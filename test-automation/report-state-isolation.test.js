const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8');

assert.match(source, /let _reportRenderEpoch = 0;/);
assert.match(source, /const renderEpoch = \+\+_reportRenderEpoch;/);
assert.match(source, /window\.currentSubjectBreakdown = \[\];/);
assert.match(source, /window\.currentSubjectBreakdownScope = reportScope;/);
assert.match(source, /selectStaffFromDropdown\(targetUser\);/);
assert.match(source, /window\.currentSubjectBreakdownScope === window\.currentReportScope/);
assert.match(source, /if \(!isCurrentRender\(\)\) return;/);

console.log('report-state-isolation.test.js: all assertions passed');
