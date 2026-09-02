/**
 * Guarded, atomic Rule-HD repair for the two production records that exposed
 * the 2026-09-02 policy regressions.
 *
 * Dry-run (default):
 *   node scripts/repair-policy-incidents-20260902.js
 * Apply both corrections atomically:
 *   node scripts/repair-policy-incidents-20260902.js --apply
 * Roll back, only while every repaired document is still unchanged:
 *   node scripts/repair-policy-incidents-20260902.js --rollback
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}`;
const DOC_ROOT = `${ROOT}/documents`;
const DOC_NAME_ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const REPAIR_ID = 'policy-incidents-20260902-v1';
const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');

const VY = Object.freeze({
    id: 'nv_1782628080827',
    name: 'Trần Thị Triệu Vy',
    date: '2026-08-10',
    sessionId: 1786331986962,
    checkIn: '2026-08-10T03:19:46.719Z',
    checkOut: '2026-08-10T11:00:00.000Z'
});
const MY = Object.freeze({
    id: 'nv_1776091622276',
    name: 'Võ Quang Mỹ',
    date: '2026-08-17',
    scheduleId: 'cs1__2026-08-17',
    section: 'afternoon2',
    rowIndex: 1,
    shiftId: 'legacy_shift_cc2hkt_1wj9szz',
    subjectId: 'ZQuEuI65dg9hthIVnzlZ'
});

if (APPLY && ROLLBACK) throw new Error('Chỉ được chọn một trong --apply hoặc --rollback.');

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
    const body = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${body}`);
    return body ? JSON.parse(body) : null;
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

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value) {
    return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function findVySession(attendanceData) {
    return (attendanceData.sessions || []).find(session => String(session?.id) === String(VY.sessionId));
}

function getMyBthRow(scheduleData) {
    const rows = Array.isArray(scheduleData?.[MY.section]) ? scheduleData[MY.section] : [];
    const row = rows[MY.rowIndex];
    if (!row || row.shiftId !== MY.shiftId || row.start !== '14:30' || row.end !== '16:30' || row.lop !== 'BTH') {
        throw new Error('Safety gate: ca BTH 14:30–16:30 của Mỹ đã dịch chuyển hoặc đổi định danh.');
    }
    const assigned = row.gvId === MY.id || (row.gvList || []).some(person => person?.id === MY.id);
    if (!assigned) throw new Error('Safety gate: Võ Quang Mỹ không còn là GV chính của ca BTH mục tiêu.');
    if (!Array.isArray(row.teacherAbsences) || row.teacherAbsences.length !== 0) {
        throw new Error('Safety gate: ca BTH không còn ở trạng thái explicit ACTIVE (teacherAbsences=[]).');
    }
    return row;
}

function validateBackup(backup) {
    if (!backup) return null;
    const data = decodeFields(backup.fields);
    if (data.repairId !== REPAIR_ID || typeof data.payload !== 'string') {
        throw new Error('Safety gate: backup production không thuộc repair này.');
    }
    const payload = JSON.parse(data.payload);
    if (data.payloadHash !== sha256(payload)) throw new Error('Safety gate: checksum backup không hợp lệ.');
    return { data, payload };
}

function isApplied(state) {
    const vySession = findVySession(state.vyAttendanceData);
    const myRow = getMyBthRow(state.myScheduleData);
    return !!state.backupInfo &&
        vySession?.bonus10 === false &&
        vySession?.bonus10RepairId === REPAIR_ID &&
        myRow.lopId === MY.subjectId &&
        myRow.subjectRepairId === REPAIR_ID &&
        state.backupInfo.data.status === 'applied';
}

async function loadState() {
    const [vyUser, vyAttendance, myUser, mySchedule, bthSubject, vyRequests, backup] = await Promise.all([
        getDocument('users', VY.id),
        getDocument('attendance_logs', `${VY.date}_${VY.id}`),
        getDocument('users', MY.id),
        getDocument('schedules', MY.scheduleId),
        getDocument('subjects', MY.subjectId),
        request(`${DOC_ROOT}:runQuery`, {
            method: 'POST',
            body: JSON.stringify({ structuredQuery: {
                from: [{ collectionId: 'bonus10_requests' }],
                where: { fieldFilter: {
                    field: { fieldPath: 'staffId' }, op: 'EQUAL', value: { stringValue: VY.id }
                }}
            }})
        }),
        getDocument('migration_backups', REPAIR_ID, true)
    ]);
    const vyUserData = decodeFields(vyUser.fields);
    const myUserData = decodeFields(myUser.fields);
    const vyAttendanceData = decodeFields(vyAttendance.fields);
    const myScheduleData = decodeFields(mySchedule.fields);
    const subjectData = decodeFields(bthSubject.fields);
    const backupInfo = validateBackup(backup);
    if (vyUserData.name !== VY.name || myUserData.name !== MY.name) {
        throw new Error('Safety gate: một mã nhân sự không còn khớp đúng người đã xác minh.');
    }
    if (subjectData.name !== 'BTH' || subjectData.allowEarly10 === true) {
        throw new Error('Safety gate: danh mục BTH đã đổi tên hoặc đang bật +10 phút.');
    }
    const state = {
        vyUser, vyAttendance, vyAttendanceData,
        myUser, mySchedule, myScheduleData,
        bthSubject, backup, backupInfo,
        vyRequests: (vyRequests || []).filter(item => item.document).map(item => decodeFields(item.document.fields))
    };
    if (isApplied(state)) return { ...state, applied: true };

    const vySession = findVySession(vyAttendanceData);
    if (!vySession || vySession.checkIn !== VY.checkIn || vySession.checkOut !== VY.checkOut) {
        throw new Error('Safety gate: phiên công Triệu Vy đã đổi hoặc không còn tồn tại.');
    }
    if (vySession.bonus10 !== true || vySession.role || vySession.linkedClassStart) {
        throw new Error('Safety gate: phiên Triệu Vy không còn đúng orphan bonus đã điều tra.');
    }
    const activeRequests = state.vyRequests.filter(request => request.dateKey === VY.date &&
        String(request.sessionId) === String(VY.sessionId) && ['pending', 'approved'].includes(request.status));
    if (activeRequests.length) throw new Error('Safety gate: đã xuất hiện yêu cầu +10 hợp lệ; dừng để đối chiếu tay.');
    const myRow = getMyBthRow(myScheduleData);
    if (myRow.lopId && myRow.lopId !== MY.subjectId) {
        throw new Error('Safety gate: BTH đã có mã môn khác, không tự thay.');
    }
    if (backupInfo) throw new Error('Safety gate: backup đã tồn tại nhưng dữ liệu không ở trạng thái applied hoàn chỉnh.');
    return { ...state, applied: false };
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
        vyAttendance: state.vyAttendance,
        mySchedule: state.mySchedule
    };
    const localBackup = path.join(os.tmpdir(), `${REPAIR_ID}-${Date.now()}-backup.json`);
    fs.writeFileSync(localBackup, JSON.stringify(backupPayload, null, 2), { flag: 'wx' });

    const sessions = structuredClone(state.vyAttendanceData.sessions || []);
    const vySession = findVySession({ sessions });
    vySession.bonus10 = false;
    vySession.bonus10RepairId = REPAIR_ID;
    vySession.bonus10RepairedAt = now;
    vySession.editHistory = Array.isArray(vySession.editHistory) ? vySession.editHistory.slice(-19) : [];
    vySession.editHistory.push({
        at: now,
        action: 'repair_orphan_bonus10',
        source: 'rule_hd_cli_policy_repair',
        editor: 'system-repair',
        before: { bonus10: true },
        after: { bonus10: false }
    });

    const mySection = structuredClone(state.myScheduleData[MY.section]);
    const myRow = mySection[MY.rowIndex];
    myRow.lopId = MY.subjectId;
    myRow.subjectRepairId = REPAIR_ID;
    myRow.subjectRepairMeta = {
        at: now,
        source: 'rule_hd_cli_policy_repair',
        before: { lopId: null },
        after: { lopId: MY.subjectId }
    };

    const writes = [
        createWrite(`${DOC_NAME_ROOT}/migration_backups/${REPAIR_ID}`, {
            repairId: { stringValue: REPAIR_ID },
            status: { stringValue: 'applied' },
            createdAt: { timestampValue: now },
            description: { stringValue: 'Remove Triệu Vy orphan +10 flag and materialize Mỹ BTH subject id; atomic and reversible.' },
            payloadHash: { stringValue: sha256(backupPayload) },
            payload: { stringValue: JSON.stringify(backupPayload) }
        }),
        updateWrite(state.vyAttendance, {
            sessions: encode(sessions),
            lastUpdated: { timestampValue: now }
        }, ['sessions', 'lastUpdated']),
        updateWrite(state.mySchedule, {
            [MY.section]: encode(mySection),
            updatedAt: { timestampValue: now }
        }, [MY.section, 'updatedAt'])
    ];
    await request(`${ROOT}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });

    const verified = await loadState();
    if (!verified.applied) throw new Error('Verification failed: production chưa đạt trạng thái repair hoàn chỉnh.');
    console.log(JSON.stringify({
        mode: 'apply', status: 'complete', repairId: REPAIR_ID, localBackup,
        backupDocument: `migration_backups/${REPAIR_ID}`,
        changes: [
            'Triệu Vy 2026-08-10: orphan session bonus10 true -> false',
            `Võ Quang Mỹ 2026-08-17 BTH: lopId -> ${MY.subjectId}; teacherAbsences vẫn []`
        ]
    }, null, 2));
}

function documentMatchesAppliedState(state) {
    try {
        return isApplied(state);
    } catch (_) {
        return false;
    }
}

async function rollbackRepair(state) {
    if (!state.backupInfo) throw new Error('Không có backup để rollback.');
    if (!documentMatchesAppliedState(state)) {
        throw new Error('Safety gate rollback: dữ liệu đã thay đổi sau repair; không tự hoàn tác.');
    }
    const { payload } = state.backupInfo;
    const rolledBackAt = new Date().toISOString();
    const writes = [
        {
            update: { name: state.vyAttendance.name, fields: payload.vyAttendance.fields },
            currentDocument: { updateTime: state.vyAttendance.updateTime }
        },
        {
            update: { name: state.mySchedule.name, fields: payload.mySchedule.fields },
            currentDocument: { updateTime: state.mySchedule.updateTime }
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
    accessToken.cached = accessToken();
    const state = await loadState();
    console.log(JSON.stringify({
        mode: ROLLBACK ? 'rollback' : (APPLY ? 'apply' : 'dry-run'),
        project: PROJECT,
        repairId: REPAIR_ID,
        alreadyApplied: state.applied,
        preview: [
            'Remove only the orphan +10 flag from Triệu Vy session; keep all clock evidence.',
            'Attach the canonical BTH subject id to Mỹ shift; preserve explicit ACTIVE absence state.'
        ]
    }, null, 2));
    if (ROLLBACK) return rollbackRepair(state);
    if (APPLY) return applyRepair(state);
})().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
