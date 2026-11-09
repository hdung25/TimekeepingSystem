'use strict';
// Real Firestore emulator only. Ghi chú riêng trang Xét tăng lương: chỉ Admin chính.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const root = path.resolve(__dirname, '..');
const denied = promise => assert.rejects(promise, { code: 'permission-denied' });

(async () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Never run Rules tests against production');
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            for (const [uid, role] of [['note-admin', 'admin'], ['note-senior', 'senior_assistant'], ['note-staff', 'teacher']]) {
                await db.collection('user_roles').doc(uid).set({ userId: uid, role, roles: [role] });
                await db.collection('users').doc(uid).set({ id: uid, name: 'Fixture', role });
            }
        });
        const admin = env.authenticatedContext('note-admin').firestore();
        const senior = env.authenticatedContext('note-senior').firestore();
        const staff = env.authenticatedContext('note-staff').firestore();
        const ok = { staffId: 'note-staff', text: '09/11: hứa tháng 1 lên 52k', updatedAt: new Date().toISOString(), updatedBy: 'note-admin' };
        const ref = db => db.collection('salary_review_notes').doc('note-staff');

        await ref(admin).set(ok);
        await ref(admin).set({ ...ok, text: '' });
        assert.equal((await ref(admin).get()).data().text, '');
        await denied(ref(admin).set({ ...ok, updatedBy: 'someone-else' }));
        await denied(ref(admin).set({ ...ok, staffId: 'other' }));
        await denied(ref(admin).set({ ...ok, extra: 1 }));
        await denied(ref(admin).set({ ...ok, text: 'x'.repeat(5001) }));
        await denied(ref(admin).delete());
        await denied(ref(senior).get());
        await denied(ref(senior).set({ ...ok, updatedBy: 'note-senior' }));
        await denied(ref(staff).get());
        await denied(ref(staff).set({ ...ok, updatedBy: 'note-staff' }));
        console.log('salary-review-notes rules tests passed');
    } finally {
        await env.cleanup();
    }
})().catch(error => { console.error(error); process.exit(1); });
