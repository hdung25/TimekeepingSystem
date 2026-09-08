/*
 * Repair the production records confirmed by the four feedback screenshots.
 *
 * Default: dry-run only
 * Apply:   node scripts/repair-feedback-images-20260908.js --apply
 *
 * The Firestore commit is atomic, uses update-time preconditions, and creates
 * migration_backups/feedback_images_20260908_v1 in the same commit.
 */
const { execFileSync } = require('node:child_process');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const DOCUMENT_ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const ROOT = `https://firestore.googleapis.com/v1/${DOCUMENT_ROOT}`;
const COMMIT_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents:commit`;
const REPAIR_ID = 'feedback_images_20260908_v1';
const MATH_VIETNAMESE_GROUP_ID = 'NiEdYERcvlL3NhoM3S43';
const ENGLISH_GROUP_ID = 'Vd6AsB7360BpIUcdmniY';
const ENGLISH_COMMUNICATION_GROUP_ID = 'RsYy7OAfY7y67CSy83xj';
const ENGLISH_SCHOOL_GROUP_ID = 'EdpwD5SjNCallXbN0naX';
const DAILY_NOTE_DOC_ID = 'nv_1781781019313';
const DAILY_NOTE_DATE = '2026-08-07';
const EXPECTED_BAD_NOTE = 'Vắng đột xuất';

const SUBJECTS_TO_MOVE = new Map([
    ['KGHoBFG8F8tlj91q8mJK', 'Toán 1'],
    ['Y35FesqfXJ7vVBXWxKN6', 'Toán 2'],
    ['mlk3bXftwfR1WRCwcKrx', 'Toán 3'],
    ['s99Udyhs2WG2Ul3gubBU', 'Toán 4'],
    ['bF4FWqxO7EpidNCq1Ffk', 'Toán 5'],
    ['FviVjVtx5SzDQX71WZ8c', 'Toán 6'],
    ['v8CUqBXZhOO8RcM7DVPw', 'Toán 7'],
    ['BkmWjRxgkw2YsV802KnL', 'Toán 8'],
    ['7JvC55qpFRFcHlyfjaCW', 'Toán 9'],
    ['xf65lhahIQP4jQA7DLI2', 'Toán 10'],
    ['UnIwpmcR4soYCN2BHG07', 'Toán 11'],
    ['9QioyU8p1Mw78LBJrlO5', 'TOÁN Dự thính'],
    ['y7An5jiQKwHXdLPXThef', 'TV1'],
    ['zkRrix5ESmeLFnxbf3Om', 'TV2'],
    ['JGoCrJGqpKsbMvYluC6r', 'TV3'],
    ['TSSpHE7jxjeClrDop8Ob', 'TV4'],
    ['OcpRX2P09OyHkqL9C7NU', 'TV5'],
    ['i4gs0WwO7pju5AuoNH6g', 'NV6'],
    ['57I4QnUCHRvHne2LxuPC', 'NV7'],
    ['nevWV0to1p5LFXJSsXNl', 'NV8'],
    ['BoRGglA1f4sKXp8EvXz3', 'NV9'],
    ['8xbja1jyx27LsoTx0LtM', 'Rèn chữ đẹp'],
    ['9j4fK7yR7aByoqFSx5HD', 'TĐ - RC']
]);

const CATALOG_POLICIES = new Map([
    [MATH_VIETNAMESE_GROUP_ID, { name: 'Toán -TV', subjectFamily: 'math_vietnamese', allowEarly10: false }],
    [ENGLISH_GROUP_ID, { name: 'Tiếng anh', subjectFamily: 'english', allowEarly10: true }],
    [ENGLISH_COMMUNICATION_GROUP_ID, { name: 'Tiếng anh giao tiếp', subjectFamily: 'english', allowEarly10: true }],
    [ENGLISH_SCHOOL_GROUP_ID, { name: 'tiếng anh trên trường', subjectFamily: 'english', allowEarly10: true }],
    ['3Uqyjves0fJlFLd1UYr2', { name: 'TTD', subjectFamily: 'math_reasoning', allowEarly10: false }]
]);

function accessToken() {
    const gcloud = 'C:\\Users\\Admin\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1';
    return execFileSync('powershell.exe', ['-NoProfile', '-File', gcloud, 'auth', 'print-access-token'], {
        encoding: 'utf8', windowsHide: true
    }).trim();
}

function decode(value) {
    if (!value || typeof value !== 'object') return value;
    if ('nullValue' in value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('timestampValue' in value) return value.timestampValue;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
    if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
    return null;
}

function decodeFields(fields) {
    return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]));
}

function encode(value) {
    if (value === null) return { nullValue: null };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        return Number.isInteger(value)
            ? { integerValue: String(value) }
            : { doubleValue: value };
    }
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
    if (value && typeof value === 'object') return { mapValue: { fields: encodeFields(value) } };
    throw new Error(`Unsupported Firestore value: ${typeof value}`);
}

function encodeFields(object) {
    return Object.fromEntries(Object.entries(object || {})
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, encode(value)]));
}

async function request(url, token, options = {}, optional = false) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    if (optional && response.status === 404) return null;
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    return text ? JSON.parse(text) : null;
}

async function getDocument(token, collection, id, optional = false) {
    const raw = await request(`${ROOT}/${collection}/${encodeURIComponent(id)}`, token, {}, optional);
    if (!raw) return null;
    return {
        id,
        name: raw.name,
        updateTime: raw.updateTime,
        data: decodeFields(raw.fields || {})
    };
}

function assertExactName(document, expectedName) {
    if (!document) throw new Error(`Missing subject ${expectedName}`);
    if (String(document.data.name || '') !== expectedName) {
        throw new Error(`Subject identity mismatch for ${document.id}: expected "${expectedName}", got "${document.data.name || ''}"`);
    }
}

function partialUpdate(document, values) {
    const fieldPaths = Object.keys(values);
    return {
        update: { name: document.name, fields: encodeFields(values) },
        updateMask: { fieldPaths },
        currentDocument: { updateTime: document.updateTime }
    };
}

async function main() {
    const apply = process.argv.includes('--apply');
    const token = accessToken();
    const subjectIds = [...SUBJECTS_TO_MOVE.keys(), ...CATALOG_POLICIES.keys()];
    const [subjectDocs, noteDoc, existingBackup] = await Promise.all([
        Promise.all(subjectIds.map(id => getDocument(token, 'subjects', id))),
        getDocument(token, 'daily_notes', DAILY_NOTE_DOC_ID),
        getDocument(token, 'migration_backups', REPAIR_ID, true)
    ]);
    if (existingBackup) throw new Error(`Backup ${REPAIR_ID} already exists; refusing to run twice.`);

    const byId = new Map(subjectDocs.map(document => [document.id, document]));
    const changes = [];
    for (const [id, expectedName] of SUBJECTS_TO_MOVE) {
        const document = byId.get(id);
        assertExactName(document, expectedName);
        const desired = {
            parentId: MATH_VIETNAMESE_GROUP_ID,
            subjectFamily: 'math_vietnamese',
            allowEarly10: false
        };
        if (document.data.parentId !== desired.parentId ||
            document.data.subjectFamily !== desired.subjectFamily ||
            document.data.allowEarly10 !== desired.allowEarly10) {
            changes.push({ kind: 'subject', document, desired });
        }
    }
    for (const [id, policy] of CATALOG_POLICIES) {
        const document = byId.get(id);
        assertExactName(document, policy.name);
        if (document.data.subjectFamily !== policy.subjectFamily ||
            document.data.allowEarly10 !== policy.allowEarly10) {
            changes.push({
                kind: document.data.isGroup === true ? 'group' : 'subject-policy', document,
                desired: { subjectFamily: policy.subjectFamily, allowEarly10: policy.allowEarly10 }
            });
        }
    }

    if (!noteDoc) throw new Error(`Missing daily_notes/${DAILY_NOTE_DOC_ID}`);
    const currentNote = noteDoc.data[DAILY_NOTE_DATE];
    if (currentNote !== EXPECTED_BAD_NOTE) {
        throw new Error(`Daily note precondition failed: expected "${EXPECTED_BAD_NOTE}", got ${JSON.stringify(currentNote)}`);
    }

    const summary = {
        repairId: REPAIR_ID,
        project: PROJECT,
        mode: apply ? 'apply' : 'dry-run',
        subjectChanges: changes.map(change => ({
            id: change.document.id,
            name: change.document.data.name,
            before: {
                parentId: change.document.data.parentId || null,
                subjectFamily: change.document.data.subjectFamily || null,
                allowEarly10: change.document.data.allowEarly10 === true
            },
            after: change.desired
        })),
        dailyNote: {
            documentId: DAILY_NOTE_DOC_ID,
            date: DAILY_NOTE_DATE,
            before: currentNote,
            after: null
        }
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!apply) {
        console.log('\nDry-run only. Re-run with --apply after reviewing the exact targets above.');
        return;
    }

    // A Firestore Write expects a resource name, not the REST endpoint URL.
    const backupName = `${DOCUMENT_ROOT}/migration_backups/${REPAIR_ID}`;
    const backupPayload = {
        repairId: REPAIR_ID,
        project: PROJECT,
        reason: 'Correct subject grouping/early10 policy and remove contradicted 2026-08-07 daily note from user feedback images.',
        subjectBefore: Object.fromEntries(changes.map(change => [change.document.id, {
            name: change.document.data.name,
            updateTime: change.document.updateTime,
            parentId: change.document.data.parentId || null,
            subjectFamily: change.document.data.subjectFamily || null,
            allowEarly10: change.document.data.allowEarly10 === true
        }])),
        subjectAfter: Object.fromEntries(changes.map(change => [change.document.id, change.desired])),
        dailyNoteBefore: {
            documentId: DAILY_NOTE_DOC_ID,
            updateTime: noteDoc.updateTime,
            date: DAILY_NOTE_DATE,
            value: currentNote
        }
    };
    const writes = [
        {
            update: { name: backupName, fields: encodeFields(backupPayload) },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }]
        },
        ...changes.map(change => partialUpdate(change.document, change.desired)),
        {
            update: { name: noteDoc.name, fields: {} },
            updateMask: { fieldPaths: [`\`${DAILY_NOTE_DATE}\``] },
            currentDocument: { updateTime: noteDoc.updateTime }
        }
    ];
    await request(COMMIT_URL, token, { method: 'POST', body: JSON.stringify({ writes }) });

    const [verifiedSubjects, verifiedNote, verifiedBackup] = await Promise.all([
        Promise.all(subjectIds.map(id => getDocument(token, 'subjects', id))),
        getDocument(token, 'daily_notes', DAILY_NOTE_DOC_ID),
        getDocument(token, 'migration_backups', REPAIR_ID)
    ]);
    const badSubjects = verifiedSubjects.filter(document => {
        if (SUBJECTS_TO_MOVE.has(document.id)) {
            return document.data.parentId !== MATH_VIETNAMESE_GROUP_ID ||
                document.data.allowEarly10 !== false ||
                document.data.subjectFamily !== 'math_vietnamese';
        }
        const expected = CATALOG_POLICIES.get(document.id);
        return !expected || document.data.allowEarly10 !== expected.allowEarly10 ||
            document.data.subjectFamily !== expected.subjectFamily;
    });
    if (badSubjects.length) throw new Error(`Post-commit subject verification failed: ${badSubjects.map(item => item.id).join(', ')}`);
    if (Object.prototype.hasOwnProperty.call(verifiedNote.data, DAILY_NOTE_DATE)) {
        throw new Error('Post-commit daily-note verification failed.');
    }
    if (!verifiedBackup) throw new Error('Post-commit backup verification failed.');
    console.log(`\nApplied and verified ${changes.length} subject/group updates plus one exact daily-note removal.`);
    console.log(`Backup: migration_backups/${REPAIR_ID}`);
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
