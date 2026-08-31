const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const dbSource = read('js/db-service.js');
const personnelSource = read('js/personnel.js');
const quietConsole = { log() {}, warn() {}, error() {} };

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createFakeFirestore(initialDocuments = {}) {
    const documents = new Map(Object.entries(initialDocuments).map(([key, value]) => [key, clone(value)]));
    let failAfterCommitOnce = false;

    function reference(collection, id) {
        return { collection, id, path: `${collection}/${id}` };
    }

    function snapshot(ref) {
        const exists = documents.has(ref.path);
        return {
            id: ref.id,
            ref,
            exists,
            data: () => exists ? clone(documents.get(ref.path)) : undefined
        };
    }

    const firestore = {
        documents,
        failNextTransactionAfterCommit() {
            failAfterCommitOnce = true;
        },
        collection(name) {
            return {
                doc(id) {
                    return reference(name, String(id));
                },
                where(field, operator, value) {
                    assert.equal(field, 'userId');
                    assert.equal(operator, '==');
                    return {
                        async get() {
                            const docs = [];
                            for (const key of documents.keys()) {
                                if (!key.startsWith(`${name}/`)) continue;
                                const ref = reference(name, key.slice(name.length + 1));
                                const doc = snapshot(ref);
                                if (doc.data()?.[field] === value) docs.push(doc);
                            }
                            return { docs, size: docs.length, empty: docs.length === 0 };
                        }
                    };
                }
            };
        },
        async runTransaction(callback) {
            const writes = [];
            const transaction = {
                get: async ref => snapshot(ref),
                delete: ref => writes.push({ type: 'delete', ref }),
                set: (ref, data) => writes.push({ type: 'set', ref, data: clone(data) })
            };
            const result = await callback(transaction);
            writes.forEach(write => {
                if (write.type === 'delete') documents.delete(write.ref.path);
                else documents.set(write.ref.path, clone(write.data));
            });
            if (failAfterCommitOnce) {
                failAfterCommitOnce = false;
                const error = new Error('acknowledgement lost');
                error.code = 'unavailable';
                throw error;
            }
            return result;
        }
    };
    return firestore;
}

function loadService(firestore, currentStaffId = 'manager-1', currentAuthUid = 'uid-manager') {
    const context = {
        console: quietConsole,
        setTimeout,
        clearTimeout,
        navigator: {},
        localStorage: { getItem: () => currentStaffId, removeItem() {} },
        window: {
            db: firestore,
            auth: { currentUser: { uid: currentAuthUid } },
            localStorage: { getItem: () => currentStaffId, removeItem() {} }
        },
        db: firestore,
        firebase: {}
    };
    vm.runInNewContext(`${dbSource}\nglobalThis.__DBService = DBService;`, context);
    return context.__DBService;
}

function baseDocuments() {
    return {
        'users/staff-1': {
            id: 'staff-1', username: 'teacher.one', name: 'Teacher One', authUid: 'uid-staff-1'
        },
        'staff_directory/staff-1': {
            id: 'staff-1', username: 'teacher.one', name: 'Teacher One', roles: ['teacher']
        },
        'user_credentials/staff-1': {
            staffId: 'staff-1', password: 'private-password'
        },
        'user_roles/uid-staff-1': {
            userId: 'staff-1', username: 'teacher.one', roles: ['teacher']
        },
        'attendance_logs/2026-08-01_staff-1': {
            userId: 'staff-1', date: '2026-08-01', sessions: []
        }
    };
}

async function verifyTransactionalDeleteAndRestore() {
    const firestore = createFakeFirestore(baseDocuments());
    const service = loadService(firestore);
    const recovery = await service.deleteUser('staff-1', 'uid-staff-1');

    assert.equal(recovery.schemaVersion, 1);
    assert.equal(recovery.userId, 'staff-1');
    assert.equal(recovery.documents.length, 4);
    assert.equal(firestore.documents.has('users/staff-1'), false);
    assert.equal(firestore.documents.has('staff_directory/staff-1'), false);
    assert.equal(firestore.documents.has('user_credentials/staff-1'), false);
    assert.equal(firestore.documents.has('user_roles/uid-staff-1'), false);
    assert.equal(firestore.documents.has('attendance_logs/2026-08-01_staff-1'), true,
        'historical attendance must remain untouched');

    await service.restoreDeletedUser(recovery);
    assert.deepEqual(firestore.documents.get('users/staff-1'), baseDocuments()['users/staff-1']);
    assert.deepEqual(
        firestore.documents.get('user_credentials/staff-1'),
        baseDocuments()['user_credentials/staff-1']
    );
    assert.deepEqual(
        firestore.documents.get('user_roles/uid-staff-1'),
        baseDocuments()['user_roles/uid-staff-1']
    );
}

async function verifyAmbiguousCommitCompensatesBeforeAuth() {
    const firestore = createFakeFirestore(baseDocuments());
    const service = loadService(firestore);
    firestore.failNextTransactionAfterCommit();

    await assert.rejects(service.deleteUser('staff-1', 'uid-staff-1'), /acknowledgement lost/);
    assert.deepEqual(firestore.documents.get('users/staff-1'), baseDocuments()['users/staff-1']);
    assert.deepEqual(
        firestore.documents.get('user_credentials/staff-1'),
        baseDocuments()['user_credentials/staff-1']
    );
    assert.deepEqual(
        firestore.documents.get('user_roles/uid-staff-1'),
        baseDocuments()['user_roles/uid-staff-1']
    );
}

async function verifyIdentitySafetyGuards() {
    const uidMismatchStore = createFakeFirestore(baseDocuments());
    const uidMismatchService = loadService(uidMismatchStore);
    await assert.rejects(
        uidMismatchService.deleteUser('staff-1', 'uid-someone-else'),
        error => error.code === 'staff/auth-uid-mismatch'
    );
    assert.equal(uidMismatchStore.documents.has('users/staff-1'), true);

    const roleMismatchDocuments = baseDocuments();
    roleMismatchDocuments['user_roles/uid-staff-1'] = {
        userId: 'staff-2', username: 'someone.else', roles: ['teacher']
    };
    const roleMismatchStore = createFakeFirestore(roleMismatchDocuments);
    const roleMismatchService = loadService(roleMismatchStore);
    await assert.rejects(
        roleMismatchService.deleteUser('staff-1', 'uid-staff-1'),
        error => error.code === 'staff/role-mapping-mismatch'
    );
    assert.equal(roleMismatchStore.documents.has('users/staff-1'), true);

    const selfStore = createFakeFirestore(baseDocuments());
    const selfService = loadService(selfStore, 'staff-1', 'uid-staff-1');
    await assert.rejects(
        selfService.deleteUser('staff-1', 'uid-staff-1'),
        error => error.code === 'staff/delete-current-actor'
    );
    assert.equal(selfStore.documents.has('users/staff-1'), true);

    const actorMappingStore = createFakeFirestore(baseDocuments());
    const actorMappingService = loadService(actorMappingStore, 'manager-1', 'uid-staff-1');
    await assert.rejects(
        actorMappingService.deleteUser('staff-1'),
        error => error.code === 'staff/delete-current-actor'
    );
    assert.equal(actorMappingStore.documents.has('user_roles/uid-staff-1'), true,
        'a legacy delete without an authUid must still preserve the active manager mapping');

    const actorProfileDocuments = baseDocuments();
    delete actorProfileDocuments['user_roles/uid-staff-1'];
    const actorProfileStore = createFakeFirestore(actorProfileDocuments);
    const actorProfileService = loadService(actorProfileStore, 'manager-1', 'uid-staff-1');
    await assert.rejects(
        actorProfileService.deleteUser('staff-1'),
        error => error.code === 'staff/delete-current-actor'
    );
    assert.equal(actorProfileStore.documents.has('users/staff-1'), true,
        'the profile authUid must protect the active manager even when its role mapping is missing');
}

async function verifyRestoreNeverOverwritesPartialRecreation() {
    const firestore = createFakeFirestore(baseDocuments());
    const service = loadService(firestore);
    const recovery = await service.deleteUser('staff-1', 'uid-staff-1');
    firestore.documents.set('users/staff-1', { id: 'staff-1', name: 'New profile' });

    await assert.rejects(
        service.restoreDeletedUser(recovery),
        error => error.code === 'staff/restore-conflict'
    );
    assert.deepEqual(firestore.documents.get('users/staff-1'), {
        id: 'staff-1', name: 'New profile'
    });
    assert.equal(firestore.documents.has('user_credentials/staff-1'), false,
        'a stale recovery must not partially overwrite a concurrently recreated profile');
}

function verifyPersonnelOrchestration() {
    const flow = personnelSource.slice(
        personnelSource.indexOf('async function deleteStaff'),
        personnelSource.indexOf('// --- Cấu hình lương')
    );
    const firestoreDeleteIndex = flow.indexOf('DBService.deleteUser');
    const authDeleteIndex = flow.indexOf('AuthHelper.deleteUser');
    assert.ok(firestoreDeleteIndex >= 0 && authDeleteIndex > firestoreDeleteIndex,
        'recoverable Firestore deletion must complete before the irreversible Auth deletion');
    assert.match(flow, /typeof AuthHelper === 'undefined'[\s\S]*?hồ sơ chưa bị xóa/,
        'a missing Auth helper must block deletion before Firestore is touched');
    assert.match(flow, /user\.authUid && !user\.username[\s\S]*?tài khoản đăng nhập mồ côi/,
        'an Auth-linked profile without a username must not be deleted client-side');
    assert.match(flow, /deletionRecoverySnapshot[\s\S]*?DBService\.restoreDeletedUser\(deletionRecoverySnapshot\)/,
        'Auth failure must restore the Firestore recovery snapshot');
    assert.match(flow, /deletionRecoverySnapshot = null;[\s\S]*?Đã xóa nhân viên/,
        'the recovery snapshot must be released only after Auth deletion succeeds');
}

(async () => {
    await verifyTransactionalDeleteAndRestore();
    await verifyAmbiguousCommitCompensatesBeforeAuth();
    await verifyIdentitySafetyGuards();
    await verifyRestoreNeverOverwritesPartialRecreation();
    verifyPersonnelOrchestration();
    console.log('personnel-delete-compensation.test.js: all assertions passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
