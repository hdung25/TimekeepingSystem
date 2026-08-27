const { execFileSync } = require('node:child_process');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const DOC_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const DATES = ['2026-08-24', '2026-08-26'];
const BRANCHES = ['cs1', 'cs2', 'cs3'];
const WEEK_KEY = '2026-08-24';
const DAY_KEYS = { '2026-08-24': 'mon', '2026-08-26': 'wed' };

function accessToken() {
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
    if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
    return value;
}

function decodeFields(fields) {
    return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]));
}

async function request(path, optional = false) {
    const response = await fetch(`${DOC_ROOT}/${path}`, {
        headers: { Authorization: `Bearer ${accessToken.cached}` }
    });
    if (optional && response.status === 404) return null;
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
                        field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value }
                    }
                }
            }
        })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    return (text ? JSON.parse(text) : []).filter(row => row.document).map(row => ({
        id: row.document.name.split('/').pop(), ...decodeFields(row.document.fields)
    }));
}

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

function assignedTo(row, userId) {
    return row.gvId === userId || row.gvThayTeId === userId || row.gvThayTheId === userId ||
        (row.gvList || []).some(item => item?.id === userId) ||
        (row.gvThayTeList || row.gvThayTheList || []).some(item => item?.id === userId) ||
        (row.registeredTeachers || []).some(item => item?.id === userId);
}

function scheduleRows(schedule, branch) {
    return Object.entries(schedule || {})
        .filter(([key, value]) => /^(morning|afternoon|evening)/.test(key) && Array.isArray(value))
        .flatMap(([section, rows]) => rows.map((row, index) => ({ section, index, branch, ...row })));
}

async function main() {
    accessToken.cached = accessToken();
    const [settingsDoc, usersPage, ...documents] = await Promise.all([
        request('settings/system'),
        request('users?pageSize=500'),
        ...DATES.flatMap(date => BRANCHES.map(branch => request(`schedules/${branch}__${date}`, true))),
        ...BRANCHES.flatMap(branch => [
            request(`receptionist_schedules/${branch}__${WEEK_KEY}`, true),
            request(`office_schedules/${branch}__${WEEK_KEY}`, true)
        ])
    ]);
    const users = (usersPage.documents || []).map(document => ({
        id: document.name.split('/').pop(),
        ...decodeFields(document.fields)
    }));
    const targets = users.filter(user => {
        const name = normalize(user.name);
        return name.includes('thuy hang') || name.includes('trieu vi') || name.includes('trieu vy') || name.includes('diem');
    });
    const schedules = {};
    let offset = 0;
    for (const date of DATES) {
        schedules[date] = [];
        for (const branch of BRANCHES) {
            const document = documents[offset++];
            if (document) schedules[date].push(...scheduleRows(decodeFields(document.fields), branch));
        }
    }
    const operationalRosters = [];
    for (const branch of BRANCHES) {
        for (const scheduleType of ['receptionist', 'office']) {
            const document = documents[offset++];
            if (!document) continue;
            const data = decodeFields(document.fields);
            for (const date of DATES) {
                const dayKey = DAY_KEYS[date];
                for (const shift of ['morning', 'afternoon', 'evening']) {
                    const configKey = scheduleType === 'office' ? `officeShifts_${branch}` : `receptionistShifts_${branch}`;
                    const config = data._shiftConfig?.[shift] || settings[configKey]?.[shift] || {};
                    for (const staff of data[shift]?.[dayKey] || []) {
                        operationalRosters.push({
                            date, branch, scheduleType, shift,
                            start: staff.customStart || config.start || null,
                            end: staff.customEnd || config.end || null,
                            staffId: staff.id, staffName: staff.name || null
                        });
                    }
                }
            }
        }
    }
    const attendanceDocs = await Promise.all(targets.flatMap(user => DATES.map(date =>
        request(`attendance_logs/${date}_${user.id}`, true).then(document => ({ userId: user.id, date, document }))
    )));
    const incidentTargets = targets.filter(user => ['nv_1786694913002', 'nv_1782628080827'].includes(user.id));
    const recentAttendance = Object.fromEntries(await Promise.all(incidentTargets.map(async user => [
        user.id,
        (await runQuery('attendance_logs', 'userId', user.id))
            .filter(row => String(row.date || row.id).startsWith('2026-08'))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
            .slice(0, 8)
            .map(row => ({ date: row.date, sessions: row.sessions || [] }))
    ])));
    const settings = decodeFields(settingsDoc.fields);
    const safeSettings = {};
    for (const branch of ['CS1', 'CS2', 'CS3']) {
        const lat = Number(settings[`gps${branch}Lat`]);
        const lng = Number(settings[`gps${branch}Lng`]);
        const radius = Number(settings[`gps${branch}Radius`]);
        safeSettings[branch.toLowerCase()] = {
            configured: Number.isFinite(lat) && Number.isFinite(lng),
            coordinateTypes: [typeof settings[`gps${branch}Lat`], typeof settings[`gps${branch}Lng`]],
            radius: Number.isFinite(radius) ? radius : null
        };
    }
    console.log(JSON.stringify({
        project: PROJECT,
        safeGPSSettings: safeSettings,
        matchedUsers: targets.map(user => ({
            id: user.id, name: user.name, username: user.username, role: user.role,
            roles: user.roles, salaryConfig: user.salary_config || null, createdAt: user.createdAt || null
        })),
        recentAttendance,
        dates: Object.fromEntries(DATES.map(date => [date, targets.map(user => ({
            userId: user.id,
            name: user.name,
            assignedSchedule: schedules[date].filter(row => assignedTo(row, user.id)).map(row => ({
                branch: row.branch, section: row.section, index: row.index, start: row.start, end: row.end,
                lop: row.lop || null, lopId: row.lopId || null, phong: row.phong || null,
                gv: row.gv || null, subject: row.subject || null,
                registered: (row.registeredTeachers || []).some(item => item?.id === user.id)
            })),
            operationalSchedule: operationalRosters.filter(row => row.date === date && row.staffId === user.id),
            attendance: (() => {
                const found = attendanceDocs.find(item => item.userId === user.id && item.date === date)?.document;
                if (!found) return null;
                const data = decodeFields(found.fields);
                return { checkIn: data.checkIn || null, checkOut: data.checkOut || null, sessions: data.sessions || [] };
            })()
        }))]))
    }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
