const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AdminAttendance = require('../js/schedule-attendance-admin.js');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const schedule = read('js/schedule.js');
const db = read('js/db-service.js');
const renderStart = schedule.indexOf('async function renderTable');
const renderEnd = schedule.indexOf('// Helper: get array', renderStart);
const renderBody = schedule.slice(renderStart, renderEnd);
assert.match(renderBody, /const renderGeneration = \+\+scheduleRenderGeneration/);
assert.match(renderBody, /isScheduleRenderCurrent\(renderGeneration, compositeKey\)/,
    'Stale day/branch/week responses must never replace the active schedule table');

const sliceFunction = (startMarker, endMarker) => {
    const start = schedule.indexOf(startMarker);
    const end = schedule.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `Missing function boundary: ${startMarker}`);
    return schedule.slice(start, end);
};

for (const [start, end] of [
    ['window.toggleClassClosure', 'let currentWeekStart'],
    ['window.addNewRow', 'window.updateRow'],
    ['window.updateRow', 'window.deleteRow'],
    ['window.deleteRow', 'window.saveScheduleManual'],
    ['window.updateSubjectRow', 'let teacherShiftManagerState']
]) {
    const body = sliceFunction(start, end);
    assert.doesNotMatch(body, /DBService\.saveSchedule\(/,
        `${start} must not rewrite a cached whole-day schedule`);
    assert.match(body, /updateScheduleRowAtomic|mutateScheduleSectionAtomic/);
}

const updateAtomic = db.slice(db.indexOf('updateScheduleRowAtomic:'), db.indexOf('mutateScheduleSectionAtomic:'));
assert.match(updateAtomic, /db\.runTransaction/);
assert.match(updateAtomic, /_revision:\s*currentRevision \+ 1/);
assert.match(updateAtomic, /_withoutSeparateScheduleRegistrations/);
assert.match(updateAtomic, /changedAbsenceIds[\s\S]*schedule\/attendance-guard-required/,
    'a new VP/VĐX state must not commit without an in-transaction attendance guard');
assert.match(updateAtomic, /attendanceRefs\.map\(attendanceRef => transaction\.get\(attendanceRef\)\)/,
    'the staffing transaction must read deterministic attendance documents');
assert.match(updateAtomic, /workedAttendanceConflictForShift/,
    'the transaction and table chips must share the same attendance resolver');
assert.ok(
    updateAtomic.indexOf('transaction.get(attendanceRef)') < updateAtomic.indexOf('transaction.set(ref'),
    'attendance evidence must be read before the schedule write in the same transaction'
);

const staffingSave = schedule.slice(
    schedule.indexOf('window.saveTeacherShiftCommand'),
    schedule.indexOf('window.saveGVPickerResult')
);
assert.match(staffingSave, /guardedAbsenceStaffIds[\s\S]*attendanceAbsenceGuard/);
assert.match(staffingSave, /staffIds:\s*guardedAbsenceStaffIds[\s\S]*dateKey:\s*state\.dateKey[\s\S]*resolverShiftId:\s*state\.shiftId/,
    'the staffing command must bind affected teachers, date and shift identity into its guard');

const mutateStart = db.indexOf('mutateScheduleSectionAtomic:');
const mutateAtomic = db.slice(mutateStart, db.indexOf('checkInPersonal: async', mutateStart));
assert.match(mutateAtomic, /db\.runTransaction/);
assert.match(mutateAtomic, /const nextRows = applyRows\(rows\)/);
assert.match(mutateAtomic, /_revision:\s*currentRevision \+ 1/);

const copyStart = db.indexOf('createScheduleIfMissing:');
const copyCreate = db.slice(copyStart, db.indexOf('updateScheduleManifest:', copyStart));
assert.match(copyCreate, /db\.runTransaction/);
assert.match(copyCreate, /if \(snapshot\.exists\) return/,
    'Week copy must preserve target days that already contain a schedule');
assert.match(schedule, /createScheduleIfMissing\(tgtComposite, cleanData\)/);

const popup = sliceFunction('window.showGVPopup', '// ================= COPY SCHEDULE');
assert.match(popup, /document\.createTextNode\(String\(g\?\.name/);
assert.doesNotMatch(popup, /innerHTML\s*=\s*gvList\.map/,
    'Teacher names must not be interpolated into popup HTML');

const picker = sliceFunction('window.openGVPicker', 'window.saveTeacherShiftCommand');
assert.match(schedule, /let teacherPickerGeneration = 0/);
assert.match(picker, /const pickerGeneration = teacherPickerGeneration/);
assert.match(picker, /await Promise\.all\([\s\S]*?DBService\.getSchedule\(compositeKey\)[\s\S]*?pickerGeneration !== teacherPickerGeneration/,
    'A stale picker request must stop immediately after its async schedule read');
assert.match(picker, /pickerGeneration !== teacherPickerGeneration[\s\S]*?document\.body\.appendChild\(overlay\)/,
    'Only the latest picker request may commit modal state and DOM');
assert.match(schedule.slice(schedule.indexOf('function closeTeacherShiftManager'), schedule.indexOf('function teacherShiftStatusMeta')),
    /teacherPickerGeneration \+= 1/,
    'Closing the manager must invalidate an in-flight picker request');

const compatibilityTail = schedule.slice(schedule.lastIndexOf('// Rolling-deploy compatibility'));
assert.match(compatibilityTail, /setTeacherShiftAbsence[\s\S]*openGVPicker\(compositeKey, section, index, 'gv'\)/,
    'Cached quick-absence actions must route to the canonical staffing manager');

function createScheduleRaceDb() {
    const store = new Map();
    let transactionAttempts = 0;
    let attendanceReads = 0;
    let raceInjected = false;
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const keyOf = (collectionName, id) => `${collectionName}/${id}`;
    const schedulePath = keyOf('schedules', 'cs1__2026-09-01');
    const attendancePath = keyOf('attendance_logs', '2026-09-01_staff-1');
    store.set(schedulePath, {
        version: 1,
        data: {
            evening2: [{
                shiftId: 'shift-a', start: '19:30', end: '21:00', lop: 'Math', phong: 'P1',
                gvId: 'staff-1', gvList: [{ id: 'staff-1', name: 'Teacher One' }],
                gvThayTeList: [], teacherAbsences: [], teacherAbsenceHistory: [],
                staffingUpdatedAt: 'staffing-v1'
            }],
            _revision: 1
        }
    });

    function ref(collectionName, id) {
        return { collectionName, id, path: keyOf(collectionName, id) };
    }
    function snapshotFor(reference) {
        const record = store.get(reference.path);
        return {
            id: reference.id,
            ref: reference,
            exists: !!record,
            data: () => clone(record?.data)
        };
    }
    const database = {
        collection(collectionName) {
            return { doc: id => ref(collectionName, id) };
        },
        async runTransaction(callback) {
            for (let retry = 0; retry < 5; retry += 1) {
                transactionAttempts += 1;
                const readVersions = new Map();
                const pendingWrites = [];
                const transaction = {
                    async get(reference) {
                        const record = store.get(reference.path);
                        readVersions.set(reference.path, record?.version || 0);
                        const snapshot = snapshotFor(reference);
                        if (reference.path === attendancePath) {
                            attendanceReads += 1;
                            if (!raceInjected) {
                                raceInjected = true;
                                // Simulate a real check-in after this transaction
                                // read but before its schedule write. Firestore must
                                // retry, and the retry must see/reject the work.
                                store.set(attendancePath, {
                                    version: 1,
                                    data: {
                                        userId: 'staff-1', date: '2026-09-01',
                                        sessions: [{
                                            id: 'worked-race', linkedScheduleShiftId: 'shift-a',
                                            checkIn: '2026-09-01T19:30:00',
                                            checkOut: '2026-09-01T21:00:00'
                                        }]
                                    }
                                });
                            }
                        }
                        return snapshot;
                    },
                    set(reference, data, options) {
                        pendingWrites.push({ reference, data: clone(data), options });
                    }
                };
                let result;
                try {
                    result = await callback(transaction);
                } catch (error) {
                    throw error;
                }
                const conflicted = Array.from(readVersions.entries()).some(([pathKey, version]) =>
                    (store.get(pathKey)?.version || 0) !== version
                );
                if (conflicted) continue;
                pendingWrites.forEach(write => {
                    const previous = store.get(write.reference.path);
                    store.set(write.reference.path, {
                        version: (previous?.version || 0) + 1,
                        data: write.options?.merge
                            ? { ...(previous?.data || {}), ...clone(write.data) }
                            : clone(write.data)
                    });
                });
                return result;
            }
            throw new Error('transaction retry limit reached');
        }
    };
    return {
        database,
        store,
        schedulePath,
        transactionAttempts: () => transactionAttempts,
        attendanceReads: () => attendanceReads
    };
}

async function verifyAbsenceAttendanceRaceClosure() {
    const fake = createScheduleRaceDb();
    const localStorage = {
        getItem(key) { return key === 'currentUserId' ? 'staff-admin' : ''; },
        setItem() {},
        removeItem() {}
    };
    const context = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout,
        clearTimeout,
        navigator: {},
        localStorage,
        window: {
            db: fake.database,
            localStorage,
            ScheduleAttendanceAdmin: AdminAttendance
        },
        firebase: {
            firestore: { FieldValue: { serverTimestamp: () => '__server_timestamp__' } }
        },
        db: fake.database
    };
    vm.runInNewContext(`${db}\nglobalThis.__DBService = DBService;`, context);
    const service = context.__DBService;
    service.updateScheduleManifest = async () => true;
    const signature = '19:30|21:00|Math|P1';
    const locator = {
        index: 0,
        shiftId: 'shift-a',
        signature,
        attendanceAbsenceGuard: {
            staffIds: ['staff-1'],
            dateKey: '2026-09-01',
            compositeKey: 'cs1__2026-09-01',
            section: 'evening2',
            start: '19:30',
            end: '21:00',
            persistedShiftId: 'shift-a',
            resolverShiftId: 'shift-a',
            signature
        }
    };

    await assert.rejects(
        service.updateScheduleRowAtomic(
            'cs1__2026-09-01',
            'evening2',
            locator,
            row => {
                row.teacherAbsences = [{ teacherId: 'staff-1', type: 'VP' }];
                return row;
            }
        ),
        error => error?.code === 'schedule/attendance-work-conflict'
    );
    assert.equal(fake.transactionAttempts(), 2,
        'a concurrent check-in must invalidate the first optimistic attempt and be seen on retry');
    assert.equal(fake.attendanceReads(), 2);
    assert.deepEqual(fake.store.get(fake.schedulePath).data.evening2[0].teacherAbsences, [],
        'the rejected retry must leave the schedule row unchanged');

    const attendanceReadsBeforeNonAbsenceEdit = fake.attendanceReads();
    await service.updateScheduleRowAtomic(
        'cs1__2026-09-01',
        'evening2',
        { index: 0, shiftId: 'shift-a', signature },
        row => ({ ...row, note: 'non-absence edit remains unchanged' })
    );
    assert.equal(fake.attendanceReads(), attendanceReadsBeforeNonAbsenceEdit,
        'ordinary schedule mutations must not add attendance reads');
    assert.equal(fake.store.get(fake.schedulePath).data.evening2[0].note, 'non-absence edit remains unchanged');
}

verifyAbsenceAttendanceRaceClosure()
    .then(() => console.log('schedule-mutation-concurrency.test.js: all assertions passed'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
