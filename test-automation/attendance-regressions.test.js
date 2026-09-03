const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const db = fs.readFileSync(path.join(root, 'js', 'db-service.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const report = fs.readFileSync(path.join(root, 'js', 'report.js'), 'utf8');
const teacherState = fs.readFileSync(path.join(root, 'js', 'teacher-shift-state.js'), 'utf8');

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
assert.match(report, /hasTeachingEmploymentRole\(currentUserContext \|\| staffRoles\)/,
    'student-count controls must use the shared teaching-role policy');

console.log('attendance regressions static tests passed');
