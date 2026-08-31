'use strict';

/**
 * Backfill the sanitized roster used by scheduler/reception screens.
 *
 * Default mode is read-only:
 *   node scripts/migrate-staff-directory.js
 *
 * Apply only with counts copied from a fresh dry run:
 *   node scripts/migrate-staff-directory.js --apply \
 *     --confirm-project=timekeeping-69f3f --expect-profiles=<COUNT> --expect-writes=<COUNT>
 *
 * The commit replaces each directory document rather than merging it. This is
 * intentional: a stale password, authUid or salary_config field must be
 * removed, not merely hidden by newer fields. All writes use an existence or
 * update-time precondition and the entire plan must fit one atomic commit.
 */

const {
    PROJECT_ID,
    MAX_ATOMIC_WRITES,
    getAccessToken,
    requestJson,
    listFirestoreDocuments,
    documentId
} = require('./migrate-user-credentials.js');

const DATABASE_ID = '(default)';
const FIRESTORE_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}`;
const DOCUMENT_ROOT = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;
const PUBLIC_FIELDS = [
    'id', 'name', 'displayName', 'username', 'role', 'roles',
    'specialty', 'specialties', 'branch', 'branches', 'department',
    'position', 'title', 'isActive', 'active', 'status', 'scheduleColor'
];

function parseArguments(argv) {
    const values = new Map();
    const flags = new Set();
    argv.forEach(argument => {
        const equalsAt = argument.indexOf('=');
        if (equalsAt > 2) values.set(argument.slice(0, equalsAt), argument.slice(equalsAt + 1));
        else flags.add(argument);
    });
    const numberValue = key => values.has(key) ? Number(values.get(key)) : null;
    return {
        apply: flags.has('--apply'),
        confirmProject: values.get('--confirm-project') || '',
        expectedProfiles: numberValue('--expect-profiles'),
        expectedWrites: numberValue('--expect-writes')
    };
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function valuesEqual(left, right) {
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function sanitizedFields(profile) {
    const source = profile.fields || {};
    const id = documentId(profile);
    const fields = { id: { stringValue: id } };
    PUBLIC_FIELDS.filter(field => field !== 'id').forEach(field => {
        if (Object.prototype.hasOwnProperty.call(source, field)) fields[field] = source[field];
    });
    return fields;
}

function replacementWrite(profile, existing) {
    const id = documentId(profile);
    return {
        update: {
            name: existing?.name || `${DOCUMENT_ROOT}/staff_directory/${encodeURIComponent(id)}`,
            fields: sanitizedFields(profile)
        },
        currentDocument: existing
            ? { updateTime: existing.updateTime }
            : { exists: false }
    };
}

function buildDirectoryPlan({ profiles, directory }) {
    const profileIds = new Set(profiles.map(documentId));
    const directoryById = new Map(directory.map(item => [documentId(item), item]));
    const writes = [];
    let documentsToCreate = 0;
    let documentsToReplace = 0;
    let documentsAlreadySanitized = 0;
    let orphanDocumentsToDelete = 0;
    let documentsWithDisallowedFields = 0;

    profiles.forEach(profile => {
        const existing = directoryById.get(documentId(profile));
        const expected = sanitizedFields(profile);
        if (existing && valuesEqual(existing.fields || {}, expected)) {
            documentsAlreadySanitized += 1;
            return;
        }
        if (existing) {
            documentsToReplace += 1;
            if (Object.keys(existing.fields || {}).some(field => !PUBLIC_FIELDS.includes(field))) {
                documentsWithDisallowedFields += 1;
            }
        } else {
            documentsToCreate += 1;
        }
        writes.push(replacementWrite(profile, existing));
    });

    directory.forEach(existing => {
        if (profileIds.has(documentId(existing))) return;
        orphanDocumentsToDelete += 1;
        writes.push({
            delete: existing.name,
            currentDocument: { updateTime: existing.updateTime }
        });
    });

    const summary = {
        projectId: PROJECT_ID,
        profilesTotal: profiles.length,
        directoryDocumentsTotal: directory.length,
        documentsToCreate,
        documentsToReplace,
        documentsAlreadySanitized,
        orphanDocumentsToDelete,
        documentsWithDisallowedFields,
        writesPlanned: writes.length,
        atomicCommitFits: writes.length <= MAX_ATOMIC_WRITES
    };
    return { writes, summary };
}

function validateApplyGuards(arguments_, summary) {
    if (arguments_.confirmProject !== PROJECT_ID) throw new Error('PROJECT_CONFIRMATION_REQUIRED');
    if (!Number.isInteger(arguments_.expectedProfiles)) throw new Error('EXPECTED_PROFILE_COUNT_REQUIRED');
    if (arguments_.expectedProfiles !== summary.profilesTotal) throw new Error('PROFILE_COUNT_CHANGED');
    if (!Number.isInteger(arguments_.expectedWrites)) throw new Error('EXPECTED_WRITE_COUNT_REQUIRED');
    if (arguments_.expectedWrites !== summary.writesPlanned) throw new Error('DIRECTORY_PLAN_CHANGED');
    if (!summary.atomicCommitFits) throw new Error('ATOMIC_WRITE_LIMIT_EXCEEDED');
}

function verifyDirectory(profiles, directory) {
    const profileById = new Map(profiles.map(item => [documentId(item), item]));
    let missingOrMismatched = 0;
    let orphanDocuments = 0;
    directory.forEach(item => {
        const profile = profileById.get(documentId(item));
        if (!profile) {
            orphanDocuments += 1;
            return;
        }
        if (!valuesEqual(item.fields || {}, sanitizedFields(profile))) missingOrMismatched += 1;
        profileById.delete(documentId(item));
    });
    missingOrMismatched += profileById.size;
    return {
        verified: missingOrMismatched === 0 && orphanDocuments === 0,
        missingOrMismatched,
        orphanDocuments
    };
}

async function run(argv = process.argv.slice(2)) {
    const arguments_ = parseArguments(argv);
    const accessToken = getAccessToken();
    const [profiles, directory] = await Promise.all([
        listFirestoreDocuments('users', PUBLIC_FIELDS, accessToken),
        listFirestoreDocuments('staff_directory', [], accessToken)
    ]);
    const plan = buildDirectoryPlan({ profiles, directory });
    const summary = { mode: arguments_.apply ? 'apply' : 'dry-run', ...plan.summary, applyExecuted: false };
    console.log(JSON.stringify(summary, null, 2));
    if (!arguments_.apply) return summary;
    validateApplyGuards(arguments_, plan.summary);
    if (plan.writes.length) {
        await requestJson(`${FIRESTORE_ROOT}/documents:commit`, accessToken, {
            method: 'POST',
            body: JSON.stringify({ writes: plan.writes })
        });
    }
    const [verifiedProfiles, verifiedDirectory] = await Promise.all([
        listFirestoreDocuments('users', PUBLIC_FIELDS, accessToken),
        listFirestoreDocuments('staff_directory', [], accessToken)
    ]);
    const verification = verifyDirectory(verifiedProfiles, verifiedDirectory);
    const result = {
        mode: 'apply', projectId: PROJECT_ID, applyExecuted: plan.writes.length > 0,
        writesCommitted: plan.writes.length, ...verification
    };
    console.log(JSON.stringify(result, null, 2));
    if (!verification.verified) throw new Error('POST_COMMIT_VERIFICATION_FAILED');
    return result;
}

if (require.main === module) {
    run().catch(error => {
        console.error(JSON.stringify({ status: 'error', code: error.message || 'UNEXPECTED_ERROR' }));
        process.exitCode = 1;
    });
}

module.exports = {
    PUBLIC_FIELDS,
    parseArguments,
    sanitizedFields,
    buildDirectoryPlan,
    validateApplyGuards,
    verifyDirectory
};
