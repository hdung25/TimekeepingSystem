'use strict';
// Real emulator + real firestore.rules: hẹn giờ gửi bảng lương + xét lương tiếp tân (08/10/2026).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
const Core = require('../js/payslip-schedule-core.js');
const Lifecycle = require('../functions/shared/payslip-lifecycle.js');

const root = path.resolve(__dirname, '..');
const denied = promise => assert.rejects(promise, { code: 'permission-denied' });
const schedule = extra => ({ month: '2026-09', runAt: '2026-10-10T01:00:00.000Z', runAtMs: Date.parse('2026-10-10T01:00:00.000Z'),
    status: 'scheduled', targets: [{ staffId: 'staff-a', name: 'A', gv: true, tt: false }], message: '', createdAt: '2026-10-08T00:00:00.000Z', ...extra });
const plan = (revision, extra = {}) => ({ schemaVersion: 1, staffId: 'staff-a', staffName: 'A', enabled: true, plannedRate: 25000, dueDate: '2026-11-01',
    note: '', lastIncreaseDate: '', currentRate: null, revision, updatedAt: '2026-10-08T00:00:00.000Z', updatedBy: 'uid-admin', history: [], ...extra });

(async () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Never run Rules tests against production');
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await db.collection('user_roles').doc('uid-a').set({ userId: 'staff-a', role: 'receptionist', roles: ['receptionist'] });
            await db.collection('user_roles').doc('uid-admin').set({ userId: 'admin-1', role: 'admin', roles: ['admin'] });
            await db.collection('user_roles').doc('uid-senior').set({ userId: 'senior-1', role: 'senior_assistant', roles: ['senior_assistant'] });
            await db.collection('users').doc('staff-a').set({ name: 'A', roles: ['receptionist'] });
            await db.collection('salary_settings_monthly').doc('2026-09_staff-a').set({ published: { role: 'giao-vien', status: 'draft', status_gv: 'draft', details_gv: { netPay: 100 } } });
        });
        const admin = env.authenticatedContext('uid-admin').firestore();
        const senior = env.authenticatedContext('uid-senior').firestore();
        const staff = env.authenticatedContext('uid-a').firestore();

        // Lệnh hẹn: chỉ Admin chính.
        await admin.collection('payslip_publish_schedules').doc('s1').set(schedule());
        await denied(senior.collection('payslip_publish_schedules').doc('s2').set(schedule()));
        await denied(staff.collection('payslip_publish_schedules').doc('s1').get());
        await denied(admin.collection('payslip_publish_schedules').doc('s3').set(schedule({ status: 'done' })));
        await denied(admin.collection('payslip_publish_schedules').doc('s1').update({ targets: [{ staffId: 'x', gv: true }] }));
        await denied(admin.collection('payslip_publish_schedules').doc('s1').delete());

        // Máy Admin chạy lệnh đến hạn (dự phòng khi Cloud Function chưa chạy) qua rules thật.
        const reports = await Core.runDueSchedules(admin, { lifecycle: Lifecycle, now: new Date('2026-10-10T01:05:00.000Z'),
            serverTimestamp: () => firebase.firestore.FieldValue.serverTimestamp(), runner: 'admin-browser' });
        assert.equal(reports.length, 1);
        assert.equal(reports[0].published, 1, JSON.stringify(reports));
        const payslip = (await staff.collection('salary_settings_monthly').doc('2026-09_staff-a').get()).data();
        assert.equal(payslip.published.status_gv, 'published');
        assert.equal((await admin.collection('payslip_publish_schedules').doc('s1').get()).data().status, 'done');
        await denied(admin.collection('payslip_publish_schedules').doc('s1').update({ status: 'cancelled' }));

        // Hẹn xét lương tiếp tân.
        await admin.collection('reception_salary_reviews').doc('staff-a').set(plan(1));
        await admin.collection('reception_salary_reviews').doc('staff-a').set(plan(2, { dueDate: '2026-12-01' }));
        await denied(admin.collection('reception_salary_reviews').doc('staff-a').set(plan(2)));
        await denied(admin.collection('reception_salary_reviews').doc('staff-a').set(plan(3, { role: 'x' })));
        await denied(admin.collection('reception_salary_reviews').doc('ghost').set(plan(1, { staffId: 'ghost' })));
        await denied(senior.collection('reception_salary_reviews').doc('staff-a').get());
        await denied(admin.collection('reception_salary_reviews').doc('staff-a').delete());
        console.log('owner-round-1008-rules.test.js: all assertions passed');
    } finally {
        await env.cleanup();
    }
})().catch(error => { console.error(error); process.exit(1); });
