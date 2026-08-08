// THÁNG TRẢ LƯƠNG CHO CA CHẤM BÙ (quy định GĐ Diễm 06/08/2026).
// Lỗi bên trung tâm (mất mạng/mất điện) → trả NGAY trong tháng dạy.
// Nhân viên quên chấm công     → trả vào THÁNG SAU.
// Ca luôn nằm ở THÁNG DẠY; chỉ tiền là dồn sang tháng được chọn.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'tuong-trinh.html'), 'utf8')
    .replace(/\r\n/g, '\n');
const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
assert.ok(inline, 'không đọc được script trong tuong-trinh.html');
const src = inline[1];

function cut(start) {
    const a = src.indexOf(start);
    assert.notEqual(a, -1, `không tìm thấy ${start}`);
    const b = src.indexOf('\n}', a);
    assert.notEqual(b, -1, `không đọc hết ${start}`);
    return src.slice(a, b + 2);
}
const stripLine = src.match(/const stripTones=[\s\S]*?;\n/);
assert.ok(stripLine, 'không tìm thấy stripTones');
const constLine = src.match(/const CF_THING=[\s\S]*?const CENTER_FAULT_RE=[^\n]*\n/);
assert.ok(constLine, 'không tìm thấy CF_THING / CF_TROUBLE / CENTER_FAULT_RE');
const arrow = src.match(/const nextMonthOf=\([\s\S]*?\n\};\n/);
assert.ok(arrow, 'không tìm thấy nextMonthOf');
const guess = src.match(/const guessCenterFault=[^\n]*\n/);
assert.ok(guess, 'không tìm thấy guessCenterFault');

const context = { console, String, Number };
vm.createContext(context);
vm.runInContext(stripLine[0] + constLine[0] + arrow[0] + guess[0] + cut('function payoutFor(r){') + cut('function payoutSummary(list){'), context);

const req = (dateKey, reason) => ({ dateKey, reason, staffName: 'NV' });

{
    // --- LỖI TRUNG TÂM → trả trong tháng ---
    const centerFault = [
        'Trung tâm mất mạng nên không chấm công được',
        'mat mang khong bam vao ca duoc',
        'Cúp điện cả buổi sáng',
        'mất điện nên máy không lên',
        'Lỗi hệ thống, bấm vào ca báo lỗi',
        'app lỗi không vào được',
        'rớt mạng lúc 18h',
        'Wifi trung tâm bị lỗi',
        'Không đăng nhập được',
        'web lỗi không bấm được',
        'máy hư không lên',
        'mạng chập chờn'
    ];
    centerFault.forEach(reason => {
        const r = req('2026-08-06', reason);
        assert.equal(context.payoutFor(r).payoutMonth, '2026-08',
            `"${reason}" phải được trả TRONG THÁNG`);
    });
}

{
    // --- NHÂN VIÊN QUÊN → trả tháng sau ---
    const staffFault = [
        'Em quên chấm công',
        'Quên bấm ra ca',
        'Đi dạy thay nhưng chưa kịp bấm',
        'bận quá nên không nhớ'
    ];
    staffFault.forEach(reason => {
        const r = req('2026-08-06', reason);
        assert.equal(context.payoutFor(r).payoutMonth, '2026-09',
            `"${reason}" phải được trả THÁNG SAU`);
    });
}

{
    // --- Sang năm: tháng 12 → tháng 1 năm sau ---
    assert.equal(context.payoutFor(req('2026-12-20', 'quên chấm công')).payoutMonth, '2027-01');
    assert.equal(context.payoutFor(req('2026-12-20', 'trung tâm mất mạng')).payoutMonth, '2026-12');
}

{
    // --- Lý do trống → coi như nhân viên quên (thận trọng, không tự cho trả sớm) ---
    assert.equal(context.payoutFor(req('2026-08-06', '')).payoutMonth, '2026-09');
    assert.equal(context.payoutFor(req('2026-08-06', undefined)).payoutMonth, '2026-09');
}

{
    // --- Tóm tắt cho hộp xác nhận duyệt hàng loạt ---
    const list = [
        req('2026-08-06', 'trung tâm mất mạng'),
        req('2026-08-06', 'mất điện'),
        req('2026-08-05', 'em quên chấm công')
    ];
    const s = context.payoutSummary(list);
    assert.match(s, /2 ca TRẢ TRONG THÁNG/);
    assert.match(s, /1 ca TRẢ THÁNG SAU/);
}

console.log('payout-month.test.js: all assertions passed');
