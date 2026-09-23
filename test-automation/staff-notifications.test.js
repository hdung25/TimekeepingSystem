'use strict';
// Staff notifications: check-in reminders skip consecutive/parallel classes, the
// bell listens in real time, decisions notify the staff member, and the PWA login
// page resumes a saved Firebase session instead of asking for the password again.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'js', 'db-service.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

const start = main.indexOf('function teachingShiftsNeedingCheckIn');
const end = main.indexOf('window.teachingShiftsNeedingCheckIn', start);
assert.ok(start >= 0 && end > start, 'reminder chain helper must exist');
const leaders = new Function(`${main.slice(start, end)}; return teachingShiftsNeedingCheckIn;`)();
const shift = (branch, s, e) => ({ branch, start: s, end: e });
const names = list => list.map(item => `${item.branch} ${item.start}`);

assert.deepEqual(names(leaders([shift('cs1', '18:00', '19:30'), shift('cs1', '19:30', '21:00')])), ['cs1 18:00'],
    'a consecutive class is part of the same check-in and is not reminded');
assert.deepEqual(names(leaders([shift('cs1', '07:30', '09:00'), shift('cs1', '07:30', '09:00')])), ['cs1 07:30'],
    'two parallel classes need one reminder');
assert.deepEqual(names(leaders([shift('cs1', '15:30', '17:00'), shift('cs1', '18:00', '19:30')])), ['cs1 15:30', 'cs1 18:00'],
    'a break between classes needs a new check-in');
assert.deepEqual(names(leaders([shift('cs1', '18:00', '19:30'), shift('cs2', '19:30', '21:00')])), ['cs1 18:00', 'cs2 19:30'],
    'moving to another branch needs a new check-in');

assert.match(main, /collection\('admin_notifications'\)\s*\.where\('staffId', '==', staffId\)\.where\('read', '==', false\)\s*\.onSnapshot/,
    'the bell listens for new notifications in real time');
assert.match(main, /showLocalNotification\(n\.title \|\| staffNotificationTitle\(n\)/, 'new notifications reach the phone');
for (const action of ['makeup_approved', 'makeup_rejected', 'makeup_covered', 'payslip_published', 'overtime_\\$\\{status\\}', 'bonus10_approved']) {
    assert.match(db, new RegExp(`createAdminNotification\\([^)]*'${action.includes('$') ? '' : action}`), `db-service notifies ${action}`);
}
assert.match(sw, /event\.notification\.data\?\.url/, 'tapping a notification opens the related page');
assert.match(main, /if \(diffMins > 8 \|\| diffMins < -30\) continue;/, 'in-app reminder also uses the 8-minute lead');
assert.match(sw, /\^\[a-z0-9-\]\+\\\.html/, 'only same-origin page names are navigated to');

const resume = main.slice(main.indexOf('async function resumeSavedSession'), main.indexOf('function setLoginButtonLoading'));
assert.match(resume, /await window\.waitAuth\(\)/, 'the login page waits for the saved Firebase session');
assert.match(resume, /DBService\.getAuthenticatedProfile\(firebaseUser/, 'a resumed session is re-verified by UID');
assert.match(resume, /window\.location\.replace\(loginHomeFor\(roles\)\)/);
assert.doesNotMatch(resume, /signOutAndClearSession/, 'a failed resume only shows the form; it never signs the user out');
assert.match(main, /loginForm\.addEventListener\('submit', handleLogin\);\s*signalCoreBootstrapReady\(\);\s*resumeSavedSession\(\);/);

console.log('staff-notifications.test.js: all assertions passed');
