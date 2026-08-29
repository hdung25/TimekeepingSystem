const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const DOC_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const USER_ID = 'nv_1786694913002';
const USER_NAME = 'Lê Thuý Hằng';
const DATE = '2026-08-28';
const REPAIR_ID = 'hang-location-failure-20260828-v1';

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
    return fields(JSON.parse(text).fields);
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
    const [user, attendance, backup, ...branchSchedules] = await Promise.all([
        get('users', USER_ID, accessToken),
        get('attendance_logs', `${DATE}_${USER_ID}`, accessToken),
        get('migration_backups', REPAIR_ID, accessToken),
        ...['cs1', 'cs2', 'cs3'].map(branch => get('schedules', `${branch}__${DATE}`, accessToken, true))
    ]);
    assert.equal(user.name, USER_NAME);
    assert.equal(backup.status, 'applied');
    assert.equal(attendance.dataRepairId, REPAIR_ID);
    assert.equal(attendance.sessions?.length, 2);
    assert.deepEqual(attendance.sessions.map(session => ({
        start: session.linkedClassStart,
        roleName: session.roleName,
        branch: session.branch,
        repair: session.dataRepairId
    })), [
        { start: '18:00', roleName: 'NV8', branch: 'cs1', repair: REPAIR_ID },
        { start: '19:30', roleName: 'NV6', branch: 'cs1', repair: REPAIR_ID }
    ]);

    const schedule = {};
    branchSchedules.forEach((branchSchedule, branchIndex) => {
        Object.entries(branchSchedule).forEach(([section, rows]) => {
            if (!/^(morning|afternoon|evening)/.test(section) || !Array.isArray(rows)) return;
            schedule[section] = (schedule[section] || []).concat(rows.map((row, index) => ({
                ...row,
                _branch: ['cs1', 'cs2', 'cs3'][branchIndex],
                _compositeKey: `${['cs1', 'cs2', 'cs3'][branchIndex]}__${DATE}`,
                _originalIndex: index
            })));
        });
    });

    const chips = buildEvaluator()(schedule, attendance.sessions, USER_ID, DATE, user);
    const worked = chips.filter(chip => !chip.isAbsent && Number(chip.paidMinutes) > 0);
    const totalMinutes = worked.reduce((sum, chip) => sum + Number(chip.paidMinutes || 0), 0);
    assert.equal(totalMinutes, 180, 'Hằng phải đủ 180 phút theo lịch ngày 28/08');
    assert.ok(worked.every(chip => chip.sessionData?.linkedClassStart), 'mọi chip đi làm phải neo vào lớp');

    console.log(JSON.stringify({
        status: 'passed',
        project: PROJECT,
        backup: `migration_backups/${REPAIR_ID}`,
        staff: USER_NAME,
        date: DATE,
        totalMinutes,
        chips: worked.map(chip => ({ text: chip.text, paidMinutes: chip.paidMinutes, class: chip.class }))
    }, null, 2));
})().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
