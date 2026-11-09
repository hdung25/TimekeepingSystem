const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/db-service.js'), 'utf8');
const date = '2026-10-09', staff = 'staff-delete';
const targets = ['afternoon', 'evening'].map(sectionKey => ({ compositeKey: 'cs3__2026-10-05', sectionKey, index: 'fri', kind: 'office' }));
let env;
async function seed() {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await db.doc('user_roles/uid-admin').set({ userId: 'admin', role: 'admin', roles: ['admin'], username: 'admin' });
        await db.doc('user_roles/uid-staff').set({ userId: staff, role: 'office_staff', roles: ['office_staff'], username: 'staff' });
        await db.doc('attendance_logs/' + date + '_' + staff).set({ userId: staff, name: 'Test', date, sessions: [{ id: 'remove', checkIn: '2026-10-09T07:00:00Z', checkOut: '2026-10-09T14:00:00Z' }, { id: 'keep', start: '2026-10-09T00:00:00Z' }] });
        await db.doc('office_schedules/cs3__2026-10-05').set({ _revision: 1, afternoon: { fri: [{ id: staff }, { id: 'other' }] }, evening: { fri: [{ id: staff }] } });
    });
}
function service(uid) {
    const db = env.authenticatedContext(uid).firestore();
    // Use this realm: Firebase rejects plain objects originating in a VM realm.
    return new Function('db', 'window', 'firebase', 'localStorage', source + '; return DBService;')(
        db, { db }, firebase, { getItem: () => uid });
}
(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: {
        host: '127.0.0.1', port: 8088, rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    await seed();
    await service('uid-admin').deleteReportShift(staff, date, 'remove', targets);
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        const log = (await db.doc('attendance_logs/' + date + '_' + staff).get()).data();
        assert.deepEqual(log.sessions.map(s => s.id), ['keep']);
        assert.equal(log.checkIn, '2026-10-09T00:00:00Z');
        assert.equal(log.checkOut, null);
        assert.deepEqual((await db.doc('office_schedules/cs3__2026-10-05').get()).data().evening.fri, []);
        assert.equal((await db.doc('cancelled_shifts/2026-10_' + staff).get()).data().shifts.length, 2);
    });
    await seed();
    await service('uid-admin').deleteReportShift(staff, date, 'NEW', [targets[0]]);
    await service('uid-admin').deleteReportShift(staff, date, 'NEW', [targets[1]]);
    await seed();
    await assert.rejects(service('uid-staff').deleteReportShift(staff, date, 'remove', targets));
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        assert.equal((await db.doc('attendance_logs/' + date + '_' + staff).get()).data().sessions.length, 2);
        assert.equal((await db.doc('office_schedules/cs3__2026-10-05').get()).data()._revision, 1);
        assert.equal((await db.doc('cancelled_shifts/2026-10_' + staff).get()).exists, false);
    });
    console.log('report-delete-rules: passed (Admin atomic commit; sequential schedule-only deletion; staff denied without partial writes)');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (env) await env.cleanup(); });
