// Kiểm tra luật "sớm 10 phút": môn cho phép + giáo viên chế độ cũ + chấm công
// sớm thật sự ít nhất 10 phút so với giờ vào ca.
const assert = require('node:assert/strict');
const path = require('node:path');

const Early10 = require(path.join(__dirname, '..', 'js', 'early10.js'));

const SUBJECTS = [
    { id: 'en', name: 'Tiếng Anh', isGroup: true, parentId: null, allowEarly10: true },
    { id: 'en-talk', name: 'Tiếng Anh giao tiếp', parentId: 'en', allowEarly10: true },
    { id: 'en-school', name: 'Tiếng Anh trên trường', parentId: 'en', allowEarly10: true },
    { id: 'math', name: 'Toán Tư Duy', parentId: null, allowEarly10: false },
    { id: 'it', name: 'Tin Học', parentId: null }
];
const SUBJECT_MAP = Early10.buildSubjectEarly10Map(SUBJECTS);

const OLD_TEACHER = { id: 'u1', name: 'Dũng', teachingMode: 'old' };
const NEW_TEACHER = { id: 'u2', name: 'Lan', teachingMode: 'new' };
const UNSET_TEACHER = { id: 'u3', name: 'Hà' };

// Ngày cố định để test không phụ thuộc hôm nay là ngày nào.
const at = (clock) => new Date(`2026-08-03T${clock}:00`);

{
    // Bản đồ môn: thiếu cờ = không cho phép.
    assert.equal(SUBJECT_MAP['en-talk'], true);
    assert.equal(SUBJECT_MAP['math'], false);
    assert.equal(SUBJECT_MAP['it'], false);
}

{
    // Ca gộp nhiều môn: chỉ cần MỘT môn cho phép là hợp lệ.
    assert.equal(Early10.isSubjectEarly10Allowed('en-talk', SUBJECT_MAP), true);
    assert.equal(Early10.isSubjectEarly10Allowed('math+en-school', SUBJECT_MAP), true);
    assert.equal(Early10.isSubjectEarly10Allowed('math+it', SUBJECT_MAP), false);
    assert.equal(Early10.isSubjectEarly10Allowed('', SUBJECT_MAP), false);
    assert.equal(Early10.isSubjectEarly10Allowed(null, SUBJECT_MAP), false);

    // Chính sách của chip phải đọc mã môn thật, không lấy nhầm session.role
    // (role có thể đã bị gán thành mã lương sau khi tính ca).
    assert.deepEqual(Early10.getChipSubjectIds({
        subjectIds: ['en-school'],
        sessionData: { role: 'salary-role' }
    }), ['en-school']);
    assert.equal(Early10.isChipEarly10Allowed({ subjectIds: ['en-talk'] }, SUBJECT_MAP), true);
    assert.equal(Early10.isChipEarly10Allowed({ subjectIds: ['math'] }, SUBJECT_MAP), false);
    assert.equal(Early10.isChipEarly10Allowed({ subjectIds: ['math', 'en-school'] }, SUBJECT_MAP), true);
}

{
    // Phân loại chế độ giáo viên.
    assert.equal(Early10.getTeachingMode(OLD_TEACHER), 'old');
    assert.equal(Early10.getTeachingMode(NEW_TEACHER), 'new');
    assert.equal(Early10.getTeachingMode(UNSET_TEACHER), 'unset');
    assert.equal(Early10.getTeachingMode(null), 'unset');
    assert.equal(Early10.isOldModeTeacher(UNSET_TEACHER), false);
}

{
    // Số phút đến sớm.
    assert.equal(Early10.getEarlyMinutes(at('07:19'), '07:30'), 11);
    assert.equal(Early10.getEarlyMinutes(at('07:25'), '07:30'), 5);
    assert.equal(Early10.getEarlyMinutes(at('07:35'), '07:30'), -5);
    assert.equal(Early10.getEarlyMinutes(at('07:20'), '07:30'), 10);
    assert.equal(Early10.getEarlyMinutes(null, '07:30'), null);
    assert.equal(Early10.getEarlyMinutes(at('07:20'), 'giờ sai'), null);
}

{
    // Ca qua nửa đêm không bị quy thành "sớm cả ngày".
    assert.equal(Early10.getEarlyMinutes(at('23:50'), '00:05'), 15);
    assert.equal(Early10.getEarlyMinutes(at('00:10'), '23:55'), -15);
}

{
    // Trường hợp 1 trong yêu cầu: ca 7h30, chấm công 7h19 → duyệt tự động.
    const result = Early10.evaluateEarly10Request({
        sessionRole: 'en-talk',
        subjectMap: SUBJECT_MAP,
        user: OLD_TEACHER,
        checkIn: at('07:19'),
        classStart: '07:30'
    });
    assert.equal(result.ok, true);
    assert.equal(result.earlyMinutes, 11);
    assert.match(result.message, /07:19/);
}

{
    // Trường hợp 2: ca 7h30, chấm công 7h25 → chặn, báo đúng giờ vào thực tế.
    const result = Early10.evaluateEarly10Request({
        sessionRole: 'en-talk',
        subjectMap: SUBJECT_MAP,
        user: OLD_TEACHER,
        checkIn: at('07:25'),
        classStart: '07:30'
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'checkin');
    assert.match(result.message, /07:25/);
    assert.match(result.message, /07:20/); // mốc phải chấm trước
}

{
    // Đúng 10 phút là hợp lệ (biên dưới).
    const result = Early10.evaluateEarly10Request({
        sessionRole: 'en-talk',
        subjectMap: SUBJECT_MAP,
        user: OLD_TEACHER,
        checkIn: at('07:20'),
        classStart: '07:30'
    });
    assert.equal(result.ok, true);
    assert.equal(result.earlyMinutes, 10);
}

{
    // Môn không áp dụng → chặn, kể cả khi đến rất sớm.
    const result = Early10.evaluateEarly10Request({
        sessionRole: 'math',
        subjectMap: SUBJECT_MAP,
        user: OLD_TEACHER,
        checkIn: at('07:00'),
        classStart: '07:30'
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'subject');
}

{
    // Mã môn của chip thắng session.role để không làm mất quyền/chặn nhầm
    // sau khi role đã được dùng cho cấu hình lương.
    const result = Early10.evaluateEarly10Request({
        sessionRole: 'en-talk',
        subjectIds: ['math'],
        subjectMap: SUBJECT_MAP,
        user: OLD_TEACHER,
        checkIn: at('07:00'),
        classStart: '07:30'
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'subject');
}

{
    // Giáo viên chế độ mới → chặn.
    const result = Early10.evaluateEarly10Request({
        sessionRole: 'en-talk',
        subjectMap: SUBJECT_MAP,
        user: NEW_TEACHER,
        checkIn: at('07:00'),
        classStart: '07:30'
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'mode');
}

{
    // Chưa phân loại → chặn, và lời nhắn phải chỉ chỗ để sửa.
    const result = Early10.evaluateEarly10Request({
        sessionRole: 'en-talk',
        subjectMap: SUBJECT_MAP,
        user: UNSET_TEACHER,
        checkIn: at('07:00'),
        classStart: '07:30'
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'mode');
    assert.match(result.message, /Nhân Sự/);
}

{
    // Chưa chấm công vào → chặn, không được coi là hợp lệ.
    const result = Early10.evaluateEarly10Request({
        sessionRole: 'en-talk',
        subjectMap: SUBJECT_MAP,
        user: OLD_TEACHER,
        checkIn: null,
        classStart: '07:30'
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'no-checkin');
}

{
    // Ca không có giờ lịch → chặn.
    const result = Early10.evaluateEarly10Request({
        sessionRole: 'en-talk',
        subjectMap: SUBJECT_MAP,
        user: OLD_TEACHER,
        checkIn: at('07:00'),
        classStart: null
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'no-schedule');
}

{
    // Thứ tự kiểm tra: môn sai thì báo môn trước, không báo giờ.
    const result = Early10.evaluateEarly10Request({
        sessionRole: 'math',
        subjectMap: SUBJECT_MAP,
        user: NEW_TEACHER,
        checkIn: at('07:29'),
        classStart: '07:30'
    });
    assert.equal(result.code, 'subject');
}

{
    // Chuỗi thời gian ISO và Firestore Timestamp đều đọc được.
    const iso = Early10.getEarlyMinutes('2026-08-03T07:19:00', '07:30');
    assert.equal(iso, 11);
    const stamp = Early10.getEarlyMinutes({ seconds: Math.floor(at('07:19').getTime() / 1000) }, '07:30');
    assert.equal(stamp, 11);
}

{
    // Hình phạt tháng: hủy 1 ca sớm 10p khóa cả 10p lẫn phụ cấp lớp đông.
    assert.equal(Early10.isMonthlyBonusPenaltyActive({}, []), false);
    assert.equal(Early10.isMonthlyBonusPenaltyActive({ studentCountBonusPenalty: true }, []), true);
    assert.equal(Early10.isMonthlyBonusPenaltyActive({}, [{ studentCountStatus: 'rejected' }]), true);
    assert.equal(Early10.isMonthlyBonusPenaltyActive({}, [{ bonus10Status: 'rejected' }]), true);
    assert.equal(
        Early10.isMonthlyBonusPenaltyActive({}, [{ bonus10Status: 'approved' }, { studentCountStatus: 'approved' }]),
        false
    );
}

console.log('early10.test.js: all assertions passed');
