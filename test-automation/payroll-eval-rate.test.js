// Cột "Đơn giá (đ/giờ)" của bảng tiêu chí và thứ tự Trước/Tiếp theo mã nhân viên.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Normalize CRLF (Windows checkout with core.autocrlf) so source slicing below matches.
const report = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8').replace(/\r\n/g, '\n');
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
const StaffCodeOrder = require('../js/staff-code-order.js');
const sortStart = report.indexOf('users.sort((a, b) => StaffCodeOrder');
const sortEnd = report.indexOf('}));', sortStart);
const sorter = new Function('StaffCodeOrder', 'return ' + report.slice(sortStart + 'users.sort('.length, sortEnd + 2))(StaffCodeOrder);
const users = ['linh12', 'thao3', 'abc', 'anhv3', 'huyenn1', 'mai3', 'thao12', 'xyz', 'thaiv1', 'giabao1'].map(username => ({ username }));
assert.deepEqual(users.sort(sorter).map(u => u.username),
    ['giabao1', 'mai3', 'thao3', 'linh12', 'thao12', 'huyenn1', 'thaiv1', 'anhv3', 'abc', 'xyz'],
    'hết số rồi mới đến chữ A→Z (N rồi V), cùng mã thì theo tên đăng nhập, mã không số đứng cuối');
assert.match(html, /staff-code-order\.js\?v=[^"]+"><\/script> <script src="js\/report\.js/, 'staff-code-order.js nạp trước report.js');

console.log('payroll-eval-rate.test.js: all assertions passed');
