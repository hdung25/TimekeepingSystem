const assert = require('node:assert/strict');
const O = require('../js/staff-code-order.js');

// Chủ trung tâm 08/11/2026: hết số (1 → 70) rồi mới đến chữ A→Z, cùng chữ thì xét số.
const usernames = ['thaiv1', 'huyenn1', 'baon2', 'giabao1', 'van75', 'quynh64', 'dung02', 'anhv3', 'huyenN10', 'admin', 'khach'];
const sorted = usernames.slice().sort((a, b) => O.compareUsernames(a, b) || a.localeCompare(b));
assert.deepEqual(sorted.map(u => O.codeText(u) || u),
    ['1', '02', '64', '75', 'N1', 'N2', 'N10', 'V1', 'V3', 'admin', 'khach']);

assert.equal(O.codeText('huyenn1'), 'N1');
assert.equal(O.codeText('van75'), '75', 'tên tận cùng bằng n + 2 số không phải mã N');
assert.equal(O.codeText('admin1'), '');

const codes = ['V3', '', 'N1', '70', '1', 'N5', 'V1', '02'];
assert.deepEqual(codes.slice().sort(O.compareCodes), ['1', '02', '70', 'N1', 'N5', 'V1', 'V3', '']);
console.log('staff-code-order ok');
