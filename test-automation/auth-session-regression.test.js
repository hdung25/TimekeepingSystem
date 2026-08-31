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

const managerRoleSync = db.slice(
    db.indexOf('_syncUserRoleMappingAsManager: async'),
    db.indexOf('deleteUser: async')
);
assert.match(managerRoleSync, /collection\('user_roles'\)\.doc\(actor\.uid\)\.get\(\)/,
    'administrative role sync must verify the acting Firebase UID');
assert.doesNotMatch(managerRoleSync, /localStorage\.getItem\('currentRole'\)/,
    'localStorage must never authorize role mapping updates');
const saveUserFlow = db.slice(db.indexOf('saveUser: async'), db.indexOf('deleteUser: async'));
assert.match(saveUserFlow, /_syncUserRoleMappingAsManager\(user, batch\)/,
    'profile, credential and UID role mapping must share one Firestore batch');
assert.doesNotMatch(saveUserFlow, /Could not sync user_roles/,
    'a failed role sync must never be hidden behind a successful profile toast');

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
    verifyUidBoundProfileResolution()
])
    .then(() => console.log('auth-session-regression.test.js: all assertions passed'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
