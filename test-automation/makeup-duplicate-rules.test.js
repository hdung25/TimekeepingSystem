'use strict';
// Real Firestore emulator + real firestore.rules. No production data is used.
// One make-up request per shift, and a request whose hours an admin already
// recorded in Bảng Công is closed without touching attendance or payroll.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');

const root = path.resolve(__dirname, '..');
const dbSource = fs.readFileSync(path.join(root, 'js', 'db-service.js'), 'utf8');
const staffId = 'mk-staff';
const dateKey = '2026-09-15';
const iso = hm => `${dateKey}T${hm}:00+07:00`;

// Same realm as the Firebase SDK (objects from a vm context fail its plain-object
// check), but wrapped in a function so the staff and admin copies stay separate.
const loadService = vm.runInThisContext(`(function (db, firebase, localStorage, window, console) {\n${dbSource}\nreturn DBService;\n})`);
function serviceFor(db, userId) {
    const storage = new Map([['currentUserId', userId]]);
    const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    return loadService(db, firebase, localStorage, {}, { log() {}, warn() {}, error() {}, info() {} });
}

const scheduled = (start, end, extra = {}) => ({
    staffId, staffName: 'Fixture', type: 'scheduled', dateKey, branch: 'cs1',
    shiftLabel: `${start}–${end} CS1 (E4)`, className: 'E4', shiftStart: start, shiftEnd: end, shiftKind: 'gv',
    scheduleLocators: [{ kind: 'gv', compositeKey: `cs1__${dateKey}`, section: 'evening1', rowIndex: 0, shiftId: 'shift-e4', start, end, branch: 'cs1' }],
    session: { checkIn: iso(start), checkOut: iso(end) }, reason: 'Quên chấm công', ...extra
});

(async () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Never run Rules tests against production');
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await db.collection('user_roles').doc('mk-staff-uid').set({ userId: staffId, role: 'teacher', roles: ['teacher'] });
            await db.collection('user_roles').doc('mk-admin-uid').set({ userId: 'mk-admin', role: 'admin', roles: ['admin'] });
        });
        const staffDb = env.authenticatedContext('mk-staff-uid').firestore();
        const adminDb = env.authenticatedContext('mk-admin-uid').firestore();
        const staff = serviceFor(staffDb, staffId);
        const admin = serviceFor(adminDb, 'mk-admin');

        await staff.createMakeupRequests([scheduled('18:00', '21:00')]);
        await assert.rejects(staff.createMakeupRequests([scheduled('18:00', '21:00')]), { code: 'MAKEUP_DUPLICATE' });
        await assert.rejects(staff.createMakeupRequests([scheduled('19:30', '21:00', { scheduleLocators: [{ kind: 'gv', compositeKey: `cs1__${dateKey}`, section: 'evening2', rowIndex: 0, start: '19:30', end: '21:00' }] })]),
            { code: 'MAKEUP_DUPLICATE' }, 'a sub-span of a pending chain cannot be requested again');
        await assert.rejects(staff.createMakeupRequests([{ ...scheduled('18:30', '20:00'), type: 'unscheduled', scheduleLocators: [], approvedBy: 'Quản lý' }]),
            { code: 'MAKEUP_DUPLICATE' }, 'the "ngoài lịch" tab cannot duplicate a pending shift');
        // Bypass the pre-check (two tabs racing): the fixed ID turns the second write into an
        // update, which only managers may perform.
        const fixedId = staff._makeupRequestFixedId(scheduled('18:00', '21:00'));
        assert.ok(fixedId.startsWith('mks_'));
        await assert.rejects(staffDb.collection('makeup_requests').doc(fixedId).set({ ...scheduled('18:00', '21:00'), status: 'pending' }),
            { code: 'permission-denied' });
        assert.equal((await adminDb.collection('makeup_requests').where('staffId', '==', staffId).get()).size, 1);
        console.log('PASS one request per shift: re-send, sub-span, extra tab and racing tab are all rejected');

        // Morning request, then an admin adds attendance covering it only partially.
        await staff.createMakeupRequests([scheduled('07:30', '09:00', { scheduleLocators: [{ kind: 'gv', compositeKey: `cs1__${dateKey}`, section: 'morning1', rowIndex: 0, start: '07:30', end: '09:00' }] })]);
        await env.withSecurityRulesDisabled(async context => {
            await context.firestore().collection('attendance_logs').doc(`${dateKey}_${staffId}`).set({ userId: staffId, date: dateKey, sessions: [
                { id: 'admin-morning', type: 'admin_add', checkIn: iso('07:30'), checkOut: iso('09:00') },
                { id: 'admin-part', type: 'admin_add', checkIn: iso('18:00'), checkOut: iso('19:30') }
            ] });
        });
        const resolved = await admin.resolveMakeupRequestsCoveredByAttendance(staffId, dateKey, 'Fixture Admin');
        assert.equal(resolved.length, 1, 'only the fully covered request is closed');
        const requests = (await adminDb.collection('makeup_requests').where('staffId', '==', staffId).get()).docs.map(doc => doc.data());
        const morning = requests.find(item => item.shiftStart === '07:30');
        const evening = requests.find(item => item.shiftStart === '18:00');
        assert.equal(morning.status, 'rejected');
        assert.equal(morning.resolution, 'covered_by_attendance');
        assert.deepEqual(morning.resolvedSessionIds, ['admin-morning']);
        assert.equal(evening.status, 'pending', 'a partially covered chain stays for manual review');
        const attendance = (await adminDb.collection('attendance_logs').doc(`${dateKey}_${staffId}`).get()).data();
        assert.equal(attendance.sessions.length, 2, 'closing a request never writes attendance');
        await assert.rejects(staff.createMakeupRequests([scheduled('07:30', '09:00', { scheduleLocators: [{ kind: 'gv', compositeKey: `cs1__${dateKey}`, section: 'morning1', rowIndex: 1, start: '07:30', end: '09:00' }] })]),
            { code: 'MAKEUP_DUPLICATE' }, 'a shift that already has attendance cannot be requested');
        console.log('PASS admin-added attendance closes fully covered requests only, without writing attendance');
        console.log('makeup-duplicate-rules.test.js: all assertions passed');
    } finally {
        await env.cleanup();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
