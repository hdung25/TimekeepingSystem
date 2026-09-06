const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const version = '20260906-early10-recovery-v1';
const nhanVien = read('nhan-vien.html');
const chamCong = read('cham-cong.html');
const baoCao = read('bao-cao.html');
const main = read('js/main.js');
const report = read('js/report.js');
const timekeeping = read('js/timekeeping.js');
const recovery = read('js/startup-recovery.js');
const worker = read('service-worker.js');

for (const [name, source] of [
    ['nhan-vien.html', nhanVien],
    ['cham-cong.html', chamCong],
    ['bao-cao.html', baoCao]
]) {
    assert.match(source, new RegExp(`startup-recovery\\.js\\?v=${version}`),
        `${name} must load the independent staff-page startup watchdog`);
}

assert.match(nhanVien, /<script\s+async\s+src=['"]https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.4\.1\/dist\/chart\.umd\.min\.js['"]><\/script>/,
    'Chart.js must not block the personal dashboard bootstrap');
assert.match(nhanVien, /<script\s+async\s+src=["']https:\/\/unpkg\.com\/lucide@latest["']><\/script>/,
    'Lucide must not block the personal dashboard bootstrap');
assert.match(chamCong, /<script\s+async\s+src=["']https:\/\/unpkg\.com\/lucide@latest["']><\/script>/,
    'Lucide must not block the attendance bootstrap');
assert.match(baoCao, /<script\s+async\s+src="https:\/\/unpkg\.com\/lucide@latest"><\/script>/,
    'Lucide must not block the report bootstrap');
assert.match(baoCao, /<script\s+async\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/flatpickr"><\/script>/,
    'Flatpickr must not block the report bootstrap');
assert.match(baoCao, /<script\s+async\s+src="https:\/\/npmcdn\.com\/flatpickr\/dist\/l10n\/vn\.js"><\/script>/,
    'The Flatpickr locale must not block the report bootstrap');
assert.match(baoCao, /flatpickr\.min\.css" media="print" onload="this\.media='all'"/,
    'The optional Flatpickr stylesheet must not block report scripts');
assert.doesNotMatch(baoCao, /forceSWUpdate|tdt-sw-cleared-version/,
    'The report page must not unregister the PWA or delete caches during startup');

assert.match(main, /window\.__TDT_CORE_BOOTSTRAP_STARTED__\s*=\s*true/);
assert.match(main, /window\.__TDT_CORE_BOOTSTRAP_READY__\s*=\s*true/);
assert.match(main, /window\.dispatchEvent\(new Event\('tdt:app-core-ready'\)\)/);
assert.match(main, /function getStaffDataLoadErrorMessage/);
assert.match(main, /getStaffDataLoadErrorMessage\(e, 'bảng lương'\)/,
    'The personal salary card must use a staff-safe message instead of a raw Firebase error');
assert.doesNotMatch(main, /Lỗi khi tải bảng lương:\s*\$\{e\.message \|\| e\}/,
    'Raw Firestore errors must never be rendered in the personal salary card');

assert.match(report, /window\.__TDT_REPORT_BOOTSTRAP_STARTED__\s*=\s*true/);
assert.match(report, /window\.__TDT_REPORT_BOOTSTRAP_READY__\s*=\s*true/);
assert.match(report, /window\.dispatchEvent\(new Event\('tdt:report-ready'\)\)/);
assert.match(report, /const authUser = typeof window\.waitAuth === 'function'[\s\S]*?if \(!authUser\) return;/,
    'The report must share the shell auth restore promise and fail closed before reads');
assert.doesNotMatch(report, /setTimeout\(resolve, 3000\)/,
    'The report must not race mobile token restoration with an independent 3-second timeout');
assert.match(report, /async function renderMonthReport\([\s\S]*?return await _renderMonthReport/,
    'The report renderer needs a safe error boundary');
assert.match(report, /async function _renderMonthReport\(/);
assert.match(report, /Chưa thể tải bảng công\. Vui lòng kiểm tra kết nối rồi thử lại\./);
assert.match(report, /flatpickr\.l10ns && flatpickr\.l10ns\.vn/,
    'The admin date editor must tolerate a late or unavailable locale script');

assert.match(timekeeping, /window\.__TDT_TIMEKEEPING_BOOTSTRAP_STARTED__\s*=\s*true/);
assert.match(timekeeping, /window\.__TDT_TIMEKEEPING_BOOTSTRAP_READY__\s*=\s*true/);
assert.match(timekeeping, /window\.dispatchEvent\(new Event\('tdt:timekeeping-ready'\)\)/);
assert.match(timekeeping, /const authUser = typeof window\.waitAuth === 'function'[\s\S]*?if \(!authUser\) return;/,
    'The attendance page must not begin Firestore work before auth restoration');
assert.match(timekeeping, /getStaffAttendanceErrorMessage\(e\)/,
    'Attendance load failures must use the existing staff-safe message policy');
assert.doesNotMatch(timekeeping, /<p style="color:red">Lỗi tải trạng thái<\/p>/,
    'Attendance load failures must offer a recovery action, not a dead-end error');

assert.match(worker, /tdt-chamcong-v155-quynh-autosubject-20260906/);
assert.match(worker, /startup-recovery\.js\?v=20260906-early10-recovery-v1/,
    'The watchdog must be part of the atomic PWA install manifest');
assert.doesNotMatch(recovery, /DBService|firestore|attendance_logs|salary_settings|localStorage|sessionStorage|fetch\(/,
    'The startup watchdog must remain read-only and independent of business data');
assert.match(recovery, /__TDT_CORE_BOOTSTRAP_READY__/,
    'The watchdog must wait for a completed core bootstrap, not merely a parsed bundle');
assert.match(recovery, /window\.setTimeout\(showRecoveryMessage, 18000\)/);

console.log('staff-bootstrap-resilience.test.js: all assertions passed');
