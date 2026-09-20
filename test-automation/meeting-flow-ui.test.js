'use strict';
// Luồng họp định kỳ chạy thật trên trình duyệt + emulator:
// admin tạo lịch -> nhân viên tự điểm danh ở "Họp Của Tôi" -> lưới điểm danh của
// admin và tiêu chí X của bảng lương phải thấy đúng cùng một kết quả.
// Kiểm cả buổi "Tự chọn thành viên" và chế độ "điểm danh sẵn tất cả là Có".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

const root = path.resolve(__dirname, '..');
const password = 'LocalFixtureOnly-20260920';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// Đồng hồ của trang được ghim vào 10:00 giờ Việt Nam của HÔM NAY. Nếu để giờ
// thật, một lần chạy lúc 23:30 sẽ tạo khung giờ họp vắt qua nửa đêm và form từ
// chối. Ghim giờ làm test lặp lại được ở mọi thời điểm trong ngày.
const pad = value => String(value).padStart(2, '0');
const vnWall = ms => new Date(ms + 7 * 3600000);
const todayParts = (() => {
    const d = vnWall(Date.now());
    return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
})();
// 10:00 giờ Việt Nam = 03:00 UTC.
const PAGE_NOW_MS = Date.UTC(todayParts[0], todayParts[1], todayParts[2], 3, 0, 0);
const PAGE_CLOCK_OFFSET_MS = PAGE_NOW_MS - Date.now();
const today = () => `${todayParts[0]}-${pad(todayParts[1] + 1)}-${pad(todayParts[2])}`;
const monthStr = () => today().slice(0, 7);
const hhmm = offsetMinutes => {
    const d = vnWall(PAGE_NOW_MS + offsetMinutes * 60000);
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

const users = [
    { id: 'meet-admin', username: 'meetadmin', name: 'Meeting Admin', roles: ['admin'] },
    // TRẦN GIA BẢO nằm trong TA_NAMES -> chuyên môn "TG TA".
    { id: 'meet-ta', username: 'meetta', name: 'TRẦN GIA BẢO', roles: ['teaching_assistant'] },
    { id: 'meet-ta2', username: 'meetta2', name: 'PHẠM QUANG TIẾN', roles: ['teaching_assistant'] }
];

function startServer() {
    const server = http.createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(root + path.sep) ||
            !/\.(html|js|css|png|jpg|jpeg|svg|ico|json|woff2?|ttf)$/i.test(file) ||
            /node_modules|\/\./.test(pathname)) { res.writeHead(403); res.end(); return; }
        try {
            let body = fs.readFileSync(file);
            if (pathname === '/js/firebase-config.js') {
                body = body.toString().replace(/projectId: "[^"]+"/, 'projectId: "demo-timekeeping"')
                    .replace('window.auth = firebase.auth();',
                        `window.auth = firebase.auth();\nwindow.auth.useEmulator('http://${authHost}', {disableWarnings:true});\nwindow.db.useEmulator('127.0.0.1', ${emulatorHost.split(':')[1]});`);
            }
            if (pathname === '/service-worker.js') body = 'self.addEventListener("install",()=>self.skipWaiting());';
            const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            res.end(body);
        } catch (_) { res.writeHead(404); res.end(); }
    });
    return server;
}

async function openSession(browser, origin, user) {
    const context = await browser.createBrowserContext();
    await context.overridePermissions(origin, ['geolocation']);
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.emulateTimezone('Asia/Ho_Chi_Minh');
    await page.setGeolocation({ latitude: 10, longitude: 106, accuracy: 10 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    await page.setRequestInterception(true);
    page.on('request', req => {
        const url = new URL(req.url());
        const sdk = /^\/firebasejs\/12\.18\.0\/(firebase-[a-z-]+-compat\.js)$/.exec(url.pathname);
        if (url.hostname === 'www.gstatic.com' && sdk) {
            req.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'node_modules/firebase', sdk[1])) });
            return;
        }
        if (/googleapis\.com$/.test(url.hostname)) { req.abort(); return; }
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
            req.respond({ status: 200, contentType: req.resourceType() === 'stylesheet' ? 'text/css' : 'text/javascript', body: '' });
            return;
        }
        req.continue();
    });
    await page.evaluateOnNewDocument(offset => {
        const RealDate = Date;
        const Shifted = function (...args) {
            if (!(this instanceof Shifted)) return new RealDate(RealDate.now() + offset).toString();
            return args.length === 0 ? new RealDate(RealDate.now() + offset) : new RealDate(...args);
        };
        Shifted.prototype = RealDate.prototype;
        Object.getOwnPropertyNames(RealDate).forEach(key => {
            if (['prototype', 'length', 'name'].includes(key)) return;
            Shifted[key] = RealDate[key];
        });
        Shifted.now = () => RealDate.now() + offset;
        window.Date = Shifted;
    }, PAGE_CLOCK_OFFSET_MS);
    await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.type('#username', user.username);
    await page.type('#password', password);
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.click('#login-form button[type="submit"]')
    ]);
    return { context, page, errors, dialogs };
}

async function createMeeting(page, origin, options, dialogSink = []) {
    await page.goto(origin + '/hop-dinh-ky.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#meetings-tbody tr[data-user-id]').length > 0, { timeout: 30000 });

    await page.evaluate(() => window.openCreateMeetingModal());
    await page.waitForSelector('#create-meeting-modal', { visible: true });

    await page.evaluate(opts => {
        const set = (id, value) => { document.getElementById(id).value = value; };
        set('meeting-title', opts.title);
        set('meeting-type', opts.type);
        const dept = document.getElementById('meeting-dept');
        dept.value = opts.department;
        dept.dispatchEvent(new Event('change'));
        set('meeting-date', opts.date);
        set('meeting-start', opts.startTime);
        set('meeting-end', opts.endTime);
        set('meeting-ci-start', opts.checkInStart);
        set('meeting-ci-close', opts.checkInClose);
        document.getElementById('meeting-require-network').checked = !!opts.requireNetwork;
        document.querySelector(`input[name="attendance-mode"][value="${opts.mode}"]`).checked = true;
    }, options);

    if (Array.isArray(options.attendeeIds)) {
        // Danh sách người dự được vẽ lại sau mỗi lần tick (người đã chọn nổi lên
        // đầu), nên phải tìm lại phần tử cho từng người thay vì giữ NodeList cũ.
        const ids = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#custom-attendees-list .custom-attendee-cb')).map(cb => cb.value));
        for (const id of ids) {
            const wanted = options.attendeeIds.includes(id);
            await page.evaluate((userId, shouldCheck) => {
                const cb = document.querySelector(`#custom-attendees-list .custom-attendee-cb[value="${userId}"]`);
                if (cb && cb.checked !== shouldCheck) cb.click();
            }, id, wanted);
        }
    }

    const selected = await page.evaluate(() => document.getElementById('attendee-selected-count').innerText);
    assert.match(selected, /Đã chọn: [1-9]/, 'phải có ít nhất một người được mời: ' + selected);

    await page.evaluate(() => document.getElementById('create-meeting-form')
        .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
    try {
        await page.waitForFunction(() => document.getElementById('create-meeting-modal').style.display === 'none', { timeout: 30000 });
    } catch (err) {
        throw new Error('Không tạo được cuộc họp: ' + JSON.stringify(options) + ' | dialogs=' + JSON.stringify(dialogSink));
    }
}

async function createMeetingEdit(page, origin, meetingId, changes) {
    await page.evaluate(id => window.openEditMeetingModal(id), meetingId);
    await page.waitForFunction(
        () => document.getElementById('create-meeting-submit')?.innerText === 'Lưu Thay Đổi',
        { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.getElementById('meeting-dept').disabled), true,
        'bộ phận phải bị khoá khi sửa');
    await page.evaluate(values => {
        if (values.title !== undefined) document.getElementById('meeting-title').value = values.title;
        if (values.checkInStart !== undefined) document.getElementById('meeting-ci-start').value = values.checkInStart;
        if (values.checkInClose !== undefined) document.getElementById('meeting-ci-close').value = values.checkInClose;
    }, changes);
    await page.evaluate(() => document.getElementById('create-meeting-form')
        .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
    await page.waitForFunction(
        () => document.getElementById('create-meeting-modal').style.display === 'none',
        { timeout: 30000 });
}

async function main() {
    for (const host of [emulatorHost, authHost]) {
        assert.match(host || '', /^127\.0\.0\.1:\d+$/, 'Local emulators required');
    }
    const env = await initializeTestEnvironment({
        projectId: 'demo-timekeeping',
        firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') }
    });
    let browser, server;
    const sessions = [];
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
                await db.collection('users').doc(u.id).set({
                    id: u.id, username: u.username, name: u.name, roles: u.roles, role: u.roles[0],
                    teachingMode: 'old',
                    salary_config: { attendance_rate: 100000, roles: [] }
                });
                await db.collection('user_roles').doc(u.authUid).set({ userId: u.id, username: u.username, role: u.roles[0], roles: u.roles });
                const { authUid, ...publicUser } = u;
                await db.collection('staff_directory').doc(u.id).set({ ...publicUser, role: u.roles[0] });
            }
            // Không cấu hình GPS -> assertMeetingLocationAllowed trả false và
            // không chặn điểm danh, nên test đo được đúng luồng nghiệp vụ.
            await db.collection('settings').doc('system').set({});
        });

        server = startServer();
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });

        const admin = await openSession(browser, origin, users[0]);
        sessions.push(admin);

        // --- 1. Buổi họp của tổ TG TA, nhân viên tự điểm danh -------------
        const deptMeeting = {
            title: 'Họp tổ TG TA', type: 'direct', department: 'TG TA',
            date: today(), startTime: hhmm(-30), endTime: hhmm(120),
            checkInStart: hhmm(-20), checkInClose: hhmm(60),
            requireNetwork: false, mode: 'self',
            attendeeIds: ['meet-ta', 'meet-ta2']
        };
        await createMeeting(admin.page, origin, deptMeeting, admin.dialogs);

        const created = await admin.page.evaluate(async month => {
            const list = await DBService.getMeetingsForMonth(month);
            return list.map(m => ({ id: m.id, title: m.title, department: m.department, attendees: m.attendees, requireNetwork: m.requireNetwork }));
        }, monthStr());
        assert.equal(created.length, 1, 'phải tạo đúng một cuộc họp');
        const deptMeetingId = created[0].id;
        assert.equal(created[0].title, '[Trực tiếp] Họp tổ TG TA');
        assert.deepEqual([...created[0].attendees].sort(), ['meet-ta', 'meet-ta2']);

        // Trước khi ai điểm danh: lưới phải là "Chưa điểm danh", không phải "Có".
        // Lưới được vẽ lại sau khi modal đóng nên phải chờ nó cập nhật xong.
        await admin.page.waitForFunction(
            () => document.querySelector('#meetings-tbody tr[data-user-id="meet-ta"] .hop-ta-select')?.value === 'Chưa điểm danh',
            { timeout: 30000 });
        const beforeCheckIn = await admin.page.evaluate(() => {
            const row = document.querySelector('#meetings-tbody tr[data-user-id="meet-ta"]');
            const select = row.querySelector('.hop-ta-select');
            return { value: select.value, disabled: select.disabled };
        });
        assert.equal(beforeCheckIn.value, 'Chưa điểm danh');
        assert.equal(beforeCheckIn.disabled, false, 'cột của tổ có họp phải mở cho admin sửa');

        // --- 2. Nhân viên tự điểm danh ở "Họp Của Tôi" --------------------
        const staff = await openSession(browser, origin, users[1]);
        sessions.push(staff);
        await staff.page.goto(origin + '/hop-cua-toi.html', { waitUntil: 'domcontentloaded' });
        await staff.page.waitForSelector('#today-grid .hero-card', { timeout: 30000 });

        const heroBefore = await staff.page.evaluate(() => document.querySelector('#today-grid .hero-card').innerText);
        assert.match(heroBefore, /Điểm danh ngay/, 'thẻ họp phải mời nhân viên điểm danh');
        assert.match(heroBefore, /báo vắng/, 'nhân viên phải báo vắng được ngay trong khung giờ');

        await staff.page.click('#today-grid .hero-checkin-btn');
        await staff.page.waitForFunction(
            () => /Đã điểm danh/.test(document.querySelector('#today-grid .hero-card')?.innerText || ''),
            { timeout: 30000 });
        const heroAfter = await staff.page.evaluate(() => document.querySelector('#today-grid .hero-card').innerText);
        assert.match(heroAfter, /Đã điểm danh: Có mặt/, 'điểm danh trong khung giờ phải là "Có mặt": ' + heroAfter);
        assert.equal(
            await staff.page.evaluate(() => document.getElementById('st-present').innerText), '1',
            'thống kê của nhân viên phải cộng ngay một buổi có mặt');

        // --- 3. Lưới điểm danh của admin thấy đúng kết quả ----------------
        await admin.page.reload({ waitUntil: 'domcontentloaded' });
        await admin.page.waitForFunction(
            () => document.querySelector('#meetings-tbody tr[data-user-id="meet-ta"] .hop-ta-select')?.value === 'Có',
            { timeout: 30000 });
        const otherBefore = await admin.page.evaluate(
            () => document.querySelector('#meetings-tbody tr[data-user-id="meet-ta2"] .hop-ta-select').value);
        assert.equal(otherBefore, 'Chưa điểm danh', 'người chưa điểm danh và họp chưa kết thúc phải là trung lập');

        // --- 4. Bảng lương đọc cùng một sự thật ---------------------------
        const payroll = await admin.page.evaluate(async month => {
            const policy = window.MeetingAttendancePolicy;
            const meetings = await DBService.getMeetingsForMonth(month);
            const attendanceByMeeting = {};
            for (const m of meetings) attendanceByMeeting[m.id] = await DBService.getMeetingAttendance(m.id);
            const status = policy.resolveDepartmentStatus({
                meetings, attendanceByMeeting, userId: 'meet-ta',
                department: 'TG TA', memberOfDepartment: true
            });
            return { status, money: policy.calculateMonthly([status]) };
        }, monthStr());
        assert.equal(payroll.status, 'Có');
        assert.equal(payroll.money.amount, 1000, 'có mặt phải cộng 1.000đ vào tiêu chí X');
        assert.equal(payroll.money.complete, true);

        // --- 5. Admin sửa tay trạng thái trên trang Thống Kê --------------
        await admin.page.evaluate(() => window.showMeetingsStats());
        await admin.page.waitForFunction(
            () => document.querySelectorAll('#stats-meeting-details-tbody tr').length >= 2, { timeout: 30000 });
        const overrideResult = await admin.page.evaluate(async () => {
            const meetingId = document.querySelector('.meeting-stats-card').dataset.meetingId;
            await DBService.updateMeetingAttendanceStatus(meetingId, 'meet-ta2', 'PHẠM QUANG TIẾN', 'Vắng phép');
            const log = await DBService.getMonthlyMeetings(meetingId.slice(0, 0) + new Date().toISOString().slice(0, 7));
            return log;
        });
        assert.ok(overrideResult, 'phải đọc được bảng điểm danh tháng');
        await admin.page.reload({ waitUntil: 'domcontentloaded' });
        await admin.page.waitForFunction(
            () => document.querySelector('#meetings-tbody tr[data-user-id="meet-ta2"] .hop-ta-select')?.value === 'Vắng phép',
            { timeout: 30000 });

        // --- 5b. Admin thấy xác nhận trước của nhân viên ------------------
        await staff.page.evaluate(async meetingId => {
            const userName = localStorage.getItem('userFullName') || 'TRẦN GIA BẢO';
            await DBService.selfRsvpMeeting(meetingId, 'meet-ta', userName, true, '');
        }, deptMeetingId);
        await admin.page.reload({ waitUntil: 'domcontentloaded' });
        await admin.page.waitForFunction(() => typeof window.showMeetingsStats === 'function', { timeout: 30000 });
        await admin.page.evaluate(() => window.showMeetingsStats());
        try {
            await admin.page.waitForFunction(
                () => document.querySelectorAll('#stats-meeting-details-tbody tr').length >= 2, { timeout: 30000 });
        } catch (err) {
            const dump = await admin.page.evaluate(() => ({
                tbody: document.getElementById('stats-meeting-details-tbody')?.innerHTML?.slice(0, 600),
                cards: document.querySelectorAll('.meeting-stats-card').length,
                statsVisible: document.getElementById('meetings-stats-view')?.style.display
            }));
            throw new Error('stats detail rỗng: ' + JSON.stringify(dump) + ' | errors=' + JSON.stringify(admin.errors));
        }
        const rsvpView = await admin.page.evaluate(() => ({
            headers: Array.from(document.querySelectorAll('#meetings-stats-view thead th')).map(th => th.innerText.trim()),
            rows: Array.from(document.querySelectorAll('#stats-meeting-details-tbody tr')).map(tr => tr.innerText)
        }));
        assert.ok(rsvpView.headers.includes('XÁC NHẬN TRƯỚC'),
            'trang Thống Kê phải có cột xác nhận trước: ' + JSON.stringify(rsvpView.headers));
        assert.ok(rsvpView.rows.some(text => /Sẽ dự/.test(text)),
            'admin phải thấy ai đã xác nhận sẽ dự: ' + JSON.stringify(rsvpView.rows));

        // --- 5c. Sửa lịch họp không được làm mất lượt đã điểm danh --------
        // Dời giờ mở điểm danh TRỄ HƠN lần điểm danh thật của nhân viên: nếu
        // không giữ lại, bản ghi đó thành không hợp lệ và người ta bị tính vắng.
        await createMeetingEdit(admin.page, origin, deptMeetingId, {
            title: 'Họp tổ TG TA (đã dời giờ)',
            checkInStart: hhmm(30),
            checkInClose: hhmm(75)
        });
        const afterEdit = await admin.page.evaluate(async (month, meetingId) => {
            const meetings = await DBService.getMeetingsForMonth(month);
            const meeting = meetings.find(m => m.id === meetingId);
            const logs = await DBService.getMeetingAttendance(meetingId);
            const mine = logs.find(l => l.userId === 'meet-ta');
            return {
                title: meeting.title,
                checkInStart: meeting.checkInStart,
                status: mine?.status,
                preservedByEdit: mine?.preservedByEdit === true,
                valid: window.MeetingAttendancePolicy.isValidAttendance(mine, meeting)
            };
        }, monthStr(), deptMeetingId);
        assert.equal(afterEdit.title, '[Trực tiếp] Họp tổ TG TA (đã dời giờ)', 'tiêu đề phải được cập nhật');
        assert.equal(afterEdit.checkInStart, hhmm(30), 'giờ mở điểm danh phải được dời');
        assert.equal(afterEdit.status, 'Có', 'trạng thái đã điểm danh không được mất');
        assert.equal(afterEdit.preservedByEdit, true, 'lượt điểm danh cũ phải được chốt lại khi dời giờ');
        assert.equal(afterEdit.valid, true, 'lượt điểm danh cũ phải vẫn hợp lệ sau khi sửa lịch');
        await admin.page.waitForFunction(
            () => document.querySelector('#meetings-tbody tr[data-user-id="meet-ta"] .hop-ta-select')?.value === 'Có',
            { timeout: 30000 });

        // Không cho đổi bộ phận hay nhảy sang tháng khác.
        const rejected = await admin.page.evaluate(async meetingId => {
            const out = {};
            try { await DBService.updateMeeting(meetingId, { department: 'TIẾP TÂN' }); out.dept = 'allowed'; }
            catch (e) { out.dept = e.message; }
            try { await DBService.updateMeeting(meetingId, { date: '2020-01-05' }); out.month = 'allowed'; }
            catch (e) { out.month = e.message; }
            return out;
        }, deptMeetingId);
        assert.match(rejected.dept, /Không thể đổi bộ phận/);
        assert.match(rejected.month, /cùng một tháng/);

        // --- 6. Buổi "Tự chọn thành viên" + điểm danh sẵn tất cả ----------
        const customMeeting = {
            title: 'Họp toàn trung tâm', type: 'online', department: 'CUSTOM',
            date: today(), startTime: hhmm(-30), endTime: hhmm(120),
            checkInStart: hhmm(-20), checkInClose: hhmm(60),
            requireNetwork: false, mode: 'auto',
            attendeeIds: ['meet-ta', 'meet-ta2']
        };
        await createMeeting(admin.page, origin, customMeeting, admin.dialogs);

        const preMarked = await admin.page.evaluate(async month => {
            const meetings = await DBService.getMeetingsForMonth(month);
            const custom = meetings.find(m => m.department === 'CUSTOM');
            const logs = await DBService.getMeetingAttendance(custom.id);
            const mine = logs.find(l => l.userId === 'meet-ta');
            return {
                id: custom.id,
                status: mine?.status,
                adminOverride: mine?.adminOverride === true,
                checkInTime: mine?.checkInTime,
                valid: window.MeetingAttendancePolicy.isValidAttendance(mine, custom)
            };
        }, monthStr());
        assert.equal(preMarked.status, 'Có');
        assert.equal(preMarked.adminOverride, true, 'điểm danh sẵn phải mang cờ adminOverride');
        assert.equal(preMarked.valid, true, 'điểm danh sẵn phải hợp lệ với luật dùng chung');

        // Thẻ của buổi tự chọn trên trang nhân viên phải hiện là đã ghi nhận,
        // không còn mời bấm điểm danh nữa.
        // Buổi họp tổ vừa bị dời giờ mở điểm danh sang tương lai nên nó rời khu
        // "cần điểm danh hôm nay"; chỉ còn buổi tự chọn ở đó.
        await staff.page.reload({ waitUntil: 'domcontentloaded' });
        await staff.page.waitForFunction(
            () => /Họp toàn trung tâm/.test(document.getElementById('today-grid')?.innerText || ''),
            { timeout: 30000 });
        const heroTexts = await staff.page.evaluate(
            () => Array.from(document.querySelectorAll('#today-grid .hero-card')).map(c => c.innerText));
        const customHero = heroTexts.find(t => /Họp toàn trung tâm/.test(t));
        assert.ok(customHero, 'nhân viên phải thấy buổi họp tự chọn');
        const upcomingText = await staff.page.evaluate(
            () => document.getElementById('upcoming-grid')?.innerText || '');
        assert.match(upcomingText, /Họp tổ TG TA \(đã dời giờ\)/,
            'buổi vừa dời giờ phải chuyển sang mục "Sắp tới" với tiêu đề mới: ' + upcomingText);
        assert.match(customHero, /Đã điểm danh|Đã ghi nhận/, 'buổi đã điểm danh sẵn không được mời bấm lại: ' + customHero);

        // Danh sách "Lịch Đã Tạo" phải đếm đúng số người đã điểm danh.
        await admin.page.reload({ waitUntil: 'domcontentloaded' });
        await admin.page.waitForFunction(() => typeof window.showMeetingsList === 'function', { timeout: 30000 });
        await admin.page.evaluate(() => window.showMeetingsList());
        await admin.page.waitForFunction(
            () => document.querySelectorAll('#meetings-list-grid .meeting-card').length >= 2, { timeout: 30000 });
        const cards = await admin.page.evaluate(
            () => Array.from(document.querySelectorAll('#meetings-list-grid .meeting-card')).map(c => c.innerText));
        const customCard = cards.find(t => /Họp toàn trung tâm/.test(t));
        assert.match(customCard, /2\/2 người/, 'điểm danh sẵn phải hiện đủ trên thẻ lịch: ' + customCard);

        // --- 7. Bằng chứng buổi tự chọn cho tổ không có buổi riêng --------
        const customEvidence = await admin.page.evaluate(async month => {
            const policy = window.MeetingAttendancePolicy;
            const meetings = await DBService.getMeetingsForMonth(month);
            const attendanceByMeeting = {};
            for (const m of meetings) attendanceByMeeting[m.id] = await DBService.getMeetingAttendance(m.id);
            const onlyCustom = meetings.filter(m => m.department === 'CUSTOM');
            return {
                member: policy.resolveDepartmentStatus({
                    meetings: onlyCustom, attendanceByMeeting, userId: 'meet-ta',
                    department: 'TIẾP TÂN', memberOfDepartment: true
                }),
                notMember: policy.resolveDepartmentStatus({
                    meetings: onlyCustom, attendanceByMeeting, userId: 'meet-ta',
                    department: 'TIẾP TÂN', memberOfDepartment: false
                })
            };
        }, monthStr());
        assert.equal(customEvidence.member, 'Có', 'đã điểm danh buổi tự chọn phải được ghi nhận cho tổ của mình');
        assert.equal(customEvidence.notMember, 'Không họp', 'người ngoài tổ không nhận bằng chứng này');

        // Buổi tự chọn KHÔNG được ghi vào bảng điểm danh tháng: một ô "Có" còn
        // lại ở đó sẽ che mất buổi họp tổ mà người này bỏ lỡ.
        const customLogTouch = await admin.page.evaluate(async month => {
            const log = await DBService.getMonthlyMeetings(month);
            return log?.records?.['meet-ta2']?.hop_tg_tieng_anh || null;
        }, monthStr());
        assert.equal(customLogTouch, 'Vắng phép',
            'ô của meet-ta2 phải vẫn là quyết định của admin, không bị buổi tự chọn ghi đè: ' + customLogTouch);

        // --- 8. Xóa cuộc họp dọn sạch bản ghi điểm danh -------------------
        const afterDelete = await admin.page.evaluate(async (month, meetingId) => {
            await DBService.deleteMeeting(meetingId);
            const meetings = await DBService.getMeetingsForMonth(month);
            const logs = await DBService.getMeetingAttendance(meetingId);
            return { count: meetings.length, logs: logs.length };
        }, monthStr(), preMarked.id);
        assert.equal(afterDelete.count, 1, 'xóa xong chỉ còn lại buổi họp tổ');
        assert.equal(afterDelete.logs, 0, 'xóa cuộc họp phải xóa cả bản ghi điểm danh');

        // --- 9. Xóa buổi họp tổ dọn luôn ô đã lưu trong bảng tháng --------
        // Nếu để lại, ô "Vắng phép" của một cuộc họp không còn tồn tại vẫn thắng
        // "Chưa điểm danh" và người ta bị trừ lương vì một buổi họp đã bị xóa.
        const afterDeptDelete = await admin.page.evaluate(async (month, meetingId) => {
            await DBService.deleteMeeting(meetingId);
            const log = await DBService.getMonthlyMeetings(month);
            const meetings = await DBService.getMeetingsForMonth(month);
            return {
                remaining: meetings.length,
                ta: log?.records?.['meet-ta']?.hop_tg_tieng_anh ?? null,
                ta2: log?.records?.['meet-ta2']?.hop_tg_tieng_anh ?? null
            };
        }, monthStr(), deptMeetingId);
        assert.equal(afterDeptDelete.remaining, 0, 'tháng không còn cuộc họp nào');
        assert.equal(afterDeptDelete.ta, null, 'ô mồ côi của meet-ta phải được dọn');
        assert.equal(afterDeptDelete.ta2, null, 'ô mồ côi của meet-ta2 phải được dọn');

        for (const session of sessions) {
            assert.deepEqual(session.errors, [], 'trang không được có lỗi JavaScript: ' + session.errors.join(' | '));
        }
        console.log('meeting-flow-ui.test.js: all assertions passed');
    } finally {
        for (const session of sessions) { try { await session.context.close(); } catch (_) {} }
        if (browser) await browser.close();
        if (server) await new Promise(resolve => server.close(resolve));
        await env.cleanup();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
