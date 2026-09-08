'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const start = main.indexOf('(function setupAppAutoUpdate()');
const end = main.indexOf('})();', start) + 5;
assert.ok(start >= 0 && end > start);
function createUpdateHarness() {
    const listeners = {}, inputs = {}, elements = {}, stored = new Map();
    let reloads = 0;
    const window = { location: { reload() { reloads++; } }, addEventListener() {} };
    const document = { addEventListener: (name, cb) => { inputs[name] = cb; },
        getElementById: id => elements[id], createElement: () => ({ style: {} }),
        body: { appendChild: element => { elements[element.id] = element; } } };
    const navigator = { serviceWorker: { addEventListener: (name, cb) => { listeners[name] = cb; } } };
    new Function('window', 'document', 'navigator', 'sessionStorage', 'APP_VERSION', main.slice(start, end))(
        window, document, navigator, { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) }, 'test-version');
    return { window, document, inputs, elements, reloads: () => reloads,
        update: () => listeners.message({ data: { type: 'APP_UPDATED', version: 'new-version' } }) };
}
for (const flag of ['__attendanceCheckInPending', '__attendanceCheckOutPending', '__adminPayrollSavePending',
    '__classClosurePending', '__payrollWritePending', '__scheduleMutationPending']) {
    const h = createUpdateHarness();
    h.window[flag] = true;
    h.update();
    assert.equal(h.reloads(), 0, flag + ' must block automatic reload');
    h.elements['app-update-ready'].onclick();
    assert.equal(h.reloads(), 0, flag + ' must also block the update button');
    h.window[flag] = false;
    h.elements['app-update-ready'].onclick();
    assert.equal(h.reloads(), 1, 'explicit reload works after write finishes');
}
const dirty = createUpdateHarness(); dirty.inputs.input(); dirty.update();
assert.equal(dirty.reloads(), 0, 'unsaved inputs survive update');
const clean = createUpdateHarness(); clean.update(); clean.update();
assert.equal(clean.reloads(), 1, 'untouched login reloads at most once per page');

(async () => {
    const source = fs.readFileSync(path.join(root, 'js/schedule.js'), 'utf8');
    const begin = source.indexOf('function beginScheduleMutation(key)');
    const finish = source.indexOf('function resolveScheduleRowIndex', begin);
    const window = {};
    const harness = new Function('window', 'document', 'renderTable',
        'const scheduleMutationsPending = new Set();\n' + source.slice(begin, finish) +
        '\nreturn { beginScheduleMutation, finishScheduleMutation };')(window, { getElementById: () => null }, async () => {});
    assert.equal(harness.beginScheduleMutation('one'), true);
    assert.equal(harness.beginScheduleMutation('one'), false);
    harness.beginScheduleMutation('two');
    assert.equal(window.__scheduleMutationPending, true);
    await harness.finishScheduleMutation('one');
    assert.equal(window.__scheduleMutationPending, true, 'other concurrent write still protects page');
    await harness.finishScheduleMutation('two');
    assert.equal(window.__scheduleMutationPending, false);
    console.log('PASS PWA updates preserve attendance/payroll/schedule writes, unsaved inputs, and explicit recovery');
})().catch(error => { console.error(error); process.exitCode = 1; });
