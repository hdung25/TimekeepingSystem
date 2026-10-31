'use strict';
// Real browser + emulators (npm run test:staff-code-ui). Trang Nhân sự: số trước rồi N, V; form tạo
// mới có ô Mã số, tự điền tên đăng nhập, chặn mã trùng. Không dùng dữ liệu production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const root = path.resolve(__dirname, '..');
const password = 'LocalFixtureOnly-20261031';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const admin = { id: 'fx-admin', username: 'fxadmin', name: 'Admin Test', roles: ['admin'] };
const staff = ['thaiv1', 'dung39', 'huyenn1', 'an08', 'vann5', 'anhv3', 'van75'].map(username => ({ id: 'fx-' + username, username, name: 'NV ' + username, roles: ['staff'] }));

async function main() {
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    let browser, server;
    try {
        await env.clearFirestore();
        await fetch(`http://${authHost}/emulator/v1/projects/demo-timekeeping/accounts`, { method: 'DELETE' });
        const r = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fixture`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: admin.username + '@tuduytre.com', password, returnSecureToken: true }) });
        admin.authUid = (await r.json()).localId;
        await env.withSecurityRulesDisabled(async c => {
            const db = c.firestore();
            for (const u of [admin, ...staff]) {
                await db.collection('users').doc(u.id).set({ id: u.id, username: u.username, name: u.name, role: u.roles[0], roles: u.roles, salary_config: {} });
                await db.collection('staff_directory').doc(u.id).set({ id: u.id, username: u.username, name: u.name, role: u.roles[0], roles: u.roles });
            }
            await db.collection('user_roles').doc(admin.authUid).set({ userId: admin.id, username: admin.username, role: 'admin', roles: admin.roles });
            await db.collection('settings').doc('system').set({ centerClosures: {} });
        });
        server = http.createServer((req, res) => {
            const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
            if (!file.startsWith(root + path.sep) || /node_modules/.test(pathname)) { res.writeHead(403); res.end(); return; }
            try {
                let body = fs.readFileSync(file);
                if (pathname === '/js/firebase-config.js') {
                    body = body.toString().replace(/projectId: "[^"]+"/, 'projectId: "demo-timekeeping"')
                        .replace('window.auth = firebase.auth();', `window.auth = firebase.auth();\nwindow.auth.useEmulator('http://${authHost}', {disableWarnings:true});\nwindow.db.useEmulator('127.0.0.1', ${emulatorHost.split(':')[1]});`);
                }
                if (pathname === '/service-worker.js') body = 'self.addEventListener("install",()=>self.skipWaiting());';
                const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream';
                res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body);
            } catch (_) { res.writeHead(404); res.end(); }
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
        const errors = [];
        const page = await (await browser.createBrowserContext()).newPage();
        await page.setViewport({ width: 1280, height: 900 });
        page.on('pageerror', e => errors.push(e.message));
        await page.setRequestInterception(true);
        page.on('request', req => {
            const url = new URL(req.url());
            const sdk = /^\/firebasejs\/12\.18\.0\/(firebase-[a-z-]+-compat\.js)$/.exec(url.pathname);
            if (url.hostname === 'www.gstatic.com' && sdk) { req.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'node_modules/firebase', sdk[1])) }); return; }
            if (/googleapis\.com$/.test(url.hostname)) { req.abort(); return; }
            if (!['localhost', '127.0.0.1'].includes(url.hostname)) { req.respond({ status: 200, contentType: req.resourceType() === 'stylesheet' ? 'text/css' : 'text/javascript', body: '' }); return; }
            req.continue();
        });
        await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
        await page.type('#username', admin.username);
        await page.type('#password', password);
        await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#login-form button[type="submit"]')]);
        await page.goto(origin + '/nhan-su.html', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#ns-list .ns-card', { timeout: 30000 });

        const badges = () => page.$$eval('#ns-list .ns-msnv', els => els.map(el => el.textContent));
        assert.deepEqual(await badges(), ['08', '39', '75', 'N1', 'N5', 'V1', 'V3', '—']);
        console.log('PASS numbers first, then N, then V, no code last');

        // Đăng nhập thật của tài khoản mới do Firebase Auth phụ trách; ở đây chỉ kiểm tra form + hồ sơ.
        await page.evaluate(() => { AuthHelper.createUser = async () => ({ uid: 'fx-new-auth' }); });
        await page.click('.ns-head .ns-btn-primary');
        await page.waitForSelector('#ns-staff-sheet.open #ns-staff-code', { visible: true });
        const hint = await page.$eval('#ns-staff-code-free', el => el.textContent);
        assert.match(hint, /Mã số: trống 01–07, 09–38, 40–74; tiếp theo 76/);
        assert.match(hint, /Mã N: trống 2–4; tiếp theo N6/);
        assert.match(hint, /Mã V: trống 2; tiếp theo V4/);
        await page.screenshot({ path: path.join(os.tmpdir(), 'tdt-staff-code-form.png') });

        await page.type('#ns-staff-name', 'Nguyễn Thị Huyền');
        await page.type('#ns-staff-code', 'n5');
        assert.equal(await page.$eval('#ns-staff-username', el => el.value), 'huyenn5');
        await page.type('#ns-staff-password', 'secret123');
        await page.click('#ns-staff-submit');
        await page.waitForFunction(() => /Mã N5 đã thuộc về/.test(document.body.innerText), { timeout: 10000 });
        assert.equal(await page.evaluate(() => document.getElementById('ns-staff-sheet').classList.contains('open')), true);
        console.log('PASS duplicate code refused');

        await page.$eval('#ns-staff-code', el => { el.value = ''; });
        await page.type('#ns-staff-code', 'n2');
        assert.equal(await page.$eval('#ns-staff-username', el => el.value), 'huyenn2');
        await page.click('#ns-staff-submit');
        await page.waitForFunction(() => !document.getElementById('ns-staff-sheet').classList.contains('open'), { timeout: 30000 });
        await page.waitForFunction(() => NhanSu._state.users.some(u => u.username === 'huyenn2'), { timeout: 30000 });
        assert.deepEqual(await badges(), ['08', '39', '75', 'N1', 'N2', 'N5', 'V1', 'V3', '—']);
        console.log('PASS new staff N2 lands between N1 and N5');

        const createdId = await page.evaluate(() => NhanSu._state.users.find(u => u.username === 'huyenn2').id);
        await page.evaluate(id => NhanSu.editStaff(id), createdId);
        assert.equal(await page.$eval('#ns-staff-code-field', el => getComputedStyle(el).display), 'none');
        console.log('PASS edit sheet keeps the existing form');

        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        if (server) await new Promise(resolve => server.close(resolve));
        await env.cleanup();
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
