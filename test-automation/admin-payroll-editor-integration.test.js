const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const report = read('js/report.js');
const db = read('js/db-service.js');
const pdf = read('js/pdf-export.js');
const ui = read('js/admin-payroll-override-ui.js');
const html = read('bao-cao.html');
const serviceWorker = read('service-worker.js');

const pureTag = html.indexOf('js/admin-payroll-override.js');
const evaluatorTag = html.indexOf('js/evaluation-service.js');
const uiTag = html.indexOf('js/admin-payroll-override-ui.js');
const reportTag = html.indexOf('js/report.js');
assert.ok(pureTag >= 0 && pureTag < evaluatorTag, 'override calculator must load before evaluator');
assert.ok(uiTag >= 0 && uiTag < reportTag, 'override editor must load before report integration');
assert.match(serviceWorker, /admin-payroll-override\.js/);
assert.match(serviceWorker, /admin-payroll-override-ui\.js/);

assert.match(report, /function isPrimaryPayrollAdminViewer\(\)[\s\S]*includes\('admin'\)/,
    'authoritative payroll editor must require the primary Admin role');
assert.match(report, /currentAttendanceMap = attendanceMap/,
    'optimistic concurrency must use untouched attendance sessions');
assert.match(report, /getAdminPayrollSessionFingerprint\(rawSession\)/);
assert.match(report, /AdminPayrollOverrideUI\.open/);
assert.match(report, /DBService\.saveAdminPayrollOverride\(command\)/);
assert.match(report, /expectedFingerprint:\s*overrideContext\.expectedFingerprint/);
assert.match(report, /expectedRevision:\s*overrideContext\.expectedRevision/);
assert.match(report, /overrideDraft\.clearLegacyScheduleLinks/);
assert.match(report, /b10Status === 'admin_override'/,
    'an Admin-owned +10 must render as an authoritative chip state, not re-enter self-service validation');
assert.match(report, /Cộng \+10 phút bằng quyền Admin/,
    'the old self-service button must guide Admin to the absolute editor instead of showing a schedule error');
assert.match(report, /commitExactTypedSubjectSelection/,
    'an exact typed subject such as E7 must be committed before save');
assert.match(report, /hasReceptionistRole \|\| primaryAdminOverride/);
assert.match(report, /hasOfficeRole \|\| primaryAdminOverride/);
assert.match(report, /hasTeachingRole \|\| primaryAdminOverride/,
    'primary Admin may assign any per-session work kind even when profile roles differ');
assert.match(report, /sameBranch[\s\S]*nextStartMin <= currentEndMin/,
    'operational shifts merge only when continuous at the same branch');
assert.doesNotMatch(report, /DBService\.autoCloseStaleSession/,
    'opening the salary report must not rewrite historical attendance');
assert.doesNotMatch(report, /DBService\.checkOutPersonal/,
    'opening the salary report must not check out the current employee');
assert.match(report, /function getTeachingPayAllocations[\s\S]*?getAuthoritativeAdminPayrollRate\(chip\)[\s\S]*?isAdminPayrollOverride: true[\s\S]*?const studentCount =/,
    'manual Admin rate must bypass student-count and monthly class-rate replacement');
assert.match(report, /function getPayrollRateGroupAmount[\s\S]*?manualAmount \+ \(policyDisabled \? 0 : \(policyMinutes \/ 60\) \* rate\)/,
    'salary modal totals must preserve manual per-chip money alongside policy-priced minutes');
assert.match(report, /data-manual-amount=/,
    'salary modal rows must carry their authoritative Admin amount through recalculation');
assert.match(report, /function buildAttendanceSessionMap\(records\)[\s\S]*const recordDate = record\?\.date \|\| record\?\.id;[\s\S]*map\[recordDate\] = record\.sessions/,
    'previous-month history must key normal Firestore attendance records by their data.date field');
{
    const helperSource = report.match(/function buildAttendanceSessionMap\(records\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(helperSource, 'previous-month attendance indexing helper must remain testable');
    const historyContext = {};
    vm.createContext(historyContext);
    vm.runInContext(`${helperSource}; result = buildAttendanceSessionMap([{ date: '2026-08-17', sessions: [{ id: 'worked' }] }]);`, historyContext);
    assert.equal(historyContext.result['2026-08-17'][0].id, 'worked',
        'a normal Firestore record without a synthetic id must survive history indexing');
}
assert.match(pdf, /adminManualRate !== null[\s\S]*?fixedRate = adminManualRate;[\s\S]*?normalRate = adminManualRate;/,
    'PDF export must use the manual Admin rate for both receptionist shift types');
assert.match(pdf, /if \(adminManualRate !== null\) \{\s*segRate = adminManualRate;/,
    'PDF export must use the manual Admin rate for merged teaching segments');

assert.match(ui, /option value="actual"/);
assert.match(ui, /option value="manual"/);
assert.match(ui, /option value="schedule"/);
assert.match(ui, /data-apo-add="teaching"/);
assert.match(ui, /data-apo-add="receptionist"/);
assert.match(ui, /data-apo-add="office"/);
assert.match(ui, /apo-reason/);
assert.match(ui, /apo-clear-links/);
assert.match(ui, /apo-allow-overlap/);
assert.match(ui, /apo-admin-early10/);
assert.match(ui, /Cộng \+10 phút theo quyết định Admin/);
assert.match(ui, /buildAdminEarly10Draft/);
assert.match(ui, /adminEarly10/,
    'the editor must persist the explicit Admin +10 decision with the payroll override');
assert.match(ui, /dayKey:\s*type !== 'teaching'/,
    'reception/office allocations retain their weekday locator');
assert.match(ui, /scheduleRef:\s*compatibleScheduleRef\(resolvedKind, inheritedScheduleRef\)/,
    'new allocations may inherit only a locator for the selected work kind');
assert.match(ui, /const scheduleRef = compatibleScheduleRef\(kind, existing\.scheduleRef\)/,
    'manual draft reads must drop a locator after its allocation kind changes');
assert.match(ui, /allocation\.scheduleRef = compatibleScheduleRef\(kindSelect\.value, allocation\.scheduleRef\)/,
    'the visible row state must drop an incompatible locator as soon as kind changes');
assert.match(ui, /scheduleRef:\s*compatibleScheduleRef\(kind, scheduleRefFromChip\(state\.chip\)\)/,
    'actual-mode role changes must not retain a locator from the old chip kind');

const uiContext = { window: {} };
vm.createContext(uiContext);
vm.runInContext(ui, uiContext);
const compatibleScheduleRef = uiContext.window.AdminPayrollOverrideUI.compatibleScheduleRef;
const employeeSupportsKind = uiContext.window.AdminPayrollOverrideUI.employeeSupportsKind;
const teachingRef = { type: 'teaching', branch: 'cs1', shiftId: 'teaching-1' };
const receptionistRef = { type: 'receptionist', branch: 'cs1', shiftKey: 'morning' };
const officeAliasRef = { scheduleType: 'van_phong', branch: 'cs2', shiftKey: 'afternoon' };
assert.strictEqual(compatibleScheduleRef('teaching', teachingRef), teachingRef);
assert.strictEqual(compatibleScheduleRef('receptionist', receptionistRef), receptionistRef);
assert.strictEqual(compatibleScheduleRef('office', officeAliasRef), officeAliasRef);
assert.equal(compatibleScheduleRef('receptionist', teachingRef), null,
    'adding/changing to receptionist cannot inherit a teaching schedule locator');
assert.equal(compatibleScheduleRef('office', receptionistRef), null,
    'changing receptionist to office must clear its old roster locator');
assert.equal(compatibleScheduleRef('teaching', { branch: 'cs1', shiftId: 'untyped' }), null,
    'an untyped legacy locator is not provably compatible and must be cleared');
assert.equal(employeeSupportsKind({ roles: ['receptionist'] }, 'receptionist'), true);
assert.equal(employeeSupportsKind({ roles: ['receptionist'] }, 'teaching'), false);
assert.equal(employeeSupportsKind({ roles: ['receptionist'], salary_config: { roles: [{ id: 'e1' }] } }, 'teaching'), true);
assert.match(ui, /Ngoài vai trò hồ sơ · ngoại lệ Admin/,
    'the absolute editor must visibly flag work allocated outside the employee profile');

const commandStart = db.indexOf('saveAdminPayrollOverride: async');
const commandEnd = db.indexOf('\n    // Admin-only, auditable command', commandStart);
assert.ok(commandStart >= 0 && commandEnd > commandStart, 'absolute payroll writer must exist');
const command = db.slice(commandStart, commandEnd);
assert.match(command, /getAuthenticatedAuthorizationContext\(true\)/);
assert.match(command, /authorization\.roles\.includes\('admin'\)/);
assert.match(command, /db\.runTransaction/);
assert.match(command, /transaction\.get\(attendanceRef\)/);
assert.match(command, /_adminPayrollSessionFingerprint\(originalSession\) !== expectedFingerprint/);
assert.match(command, /admin_payroll_override_audits/);
assert.match(command, /admin_notifications/);
assert.match(command, /clearLegacyScheduleLinks === true/);
assert.match(command, /adminEarly10: command\.override\?\.adminEarly10/,
    'the writer must carry the UI decision through transaction validation');
assert.match(db, /adminEarly10: normalized\.adminEarly10\?\.enabled === true/,
    'the persisted override must record the Admin +10 decision and its audit actor');
assert.match(command, /session\.adminPayrollOverride = _serializedAdminPayrollOverride/,
    'schedule rollback remains revisioned and auditable instead of deleting its envelope');
assert.match(command, /attendanceRevisionState/,
    'editing a published payroll source must mark it for republication');

console.log('admin-payroll-editor-integration.test.js: all assertions passed');
