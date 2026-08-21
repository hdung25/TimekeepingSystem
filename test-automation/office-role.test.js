const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const main = read('js/main.js');
const auth = read('js/auth-guard.js');
const db = read('js/db-service.js');
const roster = read('js/receptionist-schedule.js');
const personnel = read('js/personnel.js');
const report = read('js/report.js');
const peoplePage = read('nhan-su.html');
const officePage = read('lich-van-phong.html');
const rules = read('firestore.rules');
const makeup = read('cham-bu.html');

assert.match(main, /officeRoles = new Set\(\['office_staff', 'van-phong', 'van_phong'\]\)/);
assert.match(main, /Lịch Văn Phòng[\s\S]*?lich-van-phong\.html/);
assert.match(main, /const isOffice = window\.RolePolicy\.hasOfficeEmploymentRole\(userRolesArr\);[\s\S]*?if \(isReceptionist \|\| isOffice\)/,
    'Pure office staff must enter the operational shift-reminder flow');
const teachingScheduleMenu = main.match(/\{ name: scheduleName, link: 'lich-lam\.html',[\s\S]*?\},/)?.[0] || '';
assert.doesNotMatch(teachingScheduleMenu, /office_staff/,
    'A pure office account must use its separate roster page, not the teaching schedule page');
assert.match(auth, /lich-van-phong\.html[\s\S]*?'office_staff'/);
assert.match(personnel, /office_staff: 'Nhân viên văn phòng'/);
assert.match(report, /'office_staff': 'Nhân Viên Văn Phòng'/);
assert.match(report, /details\.operationalLabel = hasOfficeRole/);
assert.match(report, /'tiep-tan', 'receptionist', 'van-phong', 'van_phong', 'office_staff'/,
    'Office sessions must stay in the operational edit flow instead of loading teaching subjects');
assert.match(main, /details\.operationalLabel \|\| 'Tiếp Tân'/,
    'Published office payslips must retain an office-facing role label');
assert.match(peoplePage, /value="office_staff"> Nhân viên văn phòng/);

assert.match(officePage, /WORK_SCHEDULE_CONTEXT = \{ type: 'office' \}/);
assert.match(officePage, /Lịch Văn Phòng/);
assert.match(officePage, /#save-area\.schedule-actions-hidden[\s\S]*?display:\s*none\s*!important/,
    'Mobile CSS must not reveal schedule mutation controls to read-only office staff');
assert.match(roster, /DBService\.getOfficeSchedule/);
assert.match(roster, /DBService\.saveOfficeSchedule/);
assert.match(roster, /officeShifts/);
assert.match(roster, /office_/);
assert.match(roster, /classList\.toggle\('schedule-actions-hidden', !isEditor\)/);
assert.match(roster, /WORK_SCHEDULE_CONTEXT\.type === 'office'[\s\S]*?\['admin', 'assistant', 'senior_assistant'\]/,
    'Receptionist assistants must not receive office-roster edit controls');

assert.match(db, /collection\('office_schedules'\)/);
assert.match(db, /linkedOfficeShift/);
assert.match(db, /getOfficeShiftConfig/);
assert.match(rules, /match \/office_schedules\/\{weekId\}/);
assert.match(rules, /function isOfficeScheduleManager\(\)[\s\S]*?isAdmin\(\) \|\| hasRole\('assistant'\)/);
assert.match(rules, /office_schedules[\s\S]*?allow write: if isAuthenticated\(\) && isOfficeScheduleManager\(\)/);

assert.match(makeup, /value="van-phong">Văn phòng/);
assert.match(makeup, /linkedOfficeShift/);
assert.match(makeup, /getOfficeSchedule/);

console.log('office-role.test.js: all assertions passed');
