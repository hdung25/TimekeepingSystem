const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-service.js'), 'utf8');
let savedPayload = null;
const docRef = { id: '2026-08_staff-a' };
const db = {
    collection: () => ({ doc: () => docRef }),
    runTransaction: async callback => callback({
        get: async () => ({
            exists: true,
            data: () => ({
                userId: 'staff-a',
                month: '2026-08',
                shifts: ['cs1_2026-08-17_morning_mon', 'keep-this-shift']
            })
        }),
        set: (_ref, payload) => { savedPayload = payload; }
    })
};
const context = {
    console,
    Date,
    Math,
    Set,
    Map,
    Promise,
    fetch: async () => ({ ok: false }),
    window: { db },
    db,
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
    navigator: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout,
    clearTimeout,
    AbortController
};
vm.createContext(context);
vm.runInContext(source, context);

const DBService = vm.runInContext('DBService', context);
const isMainTeacherAbsentFromClass = vm.runInContext('isMainTeacherAbsentFromClass', context);

(async () => {
    await DBService.restoreCancelledShift(
        '2026-08',
        'staff-a',
        'cs1_2026-08-17_morning_mon'
    );
    assert.deepEqual(Array.from(savedPayload.shifts), ['keep-this-shift']);
    assert.equal(savedPayload.userId, 'staff-a');
    assert.equal(savedPayload.month, '2026-08');

    const legacy = {
        gvId: 'teacher-a',
        gvThayTeList: [{ id: 'teacher-sub' }]
    };
    assert.equal(isMainTeacherAbsentFromClass(legacy, 'teacher-a'), true,
        'dữ liệu cũ vẫn suy đoán theo GV thay thế');

    const pending = {
        ...legacy,
        teacherAbsences: [{ teacherId: 'teacher-a', status: 'pending', type: 'VP' }]
    };
    assert.equal(isMainTeacherAbsentFromClass(pending, 'teacher-a'), true,
        'trạng thái chờ người thay là một ca nghỉ rõ ràng');

    const restored = { ...legacy, teacherAbsences: [] };
    assert.equal(isMainTeacherAbsentFromClass(restored, 'teacher-a'), false,
        'mảng rõ ràng rỗng phải thắng suy đoán dữ liệu cũ sau khi khôi phục');

    console.log('absence recovery regression tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
