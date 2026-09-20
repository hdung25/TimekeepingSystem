// Trạng thái họp phải dựa trên cuộc họp thật sự, không được suy chuyên môn
// thành thành đi họp. Đây là hồi quy cho ảnh tháng 08/2026 không có TG TA nhưng
// bảng cũ vẫn tự điền "Có".
const assert = require('node:assert/strict');
const CRLF = new RegExp(String.fromCharCode(13) + String.fromCharCode(10), 'g');
const NL = String.fromCharCode(10);
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
assert.match(page, /getInvitedDepartmentMeetings\(row\.dataset\.userId, 'TG TA', hasRole\)/,
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

// Tiêu chí X của giáo viên chế độ cũ luôn theo trang họp: số tiền nhập tay cũ
// không được chặn tự động, và mọi đường tính/lưu đều áp cùng một kết quả.
const automationStart = report.indexOf('function automaticMeetingEvaluation(');
const automationSource = report.slice(automationStart, report.indexOf('\n}\n', automationStart));
assert.doesNotMatch(automationSource, /manual === true|mayAutomate/,
    'dòng họp manual cũ không được chặn đồng bộ từ trang họp');
{
    const sandbox = { window: { currentUserContext: { teachingMode: 'old' } } };
    const helpers = report.slice(report.indexOf('function isMeetingPayrollAutomatic('), report.indexOf('let currentEvalIndex'));
    const normalize = report.slice(report.indexOf('function normalizeEvaluationEntries('), report.indexOf('\n}\n', report.indexOf('function normalizeEvaluationEntries(')) + 3);
    const run = new Function('window', `${normalize}\n${helpers}\nreturn { automaticMeetingEvaluation, isMeetingPayrollAutomatic };`)(sandbox.window);
    const summary = { complete: true, amount: 1000, note: 'T-TV: Có', version: policy.VERSION };
    const stale = [{ id: 9, amount: 48650, manual: true, note: 'Tiếng Anh: Không họp; T-TV: Chưa ghi nhận' }];
    const synced = run.automaticMeetingEvaluation(stale, summary).find(row => row.id === 9);
    assert.equal(synced.amount, 1000, 'họp có mặt phải cộng 1.000đ dù dòng cũ nhập tay');
    assert.equal(synced.manual, false);
    assert.equal(stale[0].amount, 48650, 'không được sửa trực tiếp dữ liệu đã tải');
    assert.equal(run.automaticMeetingEvaluation(stale, { ...summary, complete: false })[0].amount, 48650,
        'họp chưa kết thúc thì giữ nguyên số đã lưu');
    sandbox.window.currentUserContext.teachingMode = 'new';
    assert.equal(run.automaticMeetingEvaluation(stale, summary)[0].amount, 48650,
        'giáo viên chế độ mới không bị áp tự động');
}
const subjectLoader = report.slice(report.indexOf('async function loadAndRenderSubjects('), report.indexOf('const policyApi = await ensureSubjectRatePolicyLoaded();', report.indexOf('async function loadAndRenderSubjects(')));
assert.match(subjectLoader, /DBService\.getSubjects\(true\)/,
    'danh sách môn khi sửa/thêm ca phải đọc lại server để thấy môn vừa tạo (VD B2)');

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

// ===== Buổi họp "Tự chọn thành viên" (CUSTOM) =====
// Buổi tự chọn không có cột riêng trên lưới lương. Điểm danh ở đó là bằng chứng
// có đi họp, nhưng vắng mặt ở đó KHÔNG bao giờ được biến thành mức trừ.
{
    const custom = {
        id: 'custom-1', department: 'CUSTOM', date: '2026-09-10',
        checkInStart: '08:00', endTime: '09:00', attendees: ['u1', 'u2']
    };
    const deptMeeting = {
        id: 'ta-1', department: 'TG TA', date: '2026-09-12',
        checkInStart: '08:00', endTime: '09:00', attendees: ['u1']
    };
    const customLogs = {
        'custom-1': [{ userId: 'u1', status: 'Có', checkInTime: '2026-09-10T08:10:00' }],
        'ta-1': []
    };
    const afterAll = new Date(2026, 8, 20);
    const ask = (list, userId, memberOfDepartment) => policy.resolveDepartmentStatus({
        meetings: list, attendanceByMeeting: customLogs, userId,
        department: 'TG TA', memberOfDepartment, now: afterAll
    });

    assert.equal(ask([custom], 'u1', true), 'Có',
        'đã điểm danh ở buổi tự chọn phải được tính khi tổ không có buổi riêng');
    assert.equal(ask([custom], 'u1', false), 'Không họp',
        'người không thuộc tổ này không được nhận bằng chứng buổi tự chọn');
    assert.equal(ask([custom], 'u2', true), 'Không họp',
        'vắng ở buổi tự chọn không bao giờ thành mức trừ');
    assert.equal(ask([custom, deptMeeting], 'u1', true), 'Vắng không phép',
        'buổi tự chọn không được che một buổi họp tổ đã bỏ lỡ');
    assert.equal(ask([deptMeeting], 'u1', true), 'Vắng không phép',
        'hành vi cũ của buổi họp tổ phải giữ nguyên');
    assert.equal(policy.isCustomInvited(custom, 'u1'), true);
    assert.equal(policy.isCustomInvited(deptMeeting, 'u1'), false);
}
assert.match(report, /memberOfDepartment: belongsToDepartment\(department\)/,
    'bảng lương phải nói rõ nhân viên có thuộc tổ đó không');
assert.match(report, /MeetingAttendancePolicy\.isCustomInvited\(meeting, staffId\)/,
    'bảng lương phải xét cả buổi họp tự chọn thành viên');

// ===== Đánh dấu sẵn "Có" khi tạo lịch =====
// Bản ghi được tạo TRƯỚC giờ mở điểm danh chỉ hợp lệ khi mang adminOverride;
// thiếu cờ này thì lưới, thống kê và trang nhân viên hiển thị mâu thuẫn nhau.
{
    const bulkStart = db.indexOf('checkInMeetingBulk: async');
    assert.notEqual(bulkStart, -1, 'thiếu hàm điểm danh sẵn hàng loạt');
    const bulk = db.slice(bulkStart, db.indexOf('// PAYSLIP LIFECYCLE HELPERS START', bulkStart));
    assert.match(bulk, /adminOverride: true/,
        'điểm danh sẵn phải được mọi trang công nhận');
    assert.match(bulk, /DBService\._meetingCheckInOpenISO\(mData\)/,
        'giờ ghi nhận của điểm danh sẵn phải là giờ mở điểm danh của buổi họp');
    assert.match(bulk, /const meetingField = DBService\._meetingLogField\(mData\.department\)/,
        'buổi họp của một tổ chỉ được ghi vào đúng cột của tổ đó');
    assert.doesNotMatch(bulk, /logDoc/,
        'không đọc rồi ghi đè cả tài liệu meetings_log');

    const isoStart = db.indexOf('_meetingCheckInOpenISO: (meeting) => {');
    assert.notEqual(isoStart, -1, 'thiếu bộ tính giờ mở điểm danh');
    const isoBody = db.slice(db.indexOf('(meeting) => {', isoStart), db.indexOf('    },', isoStart) + 5);
    const iso = new Function('return ' + isoBody)()({ date: '2026-09-10', checkInStart: '08:30' });
    const opened = new Date(iso);
    assert.equal(opened.getHours(), 8, 'giờ ghi nhận phải theo giờ máy, không phải UTC');
    assert.equal(opened.getMinutes(), 30);
    assert.equal(policy.isValidAttendance(
        { status: 'Có', checkInTime: iso, adminOverride: true },
        { date: '2026-09-10', checkInStart: '08:30' }
    ), true, 'bản ghi điểm danh sẵn phải hợp lệ ở mọi trang');
}

// ===== Banner điểm danh họp trên trang chấm công =====
// Một tài liệu meeting_attendance không đồng nghĩa với đã điểm danh (xác nhận
// tham gia cũng tạo tài liệu), và banner phải chịu cùng cổng mạng/thời gian.
{
    const main = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8')
        .replace(CRLF, NL);
    assert.match(main, /window\.isValidMeetingCheckIn\(rawAttendance, meeting\)/,
        'banner phải dùng chung luật hợp lệ, không coi mọi tài liệu là đã điểm danh');
    const checkIn = main.slice(main.indexOf('window.checkInToMeeting = async function'),
        main.indexOf('// ================= PASSWORD SELF-SERVICE'));
    assert.match(checkIn, /assertMeetingLocationAllowed/,
        'banner không được là đường vòng bỏ qua ràng buộc IP mạng');
    assert.match(checkIn, /Chưa tới giờ điểm danh/,
        'banner phải chặn điểm danh trước giờ mở');
    assert.match(checkIn, /Cuộc họp đã kết thúc/,
        'banner phải chặn điểm danh sau khi họp đã kết thúc');
    assert.match(main, /if \(Array\.isArray\(m\.attendees\) && m\.attendees\.length > 0\)/,
        'danh sách mời rỗng nghĩa là cả tổ, không phải không ai');
}

// ===== Trang "Họp Của Tôi" =====
{
    const mine = fs.readFileSync(path.join(__dirname, '..', 'hop-cua-toi.html'), 'utf8')
        .replace(CRLF, NL);
    assert.match(mine, /js\/meeting-attendance-policy\.js\?v=/,
        'trang nhân viên phải nạp chính sách họp dùng chung');
    assert.match(mine, /window\.MeetingAttendancePolicy\?\.isValidAttendance/,
        'trang nhân viên phải dùng chung luật hợp lệ');
    assert.match(mine, /const lockedByAdmin = !!\(log && log\.adminOverride\)/,
        'nhân viên không được ghi đè trạng thái admin đã chốt');
    assert.match(mine, /báo vắng có phép/,
        'nhân viên phải báo vắng được ngay trong khung giờ điểm danh');
}

// Ngày mặc định của form tạo họp phải theo giờ máy: toISOString() trả giờ UTC
// nên trước 07:00 giờ Việt Nam nó lùi lịch họp về hôm qua.
assert.doesNotMatch(page, /toISOString\(\)\.split\('T'\)\[0\]/,
    'ngày họp mặc định không được lấy từ giờ UTC');

console.log('meeting-schedule-truth.test.js: all assertions passed');
