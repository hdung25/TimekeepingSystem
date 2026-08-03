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

const { getTeachingPayAllocations, isStudentCountPenaltyActive } = context;

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
    // Ca tháng 7 thật từ báo cáo lỗi: 598 phút lớp 10 HS + 89 phút lớp thường.
    // Tổng phải đúng 687 phút (11h27), KHÔNG phải 1285 phút (21h25).
    const chips = [66, 90, 90, 90, 39, 63, 74, 86].map((paidMinutes, index) => ({
        paidMinutes,
        studentCount: 10,
        studentCountStatus: index === 0 ? 'approved' : 'pending'
    }));
    chips.push({ paidMinutes: 89 });

    const groups = aggregate(chips, {}, { 'Tin Học (+10 HS)': 150000 });
    assert.equal(groups['Tin Học'].minutes, 89);
    assert.equal(groups['Tin Học (+10 HS)'].minutes, 598);
    assert.equal(Object.values(groups).reduce((sum, group) => sum + group.minutes, 0), 687);
    assert.equal(
        Math.round(Object.values(groups).reduce((sum, group) => sum + group.amount, 0)),
        Math.round((89 / 60) * 100000 + (598 / 60) * 150000)
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
    assert.ok(allocations.every(allocation => allocation.name === 'Tin Học (+12 HS)'));
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

console.log('salary-breakdown.test.js: all assertions passed');
