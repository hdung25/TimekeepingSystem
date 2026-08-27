const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('C:\\Users\\Admin\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');

const ORIGIN = 'http://127.0.0.1:4173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
    const browser = await chromium.launch({
        executablePath: CHROME,
        headless: true,
        args: ['--no-sandbox']
    });
    try {
        const context = await browser.newContext({
            permissions: ['geolocation'],
            geolocation: { latitude: 10.0001, longitude: 106.0001, accuracy: 15 },
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 1
        });
        const page = await context.newPage();
        const consoleErrors = [];
        page.on('console', message => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', error => consoleErrors.push(error.message));
        await page.goto(`${ORIGIN}/test-automation/location-check.fixture.html`, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('#status').textContent(), 'READY');
        assert.equal(await page.locator('body').evaluate(element => element.innerText.trim().length > 0), true);
        assert.equal(await page.locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay').count(), 0);

        await page.locator('#check-in').click();
        await page.waitForFunction(() => document.getElementById('status')?.textContent === 'WRITE_OK');
        const write = await page.evaluate(() => window.__fixtureWrites[0]);
        assert.equal(write.ref.name, 'attendance_logs');
        assert.equal(write.data.sessions.length, 1);
        assert.equal(write.data.sessions[0].checkOut, null);

        await page.evaluate(() => {
            alert('IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để chấm công.');
            alert('IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để chấm công.');
        });
        assert.equal(await page.locator('.toast-container .toast').count(), 1);
        await page.waitForTimeout(400);
        const screenshot = path.join(os.tmpdir(), 'attendance-location-flow-20260827.png');
        await page.screenshot({ path: screenshot, fullPage: true });
        assert.deepEqual(consoleErrors, []);
        console.log(JSON.stringify({ status: 'passed', screenshot, writeCount: 1, duplicateToastCount: 1 }));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
