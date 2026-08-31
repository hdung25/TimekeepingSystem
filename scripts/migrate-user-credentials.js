'use strict';

/**
 * Production credential-isolation migration for timekeeping-69f3f.
 *
 * Safety contract:
 *   - The default mode is read-only. Nothing is written without --apply.
 *   - --apply additionally requires an exact project confirmation and the
 *     legacy-password count printed by a fresh dry run.
 *   - Passwords, access tokens, document ids, usernames and email addresses are
 *     never printed. Only aggregate counters and stable blocker codes leave the
 *     process.
 *   - All writes use source update-time/existence preconditions and must fit in
 *     one Firestore commit. A concurrent edit therefore aborts the whole commit.
 *   - The password copy and deletion happen atomically. The target credential
 *     remains a recovery source and every created/backfilled record is tagged.
 *
 * Dry run:
 *   node scripts/migrate-user-credentials.js
 *
 * Apply only after reviewing a fresh dry run:
 *   node scripts/migrate-user-credentials.js --apply \
 *     --confirm-project=timekeeping-69f3f --expect-legacy-passwords=<COUNT> \
 *     --prune-stale-role-mappings --expect-stale-role-mappings=<COUNT>
 *
 * If the Identity Toolkit Admin API is unavailable, dry run still audits
 * Firestore. Apply remains blocked unless the operator explicitly chooses the
 * credential-only path with --credentials-only.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const PROJECT_ID = 'timekeeping-69f3f';
const DATABASE_ID = '(default)';
const LOGIN_DOMAIN = 'tuduytre.com';
const MIGRATION_ID = 'isolate-user-credentials-20260831-v1';
const FIRESTORE_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}`;
const DOCUMENT_API_ROOT = `${FIRESTORE_ROOT}/documents`;
const DOCUMENT_ROOT = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;
const AUTH_ROOT = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`;
const MAX_ATOMIC_WRITES = 500;

function parseArguments(argv) {
    const values = new Map();
    const flags = new Set();
    argv.forEach(argument => {
        const equalsAt = argument.indexOf('=');
        if (equalsAt > 2) values.set(argument.slice(0, equalsAt), argument.slice(equalsAt + 1));
        else flags.add(argument);
    });
    const expectedRaw = values.get('--expect-legacy-passwords');
    const expectedStaleRaw = values.get('--expect-stale-role-mappings');
    const expectedLegacyPasswords = expectedRaw === undefined ? null : Number(expectedRaw);
    const expectedStaleRoleMappings = expectedStaleRaw === undefined ? null : Number(expectedStaleRaw);
    return {
        apply: flags.has('--apply'),
        credentialsOnly: flags.has('--credentials-only'),
        pruneStaleRoleMappings: flags.has('--prune-stale-role-mappings'),
        confirmProject: values.get('--confirm-project') || '',
        expectedLegacyPasswords,
        expectedStaleRoleMappings
    };
}

function getGcloudInvocation() {
    const configured = String(process.env.GCLOUD_CLI_PATH || '').trim();
    const windowsPowerShellScript = 'C:\\Users\\Admin\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1';
    const candidates = configured
        ? [{ executable: configured, prefix: [] }]
        : [
            { executable: 'gcloud.cmd', prefix: [] },
            { executable: 'gcloud', prefix: [] },
            { executable: 'C:\\Users\\Admin\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd', prefix: [] },
            { executable: 'powershell.exe', prefix: ['-NoProfile', '-File', windowsPowerShellScript], requiredPath: windowsPowerShellScript }
        ];
    for (const candidate of candidates) {
        if (candidate.requiredPath && !fs.existsSync(candidate.requiredPath)) continue;
        if (candidate.executable.includes('\\') && !fs.existsSync(candidate.executable)) continue;
        try {
            execFileSync(candidate.executable, [...candidate.prefix, '--version'], {
                encoding: 'utf8',
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 15000
            });
            return candidate;
        } catch (_) {
            // Try the next known invocation without exposing local account data.
        }
    }
    throw safeError('GCLOUD_UNAVAILABLE', 'Google Cloud CLI is unavailable.');
}

function getAccessToken() {
    const invocation = getGcloudInvocation();
    try {
        const token = execFileSync(invocation.executable, [...invocation.prefix, 'auth', 'print-access-token'], {
            encoding: 'utf8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 30000,
            maxBuffer: 1024 * 1024
        }).trim();
        if (!token) throw new Error('empty token');
        return token;
    } catch (_) {
        throw safeError('GCLOUD_AUTH_UNAVAILABLE', 'Google Cloud access token is unavailable.');
    }
}

function safeError(code, message) {
    const error = new Error(message || code);
    error.safeCode = code;
    return error;
}

async function requestJson(url, accessToken, options = {}) {
    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'x-goog-user-project': PROJECT_ID,
                ...(options.headers || {})
            }
        });
    } catch (_) {
        throw safeError('NETWORK_ERROR', 'A Google API request could not be completed.');
    }

    if (!response.ok) {
        // Do not echo the response body: it can contain resource names or account data.
        throw safeError(`GOOGLE_API_${response.status}`, `Google API returned HTTP ${response.status}.`);
    }
    if (response.status === 204) return null;
    try {
        return await response.json();
    } catch (_) {
        throw safeError('INVALID_API_RESPONSE', 'Google API returned an invalid response.');
    }
}

async function listFirestoreDocuments(collectionId, fieldPaths, accessToken) {
    const documents = [];
    let pageToken = '';
    do {
        const url = new URL(`${DOCUMENT_API_ROOT}/${encodeURIComponent(collectionId)}`);
        url.searchParams.set('pageSize', '1000');
        fieldPaths.forEach(fieldPath => url.searchParams.append('mask.fieldPaths', fieldPath));
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const payload = await requestJson(url.toString(), accessToken);
        documents.push(...(payload.documents || []));
        pageToken = payload.nextPageToken || '';
    } while (pageToken);
    return documents;
}

async function listAuthAccounts(accessToken) {
    const accounts = [];
    let nextPageToken = '';
    do {
        const url = new URL(`${AUTH_ROOT}/accounts:batchGet`);
        url.searchParams.set('maxResults', '1000');
        if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
        const payload = await requestJson(url.toString(), accessToken);
        accounts.push(...(payload.users || []));
        nextPageToken = payload.nextPageToken || '';
    } while (nextPageToken);
    return accounts;
}

function documentId(document) {
    return String(document.name || '').split('/').pop();
}

function hasField(document, fieldName) {
    return Object.prototype.hasOwnProperty.call(document.fields || {}, fieldName);
}

function stringField(document, fieldName) {
    const value = document.fields?.[fieldName];
    return typeof value?.stringValue === 'string' ? value.stringValue : '';
}

function stringArrayField(document, fieldName) {
    const values = document.fields?.[fieldName]?.arrayValue?.values || [];
    return values
        .map(value => typeof value?.stringValue === 'string' ? value.stringValue.trim() : '')
        .filter(Boolean);
}

function stringValue(value) {
    return { stringValue: String(value) };
}

function stringArrayValue(values) {
    return { arrayValue: { values: values.map(stringValue) } };
}

function timestampValue(value) {
    return { timestampValue: value };
}

function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
}

function expectedEmail(username) {
    const normalized = normalizeUsername(username);
    return normalized ? `${normalized}@${LOGIN_DOMAIN}` : '';
}

function valuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function rolesForProfile(profile) {
    const roles = [...new Set(stringArrayField(profile, 'roles'))];
    const role = stringField(profile, 'role').trim();
    if (role && !roles.includes(role)) roles.unshift(role);
    if (!roles.length) roles.push('staff');
    return roles;
}

function updateWrite(document, fields, fieldPaths) {
    return {
        update: { name: document.name, fields },
        updateMask: { fieldPaths: [...new Set(fieldPaths)].sort() },
        currentDocument: { updateTime: document.updateTime }
    };
}

function createWrite(name, fields) {
    return {
        update: { name, fields },
        updateMask: { fieldPaths: Object.keys(fields).sort() },
        currentDocument: { exists: false }
    };
}

function deleteWrite(document) {
    return {
        delete: document.name,
        currentDocument: { updateTime: document.updateTime }
    };
}

function indexMany(items, keySelector) {
    const map = new Map();
    items.forEach(item => {
        const key = keySelector(item);
        if (!key) return;
        const matches = map.get(key) || [];
        matches.push(item);
        map.set(key, matches);
    });
    return map;
}

function buildMigrationPlan({
    profiles,
    credentials,
    roles,
    authAccounts,
    authApiAvailable,
    pruneStaleRoleMappings = false,
    now
}) {
    const profileIds = new Set(profiles.map(documentId));
    const credentialById = new Map(credentials.map(document => [documentId(document), document]));
    const roleByUid = new Map(roles.map(document => [documentId(document), document]));
    const profilesByUsername = indexMany(profiles, profile => normalizeUsername(stringField(profile, 'username')));
    const authByEmail = indexMany(authAccounts, account => String(account.email || '').trim().toLowerCase());
    const authByUid = new Map(authAccounts.map(account => [String(account.localId || ''), account]));
    const rolesByUsername = indexMany(roles, role => normalizeUsername(stringField(role, 'username')));
    const duplicateProfileKeys = new Set([...profilesByUsername].filter(([, values]) => values.length > 1).map(([key]) => key));
    const duplicateAuthKeys = new Set([...authByEmail].filter(([, values]) => values.length > 1).map(([key]) => key));
    const blockerCounts = new Map();
    const warningCounts = new Map();
    const writes = [];
    const verification = [];
    const staleRoleDocumentNamesToRemove = [];
    const plannedStaleRoleDeletes = new Set();

    const addBlocker = code => blockerCounts.set(code, (blockerCounts.get(code) || 0) + 1);
    const addWarning = code => warningCounts.set(code, (warningCounts.get(code) || 0) + 1);

    const counts = {
        profilesTotal: profiles.length,
        profilesWithLegacyPassword: 0,
        profilesWithInvalidPasswordType: 0,
        profilesWithoutUsername: 0,
        credentialsTotal: credentials.length,
        credentialDocumentsToCreate: 0,
        credentialDocumentsToRefresh: 0,
        credentialsAlreadyIsolated: 0,
        orphanCredentialDocuments: credentials.filter(document => !profileIds.has(documentId(document))).length,
        authAccountsTotal: authAccounts.length,
        authAccountsInLoginNamespace: authAccounts.filter(account =>
            String(account.email || '').trim().toLowerCase().endsWith(`@${LOGIN_DOMAIN}`)
        ).length,
        profilesMatchedToAuth: 0,
        profilesWithoutAuthMatch: 0,
        profileAuthUidsToBackfill: 0,
        roleMappingsToCreate: 0,
        roleMappingsToComplete: 0,
        roleMappingsAlreadyValid: 0,
        roleMappingsWithRoleDifference: 0,
        conflictingUsernameRoleDocuments: 0,
        conflictingUsernameRoleUidMissingFromAuth: 0,
        conflictingUsernameRoleSameProfile: 0,
        conflictingUsernameRoleSameRoles: 0,
        staleRoleMappingsEligibleForPrune: 0,
        staleRoleMappingsPlannedForDelete: 0,
        staleRoleMappingsNotEligibleForPrune: 0,
        profilesWithoutLegacyPasswordOrCredential: 0
    };

    profiles.forEach(profile => {
        const id = documentId(profile);
        const username = stringField(profile, 'username');
        const normalizedUsername = normalizeUsername(username);
        const legacyPasswordValue = profile.fields?.password;
        const hasLegacyPassword = hasField(profile, 'password');
        const credential = credentialById.get(id) || null;
        const profileFields = {};
        const profileMask = [];
        const verificationItem = {
            profileId: id,
            originalPasswordValue: null,
            expectedAuthUid: '',
            requireRoleMapping: false
        };

        if (!normalizedUsername) counts.profilesWithoutUsername += 1;

        if (hasLegacyPassword) {
            counts.profilesWithLegacyPassword += 1;
            if (typeof legacyPasswordValue?.stringValue !== 'string') {
                counts.profilesWithInvalidPasswordType += 1;
                addBlocker('INVALID_LEGACY_PASSWORD_TYPE');
            } else {
                const existingPasswordValue = credential?.fields?.password;
                if (existingPasswordValue && !valuesEqual(existingPasswordValue, legacyPasswordValue)) {
                    addBlocker('CREDENTIAL_PASSWORD_CONFLICT');
                } else {
                    const credentialName = credential?.name || `${DOCUMENT_ROOT}/user_credentials/${encodeURIComponent(id)}`;
                    const credentialFields = {
                        staffId: stringValue(id),
                        password: legacyPasswordValue,
                        migrationId: stringValue(MIGRATION_ID),
                        migratedAt: timestampValue(now)
                    };
                    if (credential) {
                        writes.push(updateWrite(credential, credentialFields, Object.keys(credentialFields)));
                        counts.credentialDocumentsToRefresh += 1;
                    } else {
                        writes.push(createWrite(credentialName, credentialFields));
                        counts.credentialDocumentsToCreate += 1;
                    }
                    profileFields.credentialMigrationId = stringValue(MIGRATION_ID);
                    profileFields.credentialMigratedAt = timestampValue(now);
                    profileMask.push('password', 'credentialMigrationId', 'credentialMigratedAt');
                    verificationItem.originalPasswordValue = legacyPasswordValue;
                }
            }
        } else if (credential?.fields?.password) {
            counts.credentialsAlreadyIsolated += 1;
        } else {
            counts.profilesWithoutLegacyPasswordOrCredential += 1;
            addWarning('PROFILE_WITHOUT_MIGRATABLE_CREDENTIAL');
        }

        let matchedAccount = null;
        if (authApiAvailable && normalizedUsername) {
            if (duplicateProfileKeys.has(normalizedUsername)) {
                addBlocker('DUPLICATE_PROFILE_USERNAME');
            } else {
                const email = expectedEmail(normalizedUsername);
                if (duplicateAuthKeys.has(email)) {
                    addBlocker('DUPLICATE_AUTH_EMAIL');
                } else {
                    matchedAccount = (authByEmail.get(email) || [])[0] || null;
                }
            }
        }

        const currentAuthUid = stringField(profile, 'authUid').trim();
        if (matchedAccount) {
            const matchedUid = String(matchedAccount.localId || '').trim();
            counts.profilesMatchedToAuth += 1;
            verificationItem.expectedAuthUid = matchedUid;
            verificationItem.requireRoleMapping = true;
            if (!matchedUid) {
                addBlocker('AUTH_ACCOUNT_WITHOUT_UID');
            } else if (currentAuthUid && currentAuthUid !== matchedUid) {
                addBlocker('PROFILE_AUTH_UID_CONFLICT');
            } else if (!currentAuthUid) {
                profileFields.authUid = stringValue(matchedUid);
                profileFields.authBackfillMigrationId = stringValue(MIGRATION_ID);
                profileFields.authBackfilledAt = timestampValue(now);
                profileMask.push('authUid', 'authBackfillMigrationId', 'authBackfilledAt');
                counts.profileAuthUidsToBackfill += 1;
            }

            if (matchedUid) {
                const roleDocument = roleByUid.get(matchedUid) || null;
                const usernameRoles = rolesByUsername.get(normalizedUsername) || [];
                const conflictingUsernameRoles = usernameRoles.filter(document => documentId(document) !== matchedUid);
                if (conflictingUsernameRoles.length) {
                    conflictingUsernameRoles.forEach(conflictingRole => {
                        const conflictingUid = documentId(conflictingRole);
                        const conflictingUserId = stringField(conflictingRole, 'userId').trim();
                        const uidIsAbsentFromAuth = !authByUid.has(conflictingUid);
                        const isNotCurrentTargetUid = conflictingUid !== matchedUid;
                        const doesNotPointToCurrentProfile = conflictingUserId !== id;
                        counts.conflictingUsernameRoleDocuments += 1;
                        if (uidIsAbsentFromAuth) {
                            counts.conflictingUsernameRoleUidMissingFromAuth += 1;
                        }
                        if (!doesNotPointToCurrentProfile) {
                            counts.conflictingUsernameRoleSameProfile += 1;
                        }
                        if (valuesEqual(
                            [...stringArrayField(conflictingRole, 'roles')].sort(),
                            [...rolesForProfile(profile)].sort()
                        )) {
                            counts.conflictingUsernameRoleSameRoles += 1;
                        }

                        const eligibleForPrune = uidIsAbsentFromAuth
                            && isNotCurrentTargetUid
                            && doesNotPointToCurrentProfile;
                        if (eligibleForPrune) {
                            counts.staleRoleMappingsEligibleForPrune += 1;
                            if (pruneStaleRoleMappings && !plannedStaleRoleDeletes.has(conflictingRole.name)) {
                                writes.push(deleteWrite(conflictingRole));
                                plannedStaleRoleDeletes.add(conflictingRole.name);
                                staleRoleDocumentNamesToRemove.push(conflictingRole.name);
                                counts.staleRoleMappingsPlannedForDelete += 1;
                            } else if (!pruneStaleRoleMappings) {
                                addBlocker('STALE_ROLE_MAPPING_REQUIRES_EXPLICIT_PRUNE');
                            }
                        } else {
                            counts.staleRoleMappingsNotEligibleForPrune += 1;
                            addBlocker('USERNAME_MAPPED_TO_DIFFERENT_UID');
                        }
                    });
                }

                if (!roleDocument) {
                    const profileRoles = rolesForProfile(profile);
                    const primaryRole = profileRoles.includes(stringField(profile, 'role').trim())
                        ? stringField(profile, 'role').trim()
                        : profileRoles[0];
                    const fields = {
                        userId: stringValue(id),
                        username: stringValue(username),
                        role: stringValue(primaryRole),
                        roles: stringArrayValue(profileRoles),
                        createdByAdminMigration: { booleanValue: true },
                        migrationId: stringValue(MIGRATION_ID),
                        updatedAt: timestampValue(now)
                    };
                    writes.push(createWrite(`${DOCUMENT_ROOT}/user_roles/${encodeURIComponent(matchedUid)}`, fields));
                    counts.roleMappingsToCreate += 1;
                } else {
                    const mappedUserId = stringField(roleDocument, 'userId').trim();
                    const mappedUsername = normalizeUsername(stringField(roleDocument, 'username'));
                    if (mappedUserId && mappedUserId !== id) addBlocker('UID_MAPPED_TO_DIFFERENT_PROFILE');
                    if (mappedUsername && mappedUsername !== normalizedUsername) addBlocker('UID_MAPPED_TO_DIFFERENT_USERNAME');

                    const missingFields = {};
                    const missingMask = [];
                    const addedFieldNames = [];
                    if (!mappedUserId) {
                        missingFields.userId = stringValue(id);
                        missingMask.push('userId');
                        addedFieldNames.push('userId');
                    }
                    if (!mappedUsername) {
                        missingFields.username = stringValue(username);
                        missingMask.push('username');
                        addedFieldNames.push('username');
                    }
                    const mappedRoles = stringArrayField(roleDocument, 'roles');
                    const mappedRole = stringField(roleDocument, 'role').trim();
                    if (!mappedRoles.length) {
                        const profileRoles = rolesForProfile(profile);
                        missingFields.roles = stringArrayValue(profileRoles);
                        missingMask.push('roles');
                        addedFieldNames.push('roles');
                        if (!mappedRole) {
                            missingFields.role = stringValue(profileRoles[0]);
                            missingMask.push('role');
                            addedFieldNames.push('role');
                        }
                    } else {
                        const profileRoles = rolesForProfile(profile);
                        if (!valuesEqual([...mappedRoles].sort(), [...profileRoles].sort())) {
                            counts.roleMappingsWithRoleDifference += 1;
                            addWarning('EXISTING_ROLE_MAPPING_DIFFERS_FROM_PROFILE');
                        }
                    }

                    if (missingMask.length) {
                        missingFields.authBackfillMigrationId = stringValue(MIGRATION_ID);
                        missingFields.authBackfillAddedFields = stringArrayValue(addedFieldNames);
                        missingFields.authBackfilledAt = timestampValue(now);
                        missingMask.push('authBackfillMigrationId', 'authBackfillAddedFields', 'authBackfilledAt');
                        writes.push(updateWrite(roleDocument, missingFields, missingMask));
                        counts.roleMappingsToComplete += 1;
                    } else {
                        counts.roleMappingsAlreadyValid += 1;
                    }
                }
            }
        } else if (authApiAvailable) {
            counts.profilesWithoutAuthMatch += 1;
            if (currentAuthUid) {
                const uidAccount = authByUid.get(currentAuthUid);
                if (uidAccount) addBlocker('PROFILE_UID_AUTH_EMAIL_MISMATCH');
                else addWarning('PROFILE_UID_NOT_PRESENT_IN_AUTH');
            } else {
                addWarning('PROFILE_WITHOUT_AUTH_MATCH');
            }
        }

        if (profileMask.length) {
            writes.push(updateWrite(profile, profileFields, profileMask));
        }
        verification.push(verificationItem);
    });

    if (!authApiAvailable) addBlocker('AUTH_API_UNAVAILABLE');
    if (writes.length > MAX_ATOMIC_WRITES) addBlocker('ATOMIC_WRITE_LIMIT_EXCEEDED');

    const blockerCodes = [...blockerCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([code, count]) => ({ code, count }));
    const warningCodes = [...warningCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([code, count]) => ({ code, count }));

    return {
        writes,
        verification,
        staleRoleDocumentNamesToRemove,
        blockerCounts,
        summary: {
            projectId: PROJECT_ID,
            migrationId: MIGRATION_ID,
            authApiAvailable,
            pruneStaleRoleMappingsRequested: Boolean(pruneStaleRoleMappings),
            ...counts,
            duplicateProfileUsernameGroups: duplicateProfileKeys.size,
            duplicateAuthEmailGroups: duplicateAuthKeys.size,
            writesPlanned: writes.length,
            atomicCommitFits: writes.length <= MAX_ATOMIC_WRITES,
            blockerCount: blockerCodes.reduce((sum, entry) => sum + entry.count, 0),
            blockerCodes,
            warningCount: warningCodes.reduce((sum, entry) => sum + entry.count, 0),
            warningCodes
        }
    };
}

function validateApplyGuards(arguments_, summary) {
    if (!arguments_.apply) return;
    if (arguments_.confirmProject !== PROJECT_ID) {
        throw safeError('PROJECT_CONFIRMATION_REQUIRED', `Apply requires --confirm-project=${PROJECT_ID}.`);
    }
    if (!Number.isInteger(arguments_.expectedLegacyPasswords) || arguments_.expectedLegacyPasswords < 0) {
        throw safeError('EXPECTED_COUNT_REQUIRED', 'Apply requires --expect-legacy-passwords=<COUNT> from a fresh dry run.');
    }
    if (arguments_.expectedLegacyPasswords !== summary.profilesWithLegacyPassword) {
        throw safeError('SOURCE_COUNT_CHANGED', 'The legacy credential count changed after dry run.');
    }
    if (arguments_.pruneStaleRoleMappings) {
        if (!Number.isInteger(arguments_.expectedStaleRoleMappings) || arguments_.expectedStaleRoleMappings < 0) {
            throw safeError(
                'EXPECTED_STALE_ROLE_COUNT_REQUIRED',
                'Pruning requires --expect-stale-role-mappings=<COUNT> from a fresh dry run.'
            );
        }
        if (arguments_.expectedStaleRoleMappings !== summary.staleRoleMappingsEligibleForPrune) {
            throw safeError('STALE_ROLE_COUNT_CHANGED', 'The eligible stale role mapping count changed after dry run.');
        }
        if (summary.staleRoleMappingsPlannedForDelete !== summary.staleRoleMappingsEligibleForPrune) {
            throw safeError('STALE_ROLE_PRUNE_PLAN_INCOMPLETE', 'Not every eligible stale role mapping is in the atomic plan.');
        }
    } else if (summary.staleRoleMappingsEligibleForPrune > 0) {
        throw safeError(
            'STALE_ROLE_PRUNE_CONFIRMATION_REQUIRED',
            'Apply requires --prune-stale-role-mappings for the audited stale mappings.'
        );
    }
    const effectiveBlockers = summary.blockerCodes.filter(entry =>
        !(arguments_.credentialsOnly && entry.code === 'AUTH_API_UNAVAILABLE')
    );
    if (effectiveBlockers.length) {
        throw safeError('MIGRATION_BLOCKED', 'Dry-run blockers must be resolved before apply.');
    }
    if (!summary.atomicCommitFits) {
        throw safeError('ATOMIC_WRITE_LIMIT_EXCEEDED', 'The migration does not fit in one atomic commit.');
    }
}

function evaluateMigrationVerification(plan, { profiles, credentials, roles }) {
    const profilesById = new Map(profiles.map(document => [documentId(document), document]));
    const credentialsById = new Map(credentials.map(document => [documentId(document), document]));
    const rolesById = new Map(roles.map(document => [documentId(document), document]));
    const failures = {
        sourcePasswordsRemaining: 0,
        targetPasswordsMissingOrChanged: 0,
        profileAuthUidMismatch: 0,
        roleMappingMissingOrMismatched: 0,
        staleRoleMappingsStillPresent: 0
    };

    plan.verification.forEach(expected => {
        const profile = profilesById.get(expected.profileId);
        if (!profile) {
            failures.sourcePasswordsRemaining += 1;
            return;
        }
        if (expected.originalPasswordValue) {
            if (hasField(profile, 'password')) failures.sourcePasswordsRemaining += 1;
            const credential = credentialsById.get(expected.profileId);
            if (!credential || !valuesEqual(credential.fields?.password, expected.originalPasswordValue)) {
                failures.targetPasswordsMissingOrChanged += 1;
            }
        }
        if (expected.expectedAuthUid && stringField(profile, 'authUid') !== expected.expectedAuthUid) {
            failures.profileAuthUidMismatch += 1;
        }
        if (expected.requireRoleMapping && expected.expectedAuthUid) {
            const role = rolesById.get(expected.expectedAuthUid);
            if (!role || stringField(role, 'userId') !== expected.profileId) {
                failures.roleMappingMissingOrMismatched += 1;
            }
        }
    });
    const remainingRoleNames = new Set(roles.map(document => document.name));
    plan.staleRoleDocumentNamesToRemove.forEach(name => {
        if (remainingRoleNames.has(name)) failures.staleRoleMappingsStillPresent += 1;
    });

    const failureCount = Object.values(failures).reduce((sum, count) => sum + count, 0);
    return { verified: failureCount === 0, failureCount, failures };
}

async function verifyMigration(plan, accessToken) {
    const [profiles, credentials, roles] = await Promise.all([
        listFirestoreDocuments('users', ['password', 'authUid'], accessToken),
        listFirestoreDocuments('user_credentials', ['password', 'staffId'], accessToken),
        listFirestoreDocuments('user_roles', ['userId', 'username'], accessToken)
    ]);
    return evaluateMigrationVerification(plan, { profiles, credentials, roles });
}

async function run(argv = process.argv.slice(2)) {
    const arguments_ = parseArguments(argv);
    const accessToken = getAccessToken();
    const [profiles, credentials, roles] = await Promise.all([
        listFirestoreDocuments('users', ['username', 'password', 'authUid', 'role', 'roles'], accessToken),
        listFirestoreDocuments('user_credentials', ['staffId', 'password', 'authUid', 'migrationId'], accessToken),
        listFirestoreDocuments('user_roles', ['userId', 'username', 'role', 'roles'], accessToken)
    ]);

    let authAccounts = [];
    let authApiAvailable = true;
    try {
        authAccounts = await listAuthAccounts(accessToken);
    } catch (_) {
        authApiAvailable = false;
    }

    const plan = buildMigrationPlan({
        profiles,
        credentials,
        roles,
        authAccounts,
        authApiAvailable,
        pruneStaleRoleMappings: arguments_.pruneStaleRoleMappings,
        now: new Date().toISOString()
    });
    const publicSummary = {
        mode: arguments_.apply ? 'apply' : 'dry-run',
        ...plan.summary,
        applyExecuted: false
    };
    console.log(JSON.stringify(publicSummary, null, 2));

    if (!arguments_.apply) return publicSummary;
    validateApplyGuards(arguments_, plan.summary);

    if (plan.writes.length === 0) {
        const verificationResult = await verifyMigration(plan, accessToken);
        const noOpResult = {
            mode: 'apply',
            projectId: PROJECT_ID,
            migrationId: MIGRATION_ID,
            applyExecuted: false,
            noChangesRequired: true,
            writesCommitted: 0,
            ...verificationResult
        };
        console.log(JSON.stringify(noOpResult, null, 2));
        return noOpResult;
    }

    try {
        await requestJson(`${FIRESTORE_ROOT}/documents:commit`, accessToken, {
            method: 'POST',
            body: JSON.stringify({ writes: plan.writes })
        });
    } catch (error) {
        throw safeError(error.safeCode || 'ATOMIC_COMMIT_FAILED', 'The atomic migration commit failed. No partial batch is accepted.');
    }

    const verificationResult = await verifyMigration(plan, accessToken);
    const result = {
        mode: 'apply',
        projectId: PROJECT_ID,
        migrationId: MIGRATION_ID,
        applyExecuted: true,
        writesCommitted: plan.writes.length,
        ...verificationResult
    };
    console.log(JSON.stringify(result, null, 2));
    if (!verificationResult.verified) {
        throw safeError('POST_COMMIT_VERIFICATION_FAILED', 'Post-commit verification found aggregate failures.');
    }
    return result;
}

if (require.main === module) {
    run().catch(error => {
        console.error(JSON.stringify({
            status: 'error',
            code: error.safeCode || 'UNEXPECTED_ERROR',
            message: error.safeCode ? error.message : 'The migration stopped before completion.'
        }));
        process.exitCode = 1;
    });
}

module.exports = {
    PROJECT_ID,
    MIGRATION_ID,
    MAX_ATOMIC_WRITES,
    parseArguments,
    buildMigrationPlan,
    validateApplyGuards,
    evaluateMigrationVerification,
    verifyMigration,
    normalizeUsername,
    expectedEmail,
    getAccessToken,
    requestJson,
    listFirestoreDocuments,
    documentId
};
