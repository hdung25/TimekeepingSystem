'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../reminders.js');
const TeacherShiftState = require('../shared/teacher-shift-state.js');

// The Functions bundle ships its own copy of the shared roster logic; it must stay identical.
assert.equal(fs.readFileSync(path.join(__dirname, '..', 'shared', 'teacher-shift-state.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'teacher-shift-state.js'), 'utf8'),
    'functions/shared/teacher-shift-state.js must be a copy of js/teacher-shift-state.js');

const dateKey = '2026-09-23'; // Wednesday
const row = (start, end, gv, extra = {}) => ({ start, end, lop: 'E4', gvList: [{ id: gv, name: gv }], gvId: gv, ...extra });
const schedules = {
    cs1: {
        evening1: [row('18:00', '19:30', 'teacher-a'), row('18:00', '19:30', 'teacher-closed', { isClosed: true })],
        evening2: [row('19:30', '21:00', 'teacher-a')],
        afternoon2: [row('15:30', '17:00', 'teacher-a'), row('15:30', '17:00', 'teacher-absent', { teacherAbsences: [{ teacherId: 'teacher-absent', type: 'VP' }] })],
        morning1: [row('07:30', '09:00', 'teacher-b')]
    },
    cs2: { evening2: [row('19:30', '21:00', 'teacher-b')] }
};
const operational = [{ branch: 'cs1', type: 'receptionist', config: null,
    week: { afternoon: { wed: [{ id: 'recep-1' }] }, evening: { wed: [{ id: 'recep-1' }] } } }];
const closures = { [dateKey]: ['morning'] };
const byStaff = R.collectShifts({ dateKey, schedules, operational, closures, shiftState: TeacherShiftState });

assert.equal(byStaff.has('teacher-closed'), false, 'a closed class is not reminded');
assert.equal(byStaff.has('teacher-absent'), false, 'a teacher recorded absent is not reminded');
assert.equal((byStaff.get('teacher-b') || []).some(shift => shift.start === '07:30'), false, 'a centre-closed session is not reminded');
assert.deepEqual(R.chainLeaders(byStaff.get('teacher-a')).map(shift => shift.start), ['15:30', '18:00'],
    '19:30 continues the 18:00 class: one check-in, one reminder');
assert.deepEqual(R.chainLeaders(byStaff.get('recep-1')).map(shift => shift.start), ['14:00'],
    'receptionist evening (17:30) overlaps the afternoon shift: no second reminder');

const at = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
// Nhắc sớm 8 phút (mặc định).
assert.equal(R.dueReminders({ dateKey, nowMinutes: at('17:50'), byStaff }).length, 0, 'sớm hơn 8 phút thì chưa nhắc');
let due = R.dueReminders({ dateKey, nowMinutes: at('17:52'), byStaff });
assert.deepEqual(due.map(item => `${item.staffId} ${item.shift.start}`), ['teacher-a 18:00']);
assert.equal(due[0].tag, 'teaching_checkin_2026-09-23_cs1_18:00', 'tag matches the in-app reminder');
assert.equal(R.dueReminders({ dateKey, nowMinutes: at('19:25'), byStaff }).some(item => item.staffId === 'teacher-a'), false,
    'the consecutive 19:30 class is never reminded');
due = R.dueReminders({ dateKey, nowMinutes: at('19:24'), byStaff, staffFilter: new Set(['teacher-b']) });
assert.deepEqual(due.map(item => `${item.staffId} ${item.shift.branch} ${item.shift.start}`), ['teacher-b cs2 19:30']);
assert.equal(R.dueReminders({ dateKey, nowMinutes: at('18:08'), byStaff }).some(item => item.shift.start === '18:00'), true,
    'vẫn nhắc tới 10 phút sau giờ vào nếu chưa chấm công');
assert.equal(R.dueReminders({ dateKey, nowMinutes: at('18:12'), byStaff }).some(item => item.shift.start === '18:00'), false);

assert.equal(R.alreadyCheckedIn([{ checkIn: '2026-09-23T10:55:00Z' }], dateKey, '18:00'), true, 'open session = checked in');
assert.equal(R.alreadyCheckedIn([{ checkIn: '2026-09-23T01:00:00Z', checkOut: '2026-09-23T04:30:00Z' }], dateKey, '18:00'), false,
    'a finished morning session does not cover the evening');
assert.equal(R.alreadyCheckedIn([{ checkIn: '2026-09-23T10:55:00Z', checkOut: '2026-09-23T14:00:00Z', isAbsent: true }], dateKey, '18:00'), false);
assert.deepEqual(R.vietnamClock(new Date('2026-09-23T10:50:00Z')), { dateKey: '2026-09-23', nowMinutes: at('17:50') });
assert.deepEqual(R.vietnamClock(new Date('2026-09-22T17:30:00Z')), { dateKey: '2026-09-23', nowMinutes: at('00:30') });
console.log('functions reminders.test.js: all assertions passed');
