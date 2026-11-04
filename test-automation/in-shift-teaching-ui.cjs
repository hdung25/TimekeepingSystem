'use strict';
// Emulator UI flow (v257): Huy đang trực tiếp tân 13:30–18:00 thì được nhờ dạy thay
// 15:00–16:30. Admin rồi Trợ lý cấp cao mở ca tiếp tân ở Bảng công → "+ Ghi phần dạy
// thay" → lưu. Kiểm tra: ghi đúng một phiên dạy inShiftTeaching nằm trong ca, ca tiếp
// tân gốc giữ nguyên, bảng công hiện tiếp tân −1h30p dạy + chip dạy thay; giờ lấn ra
// ngoài ca bị từ chối và không ghi gì.
// Chạy: firebase emulators:exec --only auth,firestore --project demo-timekeeping
//       --config ../firebase.browser.json "node in-shift-teaching-ui.cjs"
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const root = path.resolve(__dirname, '..');
const password = 'LocalFixtureOnly-20260905';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const dateKey = new Date(Date.now() + 7 * 3600000 - 86400000).toISOString().slice(0, 10);
const docId = `${dateKey}_fixture-huy`;
const users = [
    { id: 'fixture-huy', username: 'fixturehuy', name: 'Fixture Huy', roles: ['teaching_assistant', 'receptionist'] },
    { id: 'fixture-admin', username: 'fixtureadmin', name: 'Fixture Admin', roles: ['admin'] },
    { id: 'fixture-senior', username: 'fixturesenior', name: 'Fixture Senior', roles: ['senior_assistant'] }
];
const hostSession = {
    id: 'huy-reception', source: 'self', status: 'closed', anchorDateKey: dateKey,
    role: 'tiep-tan', roleName: 'Tiếp Tân',
    start: dateKey + 'T13:29:41+07:00', checkIn: dateKey + 'T13:29:41+07:00', checkOut: dateKey + 'T18:00:20+07:00'
};

async function main() {
    for (const host of [emulatorHost, authHost]) assert.match(host || '', /^127\.0\.0\.1:\d+$/, 'Local emulators required');
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    let browser, server;
    try {
        await env.clearFirestore();
        await fetch(`http://${authHost}/emulator/v1/projects/demo-timekeeping/accounts`, { method: 'DELETE' });
        for (const user of users) {
            const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fixture`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: user.username + '@tuduytre.com', password, returnSecureToken: true })
            });
            assert.equal(response.ok, true);
            user.authUid = (await response.json()).localId;
        }
        await env.withSecurityRulesDisabled(async c => {
            const db = c.firestore();
            for (const u of users) {
                await db.collection('users').doc(u.id).set({ ...u, role: u.roles[0], salary_config: { attendance_rate: 100000, receptionist_normal_rate: 30000, roles: [{ id: 'subject-e3', name: 'E3', rate: 100000 }, { id: 'subject-pre', name: 'Pre I1', rate: 120000 }] } });
                await db.collection('user_roles').doc(u.authUid).set({ userId: u.id, username: u.username, role: u.roles[0], roles: u.roles });
                const { authUid, ...publicUser } = u;
                await db.collection('staff_directory').doc(u.id).set({ ...publicUser, role: u.roles[0] });
            }
            await db.collection('settings').doc('system').set({ gpsCS1Lat: 10, gpsCS1Lng: 106, gpsCS1Radius: 200 });
            await db.collection('subjects').doc('subject-e3').set({ name: 'E3', rate: 100000 });
            await db.collection('subjects').doc('subject-pre').set({ name: 'Pre I1', rate: 120000 });
        });
        const resetDay = () => env.withSecurityRulesDisabled(async c => {
            await c.firestore().collection('attendance_logs').doc(docId).set({
                userId: 'fixture-huy', name: 'Fixture Huy', date: dateKey, sessions: [{ ...hostSession }]
            });
        });
        const readDoc = async () => {
            let data;
            await env.withSecurityRulesDisabled(async c => { data = (await c.firestore().collection('attendance_logs').doc(docId).get()).data(); });
            return data;
        };
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

        for (const viewer of ['fixtureadmin', 'fixturesenior']) {
            await resetDay();
            const context = await browser.createBrowserContext();
            const page = await context.newPage();
            await page.setViewport({ width: 1280, height: 900 });
            await page.emulateTimezone('Asia/Ho_Chi_Minh');
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            page.on('dialog', d => d.accept());
            await page.setRequestInterception(true);
            page.on('request', req => {
                const url = new URL(req.url());
                const sdk = /^\/firebasejs\/12\.18\.0\/(firebase-[a-z-]+-compat\.js)$/.exec(url.pathname);
                if (url.hostname === 'www.gstatic.com' && sdk) {
                    req.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'node_modules/firebase', sdk[1])) }); return;
                }
                if (/googleapis\.com$/.test(url.hostname)) { req.abort(); return; }
                if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
                    req.respond({ status: 200, contentType: req.resourceType() === 'stylesheet' ? 'text/css' : 'text/javascript', body: '' }); return;
                }
                req.continue();
            });
            await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
            await page.type('#username', viewer);
            await page.type('#password', password);
            await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#login-form button[type="submit"]')]);
            await page.goto(`${origin}/bao-cao.html?staffId=fixture-huy&date=${dateKey}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForFunction(() => window.__TDT_REPORT_BOOTSTRAP_READY__ === true, { timeout: 30000 });
            await page.waitForFunction(() => window.payrollReadyScope === window.currentReportScope && !!window.payrollReadyScope, { timeout: 30000 });

            const openHost = async () => {
                await page.evaluate(async (dk) => {
                    window.__alerts = [];
                    window.alert = m => window.__alerts.push(String(m));
                    const raw = (window.currentAttendanceMap?.[dk] || []).find(s => s.id === 'huy-reception');
                    if (!raw) throw new Error('host session not loaded');
                    await openEditModal(dk, 'huy-reception', { sessionData: raw, text: 'Tiếp Tân' }, '', '', '', '', true);
                }, dateKey);
                await page.waitForSelector('#btn-open-in-shift-teaching', { visible: true, timeout: 10000 });
                await page.click('#btn-open-in-shift-teaching');
                await page.waitForSelector('#in-shift-teaching-dialog [data-action="save"]', { visible: true, timeout: 5000 });
            };
            const fill = async (from, to, subjectIds) => {
                await page.evaluate((a, b) => {
                    const box = document.getElementById('in-shift-teaching-dialog');
                    box.querySelector('[data-field="from"]').value = a;
                    box.querySelector('[data-field="to"]').value = b;
                    box.querySelector('[data-field="note"]').value = 'thiếu GV lớp E3';
                    box.querySelectorAll('[data-field="subject"] input[type="checkbox"]').forEach(cb => { cb.checked = false; });
                }, from, to);
                // Tick thật bằng chuột: lớp ghép chọn nhiều môn.
                for (const id of subjectIds) await page.click(`#in-shift-teaching-dialog [data-field="subject"] input[value="${id}"]`);
            };

            // 1) Lấn ra ngoài ca → báo lỗi trong popup, không ghi gì.
            await openHost();
            const defaults = await page.evaluate(() => {
                const box = document.getElementById('in-shift-teaching-dialog');
                return [box.querySelector('[data-field="from"]').value, box.querySelector('[data-field="to"]').value];
            });
            assert.deepEqual(defaults, ['13:29', '18:00'], 'mặc định là giờ của ca tiếp tân');
            await fill('17:30', '19:00', ['subject-e3']);
            await page.click('#in-shift-teaching-dialog [data-action="save"]');
            await page.waitForFunction(() => {
                const el = document.querySelector('#in-shift-teaching-dialog [data-field="error"]');
                return el && el.style.display === 'block' && el.textContent.length > 0;
            }, { timeout: 15000 });
            const errText = await page.$eval('#in-shift-teaching-dialog [data-field="error"]', el => el.textContent);
            assert.match(errText, /nằm trong giờ vào\/ra của ca tiếp tân/);
            assert.equal((await readDoc()).sessions.length, 1, 'giờ sai không được ghi');
            console.log(`PASS [${viewer}] outside-host range rejected, nothing written`);

            // 2) Ghi đúng 15:00–16:30.
            await fill('15:00', '16:30', ['subject-e3', 'subject-pre']);
            assert.match(await page.$eval('#in-shift-teaching-dialog [data-field="subject-picked"]', el => el.textContent), /Đã chọn: E3 \+ Pre I1/);
            await page.click('#in-shift-teaching-dialog [data-action="save"]');
            await page.waitForFunction(() => !document.getElementById('in-shift-teaching-dialog') &&
                document.getElementById('edit-time-modal').style.display === 'none', { timeout: 30000 });
            const saved = await readDoc();
            assert.equal(saved.sessions.length, 2);
            const host = saved.sessions.find(s => s.id === 'huy-reception');
            assert.deepEqual(host, hostSession, 'ca tiếp tân gốc giữ nguyên');
            const cover = saved.sessions.find(s => s.id !== 'huy-reception');
            assert.equal(cover.inShiftTeaching, true);
            assert.equal(cover.hostSessionId, 'huy-reception');
            assert.equal(cover.role, 'subject-e3+subject-pre', 'lớp ghép lưu cả 2 môn');
            assert.equal(cover.roleName, 'E3 + Pre I1');
            assert.equal(cover.note, 'thiếu GV lớp E3');
            assert.equal(new Date(cover.checkIn).toISOString(), new Date(dateKey + 'T15:00:00+07:00').toISOString());
            assert.equal(new Date(cover.checkOut).toISOString(), new Date(dateKey + 'T16:30:00+07:00').toISOString());
            const alerts = await page.evaluate(() => window.__alerts);
            assert.ok(alerts.some(a => /Đã ghi phần dạy thay 15:00 - 16:30 \(E3 \+ Pre I1\)/.test(a)), 'alerts: ' + alerts.join(' | '));

            // 3) Bảng công sau khi tải lại: tiếp tân trừ 1h30, có chip dạy thay.
            await page.waitForFunction(() => /dạy thay trong ca/.test(document.body.innerText), { timeout: 30000 });
            const text = await page.evaluate(() => document.body.innerText);
            assert.match(text, /−1h30p dạy/, 'chip tiếp tân phải ghi đã trừ 1h30 dạy');
            assert.match(text, /15:00–16:30 \(E3 \+ Pre I1\) · dạy thay trong ca/);
            // Lương: dạy 1h30 lớp ghép tính riêng; tiếp tân chỉ còn 181 phút × 30.000/h
            // (phiên thật 13:29:41–18:00:20 trừ 90 phút dạy), không còn 271 phút như trước.
            const pay = await page.evaluate(() => ({
                teaching: getCurrentCalculationPayload('giao-vien').baseSalary,
                reception: getCurrentCalculationPayload('tiep-tan').baseSalary
            }));
            assert.equal(pay.teaching, 180000, 'lớp ghép E3 + Pre I1 tính theo môn cao nhất (120.000 × 1h30)');
            assert.equal(pay.reception, 90500, 'phần tiếp tân đã trừ giờ dạy');

            // 4) Mở lại ca tiếp tân: ô dạy thay liệt kê phần đã ghi.
            await page.evaluate(async (dk) => {
                const raw = (window.currentAttendanceMap?.[dk] || []).find(s => s.id === 'huy-reception');
                await openEditModal(dk, 'huy-reception', { sessionData: raw, text: 'Tiếp Tân' }, '', '', '', '', true);
            }, dateKey);
            const boxText = await page.$eval('#edit-in-shift-teaching', el => el.innerText);
            assert.match(boxText, /Đã ghi: 15:00–16:30 E3 \+ Pre I1/);
            await page.evaluate(() => closeEditModal());
            assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
            console.log(`PASS [${viewer}] in-shift teaching saved; reception −1h30p, cover chip shown`);
            if (viewer === 'fixtureadmin') {
                // 5) Lỗi chị Thuý 04/11: mở ca ngày A rồi bấm Thêm ca ngày B → khung dạy thay
                // của ngày A còn sót lại (bấm vào sẽ ghi nhầm ngày A). Phải ẩn.
                const otherDay = dateKey.slice(0, 8) + (dateKey.endsWith('-01') ? '02' : '01');
                await page.evaluate(async (dk) => {
                    const raw = (window.currentAttendanceMap?.[dk] || []).find(s => s.id === 'huy-reception');
                    await openEditModal(dk, 'huy-reception', { sessionData: raw, text: 'Tiếp Tân' }, '', '', '', '', true);
                }, dateKey);
                assert.equal(await page.$eval('#edit-in-shift-teaching', el => el.style.display), 'block');
                await page.evaluate(async (dk) => { await openManualModal(dk); }, otherDay);
                const stale = await page.$eval('#edit-in-shift-teaching', el => ({ display: el.style.display, html: el.innerHTML }));
                assert.deepEqual(stale, { display: 'none', html: '' }, 'Thêm ca ngày khác không được giữ khung dạy thay cũ');
                await page.evaluate(() => closeEditModal());
                console.log('PASS [fixtureadmin] add-shift form never shows the previous day dạy-thay box');

                // 6) Khung giờ trùng lớp đã có trong lịch (đã được tính dạy) → chặn, không ghi.
                await page.evaluate((dk) => {
                    window.unfilteredAllMonthChips.push({ dateStr: dk, isTeaching: true, paidMinutes: 90, classStart: '16:30',
                        text: '16:30–18:00 CS1 (FFS1)', sessionData: { checkIn: dk + 'T16:30:00+07:00' } });
                }, dateKey);
                const sessionsBefore = (await readDoc()).sessions.length;
                await openHost();
                await fill('17:00', '17:45', ['subject-e3']);
                await page.click('#in-shift-teaching-dialog [data-action="save"]');
                await page.waitForFunction(() => document.querySelector('#in-shift-teaching-dialog [data-field="error"]')?.style.display === 'block', { timeout: 10000 });
                assert.match(await page.$eval('#in-shift-teaching-dialog [data-field="error"]', el => el.textContent), /đã có lớp trong lịch được tính dạy rồi: 16:30–18:00 CS1 \(FFS1\)/);
                assert.equal((await readDoc()).sessions.length, sessionsBefore, 'trùng lớp trong lịch thì không ghi');
                await page.evaluate(() => closeEditModal());
                assert.equal(await page.$('#in-shift-teaching-dialog'), null, 'đóng ô sửa ca thì đóng luôn popup dạy thay');
                console.log('PASS [fixtureadmin] overlap with a scheduled class is refused before writing');
            }
            await context.close();
        }
        console.log('in-shift-teaching-ui.cjs: all assertions passed');
    } finally {
        if (browser) await browser.close();
        if (server) server.close();
        await env.cleanup();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
