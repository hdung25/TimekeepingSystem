'use strict';
// Real Firestore emulator only. No production credentials or data are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
const root = path.resolve(__dirname, '..');
const denied = promise => assert.rejects(promise, { code: 'permission-denied' });

(async () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Never run Rules tests against production');
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            for (const [uid, role] of [['review-admin', 'admin'], ['review-senior', 'senior_assistant'], ['review-staff', 'teacher']]) {
                await db.collection('user_roles').doc(uid).set({ userId: uid, role, roles: [role] });
                await db.collection('users').doc(uid).set({ id: uid, name: 'Fixture', role, salary_config: { roles: [{ id: 'math1', name: 'Toán 1', rate: 32000 }] } });
            }
            await db.collection('subjects').doc('math1').set({ name: 'Toán 1' });
            await db.collection('salary_settings_monthly').doc('2026-08_review-staff').set({ giao_vien: { class_rates: { 'Toán 1': 32000 } }, published: { status: 'received', role: 'teacher', details: { totalBaseMins: 120, netPay: 64000 } } });
            await db.collection('attendance_logs').doc('2026-08-01_review-staff').set({ userId: 'review-staff', date: '2026-08-01', sessions: [{ id: 'old', roleRate: 32000, checkIn: '2026-08-01T01:00:00Z', checkOut: '2026-08-01T03:00:00Z' }] });
        });
        const admin = env.authenticatedContext('review-admin').firestore();
        const senior = env.authenticatedContext('review-senior').firestore();
        const staff = env.authenticatedContext('review-staff').firestore();
        const anon = env.unauthenticatedContext().firestore();
        const profilePath = 'salary_review_profiles/review-staff';
        const settingPath = 'salary_review_settings/default';
        const date = () => new Date().toISOString();
        const group = { id: 'math:level1', name: 'Toán tiểu học', subjectIds: ['math1'], currentRate: 32000, baselineDate: '2026-06-20', baselineKind: 'initial', confirmed: true, enabled: true };
        const baseProfile = { schemaVersion: 1, staffId: 'review-staff', staffName: 'Fixture', personOverrides: { cycleMonths: null, minimumHours: 0, extraMonths: null }, groups: [group] };
        const baseSettings = { schemaVersion: 1, cycleMonths: 3, minimumHours: 43, extraMonths: 1 };
        async function paired(db, parentPath, values, revision, auditId, options = {}) {
            const updatedAt = date();
            const payload = { ...values, revision, updatedAt, updatedBy: 'review-admin', lastHistoryId: auditId, ...options.parent };
            const history = { kind: parentPath === settingPath ? 'settings' : 'profile', revision, actorUid: 'review-admin', createdAt: updatedAt, recordedAt: firebase.firestore.FieldValue.serverTimestamp(), before: {}, after: payload, ...options.history };
            const batch = db.batch();
            batch.set(db.doc(parentPath), payload);
            if (!options.omitAudit) batch.set(db.doc(`${parentPath}/history/${auditId}`), history);
            await batch.commit();
            return payload;
        }
        const historicalPayroll = (await admin.doc('salary_settings_monthly/2026-08_review-staff').get()).data();
        const historicalAttendance = (await admin.doc('attendance_logs/2026-08-01_review-staff').get()).data();
        const personnel = (await admin.doc('users/review-staff').get()).data();

        await paired(admin, settingPath, baseSettings, 1, 'settings_1');
        await paired(admin, profilePath, baseProfile, 1, 'profile_1');
        assert.equal((await admin.doc(profilePath).get()).data().revision, 1);
        await paired(admin, profilePath, { ...baseProfile, groups: [{ ...group, minimumHours: 25 }] }, 2, 'profile_2');
        assert.equal((await admin.collection('salary_review_profiles').get()).size, 1);
        assert.equal((await admin.doc(profilePath).collection('history').get()).size, 2);
        console.log('PASS primary Admin profile/settings creates, updates, listing, audit pairing');

        for (const db of [senior, staff, anon]) {
            await denied(db.doc(profilePath).get());
            await denied(db.collection('salary_review_profiles').get());
            await denied(db.doc(settingPath).get());
            await denied(db.doc(`${profilePath}/history/profile_1`).get());
            await denied(paired(db, profilePath, baseProfile, 3, 'forbidden_' + Math.random().toString(36).slice(2)));
            await denied(paired(db, settingPath, baseSettings, 2, 'forbidden_' + Math.random().toString(36).slice(2)));
        }
        console.log('PASS senior assistant, staff and anonymous cannot read or write review financial data');

        await denied(paired(admin, profilePath, baseProfile, 3, 'missing_audit', { omitAudit: true }));
        await denied(paired(admin, profilePath, baseProfile, 2, 'same_revision'));
        await denied(paired(admin, profilePath, baseProfile, 4, 'skip_revision'));
        await denied(paired(admin, profilePath, baseProfile, 3, 'wrong_actor', { history: { actorUid: 'review-staff' } }));
        await denied(paired(admin, profilePath, baseProfile, 3, 'wrong_updated_actor', { parent: { updatedBy: 'review-staff' } }));
        await denied(paired(admin, profilePath, baseProfile, 3, 'wrong_audit_revision', { history: { revision: 100 } }));
        await denied(paired(admin, profilePath, baseProfile, 3, 'forged_server_stamp', { history: { recordedAt: '2026-09-01T00:00:00Z' } }));
        await denied(paired(admin, profilePath, { ...baseProfile, staffId: 'another-person' }, 3, 'wrong_person'));
        await denied(paired(admin, profilePath, { ...baseProfile, salary_config: { rate: 1 } }, 3, 'unsupported_top_field'));
        await denied(paired(admin, profilePath, { ...baseProfile, personOverrides: { cycleMonths: -1 } }, 3, 'invalid_cycle'));
        await denied(paired(admin, profilePath, { ...baseProfile, groups: Array(41).fill(group) }, 3, 'too_many_groups'));
        await denied(paired(admin, settingPath, { ...baseSettings, minimumHours: -1 }, 2, 'negative_threshold'));
        await denied(paired(admin, 'salary_review_settings/other', baseSettings, 1, 'other_setting'));
        await denied(admin.doc(profilePath).delete());
        await denied(admin.doc(settingPath).delete());
        await denied(admin.doc(`${profilePath}/history/profile_1`).update({ kind: 'overwrite' }));
        await denied(admin.doc(`${profilePath}/history/profile_1`).delete());
        await denied(admin.doc(`${settingPath}/history/settings_1`).delete());
        const forged = { kind: 'profile', revision: 2, actorUid: 'review-admin', createdAt: date(), recordedAt: firebase.firestore.FieldValue.serverTimestamp() };
        await denied(admin.doc(`${profilePath}/history/orphan`).set(forged));
        assert.equal((await admin.doc(profilePath).get()).data().revision, 2, 'Rejected writes leave the last committed parent intact');
        console.log('PASS stale/forged/orphaned writes rejected; no parent deletion or history changes');

        assert.deepEqual((await admin.doc('salary_settings_monthly/2026-08_review-staff').get()).data(), historicalPayroll);
        assert.deepEqual((await admin.doc('attendance_logs/2026-08-01_review-staff').get()).data(), historicalAttendance);
        assert.deepEqual((await admin.doc('users/review-staff').get()).data(), personnel);
        assert.deepEqual((await staff.doc('salary_settings_monthly/2026-08_review-staff').get()).data(), historicalPayroll, 'Existing own payslip read preserved');
        assert.deepEqual((await staff.doc('attendance_logs/2026-08-01_review-staff').get()).data(), historicalAttendance, 'Existing own attendance read preserved');
        await denied(staff.doc('salary_settings_monthly/2026-08_review-staff').update({ 'giao_vien.class_rates': { 'Toán 1': 99999 } }));
        await denied(senior.doc('salary_settings_monthly/2026-08_review-staff').update({ 'giao_vien.class_rates': { 'Toán 1': 99999 } }));
        console.log('PASS original payslip, rates, personnel and attendance preserved; old authorization boundary intact');

        // Run real review service envelopes too: catches a valid Rules contract
        // being unreachable by the actual browser writer.
        const serviceSource = fs.readFileSync(path.join(root, 'js/salary-review-service.js'), 'utf8');
        const dbSource = fs.readFileSync(path.join(root, 'js/db-service.js'), 'utf8');
        const lifecycleStart = dbSource.indexOf('// PAYSLIP LIFECYCLE HELPERS START');
        const lifecycleEnd = dbSource.indexOf('function _getPayslipPaymentBreakdown', lifecycleStart);
        const lifecycle = new Function(dbSource.slice(lifecycleStart, lifecycleEnd) + ';return _getPayslipLifecycleState;')();
        const window = { db: admin, firebase, SalaryReviewPolicy: require('../js/salary-review-policy.js'),
            SalaryReviewApplication: require('../js/salary-review-application.js'),
            DBService: { getAuthenticatedAuthorizationContext: async () => ({ uid: 'review-admin', userId: 'review-admin', roles: ['admin'] }), getPayslipLifecycleState: lifecycle } };
        new Function('window', serviceSource)(window);
        const service = window.SalaryReviewService;
        await service.saveSettings({ cycleMonths: 4, minimumHours: 0, extraMonths: 1 }, 1);
        await service.saveProfile('review-staff', { groups: [group], personOverrides: {} }, 2, [{ id: 'math1', name: 'Toán 1' }]);
        await assert.rejects(service.saveProfile('review-staff', { groups: [group], personOverrides: {} }, 2, [{ id: 'math1', name: 'Toán 1' }]), /phiên khác/);
        const nextReviewDate = window.SalaryReviewPolicy.addMonths(window.SalaryReviewPolicy.dateKey(), 1);
        await service.decide('review-staff', group.id, { kind: 'deferred', reason: 'Fixture admin decision', nextReviewDate }, 3);
        assert.equal((await admin.doc(profilePath).get()).data().revision, 4);
        assert.equal((await admin.doc(profilePath).collection('history').get()).size, 4);
        assert.deepEqual((await admin.doc('salary_settings_monthly/2026-08_review-staff').get()).data(), historicalPayroll);
        console.log('PASS actual service settings/profile/defer transactions and stale-tab check under deployed Rules');

        const targetMonth = window.SalaryReviewPolicy.addMonths(window.SalaryReviewPolicy.dateKey().slice(0, 7) + '-01', 1).slice(0, 7);
        const targetRef = admin.doc(`salary_settings_monthly/${targetMonth}_review-staff`);
        const operational = { tiep_tan: { class_rates: { Reception: 40000 }, advance: 50000 }, published: { role: 'tiep-tan', status: 'received', status_tt: 'received', details_tt: { netPay: 123000, filteredMinutes: 120 } } };
        await targetRef.set(operational);
        const beforeDecision = (await admin.doc(profilePath).get()).data();
        const prepared = await service.prepareApplication('review-staff', group.id, { newRate: 36000, targetMonth, selectedSubjectIds: ['math1'], reason: 'Fixture approved future rate' }, 4);
        assert.equal(prepared.preview.changes[0].afterRate, 36000);
        await service.applyApplication(prepared);
        const appliedTarget = (await targetRef.get()).data();
        assert.equal(appliedTarget.giao_vien.class_rates['Toán 1'], 36000);
        assert.deepEqual(appliedTarget.tiep_tan, operational.tiep_tan);
        assert.deepEqual(appliedTarget.published, operational.published);
        assert.equal((await admin.doc(profilePath).get()).data().revision, 5);
        assert.equal((await service.applyApplication(prepared)).alreadyApplied, true, 'Retry is idempotent across real transactions');
        assert.equal((await admin.doc(profilePath).collection('history').get()).size, 5);
        await service.cancelApplication('review-staff', group.id, 'Fixture cancel before effective date', 5);
        assert.deepEqual((await targetRef.get()).data(), operational, 'Cancel restores absence of GV key and preserves TT snapshot without deleting monthly doc');
        assert.deepEqual((await admin.doc(profilePath).get()).data().groups, beforeDecision.groups);
        assert.equal((await admin.doc(profilePath).get()).data().revision, 6);
        assert.equal((await admin.doc(profilePath).collection('history').get()).size, 6);
        await denied(admin.doc(`${profilePath}/history/${prepared.operationId}`).update({ newRate: 99999 }));
        const stalePrepared = await service.prepareApplication('review-staff', group.id, { newRate: 38000, targetMonth, selectedSubjectIds: ['math1'], reason: 'Fixture stale source' }, 6);
        await targetRef.update({ 'tiep_tan.advance': 60000 });
        await assert.rejects(service.applyApplication(stalePrepared), /Nguồn giá hoặc hồ sơ vừa thay đổi/);
        assert.equal((await admin.doc(profilePath).get()).data().revision, 6);
        assert.equal((await targetRef.get()).data().tiep_tan.advance, 60000, 'An intervening real Admin edit is never replaced');
        assert.equal((await targetRef.get()).data().giao_vien, undefined);
        assert.deepEqual((await admin.doc('salary_settings_monthly/2026-08_review-staff').get()).data(), historicalPayroll);
        assert.deepEqual((await admin.doc('attendance_logs/2026-08-01_review-staff').get()).data(), historicalAttendance);
        console.log('PASS actual preview/apply/retry/cancel, immutable financial audit, source CAS and old-payroll/TT/attendance preservation');
    } finally { await env.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
