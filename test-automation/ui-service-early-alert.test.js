'use strict';
// Scripts in <head> (auth-guard.js) call alert() before <body> exists. The
// UIService alert override used to throw on document.body.appendChild, which
// aborted the guard's redirect and left staff on a broken page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function fakeElement(tag) {
    const el = {
        tagName: String(tag).toUpperCase(),
        children: [],
        className: '',
        dataset: {},
        style: {},
        classList: { add() {}, remove() {}, contains: () => false },
        appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
        querySelectorAll() { return []; },
        addEventListener() {},
        setAttribute() {},
        remove() {}
    };
    let html = '';
    Object.defineProperty(el, 'innerHTML', { get: () => html, set: value => { html = String(value); } });
    return el;
}

function run(pathname, role) {
    const documentElement = fakeElement('html');
    const document = {
        body: null,
        documentElement,
        createElement: fakeElement,
        querySelector(selector) {
            if (selector !== '.toast-container') return null;
            return documentElement.children.find(child => child.className === 'toast-container') || null;
        },
        getElementById: () => null,
        querySelectorAll: () => []
    };
    const store = new Map([['currentUser', 'fixture'], ['currentRole', JSON.stringify([role])]]);
    const location = { pathname, href: pathname, replace(url) { this.href = url; } };
    const context = {
        document,
        localStorage: {
            getItem: key => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        console: { log() {}, warn() {}, error() {} },
        setTimeout: () => 0,
        location
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/ui-service.js'), 'utf8'), context, { filename: 'ui-service.js' });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/auth-guard.js'), 'utf8'), context, { filename: 'auth-guard.js' });
    return { context, documentElement };
}

{
    const { context, documentElement } = run('/lich-van-phong.html', 'teaching_assistant');
    assert.equal(context.location.href, 'nhan-vien.html', 'guard must still redirect after alerting');
    const container = documentElement.children.find(child => child.className === 'toast-container');
    assert.ok(container, 'toast container falls back to <html> while <body> is missing');
    assert.equal(container.children.length, 1, 'the permission message is shown as a toast');
}

{
    const { context } = run('/lich-van-phong.html', 'admin');
    assert.equal(context.location.href, '/lich-van-phong.html', 'allowed roles are not redirected');
}

console.log('ui-service-early-alert.test.js: all assertions passed');
