const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/schedule.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'js/db-service.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const day = '2026-09-14';
const key = `cs1__${day}`;
const row = (id, extra = {}) => ({ shiftId: id, start: '07:30', end: '09:00', lop: 'E5', lopId: 'e5',
    phong: 'P1', note: '', soHS: 0, registeredTeachers: [], gvList: [{ id: 'teacher-1', name: 'Teacher' }], ...extra });
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
};

function harness() {
    const elements = new Map();
    function element() {
        return { dataset: {}, style: {}, innerHTML: '', innerText: '', value: '', inert: false,
            classList: { add() {}, remove() {}, toggle() {} },
            setAttribute(name, value) { this[name] = value; },
            addEventListener() {}, appendChild(child) { if (child.id) elements.set(child.id, child); },
            querySelectorAll() { return []; }, querySelector() { return null; }, focus() {},
            remove() { elements.delete(this.id); } };
    }
    ['table-body', 'current-day-label', 'day-tabs', 'week-display', 'prev-week', 'next-week'].forEach(id => elements.set(id, element()));
    const document = {
        addEventListener() {}, getElementById: id => elements.get(id) || null,
        createElement: element, querySelector() { return null; }, querySelectorAll() { return []; },
        contains() { return true; }, body: element()
    };
    const storage = new Map([['currentRole', 'admin'], ['currentUserId', 'admin-1']]);
    const localStorage = { getItem: name => storage.get(name) || null,
        setItem: (name, value) => storage.set(name, value), removeItem: name => storage.delete(name) };
    const store = new Map([['settings/system', { centerClosures: {}, payRate: 987, branches: ['cs1', 'cs2'] }]]);
    const messages = [], writes = [], reads = [];
    let beforeWrite = null;
    const firestore = {
        collection(name) {
            return { doc(id) { return { path: `${name}/${id}`, id,
                async get(options) { reads.push({ path: this.path, options }); return snapshot(this); } }; } };
        },
        async runTransaction(callback) {
            for (let attempt = 0; attempt < 3; attempt++) {
                const pending = [];
                const result = await callback({
                    get: async ref => snapshot(ref),
                    set: (ref, value) => pending.push({ ref, value: clone(value), update: false }),
                    update: (ref, value) => pending.push({ ref, value: clone(value), update: true })
                });
                if (beforeWrite) { const action = beforeWrite; beforeWrite = null; action(store); continue; }
                for (const write of pending) {
                    if (write.update) {
                        const existing = clone(store.get(write.ref.path));
                        for (const [field, value] of Object.entries(write.value)) {
                            const parts = field.split('.');
                            let destination = existing;
                            parts.slice(0, -1).forEach(part => { destination = destination[part] ||= {}; });
                            destination[parts.at(-1)] = value;
                        }
                        store.set(write.ref.path, existing);
                    } else store.set(write.ref.path, write.value);
                    writes.push(write);
                }
                return result;
            }
            throw new Error('retry limit');
        }
    };
    function snapshot(ref) {
        const value = store.get(ref.path);
        return { exists: value != null, data: () => clone(value), id: ref.id };
    }
    class FixtureDate extends Date {
        constructor(...args) { super(...(args.length ? args : ['2026-09-08T12:00:00+07:00'])); }
        static now() { return new FixtureDate().getTime(); }
    }
    const context = vm.createContext({
        document, localStorage, navigator: {}, Date: FixtureDate, Map, Set, URLSearchParams,
        console: { log() {}, error() {}, warn() {} }, setTimeout, clearTimeout,
        requestAnimationFrame: callback => callback(),
        alert: text => messages.push({ text, type: 'alert' }),
        UIService: { toast: (text, type) => messages.push({ text, type }), confirm: async () => true },
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
        db: firestore, location: { search: '' }, scrollY: 0, scrollTo() {},
        addEventListener() {}
    });
    context.window = context;
    vm.runInContext(`${dbSource}\nglobalThis.service = DBService;`, context);
    const service = context.service;
    service.updateScheduleManifest = async () => true;
    service.getSchedule = async (_key, options) => {
        assert.equal(options?.source, 'server', 'editor must use error-propagating fresh reads');
        return clone(store.get(`schedules/${_key}`) || {});
    };
    service.getAllCancelledShifts = async () => ({});
    service.getDayAttendance = async () => new Map();
    vm.runInContext(source, context);
    const realRender = context.renderTable;
    vm.runInContext('renderTable = async function () {};', context);
    return { context, service, store, writes, messages, reads, elements, element, realRender,
        run: code => vm.runInContext(code, context),
        race: callback => { beforeWrite = callback; },
        locator: value => JSON.stringify(context.scheduleEditLocator(value, 0)) };
}

const cases = [];
const test = (name, action) => cases.push({ name, action });

test('adding to an inherited date preserves every inherited section and rejects duplicate taps', async () => {
    const h = harness();
    const inherited = { morning1: [row('inherited')], evening1: [row('evening', { start: '18:00', end: '19:30', note: 'keep' })] };
    const wait = deferred();
    h.service.getSchedule = () => wait.promise;
    const adding = h.context.addNewRow(key, 'morning1', '07:30', '09:00');
    await h.context.addNewRow(key, 'morning1', '07:30', '09:00');
    wait.resolve(clone(inherited));
    await adding;
    const saved = h.store.get(`schedules/${key}`);
    assert.equal(saved.morning1.length, 2);
    assert.deepEqual(saved.evening1, inherited.evening1);
    assert.equal(h.writes.length, 1);
});

test('retry during inherited add preserves a concurrently created daily schedule', async () => {
    const h = harness();
    h.service.getSchedule = async () => ({ morning1: [row('template')] });
    h.race(store => store.set(`schedules/${key}`, { morning1: [row('other-editor')], evening2: [row('keep')] }));
    await h.context.addNewRow(key, 'morning1', '07:30', '09:00');
    assert.equal(h.store.get(`schedules/${key}`).morning1[0].shiftId, 'other-editor');
    assert.equal(h.store.get(`schedules/${key}`).evening2[0].shiftId, 'keep');
});

test('row edit follows its rendered shift ID after another editor reorders rows', async () => {
    const h = harness(), a = row('a'), b = row('b');
    h.store.set(`schedules/${key}`, { morning1: [b, a] });
    await h.context.updateRow(key, 'morning1', 0, 'note', 'edited A', h.locator(a));
    const saved = h.store.get(`schedules/${key}`).morning1;
    assert.equal(saved[0].note, '');
    assert.equal(saved[1].note, 'edited A');
});

test('a replaced row with the same signature cannot receive the old row edit on transaction retry', async () => {
    const h = harness(), a = row('a');
    h.store.set(`schedules/${key}`, { morning1: [a] });
    h.race(store => store.set(`schedules/${key}`, { morning1: [row('replacement')] }));
    await h.context.updateRow(key, 'morning1', 0, 'note', 'must not save', h.locator(a));
    assert.equal(h.writes.length, 0);
    assert.equal(h.store.get(`schedules/${key}`).morning1[0].note, '');
    assert.equal(h.messages.at(-1).type, 'error');
});

test('same-field concurrent changes conflict; unrelated fields survive', async () => {
    const h = harness(), a = row('a');
    h.store.set(`schedules/${key}`, { morning1: [a] });
    h.race(store => store.get(`schedules/${key}`).morning1[0].note = 'someone else');
    await h.context.updateRow(key, 'morning1', 0, 'note', 'mine', h.locator(a));
    assert.equal(h.writes.length, 0);
    await h.context.updateRow(key, 'morning1', 0, 'soHS', 12, h.locator(a));
    assert.equal(h.store.get(`schedules/${key}`).morning1[0].note, 'someone else');
    assert.equal(h.store.get(`schedules/${key}`).morning1[0].soHS, 12);
});

test('delete and subject edit follow the rendered row instead of a reused array index', async () => {
    const h = harness(), a = row('a'), b = row('b');
    h.store.set(`schedules/${key}`, { morning1: [b, a] });
    h.context._subjectList = [{ name: 'E6', id: 'e6' }];
    await h.context.updateSubjectRow(key, 'morning1', 0, 'E6', h.locator(a));
    assert.equal(h.store.get(`schedules/${key}`).morning1[1].lopId, 'e6');
    await h.context.deleteRow(key, 'morning1', 0, h.locator(a));
    assert.equal(h.store.get(`schedules/${key}`).morning1.length, 2, 'old signature cannot delete a changed class');
    const updated = h.store.get(`schedules/${key}`).morning1[1];
    await h.context.deleteRow(key, 'morning1', 0, h.locator(updated));
    assert.deepEqual(h.store.get(`schedules/${key}`).morning1.map(item => item.shiftId), ['b']);
});

test('invalid time windows and negative/fractional student counts never persist', async () => {
    for (const [field, value] of [['start', ''], ['end', '07:00'], ['start', '25:00'], ['soHS', -1], ['soHS', 1.5]]) {
        const h = harness(), a = row('a');
        h.store.set(`schedules/${key}`, { morning1: [a] });
        await h.context.updateRow(key, 'morning1', 0, field, value, h.locator(a));
        assert.equal(h.writes.length, 0, `${field}=${value}`);
    }
});

test('fresh read failures are caught for add/edit/subject/delete; save status reports failure', async () => {
    for (const action of ['add', 'edit', 'subject', 'delete']) {
        const h = harness();
        h.service.getSchedule = async () => { throw new Error('offline'); };
        if (action === 'add') await h.context.addNewRow(key, 'morning1', '07:30', '09:00');
        if (action === 'edit') await h.context.updateRow(key, 'morning1', 0, 'note', 'new');
        if (action === 'subject') await h.context.updateSubjectRow(key, 'morning1', 0, 'E6');
        if (action === 'delete') await h.context.deleteRow(key, 'morning1', 0);
        assert.equal(h.writes.length, 0);
        h.context.saveScheduleManual();
        assert.equal(h.messages.at(-1).type, 'error', action);
        assert.equal(h.run('scheduleMutationsPending.size'), 0);
    }
});

test('manual save cannot claim completion during a pending server write', async () => {
    const h = harness(), wait = deferred();
    h.service.getSchedule = () => wait.promise;
    const mutation = h.context.addNewRow(key, 'morning1', '07:30', '09:00');
    h.context.saveScheduleManual();
    assert.equal(h.messages.at(-1).type, 'warning');
    wait.resolve({});
    await mutation;
});

test('reopening a legacy period/day requires explicit scope confirmation and preserves independently closed slots', async () => {
    for (const legacy of ['all', 'morning', 'morning1']) {
        const h = harness();
        let prompt = '';
        h.context.UIService.confirm = async message => { prompt = message; return true; };
        h.store.get('settings/system').centerClosures = { [day]: [legacy, 'morning2', 'evening'], '2026-09-15': ['evening1'] };
        await h.context.toggleSectionClosure(day, 'morning1', false);
        const saved = h.store.get('settings/system');
        assert.equal(h.context.isCenterClosed(day, 'morning1', saved.centerClosures), false);
        assert.equal(h.context.isCenterClosed(day, 'morning2', saved.centerClosures), true);
        assert.equal(h.context.isCenterClosed(day, 'evening', saved.centerClosures), true, 'reception/office parent remains unchanged');
        assert.match(prompt, legacy === 'all' ? /Mở lại cả ngày/ : legacy === 'morning' ? /Mở lại cả buổi/ : /Mở lại Sáng - Ca 1/);
        assert.deepEqual(saved.centerClosures['2026-09-15'], ['evening1']);
        assert.equal(saved.payRate, 987);
        assert.deepEqual(Object.keys(h.writes[0].value), [`centerClosures.${day}`]);
    }
});

test('reopening the final closure persists an empty date; changed scope conflicts on retry', async () => {
    const h = harness();
    h.store.get('settings/system').centerClosures = { [day]: ['morning1'] };
    await h.context.toggleSectionClosure(day, 'morning1', false);
    assert.deepEqual(h.store.get('settings/system').centerClosures[day], []);
    const writes = h.writes.length;
    h.store.get('settings/system').centerClosures[day] = ['morning'];
    h.race(store => { store.get('settings/system').centerClosures[day] = ['all']; });
    await h.context.toggleSectionClosure(day, 'morning1', false);
    assert.equal(h.writes.length, writes);
    assert.deepEqual(h.store.get('settings/system').centerClosures[day], ['all']);
});

test('concurrent section closures survive Firestore transaction retry', async () => {
    const h = harness();
    h.race(store => {
        store.get('settings/system').centerClosures[day] = ['evening2'];
        store.get('settings/system').payRate = 999;
    });
    await h.context.toggleSectionClosure(day, 'morning1', true);
    assert.deepEqual(h.store.get('settings/system').centerClosures[day].sort(), ['evening2', 'morning1']);
    assert.equal(h.store.get('settings/system').payRate, 999);
});

test('failed or cancelled closure does not modify settings and releases the pending guard', async () => {
    const h = harness(), before = clone(h.store.get('settings/system'));
    h.context.UIService.confirm = async () => false;
    await h.context.toggleSectionClosure(day, 'morning1', true);
    assert.deepEqual(h.store.get('settings/system'), before);
    h.context.UIService.confirm = async () => true;
    h.context.db.runTransaction = async () => { throw new Error('permission-denied'); };
    await h.context.toggleSectionClosure(day, 'morning1', true);
    assert.equal(h.messages.at(-1).type, 'error');
    assert.equal(h.run('scheduleMutationsPending.size'), 0);
});

test('class close/open targets the original row when rows move and retains the audit command', async () => {
    const h = harness(), a = row('a'), b = row('b');
    h.store.set(`schedules/${key}`, { morning1: [b, a] });
    h.run('requestClassClosureReason = async () => "Parents reported a closure";');
    const commands = [];
    h.service.updateScheduleRowAtomic = async (_key, section, locator, apply) => {
        commands.push(clone(locator.closureCommand));
        const rows = h.store.get(`schedules/${_key}`)[section];
        const index = rows.findIndex(item => item.shiftId === locator.shiftId);
        rows[index] = apply(rows[index]);
    };
    await h.context.toggleClassClosure(key, 'morning1', 0, true, h.locator(a));
    assert.equal(h.store.get(`schedules/${key}`).morning1[0].isClosed, undefined);
    assert.equal(h.store.get(`schedules/${key}`).morning1[1].isClosed, true);
    await h.context.toggleClassClosure(key, 'morning1', 0, false, h.locator(a));
    assert.equal(h.store.get(`schedules/${key}`).morning1[1].isClosed, false);
    assert.deepEqual(commands.map(command => command.expectedClosed), [false, true]);
    assert.ok(commands.every(command => command.reason && Array.isArray(command.registeredStaffIds)));
});

test('navigation rejects stale results; load error removes old editable rows and allows retry', async () => {
    const h = harness(), first = deferred(), second = deferred();
    h.run('currentWeekStart = new Date(2026, 8, 14); selectedDayIndex = 0; renderDayTabs = function () {};');
    h.service.getSchedule = k => k.startsWith('cs1') ? first.promise : second.promise;
    const body = h.elements.get('table-body');
    body.dataset.rendered = '1'; body.innerHTML = 'OLD EDITABLE ROWS';
    const initial = h.realRender();
    assert.equal(body.inert, true);
    h.run("currentBranch = 'cs2';");
    const next = h.realRender();
    second.resolve({}); await next;
    const html = body.innerHTML;
    assert.equal(body.inert, false);
    first.reject(new Error('old request failed')); await initial;
    assert.equal(body.innerHTML, html);
    assert.match(h.elements.get('current-day-label').innerText, /Cơ Sở 2/);
    h.service.getSchedule = async () => { throw new Error('new request failed'); };
    await h.realRender();
    assert.doesNotMatch(body.innerHTML, /addNewRow|OLD EDITABLE ROWS/);
    assert.match(body.innerHTML, /Tải lại lịch/);
    assert.equal(body.inert, false);
    h.service.getSchedule = async () => ({});
    await h.realRender();
    assert.match(body.innerHTML, /addNewRow/);
});

test('closure settings read errors cannot render apparently open shifts', async () => {
    const h = harness();
    h.run('currentWeekStart = new Date(2026, 8, 14); selectedDayIndex = 0;');
    h.context.readScheduleClosureSettings = async () => { throw new Error('offline'); };
    await h.realRender();
    assert.match(h.elements.get('table-body').innerHTML, /Tải lại lịch/);
    assert.doesNotMatch(h.elements.get('table-body').innerHTML, /Ca hoạt động/);
});

test('payroll review date selects the correct week/day and invalid dates are ignored', async () => {
    for (const [query, expected, branch] of [
        ['?date=2026-09-20&staffId=staff-1&branch=cs2', '2026-09-20', 'cs2'],
        ['?date=2026-08-01&branch=cs3', '2026-08-01', 'cs3'],
        ['?date=2026-02-31&branch=unknown', '2026-09-08', 'cs1'],
        ['?date=not-a-date', '2026-09-08', 'cs1']
    ]) {
        const h = harness();
        h.context.location.search = query;
        h.run('renderWeekPicker = renderDayTabs = loadTeacherListForSchedule = loadSubjectListForSchedule = function () {};');
        h.context.initSchedule();
        assert.equal(h.run('(() => { const d = new Date(currentWeekStart); d.setDate(d.getDate() + selectedDayIndex); return getLocalDateKey(d); })()'), expected);
        assert.equal(h.run('currentBranch'), branch);
        assert.equal(h.context.location.search, query);
    }
});

test('saving staffing cannot close or replace the manager while its write is in flight', async () => {
    const h = harness();
    h.run('teacherShiftManagerState = { saving: true };');
    assert.equal(h.context.closeTeacherShiftManager(), false);
    assert.equal(h.run('teacherShiftManagerState.saving'), true);
});

test('a pending staffing popup does not open after navigating to another week or branch', async () => {
    const h = harness(), wait = deferred();
    h.service.getSchedule = () => wait.promise;
    h.service.getAuthenticatedAuthorizationContext = async () => ({ roles: ['admin'] });
    const opening = h.context.openGVPicker(key, 'morning1', 0, 'gv');
    h.run("scheduleRenderGeneration += 1; currentBranch = 'cs2';");
    wait.resolve({ morning1: [row('a')] });
    await opening;
    assert.equal(h.run('teacherShiftManagerState'), null);
    assert.deepEqual(h.messages, []);
});

test('copy freezes its source week/branch and reports partial success without overwriting destinations', async () => {
    const h = harness();
    const modal = h.element(); modal.id = 'copy-week-modal';
    modal.dataset = { sourceMonday: '2026-09-14', sourceBranch: 'cs1' };
    h.elements.set(modal.id, modal);
    h.elements.set('copy-target-week', { value: '2026-09-21' });
    h.run("currentBranch = 'cs2'; currentWeekStart = new Date(2026, 9, 5);");
    const readKeys = [], writeKeys = [];
    h.service.getSchedule = async (sourceKey, options) => {
        readKeys.push(sourceKey);
        assert.equal(options.source, 'server');
        if (readKeys.length === 3) throw new Error('offline');
        return { morning1: [row('source', { isClosed: true, classClosureHistory: [{ reason: 'one date only' }] })] };
    };
    h.service.createScheduleIfMissing = async (targetKey, data) => {
        writeKeys.push(targetKey);
        assert.equal(data.morning1[0].isClosed, undefined);
        assert.equal(data.morning1[0].classClosureHistory, undefined);
        return writeKeys.length === 1;
    };
    await h.context.executeCopyWeek();
    assert.deepEqual(readKeys, ['cs1__2026-09-14', 'cs1__2026-09-15', 'cs1__2026-09-16']);
    assert.deepEqual(writeKeys, ['cs1__2026-09-21', 'cs1__2026-09-22']);
    assert.match(h.messages.at(-1).text, /Đã sao chép 1 ngày/);
    assert.equal(h.run('scheduleMutationsPending.size'), 0);
});

async function verifyBrowserControls() {
    const puppeteer = require('puppeteer-core');
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
    assert.ok(executablePath, 'Chrome or Edge is required for --browser');
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    try {
        for (const role of ['admin', 'senior_assistant']) {
            const page = await browser.newPage();
            await page.setViewport(role === 'admin' ? { width: 1365, height: 900 } : { width: 390, height: 844 });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setRequestInterception(true);
            page.on('request', request => {
                if (request.isNavigationRequest()) request.respond({ contentType: 'text/html', body:
                    '<div id="week-display"></div><button id="prev-week">Previous</button><button id="next-week">Next</button><div id="day-tabs"></div><div id="current-day-label"></div><table><tbody id="table-body"></tbody></table>' });
                else request.abort();
            });
            await page.goto('http://schedule-fixture.invalid/?date=2099-09-14&staffId=review-staff&branch=cs2');
            await page.evaluate(role => {
                localStorage.setItem('currentRole', role);
                localStorage.setItem('currentUserId', 'fixture-manager');
                window.fixtureRows = {};
                window.fixtureSettings = { centerClosures: {} };
                window.fixtureMessages = [];
                window.UIService = { toast: (text, type) => fixtureMessages.push({ text, type }), confirm: async () => true };
                window.db = {
                    collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => structuredClone(fixtureSettings) }) }) }),
                    runTransaction: async apply => apply({ get: async () => ({ exists: true, data: () => structuredClone(fixtureSettings) }),
                        update: (_ref, fields) => Object.entries(fields).forEach(([field, value]) => { fixtureSettings.centerClosures[field.split('.')[1]] = value; }) })
                };
                window.DBService = {
                    getSchedule: async () => structuredClone(fixtureRows), getAllCancelledShifts: async () => ({}),
                    getSubjects: async () => [{ id: 'e5', name: 'E5' }], getUsers: async () => [], _invalidate() {},
                    mutateScheduleSectionAtomic: async (_key, section, apply) => { fixtureRows[section] = apply(structuredClone(fixtureRows[section] || [])); },
                    updateScheduleRowAtomic: async (_key, section, locator, apply) => {
                        const index = fixtureRows[section].findIndex(row => row.shiftId === locator.shiftId);
                        fixtureRows[section][index] = apply(structuredClone(fixtureRows[section][index]));
                    }
                };
            }, role);
            await page.addScriptTag({ content: source });
            await page.evaluate(() => initSchedule());
            await page.waitForFunction(() => document.querySelector('.add-row-btn') && !document.getElementById('table-body').inert);
            assert.match(await page.$eval('#current-day-label', el => el.textContent), /14 tháng 9 năm 2099/);
            assert.match(await page.$eval('#current-day-label', el => el.textContent), /Cơ Sở 2.*chưa lọc theo nhân viên/);
            await page.click('.add-row-btn');
            await page.waitForFunction(() => fixtureRows.morning1?.length === 1 && !document.getElementById('table-body').inert);
            await page.type('[data-field="subject"] input', 'E5');
            await page.keyboard.press('Tab');
            await page.waitForFunction(() => fixtureRows.morning1[0].lopId === 'e5' && !document.getElementById('table-body').inert);
            const note = 'Check "quoted" & employee schedule';
            await page.type('[data-field="note"] input', note);
            await page.keyboard.press('Tab');
            await page.waitForFunction(note => fixtureRows.morning1[0].note === note && !document.getElementById('table-body').inert, {}, note);
            assert.equal(await page.$eval('[data-field="note"] input', el => el.value), note);
            await page.click('button[title="Xóa lớp"]');
            await page.waitForFunction(() => fixtureRows.morning1.length === 0 && !document.getElementById('table-body').inert);
            await page.click('.section-header input[type="checkbox"]');
            await page.waitForFunction(() => fixtureSettings.centerClosures['2099-09-14']?.includes('morning1') && !document.getElementById('table-body').inert);
            await page.click('.section-header input[type="checkbox"]');
            await page.waitForFunction(() => fixtureSettings.centerClosures['2099-09-14']?.length === 0 && !document.getElementById('table-body').inert);
            assert.deepEqual(errors, []);
            assert.deepEqual(await page.evaluate(() => fixtureMessages.filter(message => message.type === 'error')), []);
            console.log(`PASS actual browser controls: ${role}, add/subject/note/delete/close/reopen/date link`);
            await page.close();
        }
    } finally { await browser.close(); }
}

(async () => {
    for (const { name, action } of cases) {
        await action();
        console.log(`PASS ${name}`);
    }
    console.log(`schedule-editor-behavior.test.js: ${cases.length} behavioral scenarios passed (no emulator or production writes)`);
    if (process.argv.includes('--browser')) await verifyBrowserControls();
})().catch(error => { console.error(error); process.exitCode = 1; });
