'use strict';
// Owner round 2026-10-03, real browser + emulators (npm run test:owner-ui):
// nối ca tiếp tân → lớp, chip "Chưa bấm ra ca", ô phòng P, tiếp tân chỉ xem + Bảng lịch, Sổ ghi chú.
// Ảnh chụp chỉ được lưu khi đặt SHOTS_DIR.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
const root = path.resolve(__dirname, '..');
const OUT = process.env.SHOTS_DIR || '';
const password = 'LocalFixtureOnly-20261003';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const dateKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const hm = mins => { const d = new Date(now); d.setSeconds(0, 0); d.setMinutes(Math.floor(d.getMinutes() / 5) * 5 + mins); return d; };
const clock = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const monday = (() => { const d = new Date(now); const day = d.getDay(); d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];

const users = {
    admin: { id: 'fx-admin', username: 'fxadmin', name: 'Admin Test', roles: ['admin'] },
    huy: { id: 'fx-huy', username: 'fxhuy', name: 'Quang Huy', roles: ['receptionist', 'staff'] },
    van: { id: 'fx-van', username: 'fxvan', name: 'Phạm Thị Bích Vân', roles: ['staff'] },
    tt: { id: 'fx-tt', username: 'fxtt', name: 'Lễ Tân Test', roles: ['receptionist'] }
};
const R0 = hm(-240), C0 = hm(-20), C1 = hm(70), V0 = hm(-125), V1 = hm(-65), F0 = hm(130), F1 = hm(200);

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
            await db.collection('subjects').doc('ffl').set({ name: 'FFL', rate: 100000, color: '#EF4444' });
            await db.collection('subjects').doc('nhay').set({ name: 'Nhảy', rate: 100000, color: '#111111' });
            const row = (id, start, end, lop, phong, t) => ({ shiftId: id, start: clock(start), end: clock(end), lop, lopId: lop.toLowerCase(), phong,
                gvId: t.id, gv: t.name, gvList: [{ id: t.id, name: t.name }], registeredTeachers: [], note: '', soHS: 0 });
            await db.collection('schedules').doc(`cs1__${dateKey}`).set({
                afternoon2: [row('cls-van', V0, V1, 'Nhảy', 'p03', users.van)],
                evening1: [row('cls-huy', C0, C1, 'FFL', 'P 11', users.huy), row('cls-future', F0, F1, 'FFL', '', users.van)]
            });
            await db.collection('receptionist_schedules').doc(`cs1__${monday}`).set({
                afternoon: { [dayKey]: [{ id: users.huy.id, name: users.huy.name, customStart: clock(R0), customEnd: clock(C0) }] }
            });
            const sess = (id, at) => ({ id, anchorDateKey: dateKey, status: 'open', source: 'self', start: at.toISOString(), checkIn: at.toISOString(), checkOut: null });
            await db.collection('attendance_logs').doc(`${dateKey}_${users.huy.id}`).set({ userId: users.huy.id, name: users.huy.name, date: dateKey, sessions: [sess('s-huy', new Date(R0.getTime() + 4 * 60000))] });
            await db.collection('attendance_logs').doc(`${dateKey}_${users.van.id}`).set({ userId: users.van.id, name: users.van.name, date: dateKey, sessions: [sess('s-van', new Date(V0.getTime() - 5 * 60000))] });
            const ts = firebase.firestore.Timestamp.fromDate(new Date());
            await db.collection('staff_notes').doc('seed-huy').set({ staffId: users.huy.id, staffName: users.huy.name, title: 'Dặn ca tối', body: 'Nhắc phụ huynh lớp FFL đóng học phí.\nGọi lại số 09xx…', items: [{ text: 'In đề E5', done: true }, { text: 'Đổi phòng P11', done: false }], color: 'yellow', pinned: true, remindOn: dateKey, createdAt: ts, updatedAt: ts });
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
        const open = async (user, viewport) => {
            const page = await (await browser.createBrowserContext()).newPage();
            await page.setViewport(viewport);
            await page.emulateTimezone('Asia/Ho_Chi_Minh');
            page.on('pageerror', e => errors.push(`${user.username}: ${e.message}`));
            page.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log(`[${user.username} console.${m.type()}]`, m.text().slice(0, 300)); });
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
        const shot = (page, name, full = false) => (OUT ? page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full }) : null);
        const desktop = { width: 1440, height: 900 };
        const phone = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

        // 1. Admin: lịch hôm nay (chip nối ca, chip chưa bấm ra ca, ô phòng P)
        const admin = await open(users.admin, desktop);
        await admin.goto(origin + `/lich-lam.html?date=${dateKey}&branch=cs1`, { waitUntil: 'domcontentloaded' });
        try {
            await admin.waitForFunction(() => document.querySelectorAll('#table-body tr[data-row-locator]').length >= 3, { timeout: 30000 });
        } catch (e) {
            console.log('BODY', (await admin.evaluate(() => document.body.innerText)).slice(0, 1500));
            await shot(admin, '0-fail');
            throw e;
        }
        await admin.waitForFunction(() => /nối ca tiếp tân/.test(document.getElementById('table-body').textContent), { timeout: 20000 });
        const chips = await admin.$$eval('.gv-chip', els => els.map(e => `${e.className} | ${e.textContent.trim()}`));
        console.log('chips:', chips);
        assert.ok(chips.some(c => /is-attendance-open/.test(c) && /Quang Huy · Đã vào ca \(nối ca tiếp tân\)/.test(c)));
        assert.ok(chips.some(c => /is-attendance-overdue/.test(c) && /Bích Vân · Chưa bấm ra ca/.test(c)));
        const rooms = await admin.$$eval('td[data-field="room"]', els => els.map(td => td.textContent.trim() + '|' + (td.querySelector('input')?.value || '')));
        assert.deepEqual(rooms, ['|P03', '|P11', 'P|'], 'lớp đã qua hiện phòng chuẩn hoá; lớp sắp tới có chữ P sẵn');
        const futureRoom = 'tr[data-row-locator*="cls-future"] td[data-field="room"] input';
        await admin.click(futureRoom);
        await admin.keyboard.type('7');
        await admin.keyboard.press('Tab');
        await new Promise(r => setTimeout(r, 2500));
        await shot(admin, '1-lich-lam-admin-desktop');
        let stored;
        await env.withSecurityRulesDisabled(async c => { stored = (await c.firestore().collection('schedules').doc(`cs1__${dateKey}`).get()).data(); });
        assert.equal(stored.evening1.find(r => r.shiftId === 'cls-future').phong, 'P7', 'gõ 7 → lưu P7');

        // 2. Admin: Ghi chú nhân viên
        await admin.goto(origin + '/admin.html', { waitUntil: 'domcontentloaded' });
        await admin.waitForSelector('[data-staff-notes-button]:not([hidden])', { timeout: 20000 });
        await admin.click('[data-staff-notes-button]');
        await admin.waitForFunction(() => document.querySelectorAll('#sn-list [data-note-id]').length === 1, { timeout: 20000 });
        await admin.click('#sn-list [data-note-id]');
        await admin.waitForSelector('.sn-readonly');
        await shot(admin, '2-admin-notes-team-desktop');

        // 3. Nhân viên (Huy) trên điện thoại: thẻ ghi chú ở trang chủ, tạo ghi chú mới
        const huy = await open(users.huy, phone);
        await huy.goto(origin + '/nhan-vien.html', { waitUntil: 'domcontentloaded' });
        await huy.waitForFunction(() => document.querySelectorAll('#staff-notes-card [data-note-id]').length === 1, { timeout: 20000 });
        await huy.evaluate(() => document.getElementById('staff-notes-card').scrollIntoView());
        await shot(huy, '3-home-card-phone');
        await huy.click('#staff-notes-card [data-sn-new]');
        await huy.waitForSelector('#sn-title');
        await huy.type('#sn-title', 'Việc tối nay');
        await huy.type('#sn-body', 'Mang sổ điểm danh lớp FFL');
        await huy.click('.sn-tool[data-act="add-item"]');
        await huy.keyboard.type('Photo 20 bản đề');
        await huy.keyboard.press('Enter');
        await huy.keyboard.type('Báo phòng P11');
        await huy.click('.sn-dot[data-color="green"]');
        await huy.waitForFunction(() => document.getElementById('sn-save-status')?.textContent === 'Đã lưu', { timeout: 15000 });
        await shot(huy, '4-notes-editor-phone');
        await huy.click('.sn-back');
        await shot(huy, '5-notes-list-phone');
        let notes;
        await env.withSecurityRulesDisabled(async c => { notes = (await c.firestore().collection('staff_notes').where('staffId', '==', users.huy.id).get()).docs.map(d => d.data()); });
        const created = notes.find(n => n.title === 'Việc tối nay');
        assert.ok(created, 'ghi chú mới đã lưu lên máy chủ');
        assert.deepEqual(created.items.map(i => i.text), ['Photo 20 bản đề', 'Báo phòng P11']);
        assert.equal(created.color, 'green');
        assert.equal(created.body, 'Mang sổ điểm danh lớp FFL');

        // 3b. Desktop notebook của nhân viên
        const huyDesk = await open(users.huy, desktop);
        await huyDesk.goto(origin + '/nhan-vien.html', { waitUntil: 'domcontentloaded' });
        await huyDesk.waitForSelector('[data-staff-notes-button]:not([hidden])', { timeout: 20000 });
        await huyDesk.click('[data-staff-notes-button]');
        await huyDesk.waitForFunction(() => document.querySelectorAll('#sn-list [data-note-id]').length === 2, { timeout: 20000 });
        await huyDesk.click('#sn-list [data-note-id]');
        await new Promise(r => setTimeout(r, 400));
        await shot(huyDesk, '6-notes-desktop');

        // 4. Tiếp tân (không dạy): chỉ xem lịch + Bảng lịch
        const tt = await open(users.tt, phone);
        await tt.goto(origin + `/lich-lam.html?date=${dateKey}&branch=cs1`, { waitUntil: 'domcontentloaded' });
        await tt.waitForFunction(() => document.querySelectorAll('#table-body tr[data-row-locator]').length >= 3, { timeout: 30000 });
        await tt.waitForSelector('#btn-schedule-sheet', { visible: true, timeout: 20000 });
        const visibleButtons = await tt.$$eval('#admin-actions button', els => els.filter(b => b.offsetParent !== null).map(b => b.id || b.textContent.trim()));
        console.log('reception visible buttons:', visibleButtons);
        assert.deepEqual(visibleButtons, ['btn-schedule-sheet']);
        assert.equal(await tt.$$eval('#table-body input:not([readonly])', els => els.length), 0, 'tiếp tân không có ô sửa');
        await shot(tt, '7-reception-lich-lam-phone');
        await tt.click('#btn-schedule-sheet');
        await tt.waitForFunction(() => { const o = document.getElementById('ssheet-overlay'); return o && !o.hidden; }, { timeout: 10000 });
        await new Promise(r => setTimeout(r, 2500));
        await shot(tt, '8-reception-sheet-phone');

        console.log('errors:', errors);
        assert.deepEqual(errors, []);
        console.log('OWNER VISUAL CHECK PASSED');
    } finally {
        if (browser) await browser.close();
        if (server) server.close();
        await env.cleanup();
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
