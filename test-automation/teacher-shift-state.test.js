const assert = require('node:assert/strict');
const state = require('../js/teacher-shift-state.js');

const actor = { id: 'manager-1', name: 'Người xếp lịch' };
const now = '2026-08-31T03:00:00.000Z';
const baseRow = {
    start: '18:00',
    end: '19:30',
    lop: 'Toán 9',
    phong: 'P18',
    gvList: [
        { id: 'main-a', name: 'GV A' },
        { id: 'main-b', name: 'GV B' }
    ],
    gv: 'GV A',
    gvId: 'main-a'
};

const oneAbsent = state.applyStaffingCommand(baseRow, {
    shiftId: 'shift-test',
    mains: baseRow.gvList,
    statuses: {
        'main-a': { type: 'VDX', reason: 'Báo bệnh', reportedAt: now },
        'main-b': { type: 'ACTIVE' }
    },
    substitutes: []
}, actor, now);

assert.equal(oneAbsent.teacherAbsences.length, 1, 'chỉ GV được chọn mới bị ghi nghỉ');
assert.equal(oneAbsent.teacherAbsences[0].teacherId, 'main-a');
assert.equal(oneAbsent.teacherAbsences[0].status, 'pending');
assert.equal(state.isMainTeacherAbsent(oneAbsent, 'main-a'), true);
assert.equal(state.isMainTeacherAbsent(oneAbsent, 'main-b'), false,
    'đồng giảng viên còn lại phải tiếp tục ở trạng thái đi dạy');
assert.equal(oneAbsent.teacherAbsenceHistory.at(-1).event, 'reported_absent');

const covered = state.applyStaffingCommand(oneAbsent, {
    shiftId: 'shift-test',
    mains: baseRow.gvList,
    statuses: {
        'main-a': { type: 'VDX', reason: 'Báo bệnh', reportedAt: now },
        'main-b': { type: 'ACTIVE' }
    },
    substitutes: [{ id: 'sub-a', name: 'GV Thay A', replacesTeacherIds: ['main-a'] }]
}, actor, '2026-08-31T03:05:00.000Z');

assert.equal(covered.teacherAbsences[0].status, 'covered');
assert.deepEqual(covered.teacherAbsences[0].replacementIds, ['sub-a']);
assert.deepEqual(covered.gvThayTeList[0].replacesTeacherIds, ['main-a']);
assert.deepEqual(covered.gvThayTheList[0].replacesTeacherIds, ['main-a'],
    'hai projection legacy phải đồng bộ trong một lần ghi');
assert.deepEqual(state.getReplacementIdsForTeacher(covered, 'main-a'), ['sub-a']);
assert.deepEqual(state.getReplacementIdsForTeacher(covered, 'main-b'), []);
assert.equal(covered.teacherAbsenceHistory.at(-1).event, 'coverage_changed');

const pendingAgain = state.applyStaffingCommand(covered, {
    shiftId: 'shift-test',
    mains: baseRow.gvList,
    statuses: {
        'main-a': { type: 'VDX', reason: 'Báo bệnh', reportedAt: now },
        'main-b': { type: 'ACTIVE' }
    },
    substitutes: []
}, actor, '2026-08-31T03:05:30.000Z');
assert.equal(pendingAgain.teacherAbsences[0].status, 'pending',
    'khi chưa tìm được người thay, GV vẫn được ghi nghỉ và ca phải ở trạng thái chờ người thay');
assert.deepEqual(pendingAgain.teacherAbsences[0].replacementIds, []);
assert.equal(pendingAgain.teacherAbsenceHistory.at(-1).event, 'coverage_changed',
    'việc bỏ người thay phải để lại lịch sử điều phối thay vì xóa dấu vết');

const correctedReportedTime = state.applyStaffingCommand(covered, {
    shiftId: 'shift-test',
    mains: baseRow.gvList,
    statuses: {
        'main-a': { type: 'VDX', reason: 'Báo bệnh', reportedAt: '2026-08-31T02:30:00.000Z' },
        'main-b': { type: 'ACTIVE' }
    },
    substitutes: [{ id: 'sub-a', name: 'GV Thay A', replacesTeacherIds: ['main-a'] }]
}, actor, '2026-08-31T03:06:00.000Z');
assert.equal(correctedReportedTime.teacherAbsences[0].reportedAt, '2026-08-31T02:30:00.000Z',
    'người xếp lịch phải sửa được thời điểm báo nghỉ');
assert.equal(correctedReportedTime.teacherAbsenceHistory.at(-1).event, 'absence_details_changed');

assert.throws(() => state.applyStaffingCommand(oneAbsent, {
    mains: baseRow.gvList,
    statuses: {
        'main-a': { type: 'VDX' },
        'main-b': { type: 'ACTIVE' }
    },
    substitutes: [{ id: 'sub-a', name: 'GV Thay A', replacesTeacherIds: [] }]
}, actor, now), /thay cho giáo viên chính nào/,
'GV thay trong lớp nhiều GV phải có ánh xạ rõ ràng');

const restored = state.applyStaffingCommand(covered, {
    shiftId: 'shift-test',
    mains: baseRow.gvList,
    statuses: {
        'main-a': { type: 'ACTIVE' },
        'main-b': { type: 'ACTIVE' }
    },
    substitutes: []
}, actor, '2026-08-31T03:10:00.000Z');

assert.deepEqual(restored.teacherAbsences, []);
assert.deepEqual(restored.gvThayTeList, []);
assert.equal(restored.teacherAbsenceHistory.at(-1).event, 'restored');
assert.equal(restored.shiftId, 'shift-test', 'shiftId phải bất biến qua mọi trạng thái');

const legacySingleAbsent = {
    gvList: [{ id: 'main-a', name: 'GV A' }],
    gvThayTheList: [{ id: 'sub-a', name: 'GV Thay A' }]
};
assert.deepEqual(state.getReplacementIdsForTeacher(legacySingleAbsent, 'main-a'), ['sub-a'],
    'dữ liệu legacy một GV vẫn đọc tương thích');

const legacyAmbiguous = {
    gvList: [{ id: 'main-a', name: 'GV A' }, { id: 'main-b', name: 'GV B' }],
    gvThayTheList: [{ id: 'sub-a', name: 'GV Thay A' }]
};
assert.deepEqual(state.getReplacementIdsForTeacher(legacyAmbiguous, 'main-a'), [],
    'không tự gán một GV thay cho tất cả GV chính trong dữ liệu mơ hồ');
assert.deepEqual(state.getReplacementIdsForTeacher(legacyAmbiguous, 'main-b'), []);

console.log('teacher shift state regression tests passed');
