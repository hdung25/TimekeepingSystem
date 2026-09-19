'use strict';
// Real DBService + global resolver + Firestore Rules; emulator only, no live data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
const root = path.resolve(__dirname, '..');
const dbSource = fs.readFileSync(path.join(root, 'js/db-service.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const autoSource = mainSource.slice(mainSource.indexOf('let globalAutoCheckoutInFlight'),
    mainSource.indexOf('// ================= STAFF NOTIFICATIONS'));
const day = '2026-09-19';
const at = hm => new Date(`${day}T${hm}:00+07:00`);
class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [at('12:00').getTime()])); }
    static now() { return at('12:00').getTime(); }
}

(async () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/,
        'Never run against production');
    const env = await initializeTestEnvironment({
        projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') }
    });
    try {
        await env.clearFirestore();
        const staffId = 'fixture-auto-checkout';
        const uid = 'uid-auto-checkout';
        const session = { id: 'session-1', checkIn: at('08:00').toISOString(), start: at('08:00').toISOString(),
            checkOut: null, anchorDateKey: day, status: 'open', source: 'personal', roleRate: 48000,
            role: 'subject-math', linkedClassStart: '08:00', bonus10: true, studentCount: 9 };
        const logId = `${day}_${staffId}`;
        await env.withSecurityRulesDisabled(async c => {
            const db = c.firestore();
            await db.collection('user_roles').doc(uid).set({ userId: staffId, role: 'teaching_assistant', roles: ['teaching_assistant'] });
            await db.collection('users').doc(staffId).set({ id: staffId, authUid: uid, name: 'Fixture', role: 'teaching_assistant' });
            await db.collection('settings').doc('system').set({ centerClosures: {} });
            await db.collection('attendance_logs').doc(logId).set({ userId: staffId, date: day,
                name: 'Fixture', sessions: [session], checkIn: session.checkIn, checkOut: null });
            for (const branch of ['cs1', 'cs2', 'cs3']) {
                await db.collection('schedules').doc(`${branch}__${day}`).set({ morning1: branch === 'cs1'
                    ? [{ shiftId: 'fixture-shift', gvId: staffId, gv: 'Fixture', start: '08:00', end: '11:00', lop: 'Math' }] : [] });
            }
        });
        const storage = new Map([['currentUserId', staffId], ['currentRole', 'teaching_assistant']]);
        const auth = { currentUser: { uid, getIdToken: async () => 'emulator-only' } };
        const appWindow = { auth };
        const db = env.authenticatedContext(uid).firestore();
        const api = new Function('window', 'localStorage', 'db', 'firebase', 'Date',
            dbSource + '\n' + autoSource + '\nreturn { service: DBService, globalCheckAutoCheckout };')(
            appWindow, { getItem: key => storage.get(key) || null }, db, { firestore: firebase.firestore, auth: () => auth }, Clock);

        assert.equal(await api.globalCheckAutoCheckout({ fresh: true, refreshUi: false }), true);
        const closed = (await db.collection('attendance_logs').doc(logId).get()).data();
        assert.equal(closed.sessions[0].checkOut, at('11:00').toISOString());
        assert.deepEqual(closed.sessions[0], { ...session, checkOut: at('11:00').toISOString(), status: 'closed', autoClosedReason: 'scheduled_end' });
        assert.equal(await api.globalCheckAutoCheckout({ fresh: true, refreshUi: false }), false);
        console.log('PASS actual roster/settings/cancellation reads + automatic cutoff transaction under staff Rules');

        // Admin can correct the committed cutoff without the next automatic pass
        // undoing it; re-opening a report or another page does not re-close it.
        await env.withSecurityRulesDisabled(c => c.firestore().collection('attendance_logs').doc(logId).update({
            sessions: [{ ...closed.sessions[0], checkOut: at('11:30').toISOString() }], checkOut: at('11:30').toISOString()
        }));
        assert.equal(await api.globalCheckAutoCheckout({ fresh: true, refreshUi: false }), false);
        assert.equal((await db.collection('attendance_logs').doc(logId).get()).data().checkOut, at('11:30').toISOString());

        // An admin correction between planning and the transaction wins. This uses
        // the real service and Rules; it must fail before attempting any write.
        const edited = { ...session, checkIn: at('08:15').toISOString(), start: at('08:15').toISOString(), isAdminEdited: true };
        await env.withSecurityRulesDisabled(c => c.firestore().collection('attendance_logs').doc(logId).update({
            sessions: [edited], checkIn: edited.checkIn, checkOut: null
        }));
        assert.equal(await api.globalCheckAutoCheckout({ fresh: true, refreshUi: false }), false,
            'the global resolver preserves an open session explicitly corrected by Admin');
        await assert.rejects(api.service.checkOutPersonal(staffId, at('11:00'), { expectedSession: {
            dateKey: day, id: session.id, checkIn: session.checkIn, start: session.start
        } }), { code: 'attendance/session-changed' });
        assert.deepEqual((await db.collection('attendance_logs').doc(logId).get()).data().sessions, [edited]);
        console.log('PASS Admin correction and historical rate/link/bonus/count preservation');
    } finally {
        await env.cleanup();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
