'use strict';
// Bảng lịch gửi GV — thứ tự in (13/11/2026), trình duyệt thật + emulator (npm run test:sheet-order-ui):
// ▲▼ đổi hàng trên tờ in, nhớ theo ngày, "Xếp theo số phòng", và lịch trên Firestore KHÔNG bị đổi.
// Ảnh chụp chỉ được lưu khi đặt SHOTS_DIR.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const root = path.resolve(__dirname, '..');
const OUT = process.env.SHOTS_DIR || '';
const password = 'LocalFixtureOnly-20261113';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const dateKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const users = {
    admin: { id: 'fx-admin', username: 'fxadmin', name: 'Admin Test', roles: ['admin'] },
    tt: { id: 'fx-tt', username: 'fxtt', name: 'Lễ Tân Test', roles: ['receptionist'] }
};
const teacher = { id: 'fx-gv', name: 'Võ Thị Giàu' };
const row = (shiftId, lop, phong, extra = {}) => ({ ...(shiftId ? { shiftId } : {}), start: '18:00', end: '19:30', lop, phong,
    gvId: teacher.id, gv: teacher.name, gvList: [teacher], registeredTeachers: [], note: '', soHS: 6, ...extra });
const EVENING1 = [
    row('s-e1', 'E1', 'P1'),
    row('s-e2', 'E2', 'P2'),
    row('s-e12', 'E12', 'P12'),
    row('', 'TV2', 'P3'), // dòng cũ chưa có shiftId
    row('s-e4', 'E4', 'P4')
];

async function main() {
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    let browser, server;
    try {
        await env.clearFirestore();
        await fetch(`http://${authHost}/emulator/v1/projects/demo-timekeeping/accounts`, { method: 'DELETE' });
        for (const u of Object.values(users)) {
            const r = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fixture`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: u.username + '@tuduytre.com', password, returnSecureToken: true }) });
            u.authUid = (await r.json()).localId;
        }
        await env.withSecurityRulesDisabled(async c => {
            const db = c.firestore();
            for (const u of Object.values(users)) {
                await db.collection('users').doc(u.id).set({ id: u.id, username: u.username, name: u.name, role: u.roles[0], roles: u.roles, salary_config: { attendance_rate: 100000 } });
                await db.collection('user_roles').doc(u.authUid).set({ userId: u.id, username: u.username, role: u.roles[0], roles: u.roles });
                await db.collection('staff_directory').doc(u.id).set({ id: u.id, username: u.username, name: u.name, role: u.roles[0], roles: u.roles });
            }
            await db.collection('settings').doc('system').set({ gpsCS1Lat: 10, gpsCS1Lng: 106, gpsCS1Radius: 200, centerClosures: {} });
            await db.collection('schedules').doc(`cs1__${dateKey}`).set({ evening1: EVENING1 });
        });
        const readSchedule = async () => {
            let data;
            await env.withSecurityRulesDisabled(async c => { data = (await c.firestore().collection('schedules').doc(`cs1__${dateKey}`).get()).data(); });
            return data;
        };
        const seeded = JSON.stringify((await readSchedule()).evening1);

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
        const open = async (user, viewport) => {
            const page = await (await browser.createBrowserContext()).newPage();
            await page.setViewport(viewport);
            await page.emulateTimezone('Asia/Ho_Chi_Minh');
            page.on('pageerror', e => errors.push(`${user.username}: ${e.message}`));
            page.on('dialog', d => d.accept());
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
            await page.type('#username', user.username);
            await page.type('#password', password);
            await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#login-form button[type="submit"]')]);
            return page;
        };
        const shot = (page, name) => (OUT ? page.screenshot({ path: path.join(OUT, name + '.png') }) : null);
        const desktop = { width: 1440, height: 900 };
        const phone = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

        const openSheet = async page => {
            await page.goto(origin + `/lich-lam.html?date=${dateKey}&branch=cs1`, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.querySelectorAll('#table-body tr[data-row-locator]').length >= 5, { timeout: 30000 });
            await page.waitForSelector('#btn-schedule-sheet', { visible: true, timeout: 20000 });
            await page.click('#btn-schedule-sheet');
            await page.waitForFunction(() => document.querySelectorAll('#ssm-buoi button.on').length > 0, { timeout: 20000 });
            await page.$eval('#ssm-buoi [data-buoi="all"]', b => b.click());
            await page.waitForFunction(() => document.querySelectorAll('#ssm-order-list .ssm-oi').length === 5, { timeout: 20000 });
        };
        const reopen = async page => {
            await page.click('#btn-schedule-sheet');
            await page.waitForFunction(() => document.querySelectorAll('#ssm-buoi button.on').length > 0, { timeout: 20000 });
            await page.$eval('#ssm-buoi [data-buoi="all"]', b => b.click());
            await page.waitForFunction(() => document.querySelectorAll('#ssm-order-list .ssm-oi').length === 5, { timeout: 20000 });
        };
        const previewLops = page => page.$$eval('#ssm-preview tbody tr:not(.ss-sec):not(.ss-blank) .ss-c-lop', els => els.map(e => e.textContent.trim()));
        const listLops = page => page.$$eval('#ssm-order-list .ssm-oi-lop', els => els.map(e => e.textContent.trim()));
        const click = (page, lop, dir) => page.evaluate((lop, dir) => {
            const item = [...document.querySelectorAll('#ssm-order-list .ssm-oi')].find(el => el.querySelector('.ssm-oi-lop').textContent.trim() === lop);
            item.querySelector(`[data-move="${dir}"]`).click();
        }, lop, dir);

        // 1. Admin máy tính: mặc định đúng thứ tự lịch
        const admin = await open(users.admin, desktop);
        await openSheet(admin);
        assert.deepEqual(await previewLops(admin), ['E1', 'E2', 'E12', 'TV2', 'E4']);
        assert.deepEqual(await listLops(admin), ['E1', 'E2', 'E12', 'TV2', 'E4']);
        assert.equal(await admin.$eval('#ssm-order-list .ssm-oi [data-move="-1"]', b => b.disabled), true, 'hàng đầu không có ▲');
        // "kéo TV2 lên hàng 3"
        await click(admin, 'TV2', '-1');
        assert.deepEqual(await previewLops(admin), ['E1', 'E2', 'TV2', 'E12', 'E4']);
        assert.deepEqual(await admin.$$eval('#ssm-preview .ss-c-room', els => els.map(e => e.textContent.trim())), ['P1', 'P2', 'P3', 'P12', 'P4']);
        // Bấm liên tiếp: nút vẫn được focus để bấm tiếp
        assert.equal(await admin.evaluate(() => document.activeElement?.dataset?.move), '-1');
        await click(admin, 'E4', '-1');
        assert.deepEqual(await previewLops(admin), ['E1', 'E2', 'TV2', 'E4', 'E12'], 'P1 → P12 theo thứ tự');
        await shot(admin, '1-admin-order-desktop');
        assert.equal(await admin.$eval('#ssm-order-reset', b => b.hidden), false);
        // Lịch trên máy chủ KHÔNG đổi
        assert.equal(JSON.stringify((await readSchedule()).evening1), seeded, 'không ghi gì vào lịch');
        // Đóng mở lại: thứ tự vẫn giữ (lưu trên máy)
        await admin.click('[data-ss-close]');
        await reopen(admin);
        assert.deepEqual(await previewLops(admin), ['E1', 'E2', 'TV2', 'E4', 'E12'], 'mở lại vẫn giữ thứ tự');
        // Về thứ tự lịch
        await admin.click('#ssm-order-reset');
        assert.deepEqual(await previewLops(admin), ['E1', 'E2', 'E12', 'TV2', 'E4']);
        // Xếp theo số phòng (nhớ cho các lần sau)
        await admin.click('#ssm-room');
        assert.deepEqual(await previewLops(admin), ['E1', 'E2', 'TV2', 'E4', 'E12']);
        await click(admin, 'E12', '-1');
        assert.deepEqual(await previewLops(admin), ['E1', 'E2', 'TV2', 'E12', 'E4'], 'vẫn đổi tay được khi xếp theo phòng');
        await admin.click('[data-ss-close]');
        await admin.reload({ waitUntil: 'domcontentloaded' });
        await admin.waitForSelector('#btn-schedule-sheet', { visible: true, timeout: 30000 });
        await reopen(admin);
        assert.equal(await admin.$eval('#ssm-room', el => el.checked), true);
        assert.deepEqual(await previewLops(admin), ['E1', 'E2', 'TV2', 'E12', 'E4'], 'tải lại trang vẫn giữ');
        // Ảnh PNG tạo được (html2canvas bị chặn mạng trong test → chỉ kiểm tra không lỗi trang)
        assert.equal(JSON.stringify((await readSchedule()).evening1), seeded, 'không ghi gì vào lịch');

        // 2. Tiếp tân trên điện thoại (chỉ xem lịch) cũng đổi được thứ tự tờ in
        const tt = await open(users.tt, phone);
        await openSheet(tt);
        assert.equal(await tt.$eval('#ssm-order', d => d.open), false, 'điện thoại: thu gọn sẵn');
        await tt.$eval('#ssm-order summary', s => s.click());
        await click(tt, 'TV2', '-1');
        assert.deepEqual(await previewLops(tt), ['E1', 'E2', 'TV2', 'E12', 'E4']);
        await tt.$eval('#ssm-order', d => d.scrollIntoView());
        await shot(tt, '2-reception-order-phone');
        assert.equal(JSON.stringify((await readSchedule()).evening1), seeded, 'tiếp tân không ghi gì vào lịch');

        assert.deepEqual(errors, [], 'không có lỗi trang');
        console.log('sheet-order-ui.cjs: all assertions passed');
    } finally {
        if (browser) await browser.close();
        if (server) server.close();
        await env.cleanup();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
