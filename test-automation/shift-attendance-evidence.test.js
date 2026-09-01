const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'schedule.js'), 'utf8').replace(/\r\n/g, '\n');
const ScheduleAttendanceAdmin = require('../js/schedule-attendance-admin.js');
const start = source.indexOf('function scheduleShiftDateTime');
const end = source.indexOf('\nfunction scheduleEscapeHTML', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({
    Date,
    Number,
    String,
    Map,
    Array,
    ScheduleAttendanceAdmin,
    window: { ScheduleAttendanceAdmin }
});
vm.runInContext(source.slice(start, end), context);

const localISO = (dayOffset, hour, minute = 0) => new Date(2026, 7, 31 + dayOffset, hour, minute).toISOString();
const evidence = new Map([
    ['gv-1', [{ checkIn: localISO(0, 7), checkOut: localISO(0, 11) }]],
    ['gv-2', [{ checkIn: localISO(0, 18), checkOut: localISO(0, 21) }]],
    ['gv-3', [{ checkIn: localISO(0, 22, 45), checkOut: localISO(1, 1, 15) }]]
]);

assert.equal(context.hasAttendanceEvidenceForShift(evidence, 'gv-1', '2026-08-31', '07:30', '09:00'), true);
assert.equal(context.hasAttendanceEvidenceForShift(evidence, 'gv-1', '2026-08-31', '18:00', '21:00'), false,
    'A morning check-in cannot prove attendance for an evening class');
assert.equal(context.hasAttendanceEvidenceForShift(evidence, 'gv-2', '2026-08-31', '18:00', '21:00'), true);
assert.equal(context.hasAttendanceEvidenceForShift(evidence, 'gv-3', '2026-08-31', '23:00', '01:00'), true,
    'Overnight shift overlap must be supported');
assert.equal(context.hasAttendanceEvidenceForShift(new Map(), 'gv-1', '2026-08-31', '07:30', '09:00'), false);
const ambiguous = new Map([['gv-4', [
    { id: 'a', checkIn: localISO(0, 18), checkOut: localISO(0, 20) },
    { id: 'b', checkIn: localISO(0, 19), checkOut: localISO(0, 21) }
]]]);
assert.equal(context.resolveAttendanceEvidenceForShift(
    ambiguous, 'gv-4', '2026-08-31', '18:00', '21:00'
).status, 'ambiguous', 'Multiple overlapping sessions must never be silently reduced to one chip');

const renderCell = source.slice(source.indexOf('function renderGVMultiCell'), source.indexOf('function renderTimeCell'));
assert.match(renderCell, /is-unverified/);
assert.match(renderCell, /Chưa xác minh chấm công/);
assert.doesNotMatch(renderCell, /presentUserIds\.has/);

console.log('shift-attendance-evidence.test.js: all assertions passed');
