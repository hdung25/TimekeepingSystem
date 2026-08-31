'use strict';

const assert = require('node:assert/strict');
const {
    PROJECT_ID,
    MAX_ATOMIC_WRITES,
    buildMigrationPlan,
    evaluateMigrationVerification,
    parseArguments,
    validateApplyGuards,
    expectedEmail
} = require('../scripts/migrate-user-credentials.js');

const ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const updated = '2026-08-31T00:00:00.000Z';
const now = '2026-08-31T01:00:00.000Z';

function stringValue(value) {
    return { stringValue: value };
}

function document(collection, id, fields) {
    return {
        name: `${ROOT}/${collection}/${id}`,
        updateTime: updated,
        fields
    };
}

function profile(id, username, password) {
    const fields = {
        username: stringValue(username),
        role: stringValue('staff'),
        roles: { arrayValue: { values: [stringValue('staff')] } }
    };
    if (password !== undefined) fields.password = stringValue(password);
    return document('users', id, fields);
}

function build(input) {
    return buildMigrationPlan({
        profiles: input.profiles || [],
        credentials: input.credentials || [],
        roles: input.roles || [],
        authAccounts: input.authAccounts || [],
        authApiAvailable: input.authApiAvailable !== false,
        pruneStaleRoleMappings: input.pruneStaleRoleMappings === true,
        now
    });
}

// A normal legacy record is copied, stripped and UID-mapped in one three-write commit.
const secretUsername = 'staff-private';
const secretPassword = 'never-print-this-value';
const normal = build({
    profiles: [profile('staff-secret-id', secretUsername, secretPassword)],
    authAccounts: [{ localId: 'firebase-private-uid', email: expectedEmail(secretUsername) }]
});
assert.equal(normal.summary.profilesWithLegacyPassword, 1);
assert.equal(normal.summary.credentialDocumentsToCreate, 1);
assert.equal(normal.summary.profileAuthUidsToBackfill, 1);
assert.equal(normal.summary.roleMappingsToCreate, 1);
assert.equal(normal.summary.writesPlanned, 3);
assert.equal(normal.summary.blockerCount, 0);
const publicSummaryJson = JSON.stringify(normal.summary);
for (const privateValue of [secretUsername, secretPassword, 'staff-secret-id', 'firebase-private-uid']) {
    assert.equal(publicSummaryJson.includes(privateValue), false, 'aggregate summary must not leak PII or credentials');
}
const profileWrite = normal.writes.find(write => write.update.name.includes('/users/'));
assert.ok(profileWrite.updateMask.fieldPaths.includes('password'), 'source password must be deleted by update mask');
assert.equal(Object.hasOwn(profileWrite.update.fields, 'password'), false, 'deleted password must not remain in source fields');
const credentialWrite = normal.writes.find(write => write.update.name.includes('/user_credentials/'));
assert.deepEqual(credentialWrite.update.fields.password, stringValue(secretPassword), 'password bytes must be copied unchanged');
assert.deepEqual(credentialWrite.currentDocument, { exists: false }, 'new credential copy must use an existence precondition');
assert.match(credentialWrite.update.name, /^projects\//, 'Firestore document names must be resource names, not REST URLs');
assert.equal(credentialWrite.update.name.startsWith('https://'), false);

// Re-running against the completed state is a true no-op.
const completedProfile = profile('staff-finished', 'finished', undefined);
completedProfile.fields.authUid = stringValue('uid-finished');
const idempotent = build({
    profiles: [completedProfile],
    credentials: [document('user_credentials', 'staff-finished', {
        staffId: stringValue('staff-finished'),
        password: stringValue('already-isolated')
    })],
    roles: [document('user_roles', 'uid-finished', {
        userId: stringValue('staff-finished'),
        username: stringValue('finished'),
        role: stringValue('staff'),
        roles: { arrayValue: { values: [stringValue('staff')] } }
    })],
    authAccounts: [{ localId: 'uid-finished', email: expectedEmail('finished') }]
});
assert.equal(idempotent.summary.writesPlanned, 0);
assert.equal(idempotent.summary.credentialsAlreadyIsolated, 1);
assert.equal(idempotent.summary.roleMappingsAlreadyValid, 1);
assert.equal(idempotent.summary.blockerCount, 0);

// A differing target password is never overwritten and blocks the whole migration.
const conflicting = build({
    profiles: [profile('staff-conflict', 'conflict', 'source-secret')],
    credentials: [document('user_credentials', 'staff-conflict', {
        staffId: stringValue('staff-conflict'),
        password: stringValue('different-target-secret')
    })],
    authAccounts: [{ localId: 'uid-conflict', email: expectedEmail('conflict') }]
});
assert.ok(conflicting.summary.blockerCodes.some(entry => entry.code === 'CREDENTIAL_PASSWORD_CONFLICT'));
assert.equal(
    conflicting.writes.some(write => write.update.name.includes('/user_credentials/staff-conflict')),
    false,
    'conflicting target must not receive a planned credential write'
);

// A stale role mapping can be pruned only by an explicit plan and only when all
// three production predicates are true.
const staleRoleProfile = profile('staff-current', 'current-user', 'legacy-secret');
const staleRoleDocument = document('user_roles', 'uid-stale-no-auth', {
    userId: stringValue('different-old-profile'),
    username: stringValue('current-user'),
    role: stringValue('assistant'),
    roles: { arrayValue: { values: [stringValue('assistant')] } }
});
const staleRoleBase = {
    profiles: [staleRoleProfile],
    roles: [staleRoleDocument],
    authAccounts: [{ localId: 'uid-current-target', email: expectedEmail('current-user') }]
};
const staleWithoutPrune = build(staleRoleBase);
assert.equal(staleWithoutPrune.summary.staleRoleMappingsEligibleForPrune, 1);
assert.equal(staleWithoutPrune.summary.staleRoleMappingsPlannedForDelete, 0);
assert.ok(staleWithoutPrune.summary.blockerCodes.some(entry =>
    entry.code === 'STALE_ROLE_MAPPING_REQUIRES_EXPLICIT_PRUNE'
));
assert.equal(staleWithoutPrune.writes.some(write => Boolean(write.delete)), false);

const staleWithPrune = build({ ...staleRoleBase, pruneStaleRoleMappings: true });
assert.equal(staleWithPrune.summary.staleRoleMappingsEligibleForPrune, 1);
assert.equal(staleWithPrune.summary.staleRoleMappingsPlannedForDelete, 1);
assert.equal(staleWithPrune.summary.staleRoleMappingsNotEligibleForPrune, 0);
assert.equal(staleWithPrune.summary.blockerCount, 0);
assert.equal(staleWithPrune.summary.writesPlanned, 4, 'delete must share the credential/auth atomic plan');
const staleDelete = staleWithPrune.writes.find(write => Boolean(write.delete));
assert.equal(staleDelete.delete, staleRoleDocument.name);
assert.deepEqual(staleDelete.currentDocument, { updateTime: staleRoleDocument.updateTime });
assert.deepEqual(staleWithPrune.staleRoleDocumentNamesToRemove, [staleRoleDocument.name]);
assert.equal(JSON.stringify(staleWithPrune.summary).includes('uid-stale-no-auth'), false);

const migratedStaleProfile = profile('staff-current', 'current-user', undefined);
migratedStaleProfile.fields.authUid = stringValue('uid-current-target');
const migratedCredential = document('user_credentials', 'staff-current', {
    staffId: stringValue('staff-current'),
    password: stringValue('legacy-secret')
});
const migratedTargetRole = document('user_roles', 'uid-current-target', {
    userId: stringValue('staff-current'),
    username: stringValue('current-user'),
    role: stringValue('staff'),
    roles: { arrayValue: { values: [stringValue('staff')] } }
});
const postVerifyClean = evaluateMigrationVerification(staleWithPrune, {
    profiles: [migratedStaleProfile],
    credentials: [migratedCredential],
    roles: [migratedTargetRole]
});
assert.equal(postVerifyClean.verified, true);
assert.equal(postVerifyClean.failures.staleRoleMappingsStillPresent, 0);
const postVerifyStaleRemains = evaluateMigrationVerification(staleWithPrune, {
    profiles: [migratedStaleProfile],
    credentials: [migratedCredential],
    roles: [migratedTargetRole, staleRoleDocument]
});
assert.equal(postVerifyStaleRemains.verified, false);
assert.equal(postVerifyStaleRemains.failures.staleRoleMappingsStillPresent, 1);

const sameProfileRole = document('user_roles', 'uid-stale-same-profile', {
    userId: stringValue('staff-current'),
    username: stringValue('current-user'),
    role: stringValue('staff'),
    roles: { arrayValue: { values: [stringValue('staff')] } }
});
const sameProfileCannotPrune = build({
    profiles: [staleRoleProfile],
    roles: [sameProfileRole],
    authAccounts: [{ localId: 'uid-current-target', email: expectedEmail('current-user') }],
    pruneStaleRoleMappings: true
});
assert.equal(sameProfileCannotPrune.summary.staleRoleMappingsEligibleForPrune, 0);
assert.equal(sameProfileCannotPrune.summary.staleRoleMappingsNotEligibleForPrune, 1);
assert.ok(sameProfileCannotPrune.summary.blockerCodes.some(entry =>
    entry.code === 'USERNAME_MAPPED_TO_DIFFERENT_UID'
));
assert.equal(sameProfileCannotPrune.writes.some(write => write.delete === sameProfileRole.name), false);

const liveUidRole = document('user_roles', 'uid-live-other-account', {
    userId: stringValue('different-old-profile'),
    username: stringValue('current-user'),
    role: stringValue('staff'),
    roles: { arrayValue: { values: [stringValue('staff')] } }
});
const liveUidCannotPrune = build({
    profiles: [staleRoleProfile],
    roles: [liveUidRole],
    authAccounts: [
        { localId: 'uid-current-target', email: expectedEmail('current-user') },
        { localId: 'uid-live-other-account', email: expectedEmail('another-user') }
    ],
    pruneStaleRoleMappings: true
});
assert.equal(liveUidCannotPrune.summary.staleRoleMappingsEligibleForPrune, 0);
assert.equal(liveUidCannotPrune.summary.staleRoleMappingsNotEligibleForPrune, 1);
assert.equal(liveUidCannotPrune.writes.some(write => write.delete === liveUidRole.name), false);

// Apply requires all explicit production gates and a count from the same audit shape.
const dryArguments = parseArguments([]);
assert.equal(dryArguments.apply, false);
assert.throws(
    () => validateApplyGuards(parseArguments(['--apply']), normal.summary),
    error => error.safeCode === 'PROJECT_CONFIRMATION_REQUIRED'
);
assert.throws(
    () => validateApplyGuards(parseArguments([
        '--apply',
        `--confirm-project=${PROJECT_ID}`,
        '--expect-legacy-passwords=999'
    ]), normal.summary),
    error => error.safeCode === 'SOURCE_COUNT_CHANGED'
);
assert.doesNotThrow(() => validateApplyGuards(parseArguments([
    '--apply',
    `--confirm-project=${PROJECT_ID}`,
    '--expect-legacy-passwords=1'
]), normal.summary));
assert.throws(
    () => validateApplyGuards(parseArguments([
        '--apply',
        `--confirm-project=${PROJECT_ID}`,
        '--expect-legacy-passwords=1'
    ]), staleWithoutPrune.summary),
    error => error.safeCode === 'STALE_ROLE_PRUNE_CONFIRMATION_REQUIRED'
);
assert.throws(
    () => validateApplyGuards(parseArguments([
        '--apply',
        '--prune-stale-role-mappings',
        `--confirm-project=${PROJECT_ID}`,
        '--expect-legacy-passwords=1'
    ]), staleWithPrune.summary),
    error => error.safeCode === 'EXPECTED_STALE_ROLE_COUNT_REQUIRED'
);
assert.throws(
    () => validateApplyGuards(parseArguments([
        '--apply',
        '--prune-stale-role-mappings',
        `--confirm-project=${PROJECT_ID}`,
        '--expect-legacy-passwords=1',
        '--expect-stale-role-mappings=2'
    ]), staleWithPrune.summary),
    error => error.safeCode === 'STALE_ROLE_COUNT_CHANGED'
);
assert.doesNotThrow(() => validateApplyGuards(parseArguments([
    '--apply',
    '--prune-stale-role-mappings',
    `--confirm-project=${PROJECT_ID}`,
    '--expect-legacy-passwords=1',
    '--expect-stale-role-mappings=1'
]), staleWithPrune.summary));
assert.throws(
    () => validateApplyGuards(parseArguments([
        '--apply',
        `--confirm-project=${PROJECT_ID}`,
        '--expect-legacy-passwords=1'
    ]), conflicting.summary),
    error => error.safeCode === 'MIGRATION_BLOCKED'
);

// Identity Toolkit failure is visible and fail-closed, with an explicit credentials-only escape hatch.
const authUnavailable = build({
    profiles: [profile('staff-auth-api', 'auth-api', 'legacy-secret')],
    authApiAvailable: false
});
assert.ok(authUnavailable.summary.blockerCodes.some(entry => entry.code === 'AUTH_API_UNAVAILABLE'));
assert.throws(
    () => validateApplyGuards(parseArguments([
        '--apply',
        `--confirm-project=${PROJECT_ID}`,
        '--expect-legacy-passwords=1'
    ]), authUnavailable.summary),
    error => error.safeCode === 'MIGRATION_BLOCKED'
);
assert.doesNotThrow(() => validateApplyGuards(parseArguments([
    '--apply',
    '--credentials-only',
    `--confirm-project=${PROJECT_ID}`,
    '--expect-legacy-passwords=1'
]), authUnavailable.summary));

// A dataset that cannot fit in one commit is rejected instead of silently batching partial state.
const tooLarge = build({
    profiles: Array.from({ length: Math.floor(MAX_ATOMIC_WRITES / 2) + 1 }, (_, index) =>
        profile(`bulk-${index}`, `bulk-${index}`, `secret-${index}`)
    )
});
assert.equal(tooLarge.summary.atomicCommitFits, false);
assert.ok(tooLarge.summary.blockerCodes.some(entry => entry.code === 'ATOMIC_WRITE_LIMIT_EXCEEDED'));

console.log('credential-migration-safety.test.js: all assertions passed');
