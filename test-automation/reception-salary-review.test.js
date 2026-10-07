// Xét tăng lương tiếp tân (08/10/2026): hẹn ngày → Đến hạn → Duyệt / Chờ thêm 1 tháng.
const assert = require('node:assert/strict');
const R = require('../js/reception-salary-review.js');
const Lifecycle = require('../functions/shared/payslip-lifecycle.js');
const lifecycle = Lifecycle.getPayslipLifecycleState;
const N = R.NORMAL, F = R.FIXED;
const today = '2026-10-08';

// Danh sách: chỉ tiếp tân đang làm, giá lấy tháng gần nhất có lưu.
const users = [
    { id: 'nv_van', name: 'Nguyễn Thị Hồng Vân', username: 'van75', roles: ['giao-vien', 'receptionist'] },
    { id: 'nv_gv', name: 'GV', username: 'gv1', roles: ['giao-vien'] },
    { id: 'nv_old', name: 'Nghỉ', username: 'old2', roles: ['receptionist'], status: 'inactive' }
];
const monthly = { nv_van: [
    { id: '2026-08_nv_van', tiep_tan: { class_rates: { [N]: 22000, [F]: 24000 } } },
    { id: '2026-09_nv_van', tiep_tan: { class_rates: { [N]: 23000 } } }
] };
let rows = R.buildRows({ users, plans: [], monthlyByStaff: monthly, legacyByStaff: {}, today });
assert.deepEqual(rows.map(r => r.staffId), ['nv_van']);
assert.equal(rows[0].currentRate, 23000);
assert.equal(rows[0].fixedRate, 24000);
assert.equal(rows[0].category, 'setup');
rows = R.buildRows({ users, plans: [{ staffId: 'nv_van', dueDate: '2026-10-08', revision: 2 }], monthlyByStaff: monthly, today });
assert.equal(rows[0].category, 'due', 'tới ngày hẹn thì đến hạn');
assert.equal(R.category({ dueDate: '2026-11-08' }, today), 'soon');
assert.equal(R.category({ dueDate: '2027-03-01' }, today), 'later');
assert.equal(R.category({ dueDate: '2026-10-01', enabled: false }, today), 'disabled');
assert.equal(R.addMonths('2026-10-31', 1), '2026-11-30', 'chờ 1 tháng');
assert.equal(R.defaultTargetMonth({ dueDate: '2026-10-08' }, today), '2026-10');
assert.equal(R.defaultTargetMonth({}, today), '2026-11');

// Duyệt: ghi tháng áp dụng, ca cố định tăng cùng số tiền, giữ giá khác; nâng tháng sau đang thấp hơn.
const history = [{ ...monthly.nv_van[1], id: '2026-09' }, { ...monthly.nv_van[0], id: '2026-08' }];
const plan = R.buildApproval({ newRate: 25000, targetMonth: '2026-10', currentMonth: '2026-10', history,
    targetDoc: { tiep_tan: { base_salary: 1, class_rates: { 'Khác': 5 } } },
    laterDocs: { '2026-11': { tiep_tan: { class_rates: { [N]: 23000 } } }, '2026-12': null, '2027-01': null },
    defaults: {}, user: users[0], lifecycle });
assert.equal(plan.oldNormal, 23000);
assert.equal(plan.newFixed, 26000);
assert.deepEqual(plan.patches[0].data.tiep_tan, { base_salary: 1, class_rates: { 'Khác': 5, [N]: 25000, [F]: 26000 } });
assert.deepEqual(plan.patches[1], { month: '2026-11', data: { tiep_tan: { class_rates: { [N]: 25000 } } } });
assert.throws(() => R.buildApproval({ newRate: 23000, targetMonth: '2026-10', currentMonth: '2026-10', history, targetDoc: null, laterDocs: {}, user: users[0], lifecycle }), /cao hơn/);
assert.throws(() => R.buildApproval({ newRate: 25000, targetMonth: '2026-07', currentMonth: '2026-10', history, targetDoc: null, laterDocs: {}, user: users[0], lifecycle }), /tháng trước/);

// Tháng đích chưa có phần tiếp tân → lấy cấu hình chung làm nền (như trang Tính lương).
const fromDefaults = R.buildApproval({ newRate: 25000, targetMonth: '2026-11', currentMonth: '2026-10', history: [],
    targetDoc: { giao_vien: { class_rates: { E5: 40000 } } }, laterDocs: {}, defaults: { receptionist_normal_rate: 21000, allowance: 7 },
    user: { salary_config: {} }, lifecycle });
assert.equal(fromDefaults.oldNormal, 21000);
assert.equal(fromDefaults.patches[0].data.tiep_tan.allowance, 7);
assert.equal(fromDefaults.patches[0].data.giao_vien, undefined, 'không đụng phần giáo viên');

// Phiếu tiếp tân nháp bị bỏ để tính lại; phiếu đã gửi thì từ chối.
const draft = { published: { role: 'dual', status_gv: 'published', status_tt: 'draft', details_gv: { netPay: 1 }, details_tt: { netPay: 2 } } };
const withDraft = R.buildApproval({ newRate: 25000, targetMonth: '2026-10', currentMonth: '2026-10', history, targetDoc: draft, laterDocs: {}, user: users[0], lifecycle });
assert.equal(withDraft.patches[0].data.published.details_tt, null);
assert.deepEqual(withDraft.patches[0].data.published.details_gv, { netPay: 1 }, 'phần giáo viên đã gửi giữ nguyên');
assert.deepEqual(withDraft.clearedMonths, ['2026-10']);
const sent = { published: { role: 'tiep-tan', status_tt: 'published', details_tt: { netPay: 2 } } };
assert.throws(() => R.buildApproval({ newRate: 25000, targetMonth: '2026-10', currentMonth: '2026-10', history, targetDoc: sent, laterDocs: {}, user: users[0], lifecycle }), /Thu hồi/);
// Tháng sau có giá riêng cao hơn + phiếu đã nhận → không ảnh hưởng, vẫn duyệt được.
const keepLater = R.buildApproval({ newRate: 25000, targetMonth: '2026-10', currentMonth: '2026-10', history, targetDoc: null,
    laterDocs: { '2026-11': { tiep_tan: { class_rates: { [N]: 26000 } }, published: { role: 'tiep-tan', status_tt: 'received', details_tt: { netPay: 1 } } } },
    user: users[0], lifecycle });
assert.equal(keepLater.patches.length, 1);
console.log('reception-salary-review.test.js: all assertions passed');
