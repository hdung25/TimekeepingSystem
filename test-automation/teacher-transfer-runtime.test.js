const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const state = require(path.join(root, 'js', 'teacher-shift-state.js'));
const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

transferPromise.then(result => {
    assert.equal(result.count, 1);
    const committed = docs.get(documentKey('schedules', `cs1__${today}`));
    assert.deepEqual(committed.morning1[0].gvList.map(item => item.id), ['teacher-b']);
    assert.deepEqual(committed.morning2[0].gvList.map(item => item.id), ['teacher-c', 'teacher-a']);
    assert.equal(committed.morning1[0].assignmentTransferHistory.at(-1).event, 'teacher_transfer_out');
    assert.equal(committed.morning2[0].assignmentTransferHistory.at(-1).event, 'teacher_transfer_in');
    assert.deepEqual(committed.morning1[0].teacherAbsences, []);
    console.log('teacher-transfer runtime transaction tests passed');
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
