const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const nhanSu = read('nhan-su.html');
const monHoc = read('mon-hoc.html');
const baoCao = read('bao-cao.html');
const dbService = read('js/db-service.js');
const report = read('js/report.js');
const personnel = read('js/personnel.js');
const monHocJs = read('js/mon-hoc.js');
const serviceWorker = read('service-worker.js');
const style = read('css/style.css');

for (const [name, source] of [
  ['nhan-su.html', nhanSu],
  ['mon-hoc.html', monHoc],
  ['js/personnel.js', personnel],
  ['js/mon-hoc.js', monHocJs],
]) {
  assert.ok(source.length > 100, `${name} should not be empty`);
}

assert.match(nhanSu, /class="ns-page"/);
assert.match(nhanSu, /id="ns-salary-sheet"/);
assert.match(nhanSu, /value="receptionist_assistant"/);
assert.match(nhanSu, /value="teaching_assistant"/);
assert.match(nhanSu, /app-build" content="20260808-combined-v1"/);
assert.match(baoCao, /subject-rate-policy\.js\?v=20260809-subject-rate-v1/);
assert.match(baoCao, /db-service\.js\?v=20260816-early10-old-unset-v3/);
assert.match(baoCao, /report\.js\?v=20260816-report-chip-mobile-v4/);
assert.match(baoCao, /style\.css\?v=20260816-report-chip-mobile-v1/);
assert.match(report, /DBService\.getMonthlyReceptionistShifts/);
assert.match(dbService, /getMonthlyReceptionistShifts:\s*async/);
assert.match(report, /DBService\.getOvertimeRequestsForStaff\(staffId, prevMonthStr\)/);
assert.doesNotMatch(report, /getMonthlyOvertimeRequests/);
assert.match(report, /report-schedule-chip/);
assert.match(report, /report-chip-main/);
assert.match(report, /report-chip-action/);
assert.match(style, /\.report-schedule-chip\s*\{[\s\S]*?flex-wrap:\s*wrap/);
assert.match(style, /\.report-schedule-chip\s*>\s*\.report-chip-main[\s\S]*?flex:\s*1 1 100%/);
assert.match(style, /\.report-schedule-chip\s*>\s*\.report-chip-action[\s\S]*?margin-left:\s*0 !important/);

assert.match(monHoc, /class="mh-page"/);
assert.match(monHoc, /app-build" content="20260816-early10-old-unset-v3"/);
assert.match(monHocJs, /allowEarly10/);
assert.match(monHocJs, /function getRootGroups\(\)/);
assert.match(monHocJs, /function getDescendantLeaves\(groupId/);
assert.match(monHocJs, /openChildGroup/);
assert.match(monHocJs, /Thêm nhóm con/);
assert.match(monHocJs, /preferredParentId/);

for (const legacyName of [
  'window.openModal', 'window.handleStaffSubmit', 'window.configureSalary',
  'window.saveSalaryConfig', 'window.filterStaffTable',
]) assert.match(personnel, new RegExp(legacyName.replace('.', '\\.'), 'm'));

for (const legacyName of [
  'window.previewColorPill', 'window.saveSubjectForm',
  'window.editSubject', 'window.deleteSubject',
]) assert.match(monHocJs, new RegExp(legacyName.replace('.', '\\.'), 'm'));

assert.match(monHocJs, /DBService\.saveSubjectsBatch/);
assert.match(monHocJs, /DBService\.deleteSubjectsBatch/);
assert.match(personnel, /salary_config/);
assert.match(personnel, /subjectRatePolicy/);
assert.match(serviceWorker, /tdt-chamcong-v132-cross-branch-oversight-20260816/);
assert.match(serviceWorker, /subject-rate-policy\.js\?v=20260809-subject-rate-v1/);
assert.match(serviceWorker, /20260816-report-chip-mobile-v4/);

console.log('page compatibility checks passed');
