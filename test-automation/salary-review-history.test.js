'use strict';
// Lịch sử tăng lương: đọc đơn giá theo tháng + quyết định trên trang Xét tăng lương.
const assert = require('node:assert/strict');
const H = require('../js/salary-review-history.js');

const doc = (month, rates, role = 'giao_vien') => ({ id: month + '_gv1', [role]: { class_rates: rates } });

// Tháng không lưu lớp = giữ giá tháng trước; 0 = chưa nhập, không phải "giảm về 0".
const t = H.rateTimeline([
    doc('2026-07', { E4: 48000, 'TV5': 40000 }),
    doc('2026-08', { E4: 48000, TV5: 0 }),
    doc('2026-09', { E4: 50000, 'E4 (+10 HS)': 54000 }),
    doc('2026-10', { E4: 50000, TV5: 42000 }),
    { id: '2026-11_gv1', published: { status: 'draft' } }
]);
assert.equal(t.firstMonth, '2026-07');
assert.deepEqual(t.changes.map(c => c.month), ['2026-10', '2026-09'], 'newest first, unchanged months skipped');
assert.deepEqual(t.changes[1].items, [{ name: 'E4', before: 48000, after: 50000 }, { name: 'E4 (+10 HS)', before: null, after: 54000 }]);
assert.deepEqual(t.changes[0].items, [{ name: 'TV5', before: 40000, after: 42000 }]);
assert.deepEqual(t.current, [{ name: 'E4', rate: 50000 }, { name: 'E4 (+10 HS)', rate: 54000 }, { name: 'TV5', rate: 42000 }]);

// Lần duyệt gắn vào đúng tháng; lần duyệt đã hủy không gắn, vẫn hiện ở "quyết định khác".
const history = [
    { id: 'op1', kind: 'approved', createdAt: '2026-08-20T03:00:00.000Z', targetMonth: '2026-09', newRate: 50000, reason: 'Dạy đều', groupName: 'E · 48.000 đ', changes: [{ name: 'E4', beforeRate: 48000, afterRate: 50000 }] },
    { id: 'op2', kind: 'approved', createdAt: '2026-09-25T03:00:00.000Z', targetMonth: '2026-10', newRate: 52000, changes: [{ name: 'E4', beforeRate: 50000, afterRate: 52000 }] },
    { id: 'c1', kind: 'cancelled', operationId: 'op2', createdAt: '2026-09-26T03:00:00.000Z', reason: 'chọn nhầm' },
    { id: 'n1', kind: 'not_increased', createdAt: '2026-10-05T03:00:00.000Z', reason: 'chưa đủ giờ', nextReviewDate: '2027-01-05' },
    { id: 'p1', kind: 'profile', createdAt: '2026-10-06T03:00:00.000Z' }
];
const built = H.build([doc('2026-08', { E4: 48000 }), doc('2026-09', { E4: 50000 })], history);
assert.equal(built.changes[0].approvals.length, 1);
assert.equal(built.changes[0].approvals[0].reason, 'Dạy đều');
assert.equal(built.changes[0].approvals[0].groupName, 'E');
assert.deepEqual(built.others.map(d => d.id), ['n1', 'c1', 'op2'], 'profile edits hidden, newest first');

// Tiếp tân đọc tiep_tan / tiep-tan.
const tt = H.rateTimeline([doc('2026-09', { 'Tiếp tân': 25000 }, 'tiep-tan'), doc('2026-10', { 'Tiếp tân': 27000 }, 'tiep_tan')], 'tiep_tan');
assert.deepEqual(tt.changes[0].items, [{ name: 'Tiếp tân', before: 25000, after: 27000 }]);
assert.equal(H.rateTimeline([]).firstMonth, '');

// Mức đã duyệt cho tháng sau: hiện 'sắp áp dụng', 'Đang áp dụng' vẫn là giá tháng này.
const up = H.rateTimeline([doc('2026-10', { E4: 48000 }), doc('2026-11', { E4: 48000 }), doc('2026-12', { E4: 50000 })], 'giao_vien', '2026-11');
assert.deepEqual(up.current, [{ name: 'E4', rate: 48000 }]);
assert.equal(up.changes[0].month, '2026-12'); assert.equal(up.changes[0].upcoming, true);

console.log('salary-review-history tests passed');
