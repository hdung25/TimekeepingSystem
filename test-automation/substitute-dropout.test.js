// GV dạy thay đã nhận ca rồi báo bận (yêu cầu Giám đốc 06/10/2026): Giàu nghỉ → xếp Bảo thay,
// sát ngày Bảo báo bận → đổi sang Hùng. Bảo phải được ghi VP/VĐX đúng ca trong Bảng Công/lương,
// Hùng được tính công dạy thay, Giàu giữ nguyên trạng thái nghỉ của GV chính.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TeacherShiftState = require('../js/teacher-shift-state.js');
const ShiftAbsenceState = require('../js/shift-absence-state.js');

const GIAU = { id: 'nv_giau', name: 'Nguyễn Thị Ngọc Giàu' };
const BAO = { id: 'nv_bao', name: 'Bảo' };
const HUNG = { id: 'nv_hung', name: 'Hùng' };
const actor = { id: 'nv_admin', name: 'Quản lý' };
const dateKey = '2026-10-08';

const baseRow = {
    shiftId: 'shift-e6', start: '18:00', end: '19:30', lop: 'E6', lopId: 'subject-e6',
    gvList: [GIAU], gvId: GIAU.id, gv: GIAU.name, teacherAbsences: [], teacherAbsenceHistory: []
};

// Bước 1: Giàu báo nghỉ (VP), xếp Bảo dạy thay.
const withBao = TeacherShiftState.applyStaffingCommand(baseRow, {
    mains: [GIAU],
    statuses: { [GIAU.id]: { type: 'VP', reportedAt: '2026-10-05T09:00:00.000Z' } },
    substitutes: [{ ...BAO, replacesTeacherIds: [GIAU.id] }]
}, actor, '2026-10-05T09:00:00.000Z');
assert.equal(withBao.substituteAbsences, undefined, 'ca bình thường không sinh trường mới');

// Bước 2: Bảo báo bận sát ngày → ghi VĐX cho Bảo, Hùng dạy thay.
const withHung = TeacherShiftState.applyStaffingCommand(withBao, {
    mains: [GIAU],
    statuses: { [GIAU.id]: { type: 'VP', reportedAt: '2026-10-05T09:00:00.000Z' } },
    substitutes: [{ ...HUNG, replacesTeacherIds: [GIAU.id] }],
    substituteAbsences: [{ id: BAO.id, name: BAO.name, type: 'VDX', replacedTeacherIds: [GIAU.id] }]
}, actor, '2026-10-08T07:00:00.000Z');
{
    assert.deepEqual(withHung.gvThayTeList.map(item => item.id), [HUNG.id]);
    assert.equal(withHung.substituteAbsences.length, 1);
    const record = withHung.substituteAbsences[0];
    assert.equal(record.teacherId, BAO.id);
    assert.equal(record.type, 'VDX');
    assert.equal(record.role, 'substitute');
    assert.deepEqual(record.replacedTeacherIds, [GIAU.id]);
    assert.deepEqual(record.replacementIds, [HUNG.id]);
    assert.equal(withHung.teacherAbsences.length, 1, 'teacherAbsences vẫn chỉ chứa GV chính');
    assert.equal(withHung.teacherAbsences[0].teacherId, GIAU.id);
    assert.deepEqual(withHung.teacherAbsences[0].replacementIds, [HUNG.id]);
    assert.ok(withHung.teacherAbsenceHistory.some(item => item.event === 'substitute_absent' && item.teacherId === BAO.id));
    assert.deepEqual(TeacherShiftState.getReplacementIdsForTeacher(withHung, BAO.id), [HUNG.id]);
}

// Lệnh cũ (không gửi substituteAbsences) giữ nguyên ghi nhận báo bận.
{
    const kept = TeacherShiftState.applyStaffingCommand(withHung, {
        mains: [GIAU],
        statuses: { [GIAU.id]: { type: 'VP' } },
        substitutes: [{ ...HUNG, replacesTeacherIds: [GIAU.id] }]
    }, actor, '2026-10-08T07:05:00.000Z');
    assert.equal(kept.substituteAbsences.length, 1);
    assert.equal(kept.substituteAbsences[0].type, 'VDX');
    // Xếp Bảo dạy lại thì không còn là "báo bận".
    const backAgain = TeacherShiftState.applyStaffingCommand(withHung, {
        mains: [GIAU],
        statuses: { [GIAU.id]: { type: 'VP' } },
        substitutes: [{ ...BAO, replacesTeacherIds: [GIAU.id] }]
    }, actor, '2026-10-08T07:06:00.000Z');
    assert.deepEqual(backAgain.substituteAbsences, []);
    assert.throws(() => TeacherShiftState.applyStaffingCommand(withHung, {
        mains: [GIAU],
        statuses: { [GIAU.id]: { type: 'VP' } },
        substitutes: [{ ...BAO, replacesTeacherIds: [GIAU.id] }],
        substituteAbsences: [{ id: BAO.id, name: BAO.name, type: 'VDX' }]
    }, actor), /đang được xếp dạy/);
    // Danh sách rỗng = hoàn tác báo bận.
    const undone = TeacherShiftState.applyStaffingCommand(withHung, {
        mains: [GIAU],
        statuses: { [GIAU.id]: { type: 'VP' } },
        substitutes: [{ ...HUNG, replacesTeacherIds: [GIAU.id] }],
        substituteAbsences: []
    }, actor, '2026-10-08T07:07:00.000Z');
    assert.deepEqual(undone.substituteAbsences, []);
    assert.ok(undone.teacherAbsenceHistory.some(item => item.event === 'substitute_absence_removed'));
}

// Bộ xác định vắng theo ca.
{
    const resolve = staffId => ShiftAbsenceState.resolveTeachingShift({
        row: withHung, staffId, dateKey, start: '18:00', end: '19:30', shiftId: 'shift-e6', kind: 'gv'
    });
    const bao = resolve(BAO.id);
    assert.equal(bao.isAbsent, true);
    assert.equal(bao.type, 'VDX');
    assert.equal(bao.source, 'teacher-absence');
    assert.equal(ShiftAbsenceState.classifyChipAbsence(ShiftAbsenceState.toChipMetadata(bao)), 'VDX');
    assert.equal(resolve(GIAU.id).type, 'VP', 'GV chính giữ nguyên VP');
    assert.equal(resolve(HUNG.id).isAbsent, false, 'GV thay mới không bị tính vắng');
    assert.equal(resolve('nv_khac').isAbsent, false, 'người không liên quan không bị tính vắng');
}

// Bảng Công: chip VĐX cho Bảo, công dạy thay cho Hùng.
{
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'evaluation-service.js'), 'utf8');
    const ids = (cls, lists, singles) => new Set([
        ...lists.flatMap(key => (cls[key] || []).map(item => item.id)),
        ...singles.map(key => cls[key]).filter(Boolean)
    ]);
    const context = {
        console, Date, Math, Set, Map, Intl,
        window: { centerClosures: {}, getIconHtml: () => '', ShiftAbsenceState, TeacherShiftState },
        TeacherShiftState,
        getLocalDateKey: date => date.toISOString().slice(0, 10),
        isScheduledMainTeacher: (cls, id) => ids(cls, ['gvList'], ['gvId']).has(id),
        isScheduledSubstitute: (cls, id) => ids(cls, ['gvThayTeList', 'gvThayTheList'], ['gvThayTeId', 'gvThayTheId']).has(id),
        hasScheduledSubstitute: cls => ids(cls, ['gvThayTeList', 'gvThayTheList'], ['gvThayTeId', 'gvThayTheId']).size > 0
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    const schedule = { evening1: [{ ...withHung, _branch: 'cs1', _compositeKey: `cs1__${dateKey}`, _originalIndex: 0 }] };
    const user = { roles: ['teaching_assistant'], salary_config: { roles: [{ id: 'subject-e6', name: 'E6', rate: 100000 }] } };

    const baoChips = context.window.calculateDailyChips(schedule, [], BAO.id, dateKey, user);
    assert.equal(baoChips.length, 1, JSON.stringify(baoChips));
    assert.match(baoChips[0].text, /^VĐX: E6 18:00–19:30/);
    assert.equal(baoChips[0].isVDX, true);
    assert.equal(baoChips[0].paidMinutes, 0);
    assert.equal(baoChips[0].isPendingReplacement, false);
    assert.match(baoChips[0].tooltip, /báo bận.*Hùng/);

    // Bảo vẫn đến dạy (có chấm công) → chấm công thắng, không còn chip vắng.
    const worked = context.window.calculateDailyChips(schedule,
        [{ id: 's1', checkIn: `${dateKey}T11:00:00.000Z`, checkOut: `${dateKey}T12:30:00.000Z` }], BAO.id, dateKey, user);
    assert.ok(!worked.some(chip => chip.isVDX), 'đã đi làm thì không còn chip VĐX');

    const hungChips = context.window.calculateDailyChips(schedule,
        [{ id: 's2', checkIn: `${dateKey}T10:55:00.000Z`, checkOut: `${dateKey}T12:30:00.000Z` }], HUNG.id, dateKey, user);
    assert.ok(hungChips.some(chip => chip.isTeaching && chip.paidMinutes > 0), JSON.stringify(hungChips));
    assert.ok(!hungChips.some(chip => chip.isAbsence));

    const giauChips = context.window.calculateDailyChips(schedule, [], GIAU.id, dateKey, user);
    assert.equal(giauChips.length, 1);
    assert.match(giauChips[0].text, /^VP:/);
}

// Bản sao cho Cloud Functions phải giống hệt.
assert.equal(
    fs.readFileSync(path.join(__dirname, '..', 'functions', 'shared', 'teacher-shift-state.js'), 'utf8').replace(/\r\n/g, '\n'),
    fs.readFileSync(path.join(__dirname, '..', 'js', 'teacher-shift-state.js'), 'utf8').replace(/\r\n/g, '\n'));

console.log('substitute-dropout.test.js: all assertions passed');
