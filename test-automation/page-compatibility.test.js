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
assert.match(baoCao, /db-service\.js\?v=20260809-history-overtime-v8/);
assert.match(baoCao, /report\.js\?v=20260809-history-overtime-v8/);
assert.match(report, /DBService\.getMonthlyReceptionistShifts/);
assert.match(dbService, /getMonthlyReceptionistShifts:\s*async/);
assert.match(report, /DBService\.getOvertimeRequestsForStaff\(staffId, prevMonthStr\)/);
assert.doesNotMatch(report, /getMonthlyOvertimeRequests/);

assert.match(monHoc, /class="mh-page"/);
assert.match(monHoc, /app-build" content="20260809-chip-policy-v1"/);
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
assert.match(serviceWorker, /tdt-chamcong-v125-history-overtime-20260809/);
assert.match(serviceWorker, /subject-rate-policy\.js\?v=20260809-subject-rate-v1/);
assert.match(serviceWorker, /20260809-history-overtime-v8/);

console.log('page compatibility checks passed');
