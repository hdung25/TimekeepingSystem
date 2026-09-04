const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const main = read('js/main.js');
const db = read('js/db-service.js');
const firebaseConfig = read('js/firebase-config.js');
const authGuard = read('js/auth-guard.js');
const authHelper = read('js/auth-helper.js');
const personnel = read('js/personnel.js');
const quietConsole = { log() {}, warn() {}, error() {} };

const handleLogin = main.slice(
    main.indexOf('async function handleLogin'),
    main.indexOf('async function handleLogout')
);
assert.match(handleLogin, /if \(loginInFlight\) return;/, 'login must be single-flight');
assert.match(handleLogin, /const password = document\.getElementById\('password'\)\.value;/,
    'password must be passed to Firebase without trimming');
assert.doesNotMatch(handleLogin, /getElementById\('password'\)\.value\.trim\(/);
assert.match(handleLogin, /e\.submitter \|\| e\.currentTarget\.querySelector\('button\[type="submit"\]'\)/,
    'the submit button must not resolve to the password visibility button');
assert.match(handleLogin, /finally \{[\s\S]*?loginInFlight = false;/);

assert.match(main, /localStorage\.setItem\('currentAuthUid'/);
assert.match(main, /localStorage\.setItem\('currentUserName'/);
assert.match(main, /await DBService\.getAuthenticatedProfile\(firebaseUser, \{[\s\S]*?userId: currentUserId,[\s\S]*?username: currentUser/,
    'startup must re-resolve the cached profile through the Firebase UID');
assert.match(main, /storedAuthUid && storedAuthUid !== firebaseUser\.uid/);
assert.match(main, /async function handleLogout[\s\S]*?await signOutAndClearSession\(\)[\s\S]*?location\.replace\('index\.html'\)/);
assert.match(main, /onclick="return handleLogout\(event, this\);"/);

const startupAuth = main.slice(
    main.indexOf('// Wait for Firebase Auth to restore session'),
    main.indexOf("console.log('Timekeeping System Loaded');")
);
assert.doesNotMatch(startupAuth, /collection\('user_roles'\)[\s\S]*?\.set\(/,
    'client startup must never repair its own role document');

const profileResolver = db.slice(
    db.indexOf('getAuthenticatedProfile: async'),
    db.indexOf('// 4. Authenticate User')
);
const mappingReadIndex = profileResolver.indexOf("collection('user_roles').doc(authUser.uid).get()");
const legacyLookupIndex = profileResolver.indexOf('_findUserProfileCaseCompatible(authUsername)');
assert.ok(mappingReadIndex >= 0 && legacyLookupIndex > mappingReadIndex,
    'UID mapping must be consulted before legacy username lookup');
assert.match(profileResolver, /hintedUserId && hintedUserId !== mappedUserId/);
assert.match(profileResolver, /profileUsername !== normalizedAuthUsername/);
assert.match(profileResolver, /roleMapping\?\.username[\s\S]*?_normalizeAuthUsername\(roleMapping\.username\) !== profileUsername/);
assert.doesNotMatch(profileResolver, /\.set\(/, 'profile resolution must be read-only');

const dbLogin = db.slice(db.indexOf('loginUser: async'), db.indexOf('generateUniqueShortNames'));
assert.match(dbLogin, /signInWithEmailAndPassword\(email, password\)/);
assert.match(dbLogin, /await primaryAuth\.signOut\(\)/);
assert.match(dbLogin, /finally \{[\s\S]*?_clearStoredAuthSession\(\)/);
assert.doesNotMatch(dbLogin, /collection\('user_roles'\)[\s\S]*?\.set\(/,
    'login must not promote profile/local roles into user_roles');

const attendanceCheckIn = db.slice(
    db.indexOf('checkInPersonal: async'),
    db.indexOf('checkOutPersonal: async')
);
assert.match(attendanceCheckIn, /const settingsDoc = await _runAttendanceFirestoreOperation\(\(\) =>/,
    'the settings read must recover from one stale Firestore credential');
assert.match(attendanceCheckIn, /const dateKey = await _runAttendanceFirestoreOperation\(async authUser =>/,
    'the write transaction must recover from one stale Firestore credential');
assert.equal(
    (attendanceCheckIn.match(/_runAttendanceFirestoreOperation\(/g) || []).length,
    2,
    'check-in must keep exactly two bounded recovery boundaries: read then transaction'
);
assert.match(db, /function _isFirestorePermissionDenied\(error\)/);
assert.match(db, /return code\.includes\('permission-denied'\)[\s\S]*?missing or insufficient permissions/);
assert.match(db, /Network\/timeout errors deliberately do not[\s\S]*?enter this branch/,
    'only rejected permission operations are allowed one retry');

const managerRoleSync = db.slice(
    db.indexOf('_syncUserRoleMappingAsManager: async'),
    db.indexOf('deleteUser: async')
);
const profileSaveBoundary = db.slice(
    db.indexOf('_authorizeUserProfileSave: async'),
    db.indexOf('_syncUserRoleMappingAsManager: async')
);
assert.doesNotMatch(managerRoleSync, /localStorage\.getItem\('currentRole'\)/,
    'localStorage must never authorize role mapping updates');
const saveUserFlow = db.slice(db.indexOf('saveUser: async'), db.indexOf('deleteUser: async'));
assert.match(profileSaveBoundary, /getAuthenticatedAuthorizationContext\(true\)/,
    'profile saves must authorize against a server-verified Firebase role mapping');
assert.match(managerRoleSync, /if \(!authorization\.roles\.includes\('admin'\)\) return false;/,
    'only the primary Admin may sync user_roles');
assert.match(saveUserFlow, /_syncUserRoleMappingAsManager\([\s\S]*saveAuthorization\.authorization/,
    'profile, credential and UID role mapping must share one Firestore batch');
assert.match(saveUserFlow, /password && saveAuthorization\.isPrimaryAdmin/,
    'senior profile maintenance must never write compatibility credentials');
assert.match(saveUserFlow, /Object\.entries\(safeProfile\)\.filter[\s\S]*'id', 'username', 'role', 'roles', 'authUid'/,
    'senior profile batches must omit every protected identity/role field even when unchanged');
assert.doesNotMatch(saveUserFlow, /Could not sync user_roles/,
    'a failed role sync must never be hidden behind a successful profile toast');
assert.match(personnel, /key !== 'password'/,
    'non-security personnel actions must strip cached passwords before saveUser');

const normalizeFunction = db.match(/function _normalizeAuthUsername\(value\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(normalizeFunction, 'normalization helper should remain independently testable');
const normalizeContext = {};
vm.runInNewContext(`${normalizeFunction}; result = [
    _normalizeAuthUsername(' Admin '),
    _normalizeAuthUsername('LÊ.VĂN.A'),
    _normalizeAuthUsername(null)
];`, normalizeContext);
assert.deepEqual(Array.from(normalizeContext.result), ['admin', 'lê.văn.a', '']);

assert.match(firebaseConfig, /let firebaseAuthRestorePromise = null;/);
assert.match(firebaseConfig, /if \(firebaseAuthRestorePromise\) return firebaseAuthRestorePromise;/);
assert.match(firebaseConfig, /setTimeout\(\(\) => finish\(authInstance\.currentUser, true\), 15000\)/,
    'auth restore timeout must allow slow mobile networks');
assert.match(authGuard, /function clearMissingSessionAndRedirect[\s\S]*?primaryAuth\.signOut\(\)[\s\S]*?\.finally\(redirect\)/,
    'a protected page with no client session must also terminate Firebase Auth');

assert.doesNotMatch(authHelper, /fallback password|signInWithEmailAndPassword\(email, '123456'\)/i,
    'administrator auth maintenance must never guess a shared default password');
const syncUserHelper = authHelper.slice(authHelper.indexOf('syncUser: async'), authHelper.indexOf('// Delete User'));
assert.doesNotMatch(syncUserHelper, /createUser\(/,
    'a failed identity sync must never create a replacement account');
assert.match(syncUserHelper, /finally \{[\s\S]*?auth\.signOut\(\)/,
    'secondary staff sessions must always be cleared');
assert.match(personnel, /Promise\.all\(\[[\s\S]*?DBService\.getUsers\(\)[\s\S]*?DBService\.getUserCredentialsMap\(\)/,
    'the admin personnel screen must join the isolated compatibility credential store');
assert.match(personnel, /getElementById\('ns-staff-password'\)\.value;/,
    'password edits must preserve intentional leading/trailing spaces');
assert.doesNotMatch(personnel, /getElementById\('ns-staff-password'\)\.value\.trim\(\)/);
const deleteStaffFlow = personnel.slice(
    personnel.indexOf('async function deleteStaff'),
    personnel.indexOf('// --- Cấu hình lương')
);
assert.ok(
    deleteStaffFlow.indexOf('DBService.deleteUser') < deleteStaffFlow.indexOf('AuthHelper.deleteUser'),
    'Firestore deletion must produce a recovery snapshot before the irreversible Auth deletion'
);
assert.match(deleteStaffFlow, /if \(!authDeleted\)[\s\S]*?restoreDeletedUser\(deletionRecoverySnapshot\)/,
    'a failed Auth deletion must compensate the recoverable Firestore deletion');
assert.match(db, /const \{ password: _legacyPassword, \.\.\.profileData \} = profileDoc\.data\(\)/,
    'legacy profile passwords must never escape through the authenticated profile object');
assert.match(db, /const \{ password, \.\.\.safeProfile \} = user;/,
    'staff profiles and compatibility credentials must be persisted separately');
const passwordChangeFlow = main.slice(main.indexOf('window.handleChangePassword'), main.indexOf('// ================= PWA SYSTEM NOTIFICATIONS'));
assert.match(passwordChangeFlow, /authPasswordChanged = true/);
assert.match(passwordChangeFlow, /if \(authPasswordChanged\)[\s\S]*?updatePassword\(currentPassword\)/,
    'a failed credential-store write must compensate the Firebase password change');

async function verifyMemoizedAuthRestore() {
    let authObserver = null;
    let observerCount = 0;
    let unsubscribeCount = 0;
    const authInstance = {
        currentUser: null,
        onAuthStateChanged(observer) {
            observerCount += 1;
            authObserver = observer;
            return () => { unsubscribeCount += 1; };
        }
    };
    const context = {
        console: quietConsole,
        setTimeout,
        clearTimeout,
        firebase: {
            initializeApp() {},
            firestore: () => ({}),
            auth: () => authInstance
        },
        window: {
            location: { hostname: 'localhost' },
            addEventListener() {},
            UIService: { showLoading() {}, hideLoading() {} }
        }
    };
    vm.runInNewContext(firebaseConfig, context);
    const firstWait = context.window.waitAuth();
    const secondWait = context.window.waitAuth();
    assert.strictEqual(firstWait, secondWait, 'parallel auth waits must share the same promise');
    assert.equal(observerCount, 1, 'parallel auth waits must register only one Firebase observer');

    const restoredUser = { uid: 'uid-1', email: 'admin@tuduytre.com' };
    authObserver(restoredUser);
    assert.strictEqual(await firstWait, restoredUser);
    assert.equal(unsubscribeCount, 1);
}

async function verifyAttendancePermissionRecovery() {
    const tokenRefreshes = [];
    const authUser = {
        uid: 'attendance-uid',
        getIdToken: async forceRefresh => {
            tokenRefreshes.push(forceRefresh);
            return forceRefresh ? 'fresh-token' : 'cached-token';
        }
    };
    const auth = { currentUser: authUser };
    const context = {
        console: quietConsole,
        setTimeout,
        clearTimeout,
        window: {
            auth,
            db: {},
            localStorage: { getItem() { return ''; }, removeItem() {} }
        },
        localStorage: { getItem() { return ''; }, removeItem() {} },
        navigator: {},
        firebase: { auth: () => auth },
        db: {}
    };
    vm.runInNewContext(`${db}\nglobalThis.__runAttendanceFirestoreOperation = _runAttendanceFirestoreOperation;`, context);

    let attempts = 0;
    const recovered = await context.__runAttendanceFirestoreOperation(async actor => {
        attempts += 1;
        assert.equal(actor.uid, 'attendance-uid');
        if (attempts === 1) {
            const error = new Error('Missing or insufficient permissions.');
            error.code = 'permission-denied';
            throw error;
        }
        return 'committed-after-token-refresh';
    });
    assert.equal(recovered, 'committed-after-token-refresh');
    assert.equal(attempts, 2, 'a denied Firestore operation retries exactly once');
    assert.deepEqual(tokenRefreshes, [false, true], 'only the retry forces a Firebase token refresh');

    tokenRefreshes.length = 0;
    attempts = 0;
    await assert.rejects(
        context.__runAttendanceFirestoreOperation(async () => {
            attempts += 1;
            const error = new Error('network unavailable');
            error.code = 'unavailable';
            throw error;
        }),
        error => error?.code === 'unavailable'
    );
    assert.equal(attempts, 1, 'network errors never retry a transaction automatically');
    assert.deepEqual(tokenRefreshes, [false], 'network errors never force-refresh the credential');
}

function firestoreDoc(id, data, exists = true) {
    return { id, exists, data: () => data };
}

function authProfileDb({ roleMapping = null, profiles = [] }) {
    return {
        collection(name) {
            if (name === 'user_roles') {
                return {
                    doc: () => ({
                        get: async () => firestoreDoc('uid-1', roleMapping, Boolean(roleMapping))
                    })
                };
            }
            if (name !== 'users') throw new Error(`unexpected collection: ${name}`);
            return {
                doc: id => ({
                    get: async () => {
                        const profile = profiles.find(item => item.id === id);
                        return profile
                            ? firestoreDoc(profile.id, profile.data)
                            : firestoreDoc(id, null, false);
                    }
                }),
                where: (field, operator, value) => ({
                    limit: () => ({
                        get: async () => {
                            assert.equal(field, 'username');
                            assert.equal(operator, '==');
                            const docs = profiles
                                .filter(item => item.data.username === value)
                                .map(item => firestoreDoc(item.id, item.data));
                            return { docs, size: docs.length, empty: docs.length === 0 };
                        }
                    })
                }),
                get: async () => ({
                    docs: profiles.map(item => firestoreDoc(item.id, item.data))
                })
            };
        }
    };
}

function staffProfileSaveDb() {
    const store = new Map();
    const writeLog = [];
    let credentialListReads = 0;
    const keyOf = (collectionName, id) => `${collectionName}/${id}`;
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const seed = (collectionName, id, data) => store.set(keyOf(collectionName, id), clone(data));
    seed('user_roles', 'uid-admin', {
        userId: 'staff-admin', username: 'admin', role: 'admin', roles: ['admin']
    });
    seed('user_roles', 'uid-senior', {
        userId: 'staff-senior', username: 'senior', role: 'senior_assistant', roles: ['senior_assistant']
    });
    seed('user_roles', 'uid-target', {
        userId: 'staff-target', username: 'target', role: 'staff', roles: ['staff']
    });
    seed('users', 'staff-target', {
        id: 'staff-target', name: 'Target Staff', username: 'target',
        role: 'staff', roles: ['staff'], authUid: 'uid-target', scheduleColor: '#059669'
    });
    seed('staff_directory', 'staff-target', {
        id: 'staff-target', name: 'Target Staff', username: 'target',
        role: 'staff', roles: ['staff'], scheduleColor: '#059669'
    });
    seed('user_credentials', 'staff-target', {
        staffId: 'staff-target', password: 'original-password'
    });

    function makeRef(collectionName, id) {
        const key = keyOf(collectionName, id);
        const ref = {
            id,
            path: key,
            async get() {
                const value = store.get(key);
                return {
                    id,
                    ref,
                    exists: value !== undefined,
                    data: () => clone(value)
                };
            },
            async set(data, options) {
                applyWrite({ type: 'set', ref, data, options });
            }
        };
        return ref;
    }

    function applyWrite(write) {
        const key = write.ref.path;
        const previous = store.get(key);
        const next = write.options?.merge
            ? { ...(previous || {}), ...clone(write.data) }
            : clone(write.data);
        store.set(key, next);
        writeLog.push({ path: key, data: clone(write.data), merge: !!write.options?.merge });
    }

    const database = {
        collection(collectionName) {
            return {
                doc: id => makeRef(collectionName, id),
                where(field, operator, value) {
                    return {
                        limit() {
                            return {
                                async get() {
                                    assert.equal(operator, '==');
                                    const docs = [];
                                    for (const [key, data] of store.entries()) {
                                        if (!key.startsWith(`${collectionName}/`) || data?.[field] !== value) continue;
                                        const id = key.slice(collectionName.length + 1);
                                        const ref = makeRef(collectionName, id);
                                        docs.push({ id, ref, exists: true, data: () => clone(data) });
                                    }
                                    return { docs, size: docs.length, empty: docs.length === 0 };
                                }
                            };
                        }
                    };
                },
                async get() {
                    if (collectionName === 'user_credentials') credentialListReads += 1;
                    const docs = [];
                    for (const [key, data] of store.entries()) {
                        if (!key.startsWith(`${collectionName}/`)) continue;
                        const id = key.slice(collectionName.length + 1);
                        docs.push({ id, data: () => clone(data) });
                    }
                    return { forEach: callback => docs.forEach(callback), docs };
                }
            };
        },
        batch() {
            const pending = [];
            return {
                set(ref, data, options) { pending.push({ type: 'set', ref, data, options }); },
                async commit() { pending.forEach(applyWrite); }
            };
        }
    };

    return {
        database,
        store,
        writeLog,
        keyOf,
        credentialListReads: () => credentialListReads
    };
}

async function verifySeniorProfileSaveBoundary() {
    const auth = { currentUser: { uid: 'uid-senior' } };
    const fake = staffProfileSaveDb();
    const context = {
        console: quietConsole,
        setTimeout,
        clearTimeout,
        window: {
            auth,
            db: fake.database,
            localStorage: { removeItem() {}, getItem() { return ''; } }
        },
        localStorage: { removeItem() {}, getItem() { return ''; } },
        navigator: {},
        firebase: {
            auth: () => auth,
            firestore: { FieldValue: { serverTimestamp: () => '__server_timestamp__' } }
        },
        db: fake.database
    };
    vm.runInNewContext(`${db}\nglobalThis.__DBService = DBService;`, context);
    const service = context.__DBService;
    const unchangedSecurity = {
        id: 'staff-target', username: 'target', role: 'staff', roles: ['staff'], authUid: 'uid-target'
    };

    const credentialsBefore = await service.getUserCredentialsMap();
    assert.deepEqual(Object.keys(credentialsBefore), [], 'senior must not list the credential store');
    assert.equal(fake.credentialListReads(), 0, 'senior credential denial must happen before the collection read');

    await service.saveUser({ ...unchangedSecurity, name: 'Senior Updated Name', scheduleColor: '#3B82F6' });
    assert.equal(fake.store.get(fake.keyOf('users', 'staff-target')).name, 'Senior Updated Name');
    assert.equal(fake.store.get(fake.keyOf('staff_directory', 'staff-target')).name, 'Senior Updated Name');
    assert.equal(fake.store.get(fake.keyOf('user_roles', 'uid-target')).role, 'staff');
    assert.equal(fake.store.get(fake.keyOf('user_credentials', 'staff-target')).password, 'original-password');
    assert.equal(fake.writeLog.some(item => item.path === 'user_roles/uid-target'), false,
        'senior profile save must not enqueue a role mapping write');
    assert.equal(fake.writeLog.some(item => item.path === 'user_credentials/staff-target'), false,
        'senior profile save must not enqueue a credential write');

    const forbiddenPayloads = [
        { ...unchangedSecurity, username: 'renamed-target' },
        { ...unchangedSecurity, role: 'admin' },
        { ...unchangedSecurity, roles: ['admin'] },
        { ...unchangedSecurity, authUid: 'uid-senior' },
        { ...unchangedSecurity, password: 'forbidden-password' }
    ];
    for (const payload of forbiddenPayloads) {
        await assert.rejects(service.saveUser(payload), error => error?.code === 'auth/security-field-change');
    }
    await assert.rejects(
        service.saveUser({ id: 'staff-new', name: 'Not Allowed', username: 'new', role: 'staff' }),
        error => error?.code === 'auth/profile-create-forbidden'
    );

    auth.currentUser = { uid: 'uid-admin' };
    const adminCredentials = await service.getUserCredentialsMap();
    assert.equal(adminCredentials['staff-target'].password, 'original-password');
    assert.equal(fake.credentialListReads(), 1, 'primary Admin may list compatibility credentials');
    await service.saveUser({
        ...unchangedSecurity,
        name: 'Admin Updated Name',
        role: 'assistant',
        roles: ['assistant'],
        password: 'admin-rotated-password'
    });
    assert.equal(fake.store.get(fake.keyOf('user_roles', 'uid-target')).role, 'assistant');
    assert.deepEqual(fake.store.get(fake.keyOf('user_roles', 'uid-target')).roles, ['assistant']);
    assert.equal(fake.store.get(fake.keyOf('user_credentials', 'staff-target')).password, 'admin-rotated-password');
}

async function verifyUidBoundProfileResolution() {
    const context = {
        console: quietConsole,
        setTimeout,
        clearTimeout,
        window: { localStorage: { removeItem() {} } },
        localStorage: { removeItem() {} },
        navigator: {},
        firebase: {},
        db: {}
    };
    vm.runInNewContext(`${db}\nglobalThis.__DBService = DBService;`, context);
    const service = context.__DBService;
    const authUser = { uid: 'uid-1', email: 'admin@tuduytre.com' };

    context.window.db = authProfileDb({
        roleMapping: {
            userId: 'profile-admin',
            username: 'ADMIN',
            roles: ['admin']
        },
        profiles: [{
            id: 'profile-admin',
            data: { username: 'Admin', name: 'Quản trị', roles: ['staff'] }
        }]
    });
    const mapped = await service.getAuthenticatedProfile(authUser, {
        userId: 'profile-admin',
        username: 'ADMIN'
    });
    assert.equal(mapped.id, 'profile-admin');
    assert.equal(mapped.roles[0], 'admin', 'UID role mapping must override profile roles');
    assert.equal(mapped.roleMappingVerified, true);
    await assert.rejects(
        service.getAuthenticatedProfile({ uid: 'uid-1', email: 'admin@example.com' }),
        /không có email đăng nhập hợp lệ/,
        'only the synthetic tuduytre.com login namespace may resolve a personnel profile'
    );
    await assert.rejects(
        service.getAuthenticatedProfile(authUser, {
            userId: 'another-profile',
            username: 'admin'
        }),
        /không khớp hồ sơ nhân sự/
    );

    context.window.db = authProfileDb({
        profiles: [{
            id: 'legacy-profile',
            data: { username: 'AdMiN', name: 'Legacy', role: 'staff' }
        }]
    });
    const legacy = await service.getAuthenticatedProfile(authUser, { username: 'ADMIN' });
    assert.equal(legacy.id, 'legacy-profile', 'legacy fallback must be case-compatible');
    assert.equal(legacy.roleMappingVerified, false);

    let receivedEmail = '';
    let receivedPassword = '';
    let signOutCount = 0;
    let clearSessionCount = 0;
    const failingAuth = {
        signInWithEmailAndPassword: async (email, password) => {
            receivedEmail = email;
            receivedPassword = password;
            const error = new Error('firebase rejected');
            error.code = 'auth/wrong-password';
            throw error;
        },
        signOut: async () => { signOutCount += 1; }
    };
    context.firebase.auth = () => failingAuth;
    context.window.auth = failingAuth;
    context.window.clearAuthSessionStorage = () => { clearSessionCount += 1; };
    await assert.rejects(service.loginUser(' Admin ', ' password có khoảng trắng '), /Sai mật khẩu/);
    assert.equal(receivedEmail, 'admin@tuduytre.com');
    assert.equal(receivedPassword, ' password có khoảng trắng ', 'DBService must preserve password whitespace');
    assert.equal(signOutCount, 1, 'failed login must sign out the primary Firebase session');
    assert.equal(clearSessionCount, 1, 'failed login must clear all cached identity values');
}

for (const page of ['nhan-su.html', 'hop-dinh-ky.html', 'mon-hoc.html']) {
    const html = read(page);
    const guardIndex = html.indexOf('js/auth-guard.js');
    const dbIndex = html.indexOf('js/db-service.js');
    assert.ok(guardIndex >= 0 && guardIndex < dbIndex, `${page} must load its admin guard before DBService`);
    assert.match(authGuard, new RegExp(page.replace('.', '\\.')));
}
assert.match(authGuard, /path\.includes\('mon-hoc\.html'\)[\s\S]*?currentRoles\.includes\('admin'\)/,
    'subject management must remain admin-only');

Promise.all([
    verifyMemoizedAuthRestore(),
    verifyAttendancePermissionRecovery(),
    verifyUidBoundProfileResolution(),
    verifySeniorProfileSaveBoundary()
])
    .then(() => console.log('auth-session-regression.test.js: all assertions passed'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
