// MSNV ở trang Nhân sự: số trước, rồi chữ A→Z; form tạo mới có ô nhập mã số.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const sandbox = { window: {}, document: { addEventListener() {} }, localStorage: { getItem() { return null; } }, console };
vm.runInNewContext(read('js/personnel.js'), sandbox);
const N = sandbox.window.NhanSu;
const plain = (value) => JSON.parse(JSON.stringify(value));

// Đọc mã từ tên đăng nhập thật đang dùng
const expected = {
    dung39: '39', an08: '08', van75: '75', nguyen12: '12', My43: '43', thanh02: '02',
    anhv3: 'V3', thaiv1: 'V1', huyenn1: 'N1', vann5: 'N5', huyenN10: 'N10'
};
Object.keys(expected).forEach((username) => {
    assert.strictEqual(N._parseStaffCode(username).text, expected[username], username);
});
['admin', 'admin1', 'test', 'Thuytien', ''].forEach((username) => {
    assert.strictEqual(N._parseStaffCode(username), null, username);
});

// Thứ tự: số nhỏ → lớn, N1 N5 N10, V1 V3, không có mã xuống cuối
const sorted = N._sortUsers(['thaiv1', 'test', 'dung39', 'vann5', 'admin1', 'huyenn1', 'an08', 'anhv3', 'huyenN10', 'thanh02']
    .map((username) => ({ username })));
assert.deepStrictEqual(plain(sorted.map((u) => u.username)),
    ['thanh02', 'an08', 'dung39', 'huyenn1', 'vann5', 'huyenN10', 'thaiv1', 'anhv3', 'admin1', 'test']);
assert.deepStrictEqual(plain(sorted.map((u) => u._msnvStr)),
    ['02', '08', '39', 'N1', 'N5', 'N10', 'V1', 'V3', '', '']);

// Chuẩn hóa mã nhập tay
assert.strictEqual(N._normalizeStaffCode(' 5 '), '05');
assert.strictEqual(N._normalizeStaffCode('77'), '77');
assert.strictEqual(N._normalizeStaffCode('n6'), 'N6');
assert.strictEqual(N._normalizeStaffCode('V02'), 'V2');
['', '0', 'N0', 'abc', 'NV1', '1a'].forEach((value) => assert.strictEqual(N._normalizeStaffCode(value), '', value));

// Tên đăng nhập gợi ý luôn đọc ngược lại đúng mã đã nhập
assert.strictEqual(N._suggestUsername('Nguyễn Thị Huyền', 'N6'), 'huyenn6');
assert.strictEqual(N._suggestUsername('Trần Văn Đạt', '05'), 'dat05');
assert.strictEqual(N._suggestUsername('Lê Thị Vân', 'V2'), 'vanv2');
assert.strictEqual(N._suggestUsername('Nguyễn Thị Huyền', 'N10'), 'huyenN10');
[['Hoàng Tuấn', '05'], ['Hoàng Tuấn', 'N12'], ['Lê Ánh', 'T3'], ['Lê Ánh', 'V11']].forEach(([name, code]) => {
    assert.strictEqual(N._parseStaffCode(N._suggestUsername(name, code)).text, code, name + code);
});

// Số còn trống theo từng nhóm
assert.strictEqual(
    N._describeFreeCodes(['a01', 'b04', 'c05', 'huyenn1', 'vann5', 'thaiv1', 'anhv2', 'test'].map((username) => ({ username }))),
    'Mã số: trống 02–03; tiếp theo 06 · Mã N: trống 2–4; tiếp theo N6 · Mã V: không có chỗ trống; tiếp theo V3'
);

// Form tạo mới có ô mã số
const page = read('nhan-su.html');
assert.match(page, /Mã số nhân viên <i>\*<\/i>/);
assert.match(page, /id="ns-staff-code"[^>]*NhanSu\.fillSuggestedUsername/);

console.log('personnel-staff-code: ok');
