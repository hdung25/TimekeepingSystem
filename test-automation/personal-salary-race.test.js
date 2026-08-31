const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const loadStart = main.indexOf('async function loadStaffPersonalSalary');
const changeStart = main.indexOf('function changePersonalSalaryMonth', loadStart);
const confirmStart = main.indexOf('async function confirmPersonalSalaryReceipt', changeStart);
const bindStart = main.indexOf('// Bind to window', confirmStart);
assert.ok(loadStart >= 0 && changeStart > loadStart && confirmStart > changeStart && bindStart > confirmStart);

const load = main.slice(loadStart, changeStart);
assert.match(load, /const loadGeneration = \+\+personalSalaryLoadGeneration/);
assert.match(load, /const requestedDate = new Date\(currentPersonalSalaryDate\)/);
assert.match(load, /if \(loadGeneration !== personalSalaryLoadGeneration\) return/,
    'A stale month response must not replace the currently selected month');
assert.match(load, /confirmBtn\.dataset\.salaryMonth = monthStr/);

const confirm = main.slice(confirmStart, bindStart);
assert.match(confirm, /btn\?\.dataset\.salaryMonth \|\| renderedPersonalSalaryMonth/);
assert.doesNotMatch(confirm, /currentPersonalSalaryDate\.get/,
    'Receipt confirmation must use the month actually rendered, not mutable navigation state');
assert.match(confirm, /\^\\d\{4\}-\\d\{2\}\$/);

console.log('personal-salary-race.test.js: all assertions passed');
