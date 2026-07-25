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
    }
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

console.log('evaluation-service regression tests passed');
