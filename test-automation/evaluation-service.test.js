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
    // Trang xếp lịch ghi danh sách GV thay thế ở gvThayTeList (bản mới) hoặc gvThayTheList
    // (bản cũ) — db-service đọc CẢ HAI. Stub phải giống hệt, nếu không test dựng dữ liệu
    // theo tên trường thật lại lặng lẽ không nhận ra GV dạy thay.
    isScheduledSubstitute: (cls, id) =>
        cls.gvThayTheId === id || cls.gvThayTeId === id ||
        (cls.gvThayTheList || []).some(g => g.id === id) ||
        (cls.gvThayTeList || []).some(g => g.id === id),
    hasScheduledSubstitute: cls =>
        !!cls.gvThayTheId || !!cls.gvThayTeId ||
        (cls.gvThayTheList || []).length > 0 || (cls.gvThayTeList || []).length > 0
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
    assert.equal(chips[0].class, 'chip-orange');
    assert.match(chips[0].text, /\(T3p\)/, 'admin-edited phải báo trễ theo lịch');
    assert.equal(chips[0].paidMinutes, 87); // 07:33–09:00 đủ theo giờ admin
}

{
    // Ca admin sửa môn: lịch cũ là Nhảy nhưng phiên đã chọn BTH thì bảng lương
    // phải gom theo BTH, không được đẩy giờ sang dòng Nhảy.
    const editedSubjectSchedule = {
        afternoon2: [{
            start: '14:30',
            end: '16:30',
            lop: 'Nhảy',
            lopId: 'subject-jump',
            gvId: staffId,
            registeredTeachers: [],
            _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-14',
            _originalIndex: 0
        }]
    };
    const editedSubjectChips = context.window.calculateDailyChips(
        editedSubjectSchedule,
        [{
            id: 'admin-selected-bth',
            checkIn: '2026-07-14T14:30:00',
            checkOut: '2026-07-14T16:30:00',
            isAdminEdited: true,
            role: 'subject-bth',
            roleName: 'BTH',
            roleRate: 0,
            linkedClassStart: '14:30'
        }],
        staffId,
        dateKey,
        user
    );
    assert.equal(editedSubjectChips.length, 1);
    assert.equal(editedSubjectChips[0].chipFilterName, 'Bth');
    assert.match(editedSubjectChips[0].text, /\(BTH\)/);
    assert.equal(editedSubjectChips[0].paidMinutes, 120);
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
    assert.equal(chips[0].paidMinutes, 85); // 90p theo lịch − 5p ghi nhận tay
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
    // QUY TẮC GIÁM ĐỐC (06/08/2026): CHẤM CÔNG LÀ SỰ THẬT.
    // "Các ghi nhận ca thực tế tốt hơn nhiều so với ghi chú, vì ca thực tế do chính nhân
    // viên chấm công." Nên một phiên 15:30–21:00 đã dùng cho ca 15:30–17:00 VẪN được dùng
    // tiếp cho các ca tối 18:00–21:00: người ta có mặt suốt khoảng đó, không được báo Vắng
    // và cắt công. (Trước đây quy tắc ngược lại — phiên dùng rồi là khoá — nên thầy Quân
    // ngày 04/08 bị mất 1h30 và bị in chip Vắng cho ca tối mà thầy có dạy.)
    // Chống tính hai lần vẫn còn nguyên: chỉ chặn khi ca mới CHỒNG khung giờ đã tính.
    // Phiên chạy dài vô lý cũng không còn sinh ra nữa vì mốc tự ra ca đã cắt theo mạch
    // làm việc liền nhau — xem auto-checkout.test.js.
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

    // Ca chiều 15:30–17:00 (90p) + chuỗi ca tối 18:00–21:00 (180p) đều được tính.
    assert.equal(chips.length, 2, 'hai chip: ca chiều và chuỗi ca tối');
    assert.equal(chips.filter(chip => chip.paidMinutes > 0).length, 2,
        'cả hai ca đều được tính công vì phiên chấm công phủ suốt');
    assert.ok(!chips.some(chip => /\(V\)/.test(chip.text)),
        'không được in chip Vắng khi nhân viên đang có mặt theo chấm công');
    assert.equal(chips.reduce((sum, c) => sum + c.paidMinutes, 0), 90 + 180);
}

{
    // CA THẬT 04/08 của thầy Vũ Lê Anh Quân: vào ca MỘT LẦN 14:52–21:02, phủ cả lớp
    // Tin Học 15:00–16:30 (dạy thay thầy Dũng) lẫn chuỗi 18:00–21:00. Cả hai phải được
    // tính; không ca nào bị báo Vắng.
    const QUAN = staffId;
    const day = '2026-07-14';
    const mk = (start, end, lop, extra) => Object.assign({
        start, end, lop, lopId: 'sub-' + lop, registeredTeachers: [],
        _branch: 'cs1', _compositeKey: 'cs1__' + day, _originalIndex: 0
    }, extra || {});
    const sched = {
        afternoon2: [mk('15:00', '16:30', 'Tin Học', { gvId: 'gv-dung', gvThayTeList: [{ id: QUAN }] })],
        evening1: [mk('18:00', '19:30', 'Mover 4', { gvId: QUAN })],
        evening2: [
            mk('19:30', '21:00', 'E4', { gvId: QUAN, gvThayTeList: [{ id: 'gv-kieumy' }] }),
            mk('19:30', '21:00', 'B1', { gvId: 'gv-nhan', gvThayTeList: [{ id: QUAN }] })
        ]
    };
    const chips = context.window.calculateDailyChips(
        sched,
        [{ id: 'one-checkin', checkIn: `${day}T14:52:00`, checkOut: `${day}T21:02:00` }],
        QUAN, day, user
    );
    const total = chips.reduce((s, c) => s + (c.paidMinutes || 0), 0);
    assert.ok(chips.some(c => c.classStart === '15:00' && c.paidMinutes === 90),
        'lớp dạy thay Tin Học phải được tính 1h30');
    assert.ok(chips.some(c => c.classStart === '18:00' && c.paidMinutes === 180),
        'chuỗi ca tối 18:00–21:00 vẫn được tính đủ 3h');
    assert.ok(!chips.some(c => /\(V\)/.test(c.text)), 'không có ca nào bị báo Vắng');
    assert.equal(total, 90 + 180, 'tổng 4h30 — một lần vào ca, hai khối ca rời nhau');
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
    // REGRESSION: phiên sáng kết thúc sát giờ bắt đầu ca cố định không được
    // chiếm chip chiều. Phiên đúng 13:33 phải được ghép vào ca 13:30–18:00.
    const fixedReception = {
        roles: ['teaching_assistant', 'receptionist'],
        salary_config: { receptionist_normal_rate: 30000 }
    };
    const fixedSchedule = { morning1: [], evening1: [] };
    const fixedSessions = [
        {
            id: 'morning-session',
            checkIn: '2026-07-18T07:30:43+07:00',
            checkOut: '2026-07-18T13:30:10+07:00',
            role: 'tiep-tan', roleName: 'Tiếp Tân'
        },
        {
            id: 'afternoon-session',
            checkIn: '2026-07-18T13:33:15+07:00',
            checkOut: '2026-07-18T18:00:00+07:00'
        }
    ];
    const fixedChips = context.window.calculateDailyChips(
        fixedSchedule,
        fixedSessions,
        staffId,
        '2026-07-18',
        fixedReception,
        [{ shift: 'afternoon', label: 'CHIỀU', start: '13:30', end: '18:00', branch: 'cs1', isFixedShift: true }]
    );
    const afternoonChip = fixedChips.find(c => c.isReceptionist && c.classSectionKey === 'afternoon' && c.sessionId === 'afternoon-session');
    assert.ok(afternoonChip, 'ca cố định phải ghép phiên 13:33 đúng ca');
    assert.equal(afternoonChip.paidMinutes, 267, 'ca chiều tính từ 13:33 đến 18:00');
    assert.ok(!fixedChips.some(c => c.isReceptionist && c.classSectionKey === 'afternoon' && c.sessionId === 'morning-session'), 'không ghép nhầm phiên sáng');
}

{
    // REGRESSION: check-in 13:29 cho chip 13:30 phải tính/hiển thị từ 13:30,
    // nhưng sessionData vẫn giữ giờ thực tế để đối soát.
    const adminReception = {
        roles: ['teaching_assistant', 'tiep-tan'],
        salary_config: { receptionist_normal_rate: 30000 }
    };
    const adminSession = {
        id: 'admin-early',
        isAdminEdited: true,
        checkIn: '2026-07-04T13:29:00+07:00',
        checkOut: '2026-07-04T18:00:00+07:00',
        role: 'tiep-tan', roleName: 'Tiếp Tân'
    };
    const adminChips = context.window.calculateDailyChips(
        {}, [adminSession], staffId, '2026-07-04', adminReception,
        [{ shift: 'afternoon', label: 'CHIỀU', start: '13:30', end: '18:00', branch: 'cs1' }]
    );
    const adminChip = adminChips.find(c => c.isReceptionist && c.sessionId === 'admin-early');
    assert.ok(adminChip, 'ca admin chỉnh tay phải vẫn hiện trên chip');
    assert.match(adminChip.text, /13:30–18:00/, 'chip neo theo giờ bắt đầu 13:30');
    assert.equal(adminChip.paidMinutes, 270, 'không cộng thêm 1 phút vào ca 13:29');
    assert.equal(adminChip.sessionData.checkIn, adminSession.checkIn, 'giữ nguyên giờ thực tế trong dữ liệu');
}

{
    // REGRESSION: tiếp tân và dạy được lưu thành 2 phiên riêng nhưng liền mốc
    // lịch. Hệ thống phải nhận diện cùng một chuỗi ngày làm ở lớp tính toán,
    // không sửa checkOut của phiên tiếp tân và không tính trùng 3 giờ dạy.
    const crossRoleUser = {
        roles: ['teaching_assistant', 'tiep-tan'],
        salary_config: {
            receptionist_normal_rate: 30000,
            roles: [{ id: 'subject-ffs', name: 'FFS01 + Pre-I2', rate: 100000 }]
        }
    };
    const crossRoleSchedule = {
        evening1: [{
            start: '18:00', end: '19:30', lop: 'FFS01', lopId: 'subject-ffs',
            gvId: staffId, registeredTeachers: [], _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-04', _originalIndex: 0
        }],
        evening2: [{
            start: '19:30', end: '21:00', lop: 'Pre-I2', lopId: 'subject-ffs',
            gvId: staffId, registeredTeachers: [], _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-04', _originalIndex: 0
        }]
    };
    const crossRoleSessions = [
        {
            id: 'reception-session', isAdminEdited: true,
            checkIn: '2026-07-04T13:30:00+07:00',
            checkOut: '2026-07-04T18:00:00+07:00',
            role: 'tiep-tan', roleName: 'Tiếp Tân'
        },
        {
            id: 'teaching-session', isAdminEdited: true,
            checkIn: '2026-07-04T18:00:00+07:00',
            checkOut: '2026-07-04T21:00:00+07:00',
            linkedClassStart: '18:00', role: 'subject-ffs', roleName: 'FFS01'
        }
    ];
    const crossRoleChips = context.window.calculateDailyChips(
        crossRoleSchedule,
        crossRoleSessions,
        staffId,
        '2026-07-04',
        crossRoleUser,
        [{ shift: 'afternoon', label: 'CHIỀU', start: '13:30', end: '18:00', branch: 'cs1', isFixedShift: true }]
    );
    const crossRoleRecep = crossRoleChips.find(c => c.isReceptionist && c.sessionId === 'reception-session');
    const crossRoleTeach = crossRoleChips.find(c => c.isTeaching && c.sessionId === 'teaching-session');
    assert.ok(crossRoleRecep, 'phải giữ chip tiếp tân gốc');
    assert.ok(crossRoleTeach, 'phải giữ chip dạy riêng');
    assert.match(crossRoleRecep.text, /13:30–21:00/, 'chip tiếp tân phải hiển thị hết chuỗi liên tục');
    assert.match(crossRoleRecep.text, /−3h dạy/, 'chip tiếp tân phải ghi phần dạy được trừ');
    assert.equal(crossRoleRecep.paidMinutes, 270, 'tiếp tân vẫn chỉ được trả 4h30');
    assert.equal(crossRoleTeach.paidMinutes, 180, 'dạy được trả 3h');
    assert.equal(
        crossRoleRecep.daySegments.map(s => `${s.start}-${s.end}/${s.kind}`).join(' | '),
        '13:30-18:00/tiep-tan | 18:00-21:00/day'
    );
    assert.equal(crossRoleRecep.sessionData.checkOut, crossRoleSessions[0].checkOut, 'không sửa dữ liệu gốc');
    assert.equal(
        crossRoleTeach.daySegments.map(s => `${s.start}-${s.end}/${s.kind}`).join(' | '),
        '13:30-18:00/tiep-tan | 18:00-21:00/day',
        'popup của chip dạy cũng thấy cùng chuỗi'
    );
}

{
    // REGRESSION HUY 04/07: dữ liệu lịch lưu CS1, còn ca tiếp tân lưu cs1.
    // Có hai lớp trùng 18:00 (một lớp hiển thị sau khi khử trùng) và chip
    // 18:00 đã bị xoá, nhưng chip Pre-I2 19:30–21:00 vẫn còn. Khác kiểu chữ
    // ở mã cơ sở không được làm mất chuỗi 13:30–21:00 trên bảng công.
    const huyUser = {
        roles: ['teaching_assistant', 'receptionist'],
        salary_config: {
            receptionist_normal_rate: 30000,
            roles: [{ id: 'subject-ffs', name: 'FFS01', rate: 100000 }, { id: 'subject-pre', name: 'Pre- I2', rate: 100000 }]
        }
    };
    const huySchedule = {
        evening1: [
            { start: '18:00', end: '19:30', lop: 'FFS01', lopId: 'subject-ffs', gvId: staffId, gvThayTheId: staffId, registeredTeachers: [], _branch: 'cs1', _compositeKey: 'cs1__2026-07-04', _originalIndex: 0 },
            { start: '18:00', end: '19:30', lop: 'FFS02', lopId: 'subject-ffs', gvId: staffId, registeredTeachers: [], _branch: 'cs1', _compositeKey: 'cs1__2026-07-04', _originalIndex: 1 }
        ],
        evening2: [{ start: '19:30', end: '21:00', lop: 'Pre- I2', lopId: 'subject-pre', gvId: staffId, registeredTeachers: [], _branch: 'cs1', _compositeKey: 'cs1__2026-07-04', _originalIndex: 0 }]
    };
    const huySessions = [
        { id: 'huy-reception', isAdminEdited: true, checkIn: '2026-07-04T13:30:00+07:00', checkOut: '2026-07-04T18:00:00+07:00', role: 'tiep-tan', roleName: 'Tiếp Tân' },
        { id: 'huy-pre-i2', isAdminEdited: true, checkIn: '2026-07-04T19:30:00+07:00', checkOut: '2026-07-04T21:00:00+07:00', linkedClassStart: '19:30', role: 'subject-pre', roleName: 'PRE-I1' }
    ];
    const huyChips = context.window.calculateDailyChips(
        huySchedule, huySessions, staffId, '2026-07-04', huyUser,
        [{ shift: 'afternoon', label: 'CHIỀU', start: '13:30', end: '18:00', branch: 'cs1', isFixedShift: true }]
    );
    const huyRecep = huyChips.find(c => c.sessionId === 'huy-reception');
    assert.ok(huyRecep, 'phải giữ ca tiếp tân của Huy');
    assert.match(huyRecep.text, /13:30–21:00/, 'ca tiếp tân phải ghép tới hết Pre-I2 dù CS1/cs1 khác kiểu chữ');
    assert.match(huyRecep.text, /−1h30p dạy/, 'chỉ được trừ giờ dạy có phiên chấm công thực tế');
    assert.equal(huyRecep.paidMinutes, 270, 'không được tự trả tiền cho ca dạy thiếu chip');
    assert.equal(
        huyRecep.daySegments.map(s => `${s.start}-${s.end}/${s.kind}`).join(' | '),
        '13:30-18:00/tiep-tan | 18:00-19:30/missing | 19:30-21:00/day',
        'popup phải phân biệt ca chưa chấm thay vì bịa giờ đã làm'
    );
}

{
    // REGRESSION HUY 18/07: một lần chấm 07:30–13:30 vừa phủ lớp 07:30–09:00
    // vừa có vai trò tiếp tân, nhưng lịch không có ca tiếp tân sáng. Chip lớp
    // phải giữ 90 phút; chip tiếp tân ngoài lịch chỉ được còn 09:00–13:30.
    // Không được tạo lại một chip tiếp tân 07:30–13:30 và đếm trùng 90 phút dạy.
    const dualRoleUser = { roles: ['teaching_assistant', 'receptionist'], salary_config: {} };
    const dualRoleSchedule = {
        morning1: [{ start: '07:30', end: '09:00', lop: 'EMN', lopId: 'subject-emn', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }]
    };
    const dualRoleSession = [{
        id: 'huy-long-session', role: 'tiep-tan', roleName: 'Tiếp Tân', roleAssignmentSource: 'manual',
        checkIn: '2026-07-18T07:30:00+07:00', checkOut: '2026-07-18T13:30:00+07:00'
    }];
    const dualRoleChips = context.window.calculateDailyChips(dualRoleSchedule, dualRoleSession, staffId, '2026-07-18', dualRoleUser);
    const morningTeaching = dualRoleChips.find(c => c.isTeaching && c.classStart === '07:30');
    const remainingReception = dualRoleChips.find(c => c.sourceSessionSplit && c.isReceptionist);
    assert.equal(morningTeaching.paidMinutes, 90, 'phần lớp vẫn được tính đúng 90 phút');
    assert.ok(remainingReception, 'phải giữ phần tiếp tân còn lại');
    assert.match(remainingReception.text, /09:00–13:30/, 'chỉ còn phần sau ca dạy là tiếp tân ngoài lịch');
    assert.equal(remainingReception.paidMinutes, 270, 'không được tính trùng 90 phút lớp');
    assert.ok(!dualRoleChips.some(c => c.sourceSessionSplit && /07:30–13:30/.test(c.text)), 'không được tạo chip toàn phiên đã gồm giờ dạy');
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

{
    // LỖI ẢNH ZALO (ngày 26): phiên bị neo vào một giờ ca KHÔNG CÒN trong lịch
    // (admin sửa lịch / duyệt chấm bù sai giờ) thì mọi vòng ghép đều từ chối nó →
    // ca dạy biến mất, chỉ còn chip tím "(Role?)" và tổng giờ hụt.
    // GV dạy nhiều môn → không có "môn duy nhất" để đoán vai trò, đúng như GV thật.
    const multiRoleUser = {
        roles: ['teaching_assistant'],
        salary_config: {
            roles: [
                { id: 'subject-math', name: 'Toán dự thính', rate: 100000 },
                { id: 'subject-english', name: 'Tiếng Anh', rate: 120000 }
            ]
        }
    };
    const staleSession = {
        id: 'sess-stale-link',
        checkIn: `${dateKey}T07:28:00`,
        checkOut: `${dateKey}T09:02:00`,
        linkedClassStart: '07:20' // lịch cũ; ca thật trong lịch bắt đầu 07:30
    };
    const chips = context.window.calculateDailyChips(
        schedule, [staleSession], staffId, dateKey, multiRoleUser
    );
    // Chip ca dạy thật luôn mang classStart/classEnd của ô lịch; chip "ca ngoài lịch" thì không.
    const teach = chips.find(c => c.classStart === '07:30' && c.classEnd === '09:00');
    assert.ok(teach, 'neo mồ côi không được làm mất chip ca dạy');
    assert.equal(teach.paidMinutes, 90, 'ca dạy vẫn tính đủ 1h30 theo lịch');
    assert.match(teach.text, /Toán dự thính/, 'chip hiện đúng môn thay vì (Role?)');
    assert.ok(
        !chips.some(c => /Role\?/.test(c.text)),
        'không còn rơi xuống chip tím (Role?)'
    );

    // Neo CÒN hiệu lực vẫn phải được tôn trọng như cũ.
    const liveChips = context.window.calculateDailyChips(
        schedule,
        [{ ...staleSession, id: 'sess-live-link', linkedClassStart: '07:30' }],
        staffId, dateKey, multiRoleUser
    );
    assert.ok(
        liveChips.find(c => c.classStart === '07:30' && c.paidMinutes === 90),
        'neo đúng giờ vẫn ghép được ca dạy'
    );
}

{
    // Ca admin thêm/chấm bù bị gõ NGƯỢC giờ (vào 15:30, ra 15:16) trước đây in nhãn
    // "15:30–15:16" khiến người xem tưởng phần mềm lỗi. Nay phải nói thẳng lý do.
    const reversed = {
        id: 'sess-reversed',
        type: 'admin_add',
        isAdminEdited: true,
        checkIn: `${dateKey}T15:30:00`,
        checkOut: `${dateKey}T15:16:00`
    };
    const chip = chipsFor(reversed).find(c => c.sessionId === 'sess-reversed');
    assert.ok(chip, 'ca giờ ngược vẫn phải hiện để admin sửa');
    assert.match(chip.text, /Giờ ra ≤ giờ vào/, 'chip nêu rõ dữ liệu giờ bị sai');
    assert.equal(chip.paidMinutes, 0, 'không tính phút cho ca giờ ngược');
}

{
    // LỖI BẢNG LƯƠNG NGÀY 11 (Bùi Như Quỳnh): GV dạy 2 lớp CÙNG KHUNG GIỜ 09:15–10:45.
    // Hai phiên ngoài lịch cùng khung giờ, mỗi phiên tính đủ 1h30 → tổng ngày 4h40 thay
    // vì 3h10. Một khung giờ chỉ được trả công MỘT lần.
    const twoClassSchedule = {
        morning1: [{
            start: '07:30', end: '09:00', lop: 'E3 + E4', lopId: 'subject-math',
            gvId: staffId, registeredTeachers: [],
            _branch: 'cs1', _compositeKey: 'cs1__2026-07-14', _originalIndex: 0
        }],
        // Ô lịch 09:15 xếp cho GV khác (hoặc GV này đã bị gỡ khỏi ca) nên hai phiên chấm
        // công 09:15 không ghép được vào ca nào — đúng như bảng lương thật: hai chip tím.
        morning2: [{
            start: '09:15', end: '10:45', lop: 'E1 + EMNGT', lopId: 'subject-english',
            gvId: 'teacher-khac', registeredTeachers: [],
            _branch: 'cs1', _compositeKey: 'cs1__2026-07-14', _originalIndex: 1
        }]
    };
    const multiRoleUser = {
        roles: ['teaching_assistant'],
        salary_config: {
            roles: [
                { id: 'subject-math', name: 'Toán', rate: 100000 },
                { id: 'subject-english', name: 'Tiếng Anh', rate: 120000 }
            ]
        }
    };
    // Ca 07:30 khớp lịch; hai ca 09:15 là ca admin thêm tay (mỗi lớp một ca).
    const sessions = [
        { id: 'sess-morning', checkIn: `${dateKey}T07:28:00`, checkOut: `${dateKey}T09:00:00` },
        { id: 'sess-dup-a', type: 'admin_add', isAdminEdited: true,
          checkIn: `${dateKey}T09:15:00`, checkOut: `${dateKey}T10:45:00` },
        { id: 'sess-dup-b', type: 'admin_add', isAdminEdited: true,
          checkIn: `${dateKey}T09:15:00`, checkOut: `${dateKey}T10:45:00`, bonus10: true }
    ];
    const chips = context.window.calculateDailyChips(
        twoClassSchedule, sessions, staffId, dateKey, multiRoleUser
    );
    const total = chips.reduce((sum, c) => sum + (c.paidMinutes || 0), 0);
    assert.equal(total, 90 + 90, 'cả ngày chỉ tính 1h30 + 1h30 = 3h0p, không cộng đôi ca trùng giờ');

    const dupChip = chips.find(c => /trùng giờ/.test(c.text));
    assert.ok(dupChip, 'ca bị trùng khung giờ phải được ghi rõ trên chip');
    assert.equal(dupChip.paidMinutes, 0, 'ca trùng giờ không tính phút');
    assert.ok(!/\+10p/.test(dupChip.text), 'ca trùng giờ cũng không được cộng thưởng 10p');

    // Ngày bình thường (2 lớp NỐI TIẾP nhau, không chồng giờ) vẫn phải tính đủ cả hai.
    const backToBack = [
        { id: 'sess-a', type: 'admin_add', isAdminEdited: true,
          checkIn: `${dateKey}T07:30:00`, checkOut: `${dateKey}T09:00:00` },
        { id: 'sess-b', type: 'admin_add', isAdminEdited: true,
          checkIn: `${dateKey}T09:15:00`, checkOut: `${dateKey}T10:45:00` }
    ];
    const okChips = context.window.calculateDailyChips(
        twoClassSchedule, backToBack, staffId, dateKey, multiRoleUser
    );
    assert.equal(
        okChips.reduce((sum, c) => sum + (c.paidMinutes || 0), 0), 180,
        'hai ca khác khung giờ vẫn tính đủ 3h'
    );
}

{
    // Partial cross-role chain: the first teaching attendance segment is
    // missing, but a later real teaching session remains. The receptionist
    // label may follow the continuous schedule; payroll may use real minutes
    // only and must never invent the missing segment.
    const partialUser = {
        roles: ['teaching_assistant', 'tiep-tan'],
        salary_config: { receptionist_normal_rate: 30000 }
    };
    const partialSchedule = {
        evening1: [{
            start: '18:00', end: '19:30', lop: 'FFS01', lopId: 'subject-ffs',
            gvId: staffId, registeredTeachers: [], _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-04', _originalIndex: 0
        }],
        evening2: [{
            start: '19:30', end: '21:00', lop: 'Pre-I2', lopId: 'subject-ffs',
            gvId: staffId, registeredTeachers: [], _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-04', _originalIndex: 0
        }]
    };
    const partialSessions = [
        {
            id: 'partial-reception-session', isAdminEdited: true,
            checkIn: '2026-07-04T13:30:00+07:00',
            checkOut: '2026-07-04T18:00:00+07:00',
            role: 'tiep-tan', roleName: 'Tiếp Tân'
        },
        {
            id: 'partial-teaching-session', isAdminEdited: true,
            checkIn: '2026-07-04T19:30:00+07:00',
            checkOut: '2026-07-04T21:00:00+07:00',
            linkedClassStart: '19:30', role: 'subject-ffs', roleName: 'Pre-I2'
        }
    ];
    const partialChips = context.window.calculateDailyChips(
        partialSchedule,
        partialSessions,
        staffId,
        '2026-07-04',
        partialUser,
        [{ shift: 'afternoon', label: 'CHIỀU', start: '13:30', end: '18:00', branch: 'cs1', isFixedShift: true }]
    );
    const partialRecep = partialChips.find(c => c.isReceptionist && c.sessionId === 'partial-reception-session');
    assert.ok(partialRecep, 'partial chain must keep the receptionist chip');
    assert.ok(partialRecep.text.includes('13:30') && partialRecep.text.includes('21:00'), 'display must reach the scheduled chain end');
    assert.ok(partialRecep.text.includes('1h30p'), 'only the real teaching segment is subtracted');
    assert.equal(partialRecep.paidMinutes, 270, 'missing teaching attendance must not create paid minutes');
    assert.ok(partialRecep.tooltip.includes('không tính lương'), 'tooltip must disclose the missing attendance segment');
    assert.equal(partialRecep.sessionData.checkOut, partialSessions[0].checkOut, 'source checkout must remain unchanged');
}

{
    // Real-shaped regression: Quang Huy on 04/07 has a receptionist session
    // ending at 18:00, no 18:00 teaching attendance, and a later 19:30
    // teaching session.  The schedule is still the authoritative source for
    // its linked class label.  No missing attendance may become paid time.
    const huyUser = {
        roles: ['teaching_assistant', 'receptionist'],
        salary_config: { receptionist_normal_rate: 30000 }
    };
    const huySchedule = {
        evening1: [
            {
                start: '18:00', end: '19:30', lop: 'FFS01', lopId: '',
                gvId: staffId, registeredTeachers: [], _branch: 'cs1',
                _compositeKey: 'cs1__2026-07-04', _originalIndex: 5
            },
            {
                start: '18:00', end: '19:30', lop: 'FFS02', lopId: '',
                gvId: staffId, registeredTeachers: [], _branch: 'cs1',
                _compositeKey: 'cs1__2026-07-04', _originalIndex: 10
            }
        ],
        evening2: [{
            start: '19:30', end: '21:00', lop: 'Pre- I2', lopId: '',
            gvId: staffId, registeredTeachers: [], _branch: 'cs1',
            _compositeKey: 'cs1__2026-07-04', _originalIndex: 1
        }]
    };
    const huySessions = [
        {
            id: '1786262573380', type: 'admin_add', isAdminEdited: true,
            checkIn: '2026-07-04T06:30:00.000Z', start: '2026-07-04T06:30:00.000Z',
            checkOut: '2026-07-04T11:00:00.000Z', role: 'tiep-tan', roleName: 'Tiếp Tân'
        },
        {
            id: '1786264786867', type: 'admin_add', isAdminEdited: true,
            checkIn: '2026-07-04T12:30:00.000Z', start: '2026-07-04T12:30:00.000Z',
            checkOut: '2026-07-04T14:00:00.000Z', linkedClassStart: '19:30',
            role: 't1ajt5FjkjvYAe1lUThH', roleName: 'PRE-I1'
        }
    ];
    const huyChips = context.window.calculateDailyChips(
        huySchedule, huySessions, staffId, '2026-07-04', huyUser,
        [{ shift: 'afternoon', label: 'CHIỀU', start: '13:30', end: '18:00', branch: 'cs1', isFixedShift: true }]
    );
    const huyRecep = huyChips.find(c => c.isReceptionist && c.sessionId === '1786262573380');
    const huyTeaching = huyChips.find(c => c.isTeaching && c.sessionId === '1786264786867');
    assert.ok(huyRecep.text.includes('13:30') && huyRecep.text.includes('21:00'), 'Huy: receptionist chip must follow the continuous scheduled boundary');
    assert.equal(huyRecep.paidMinutes, 270, 'Huy: only the real 13:30–18:00 receptionist minutes are paid');
    assert.ok(huyRecep.tooltip.includes('chưa có phiên chấm công'), 'Huy: missing 18:00 attendance must be disclosed');
    assert.ok(huyTeaching.text.includes('Pre- I2'), 'Huy: a linked session must display the scheduled class, not a stale role label');
    assert.equal(huyTeaching.chipFilterName, 'Pre- I2', 'Huy: salary grouping must follow the scheduled class when no override exists');
    const huyMissingSegment = huyRecep.daySegments.find(segment => segment.kind === 'missing');
    assert.ok(huyMissingSegment && huyMissingSegment.start === '18:00' && huyMissingSegment.end === '19:30', 'Huy: the unrecorded scheduled slot must stay visible');
    assert.equal(huyMissingSegment.minutes, 0, 'Huy: the unrecorded scheduled slot must not create paid minutes');
}

{
    // REGRESSION HUY 26/07: hai phiên nối nhau đúng mép 15:30. Phiên sáng
    // kết thúc lúc 15:30:03 nên có thể "chạm" ca chiều vài giây, còn phiên
    // thật của ca chiều bắt đầu 15:30:04. Ca 15:30–18:30 phải được gắn cho
    // phiên thứ hai; không được để nó thành một chip Role? trùng với chip dạy.
    const huySplitUser = { roles: ['teaching_assistant', 'receptionist'], salary_config: {} };
    const huySplitSchedule = {
        morning1: [{ start: '07:30', end: '09:00', lop: 'MC', lopId: 'subject-mc', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }],
        afternoon2: [{ start: '15:30', end: '17:00', lop: 'Mover 1', lopId: 'subject-mover', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }],
        evening1: [{ start: '17:00', end: '18:30', lop: 'E5', lopId: 'subject-e5', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }]
    };
    const huySplitSessions = [
        { id: 'huy-morning', checkIn: '2026-07-26T07:29:40+07:00', checkOut: '2026-07-26T15:30:03+07:00' },
        { id: 'huy-afternoon', checkIn: '2026-07-26T15:30:04+07:00', checkOut: '2026-07-26T18:30:00+07:00' }
    ];
    const huySplitChips = context.window.calculateDailyChips(
        huySplitSchedule, huySplitSessions, staffId, '2026-07-26', huySplitUser
    );
    assert.ok(
        huySplitChips.some(c => c.isTeaching && /15:30–18:30/.test(c.text)),
        'Huy: ca chiều phải nhận chip dạy theo lịch'
    );
    assert.ok(
        !huySplitChips.some(c => c.sourceSessionSplit && /15:30–18:30 \(Role\?\)/.test(c.text)),
        'Huy: không được sinh Role? trùng nguyên ca chiều'
    );
    assert.ok(
        !huySplitChips.some(c => c.sourceSessionSplit && /09:00–15:30 \(Role\?\)/.test(c.text)),
        'Huy: phần dư của phiên dùng cho ca dạy phải biến mất hoàn toàn'
    );
}

{
    // Huy 19/07: cùng một phiên thực tế phủ hai lớp nhưng có khoảng trống
    // 15 phút ở giữa. Đây không phải ca mới, không được hiện Role? và cũng
    // không được làm hệ thống hiểu nhầm là tự ra/vào ca.
    const gapUser = { roles: ['teaching_assistant', 'receptionist'], salary_config: {} };
    const gapSchedule = {
        morning1: [{ start: '07:30', end: '09:00', lop: 'E7', lopId: 'subject-e7', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }],
        morning2: [{ start: '09:15', end: '10:45', lop: 'Mover 1', lopId: 'subject-mover', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }]
    };
    const gapChips = context.window.calculateDailyChips(
        gapSchedule,
        [{ id: 'huy-gap', checkIn: '2026-07-19T07:30:00+07:00', checkOut: '2026-07-19T10:45:00+07:00' }],
        staffId, '2026-07-19', gapUser
    );
    assert.ok(!gapChips.some(c => /09:00–09:15 \(Role\?\)/.test(c.text)), 'khoảng nghỉ ngắn giữa hai lớp phải được ẩn');
    assert.equal(
        gapChips.reduce((sum, chip) => sum + (chip.paidMinutes || 0), 0), 180,
        'chỉ cộng hai ca dạy trong lịch, không cộng 15 phút khoảng trống'
    );
}

{
    // Huy 26/07: phần 09:00–15:30 thuộc một phiên vào/ra kéo dài nhưng
    // không có lịch hoặc role. Phải giữ cảnh báo đối soát, song tuyệt đối
    // không làm phồng tổng giờ/lương.
    const unknownRemainderUser = { roles: ['teaching_assistant', 'receptionist'], salary_config: {} };
    const unknownRemainderSchedule = {
        morning1: [{ start: '07:30', end: '09:00', lop: 'MC', lopId: 'subject-mc', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }]
    };
    const unknownRemainderChips = context.window.calculateDailyChips(
        unknownRemainderSchedule,
        [{ id: 'huy-long-unknown', checkIn: '2026-07-26T07:30:00+07:00', checkOut: '2026-07-26T15:30:00+07:00' }],
        staffId, '2026-07-26', unknownRemainderUser
    );
    assert.ok(
        !unknownRemainderChips.some(c => c.sourceSessionSplit && /09:00–15:30 \(Role\?\)/.test(c.text)),
        'phần dư của phiên dạy không được hiện Role?'
    );
    assert.equal(
        unknownRemainderChips.reduce((sum, chip) => sum + (chip.paidMinutes || 0), 0), 90,
        'tổng giờ chỉ còn ca dạy đã xác định'
    );
}

{
    // Ca đã xếp luôn bị chặn trong khung lịch, kể cả giờ admin đã nhập để
    // đối soát lệch vài phút. Đây là hai mẫu 12/07 của Huy: 07:26–09:05 và
    // 15:27–18:32 không được làm tổng thành 4h44 thay vì 4h30.
    const boundedUser = { roles: ['teaching_assistant'], salary_config: {} };
    const boundedSchedule = {
        morning1: [{ start: '07:30', end: '09:00', lop: 'MC', lopId: 'subject-mc', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }],
        afternoon2: [{ start: '15:30', end: '18:30', lop: 'Mover 1 + E5+UP 2', lopId: 'subject-mover', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }]
    };
    const boundedChips = context.window.calculateDailyChips(
        boundedSchedule,
        [
            { id: 'huy-early-late-am', isAdminEdited: true, checkIn: '2026-07-12T07:26:00+07:00', checkOut: '2026-07-12T09:05:00+07:00' },
            { id: 'huy-early-late-pm', isAdminEdited: true, checkIn: '2026-07-12T15:27:00+07:00', checkOut: '2026-07-12T18:32:00+07:00' }
        ],
        staffId, '2026-07-12', boundedUser
    );
    const boundedMorning = boundedChips.find(c => c.isTeaching && /07:30–09:00/.test(c.text));
    const boundedAfternoon = boundedChips.find(c => c.isTeaching && /15:30–18:30/.test(c.text));
    assert.equal(boundedMorning.paidMinutes, 90, 'ca sáng chỉ tính đúng 1h30 theo lịch');
    assert.equal(boundedAfternoon.paidMinutes, 180, 'ca chiều chỉ tính đúng 3h theo lịch');
    assert.equal(boundedChips.reduce((sum, chip) => sum + (chip.paidMinutes || 0), 0), 270, 'tổng hai chip phải là 4h30');
}

{
    // Phiên có role Tiếp Tân do lỗi auto-save cũ nhưng không mang marker chọn
    // tay không được đẻ ra ca ngoài lịch sau khi đã dùng để nhận ca dạy.
    const legacyAutoRoleUser = { roles: ['teaching_assistant', 'receptionist'], salary_config: {} };
    const legacyAutoRoleSchedule = {
        morning1: [{ start: '07:30', end: '09:00', lop: 'EMN', lopId: 'subject-emn', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }]
    };
    const legacyAutoRoleChips = context.window.calculateDailyChips(
        legacyAutoRoleSchedule,
        [{
            id: 'huy-legacy-auto-reception',
            checkIn: '2026-07-18T07:30:00+07:00',
            checkOut: '2026-07-18T13:30:00+07:00',
            role: 'tiep-tan', roleName: 'Tiếp Tân'
        }],
        staffId, '2026-07-18', legacyAutoRoleUser
    );
    assert.ok(!legacyAutoRoleChips.some(c => /Tiếp Tân ngoài lịch/.test(c.text)), 'role tự lưu cũ không được sinh ca tiếp tân ngoài lịch');
    assert.equal(legacyAutoRoleChips.reduce((sum, chip) => sum + (chip.paidMinutes || 0), 0), 90, 'chỉ còn ca dạy đã xếp được tính');
}

{
    // Có chấm công cho 18:00–19:30 nhưng ra lúc 19:17: phải báo về sớm và
    // chuyển cam, không được xanh như đã làm đủ; ca 19:30–21:00 vẫn vắng vì
    // không có lần vào ca/phiên nào bao phủ nó.
    const partialSchedule = {
        evening1: [{ start: '18:00', end: '19:30', lop: 'FFS01', lopId: 'subject-ffs', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }],
        evening2: [{ start: '19:30', end: '21:00', lop: 'Pre- I2', lopId: 'subject-pre', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }]
    };
    const partialChips = context.window.calculateDailyChips(
        partialSchedule,
        [{ id: 'huy-left-early', checkIn: '2026-07-11T17:58:00+07:00', checkOut: '2026-07-11T19:17:00+07:00' }],
        staffId, '2026-07-11', { roles: ['teaching_assistant'], salary_config: {} }
    );
    const partialWorked = partialChips.find(c => c.isTeaching && /18:00–19:30/.test(c.text));
    assert.equal(partialWorked.class, 'chip-orange', 'về sớm phải là chip cam');
    assert.match(partialWorked.text, /\(V13p\)/, 'chip phải ghi rõ số phút về sớm');
    assert.equal(partialWorked.paidMinutes, 77, 'chỉ tính phần thời gian có mặt thực tế');
    assert.ok(partialChips.some(c => /19:30–21:00.*\(V\)/.test(c.text)), 'không được tự bịa lần vào ca cho ca liền sau');
}

{
    // Phiên đã có vai trò dạy do admin chọn là nguồn dữ liệu thủ công có chủ
    // đích. Dù người đó kiêm tiếp tân, hệ thống không được tự tách phần dư ra
    // Role? rồi cộng trùng với chip dạy đã được chọn.
    const explicitTeachingUser = { roles: ['teaching_assistant', 'receptionist'], salary_config: {} };
    const explicitTeachingSchedule = {
        morning1: [{ start: '07:30', end: '09:00', lop: 'MC', lopId: 'subject-mc', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }],
        morning2: [{ start: '09:15', end: '10:45', lop: 'Mover 1', lopId: 'subject-mover', gvId: staffId, registeredTeachers: [], _branch: 'cs1' }]
    };
    const explicitTeachingChips = context.window.calculateDailyChips(
        explicitTeachingSchedule,
        [{
            id: 'manual-subject-whole-session', isAdminEdited: true,
            checkIn: '2026-07-05T07:00:00+07:00', checkOut: '2026-07-05T10:00:00+07:00',
            role: 'subject-mc', roleName: 'MC'
        }],
        staffId, '2026-07-05', explicitTeachingUser
    );
    assert.ok(explicitTeachingChips.some(c => c.isTeaching), 'phiên chọn môn vẫn giữ chip dạy');
    assert.equal(
        explicitTeachingChips.filter(c => c.isTeaching).length, 1,
        'một phiên admin chọn môn không được nhân thành hai chip cho hai hàng lịch rời nhau'
    );
    assert.ok(
        !explicitTeachingChips.some(c => c.sourceSessionSplit),
        'phiên đã chọn môn không được sinh chip Role? phụ làm cộng trùng'
    );
}

console.log('evaluation-service regression tests passed');
