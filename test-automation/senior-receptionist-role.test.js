const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const main = read('js/main.js');
const report = read('js/report.js');
const personnel = read('js/personnel.js');
const evaluation = read('js/evaluation-service.js');
const analytics = read('js/analytics.js');
const schedule = read('js/schedule.js');
const rules = read('firestore.rules');
const worker = read('service-worker.js');

assert.match(main, /receptionistRoles[\s\S]*?'senior_assistant'/,
    'Senior assistant must be classified as receptionist employment');
const teachingPolicy = main.match(/const teachingRoles = new Set\(\[([\s\S]*?)\]\);/);
assert(teachingPolicy, 'Teaching role policy must exist');
assert(!teachingPolicy[1].includes('senior_assistant'),
    'Senior assistant must not be implicitly classified as teaching staff');

assert.match(report, /const hasReceptionistRole = userRolesArr\.some\(role => \[[\s\S]*?'senior_assistant'/,
    'Shift role dropdown must keep senior assistant in the receptionist roster roles');
assert.match(report, /const hasTeachingRole = hasTeachingEmploymentRole\(userRolesArr\)/,
    'Shift role dropdown must use teaching employment policy');
assert(!report.includes("hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant'"),
    'Payroll must not classify senior assistant as teaching staff');

const personnelTeaching = personnel.match(/var TEACH_ROLES = \[([^\]]*)\]/);
assert(personnelTeaching && !personnelTeaching[1].includes('senior_assistant'),
    'Personnel teaching filter must exclude senior assistant');
assert.match(personnel, /var RECEP_ROLES = \[[^\]]*senior_assistant/,
    'Personnel receptionist filter must include senior assistant');

assert.match(evaluation, /receptionistRoleKeys = \[[^\]]*senior_assistant/,
    'Evaluation must classify senior assistant as receptionist');
assert(!evaluation.includes("hasTeachingRole = staffRoles.some(r => ['giao-vien', 'teacher', 'senior_assistant'"),
    'Evaluation must not classify senior assistant as teaching staff');

assert.match(analytics, /tt: \[[^\]]*senior_assistant/,
    'Analytics receptionist group must include senior assistant');
assert(!/gv: \[[^\]]*senior_assistant/.test(analytics),
    'Analytics teaching group must exclude senior assistant');
const scheduleTeachingPolicy = schedule.match(/function hasTeachingEmploymentRole\(value\) \{([\s\S]*?)\n\}/);
assert(scheduleTeachingPolicy && !scheduleTeachingPolicy[1].includes('senior_assistant'),
    'Schedule teaching policy must exclude senior assistant');
assert.match(rules, /isReceptionistOperator\(\)[\s\S]*?hasRole\('senior_assistant'\)/,
    'Firestore receptionist operations must allow senior assistant');

assert.match(worker, /tdt-chamcong-v153-payroll-sync-20260905/,
    'Service worker cache must be bumped');
assert.match(read('bao-cao.html'), /report\.js\?v=20260905-payroll-sync-v3/,
    'Report page must load the new role policy bundle');

console.log('✓ Senior assistant receptionist-role regression tests passed');
