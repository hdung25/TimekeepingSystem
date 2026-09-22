'use strict';
// Real Firestore emulator + real firestore.rules for web push device tokens.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

const root = path.resolve(__dirname, '..');
const denied = promise => assert.rejects(promise, { code: 'permission-denied' });
const id = 'a'.repeat(64);
const token = 'fcm-token-' + 'x'.repeat(140);
const doc = (staffId, authUid, extra = {}) => ({ staffId, authUid, token, enabled: true, userAgent: 'test', updatedAt: new Date(), ...extra });

(async () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Never run Rules tests against production');
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await db.collection('user_roles').doc('uid-a').set({ userId: 'staff-a', role: 'teaching_assistant', roles: ['teaching_assistant'] });
            await db.collection('user_roles').doc('uid-b').set({ userId: 'staff-b', role: 'receptionist', roles: ['receptionist'] });
            await db.collection('user_roles').doc('uid-admin').set({ userId: 'admin', role: 'admin', roles: ['admin'] });
        });
        const a = env.authenticatedContext('uid-a').firestore();
        const b = env.authenticatedContext('uid-b').firestore();
        const admin = env.authenticatedContext('uid-admin').firestore();

        await a.collection('push_tokens').doc(id).set(doc('staff-a', 'uid-a'));
        await denied(a.collection('push_tokens').doc('b'.repeat(64)).set(doc('staff-b', 'uid-a')));
        await denied(a.collection('push_tokens').doc('c'.repeat(64)).set(doc('staff-a', 'uid-b')));
        await denied(a.collection('push_tokens').doc('not-a-hash').set(doc('staff-a', 'uid-a')));
        await denied(a.collection('push_tokens').doc('d'.repeat(64)).set(doc('staff-a', 'uid-a', { role: 'admin' })));
        await denied(b.collection('push_tokens').doc(id).get());
        await denied(a.collection('push_tokens').get());
        assert.equal((await admin.collection('push_tokens').get()).size, 1);
        // Shared phone: B signs in on the same device and takes the token over.
        await b.collection('push_tokens').doc(id).set(doc('staff-b', 'uid-b'));
        await denied(a.collection('push_tokens').doc(id).delete());
        await b.collection('push_tokens').doc(id).delete();
        await denied(a.collection('push_reminders').doc('x').set({ a: 1 }));
        await denied(admin.collection('push_reminders').doc('x').get());
        console.log('push-token-rules.test.js: all assertions passed');
    } finally {
        await env.cleanup();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
