'use strict';
// Trang Chấm Công Bù: trạng thái phải đúng NGAY và không nói dối khi mạng chập chờn.
// Chạy: npm run test:makeup-ui (emulator auth+firestore, cấu hình firebase.browser.json).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const root = path.resolve(__dirname, '..');
const password = 'LocalFixtureOnly-20260905';
const dateKey = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const staff = { id: 'fixture-nhan', username: 'fixturenhan', name: 'Nguyễn Phan Thanh Nhàn ', roles: ['teaching_assistant'] };

async function main() {
    for (const host of [emulatorHost, authHost]) assert.match(host || '', /^127\.0\.0\.1:\d+$/, 'Local emulators required');
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    let browser, server;
    try {
        await env.clearFirestore();
        await fetch(`http://${authHost}/emulator/v1/projects/demo-timekeeping/accounts`, { method: 'DELETE' });
        const signUp = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fixture`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: staff.username + '@tuduytre.com', password, returnSecureToken: true })
        });
        assert.equal(signUp.ok, true);
        staff.authUid = (await signUp.json()).localId;
        await env.withSecurityRulesDisabled(async c => {
            const db = c.firestore();
            await db.collection('users').doc(staff.id).set({ ...staff, role: staff.roles[0], salary_config: { attendance_rate: 100000, roles: [{ id: 'fixture-subject', name: 'Fixture class', rate: 100000 }] } });
            await db.collection('user_roles').doc(staff.authUid).set({ userId: staff.id, username: staff.username, role: staff.roles[0], roles: staff.roles });
            const { authUid, ...publicUser } = staff;
            await db.collection('staff_directory').doc(staff.id).set({ ...publicUser, role: staff.roles[0] });
            await db.collection('settings').doc('system').set({ gpsCS1Lat: 10, gpsCS1Lng: 106, gpsCS1Radius: 200 });
            await db.collection('subjects').doc('fixture-subject').set({ name: 'Fixture class', rate: 100000 });
            await db.collection('schedules').doc(`cs1__${dateKey}`).set({ evening1: [{
                shiftId: 'fixture-class', start: '18:00', end: '19:30', lop: 'Fixture class', lopId: 'fixture-subject', phong: 'P1',
                gvId: staff.id, gv: staff.name, gvList: [{ id: staff.id, name: staff.name }], registeredTeachers: []
            }] });
        });
        server = http.createServer((req, res) => {
            const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
            if (!file.startsWith(root + path.sep) || !/\.(html|js|css|png|jpg|jpeg|svg|ico|json|woff2?|ttf)$/i.test(file) || /node_modules|\/\./.test(pathname)) { res.writeHead(403); res.end(); return; }
            try {
                let body = fs.readFileSync(file);
                if (pathname === '/js/firebase-config.js') {
                    body = body.toString().replace(/projectId: "[^"]+"/, 'projectId: "demo-timekeeping"')
                        .replace('window.auth = firebase.auth();', `window.auth = firebase.auth();\nwindow.auth.useEmulator('http://${authHost}', {disableWarnings:true});\nwindow.db.useEmulator('127.0.0.1', ${emulatorHost.split(':')[1]});`);
                }
                if (pathname === '/service-worker.js') body = 'self.addEventListener("install",()=>self.skipWaiting());';
                const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
                res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body);
            } catch (_) { res.writeHead(404); res.end(); }
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
        const page = await (await browser.createBrowserContext()).newPage();
        await page.setViewport({ width: 390, height: 844, isMobile: true });
        await page.emulateTimezone('Asia/Ho_Chi_Minh');
        const errors = [], dialogs = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
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
        await page.type('#username', staff.username);
        await page.type('#password', password);
        await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#login-form button[type="submit"]')]);
        await page.goto(origin + '/cham-bu.html', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof monthReady !== 'undefined' && monthReady === true, { timeout: 30000 });

        // 1. Chưa có đơn: ngày hôm nay phải cần chấm bù, chọn được ca, KHÔNG bị chặn.
        await page.evaluate(k => { pickDay(k); }, dateKey);
        await page.waitForSelector('#day-list .sc .b-pick', { timeout: 10000 });
        assert.match(await page.$eval('#day-list', el => el.textContent), /Chưa chấm công/);

        // 2. Gửi đơn: trạng thái "Chờ duyệt" phải hiện NGAY, không đợi tải lại.
        await page.click('#day-list .sc .b-pick');
        await page.type('#s-reason', 'Quên chấm công (kiểm thử)');
        await page.evaluate(() => { document.querySelector('#day-list .b-main').click(); });
        await page.waitForFunction(() => /Chờ duyệt/.test(document.getElementById('day-list').textContent), { timeout: 15000 });
        assert.equal(await page.$eval('#day-list .b-pick', () => 1).catch(() => 0), 0, 'ca vừa gửi không được còn nút chọn chấm bù');
        assert.ok(dialogs.some(m => /Đã gửi 1 yêu cầu/.test(m)));

        // 3. Làm mới nền xong vẫn "Chờ duyệt" (đọc từ máy chủ), danh sách của tôi có đúng 1 đơn.
        await page.waitForFunction(() => !monthLoading && lastRequests && lastRequests.length === 1, { timeout: 15000 });
        assert.match(await page.$eval('#day-list', el => el.textContent), /Chờ duyệt/);
        assert.equal(await page.$$eval('#my-reqs .req', els => els.length), 1);

        // 4. Mất mạng: làm mới phải BÁO LỖI nhưng GIỮ lịch cũ; tuyệt đối không biến ca thành "Chưa chấm công".
        await page.setOfflineMode(true);
        await page.evaluate(() => { lastResumeRefreshAt=0; refreshMakeupAfterResume(); });
        await page.waitForFunction(() => !document.getElementById('sync-note').hidden && /Không cập nhật được/.test(document.getElementById('sync-note').textContent), { timeout: 40000 });
        const offlineText = await page.$eval('#day-list', el => el.textContent);
        assert.match(offlineText, /Chờ duyệt/);
        assert.doesNotMatch(offlineText, /Chưa chấm công/);
        assert.equal(await page.$$eval('#my-reqs .req', els => els.length), 1, 'danh sách đơn cũ không bị thay bằng "Chưa có yêu cầu"');
        // Đang lỗi mạng mà bấm gửi ca khác không được vỡ trang.
        await page.evaluate(() => { submitSched(); });

        // 5. Có mạng lại + Thử lại → thanh lỗi biến mất, dữ liệu mới.
        await page.setOfflineMode(false);
        await page.evaluate(() => { retryLoad(); });
        await page.waitForFunction(() => document.getElementById('sync-note').hidden, { timeout: 40000 });
        assert.match(await page.$eval('#day-list', el => el.textContent), /Chờ duyệt/);

        // 6. Quản lý duyệt ở nơi khác → lần kiểm tra kế tiếp thấy trạng thái mới (không cần F5).
        const requestId = await page.evaluate(() => lastRequests[0].id);
        await env.withSecurityRulesDisabled(async c => {
            await c.firestore().collection('makeup_requests').doc(requestId).update({ status: 'rejected', rejectReason: 'Kiểm thử từ chối' });
        });
        await page.evaluate(() => { pollMakeupStatus(); });
        await page.waitForFunction(() => /Bị từ chối/.test(document.getElementById('day-list').textContent), { timeout: 30000 });
        assert.match(await page.$eval('#my-reqs', el => el.textContent), /Từ chối/);

        assert.deepEqual(errors, [], 'trang không được phát sinh lỗi JavaScript');
        console.log('makeup-sync-ui.test.js: all assertions passed');
    } finally {
        if (browser) await browser.close();
        if (server) server.close();
        await env.cleanup();
    }
}
main().catch(error => { console.error(error); process.exit(1); });
