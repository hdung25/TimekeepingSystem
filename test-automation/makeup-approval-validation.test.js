const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dbServiceSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-service.js'), 'utf8');
const resolver = require('../js/shift-absence-state.js');

const staffId = 'nv_1776091622276'; // Võ Quang Mỹ
const dateKey = '2026-08-17';
const requestId = 'makeup-my-bth-20260817';
const compositeKey = 'cs1__2026-08-17';
const cancelKey = `${compositeKey}_afternoon1_0`;

const clone = value => JSON.parse(JSON.stringify(value));
const activeBth = () => ({
    start: '14:30',
    end: '16:30',
    lop: 'BTH',
    lopId: 'ZQuEuI65dg9hthIVnzlZ',
    shiftId: 'shift-bth',
    gvId: staffId,
    gvList: [{ id: staffId, name: 'Võ Quang Mỹ' }],
    gvThayTeList: [],
    teacherAbsences: []
});

const pendingRequest = () => ({
    staffId,
    staffName: 'Võ Quang Mỹ',
    type: 'scheduled',
    status: 'pending',
    dateKey,
    branch: 'cs1',
    shiftLabel: '14:30–16:30 CS1 (BTH)',
    className: 'BTH',
    classId: 'ZQuEuI65dg9hthIVnzlZ',
    shiftStart: '14:30',
    shiftEnd: '16:30',
    shiftKind: 'gv',
    scheduleLocators: [{
        kind: 'gv',
        compositeKey,
        section: 'afternoon1',
        rowIndex: 0,
        shiftId: 'shift-bth',
        start: '14:30',
        end: '16:30',
        branch: 'cs1',
        classId: 'ZQuEuI65dg9hthIVnzlZ',
        className: 'BTH'
    }],
    session: {
        checkIn: '2026-08-17T14:30:00+07:00',
        checkOut: '2026-08-17T16:30:00+07:00',
        overtimeMinutes: 30
    },
    reason: 'Quên chấm công'
});

function createHarness() {
    const state = {
        request: pendingRequest(),
        attendance: { userId: staffId, name: 'Võ Quang Mỹ', date: dateKey, note: 'Vắng phép', sessions: [] },
        cancelled: { userId: staffId, month: '2026-08', shifts: [] },
        schedule: { afternoon1: [activeBth()] },
        receptionistSchedule: {
            afternoon: { mon: [{ id: staffId, name: 'Võ Quang Mỹ' }] },
            _shiftConfig: { afternoon: { start: '14:00', end: '18:00' } }
        },
        overtime: {},
        serverReads: [],
        scheduleReads: [],
        operationalReads: []
    };

    const snapshot = (id, value) => ({
        id,
        exists: value !== undefined && value !== null,
        data: () => value
    });
    const readRef = ref => {
        if (ref.collectionName === 'makeup_requests') return snapshot(ref.id, state.request);
        if (ref.collectionName === 'attendance_logs') return snapshot(ref.id, state.attendance);
        if (ref.collectionName === 'cancelled_shifts') return snapshot(ref.id, state.cancelled);
        if (ref.collectionName === 'overtime_requests') return snapshot(ref.id, state.overtime[ref.id]);
        if (ref.collectionName === 'users') return snapshot(ref.id, { name: 'Võ Quang Mỹ' });
        return snapshot(ref.id, null);
    };
    const writeRef = (ref, payload, merge) => {
        if (ref.collectionName === 'attendance_logs') state.attendance = clone(payload);
        else if (ref.collectionName === 'makeup_requests') {
            state.request = merge ? { ...state.request, ...clone(payload) } : clone(payload);
        } else if (ref.collectionName === 'overtime_requests') {
            const current = state.overtime[ref.id] || {};
            state.overtime[ref.id] = merge ? { ...current, ...clone(payload) } : clone(payload);
        }
    };
    const makeRef = (collectionName, id) => ({
        id,
        collectionName,
        path: `${collectionName}/${id}`,
        get: async options => {
            if (options?.source === 'server') state.serverReads.push(`${collectionName}/${id}`);
            return readRef({ collectionName, id });
        },
        set: async (payload, options) => writeRef({ collectionName, id }, payload, !!options?.merge),
        update: async payload => writeRef({ collectionName, id }, payload, true)
    });
    const db = {
        collection: collectionName => ({
            doc: id => makeRef(collectionName, id)
        }),
        runTransaction: async callback => callback({
            get: async ref => readRef(ref),
            set: (ref, payload, options) => writeRef(ref, payload, !!options?.merge),
            update: (ref, payload) => writeRef(ref, payload, true)
        })
    };
    const context = {
        console,
        Date,
        Math,
        Set,
        Map,
        Promise,
        Intl,
        fetch: async () => ({ ok: false }),
        window: { db, ShiftAbsenceState: resolver },
        db,
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
        navigator: {},
        localStorage: { getItem: () => null, setItem: () => {} },
        setTimeout,
        clearTimeout,
        AbortController
    };
    vm.createContext(context);
    vm.runInContext(dbServiceSource, context);
    const DBService = vm.runInContext('DBService', context);
    DBService.getSchedule = async (key, options) => {
        state.scheduleReads.push({ key, source: options?.source || '' });
        return state.schedule;
    };
    DBService.getReceptionistSchedule = async (key, options) => {
        state.operationalReads.push({ kind: 'tt', key, source: options?.source || '' });
        return state.receptionistSchedule;
    };
    return { state, DBService };
}

async function expectCode(promiseFactory, code) {
    await assert.rejects(promiseFactory, error => {
        assert.equal(error.code, code);
        return true;
    });
}

(async () => {
    {
        const { state, DBService } = createHarness();
        const result = await DBService.validateMakeupRequestForApproval({ id: requestId, staffId, dateKey });
        assert.equal(result.alreadyApproved, false);
        assert.equal(result.resolvedStates.length, 1);
        assert.equal(result.resolvedStates[0].isAbsent, false,
            'BTH remains eligible even though the day-level note says Vắng phép');
        assert.deepEqual(state.scheduleReads, [{ key: compositeKey, source: 'server' }]);
        assert.ok(state.serverReads.includes(`makeup_requests/${requestId}`));
        assert.ok(state.serverReads.includes(`attendance_logs/${dateKey}_${staffId}`));
        assert.ok(state.serverReads.includes(`cancelled_shifts/2026-08_${staffId}`));
    }

    {
        const { state, DBService } = createHarness();
        // `getSchedule` regenerates shiftId when it materializes an inherited
        // weekly template. The stable locator fields must still identify BTH.
        state.schedule.afternoon1[0].shiftId = 'shift-bth-regenerated-on-fresh-read';
        const result = await DBService.validateMakeupRequestForApproval({ id: requestId, staffId, dateKey });
        assert.equal(result.resolvedStates[0].isAbsent, false);
    }

    {
        const { state, DBService } = createHarness();
        state.schedule.afternoon1[0].teacherAbsences = [{ teacherId: staffId, type: 'VP' }];
        await expectCode(
            () => DBService.validateMakeupRequestForApproval({ id: requestId, staffId, dateKey }),
            'MAKEUP_SHIFT_NOT_ELIGIBLE'
        );
    }

    {
        const { state, DBService } = createHarness();
        state.cancelled.shifts = [cancelKey];
        await expectCode(
            () => DBService.validateMakeupRequestForApproval({ id: requestId, staffId, dateKey }),
            'MAKEUP_SHIFT_NOT_ELIGIBLE'
        );
    }

    {
        const { state, DBService } = createHarness();
        state.attendance.sessions = [{
            id: 'absent-toan-3',
            isAbsent: true,
            checkIn: '2026-08-17T07:30:00+07:00',
            checkOut: '2026-08-17T09:00:00+07:00',
            linkedClassStart: '07:30'
        }];
        const result = await DBService.validateMakeupRequestForApproval({ id: requestId, staffId, dateKey });
        assert.equal(result.resolvedStates[0].isAbsent, false,
            'an absent Toán 3 session must not leak into BTH');

        state.attendance.sessions[0].linkedClassStart = '14:30';
        await expectCode(
            () => DBService.validateMakeupRequestForApproval({ id: requestId, staffId, dateKey }),
            'MAKEUP_SHIFT_NOT_ELIGIBLE'
        );
    }

    {
        const { state, DBService } = createHarness();
        state.schedule.afternoon1 = [];
        await expectCode(
            () => DBService.validateMakeupRequestForApproval({ id: requestId, staffId, dateKey }),
            'MAKEUP_REQUEST_STALE'
        );
    }

    {
        const { state, DBService } = createHarness();
        state.request = {
            ...pendingRequest(),
            shiftKind: 'tt',
            shiftKey: 'afternoon',
            shiftStart: '14:00',
            shiftEnd: '18:00',
            className: '',
            classId: '',
            scheduleLocators: [{
                kind: 'tt', compositeKey: 'cs1__2026-08-17', section: 'afternoon',
                dayKey: 'mon', start: '14:00', end: '18:00', branch: 'cs1'
            }],
            session: {
                checkIn: '2026-08-17T14:00:00+07:00',
                checkOut: '2026-08-17T18:00:00+07:00',
                role: 'tiep-tan',
                linkedReceptionistShift: 'afternoon'
            }
        };
        const active = await DBService.validateMakeupRequestForApproval({ id: requestId, staffId, dateKey });
        assert.equal(active.resolvedStates[0].isAbsent, false,
            'day note alone does not block an active receptionist shift');
        assert.deepEqual(state.operationalReads, [{
            kind: 'tt', key: 'cs1__2026-08-17', source: 'server'
        }]);

        state.cancelled.shifts = ['cs1_2026-08-17_afternoon_mon'];
        await expectCode(
            () => DBService.validateMakeupRequestForApproval({ id: requestId, staffId, dateKey }),
            'MAKEUP_SHIFT_NOT_ELIGIBLE'
        );
    }

    {
        const { state, DBService } = createHarness();
        const sessionId = await DBService.approveMakeupRequest(
            { id: requestId, staffId, dateKey },
            'Admin Diễm'
        );
        assert.ok(sessionId);
        assert.equal(state.request.status, 'approved');
        assert.equal(state.request.materializedSessionId, sessionId);
        assert.equal(state.attendance.sessions.length, 1);
        assert.equal(state.attendance.sessions[0].makeupRequestId, requestId);
        assert.equal(state.attendance.sessions[0].linkedScheduleShiftId, 'shift-bth');
        assert.equal(state.overtime[`makeup_${requestId}`].sessionId, sessionId);

        // A retry after an uncertain network response is a safe no-op.
        const retryId = await DBService.approveMakeupRequest(
            { id: requestId, staffId, dateKey },
            'Admin Diễm'
        );
        assert.equal(retryId, sessionId);
        assert.equal(state.attendance.sessions.length, 1);
        assert.equal(Object.keys(state.overtime).length, 1);
    }

    {
        const { state, DBService } = createHarness();
        DBService.getSchedule = async () => {
            // Simulate another admin rejecting after the fresh schedule read but
            // before the materialization transaction starts.
            state.request.status = 'rejected';
            return state.schedule;
        };
        await expectCode(
            () => DBService.approveMakeupRequest({ id: requestId, staffId, dateKey }, 'Admin Diễm'),
            'MAKEUP_REQUEST_STALE'
        );
        assert.equal(state.attendance.sessions.length, 0,
            'request status and attendance are re-read together before any write');
    }

    console.log('makeup-approval-validation.test.js: all assertions passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
