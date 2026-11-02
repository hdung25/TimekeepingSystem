'use strict';
// Emulator UI flow: Admin thêm ca 16:00–18:00 khi ngày đó đã có ca tự chấm 16:15–18:00 và
// ca 18:00–21:00 (cô Vy 23/10). Popup trùng giờ: "Hủy bỏ" không đổi gì; "Sửa ca có sẵn"
// nới ca 16:15–18:00 thành 16:00–18:00, giữ nguyên ca 18:00–21:00, không thêm ca thứ ba.
// Chạy: firebase emulators:exec --only auth,firestore --project demo-timekeeping
//       --config ../firebase.browser.json "node add-session-overlap-merge-ui.cjs"
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
const docId = `${dateKey}_fixture-vy`;
const users = [
    { id: 'fixture-vy', username: 'fixturevy', name: 'Fixture Vy', roles: ['teaching_assistant'] },
    { id: 'fixture-admin', username: 'fixtureadmin', name: 'Fixture Admin', roles: ['admin'] }
];

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
                await db.collection('users').doc(u.id).set({ ...u, role: u.roles[0], salary_config: { attendance_rate: 100000, roles: [{ id: 'fixture-subject', name: 'Fixture class', rate: 100000 }] } });
                await db.collection('user_roles').doc(u.authUid).set({ userId: u.id, username: u.username, role: u.roles[0], roles: u.roles });
                const { authUid, ...publicUser } = u;
                await db.collection('staff_directory').doc(u.id).set({ ...publicUser, role: u.roles[0] });
            }
            await db.collection('settings').doc('system').set({ gpsCS1Lat: 10, gpsCS1Lng: 106, gpsCS1Radius: 200 });
            await db.collection('subjects').doc('fixture-subject').set({ name: 'Fixture class', rate: 100000 });
            await db.collection('attendance_logs').doc(docId).set({
                userId: 'fixture-vy', name: 'Fixture Vy', date: dateKey,
                sessions: [
                    { id: 'self-early', source: 'self', status: 'closed', anchorDateKey: dateKey, studentCount: 3,
                        start: dateKey + 'T16:15:00+07:00', checkIn: dateKey + 'T16:15:00+07:00', checkOut: dateKey + 'T18:00:00+07:00' },
                    { id: 'self-evening', source: 'self', status: 'closed', anchorDateKey: dateKey,
                        role: 'fixture-subject', roleName: 'Fixture class', roleRate: 100000,
                        start: dateKey + 'T18:00:00+07:00', checkIn: dateKey + 'T18:00:00+07:00', checkOut: dateKey + 'T21:00:00+07:00' }
                ]
            });
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
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        await page.emulateTimezone('Asia/Ho_Chi_Minh');
        const errors = [];
        const alerts = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
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
        await page.type('#username', 'fixtureadmin');
        await page.type('#password', password);
        await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#login-form button[type="submit"]')]);
        await page.goto(`${origin}/bao-cao.html?staffId=fixture-vy&date=${dateKey}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => window.__TDT_REPORT_BOOTSTRAP_READY__ === true, { timeout: 30000 });
        await page.waitForFunction(() => window.payrollReadyScope === window.currentReportScope && !!window.payrollReadyScope, { timeout: 30000 });

        const readDoc = async () => {
            let data;
            await env.withSecurityRulesDisabled(async c => { data = (await c.firestore().collection('attendance_logs').doc(docId).get()).data(); });
            return data;
        };
        const openAddForm = async () => {
            await page.evaluate(async (dk) => {
                await openManualModal(dk);
                document.getElementById('edit-check-in').value = dk + 'T16:00';
                document.getElementById('edit-check-out').value = dk + 'T18:00';
                const subject = allAvailableSubjects.find(x => x.id === 'fixture-subject');
                if (!subject) throw new Error('fixture subject not loaded: ' + JSON.stringify(allAvailableSubjects.map(x => x.id)));
                editSelectedSubjectIds = ['fixture-subject'];
            }, dateKey);
            await page.evaluate(() => { window.__alerts = []; window.alert = m => window.__alerts.push(String(m)); saveEditedTime(); });
            try {
                await page.waitForSelector('.custom-modal-box [data-choice="merge"]', { visible: true, timeout: 15000 });
            } catch (error) {
                const box = await page.evaluate(() => JSON.stringify({
                    modal: document.querySelector('.custom-modal-box')?.innerText || '(no modal)',
                    pending: window.__adminPayrollSavePending,
                    sid: document.getElementById('edit-session-id').value,
                    inV: document.getElementById('edit-check-in').value,
                    outV: document.getElementById('edit-check-out').value,
                    editModal: document.getElementById('edit-time-modal').style.display,
                    role: document.getElementById('edit-role')?.value
                }));
                console.log(JSON.stringify(await readDoc()));
                throw new Error(`overlap popup missing. alerts=${alerts.join(' | ')} errors=${errors.join(' | ')} modal=${box}`);
            }
        };

        // 1) Hủy bỏ → dữ liệu không đổi.
        await openAddForm();
        const popupText = await page.$eval('.custom-modal-box', el => el.innerText);
        assert.match(popupText, /16:15/);
        assert.match(popupText, /16:00–18:00/);
        await page.click('.custom-modal-box [data-choice=""]');
        await page.waitForFunction(() => !document.querySelector('.custom-modal-box'), { timeout: 5000 });
        let saved = await readDoc();
        assert.equal(saved.sessions.length, 2);
        assert.equal(saved.sessions[0].checkIn, dateKey + 'T16:15:00+07:00');
        console.log('PASS Hủy bỏ leaves both sessions untouched');
        await page.evaluate(() => closeEditModal());

        // 2) Sửa ca có sẵn → nới 16:15 thành 16:00, không thêm ca, ca tối giữ nguyên.
        await openAddForm();
        await page.click('.custom-modal-box [data-choice="merge"]');
        await page.waitForFunction(() => document.getElementById('edit-time-modal').style.display === 'none', { timeout: 30000 });
        saved = await readDoc();
        assert.equal(saved.sessions.length, 2, 'không được thêm ca thứ ba');
        const early = saved.sessions.find(s => s.id === 'self-early');
        const evening = saved.sessions.find(s => s.id === 'self-evening');
        assert.equal(new Date(early.checkIn).toISOString(), new Date(dateKey + 'T16:00:00+07:00').toISOString());
        assert.equal(new Date(early.checkOut).toISOString(), new Date(dateKey + 'T18:00:00+07:00').toISOString());
        assert.equal(early.studentCount, 3, 'các trường khác của ca có sẵn phải được giữ');
        assert.equal(early.editHistory.length, 1);
        assert.equal(evening.checkIn, dateKey + 'T18:00:00+07:00');
        assert.equal(evening.checkOut, dateKey + 'T21:00:00+07:00');
        assert.equal(evening.role, 'fixture-subject');
        const pageAlerts = await page.evaluate(() => window.__alerts);
        assert.ok(pageAlerts.some(a => /Đã sửa ca có sẵn thành 16:00 - 18:00/.test(a)), 'alerts: ' + pageAlerts.join(' | '));
        console.log('PASS Sửa ca có sẵn widens 16:15–18:00 to 16:00–18:00; 18:00–21:00 untouched; no third session');

        assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
        console.log('add-session-overlap-merge-ui.cjs: all assertions passed');
    } finally {
        if (browser) await browser.close();
        if (server) server.close();
        await env.cleanup();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
