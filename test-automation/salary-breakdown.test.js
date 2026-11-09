// Regression test: giờ lớp đông (+N HS) là ĐƠN GIÁ THAY THẾ, không phải giờ cộng thêm.
// Lỗi cũ: 1 ca lớp đông được cộng vào cả dòng môn gốc lẫn dòng "(+N HS)" →
// tổng giờ tháng bị nhân đôi (thực tế 11h27 nhưng bảng lương hiện 21h25).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const reportSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8');
const startMarker = '// PAYROLL HOUR ALLOCATION HELPERS START';
const endMarker = '// PAYROLL HOUR ALLOCATION HELPERS END';
const start = reportSource.indexOf(startMarker);
const end = reportSource.indexOf(endMarker);

assert.notEqual(start, -1, 'payroll helper start marker must exist');
assert.notEqual(end, -1, 'payroll helper end marker must exist');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(reportSource.slice(start, end + endMarker.length), context);

const {
    getTeachingPayAllocations,
    isStudentCountPenaltyActive,
    normalizeStudentCountApprovalStatus,
    getStudentCountBadgePresentation,
    studentCountSegmentIndexes,
    chipForStudentCountSegment
} = context;

function aggregate(chips, monthlySettings = {}, classRates = {}, baseRate = 100000) {
    const penaltyActive = isStudentCountPenaltyActive(monthlySettings, chips);
    const groups = {};

    chips.forEach(chip => {
        getTeachingPayAllocations(chip, 'Tin Học', chip.paidMinutes, baseRate, classRates, penaltyActive)
            .forEach(allocation => {
                if (!groups[allocation.name]) {
                    groups[allocation.name] = { minutes: 0, amount: 0, rate: allocation.rate };
                }
                groups[allocation.name].minutes += allocation.minutes;
                groups[allocation.name].amount += (allocation.minutes / 60) * allocation.rate;
            });
    });

    return groups;
}

{
    // Ca tháng 7 thật từ báo cáo lỗi: khai 598 phút lớp 10 HS nhưng chỉ 66 phút
    // đã duyệt; 532 phút còn chờ phải giữ đơn giá gốc, cộng 89 phút lớp thường.
    // Tổng phải đúng 687 phút (11h27), KHÔNG phải 1285 phút (21h25).
    const chips = [66, 90, 90, 90, 39, 63, 74, 86].map((paidMinutes, index) => ({
        paidMinutes,
        studentCount: 10,
        studentCountStatus: index === 0 ? 'approved' : 'pending'
    }));
    chips.push({ paidMinutes: 89 });

    const groups = aggregate(chips, {}, { 'Tin Học (+10 HS)': 150000 });
    assert.equal(groups['Tin Học'].minutes, 621);
    assert.equal(groups['Tin Học (+10 HS)'].minutes, 66);
    assert.equal(Object.values(groups).reduce((sum, group) => sum + group.minutes, 0), 687);
    assert.equal(
        Math.round(Object.values(groups).reduce((sum, group) => sum + group.amount, 0)),
        Math.round((621 / 60) * 100000 + (66 / 60) * 150000)
    );
}

{
    // Mỗi ca chỉ sinh ra ĐÚNG 1 dòng lương.
    const allocations = getTeachingPayAllocations(
        { studentCount: 10, studentCountStatus: 'approved' },
        'Tin Học',
        90,
        120000,
        { 'Tin Học (+10 HS)': 150000 },
        false
    );
    assert.equal(allocations.length, 1);
    assert.equal(allocations[0].name, 'Tin Học (+10 HS)');
    assert.equal(allocations[0].minutes, 90);
    assert.equal(allocations[0].rate, 150000);
}

{
    // Chưa cấu hình đơn giá lớp đông → vẫn trả đơn giá gốc, không được thành 0đ.
    const [allocation] = getTeachingPayAllocations(
        { studentCount: 10, studentCountStatus: 'approved' },
        'Tin Học',
        90,
        120000,
        {},
        false
    );
    assert.equal(allocation.name, 'Tin Học (+10 HS)');
    assert.equal(allocation.minutes, 90);
    assert.equal(allocation.rate, 120000);
}

{
    // Ca bị từ chối sĩ số → về đơn giá gốc, giờ vẫn được tính đủ.
    const [allocation] = getTeachingPayAllocations(
        { studentCount: 10, studentCountStatus: 'rejected' },
        'Tin Học',
        75,
        100000,
        { 'Tin Học (+10 HS)': 150000 },
        false
    );
    assert.equal(allocation.name, 'Tin Học');
    assert.equal(allocation.minutes, 75);
    assert.equal(allocation.rate, 100000);
}

{
    // 1 ca bị từ chối làm mất phụ cấp cả tháng, nhưng KHÔNG mất giờ và lương gốc.
    const chips = [
        { paidMinutes: 90, studentCount: 10, studentCountStatus: 'approved' },
        { paidMinutes: 75, studentCount: 10, studentCountStatus: 'rejected' }
    ];
    const groups = aggregate(chips, {}, { 'Tin Học (+10 HS)': 150000 });
    assert.deepEqual(Object.keys(groups), ['Tin Học']);
    assert.equal(groups['Tin Học'].minutes, 165);
    assert.equal(groups['Tin Học'].rate, 100000);
}

{
    // Cờ phạt lưu theo tháng cũng cho kết quả tương tự.
    const chips = [{ paidMinutes: 90, studentCount: 10, studentCountStatus: 'approved' }];
    const groups = aggregate(chips, { studentCountBonusPenalty: true }, { 'Tin Học (+10 HS)': 150000 });
    assert.equal(groups['Tin Học'].minutes, 90);
    assert.equal(groups['Tin Học (+10 HS)'], undefined);
}

{
    // Ca gộp: tổng phút của các segment phải bằng đúng tổng phút của ca.
    const chip = { studentCount: 12, studentCountStatus: 'pending' };
    const allocations = [31, 32].flatMap(minutes => getTeachingPayAllocations(
        chip,
        'Tin Học',
        minutes,
        100000,
        { 'Tin Học (+12 HS)': 160000 },
        false
    ));
    assert.equal(allocations.reduce((sum, allocation) => sum + allocation.minutes, 0), 63);
    assert.ok(allocations.every(allocation => allocation.name === 'Tin Học'));
}

{
    // Legacy/thiếu trạng thái phải được xem là chờ duyệt, không được tự nâng
    // thành approved để hiển thị hoặc trả phụ cấp.
    assert.equal(normalizeStudentCountApprovalStatus(undefined), 'pending');
    const [allocation] = getTeachingPayAllocations(
        { studentCount: 15 },
        'Toán',
        60,
        100000,
        { 'Toán (+15 HS)': 180000 },
        false
    );
    assert.equal(allocation.name, 'Toán');
    assert.equal(allocation.rate, 100000);

    const pendingBadge = getStudentCountBadgePresentation(undefined, false);
    assert.equal(pendingBadge.status, 'pending');
    assert.equal(pendingBadge.label, 'Chờ duyệt');
    assert.equal(pendingBadge.className, 'pending');
    assert.equal(getStudentCountBadgePresentation('approved', false).label, 'Đã duyệt');
    assert.equal(getStudentCountBadgePresentation('rejected', true).className, 'rejected');
}

{
    // Hủy 1 ca sớm 10p cũng khóa đơn giá lớp đông của cả tháng.
    assert.equal(isStudentCountPenaltyActive({}, [{ bonus10Status: 'rejected' }]), true);
    const chips = [
        { paidMinutes: 90, studentCount: 10, studentCountStatus: 'approved' },
        { paidMinutes: 60, studentCount: 10, studentCountStatus: 'approved', bonus10Status: 'rejected' }
    ];
    const groups = aggregate(chips, {}, { 'Tin Học (+10 HS)': 150000 });
    assert.deepEqual(Object.keys(groups), ['Tin Học']);
    assert.equal(groups['Tin Học'].minutes, 150);
    assert.equal(groups['Tin Học'].rate, 100000);
}

{
    // Phút âm / không hợp lệ không được làm hỏng tổng.
    const [allocation] = getTeachingPayAllocations({}, '', -10, 100000, {}, false);
    assert.equal(allocation.name, 'Chưa phân lớp');
    assert.equal(allocation.minutes, 0);
}

{
    // 09/11/2026 (Mai Linh 26/10): 1 lần chấm nối E2 18:00–19:30 → NV6 19:30–21:00, báo 14hs.
    // Sĩ số chỉ thuộc lớp có Số HS kế hoạch lớn nhất (E2 13hs), NV6 (1hs) giữ đơn giá thường.
    const chip = { paidMinutes: 180, studentCount: 14, studentCountStatus: 'approved' };
    const segs = [
        { lop: 'E2', lopId: 'e2', soHS: 13, schedMinutes: 90 },
        { lop: 'Nv6', lopId: 'nv6', soHS: 1, schedMinutes: 90 }
    ];
    const rates = { 'E2 (+14 HS)': 47000, 'Nv6 (+14 HS)': 60000 };
    const names = segs.map((seg, i) => getTeachingPayAllocations(
        chipForStudentCountSegment(chip, segs, i), seg.lop, 90, seg.lop === 'E2' ? 42000 : 44000, rates, false)[0]);
    assert.equal(names[0].name, 'E2 (+14 HS)');
    assert.equal(names[0].rate, 47000);
    assert.equal(names[1].name, 'Nv6');
    assert.equal(names[1].rate, 44000);
    assert.equal(chip.studentCount, 14, 'original chip must not be mutated');

    // Lớp lớn nằm sau trong chuỗi vẫn được chọn đúng.
    assert.deepEqual([...studentCountSegmentIndexes([segs[1], segs[0]])], [1]);
    // Cùng một lớp học 2 khung liền: cả 2 khung đều là lớp đông.
    assert.deepEqual([...studentCountSegmentIndexes([{ lop: 'E2', soHS: 13 }, { lop: 'E2', soHS: 13 }])], [0, 1]);
    // Không có số kế hoạch (lịch ghi 0) hoặc hòa: lớp đầu chuỗi.
    assert.deepEqual([...studentCountSegmentIndexes([{ lop: 'A' }, { lop: 'B', soHS: 0 }])], [0]);
    assert.deepEqual([...studentCountSegmentIndexes([{ lop: 'A', soHS: 5 }, { lop: 'B', soHS: 5 }])], [0]);
    // Lịch trống Số HS (chưa biết) thắng lớp ghi rõ 1–2 bé; nhưng thua lớp ghi rõ 9 bé.
    assert.deepEqual([...studentCountSegmentIndexes([{ lop: 'E6', soHS: 0 }, { lop: 'Pre I1', soHS: 2 }])], [0]);
    assert.deepEqual([...studentCountSegmentIndexes([{ lop: 'E4', soHS: 9 }, { lop: 'TV5', soHS: 0 }])], [0]);
    assert.deepEqual([...studentCountSegmentIndexes([{ lop: 'Toán 5', soHS: 8 }, { lop: 'Toán 3', soHS: 14 }])], [1]);
    // A → B → A: sĩ số theo lớp A cho cả 2 khung của A.
    assert.deepEqual([...studentCountSegmentIndexes([{ lop: 'A', soHS: 12 }, { lop: 'B', soHS: 2 }, { lop: 'A', soHS: 12 }])], [0, 2]);
    // Ca đơn / không có sĩ số: giữ nguyên chip.
    assert.equal(chipForStudentCountSegment({ studentCount: 0 }, segs, 1).studentCount, 0);
    assert.deepEqual([...studentCountSegmentIndexes(null)], []);
}

console.log('salary-breakdown.test.js: all assertions passed');
