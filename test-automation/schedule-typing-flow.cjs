'use strict';
// Owner report 29/09/2026: "chỗ xếp lịch cứ nháy mỗi khi điền một thông tin".
// Real browser: type into several cells of one class while each save is slow. The table
// must not dim or lock, focus and half-typed text must survive every re-render, and every
// edit must reach the (fake) server in order. Run: node schedule-typing-flow.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/schedule.js'), 'utf8');

(async () => {
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
    assert.ok(executablePath, 'Chrome or Edge is required');
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1365, height: 900 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (request.isNavigationRequest()) request.respond({ contentType: 'text/html', body:
                '<div id="week-display"></div><button id="prev-week">P</button><button id="next-week">N</button><div id="day-tabs"></div><div id="current-day-label"></div><table id="schedule-table"><tbody id="table-body"></tbody></table><datalist id="subject-list"><option value="E5"></option></datalist>' });
            else request.abort();
        });
        await page.goto('http://schedule-typing.invalid/?date=2099-09-14&branch=cs1');
        await page.evaluate(() => {
            localStorage.setItem('currentRole', 'admin');
            localStorage.setItem('currentUserId', 'fixture-manager');
            window.fixtureRows = { morning1: [{ shiftId: 'shift-a', start: '07:30', end: '09:00', lop: '', lopId: '', phong: '', note: '', soHS: 0, gvList: [] },
                { shiftId: 'shift-b', start: '07:30', end: '09:00', lop: '', lopId: '', phong: '', note: '', soHS: 0, gvList: [] }] };
            window.fixtureWrites = [];
            window.fixtureDim = [];
            window.fixtureInert = [];
            window.fixtureSettings = { centerClosures: {} };
            window.UIService = { toast: (text, type) => { if (type === 'error') window.fixtureErrors = (window.fixtureErrors || []).concat(text); }, confirm: async () => true };
            window.db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => structuredClone(fixtureSettings) }) }) }) };
            const slow = () => new Promise(resolve => setTimeout(resolve, 350));
            window.DBService = {
                getSchedule: async () => { await new Promise(r => setTimeout(r, 60)); return structuredClone(fixtureRows); },
                getAllCancelledShifts: async () => ({}), getDayAttendance: async () => new Map(),
                getSubjects: async () => [{ id: 'e5', name: 'E5' }], getUsers: async () => [], _invalidate() {},
                mutateScheduleSectionAtomic: async (_key, section, apply) => { fixtureRows[section] = apply(structuredClone(fixtureRows[section] || [])); },
                updateScheduleRowAtomic: async (_key, section, locator, apply) => {
                    await slow();
                    const index = fixtureRows[section].findIndex(row => row.shiftId === locator.shiftId);
                    const next = apply(structuredClone(fixtureRows[section][index]));
                    fixtureRows[section][index] = next;
                    fixtureWrites.push(Object.fromEntries(['lop', 'phong', 'note'].map(k => [k, next[k]])));
                    return structuredClone(next);
                }
            };
            new MutationObserver(() => {
                const body = document.getElementById('table-body');
                if (body.style.opacity) fixtureDim.push(body.style.opacity);
                if (body.inert) fixtureInert.push(true);
            }).observe(document.getElementById('table-body'), { attributes: true });
        });
        await page.addScriptTag({ content: source });
        await page.evaluate(() => { window._subjectList = [{ id: 'e5', name: 'E5' }]; initSchedule(); });
        await page.waitForFunction(() => document.querySelectorAll('#table-body tr[data-row-locator]').length === 2);
        await page.evaluate(() => { window.fixtureDim.length = 0; window.fixtureInert.length = 0; });

        const firstRow = 'tr[data-row-locator*="shift-a"]';
        // Nhập liền tay: Môn → Tab → Phòng → Tab ... → Ghi chú, không chờ lưu xong.
        await page.click(`${firstRow} [data-field="subject"] input`);
        await page.keyboard.type('E5');
        await page.keyboard.press('Tab');
        await page.keyboard.type('P101');
        // Lúc này lần lưu Môn đang chạy (350ms) và bảng sẽ vẽ lại; con trỏ phải còn ở ô Phòng.
        await new Promise(r => setTimeout(r, 500));
        const mid = await page.evaluate(() => ({
            field: document.activeElement?.closest('td')?.dataset.field,
            value: document.activeElement?.value
        }));
        assert.deepEqual(mid, { field: 'room', value: 'P101' }, 'ô đang gõ giữ con trỏ và chữ sau khi bảng vẽ lại');
        await page.keyboard.press('Tab'); // → GV cell button, then note later
        await page.click(`${firstRow} [data-field="note"] input`);
        await page.keyboard.type('Ghi chu 1');
        await page.click(`tr[data-row-locator*="shift-b"] [data-field="room"] input`);
        await page.keyboard.type('P202');
        await page.keyboard.press('Tab');
        await page.waitForFunction(() => fixtureWrites.length >= 4 && !window.__scheduleMutationPending, { timeout: 8000 });
        await new Promise(r => setTimeout(r, 400));

        const result = await page.evaluate(() => ({ rows: fixtureRows.morning1.map(r => [r.lop, r.phong, r.note]),
            dim: fixtureDim, inert: fixtureInert, errors: window.fixtureErrors || [],
            status: document.getElementById('schedule-save-status')?.textContent }));
        assert.deepEqual(result.rows, [['E5', 'P101', 'Ghi chu 1'], ['', 'P202', '']], 'mọi ô đã gõ đều được lưu');
        assert.deepEqual(result.dim, [], 'bảng không bị làm mờ khi lưu một ô');
        assert.deepEqual(result.inert, [], 'bảng không bị khoá khi lưu một ô');
        assert.deepEqual(result.errors, []);
        assert.equal(result.status, 'Đã lưu');
        assert.deepEqual(errors, []);
        console.log('PASS schedule typing flow: no dim/lock, focus + typed text kept, 4 edits saved in order');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
