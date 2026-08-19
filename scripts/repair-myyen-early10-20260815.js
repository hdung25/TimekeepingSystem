const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}`;
const DOC_ROOT = `${ROOT}/documents`;
const DOC_NAME_ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const MIGRATION_ID = 'myyen-early10-20260815-v1';
const STAFF_ID = 'nv_1777820162937';
const DATE_KEY = '2026-08-15';
const SESSION_ID = '1786781750885';
const SUBJECT_ID = 't1ajt5FjkjvYAe1lUThH';
const SCHEDULE_START = '15:30';
const REQUEST_ID = `auto_${DATE_KEY}_${STAFF_ID}_${SESSION_ID}`;
const apply = process.argv.includes('--apply');

function accessToken() {
    const gcloud = 'C:\\Users\\Admin\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1';
    return execFileSync('powershell.exe', ['-NoProfile', '-File', gcloud, 'auth', 'print-access-token'], {
        encoding: 'utf8', windowsHide: true
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

async function getDocument(collection, id, optional = false) {
    try {
        return await request(`${DOC_ROOT}/${collection}/${encodeURIComponent(id)}`);
    } catch (error) {
        if (optional && /^404\b/.test(error.message)) return null;
        throw error;
    }
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function field(fields, name) {
    const value = fields?.[name];
    if (!value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    return null;
}

function sessionsOf(document) {
    return document.fields.sessions?.arrayValue?.values || [];
}

function sessionFields(value) {
    return value?.mapValue?.fields || {};
}

function updateWrite(document, fields, fieldPaths) {
    return {
        update: { name: document.name, fields },
        updateMask: { fieldPaths },
        currentDocument: { updateTime: document.updateTime }
    };
}

function createWrite(name, fields) {
    return {
        update: { name, fields },
        currentDocument: { exists: false }
    };
}

function vietnamMinutes(iso) {
    const date = new Date(iso);
    return (date.getUTCHours() + 7) % 24 * 60 + date.getUTCMinutes() +
        date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60000;
}

async function main() {
    accessToken.cached = accessToken();
    const now = new Date().toISOString();
    const [user, attendance, subject, schedule, existingRequest, existingBackup] = await Promise.all([
        getDocument('users', STAFF_ID),
        getDocument('attendance_logs', `${DATE_KEY}_${STAFF_ID}`),
        getDocument('subjects', SUBJECT_ID),
        getDocument('schedules', `cs1__${DATE_KEY}`),
        getDocument('bonus10_requests', REQUEST_ID, true),
        getDocument('migration_backups', MIGRATION_ID, true)
    ]);

    if (field(user.fields, 'name') !== 'Nguyễn Ngọc Mỹ Yến') {
        throw new Error('Safety gate: hồ sơ không còn là Nguyễn Ngọc Mỹ Yến.');
    }
    const currentMode = field(user.fields, 'teachingMode');
    if (currentMode && currentMode !== 'old') {
        throw new Error(`Safety gate: teachingMode hiện là ${currentMode}, không tự ghi đè.`);
    }
    if (field(subject.fields, 'allowEarly10') !== true) {
        throw new Error('Safety gate: PRE-I1 không còn bật allowEarly10.');
    }

    const scheduleRows = Object.values(schedule.fields)
        .flatMap(value => value?.arrayValue?.values || [])
        .map(sessionFields);
    const scheduledClass = scheduleRows.find(fields =>
        field(fields, 'lopId') === SUBJECT_ID && field(fields, 'start') === SCHEDULE_START &&
        field(fields, 'gvId') === STAFF_ID
    );
    if (!scheduledClass) throw new Error('Safety gate: không còn lịch PRE-I1 15:30 của Mỹ Yến.');

    const sessions = clone(sessionsOf(attendance));
    const target = sessions.find(value => String(field(sessionFields(value), 'id')) === SESSION_ID);
    if (!target) throw new Error('Safety gate: không tìm thấy phiên chấm công mục tiêu.');
    const targetFields = sessionFields(target);
    const checkIn = field(targetFields, 'checkIn');
    const checkOut = field(targetFields, 'checkOut');
    if (checkIn !== '2026-08-15T08:15:50.802Z' || checkOut !== '2026-08-15T10:00:00.000Z') {
        throw new Error('Safety gate: giờ vào/ra đã thay đổi, dừng để tránh sửa nhầm.');
    }
    const scheduledStartMinutes = 15 * 60 + 30;
    const earlyMinutesExact = scheduledStartMinutes - vietnamMinutes(checkIn);
    if (earlyMinutesExact < 10) throw new Error('Safety gate: phiên không đủ vào sớm 10 phút.');
    if (existingRequest) throw new Error('Safety gate: request deterministic đã tồn tại; không tạo trùng.');
    if (existingBackup) throw new Error('Safety gate: migration backup đã tồn tại; migration này đã chạy.');

    targetFields.bonus10 = { booleanValue: true };
    targetFields.bonus10RepairId = { stringValue: MIGRATION_ID };
    targetFields.bonus10RepairedAt = { timestampValue: now };

    const backupPayload = JSON.stringify({
        migrationId: MIGRATION_ID,
        createdAt: now,
        user,
        attendance,
        existingRequest
    });
    const localBackup = path.join(os.tmpdir(), `${MIGRATION_ID}-${Date.now()}-backup.json`);

    const writes = [
        createWrite(`${DOC_NAME_ROOT}/migration_backups/${MIGRATION_ID}`, {
            migrationId: { stringValue: MIGRATION_ID },
            createdAt: { timestampValue: now },
            description: { stringValue: 'Classify Mỹ Yến as old-mode teacher and restore valid PRE-I1 early-10 reward for 2026-08-15.' },
            payload: { stringValue: backupPayload }
        }),
        updateWrite(user, {
            teachingMode: { stringValue: 'old' },
            updatedAt: { timestampValue: now }
        }, ['teachingMode', 'updatedAt']),
        updateWrite(attendance, {
            sessions: { arrayValue: { values: sessions } },
            lastUpdated: { timestampValue: now }
        }, ['sessions', 'lastUpdated']),
        createWrite(`${DOC_NAME_ROOT}/bonus10_requests/${REQUEST_ID}`, {
            staffId: { stringValue: STAFF_ID },
            staffName: { stringValue: 'Nguyễn Ngọc Mỹ Yến' },
            dateKey: { stringValue: DATE_KEY },
            sessionId: { stringValue: SESSION_ID },
            status: { stringValue: 'approved' },
            autoApproved: { booleanValue: true },
            earlyMinutes: { integerValue: String(Math.floor(earlyMinutesExact)) },
            checkInAt: { stringValue: '15:15' },
            scheduledStart: { stringValue: SCHEDULE_START },
            createdAt: { timestampValue: now },
            approvedBy: { stringValue: 'Hệ thống khôi phục theo rule HD' },
            approvedAt: { timestampValue: now },
            dataRepairId: { stringValue: MIGRATION_ID }
        })
    ];

    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        migrationId: MIGRATION_ID,
        staffId: STAFF_ID,
        previousTeachingMode: currentMode || 'unset',
        nextTeachingMode: 'old',
        sessionId: SESSION_ID,
        checkIn,
        checkOut,
        earlyMinutesExact,
        paidMinutesAfterRepair: 100,
        requestId: REQUEST_ID
    }, null, 2));

    if (!apply) return;
    fs.writeFileSync(localBackup, JSON.stringify({ user, attendance, existingRequest }, null, 2), { flag: 'wx' });
    await request(`${ROOT}/documents:commit`, {
        method: 'POST',
        body: JSON.stringify({ writes })
    });

    const [verifiedUser, verifiedAttendance, verifiedRequest] = await Promise.all([
        getDocument('users', STAFF_ID),
        getDocument('attendance_logs', `${DATE_KEY}_${STAFF_ID}`),
        getDocument('bonus10_requests', REQUEST_ID)
    ]);
    const verifiedSession = sessionsOf(verifiedAttendance)
        .find(value => String(field(sessionFields(value), 'id')) === SESSION_ID);
    if (field(verifiedUser.fields, 'teachingMode') !== 'old' ||
        field(sessionFields(verifiedSession), 'bonus10') !== true ||
        field(verifiedRequest.fields, 'status') !== 'approved') {
        throw new Error('Verification failed after commit.');
    }

    console.log(JSON.stringify({
        status: 'complete',
        localBackup,
        backupDocument: `migration_backups/${MIGRATION_ID}`,
        teachingMode: 'old',
        sessionBonus10: true,
        requestStatus: 'approved'
    }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
