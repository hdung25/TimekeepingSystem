'use strict';
// 09/11/2026 (thu ngân ngày 21): ca CHIỀU+TỐI 14:00–21:30 gộp, phiên chính 14:00–18:00, admin tạo công tay
// 18:00–21:30. Trước đây vẫn hiện thêm chip "18:00–21:30 (Vắng)". Nay: tháng CHƯA tính lương thì ẩn chip
// Vắng đã được phiên khác phủ; tháng đã tính (cờ tắt) giữ nguyên như cũ để số vắng trên phiếu chốt không đổi.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };
const date = '2026-10-21', staff = 'thu-ngan';
const ctx = { console: quiet, Date, Math, Set, Map, Intl, window: { centerClosures: {}, getIconHtml: () => '' },
    getLocalDateKey: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    isScheduledMainTeacher: () => false, isScheduledSubstitute: () => false, hasScheduledSubstitute: () => false };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/evaluation-service.js'), 'utf8'), ctx);
const shifts = [
    { shift: 'afternoon', label: 'CHIỀU', start: '14:00', end: '18:00', branch: 'cs1', documentKey: 'cs1__2026-10-19', dayKey: 'wed' },
    { shift: 'evening', label: 'TỐI', start: '18:00', end: '21:30', branch: 'cs1', documentKey: 'cs1__2026-10-19', dayKey: 'wed' }
];
const user = { id: staff, roles: ['receptionist'], salary_config: {} };
const main = { id: 'main', checkIn: `${date}T14:00:00`, checkOut: `${date}T18:00:00` };
const manual = { id: 'manual', checkIn: `${date}T18:00:00`, checkOut: `${date}T21:30:00`, isManual: true };
const run = (sessions, flags) => ctx.window.calculateDailyChips({}, sessions, staff, date, user, shifts, {}, [], {}, [], flags);
const paid = chips => chips.reduce((sum, chip) => sum + (Number(chip.paidMinutes) || 0), 0);
const absentText = chips => chips.filter(c => c.isSplitAbsent).map(c => c.text);

const locked = run([main, manual], {});
const open = run([main, manual], { hideCoveredSplitAbsent: true });
assert.equal(absentText(locked).length, 1, 'month already calculated: legacy chip kept (absence counts unchanged)');
assert.equal(absentText(open).length, 0, 'month not calculated: covered absent subshift hidden');
assert.equal(paid(open), paid(locked), 'hiding the chip never changes paid minutes');
assert.equal(open.filter(c => c.class === 'chip-gray').length, locked.filter(c => c.class === 'chip-gray').length - 1);

// Không có phiên khác phủ → vẫn là Vắng thật.
assert.equal(absentText(run([main], { hideCoveredSplitAbsent: true })).length, 1);
// Phiên khác chỉ chạm 20 phút (< nửa ca con) → không coi là đã phủ.
const brief = { id: 'brief', checkIn: `${date}T18:00:00`, checkOut: `${date}T18:20:00` };
assert.equal(absentText(run([main, brief], { hideCoveredSplitAbsent: true })).length, 1);
// Admin đã tick ca con vắng bằng tay → luôn giữ chip Vắng.
const ticked = { ...main, absentSubShifts: ['18:00'] };
assert.equal(absentText(run([ticked, manual], { hideCoveredSplitAbsent: true })).length, 1);

// Trang báo cáo: cờ chỉ bật khi tháng chưa có phiếu lương nào.
const report = fs.readFileSync(path.join(root, 'js/report.js'), 'utf8');
const a = report.indexOf('// PAYROLL HOUR ALLOCATION HELPERS START'), b = report.indexOf('// PAYROLL HOUR ALLOCATION HELPERS END');
const r = { window: {} }; vm.createContext(r); vm.runInContext(report.slice(a, b), r);
assert.equal(r.hasAnySavedPayslipDetails(undefined), false);
assert.equal(r.hasAnySavedPayslipDetails({ status: 'draft' }), false);
assert.equal(r.hasAnySavedPayslipDetails({ details_tt: { netPay: 1 } }), true);
assert.equal(r.hasAnySavedPayslipDetails({ details: { netPay: 1 } }), true);
assert.match(report, /hideCoveredSplitAbsent: !hasAnySavedPayslipDetails\(currentMonthlySalarySettingsAll\?\.published\)/);
console.log('covered-split-absent.test.cjs: all assertions passed');
