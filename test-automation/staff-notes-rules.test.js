'use strict';
// Real Firestore emulator + real firestore.rules for the personal notebook (staff_notes).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');

const root = path.resolve(__dirname, '..');
const denied = promise => assert.rejects(promise, { code: 'permission-denied' });
const now = () => firebase.firestore.FieldValue.serverTimestamp();
const note = (staffId, extra = {}) => ({
    staffId, staffName: 'Tên', title: 'Việc cần làm', body: 'Gọi phụ huynh lớp E5',
    items: [{ text: 'In đề', done: false }], color: 'yellow', pinned: false, remindOn: null,
    createdAt: now(), updatedAt: now(), ...extra
});

(async () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Never run Rules tests against production');
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await db.collection('user_roles').doc('uid-a').set({ userId: 'staff-a', role: 'staff', roles: ['staff'] });
            await db.collection('user_roles').doc('uid-b').set({ userId: 'staff-b', role: 'receptionist', roles: ['receptionist'] });
            await db.collection('user_roles').doc('uid-admin').set({ userId: 'admin-1', role: 'admin', roles: ['admin'] });
            await db.collection('user_roles').doc('uid-senior').set({ userId: 'senior-1', role: 'senior_assistant', roles: ['senior_assistant'] });
        });
        const a = env.authenticatedContext('uid-a').firestore();
        const b = env.authenticatedContext('uid-b').firestore();
        const admin = env.authenticatedContext('uid-admin').firestore();
        const senior = env.authenticatedContext('uid-senior').firestore();
        const anon = env.unauthenticatedContext().firestore();

        // Owner creates, reads, updates and deletes own note.
        await a.collection('staff_notes').doc('n1').set(note('staff-a'));
        await a.collection('staff_notes').doc('n2').set(note('staff-a', { pinned: true, color: 'green', remindOn: '2026-10-05' }));
        assert.equal((await a.collection('staff_notes').where('staffId', '==', 'staff-a').get()).size, 2);
        await a.collection('staff_notes').doc('n1').update({ title: 'Đã sửa', items: [], updatedAt: now() });
        await b.collection('staff_notes').doc('nb').set(note('staff-b'));

        // Cannot write for someone else, forge fields or fake timestamps.
        await denied(a.collection('staff_notes').doc('x1').set(note('staff-b')));
        await denied(a.collection('staff_notes').doc('x2').set(note('staff-a', { role: 'admin' })));
        await denied(a.collection('staff_notes').doc('x3').set(note('staff-a', { color: 'red' })));
        await denied(a.collection('staff_notes').doc('x4').set(note('staff-a', { updatedAt: new Date(2020, 0, 1) })));
        await denied(a.collection('staff_notes').doc('x5').set(note('staff-a', { body: 'x'.repeat(20001) })));
        await denied(a.collection('staff_notes').doc('x6').set(note('staff-a', { remindOn: 'mai' })));
        await denied(a.collection('staff_notes').doc('n1').update({ staffId: 'staff-b', updatedAt: now() }));
        await denied(a.collection('staff_notes').doc('n1').update({ createdAt: new Date(2020, 0, 1), updatedAt: now() }));
        await denied(a.collection('staff_notes').doc('n1').update({ title: 'không đổi giờ' }));

        // Other staff cannot read, list, edit or delete.
        await denied(b.collection('staff_notes').doc('n1').get());
        await denied(b.collection('staff_notes').where('staffId', '==', 'staff-a').get());
        await denied(b.collection('staff_notes').get());
        await denied(b.collection('staff_notes').doc('n1').update({ title: 'hack', updatedAt: now() }));
        await denied(b.collection('staff_notes').doc('n1').delete());
        await denied(anon.collection('staff_notes').get());
        await denied(senior.collection('staff_notes').get());

        // Primary admin sees every note (read-only).
        const all = await admin.collection('staff_notes').orderBy('updatedAt', 'desc').limit(500).get();
        assert.equal(all.size, 3);
        await denied(admin.collection('staff_notes').doc('n1').update({ title: 'admin sửa', updatedAt: now() }));
        await denied(admin.collection('staff_notes').doc('n1').delete());
        // Admin keeps a personal notebook too.
        await admin.collection('staff_notes').doc('na').set(note('admin-1'));

        await a.collection('staff_notes').doc('n1').delete();
        console.log('staff-notes-rules.test.js: all assertions passed');
    } finally {
        await env.cleanup();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
