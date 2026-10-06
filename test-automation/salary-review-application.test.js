'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Application = require('../js/salary-review-application.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const lifecycleSource = read('js/db-service.js');
const lifecycle = {};
vm.createContext(lifecycle);
vm.runInContext(lifecycleSource.slice(lifecycleSource.indexOf('// PAYSLIP LIFECYCLE HELPERS START'),
    lifecycleSource.indexOf('// PAYSLIP LIFECYCLE HELPERS END')), lifecycle);
const getPayslipLifecycleState = lifecycle._getPayslipLifecycleState;
const catalog = [
    {id: 'math', name: 'Toán -TV', isGroup: true},
    {id: 'm1', name: 'Toán 1', parentId: 'math'},
    {id: 'm2', name: 'Toán 2', parentId: 'math'},
    {id: 'm6', name: 'Toán 6', parentId: 'math'},
    {id: 'english', name: 'E1', parentId: 'school'},
    {id: 'communication', name: 'FFS1', parentId: 'talk'}
];
function laterNulls(targetMonth, currentMonth) {
    try { return Object.fromEntries(Application.followingMonths(targetMonth, currentMonth).map(month => [month, null])); }
    catch { return {}; }
}
function fixture(overrides = {}) {
    const input = {
        staffId: 'teacher', user: {id: 'teacher', salary_config: {class_rates: {'Tin Học': 60000}}},
        defaults: null, targetDoc: null, targetMonth: '2026-10', currentMonth: '2026-09',
        history: {
            '2026-09': {giao_vien: {class_rates: {'Toán 1': 30000, 'Toán 2': 32000, 'Toán 6': 50000,
                'E1': 40000, 'FFS01': 42000, 'Toán 1 + E1': 70000, 'Toán 1 (+12 HS)': 60000}}}
        }, catalog, group: {id: 'primary', subjectIds: ['m1', 'm2']}, selectedSubjectIds: ['m1'],
        newRate: 36000, getPayslipLifecycleState, ...overrides
    };
    if (!Object.prototype.hasOwnProperty.call(overrides, 'laterDocs')) input.laterDocs = laterNulls(input.targetMonth, input.currentMonth);
    return input;
}
function rejects(overrides, code) {
    assert.throws(() => Application.buildPreview(fixture(overrides)), error => error.code === `salary-review/${code}`);
}

// A folder increase materializes the complete source map; later months retain
// other folders, aliases, combined classes and dense-class exceptions.
{
    const input = fixture();
    const before = JSON.stringify(input);
    const preview = Application.buildPreview(input);
    assert.equal(JSON.stringify(input), before, 'pure preview cannot mutate a live cached user/month');
    assert.equal(preview.mergedRates['Toán 1'], 36000);
    assert.equal(preview.mergedRates['Toán 2'], 32000, 'unselected exception stays unchanged');
    assert.equal(preview.mergedRates['Toán 6'], 50000);
    assert.equal(preview.mergedRates.E1, 40000);
    assert.equal(preview.mergedRates.FFS01, 42000, 'old alias is not fuzzy-rewritten');
    assert.equal(preview.mergedRates['Toán 1 + E1'], 70000);
    assert.equal(preview.mergedRates['Toán 1 (+12 HS)'], 66000, 'crowded-class rate follows its base: 30k/60k raised to 36k gives 66k');
    assert.deepEqual(preview.followers, [{name: 'Toán 1 (+12 HS)', base: 'Toán 1', beforeRate: 60000, afterRate: 66000,
        beforeSource: 'inherited:2026-09'}]);
    assert.ok(!preview.preserved.some(item => item.name === 'Toán 1 (+12 HS)'));
    assert.equal(preview.mergedRates['Tin Học'], 60000);
    assert.deepEqual(preview.changes, [{subjectId: 'm1', name: 'Toán 1', beforeRate: 30000,
        afterRate: 36000, beforeSource: 'inherited:2026-09'}]);
    const next = Application.buildPreview(fixture({targetMonth: '2026-11', history: {'2026-10': preview.patch}, newRate: 38000}));
    assert.equal(next.mergedRates['Toán 6'], 50000, 'writing one group cannot drop another group next month');
    assert.equal(next.mergedRates.E1, 40000);
    assert.equal(next.changes[0].beforeRate, 36000);
}

// Target data, aliases and every non-price field survive. A teacher-only patch
// cannot rewrite the operational role or a published operational payslip.
{
    const timestamp = new Date('2026-08-01T00:00:00.000Z');
    const targetDoc = {
        'giao-vien': {advance: 125000, evaluation: [{id: 1, amount: 12000}], savedAt: timestamp,
            class_rates: {'Toán 1': 31000, 'Toán 2': 0, E1: 44000, 'Riêng': 66667}},
        tiep_tan: {advance: 987000, class_rates: {'Tiếp Tân': 50000}},
        published: {role: 'tiep-tan', status: 'received', details: {netPay: 234567}}
    };
    const before = JSON.stringify(targetDoc);
    const preview = Application.buildPreview(fixture({targetDoc}));
    assert.deepEqual(Object.keys(preview.patch), ['giao-vien']);
    assert.equal(preview.effectiveRoleKey, 'giao-vien');
    assert.equal(preview.mergedRates['Toán 2'], 0, 'explicit stored zero remains intact');
    assert.equal(preview.mergedRates.E1, 44000, 'target manual exception takes priority over inheritance');
    assert.equal(preview.mergedRates['Riêng'], 66667);
    assert.equal(preview.mergedRates['Toán 6'], 50000);
    assert.equal(preview.patch['giao-vien'].advance, 125000);
    assert.deepEqual(preview.patch['giao-vien'].evaluation, targetDoc['giao-vien'].evaluation);
    assert.equal(preview.patch['giao-vien'].savedAt, timestamp, 'do not turn timestamps into plain objects');
    assert.equal(JSON.stringify(targetDoc), before);
}

// Missing role inherits legacy salary_settings, including non-rate fields. A
// truly existing empty role does not accidentally import those defaults.
{
    const defaults = {advance: 4000, evaluation: [{id: 3, amount: 500}], class_rates: {E1: 45000}};
    const preview = Application.buildPreview(fixture({defaults}));
    assert.equal(preview.patch.giao_vien.advance, 4000);
    assert.equal(preview.mergedRates.E1, 45000);
    assert.equal(preview.mergedRates['Toán 6'], 50000);
    const explicit = Application.buildPreview(fixture({defaults, targetDoc: {giao_vien: {}}}));
    assert.equal(explicit.patch.giao_vien.advance, undefined);
    assert.equal(explicit.mergedRates.E1, 40000);
}

// Require knowledge of missing documents, never interpret a failed fetch as an
// empty period; look back exactly six months and stop at nearest positive source.
{
    rejects({history: {}}, 'incomplete-history');
    rejects({history: {'2026-09': undefined}}, 'incomplete-history');
    const history = Object.fromEntries(Array.from({length: 6}, (_, index) => [Application.shiftMonth('2026-10', -index - 1), null]));
    const empty = Application.buildPreview(fixture({history}));
    assert.equal(empty.sourceMonths.length, 6);
    assert.equal(empty.inheritedMonth, '');
    assert.equal(empty.changes[0].beforeRate, null);
    history['2026-09'] = {giao_vien: {class_rates: {Zero: 0}}};
    history['2026-08'] = {giao_vien: {class_rates: {E1: 33000}}};
    history['2026-07'] = {giao_vien: {class_rates: {'Too Old To Inherit': 42000}}};
    const prior = Application.buildPreview(fixture({history}));
    assert.deepEqual(prior.sourceMonths, ['2026-09', '2026-08']);
    assert.equal(prior.mergedRates['Too Old To Inherit'], undefined, 'retain actual nearest-role history contract');
    assert.equal(prior.mergedRates.E1, 33000);
}

// Use the actual DB lifecycle, including dual role and legacy snapshots; a saved
// teacher draft must be recalculated explicitly elsewhere before applying rates.
for (const published of [
    {role: 'giao-vien', status: 'draft', details: {netPay: 123}},
    {role: 'giao-vien', status: 'published', details: {netPay: 123}},
    {role: 'giao-vien', status: 'received', details: {netPay: 123}},
    {role: 'dual', status_gv: 'draft', status_tt: 'received', details_gv: {netPay: 1}, details_tt: {netPay: 2}},
    {status_gv: 'published'}, {status: 'received', netPay: 5000}
]) rejects({targetDoc: {published}}, 'calculated-target');
rejects({targetDoc: {revisionDrafts: {gv: {version: 1}}}}, 'calculated-target');
rejects({targetDoc: {published: {role: 'tiep-tan', details: {netPay: 12}}}, getPayslipLifecycleState: undefined}, 'missing-lifecycle');
assert.doesNotThrow(() => Application.buildPreview(fixture({targetDoc: {
    published: {role: 'dual', status_gv: 'draft', status_tt: 'received', details_tt: {netPay: 2}}
}})));

rejects({targetMonth: '2026-07'}, 'invalid-month');
rejects({targetMonth: '2027-01'}, 'invalid-month');
assert.equal(Application.buildPreview(fixture({targetMonth: '2026-09', history: {'2026-08': null, '2026-07': null, '2026-06': null,
    '2026-05': null, '2026-04': null, '2026-03': null}})).backdated, true, 'current month is allowed (back-dated)');
assert.doesNotThrow(() => Application.buildPreview(fixture({targetMonth: '2026-08', history: {'2026-07': null, '2026-06': null,
    '2026-05': null, '2026-04': null, '2026-03': null, '2026-02': null}})), 'previous month is allowed (back-dated)');
rejects({laterDocs: {}}, 'incomplete-history');
rejects({laterDocs: {'2026-11': null, '2026-12': undefined}}, 'incomplete-history');
rejects({targetMonth: '2026-13'}, 'invalid-month');
rejects({currentMonth: undefined}, 'invalid-month');
rejects({targetDoc: undefined}, 'incomplete-source');
rejects({defaults: undefined}, 'incomplete-source');
rejects({user: {id: 'another'}}, 'invalid-staff');
rejects({newRate: 0}, 'invalid-rate');
rejects({newRate: -1}, 'invalid-rate');
rejects({newRate: 34.5}, 'invalid-rate');
rejects({selectedSubjectIds: []}, 'empty-selection');
rejects({selectedSubjectIds: ['m6']}, 'invalid-subject');
rejects({selectedSubjectIds: ['deleted']}, 'invalid-subject');
{
    const targetDoc = {giao_vien: {class_rates: {'Toán 1': 34000}}, 'giao-vien': {class_rates: {'Toán 1': 30000}, advance: 15000}};
    const previous = JSON.stringify(targetDoc);
    const preview = Application.buildPreview(fixture({targetDoc, history: {'2026-09': {
        giao_vien: {class_rates: {'Toán 6': 52000}}, 'giao-vien': {class_rates: {'Toán 6': 48000}}
    }}}));
    assert.equal(preview.effectiveRoleKey, 'giao_vien');
    assert.deepEqual(Object.keys(preview.patch), ['giao_vien']);
    assert.equal(preview.mergedRates['Toán 6'], 52000);
    assert.equal(preview.changes[0].beforeRate, 34000);
    assert.equal(preview.warnings.length, 2);
    assert.equal(JSON.stringify(targetDoc), previous, 'legacy sibling must remain intact');
}
rejects({targetDoc: {giao_vien: {class_rates: []}}}, 'invalid-source');
rejects({catalog: [...catalog, {id: 'duplicate', name: '  TOÁN 1  '}]}, 'ambiguous-subject');
rejects({catalog: [...catalog.filter(s => s.id !== 'm1'), {id: 'm1', name: 'Toán 1 + E1'}]}, 'combined-subject');

// Back-dated raise (owner 06/10/2026: "áp dụng từ tháng 9"): today is in
// October, target September. A teacher DRAFT is dropped so it is recalculated;
// a sent payslip is refused. Later saved lower rates are lifted, never lowered.
{
    const backdated = overrides => Application.buildPreview(fixture({targetMonth: '2026-09', currentMonth: '2026-10',
        history: {'2026-08': {giao_vien: {class_rates: {'Toán 1': 30000, 'Toán 2': 32000}}}}, ...overrides}));
    const targetDoc = {giao_vien: {advance: 5000, class_rates: {'Toán 1': 30000, 'Toán 2': 32000}},
        published: {role: 'giao-vien', status: 'draft', status_gv: 'draft', netPay: 900, details_gv: {netPay: 900}, details: {netPay: 900}, message: 'hi'}};
    const october = {giao_vien: {class_rates: {'Toán 1': 30000, 'Toán 2': 0, E1: 40000}},
        published: {role: 'dual', status_gv: 'draft', status_tt: 'received', details_gv: {netPay: 1}, details_tt: {netPay: 2}, details: {netPay: 1}}};
    const before = JSON.stringify([targetDoc, october]);
    const preview = backdated({targetDoc, selectedSubjectIds: ['m1', 'm2'],
        laterDocs: {'2026-10': october, '2026-11': null, '2026-12': {giao_vien: {class_rates: {'Toán 1': 40000}}}, '2027-01': null}});
    assert.equal(JSON.stringify([targetDoc, october]), before, 'pure preview');
    assert.equal(preview.backdated, true);
    assert.equal(preview.patch.giao_vien.class_rates['Toán 1'], 36000);
    assert.equal(preview.patch.giao_vien.advance, 5000);
    assert.equal(preview.patch.published.details_gv, null, 'stale September teacher draft is dropped');
    assert.equal(preview.patch.published.details, null);
    assert.equal(preview.patch.published.message, 'hi');
    assert.equal(getPayslipLifecycleState(preview.patch.published).has_gv, false, 'shows as not calculated, cannot be bulk-sent');
    assert.deepEqual(preview.carried.map(item => item.month), ['2026-10'], 'December already pays more; November has no doc');
    const oct = preview.carried[0];
    assert.deepEqual(oct.lifted, [{name: 'Toán 1', beforeRate: 30000, afterRate: 36000}], 'saved 0 stays intact');
    assert.deepEqual(oct.patch.giao_vien, {class_rates: {'Toán 1': 36000}}, 'merge patch touches only the lifted name');
    assert.equal(oct.patch.published.details_gv, null);
    assert.deepEqual(oct.patch.published.details, {netPay: 2}, 'dual: receptionist part kept');
    assert.equal(oct.patch.published.status_tt, 'received');
    assert.deepEqual(preview.clearedDrafts.map(item => item.month), ['2026-09', '2026-10']);
    assert.deepEqual(preview.clearedDrafts[0].before, targetDoc.published, 'audit keeps the dropped draft');

    for (const published of [{role: 'giao-vien', status: 'published', details: {netPay: 1}}, {role: 'dual', status_gv: 'received', details_gv: {netPay: 1}},
        {status: 'received', netPay: 5000}]) {
        assert.throws(() => backdated({targetDoc: {published}}), error => error.code === 'salary-review/calculated-target');
        assert.throws(() => backdated({laterDocs: {'2026-10': {published}, '2026-11': null, '2026-12': null, '2027-01': null}}),
            error => error.code === 'salary-review/calculated-target', 'a sent later month must be recalled first');
    }
    assert.throws(() => backdated({targetDoc: {revisionDrafts: {gv: {version: 1}}}}), error => error.code === 'salary-review/calculated-target');
    const untouched = backdated({});
    assert.equal(untouched.patch.published, undefined, 'no payslip: nothing to clear');
    assert.deepEqual(untouched.carried, []);
}
// Owner case 07/10: E4 48k with "E4 (+10 HS)" 52k raised to 50k gives 54k,
// also in later saved months; other crowded classes and a missing base stay.
{
    const english = [...catalog, {id: 'e4', name: 'E4', parentId: 'school'}, {id: 'e40', name: 'E40', parentId: 'school'}];
    const history = {'2026-09': {giao_vien: {class_rates: {E4: 48000, 'E4 (+10 HS)': 52000, 'E4 (+5 hs)': 50000,
        'E40 (+10 HS)': 70000, 'Toán 1 (+12 HS)': 60000}}}};
    const preview = Application.buildPreview(fixture({catalog: english, history, group: {id: 'school', subjectIds: ['e4', 'e40']},
        selectedSubjectIds: ['e4', 'e40'], newRate: 50000,
        laterDocs: {'2026-11': {giao_vien: {class_rates: {E4: 48000, 'E4 (+10 HS)': 52000}}}, '2026-12': {giao_vien: {class_rates: {'E4 (+10 HS)': 60000}}}}}));
    assert.equal(preview.mergedRates.E4, 50000);
    assert.equal(preview.mergedRates['E4 (+10 HS)'], 54000);
    assert.equal(preview.mergedRates['E4 (+5 hs)'], 52000);
    assert.equal(preview.mergedRates['E40 (+10 HS)'], 70000, 'E40 had no base rate: nothing to follow');
    assert.equal(preview.mergedRates['Toán 1 (+12 HS)'], 60000, 'another subject is untouched');
    assert.deepEqual(preview.carried.map(item => [item.month, item.patch.giao_vien.class_rates]),
        [['2026-11', {E4: 50000, 'E4 (+10 HS)': 54000}]], 'December already pays more for the crowded class');
}
// Future target keeps the strict rule; later months are still lifted.
{
    const preview = Application.buildPreview(fixture({laterDocs: {'2026-11': {giao_vien: {class_rates: {'Toán 1': 30000}}}, '2026-12': null}}));
    assert.equal(preview.backdated, false);
    assert.deepEqual(preview.carried.map(item => [item.month, item.patch.giao_vien.class_rates['Toán 1']]), [['2026-11', 36000]]);
}

// The reviewed source token changes even when a concurrent edit is unrelated to
// the selected rates, so the service can reject stale whole-role updates.
{
    const first = Application.buildPreview(fixture());
    const second = Application.buildPreview(fixture({targetDoc: {giao_vien: {advance: 10}}}));
    assert.notEqual(first.sourceFingerprint, second.sourceFingerprint);
    assert.equal(Application.fingerprint({a: 1, b: {d: 2, c: 3}}), Application.fingerprint({b: {c: 3, d: 2}, a: 1}));
}

// Key normalization parity matters: a visually similar new key would otherwise
// never be picked up by existing salary chips and would appear to apply safely.
{
    const source = read('js/evaluation-service.js');
    const start = source.indexOf('function normalizeChipFilterName(');
    const end = source.indexOf('window.normalizeChipFilterName = normalizeChipFilterName;', start);
    const normalizer = new Function(source.slice(start, end) + '\nreturn normalizeChipFilterName;')();
    for (const name of ['  TOÁN   1 ', 'FFS1', 'Pre- I2', 'Pre I1', 'PRE-I1', '  ( Tin Học ) ', 'Toán 1 (+12 HS)']) {
        assert.equal(Application.payrollName(name), normalizer(name));
    }
    assert.equal(Application.shiftMonth('2027-01', -1), '2026-12');
    assert.equal(Application.shiftMonth('2026-12', 1), '2027-01');
}

console.log('salary-review-application.test.js: preserved rates, future periods, lifecycle locks, source completeness and key parity passed');
