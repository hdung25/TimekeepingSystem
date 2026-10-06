// Pure logic of the one-page salary review board (no Firestore, no DOM).
const assert = require('node:assert/strict');
const P = require('../js/salary-review-policy.js');
const O = require('../js/salary-review-overview-policy.js');
const B = require('../js/salary-review-board-policy.js');

// Ladder step: next ladder rate, +2.000 outside the 30–56k ladder.
assert.equal(B.nextRate(32000, P.LADDER), 34000);
assert.equal(B.nextRate(33000, P.LADDER), 34000);
assert.equal(B.nextRate(42000, P.LADDER), 48000);
assert.equal(B.nextRate(22000, P.LADDER), 24000, 'below the ladder adds 2.000đ');
assert.equal(B.nextRate(56000, P.LADDER), 58000, 'top of the ladder adds 2.000đ');
assert.equal(B.nextRate(null, P.LADDER), null);

const today = '2026-10-04';
const months = ['2026-10', ...P.previousMonths(today, 6)]; // 2026-10 .. 2026-04
const subjects = [{ id: 'math', name: 'Toán', isGroup: true },
    { id: 'm1', name: 'Toán 1', parentId: 'math' }, { id: 'm2', name: 'Toán 2', parentId: 'math' },
    { id: 'eng', name: 'Tiếng Anh', isGroup: true }, { id: 'e5', name: 'E5', parentId: 'eng' }];
const doc = (staffId, month, rates, extra = {}) => ({ id: month + '_' + staffId, giao_vien: { class_rates: rates }, ...extra });
const published = minutes => ({ published: { role: 'giao-vien', status_gv: 'received', details_gv: {
    totalBaseMins: minutes, totalTinHocMins: 0, totalPreschoolMins: 0, totalAffiliateMins: 0, totalTutoringMins: 0,
    stats: { workedShifts: 9, vpShifts: 1, vdxShifts: 0, vkpShifts: 0, lateCount: 0, totalLateMinutes: 0 } } } });
// Teacher A: Toán 1 at 32k since 2026-06 (30k before), Toán 2 at 34k; E5 at 24k for all 7 months.
const monthlyA = months.map(month => doc('a', month, {
    'Toán 1': month >= '2026-06' ? 32000 : 30000, 'Toán 2': 34000, 'E5': 24000
}, ['2026-07', '2026-08', '2026-09'].includes(month) ? published(3000) : {}));
const users = [
    { id: 'a', username: 'gv12', name: 'Giáo viên A', role: 'teacher' },
    { id: 'b', username: 'gv13', name: 'Giáo viên B', role: 'teacher' },
    { id: 'r', username: 'tt1', name: 'Tiếp tân', role: 'receptionist' }
];
const config = { cycleMonths: 3, minimumHours: 43, extraMonths: 1 };
const input = (profiles = []) => ({ users, subjects, profiles, config, monthlyByStaff: { a: monthlyA }, legacyByStaff: {},
    today, policy: P, overview: O, lifecycle: undefined, rateResolver: null });

const rows = B.buildRows(input());
const rowsA = rows.filter(r => r.staffId === 'a');
assert.equal(rows.some(r => r.staffId === 'r'), false, 'receptionists are not reviewed');
assert.equal(rows.find(r => r.staffId === 'b').category, 'nodata', 'teacher without prices is listed for detail');
const m1 = rowsA.find(r => r.subjects.some(s => s.id === 'm1'));
const e5 = rowsA.find(r => r.subjects.some(s => s.id === 'e5'));
assert.equal(m1.currentRate, 32000);
assert.equal(m1.code, 'GV12');
assert.equal(m1.msnv, '12', 'MSNV = trailing number of the username');
// Owner 06/10: rows follow MSNV ascending (gv2 before gv12, codes without a number last).
const sortUsers = [{ id: 'x', username: 'nv', name: 'Không số', role: 'teacher' },
    { id: 'c', username: 'gv12', name: 'C', role: 'teacher' }, { id: 'd', username: 'gv2', name: 'D', role: 'teacher' }];
assert.deepEqual(B.buildRows({ ...input(), users: sortUsers }).map(r => r.staffId), ['d', 'c', 'x']);
assert.equal(m1.baselineDate, '2026-06-01', 'estimate = first month of the continuous current price');
assert.equal(m1.estimate.estimated, true);
assert.equal(m1.evaluation.dueDate, '2026-09-01');
assert.equal(m1.category, 'due', 'estimated overdue groups appear in Đến hạn');
assert.equal(m1.nextRate, 34000);
assert.equal(e5.estimate.capped, true, 'price seen in every loaded month is marked "từ trước"');
assert.equal(e5.nextRate, 26000);
assert.equal(Math.round(m1.stats.averageHours), 50);
assert.equal(m1.attendance, 90);

const counts = B.summary(rows);
assert.equal(counts.setup, 1, 'multiple unconfirmed groups count as one teacher');
assert.equal(counts.due, 1, 'multiple due groups count as one teacher');
assert.equal(counts.all, 2);
assert.equal(B.groupByTeacher(rows).length, 2);
assert.deepEqual(B.groupByTeacher(rows)[0].map(row => row.key), rowsA.map(row => row.key), 'grouping keeps every independent rate and review date');
const samePrice = [{ staffId: 'a', currentRate: 22000, key: 'a1' }, { staffId: 'a', currentRate: 22000, key: 'a2' },
    { staffId: 'a', currentRate: 24000, key: 'a3' }, { staffId: 'b', currentRate: 22000, key: 'b1' }];
assert.deepEqual(B.rateBuckets(samePrice).map(bucket => bucket.map(row => row.key)), [['a1', 'a2'], ['a3'], ['b1']],
    'same-price subjects share an input, different teachers and prices remain separate');
assert.equal(B.matchesTab(m1, 'setup'), true);

// Confirmed saved group: stored baseline wins, pending change is its own tab.
const saved = { ...m1.group, confirmed: true, enabled: true, baselineDate: '2026-08-15', baselineKind: 'increase' };
const confirmedRows = B.buildRows(input([{ staffId: 'a', revision: 2, groups: [saved], personOverrides: {} }]));
const savedRow = confirmedRows.find(r => r.key === 'a|' + saved.id);
assert.equal(savedRow.confirmed, true);
assert.equal(savedRow.baselineDate, '2026-08-15');
assert.equal(savedRow.category, 'soon', 'due 15/11 is within the next two months');
const pendingRows = B.buildRows(input([{ staffId: 'a', revision: 3, groups: [{ ...saved, currentRate: 34000,
    scheduledChange: { effectiveFrom: '2026-11-01', newRate: 34000 } }], personOverrides: {} }]));
assert.equal(pendingRows.find(r => r.key === 'a|' + saved.id).category, 'pending');

// Draft confirmation never mutates the loaded profile and keeps other groups.
const profile = { revision: 2, staffId: 'a', groups: [saved], personOverrides: { minimumHours: 40 } };
const before = JSON.stringify(profile);
const draft = B.confirmDraft(profile, [{ group: e5.group, baselineDate: e5.baselineDate }]);
assert.equal(JSON.stringify(profile), before);
assert.equal(draft.groups.length, 2);
assert.equal(draft.groups[1].confirmed, true);
assert.equal(draft.groups[1].baselineDate, e5.baselineDate);
assert.equal(draft.groups[1].baselineKind, 'initial');
assert.equal(draft.groups[0].baselineKind, 'increase', 'untouched saved group keeps its kind');
assert.equal(draft.personOverrides.minimumHours, 40);
assert.equal(B.confirmDraft(profile, [{ group: saved, baselineDate: '2026-07-01' }]).groups[0].baselineKind, 'initial');

// Server preview must match what the Admin saw.
const shown = new Map([['m1', 32000], ['m5', null]]);
assert.deepEqual(B.previewProblems([{ subjectId: 'm1', name: 'Toán 1', beforeRate: 32000, afterRate: 34000 },
    { subjectId: 'm5', name: 'Toán 5', beforeRate: null, afterRate: 34000 }], shown, 34000), []);
assert.match(B.previewProblems([{ subjectId: 'm1', name: 'Toán 1', beforeRate: 33000 }], shown, 34000)[0], /khác/);
assert.match(B.previewProblems([{ subjectId: 'x', name: 'X', beforeRate: 36000 }], shown, 34000)[0], /cao hơn/);

console.log('salary-review-board.test.js: ladder step, estimated baselines, due categories, drafts and preview guard passed');
