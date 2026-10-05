// "Bảng cơ cấu lương 1" (new-mode teachers): every bonus = đ/giờ × paid teaching hours.
const assert = require('node:assert/strict');
const P = require('../js/teacher-attendance-policy.js');
const src = (hours, extra = {}) => ({ minutes: hours * 60, vp: 0, vdx: 0, vkp: 0, unreported: 0, lateMinutes: 0, lateCount: 0, ...extra });
const amounts = result => Object.fromEntries(result.rows.map(row => [row.id, row.amount]));
const full = { state: 'full', streakCut: false };

// Perfect month, 60 hours: I 4.000, II 2.000, III 2.000, VI 2.000, X 3.000.
let r = P.newModeRows(src(60), { meeting: full });
assert.deepEqual(amounts(r), { 0: 240000, 1: 120000, 2: 120000, 5: 120000, 9: 180000 });
assert.deepEqual(r.cut, []);
assert.ok(r.rows.every(row => row.note.startsWith('Tự động CCL1:') && row.manual === false));

// I. Chuyên cần: VP ≥24h 2.000; VĐX <24h (and unreported) 1.000; VKP 0; worst wins.
assert.equal(amounts(P.newModeRows(src(10, { vp: 2 }), {}))[0], 20000);
assert.equal(amounts(P.newModeRows(src(10, { vp: 1, vdx: 1 }), {}))[0], 10000);
assert.equal(amounts(P.newModeRows(src(10, { unreported: 1 }), {}))[0], 10000, 'unreported absence counts as late notice');
assert.equal(amounts(P.newModeRows(src(10, { vp: 1, vkp: 1 }), {}))[0], 0);

// II. Đúng giờ: 0 late → 2.000; late ≤ 1/9 hours AND count < 5.5% of 90-min shifts → 1.000; else 0.
// 60 h = 40 shifts → < 2.2 lates allowed; 60 h / 9 = 400 minutes.
assert.equal(amounts(P.newModeRows(src(60, { lateCount: 2, lateMinutes: 30 }), {}))[1], 60000);
assert.equal(amounts(P.newModeRows(src(60, { lateCount: 3, lateMinutes: 30 }), {}))[1], 0, 'too many late shifts');
assert.equal(amounts(P.newModeRows(src(60, { lateCount: 1, lateMinutes: 401 }), {}))[1], 0, 'too many late minutes');

// III. Tập trung and VI. Nhận xét are Admin choices.
r = P.newModeRows(src(10), { focus: 'fail', report: 'late' });
assert.equal(amounts(r)[2], 0); assert.equal(amounts(r)[5], 10000);
assert.equal(amounts(P.newModeRows(src(10), { report: 'none' }))[5], 0);

// X. Họp: full 3.000, permitted 1.000, unpermitted 0, no meeting 0; unknown → no automatic row.
assert.equal(amounts(P.newModeRows(src(10), { meeting: { state: 'permitted' } }))[9], 10000);
assert.equal(amounts(P.newModeRows(src(10), { meeting: { state: 'unpermitted' } }))[9], 0);
assert.equal(amounts(P.newModeRows(src(10), { meeting: { state: 'none' } }))[9], 0);
assert.equal(P.newModeRows(src(10), {}).rows.some(row => row.id === 9), false);
assert.equal(P.meetingStateFromStatuses({ a: 'Có', b: 'Vắng phép' }), 'permitted');
assert.equal(P.meetingStateFromStatuses(['Có', 'Vắng không phép']), 'unpermitted');
assert.equal(P.meetingStateFromStatuses(['Trễ', 'Không họp']), 'full');
assert.equal(P.meetingStateFromStatuses(['Không họp']), 'none');

// Cut every bonus: trial, no report all month, 3 months absent from meetings.
for (const input of [{ trial: true, meeting: full }, { report: 'missing', meeting: full }, { meeting: { state: 'full', streakCut: true } }]) {
    r = P.newModeRows(src(60), input);
    assert.equal(r.cut.length, 1);
    assert.ok(r.rows.every(row => row.amount === 0), JSON.stringify(input));
}

// Streak: 3 absent months in a row (incl. current) → cut; first attended month after it still cut; second restores.
assert.equal(P.meetingStreakCut('permitted', ['unpermitted', 'permitted']), true);
assert.equal(P.meetingStreakCut('unpermitted', ['unpermitted', 'full']), false);
assert.equal(P.meetingStreakCut('full', ['permitted', 'unpermitted', 'permitted']), true, 'first attended month after the streak');
assert.equal(P.meetingStreakCut('full', ['full', 'permitted', 'unpermitted']), false, 'second attended month restores');
assert.equal(P.meetingStreakCut('unpermitted', ['unknown', 'unpermitted']), false, 'unknown months never count as absent');
assert.equal(P.meetingStreakCut('none', ['permitted', 'permitted', 'permitted']), false);

// Rounding only on the final amount; no negative amounts.
assert.equal(amounts(P.newModeRows({ ...src(0), minutes: 125 }, {}))[0], 8333);
assert.ok(P.newModeRows(src(30, { vkp: 3, lateCount: 9, lateMinutes: 600 }), { focus: 'fail', report: 'none', meeting: { state: 'unpermitted' } }).rows.every(row => row.amount === 0));
console.log('teacher-new-mode-policy.test.js: CCL1 tiers, Admin choices, meetings, cut rules and streak passed');
