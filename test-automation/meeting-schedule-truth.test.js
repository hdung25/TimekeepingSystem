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

const resolverStart = page.indexOf('function resolveAutoStatus(dept, savedValue)');
const resolverEnd = page.indexOf('// Chuyên môn chỉ quyết định', resolverStart);
assert.notEqual(resolverStart, -1, 'thiếu bộ phân giải trạng thái họp');
assert.notEqual(resolverEnd, -1, 'không đọc được bộ phân giải trạng thái họp');
const resolver = page.slice(resolverStart, resolverEnd);
assert.match(resolver, /deptMeetings\.length === 0[\s\S]*return "Không họp"/,
    'không có lịch họp phải luôn là Không họp');
assert.doesNotMatch(resolver, /defaultVal/,
    'không được dùng chuyên môn làm mặc định Có');
assert.match(page, /getInvitedDepartmentMeetings\(row\.dataset\.userId, 'TG TA'\)/,
    'cột TG TA phải kiểm tra lịch họp trước khi cho sửa');
assert.match(page, /value="Chưa điểm danh"/,
    'họp đã lên lịch nhưng chưa diễn ra cần trạng thái trung lập');
assert.match(page, /if \(!autoMeetingsLoaded\)[\s\S]*Không tải được lịch họp thật/,
    'lỗi đọc không được giả thành tháng không họp');

assert.match(report, /scheduledMeetings = await DBService\.getMeetingsForMonth\(monthStr\)/,
    'ghi chú tính lương phải đọc lịch họp thật');
assert.match(report, /if \(!invited\) return 'Không họp'/,
    'ghi chú lương phải hiện Không họp khi bộ phận không có lịch');

const dbMeetingStart = db.indexOf('getMeetingsForMonth: async');
const dbMeetingEnd = db.indexOf('getTodayMeetings:', dbMeetingStart);
const dbMeetingSource = db.slice(dbMeetingStart, dbMeetingEnd);
assert.match(dbMeetingSource, /throw error/,
    'lỗi Firestore phải được đẩy lên giao diện');
assert.doesNotMatch(dbMeetingSource, /catch \(error\)[\s\S]*return \[\]/,
    'lỗi Firestore không được đổi thành danh sách họp rỗng');

console.log('meeting-schedule-truth.test.js: all assertions passed');
