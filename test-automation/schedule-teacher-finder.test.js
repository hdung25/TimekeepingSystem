'use strict';
// Thanh "Tìm giáo viên" trên trang Xếp lịch (01/10/2026): gõ tên → thấy thứ mấy dạy / thứ mấy nghỉ.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

(async () => {
    const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const week = '2026-09-28'; // Thứ 2
    const docs = {
        'cs1__2026-09-28': { morning1: [{ start: '07:30', lop: 'Toán', gvList: [{ id: 'u1', name: 'Nguyễn Thị Hà' }] }] },
        'cs2__2026-09-29': { evening1: [{ start: '18:00', lop: 'Anh', gvList: [{ id: 'u1', name: 'Nguyễn Thị Hà' }], teacherAbsences: [{ teacherId: 'u1' }] }] },
        'cs1__2026-09-30': { afternoon1: [{ start: '14:00', lop: 'Lý', gvList: [{ id: 'u2', name: 'Trần Văn Bình' }], gvThayTeList: [{ id: 'u1', name: 'Nguyễn Thị Hà' }] }] },
        'cs1__2026-10-01': { morning1: [{ start: '07:30', lop: 'Hóa', isClosed: true, gvList: [{ id: 'u1', name: 'Nguyễn Thị Hà' }] }] }
    };
    const sandbox = {
        console, setTimeout, setInterval: () => 0, clearTimeout,
        document: { readyState: 'complete', getElementById: () => null, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
        DBService: { getSchedule: async k => docs[k] || null },
        SECTIONS: [{ key: 'morning1', defaultStart: '07:30' }, { key: 'afternoon1', defaultStart: '14:00' }, { key: 'evening1', defaultStart: '18:00' }],
        DAYS: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'],
        currentWeekStart: new Date(2026, 8, 28), currentBranch: 'cs1', selectedDayIndex: 0,
        getLocalDateKey: key,
        getGVList: (row, f) => (f === 'gv' ? row.gvList : row.gvThayTeList) || [],
        isRowMainTeacherAbsent: (row, id) => (row.teacherAbsences || []).some(a => a.teacherId === id),
        isCenterClosed: () => false,
        renderDayTabs() {}, renderTable() {}
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('js/schedule-teacher-finder.js'), sandbox);
    const F = sandbox.ScheduleTeacherFinder;

    assert.equal(F.fold('Nguyễn Đức'), 'nguyen duc', 'tìm không dấu');
    await F.loadWeek(true);
    const days = F.summarize({ id: 'u1', name: 'Nguyễn Thị Hà' });
    assert.equal(days.length, 7);
    assert.deepEqual(Array.from(days[0].shifts.map(s => `${s.branch}:${s.label}:${s.role}`)), ['cs1:Toán:main'], 'T2 dạy');
    assert.equal(days[1].shifts.length, 0, 'T3 không có ca dạy');
    assert.deepEqual(Array.from(days[1].absent.map(s => s.label)), ['Anh'], 'T3 đã báo nghỉ');
    assert.deepEqual(Array.from(days[2].shifts.map(s => s.role)), ['sub'], 'T4 dạy thay');
    assert.equal(days[3].shifts.length + days[3].absent.length, 0, 'lớp đã tắt không tính');
    assert.equal(days[3].closedShifts, 1);
    assert.equal(days[4].shifts.length + days[4].absent.length, 0, 'T6 không có lịch');
    // GV khác không lẫn
    const other = F.summarize({ id: 'u2', name: 'Trần Văn Bình' });
    assert.equal(other[2].shifts.length, 1);
    assert.equal(other[0].shifts.length, 0);

    // Gắn vào trang + cache offline
    const html = read('lich-lam.html');
    assert.match(html, /js\/schedule-teacher-finder\.js\?v=20261001-finder-v1/);
    assert.ok(html.indexOf('schedule-teacher-finder.js') > html.indexOf('js/schedule.js'), 'nạp sau schedule.js');
    assert.match(read('service-worker.js'), /'\/js\/schedule-teacher-finder\.js\?v=20261001-finder-v1'/);
    console.log('schedule-teacher-finder.test.js: all assertions passed');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
