const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/db-service.js'), 'utf8');
const quiet = { log() {}, warn() {}, error() {} };
const date = '2026-10-09', staff = 'staff-a';
const attKey = 'attendance_logs/' + date + '_' + staff;
const cancelKey = 'cancelled_shifts/2026-10_' + staff;
const rosterKey = 'office_schedules/cs3__2026-10-05';
let records, rejectCommit;
const db = {
    collection: col => ({ doc: id => ({ key: col + '/' + id }) }),
    async runTransaction(callback) {
        const writes = [];
        let writing = false;
        const transaction = {
            async get(ref) {
                assert.equal(writing, false, 'All reads must precede writes');
                return { exists: records.has(ref.key), data: () => structuredClone(records.get(ref.key)) };
            },
            set(ref, data, options) { writing = true; writes.push({ ref, data, merge: options?.merge }); },
            update(ref, data) { writing = true; writes.push({ ref, data, merge: true }); }
        };
        await callback(transaction);
        if (rejectCommit) throw Error('permission-denied');
        for (const w of writes) {
            assert.equal(JSON.stringify(w.data).includes('undefined'), false);
            function validate(value) {
                assert.notEqual(value, undefined, 'Firestore rejects undefined');
                if (value && typeof value === 'object') Object.values(value).forEach(validate);
            }
            validate(w.data);
            records.set(w.ref.key, structuredClone(w.merge ? { ...records.get(w.ref.key), ...w.data } : w.data));
        }
    }
};
const context = { console: quiet, db, window: { db }, navigator: {}, localStorage: { getItem: () => 'admin' },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } } },
    setTimeout, clearTimeout, AbortController, fetch, Date, Map, Set };
vm.createContext(context);
vm.runInContext(source, context);
const service = vm.runInContext('DBService', context);
const targets = ['afternoon', 'evening'].map(sectionKey => ({ compositeKey: 'cs3__2026-10-05', sectionKey, index: 'fri', kind: 'office' }));
function reset() {
    rejectCommit = false;
    records = new Map([
        [attKey, { userId: staff, date, sessions: [{ id: 'delete-me', checkIn: 'IN' }, { id: 'keep-me', start: 'KEEP' }], payroll: 'preserved' }],
        [cancelKey, { shifts: ['keep-tombstone'], unrelated: 'keep' }],
        [rosterKey, { _revision: 3, afternoon: { fri: [{ id: staff }, { id: 'colleague' }], thu: [{ id: staff }] }, evening: { fri: [{ id: staff }] }, notes: 'keep' }]
    ]);
}
(async () => {
    reset();
    await service.deleteReportShift(staff, date, 'delete-me', targets);
    assert.equal(records.get(attKey).sessions.length, 1);
    assert.equal(records.get(attKey).sessions[0].id, 'keep-me');
    assert.equal(records.get(attKey).checkIn, 'KEEP');
    assert.equal(records.get(attKey).checkOut, null);
    assert.equal(records.get(attKey).payroll, 'preserved');
    assert.deepEqual(records.get(rosterKey).afternoon.fri, [{ id: 'colleague' }]);
    assert.deepEqual(records.get(rosterKey).evening.fri, []);
    assert.deepEqual(records.get(rosterKey).afternoon.thu, [{ id: staff }]);
    assert.equal(records.get(rosterKey)._revision, 4);
    assert.deepEqual(records.get(cancelKey).shifts, ['keep-tombstone', 'office_cs3_2026-10-05_afternoon_fri', 'office_cs3_2026-10-05_evening_fri']);
    reset();
    const before = JSON.stringify([...records]);
    rejectCommit = true;
    await assert.rejects(service.deleteReportShift(staff, date, 'delete-me', targets), /permission-denied/);
    assert.equal(JSON.stringify([...records]), before, 'Failure must leave attendance and roster intact');
    reset();
    // An absent chip has no attendance: deleting the second shift must still work.
    const originalAttendance = JSON.stringify(records.get(attKey));
    await service.deleteReportShift(staff, date, 'NEW', [targets[0]]);
    await service.deleteReportShift(staff, date, 'NEW', [targets[1]]);
    assert.equal(JSON.stringify(records.get(attKey)), originalAttendance);
    assert.deepEqual(records.get(rosterKey).evening.fri, []);
    reset();
    await service.deleteReportShift(staff, date, null, [{ kind: 'teaching', compositeKey: 'cs1__2026-10-09', sectionKey: 'evening1', index: '0' }]);
    assert.ok(records.get(cancelKey).shifts.includes('cs1__2026-10-09_evening1_0'));
    assert.equal(records.get(rosterKey)._revision, 3);
    reset();
    await service.deleteReportShift(staff, date, 'missing-session', []);
    assert.equal(records.get(attKey).checkIn, undefined, 'A stale session ID must not rewrite the log');
    // Modal uses every original segment and clears the context when switching chips.
    const report = fs.readFileSync(path.join(root, 'js/report.js'), 'utf8');
    vm.runInContext(report.slice(report.indexOf('function reportDeleteTargets('), report.indexOf('async function openManualModal(')), context);
    const merged = { mergedSegments: targets.map(t => ({ documentKey: t.compositeKey, shiftKey: t.sectionKey, dayKey: t.index })) };
    const result = context.reportDeleteTargets(merged, 'wrong', 'wrong', 'wrong', 'office');
    assert.equal(JSON.stringify(result), JSON.stringify(targets));
    assert.equal(context.reportDeleteTargets(null, '', '', '', 'teaching').length, 0);
    const evalContext = { console: quiet, Date, Math, Set, Map, Intl, window: { centerClosures: {}, getIconHtml: () => '' },
        getLocalDateKey: d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
        isScheduledMainTeacher: () => false, isScheduledSubstitute: () => false, hasScheduledSubstitute: () => false };
    vm.createContext(evalContext);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/evaluation-service.js'), 'utf8'), evalContext);
    const shifts = [
        { shift: 'afternoon', label: 'CHIỀU', start: '14:00', end: '18:00', branch: 'cs3', scheduleType: 'office', documentKey: 'cs3__2026-10-05', dayKey: 'fri' },
        { shift: 'evening', label: 'TỐI', start: '18:00', end: '21:30', branch: 'cs3', scheduleType: 'office', documentKey: 'cs3__2026-10-05', dayKey: 'fri' }
    ];
    const user = { id: staff, roles: ['office_staff'], salary_config: {} };
    const chips = evalContext.window.calculateDailyChips({}, [], staff, date, user, shifts);
    const office = chips.find(chip => chip.isOffice);
    assert.ok(office, 'The merged absent office chip must exist');
    assert.equal(office.reportDeleteSegments.length, 2);
    assert.deepEqual(Array.from(office.reportDeleteSegments, seg => seg.shiftKey), ['afternoon', 'evening']);
    const session = { id: 'evening-only', checkIn: `${date}T18:00:00`, checkOut: `${date}T21:30:00` };
    const split = evalContext.window.calculateDailyChips({}, [session], staff, date, user, shifts);
    const absent = split.find(chip => chip.isSplitAbsent);
    const worked = split.find(chip => chip.sessionId === session.id && chip.isOffice);
    assert.equal(absent.reportDeleteSegments[0].shiftKey, 'afternoon');
    assert.equal(absent.isClickable, true, 'Admin must be able to remove the absent subshift');
    assert.equal(worked.reportDeleteSegments.length, 1);
    assert.equal(worked.reportDeleteSegments[0].shiftKey, 'evening', 'Deleting worked evening must not remove absent afternoon');
    console.log('report-delete-atomic: passed (merged shifts, sequential absence deletion, rollback, legacy clocks, exact teaching keys, unrelated data)');
})().catch(e => { console.error(e); process.exitCode = 1; });
