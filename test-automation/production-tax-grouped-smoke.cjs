'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const origin = 'https://timekeeping-system-tawny.vercel.app';
const files = ['js/main.js', 'js/report.js', 'js/pdf-export.js', 'js/salary-bulk-export.js', 'js/salary-review-board.js',
    'js/salary-review-board-policy.js', 'css/salary-review.css', 'service-worker.js', 'bao-cao.html', 'xet-tang-luong.html', 'index.html', 'cham-cong.html'];
const hash = bytes => crypto.createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
(async () => {
    const evidence = { origin, checkedAt: new Date().toISOString(), assets: [], browserErrors: [] };
    for (const file of files) {
        const response = await fetch(origin + '/' + file + '?verify=tax-grouped-20261006', { cache: 'no-store', signal: AbortSignal.timeout(25000) });
        assert.equal(response.status, 200, file);
        const body = Buffer.from(await response.arrayBuffer());
        assert.equal(hash(body), hash(fs.readFileSync(path.join(root, file))), 'Live asset mismatch: ' + file);
        evidence.assets.push({ file, status: 200, sha256: hash(body) });
    }
    const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    try {
        const page = await browser.newPage();
        page.on('pageerror', error => evidence.browserErrors.push(error.message));
        await page.setViewport({ width: 390, height: 844, isMobile: true });
        await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#login-form', { visible: true });
        await page.waitForFunction(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            if (!registration?.active) return false;
            const cache = await caches.open('tdt-chamcong-assets');
            return !!(await cache.match('/js/main.js?v=20261006-tax-grouped-v1')) &&
                !!(await cache.match('/js/report.js?v=20261008-owner-round-v1'));
        }, { timeout: 60000 });
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 });
        await page.waitForSelector('#login-form', { visible: true });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert.equal(overflow, false, 'login page fits phone viewport');
        assert.deepEqual(evidence.browserErrors, []);
        evidence.serviceWorker = 'active; updated payroll/main assets cached';
        fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
        await page.screenshot({ path: path.join(root, 'scratch/production-tax-grouped.png'), fullPage: true });
        fs.writeFileSync(path.join(root, 'scratch/production-tax-grouped.json'), JSON.stringify(evidence, null, 2));
        console.log('Production PASS: exact alias; 12 files match tested source; login and updated PWA cache work. No login or data writes.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
