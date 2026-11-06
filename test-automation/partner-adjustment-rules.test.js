'use strict';
// Real Firestore emulator + real firestore.rules for partner-only corrections (Bảng công liên kết).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');

const root = path.resolve(__dirname, '..');
const denied = promise => assert.rejects(promise, { code: 'permission-denied' });
const now = () => firebase.firestore.FieldValue.serverTimestamp();
const id = 'teacher-1__2026-10-05__cs1__2026-10-05_evening1_13_18_00_19_30_b';
const adjustment = (extra = {}) => ({
    staffId: 'teacher-1', date: '2026-10-05', month: '2026-10', rowKey: 'cs1__2026-10-05|evening1|13|18:00|19:30|b',
    active: true, status: 'du', checkIn: '17:57', checkOut: '19:30', minutes: 90, note: '',
    updatedByName: 'Admin', updatedByStaffId: 'admin-1', updatedAt: now(), createdAt: now(), ...extra
});

(async () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Never run Rules tests against production');
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await db.collection('user_roles').doc('uid-admin').set({ userId: 'admin-1', role: 'admin', roles: ['admin'] });
            await db.collection('user_roles').doc('uid-senior').set({ userId: 'senior-1', role: 'senior_assistant', roles: ['senior_assistant'] });
            await db.collection('user_roles').doc('uid-reception').set({ userId: 'rec-1', role: 'receptionist', roles: ['receptionist'] });
            await db.collection('overtime_requests').doc('ot-1').set({ staffId: 'teacher-1', dateKey: '2026-10-05', status: 'approved' });
            await db.collection('bonus10_requests').doc('b-1').set({ staffId: 'teacher-1', dateKey: '2026-10-05', status: 'approved' });
            await db.collection('user_roles').doc('uid-teacher').set({ userId: 'teacher-1', role: 'staff', roles: ['teaching_assistant'] });
        });
        const admin = env.authenticatedContext('uid-admin').firestore();
        const senior = env.authenticatedContext('uid-senior').firestore();
        const teacher = env.authenticatedContext('uid-teacher').firestore();
        const reception = env.authenticatedContext('uid-reception').firestore();
        const anon = env.unauthenticatedContext().firestore();
        const col = db => db.collection('partner_attendance_adjustments');

        // Only the primary admin creates and updates; nobody deletes.
        // v261: senior assistant and reception read (view + export), never write.
        await col(admin).doc(id).set(adjustment());
        assert.equal((await col(admin).where('month', '==', '2026-10').get()).size, 1);
        assert.equal((await col(senior).where('month', '==', '2026-10').get()).size, 1);
        assert.equal((await col(reception).where('month', '==', '2026-10').get()).size, 1);
        await denied(col(reception).doc('rec__x').set(adjustment({ rowKey: 'x' })));
        await denied(col(reception).doc(id).set(adjustment()));
        // The report reads each teacher's overtime / +10 status; reception may list but not change them.
        assert.equal((await reception.collection('overtime_requests').where('staffId', '==', 'teacher-1').get()).size, 1);
        assert.equal((await reception.collection('bonus10_requests').where('staffId', '==', 'teacher-1').get()).size, 1);
        await denied(reception.collection('overtime_requests').doc('ot-1').update({ status: 'rejected' }));
        await denied(reception.collection('bonus10_requests').doc('b-1').update({ status: 'rejected' }));
        await denied(reception.collection('salary_settings_monthly').doc('2026-10_teacher-1').get());
        await denied(teacher.collection('overtime_requests').where('staffId', '==', 'teacher-2').get());
        await denied(col(teacher).doc(id).get());
        await denied(col(anon).doc(id).get());
        await denied(col(teacher).doc('teacher-1__x').set(adjustment({ rowKey: 'x' })));
        await denied(col(senior).doc('senior__x').set(adjustment({ rowKey: 'x' })));
        await denied(col(admin).doc(id).delete());

        // Shape is enforced: no extra fields, valid status/time/minutes, month matches the date, server time.
        await denied(col(admin).doc('a1').set(adjustment({ salary: 100000 })));
        await denied(col(admin).doc('a2').set(adjustment({ status: 'paid' })));
        await denied(col(admin).doc('a3').set(adjustment({ minutes: 1441 })));
        await denied(col(admin).doc('a4').set(adjustment({ minutes: 1.5 })));
        await denied(col(admin).doc('a5').set(adjustment({ checkIn: '25:00' })));
        await denied(col(admin).doc('a6').set(adjustment({ month: '2026-11' })));
        await denied(col(admin).doc('a7').set(adjustment({ updatedAt: new Date(2020, 0, 1) })));
        await denied(col(admin).doc('a8').set(adjustment({ note: 'x'.repeat(501) })));
        await denied(col(admin).doc('bad.id').set(adjustment()));
        await col(admin).doc('a9').set(adjustment({ status: 'vkp', minutes: 0, checkIn: '', checkOut: '' }));

        // Update keeps identity and createdAt; soft clear with active=false.
        const created = (await col(admin).doc(id).get()).data().createdAt;
        await col(admin).doc(id).set(adjustment({ active: false, createdAt: created }));
        assert.equal((await col(admin).doc(id).get()).data().active, false);
        await denied(col(admin).doc(id).set(adjustment({ createdAt: now() })));
        await denied(col(admin).doc(id).set(adjustment({ staffId: 'teacher-2', createdAt: created })));
        await denied(col(admin).doc(id).set(adjustment({ rowKey: 'other', createdAt: created })));

        // The partner collection never opens a path into attendance or payroll.
        await denied(admin.collection('partner_attendance_adjustments_x').doc('z').set(adjustment()));
        console.log('partner-adjustment-rules.test.js: all assertions passed');
    } finally {
        await env.cleanup();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
