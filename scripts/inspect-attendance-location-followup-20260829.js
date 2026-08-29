const { execFileSync } = require('node:child_process');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const DOC_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const DATES = ['2026-08-28', '2026-08-29'];
const BRANCHES = ['cs1', 'cs2', 'cs3'];
const WEEK_KEY = '2026-08-24';
const DAY_KEYS = { '2026-08-28': 'fri', '2026-08-29': 'sat' };
const TARGETS = [
    { id: 'nv_1786694913002', name: 'Lê Thuý Hằng' },
    { id: 'nv_1782628080827', name: 'Trần Thị Triệu Vy' }
];

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
    return { updateTime: document.updateTime, data: fields(document.fields) };
}

function assignedTo(row, userId) {
    return row.gvId === userId || row.gvThayTeId === userId || row.gvThayTheId === userId ||
        (row.gvList || []).some(item => item?.id === userId) ||
        (row.gvThayTeList || row.gvThayTheList || []).some(item => item?.id === userId) ||
        (row.registeredTeachers || []).some(item => item?.id === userId);
}

function teachingRows(documents, userId) {
    return documents.flatMap((document, branchIndex) => {
        if (!document) return [];
        return Object.entries(document.data)
            .filter(([section, rows]) => /^(morning|afternoon|evening)/.test(section) && Array.isArray(rows))
            .flatMap(([section, rows]) => rows.map((row, index) => ({
                branch: BRANCHES[branchIndex], section, index, ...row
            })))
            .filter(row => assignedTo(row, userId))
            .map(row => ({
                type: 'teaching', branch: row.branch, section: row.section, index: row.index,
                start: row.start, end: row.end, className: row.lop || null,
                subjectId: row.lopId || row.subject || null
            }));
    });
}

function operationalRows(rosters, date, userId) {
    const dayKey = DAY_KEYS[date];
    return rosters.flatMap(item => {
        if (!item.document) return [];
        const result = [];
        for (const shift of ['morning', 'afternoon', 'evening']) {
            for (const staff of item.document.data[shift]?.[dayKey] || []) {
                if (staff.id !== userId) continue;
                const config = item.document.data._shiftConfig?.[shift] || {};
                result.push({
                    type: item.type,
                    branch: item.branch,
                    shift,
                    start: staff.customStart || config.start || null,
                    end: staff.customEnd || config.end || null
                });
            }
        }
        return result;
    });
}

(async () => {
    const accessToken = token();
    const [users, ...rosterDocs] = await Promise.all([
        Promise.all(TARGETS.map(target => get('users', target.id, accessToken))),
        ...BRANCHES.flatMap(branch => [
            get('receptionist_schedules', `${branch}__${WEEK_KEY}`, accessToken, true),
            get('office_schedules', `${branch}__${WEEK_KEY}`, accessToken, true)
        ])
    ]);
    users.forEach((user, index) => {
        if (user.data.name !== TARGETS[index].name) {
            throw new Error(`Safety gate: ${TARGETS[index].id} hiện là “${user.data.name}”.`);
        }
    });
    const rosters = [];
    let offset = 0;
    for (const branch of BRANCHES) {
        rosters.push({ branch, type: 'receptionist', document: rosterDocs[offset++] });
        rosters.push({ branch, type: 'office', document: rosterDocs[offset++] });
    }

    const results = {};
    for (const date of DATES) {
        const schedules = await Promise.all(BRANCHES.map(branch =>
            get('schedules', `${branch}__${date}`, accessToken, true)
        ));
        results[date] = [];
        for (const target of TARGETS) {
            const attendance = await get('attendance_logs', `${date}_${target.id}`, accessToken, true);
            results[date].push({
                staff: target.name,
                staffId: target.id,
                schedules: [
                    ...teachingRows(schedules, target.id),
                    ...operationalRows(rosters, date, target.id)
                ],
                attendance: attendance ? {
                    updateTime: attendance.updateTime,
                    sessions: (attendance.data.sessions || []).map(session => ({
                        checkIn: session.checkIn || session.start || null,
                        checkOut: session.checkOut || null,
                        linkedClassStart: session.linkedClassStart || null,
                        linkedReceptionistShift: session.linkedReceptionistShift || null,
                        dataRepairId: session.dataRepairId || null
                    }))
                } : null
            });
        }
    }
    console.log(JSON.stringify({ project: PROJECT, dates: results }, null, 2));
})().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
