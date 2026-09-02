const { execFileSync } = require('node:child_process');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const DOC_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const DATE_KEY = process.argv[2] || '2026-08-17';
const MONTH_KEY = DATE_KEY.slice(0, 7);
const BRANCHES = ['cs1', 'cs2', 'cs3'];
const SEARCH_TERMS = (process.argv.slice(3).length ? process.argv.slice(3) : ['vo quang my', 'ngoc giau'])
    .map(normalize);

function accessToken() {
    const gcloud = 'C:\\Users\\Admin\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1';
    return execFileSync('powershell.exe', ['-NoProfile', '-File', gcloud, 'auth', 'print-access-token'], {
        encoding: 'utf8',
        windowsHide: true
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
    return value;
}

function decodeFields(fields) {
    return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]));
}

function normalize(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

async function request(path, options = {}) {
    const response = await fetch(path.startsWith('http') ? path : `${DOC_ROOT}/${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken.cached}`,
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    return text ? JSON.parse(text) : null;
}

async function list(collectionId) {
    const result = await request(`${collectionId}?pageSize=500`);
    return (result?.documents || []).map(document => ({
        id: document.name.split('/').pop(),
        ...decodeFields(document.fields)
    }));
}

async function runQuery(collectionId, field, value) {
    const result = await request(`${DOC_ROOT}:runQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: field },
                        op: 'EQUAL',
                        value: { stringValue: value }
                    }
                }
            }
        })
    });
    return (result || []).filter(row => row.document).map(row => ({
        id: row.document.name.split('/').pop(),
        ...decodeFields(row.document.fields)
    }));
}

function rowPeople(row) {
    return [
        { id: row.gvId, name: row.gvName, kind: 'main-legacy' },
        { id: row.gvThayTheId || row.gvThayTeId, name: row.gvThayThe || row.gvThayTe, kind: 'substitute-legacy' },
        ...(row.gvList || []).map(person => ({ ...person, kind: 'main' })),
        ...(row.gvThayTeList || row.gvThayTheList || []).map(person => ({ ...person, kind: 'substitute' })),
        ...(row.registeredTeachers || []).map(person => ({ ...person, kind: 'registered' }))
    ].filter(person => person.id || person.name);
}

function assigned(row, user) {
    return rowPeople(row).some(person => String(person.id || '') === user.id ||
        normalize(person.name) === normalize(user.name));
}

function safeSession(session) {
    return {
        id: session?.id || null,
        checkIn: session?.checkIn || session?.start || null,
        checkOut: session?.checkOut || null,
        role: session?.role || null,
        roleName: session?.roleName || null,
        linkedClassStart: session?.linkedClassStart || null,
        isAbsent: session?.isAbsent === true,
        makeupRequestId: session?.makeupRequestId || null
    };
}

async function main() {
    accessToken.cached = accessToken();
    const [users, scheduleDocs] = await Promise.all([
        list('users'),
        Promise.all(BRANCHES.map(async branch => {
            const document = await request(`schedules/${branch}__${DATE_KEY}`);
            return { branch, data: document ? decodeFields(document.fields) : {} };
        }))
    ]);
    const people = users.filter(user => {
        const name = normalize(user.name || user.fullName);
        return SEARCH_TERMS.some(term => name.includes(term));
    }).map(user => ({ ...user, name: user.name || user.fullName || '' }));

    const result = [];
    for (const user of people) {
        const [attendanceDoc, notesDoc, cancelledDoc, makeupRequests] = await Promise.all([
            request(`attendance_logs/${DATE_KEY}_${user.id}`),
            request(`daily_notes/${user.id}`),
            request(`cancelled_shifts/${MONTH_KEY}_${user.id}`),
            runQuery('makeup_requests', 'staffId', user.id)
        ]);
        const attendance = attendanceDoc ? decodeFields(attendanceDoc.fields) : {};
        const notes = notesDoc ? decodeFields(notesDoc.fields) : {};
        const cancelled = cancelledDoc ? decodeFields(cancelledDoc.fields) : {};
        const scheduleRows = scheduleDocs.flatMap(({ branch, data }) =>
            Object.entries(data)
                .filter(([section, rows]) => /^(morning|afternoon|evening)/.test(section) && Array.isArray(rows))
                .flatMap(([section, rows]) => rows.map((row, index) => ({ branch, section, index, row })))
                .filter(item => assigned(item.row, user))
                .map(item => ({
                    branch: item.branch,
                    section: item.section,
                    index: item.index,
                    shiftId: item.row.shiftId || null,
                    start: item.row.start,
                    end: item.row.end,
                    subject: item.row.lop || null,
                    subjectId: item.row.lopId || null,
                    people: rowPeople(item.row),
                    hasExplicitAbsenceArray: Array.isArray(item.row.teacherAbsences),
                    teacherAbsences: item.row.teacherAbsences || null,
                    teacherAbsenceHistory: item.row.teacherAbsenceHistory || null
                }))
        );
        result.push({
            user: { id: user.id, name: user.name, role: user.role, roles: user.roles || [] },
            dailyNote: notes[DATE_KEY] || null,
            cancelledShifts: (cancelled.shifts || []).filter(key => String(key).includes('2026-08-17') || String(key).includes('2026-08-16')),
            attendanceSessions: (attendance.sessions || []).map(safeSession),
            scheduleRows,
            makeupRequests: makeupRequests.filter(request => request.dateKey === DATE_KEY).map(request => ({
                id: request.id,
                status: request.status,
                shiftLabel: request.shiftLabel,
                session: safeSession(request.session || {})
            }))
        });
    }
    console.log(JSON.stringify({ date: DATE_KEY, people: result }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
