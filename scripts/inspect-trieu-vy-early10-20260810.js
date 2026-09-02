const { execFileSync } = require('node:child_process');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const DOC_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const USER_ID = 'nv_1782628080827';
const EXPECTED_NAME = 'Trần Thị Triệu Vy';
const DATE_KEY = '2026-08-10';
const BRANCHES = ['cs1', 'cs2', 'cs3'];

function token() {
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
    if ('mapValue' in value) return fields(value.mapValue.fields || {});
    return value;
}

function fields(raw) {
    return Object.fromEntries(Object.entries(raw || {}).map(([key, value]) => [key, decode(value)]));
}

async function get(collection, id, accessToken, optional = false) {
    const response = await fetch(`${DOC_ROOT}/${collection}/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const text = await response.text();
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    const document = JSON.parse(text);
    return { id, updateTime: document.updateTime, data: fields(document.fields) };
}

async function list(collection, accessToken) {
    const response = await fetch(`${DOC_ROOT}/${collection}?pageSize=500`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    const payload = JSON.parse(text);
    return (payload.documents || []).map(document => ({
        id: document.name.split('/').pop(),
        ...fields(document.fields)
    }));
}

async function query(collectionId, fieldPath, stringValue, accessToken) {
    const response = await fetch(`${DOC_ROOT}:runQuery`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId }],
                where: {
                    fieldFilter: {
                        field: { fieldPath }, op: 'EQUAL', value: { stringValue }
                    }
                }
            }
        })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    return JSON.parse(text).filter(row => row.document).map(row => ({
        id: row.document.name.split('/').pop(),
        updateTime: row.document.updateTime,
        ...fields(row.document.fields)
    }));
}

function assigned(row) {
    return row.gvId === USER_ID || row.gvThayTeId === USER_ID || row.gvThayTheId === USER_ID ||
        (row.gvList || []).some(person => person?.id === USER_ID) ||
        (row.gvThayTeList || row.gvThayTheList || []).some(person => person?.id === USER_ID) ||
        (row.registeredTeachers || []).some(person => person?.id === USER_ID);
}

function scheduleRows(document, branch) {
    if (!document) return [];
    return Object.entries(document.data)
        .filter(([section, rows]) => /^(morning|afternoon|evening)/.test(section) && Array.isArray(rows))
        .flatMap(([section, rows]) => rows.map((row, index) => ({ branch, section, index, ...row })))
        .filter(assigned)
        .map(row => ({
            branch: row.branch,
            section: row.section,
            index: row.index,
            shiftId: row.shiftId || null,
            start: row.start,
            end: row.end,
            subject: row.lop || null,
            subjectId: row.lopId || null,
            mainTeacherId: row.gvId || null,
            substituteTeacherId: row.gvThayTeId || row.gvThayTheId || null
        }));
}

(async () => {
    const accessToken = token();
    const [user, attendance, subjects, requests, ...schedules] = await Promise.all([
        get('users', USER_ID, accessToken),
        get('attendance_logs', `${DATE_KEY}_${USER_ID}`, accessToken, true),
        list('subjects', accessToken),
        query('bonus10_requests', 'staffId', USER_ID, accessToken),
        ...BRANCHES.map(branch => get('schedules', `${branch}__${DATE_KEY}`, accessToken, true))
    ]);
    if (user.data.name !== EXPECTED_NAME) {
        throw new Error(`Safety gate: ${USER_ID} hiện là “${user.data.name}”.`);
    }
    const sessions = (attendance?.data?.sessions || []).map(session => ({
        id: session.id,
        checkIn: session.checkIn || session.start || null,
        checkOut: session.checkOut || null,
        role: session.role || null,
        roleName: session.roleName || null,
        subjectIds: session.subjectIds || null,
        linkedClassStart: session.linkedClassStart || null,
        bonus10: session.bonus10 === true,
        editHistory: session.editHistory || null
    }));
    const subjectById = Object.fromEntries(subjects.map(subject => [String(subject.id), subject]));
    const result = {
        project: PROJECT,
        date: DATE_KEY,
        user: {
            id: USER_ID,
            name: user.data.name,
            role: user.data.role,
            roles: user.data.roles || [],
            teachingMode: user.data.teachingMode || null
        },
        attendanceUpdateTime: attendance?.updateTime || null,
        sessions: sessions.map(session => ({
            ...session,
            roleSubjects: String(session.role || '').split('+').filter(Boolean).map(id => ({
                id,
                name: subjectById[id]?.name || null,
                allowEarly10: subjectById[id]?.allowEarly10 === true
            }))
        })),
        requests: requests.filter(request => request.dateKey === DATE_KEY),
        schedule: schedules.flatMap((document, index) => scheduleRows(document, BRANCHES[index])),
        matchingSubjects: subjects.filter(subject => /bth|bán trú/i.test(String(subject.name || ''))).map(subject => ({
            id: subject.id,
            name: subject.name,
            allowEarly10: subject.allowEarly10 === true
        }))
    };
    console.log(JSON.stringify(result, null, 2));
})().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
