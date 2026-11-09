const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const report = fs.readFileSync(path.join(root, 'js/report.js'), 'utf8').replace(/\r\n/g, '\n');
const helper = report.slice(report.indexOf('function reportDeleteTargets('), report.indexOf('async function openManualModal('));
const start = report.indexOf('async function deleteSessionFromModal(');
const deletion = report.slice(start, report.indexOf('\n}\n', start) + 3);
(async () => {
    const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.setContent('<body><input id="edit-date-key" value="2026-10-09"><input id="edit-session-id" value="NEW"><input id="edit-class-composite-key" value="cs3__2026-10-05"><input id="edit-class-section-key" value="evening"><input id="edit-class-index" value="fri"><input id="edit-class-is-receptionist" value="office"></body>');
        await page.evaluate(code => {
            window.calls = []; window.messages = []; window.currentDate = new Date(); window._cachedStaffId = 'staff';
            window.getTargetStaffId = () => 'staff'; window.getTargetStaffName = () => 'Staff';
            window.alert = message => messages.push(message);
            window.closeEditModal = () => calls.push('close'); window.renderMonthReport = () => calls.push('render');
            window.DBService = {
                async deleteReportShift(...args) { calls.push(args); await new Promise(r => setTimeout(r, 50)); },
                async createAdminNotification() { throw Error('notification unavailable'); }
            };
            (0, eval)(code);
        }, helper + deletion);
        await page.evaluate(async () => {
            await Promise.all([deleteSessionFromModal(), deleteSessionFromModal()]);
        });
        const result = await page.evaluate(() => ({ calls, messages, pending: deleteSessionFromModal.pending }));
        assert.equal(result.calls.filter(Array.isArray).length, 1, 'Double taps must send one transaction');
        assert.equal(result.calls[0][3][0].kind, 'office');
        assert.equal(result.calls[0][3][0].sectionKey, 'evening');
        assert.deepEqual(result.messages, ['Đã xóa hoàn toàn!'], 'Notification failure must not report deletion failure');
        assert.ok(result.calls.includes('render'));
        assert.equal(result.pending, false);
        assert.deepEqual(errors, []);
        if (process.env.PRODUCTION_SMOKE === '1') {
            const origin = 'https://timekeeping-system-tawny.vercel.app';
            const crypto = require('node:crypto');
            const digest = s => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');
            const files = ['js/db-service.js', 'js/report.js', 'js/evaluation-service.js', 'bao-cao.html', 'cham-cong.html', 'service-worker.js'];
            for (const file of files) {
                const response = await fetch(origin + '/' + file + '?verify=delete-v274', { cache: 'no-store' });
                assert.equal(response.status, 200, file);
                assert.equal(digest(await response.text()), digest(fs.readFileSync(path.join(root, file), 'utf8')), file + ' must match the tested release');
            }
            await page.setRequestInterception(true);
            page.on('request', request => {
                if (/firestore\.googleapis\.com/.test(request.url()) && request.method() !== 'GET') request.abort();
                else request.continue();
            });
            await page.setViewport({ width: 430, height: 932, isMobile: true });
            await page.goto(origin + '/index.html', { waitUntil: 'networkidle2' });
            await page.waitForSelector('#login-form', { visible: true, timeout: 30000 });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
            assert.deepEqual(errors, []);
            fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
            await page.screenshot({ path: path.join(root, 'scratch/report-delete-production.png') });
            console.log('Production: six exact asset hashes; mobile login; no browser errors. No production data writes.');
        }
        console.log('Browser: exact shift target, double-tap guard, refresh and notification failure passed.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
