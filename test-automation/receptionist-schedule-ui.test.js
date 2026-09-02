const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const roster = read('js/receptionist-schedule.js');
const receptionistPage = read('lich-tiep-tan.html');
const officePage = read('lich-van-phong.html');

// Evaluate pure helpers without booting Firebase or a browser.
const context = vm.createContext({
    window: {
        WORK_SCHEDULE_CONTEXT: { type: 'receptionist' },
        addEventListener() {}
    },
    document: {
        addEventListener() {},
        querySelectorAll() { return []; }
    },
    localStorage: {
        getItem() { return null; },
        setItem() {}
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout
});
vm.runInContext(roster, context, { filename: 'receptionist-schedule.js' });

const evaluate = expression => vm.runInContext(expression, context);
assert.equal(
    JSON.stringify(evaluate(`validateTimeRange('07:05', '11:30', 'Ca sáng')`)),
    JSON.stringify({ start: '07:05', end: '11:30' })
);
assert.throws(() => evaluate(`validateTimeRange('7:05', '11:30', 'Ca sáng')`), /HH:mm/);
assert.throws(() => evaluate(`validateTimeRange('24:00', '25:00', 'Ca sáng')`), /HH:mm/);
assert.throws(() => evaluate(`validateTimeRange('11:30', '11:30', 'Ca sáng')`), /sớm hơn/);
assert.throws(() => evaluate(`validateTimeRange('18:00', '09:00', 'Ca sáng')`), /sớm hơn/);
assert.equal(evaluate(`escapeHtml('<img src=x onerror="alert(1)">')`), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
assert.equal(evaluate(`sanitizeScheduleColor('red; background:url(javascript:1)')`), '#E5E7EB');
assert.equal(evaluate(`sanitizeScheduleColor('#12aBcD')`), '#12aBcD');

for (const [name, page] of [
    ['lich-tiep-tan.html', receptionistPage],
    ['lich-van-phong.html', officePage]
]) {
    assert.match(page, /<body class="work-schedule-page">/, `${name} must opt into the shared responsive shell`);
    assert.match(page, /id="cell-modal" role="dialog" aria-modal="true" aria-hidden="true"/);
    assert.match(page, /class="cell-modal-header"[\s\S]*?class="cell-modal-body"[\s\S]*?class="cell-modal-footer"/,
        `${name} must keep modal header/footer outside the scrolling body`);
    assert.match(page, /aria-labelledby="cell-modal-title" aria-describedby="cell-modal-description"/);
    assert.match(page, /id="cell-modal-error" role="alert" hidden/);
    assert.match(page, /@media \(max-width: 1100px\) and \(min-width: 769px\)/,
        `${name} must have a tablet layout`);
    assert.match(page, /@media \(max-width: 768px\)[\s\S]*?\.cell-modal[\s\S]*?align-items:\s*flex-end/,
        `${name} must turn the editor into a mobile bottom sheet`);
    assert.match(page, /\.schedule-table th:first-child[\s\S]*?position:\s*sticky[\s\S]*?left:\s*0/);
    assert.match(page, /receptionist-schedule\.js\?v=20260902-policy-payroll-absence-v1/,
        `${name} must request the upgraded script cache key`);
}

assert.match(roster, /function handleScheduleKeydown\(event\)[\s\S]*?event\.key === 'Escape'/);
assert.match(roster, /lastModalTrigger[\s\S]*?requestAnimationFrame\(\(\) => trigger\.focus\(\)\)/,
    'Closing the modal must restore focus to its trigger');
assert.match(roster, /positionAbsentPopup[\s\S]*?getBoundingClientRect[\s\S]*?window\.innerWidth[\s\S]*?window\.innerHeight/,
    'Absence popover must be clamped to both viewport axes');
assert.match(roster, /escapeHtml\(shortName\)[\s\S]*?escapeHtml\(shiftLabel\)/,
    'Popover content coming from roster data must be escaped');
assert.match(roster, /UIService\.confirm\(escapeHtml\(confirmationMessage\)\)/,
    'Dynamic staff names must be escaped before reaching the shared HTML-based confirm dialog');
assert.match(roster, /UIService\.toast\(escapeHtml\(message\), 'error'\)/,
    'Dynamic write errors must be escaped before reaching the shared HTML-based toast');
assert.match(roster, /sanitizeScheduleColor\(user\.scheduleColor\)/,
    'User-controlled schedule colors must be allow-listed');
assert.match(roster, /validateTimeRange\(customStart, customEnd/,
    'Per-person custom times must be validated before updating local roster state');

const saveStart = roster.indexOf('async function saveFullWeek()');
const confirmStart = roster.indexOf('async function confirmInheritedSchedule()');
const saveBody = roster.slice(saveStart, confirmStart);
assert.ok(saveStart >= 0 && confirmStart > saveStart, 'saveFullWeek must remain defined');
assert.ok(saveBody.indexOf('nextShiftConfig = readShiftConfigFromUI()') < saveBody.indexOf('Lock today/future days'),
    'Edited shift config must be read before future-day snapshots are created');
assert.ok(saveBody.indexOf('await saveWorkSchedule(key, weekData, loadedScheduleRevision)') < saveBody.indexOf('await saveShiftConfigToFirestore(nextShiftConfig)'),
    'Global defaults must not change when the roster document fails to save');
assert.match(saveBody, /catch \(e\)[\s\S]*?return false;[\s\S]*?finally/,
    'Write errors must return a failed result instead of falling through as success');
assert.match(saveBody, /existingData\?\.\[shift\]\?\.\[dayKey\][\s\S]*?JSON\.parse\(JSON\.stringify\(historicalRoster\)\)/,
    'Past rosters must be restored exactly from the loaded snapshot');
assert.match(roster, /isPastDay[\s\S]*?classList\.add\('past-locked'\)[\s\S]*?isEditor && !isPastDay/,
    'Past cells must not expose roster-edit actions');
assert.match(roster, /receptionist_lead[\s\S]*?receptionist_staff/,
    'All supported receptionist role aliases must appear in the picker');
assert.match(roster, /scheduleLoadGeneration[\s\S]*?loadGeneration !== scheduleLoadGeneration/,
    'Stale week loads must be ignored');

const dbSource = read('js/db-service.js');
for (const methodName of ['saveReceptionistSchedule', 'saveOfficeSchedule']) {
    const start = dbSource.indexOf(`async ${methodName}`);
    const end = dbSource.indexOf('\n    },', start);
    const body = dbSource.slice(start, end);
    assert.match(body, /db\.runTransaction/);
    assert.match(body, /currentRevision !== expectedRevision/);
    assert.match(body, /SCHEDULE_CONFLICT/);
}
for (const methodName of ['unassignReceptionist', 'unassignOfficeStaff']) {
    const start = dbSource.indexOf(`async ${methodName}`);
    const end = dbSource.indexOf('\n    },', start);
    const body = dbSource.slice(start, end);
    assert.match(body, /_revision:\s*currentRevision \+ 1/,
        `${methodName} must invalidate stale week editors by advancing the revision`);
    assert.match(body, /_updatedBy/);
}

const shiftSaveStart = roster.indexOf('async function saveShiftConfigToFirestore');
const branchStart = roster.indexOf('// ==================== NAVIGATION', shiftSaveStart);
const shiftSaveBody = roster.slice(shiftSaveStart, branchStart);
assert.doesNotMatch(shiftSaveBody, /catch\s*\(/,
    'Shift-config writes must propagate failures to saveFullWeek');
assert.doesNotMatch(roster.slice(confirmStart), /toast\([^)]*xác nhận lịch kế thừa/i,
    'Inherited confirmation must not display a second success toast after a failed save');

// Exercise the write boundary: neither a roster-write failure nor a subsequent
// settings-write failure may resolve as success or emit a success toast.
(async () => {
    const fakeInput = value => ({
        value,
        classList: { add() {}, remove() {} },
        removeAttribute() {},
        setAttribute() {},
        focus() {}
    });
    const inputs = {
        'shift-morning-start': fakeInput('07:00'),
        'shift-morning-end': fakeInput('11:30'),
        'shift-afternoon-start': fakeInput('14:00'),
        'shift-afternoon-end': fakeInput('18:00'),
        'shift-evening-start': fakeInput('17:30'),
        'shift-evening-end': fakeInput('21:30')
    };
    context.document.getElementById = id => inputs[id] || null;
    context.document.querySelectorAll = () => [];
    context.__toasts = [];
    context.UIService = {
        toast(message, type) { context.__toasts.push({ message, type }); },
        async confirm() { return true; }
    };
    context.alert = message => context.__toasts.push({ message, type: 'alert' });
    evaluate(`
        weekData = {
            morning: Object.fromEntries(DAY_KEYS.map(day => [day, []])),
            afternoon: Object.fromEntries(DAY_KEYS.map(day => [day, []])),
            evening: Object.fromEntries(DAY_KEYS.map(day => [day, []])),
            _notes: {}
        };
        isInheritedTemplate = false;
        isSavingWeek = false;
    `);

    let settingsWrites = 0;
    context.DBService = {
        async getSystemSettings() { return {}; },
        async getReceptionistSchedule() { return null; },
        async saveReceptionistSchedule() { throw new Error('roster write failed'); },
        async saveSystemSettings() { settingsWrites += 1; }
    };
    assert.equal(await evaluate('saveFullWeek()'), false);
    assert.equal(settingsWrites, 0, 'Global shift defaults must not be written after a roster failure');
    assert.equal(context.__toasts.at(-1).type, 'error');
    assert.equal(context.__toasts.some(toast => toast.type === 'success'), false);

    context.__toasts.length = 0;
    context.DBService.saveReceptionistSchedule = async () => {};
    context.DBService.saveSystemSettings = async () => {
        settingsWrites += 1;
        throw new Error('settings write failed');
    };
    assert.equal(await evaluate('saveFullWeek()'), false);
    assert.equal(context.__toasts.at(-1).type, 'error');
    assert.match(context.__toasts.at(-1).message, /Lịch tuần đã được lưu, nhưng chưa cập nhật được giờ ca mặc định/);
    assert.equal(context.__toasts.some(toast => toast.type === 'success'), false);

    context.__toasts.length = 0;
    context.DBService.saveSystemSettings = async () => { settingsWrites += 1; };
    assert.equal(await evaluate('saveFullWeek()'), true);
    assert.deepEqual(context.__toasts.map(toast => toast.type), ['success']);

    console.log('receptionist-schedule-ui.test.js: all assertions passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
