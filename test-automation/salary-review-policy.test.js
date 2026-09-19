const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Policy = require('../js/salary-review-policy.js');
const RatePolicy = require('../js/subject-rate-policy.js');

// Exercise the same component lifecycle production uses, not just a test stub.
const dbSource = fs.readFileSync(path.join(__dirname, '../js/db-service.js'), 'utf8');
const lifecycleStart = dbSource.indexOf('// PAYSLIP LIFECYCLE HELPERS START');
const lifecycleEnd = dbSource.indexOf('function _getPayslipPaymentBreakdown', lifecycleStart);
assert.ok(lifecycleStart >= 0 && lifecycleEnd > lifecycleStart);
const lifecycle = new Function(dbSource.slice(lifecycleStart, lifecycleEnd) + '; return _getPayslipLifecycleState;')();
const opts = { lifecycle };
const snapshot = (staffId, month, minutes, published = {}) => ({
    id: `${month}_${staffId}`,
    published: { role: 'giao-vien', status: 'published', details: { totalBaseMins: minutes }, ...published }
});

assert.equal(Policy.dateKey('2026-08-31T17:00:00Z'), '2026-09-01', 'Use the Vietnam date, independent of browser timezone');
assert.equal(Policy.dateKey('2026-08-31'), '2026-08-31');
assert.equal(Policy.dateKey('2026-02-30'), '');
assert.equal(Policy.dateKey(null), '');
assert.equal(Policy.addMonths('2024-01-31', 1), '2024-02-29');
assert.equal(Policy.addMonths('2026-01-31', 1), '2026-02-28');
assert.equal(Policy.addMonths('2026-08-31', 6), '2027-02-28');
assert.equal(Policy.addMonths('2026-02-30', 1), '');
assert.equal(Policy.addMonths('2026-09-19', 1.5), '');
assert.deepEqual(Policy.previousMonths('2026-01-01'), ['2025-12', '2025-11', '2025-10']);
assert.deepEqual(Policy.previousMonths('2026-09-01', 10000), []);

assert.equal(Policy.isTeacher({ roles: ['senior_assistant'] }), false);
assert.equal(Policy.isTeacher({ roles: ['receptionist_assistant'] }), false);
assert.equal(Policy.isTeacher({ roles: ['senior_assistant', 'teacher'] }), true);
assert.equal(Policy.isTeacher({ roles: ['assistant'] }), true, 'Align with existing RolePolicy employment classification');
assert.equal(Policy.isTeacher({ roles: [], role: 'staff' }), true);
assert.equal(Policy.isTeacher({ role: 'teacher', isActive: false }), false);
assert.equal(Policy.isTeacher({ role: 'teacher', status: 'RESIGNED' }), false);

const teaching = snapshot('dual', '2026-08', 60, {
    role: 'dual', status: 'published', status_gv: 'received', status_tt: 'draft',
    details: { totalBaseMins: 99999 },
    details_gv: { totalBaseMins: 60, totalTinHocMins: 30, totalPreschoolMins: 10, totalAffiliateMins: 20, totalTutoringMins: 15, totalExtraMins: 999 },
    details_tt: { filteredMinutes: 12000 }
});
assert.equal(Policy.teachingMinutes(teaching, opts), 135, 'Exclude receptionist and extra minutes; include all teaching payroll categories');
assert.equal(Policy.teachingMinutes(teaching), 135, 'Compatibility fallback agrees with DBService');
const draftSibling = structuredClone(teaching);
delete draftSibling.published.status_gv;
draftSibling.published.status_tt = 'received';
assert.equal(Policy.teachingMinutes(draftSibling, opts), null, 'Received receptionist component cannot promote teacher draft');
assert.equal(Policy.teachingMinutes(draftSibling), null);
assert.equal(Policy.teachingMinutes(snapshot('t', '2026-08', 0), opts), 0);
assert.equal(Policy.teachingMinutes(snapshot('t', '2026-08', ''), opts), null);
assert.equal(Policy.teachingMinutes(snapshot('t', '2026-08', null), opts), null);
assert.equal(Policy.teachingMinutes(snapshot('t', '2026-08', -1), opts), null);
assert.equal(Policy.teachingMinutes(snapshot('t', '2026-08', 60, { status: 'draft' }), opts), null);
assert.equal(Policy.teachingMinutes(snapshot('t', '2026-08', 60, { role: 'dual' }), opts), null, 'Ambiguous legacy dual-role details are not teaching proof');

const months = ['2026-08', '2026-07', '2026-06'];
const docs = [snapshot('a', '2026-08', 600), snapshot('a', '2026-07', 0)];
const stats = Policy.statistics('a', months, docs, opts);
assert.equal(stats.averageHours, 5);
assert.equal(stats.complete, false);
assert.deepEqual(stats.missingMonths, ['2026-06']);
assert.equal(stats.rows[1].minutes, 0);
assert.equal(stats.rows[2].minutes, null);
assert.ok(stats.missingStats.includes('lateCount'), 'Missing attendance stats are not claimed to be confirmed zero');
const duplicate = Policy.statistics('a', ['2026-08'], [...docs, docs[0], docs[0]], opts);
assert.equal(duplicate.complete, false);
assert.equal(duplicate.rows[0].status, 'duplicate');

const users = [{ id: 'a', role: 'teacher' }, { id: 'b', role: 'teaching_assistant' }, { id: 'c', role: 'staff' }, { id: 'r', role: 'receptionist' }];
const benchmark = Policy.benchmark(users, [...docs, snapshot('b', '2026-08', 0), snapshot('c', '2026-08', 12000, { status: 'draft' }), snapshot('a', '2026-09', 30000), snapshot('r', '2026-08', 60000)], '2026-09-19', opts);
assert.equal(benchmark.month, '2026-08');
assert.equal(benchmark.people, 2);
assert.equal(benchmark.totalPeople, 3);
assert.equal(benchmark.meanHours, 5);
assert.equal(benchmark.zeroHours, 1);
assert.equal(benchmark.missingPeople, 1);
assert.equal(benchmark.complete, false);
assert.equal(Policy.benchmark(users, [snapshot('a', '2026-06', 10000)], '2026-09-19', opts).hours, null, 'No silent fallback to a stale month');

const subjects = [
    { id: 'eng', name: 'Tiếng Anh', isGroup: true },
    { id: 'school', name: 'Tiếng Anh trên trường', isGroup: true, parentId: 'eng' },
    { id: 'talk', name: 'Tiếng Anh giao tiếp', isGroup: true, parentId: 'eng' },
    { id: 'e1', name: 'E1', parentId: 'school' },
    { id: 'e2', name: 'E2', parentId: 'school' },
    { id: 'e3', name: 'E3', parentId: 'school' },
    { id: 'talk1', name: 'FFS 1', parentId: 'talk' },
    { id: 'math', name: 'Toán - TV', isGroup: true },
    { id: 'm1', name: 'Toán 1', parentId: 'math' },
    { id: 'm5', name: 'Toán lớp 5', parentId: 'math' },
    { id: 'm6', name: 'Toán 6', parentId: 'math' },
    { id: 'm9', name: 'Toán 9', parentId: 'math' },
    { id: 'm10', name: 'Toán 10', parentId: 'math' },
    { id: 'tv', name: 'Tiếng Việt 1', parentId: 'math' },
    { id: 'nv', name: 'Ngữ Văn 9', parentId: 'math' },
    { id: 'link', name: 'LIÊN KẾT', isGroup: true },
    { id: 'link1', name: 'Liên kết A', parentId: 'link' },
    { id: 'home', name: 'Dạy tại nhà' },
    { id: 'pre1', name: 'Pre I1', parentId: 'talk' },
    { id: 'pre2', name: 'PRE-I1', parentId: 'talk' }
];
const groups = Policy.catalogGroups(subjects);
assert.deepEqual(groups.find(g => g.id === 'math:level1').subjectIds, ['m1', 'm5']);
assert.deepEqual(groups.find(g => g.id === 'math:level2').subjectIds, ['m6', 'm9']);
assert.deepEqual(groups.find(g => g.id === 'math:level3').subjectIds, ['m10']);
assert.deepEqual(groups.find(g => g.id === 'math').subjectIds, ['tv', 'nv']);
assert.deepEqual(groups.find(g => g.id === 'school').subjectIds, ['e1', 'e2', 'e3']);
assert.ok(groups.every(g => !g.subjectIds.includes('link1') && !g.subjectIds.includes('home')));
const cyclicCatalog = [{ id: 'a', name: 'A', isGroup: true, parentId: 'b' }, { id: 'b', name: 'B', isGroup: true, parentId: 'a' }, { id: 'c', name: 'C', parentId: 'a' }];
assert.equal(Policy.catalogGroups(cyclicCatalog).length, 1, 'Malformed ancestry cannot loop');

const salaryDocs = [
    { ...snapshot('a', '2026-08', 600), giao_vien: { class_rates: { E1: 34000, E2: 34000, E3: 37000, 'Toán 1': 0, 'Pre I1': 48000, 'Toán 6 + Toán 9': 66667, 'Toán 9 (+10 HS)': 90000 } }, 'giao-vien': { class_rates: { E1: 30000 } }, published: { role: 'teacher', status: 'published', details: { totalBaseMins: 600 }, breakdown: [{ name: 'E1', rate: 32000 }] } },
    { id: '2026-07_a', giao_vien: { class_rates: { E1: 34000, E2: 34000, E3: 37000 } } },
    { id: '2026-05_a', giao_vien: { class_rates: { E1: 34000 } } },
    { id: '2026-10_a', giao_vien: { class_rates: { E1: 99000 } } },
    { id: '2026-08_another', giao_vien: { class_rates: { 'Toán 1': 99999 } } }
];
const person = { id: 'a', salary_config: { roles: [{ id: 'pre2', name: 'PRE-I1', rate: 46000 }, { id: 'm10', name: 'Toán 10', rate: 60000 }], subjectRatePolicy: { mode: 'group', effectiveFrom: '2026-09-01', groupRates: [{ groupId: 'math', rate: 50000 }] } } };
const before = JSON.stringify({ subjects, salaryDocs, person });
const inferred = Policy.inferGroups(person, subjects, salaryDocs, { ...opts, today: '2026-09-19', rateResolver: RatePolicy, legacySettings: { class_rates: { 'FFS 1': 44000 } } });
const school = inferred.find(g => g.id === 'school');
assert.equal(school.suggestedRate, 34000);
assert.equal(school.mixedRates, true);
assert.equal(school.exceptions[0].subjectId, 'e3');
assert.equal(school.contradictions.length, 1, 'Snapshot/config conflict must stay visible');
assert.equal(school.evidence[0].source, 'monthly_config');
assert.equal(school.evidence[0].month, '2026-08');
assert.equal(school.observedSince, '', 'Mixed/conflicting evidence cannot claim a common start month');
assert.equal(inferred.find(g => g.id === 'math:level1').evidence.find(e => e.subjectId === 'm1').rate, 0, 'Explicit zero survives all positive fallback prices');
assert.equal(inferred.find(g => g.id === 'math:level1').evidence.find(e => e.subjectId === 'm5').source, 'personnel_group_config');
assert.equal(inferred.find(g => g.id === 'math:level3').suggestedRate, 60000, 'Outside-ladder exact override is preserved');
const talk = inferred.find(g => g.id === 'talk');
assert.equal(talk.evidence.find(e => e.subjectId === 'talk1').source, 'legacy_salary_settings');
assert.equal(talk.evidence.find(e => e.subjectId === 'pre1').status, 'ambiguous_name');
assert.equal(talk.evidence.find(e => e.subjectId === 'pre1').rate, null);
assert.equal(talk.evidence.find(e => e.subjectId === 'pre2').rate, 46000, 'Exact ID is still trustworthy when normalized name is ambiguous');
const middle = inferred.find(g => g.id === 'math:level2');
assert.equal(middle.specialEvidence.length, 2);
assert.equal(middle.suggestedRate, 50000, 'Only independently configured group rate is suggested, never a combined/crowded price');
const noFallback = Policy.inferGroups({ id: 'a', salary_config: { roles: [{ id: 'unknown', name: 'Default legacy', rate: 99000 }] } }, subjects, salaryDocs, { today: '2026-09-19', rateResolver: RatePolicy });
assert.equal(noFallback.find(g => g.id === 'math:level2').suggestedRate, null);
assert.equal(JSON.stringify({ subjects, salaryDocs, person }), before, 'Inference is side-effect-free');

const single = [{ id: 'x', name: 'X' }];
const history = [{ id: '2026-08_a', giao_vien: { class_rates: { X: 32000 } } }, { id: '2026-07_a', giao_vien: { class_rates: { X: 32000 } } }, { id: '2026-05_a', giao_vien: { class_rates: { X: 32000 } } }];
const observed = Policy.inferGroups({ id: 'a' }, single, history, { today: '2026-09-19' })[0];
assert.equal(observed.observedSince, '2026-07', 'Gaps stop continuous observation, and never create a raiseDate');
assert.equal(own(observed, 'lastIncreaseDate'), false);
const invalidLatest = Policy.inferGroups({ id: 'a' }, single, [{ id: '2026-09_a', giao_vien: { class_rates: { X: '' } } }, ...history], { today: '2026-09-19' })[0];
assert.equal(invalidLatest.suggestedRate, null);
assert.equal(invalidLatest.evidence[0].status, 'invalid_rate');
const canonicalEmpty = Policy.ratesForMonth({ id: '2026-08_a', giao_vien: {}, 'giao-vien': { class_rates: { X: 12345 } } });
assert.deepEqual(canonicalEmpty, []);
const dualUnsafe = Policy.ratesForMonth({ id: '2026-08_a', published: { role: 'dual', status: 'received', details_gv: { totalBaseMins: 60 }, breakdown: [{ name: 'X', rate: 99000 }] } }, opts);
assert.deepEqual(dualUnsafe, [], 'Top-level breakdown on dual record is not attributed to teacher');

const reference = { id: 'school', confirmed: true, baselineDate: '2026-06-20', baselineKind: 'initial', currentRate: 34000 };
const completeStats = { complete: true, averageHours: 20, missingMonths: [] };
const settings = { cycleMonths: 3, minimumHours: 43, extraMonths: 1 };
let evaluation = Policy.evaluate(reference, completeStats, settings, '2026-09-01');
assert.equal(evaluation.state, 'this_month');
assert.equal(evaluation.dueDate, '2026-09-20');
assert.equal(evaluation.visibleThisMonth, true);
assert.equal(evaluation.low, true);
assert.equal(evaluation.suggestedDeferUntil, '2026-10-20');
assert.equal(Policy.evaluate(reference, {}, settings, '2026-09-20').state, 'due', 'Missing stats never hide a due person');
assert.equal(Policy.evaluate(reference, {}, settings, '2026-09-20').missing, true);
assert.equal(Policy.evaluate(reference, completeStats, { ...settings, minimumHours: 0 }, '2026-09-01').low, false);
assert.equal(Policy.evaluate({ ...reference, currentRate: 42000 }, completeStats, settings, '2026-09-01').dueDate, '2026-12-20');
assert.equal(Policy.evaluate({ ...reference, currentRate: 42000 }, completeStats, settings, '2026-09-01', { cycleMonths: 4 }).dueDate, '2026-10-20');
assert.equal(Policy.evaluate({ ...reference, cycleMonths: 2, minimumHours: 0 }, completeStats, settings, '2026-09-01', { cycleMonths: 4, minimumHours: 90 }).months, 2);
assert.equal(Policy.evaluate({ ...reference, cycleMonths: '' }, completeStats, settings, '2026-09-01', { cycleMonths: 4 }).months, 4);
assert.equal(Policy.evaluate({ ...reference, nextReviewDate: '2026-11-03' }, completeStats, settings, '2026-09-01').state, 'deferred');
assert.equal(Policy.evaluate({ ...reference, nextReviewDate: '2026-08-03' }, completeStats, settings, '2026-09-01').dueDate, '2026-09-20', 'Earlier accidental next date cannot shorten a cycle');
assert.equal(Policy.evaluate({ ...reference, nextReviewDate: '2026-11-03' }, completeStats, settings, '2026-11-01').state, 'this_month');
assert.equal(Policy.evaluate({ ...reference, enabled: false }, completeStats, settings, '2026-09-01').state, 'disabled');
assert.equal(Policy.evaluate({ ...reference, confirmed: false }, completeStats, settings, '2026-09-01').state, 'setup');
assert.equal(Policy.evaluate({ ...reference, currentRate: 0 }, completeStats, settings, '2026-09-01').state, 'this_month');
assert.equal(Policy.evaluate({ ...reference, currentRate: '' }, completeStats, settings, '2026-09-01').state, 'setup');
assert.equal(Policy.evaluate({ ...reference, minimumHours: 'bad' }, completeStats, settings, '2026-09-01').state, 'this_month');
assert.equal(Policy.evaluate({ ...reference, hoursOverride: 0, hoursMonth: '2026-08' }, {}, settings, '2026-09-01').hours, 0);
assert.equal(Policy.evaluate({ ...reference, hoursOverride: 100, hoursMonth: '2026-08' }, completeStats, settings, '2026-09-01').hours, 100);
assert.equal(Policy.evaluate({ ...reference, hoursOverride: 100, hoursMonth: '2026-08' }, completeStats, settings, '2026-10-01').hours, 20, 'Stale manual hours yield to complete current system evidence');
assert.equal(Policy.evaluate({ ...reference, hoursOverride: 100, hoursMonth: '2026-08' }, completeStats, settings, '2026-10-01').manualHoursStale, true);
assert.equal(Policy.evaluate({ ...reference, hoursOverride: 100, hoursMonth: '2026-08' }, {}, settings, '2026-10-01').hours, null, 'No later system evidence means missing, not permanent manual reuse');
assert.equal(Policy.evaluate({ ...reference, hoursOverride: 100, hoursMonth: '2026-09' }, {}, settings, '2026-09-01').manualHoursStale, true, 'Current/future partial periods cannot supply complete-month average');
assert.equal(Policy.evaluate({ ...reference, hoursOverride: 100 }, {}, settings, '2026-09-01').manualHoursStale, true, 'Unscoped legacy manual values need a period confirmation');
assert.equal(Policy.evaluate({ ...reference, cycleMonths: -1 }, completeStats, settings, '2026-09-01').state, 'setup');
assert.equal(Policy.evaluate(reference, completeStats, settings, '2026-10-25').suggestedDeferUntil, '2026-11-25', 'Suggested postponement must not still be in the past');
assert.equal(Policy.evaluate(reference, completeStats, settings, '2026-09-01').cycleKey, Policy.evaluate(reference, {}, settings, '2026-09-02').cycleKey, 'Missing or changed evidence does not create a second reminder cycle');
assert.equal(Policy.evaluate({ ...reference, nextReviewDate: '2026-11-03' }, completeStats, settings, '2026-10-01').cycleKey, evaluation.cycleKey, 'Deferral preserves the original review cycle');

const scheduled = { ...reference, currentRate: 36000, baselineDate: '2026-10-01', baselineKind: 'increase',
    scheduledChange: { effectiveFrom: '2026-10-01', targetMonth: '2026-10', newRate: 36000, operationId: 'fixture-approved' } };
const waiting = Policy.evaluate(scheduled, completeStats, settings, '2026-09-19');
assert.equal(waiting.visibleThisMonth, false, 'Approved future baseline prevents duplicate old-cycle reminders');
assert.equal(waiting.state, 'upcoming');
assert.equal(waiting.dueDate, '2027-01-01');
assert.equal(Policy.evaluate(scheduled, completeStats, settings, '2026-10-01').visibleThisMonth, false);
assert.equal(Policy.evaluate(scheduled, completeStats, settings, '2027-01-01').state, 'due', 'New cycle begins from the actual approved effective date');

function own(value, property) { return Object.prototype.hasOwnProperty.call(value, property); }
console.log('salary-review-policy.test.js: all assertions passed');
