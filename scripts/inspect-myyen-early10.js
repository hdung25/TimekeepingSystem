const { execFileSync } = require('node:child_process');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const DOC_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const MY_YEN_ID = 'nv_1777820162937';
const DATE_KEY = process.argv[2] || '2026-08-15';

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

async function get(path) {
    const response = await fetch(`${DOC_ROOT}/${path}`, {
        headers: { Authorization: `Bearer ${accessToken.cached}` }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    return text ? JSON.parse(text) : null;
}

async function runQuery(collectionId, field, value) {
    const response = await fetch(`${DOC_ROOT}:runQuery`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken.cached}`,
            'Content-Type': 'application/json'
        },
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
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    return (text ? JSON.parse(text) : [])
        .filter(row => row.document)
        .map(row => ({
            id: row.document.name.split('/').pop(),
            ...decodeFields(row.document.fields)
        }));
}

async function main() {
    accessToken.cached = accessToken();
    const [userDoc, attendanceDoc, scheduleDoc, subjectsPage, bonus10Requests, overtimeRequests] = await Promise.all([
        get(`users/${MY_YEN_ID}`),
        get(`attendance_logs/${DATE_KEY}_${MY_YEN_ID}`),
        get(`schedules/cs1__${DATE_KEY}`),
        get('subjects?pageSize=500'),
        runQuery('bonus10_requests', 'staffId', MY_YEN_ID),
        runQuery('overtime_requests', 'staffId', MY_YEN_ID)
    ]);

    const user = decodeFields(userDoc.fields);
    const attendance = decodeFields(attendanceDoc.fields);
    const schedule = decodeFields(scheduleDoc.fields);
    const subjects = (subjectsPage.documents || []).map(document => ({
        id: document.name.split('/').pop(),
        ...decodeFields(document.fields)
    }));
    const assigned = Object.entries(schedule)
        .filter(([section]) => /^(morning|afternoon|evening)/.test(section))
        .flatMap(([section, rows]) => (Array.isArray(rows) ? rows : []).map(row => ({ section, ...row })))
        .filter(row => row.gvId === MY_YEN_ID || row.gvThayTeId === MY_YEN_ID ||
            (row.gvList || []).some(item => item && item.id === MY_YEN_ID) ||
            (row.gvThayTeList || row.gvThayTheList || []).some(item => item && item.id === MY_YEN_ID) ||
            (row.registeredTeachers || []).some(item => item && item.id === MY_YEN_ID));

    console.log(JSON.stringify({
        user: {
            id: MY_YEN_ID,
            name: user.name,
            roles: user.roles,
            role: user.role,
            teachingMode: user.teachingMode
        },
        attendance: {
            date: attendance.date,
            checkIn: attendance.checkIn,
            checkOut: attendance.checkOut,
            sessions: attendance.sessions
        },
        bonus10Requests: bonus10Requests.filter(request => request.dateKey === DATE_KEY),
        overtimeRequests: overtimeRequests.filter(request => request.dateKey === DATE_KEY),
        assignedSchedule: assigned,
        early10Subjects: subjects
            .filter(subject => subject.allowEarly10 === true)
            .map(subject => ({ id: subject.id, name: subject.name, parentId: subject.parentId || null }))
    }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
