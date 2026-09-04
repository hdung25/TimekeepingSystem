'use strict';

/**
 * Sends one audited in-app recovery notice to each staff account affected by
 * the 2026-09-04 attendance-token incident.
 *
 * This does not alter browser location permissions, account roles, attendance,
 * payroll, or schedules. Browser permissions are owned by the device. The
 * notices merely tell the two verified accounts to reopen the newly deployed
 * app, whose check-in flow now refreshes a stale Firebase token safely.
 *
 * Default: read-only audit
 *   node scripts/reset-attendance-access-20260904.js
 * Apply: one guarded, atomic notification commit
 *   node scripts/reset-attendance-access-20260904.js --apply \
 *     --confirm-project=timekeeping-69f3f --expect-targets=2
 */

const {
    PROJECT_ID,
    getAccessToken,
    requestJson
} = require('./migrate-user-credentials.js');

const DATABASE_ID = '(default)';
const FIRESTORE_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}`;
const DOCUMENT_API_ROOT = `${FIRESTORE_ROOT}/documents`;
const DOCUMENT_NAME_ROOT = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;
const RECOVERY_ID = 'attendance-access-reset-20260904-v1';
const DATE_KEY = '2026-09-04';
const TARGETS = Object.freeze([
    Object.freeze({
        staffId: 'nv_1772981307954',
        authUid: 'YEMHcQWm3qed2m2xCTmojJSnfss1',
        username: 'huy04'
    }),
    Object.freeze({
        staffId: 'nv_1776091868801',
        authUid: 'MGyEo5u8VnavTj7trAiD627CLyu2',
        username: 'nhan20'
    })
]);

const NOTICE = Object.freeze({
    title: 'Đã làm mới chấm công',
    details: 'Hệ thống đã cập nhật lại phiên chấm công của em. Em vui lòng đóng/mở lại ứng dụng, rồi bấm Vào ca một lần. Nếu app yêu cầu đăng nhập lại thì em đăng nhập lại giúp chị nhé.',
    color: 'green',
    icon: 'refresh-cw'
});

function safeError(code, message) {
    const error = new Error(message || code);
    error.safeCode = code;
    return error;
}

function parseArguments(argv = process.argv.slice(2)) {
    const values = new Map();
    const flags = new Set();
    argv.forEach(argument => {
        const equalsAt = argument.indexOf('=');
        if (equalsAt > 2) values.set(argument.slice(0, equalsAt), argument.slice(equalsAt + 1));
        else flags.add(argument);
    });
    const unknown = [...flags].filter(flag => flag !== '--apply');
    const knownValues = new Set(['--confirm-project', '--expect-targets']);
    const unknownValues = [...values.keys()].filter(key => !knownValues.has(key));
    if (unknown.length || unknownValues.length) {
        throw safeError('UNSUPPORTED_ARGUMENT', 'Only the documented guarded arguments are accepted.');
    }
    const expectedRaw = values.get('--expect-targets');
    return {
        apply: flags.has('--apply'),
        confirmProject: values.get('--confirm-project') || '',
        expectedTargets: expectedRaw === undefined ? null : Number(expectedRaw)
    };
}

function stringField(document, fieldName) {
    const value = document?.fields?.[fieldName];
    return typeof value?.stringValue === 'string' ? value.stringValue : '';
}

function booleanField(document, fieldName) {
    return document?.fields?.[fieldName]?.booleanValue === true;
}

function notificationIdFor(staffId) {
    return `${RECOVERY_ID}_${staffId}`;
}

function documentName(collectionId, documentId) {
    return `${DOCUMENT_NAME_ROOT}/${collectionId}/${encodeURIComponent(documentId)}`;
}

function stringValue(value) {
    return { stringValue: String(value) };
}

function booleanValue(value) {
    return { booleanValue: value === true };
}

function timestampValue(value) {
    return { timestampValue: value };
}

async function getOptionalDocument(collectionId, documentId, accessToken, transaction = '') {
    const url = new URL(`${DOCUMENT_API_ROOT}/${encodeURIComponent(collectionId)}/${encodeURIComponent(documentId)}`);
    if (transaction) url.searchParams.set('transaction', transaction);
    try {
        return await requestJson(url.toString(), accessToken);
    } catch (error) {
        if (error?.safeCode === 'GOOGLE_API_404') return null;
        throw error;
    }
}

function assertVerifiedTarget(target, profile, roleMapping) {
    if (!profile || !roleMapping) {
        throw safeError('TARGET_ACCOUNT_NOT_FOUND', 'A verified target account is no longer complete.');
    }
    if (stringField(profile, 'authUid') !== target.authUid ||
        stringField(roleMapping, 'userId') !== target.staffId ||
        stringField(roleMapping, 'username').trim().toLowerCase() !== target.username) {
        throw safeError('TARGET_ACCOUNT_MAPPING_MISMATCH', 'A target account mapping changed; no notification was sent.');
    }
    const displayName = stringField(profile, 'name').trim() || stringField(profile, 'displayName').trim();
    if (!displayName) {
        throw safeError('TARGET_ACCOUNT_NAME_MISSING', 'A target account has no display name; no notification was sent.');
    }
    return displayName;
}

function isExpectedNotice(document, target) {
    if (!document) return false;
    return stringField(document, 'staffId') === target.staffId &&
        stringField(document, 'action') === 'announcement' &&
        stringField(document, 'batchId') === RECOVERY_ID &&
        stringField(document, 'title') === NOTICE.title &&
        stringField(document, 'details') === NOTICE.details;
}

function createNoticeWrite(target, displayName, now) {
    return {
        update: {
            name: documentName('admin_notifications', notificationIdFor(target.staffId)),
            fields: {
                staffId: stringValue(target.staffId),
                staffName: stringValue(displayName),
                action: stringValue('announcement'),
                title: stringValue(NOTICE.title),
                details: stringValue(NOTICE.details),
                color: stringValue(NOTICE.color),
                icon: stringValue(NOTICE.icon),
                batchId: stringValue(RECOVERY_ID),
                dateKey: stringValue(DATE_KEY),
                adminName: stringValue('Hệ thống'),
                read: booleanValue(false),
                createdAt: timestampValue(now)
            }
        },
        currentDocument: { exists: false }
    };
}

async function auditTargets(accessToken, transaction = '') {
    const results = await Promise.all(TARGETS.map(async target => {
        const [profile, roleMapping, notification] = await Promise.all([
            getOptionalDocument('users', target.staffId, accessToken, transaction),
            getOptionalDocument('user_roles', target.authUid, accessToken, transaction),
            getOptionalDocument('admin_notifications', notificationIdFor(target.staffId), accessToken, transaction)
        ]);
        const displayName = assertVerifiedTarget(target, profile, roleMapping);
        if (notification && !isExpectedNotice(notification, target)) {
            throw safeError('NOTIFICATION_ID_CONFLICT', 'A recovery notification ID is already occupied by unrelated data.');
        }
        return {
            target,
            displayName,
            notification,
            alreadySent: isExpectedNotice(notification, target)
        };
    }));
    return results;
}

function buildSummary(mode, records, writes = 0) {
    return {
        mode,
        projectId: PROJECT_ID,
        recoveryId: RECOVERY_ID,
        verifiedAccounts: records.length,
        alreadyNotified: records.filter(record => record.alreadySent).length,
        notificationsToCreate: records.filter(record => !record.alreadySent).length,
        writes
    };
}

function validateApplyArguments(args, records) {
    if (args.confirmProject !== PROJECT_ID) {
        throw safeError('PROJECT_CONFIRMATION_REQUIRED', 'Apply requires the exact production project confirmation.');
    }
    if (!Number.isInteger(args.expectedTargets) || args.expectedTargets !== TARGETS.length) {
        throw safeError('TARGET_COUNT_CONFIRMATION_REQUIRED', 'Apply requires the expected verified target count.');
    }
    if (records.length !== TARGETS.length) {
        throw safeError('TARGET_AUDIT_INCOMPLETE', 'The target audit is incomplete.');
    }
}

async function beginTransaction(accessToken) {
    const payload = await requestJson(`${FIRESTORE_ROOT}/documents:beginTransaction`, accessToken, {
        method: 'POST',
        body: JSON.stringify({ options: { readWrite: {} } })
    });
    if (!payload?.transaction) throw safeError('TRANSACTION_UNAVAILABLE', 'Could not open the guarded notification transaction.');
    return payload.transaction;
}

async function rollbackTransaction(accessToken, transaction) {
    if (!transaction) return;
    try {
        await requestJson(`${FIRESTORE_ROOT}/documents:rollback`, accessToken, {
            method: 'POST',
            body: JSON.stringify({ transaction })
        });
    } catch (_) {
        // The original guarded failure remains the useful error. The transaction
        // expires server-side if this best-effort rollback cannot reach Google.
    }
}

async function run(argv = process.argv.slice(2)) {
    const args = parseArguments(argv);
    const accessToken = getAccessToken();
    if (!args.apply) {
        const records = await auditTargets(accessToken);
        const summary = buildSummary('dry-run', records);
        console.log(JSON.stringify(summary, null, 2));
        return summary;
    }

    let transaction = '';
    let committed = false;
    try {
        transaction = await beginTransaction(accessToken);
        const records = await auditTargets(accessToken, transaction);
        validateApplyArguments(args, records);
        const writes = records
            .filter(record => !record.alreadySent)
            .map(record => createNoticeWrite(record.target, record.displayName, new Date().toISOString()));

        if (writes.length) {
            await requestJson(`${FIRESTORE_ROOT}/documents:commit`, accessToken, {
                method: 'POST',
                body: JSON.stringify({ transaction, writes })
            });
            committed = true;
        } else {
            await rollbackTransaction(accessToken, transaction);
            transaction = '';
        }

        const verified = await auditTargets(accessToken);
        if (!verified.every(record => record.alreadySent)) {
            throw safeError('POST_COMMIT_VERIFICATION_FAILED', 'The recovery notices could not be verified after commit.');
        }
        const summary = buildSummary('apply', verified, writes.length);
        console.log(JSON.stringify(summary, null, 2));
        return summary;
    } finally {
        if (transaction && !committed) await rollbackTransaction(accessToken, transaction);
    }
}

if (require.main === module) {
    run().catch(error => {
        console.error(JSON.stringify({
            status: 'error',
            code: error?.safeCode || 'UNEXPECTED_ERROR',
            message: error?.safeCode ? error.message : 'The guarded attendance notification reset stopped.'
        }));
        process.exitCode = 1;
    });
}

module.exports = {
    PROJECT_ID,
    RECOVERY_ID,
    DATE_KEY,
    TARGETS,
    NOTICE,
    parseArguments,
    notificationIdFor,
    isExpectedNotice,
    createNoticeWrite,
    buildSummary,
    validateApplyArguments
};
