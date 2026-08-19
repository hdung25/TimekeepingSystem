const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}`;
const DOC_ROOT = `${ROOT}/documents`;
const MIGRATION_ID = 'senior-assistant-myyen-20260814-v1';
const SENIOR_ID = 'nv_1772981835537';
const MY_YEN_ID = 'nv_1777820162937';
const apply = process.argv.includes('--apply');

const myYenRepairs = {
    '2026-07-27': {
        checkout: '2026-07-27T03:45:00.000Z',
        fix: { '1785117788780': { linkedClassStart: '09:15' } }
    },
    '2026-08-09': {
        checkout: '2026-08-09T11:30:00.000Z',
        fix: { '1786263408541': { linkedClassStart: '15:30' } }
    },
    '2026-08-10': {
        checkout: '2026-08-10T12:30:00.000Z',
        fix: { '1786359243758': { linkedClassStart: '18:00' } }
    },
    '2026-08-11': {
        checkout: '2026-08-11T14:00:00.000Z',
        remove: ['1786445388083'],
        fix: { '1786445437689': { linkedClassStart: '18:00' } }
    },
    '2026-08-13': {
        checkout: '2026-08-13T14:00:00.000Z',
        fix: { '1786618208870': { linkedClassStart: '18:00' } }
    }
};

function accessToken() {
    const gcloud = 'C:\\Users\\Admin\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1';
    return execFileSync('powershell.exe', ['-NoProfile', '-File', gcloud, 'auth', 'print-access-token'], {
        encoding: 'utf8',
        windowsHide: true
    }).trim();
}

async function request(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken.cached}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    return text ? JSON.parse(text) : null;
}

async function getDocument(collection, id) {
    return request(`${DOC_ROOT}/${collection}/${encodeURIComponent(id)}`);
}

async function queryAttendance(userId) {
    const rows = await request(`${DOC_ROOT}:runQuery`, {
        method: 'POST',
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId: 'attendance_logs' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: 'userId' },
                        op: 'EQUAL',
                        value: { stringValue: userId }
                    }
                }
            }
        })
    });
    return rows.filter(row => row.document).map(row => row.document);
}

function docId(document) {
    return document.name.split('/').pop();
}

function sessionsOf(document) {
    return document.fields.sessions?.arrayValue?.values || [];
}

function stringField(fields, name) {
    return fields?.[name]?.stringValue || fields?.[name]?.integerValue || '';
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function updateWrite(document, fields, fieldPaths) {
    return {
        update: { name: document.name, fields },
        updateMask: { fieldPaths },
        currentDocument: { updateTime: document.updateTime }
    };
}

async function main() {
    accessToken.cached = accessToken();
    const now = new Date().toISOString();

    const [seniorUser, seniorAttendance, myYenAttendance] = await Promise.all([
        getDocument('users', SENIOR_ID),
        queryAttendance(SENIOR_ID),
        queryAttendance(MY_YEN_ID)
    ]);

    const unclassifiedSenior = [];
    const seniorWrites = [];
    seniorAttendance.forEach(document => {
        const sessions = clone(sessionsOf(document));
        let changed = false;
        sessions.forEach(value => {
            const fields = value.mapValue?.fields;
            if (!fields || stringField(fields, 'role') || stringField(fields, 'roleName')) return;
            unclassifiedSenior.push({ date: stringField(document.fields, 'date'), sessionId: stringField(fields, 'id') });
            fields.role = { stringValue: 'tiep-tan' };
            fields.roleName = { stringValue: 'Tiếp Tân' };
            fields.roleMigrationId = { stringValue: MIGRATION_ID };
            changed = true;
        });
        if (changed) {
            seniorWrites.push(updateWrite(document, {
                sessions: { arrayValue: { values: sessions } },
                lastUpdated: { timestampValue: now }
            }, ['sessions', 'lastUpdated']));
        }
    });

    const myYenByDate = new Map(myYenAttendance.map(document => [stringField(document.fields, 'date'), document]));
    const myYenWrites = [];
    const myYenChanges = [];
    Object.entries(myYenRepairs).forEach(([date, plan]) => {
        const document = myYenByDate.get(date);
        if (!document) throw new Error(`Missing Mỹ Yến attendance document for ${date}`);

        let sessions = clone(sessionsOf(document));
        const removeIds = new Set(plan.remove || []);
        const originalCount = sessions.length;
        sessions = sessions.filter(value => !removeIds.has(String(stringField(value.mapValue?.fields, 'id'))));
        if (sessions.length !== originalCount - removeIds.size) {
            throw new Error(`Unexpected duplicate-removal count for Mỹ Yến on ${date}`);
        }

        Object.entries(plan.fix).forEach(([sessionId, details]) => {
            const session = sessions.find(value => String(stringField(value.mapValue?.fields, 'id')) === sessionId);
            if (!session) throw new Error(`Missing Mỹ Yến session ${sessionId} on ${date}`);
            const fields = session.mapValue.fields;
            fields.checkOut = { stringValue: plan.checkout };
            fields.linkedClassStart = { stringValue: details.linkedClassStart };
            fields.dataRepairReason = { stringValue: 'historical_schedule_checkout_repair' };
            fields.dataRepairId = { stringValue: MIGRATION_ID };
            fields.dataRepairedAt = { stringValue: now };
            myYenChanges.push({ date, sessionId, checkout: plan.checkout, linkedClassStart: details.linkedClassStart });
        });

        myYenWrites.push(updateWrite(document, {
            sessions: { arrayValue: { values: sessions } },
            checkOut: { stringValue: plan.checkout },
            lastUpdated: { timestampValue: now }
        }, ['sessions', 'checkOut', 'lastUpdated']));
    });

    const currentRoles = seniorUser.fields.roles?.arrayValue?.values || [];
    const hasSeniorRole = currentRoles.some(value => value.stringValue === 'senior_assistant');
    const userWrite = hasSeniorRole ? [] : [updateWrite(seniorUser, {
        roles: { arrayValue: { values: [{ stringValue: 'senior_assistant' }] } },
        updatedAt: { timestampValue: now }
    }, ['roles', 'updatedAt'])];

    const summary = {
        migrationId: MIGRATION_ID,
        mode: apply ? 'apply' : 'dry-run',
        seniorAttendanceDocuments: seniorAttendance.length,
        seniorSessionsClassified: unclassifiedSenior.length,
        seniorDocumentsChanged: seniorWrites.length,
        seniorProfileNormalized: userWrite.length === 1,
        myYenDocumentsChanged: myYenWrites.length,
        myYenSessionsRepaired: myYenChanges.length,
        myYenDuplicateSessionsRemoved: 1
    };
    console.log(JSON.stringify(summary, null, 2));
    console.log('Mỹ Yến repairs:', JSON.stringify(myYenChanges, null, 2));

    if (!apply) return;
    if (unclassifiedSenior.length !== 32) {
        throw new Error(`Safety gate: expected 32 unclassified senior sessions, found ${unclassifiedSenior.length}`);
    }
    if (seniorAttendance.length !== 111 || myYenWrites.length !== 5 || myYenChanges.length !== 5) {
        throw new Error('Safety gate: source document counts differ from the verified dry run');
    }

    const backup = {
        migrationId: MIGRATION_ID,
        createdAt: now,
        seniorProfile: {
            name: seniorUser.name,
            updateTime: seniorUser.updateTime,
            role: seniorUser.fields.role,
            roles: seniorUser.fields.roles || null
        },
        seniorAttendance: seniorAttendance
            .filter(document => seniorWrites.some(write => write.update.name === document.name)),
        myYenAttendance: [...myYenByDate.entries()]
            .filter(([date]) => myYenRepairs[date])
            .map(([, document]) => document)
    };
    const backupJson = JSON.stringify(backup);
    const backupPath = path.join(os.tmpdir(), `${MIGRATION_ID}-backup.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { flag: 'wx' });

    await request(`${DOC_ROOT}/migration_backups/${MIGRATION_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({
            fields: {
                migrationId: { stringValue: MIGRATION_ID },
                createdAt: { timestampValue: now },
                description: { stringValue: 'Normalize historical senior-assistant work as receptionist and repair Mỹ Yến schedule checkouts.' },
                payload: { stringValue: backupJson }
            }
        })
    });

    const writes = [...userWrite, ...seniorWrites, ...myYenWrites];
    await request(`${ROOT}/documents:commit`, {
        method: 'POST',
        body: JSON.stringify({ writes })
    });

    const [verifiedSenior, ...verifiedMyYen] = await Promise.all([
        queryAttendance(SENIOR_ID),
        ...Object.keys(myYenRepairs).map(date => getDocument('attendance_logs', `${date}_${MY_YEN_ID}`))
    ]);
    const remainingUnclassified = verifiedSenior.flatMap(sessionsOf).filter(value => {
        const fields = value.mapValue?.fields;
        return fields && !stringField(fields, 'role') && !stringField(fields, 'roleName');
    });
    if (remainingUnclassified.length !== 0) throw new Error('Verification failed: senior sessions remain unclassified');

    verifiedMyYen.forEach(document => {
        const date = stringField(document.fields, 'date');
        const sessions = sessionsOf(document);
        const invalid = sessions.filter(value => {
            const fields = value.mapValue?.fields;
            const checkIn = new Date(stringField(fields, 'checkIn'));
            const checkOutRaw = stringField(fields, 'checkOut');
            return !checkOutRaw || new Date(checkOutRaw) < checkIn;
        });
        if (invalid.length) throw new Error(`Verification failed: invalid Mỹ Yến session remains on ${date}`);
    });

    console.log(JSON.stringify({
        status: 'complete',
        backupDocument: `migration_backups/${MIGRATION_ID}`,
        localBackup: backupPath,
        writesCommitted: writes.length,
        remainingUnclassifiedSeniorSessions: 0,
        remainingInvalidMyYenSessions: 0
    }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
