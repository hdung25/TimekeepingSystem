const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const DOC_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
const USER_ID = 'nv_1782628080827';
const USER_NAME = 'Trần Thị Triệu Vy';
const REPAIR_ID = 'trieu-vy-bth-20260822-27-v1';
const TARGETS = [
    { date: '2026-08-22', expectedPaidMinutes: 250, keepsApprovedEarly10: true },
    { date: '2026-08-27', expectedPaidMinutes: 240, keepsApprovedEarly10: false }
];
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
    const user = await get('users', USER_ID, accessToken);
    assert.equal(user.name, USER_NAME);
    const backup = await get('migration_backups', REPAIR_ID, accessToken);
    assert.equal(backup.status, 'applied');
    const backupPayload = JSON.parse(backup.payload);
    const calculateDailyChips = buildEvaluator();
    const results = [];

    for (const target of TARGETS) {
        const { date } = target;
        const [attendance, ...branchSchedules] = await Promise.all([
            get('attendance_logs', `${date}_${USER_ID}`, accessToken),
            ...BRANCHES.map(branch => get('schedules', `${branch}__${date}`, accessToken, true))
        ]);
        assert.equal(attendance.dataRepairId, REPAIR_ID);
        assert.equal(attendance.sessions.length, 1);
        assert.equal(attendance.sessions[0].linkedClassStart, '10:30');

        const schedule = {};
        branchSchedules.forEach((branchSchedule, branchIndex) => {
            Object.entries(branchSchedule).forEach(([section, rows]) => {
                if (!/^(morning|afternoon|evening)/.test(section) || !Array.isArray(rows)) return;
                schedule[section] = (schedule[section] || []).concat(rows.map((row, index) => ({
                    ...row,
                    _branch: BRANCHES[branchIndex],
                    _compositeKey: `${BRANCHES[branchIndex]}__${date}`,
                    _originalIndex: index
                })));
            });
        });
        const chips = calculateDailyChips(schedule, attendance.sessions, USER_ID, date, user);
        const worked = chips.filter(chip => !chip.isAbsent && Number(chip.paidMinutes) > 0);
        const totalMinutes = worked.reduce((sum, chip) => sum + Number(chip.paidMinutes || 0), 0);
        assert.equal(totalMinutes, target.expectedPaidMinutes,
            `${date} phải đủ ${target.expectedPaidMinutes} phút sau policy thưởng`);
        assert.equal(worked.length, 1, `${date} phải chỉ có một chip tính công`);
        assert.match(worked[0].text, /10:30–14:30.*BTH/);
        assert.equal(worked[0].class, 'chip-green');
        assert.equal(worked[0].isWarning, undefined);
        if (target.keepsApprovedEarly10) assert.match(worked[0].text, /\+10p/);
        else assert.doesNotMatch(worked[0].text, /\+10p/);

        if (date === '2026-08-22') {
            const originalSchedule = fields(backupPayload.schedule22.fields);
            const originalRows = originalSchedule.morning2;
            const currentRows = branchSchedules[0].morning2;
            assert.equal(currentRows.length, originalRows.length, 'không được thêm/xóa dòng lịch khác');
            currentRows.forEach((row, index) => {
                if (index !== 11) {
                    assert.deepEqual(row, originalRows[index], `dòng lịch morning2[${index}] không được thay đổi`);
                    return;
                }
                const currentTarget = structuredClone(row);
                const originalTarget = structuredClone(originalRows[index]);
                delete currentTarget.start;
                delete currentTarget.end;
                delete currentTarget.dataRepairId;
                delete currentTarget.repairMeta;
                delete originalTarget.start;
                delete originalTarget.end;
                assert.deepEqual(currentTarget, originalTarget, 'dòng của Vy chỉ được đổi giờ và thêm dấu audit');
            });

            const originalAttendance = fields(backupPayload.attendance22.fields);
            const currentSession = structuredClone(attendance.sessions[0]);
            const originalSession = structuredClone(originalAttendance.sessions[0]);
            for (const key of ['linkedClassStart', 'branch', 'dataRepairId', 'editHistory']) {
                delete currentSession[key];
                delete originalSession[key];
            }
            assert.deepEqual(currentSession, originalSession,
                'sửa liên kết ngày 22 không được làm mất thuộc tính công cũ');
        }
        results.push({
            date,
            totalMinutes,
            chip: { text: worked[0].text, class: worked[0].class, paidMinutes: worked[0].paidMinutes }
        });
    }
    console.log(JSON.stringify({ status: 'passed', project: PROJECT, staff: USER_NAME, results }, null, 2));
})().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
