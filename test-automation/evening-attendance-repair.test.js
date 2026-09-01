const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repairPath = path.join(__dirname, '..', 'scripts', 'repair-evening-attendance-20260831.js');
const source = fs.readFileSync(repairPath, 'utf8');
const repair = require(repairPath);

assert.deepEqual(repair.parseArguments([]), { apply: false, rollback: false, mode: 'dry-run' });
assert.equal(repair.parseArguments(['--apply']).mode, 'apply');
assert.equal(repair.parseArguments(['--rollback']).mode, 'rollback');
assert.throws(() => repair.parseArguments(['--apply', '--rollback']), /một trong/);
assert.equal(repair.exactScheduleISO('18:00'), '2026-08-31T18:00:00+07:00');
assert.equal(repair.exactScheduleISO('19:30'), '2026-08-31T19:30:00+07:00');

const staffIds = Array.from({ length: 18 }, (_, index) => `staff-${String(index + 1).padStart(2, '0')}`);
let rowCounter = 0;
const rowFor = (staffId, section, suffix = '') => {
    rowCounter += 1;
    return {
        start: section === 'evening1' ? '18:00' : '19:30',
        end: section === 'evening1' ? '19:30' : '21:00',
        lop: `Subject ${rowCounter}${suffix}`,
        lopId: `subject-${rowCounter}`,
        phong: `P${rowCounter}`,
        gvList: [{ id: staffId, name: `Staff ${staffId}` }]
    };
};

const evening1 = staffIds.map(staffId => rowFor(staffId, 'evening1'));
const evening2 = staffIds.slice(0, 9).map(staffId => rowFor(staffId, 'evening2'));

// Seven concurrent classes add seven assignment records but remain in the
// same staff/branch/section/time windows.
for (let index = 0; index < 7; index += 1) {
    evening1.push(rowFor(staffIds[index], 'evening1', ' concurrent'));
}

// Per-teacher absence removes the main while the substitute remains active.
evening1[17] = {
    ...evening1[17],
    gvList: [{ id: 'absent-main', name: 'Absent Main' }],
    teacherAbsences: [{ teacherId: 'absent-main', type: 'VP' }],
    gvThayTeList: [{ id: staffIds[17], name: `Staff ${staffIds[17]}` }]
};
evening1.push({ ...rowFor('ignored-closed', 'evening1'), isClosed: true });
evening1.push({ ...rowFor('ignored-blank', 'evening1'), lop: '' });

const subjectCatalog = Array.from({ length: rowCounter }, (_, index) => {
    const number = index + 1;
    return {
        id: `subject-${number}`,
        data: { name: `Subject ${number}${number >= 28 && number <= 34 ? ' concurrent' : ''}` },
        updateTime: `2026-08-31T00:00:${String(number).padStart(2, '0')}Z`
    };
});

const manifest = repair.buildManifest([
    { branch: 'cs1', id: 'cs1__2026-08-31', data: { evening1, evening2 } },
    { branch: 'cs2', id: 'cs2__2026-08-31', data: {} },
    { branch: 'cs3', id: 'cs3__2026-08-31', data: {} }
], subjectCatalog);

assert.deepEqual(manifest.counts, {
    assignmentRecords: 34,
    staffWindows: 27,
    uniqueStaff: 18
});
const firstStaffWindows = manifest.windows.filter(window => window.staffId === staffIds[0]);
assert.equal(firstStaffWindows.length, 2, 'consecutive evening slots stay separate');
assert.equal(firstStaffWindows[0].scheduleLinks.length, 2, 'concurrent rows in one lane merge');
assert.equal(firstStaffWindows[0].role, 'subject-1+subject-28');
assert.equal(firstStaffWindows[0].roleName, 'Subject 1 + Subject 28 concurrent');
assert.ok(manifest.uniqueStaffIds.includes(staffIds[17]));
assert.ok(!manifest.uniqueStaffIds.includes('absent-main'));
assert.ok(!manifest.uniqueStaffIds.includes('ignored-closed'));
assert.equal(manifest.referencedSubjects.length, 34);
assert.ok(manifest.referencedSubjects.every(subject => subject.fields && subject.updateTime),
    'referenced subject semantics and updateTime must be fingerprinted');
const changedSubjectCatalog = subjectCatalog.map(subject => subject.id === 'subject-1'
    ? { ...subject, data: { ...subject.data, name: 'Renamed subject' } }
    : subject);
const changedSubjectManifest = repair.buildManifest([
    { branch: 'cs1', id: 'cs1__2026-08-31', data: { evening1, evening2 } },
    { branch: 'cs2', id: 'cs2__2026-08-31', data: {} },
    { branch: 'cs3', id: 'cs3__2026-08-31', data: {} }
], changedSubjectCatalog);
assert.notEqual(changedSubjectManifest.manifestHash, manifest.manifestHash,
    'a referenced subject semantic change must invalidate the manifest fingerprint');
assert.notEqual(changedSubjectManifest.scheduleHash, manifest.scheduleHash,
    'a referenced subject semantic change must invalidate the schedule fingerprint');

assert.throws(() => repair.buildManifest([
    {
        branch: 'cs1', id: 'cs1__2026-08-31',
        data: { evening1: [{ ...rowFor('staff-x', 'evening1'), lopId: 'missing-a+missing-b' }] }
    },
    { branch: 'cs2', id: 'cs2__2026-08-31', data: {} },
    { branch: 'cs3', id: 'cs3__2026-08-31', data: {} }
], subjectCatalog), /subject không tồn tại \[missing-a, missing-b\]/,
'every atomic id in a composite subject reference must exist');

const registrations = repair.mergeScheduleRegistrations(
    { evening1: [{ start: '18:00', end: '19:30', lop: 'A', phong: 'P1', registeredTeachers: [] }] },
    [{
        section: 'evening1', rowIndex: 0, rowSignature: '18:00|19:30|A|P1',
        userId: 'registered', userName: 'Registered', status: 'active', updatedAt: '2026-08-31T10:00:00Z'
    }]
);
assert.equal(registrations.evening1[0].registeredTeachers[0].id, 'registered');

const inherited = repair.sanitizeInheritedSchedule({
    evening1: [{
        isClosed: true,
        shiftId: 'ephemeral',
        gvThayTeId: 'old-sub',
        teacherAbsences: [{ type: 'VP' }],
        registeredTeachers: [{ id: 'old-registration' }]
    }]
});
assert.equal(inherited.evening1[0].isClosed, undefined);
assert.equal(inherited.evening1[0].gvThayTeId, '');
assert.deepEqual(inherited.evening1[0].teacherAbsences, []);
assert.deepEqual(inherited.evening1[0].registeredTeachers, []);

const repairTarget = {
    staffId: staffIds[0],
    name: 'Staff 1',
    sessions: firstStaffWindows
};
assert.equal(
    repair.classifyOriginalSession({ checkIn: '2026-08-31T03:00:00Z' }, repairTarget).kind,
    'preserve',
    'a non-target session outside 18:00–21:00 must survive untouched'
);
assert.equal(
    repair.classifyOriginalSession({
        checkIn: '2026-08-31T12:00:00Z', role: 'office_staff', linkedOfficeShift: 'office-1'
    }, repairTarget).kind,
    'preserve',
    'an operational session inside the evening horizon must survive untouched'
);
assert.throws(() => repair.classifyOriginalSession({
    checkIn: '2026-08-31T11:01:00Z', roleRate: 100000
}, repairTarget), /dữ liệu nghiệp vụ/,
'an unrelated monetized session inside the target horizon must abort the repair');
const preservedRaw = {
    mapValue: {
        fields: {
            checkIn: { timestampValue: '2026-08-31T00:00:00Z' },
            checkOut: { timestampValue: '2026-08-31T01:00:00Z' },
            role: { stringValue: 'office_staff' }
        }
    }
};
const patch = repair.buildAttendancePatch({
    originalAudit: {
        preservedSessionEntriesByStaff: new Map([[
            staffIds[0],
            [{
                decoded: {
                    checkIn: '2026-08-31T00:00:00Z',
                    checkOut: '2026-08-31T01:00:00Z',
                    role: 'office_staff'
                },
                rawValue: preservedRaw
            }]
        ]]),
        mappedAttempts: new Map()
    }
}, repairTarget, '2026-09-01T00:00:00Z');

assert.equal(patch.rawSessions.arrayValue.values[0], preservedRaw,
    'preserved sessions must retain their raw Firestore value object');
const repairedSessions = patch.sessions.filter(session => session.dataRepairId === repair.REPAIR_ID);
assert.equal(repairedSessions.length, 2);
assert.equal(repairedSessions[0].roleRate, undefined,
    'repair must let the evaluator resolve the dated subject rate');
assert.equal(repairedSessions[0].status, 'closed');
assert.equal(repairedSessions[0].source, 'admin');
assert.equal(repairedSessions[0].anchorDateKey, repair.DATE);
assert.equal(repairedSessions[0].linkedScheduleCompositeKey, 'cs1__2026-08-31');
assert.equal(repairedSessions[0].linkedScheduleSection, 'evening1');
assert.equal(repairedSessions[0].linkedScheduleShiftId, undefined,
    'a merged session must not claim one singular schedule shift id');

const externalFixtureTarget = {
    staffId: staffIds[0],
    sessions: [{
        scheduleLinks: [{
            compositeKey: 'cs1__2026-08-31', section: 'evening1', index: 0,
            shiftId: 'stable-evening-1', branch: 'cs1', start: '18:00', end: '19:30'
        }]
    }]
};
assert.throws(() => repair.evaluateExternalGates(
    [externalFixtureTarget],
    [{ id: `2026-08_${staffIds[0]}`, data: { userId: staffIds[0], shifts: ['shift:stable-evening-1'] } }],
    [], [], [], []
), /relevantCancellations=1/,
'stable shift-id cancellation tombstones must block the repair');
assert.throws(() => repair.evaluateExternalGates(
    [externalFixtureTarget], [], [], [], [], [
        {
            id: 'late-observation',
            data: {
                teacherId: staffIds[0], dateKey: repair.DATE, status: 'active', lateMinutes: 5,
                branch: 'cs1', scheduleCompositeKey: 'cs1__2026-08-31',
                classSectionKey: 'evening1', classIndex: 0, classStart: '18:00'
            }
        },
        {
            id: 'note-observation',
            data: {
                teacherId: staffIds[0], dateKey: repair.DATE, status: 'active', lateMinutes: 0,
                branch: 'cs1', scheduleCompositeKey: 'cs1__2026-08-31',
                classSectionKey: 'evening1', classIndex: 0, classStart: '18:00'
            }
        }
    ]
), /activeLateObservations=1/,
'an active receptionist late adjustment must block an exact-on-time repair');

const targets = staffIds.map(staffId => ({
    staffId,
    name: `Staff ${staffId}`,
    sessions: manifest.windows.filter(window => window.staffId === staffId)
}));
const emptyPreserved = new Map(staffIds.map(staffId => [staffId, []]));
const applyPlan = repair.buildApplyWrites({
    backup: null,
    applied: false,
    rolledBack: false,
    targets,
    attendance: [],
    attendanceHash: repair.EXPECTED_ATTENDANCE_SHA256,
    scheduleDocuments: [
        { id: 'cs1__2026-08-31', name: 'schedules/cs1__2026-08-31', updateTime: 'fixture' },
        { id: 'cs2__2026-08-31', name: 'schedules/cs2__2026-08-31', updateTime: 'fixture' },
        { id: 'cs3__2026-08-31', name: 'schedules/cs3__2026-08-31', updateTime: null }
    ],
    manifest,
    originalAudit: {
        targetAttemptDocuments: 9,
        targetAttempts: 10,
        preservedSessions: 0,
        preservedSessionEntriesByStaff: emptyPreserved,
        mappedAttempts: new Map()
    },
    external: {
        counts: {
            relevantCancellations: 0,
            lockedPayslips: 0,
            activeBonusRequests: 0,
            activeOvertimeRequests: 0
        }
    }
}, '2026-09-01T00:00:00Z');
assert.equal(applyPlan.writes.length, 19, 'one backup and all 18 attendance writes must be one commit plan');
assert.match(applyPlan.writes[0].update.name, /migration_backups\/evening-attendance-20260831-v1$/);
assert.ok(applyPlan.writes.slice(1).every(write => /attendance_logs\//.test(write.update.name)));
assert.equal(applyPlan.backupPayload.originalAttendance.length, 18,
    'backup must account for every target, including absent documents');
assert.deepEqual(applyPlan.backupPayload.referencedSubjects, manifest.referencedSubjects,
    'backup must carry the exact subject catalog evidence used by the manifest');

for (const value of [
    repair.EXPECTED_MANIFEST_SHA256,
    repair.EXPECTED_SCHEDULE_SHA256,
    repair.EXPECTED_ATTENDANCE_SHA256
]) {
    assert.match(value, /^[a-f0-9]{64}$/, 'every production input fingerprint must be pinned');
}

assert.equal(
    repair.fieldsFingerprint([{
        documentId: 'empty-array-wire-shape',
        fields: { items: { arrayValue: { values: [] } } }
    }]),
    repair.fieldsFingerprint([{
        documentId: 'empty-array-wire-shape',
        fields: { items: { arrayValue: {} } }
    }]),
    'Firestore REST omission of empty array values must not fail post-commit verification'
);

assert.equal(
    repair.fieldsFingerprint([{
        documentId: 'empty-map-wire-shape',
        fields: { metadata: { mapValue: { fields: {} } } }
    }]),
    repair.fieldsFingerprint([{
        documentId: 'empty-map-wire-shape',
        fields: { metadata: { mapValue: {} } }
    }]),
    'Firestore REST omission of empty map fields must not fail post-commit verification'
);

assert.match(source, /runFieldQuery\('cancelled_shifts', 'month', MONTH, transaction\)/,
    'cancelled shifts must be audited by their month field');
assert.match(source, /runFieldQuery\([\s\S]*?'schedule_registrations'[\s\S]*?'scheduleKey'/,
    'schedule registrations must be transaction-read and merged');
assert.match(source, /getDocument\('settings', 'system', false, transaction\)/,
    'center closures must be transaction-read');
assert.match(source, /runDateQuery\('shift_observations', transaction\)/,
    'downstream late observations must be transaction-read before writing exact attendance');
assert.match(source, /const missing = ids\.filter\(id => !subjectsById\.has\(id\)\)/,
    'explicit and composite subject IDs must fail closed against the catalog');
assert.match(source, /async function loadRollbackState/,
    'rollback must have a backup-authoritative, schedule-independent loader');
assert.doesNotMatch(
    source.match(/async function loadRollbackState[\s\S]*?\n}\n/)?.[0] || '',
    /schedules|schedule_manifest/,
    'rollback must not be blocked by later schedule edits'
);
assert.match(source, /currentDocument: \{ updateTime: document\.updateTime \}/,
    'existing writes must use Firestore updateTime preconditions');
assert.match(source, /currentDocument: \{ exists: false \}/,
    'new attendance and backup documents must use existence preconditions');
assert.doesNotMatch(source, /shift_observations\//,
    'the repair must never mutate shift observations');

console.log('Evening attendance repair regression tests passed.');
