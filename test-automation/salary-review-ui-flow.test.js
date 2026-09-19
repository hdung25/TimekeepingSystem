'use strict';
// Actual Chrome UI + Auth/Firestore emulators. Blocks every production Firebase request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const Policy = require('../js/salary-review-policy.js');
const Application = require('../js/salary-review-application.js');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'scratch');
fs.mkdirSync(output, { recursive: true });
const today = Policy.dateKey(), month = today.slice(0, 7);
const previous = Application.shiftMonth(month, -1), future = Application.shiftMonth(month, 1);
const baseline = Application.shiftMonth(month, -4) + '-01';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST, firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const staff = 'review-teacher', admin = 'review-admin', password = 'ReviewFixtureOnly-20260919';
const evidence = { environment: 'demo-timekeeping local emulators only', month, future, results: [], errors: [] };
const sourcePaths = ['users/' + staff, 'salary_settings/' + staff,
    'salary_settings_monthly/' + month + '_' + staff, 'salary_settings_monthly/' + previous + '_' + staff,
    'attendance_logs/' + previous + '-03_' + staff];
let env, browser, server, origin, page;
async function readRecord(key) {
    let value;
    await env.withSecurityRulesDisabled(async c => { const doc = await c.firestore().doc(key).get(); value = doc.exists ? doc.data() : null; });
    return value;
}
async function snapshotSources() { return Object.fromEntries(await Promise.all(sourcePaths.map(async key => [key, await readRecord(key)]))); }
async function changedProfile(minRevision) {
    for (let i = 0; i < 100; i++) {
        const p = await readRecord('salary_review_profiles/' + staff);
        if (p?.revision >= minRevision) return p;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('Profile save not committed: ' + await page.$eval('#sr-message', e => e.textContent));
}
async function click(selector) {
    await page.waitForSelector(selector, { visible: true, timeout: 15000 });
    await page.$eval(selector, e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction(s => { const el = document.querySelector(s); return el && !el.disabled; }, { timeout: 15000 }, selector);
    await page.focus(selector);
    await page.keyboard.press(await page.$eval(selector, e => e.type === 'checkbox' ? 'Space' : 'Enter'));
}
async function fill(selector, value) {
    await page.waitForSelector(selector, { visible: true });
    await page.$eval(selector, (e, v) => {
        e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
    }, String(value));
}
async function readyProfile() {
    await page.waitForFunction(() => document.querySelector('#sr-message.error') ||
        (!!document.querySelector('#sr-profile-form') && !window.__payrollWritePending && !document.querySelector('#sr-detail .sr-skeleton')), { timeout: 30000 });
    const error = await page.$eval('#sr-message', e => e.classList.contains('error') ? e.textContent : '');
    assert.equal(error, '', 'review workspace must load without requiring a second click after auth restore');
}
async function shot(label) {
    const file = path.join(output, 'salary-review-ui-' + label + '.png');
    await page.screenshot({ path: file, fullPage: false }); evidence.results.push({ screenshot: file });
}

async function main() {
    for (const host of [authHost, firestoreHost]) assert.match(host || '', /^127\.0\.0\.1:\d+$/);
    env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    await env.clearFirestore();
    await fetch(`http://${authHost}/emulator/v1/projects/demo-timekeeping/accounts`, { method: 'DELETE' });
    const signup = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fixture`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'reviewadmin@tuduytre.com', password, returnSecureToken: true })
    });
    assert.equal(signup.ok, true);
    const uid = (await signup.json()).localId;
    const rates = { 'Toán 1': 32000, 'Toán 2': 34000, 'Toán 5': 32000, 'E5': 56000,
        'Toán 1 + E5': 73000, 'E5 (+2 HS)': 80000 };
    const subjects = [{ id: 'review-math', name: 'Toán', isGroup: true },
        { id: 'review-english', name: 'Tiếng Anh trường', isGroup: true },
        ...[['m1', 'Toán 1'], ['m2', 'Toán 2'], ['m5', 'Toán 5']].map(([id, name]) => ({ id, name, parentId: 'review-math' })),
        { id: 'e5', name: 'E5', parentId: 'review-english' }];
    const group = { id: 'review-math:level1', name: 'Toán tiểu học', subjectIds: ['m1', 'm5'], currentRate: 32000,
        baselineDate: baseline, baselineKind: 'initial', confirmed: true, enabled: true, cycleMonths: null, minimumHours: null,
        extraMonths: null, nextReviewDate: '', hoursOverride: null, hoursMonth: '', hoursNote: '', note: 'Đã đối chiếu từ bảng công',
        performance: 'unknown', attendance: 'unknown' };
    const targetInitial = { tiep_tan: { advance: 51000, evaluation: [{ id: 1, amount: 99000, note: 'Giữ phí tư vấn' }],
        class_rates: { 'Tiếp Tân (Ca Bình Thường)': 52000 } }, marker: 'preserve-target',
        published: { role: 'tiep-tan', status: 'received', status_tt: 'received', publishedAt_tt: 'fixture-tt',
            details_tt: { netPay: 123456, totalMinutes: 120 }, receivedAt: 'fixture-received' } };
    await env.withSecurityRulesDisabled(async c => {
        const db = c.firestore(), batch = db.batch();
        const add = (key, value) => batch.set(db.doc(key), value);
        add('users/' + admin, { id: admin, username: 'reviewadmin', name: 'Admin kiểm thử', role: 'admin', roles: ['admin'] });
        add('user_roles/' + uid, { userId: admin, username: 'reviewadmin', role: 'admin', roles: ['admin'] });
        add('users/' + staff, { id: staff, username: 'reviewteacher', name: 'Giáo viên Đối Chiếu', role: 'teaching_assistant',
            roles: ['teaching_assistant', 'receptionist'], salary_config: { class_rates: { 'Toán 1': 30000, 'E5': 50000 },
                roles: subjects.filter(s => !s.isGroup).map(s => ({ id: s.id, name: s.name, rate: rates[s.name] })) } });
        add('staff_directory/' + staff, { id: staff, username: 'reviewteacher', name: 'Giáo viên Đối Chiếu', role: 'teaching_assistant', roles: ['teaching_assistant', 'receptionist'] });
        add('staff_directory/' + admin, { id: admin, username: 'reviewadmin', name: 'Admin kiểm thử', role: 'admin', roles: ['admin'] });
        add('settings/system', { centerClosures: {} });
        ['cs1', 'cs2', 'cs3'].forEach(branch => add('settings/schedule_manifest_' + branch, {}));
        subjects.forEach(({ id, ...s }) => add('subjects/' + id, s));
        add('salary_review_settings/default', { schemaVersion: 1, revision: 1, cycleMonths: 3, minimumHours: 43, extraMonths: 1 });
        add('salary_review_profiles/' + staff, { schemaVersion: 1, revision: 1, staffId: staff, staffName: 'Giáo viên Đối Chiếu',
            personOverrides: { cycleMonths: null, minimumHours: null, extraMonths: null }, groups: [group,
                { ...group, id: 'review-english', name: 'Tiếng Anh trường', subjectIds: ['e5'], currentRate: 56000 }] });
        add('salary_settings/' + staff, { advance: 17000, evaluation: [{ id: 2, amount: 40000, note: 'Giữ phụ cấp mặc định' }], class_rates: {} });
        add('salary_settings_monthly/' + month + '_' + staff, { giao_vien: { advance: 19000,
            evaluation: [{ id: 1, amount: 12000, note: 'Giữ thưởng hiện tại' }], class_rates: rates },
            'giao-vien': { class_rates: { 'Toán 1': 99999 }, legacyMarker: 'preserve-alias' } });
        add('salary_settings_monthly/' + previous + '_' + staff, { 'giao-vien': { class_rates: { ...rates, 'Toán 1': 30000 }, advance: 8000 },
            published: { role: 'giao-vien', status: 'received', status_gv: 'received', publishedAt_gv: 'fixture-published',
                details_gv: { totalBaseMins: 2592, totalTinHocMins: 0, totalPreschoolMins: 0, totalAffiliateMins: 0, totalTutoringMins: 0,
                    netPay: 999999, breakdown: [{ name: 'Toán 1', rate: 30000, hours: 2, amount: 60000 }], stats: { workedShifts: 8, lateCount: 1 } } } });
        add('salary_settings_monthly/' + future + '_' + staff, targetInitial);
        add('attendance_logs/' + previous + '-03_' + staff, { userId: staff, date: previous + '-03', name: 'Giáo viên Đối Chiếu',
            sessions: [{ id: 'preserve-session', checkIn: previous + '-03T08:00:00+07:00', start: previous + '-03T08:00:00+07:00',
                checkOut: previous + '-03T10:00:00+07:00', role: 'm1', roleRate: 30000, linkedClassStart: '08:00', bonus10: true,
                isAdminEdited: true, adminPayrollOverride: { reason: 'fixture note', rate: 30000 } }] });
        for (const target of [previous, month, future]) add('schedules/cs1__' + target + '-03', {
            morning1: [{ shiftId: 'fixture-' + target, start: '08:00', end: '10:00', lop: 'Toán 1', lopId: 'm1', gvId: staff, gv: 'Giáo viên Đối Chiếu' }]
        });
        await batch.commit();
    });
    const original = await snapshotSources();
    server = http.createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(root + path.sep) || !/\.(html|js|css|png|jpg|jpeg|svg|ico|json|woff2?|ttf)$/i.test(file) || /node_modules|\/\./.test(pathname)) { res.writeHead(403); res.end(); return; }
        try {
            let body = fs.readFileSync(file);
            if (pathname === '/js/firebase-config.js') body = body.toString().replace(/projectId: "[^"]+"/, 'projectId: "demo-timekeeping"')
                .replace('window.auth = firebase.auth();', `window.auth = firebase.auth();\nwindow.auth.useEmulator('http://${authHost}', {disableWarnings:true});\nwindow.db.useEmulator('127.0.0.1', ${firestoreHost.split(':')[1]});`);
            if (pathname === '/service-worker.js') body = 'self.addEventListener("install",()=>self.skipWaiting());';
            res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
        } catch (_) { res.writeHead(404); res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.emulateTimezone('Asia/Ho_Chi_Minh');
    page.on('pageerror', error => evidence.errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = new URL(request.url()), sdk = /^\/firebasejs\/12\.18\.0\/(firebase-[a-z-]+-compat\.js)$/.exec(url.pathname);
        if (url.hostname === 'www.gstatic.com' && sdk) return void request.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'node_modules/firebase', sdk[1])) });
        if (url.hostname === 'cdn.jsdelivr.net' && url.pathname === '/npm/chart.js@4.4.1/dist/chart.umd.min.js') return void request.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js')) });
        if (/googleapis\.com$/.test(url.hostname)) return void request.abort();
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) return void request.respond({ status: 200, contentType: request.resourceType() === 'stylesheet' ? 'text/css' : 'text/javascript', body: '' });
        request.continue();
    });
    await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.type('#username', 'reviewadmin'); await page.type('#password', password);
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#login-form button[type="submit"]')]);
    await page.waitForSelector('#salary-review-reminder:not([hidden])', { timeout: 30000 });
    assert.match(await page.$eval('#salary-review-reminder', e => e.innerText), /1 nhân viên cần xét/);
    await page.goto(origin + '/xet-tang-luong.html?staffId=' + staff, { waitUntil: 'domcontentloaded' });
    await readyProfile();
    assert.match(await page.$eval('#sr-detail', e => e.innerText), /Folder có giá khác nhau/);
    assert.equal(await page.$eval('input[name="subjectIds"][value="m2"]', e => e.checked), false);
    assert.equal(await page.$eval('#sr-currentRate', e => e.value), '32000');
    await shot('desktop-initial');
    assert.deepEqual(await snapshotSources(), original, 'loading a review must never change source salary or attendance');
    await fill('#sr-note', 'Admin đã đối chiếu giá 32.000 và ngoại lệ Toán 2.');
    await page.select('#sr-performance', 'pass'); await page.select('#sr-attendance', 'pass');
    await click('#sr-profile-form button[type="submit"]');
    let profile = await changedProfile(2); await readyProfile();
    assert.match(profile.groups[0].note, /ngoại lệ/);
    assert.equal(profile.groups[0].baselineDate, baseline);
    assert.deepEqual(await snapshotSources(), original);
    evidence.results.push('Actual UI save: rates, published history and attendance unchanged');

    await click('[data-action="deferred"]');
    const deferred = Policy.addMonths(today, 1);
    await fill('#sr-decision-date', deferred); await fill('#sr-decision-reason', 'Cần thêm kỳ đánh giá theo cá nhân.');
    await click('#sr-decision-form button[type="submit"]');
    profile = await changedProfile(3); await readyProfile();
    assert.equal(profile.groups[0].nextReviewDate, deferred);
    assert.equal(profile.groups[0].baselineDate, baseline, 'deferral must not reset the last increase baseline');
    assert.deepEqual(await snapshotSources(), original);

    await click('[data-action="approve"]');
    await fill('#sr-new-rate', 36000); await fill('#sr-target-month', future);
    await fill('#sr-approval-reason', 'Đạt đánh giá cá nhân; chỉ áp dụng Toán 1 và Toán 5.');
    await click('#sr-approval-form button[type="submit"]');
    await page.waitForSelector('#sr-apply', { visible: true, timeout: 30000 });
    const previewText = await page.$eval('#sr-dialog-content', e => e.innerText);
    assert.match(previewText, /Toán 1/); assert.match(previewText, /Toán 5/); assert.match(previewText, /36[.,]000/);
    assert.deepEqual(await readRecord('salary_settings_monthly/' + future + '_' + staff), targetInitial, 'preview is read-only');
    // Changing isMobile mid-page forces a Puppeteer reload and destroys the
    // pending preview. Resize only; this checks the actual responsive layout.
    await page.setViewport({ width: 390, height: 844 });
    await shot('mobile-preview');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'mobile page must not overflow horizontally');
    await click('#sr-apply');
    profile = await changedProfile(4); await readyProfile();
    const targetApplied = await readRecord('salary_settings_monthly/' + future + '_' + staff);
    assert.deepEqual(targetApplied.giao_vien.class_rates, { ...rates, 'Toán 1': 36000, 'Toán 5': 36000 });
    assert.deepEqual(targetApplied.tiep_tan, targetInitial.tiep_tan);
    assert.deepEqual(targetApplied.published, targetInitial.published);
    assert.equal(targetApplied.marker, targetInitial.marker);
    assert.equal(profile.groups[0].scheduledChange.effectiveFrom, future + '-01');
    assert.equal(profile.groups[1].currentRate, 56000);
    assert.deepEqual(await snapshotSources(), original);
    await shot('mobile-applied');
    evidence.results.push('Actual preview/apply preserves full inherited price map, exception, other folder, combined/crowded prices, TT snapshot and all historic sources');

    // The existing report is another consumer of the target monthly map. Reload
    // through its real UI, never save/pay/publish during this verification.
    await page.setViewport({ width: 1440, height: 1000 });
    for (const [reportMonth, expectedRate] of [[future, 36000], [month, 32000], [previous, 30000]]) {
        await page.goto(`${origin}/bao-cao.html?staffId=${staff}&date=${reportMonth}-03&roleView=giao-vien`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__TDT_REPORT_BOOTSTRAP_READY__ && window.payrollReadyScope && window.payrollReadyScope === window.currentReportScope, { timeout: 60000 });
        const loaded = await page.evaluate(() => window.currentMonthlySalarySettingsAll);
        assert.equal((loaded.giao_vien || loaded['giao-vien']).class_rates['Toán 1'], expectedRate);
    }
    assert.deepEqual(await snapshotSources(), original, 'opening existing report months is read-only');
    assert.deepEqual(await readRecord('salary_settings_monthly/' + future + '_' + staff), targetApplied);
    evidence.results.push('Existing report reload sees future 36,000, current 32,000 and legacy historical 30,000, without saving');

    await page.goto(origin + '/xet-tang-luong.html?staffId=' + staff, { waitUntil: 'domcontentloaded' }); await readyProfile();
    await click('[data-action="cancel"]'); await fill('#sr-decision-reason', 'Hoãn áp dụng; giữ nguyên mức cũ trước hiệu lực.');
    await click('#sr-decision-form button[type="submit"]');
    profile = await changedProfile(5); await readyProfile();
    assert.equal(profile.groups[0].scheduledChange, undefined);
    assert.equal(profile.groups[0].currentRate, 32000);
    assert.equal(profile.groups[0].baselineDate, baseline);
    assert.equal(profile.groups[0].nextReviewDate, deferred);
    assert.deepEqual(await readRecord('salary_settings_monthly/' + future + '_' + staff), targetInitial, 'cancel restores target exactly, including TT');
    assert.deepEqual(await snapshotSources(), original);
    await env.withSecurityRulesDisabled(async c => {
        const records = (await c.firestore().collection('salary_review_profiles').doc(staff).collection('history').get()).docs.map(d => d.data());
        assert.deepEqual(records.map(r => r.kind).sort(), ['approved', 'cancelled', 'deferred', 'profile'].sort());
        assert.ok(records.every(record => record.recordedAt?.toMillis() > 0));
        assert.ok(records.every(record => record.actorUserId === admin));
    });
    assert.match(await page.$eval('.sr-history', el => el.innerText), /Admin kiểm thử/);
    await page.setViewport({ width: 390, height: 844 });
    await page.$eval('#sr-detail', e => e.scrollIntoView({ block: 'start' })); await shot('mobile-restored');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    assert.deepEqual(evidence.errors, [], 'no uncaught browser JavaScript errors');
    evidence.results.push('Actual UI cancel restores original target and personal baseline; complete immutable audit trail');
    console.log('PASS salary-review UI save/defer/preview/apply/report-reload/cancel/mobile + source preservation');
}
main().catch(async error => {
    evidence.fatal = error.stack; console.error(error); process.exitCode = 1;
    if (page) {
        evidence.pageText = await page.evaluate(() => document.body.innerText.slice(-12000)).catch(() => '');
        evidence.url = page.url(); await page.screenshot({ path: path.join(output, 'salary-review-ui-fatal.png'), fullPage: false }).catch(() => {});
    }
}).finally(async () => {
    fs.writeFileSync(path.join(output, 'salary-review-ui-audit.json'), JSON.stringify(evidence, null, 2));
    if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); if (env) await env.cleanup();
});
