'use strict';
// Real browser + emulators (npm run test:makeup-chain-ui). Đức Đại 03/10: đơn gộp 18:00–21:00 gửi
// lúc 18:27, sau đó vào thật ca 19:30 → quản lý duyệt đúng ca còn thiếu, công thật không đổi.
// Không dùng dữ liệu production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const root = path.resolve(__dirname, '..');
const password = 'LocalFixtureOnly-20261030';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const pad = n => String(n).padStart(2, '0');
const vnNow = new Date(Date.now() + 7 * 3600000);
const today = `${vnNow.getUTCFullYear()}-${pad(vnNow.getUTCMonth() + 1)}-${pad(vnNow.getUTCDate())}`;
const lateEnough = vnNow.getUTCHours() === 23 && vnNow.getUTCMinutes() >= 50;
const chainDate = '2026-10-03';
const users = {
    admin: { id: 'fx-admin', username: 'fxadmin', name: 'Admin Test', roles: ['admin'] },
    dai: { id: 'fx-dai', username: 'fxdai', name: 'Giáo Viên Test', roles: ['staff'] }
};
const realSession = { id: 'real-m1', source: 'self', status: 'closed', anchorDateKey: chainDate, start: '2026-10-03T12:29:59.823Z', checkIn: '2026-10-03T12:29:59.823Z', checkOut: '2026-10-03T13:58:12.660Z' };
const row = (id, start, end, lop, lopId) => ({ shiftId: id, start, end, lop, lopId, gvId: users.dai.id, gv: users.dai.name, gvList: [{ id: users.dai.id, name: users.dai.name }], registeredTeachers: [] });
const locator = (id, section, start, end, className, classId) => ({ kind: 'gv', compositeKey: 'cs1__' + chainDate, section, rowIndex: 0, shiftId: id, start, end, branch: 'cs1', classId, className });

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
            await db.collection('settings').doc('system').set({ centerClosures: {} });
            await db.collection('schedules').doc('cs1__' + chainDate).set({
                evening1: [row('s-e7', '18:00', '19:30', 'E7', 'id-e7')], evening2: [row('s-m1', '19:30', '21:00', 'Mover 1', 'id-m1')] });
            await db.collection('attendance_logs').doc(chainDate + '_' + users.dai.id).set({ userId: users.dai.id, date: chainDate, sessions: [realSession] });
            await db.collection('makeup_requests').doc('chain-pending').set({ staffId: users.dai.id, staffName: users.dai.name, type: 'scheduled', status: 'pending', dateKey: chainDate, branch: 'cs1',
                shiftLabel: '18:00–21:00 CS1 (E7 + Mover 1)', className: 'E7 + Mover 1', classNames: ['E7', 'Mover 1'], classId: '', classIds: ['id-e7', 'id-m1'], shiftStart: '18:00', shiftEnd: '21:00', shiftKind: 'gv',
                scheduleLocators: [locator('s-e7', 'evening1', '18:00', '19:30', 'E7', 'id-e7'), locator('s-m1', 'evening2', '19:30', '21:00', 'Mover 1', 'id-m1')],
                session: { checkIn: '2026-10-03T11:00:00.000Z', checkOut: '2026-10-03T14:00:00.000Z', role: null, roleName: 'E7 + Mover 1' }, reason: 'Điện thoại bị mất wifi' });
            if (!lateEnough) await db.collection('schedules').doc('cs1__' + today).set({ evening2: [row('s-late', '23:58', '23:59', 'E7', 'id-e7')] });
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
        const open = async user => {
            const page = await (await browser.createBrowserContext()).newPage();
            await page.setViewport({ width: 1440, height: 900 });
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

        const admin = await open(users.admin);
        await admin.goto(origin + '/tuong-trinh.html', { waitUntil: 'domcontentloaded' });
        await admin.waitForFunction(() => curReqs.some(r => r.id === 'chain-pending') && curVerdicts['chain-pending'], { timeout: 30000 });
        await admin.evaluate(() => { activeId = 'chain-pending'; renderDetail(); });
        const detail = await admin.$eval('#detail', el => el.textContent);
        assert.match(detail, /Đơn gộp nhiều ca — một ca đã có công/);
        assert.doesNotMatch(detail, /Đã có công trùng giờ/);
        const labels = await admin.$$eval('#detail button', els => els.map(b => b.textContent.trim()));
        assert.ok(!labels.includes('Duyệt'), 'nút Duyệt cả đơn (gây lương đôi) phải được thay thế');
        await admin.$$eval('#detail button', els => els.find(b => b.textContent.includes('Duyệt ca còn thiếu: 18:00–19:30 E7')).click());
        await admin.waitForSelector('#tt-po-ok', { visible: true, timeout: 10000 });
        await admin.click('#tt-po-ok');
        await env.withSecurityRulesDisabled(async c => {
            const ref = c.firestore().collection('makeup_requests').doc('chain-pending');
            for (let i = 0; i < 60 && (await ref.get()).data().status !== 'approved'; i++) await new Promise(r => setTimeout(r, 250));
            const request = (await ref.get()).data();
            assert.equal(request.status, 'approved');
            assert.equal(request.shiftLabel, '18:00–19:30 CS1 (E7)');
            assert.equal(request.narrowedFrom.shiftLabel, '18:00–21:00 CS1 (E7 + Mover 1)');
            const sessions = (await c.firestore().collection('attendance_logs').doc(chainDate + '_' + users.dai.id).get()).data().sessions;
            assert.equal(sessions.length, 2, 'chỉ thêm đúng một ca');
            const real = sessions.find(s => s.id === 'real-m1');
            assert.equal(real.checkIn, realSession.checkIn, 'công thật không đổi');
            assert.equal(real.checkOut, realSession.checkOut, 'công thật không đổi');
            const made = sessions.find(s => s.makeupRequestId === 'chain-pending');
            assert.equal(made.checkIn, '2026-10-03T11:00:00.000Z');
            assert.equal(made.checkOut, '2026-10-03T12:30:00.000Z');
            assert.equal(made.role, 'id-e7');
            assert.equal(made.roleName, 'E7');
        });
        console.log('PASS manager approves only the missing shift; real attendance untouched');

        if (!lateEnough) {
            const staff = await open(users.dai);
            await staff.goto(origin + '/cham-bu.html', { waitUntil: 'domcontentloaded' });
            await staff.waitForFunction(() => monthReady, { timeout: 30000 });
            await staff.evaluate(k => pickDay(k), today);
            const card = await staff.$$eval('#day-list .sc', els => els.map(el => el.textContent).find(t => t.includes('23:58')));
            assert.match(card, /Chưa tới giờ/);
            assert.doesNotMatch(card, /Chọn chấm bù/);
            console.log('PASS a shift that has not started cannot be requested');
        }
        assert.deepEqual(errors, []);
        console.log('makeup-chain-narrow-ui.cjs: all assertions passed');
    } finally {
        if (browser) await browser.close();
        if (server) server.close();
        await env.cleanup();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
