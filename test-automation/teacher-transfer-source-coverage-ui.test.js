const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const schedule = read('js/schedule.js');
const db = read('js/db-service.js');
const state = read('js/teacher-shift-state.js');

const modalStart = schedule.indexOf('function openTeacherTransferModal');
const modalEnd = schedule.indexOf('\nfunction findTransferRowIndex', modalStart);
assert.ok(modalStart >= 0 && modalEnd > modalStart, 'transfer modal must stay isolated');
const modal = schedule.slice(modalStart, modalEnd);
assert.match(modal, /data-action="transfer-source-action"/,
    'scheduler must explicitly choose how the source class is handled');
assert.match(modal, /Bàn giao cho GV tiếp quản/);
assert.match(modal, /Giữ lịch nguồn · Vắng có phép/);
assert.match(modal, /Giữ lịch nguồn · Vắng đột xuất/);
assert.match(modal, /data-transfer-replacement-title/,
    'handoff teacher must be named as the source successor, not an ambiguous generic helper');
assert.match(schedule, /hỗ trợ ở lớp đích[\s\S]*GV chính/,
    'the modal must make the support-to-main conversion explicit');

const submitStart = schedule.indexOf('async function submitTeacherTransferModal');
const submitEnd = schedule.indexOf('\nasync function retryTeacherAttendanceAuthorization', submitStart);
assert.ok(submitStart >= 0 && submitEnd > submitStart, 'transfer submit handler must stay isolated');
const submit = schedule.slice(submitStart, submitEnd);
assert.match(submit, /const sourceDisposition = sourceAction === 'handoff'/);
assert.match(submit, /sourceAbsenceType = sourceAction === 'absence-vp' \? 'VP'/);
assert.match(submit, /sourceHasAnotherMain/,
    'a sole source teacher cannot be silently removed without a successor or explicit absence');
assert.match(submit, /sourceDisposition,\s*\n\s*sourceAbsence/,
    'the selected source disposition must be sent to every atomic date operation');
assert.match(submit, /là GV chính ở lớp đích/,
    'success UI must confirm that the transferred teacher is a target main teacher');

assert.match(db, /sourceDisposition = String\(item\.sourceDisposition \|\| 'handoff'\)/);
assert.match(db, /sourceAttendanceChecks[\s\S]*transaction\.get\(db\.collection\('attendance_logs'\)/,
    'every source staffing mutation must re-read source attendance inside the transfer transaction');
assert.match(db, /direction: sourceDirection[\s\S]*sourceAbsence:/,
    'the transaction must invoke the explicit source absence state transition');
assert.match(state, /direction === 'source_absence'[\s\S]*applyStaffingCommand/,
    'explicit source absence must use the canonical staffing/history command');
assert.match(state, /event: 'teacher_transfer_source_absence'/,
    'explicit source absence must leave a transfer audit entry');

console.log('teacher transfer source coverage UI regression tests passed');
