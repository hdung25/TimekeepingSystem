const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-service.js'), 'utf8');
const startMarker = '// SCHEDULE REGISTRATION HELPERS START';
const endMarker = '// SCHEDULE REGISTRATION HELPERS END';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
assert.ok(start >= 0 && end > start, 'schedule registration helpers must stay testable');

const context = {};
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}
globalThis.helpers = {
  id: _scheduleRegistrationId,
  signature: _scheduleRegistrationRowSignature,
  merge: _mergeScheduleRegistrations,
  clean: _withoutSeparateScheduleRegistrations
};`, context);
const helpers = context.helpers;

const row = {
    shiftId: 'shift-a', start: '18:00', end: '19:30', lop: 'Toán 9', phong: 'P18',
    registeredTeachers: [{ id: 'teacher-a', name: 'GV A', timestamp: 'legacy' }]
};
const schedule = { evening1: [row] };
const locator = {
    scheduleKey: 'cs1__2026-09-01', section: 'evening1', rowIndex: 0,
    shiftId: 'shift-a', rowSignature: helpers.signature(row), userId: 'teacher-a'
};

const cancelled = helpers.merge(schedule, [{
    ...locator, id: 'cancel-a', status: 'cancelled', updatedAt: '2026-08-31T02:00:00.000Z'
}]);
assert.deepEqual(Array.from(cancelled.evening1[0].registeredTeachers), [],
    'a separate cancellation must hide an embedded legacy registration');

const active = helpers.merge(schedule, [{
    ...locator, id: 'active-a', status: 'active', userName: 'GV A mới', updatedAt: '2026-08-31T03:00:00.000Z'
}]);
assert.equal(active.evening1[0].registeredTeachers.length, 1);
assert.equal(active.evening1[0].registeredTeachers[0].registrationSource, 'schedule_registrations');
assert.equal(active.evening1[0].registeredTeachers[0].name, 'GV A mới');

const latestWins = helpers.merge(schedule, [
    { ...locator, id: 'old-active', status: 'active', updatedAt: '2026-08-31T01:00:00.000Z' },
    { ...locator, id: 'new-cancel', status: 'cancelled', updatedAt: '2026-08-31T04:00:00.000Z' }
]);
assert.equal(latestWins.evening1[0].registeredTeachers.length, 0,
    'duplicate legacy locators must resolve to the latest status');

assert.notEqual(
    helpers.id('cs1__2026-09-01', 'evening1', row, 'teacher-a', 0),
    helpers.id('cs1__2026-09-01', 'evening1', row, 'teacher-a', 1),
    'two otherwise identical rows need independent registration documents'
);

const cleaned = helpers.clean(active);
assert.equal(cleaned.evening1[0].registeredTeachers.length, 0,
    'manager schedule saves must never embed the separate registration projection');
assert.equal(schedule.evening1[0].registeredTeachers.length, 1,
    'projection helpers must not mutate cached/source schedule objects');

const registerFlow = source.slice(source.indexOf('registerClass: async'), source.indexOf('updateAttendanceSession: async'));
assert.match(registerFlow, /collection\('schedule_registrations'\)/);
assert.doesNotMatch(registerFlow, /collection\('schedules'\)/,
    'self-registration must never write a schedule document');
assert.match(registerFlow, /status: nextStatus/);
assert.match(source, /_attachScheduleRegistrations\(compositeKey, data(?:, options)?\)/);

console.log('schedule-registration.test.js: all assertions passed');
