const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const db = fs.readFileSync(path.join(root, 'js', 'db-service.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const report = fs.readFileSync(path.join(root, 'js', 'report.js'), 'utf8');
const teacherState = fs.readFileSync(path.join(root, 'js', 'teacher-shift-state.js'), 'utf8');
const timekeeping = fs.readFileSync(path.join(root, 'js', 'timekeeping.js'), 'utf8');
const makeupPage = fs.readFileSync(path.join(root, 'cham-bu.html'), 'utf8');

const serializerStart = db.indexOf('function _serializedAdminPayrollOverride');
const serializerEnd = db.indexOf('\nfunction _resolveConcurrentTeachingSubjectSet', serializerStart);
assert.ok(serializerStart >= 0 && serializerEnd > serializerStart);
const serializer = db.slice(serializerStart, serializerEnd);
assert.match(serializer, /editedAt:\s*new Date\(\)\.toISOString\(\)/,
    'audit time nested in sessions must be a string, not a server timestamp sentinel');
assert.doesNotMatch(serializer, /editedAt:\s*firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);

assert.match(db, /transferTeacherBetweenShiftsAtomic:\s*async/);
assert.match(teacherState, /teacherAbsenceHistory/);
assert.match(teacherState, /assignmentTransferHistory/);
assert.match(main, /function getStaffAttendanceErrorMessage/);
assert.match(main, /missing or insufficient permissions/i);
assert.doesNotMatch(main, /alert\(e\?\.name === 'AttendanceLocationError'\s*\?\s*e\.message\s*:\s*\("Lỗi: " \+ e\.message\)\)/);
assert.match(report, /chip\.class !== 'chip-waiting' \|\| chip\.schedData\?\.shiftId/,
    'a waiting chip with a concrete schedule identity may still expose +10');
assert.match(report, /function hasTeachingPayrollEvidence[\s\S]*user\.teachingMode === 'old'[\s\S]*config\.class_rates/,
    'legacy teachers with teaching payroll evidence must keep 10p/large-class controls');
assert.match(report, /const isTeachingAssistant = hasTeachingPayrollEvidence\(currentUserContext\)/,
    'student-count controls must not depend only on the migrated role array');
assert.match(timekeeping, /function loadTodayTeachingSchedules[\s\S]*source:\s*'server'/,
    'the timekeeping page must support a server-fresh schedule read');
assert.match(timekeeping, /visibilitychange[\s\S]*refreshTimekeepingAfterResume/,
    'resuming the mobile app must refresh schedule chips instead of retaining an old in-memory roster');
assert.match(timekeeping, /todayTeachingScheduleRead/,
    'chips and class cards must share the same fresh schedule read to avoid duplicate load');
assert.match(makeupPage, /loadMonth\(options=\{\}\)[\s\S]*scheduleReadOptions=Object\.assign\(fresh\?\{source:'server'\}:\{\},\{readCache:new Map\(\)\}[\s\S]*getSchedule\(b\+'__'\+k,scheduleReadOptions\)/,
    'make-up detection must be able to re-read newly assigned admin schedules from the server');
assert.match(makeupPage, /visibilitychange[\s\S]*refreshMakeupAfterResume/,
    'resuming the make-up page must not keep classifying a newly assigned shift as outside schedule');

console.log('attendance regressions static tests passed');
