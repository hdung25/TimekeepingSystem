'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const schedule = fs.readFileSync(path.join(root, 'js', 'schedule.js'), 'utf8');
const helperStart = schedule.indexOf('function normalizeTeacherRosterSearch');
const helperEnd = schedule.indexOf('\nasync function refreshTeacherDirectoryForManager', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'teacher directory helpers must remain isolated');

const helpers = new Function('hasTeachingEmploymentRole', `${schedule.slice(helperStart, helperEnd)}
    return { normalizeTeacherRosterSearch, buildTeachingDirectory };
`)(roles => roles.some(role => ['teacher', 'teaching_assistant', 'assistant', 'staff'].includes(role)));

assert.equal(helpers.normalizeTeacherRosterSearch('  Thanh Thủy  '), 'thanh thuy');
assert.equal(helpers.normalizeTeacherRosterSearch('ĐOÀN THỊ THU THUỶ'), 'doan thi thu thuy');

const directory = helpers.buildTeachingDirectory([
    { id: 'fresh', name: 'Thanh Thủy', username: 'thuy99', roles: ['teaching_assistant'] },
    { id: 'office', name: 'Nhân sự văn phòng', username: 'office1', roles: ['receptionist'] }
], [
    { id: 'fresh', name: 'Tên cũ trên lịch', roles: ['teacher'] },
    { id: 'legacy', name: 'GV đã rời danh bạ' }
]);

assert.deepEqual(directory.teachers.map(item => item.id), ['fresh', 'legacy']);
assert.equal(directory.teacherById.get('fresh').name, 'Thanh Thủy',
    'fresh server profile must not be overwritten by an old schedule snapshot');
assert.equal(directory.teacherById.get('fresh').username, 'thuy99');
assert.equal(directory.teacherById.get('fresh')._preservedScheduleAssignment, undefined);
assert.equal(directory.teacherById.get('legacy')._preservedScheduleAssignment, true,
    'an already assigned legacy teacher must remain visible so the shift cannot silently lose data');
assert.equal(directory.teacherById.has('office'), false,
    'office-only staff must not become teaching candidates');

const pickerStart = schedule.indexOf('window.openGVPicker = async function');
const pickerEnd = schedule.indexOf('\nwindow.saveTeacherShiftCommand', pickerStart);
const picker = schedule.slice(pickerStart, pickerEnd);
assert.match(picker, /loadTeacherListForSchedule\(\{ forceRefresh: true, throwOnError: true \}\)/,
    'opening every shift picker must bypass the one-minute directory cache');
assert.match(schedule, /data-action="refresh-roster"/,
    'the manager needs an explicit retry when a remote directory read fails');
assert.match(schedule, /Không thể bỏ GV chính cuối cùng[\s\S]*tích GV mới trước/,
    'the sole-main invariant must explain the safe replacement order');

console.log('schedule roster refresh tests passed');
