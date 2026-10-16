'use strict';
// Owner report 16/10/2026: "phải mở thêm lớp xoá từ từ, nhiều lúc không xoá được luôn".
// Real browser, real schedule.js table: delete two classes back to back while the first
// delete is still saving, then delete/edit a class that another scheduler changed after
// the table was drawn. Run: node schedule-flex-flow.cjs
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
                '<div id="week-display"></div><button id="prev-week">P</button><button id="next-week">N</button><div id="day-tabs"></div><div id="current-day-label"></div><table id="schedule-table"><tbody id="table-body"></tbody></table>' });
            else request.abort();
        });
        await page.goto('http://schedule-flex.invalid/?date=2099-09-14&branch=cs1');
        await page.evaluate(() => {
            localStorage.setItem('currentRole', 'admin');
            localStorage.setItem('currentUserId', 'fixture-manager');
            const cls = (id, phong) => ({ shiftId: id, start: '09:15', end: '10:45', lop: 'E5', lopId: 'e5', phong, note: '', soHS: 0, gvList: [] });
            window.fixtureRows = { morning2: [cls('shift-a', 'P1'), cls('shift-b', 'P2'), cls('shift-c', 'P3'), cls('shift-d', 'P4')] };
            window.fixtureSettings = { centerClosures: {} };
            window.fixtureQuestions = [];
            window.fixtureErrors = [];
            window.UIService = { toast: (text, type) => { if (type === 'error') fixtureErrors.push(text); },
                confirm: async text => { fixtureQuestions.push(text); return true; } };
            window.db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => structuredClone(fixtureSettings) }) }) }) };
            const slow = () => new Promise(resolve => setTimeout(resolve, 600));
            window.DBService = {
                getSchedule: async () => { await new Promise(r => setTimeout(r, 40)); return structuredClone(fixtureRows); },
                getAllCancelledShifts: async () => ({}), getDayAttendance: async () => new Map(),
                getSubjects: async () => [{ id: 'e5', name: 'E5' }], getUsers: async () => [], _invalidate() {},
                // Each commit applies to the latest rows, like a Firestore transaction retry.
                mutateScheduleSectionAtomic: async (_key, section, apply) => {
                    await slow();
                    fixtureRows[section] = apply(structuredClone(fixtureRows[section] || []));
                },
                updateScheduleRowAtomic: async (_key, section, locator, apply) => {
                    await slow();
                    const index = fixtureRows[section].findIndex(row => row.shiftId === locator.shiftId);
                    if (index < 0) throw new Error('missing row');
                    fixtureRows[section][index] = apply(structuredClone(fixtureRows[section][index]));
                    return structuredClone(fixtureRows[section][index]);
                }
            };
        });
        await page.addScriptTag({ content: source });
        await page.evaluate(() => { window._subjectList = [{ id: 'e5', name: 'E5' }]; initSchedule(); });
        await page.waitForFunction(() => document.querySelectorAll('#table-body tr[data-row-locator]').length === 4);

        const del = id => page.click(`tr[data-row-locator*="${id}"] button[title="Xóa lớp"]`);
        // Delete A, and while it is still saving delete B: the second click must not be lost.
        await del('shift-a');
        await new Promise(r => setTimeout(r, 150));
        const inertDuringSave = await page.evaluate(() => document.getElementById('table-body').inert);
        await del('shift-b');
        await page.waitForFunction(() => fixtureRows.morning2.length === 2 && !window.__scheduleMutationPending, { timeout: 8000 });

        await page.click('tr[data-row-locator*="shift-d"] [data-field="note"] input');
        await page.keyboard.type('Mang sach');
        await page.keyboard.press('Tab');
        await page.waitForFunction(() => fixtureRows.morning2[1].note === 'Mang sach' && !window.__scheduleMutationPending, { timeout: 8000 });
        // Another scheduler moves class C to a new room after this table was drawn.
        await page.evaluate(() => { fixtureRows.morning2[0].phong = 'P9'; });
        await del('shift-c');
        await page.waitForFunction(() => fixtureRows.morning2.length === 1 && !window.__scheduleMutationPending, { timeout: 8000 });
        await new Promise(r => setTimeout(r, 300));

        const result = await page.evaluate(() => ({ rows: fixtureRows.morning2.map(r => [r.shiftId, r.phong, r.note]),
            errors: fixtureErrors, questions: fixtureQuestions,
            rendered: document.querySelectorAll('#table-body tr[data-row-locator]').length,
            status: document.getElementById('schedule-save-status')?.textContent }));
        assert.equal(inertDuringSave, false, 'bảng không khoá khi đang xoá một lớp có mã');
        assert.deepEqual(result.rows, [['shift-d', 'P4', 'Mang sach']]);
        assert.equal(result.rendered, 1);
        assert.deepEqual(result.errors, []);
        assert.equal(result.questions.length, 3);
        assert.match(result.questions[2], /P9/, 'xác nhận xoá hiện phòng mới nhất');
        assert.match(result.questions[2], /phòng: P3 → P9/, 'xác nhận xoá nói rõ lớp vừa được sửa');
        assert.equal(result.status, 'Đã lưu');
        assert.deepEqual(errors, []);
        console.log('PASS schedule flex flow: back-to-back deletes kept, table unlocked, edit/delete after another scheduler changed the class');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
