// Trạng thái họp phải dựa trên cuộc họp thật sự, không được suy chuyên môn
// thành thành đi họp. Đây là hồi quy cho ảnh tháng 08/2026 không có TG TA nhưng
// bảng cũ vẫn tự điền "Có".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'hop-dinh-ky.html'), 'utf8')
    .replace(/\r\n/g, '\n');
const report = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8')
    .replace(/\r\n/g, '\n');
const db = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-service.js'), 'utf8')
    .replace(/\r\n/g, '\n');
const policy = require('../js/meeting-attendance-policy.js');

const resolverStart = page.indexOf('function resolveAutoStatus(dept, savedValue)');
const resolverEnd = page.indexOf('// Chuyên môn chỉ quyết định', resolverStart);
assert.notEqual(resolverStart, -1, 'thiếu bộ phân giải trạng thái họp');
assert.notEqual(resolverEnd, -1, 'không đọc được bộ phân giải trạng thái họp');
const resolver = page.slice(resolverStart, resolverEnd);
assert.match(resolver, /MeetingAttendancePolicy\.resolveDepartmentStatus/,
    'lưới họp phải dùng chung bộ phân giải với bảng lương');
assert.doesNotMatch(resolver, /defaultVal/,
    'không được dùng chuyên môn làm mặc định Có');
assert.match(page, /getInvitedDepartmentMeetings\(row\.dataset\.userId, 'TG TA'\)/,
    'cột TG TA phải kiểm tra lịch họp trước khi cho sửa');
assert.match(page, /value="Chưa điểm danh"/,
    'họp đã lên lịch nhưng chưa diễn ra cần trạng thái trung lập');
assert.match(page, /if \(!autoMeetingsLoaded\)[\s\S]*Không tải được lịch họp thật/,
    'lỗi đọc không được giả thành tháng không họp');

assert.match(report, /DBService\.getMeetingsForMonth\(monthStr\)/,
    'ghi chú tính lương phải đọc lịch họp thật');
assert.match(report, /loadMeetingPayrollSummary[\s\S]*getMeetingAttendance\(meeting\.id, \{ strict: true \}\)/,
    'bảng lương phải đọc bản ghi nhân viên tự điểm danh và không nuốt lỗi đọc');
assert.match(report, /automaticMeetingEvaluation/,
    'tiêu chí X phải được tính từ cùng dữ liệu họp');
assert.match(report, /staffProfile\?\.chuyen_mon \|\| staffProfile\?\.specialty/,
    'nhân viên tự điểm danh phải vẫn được xác định chuyên môn từ hồ sơ khi meetings_log cũ chưa có dòng');
assert.match(report, /if \(meeting\.department !== department\) return false/,
    'mỗi cột lương chỉ xét lịch họp đúng tổ, không lẫn các tổ khác');

const dbMeetingStart = db.indexOf('getMeetingsForMonth: async');
const dbMeetingEnd = db.indexOf('getTodayMeetings:', dbMeetingStart);
const dbMeetingSource = db.slice(dbMeetingStart, dbMeetingEnd);
assert.match(dbMeetingSource, /throw error/,
    'lỗi Firestore phải được đẩy lên giao diện');
assert.doesNotMatch(dbMeetingSource, /catch \(error\)[\s\S]*return \[\]/,
    'lỗi Firestore không được đổi thành danh sách họp rỗng');

const meetings = [
    { id: 'ta', department: 'TG TA', date: '2026-08-07', checkInStart: '21:37', endTime: '22:45', attendees: ['old-1'] },
    { id: 'ttv', department: 'TG T-TV', date: '2026-08-08', checkInStart: '21:37', endTime: '22:45', attendees: ['old-1'] }
];
const attendance = {
    ta: [{ userId: 'old-1', status: 'Có', adminOverride: true }],
    ttv: [{ userId: 'old-1', status: 'Vắng phép', adminOverride: true }]
};
assert.equal(policy.resolveDepartmentStatus({ meetings, attendanceByMeeting: attendance, userId: 'old-1', department: 'TG TA', now: new Date('2026-09-01') }), 'Có');
assert.equal(policy.calculateMonthly(['Có', 'Vắng phép', 'Không họp']).amount, 0,
    'một môn có mặt và một môn vắng phép phải hòa');
assert.equal(policy.calculateMonthly(['Vắng phép', 'Vắng phép', 'Vắng phép']).amount, -1000,
    'ba môn vắng có phép chỉ trừ một lần 1.000đ');
assert.equal(policy.calculateMonthly(['Vắng không phép']).amount, -2000);
assert.equal(policy.calculateMonthly(['Không họp']).amount, 0);

console.log('meeting-schedule-truth.test.js: all assertions passed');
