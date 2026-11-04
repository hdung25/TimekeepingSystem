// Dạy thay đột xuất trong ca tiếp tân (v257): Huy đang trực 13:30–18:00 thì được nhờ
// dạy thay 15:00–16:30 vì thiếu GV, không kịp xếp lịch. Admin/TLCC ghi thêm một phiên
// dạy `inShiftTeaching` nằm trong phiên tiếp tân → phần dạy tính giá môn, phần tiếp tân
// chỉ còn 3h, tổng ngày vẫn đúng 4h30 (không tính trùng giờ nào).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'evaluation-service.js'), 'utf8');
const context = {
    console, Date, Math, Set, Map, Intl,
    window: { centerClosures: {}, getIconHtml: () => '' },
    getLocalDateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    isScheduledMainTeacher: (cls, id) => cls.gvId === id || (cls.gvList || []).some(g => g.id === id),
    isScheduledSubstitute: (cls, id) =>
        cls.gvThayTheId === id || cls.gvThayTeId === id ||
        (cls.gvThayTheList || []).some(g => g.id === id) ||
        (cls.gvThayTeList || []).some(g => g.id === id),
    hasScheduledSubstitute: cls =>
        !!cls.gvThayTheId || !!cls.gvThayTeId ||
        (cls.gvThayTheList || []).length > 0 || (cls.gvThayTeList || []).length > 0
};
vm.createContext(context);
vm.runInContext(source, context);

const staffId = 'nv_huy';
const dateKey = '2026-11-03';
const huy = {
    roles: ['teaching_assistant', 'receptionist'],
    salary_config: {
        receptionist_normal_rate: 30000,
        roles: [{ id: 'subject-e3', name: 'E3', rate: 100000 }]
    }
};
const afternoon = [{ shift: 'afternoon', label: 'CHIỀU', start: '13:30', end: '18:00', branch: 'cs1' }];
const reception = {
    id: 'huy-reception',
    checkIn: `${dateKey}T13:30:00+07:00`,
    checkOut: `${dateKey}T18:00:00+07:00`,
    role: 'tiep-tan',
    roleName: 'Tiếp Tân'
};
const cover = {
    id: 'huy-cover',
    type: 'admin_add',
    isAdminEdited: true,
    inShiftTeaching: true,
    hostSessionId: 'huy-reception',
    checkIn: `${dateKey}T15:00:00+07:00`,
    checkOut: `${dateKey}T16:30:00+07:00`,
    role: 'subject-e3',
    roleName: 'E3',
    roleRate: 100000,
    roleAssignmentSource: 'manual'
};

const run = (sessions, shifts = afternoon, schedule = {}) =>
    context.window.calculateDailyChips(schedule, sessions.map(s => ({ ...s })), staffId, dateKey, huy, shifts);
const total = chips => chips.reduce((sum, chip) => sum + (chip.paidMinutes || 0), 0);

{
    // Ca tiếp tân có trong lịch.
    const chips = run([reception, cover]);
    const recep = chips.find(c => c.isReceptionist && c.sessionId === 'huy-reception');
    const teach = chips.find(c => c.sessionId === 'huy-cover');
    assert.ok(recep && teach, 'phải có chip tiếp tân và chip dạy thay');
    assert.equal(recep.paidMinutes, 180, 'tiếp tân còn 3h (4h30 − 1h30 dạy)');
    assert.match(recep.text, /−1h30p dạy/);
    assert.equal(
        recep.daySegments.map(s => `${s.start}-${s.end}/${s.kind}`).join(' | '),
        '13:30-15:00/tiep-tan | 15:00-16:30/day | 16:30-18:00/tiep-tan'
    );
    assert.equal(teach.paidMinutes, 90, 'dạy thay 1h30');
    assert.equal(teach.isTeaching, true);
    assert.equal(teach.isReceptionist, false);
    assert.equal(teach.sessionData.role, 'subject-e3', 'phần dạy tính theo môn E3');
    assert.match(teach.text, /dạy thay trong ca/);
    assert.equal(teach.isWarning, false);
    assert.equal(total(chips), 270, 'tổng ngày vẫn 4h30');
}

{
    // Thứ tự phiên đảo ngược cũng không được trừ hai lần.
    const chips = run([cover, reception]);
    assert.equal(chips.find(c => c.sessionId === 'huy-reception').paidMinutes, 180);
    assert.equal(chips.find(c => c.sessionId === 'huy-cover').paidMinutes, 90);
    assert.equal(total(chips), 270);
}

for (const order of [[reception, cover], [cover, reception]]) {
    // Ca tiếp tân ngoài lịch (không có ca trong lịch tiếp tân).
    const chips = run(order, []);
    const recep = chips.find(c => c.sessionId === 'huy-reception');
    const teach = chips.find(c => c.sessionId === 'huy-cover');
    assert.equal(recep.paidMinutes, 180, 'tiếp tân ngoài lịch cũng trừ phần dạy');
    assert.match(recep.text, /−1h30p dạy/);
    assert.equal(teach.paidMinutes, 90, 'phần dạy không bị coi là trùng giờ');
    assert.doesNotMatch(teach.text, /trùng giờ/);
    assert.equal(total(chips), 270);
}

{
    // Sau đó lớp cũng được xếp lịch cho Huy cùng giờ: chỉ tính dạy một lần.
    const schedule = {
        afternoon2: [{
            start: '15:00', end: '16:30', lop: 'E3', lopId: 'subject-e3',
            gvId: staffId, registeredTeachers: [],
            _branch: 'cs1', _compositeKey: 'cs1__2026-11-03', _originalIndex: 0
        }]
    };
    const chips = run([reception, cover], afternoon, schedule);
    assert.equal(total(chips), 270, 'lớp trong lịch + phần dạy thay không được cộng trùng');
    assert.equal(chips.find(c => c.sessionId === 'huy-reception' && c.isReceptionist).paidMinutes, 180);
    const teachMinutes = chips.filter(c => c.isTeaching).reduce((sum, c) => sum + c.paidMinutes, 0);
    assert.equal(teachMinutes, 90);
}

{
    // Không có phần dạy thay: hành vi cũ giữ nguyên.
    const chips = run([reception]);
    assert.equal(total(chips), 270);
    assert.equal(chips.length, 1);
}

{
    // Phần dạy thay bị đánh vắng thì không khoét ca tiếp tân.
    const chips = run([reception, { ...cover, isAbsent: true }]);
    assert.equal(chips.find(c => c.sessionId === 'huy-reception').paidMinutes, 270);
}

// ===== Ghi dữ liệu: addSession(..., { inShiftHostId }) =====
{
    const dbSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-service.js'), 'utf8').replace(/\r\n/g, '\n');
    const fnStart = dbSource.indexOf('addSession: async (userId, dateKey, sessionData, options = {}) => {');
    const guardStart = dbSource.indexOf('// === DẠY THAY ĐỘT XUẤT TRONG CA TIẾP TÂN ===', fnStart);
    const guardEnd = dbSource.indexOf('\n                }\n', dbSource.indexOf('err.clash = clash;', guardStart));
    assert.ok(fnStart !== -1 && guardStart !== -1 && guardEnd !== -1, 'không tìm thấy khối kiểm tra dạy thay trong addSession');
    const guardContext = { Date, Math, console };
    vm.createContext(guardContext);
    vm.runInContext(
        'function runGuard(dateKey, data, sessionData, options) {\n' +
        '    const newStart = sessionData.checkIn || sessionData.start;\n' +
        dbSource.slice(guardStart, guardEnd + 20) + '\n' +
        '    return inShiftHost ? "ADDED:" + inShiftHost.id : "ADDED";\n' +
        '}',
        guardContext
    );
    const at = hm => `${dateKey}T${hm}:00+07:00`;
    const day = () => ({ sessions: [
        { id: 'host', checkIn: `${dateKey}T13:29:41+07:00`, checkOut: `${dateKey}T18:00:12+07:00`, role: 'tiep-tan' },
        { id: 'evening', checkIn: at('18:00'), checkOut: at('19:30'), role: 'subject-e3' }
    ] });
    const part = (a, b) => ({ checkIn: at(a), start: at(a), checkOut: at(b), role: 'subject-e3' });

    assert.equal(guardContext.runGuard(dateKey, day(), part('15:00', '16:30'), { inShiftHostId: 'host' }), 'ADDED:host',
        'phần dạy thay nằm trong ca tiếp tân được ghi dù chồng lên ca đó');
    assert.equal(guardContext.runGuard(dateKey, day(), part('13:30', '18:00'), { inShiftHostId: 'host' }), 'ADDED:host',
        'giờ chọn theo phút vẫn khớp giờ vào/ra có giây');
    assert.throws(() => guardContext.runGuard(dateKey, day(), part('15:00', '16:30'), {}),
        e => e.code === 'SESSION_OVERLAP', 'không có phiên chủ thì vẫn chặn trùng giờ như cũ');
    assert.throws(() => guardContext.runGuard(dateKey, day(), part('17:00', '18:30'), { inShiftHostId: 'host' }),
        e => e.code === 'IN_SHIFT_OUTSIDE_HOST', 'không được lấn ra ngoài ca tiếp tân');
    assert.throws(() => guardContext.runGuard(dateKey, day(), part('15:00', '16:30'), { inShiftHostId: 'evening' }),
        e => e.code === 'IN_SHIFT_HOST_MISSING', 'phiên chủ phải là ca tiếp tân/văn phòng');
    assert.throws(() => guardContext.runGuard(dateKey, day(), part('15:00', '16:30'), { inShiftHostId: 'missing' }),
        e => e.code === 'IN_SHIFT_HOST_MISSING');
    const overridden = day();
    overridden.sessions[0].adminPayrollOverride = { mode: 'manual', revision: 1 };
    assert.throws(() => guardContext.runGuard(dateKey, overridden, part('15:00', '16:30'), { inShiftHostId: 'host' }),
        e => e.code === 'IN_SHIFT_HOST_OVERRIDE');
    const withCover = day();
    withCover.sessions.push({ id: 'cover1', checkIn: at('15:00'), checkOut: at('16:30'), role: 'subject-e3', inShiftTeaching: true, hostSessionId: 'host' });
    assert.throws(() => guardContext.runGuard(dateKey, withCover, part('16:00', '17:00'), { inShiftHostId: 'host' }),
        e => e.code === 'SESSION_OVERLAP', 'hai phần dạy thay chồng nhau vẫn bị chặn');
    assert.equal(guardContext.runGuard(dateKey, withCover, part('16:30', '17:30'), { inShiftHostId: 'host' }), 'ADDED:host');
}

console.log('in-shift teaching tests passed');
