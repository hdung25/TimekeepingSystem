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

console.log('evaluation-service late-minute tests passed');
