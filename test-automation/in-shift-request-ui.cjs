'use strict';
// Emulator UI flow (v280): chị Thuý 11/11 — nhân viên đang trực tiếp tân được nhờ dạy thay tự
// gửi đơn ở Chấm Công Bù → tab "Dạy Thay Trong Ca", quản lý duyệt ở Tường Trình (như tăng ca /
// tường trình). Kiểm tra: giờ lấn ngoài ca bị chặn không ghi gì; đơn hợp lệ vào "Chờ duyệt";
// trang Tường Trình không tự đóng đơn (ca tiếp tân không phải "đã có công"), hiện đúng loại,
// duyệt không hỏi tháng trả; Bảng Công có phần dạy thay, tiếp tân trừ đúng 1h30, lương đúng.
// Chạy: firebase emulators:exec --only auth,firestore --project demo-timekeeping
//       --config ../firebase.browser.json "node in-shift-request-ui.cjs"
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const root = path.resolve(__dirname, '..');
const shotsDir = process.env.SHOTS_DIR || '';
const password = 'LocalFixtureOnly-20260905';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const dateKey = new Date(Date.now() + 7 * 3600000 - 86400000).toISOString().slice(0, 10);
const docId = `${dateKey}_fixture-huy`;
const users = [
    { id: 'fixture-huy', username: 'fixturehuy', name: 'Fixture Huy', roles: ['teaching_assistant', 'receptionist'] },
    { id: 'fixture-admin', username: 'fixtureadmin', name: 'Fixture Admin', roles: ['admin'] }
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
    const readAll = async () => {
        let attendance, requests;
        await env.withSecurityRulesDisabled(async c => {
            const db = c.firestore();
            attendance = (await db.collection('attendance_logs').doc(docId).get()).data();
            requests = (await db.collection('makeup_requests').get()).docs.map(d => ({ id: d.id, ...d.data() }));
        });
        return { attendance, requests };
    };
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
            await db.collection('attendance_logs').doc(docId).set({ userId: 'fixture-huy', name: 'Fixture Huy', date: dateKey, sessions: [{ ...hostSession }] });
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
        browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--lang=vi-VN'] });

        const openAs = async (username, viewport) => {
            const context = await browser.createBrowserContext();
            const page = await context.newPage();
            await page.setViewport(viewport);
            await page.emulateTimezone('Asia/Ho_Chi_Minh');
            const errors = [], dialogs = [];
            page.on('pageerror', e => errors.push(e.message));
            page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.accept(); });
            await page.setRequestInterception(true);
            page.on('request', req => {
                const url = new URL(req.url());
                const sdk = /^\/firebasejs\/12\.18\.0\/(firebase-[a-z-]+-compat\.js)$/.exec(url.pathname);
                if (url.hostname === 'www.gstatic.com' && sdk) {
                    req.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'node_modules/firebase', sdk[1])) }); return;
                }
                if (/googleapis\.com$/.test(url.hostname)) { req.abort(); return; }
                if (url.hostname === 'unpkg.com' && /lucide/.test(url.pathname)) {
                    const local = path.join(__dirname, 'node_modules/lucide/dist/umd/lucide.min.js');
                    if (fs.existsSync(local)) { req.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(local) }); return; }
                }
                if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
                    req.respond({ status: 200, contentType: req.resourceType() === 'stylesheet' ? 'text/css' : 'text/javascript', body: '' }); return;
                }
                req.continue();
            });
            await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
            await page.type('#username', username);
            await page.type('#password', password);
            await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#login-form button[type="submit"]')]);
            return { context, page, errors, dialogs };
        };

        // ===== 1) Nhân viên gửi đơn trên điện thoại =====
        const staff = await openAs('fixturehuy', { width: 390, height: 844, isMobile: true, hasTouch: true });
        const sp = staff.page;
        await sp.goto(`${origin}/cham-bu.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sp.waitForSelector('#m-inshift:not([hidden])', { visible: true, timeout: 30000 });
        assert.equal(await sp.$eval('.modes', el => el.classList.contains('three')), true);
        await sp.click('#m-inshift');
        await sp.waitForSelector('#p-inshift', { visible: true });
        await sp.waitForFunction(() => document.querySelectorAll('#is-subjects input[type="checkbox"]').length === 2, { timeout: 20000 });
        await sp.evaluate(dk => { const el = document.getElementById('is-date'); el.value = dk; return onInShiftDateChange(); }, dateKey);
        await sp.waitForSelector('#is-hosts input[name="is-host"]', { timeout: 20000 });
        const hostText = await sp.$eval('#is-hosts', el => el.innerText);
        assert.match(hostText, /Tiếp Tân 13:29–18:00/);
        const defaults = await sp.evaluate(() => [document.getElementById('is-from').value, document.getElementById('is-to').value]);
        assert.deepEqual(defaults, ['13:29', '18:00'], 'một ca tiếp tân → tự chọn, giờ mặc định theo ca');

        const fill = async (from, to) => {
            await sp.evaluate((a, b) => {
                document.getElementById('is-from').value = a;
                document.getElementById('is-to').value = b;
                document.getElementById('is-branch').value = 'cs1';
                document.getElementById('is-approver').value = 'Chị Thuý';
                document.getElementById('is-reason').value = 'Cô Lan nghỉ đột xuất, dạy thay lớp E3';
                document.querySelectorAll('#is-subjects input:checked').forEach(cb => { cb.checked = false; });
            }, from, to);
            for (const id of ['subject-e3', 'subject-pre']) await sp.click(`#is-subjects input[value="${id}"]`);
        };
        // 1a) Lấn ra ngoài ca → chặn, không ghi.
        await fill('17:30', '19:00');
        staff.dialogs.length = 0;
        await sp.click('#is-submit');
        await sp.waitForFunction(() => true);
        await new Promise(r => setTimeout(r, 400));
        assert.ok(staff.dialogs.some(d => /nằm trong giờ vào\/ra của ca tiếp tân/.test(d)), staff.dialogs.join(' | '));
        assert.equal((await readAll()).requests.length, 0, 'giờ sai không được gửi');
        console.log('PASS [staff] outside-host range refused, nothing written');

        // 1b) Gửi đúng 15:00–16:30 lớp ghép E3 + Pre I1.
        await fill('15:00', '16:30');
        assert.match(await sp.$eval('#is-picked', el => el.textContent), /Đã chọn: E3 \+ Pre I1/);
        if (shotsDir) await sp.screenshot({ path: path.join(shotsDir, 'staff-form.png'), fullPage: true });
        staff.dialogs.length = 0;
        await sp.click('#is-submit');
        await sp.waitForFunction(() => /Dạy thay trong ca/.test(document.getElementById('my-reqs').innerText), { timeout: 30000 });
        assert.ok(staff.dialogs.some(d => /^confirm: Gửi yêu cầu dạy thay ngày/.test(d)), staff.dialogs.join(' | '));
        assert.ok(staff.dialogs.some(d => /Đã gửi yêu cầu dạy thay/.test(d)), staff.dialogs.join(' | '));
        let data = await readAll();
        assert.equal(data.requests.length, 1);
        const req = data.requests[0];
        assert.equal(req.type, 'in_shift_teaching');
        assert.equal(req.status, 'pending');
        assert.equal(req.staffId, 'fixture-huy');
        assert.equal(req.hostSessionId, 'huy-reception');
        assert.equal(req.session.role, 'subject-e3+subject-pre');
        assert.equal(req.approvedBy, 'Chị Thuý');
        assert.equal(new Date(req.session.checkIn).toISOString(), new Date(dateKey + 'T15:00:00+07:00').toISOString());
        assert.equal(data.attendance.sessions.length, 1, 'gửi đơn không đụng Bảng Công');
        const myText = await sp.$eval('#my-reqs', el => el.innerText);
        assert.match(myText, /Chờ duyệt/);
        if (shotsDir) await sp.screenshot({ path: path.join(shotsDir, 'staff-sent.png'), fullPage: true });
        // 1c) Gửi lại đúng khung giờ → chặn (đã có đơn đang chờ).
        await fill('15:00', '16:30');
        staff.dialogs.length = 0;
        await sp.click('#is-submit');
        await sp.waitForFunction(() => !document.querySelector('#is-submit').disabled, { timeout: 20000 });
        await new Promise(r => setTimeout(r, 300));
        assert.ok(staff.dialogs.some(d => /đang chờ duyệt/.test(d)), staff.dialogs.join(' | '));
        assert.equal((await readAll()).requests.length, 1);
        // Tab Ca Có Lịch vẫn hoạt động.
        await sp.click('#m-sched');
        await sp.waitForSelector('#p-sched', { visible: true });
        assert.deepEqual(staff.errors, [], 'staff page errors: ' + staff.errors.join(' | '));
        await staff.context.close();
        console.log('PASS [staff] request sent as pending; duplicate refused; Bảng Công untouched');

        // ===== 2) Quản lý duyệt ở Tường Trình =====
        const admin = await openAs('fixtureadmin', { width: 1280, height: 900 });
        const ap = admin.page;
        await ap.goto(`${origin}/tuong-trinh.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await ap.waitForFunction(() => /Dạy thay trong ca/.test(document.getElementById('rows').innerText), { timeout: 30000 });
        data = await readAll();
        assert.equal(data.requests[0].status, 'pending', 'không được tự đóng đơn vì ca tiếp tân');
        assert.equal(await ap.$eval('#c-pending', el => el.innerText), '1');
        await ap.click('#rows .row');
        await ap.waitForFunction(() => /Đối chiếu tự động/.test(document.getElementById('detail').innerText), { timeout: 10000 });
        const detail = await ap.$eval('#detail', el => el.innerText);
        assert.match(detail, /Dạy thay trong ca — cần quản lý xác nhận/);
        // Nhãn cột viết hoa bằng CSS nên innerText ra chữ in hoa.
        assert.match(detail, /Người nhờ dạy thay\s+Chị Thuý/i);
        assert.match(detail, /Ca tiếp tân\s+Tiếp Tân 13:29–18:00/i);
        assert.match(detail, /tháng dạy/);
        if (shotsDir) await ap.screenshot({ path: path.join(shotsDir, 'manager-detail.png') });
        await ap.evaluate(() => [...document.querySelectorAll('#detail button')].find(b => /^\s*Duyệt\s*$/.test(b.innerText)).click());
        await ap.waitForSelector('#modal-confirm-btn', { visible: true, timeout: 10000 });
        assert.match(await ap.$eval('.custom-modal-box', el => el.innerText), /Duyệt dạy thay trong ca\?/);
        assert.equal(await ap.$('input[name="tt-payout"]'), null, 'không hỏi tháng trả cho dạy thay');
        await ap.click('#modal-confirm-btn');
        await ap.waitForFunction(() => document.getElementById('c-pending').innerText === '0', { timeout: 30000 });
        data = await readAll();
        assert.equal(data.requests[0].status, 'approved');
        assert.equal(data.attendance.sessions.length, 2);
        assert.deepEqual(data.attendance.sessions.find(s => s.id === 'huy-reception'), hostSession, 'ca tiếp tân gốc giữ nguyên');
        const part = data.attendance.sessions.find(s => s.id !== 'huy-reception');
        assert.equal(part.inShiftTeaching, true);
        assert.equal(part.hostSessionId, 'huy-reception');
        assert.equal(part.makeupRequestId, data.requests[0].id);
        assert.equal(data.requests[0].materializedSessionId, part.id);
        assert.equal(part.role, 'subject-e3+subject-pre');
        assert.equal(part.roleName, 'E3 + Pre I1');
        assert.equal(part.roleRate, 120000);
        assert.deepEqual(admin.errors, [], 'tuong-trinh errors: ' + admin.errors.join(' | '));
        console.log('PASS [admin] approved on Tường Trình; one in-shift part written, host unchanged');

        // ===== 3) Bảng Công: tiếp tân −1h30p, phần dạy thay, lương đúng như ghi tay =====
        await ap.goto(`${origin}/bao-cao.html?staffId=fixture-huy&date=${dateKey}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await ap.waitForFunction(() => window.__TDT_REPORT_BOOTSTRAP_READY__ === true, { timeout: 30000 });
        await ap.waitForFunction(() => window.payrollReadyScope === window.currentReportScope && !!window.payrollReadyScope, { timeout: 30000 });
        await ap.waitForFunction(() => /dạy thay trong ca/.test(document.body.innerText), { timeout: 30000 });
        const text = await ap.evaluate(() => document.body.innerText);
        assert.match(text, /−1h30p dạy/);
        assert.match(text, /15:00–16:30 \(E3 \+ Pre I1\) · dạy thay trong ca/);
        const pay = await ap.evaluate(() => ({
            teaching: getCurrentCalculationPayload('giao-vien').baseSalary,
            reception: getCurrentCalculationPayload('tiep-tan').baseSalary
        }));
        assert.equal(pay.teaching, 180000, 'E3 + Pre I1 theo môn cao nhất 120.000 × 1h30');
        assert.equal(pay.reception, 90500, 'tiếp tân đã trừ 1h30 dạy');
        assert.deepEqual(admin.errors, [], 'bao-cao errors: ' + admin.errors.join(' | '));
        await admin.context.close();
        console.log('PASS [admin] Bảng Công pays teaching 180000 + reception 90500 (same as manual tool)');
        console.log('in-shift-request-ui.cjs: all assertions passed');
    } finally {
        if (browser) await browser.close();
        if (server) server.close();
        await env.cleanup();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
