const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}`;
const DOC_ROOT = `${ROOT}/documents`;
const DOC_NAME_ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const USER_ID = 'nv_1782628080827';
const USER_NAME = 'Trần Thị Triệu Vy';
const SUBJECT_ID = 'ZQuEuI65dg9hthIVnzlZ';
const REPAIR_ID = 'trieu-vy-bth-20260822-27-v1';
const DATE_22 = '2026-08-22';
const DATE_27 = '2026-08-27';
const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');

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

function encodeFields(value) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
}

function localISO(date, time) {
    return new Date(`${date}T${time}:00+07:00`).toISOString();
}

function assignedTo(row) {
    return row.gvId === USER_ID || row.gvThayTeId === USER_ID || row.gvThayTheId === USER_ID ||
        (row.gvList || []).some(item => item?.id === USER_ID) ||
        (row.gvThayTeList || row.gvThayTheList || []).some(item => item?.id === USER_ID) ||
        (row.registeredTeachers || []).some(item => item?.id === USER_ID);
}

function scheduleRows(document, branch = 'cs1') {
    if (!document) return [];
    const data = decodeFields(document.fields);
    return Object.entries(data)
        .filter(([section, rows]) => /^(morning|afternoon|evening)/.test(section) && Array.isArray(rows))
        .flatMap(([section, rows]) => rows.map((row, index) => ({ branch, section, index, ...row })));
}

function exactTargetRow(document, date, start, end) {
    const matches = scheduleRows(document).filter(row =>
        row.start === start && row.end === end && row.lop === 'BTH' &&
        (row.lopId || row.subject) === SUBJECT_ID && assignedTo(row)
    );
    if (matches.length !== 1) {
        throw new Error(`Safety gate: lịch ${date} ${start}–${end} của ${USER_NAME} khớp ${matches.length} dòng.`);
    }
    return matches[0];
}

function updateWrite(document, fields, fieldPaths) {
    return {
        update: { name: document.name, fields },
        updateMask: { fieldPaths },
        currentDocument: { updateTime: document.updateTime }
    };
}

function createWrite(name, fields) {
    return { update: { name, fields }, currentDocument: { exists: false } };
}

function buildSession(date, now) {
    const checkIn = localISO(date, '10:30');
    const checkOut = localISO(date, '14:30');
    return {
        id: Date.parse(checkIn),
        start: checkIn,
        checkIn,
        checkOut,
        type: 'admin_add',
        role: SUBJECT_ID,
        roleName: 'BTH',
        roleRate: 0,
        isFixedShift: false,
        linkedClassStart: '10:30',
        branch: 'cs1',
        className: 'BTH',
        room: null,
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
            after: { checkIn, checkOut, role: SUBJECT_ID, linkedClassStart: '10:30' }
        }]
    };
}

function isAppliedAttendance(document, date) {
    if (!document) return false;
    const data = decodeFields(document.fields);
    const sessions = data.sessions || [];
    return data.dataRepairId === REPAIR_ID && sessions.length === 1 &&
        sessions[0].dataRepairId === REPAIR_ID &&
        sessions[0].checkIn === localISO(date, '10:30') &&
        sessions[0].checkOut === localISO(date, '14:30') &&
        sessions[0].linkedClassStart === '10:30' &&
        sessions[0].role === SUBJECT_ID;
}

async function loadState() {
    const [user, schedule22, schedule27, attendance22, attendance27, backup] = await Promise.all([
        getDocument('users', USER_ID),
        getDocument('schedules', `cs1__${DATE_22}`),
        getDocument('schedules', `cs1__${DATE_27}`),
        getDocument('attendance_logs', `${DATE_22}_${USER_ID}`),
        getDocument('attendance_logs', `${DATE_27}_${USER_ID}`, true),
        getDocument('migration_backups', REPAIR_ID, true)
    ]);
    const userData = decodeFields(user.fields);
    if (userData.name !== USER_NAME) {
        throw new Error(`Safety gate: ${USER_ID} hiện là “${userData.name}”, không phải “${USER_NAME}”.`);
    }
    const schedule22Data = decodeFields(schedule22.fields);
    const appliedRow22 = scheduleRows(schedule22).filter(row =>
        row.start === '10:30' && row.end === '14:30' && row.lop === 'BTH' &&
        row.dataRepairId === REPAIR_ID && assignedTo(row)
    );
    const applied = !!backup && appliedRow22.length === 1 &&
        isAppliedAttendance(attendance22, DATE_22) && isAppliedAttendance(attendance27, DATE_27);
    if (!applied) {
        const row22 = exactTargetRow(schedule22, DATE_22, '09:15', '10:45');
        if (row22.section !== 'morning2' || row22.index !== 11) {
            throw new Error(`Safety gate: dòng lịch 22/08 đã dịch chuyển sang ${row22.section}[${row22.index}].`);
        }
        const attendance22Data = decodeFields(attendance22.fields);
        const sessions22 = attendance22Data.sessions || [];
        if (sessions22.length !== 1 ||
            sessions22[0].checkIn !== localISO(DATE_22, '10:30') ||
            sessions22[0].checkOut !== localISO(DATE_22, '14:30') ||
            sessions22[0].linkedClassStart !== '09:15' || sessions22[0].role !== SUBJECT_ID) {
            throw new Error('Safety gate: công 22/08 không còn đúng trạng thái lỗi đã xác định; dừng để tránh ghi đè.');
        }
        if (attendance27) {
            throw new Error('Safety gate: ngày 27/08 đã có công; dừng để không ghi đè dữ liệu mới.');
        }
        exactTargetRow(schedule27, DATE_27, '10:30', '14:30');
        if (backup) throw new Error('Safety gate: backup tồn tại nhưng dữ liệu không ở trạng thái đã áp dụng hoàn chỉnh.');
    }
    return { user, schedule22, schedule27, attendance22, attendance27, backup, applied, schedule22Data };
}

async function applyRepair(state) {
    if (state.applied) {
        console.log(JSON.stringify({ mode: 'apply', status: 'already-applied', repairId: REPAIR_ID }, null, 2));
        return;
    }
    const now = new Date().toISOString();
    const backupPayload = {
        repairId: REPAIR_ID,
        createdAt: now,
        schedule22: state.schedule22,
        attendance22: state.attendance22,
        attendance27: state.attendance27,
        verifiedSchedule27: state.schedule27
    };
    const localBackup = path.join(os.tmpdir(), `${REPAIR_ID}-${Date.now()}-backup.json`);
    fs.writeFileSync(localBackup, JSON.stringify(backupPayload, null, 2), { flag: 'wx' });

    const morning2 = structuredClone(state.schedule22.fields.morning2);
    const row22Fields = morning2.arrayValue.values[11].mapValue.fields;
    row22Fields.start = { stringValue: '10:30' };
    row22Fields.end = { stringValue: '14:30' };
    row22Fields.dataRepairId = { stringValue: REPAIR_ID };
    row22Fields.repairMeta = encode({
        at: now,
        source: 'rule_hd_cli_schedule_repair',
        before: { start: '09:15', end: '10:45' },
        after: { start: '10:30', end: '14:30' }
    });

    const sessions22 = structuredClone(state.attendance22.fields.sessions);
    const session22Fields = sessions22.arrayValue.values[0].mapValue.fields;
    session22Fields.linkedClassStart = { stringValue: '10:30' };
    session22Fields.branch = { stringValue: 'cs1' };
    session22Fields.dataRepairId = { stringValue: REPAIR_ID };
    const oldHistory = session22Fields.editHistory?.arrayValue?.values || [];
    session22Fields.editHistory = {
        arrayValue: {
            values: [...oldHistory, encode({
                at: now,
                action: 'repair_schedule_link',
                source: 'rule_hd_cli_schedule_repair',
                editor: 'system-repair',
                before: { linkedClassStart: '09:15' },
                after: { linkedClassStart: '10:30', branch: 'cs1' }
            })]
        }
    };

    const session27 = buildSession(DATE_27, now);
    const attendance27Data = {
        userId: USER_ID,
        name: USER_NAME,
        date: DATE_27,
        sessions: [session27],
        checkIn: session27.checkIn,
        checkOut: session27.checkOut,
        dataRepairId: REPAIR_ID
    };
    const attendance27Fields = encodeFields(attendance27Data);
    attendance27Fields.lastUpdated = { timestampValue: now };

    const writes = [
        createWrite(`${DOC_NAME_ROOT}/migration_backups/${REPAIR_ID}`, {
            repairId: { stringValue: REPAIR_ID },
            status: { stringValue: 'applied' },
            createdAt: { timestampValue: now },
            description: { stringValue: 'Correct Triệu Vy BTH schedule link on 2026-08-22 and restore scheduled attendance on 2026-08-27; atomic and reversible.' },
            payload: { stringValue: JSON.stringify(backupPayload) }
        }),
        updateWrite(state.schedule22, { morning2 }, ['morning2']),
        updateWrite(state.attendance22, {
            sessions: sessions22,
            dataRepairId: { stringValue: REPAIR_ID },
            lastUpdated: { timestampValue: now }
        }, ['sessions', 'dataRepairId', 'lastUpdated']),
        createWrite(`${DOC_NAME_ROOT}/attendance_logs/${DATE_27}_${USER_ID}`, attendance27Fields)
    ];
    await request(`${ROOT}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });

    const verified = await loadState();
    if (!verified.applied) throw new Error('Verification failed: dữ liệu chưa đạt trạng thái sửa hoàn chỉnh.');
    console.log(JSON.stringify({
        mode: 'apply', status: 'complete', repairId: REPAIR_ID,
        localBackup,
        backupDocument: `migration_backups/${REPAIR_ID}`,
        changes: [
            { date: DATE_22, schedule: 'BTH 10:30–14:30 CS1', attendance: '10:30–14:30, linkedClassStart=10:30' },
            { date: DATE_27, schedule: 'BTH 10:30–14:30 CS1', attendance: '10:30–14:30, linkedClassStart=10:30' }
        ]
    }, null, 2));
}

async function rollbackRepair(state) {
    if (!state.backup) throw new Error('Không có backup để rollback.');
    if (!state.applied) throw new Error('Safety gate rollback: dữ liệu đã thay đổi sau repair; không tự hoàn tác.');
    const backupData = decodeFields(state.backup.fields);
    const payload = JSON.parse(backupData.payload);
    const rolledBackAt = new Date().toISOString();
    const writes = [
        updateWrite(state.schedule22, {
            morning2: payload.schedule22.fields.morning2
        }, ['morning2']),
        {
            update: { name: state.attendance22.name, fields: payload.attendance22.fields },
            currentDocument: { updateTime: state.attendance22.updateTime }
        },
        {
            delete: state.attendance27.name,
            currentDocument: { updateTime: state.attendance27.updateTime }
        },
        updateWrite(state.backup, {
            status: { stringValue: 'rolled-back' },
            rolledBackAt: { timestampValue: rolledBackAt }
        }, ['status', 'rolledBackAt'])
    ];
    await request(`${ROOT}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
    console.log(JSON.stringify({ mode: 'rollback', status: 'complete', repairId: REPAIR_ID, rolledBackAt }, null, 2));
}

(async () => {
    token.cached = token();
    const state = await loadState();
    console.log(JSON.stringify({
        mode: ROLLBACK ? 'rollback' : (APPLY ? 'apply' : 'dry-run'),
        project: PROJECT,
        repairId: REPAIR_ID,
        alreadyApplied: state.applied,
        preview: [
            { date: DATE_22, action: 'correct schedule 09:15–10:45 → 10:30–14:30 and relink existing attendance' },
            { date: DATE_27, action: 'create scheduled BTH attendance 10:30–14:30' }
        ]
    }, null, 2));
    if (ROLLBACK) return rollbackRepair(state);
    if (APPLY) return applyRepair(state);
})().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
