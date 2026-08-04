const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'evaluation-service.js'), 'utf8');
const context = {
    console,
    Date,
    Math,
    Set,
    Map,
    Intl,
    window: {
        centerClosures: {},
        getIconHtml: () => ''
    },
    getLocalDateKey: date => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },
    // Ba helper này định nghĩa ở db-service.js (trang web nạp trước evaluation-service).
    // Trong test phải stub lại, nếu không calculateDailyChips ném ReferenceError.
    isScheduledMainTeacher: (cls, id) =>
        cls.gvId === id || (cls.gvList || []).some(g => g.id === id),
    isScheduledSubstitute: (cls, id) =>
        cls.gvThayTheId === id || (cls.gvThayTheList || []).some(g => g.id === id),
    hasScheduledSubstitute: cls =>
        !!cls.gvThayTheId || (cls.gvThayTheList || []).length > 0
};
vm.createContext(context);
vm.runInContext(source, context);

const staffId = 'teacher-hang';
const dateKey = '2026-07-14';
const schedule = {
    morning1: [{
        start: '07:30',
        end: '09:00',
        lop: 'TOÁN Dự thính',
        lopId: 'subject-math',
        gvId: staffId,
        registeredTeachers: [],
        _branch: 'cs1',
        _compositeKey: 'cs1__2026-07-14',
        _originalIndex: 0
    }]
};
const user = {
    roles: ['teaching_assistant'],
    salary_config: {
        roles: [{ id: 'subject-math', name: 'Toán dự thính', rate: 100000 }]
    }
};

function chipsFor(session, observations = []) {
    return context.window.calculateDailyChips(
        schedule,
        [session],
        staffId,
        dateKey,
        user,
        [],
        {},
        [],
        {},
        observations
    );
}

function observation(lateMinutes) {
    return {
        id: `obs-${lateMinutes}`,
        status: 'active',
        dateKey,
        branch: 'cs1',
        shiftKey: 'morning',
        scheduleCompositeKey: 'cs1__2026-07-14',
        classSectionKey: 'morning1',
        classIndex: 0,
        classStart: '07:30',
        classEnd: '09:00',
        teacherId: staffId,
        lateMinutes,
        note: `Tiếp tân ghi nhận ${lateMinutes} phút`
    };
}

{
    const chips = chipsFor({ id: 'open', checkIn: '2026-07-14T00:33:47.121Z' });
    assert.equal(chips.length, 1);
    assert.equal(chips[0].class, 'chip-orange');
    assert.match(chips[0].text, /\(T4p\)/);
    assert.equal(chips[0].paidMinutes, 86);
}

{
    const chips = chipsFor({
        id: 'manual-wins',
        checkIn: '2026-07-14T00:31:00.000Z',
        checkOut: '2026-07-14T02:00:00.000Z'
    }, [observation(5)]);
    assert.equal(chips[0].effectiveLateMinutes, 5);
    assert.equal(chips[0].paidMinutes, 85);
    assert.match(chips[0].text, /\(T5p\)/);
}

{
    const chips = chipsFor({
        id: 'system-wins',
        checkIn: '2026-07-14T00:36:00.000Z',
        checkOut: '2026-07-14T02:00:00.000Z'
    }, [observation(4)]);
    assert.equal(chips[0].effectiveLateMinutes, 6);
    assert.equal(chips[0].paidMinutes, 84);
    assert.match(chips[0].text, /\(T6p\)/);
}

{
    // QUY TẮC GĐ (18/07): giờ admin đã sửa là nguồn sự thật — tính đủ phút theo đúng
    // khoảng admin đặt (không cắt theo lịch) và KHÔNG gắn cờ trễ (T..p) theo lịch cũ.
    const chips = chipsFor({
        id: 'admin-edited',
        checkIn: '2026-07-14T00:33:00.000Z',
        checkOut: '2026-07-14T02:00:00.000Z',
        isAdminEdited: true
    });
    assert.equal(chips[0].class, 'chip-green');
    assert.ok(!/\(T\d+p\)/.test(chips[0].text), 'admin-edited không gắn cờ trễ hệ thống');
    assert.equal(chips[0].paidMinutes, 87); // 07:33–09:00 đủ theo giờ admin
}

{
    // Admin sửa giờ NHƯNG tiếp tân có ghi nhận trễ tay → ghi nhận tay vẫn hiệu lực
    const chips = chipsFor({
        id: 'admin-edited-manual-late',
        checkIn: '2026-07-14T00:33:00.000Z',
        checkOut: '2026-07-14T02:00:00.000Z',
        isAdminEdited: true
    }, [observation(5)]);
    assert.equal(chips[0].class, 'chip-orange');
    assert.match(chips[0].text, /\(T5p\)/);
    assert.equal(chips[0].paidMinutes, 82); // 87p − 5p ghi nhận tay
}

{
    // Hai ca dạy kề nhau: chỉ có công ca 1 thì ca 2 phải hiện Vắng,
    // không được bị gộp mất vào chip 1,5 giờ của ca đầu.
    const consecutiveSchedule = {
        evening1: [{
            start: '18:00',
            end: '19:30',
            lop: 'K1',
            lopId: 'subject-k1',
            gvId: staffId,
            registeredTeachers: [],
            _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-08',
            _originalIndex: 0
        }],
        evening2: [{
            start: '19:30',
            end: '21:00',
            lop: 'K2',
            lopId: 'subject-k2',
            gvId: staffId,
            registeredTeachers: [],
            _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-08',
            _originalIndex: 0
        }]
    };
    const chips = context.window.calculateDailyChips(
        consecutiveSchedule,
        [{
            id: 'worked-first-shift-only',
            checkIn: '2026-07-08T18:00:00+07:00',
            checkOut: '2026-07-08T19:30:00+07:00',
            isAdminEdited: true
        }],
        staffId,
        '2026-07-08',
        user
    );

    assert.equal(chips.length, 2);
    assert.equal(chips.filter(chip => chip.paidMinutes > 0).length, 1);
    const workedChip = chips.find(chip => chip.paidMinutes > 0);
    assert.equal(workedChip.paidMinutes, 90);
    assert.match(workedChip.text, /\(K1\)/);
    assert.doesNotMatch(workedChip.text, /K1 \+ K2/);
    assert.match(chips.find(chip => chip.paidMinutes === 0).text, /19:30–21:00.*\(V\)/);
}

{
    // Hai yêu cầu chấm bù được duyệt thành hai session riêng vẫn phải cộng đủ
    // ba giờ của chuỗi ca, không chỉ lấy 1,5 giờ từ session đầu.
    const consecutiveSchedule = {
        evening1: [{
            start: '18:00',
            end: '19:30',
            lop: 'E8',
            lopId: 'subject-e8',
            gvId: staffId,
            registeredTeachers: [],
            _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-25',
            _originalIndex: 0
        }],
        evening2: [{
            start: '19:30',
            end: '21:00',
            lop: 'PRE-I1',
            lopId: 'subject-pre',
            gvId: staffId,
            registeredTeachers: [],
            _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-25',
            _originalIndex: 0
        }]
    };
    const chips = context.window.calculateDailyChips(
        consecutiveSchedule,
        [
            {
                id: 'makeup-evening-1',
                checkIn: '2026-07-25T18:00:00+07:00',
                checkOut: '2026-07-25T19:30:00+07:00',
                isAdminEdited: true,
                type: 'makeup'
            },
            {
                id: 'makeup-evening-2',
                checkIn: '2026-07-25T19:30:00+07:00',
                checkOut: '2026-07-25T21:00:00+07:00',
                isAdminEdited: true,
                type: 'makeup'
            }
        ],
        staffId,
        '2026-07-25',
        user
    );

    assert.equal(chips.length, 1);
    assert.equal(chips[0].paidMinutes, 180);
    assert.match(chips[0].text, /18:00–21:00/);
}

{
    // Quy tắc dữ liệu cũ: ca quá khứ có check-in nhưng thiếu checkout được tự
    // khép theo toàn bộ chuỗi ca liền kề.
    const consecutiveSchedule = {
        evening1: [{
            start: '18:00',
            end: '19:30',
            lop: 'K1',
            gvId: staffId,
            registeredTeachers: [],
            _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-08',
            _originalIndex: 0
        }],
        evening2: [{
            start: '19:30',
            end: '21:00',
            lop: 'K2',
            gvId: staffId,
            registeredTeachers: [],
            _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-08',
            _originalIndex: 0
        }]
    };
    const chips = context.window.calculateDailyChips(
        consecutiveSchedule,
        [{
            id: 'past-open-session',
            checkIn: '2026-07-08T18:00:00+07:00'
        }],
        staffId,
        '2026-07-08',
        user
    );

    assert.equal(chips.length, 1);
    assert.equal(chips[0].paidMinutes, 180);
}

{
    // Một phiên 15:30–21:00 đã dùng cho ca 15:30–17:00 không được tiếp tục
    // che mất trạng thái vắng của hai ca tối sau khoảng nghỉ 17:00–18:00.
    const separatedSchedule = {
        afternoon1: [{
            start: '15:30',
            end: '17:00',
            lop: 'PRE-I1',
            lopId: 'subject-pre',
            gvId: staffId,
            registeredTeachers: [],
            _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-25',
            _originalIndex: 0
        }],
        evening1: [{
            start: '18:00',
            end: '19:30',
            lop: 'E8',
            lopId: 'subject-e8',
            gvId: staffId,
            registeredTeachers: [],
            _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-25',
            _originalIndex: 0
        }],
        evening2: [{
            start: '19:30',
            end: '21:00',
            lop: 'PRE-I1',
            lopId: 'subject-pre',
            gvId: staffId,
            registeredTeachers: [],
            _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-25',
            _originalIndex: 0
        }]
    };
    const chips = context.window.calculateDailyChips(
        separatedSchedule,
        [{
            id: 'long-session-owned-by-afternoon',
            checkIn: '2026-07-25T15:30:00+07:00',
            checkOut: '2026-07-25T21:00:00+07:00'
        }],
        staffId,
        '2026-07-25',
        user
    );

    assert.equal(chips.length, 2);
    assert.equal(chips.filter(chip => chip.paidMinutes > 0).length, 1);
    assert.ok(chips.some(chip => chip.paidMinutes === 0 && /\(V\)/.test(chip.text)));
}

{
    const shifts = [
        { start: '07:30', end: '09:00' },
        { start: '15:30', end: '17:00' },
        { start: '18:00', end: '19:30' },
        { start: '19:30', end: '21:00' }
    ];
    const coverage = context.window.matchScheduledShiftCoverage(
        shifts,
        [
            {
                id: 'morning',
                checkIn: '2026-07-25T07:30:00+07:00',
                checkOut: '2026-07-25T09:00:00+07:00'
            },
            {
                id: 'long-afternoon',
                checkIn: '2026-07-25T15:30:00+07:00',
                checkOut: '2026-07-25T21:00:00+07:00'
            }
        ],
        '2026-07-25'
    );
    assert.deepEqual(Array.from(coverage), [true, true, false, false]);
}

{
    // Một phiên bắt đầu đúng ca tối và chạy xuyên hai ca LIỀN KỀ vẫn tính đủ cả hai.
    const coverage = context.window.matchScheduledShiftCoverage(
        [
            { start: '18:00', end: '19:30' },
            { start: '19:30', end: '21:00' }
        ],
        [{
            id: 'full-evening-chain',
            checkIn: '2026-07-25T18:00:00+07:00',
            checkOut: '2026-07-25T21:00:00+07:00'
        }],
        '2026-07-25'
    );
    assert.deepEqual(Array.from(coverage), [true, true]);
}

{
    // LỖI ẢNH 1: phiên đã được chip ca DẠY dùng rồi bị sinh thêm chip "Ca Ngoài Lịch"
    // màu cam "10:24–???" (do cờ autoClosedReason + yêu cầu tăng ca đang chờ duyệt).
    // Nhân viên vừa được ghi nhận ĐÚNG lại vừa thấy một dòng cảnh báo SAI cùng một ca.
    const recepUser = {
        roles: ['teaching_assistant', 'tiep-tan'],
        salary_config: { roles: [{ id: 'subject-math', name: 'Toán dự thính', rate: 100000 }] }
    };
    const chips = context.window.calculateDailyChips(
        schedule,
        [{
            id: 'auto-closed',
            checkIn: '2026-07-14T07:24:00+07:00',
            checkOut: '2026-07-14T09:00:00+07:00',
            autoClosedReason: 'stale_session'
        }],
        staffId,
        dateKey,
        recepUser,
        [],
        { 'auto-closed': { id: 'ot1', status: 'pending' } }
    );
    assert.equal(chips.length, 1, 'chỉ còn 1 chip — không sinh bản sao "Ca Ngoài Lịch"');
    assert.doesNotMatch(chips[0].text, /–\?\?\?/, 'không hiện giờ ra "???" khi ca đã tự đóng đúng giờ');
    assert.equal(chips[0].isTeaching, true);
}

{
    // YÊU CẦU KHÁCH (ảnh 2/3): ngày vừa trực tiếp tân vừa dạy — chỉ bấm VÀO CA 1 lần.
    // Ca trực 07:00–11:00, lớp dạy 07:30–09:00 → dạy 1h30, tiếp tân 2h30, và ngày làm
    // được cắt thành 3 khúc để admin sửa từng phần.
    const mixedUser = {
        roles: ['teaching_assistant', 'tiep-tan'],
        salary_config: {
            roles: [{ id: 'subject-math', name: 'Toán 6', rate: 100000 }],
            receptionist_normal_rate: 30000
        }
    };
    const mixedSchedule = {
        morning1: [{
            start: '07:30', end: '09:00', lop: 'Toán 6', lopId: 'subject-math',
            gvId: staffId, registeredTeachers: [],
            _branch: 'cs1', _compositeKey: 'cs1__2026-07-14', _originalIndex: 0
        }]
    };
    const chips = context.window.calculateDailyChips(
        mixedSchedule,
        [{
            id: 'one-checkin',
            checkIn: '2026-07-14T07:00:00+07:00',
            checkOut: '2026-07-14T11:00:00+07:00'
        }],
        staffId,
        dateKey,
        mixedUser,
        [{ shift: 'morning', label: 'SÁNG', start: '07:00', end: '11:00', branch: 'cs1' }]
    );

    const teach = chips.find(c => c.isTeaching && c.paidMinutes > 0);
    const recep = chips.find(c => c.isReceptionist && c.paidMinutes > 0);
    assert.ok(teach && recep, 'phải có cả chip dạy lẫn chip tiếp tân');
    assert.equal(teach.paidMinutes, 90, 'dạy 1h30');
    assert.equal(recep.paidMinutes, 150, 'tiếp tân 2h30 (4h − 1h30 dạy)');

    const segs = recep.daySegments;
    assert.equal(segs.length, 3, 'ngày làm được cắt thành 3 khúc');
    assert.equal(
        segs.map(s => s.start + '-' + s.end + '/' + s.kind).join(' | '),
        '07:00-07:30/tiep-tan | 07:30-09:00/day | 09:00-11:00/tiep-tan'
    );
    assert.match(recep.text, /−1h30p dạy/, 'chip ghi rõ đã trừ giờ dạy');
    // chip ca dạy cũng thấy được bảng chia khúc để mở cùng ô chi tiết
    assert.equal(teach.daySegments.length, 3);
}

{
    // LỖI ẢNH 5: ca vắng phải ghi rõ LỚP. Nếu lịch chưa điền lớp thì phải nói thẳng.
    const noSubjectSchedule = {
        morning1: [{
            start: '09:15', end: '10:45', lop: '', lopId: '',
            gvId: staffId, registeredTeachers: [],
            _branch: 'cs1', _compositeKey: 'cs1__2026-07-14', _originalIndex: 0
        }],
        morning2: [{
            start: '14:30', end: '16:00', lop: 'Toán 6', lopId: 'subject-math',
            gvId: staffId, registeredTeachers: [],
            _branch: 'cs1', _compositeKey: 'cs1__2026-07-14', _originalIndex: 0
        }]
    };
    const chips = context.window.calculateDailyChips(
        noSubjectSchedule, [], staffId, dateKey, user
    );
    const noSub = chips.find(c => c.text.includes('09:15'));
    const withSub = chips.find(c => c.text.includes('14:30'));
    assert.match(noSub.text, /CHƯA CHỌN LỚP/, 'ca thiếu lớp được nêu rõ trên bảng công');
    assert.equal(noSub.missingSubject, true);
    assert.match(withSub.text, /\(Toán 6\).*\(V\)/, 'ca vắng có lớp thì hiện tên lớp');
}

console.log('evaluation-service regression tests passed');
