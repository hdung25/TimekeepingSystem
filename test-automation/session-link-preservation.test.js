const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-service.js'), 'utf8');

assert.match(source, /const clearScheduleLinks = patch\.clearScheduleLinks === true;/);
assert.match(source, /else if \(hasClassLink\)/);
assert.match(source, /else if \(hasReceptionistLink\)/);
assert.match(source, /const history = Array\.isArray\(session\.editHistory\) \? session\.editHistory\.slice\(-19\) : \[\];/);
assert.doesNotMatch(source, /delete session\.linkedClassStart;\s*delete session\.linkedReceptionistShift;\s*\n\s*\/\/.*Merge new data/s);

console.log('session-link-preservation.test.js: all assertions passed');
