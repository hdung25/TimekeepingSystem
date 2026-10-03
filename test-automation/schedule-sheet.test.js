'use strict';
// "Bảng lịch gửi GV" (02/10/2026): tờ lịch một buổi để gửi nhóm giáo viên (ảnh / chữ).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const sandbox = {
    console, setTimeout, clearTimeout, TextEncoder, Uint8Array, Uint32Array, DataView, ArrayBuffer,
    document: { readyState: 'complete', getElementById: () => null, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    DBService: { getSchedule: async () => null },
    SECTIONS: [
        { key: 'morning1', defaultStart: '07:30', defaultEnd: '09:00' },
        { key: 'evening1', defaultStart: '18:00', defaultEnd: '19:30' },
        { key: 'evening2', defaultStart: '19:30', defaultEnd: '21:00' }
    ],
    getLocalDateKey: () => '2026-10-01',
    renderTable() {},
    getGVList: (row, f) => (f === 'gv' ? row.gvList : row.gvThayTeList) || [],
    isRowMainTeacherAbsent: (row, id) => (row.teacherAbsences || []).some(a => a.teacherId === id),
    getMappedReplacementIds: (row, id) => ((row.teacherAbsences || []).find(a => a.teacherId === id) || {}).replacementIds || [],
    isCenterClosed: (dateKey, key, closures) => !!closures[`${dateKey}_${key}`]
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('js/schedule-sheet.js'), sandbox);
const S = sandbox.ScheduleSheet;

assert.equal(S.shortName('Nguyễn Thị Kiều My'), 'Kiều My');
assert.equal(S.shortName('Khoa'), 'Khoa');
assert.equal(S.shortName('Võ Thị Giàu'), 'Giàu', 'bỏ tên lót Thị/Văn');
assert.equal(S.shortName('Lê Văn Đại'), 'Đại');
assert.equal(S.shortName('Trần Đăng Khoa'), 'Đăng Khoa');
assert.equal(S.defaultTitle('2026-10-01', 'evening'), 'Lịch dạy Tối Thứ 5');

const day = {
    morning1: [{ lop: 'Toán 1', phong: 'P01', gvList: [{ id: 'a', name: 'Lê Văn A' }] }],
    evening1: [
        { lop: 'E8', phong: 'P15', soHS: 8, start: '18:00', end: '19:30', gvList: [{ id: 'k', name: 'Trần Đăng Khoa' }] },
        { lop: 'FFL', phong: 'P02', soHS: 5, start: '18:30', end: '19:00', note: 'qua P04', gvList: [{ id: 'm', name: 'Nguyễn Thị Kiều My' }] },
        { lop: 'E7', phong: 'P07', soHS: 5, gvList: [{ id: 'q', name: 'Phạm Minh Quân' }], gvThayTeList: [{ id: 'd', name: 'Lê Văn Đại' }],
            teacherAbsences: [{ teacherId: 'q', replacementIds: ['d'] }] },
        { lop: 'E2', phong: 'P01', gvList: [{ id: 'g', name: 'Võ Thị Giàu' }], teacherAbsences: [{ teacherId: 'g' }] },
        { lop: 'E9', phong: 'P19', soHS: 1, isClosed: true, gvList: [{ id: 'n', name: 'Ngô Nhàn' }] },
        { lop: '', phong: '', gvList: [] } // dòng trống bị bỏ
    ],
    evening2: [{ lop: 'E5', phong: 'P01', gvList: [{ id: 'y', name: 'Lê Bảo Ngọc' }] }]
};

const model = S.buildSheetModel(day, { dateKey: '2026-10-01', branch: 'cs1', buoi: 'evening', closures: {} });
assert.deepEqual(Array.from(model.sections.map(s => s.title)), ['Ca 1', 'Ca 2'], 'chỉ buổi tối');
const ca1 = model.sections[0];
assert.equal(ca1.rows.length, 5, 'bỏ dòng trống');
assert.equal(ca1.classCount, 4, 'lớp tắt không đếm');
assert.equal(ca1.studentCount, 18);
assert.equal(ca1.rows[0].time, '', 'giờ mặc định không ghi');
assert.equal(ca1.rows[1].time, '18:30–19:00', 'giờ lệch hiện ở ghi chú');
assert.equal(ca1.rows[2].teachers.replacements[0].subs[0].name, 'Lê Văn Đại', 'GV thay gắn với GV nghỉ');
assert.equal(ca1.rows[3].teachers.replacements[0].subs.length, 0, 'GV nghỉ chưa có người thay');

const html = S.renderSheetHtml(model, { footer: 'Hoàng Anh test 1/10 <UP1>' });
assert.match(html, /LỊCH DẠY TỐI THỨ 5/, 'tiêu đề in hoa như tờ giấy');
assert.equal((html.match(/class="ss-blank"/g) || []).length, 6, 'mặc định 3 dòng trống mỗi ca');
assert.equal((S.renderSheetHtml(model, { blankRows: 0 }).match(/class="ss-blank"/g) || []).length, 0);
assert.equal((S.renderSheetHtml(model, { blankRows: 2 }).match(/class="ss-blank"/g) || []).length, 4);
assert.match(html, /Kiều My/);
assert.doesNotMatch(html, /Nguyễn Thị Kiều My/, 'mặc định tên gọn');
assert.match(html, /Đại<\/div><div class="ss-was">thay <s>Minh Quân<\/s>/);
assert.match(html, /Chưa có GV thay/);
assert.match(html, /ss-row-closed/);
assert.match(html, /&lt;UP1&gt;/, 'ghi chú được escape');
assert.match(S.renderSheetHtml(model, { shortNames: false }), /Nguyễn Thị Kiều My/);

assert.equal(ca1.offTimeCount, 1, 'đếm lớp lệch giờ');
assert.match(html, /ss-row-off/);
assert.match(html, /<div class="ss-time">18:30–19:00<\/div>/, 'giờ lệch ngay dưới tên lớp');
assert.match(html, /Lưu ý: 1 lớp học giờ khác/);

// Cả ca dời giờ (Sáng Ca 1 học 08:00–09:30): giờ ca lấy theo đa số, chỉ lớp lệch bị đánh dấu.
const shifted = S.buildSheetModel({ morning1: [
    { lop: 'A', start: '08:00', end: '09:30', gvList: [{ id: 'a', name: 'A' }] },
    { lop: 'B', start: '08:00', end: '09:30', gvList: [{ id: 'b', name: 'B' }] },
    { lop: 'C', start: '07:30', end: '09:00', gvList: [{ id: 'c', name: 'C' }] }
] }, { dateKey: '2026-10-01', branch: 'cs1', buoi: 'morning', closures: {} });
assert.equal(shifted.sections[0].start, '08:00');
assert.equal(shifted.sections[0].end, '09:30');
assert.deepEqual(Array.from(shifted.sections[0].rows.map(r => r.time)), ['', '', '07:30–09:00']);

const hidden = S.buildSheetModel(day, { dateKey: '2026-10-01', branch: 'cs1', buoi: 'evening', closures: {}, showClosed: false });
assert.equal(hidden.sections[0].rows.length, 4, 'ẩn lớp đã tắt');

const closed = S.buildSheetModel(day, { dateKey: '2026-10-01', branch: 'cs1', buoi: 'evening', closures: { '2026-10-01_evening2': true } });
assert.equal(closed.sections[1].centerClosed, true);
assert.match(S.renderSheetHtml(closed), /Trung tâm nghỉ ca này/);

const text = S.sheetText(model, {});
assert.match(text, /^LỊCH DẠY TỐI THỨ 5 — 01\/10\/2026 — Cơ sở 1/);
assert.match(text, /• FFL \(⏰ 18:30–19:00\) · P02 · Kiều My · 5 HS · qua P04/);
assert.match(text, /• E7 · P07 · Đại \(thay Minh Quân\)/);
assert.match(text, /✕ \[ĐÃ TẮT\] E9/);

// Sĩ số: số kế hoạch dạng chuỗi vẫn đọc được; lịch chưa ghi thì lấy sĩ số GV báo khi chấm công.
const counted = S.buildSheetModel({ evening1: [
    { lop: 'X', phong: 'P1', soHS: ' 9 ', gvList: [{ id: 'x', name: 'X' }] },
    { lop: 'Y', phong: 'P2', soHS: 0, gvList: [{ id: 'y', name: 'Y' }] },
    { lop: 'Z', phong: 'P3', gvList: [{ id: 'z', name: 'Z' }] }
] }, { dateKey: '2026-10-01', branch: 'cs1', buoi: 'evening', closures: {},
    reportedCount: (row, sectionKey, index) => (row.lop === 'Y' && sectionKey === 'evening1' && index === 1 ? 7 : 0) });
assert.deepEqual(Array.from(counted.sections[0].rows.map(r => r.ss)), [9, 7, '']);
assert.equal(counted.sections[0].studentCount, 16);

// Excel theo mẫu: tiêu đề, hàng cột, dòng ca, lớp, 3 dòng trống mỗi ca, ghi chú cuối.
const xrows = S.sheetRows(model, { footer: 'Hoàng Anh test' });
assert.equal(xrows[0].cells[0].v, 'LỊCH DẠY TỐI THỨ 5');
assert.deepEqual(Array.from(xrows[2].cells.map(c => c.v)), ['SS', 'Lớp', 'Phòng', 'GV', 'Ghi chú']);
assert.equal(xrows[3].cells[0].v, 'Ca 1 (18:00 – 19:30) · 4 lớp · 18 HS');
const fflRow = xrows.find(r => r.cells[1] && r.cells[1].v === 'FFL');
assert.equal(fflRow.cells[0].v, 5);
assert.equal(fflRow.cells[3].v, 'Kiều My');
assert.equal(fflRow.cells[4].v, 'Giờ 18:30–19:00; qua P04');
assert.equal(xrows.find(r => r.cells[1] && r.cells[1].v === 'E7').cells[3].v, 'Đại (thay Minh Quân)');
const blankCount = xrows.filter(r => r.cells.length === 5 && !r.merge && r.cells.every(c => c.v == null)).length;
assert.equal(blankCount, 6, '3 dòng trống × 2 ca');
assert.equal(xrows[xrows.length - 1].cells[0].v, 'Hoàng Anh test');
const xlsx = Buffer.from(S.buildSheetXlsx(model, {}));
assert.equal(xlsx.readUInt32LE(0), 0x04034b50, 'xlsx là file zip');
const xml = xlsx.toString('utf8');
assert.ok(xml.includes('<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/>'), 'A4 dọc, vừa 1 trang');
assert.ok(xml.includes('<mergeCell ref="A1:E1"/>'));
assert.match(xml, /LỊCH DẠY TỐI THỨ 5/);

// Gắn vào trang + cache offline
const page = read('lich-lam.html');
assert.match(page, /js\/schedule-sheet\.js\?v=20261003-sheet-v3/);
assert.ok(page.indexOf('schedule-sheet.js') > page.indexOf('js/schedule.js'), 'nạp sau schedule.js');
assert.match(read('service-worker.js'), /'\/js\/schedule-sheet\.js\?v=20261003-sheet-v3'/);
console.log('schedule-sheet.test.js: all assertions passed');
