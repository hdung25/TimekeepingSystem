// CHẶN CA TRÙNG GIỜ NGAY TỪ LÚC GHI.
// Nhân viên chỉ bấm vào ca MỘT lần (checkInPersonal từ chối tạo ca thứ hai khi còn ca
// đang mở), nên hai ca cùng khung giờ luôn đến từ phía quản lý: thêm ca tay, hoặc duyệt
// hai yêu cầu chấm bù cho hai lớp dạy cùng giờ. Mỗi ca sau đó tự tính đủ giờ → lương đôi.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-service.js'), 'utf8')
    .replace(/\r\n/g, '\n');

// db-service.js là file trình duyệt (đụng firebase/localStorage khi nạp), nên chỉ dựng lại
// đúng thân transaction của addSession để chạy thử. Đổi tên hàm là test đỏ ngay.
const fnStart = source.indexOf('addSession: async (userId, dateKey, sessionData, options = {}) => {');
assert.notEqual(fnStart, -1, 'không tìm thấy addSession(..., options) trong js/db-service.js');
const guardStart = source.indexOf('// === CHẶN CA TRÙNG GIỜ ===', fnStart);
const guardEnd = source.indexOf('\n                }\n', source.indexOf('err.clash = clash;', guardStart));
assert.ok(guardStart !== -1 && guardEnd !== -1, 'không tìm thấy khối chặn ca trùng giờ');
const guardSrc = source.slice(guardStart, guardEnd + 20);

const context = { Date, Math, console };
vm.createContext(context);
vm.runInContext(
    'function runGuard(dateKey, data, sessionData, options) {\n' +
    '    const newStart = sessionData.checkIn || sessionData.start;\n' +
    guardSrc + '\n' +
    '    return "ADDED";\n' +
    '}',
    context
);

const DAY = '2026-08-11';
const iso = hm => `${DAY}T${hm}:00`;
const existing = { sessions: [{ id: 1, checkIn: iso('09:15'), checkOut: iso('10:45') }] };

{
    // Ca thứ hai TRÙNG NGUYÊN khung giờ (dạy 2 lớp cùng lúc) → chặn.
    assert.throws(
        () => context.runGuard(DAY, existing, { checkIn: iso('09:15'), checkOut: iso('10:45') }, {}),
        e => e.code === 'SESSION_OVERLAP' && /09:15/.test(e.message),
        'ca trùng nguyên khung giờ phải bị chặn kèm giờ của ca đang có'
    );
}

{
    // Chồng một phần từ 10 phút trở lên → vẫn chặn.
    assert.throws(
        () => context.runGuard(DAY, existing, { checkIn: iso('10:00'), checkOut: iso('11:30') }, {}),
        e => e.code === 'SESSION_OVERLAP'
    );
}

{
    // Ca NỐI TIẾP nhau (và lệch vài phút) là bình thường → cho qua.
    assert.equal(context.runGuard(DAY, existing, { checkIn: iso('10:45'), checkOut: iso('12:15') }, {}), 'ADDED');
    assert.equal(context.runGuard(DAY, existing, { checkIn: iso('10:40'), checkOut: iso('12:00') }, {}), 'ADDED',
        'chồng dưới 10 phút vẫn cho thêm (ca nối tiếp lệch giờ vài phút)');
    assert.equal(context.runGuard(DAY, existing, { checkIn: iso('07:30'), checkOut: iso('09:00') }, {}), 'ADDED');
}

{
    // Quản lý đã xem cảnh báo và vẫn quyết định duyệt → cho qua.
    assert.equal(
        context.runGuard(DAY, existing, { checkIn: iso('09:15'), checkOut: iso('10:45') }, { allowOverlap: true }),
        'ADDED'
    );
}

{
    // Ca đánh dấu VẮNG và ca chưa có giờ ra không nằm trong phạm vi kiểm tra.
    assert.equal(context.runGuard(DAY, existing, { checkIn: iso('09:15'), checkOut: iso('10:45'), isAbsent: true }, {}), 'ADDED');
    assert.equal(context.runGuard(DAY, existing, { checkIn: iso('09:15'), checkOut: null }, {}), 'ADDED');
    // Ca đã có được đánh dấu vắng thì không chặn ca thật.
    const absentDay = { sessions: [{ id: 1, checkIn: iso('09:15'), checkOut: iso('10:45'), isAbsent: true }] };
    assert.equal(context.runGuard(DAY, absentDay, { checkIn: iso('09:15'), checkOut: iso('10:45') }, {}), 'ADDED');
}

console.log('add-session-overlap.test.js: all assertions passed');
