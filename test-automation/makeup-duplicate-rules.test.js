'use strict';
// Real Firestore emulator + real firestore.rules. No production data is used.
// One make-up request per shift, and a request whose hours an admin already
// recorded in Bảng Công is closed without touching attendance or payroll.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');

const root = path.resolve(__dirname, '..');
const dbSource = fs.readFileSync(path.join(root, 'js', 'db-service.js'), 'utf8');
const staffId = 'mk-staff';
const dateKey = '2026-09-15';
const iso = hm => `${dateKey}T${hm}:00+07:00`;

// Same realm as the Firebase SDK (objects from a vm context fail its plain-object
// check), but wrapped in a function so the staff and admin copies stay separate.
const loadService = vm.runInThisContext(`(function (db, firebase, localStorage, window, console) {\n${dbSource}\nreturn DBService;\n})`);
function serviceFor(db, userId) {
    const storage = new Map([['currentUserId', userId]]);
    const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    return loadService(db, firebase, localStorage, {}, { log() {}, warn() {}, error() {}, info() {} });
}

const scheduled = (start, end, extra = {}) => ({
    staffId, staffName: 'Fixture', type: 'scheduled', dateKey, branch: 'cs1',
    shiftLabel: `${start}–${end} CS1 (E4)`, className: 'E4', shiftStart: start, shiftEnd: end, shiftKind: 'gv',
    scheduleLocators: [{ kind: 'gv', compositeKey: `cs1__${dateKey}`, section: 'evening1', rowIndex: 0, shiftId: 'shift-e4', start, end, branch: 'cs1' }],
    session: { checkIn: iso(start), checkOut: iso(end) }, reason: 'Quên chấm công', ...extra
});

(async () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Never run Rules tests against production');
    const env = await initializeTestEnvironment({ projectId: 'demo-timekeeping', firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
    try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await db.collection('user_roles').doc('mk-staff-uid').set({ userId: staffId, role: 'teacher', roles: ['teacher'] });
            await db.collection('user_roles').doc('mk-admin-uid').set({ userId: 'mk-admin', role: 'admin', roles: ['admin'] });
        });
        const staffDb = env.authenticatedContext('mk-staff-uid').firestore();
        const adminDb = env.authenticatedContext('mk-admin-uid').firestore();
        const staff = serviceFor(staffDb, staffId);
        const admin = serviceFor(adminDb, 'mk-admin');

        // Ghi sai ngày: nhân viên tự xóa đơn đang chờ rồi gửi lại được; không xóa được đơn người khác,
        // đơn đã duyệt, hay đơn từng hủy duyệt (phải giữ vết).
        await staff.createMakeupRequests([scheduled('18:00', '21:00')]);
        const wrongId = staff._makeupRequestFixedId(scheduled('18:00', '21:00'));
        await env.withSecurityRulesDisabled(async context => {
            await context.firestore().collection('user_roles').doc('mk-other-uid').set({ userId: 'mk-other', role: 'teacher', roles: ['teacher'] });
        });
        const otherDb = env.authenticatedContext('mk-other-uid').firestore();
        await assert.rejects(otherDb.collection('makeup_requests').doc(wrongId).delete());
        await staff.deleteMakeupRequest(wrongId, 'Fixture');
        assert.equal((await adminDb.collection('makeup_requests').doc(wrongId).get()).exists, false);
        await staff.createMakeupRequests([scheduled('18:00', '21:00')]);
        await adminDb.collection('makeup_requests').doc(wrongId).update({ status: 'approved' });
        await assert.rejects(staffDb.collection('makeup_requests').doc(wrongId).delete());
        await assert.rejects(staff.deleteMakeupRequest(wrongId, 'Fixture'), { code: 'MAKEUP_REQUEST_STALE' });
        await assert.rejects(admin.deleteMakeupRequest(wrongId, 'QL'), { code: 'MAKEUP_REQUEST_STALE' });
        await adminDb.collection('makeup_requests').doc(wrongId).update({ status: 'pending', approvalHistory: [{ action: 'approval_revoked' }] });
        await assert.rejects(staffDb.collection('makeup_requests').doc(wrongId).delete());
        await admin.deleteMakeupRequest(wrongId, 'QL');
        assert.equal((await adminDb.collection('makeup_requests').doc(wrongId).get()).exists, false);

        await staff.createMakeupRequests([scheduled('18:00', '21:00')]);
        await assert.rejects(staff.createMakeupRequests([scheduled('18:00', '21:00')]), { code: 'MAKEUP_DUPLICATE' });
        await assert.rejects(staff.createMakeupRequests([scheduled('19:30', '21:00', { scheduleLocators: [{ kind: 'gv', compositeKey: `cs1__${dateKey}`, section: 'evening2', rowIndex: 0, start: '19:30', end: '21:00' }] })]),
            { code: 'MAKEUP_DUPLICATE' }, 'a sub-span of a pending chain cannot be requested again');
        await assert.rejects(staff.createMakeupRequests([{ ...scheduled('18:30', '20:00'), type: 'unscheduled', scheduleLocators: [], approvedBy: 'Quản lý' }]),
            { code: 'MAKEUP_DUPLICATE' }, 'the "ngoài lịch" tab cannot duplicate a pending shift');
        // Bypass the pre-check (two tabs racing): the fixed ID turns the second write into an
        // update, which only managers may perform.
        const fixedId = staff._makeupRequestFixedId(scheduled('18:00', '21:00'));
        assert.ok(fixedId.startsWith('mks_'));
        await assert.rejects(staffDb.collection('makeup_requests').doc(fixedId).set({ ...scheduled('18:00', '21:00'), status: 'pending' }),
            { code: 'permission-denied' });
        assert.equal((await adminDb.collection('makeup_requests').where('staffId', '==', staffId).get()).size, 1);
        console.log('PASS one request per shift: re-send, sub-span, extra tab and racing tab are all rejected');

        // Morning request, then an admin adds attendance covering it only partially.
        await staff.createMakeupRequests([scheduled('07:30', '09:00', { scheduleLocators: [{ kind: 'gv', compositeKey: `cs1__${dateKey}`, section: 'morning1', rowIndex: 0, start: '07:30', end: '09:00' }] })]);
        await env.withSecurityRulesDisabled(async context => {
            await context.firestore().collection('attendance_logs').doc(`${dateKey}_${staffId}`).set({ userId: staffId, date: dateKey, sessions: [
                { id: 'admin-morning', type: 'admin_add', checkIn: iso('07:30'), checkOut: iso('09:00') },
                { id: 'admin-part', type: 'admin_add', checkIn: iso('18:00'), checkOut: iso('19:30') }
            ] });
        });
        const resolved = await admin.resolveMakeupRequestsCoveredByAttendance(staffId, dateKey, 'Fixture Admin');
        assert.equal(resolved.length, 1, 'only the fully covered request is closed');
        const requests = (await adminDb.collection('makeup_requests').where('staffId', '==', staffId).get()).docs.map(doc => doc.data());
        const morning = requests.find(item => item.shiftStart === '07:30');
        const evening = requests.find(item => item.shiftStart === '18:00');
        assert.equal(morning.status, 'rejected');
        assert.equal(morning.resolution, 'covered_by_attendance');
        assert.deepEqual(morning.resolvedSessionIds, ['admin-morning']);
        assert.equal(evening.status, 'pending', 'a partially covered chain stays for manual review');
        const attendance = (await adminDb.collection('attendance_logs').doc(`${dateKey}_${staffId}`).get()).data();
        assert.equal(attendance.sessions.length, 2, 'closing a request never writes attendance');
        await assert.rejects(staff.createMakeupRequests([scheduled('07:30', '09:00', { scheduleLocators: [{ kind: 'gv', compositeKey: `cs1__${dateKey}`, section: 'morning1', rowIndex: 1, start: '07:30', end: '09:00' }] })]),
            { code: 'MAKEUP_DUPLICATE' }, 'a shift that already has attendance cannot be requested');
        console.log('PASS admin-added attendance closes fully covered requests only, without writing attendance');

        // Rejected → the staff member may send again (new fixed id _r1), but only once at a time.
        const eveningId = (await adminDb.collection('makeup_requests').where('staffId', '==', staffId).get()).docs
            .find(item => item.data().shiftStart === '18:00').id;
        await adminDb.collection('makeup_requests').doc(eveningId).update({ status: 'rejected', rejectReason: 'Thiếu lý do' });
        await env.withSecurityRulesDisabled(context => context.firestore().collection('attendance_logs').doc(`${dateKey}_${staffId}`)
            .update({ sessions: [{ id: 'admin-morning', type: 'admin_add', checkIn: iso('07:30'), checkOut: iso('09:00') }] }));
        await staff.createMakeupRequests([scheduled('18:00', '21:00', { reason: 'Quên mang điện thoại, đã dạy đủ 2 lớp' })]);
        const again = (await adminDb.collection('makeup_requests').where('staffId', '==', staffId).get()).docs
            .find(item => item.data().status === 'pending' && item.data().shiftStart === '18:00');
        assert.ok(again.id.endsWith('_r1'), 'a resubmission gets its own fixed id');
        assert.deepEqual(again.data().resubmissionOf, [eveningId]);
        await assert.rejects(staff.createMakeupRequests([scheduled('18:00', '21:00')]), { code: 'MAKEUP_DUPLICATE' },
            'the resubmission itself cannot be duplicated');
        console.log('PASS a rejected request can be sent again exactly once while pending');

        // Đức Đại 03/10: đơn gộp 18:00–21:00 gửi lúc 18:27, sau đó vào thật ca 19:30 (19:29:59–20:58).
        // Duyệt = chỉ ghi ca còn thiếu, công thật không đổi, đơn giữ vết.
        const chainDate = '2026-10-03';
        const chainStaff = 'mk-chain';
        const chainId = 'mks_chain_fixture';
        const chainLocators = [
            { kind: 'gv', compositeKey: `cs1__${chainDate}`, section: 'evening1', rowIndex: 0, shiftId: 's-e7', start: '18:00', end: '19:30', branch: 'cs1', classId: 'id-e7', className: 'E7' },
            { kind: 'gv', compositeKey: `cs1__${chainDate}`, section: 'evening2', rowIndex: 10, shiftId: 's-m1', start: '19:30', end: '21:00', branch: 'cs1', classId: 'id-m1', className: 'Mover 1' }
        ];
        const chainRequest = {
            staffId: chainStaff, staffName: 'Fixture', type: 'scheduled', dateKey: chainDate, branch: 'cs1', status: 'pending',
            shiftLabel: '18:00–21:00 CS1 (E7 + Mover 1)', className: 'E7 + Mover 1', classNames: ['E7', 'Mover 1'], classId: '', classIds: ['id-e7', 'id-m1'],
            shiftStart: '18:00', shiftEnd: '21:00', shiftKind: 'gv', scheduleLocators: chainLocators,
            session: { checkIn: '2026-10-03T11:00:00.000Z', checkOut: '2026-10-03T14:00:00.000Z', role: null, roleName: 'E7 + Mover 1' }, reason: 'Điện thoại bị mất wifi'
        };
        const realSession = { id: 'real-m1', source: 'self', checkIn: '2026-10-03T12:29:59.823Z', start: '2026-10-03T12:29:59.823Z', checkOut: '2026-10-03T13:58:12.660Z', status: 'closed' };
        const morningSession = { id: 'real-am', source: 'self', checkIn: '2026-10-03T02:15:00.000Z', start: '2026-10-03T02:15:00.000Z', checkOut: '2026-10-03T03:45:00.000Z', status: 'closed' };
        await env.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await db.collection('makeup_requests').doc(chainId).set(chainRequest);
            await db.collection('attendance_logs').doc(`${chainDate}_${chainStaff}`).set({ userId: chainStaff, date: chainDate, sessions: [morningSession, realSession] });
        });
        const split = admin._splitMakeupRequestByAttendance({ id: chainId, ...chainRequest }, [morningSession, realSession]);
        assert.deepEqual(split.keep.map(item => item.className), ['E7']);
        assert.deepEqual(split.covered.map(item => item.className), ['Mover 1']);
        assert.equal(admin._splitMakeupRequestByAttendance({ id: chainId, ...chainRequest }, []), null, 'no attendance: nothing to split');
        assert.equal(admin._splitMakeupRequestByAttendance({ id: chainId, ...chainRequest }, [{ checkIn: chainRequest.session.checkIn, checkOut: chainRequest.session.checkOut }]), null, 'all covered: nothing left to approve');
        assert.equal(admin._splitMakeupRequestByAttendance({ id: chainId, ...chainRequest, scheduleLocators: [chainLocators[0]] }, [realSession]), null, 'single-shift request is a real overlap, never split');
        await assert.rejects(staffDb.collection('makeup_requests').doc(chainId).update({ shiftEnd: '19:30' }), { code: 'permission-denied' });

        const narrowed = await admin.narrowMakeupRequestToMissing(chainId, 'QL');
        assert.equal(narrowed.shiftLabel, '18:00–19:30 CS1 (E7)');
        const liveNarrowed = (await adminDb.collection('makeup_requests').doc(chainId).get()).data();
        assert.equal(liveNarrowed.status, 'pending');
        assert.equal(liveNarrowed.session.checkIn, '2026-10-03T11:00:00.000Z');
        assert.equal(liveNarrowed.session.checkOut, '2026-10-03T12:30:00.000Z');
        assert.deepEqual(liveNarrowed.classIds, ['id-e7']);
        assert.equal(liveNarrowed.classId, 'id-e7');
        assert.equal(liveNarrowed.scheduleLocators.length, 1);
        assert.equal(liveNarrowed.scheduleShiftId, 's-e7');
        assert.equal(liveNarrowed.narrowedFrom.shiftLabel, '18:00–21:00 CS1 (E7 + Mover 1)');
        assert.deepEqual(liveNarrowed.narrowedFrom.coveredSessionIds, ['real-m1']);
        await assert.rejects(admin.narrowMakeupRequestToMissing(chainId, 'QL'), { code: 'MAKEUP_NOT_SPLITTABLE' }, 'running twice changes nothing');

        // The ordinary overlap guard must now accept it (19:29:59 only touches 19:30) and keep the real session.
        const sessionId = await admin.addSession(chainStaff, chainDate, { ...liveNarrowed.session, type: 'makeup', makeupRequestId: chainId, linkedClassStart: '18:00', isAdminEdited: true }, {
            makeupApproval: { requestId: chainId, reviewedBy: 'QL', staffName: 'Fixture', overtimeMinutes: 0 }
        });
        const chainLog = (await adminDb.collection('attendance_logs').doc(`${chainDate}_${chainStaff}`).get()).data();
        assert.equal(chainLog.sessions.length, 3);
        const untouched = chainLog.sessions.find(item => item.id === 'real-m1');
        assert.equal(untouched.checkIn, realSession.checkIn);
        assert.equal(untouched.checkOut, realSession.checkOut);
        assert.equal(chainLog.sessions.find(item => item.id === sessionId).checkOut, '2026-10-03T12:30:00.000Z');
        console.log('PASS chain request narrows to the missing shift; real attendance is untouched');
        console.log('makeup-duplicate-rules.test.js: all assertions passed');
    } finally {
        await env.cleanup();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
