// Mốc TỰ RA CA của ngày làm việc: nối các khúc việc liền nhau (ca trực + lớp dạy) để
// nhân viên chỉ bấm vào ca một lần, nhưng KHÔNG được nối sang ca tối cách mấy tiếng —
// buổi tối họ vẫn bấm vào ca như bình thường.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// main.js chạy trong trình duyệt (đụng document ngay khi nạp) nên chỉ trích đúng phần
// thuần logic ra chạy thử. Nếu đổi tên hàm thì test đỏ ngay — đúng ý đồ.
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const gapConst = source.match(/const AUTO_CHECKOUT_GAP_MS[^\n]*\n/);
const fnStart = source.indexOf('function resolveWorkChainEnd');
const fnEnd = source.indexOf('\n}\n', fnStart);
assert.ok(gapConst && fnStart !== -1 && fnEnd !== -1,
    'không tìm thấy AUTO_CHECKOUT_GAP_MS / resolveWorkChainEnd trong js/main.js');

const context = { console, Date, Math, Number };
vm.createContext(context);
vm.runInContext(gapConst[0] + source.slice(fnStart, fnEnd + 3), context);

const DAY = '2026-08-05';
const at = hm => new Date(DAY + 'T' + hm + ':00');
const block = (a, b, kind) => ({ start: at(a), end: at(b), kind: kind || 'day' });
const hhmm = d => (d ? d.toTimeString().slice(0, 5) : null);

{
    // Vừa trực tiếp tân 07:00–11:00 vừa có lớp 07:30–09:00: vào ca 1 lần lúc 07:00,
    // ra ca lúc 11:00 (trước đây bị ra lúc 09:00 nên phải bấm vào ca lần 2).
    const blocks = [block('07:00', '11:00', 'tiep-tan'), block('07:30', '09:00')];
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('07:00'))), '11:00');
}

{
    // Có thêm ca tối 18:00–21:00: vào ca buổi sáng KHÔNG được kéo tới 21:00.
    const blocks = [
        block('07:00', '11:00', 'tiep-tan'),
        block('07:30', '09:00'),
        block('18:00', '21:00')
    ];
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('07:00'))), '11:00',
        'ca tối cách nhiều tiếng không được nối vào mạch sáng');
    // Tối họ bấm vào ca như bình thường → mạch tối tan lúc 21:00.
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('17:55'))), '21:00');
}

{
    // Hai lớp cách nhau 15p (ra chơi) vẫn là một mạch → không bắt bấm vào ca lần 2.
    const blocks = [block('07:30', '09:00'), block('09:15', '10:45')];
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('07:25'))), '10:45');
}

{
    // Nghỉ trưa dài (12:00 → 14:30) thì cắt mạch, chiều bấm vào ca lại.
    const blocks = [block('09:00', '12:00'), block('14:30', '16:00')];
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('09:00'))), '12:00');
}

{
    // Ba ca trực liền nhau cả ngày vẫn nối thành một mạch.
    const blocks = [
        block('07:00', '11:30', 'tiep-tan'),
        block('11:30', '17:30', 'tiep-tan'),
        block('17:30', '21:00', 'tiep-tan')
    ];
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('07:00'))), '21:00');
}

{
    // Không có khúc nào khớp giờ vào ca → không tự ra ca (để admin xử lý).
    assert.equal(context.resolveWorkChainEnd([block('18:00', '21:00')], at('07:00')), null);
    assert.equal(context.resolveWorkChainEnd([], at('07:00')), null);
}

{
    // Không được ghép một ca đã kết thúc dù check-in cách giờ bắt đầu dưới 60p.
    // Lỗi cũ trả 09:45 cho check-in 10:00 rồi retry checkout vô hạn.
    assert.equal(context.resolveWorkChainEnd([block('09:15', '09:45')], at('10:00')), null);
}

assert.match(source.slice(source.indexOf('async function globalCheckAutoCheckout'), source.indexOf('// Khoảng nghỉ TỐI ĐA')),
    /getPersonalAttendance\(todayDateKey[\s\S]*getPersonalAttendance\(previousDateKey/,
    'global auto-checkout must search both today and previous-day attendance anchors');

console.log('auto-checkout.test.js: all assertions passed');
