const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const state = require(path.join(root, 'js', 'teacher-shift-state.js'));
const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
const dateAfter = (dateKey, days) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
const clone = value => JSON.parse(JSON.stringify(value));
const docs = new Map();
const documentKey = (collection, id) => `${collection}/${id}`;
const snapshotFor = ref => {
    const value = docs.get(documentKey(ref.collectionName, ref.id));
    return { exists: value !== undefined, data: () => clone(value) };
};

const db = {
    collection(collectionName) {
        return {
            doc(id) {
                const ref = {
                    collectionName,
                    id,
                    get: async () => snapshotFor(ref)
                };
                return ref;
            }
        };
    },
    async runTransaction(callback) {
        const staged = new Map();
        const transaction = {
            get: async ref => snapshotFor(ref),
            set: (ref, value) => staged.set(documentKey(ref.collectionName, ref.id), clone(value))
        };
        await callback(transaction);
        staged.forEach((value, key) => docs.set(key, value));
    }
};

const source = {
    shiftId: 'source-1', start: '08:00', end: '09:30', lop: 'Lớp nguồn', phong: 'P1',
    gvList: [{ id: 'teacher-a', name: 'GV A' }, { id: 'teacher-b', name: 'GV B' }]
};
const target = {
    shiftId: 'target-1', start: '10:00', end: '11:30', lop: 'Lớp đích', phong: 'P2',
    gvList: [{ id: 'teacher-c', name: 'GV C' }]
};
const schedule = { morning1: [source], morning2: [target] };
docs.set(documentKey('schedules', `cs1__${today}`), clone(schedule));

const localValues = new Map([
    ['currentUserId', 'manager-1'],
    ['userFullName', 'Người xếp lịch']
]);
const localStorage = {
    getItem: key => localValues.get(key) || null,
    setItem: (key, value) => localValues.set(key, value)
};
const context = {
    window: {
        db,
        auth: { currentUser: { uid: 'auth-manager' } },
        localStorage,
        TeacherShiftState: state
    },
    db,
    localStorage,
    firebase: { firestore: { FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } } },
    console: { log() {}, warn() {}, error() {} }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'db-service.js'), 'utf8'), context);

const signature = row => [row.start, row.end, row.lop, row.phong].join('|');
const fallback = JSON.stringify(schedule);
const transferPromise = vm.runInContext(`
    DBService.updateScheduleManifest = async () => {};
    DBService._invalidate = () => {};
    DBService.getAuthenticatedAuthorizationContext = async () => ({
        uid: 'auth-manager', userId: 'manager-1', roles: ['admin']
    });
    DBService.transferTeacherBetweenShiftsAtomic([{
        teacherId: 'teacher-a', transferId: 'runtime-transfer', mode: 'temporary',
        effectiveFrom: '${today}', effectiveTo: '${today}', reason: 'Kiểm thử transaction',
        source: {
            compositeKey: 'cs1__${today}', section: 'morning1',
            locator: { index: 0, shiftId: 'source-1', signature: '08:00|09:30|Lớp nguồn|P1' },
            fallbackData: ${fallback}
        },
        target: {
            compositeKey: 'cs1__${today}', section: 'morning2',
            locator: { index: 0, shiftId: 'target-1', signature: '10:00|11:30|Lớp đích|P2' },
            fallbackData: ${fallback}
        }
    }]);
`, context);

transferPromise.then(async result => {
    assert.equal(result.count, 1);
    const committed = docs.get(documentKey('schedules', `cs1__${today}`));
    assert.deepEqual(committed.morning1[0].gvList.map(item => item.id), ['teacher-b']);
    assert.deepEqual(committed.morning2[0].gvList.map(item => item.id), ['teacher-c', 'teacher-a']);
    assert.equal(committed.morning1[0].assignmentTransferHistory.at(-1).event, 'teacher_transfer_out');
    assert.equal(committed.morning2[0].assignmentTransferHistory.at(-1).event, 'teacher_transfer_in');
    assert.deepEqual(committed.morning1[0].teacherAbsences, []);

    const sourceAbsenceDate = dateAfter(today, 1);
    const sourceAbsenceSchedule = {
        morning1: [{
            shiftId: 'source-absence-1', start: '18:00', end: '19:30', lop: 'Toán 5', phong: 'P1',
            gvList: [{ id: 'teacher-a', name: 'GV A' }]
        }],
        morning2: [{
            shiftId: 'target-assisted-1', start: '18:00', end: '19:30', lop: 'Ngữ văn 7', phong: 'P2',
            gvList: [{ id: 'teacher-c', name: 'GV C' }],
            gvThayTeList: [{ id: 'teacher-a', name: 'GV A', replacesTeacherIds: ['teacher-c'] }],
            teacherAbsences: [{
                teacherId: 'teacher-c', teacherName: 'GV C', type: 'VDX', status: 'covered',
                replacementIds: ['teacher-a'], replacementNames: ['GV A']
            }]
        }]
    };
    docs.set(documentKey('schedules', `cs1__${sourceAbsenceDate}`), clone(sourceAbsenceSchedule));
    docs.set(documentKey('attendance_logs', `${sourceAbsenceDate}_teacher-a`), { sessions: [] });
    const checkedSourceShifts = [];
    context.window.ScheduleAttendanceAdmin = {
        workedAttendanceConflictForShift: (_attendance, identity) => {
            checkedSourceShifts.push(identity);
            return { conflict: false };
        }
    };
    const sourceAbsenceFallback = JSON.stringify(sourceAbsenceSchedule);
    const sourceAbsenceResult = await vm.runInContext(`
        DBService.transferTeacherBetweenShiftsAtomic([{
            teacherId: 'teacher-a', transferId: 'runtime-source-absence', mode: 'temporary',
            effectiveFrom: '${sourceAbsenceDate}', effectiveTo: '${sourceAbsenceDate}',
            sourceDisposition: 'absence',
            sourceAbsence: { type: 'VP', reason: 'Điều chuyển sang Ngữ văn 7, chưa có GV thay Toán 5' },
            reason: 'Điều chuyển cố định sang Ngữ văn 7',
            source: {
                compositeKey: 'cs1__${sourceAbsenceDate}', section: 'morning1',
                locator: { index: 0, shiftId: 'source-absence-1', signature: '18:00|19:30|Toán 5|P1' },
                fallbackData: ${sourceAbsenceFallback}
            },
            target: {
                compositeKey: 'cs1__${sourceAbsenceDate}', section: 'morning2',
                locator: { index: 0, shiftId: 'target-assisted-1', signature: '18:00|19:30|Ngữ văn 7|P2' },
                fallbackData: ${sourceAbsenceFallback}
            }
        }]);
    `, context);
    assert.equal(sourceAbsenceResult.count, 1);
    const sourceAbsenceCommitted = docs.get(documentKey('schedules', `cs1__${sourceAbsenceDate}`));
    assert.deepEqual(sourceAbsenceCommitted.morning1[0].gvList.map(item => item.id), ['teacher-a']);
    assert.deepEqual(sourceAbsenceCommitted.morning1[0].teacherAbsences.map(item => ({
        teacherId: item.teacherId, type: item.type, status: item.status
    })), [{ teacherId: 'teacher-a', type: 'VP', status: 'pending' }]);
    assert.equal(sourceAbsenceCommitted.morning1[0].assignmentTransferHistory.at(-1).event,
        'teacher_transfer_source_absence');
    assert.deepEqual(sourceAbsenceCommitted.morning2[0].gvList.map(item => item.id), ['teacher-c', 'teacher-a'],
        'a teacher formerly supporting the target must become a target main teacher');
    assert.deepEqual(sourceAbsenceCommitted.morning2[0].gvThayTeList, []);
    assert.equal(sourceAbsenceCommitted.morning2[0].teacherAbsences[0].status, 'pending');
    assert.deepEqual(JSON.parse(JSON.stringify(checkedSourceShifts)), [{
        dateKey: sourceAbsenceDate,
        start: '18:00',
        end: '19:30',
        shiftId: 'source-absence-1',
        compositeKey: `cs1__${sourceAbsenceDate}`,
        section: 'morning1'
    }], 'source VP/VDX must inspect the exact source attendance shift in-transaction');

    const blockedDate = dateAfter(today, 2);
    docs.set(documentKey('schedules', `cs1__${blockedDate}`), clone(sourceAbsenceSchedule));
    docs.set(documentKey('attendance_logs', `${blockedDate}_teacher-a`), { sessions: [{ checkIn: '18:00' }] });
    context.window.ScheduleAttendanceAdmin = {
        workedAttendanceConflictForShift: () => ({ conflict: true, kind: 'worked' })
    };
    const beforeBlockedTransfer = clone(docs.get(documentKey('schedules', `cs1__${blockedDate}`)));
    await assert.rejects(vm.runInContext(`
        DBService.transferTeacherBetweenShiftsAtomic([{
            teacherId: 'teacher-a', transferId: 'runtime-source-absence-blocked', mode: 'temporary',
            effectiveFrom: '${blockedDate}', effectiveTo: '${blockedDate}',
            sourceDisposition: 'absence',
            sourceAbsence: { type: 'VP', reason: 'Kiểm thử phải chặn khi đã có công' },
            reason: 'Kiểm thử chặn công nguồn',
            source: {
                compositeKey: 'cs1__${blockedDate}', section: 'morning1',
                locator: { index: 0, shiftId: 'source-absence-1', signature: '18:00|19:30|Toán 5|P1' },
                fallbackData: ${sourceAbsenceFallback}
            },
            target: {
                compositeKey: 'cs1__${blockedDate}', section: 'morning2',
                locator: { index: 0, shiftId: 'target-assisted-1', signature: '18:00|19:30|Ngữ văn 7|P2' },
                fallbackData: ${sourceAbsenceFallback}
            }
        }]);
    `, context), /đã có giờ vào\/ra khớp ca nguồn/);
    assert.deepEqual(docs.get(documentKey('schedules', `cs1__${blockedDate}`)), beforeBlockedTransfer,
        'attendance conflict must abort both source and target updates together');
    console.log('teacher-transfer runtime transaction tests passed');
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
