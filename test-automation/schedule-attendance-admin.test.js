const assert = require('node:assert/strict');
const AdminAttendance = require('../js/schedule-attendance-admin.js');

const {
    buildShiftWindow,
    toDateTimeLocal,
    resolveSessionForShift,
    workedAttendanceConflictForShift,
    fingerprintSession,
    createDraft,
    validateDraft,
    previewState
} = AdminAttendance;

function localValue(dateKey, hm) {
    return `${dateKey}T${hm}:00`;
}

// Public surface is explicit and CommonJS-compatible while the same file also
// installs window.ScheduleAttendanceAdmin in a browser.
assert.deepEqual(
    Object.keys(AdminAttendance).sort(),
    [
        'buildShiftWindow',
        'createDraft',
        'fingerprintSession',
        'previewState',
        'resolveSessionForShift',
        'workedAttendanceConflictForShift',
        'toDateTimeLocal',
        'validateDraft'
    ].sort()
);

// The staffing transaction shares the exact session resolver with the chip.
// Worked or ambiguous evidence blocks VP/VĐX, while a source session already
// marked absent is not treated as worked time.
{
    const shift = {
        dateKey: '2026-09-01', shiftId: 'shift-a', compositeKey: 'cs1__2026-09-01',
        section: 'evening2', start: '19:30', end: '21:00'
    };
    const worked = workedAttendanceConflictForShift({
        sessions: [{
            id: 'worked', linkedScheduleShiftId: 'shift-a',
            checkIn: localValue('2026-09-01', '19:30'),
            checkOut: localValue('2026-09-01', '21:00')
        }]
    }, shift);
    assert.equal(worked.conflict, true);
    assert.equal(worked.kind, 'worked');

    const sourceAbsent = workedAttendanceConflictForShift({
        sessions: [{
            id: 'absent-source', linkedScheduleShiftId: 'shift-a', isAbsent: true,
            checkIn: localValue('2026-09-01', '19:30'),
            checkOut: localValue('2026-09-01', '21:00')
        }]
    }, shift);
    assert.equal(sourceAbsent.conflict, false);

    const absentExactLinkMustNotHideWorkedOverlap = workedAttendanceConflictForShift({
        sessions: [
            {
                id: 'absent-exact', linkedScheduleShiftId: 'shift-a', isAbsent: true,
                checkIn: localValue('2026-09-01', '19:30'),
                checkOut: localValue('2026-09-01', '21:00')
            },
            {
                id: 'worked-overlap',
                checkIn: localValue('2026-09-01', '19:35'),
                checkOut: localValue('2026-09-01', '20:55')
            }
        ]
    }, shift);
    assert.equal(absentExactLinkMustNotHideWorkedOverlap.conflict, true,
        'an exact-linked absence marker must not hide a second worked session');
    assert.equal(absentExactLinkMustNotHideWorkedOverlap.session.id, 'worked-overlap');

    const legacy = workedAttendanceConflictForShift({
        checkIn: localValue('2026-09-01', '19:30'),
        checkOut: localValue('2026-09-01', '21:00')
    }, { ...shift, shiftId: '' });
    assert.equal(legacy.conflict, true, 'legacy top-level checkIn/checkOut must also block absence');

    const ambiguous = workedAttendanceConflictForShift({
        sessions: [
            { id: 'a', checkIn: localValue('2026-09-01', '19:30'), checkOut: localValue('2026-09-01', '20:30') },
            { id: 'b', checkIn: localValue('2026-09-01', '19:45'), checkOut: localValue('2026-09-01', '21:00') }
        ]
    }, { ...shift, shiftId: '' });
    assert.equal(ambiguous.conflict, true);
    assert.equal(ambiguous.kind, 'ambiguous');
}

// Shift windows use local calendar time and carry an end date into tomorrow
// when the clock wraps at midnight.
const normalWindow = buildShiftWindow('2026-09-01', { shiftId: 'shift-a', start: '19:30', end: '21:00' });
assert.equal(normalWindow.shiftId, 'shift-a');
assert.equal(normalWindow.startClock, '19:30');
assert.equal(normalWindow.durationMinutes, 90);
assert.equal(normalWindow.overnight, false);
assert.equal(toDateTimeLocal(normalWindow.startDate), '2026-09-01T19:30:00');
assert.equal(
    toDateTimeLocal(new Date(2026, 8, 1, 19, 20, 1)),
    '2026-09-01T19:20:01',
    'datetime-local must preserve seconds so +10 policy cannot gain a second by truncation'
);
assert.equal(normalWindow.start, normalWindow.startDate);
assert.equal(normalWindow.end, normalWindow.endDate);

const overnightWindow = buildShiftWindow('2026-09-01', '23:30', '01:00');
assert.equal(overnightWindow.overnight, true);
assert.equal(overnightWindow.durationMinutes, 90);
assert.equal(toDateTimeLocal(overnightWindow.endDate), '2026-09-02T01:00:00');
assert.throws(
    () => buildShiftWindow('2026-02-30', '08:00', '09:00'),
    error => error.code === 'INVALID_DATE_KEY'
);

// Explicit stable shift IDs have first priority, even when another session has
// the same class start and both overlap the shift.
{
    const linkedByStart = {
        id: 'start-link',
        linkedClassStart: '19:30',
        checkIn: localValue('2026-09-01', '19:25'),
        checkOut: localValue('2026-09-01', '21:00')
    };
    const linkedById = {
        id: 'id-link',
        linkedScheduleShiftId: 'shift-a',
        checkIn: localValue('2026-09-01', '19:30'),
        checkOut: localValue('2026-09-01', '21:00')
    };
    const result = resolveSessionForShift([linkedByStart, linkedById], {
        shiftId: 'shift-a', start: '19:30', end: '21:00'
    }, normalWindow);
    assert.equal(result.status, 'matched');
    assert.equal(result.method, 'linkedScheduleShiftId');
    assert.equal(result.session, linkedById, 'resolver must return the original session object, not a clone');
}

// linkedClassStart is the compatibility fallback before time overlap.
{
    const linked = {
        id: 'legacy-link',
        linkedClassStart: '7:30',
        checkIn: localValue('2026-09-01', '06:00'),
        checkOut: localValue('2026-09-01', '07:00')
    };
    const overlapping = {
        id: 'overlap',
        checkIn: localValue('2026-09-01', '07:25'),
        checkOut: localValue('2026-09-01', '09:00')
    };
    const morningWindow = buildShiftWindow('2026-09-01', '07:30', '09:00');
    const result = resolveSessionForShift([overlapping, linked], { start: '07:30', end: '09:00' }, morningWindow);
    assert.equal(result.method, 'linkedClassStart');
    assert.equal(result.session, linked);
}

// Concurrent schedule rows deliberately share one attendance session.  The
// shared session is anchored by day/branch + section + class start (without a
// row-only shift ID), so opening either row must resolve the exact same object
// and must never offer to create a duplicate session.
{
    const merged = {
        id: 'merged-concurrent',
        role: 'subject-a+subject-b',
        linkedClassStart: '19:30',
        linkedScheduleCompositeKey: 'cs1_2026-09-01',
        linkedScheduleSection: 'evening2',
        checkIn: localValue('2026-09-01', '19:30'),
        checkOut: localValue('2026-09-01', '21:00')
    };
    const rowA = resolveSessionForShift([merged], {
        shiftId: 'row-a', compositeKey: 'cs1_2026-09-01', section: 'evening2',
        start: '19:30', end: '21:00'
    }, normalWindow);
    const rowB = resolveSessionForShift([merged], {
        shiftId: 'row-b', compositeKey: 'cs1_2026-09-01', section: 'evening2',
        start: '19:30', end: '21:00'
    }, normalWindow);
    assert.equal(rowA.status, 'matched');
    assert.equal(rowB.status, 'matched');
    assert.equal(rowA.session, merged);
    assert.equal(rowB.session, merged, 'both concurrent rows must reuse one session');

    const wrongSection = resolveSessionForShift([merged], {
        shiftId: 'row-c', compositeKey: 'cs1_2026-09-01', section: 'evening1',
        start: '19:30', end: '21:00'
    }, normalWindow);
    assert.equal(wrongSection.status, 'none', 'a same-time row in another section cannot steal the session');
}

// A single valid overlap is safe to use, including a current open session
// checked in shortly before the scheduled start.
{
    const overlap = {
        id: 'only-overlap',
        checkIn: localValue('2026-09-01', '19:20'),
        checkOut: localValue('2026-09-01', '20:45')
    };
    const result = resolveSessionForShift([overlap], { start: '19:30', end: '21:00' }, normalWindow);
    assert.equal(result.status, 'matched');
    assert.equal(result.method, 'overlap');
    assert.equal(result.session, overlap);

    const open = { id: 'open', checkIn: localValue('2026-09-01', '19:15'), checkOut: null };
    const openResult = resolveSessionForShift([open], { start: '19:30', end: '21:00' }, normalWindow);
    assert.equal(openResult.session, open);
}

// Operational attendance and a session explicitly linked to another class
// must never become this class's chip/editor source merely due to overlapping.
{
    const receptionist = {
        id: 'reception',
        checkIn: localValue('2026-09-01', '19:30'),
        checkOut: localValue('2026-09-01', '21:00'),
        linkedReceptionistShift: 'toi'
    };
    const otherClass = {
        id: 'other-class',
        checkIn: localValue('2026-09-01', '19:30'),
        checkOut: localValue('2026-09-01', '21:00'),
        linkedScheduleShiftId: 'shift-other'
    };
    const result = resolveSessionForShift(
        [receptionist, otherClass],
        { start: '19:30', end: '21:00', shiftId: 'shift-a' },
        normalWindow
    );
    assert.equal(result.status, 'none');
}

// More than one candidate is never guessed.  The ambiguity exposes the exact
// original candidates so the UI can require an administrator's choice.
{
    const a = { id: 'a', checkIn: localValue('2026-09-01', '19:20'), checkOut: localValue('2026-09-01', '20:30') };
    const b = { id: 'b', checkIn: localValue('2026-09-01', '19:40'), checkOut: localValue('2026-09-01', '21:10') };
    const result = resolveSessionForShift([a, b], { start: '19:30', end: '21:00' }, normalWindow);
    assert.equal(result.status, 'ambiguous');
    assert.equal(result.code, 'AMBIGUOUS_SESSION');
    assert.equal(result.session, null);
    assert.deepEqual(result.candidates, [a, b]);
    assert.match(result.error, /nhiều phiên/i);

    const duplicateLink = resolveSessionForShift([
        { id: 'x', linkedScheduleShiftId: 'shift-a' },
        { id: 'y', linkedScheduleShiftId: 'shift-a' }
    ], { shiftId: 'shift-a', start: '19:30', end: '21:00' }, normalWindow);
    assert.equal(duplicateLink.status, 'ambiguous');
    assert.equal(duplicateLink.method, 'linkedScheduleShiftId');
}

// Invalid chronology cannot become an overlap candidate.
{
    const reversed = {
        id: 'bad',
        checkIn: localValue('2026-09-01', '20:00'),
        checkOut: localValue('2026-09-01', '19:00')
    };
    assert.equal(
        resolveSessionForShift([reversed], { start: '19:30', end: '21:00' }, normalWindow).status,
        'none'
    );
}

// A legacy session leaking only a few minutes into the next class must not be
// stolen by that row. Besides the 10-minute floor, the overlap must cover at
// least half of the shorter interval so an adjacent ca-1 session cannot become
// ca-2 merely because it ended 10/11 minutes late.
{
    const weakAdjacent = {
        id: 'weak-adjacent',
        checkIn: localValue('2026-09-01', '18:00'),
        checkOut: localValue('2026-09-01', '19:39')
    };
    const meaningfulAdjacent = {
        id: 'meaningful-adjacent',
        checkIn: localValue('2026-09-01', '19:30'),
        checkOut: localValue('2026-09-01', '19:40')
    };
    const tenMinuteLeak = {
        id: 'ten-minute-leak',
        checkIn: localValue('2026-09-01', '18:00'),
        checkOut: localValue('2026-09-01', '19:40')
    };
    const elevenMinuteLeak = {
        id: 'eleven-minute-leak',
        checkIn: localValue('2026-09-01', '18:00'),
        checkOut: localValue('2026-09-01', '19:41')
    };
    assert.equal(
        resolveSessionForShift([weakAdjacent], { start: '19:30', end: '21:00' }, normalWindow).status,
        'none',
        'a 1-9 minute boundary leak is not a safe attendance match'
    );
    assert.equal(
        resolveSessionForShift([tenMinuteLeak], { start: '19:30', end: '21:00' }, normalWindow).status,
        'none',
        'a 10-minute tail of the previous long session is still not meaningful'
    );
    assert.equal(
        resolveSessionForShift([elevenMinuteLeak], { start: '19:30', end: '21:00' }, normalWindow).status,
        'none',
        'an 11-minute tail of the previous long session is still not meaningful'
    );
    assert.equal(
        resolveSessionForShift([meaningfulAdjacent], { start: '19:30', end: '21:00' }, normalWindow).session,
        meaningfulAdjacent,
        'a short session genuinely contained in the shift remains eligible for explicit Admin review'
    );
}

// Fingerprints are key-order independent, cover nested payroll fields, and do
// not mutate their source object.
{
    const left = { id: 's1', studentCount: 12, nested: { b: 2, a: 1 }, tags: ['x', 'y'] };
    const right = { tags: ['x', 'y'], nested: { a: 1, b: 2 }, studentCount: 12, id: 's1' };
    const before = JSON.stringify(left);
    assert.equal(fingerprintSession(left), fingerprintSession(right));
    assert.notEqual(fingerprintSession(left), fingerprintSession({ ...right, studentCount: 13 }));
    assert.equal(JSON.stringify(left), before);
}

// Drafts preserve source identity/fingerprint and infer none/open/closed while
// providing scheduled defaults for a new session.
{
    const source = {
        id: 'closed-session',
        checkIn: localValue('2026-09-01', '19:30'),
        checkOut: localValue('2026-09-01', '21:00'),
        studentCount: 11,
        studentCountStatus: 'approved',
        bonus10: true
    };
    const closed = createDraft(source, normalWindow);
    assert.equal(closed.mode, 'closed');
    assert.equal(closed.state, 'closed');
    assert.equal(closed.sourceSession, source);
    assert.equal(closed.studentCount, 11);
    assert.equal(closed.studentCountDirty, false,
        'opening a reviewed count must not mark it for approval or deletion');
    assert.equal(closed.bonus10, true);
    assert.equal(closed.originalFingerprint, fingerprintSession(source));

    const open = createDraft({ id: 'open-session', checkIn: localValue('2026-09-01', '19:30') }, normalWindow);
    assert.equal(open.mode, 'open');
    assert.equal(open.state, 'open');
    assert.equal(open.checkOut, '');
    assert.equal(open.studentCountDirty, false);

    const empty = createDraft(null, normalWindow);
    assert.equal(empty.mode, 'none');
    assert.equal(empty.state, 'none');
    assert.equal(empty.checkIn, '2026-09-01T19:30:00');
    assert.equal(empty.checkOut, '2026-09-01T21:00:00');
    assert.equal(empty.linkedScheduleShiftId, 'shift-a');
    assert.equal(empty.studentCountDirty, false);
}

// A valid closed draft returns write-ready ISO values and normalized count.
{
    const result = validateDraft({
        mode: 'closed',
        checkIn: '2026-09-01T19:20',
        checkOut: '2026-09-01T21:00',
        studentCount: '11'
    }, normalWindow, { now: '2026-09-01T22:00' });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'closed');
    assert.equal(result.studentCount, 11);
    assert.match(result.checkInISO, /^2026-09-01T/);
    assert.match(result.checkOutISO, /^2026-09-01T/);
}

// Overnight editing is valid only when the explicit checkout is after checkin.
{
    const valid = validateDraft({
        mode: 'closed',
        checkIn: '2026-09-01T23:25',
        checkOut: '2026-09-02T01:00',
        studentCount: ''
    }, overnightWindow, { now: '2026-09-02T02:00' });
    assert.equal(valid.ok, true);
    assert.equal(valid.studentCount, null);

    const reversed = validateDraft({
        mode: 'closed',
        checkIn: '2026-09-02T01:00',
        checkOut: '2026-09-01T23:25'
    }, overnightWindow, { now: '2026-09-02T02:00' });
    assert.equal(reversed.ok, false);
    assert.equal(reversed.code, 'CHECKOUT_NOT_AFTER_CHECKIN');
}

// Sessions longer than 24h, future timestamps, and past shifts left open are
// rejected with explicit codes instead of relying on the payroll evaluator.
{
    const tooLong = validateDraft({
        mode: 'closed',
        checkIn: '2026-09-01T01:00',
        checkOut: '2026-09-02T01:01'
    }, normalWindow, { now: '2026-09-03T00:00' });
    assert.equal(tooLong.ok, false);
    assert.ok(tooLong.errors.some(error => error.code === 'SESSION_TOO_LONG'));

    const future = validateDraft({
        mode: 'closed',
        checkIn: '2026-09-01T19:30',
        checkOut: '2026-09-01T21:00'
    }, normalWindow, { now: '2026-09-01T20:00' });
    assert.equal(future.ok, false);
    assert.ok(future.errors.some(error => error.code === 'FUTURE_CHECKOUT'));

    const pastOpen = validateDraft({
        mode: 'open',
        checkIn: '2026-09-01T19:30',
        checkOut: ''
    }, normalWindow, { now: '2026-09-01T22:00' });
    assert.equal(pastOpen.ok, false);
    assert.ok(pastOpen.errors.some(error => error.code === 'PAST_SHIFT_CANNOT_STAY_OPEN'));
}

// The ±12h guard prevents an unrelated attendance record from being attached
// to this shift, and Firestore-compatible student counts are integer 1..500.
{
    const outsideWindow = validateDraft({
        mode: 'closed',
        checkIn: '2026-09-01T01:00',
        checkOut: '2026-09-01T02:00'
    }, normalWindow, { now: '2026-09-02T00:00' });
    assert.equal(outsideWindow.ok, false);
    assert.ok(outsideWindow.errors.some(error => error.code === 'CHECKIN_OUTSIDE_SHIFT_WINDOW'));

    ['0', '501', '10.5', 'abc'].forEach(value => {
        const result = validateDraft({ mode: 'none', studentCount: value }, normalWindow, {
            now: '2026-09-02T00:00'
        });
        assert.equal(result.ok, false, `studentCount=${value} must be rejected`);
        assert.equal(result.code, 'INVALID_STUDENT_COUNT');
    });
    assert.equal(validateDraft({ mode: 'none', studentCount: 1 }, normalWindow).ok, true);
    assert.equal(validateDraft({ mode: 'none', studentCount: 500 }, normalWindow).ok, true);
}

// Preview state is display-only and deterministic from draft + validation.
assert.equal(previewState({ mode: 'none' }).key, 'none');
assert.equal(previewState({ mode: 'open' }).key, 'open');
assert.equal(previewState({ mode: 'closed' }).key, 'closed');
assert.equal(previewState({ mode: 'closed', isAbsent: true }).key, 'absent');
assert.equal(previewState({ mode: 'closed' }, { ok: false, error: 'Sai giờ' }).key, 'invalid');

console.log('schedule-attendance-admin.test.js: all assertions passed');
