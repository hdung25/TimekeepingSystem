// Cột "Đơn giá (đ/giờ)" của bảng tiêu chí và thứ tự Trước/Tiếp theo mã nhân viên.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const report = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'bao-cao.html'), 'utf8');
const slice = (start, end) => report.slice(report.indexOf(start), report.indexOf(end, report.indexOf(start)));
const fn = name => {
    const start = report.indexOf(`function ${name}(`);
    return report.slice(start, report.indexOf('\n}\n', start) + 3);
};

const run = new Function('window', fn('normalizeEvaluationEntries') + fn('formatNumberWithCommas') +
    slice('const EVAL_RATE_NOTE_PATTERN', 'function isMeetingPayrollAutomatic(') +
    'return { applyEvaluationRateRows, parseEvaluationRate, evaluationRateNote };')({});

assert.equal(run.parseEvaluationRate(''), null, 'để trống = nhập thành tiền tay');
assert.equal(run.parseEvaluationRate('-'), null);
assert.equal(run.parseEvaluationRate('0'), 0, 'nhập 0 là đơn giá hợp lệ');
assert.equal(run.parseEvaluationRate('-2,000'), -2000, 'cho phép đơn giá âm để phạt');

const rows = run.applyEvaluationRateRows([
    { id: 2, rate: 1000, amount: 5, note: 'Tính theo giờ: 1 giờ × 1,000đ/giờ = 1,000đ; ghi chú admin' },
    { id: 9, rate: -2000, amount: 7, automatic: 'meeting' },
    { id: 3, amount: 4, note: 'nhập tay' }
], 22.5);
assert.equal(rows[0].amount, 22500, 'thành tiền = đơn giá × tổng giờ dạy hiện tại');
assert.equal(rows[0].note, 'Tính theo giờ: 22,5 giờ × 1,000đ/giờ = 22,500đ; ghi chú admin',
    'công thức cũ được thay, ghi chú admin giữ nguyên');
assert.equal(rows[1].amount, 7, 'dòng tự động không bị cột đơn giá ghi đè');
assert.equal(rows[2].amount, 4, 'dòng không có đơn giá giữ số nhập tay');
assert.equal(run.evaluationRateNote('Tính theo giờ: 1 giờ × 1,000đ/giờ = 1,000đ; abc', null, 22.5), 'abc',
    'xóa đơn giá thì bỏ công thức khỏi ghi chú');

// Lưu đơn giá cùng tiêu chí ở cả popup và bảng chính.
assert.match(report, /\.modal-eval-rate\[data-index="\$\{index\}"\]/);
assert.match(report, /entry\.rate = rateValue/);
assert.match(html, /id="modal-eval-rate-head"/);

// Nút Trước/Tiếp không phụ thuộc icon CDN và có hiển thị mã nhân viên.
assert.doesNotMatch(html, /id="btn-prev-staff"[^>]*>\s*<i data-lucide/);
assert.match(html, /id="staff-nav-code"/);
const sortStart = report.indexOf('users.sort((a, b) => {');
const sorter = new Function('return ' + report.slice(sortStart + 'users.sort('.length, report.indexOf('\n    });', sortStart) + 6))();
const users = ['gv12', 'tt3', 'abc', 'gv3', 'tt12', 'xyz'].map(username => {
    const match = username.match(/\d+$/);
    return { username, msnv: match ? parseInt(match[0], 10) : null };
});
assert.deepEqual(users.sort(sorter).map(u => u.username), ['gv3', 'tt3', 'gv12', 'tt12', 'abc', 'xyz'],
    'thứ tự theo số mã, cùng số thì theo mã, mã không số đứng cuối');

console.log('payroll-eval-rate.test.js: all assertions passed');
