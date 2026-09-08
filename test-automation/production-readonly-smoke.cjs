'use strict';
// This smoke never logs in or creates production attendance/payroll records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const origin = 'https://timekeeping-system-tawny.vercel.app';
const version = '20260908-payroll-review-v2';
const assets = ['js/main.js', 'js/db-service.js', 'js/report.js', 'js/payroll-review.js', 'js/schedule.js',
    'js/pdf-export.js', 'js/salary-bulk-export.js', 'js/receptionist-schedule.js', 'service-worker.js'];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
(async () => {
    const evidence = { origin, version, checkedAt: new Date().toISOString(), assets: {}, browserErrors: [], writesBlocked: [] };
    const results = await Promise.allSettled(assets.map(async file => {
        const response = await fetch(`${origin}/${file}?v=${version}`, { cache: 'no-store' });
        assert.equal(response.status, 200, file);
        const remote = Buffer.from(await response.arrayBuffer());
        const local = fs.readFileSync(path.join(root, file));
        assert.equal(digest(remote), digest(local), 'Production must match tested local asset: ' + file);
        evidence.assets[file] = { status: response.status, sha256: digest(remote) };
    }));
    const failures = results.filter(result => result.status === 'rejected');
    assert.deepEqual(failures.map(result => result.reason.message), []);
    const response = await fetch(origin + '/bao-cao.html', { cache: 'no-store' });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('js/payroll-review.js?v=' + version));
    evidence.reportHeaders = { status: response.status, cache: response.headers.get('cache-control'), frame: response.headers.get('x-frame-options') };
    const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 430, height: 932, isMobile: true });
        page.on('pageerror', error => evidence.browserErrors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (/firestore\.googleapis\.com/.test(request.url()) && /(?:commit|Write\/channel)/i.test(request.url())) {
                evidence.writesBlocked.push(request.url().split('?')[0]); request.abort();
            } else request.continue();
        });
        await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#login-form', { visible: true });
        await page.waitForFunction(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            const key = (await caches.keys()).find(name => name.includes('v159-payroll-review'));
            if (!registration?.active || !key) return false;
            const cache = await caches.open(key);
            return !!(await cache.match('/js/payroll-review.js?v=20260908-payroll-review-v2')) &&
                !!(await cache.match('/js/db-service.js?v=20260908-payroll-review-v2'));
        }, { timeout: 60000 });
        // A first PWA install announces APP_UPDATED and intentionally reloads
        // an untouched login page. Wait through that navigation before reading.
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 });
        await page.waitForSelector('#login-form', { visible: true });
        evidence.browser = await page.evaluate(async () => ({
            title: document.title, viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
            cacheKeys: await caches.keys(), serviceWorker: (await navigator.serviceWorker.getRegistration())?.active?.scriptURL,
            cachedAssets: (await (await caches.open('tdt-chamcong-v159-payroll-review-20260908')).keys()).length
        }));
        assert.ok(evidence.browser.pageWidth <= evidence.browser.viewport + 2, 'Mobile login must not overflow');
        assert.deepEqual(evidence.browserErrors, []);
        assert.deepEqual(evidence.writesBlocked, []);
        fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
        await page.screenshot({ path: path.join(root, 'scratch/production-payroll-review.png') });
        fs.writeFileSync(path.join(root, 'scratch/production-payroll-review.json'), JSON.stringify(evidence, null, 2));
        console.log(JSON.stringify(evidence, null, 2));
        console.log('PASS production exact asset hashes, report script, mobile login, PWA installation; no production writes');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
