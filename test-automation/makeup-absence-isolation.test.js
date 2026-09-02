const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const resolver = require('../js/shift-absence-state.js');
const evaluationSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'evaluation-service.js'), 'utf8');
const reportSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8');
const makeupSource = fs.readFileSync(path.join(__dirname, '..', 'cham-bu.html'), 'utf8');
const reviewSource = fs.readFileSync(path.join(__dirname, '..', 'tuong-trinh.html'), 'utf8');
const dbSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-service.js'), 'utf8');

const staffId = 'nv_1776091622276'; // Võ Quang Mỹ — production incident 17/08/2026
const dateKey = '2026-08-17';
const dailyNotes = { [dateKey]: 'Vắng phép' };

const toan3 = {
    start: '07:30',
    end: '09:00',
    lop: 'Toán 3',
    lopId: 'subject-toan-3',
    shiftId: 'shift-toan-3',
    gvId: staffId,
    gvList: [{ id: staffId, name: 'Võ Quang Mỹ' }],
    gvThayTeList: [{ id: 'teacher-dung', name: 'Hà Huy Dũng', replacesTeacherIds: [staffId] }],
    teacherAbsences: [{
        teacherId: staffId,
        teacherName: 'Võ Quang Mỹ',
        type: 'VP',
        replacementIds: ['teacher-dung'],
        reportedByName: 'Nguyễn Thị Ngọc Giàu'
    }],
    _branch: 'cs1',
    _compositeKey: 'cs1__2026-08-17',
    _originalIndex: 0
};

const bth = {
    start: '14:30',
    end: '16:30',
    lop: 'BTH',
    lopId: 'ZQuEuI65dg9hthIVnzlZ',
    shiftId: 'shift-bth',
    gvId: staffId,
    gvList: [{ id: staffId, name: 'Võ Quang Mỹ' }],
    gvThayTeList: [],
    teacherAbsences: [],
    _branch: 'cs1',
    _compositeKey: 'cs1__2026-08-17',
    _originalIndex: 0
};

// The exact production state: one shift is VP, BTH has explicitly been restored
// to ACTIVE. The day note may describe Toán 3 but must never lock BTH.
const toanState = resolver.resolveTeachingShift({
    row: toan3,
    staffId,
    dateKey,
    start: toan3.start,
    end: toan3.end,
    dateNote: dailyNotes[dateKey]
});
const bthState = resolver.resolveTeachingShift({
    row: bth,
    staffId,
    dateKey,
    start: bth.start,
    end: bth.end,
    dateNote: dailyNotes[dateKey]
});
assert.equal(toanState.isAbsent, true);
assert.equal(toanState.type, 'VP');
assert.equal(toanState.source, 'teacher-absence');
assert.equal(bthState.isAbsent, false);
assert.equal(bthState.source, 'teacher-active');
assert.equal(bthState.hasCanonicalState, true);

// A note alone is never evidence, including on legacy data. It may only classify
// an already evidenced legacy substitute absence.
const legacyBthState = resolver.resolveTeachingShift({
    row: { ...bth, teacherAbsences: undefined },
    staffId,
    dateKey,
    start: bth.start,
    end: bth.end,
    dateNote: dailyNotes[dateKey]
});
assert.equal(legacyBthState.isAbsent, false);

const legacyCoveredState = resolver.resolveTeachingShift({
    row: {
        ...toan3,
        teacherAbsences: undefined,
        gvThayTeList: [{ id: 'teacher-dung', name: 'Hà Huy Dũng' }]
    },
    staffId,
    dateKey,
    start: toan3.start,
    end: toan3.end,
    dateNote: dailyNotes[dateKey]
});
assert.equal(legacyCoveredState.isAbsent, true);
assert.equal(legacyCoveredState.type, 'VP');
assert.equal(legacyCoveredState.source, 'legacy-substitute');

// An admin absent session is evidence only for the linked/overlapping shift, not
// every other shift on that date.
const absentMorningSession = {
    id: 'absent-toan-3',
    isAbsent: true,
    checkIn: '2026-08-17T07:30:00',
    checkOut: '2026-08-17T09:00:00',
    linkedClassStart: '07:30'
};
const bthWithMorningAbsent = resolver.resolveTeachingShift({
    row: bth,
    staffId,
    dateKey,
    start: bth.start,
    end: bth.end,
    attendanceSessions: [absentMorningSession],
    dateNote: dailyNotes[dateKey]
});
assert.equal(bthWithMorningAbsent.isAbsent, false);

const exactMorningAbsent = resolver.resolveTeachingShift({
    row: { ...toan3, teacherAbsences: [] },
    staffId,
    dateKey,
    start: toan3.start,
    end: toan3.end,
    attendanceSessions: [absentMorningSession],
    dateNote: dailyNotes[dateKey]
});
assert.equal(exactMorningAbsent.isAbsent, true);
assert.equal(exactMorningAbsent.source, 'attendance-session');
assert.equal(exactMorningAbsent.type, 'VP');

const bthCancelKey = 'cs1__2026-08-17_afternoon1_0';
assert.equal(resolver.resolveTeachingShift({
    row: bth,
    staffId,
    cancelKey: bthCancelKey,
    cancelledShifts: new Set([bthCancelKey])
}).source, 'cancellation');
assert.equal(resolver.resolveTeachingShift({
    row: toan3,
    staffId,
    cancelKey: 'cs1__2026-08-17_morning1_0',
    cancelledShifts: new Set([bthCancelKey])
}).source, 'teacher-absence');

const operationalNoteOnly = resolver.resolveOperationalShift({
    kind: 'tt',
    dateKey,
    start: '14:00',
    end: '18:00',
    shiftKey: 'afternoon',
    dateNote: dailyNotes[dateKey]
});
assert.equal(operationalNoteOnly.isAbsent, false, 'daily note alone must not lock an operational shift either');

assert.equal(resolver.classifyChipAbsence({
    dateStr: dateKey,
    class: 'chip-gray',
    ...resolver.toChipMetadata(bthState)
}, dailyNotes), 'VKP');
assert.equal(resolver.classifyChipAbsence({
    dateStr: dateKey,
    class: 'chip-gray',
    ...resolver.toChipMetadata(toanState)
}, dailyNotes), 'VP');
assert.equal(resolver.classifyChipAbsence({
    dateStr: dateKey,
    class: 'chip-gray'
}, dailyNotes), 'VKP', 'generic missing chip must not be reclassified by a day note');

// Exercise the real evaluator so the metadata contract cannot drift away from
// the resolver/report integration.
const context = {
    console,
    Date,
    Math,
    Set,
    Map,
    Intl,
    window: {
        centerClosures: {},
        ShiftAbsenceState: resolver,
        getIconHtml: () => ''
    },
    getLocalDateKey: date => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },
    isScheduledMainTeacher: (row, id) =>
        row.gvId === id || (row.gvList || []).some(item => item.id === id),
    isScheduledSubstitute: (row, id) =>
        row.gvThayTeId === id || row.gvThayTheId === id ||
        (row.gvThayTeList || []).some(item => item.id === id) ||
        (row.gvThayTheList || []).some(item => item.id === id),
    hasScheduledSubstitute: row =>
        !!row.gvThayTeId || !!row.gvThayTheId ||
        (row.gvThayTeList || []).length > 0 || (row.gvThayTheList || []).length > 0
};
vm.createContext(context);
vm.runInContext(evaluationSource, context);
const chips = context.window.calculateDailyChips(
    { morning1: [toan3], afternoon1: [bth] },
    [],
    staffId,
    dateKey,
    { roles: ['teacher'], salary_config: { roles: [] } }
);
const toanChip = chips.find(chip => chip.text.includes('Toán 3'));
const bthChip = chips.find(chip => chip.text.includes('BTH'));
assert.ok(toanChip, 'Toán 3 must remain visible as an explicit absence');
assert.ok(bthChip, 'BTH missing-attendance chip must remain visible');
assert.equal(toanChip.absenceStateSource, 'teacher-absence');
assert.equal(toanChip.absenceType, 'VP');
assert.equal(bthChip.absenceState, 'ACTIVE');
assert.equal(bthChip.hasCanonicalAbsenceState, true);
assert.equal(resolver.classifyChipAbsence({ ...toanChip, dateStr: dateKey }, dailyNotes), 'VP');
assert.equal(resolver.classifyChipAbsence({ ...bthChip, dateStr: dateKey }, dailyNotes), 'VKP');

// Guard the actual page/report call sites against the two original broad leaks.
assert.match(makeupSource, /ShiftAbsenceState\.resolveTeachingShift\(/);
assert.match(makeupSource, /ShiftAbsenceState\.resolveOperationalShift\(/);
assert.doesNotMatch(makeupSource, /const\s+adminAbsent\s*=\s*sess\.some/);
assert.doesNotMatch(makeupSource, /excuse\s*=\s*dayExcuse/);
assert.match(makeupSource, /scheduleLocators:scheduleLocators/);
assert.match(reportSource, /ShiftAbsenceState\?\.classifyChipAbsence/);
assert.match(reviewSource, /DBService\.getCancelledShifts\(mStr,staffId\)/);
assert.match(reviewSource, /const blockedAbsence=absenceStates\.find/);
assert.match(reviewSource, /title='Ca đã được ghi nhận vắng'/);
assert.match(dbSource, /sessionData\.linkedScheduleShiftId = linkedShiftId/);
assert.match(dbSource, /sessionData\.linkedScheduleLocators = scheduleLocators/);

console.log('makeup-absence-isolation.test.js: all assertions passed');
