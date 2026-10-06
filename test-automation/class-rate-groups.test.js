// Combined classes follow the highest component; rates are grouped by subject block.
const assert = require('node:assert/strict');
global.normalizeChipFilterName = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
global.SalaryReviewPolicy = require('../js/salary-review-policy.js');
const G = require('../js/class-rate-groups.js');

assert.equal(G.isCombined('Toán 1 + Toán 7'), true);
assert.equal(G.isCombined('Toán 7 (+2 HS)'), false, 'student-count rows are not combined classes');
assert.deepEqual(G.componentsOf('toán 1 +  Toán 7'), ['Toán 1', 'Toán 7']);
assert.deepEqual(G.combinedRate('Toán 1 + Toán 7', c => ({ 'Toán 1': 34000, 'Toán 7': 50000 })[c]), { rate: 50000, from: 'Toán 7' });

// Inherited/missing combined rate follows the components; a rate saved this month is kept.
const rates = { 'Toán 1': 34000, 'Toán 7': 50000, 'Toán 1 + Toán 7': 45000, 'E5 + E6': 30000 };
let out = G.deriveCombinedRates(rates, Object.keys(rates).concat('Toán 1 + Toán 8'), {}, c => (c === 'Toán 8' ? 52000 : 0));
assert.equal(out.rates['Toán 1 + Toán 7'], 50000, 'last month 45k is replaced by the highest component');
assert.equal(out.rates['Toán 1 + Toán 8'], 52000, 'component missing from the map uses the fallback rate');
assert.equal(out.rates['E5 + E6'], 30000, 'unknown components keep the existing rate');
assert.equal(rates['Toán 1 + Toán 7'], 45000, 'input map is not mutated');
out = G.deriveCombinedRates(rates, Object.keys(rates), { 'Toán 1 + Toán 7': 45000 }, () => 0);
assert.equal(out.rates['Toán 1 + Toán 7'], 45000, 'a rate saved for this month wins');

// Blocks: primary/secondary maths split, English folders separate, unknown → "khác".
const catalog = [{ id: 'math', name: 'Toán', isGroup: true }, { id: 'm1', name: 'Toán 1', parentId: 'math' }, { id: 'm7', name: 'Toán 7', parentId: 'math' },
    { id: 'ta', name: 'Tiếng Anh trên trường', isGroup: true }, { id: 'e5', name: 'E5', parentId: 'ta' },
    { id: 'gt', name: 'Tiếng Anh giao tiếp', isGroup: true }, { id: 'up1', name: 'UP1', parentId: 'gt' }];
const rows = ['Toán 1', 'Toán 7', 'E5', 'Up1', 'Lớp Lạ'].map(name => ({ name, input: {} }));
const blocks = G.blocksFor(rows, catalog);
const names = Object.fromEntries(blocks.map(b => [b.name, b.rows.map(r => r.name)]));
assert.deepEqual(names['Toán tiểu học · lớp 1–5'], ['Toán 1']);
assert.deepEqual(names['Toán cấp 2 · lớp 6–9'], ['Toán 7']);
assert.deepEqual(names['Tiếng Anh trên trường'], ['E5']);
assert.deepEqual(names['Tiếng Anh giao tiếp'], ['Up1']);
assert.equal(blocks[blocks.length - 1].id, 'other');
assert.deepEqual(blocks[blocks.length - 1].rows.map(r => r.name), ['Lớp Lạ']);
// Salary popup: "E4 (+10 HS)" keeps its gap to "E4" until typed by hand.
{
    const make = (name, value) => { const input = { dataset: { name }, value, disabled: false, closest: () => null }; return input; };
    const fmt = n => Number(n).toLocaleString('en-US');
    global.formatNumberWithCommas = fmt;
    global.parseFormattedNumber = v => Number(String(v || '').replace(/,/g, '')) || 0;
    const base = make('E4', '48,000'), crowded = make('E4 (+10 HS)', '52,000'), lonely = make('E5 (+10 HS)', '60,000');
    const list = [base, crowded, lonely];
    let listener;
    const tbody = { dataset: {}, querySelectorAll: () => list, addEventListener: (type, fn) => { if (type === 'input') listener = fn; } };
    global.document = { getElementById: id => id === 'class-rate-table-body' ? tbody : null };
    G.attach({});
    base.value = '50,000'; G.syncCombined();
    assert.equal(crowded.value, '54,000');
    assert.equal(lonely.value, '60,000', 'no base row: unchanged');
    base.value = '5'; G.syncCombined();
    assert.equal(crowded.value, '54,000', 'half-typed value is ignored');
    listener({ target: { closest: () => crowded } });
    base.value = '56,000'; G.syncCombined();
    assert.equal(crowded.value, '54,000', 'typed by hand: stops following');
    delete global.document;
}
console.log('class-rate-groups.test.js: combined classes follow highest component, block grouping passed');
