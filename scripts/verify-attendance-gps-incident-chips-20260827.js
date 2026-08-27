const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const DOC_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const TARGETS = [
    { userId: 'nv_1786694913002', name: 'Lê Thuý Hằng', date: '2026-08-24', expectedMinutes: 180 },
    { userId: 'nv_1782628080827', name: 'Trần Thị Triệu Vy', date: '2026-08-26', expectedMinutes: 240 }
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
    if (optional && response.status === 404) return {};
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    const document = JSON.parse(text);
    return fields(document.fields);
}

function buildEvaluator() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'evaluation-service.js'), 'utf8');
    const context = {
        console, Date, Math, Set, Map, Intl,
        window: { centerClosures: {}, getIconHtml: () => '' },
        getLocalDateKey: date => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        },
        isScheduledMainTeacher: (row, id) => row.gvId === id || (row.gvList || []).some(item => item?.id === id),
        isScheduledSubstitute: (row, id) => row.gvThayTeId === id || row.gvThayTheId === id ||
            (row.gvThayTeList || row.gvThayTheList || []).some(item => item?.id === id),
        hasScheduledSubstitute: row => !!row.gvThayTeId || !!row.gvThayTheId ||
            (row.gvThayTeList || row.gvThayTheList || []).length > 0
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context.window.calculateDailyChips;
}

(async () => {
    const accessToken = token();
    const calculateDailyChips = buildEvaluator();
    const results = [];
    for (const target of TARGETS) {
        const [user, attendance, ...branchSchedules] = await Promise.all([
            get('users', target.userId, accessToken),
            get('attendance_logs', `${target.date}_${target.userId}`, accessToken),
            ...['cs1', 'cs2', 'cs3'].map(branch => get('schedules', `${branch}__${target.date}`, accessToken, true))
        ]);
        assert.equal(user.name, target.name);
        const schedule = {};
        branchSchedules.forEach((branchSchedule, branchIndex) => {
            Object.entries(branchSchedule).forEach(([section, rows]) => {
                if (!/^(morning|afternoon|evening)/.test(section) || !Array.isArray(rows)) return;
                schedule[section] = (schedule[section] || []).concat(rows.map((row, index) => ({
                    ...row,
                    _branch: ['cs1', 'cs2', 'cs3'][branchIndex],
                    _compositeKey: `${['cs1', 'cs2', 'cs3'][branchIndex]}__${target.date}`,
                    _originalIndex: index
                })));
            });
        });
        const chips = calculateDailyChips(schedule, attendance.sessions || [], target.userId, target.date, user);
        const worked = chips.filter(chip => !chip.isAbsent && Number(chip.paidMinutes) > 0);
        const totalMinutes = worked.reduce((sum, chip) => sum + Number(chip.paidMinutes || 0), 0);
        assert.equal(totalMinutes, target.expectedMinutes, `${target.name} phải đủ ${target.expectedMinutes} phút theo chip`);
        assert.ok(worked.every(chip => chip.sessionData?.linkedClassStart), 'mọi chip đi làm phải neo vào lớp');
        results.push({
            staff: target.name,
            date: target.date,
            totalMinutes,
            chips: worked.map(chip => ({ text: chip.text, paidMinutes: chip.paidMinutes, class: chip.class }))
        });
    }
    console.log(JSON.stringify({ status: 'passed', project: PROJECT, results }, null, 2));
})().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
