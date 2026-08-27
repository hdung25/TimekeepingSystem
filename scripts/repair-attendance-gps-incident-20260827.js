const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}`;
const DOC_ROOT = `${ROOT}/documents`;
const DOC_NAME_ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const REPAIR_ID = 'attendance-gps-incident-20260824-26-v1';
const apply = process.argv.includes('--apply');
const rollback = process.argv.includes('--rollback');

if (apply && rollback) throw new Error('Chỉ được chọn một trong --apply hoặc --rollback.');

const TARGETS = [
    {
        userId: 'nv_1786694913002',
        name: 'Lê Thuý Hằng',
        date: '2026-08-24',
        sessions: [
            { branch: 'cs1', start: '18:00', end: '19:30', className: 'NV8', subjectId: 'nevWV0to1p5LFXJSsXNl', room: 'P17' },
            { branch: 'cs1', start: '19:30', end: '21:00', className: 'NV9', subjectId: 'BoRGglA1f4sKXp8EvXz3', room: 'P10' }
        ]
    },
    {
        userId: 'nv_1782628080827',
        name: 'Trần Thị Triệu Vy',
        date: '2026-08-26',
        sessions: [
            { branch: 'cs1', start: '10:30', end: '14:30', className: 'BTH', subjectId: 'ZQuEuI65dg9hthIVnzlZ', room: null }
        ]
    }
];

function accessToken() {
    const gcloud = 'C:\\Users\\Admin\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1';
    return execFileSync('powershell.exe', ['-NoProfile', '-File', gcloud, 'auth', 'print-access-token'], {
        encoding: 'utf8', windowsHide: true
    }).trim();
}

async function request(url, options = {}, optional = false) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken.cached}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    if (optional && response.status === 404) return null;
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    return text ? JSON.parse(text) : null;
}

function getDocument(collection, id, optional = false) {
    return request(`${DOC_ROOT}/${collection}/${encodeURIComponent(id)}`, {}, optional);
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
    return value;
}

function decodeFields(fields) {
    return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]));
}

function encode(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
    return { mapValue: { fields: encodeFields(value) } };
}

function encodeFields(object) {
    return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, encode(value)]));
}

function timestampField(iso) {
    return { timestampValue: iso };
}

function assignedTo(row, userId) {
    return row.gvId === userId || row.gvThayTeId === userId || row.gvThayTheId === userId ||
        (row.gvList || []).some(item => item?.id === userId) ||
        (row.gvThayTeList || row.gvThayTheList || []).some(item => item?.id === userId) ||
        (row.registeredTeachers || []).some(item => item?.id === userId);
}

function localISO(date, time) {
    return new Date(`${date}T${time}:00+07:00`).toISOString();
}

function scheduleRows(document, branch) {
    if (!document) return [];
    const schedule = decodeFields(document.fields);
    return Object.entries(schedule)
        .filter(([section, rows]) => /^(morning|afternoon|evening)/.test(section) && Array.isArray(rows))
        .flatMap(([section, rows]) => rows.map((row, index) => ({ section, index, branch, ...row })));
}

function createWrite(name, fields) {
    return { update: { name, fields }, currentDocument: { exists: false } };
}

function updateWrite(document, fields, fieldPaths) {
    return {
        update: { name: document.name, fields },
        updateMask: { fieldPaths },
        currentDocument: { updateTime: document.updateTime }
    };
}

async function loadAndValidate() {
    const rowsByTarget = new Map();
    const loaded = [];
    for (const target of TARGETS) {
        const [user, attendance, existingBackup, ...scheduleDocs] = await Promise.all([
            getDocument('users', target.userId),
            getDocument('attendance_logs', `${target.date}_${target.userId}`, true),
            getDocument('migration_backups', REPAIR_ID, true),
            ...['cs1', 'cs2', 'cs3'].map(branch => getDocument('schedules', `${branch}__${target.date}`, true))
        ]);
        const userData = decodeFields(user.fields);
        if (userData.name !== target.name) {
            throw new Error(`Safety gate: ${target.userId} hiện là “${userData.name}”, không phải “${target.name}”.`);
        }
        const allRows = scheduleDocs.flatMap((document, index) => scheduleRows(document, ['cs1', 'cs2', 'cs3'][index]));
        const matchedRows = target.sessions.map(expected => {
            const matches = allRows.filter(row =>
                row.branch === expected.branch && row.start === expected.start && row.end === expected.end &&
                row.lop === expected.className && row.lopId === expected.subjectId && assignedTo(row, target.userId)
            );
            if (matches.length !== 1) {
                throw new Error(`Safety gate: lịch ${target.name} ${target.date} ${expected.start}–${expected.end} khớp ${matches.length} dòng.`);
            }
            return matches[0];
        });
        if (attendance) {
            const existing = decodeFields(attendance.fields);
            const sessions = existing.sessions || [];
            const alreadyApplied = sessions.length === target.sessions.length &&
                sessions.every(session => session.dataRepairId === REPAIR_ID);
            if (!alreadyApplied) {
                throw new Error(`Safety gate: attendance ${target.date}_${target.userId} vừa có dữ liệu khác; dừng để không ghi đè.`);
            }
        }
        rowsByTarget.set(target.userId, matchedRows);
        loaded.push({ target, user, attendance, existingBackup, matchedRows });
    }
    const backups = loaded.map(item => item.existingBackup).filter(Boolean);
    if (backups.length > 0 && backups.length !== loaded.length) {
        throw new Error('Safety gate: trạng thái backup không đồng nhất giữa các mục tiêu.');
    }
    return { loaded, rowsByTarget, existingBackup: backups[0] || null };
}

function buildAttendance(target, now) {
    const sessions = target.sessions.map(expected => {
        const checkIn = localISO(target.date, expected.start);
        const checkOut = localISO(target.date, expected.end);
        return {
            id: Date.parse(checkIn),
            start: checkIn,
            checkIn,
            checkOut,
            type: 'admin_add',
            role: expected.subjectId,
            roleName: expected.className,
            roleRate: 0,
            isFixedShift: false,
            linkedClassStart: expected.start,
            branch: expected.branch,
            className: expected.className,
            room: expected.room,
            isAdminEdited: true,
            isAbsent: false,
            roleAssignmentSource: 'repair_from_schedule',
            subjectOverride: false,
            dataRepairId: REPAIR_ID,
            createdAt: now,
            editHistory: [{
                at: now,
                action: 'admin_add',
                source: 'rule_hd_cli_schedule_repair',
                editor: 'system-repair',
                before: null,
                after: { checkIn, checkOut, role: expected.subjectId, linkedClassStart: expected.start }
            }]
        };
    });
    const last = sessions[sessions.length - 1];
    return {
        userId: target.userId,
        name: target.name,
        date: target.date,
        sessions,
        checkIn: last.checkIn,
        checkOut: last.checkOut,
        dataRepairId: REPAIR_ID
    };
}

async function applyRepair(state) {
    if (state.existingBackup) {
        console.log(JSON.stringify({ mode: 'apply', status: 'already-applied', repairId: REPAIR_ID }, null, 2));
        return;
    }
    const now = new Date().toISOString();
    const attendancePayloads = TARGETS.map(target => ({ target, data: buildAttendance(target, now) }));
    const backupPayload = {
        repairId: REPAIR_ID,
        createdAt: now,
        originalAttendance: state.loaded.map(item => ({
            documentId: `${item.target.date}_${item.target.userId}`,
            document: item.attendance
        })),
        verifiedSchedules: state.loaded.map(item => ({
            userId: item.target.userId,
            date: item.target.date,
            rows: item.matchedRows
        })),
        createdAttendance: attendancePayloads
    };
    const localBackup = path.join(os.tmpdir(), `${REPAIR_ID}-${Date.now()}-backup.json`);
    fs.writeFileSync(localBackup, JSON.stringify(backupPayload, null, 2), { flag: 'wx' });

    const writes = [
        createWrite(`${DOC_NAME_ROOT}/migration_backups/${REPAIR_ID}`, {
            repairId: { stringValue: REPAIR_ID },
            status: { stringValue: 'applied' },
            createdAt: timestampField(now),
            description: { stringValue: 'Restore full scheduled attendance after client location failures; reversible by guarded rollback.' },
            payload: { stringValue: JSON.stringify(backupPayload) }
        }),
        ...attendancePayloads.map(({ target, data }) => {
            const fields = encodeFields(data);
            fields.lastUpdated = timestampField(now);
            return createWrite(`${DOC_NAME_ROOT}/attendance_logs/${target.date}_${target.userId}`, fields);
        })
    ];
    await request(`${ROOT}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
    const verified = await Promise.all(TARGETS.map(target =>
        getDocument('attendance_logs', `${target.date}_${target.userId}`)
    ));
    verified.forEach((document, index) => {
        const data = decodeFields(document.fields);
        const expected = TARGETS[index];
        if (data.dataRepairId !== REPAIR_ID || data.sessions?.length !== expected.sessions.length ||
            data.sessions.some(session => session.dataRepairId !== REPAIR_ID || !session.linkedClassStart)) {
            throw new Error(`Verification failed: ${expected.name} ${expected.date}.`);
        }
    });
    console.log(JSON.stringify({
        mode: 'apply', status: 'complete', repairId: REPAIR_ID, localBackup,
        backupDocument: `migration_backups/${REPAIR_ID}`,
        attendance: TARGETS.map((target, index) => ({
            staff: target.name, date: target.date,
            sessions: decodeFields(verified[index].fields).sessions.map(session => ({
                checkIn: session.checkIn, checkOut: session.checkOut,
                roleName: session.roleName, linkedClassStart: session.linkedClassStart
            }))
        }))
    }, null, 2));
}

async function rollbackRepair(state) {
    if (!state.existingBackup) throw new Error('Không có backup để rollback.');
    const writes = [];
    for (const item of state.loaded) {
        if (!item.attendance) throw new Error(`Attendance ${item.target.name} đã không còn tồn tại.`);
        const data = decodeFields(item.attendance.fields);
        if (data.dataRepairId !== REPAIR_ID || data.sessions?.length !== item.target.sessions.length ||
            data.sessions.some(session => session.dataRepairId !== REPAIR_ID)) {
            throw new Error(`Safety gate rollback: ${item.target.name} đã có thay đổi sau repair; không xóa.`);
        }
        writes.push({
            delete: item.attendance.name,
            currentDocument: { updateTime: item.attendance.updateTime }
        });
    }
    const rolledBackAt = new Date().toISOString();
    writes.push(updateWrite(state.existingBackup, {
        status: { stringValue: 'rolled-back' },
        rolledBackAt: timestampField(rolledBackAt)
    }, ['status', 'rolledBackAt']));
    await request(`${ROOT}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
    console.log(JSON.stringify({ mode: 'rollback', status: 'complete', repairId: REPAIR_ID, rolledBackAt }, null, 2));
}

async function main() {
    accessToken.cached = accessToken();
    const state = await loadAndValidate();
    const preview = TARGETS.map(target => ({
        staff: target.name,
        userId: target.userId,
        date: target.date,
        attendanceExists: !!state.loaded.find(item => item.target.userId === target.userId).attendance,
        sessions: target.sessions.map(session => ({
            start: session.start, end: session.end, className: session.className,
            subjectId: session.subjectId, branch: session.branch
        }))
    }));
    console.log(JSON.stringify({
        mode: rollback ? 'rollback' : (apply ? 'apply' : 'dry-run'),
        repairId: REPAIR_ID,
        project: PROJECT,
        backupExists: !!state.existingBackup,
        preview
    }, null, 2));
    if (rollback) return rollbackRepair(state);
    if (apply) return applyRepair(state);
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
