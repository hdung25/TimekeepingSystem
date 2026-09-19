'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const main = read('js/main.js');
const dbSource = read('js/db-service.js');
const quiet = { log() {}, warn() {}, error() {} };
const dateKey = date => new Date(date.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const clone = value => JSON.parse(JSON.stringify(value));
const at = hm => new Date(`2026-09-19T${hm}:00+07:00`);
const autoSource = main.slice(main.indexOf('let globalAutoCheckoutInFlight'), main.indexOf('// Khoảng nghỉ TỐI ĐA'));
const resolveSource = main.slice(main.indexOf('const AUTO_CHECKOUT_GAP_MS'), main.indexOf('// Trả về các khúc ca vận hành'));
const resolve = new Function(resolveSource + '\nreturn resolveWorkChainEnd;')();

function autoHarness({ hour = '10:00', session, end = '11:00' } = {}) {
    let currentTime = at(hour).getTime();
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [currentTime])); }
        static now() { return currentTime; }
    }
    const state = {
        userId: 'staff-1',
        session: session === null ? null : session || { id: 's1', checkIn: at('08:00').toISOString(), checkOut: null },
        end: at(end), schedules: 0, writes: [], reads: [], failure: false, window: {}
    };
    const service = {
        _invalidateAttendance() {},
        async getPersonalAttendance(key, userId, options) {
            state.reads.push({ key, userId, options });
            return state.session && dateKey(new Date(state.session.checkIn)) === key
                ? { sessions: [clone(state.session)] } : null;
        },
        async getSystemSettings(options) {
            assert.equal(options.source, 'server');
            state.schedules++;
            return { centerClosures: {} };
        },
        async getCancelledShifts(month, staff, options) {
            assert.equal(options.strict, true);
            return [];
        },
        async checkOutPersonal(userId, cutoff, options) {
            assert.equal(state.window.__autoCheckoutPending, true, 'PWA must not reload while an automatic write is pending');
            state.writes.push({ userId, cutoff: cutoff.toISOString(), options });
            state.session.checkOut = cutoff.toISOString();
        }
    };
    const api = new Function('localStorage', 'DBService', 'getLocalDateKeyFromDate',
        'findReceptionistShiftBlocks', 'findTeachingBlocks', 'resolveWorkChainEnd', 'Date', 'console', 'window',
        autoSource + '\nreturn { globalCheckAutoCheckout };')(
        { getItem: () => state.userId }, service, dateKey,
        async (user, day, cancelled, closures, options) => {
            assert.equal(options.source, 'server');
            assert.ok(options.settings);
            return [];
        },
        async () => {
            if (state.failure) throw new Error('schedule source unavailable');
            return [{ start: new Date(state.session.checkIn), end: state.end }];
        }, resolve, Clock, quiet, state.window);
    return { state, run: options => api.globalCheckAutoCheckout({ refreshUi: false, ...options }),
        setTime: hm => { currentTime = at(hm).getTime(); } };
}

function transactionHarness(sessions, expectedDate = '2026-09-19') {
    const records = new Map([[expectedDate, { userId: 'staff-1', date: expectedDate,
        sessions: clone(sessions), checkIn: sessions.at(-1)?.checkIn, checkOut: sessions.at(-1)?.checkOut,
        preservedNote: 'do not replace admin context' }]]);
    const state = { writes: 0, retryGuard: 0, userId: 'staff-1', authUid: 'uid-1' };
    const db = {
        collection: () => ({ doc: id => ({ key: id.slice(0, 10) }) }),
        async runTransaction(callback) {
            return callback({
                get: async ref => ({ exists: records.has(ref.key), data: () => clone(records.get(ref.key)) }),
                set(ref, data) { state.writes++; records.set(ref.key, clone(data)); }
            });
        }
    };
    const start = dbSource.indexOf('    checkOutPersonal: async');
    const end = dbSource.indexOf('    // 7.1 Manual Add', start);
    const service = new Function('db', 'firebase', 'getLocalDateKeyFromDate', 'localStorage', 'window',
        '_attendanceAuthError', '_runAttendanceFirestoreOperation',
        `const DBService = { _invalidateAttendance() {}, ${dbSource.slice(start, end)} }; return DBService;`)(
        db, { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } }, dateKey,
        { getItem: () => state.userId }, { auth: { get currentUser() { return { uid: state.authUid }; } } },
        (message, code) => Object.assign(new Error(message), { code }),
        async operation => { state.retryGuard++; return operation({ uid: 'uid-1' }); });
    return { service, records, state };
}

(async () => {
    // No open session: no schedule/roster/settings reads, including app resume.
    {
        const h = autoHarness({ session: null });
        assert.equal(await h.run(), false);
        assert.equal(await h.run({ fresh: true }), false);
        assert.equal(h.state.schedules, 0);
        assert.ok(h.state.reads.slice(-2).every(read => read.options.source === 'server'));
    }
    {
        const h = autoHarness({ hour: '12:00', session: {
            id: 'admin-open', checkIn: at('08:00').toISOString(), checkOut: null, isAdminEdited: true
        } });
        assert.equal(await h.run({ fresh: true }), false);
        assert.equal(h.state.schedules, 0, 'do not reinterpret an explicit administrator correction');
        assert.equal(h.state.writes.length, 0);
    }
    // Repeated active checks reuse a bounded snapshot. At its cutoff, a server-side
    // extension must be read before any write (no early checkout for stale rosters).
    {
        const h = autoHarness();
        await h.run();
        await h.run();
        await h.run();
        assert.equal(h.state.schedules, 1);
        h.setTime('10:01');
        h.state.end = at('10:02');
        await h.run({ fresh: true });
        h.state.end = at('12:00');
        h.setTime('10:03');
        assert.equal(await h.run(), false);
        assert.equal(h.state.schedules, 3, 'due cached cutoff requires a server refresh');
        assert.equal(h.state.writes.length, 0, 'extension keeps the current session open');
        h.setTime('10:09');
        await h.run();
        assert.equal(h.state.schedules, 4, 'an active snapshot expires after five minutes');
    }
    // Resume must discover an admin-shortened shift and close at its scheduled end,
    // not at the late reopen time. Observed identity is passed to the transaction.
    {
        const h = autoHarness();
        await h.run();
        h.state.end = at('10:05');
        h.setTime('10:20');
        assert.equal(await h.run({ fresh: true }), true);
        assert.equal(h.state.window.__autoCheckoutPending, false, 'release the update guard after commit');
        assert.equal(h.state.writes[0].cutoff, at('10:05').toISOString());
        assert.deepEqual(h.state.writes[0].options.expectedSession, {
            dateKey: '2026-09-19', id: 's1', checkIn: at('08:00').toISOString(), start: at('08:00').toISOString()
        });
        assert.equal(await h.run(), false);
        assert.equal(h.state.writes.length, 1);
    }
    // A failed source cannot be cached as an empty roster and cannot trigger a
    // partial-workday checkout; the next successful attempt remains retryable.
    {
        const h = autoHarness({ hour: '12:00' });
        h.state.failure = true;
        assert.equal(await h.run(), false);
        assert.equal(h.state.writes.length, 0);
        h.state.failure = false;
        assert.equal(await h.run(), true);
        assert.equal(h.state.schedules, 2);
    }
    // Real collectors propagate failures in automatic strict mode, but preserve
    // their old optional-reader behavior for existing external callers.
    {
        const start = main.indexOf('function isAutoCheckoutShiftClosed');
        const end = main.indexOf('// ================= STAFF NOTIFICATIONS');
        const failure = new Error('offline');
        const service = {
            getReceptionistSchedule: async () => { throw failure; },
            getOfficeSchedule: async () => null,
            getReceptionistShiftConfig: async () => ({}),
            getOfficeShiftConfig: async () => ({}),
            getSchedule: async () => { throw failure; }
        };
        const collectors = new Function('DBService', 'console', main.slice(start, end) +
            '\nreturn { findTeachingBlocks, findReceptionistShiftBlocks };')(service, quiet);
        for (const collect of Object.values(collectors)) {
            await assert.rejects(collect('staff-1', '2026-09-19', [], {}, { source: 'server', settings: {} }), /offline/);
            assert.deepEqual(await collect('staff-1', '2026-09-19'), []);
        }
    }
    const original = { id: 's1', checkIn: at('08:00').toISOString(), start: at('08:00').toISOString(), checkOut: null,
        role: 'subject-1', roleRate: 48000, linkedClassStart: '08:00', bonus10: true, studentCount: 8 };
    const expected = { dateKey: '2026-09-19', id: original.id, checkIn: original.checkIn, start: original.start };
    // Pin the precise session. Existing money/link/count data is preserved; admin
    // corrections, another device's checkout and a different open session abort.
    {
        const h = transactionHarness([original]);
        await h.service.checkOutPersonal('staff-1', at('11:00'), { expectedSession: expected });
        const saved = h.records.get('2026-09-19');
        assert.deepEqual(saved.sessions[0], { ...original, checkOut: at('11:00').toISOString(), status: 'closed', anchorDateKey: '2026-09-19', autoClosedReason: 'scheduled_end' });
        assert.equal(saved.preservedNote, 'do not replace admin context');
        assert.equal(h.state.retryGuard, 1);
    }
    for (const sessions of [
        [{ ...original, isAdminEdited: true }],
        [{ ...original, checkIn: at('08:10').toISOString(), start: at('08:10').toISOString() }],
        [{ ...original, checkOut: at('11:30').toISOString() }],
        [original, { ...original, id: 'another', checkIn: at('09:00').toISOString(), start: at('09:00').toISOString() }]
    ]) {
        const h = transactionHarness(sessions);
        await assert.rejects(h.service.checkOutPersonal('staff-1', at('11:00'), { expectedSession: expected }),
            { code: 'attendance/session-changed' });
        assert.equal(h.state.writes, 0);
        assert.deepEqual(h.records.get('2026-09-19').sessions, sessions);
    }
    {
        const h = transactionHarness([original]);
        h.state.userId = 'staff-2';
        await assert.rejects(h.service.checkOutPersonal('staff-1', at('11:00'), { expectedSession: expected }),
            { code: 'attendance/session-changed' });
        assert.equal(h.state.writes, 0);
    }
    // Overnight work remains in its original attendance document and cannot be
    // closed before the actual scheduled end on the next day.
    {
        const overnight = { id: 'overnight', checkIn: '2026-09-18T16:00:00.000Z', checkOut: null };
        const h = transactionHarness([overnight], '2026-09-18');
        await h.service.checkOutPersonal('staff-1', at('02:00'), { expectedSession: {
            dateKey: '2026-09-18', id: overnight.id, checkIn: overnight.checkIn, start: overnight.checkIn
        } });
        assert.equal(h.records.get('2026-09-18').sessions[0].checkOut, at('02:00').toISOString());
        assert.equal(h.records.size, 1);
    }
    // New strict read options bypass a stale memory result and reject unavailable
    // data without changing the legacy/default readers used across other pages.
    for (const [name, marker, next, args] of [
        ['getPersonalAttendance', '    getPersonalAttendance: async', '    getMonthlySchedule:', ['2026-09-19', 'staff-1']],
        ['getSystemSettings', '    getSystemSettings: async', '    saveSystemSettings:', []]
    ]) {
        let value = { sessions: [], revision: 1 };
        let reads = 0;
        let fail = false;
        const db = { collection: () => ({ doc: () => ({ async get(options) {
            reads++;
            if (fail) throw new Error('offline');
            if (reads > 1) assert.equal(options.source, 'server');
            return { exists: true, data: () => clone(value) };
        } }) }) };
        const section = dbSource.slice(dbSource.indexOf(marker), dbSource.indexOf(next, dbSource.indexOf(marker)));
        const service = new Function('db', 'console', `const DBService = { _cache: {}, ${section} }; return DBService;`)(db, quiet);
        assert.equal((await service[name](...args)).revision, 1);
        value.revision = 2;
        assert.equal((await service[name](...args)).revision, 1, 'default caching stays compatible');
        assert.equal((await service[name](...args, { source: 'server' })).revision, 2);
        fail = true;
        await assert.rejects(service[name](...args, { source: 'server' }), /offline/);
    }
    console.log('auto-checkout-freshness.test.js: all assertions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
