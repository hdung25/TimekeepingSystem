const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}`;
const DOC_ROOT = `${ROOT}/documents`;
const DOC_NAME_ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const USER_ID = 'nv_1786694913002';
const USER_NAME = 'Lê Thuý Hằng';
const DATE = '2026-08-28';
const REPAIR_ID = 'hang-location-failure-20260828-v1';
const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');
const EXPECTED = [
    { branch: 'cs1', start: '18:00', end: '19:30', className: 'NV8', subjectId: 'nevWV0to1p5LFXJSsXNl' },
    { branch: 'cs1', start: '19:30', end: '21:00', className: 'NV6', subjectId: 'i4gs0WwO7pju5AuoNH6g' }
];

if (APPLY && ROLLBACK) throw new Error('Chỉ được chọn một trong --apply hoặc --rollback.');

function token() {
    const gcloud = 'C:\\Users\\Admin\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1';
    return execFileSync('powershell.exe', ['-NoProfile', '-File', gcloud, 'auth', 'print-access-token'], {
        encoding: 'utf8', windowsHide: true
    }).trim();
}

async function request(url, options = {}, optional = false) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token.cached}`,
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
    if ('mapValue' in value) return fields(value.mapValue.fields || {});
    return value;
}

function fields(raw) {
    return Object.fromEntries(Object.entries(raw || {}).map(([key, value]) => [key, decode(value)]));
}

function encode(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return Number.isInteger(value)
        ? { integerValue: String(value) }
        : { doubleValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
    return { mapValue: { fields: encodeFields(value) } };
}

function encodeFields(value) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
}

function assignedTo(row) {
    return row.gvId === USER_ID || row.gvThayTeId === USER_ID || row.gvThayTheId === USER_ID ||
        (row.gvList || []).some(item => item?.id === USER_ID) ||
        (row.gvThayTeList || row.gvThayTheList || []).some(item => item?.id === USER_ID) ||
        (row.registeredTeachers || []).some(item => item?.id === USER_ID);
}

function localISO(time) {
    return new Date(`${DATE}T${time}:00+07:00`).toISOString();
}

function scheduleRows(document, branch) {
    if (!document) return [];
    const data = fields(document.fields);
    return Object.entries(data)
        .filter(([section, rows]) => /^(morning|afternoon|evening)/.test(section) && Array.isArray(rows))
        .flatMap(([section, rows]) => rows.map((row, index) => ({ branch, section, index, ...row })));
}

async function loadState() {
    const [user, attendance, backup, ...scheduleDocs] = await Promise.all([
        getDocument('users', USER_ID),
        getDocument('attendance_logs', `${DATE}_${USER_ID}`, true),
        getDocument('migration_backups', REPAIR_ID, true),
        ...['cs1', 'cs2', 'cs3'].map(branch => getDocument('schedules', `${branch}__${DATE}`, true))
    ]);
    const userData = fields(user.fields);
    if (userData.name !== USER_NAME) throw new Error(`Safety gate: ${USER_ID} hiện là “${userData.name}”.`);
    const rows = scheduleDocs.flatMap((document, index) => scheduleRows(document, ['cs1', 'cs2', 'cs3'][index]));
    for (const expected of EXPECTED) {
        const matches = rows.filter(row => row.branch === expected.branch && row.start === expected.start &&
            row.end === expected.end && row.lop === expected.className &&
            (row.lopId || row.subject) === expected.subjectId && assignedTo(row));
        if (matches.length !== 1) {
            throw new Error(`Safety gate: lịch ${expected.start}–${expected.end} khớp ${matches.length} dòng.`);
        }
    }
    const attendanceData = attendance ? fields(attendance.fields) : null;
    const applied = !!backup && attendanceData?.dataRepairId === REPAIR_ID &&
        attendanceData.sessions?.length === EXPECTED.length &&
        attendanceData.sessions.every(session => session.dataRepairId === REPAIR_ID);
    if (!applied && attendance) throw new Error('Safety gate: ngày 28/08 đã có công khác; dừng để không ghi đè.');
    if (!applied && backup) throw new Error('Safety gate: backup tồn tại nhưng attendance không ở trạng thái repair.');
    return { attendance, backup, applied, rows };
}

function buildAttendance(now) {
    const sessions = EXPECTED.map(expected => {
        const checkIn = localISO(expected.start);
        const checkOut = localISO(expected.end);
        return {
            id: Date.parse(checkIn), start: checkIn, checkIn, checkOut,
            type: 'admin_add', role: expected.subjectId, roleName: expected.className,
            roleRate: 0, isFixedShift: false, linkedClassStart: expected.start,
            branch: expected.branch, className: expected.className, room: null,
            isAdminEdited: true, isAbsent: false,
            roleAssignmentSource: 'repair_from_schedule', subjectOverride: false,
            dataRepairId: REPAIR_ID, createdAt: now,
            editHistory: [{
                at: now, action: 'admin_add', source: 'rule_hd_cli_schedule_repair',
                editor: 'system-repair', before: null,
                after: { checkIn, checkOut, role: expected.subjectId, linkedClassStart: expected.start }
            }]
        };
    });
    return {
        userId: USER_ID, name: USER_NAME, date: DATE, sessions,
        checkIn: sessions[sessions.length - 1].checkIn,
        checkOut: sessions[sessions.length - 1].checkOut,
        dataRepairId: REPAIR_ID
    };
}

async function applyRepair(state) {
    if (state.applied) {
        console.log(JSON.stringify({ mode: 'apply', status: 'already-applied', repairId: REPAIR_ID }, null, 2));
        return;
    }
    const now = new Date().toISOString();
    const attendanceData = buildAttendance(now);
    const attendanceFields = encodeFields(attendanceData);
    attendanceFields.lastUpdated = { timestampValue: now };
    const backupPayload = {
        repairId: REPAIR_ID, createdAt: now, originalAttendance: state.attendance,
        verifiedRows: EXPECTED
    };
    const localBackup = path.join(os.tmpdir(), `${REPAIR_ID}-${Date.now()}-backup.json`);
    fs.writeFileSync(localBackup, JSON.stringify(backupPayload, null, 2), { flag: 'wx' });
    const writes = [
        {
            update: {
                name: `${DOC_NAME_ROOT}/migration_backups/${REPAIR_ID}`,
                fields: {
                    repairId: { stringValue: REPAIR_ID }, status: { stringValue: 'applied' },
                    createdAt: { timestampValue: now },
                    description: { stringValue: 'Restore Hằng scheduled attendance on 2026-08-28 after repeated client location failure; atomic and reversible.' },
                    payload: { stringValue: JSON.stringify(backupPayload) }
                }
            },
            currentDocument: { exists: false }
        },
        {
            update: { name: `${DOC_NAME_ROOT}/attendance_logs/${DATE}_${USER_ID}`, fields: attendanceFields },
            currentDocument: { exists: false }
        }
    ];
    await request(`${ROOT}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
    const verified = await loadState();
    if (!verified.applied) throw new Error('Verification failed after apply.');
    console.log(JSON.stringify({
        mode: 'apply', status: 'complete', repairId: REPAIR_ID, localBackup,
        backupDocument: `migration_backups/${REPAIR_ID}`,
        sessions: EXPECTED.map(item => `${item.start}–${item.end} ${item.className}`)
    }, null, 2));
}

async function rollbackRepair(state) {
    if (!state.applied || !state.attendance || !state.backup) {
        throw new Error('Safety gate rollback: dữ liệu không ở trạng thái repair nguyên vẹn.');
    }
    const rolledBackAt = new Date().toISOString();
    await request(`${ROOT}/documents:commit`, {
        method: 'POST',
        body: JSON.stringify({
            writes: [
                { delete: state.attendance.name, currentDocument: { updateTime: state.attendance.updateTime } },
                {
                    update: {
                        name: state.backup.name,
                        fields: { status: { stringValue: 'rolled-back' }, rolledBackAt: { timestampValue: rolledBackAt } }
                    },
                    updateMask: { fieldPaths: ['status', 'rolledBackAt'] },
                    currentDocument: { updateTime: state.backup.updateTime }
                }
            ]
        })
    });
    console.log(JSON.stringify({ mode: 'rollback', status: 'complete', repairId: REPAIR_ID, rolledBackAt }, null, 2));
}

(async () => {
    token.cached = token();
    const state = await loadState();
    console.log(JSON.stringify({
        mode: ROLLBACK ? 'rollback' : (APPLY ? 'apply' : 'dry-run'),
        project: PROJECT, repairId: REPAIR_ID, alreadyApplied: state.applied,
        preview: EXPECTED
    }, null, 2));
    if (ROLLBACK) return rollbackRepair(state);
    if (APPLY) return applyRepair(state);
})().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
