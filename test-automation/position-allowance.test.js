'use strict';
// Regression: bảng lương giáo viên cộng "Trợ cấp chức vụ" 2 lần.
// Lỗi cũ: payload chép tiêu chí IV (NHIỆT TÌNH) vào troCapChucVu, còn IV đã nằm trong totalBonus →
// nhân viên thấy 6.350.333đ trong khi Admin/bản lưu là 6.050.333đ (Mỹ Sang, tháng 8/2026).
// Nay trợ cấp chức vụ giáo viên là ô riêng của Admin (position_allowance), cộng đúng 1 lần.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const main = read('js/main.js');
const start = main.indexOf('const PAYSLIP_CARD_CSS');
const end = main.indexOf('async function loadStaffPersonalSalary');
assert.ok(start >= 0 && end > start, 'payslip renderer must be extractable');

const context = { window: { getIconHtml: () => '' }, formatNumberWithCommas: n => Number(n).toLocaleString('en-US') };
vm.createContext(context);
vm.runInContext(main.slice(start, end), context);
const text = details => context.renderDetailedSalaryTable(details, 'received')
    .replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const criteria = [209000, 0, 0, 300000, 0, 0, 0, 103500, 313500, 1000]
    .map((amount, id) => ({ id, amount, note: id === 3 ? 'trợ cấp chức vụ' : '' }));

{
    // Bản đã lưu thật (chưa có ô riêng): IV = 300.000 đã nằm trong totalBonus.
    const legacy = text({
        role: 'giao-vien', totalBaseMins: 6270, totalBaseSalary: 5123333, totalBonus: 927000,
        troCapChucVu: 300000, troCapNote: 'trợ cấp chức vụ', advance: 0, attendanceAdjustments: 0,
        netPay: 6050333, evalItems: criteria
    });
    assert.match(legacy, /TỔNG LƯƠNG \(1\) 6,050,333 ₫/);
    assert.match(legacy, /THỰC LÃNH \(1\)-\(2\) 6,050,333 ₫/);
    assert.doesNotMatch(legacy, /6,350,333/, 'legacy snapshot must not add criterion IV twice');
    assert.match(legacy, /TRỢ CẤP CHỨC VỤ: —/);
    assert.match(legacy, /\(IV\) NHIỆT TÌNH trợ cấp chức vụ 300,000 ₫/);
}

{
    // Bản mới: trợ cấp nhập ở ô riêng, IV không còn chứa khoản này.
    const separate = text({
        role: 'giao-vien', totalBaseMins: 6270, totalBaseSalary: 5123333, totalBonus: 627000,
        troCapChucVu: 300000, troCapNote: 'Tổ trưởng', positionAllowanceSeparate: true,
        advance: 100000, attendanceAdjustments: 0, netPay: 5950333,
        evalItems: criteria.map(item => item.id === 3 ? { id: 3, amount: 0, note: '' } : item)
    });
    assert.match(separate, /TRỢ CẤP CHỨC VỤ: \(Tổ trưởng\) 300,000 ₫/);
    assert.match(separate, /TỔNG LƯƠNG \(1\) 6,050,333 ₫/);
    assert.match(separate, /THỰC LÃNH \(1\)-\(2\) 5,950,333 ₫/);
}

{
    // Tiếp Tân không đổi: trợ cấp là tiêu chí V (id 3) và chỉ được cộng một lần.
    const receptionist = text({
        role: 'tiep-tan', baseSalary: 1000000, filteredMinutes: 600, troCapChucVu: 200000,
        advance: 0, attendanceAdjustments: 0, netPay: 1200000
    });
    assert.match(receptionist, /TỔNG LƯƠNG \(1\) 1,200,000 ₫/);
    assert.match(receptionist, /TRỢ CẤP CHỨC VỤ: 200,000 ₫/);
}

const report = read('js/report.js');
const payload = report.slice(report.indexOf('function getCurrentCalculationPayload'), report.indexOf('async function saveCalculationDraftToDb'));
assert.match(payload, /roundedTotalBonus \+ positionAllowance \+ roundedAttendanceAdjustments - roundedAdvance/,
    'teacher net pay must include the dedicated allowance exactly once');
assert.match(payload, /role === 'tiep-tan'\s*\? 0/, 'receptionist allowance stays inside criterion V');
assert.match(payload, /details\.positionAllowanceSeparate = true/);
assert.equal((payload.match(/item\.id === 3/g) || []).length, 2, 'only the receptionist branch may read criterion id 3 as allowance');

const modalSave = report.slice(report.indexOf('async function saveSalarySettingsFromModal'), report.indexOf('function exportSalaryPDFFromModal'));
assert.match(modalSave, /settingsObj\.position_allowance = /);
assert.match(modalSave, /settingsObj\.position_allowance_note = /);
const modalRecalc = report.slice(report.indexOf('function recalculateSalaryModal'), report.indexOf('async function saveSalarySettingsFromModal'));
assert.match(modalRecalc, /basePay \+ criteriaPay \+ positionAllowance \+ recepPoolPay/, 'modal preview must match the saved payslip');
assert.match(report, /roleSettings\.position_allowance_note/, 'modal must load the saved note');

const page = read('bao-cao.html');
assert.match(page, /id="modal-position-allowance"/, 'Admin modal must expose the allowance input');
assert.match(page, /id="modal-position-allowance-note"/);

console.log('position-allowance.test.js: legacy snapshots, dedicated teacher allowance, receptionist criterion V and modal wiring passed');
