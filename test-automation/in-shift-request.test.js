// Đơn "Dạy thay trong ca tiếp tân" do nhân viên tự gửi (v280). Chị Thuý 11/11: thay vì nhắn
// quản lý tạo phần dạy thay, nhân viên tự bấm tạo, quản lý (Thuý/Diễm) duyệt như tường trình.
// Kiểm tra tầng dữ liệu: đủ trường, khớp ca tiếp tân, không bị coi là "đã có công" vì ca tiếp
// tân chủ, duyệt ghi đúng một phần dạy inShiftTeaching (ca tiếp tân gốc giữ nguyên), duyệt lại
// không nhân đôi, trùng lớp trong lịch thì chặn, hủy duyệt chỉ gỡ đúng phần đó.
process.env.TZ = 'Asia/Ho_Chi_Minh';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dbServiceSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-service.js'), 'utf8');
const staffId = 'nv_huy';
const dateKey = '2026-11-10';
const requestId = 'req-inshift-1';
const clone = value => JSON.parse(JSON.stringify(value));
const eq = (actual, expected, message) => assert.deepEqual(clone(actual), clone(expected), message);

const host = () => ({
    id: 'huy-reception', source: 'self', status: 'closed', role: 'tiep-tan', roleName: 'Tiếp Tân',
    start: `${dateKey}T13:29:41+07:00`, checkIn: `${dateKey}T13:29:41+07:00`, checkOut: `${dateKey}T18:00:20+07:00`
});
const request = (extra = {}) => ({
    staffId, staffName: 'Huy', type: 'in_shift_teaching', status: 'pending', dateKey, branch: 'cs1',
    className: 'E3 + Pre I1', classNames: ['E3', 'Pre I1'], classIds: ['subject-e3', 'subject-pre'], classId: '',
    hostSessionId: 'huy-reception',
    hostClock: { checkIn: host().checkIn, checkOut: host().checkOut, label: 'Tiếp Tân' },
    approvedBy: 'Chị Thuý', shiftStart: '15:00', shiftEnd: '16:30',
    shiftLabel: '15:00–16:30 CS1 (E3 + Pre I1) · dạy thay trong ca tiếp tân',
    session: { checkIn: `${dateKey}T15:00:00+07:00`, checkOut: `${dateKey}T16:30:00+07:00`, role: 'subject-e3+subject-pre', roleName: 'E3 + Pre I1' },
    reason: 'Cô Lan nghỉ đột xuất',
    ...extra
});

function createHarness() {
    const state = {
        requests: { [requestId]: request() },
        attendance: { userId: staffId, name: 'Huy', date: dateKey, sessions: [host()] },
        schedule: {},
        notifications: [],
        overtime: {},
        monthly: null,
        written: []
    };
    const snapshot = (id, value) => ({ id, exists: value !== undefined && value !== null, data: () => value });
    const readRef = ref => {
        if (ref.collectionName === 'makeup_requests') return snapshot(ref.id, state.requests[ref.id]);
        if (ref.collectionName === 'attendance_logs') return snapshot(ref.id, ref.id === `${dateKey}_${staffId}` ? state.attendance : null);
        if (ref.collectionName === 'overtime_requests') return snapshot(ref.id, state.overtime[ref.id]);
        if (ref.collectionName === 'salary_settings_monthly') return snapshot(ref.id, state.monthly);
        if (ref.collectionName === 'users') return snapshot(ref.id, {
            name: 'Huy', salary_config: { attendance_rate: 90000, roles: [{ id: 'subject-e3', name: 'E3', rate: 100000 }, { id: 'subject-pre', name: 'Pre I1', rate: 120000 }] }
        });
        return snapshot(ref.id, null);
    };
    const writeRef = (ref, payload, merge) => {
        state.written.push(ref.collectionName + '/' + ref.id);
        if (ref.collectionName === 'attendance_logs') state.attendance = clone(payload);
        else if (ref.collectionName === 'makeup_requests') {
            state.requests[ref.id] = merge ? { ...state.requests[ref.id], ...clone(payload) } : clone(payload);
        } else if (ref.collectionName === 'overtime_requests') state.overtime[ref.id] = clone(payload);
        else if (ref.collectionName === 'salary_settings_monthly') state.monthly = { ...(state.monthly || {}), ...clone(payload) };
    };
    let autoId = 0;
    const makeRef = (collectionName, id) => ({
        id, collectionName,
        get: async () => readRef({ collectionName, id }),
        set: async (payload, options) => writeRef({ collectionName, id }, payload, !!options?.merge),
        update: async payload => writeRef({ collectionName, id }, payload, true)
    });
    const db = {
        collection: collectionName => ({
            doc: id => makeRef(collectionName, id || `auto-${++autoId}`),
            where: (field, op, value) => ({
                limit: () => ({ get: async () => ({ docs: [] }) }),
                get: async () => {
                    if (collectionName !== 'makeup_requests') return { docs: [] };
                    return {
                        docs: Object.entries(state.requests)
                            .filter(([, data]) => data && data[field] === value)
                            .map(([id, data]) => ({ id, data: () => data }))
                    };
                }
            })
        }),
        batch: () => {
            const ops = [];
            return {
                set: (ref, payload) => ops.push(() => writeRef(ref, payload, false)),
                commit: async () => ops.forEach(fn => fn())
            };
        },
        runTransaction: async callback => callback({
            get: async ref => readRef(ref),
            set: (ref, payload, options) => writeRef(ref, payload, !!options?.merge),
            update: (ref, payload) => writeRef(ref, payload, true),
            delete: ref => { delete state.requests[ref.id]; }
        })
    };
    const context = {
        console, Date, Math, Set, Map, Promise, Intl, setTimeout, clearTimeout, AbortController,
        fetch: async () => ({ ok: false }),
        window: { db },
        db,
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
        navigator: {},
        localStorage: { getItem: () => null, setItem: () => {} }
    };
    vm.createContext(context);
    vm.runInContext(dbServiceSource, context);
    const DBService = vm.runInContext('DBService', context);
    DBService.getSchedule = async () => state.schedule;
    DBService.getSubjects = async () => [{ id: 'subject-e3', name: 'E3' }, { id: 'subject-pre', name: 'Pre I1' }];
    DBService.createAdminNotification = async (...args) => { state.notifications.push(args); };
    DBService.validateMakeupRequestForApproval = async () => { throw new Error('regular make-up validation must not run for in-shift requests'); };
    return { state, DBService };
}

async function expectCode(factory, code) {
    await assert.rejects(factory, error => { assert.equal(error.code, code, error.message); return true; });
}

(async () => {
    // 1) Đủ trường / thiếu trường.
    {
        const { DBService } = createHarness();
        eq(DBService.missingMakeupFields(request()), []);
        eq(DBService.missingMakeupFields(request({ approvedBy: '', hostSessionId: '' })), ['ca tiếp tân', 'người nhờ dạy thay']);
        eq(DBService.missingMakeupFields(request({ session: { ...request().session, role: '' } })), ['môn/lớp']);
        console.log('PASS required fields');
    }

    // 2) Ca tiếp tân chủ: nằm trong giờ thì hợp lệ; lấn ra ngoài / ca không còn → báo lỗi.
    {
        const { DBService } = createHarness();
        const sessions = [host()];
        assert.equal(DBService.inShiftHostProblem(request(), sessions), '');
        assert.match(DBService.inShiftHostProblem(request({ session: { ...request().session, checkOut: `${dateKey}T19:00:00+07:00` } }), sessions), /nằm trong giờ vào\/ra/);
        assert.match(DBService.inShiftHostProblem(request(), []), /Không còn thấy ca tiếp tân/);
        assert.match(DBService.inShiftHostProblem(request(), [{ ...host(), adminPayrollOverride: { mode: 'manual' } }]), /phân bổ lương Admin/);
        assert.equal(DBService.isInShiftHostCandidate(host()), true);
        assert.equal(DBService.isInShiftHostCandidate({ ...host(), role: 'subject-e3' }), false);
        assert.equal(DBService.isInShiftHostCandidate({ ...host(), role: '' }, false), false);
        assert.equal(DBService.isInShiftHostCandidate({ ...host(), role: '' }, true), true);
        console.log('PASS host checks');
    }

    // 3) Ca tiếp tân chủ không phải "đã có công trùng giờ"; phần dạy thay đã ghi thì có.
    {
        const { DBService } = createHarness();
        const part = { id: 'part-1', inShiftTeaching: true, hostSessionId: 'huy-reception', checkIn: `${dateKey}T15:30:00+07:00`, checkOut: `${dateKey}T16:00:00+07:00`, role: 'subject-e3' };
        assert.equal(DBService.makeupAttendanceClash(request(), [host()]), null);
        assert.equal(DBService.makeupAttendanceClash(request(), [host(), part]).id, 'part-1');
        // Đơn chấm bù thường vẫn coi ca tiếp tân là đã có công như trước.
        const regular = { ...request(), type: 'unscheduled' };
        assert.equal(DBService.makeupAttendanceClash(regular, [host()]).id, 'huy-reception');
        // Chỉ phần dạy thay mới "phủ" đơn dạy thay; ca tiếp tân thì không.
        const span = DBService._makeupRequestSpan(request());
        assert.equal(DBService._sessionsCoveringSpan(DBService.makeupCoverCandidates(request(), [host()]), span, requestId), null);
        const full = { ...part, checkIn: `${dateKey}T15:00:00+07:00`, checkOut: `${dateKey}T16:30:00+07:00` };
        eq(DBService._sessionsCoveringSpan(DBService.makeupCoverCandidates(request(), [host(), full]), span, requestId), ['part-1']);
        console.log('PASS clash / cover rules');
    }

    // 4) Gửi đơn: ca tiếp tân từng được chấm bù (đơn thường đã duyệt) không chặn đơn dạy thay.
    {
        const { state, DBService } = createHarness();
        state.requests = {
            'old-makeup': { staffId, type: 'scheduled', status: 'approved', dateKey,
                session: { checkIn: `${dateKey}T13:30:00+07:00`, checkOut: `${dateKey}T18:00:00+07:00` } }
        };
        const { id, status, ...fresh } = { ...request() };
        await DBService.createMakeupRequests([fresh]);
        const created = Object.entries(state.requests).filter(([key]) => key !== 'old-makeup');
        assert.equal(created.length, 1);
        assert.equal(created[0][1].status, 'pending');
        assert.equal(created[0][1].type, 'in_shift_teaching');
        // Gửi lần hai cùng giờ → chặn (đã có đơn đang chờ).
        await expectCode(() => DBService.createMakeupRequests([fresh]), 'MAKEUP_DUPLICATE');
        // Giờ ngoài ca tiếp tân → chặn.
        await expectCode(() => DBService.createMakeupRequests([{ ...fresh, session: { ...fresh.session, checkIn: `${dateKey}T17:30:00+07:00`, checkOut: `${dateKey}T19:00:00+07:00` } }]), 'MAKEUP_DUPLICATE');
        console.log('PASS submit checks');
    }

    // 5) Quản lý đã ghi tay phần dạy thay → đơn tự đóng; chỉ có ca tiếp tân thì KHÔNG tự đóng.
    {
        const { state, DBService } = createHarness();
        eq(await DBService.resolveMakeupRequestsCoveredByAttendance(staffId, dateKey, 'Admin'), []);
        assert.equal(state.requests[requestId].status, 'pending', 'ca tiếp tân không được tự đóng đơn dạy thay');
        state.attendance.sessions.push({ id: 'manual-part', inShiftTeaching: true, hostSessionId: 'huy-reception',
            checkIn: `${dateKey}T15:00:00+07:00`, checkOut: `${dateKey}T16:30:00+07:00`, role: 'subject-e3' });
        eq(await DBService.resolveMakeupRequestsCoveredByAttendance(staffId, dateKey, 'Admin'), [requestId]);
        assert.equal(state.requests[requestId].resolution, 'covered_by_attendance');
        console.log('PASS covered auto-close only by a recorded in-shift part');
    }

    // 6) Duyệt: ghi đúng một phần dạy thay, ca tiếp tân giữ nguyên; duyệt lại không nhân đôi.
    {
        const { state, DBService } = createHarness();
        const sid = await DBService.approveMakeupRequest({ id: requestId, staffId, dateKey, type: 'in_shift_teaching' }, 'Ngọc Thuý', { payoutMonth: '2026-12' });
        assert.ok(sid);
        assert.equal(state.attendance.sessions.length, 2);
        eq(state.attendance.sessions[0], host(), 'ca tiếp tân gốc giữ nguyên');
        const part = state.attendance.sessions[1];
        assert.equal(part.id, sid);
        assert.equal(part.inShiftTeaching, true);
        assert.equal(part.hostSessionId, 'huy-reception');
        assert.equal(part.makeupRequestId, requestId);
        assert.equal(part.type, 'admin_add');
        assert.equal(part.role, 'subject-e3+subject-pre');
        assert.equal(part.roleName, 'E3 + Pre I1');
        assert.equal(part.roleRate, 120000, 'lớp ghép lấy đơn giá môn cao nhất');
        assert.equal(part.payoutMonth, undefined, 'dạy thay tính vào tháng dạy');
        assert.equal(part.checkIn, `${dateKey}T15:00:00+07:00`);
        assert.equal(part.checkOut, `${dateKey}T16:30:00+07:00`);
        assert.equal(state.requests[requestId].status, 'approved');
        assert.equal(state.requests[requestId].materializedSessionId, sid);
        assert.equal(state.requests[requestId].reviewedBy, 'Ngọc Thuý');
        assert.ok(state.notifications.some(args => args[2] === 'makeup_approved'));
        const again = await DBService.approveMakeupRequest({ id: requestId, staffId, dateKey, type: 'in_shift_teaching' }, 'Ngọc Thuý');
        assert.equal(again, sid);
        assert.equal(state.attendance.sessions.length, 2, 'duyệt lại không tạo phần thứ hai');

        // 7) Hủy duyệt: chỉ gỡ đúng phần dạy thay, đơn về Chờ duyệt.
        await DBService.revokeMakeupApproval(requestId, 'Admin', 'kiểm tra');
        eq(state.attendance.sessions, [host()]);
        assert.equal(state.requests[requestId].status, 'pending');
        console.log('PASS approve / idempotent / revoke');
    }

    // 8) Trùng lớp trong lịch của chính nhân viên → chặn, không ghi gì.
    {
        const { state, DBService } = createHarness();
        state.schedule = { afternoon2: [{ start: '16:00', end: '17:30', lop: 'FFS1', lopId: 'ffs1', gvId: staffId, gvList: [{ id: staffId }] }] };
        await expectCode(() => DBService.approveMakeupRequest({ id: requestId, staffId, dateKey, type: 'in_shift_teaching' }, 'Admin'), 'IN_SHIFT_SCHEDULED_CLASH');
        eq(state.attendance.sessions, [host()]);
        assert.equal(state.requests[requestId].status, 'pending');
        // Lớp đã tắt hoặc của GV khác không chặn.
        state.schedule.afternoon2[0].isClosed = true;
        state.schedule.afternoon1 = [{ start: '15:00', end: '16:30', lop: 'E3', gvId: 'nv_lan', gvList: [{ id: 'nv_lan' }] }];
        await DBService.approveMakeupRequest({ id: requestId, staffId, dateKey, type: 'in_shift_teaching' }, 'Admin');
        assert.equal(state.attendance.sessions.length, 2);
        console.log('PASS scheduled-class clash refused');
    }

    // 9) Ca tiếp tân đã bị xóa / đơn đã từ chối → không duyệt được, không ghi gì.
    {
        const { state, DBService } = createHarness();
        state.attendance.sessions = [];
        await expectCode(() => DBService.approveMakeupRequest({ id: requestId, staffId, dateKey, type: 'in_shift_teaching' }, 'Admin'), 'IN_SHIFT_HOST_MISSING');
        eq(state.attendance.sessions, []);
        assert.equal(state.requests[requestId].status, 'pending');
        state.requests[requestId].status = 'rejected';
        await expectCode(() => DBService.approveMakeupRequest({ id: requestId, staffId, dateKey, type: 'in_shift_teaching' }, 'Admin'), 'MAKEUP_REQUEST_STALE');
        console.log('PASS missing host / stale request refused');
    }

    console.log('in-shift-request.test.js: all assertions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
