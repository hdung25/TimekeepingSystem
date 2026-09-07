'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Early10 = require('../js/early10.js');
const AdminAttendance = require('../js/schedule-attendance-admin.js');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/db-service.js'), 'utf8');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const quiet = { log() {}, warn() {}, error() {} };
function serviceFor(db, window) {
    return new Function('db', 'window', 'firebase', 'localStorage', 'console', source + '\nreturn DBService;')(
        db, window, { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } } },
        { getItem: () => 'staff-admin', setItem() {} }, quiet);
}

async function directoryTests() {
    let calls = 0, fail = true;
    const window = { auth: { currentUser: { uid: 'admin' } } };
    const db = { collection: name => ({ get: async () => {
        calls++;
        if (fail) throw Object.assign(new Error('offline'), { code: 'unavailable' });
        return { docs: [{ id: 'one', data: () => ({ name: 'THỦY', username: 'thuy', password: 'private' }) }] };
    } }) };
    const service = serviceFor(db, window);
    service._getAuthenticatedDirectoryContext = async () => ({ uid: 'admin', canReadPrivateProfiles: true });
    await assert.rejects(service.getUsers(), { code: 'unavailable' });
    fail = false;
    const result = await service.getUsers();
    assert.equal(result.length, 1);
    assert.equal(result[0].password, undefined);
    await service.getUsers();
    assert.equal(calls, 2, 'successful directory is shared within TTL; failure is not cached');
    await service.getUsers({ forceRefresh: true });
    assert.equal(calls, 3);
    service._directoryReadTimes['users_all_admin_users'] = 0;
    await service.getUsers();
    assert.equal(calls, 4, 'expired cache refreshes only on demand, no polling');
    window.auth.currentUser.uid = 'different-user';
    await assert.rejects(service.getUsers({ forceRefresh: true }), { code: 'auth/session-changed' });
}

async function closureTests() {
    const row = { shiftId: 'shift-a', start: '07:30', end: '09:00', lop: 'Toán 5', phong: 'P1',
        gvId: 'staff-1', note: 'keep-note', teacherAbsences: [], gvList: [{ id: 'staff-1' }] };
    const schedulePath = 'schedules/cs1__2026-08-31';
    const store = new Map([[schedulePath, { morning1: [row, { shiftId: 'other', note: 'keep-other' }], _revision: 1 }]]);
    let race = false, reads = [], writes = 0;
    const ref = (collection, id) => ({ path: `${collection}/${id}`, id });
    const db = {
        collection: name => ({ doc: id => ref(name, id) }),
        runTransaction: async callback => {
            for (let attempt = 0; attempt < 2; attempt++) {
                let changed = false;
                const queued = [];
                await callback({ get: async reference => {
                    reads.push(reference.path);
                    const data = clone(store.get(reference.path));
                    if (race && reference.path === 'attendance_logs/2026-08-31_staff-1') {
                        race = false; changed = true;
                        store.set(reference.path, { sessions: [{ id: 'worked', linkedScheduleShiftId: 'shift-a',
                            checkIn: '2026-08-31T07:30:00+07:00', checkOut: '2026-08-31T09:00:00+07:00' }] });
                    }
                    return { exists: !!data, data: () => data };
                }, set: (reference, value) => queued.push([reference.path, clone(value)]) });
                if (changed) continue;
                queued.forEach(([key, value]) => { writes++; store.set(key, value); });
                return;
            }
        }
    };
    const window = { auth: { currentUser: { uid: 'admin' } }, ScheduleAttendanceAdmin: AdminAttendance };
    const service = serviceFor(db, window);
    service.getAuthenticatedAuthorizationContext = async () => ({ uid: 'admin', userId: 'staff-admin', roles: ['admin'] });
    service.updateScheduleManifest = async () => {};
    const locator = () => ({ index: 0, shiftId: 'shift-a', signature: '07:30|09:00|Toán 5|P1',
        closureCommand: { reason: 'Phụ huynh báo cả lớp nghỉ', expectedClosed: false, registeredStaffIds: [] } });
    const change = (isClosed, meta = locator()) => service.updateScheduleRowAtomic(
        'cs1__2026-08-31', 'morning1', meta, current => ({ ...current, isClosed }));
    race = true;
    await assert.rejects(change(true), { code: 'schedule/closure-work-conflict' });
    assert.equal(writes, 0, 'a concurrent check-in aborts closure on retry');
    assert.equal(reads.filter(p => p.includes('attendance_logs')).length, 2);
    store.delete('attendance_logs/2026-08-31_staff-1');
    await change(true);
    let saved = store.get(schedulePath);
    assert.equal(saved.morning1[0].isClosed, true);
    assert.equal(saved.morning1[0].note, 'keep-note');
    assert.equal(saved.morning1[1].note, 'keep-other');
    assert.equal(saved.morning1[0].classClosureHistory[0].after, true);
    await assert.rejects(change(false), { code: 'schedule/closure-conflict' });
    const reopen = locator(); reopen.closureCommand.expectedClosed = true;
    await change(false, reopen);
    saved = store.get(schedulePath);
    assert.equal(saved.morning1[0].isClosed, false);
    assert.equal(saved.morning1[0].classClosureHistory.length, 2);
    assert.equal(saved.morning1[0].gvId, 'staff-1');
    service.getAuthenticatedAuthorizationContext = async () => ({ uid: 'admin', roles: ['staff'] });
    await assert.rejects(change(true), /quyền quản lý/);
    assert.equal(writes, 2, 'only close and restore write, never attendance/payroll');
}

async function main() {
    const input = { sessionRole: 'english', subjectMap: { english: true }, user: { teachingMode: 'old' }, classStart: '18:00' };
    assert.equal(Early10.evaluateEarly10Request({ ...input, checkIn: '2026-09-05T17:50:00+07:00' }).ok, true);
    const late = Early10.evaluateEarly10Request({ ...input, checkIn: '2026-09-05T17:50:47+07:00' });
    assert.equal(late.ok, false);
    assert.match(late.message, /chậm nhất 17:50:00/);
    await directoryTests();
    await closureTests();
    const schedule = fs.readFileSync(path.join(root, 'js/schedule.js'), 'utf8');
    const action = schedule.slice(schedule.indexOf('// === ACTION CELL ==='), schedule.indexOf('// === CỘT LỚP'));
    assert.match(action, /if \(isAdmin\)/, 'past closures must remain manager-accessible');
    assert.match(action, /rowIsAdmin \? `<button/, 'historical delete must remain disabled');
    assert.match(source, /delete newRow\.classClosureHistory/, 'daily closure audit must not inherit into another date');
    console.log('incident-recovery.test.js: exact-time, cache retry/scope, class close/restore/race checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
