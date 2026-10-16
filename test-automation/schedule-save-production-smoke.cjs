'use strict';
// Read-only: no login and no production attendance/payroll writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const origin = 'https://timekeeping-system-tawny.vercel.app';
const hash = value => crypto.createHash('sha256').update(value.toString().replace(/\r\n/g, '\n')).digest('hex');
const assets = ['lich-lam.html', 'js/schedule.js', 'service-worker.js', 'js/db-service.js',
    'js/ui-service.js', 'js/teacher-shift-state.js', 'css/style.css', 'js/evaluation-service.js',
    'js/report.js', 'js/timekeeping.js', 'js/partner-attendance.js', 'js/main.js', 'bao-cao.html', 'cham-cong.html'];
(async () => {
    const results = await Promise.allSettled(assets.map(async file => {
        const response = await fetch(`${origin}/${file}?smoke=v244`, { signal: AbortSignal.timeout(25000), cache: 'no-store' });
        assert.equal(response.status, 200, file);
        assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(fs.readFileSync(path.join(root, file))), file);
    }));
    assert.deepEqual(results.filter(item => item.status === 'rejected').map(item => item.reason.message), []);
    const puppeteer = require('puppeteer-core');
    const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        headless: true, args: ['--no-sandbox'] });
    try {
        for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }]) {
            const page = await browser.newPage();
            await page.setViewport(viewport);
            const errors = [], writes = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setRequestInterception(true);
            page.on('request', request => {
                // Listen/channel and batchGet are read APIs even when they use
                // POST. Only the Write stream and document mutations are writes.
                const url = new URL(request.url());
                const mutation = /\/Write\/channel|:(commit|batchWrite)$/.test(url.pathname) ||
                    (/\/documents\//.test(url.pathname) && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()));
                if (url.hostname === 'firestore.googleapis.com' && mutation) {
                    writes.push(request.url());
                    return request.abort();
                }
                request.continue();
            });
            await page.goto(origin + '/lich-lam.html', { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#login-form', { visible: true });
            await page.waitForFunction(() => location.pathname.endsWith('/index.html') || location.pathname === '/');
            assert.deepEqual(errors, []);
            assert.deepEqual(writes, []);
            await page.close();
        }
    } finally { await browser.close(); }
    console.log('PASS production v244: 14 asset hashes match; desktop/mobile login redirects; no data writes or page errors');
})().catch(error => { console.error(error); process.exitCode = 1; });
