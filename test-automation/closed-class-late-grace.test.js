// 1) Lớp đã tắt không được che lớp còn mở cùng giờ của cùng GV (cô Thảo 03/10: Starters tắt, dạy Flyers).
// 2) GV/trợ giảng vào trễ tối đa 30 giây vẫn tính đúng giờ.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'evaluation-service.js'), 'utf8');
const context = {
    console, Date, Math, Set, Map, Intl,
    window: { centerClosures: {}, getIconHtml: () => '' },
    getLocalDateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    isScheduledMainTeacher: (cls, id) => cls.gvId === id || (cls.gvList || []).some(g => g.id === id),
    isScheduledSubstitute: () => false,
    hasScheduledSubstitute: () => false
};
vm.createContext(context);
vm.runInContext(source, context);

const staffId = 'teacher-thao';
const dateKey = '2026-10-03';
const row = (lop, lopId, extra = {}) => ({
    start: '18:00', end: '19:30', lop, lopId, gvId: staffId, registeredTeachers: [],
    _branch: 'cs2', _compositeKey: `cs2__${dateKey}`, ...extra
});
const user = {
    roles: ['teaching_assistant'],
    salary_config: { roles: [{ id: 'flyers', name: 'Flyers', rate: 100000 }, { id: 'starters', name: 'Starters', rate: 90000 }] }
};
const chipsFor = (rows, session, profile = user) => context.window.calculateDailyChips(
    { evening1: rows }, [session], staffId, dateKey, profile, [], {}, [], {}, []
);
const at = (time) => new Date(`${dateKey}T${time}`).toISOString();
const session = (checkIn, checkOut, extra = {}) => ({
    id: 's1', status: checkOut ? 'closed' : 'open', source: 'self', start: at(checkIn), checkIn: at(checkIn),
    checkOut: checkOut ? at(checkOut) : null, role: null, ...extra
});
const assertFlyersChip = (chips) => {
    assert.equal(chips.length, 1, JSON.stringify(chips.map(c => c.text)));
    assert.match(chips[0].text, /Flyers/);
    assert.doesNotMatch(chips[0].text, /Role\?|Starters/);
    assert.equal(chips[0].paidMinutes, 90);
};

// Dữ liệu thật: lớp tắt đứng trước lớp còn mở trong cùng ca.
const closedFirst = [
    row('Starters', 'starters', { isClosed: true, _originalIndex: 5 }),
    row('Flyers', 'flyers', { _originalIndex: 6 })
];
assertFlyersChip(chipsFor(closedFirst, session('17:48:49', '19:30:00')));
// Lớp tắt đứng sau cũng phải cho cùng kết quả.
assertFlyersChip(chipsFor([closedFirst[1], closedFirst[0]], session('17:48:49', '19:30:00')));
// Hồ sơ thật không có đơn giá riêng (hai lớp hòa giá) và lớp tắt giá cao hơn: lớp tắt vẫn không được thắng.
assertFlyersChip(chipsFor(closedFirst, session('17:48:49', '19:30:00'), { roles: ['teaching_assistant'], salary_config: { roles: [] } }));
assertFlyersChip(chipsFor(closedFirst, session('17:48:49', '19:30:00'), {
    roles: ['teaching_assistant'],
    salary_config: { roles: [{ id: 'flyers', name: 'Flyers', rate: 50000 }, { id: 'starters', name: 'Starters', rate: 90000 }] }
}));
// Phiên đã được sửa tay chọn môn Flyers (bản Chị Thúy sửa) không bị tính đôi.
assertFlyersChip(chipsFor(closedFirst, session('18:00:00', '19:30:00', {
    role: 'flyers', roleName: 'Flyers', roleAssignmentSource: 'manual', subjectOverride: true, isAdminEdited: true
})));
// Mọi lớp đều tắt: không sinh chip công cho lớp, phiên vẫn còn nguyên để xử lý thủ công.
const allClosed = chipsFor([row('Starters', 'starters', { isClosed: true })], session('17:48:49', '19:30:00'));
assert.ok(!allClosed.some(c => /Starters/.test(c.text)), 'lớp đã tắt không được có chip lớp');

// Hai lớp còn mở cùng giờ vẫn gộp thành MỘT ca, không lương đôi.
const bothOpen = chipsFor([row('E2', 'flyers'), row('E5', 'starters')], session('17:50:00', '19:30:00'));
assert.equal(bothOpen.length, 1);
assert.equal(bothOpen[0].paidMinutes, 90);

// Ân hạn 30 giây: tròn 30 giây còn đúng giờ, từ 31 giây là trễ.
const oneClass = [row('Flyers', 'flyers')];
for (const [checkIn, expectedLate, expectedMinutes] of [
    ['18:00:00', 0, 90], ['18:00:29', 0, 90], ['18:00:30', 0, 90],
    ['18:00:31', 1, 89], ['18:01:00', 1, 89], ['18:05:00', 5, 85]
]) {
    const chip = chipsFor(oneClass, session(checkIn, '19:30:00'))[0];
    const late = Number(/\(T(\d+)p\)/.exec(chip.text)?.[1] || 0);
    assert.equal(late, expectedLate, `${checkIn}: ${chip.text}`);
    assert.equal(chip.paidMinutes, expectedMinutes, `${checkIn}: ${chip.paidMinutes}`);
    assert.equal(chip.class.includes('chip-orange'), expectedLate > 0, `${checkIn}: ${chip.class}`);
}

// Quan sát ca + biểu đồ cùng mức 30 giây.
assert.match(fs.readFileSync(path.join(root, 'js', 'shift-oversight.js'), 'utf8'), /checkIn - scheduledStart <= 30 \* 1000/);
assert.match(fs.readFileSync(path.join(root, 'js', 'chart-service.js'), 'utf8'), /diffMs < -30 \* 1000/);

console.log('closed-class-late-grace: OK');
