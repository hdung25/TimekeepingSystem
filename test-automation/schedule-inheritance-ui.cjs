'use strict';
// Real-browser check of the "Kế thừa lịch" dialog (no Firebase): opens, previews, applies the
// planned stop changes through DBService and closes. Optional screenshots: SHOTS=<dir>.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'js/schedule-inheritance.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/app-ui.css'), 'utf8');
const shots = process.env.SHOTS || '';

(async () => {
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    try {
        for (const viewport of [{ width: 1280, height: 860 }, { width: 390, height: 844, isMobile: true, hasTouch: true }]) {
            const page = await browser.newPage();
            await page.setViewport(viewport);
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
            await page.setRequestInterception(true);
            page.on('request', request => {
                if (request.isNavigationRequest()) request.respond({ contentType: 'text/html', body:
                    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="font-family:system-ui"><button id="open">Kế thừa lịch</button><table id="schedule-table"><tbody id="table-body"></tbody></table></body></html>` });
                else request.abort();
            });
            await page.goto('http://inherit.invalid/');
            await page.evaluate(() => {
                localStorage.clear();
                localStorage.setItem('currentRole', JSON.stringify(['admin']));
                window.getLocalDateKeyFromDate = () => '2026-09-29';
                window.currentBranch = 'cs2';
                window.currentWeekStart = new Date(2026, 9, 5);
                window.calls = [];
                const days = {};
                for (let i = 7; i < 98; i += 1) {
                    const d = new Date(2026, 9, 5 + i);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    days[key] = { docId: `cs2__${key}`, exists: key === '2026-10-26' || key === '2026-11-09', stop: key === '2026-11-09', rows: 0 };
                }
                window.UIService = { confirm: async () => true, toast: (text, type) => calls.push(['toast', type, text]) };
                window.DBService = {
                    getScheduleInheritanceSnapshot: async (branch, keys) => { calls.push(['snapshot', branch, keys.length]);
                        return { manifest: { 1: ['cs2__2026-10-05', 'cs2__2026-10-26', 'cs2__2026-11-09'], 2: ['cs2__2026-10-06'], 3: ['cs2__2026-10-07'],
                            4: ['cs2__2026-10-08'], 5: ['cs2__2026-10-09'], 6: ['cs2__2026-10-10'] }, days }; },
                    removeScheduleInheritanceStop: async key => { calls.push(['remove', key]); return true; },
                    getSchedule: async () => ({ morning1: [{ lop: 'E5', _isInheritedSchedule: true, _inheritedFromScheduleDocId: 'cs2__2026-10-05' }] }),
                    createScheduleInheritanceStop: async (key, meta) => { calls.push(['stop', key, meta.lastInheritedWeek]); return true; },
                    isScheduleInheritanceStop: () => false,
                    _invalidate: pattern => calls.push(['invalidate', pattern])
                };
                window.beginScheduleMutation = () => true;
                window.finishScheduleMutation = async () => { calls.push(['finish']); };
            });
            await page.addScriptTag({ content: moduleSource });
            await page.click('#open').catch(() => {});
            await page.evaluate(() => openScheduleInheritanceModal());
            await page.waitForSelector('.si-weeks');
            const guide = await page.$eval('[data-si-guide-slot]', el => el.textContent);
            assert.match(guide, /Lịch kế thừa hoạt động thế nào/, 'guide shows the first time');
            const forever = await page.$eval('[data-si-preview]', el => el.textContent);
            assert.match(forever, /cho đến khi bạn tự sửa/);
            assert.match(forever, /gỡ 1 ngày điểm dừng cũ/);
            if (shots) await page.screenshot({ path: path.join(shots, `inherit-${viewport.width}-forever.png`), fullPage: false });
            await page.select('select[name="lastWeek"]', '2');
            await page.waitForFunction(() => /điểm dừng cho/.test(document.querySelector('[data-si-preview]').textContent));
            const until = await page.$eval('[data-si-preview]', el => el.textContent);
            assert.match(until, /tới hết tuần\s*12\/10 – 18\/10|hết tuần 19\/10 – 25\/10/);
            assert.equal(await page.$eval('input[name="mode"][value="until"]', el => el.checked), true, 'picking a week selects that option');
            if (shots) {
                await page.$eval('.ch-body', el => { el.scrollTop = el.scrollHeight; });
                await page.screenshot({ path: path.join(shots, `inherit-${viewport.width}-until.png`), fullPage: false });
            }
            await page.click('[data-si-submit]');
            await page.waitForFunction(() => calls.some(call => call[0] === 'finish'));
            const calls = await page.evaluate(() => window.calls);
            const stops = calls.filter(call => call[0] === 'stop').map(call => call[1]);
            assert.deepEqual(stops, ['cs2__2026-10-27', 'cs2__2026-10-28', 'cs2__2026-10-29', 'cs2__2026-10-30', 'cs2__2026-10-31']);
            assert.ok(calls.some(call => call[0] === 'toast' && call[1] === 'success'));
            assert.equal(await page.$('.ch-backdrop'), null, 'dialog closes after applying');
            // Second open: guide collapsed (already seen) but reachable.
            await page.evaluate(() => openScheduleInheritanceModal());
            await page.waitForSelector('.si-weeks');
            assert.equal((await page.$eval('[data-si-guide-slot]', el => el.textContent)).trim(), '');
            await page.click('[data-si-guide-toggle]');
            assert.match(await page.$eval('[data-si-guide-slot]', el => el.textContent), /Chọn cách áp dụng/);
            await page.keyboard.press('Escape');
            assert.equal(await page.$('.ch-backdrop'), null);
            // Hint above the table for an inherited day.
            await page.evaluate(() => renderScheduleInheritanceHint({ morning1: [{ _isInheritedSchedule: true, _inheritedFromScheduleDocId: 'cs2__2026-10-05' }] }, '2026-10-12'));
            assert.match(await page.$eval('#schedule-inheritance-hint', el => el.textContent), /kế thừa lịch T2 05\/10\/2026/);
            await page.evaluate(() => renderScheduleInheritanceHint({ morning1: [] }, '2026-10-12'));
            assert.equal(await page.$('#schedule-inheritance-hint'), null);
            assert.deepEqual(errors, []);
            console.log(`PASS inheritance dialog ${viewport.width}px: guide, preview, apply, hint`);
            await page.close();
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
