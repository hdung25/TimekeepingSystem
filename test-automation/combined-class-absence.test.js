// Lớp gộp (yêu cầu 07/10/2026): Uyên Vy dạy EMNGT + UP 2 cùng 18:00–19:30 P03. Ghi VĐX ở EMNGT
// thì UP 2 cũng là VĐX; Bảng Công chỉ hiện 1 chip vắng ghi đủ 2 lớp và đếm 1 ca.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const TeacherShiftState = require('../js/teacher-shift-state.js');
const ShiftAbsenceState = require('../js/shift-absence-state.js');

const VY = { id: 'nv_vy', name: 'Nguyễn Huỳnh Uyên Vy' };
const MY = { id: 'nv_my', name: 'Võ Quang Mỹ' };
const SUB = { id: 'nv_sub', name: 'GV thay' };
const actor = { id: 'nv_admin', name: 'Kiều Diễm' };
const dateKey = '2026-09-22';
const row = (lop, extra = {}) => ({ shiftId: `shift-${lop}`, start: '18:00', end: '19:30', lop, phong: 'P03',
    gvList: [VY], gvId: VY.id, gv: VY.name, teacherAbsences: [], teacherAbsenceHistory: [], gvThayTeList: [], ...extra });

const emngt = TeacherShiftState.applyStaffingCommand(row('EMNGT'), {
    mains: [VY], statuses: { [VY.id]: { type: 'VDX' } }, substitutes: []
}, actor, '2026-10-07T16:14:27.720Z');
const up2 = row('UP 2');

// 1. Lệnh đồng bộ cho lớp gộp.
{
    const command = TeacherShiftState.buildCombinedClassAbsenceCommand(up2, VY.id, emngt);
    assert.equal(command.statuses[VY.id].type, 'VDX');
    const synced = TeacherShiftState.applyStaffingCommand(up2, command, actor, '2026-10-08T00:00:00.000Z');
    assert.equal(synced.teacherAbsences[0].type, 'VDX');
    assert.equal(TeacherShiftState.buildCombinedClassAbsenceCommand(synced, VY.id, emngt), null, 'đã khớp thì không ghi lại');
    // GV thay ở lớp nguồn được xếp luôn cho lớp gộp.
    const covered = TeacherShiftState.applyStaffingCommand(emngt, {
        mains: [VY], statuses: { [VY.id]: { type: 'VDX' } }, substitutes: [{ ...SUB, replacesTeacherIds: [VY.id] }]
    }, actor, '2026-10-08T00:01:00.000Z');
    const cmd2 = TeacherShiftState.buildCombinedClassAbsenceCommand(synced, VY.id, covered);
    const synced2 = TeacherShiftState.applyStaffingCommand(synced, cmd2, actor, '2026-10-08T00:02:00.000Z');
    assert.deepEqual(synced2.gvThayTeList.map(item => item.id), [SUB.id]);
    // Hủy vắng ở lớp nguồn → lớp gộp cũng về Đang dạy và bỏ GV thay của Vy.
    const back = TeacherShiftState.applyStaffingCommand(covered, { mains: [VY], statuses: { [VY.id]: { type: 'ACTIVE' } }, substitutes: [] }, actor, '2026-10-08T00:03:00.000Z');
    const synced3 = TeacherShiftState.applyStaffingCommand(synced2, TeacherShiftState.buildCombinedClassAbsenceCommand(synced2, VY.id, back), actor, '2026-10-08T00:04:00.000Z');
    assert.equal(synced3.teacherAbsences.length, 0);
    assert.equal(synced3.gvThayTeList.length, 0);
    // Không phải GV chính lớp kia → không đụng tới.
    assert.equal(TeacherShiftState.buildCombinedClassAbsenceCommand(row('TV2', { gvList: [MY], gvId: MY.id, gv: MY.name }), VY.id, emngt), null);
}

// 2. Bảng Công: dữ liệu cũ (chỉ EMNGT có VĐX) → 1 chip VĐX "EMNGT + UP 2", không còn (V).
{
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'evaluation-service.js'), 'utf8');
    const ids = (cls, lists, singles) => new Set([...lists.flatMap(key => (cls[key] || []).map(item => item.id)), ...singles.map(key => cls[key]).filter(Boolean)]);
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
    const meta = (r, i) => ({ ...r, _branch: 'cs2', _compositeKey: `cs2__${dateKey}`, _originalIndex: i });
    const user = { roles: ['teaching_assistant'], salary_config: { roles: [] } };
    for (const order of [[emngt, up2], [up2, emngt]]) {
        const schedule = { evening1: order.map(meta) };
        const chips = context.window.calculateDailyChips(schedule, [], VY.id, dateKey, user);
        assert.equal(chips.length, 1, JSON.stringify(chips.map(c => c.text)));
        assert.match(chips[0].text, /^VĐX: (EMNGT \+ UP 2|UP 2 \+ EMNGT) 18:00–19:30/);
        assert.equal(chips[0].isVDX, true);
    }
    // Cả 2 lớp đều đã ghi VĐX → vẫn chỉ 1 chip (không trừ chuyên cần 2 lần).
    const both = TeacherShiftState.applyStaffingCommand(up2, TeacherShiftState.buildCombinedClassAbsenceCommand(up2, VY.id, emngt), actor, '2026-10-08T00:00:00.000Z');
    const chips = context.window.calculateDailyChips({ evening1: [meta(emngt, 0), meta(both, 1)] }, [], VY.id, dateKey, user);
    assert.equal(chips.length, 1);
    assert.match(chips[0].text, /EMNGT \+ UP 2/);
    // Có chấm công → đi dạy bình thường, không có chip vắng.
    const worked = context.window.calculateDailyChips({ evening1: [meta(emngt, 0), meta(up2, 1)] },
        [{ id: 's1', checkIn: `${dateKey}T10:58:00.000Z`, checkOut: `${dateKey}T12:31:00.000Z` }], VY.id, dateKey, user);
    assert.ok(!worked.some(chip => chip.isAbsence), JSON.stringify(worked.map(c => c.text)));
}

assert.equal(
    fs.readFileSync(path.join(__dirname, '..', 'functions', 'shared', 'teacher-shift-state.js'), 'utf8').replace(/\r\n/g, '\n'),
    fs.readFileSync(path.join(__dirname, '..', 'js', 'teacher-shift-state.js'), 'utf8').replace(/\r\n/g, '\n'));
console.log('combined-class-absence.test.js: all assertions passed');
