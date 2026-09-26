'use strict';
// Giao diện mobile 26/09/2026 + độ bền phiên đăng nhập:
// - Mạng chậm lúc mở app (Firebase cần > 15 giây để khôi phục phiên) KHÔNG được đăng xuất nhân viên.
// - Lỗi kết nối khi xác minh hồ sơ chỉ hiện "Thử lại"; lỗi xác thực thật vẫn đăng xuất như cũ.
// - Thẻ "Thông báo trên máy này" nhận đúng iPhone chưa cài app / Zalo / đã chặn / đang nhận.
// - Thanh tab dưới đáy chỉ gồm trang mà vai trò đó vốn được vào.
// - Emoji trong nhãn chip chỉ đổi thành icon lúc hiển thị.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const main = read('js/main.js');
const firebaseConfig = read('js/firebase-config.js');
const report = read('js/report.js');
const timekeeping = read('js/timekeeping.js');
const css = read('css/app-ui.css');
const between = (source, from, to) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + from.length);
    assert.ok(start >= 0 && end > start, `missing slice ${from}`);
    return source.slice(start, end);
};

(async () => {
    // ---------- 1. waitAuth: quá 15 giây không có nghĩa là đã đăng xuất ----------
    {
        let observer = null;
        let unsubscribed = 0;
        const timers = [];
        const events = [];
        const windowStub = {
            location: { hostname: 'localhost' },
            addEventListener() {},
            dispatchEvent: event => { events.push(event); return true; },
            UIService: { showLoading() {}, hideLoading() {}, toast() {} }
        };
        const context = {
            console: { log() {}, warn() {}, error() {} },
            setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
            clearTimeout: () => {},
            CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
            firebase: {
                initializeApp() {}, firestore: () => ({}),
                auth: () => ({ currentUser: null, onAuthStateChanged(fn) { observer = fn; return () => { unsubscribed++; }; } })
            },
            window: windowStub
        };
        vm.runInNewContext(firebaseConfig, context);
        const waiting = context.window.waitAuth();
        const timeout = timers.find(timer => timer.ms === 15000);
        assert.ok(timeout, 'waitAuth vẫn có mốc 15 giây');
        timeout.fn();
        assert.equal(await waiting, null, 'hết 15 giây trả null cho trang tự quyết định');
        assert.equal(context.window.__tdtAuthRestorePending, true, 'đánh dấu phiên còn đang khôi phục, không phải đã đăng xuất');
        assert.equal(unsubscribed, 0, 'vẫn nghe tiếp kết quả thật từ Firebase');
        const user = { uid: 'uid-slow' };
        observer(user);
        assert.equal(context.window.__tdtAuthRestorePending, false);
        assert.equal(unsubscribed, 1);
        assert.equal(events.length, 1);
        assert.equal(events[0].type, 'tdt:auth-restored');
        assert.equal(events[0].detail.user, user, 'báo phiên khôi phục muộn để trang tải lại thay vì đăng xuất');
    }

    // ---------- 2. Trang bên trong: chờ phiên muộn + lỗi mạng không đăng xuất ----------
    const boot = between(main, "document.addEventListener('DOMContentLoaded', async () => {", '// ================= GLOBAL AUTO-CHECKOUT FUNCTION');
    const pendingIndex = boot.indexOf('window.__tdtAuthRestorePending');
    const signOutIndex = boot.indexOf("console.warn(\"Auth session missing or mismatched. Redirecting to login.\");");
    assert.ok(pendingIndex > 0 && pendingIndex < signOutIndex, 'kiểm tra phiên đang khôi phục TRƯỚC nhánh đăng xuất');
    assert.match(boot, /tdt:auth-restored[\s\S]*?event\.detail\?\.user\) \{ window\.location\.reload\(\)/);
    assert.match(boot, /if \(isTransientSessionVerificationError\(error\)\) \{\s*showSessionRetryScreen\(\);\s*return;\s*\}\s*await signOutAndClearSession\(\);/,
        'lỗi kết nối chỉ hiện Thử lại; lỗi khác vẫn đăng xuất');

    const classify = new Function('navigator', `${between(main, 'function isTransientSessionVerificationError', 'function showSessionRetryScreen')}; return isTransientSessionVerificationError;`);
    const online = classify({ onLine: true });
    for (const code of ['unavailable', 'deadline-exceeded', 'resource-exhausted', 'auth/network-request-failed', 'auth/database-unavailable']) {
        assert.equal(online({ code }), true, `${code} là lỗi tạm thời`);
    }
    for (const code of ['auth/profile-mismatch', 'auth/profile-not-found', 'auth/duplicate-profile', 'auth/session-missing', 'permission-denied']) {
        assert.equal(online({ code, message: 'network' }), false, `${code} vẫn phải đăng xuất`);
    }
    assert.equal(online({ message: 'Failed to get document because the client is offline.' }), true);
    assert.equal(classify({ onLine: false })({ message: 'x' }), true, 'máy đang mất mạng');

    // Trang đăng nhập: tự vào lại khi phiên khôi phục muộn, nhưng không chen ngang lúc đang đăng nhập.
    const resume = between(main, 'async function resumeSavedSession', 'function setLoginButtonLoading');
    assert.match(resume, /tdt:auth-restored[\s\S]*?event\.detail\?\.user && !loginInFlight\) resumeSavedSession\(event\.detail\.user\)/);
    assert.doesNotMatch(resume, /signOutAndClearSession/);

    // Đăng xuất trên máy đang nhận thông báo phải hỏi lại (đăng xuất gỡ nhắc vào ca).
    const logout = between(main, 'async function handleLogout', 'window.handleLogout = handleLogout;');
    assert.ok(logout.indexOf('isPushActiveOnThisDevice()') < logout.indexOf('await unregisterPushNotifications()'));
    assert.match(logout, /if \(!confirmed\) return false;/);

    // ---------- 3. Trạng thái thông báo của máy đang dùng ----------
    const stateSource = between(main, 'function getDeviceNotificationState', 'window.getDeviceNotificationState');
    const makeState = ({ ua, standalone = false, permission = null, token = false }) => {
        const windowStub = {
            matchMedia: () => ({ matches: standalone }),
            ...(permission ? { Notification: { permission } } : {})
        };
        return new Function('navigator', 'window', 'Notification', 'isPushActiveOnThisDevice',
            `${stateSource}; return getDeviceNotificationState();`)(
            { userAgent: ua, platform: /iPhone/.test(ua) ? 'iPhone' : 'Linux', maxTouchPoints: 5, standalone, serviceWorker: {} },
            windowStub, windowStub.Notification, () => token);
    };
    const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
    const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36';
    assert.equal(makeState({ ua: IOS }), 'ios-install', 'iPhone mở bằng Safari phải được hướng dẫn thêm ra màn hình chính');
    assert.equal(makeState({ ua: IOS, standalone: true, permission: 'granted', token: true }), 'on');
    assert.equal(makeState({ ua: IOS + ' Zalo iOS/501', permission: 'default' }), 'inapp');
    assert.equal(makeState({ ua: ANDROID, permission: 'denied' }), 'blocked');
    assert.equal(makeState({ ua: ANDROID, permission: 'default' }), 'off');
    assert.equal(makeState({ ua: ANDROID, permission: 'granted', token: false }), 'partial');
    assert.equal(makeState({ ua: ANDROID, permission: 'granted', token: true }), 'on');

    // ---------- 4. Thanh tab dưới đáy chỉ gồm trang vai trò đó vốn có ----------
    const nav = new Function(`${between(main, 'function _primaryNavItems', 'window._primaryNavItems')}; return _primaryNavItems;`)();
    const menu = links => links.map(link => ({ link, name: link }));
    const links = items => items.map(item => item.link);
    assert.deepEqual(links(nav('teaching_assistant', ['teaching_assistant'],
        menu(['nhan-vien.html', 'cham-cong.html', 'lich-lam.html', 'cham-bu.html', 'bao-cao.html']))),
        ['nhan-vien.html', 'cham-cong.html', 'lich-lam.html', 'bao-cao.html']);
    assert.deepEqual(links(nav('receptionist', ['receptionist'],
        menu(['nhan-vien.html', 'cham-cong.html', 'lich-lam.html', 'lich-tiep-tan.html', 'bao-cao.html']))),
        ['nhan-vien.html', 'cham-cong.html', 'lich-tiep-tan.html', 'bao-cao.html'], 'tiếp tân: tab Lịch là lịch trực');
    assert.deepEqual(links(nav('office_staff', ['office_staff'],
        menu(['nhan-vien.html', 'cham-cong.html', 'lich-van-phong.html', 'bao-cao.html']))),
        ['nhan-vien.html', 'cham-cong.html', 'lich-van-phong.html', 'bao-cao.html']);
    assert.deepEqual(links(nav('admin', ['admin'],
        menu(['admin.html', 'nhan-su.html', 'lich-lam.html', 'bao-cao.html', 'he-thong.html']))),
        ['admin.html', 'lich-lam.html', 'bao-cao.html', 'nhan-su.html']);
    assert.deepEqual(links(nav('senior_assistant', ['senior_assistant'],
        menu(['admin.html', 'cham-cong.html', 'lich-lam.html', 'bao-cao.html']))),
        ['admin.html', 'cham-cong.html', 'lich-lam.html', 'bao-cao.html']);
    assert.deepEqual(links(nav('teaching_assistant', ['teaching_assistant'], menu(['nhan-vien.html', 'bao-cao.html']))),
        ['nhan-vien.html', 'bao-cao.html'], 'không bao giờ thêm trang mà menu của người đó không có');

    // Điện thoại xoay ngang dùng menu trượt, không có thanh tab (thiếu chiều cao).
    assert.match(css, /@media \(orientation: landscape\) and \(max-height: 540px\) and \(pointer: coarse\) \{\s*\.bottom-nav \{ display: none !important; \}/);
    assert.match(main, /const DRAWER_NAV_QUERY = '\(max-width: 768px\), \(orientation: landscape\) and \(max-height: 540px\) and \(pointer: coarse\)';/);

    // ---------- 5. Chỉ đổi ký hiệu lúc hiển thị ----------
    const decorate = new Function('window', `${between(report, 'function reportIcon', '// REPORT_COLOR_SANITIZER_START')}; return decorateReportChipGlyphs;`);
    const withIcons = decorate({ tdtIcon: name => `<svg data-i="${name}"></svg>` });
    assert.equal(withIcons('18:00–19:30 ★+10p ⏱+30'), '18:00–19:30 <svg data-i="star"></svg>+10p <svg data-i="timer"></svg>+30');
    assert.equal(decorate({})('A ⏱+30'), 'A ⏱+30', 'không có bộ icon thì giữ nguyên chữ');
    assert.match(timekeeping, /chipHtml = timekeepingEscapeHTML\(chip\.text\);/, 'nhãn chip vẫn được escape trước khi chèn icon');

    // Không còn emoji trên các trang/scripts giao diện chính.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{26FF}\u{2B50}\u{2B55}\u{231A}\u{231B}\u{23E9}-\u{23FA}\u{2705}\u{274C}\u{2753}-\u{2757}]️?/u;
    for (const file of ['nhan-vien.html', 'cham-cong.html', 'bao-cao.html', 'lich-lam.html', 'lich-tiep-tan.html', 'lich-van-phong.html', 'js/timekeeping.js']) {
        const visible = read(file).split('\n').filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line) && !/console\.(log|warn|error|info)/.test(line));
        const hit = visible.find(line => emoji.test(line));
        assert.equal(hit, undefined, `${file} còn emoji: ${hit && hit.trim().slice(0, 80)}`);
    }

    // ---------- 6. Đợt 2 (ảnh iPhone của chủ hệ thống) ----------
    const hop = read('hop-cua-toi.html');
    assert.match(hop, /<div class="month-navigator ui-monthbar">[\s\S]*?onclick="myMeetChangeMonth\(-1\)"[\s\S]*?id="mymeet-month"[\s\S]*?onclick="myMeetChangeMonth\(1\)"/,
        'Họp: thanh tháng một hàng, giữ nguyên id/onclick');
    assert.doesNotMatch(hop, /<header[^>]*>[\s\S]{0,1600}month-navigator/, 'thanh tháng không được nằm trong <header> (CSS cũ ép 1 cột → nút dựng đứng)');
    assert.match(css, /\.ui-monthbar \{[\s\S]*?grid-template-columns: var\(--ui-tap\) minmax\(0, 1fr\) var\(--ui-tap\)/);

    const bc = read('bao-cao.html');
    assert.match(bc, /<div id="personal-specific-header-controls" class="rp-actions"/);
    for (const id of ['btn-manual-bonus', 'btn-mark-fixed', 'btn-save-fixed', 'btn-select-bonus10-mode', 'btn-approve-selected-bonus10',
        'btn-approve-all-bonus10', 'btn-select-student-count-mode', 'admin-header-revenues', 'total-hours-display', 'page-title']) {
        assert.equal((bc.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `Bảng Công giữ đúng 1 phần tử #${id}`);
    }
    assert.match(css, /#personal-specific-header-controls\.rp-actions:not\(\[style\*="display: none"\]\)/,
        'khối nút dùng bộ chọn id (thắng CSS cũ) và tôn trọng trạng thái ẩn của report.js');

    const chambu = read('cham-bu.html');
    const chambuStyle = chambu.slice(chambu.indexOf('<style>'), chambu.indexOf('</style>'));
    assert.match(chambuStyle, /\.g2\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'form 2 cột luôn co giãn (iOS date/time không tràn)');
    assert.match(chambuStyle, /-webkit-appearance:none;appearance:none/);
    assert.match(chambuStyle, /::-webkit-date-and-time-value\{text-align:left/);
    const chambuScript = chambu.slice(chambu.indexOf('</style>'));
    const usedClasses = new Set([...chambuScript.matchAll(/class=\\?["']([^"'\\]+)/g)].flatMap(m => m[1].split(/\s+/)).filter(c => /^[a-z][\w-]*$/.test(c)));
    for (const cls of usedClasses) {
        if (['on', 'pick', 'off', 'sel', 'today', 'out', 'we', 'ui-icon'].includes(cls)) continue;
        assert.ok(chambuStyle.includes('.' + cls), `Chấm Bù: lớp .${cls} dùng trong trang phải còn được định kiểu`);
    }

    assert.match(read('css/login.css'), /#toggle-password svg\[hidden\]\s*\{\s*display:\s*none;/, 'Safari: chỉ hiện 1 icon mắt');
    assert.match(main, /inlineOpen\.toggleAttribute\('hidden', show\);\s*inlineOff\.toggleAttribute\('hidden', !show\);/);

    const lichLam = read('lich-lam.html');
    assert.match(lichLam, /<div id="admin-actions" style="display: none; gap:0\.5rem; flex-wrap:wrap;">/, 'Sao Chép/Lưu Lịch ẩn mặc định; schedule.js mở cho người xếp lịch');
    assert.match(read('js/schedule.js'), /if \(adminActions\) adminActions\.style\.display = 'flex';/);
    assert.match(css, /#admin-actions\[style\*="display: none"\] \{ display: none !important; \}/);

    assert.match(css, /\.shift-segment \{\s*display: grid !important;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, 'Quan Sát Ca: 3 nút ca một hàng');
    for (const page of ['lich-tiep-tan.html', 'lich-van-phong.html']) {
        assert.match(read(page), /<div class="week-picker ui-weekbar">[\s\S]*?onclick="navigateWeek\(-1\)"[\s\S]*?id="week-label"[\s\S]*?onclick="navigateWeek\(1\)"/, `${page}: thanh tuần một hàng`);
    }
    assert.match(main, /bell\.classList\.add\('notif-bell--sidebar'\)/, 'máy tính: chuông không nổi đè lên nội dung trang');

    console.log('mobile-ui-session.test.js: all assertions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
