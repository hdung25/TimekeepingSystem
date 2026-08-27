const { execFileSync } = require('node:child_process');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const DOC_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const USER_ID = 'nv_1782628080827';
const EXPECTED_NAME = 'Trần Thị Triệu Vy';
const DATES = ['2026-08-22', '2026-08-27'];
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
    return { name: document.name, updateTime: document.updateTime, data: fields(document.fields) };
}

function assignedTo(row) {
    return row.gvId === USER_ID || row.gvThayTeId === USER_ID || row.gvThayTheId === USER_ID ||
        (row.gvList || []).some(item => item?.id === USER_ID) ||
        (row.gvThayTeList || row.gvThayTheList || []).some(item => item?.id === USER_ID) ||
        (row.registeredTeachers || []).some(item => item?.id === USER_ID);
}

function scheduleRows(document, branch) {
    if (!document) return [];
    return Object.entries(document.data)
        .filter(([section, rows]) => /^(morning|afternoon|evening)/.test(section) && Array.isArray(rows))
        .flatMap(([section, rows]) => rows.map((row, index) => ({ branch, section, index, ...row })))
        .filter(assignedTo)
        .map(row => ({
            branch: row.branch,
            section: row.section,
            index: row.index,
            start: row.start,
            end: row.end,
            className: row.lop || null,
            subjectId: row.lopId || row.subject || null,
            room: row.phong || null,
            mainTeacher: row.gv || null,
            mainTeacherId: row.gvId || null,
            mainTeachers: row.gvList || [],
            substituteTeacherId: row.gvThayTeId || row.gvThayTheId || null,
            substituteTeachers: row.gvThayTeList || row.gvThayTheList || [],
            registeredTeachers: row.registeredTeachers || [],
            status: row.status || null,
            note: row.note || null,
            registered: (row.registeredTeachers || []).some(item => item?.id === USER_ID)
        }));
}

function timeMinutes(value) {
    const [hour, minute] = String(value || '').split(':').map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function overlappingRows(document, branch, start = '10:30', end = '14:30') {
    if (!document) return [];
    const targetStart = timeMinutes(start);
    const targetEnd = timeMinutes(end);
    return Object.entries(document.data)
        .filter(([section, rows]) => /^(morning|afternoon|evening)/.test(section) && Array.isArray(rows))
        .flatMap(([section, rows]) => rows.map((row, index) => ({ branch, section, index, ...row })))
        .filter(row => {
            const rowStart = timeMinutes(row.start);
            const rowEnd = timeMinutes(row.end);
            return rowStart !== null && rowEnd !== null && rowStart < targetEnd && rowEnd > targetStart;
        })
        .map(row => ({
            branch: row.branch, section: row.section, index: row.index,
            start: row.start, end: row.end, className: row.lop || null,
            subjectId: row.lopId || row.subject || null, mainTeacher: row.gv || null,
            mainTeacherId: row.gvId || null, mainTeachers: row.gvList || [],
            substituteTeachers: row.gvThayTeList || row.gvThayTheList || [],
            registeredTeachers: row.registeredTeachers || []
        }));
}

(async () => {
    const accessToken = token();
    const user = await get('users', USER_ID, accessToken);
    if (user.data.name !== EXPECTED_NAME) {
        throw new Error(`Safety gate: ${USER_ID} hiện là “${user.data.name}”.`);
    }
    const dates = {};
    for (const date of DATES) {
        const [attendance, ...schedules] = await Promise.all([
            get('attendance_logs', `${date}_${USER_ID}`, accessToken, true),
            ...BRANCHES.map(branch => get('schedules', `${branch}__${date}`, accessToken, true))
        ]);
        dates[date] = {
            schedule: schedules.flatMap((document, index) => scheduleRows(document, BRANCHES[index])),
            overlappingScheduleRows: schedules.flatMap((document, index) => overlappingRows(document, BRANCHES[index])),
            attendance: attendance ? {
                updateTime: attendance.updateTime,
                checkIn: attendance.data.checkIn || null,
                checkOut: attendance.data.checkOut || null,
                dataRepairId: attendance.data.dataRepairId || null,
                sessions: (attendance.data.sessions || []).map(session => ({
                    id: session.id,
                    checkIn: session.checkIn || session.start || null,
                    checkOut: session.checkOut || null,
                    role: session.role || null,
                    roleName: session.roleName || null,
                    linkedClassStart: session.linkedClassStart || null,
                    branch: session.branch || null,
                    isAdminEdited: !!session.isAdminEdited,
                    dataRepairId: session.dataRepairId || null
                }))
            } : null
        };
    }
    console.log(JSON.stringify({ project: PROJECT, user: { id: USER_ID, name: user.data.name, username: user.data.username }, dates }, null, 2));
})().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
