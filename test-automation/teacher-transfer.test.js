const assert = require('node:assert/strict');
const state = require('../js/teacher-shift-state.js');

const actor = { id: 'manager-1', name: 'Người xếp lịch' };
const command = {
    transferId: 'transfer-test-1',
    mode: 'temporary',
    effectiveFrom: '2026-09-03',
    effectiveTo: '2026-09-09',
    teacherId: 'teacher-a',
    teacherName: 'GV A',
    reason: 'Điều phối tạm thời trong tuần',
    source: { compositeKey: 'cs1__2026-09-03', section: 'morning1', shiftId: 'source-1' },
    target: { compositeKey: 'cs1__2026-09-03', section: 'morning2', shiftId: 'target-1' }
};

const source = {
    shiftId: 'source-1',
    start: '08:00', end: '09:30', lop: 'Lớp nguồn', phong: 'P1',
    gvList: [{ id: 'teacher-a', name: 'GV A' }, { id: 'teacher-b', name: 'GV B' }],
    teacherAbsences: [],
    teacherAbsenceHistory: []
};
const movedOut = state.applyTeacherTransferCommand(source, {
    ...command,
    direction: 'out',
    replacementTeacher: { id: 'teacher-c', name: 'GV C' }
}, actor, '2026-09-03T02:00:00.000Z');

assert.deepEqual(movedOut.gvList.map(item => item.id), ['teacher-b', 'teacher-c']);
assert.deepEqual(movedOut.teacherAbsences, [], 'đổi lớp không được tự tạo ca vắng');
assert.equal(movedOut.assignmentTransferHistory.at(-1).event, 'teacher_transfer_out');
assert.equal(movedOut.assignmentTransferHistory.at(-1).mode, 'temporary');
assert.equal(movedOut.assignmentTransferHistory.at(-1).effectiveTo, '2026-09-09');
assert.equal(typeof movedOut.assignmentTransferHistory.at(-1).at, 'string');

const target = {
    shiftId: 'target-1',
    start: '10:00', end: '11:30', lop: 'Lớp đích', phong: 'P2',
    gvList: [{ id: 'teacher-d', name: 'GV D' }],
    gvThayTeList: [{ id: 'teacher-a', name: 'GV A', replacesTeacherIds: ['teacher-d'] }],
    teacherAbsences: [{
        teacherId: 'teacher-d', teacherName: 'GV D', type: 'VDX', status: 'covered',
        replacementIds: ['teacher-a'], replacementNames: ['GV A']
    }]
};
const movedIn = state.applyTeacherTransferCommand(target, {
    ...command,
    direction: 'in',
    teacherName: 'GV A'
}, actor, '2026-09-03T02:00:00.000Z');

assert.deepEqual(movedIn.gvList.map(item => item.id), ['teacher-d', 'teacher-a']);
assert.deepEqual(movedIn.gvThayTeList, [], 'GV chuyển đến không được vừa là GV chính vừa là GV thay');
assert.equal(movedIn.teacherAbsences[0].status, 'pending', 'lớp đích phải chờ GV thay cũ được điều chỉnh');
assert.deepEqual(movedIn.teacherAbsences[0].replacementIds, []);
assert.equal(movedIn.assignmentTransferHistory.at(-1).event, 'teacher_transfer_in');

assert.throws(() => state.applyTeacherTransferCommand({
    ...source,
    teacherAbsences: [{ teacherId: 'teacher-a', type: 'VP' }]
}, { ...command, direction: 'out' }, actor, '2026-09-03T02:00:00.000Z'), /đang ở trạng thái nghỉ/);

console.log('teacher-transfer regression tests passed');
