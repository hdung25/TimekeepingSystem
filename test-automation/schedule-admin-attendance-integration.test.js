const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const schedule = read('js/schedule.js');
const db = read('js/db-service.js');
const report = read('js/report.js');
const early10 = read('js/early10.js');
const rules = read('firestore.rules');
const html = read('lich-lam.html');
const serviceWorker = read('service-worker.js');

assert.match(db, /\^\[A-Za-z0-9_-\]\{1,160\}\$\/\.test\(sessionId\)/,
    'client canonical +10 identity must accept the same 160-character session IDs as Firestore Rules');
assert.match(rules, /sessionId', ''\)\.matches\('\[A-Za-z0-9_-\]\{1,160\}'\)/,
    'Firestore canonical +10 identity must stay aligned with the client helper');

const panelStart = schedule.indexOf('function attendanceAdminPanelMarkup');
const panelEnd = schedule.indexOf('\nasync function loadAdminAttendanceEditor', panelStart);
assert.ok(panelStart >= 0 && panelEnd > panelStart, 'admin attendance panel must be isolated');
const panel = schedule.slice(panelStart, panelEnd);
assert.match(panel, /if \(!state\?\.canEditAttendance\) \{[\s\S]*!state\?\.likelyPrimaryAdmin[\s\S]*return '';/,
    'attendance controls must be absent for verified non-Admin schedulers');
assert.match(panel, /Công & chip nhân viên/);
assert.match(panel, /Giờ vào chính xác/);
assert.match(panel, /Giờ ra chính xác/);
assert.match(panel, /Sĩ số thực tế tính lương/);
assert.match(panel, /Chưa thay đổi; giữ nguyên trạng thái/,
    'the popup must explain that an untouched review state is preserved');
assert.match(panel, /Phụ cấp vào sớm \+10p/);
assert.match(panel, /Lưu công & cập nhật chip/);
assert.match(panel, /Yêu cầu \+10p đang chờ duyệt/,
    'a pending request must be shown as pending instead of being coerced to unchecked');
assert.match(panel, /data-action="attendance-bonus-set" data-desired="true"/);
assert.match(panel, /data-action="attendance-bonus-set" data-desired="false"/,
    'pending +10 requests need explicit approve and decline actions');
assert.match(panel, /Không áp dụng · không phạt tháng/,
    'declining a pending popup request must explicitly distinguish cancellation from monthly rejection');
assert.match(panel, /attendancePenaltyMessage\(entry\)/,
    'an active monthly penalty must show its durable marker metadata in the popup');
assert.match(panel, /data-action="attendance-check-in"[^>]*step="1"|step="1"[^>]*data-action="attendance-check-in"/,
    'exact attendance times must preserve seconds');
assert.match(panel, /data-action="attendance-check-out"[^>]*step="1"|step="1"[^>]*data-action="attendance-check-out"/);

assert.match(schedule, /getAuthenticatedAuthorizationContext\(true\)/,
    'popup must verify the Firebase role instead of trusting localStorage');
assert.match(schedule, /strictAuthorization\.roles\.includes\('admin'\)/);
assert.doesNotMatch(schedule, /canEditAttendance\s*=\s*[^;]*senior_assistant/);
assert.match(schedule, /getAdminTeachingAttendanceEditorContext/);
assert.match(schedule, /saveAdminTeachingAttendanceCorrection/);
assert.match(schedule, /expectedFingerprint/);
assert.match(schedule, /findAttendanceEvidenceForShift/);
assert.match(schedule, /resolveAttendanceEvidenceForShift[\s\S]*ScheduleAttendanceAdmin\.resolveSessionForShift/,
    'table chips and editor must share the deterministic attendance resolver');
assert.match(schedule, /Cần đối chiếu nhiều phiên công/,
    'ambiguous attendance sessions must be surfaced instead of silently choosing one');
assert.match(schedule, /attendanceEvidence = null[\s\S]*không kết luận ai chưa chấm công/,
    'a failed attendance read must remain unknown rather than mark every teacher unverified');
assert.match(schedule, /stableScheduleShiftLocatorId\(compositeKey, caType, row, index\)/,
    'legacy rows need a deterministic schedule identity for table chips and writes');
assert.match(schedule, /Đủ vào\/ra/);
assert.match(schedule, /Đã vào ca/);
assert.match(schedule, /bonus10Mutation\s*=\s*\{[\s\S]*dirty:\s*entry\.bonus10Dirty === true[\s\S]*desired:\s*entry\.draft\.bonus10 === true/);
assert.match(schedule, /bonus10Dirty:\s*bonus10Mutation\.dirty/,
    'the caller must send the explicit dirty flag required by the atomic API');
assert.match(schedule, /studentCountMutation\s*=\s*\{[\s\S]*dirty:\s*entry\.studentCountDirty === true \|\| entry\.draft\.studentCountDirty === true/,
    'student count must carry an explicit dirty flag separate from time edits');
assert.match(schedule, /studentCountDirty:\s*studentCountMutation\.dirty/);
assert.match(schedule, /attendance-use-planned-count[\s\S]*entry\.studentCountDirty = true/,
    'using the planned count is an explicit count mutation');
assert.match(schedule, /attendance-student-count[\s\S]*entry\.studentCountDirty = true/,
    'editing or clearing the count is an explicit count mutation');
assert.match(schedule, /expectedScheduleSignature:\s*state\.signature/);
assert.match(schedule, /expectedStaffingUpdatedAt:\s*state\.expectedStaffingUpdatedAt/);
assert.match(schedule, /scheduleIndex:\s*state\.index/,
    'the legacy-row locator must be included in the correction command');
assert.match(schedule, /Early10\.splitSubjectIds\(rowSubjectId\)/,
    'merged subject IDs must be reconciled against the server context');
assert.match(schedule, /subjectResolutionError[\s\S]*Đã khóa lưu công/);
assert.match(schedule, /if \(isAttendanceSaveInFlight\(state\)\)[\s\S]*Đang lưu công nguyên tử/,
    'direct schedule-save calls must be guarded while an attendance transaction is active');
assert.match(schedule, /attendanceAbsenceConflict\(state\)/,
    'a worked attendance session must not be saved with VP/VĐX state');
assert.match(schedule, /commandTop:[\s\S]*nextCommandColumn\.scrollTop = viewport\.commandTop/,
    'attendance re-renders must preserve the command-column viewport');
assert.match(schedule, /attendance-auth-retry/,
    'a local Admin must get a fail-closed retry path when server authorization cannot be read');
assert.match(schedule, /attendanceShiftClosed:\s*row\.isClosed === true \|\| isCenterClosed\(dateKey, caType, window\.centerClosures\)/,
    'the popup must fail fast when its row or section is already closed');
assert.match(schedule, /state\.attendanceShiftClosed\) return 'Ca\/lớp đang tắt\./,
    'a closed shift must explain why attendance editing is blocked');
assert.match(schedule, /editorLocked = savingLocked \|\| state\.attendanceShiftClosed/,
    'closed shifts keep staffing visible but lock every attendance editor control');
assert.match(schedule, /\^\(morning\|afternoon\|evening\)\[12\]\$/,
    'schedule UI closure semantics must honor a parent day period such as evening');

const commandStart = db.indexOf('saveAdminTeachingAttendanceCorrection: async');
const commandEnd = db.indexOf('\n    updateSessionRole:', commandStart);
assert.ok(commandStart >= 0 && commandEnd > commandStart, 'atomic admin command must exist');
const command = db.slice(commandStart, commandEnd);
assert.match(command, /authorization\.roles\.includes\('admin'\)/);
assert.match(db, /forceServer\s*&&\s*!mappedUserId/,
    'strict authorization must fail closed when the Firebase role has no staff mapping');
assert.match(db, /auth\/role-user-missing/);
assert.match(command, /schedule_attendance_admin_audits/,
    'transaction must include the strict-admin immutable audit boundary');
assert.match(command, /transaction\.get\(scheduleRef\)/,
    'the attendance transaction must read the exact materialized schedule document');
assert.match(command, /transaction\.get\(settingsRef\)/,
    'the attendance transaction must re-read settings/system instead of trusting cached window closures');
assert.match(command, /expectedScheduleSignature/);
assert.match(command, /expectedStaffingUpdatedAt/);
assert.match(command, /schedule\/not-materialized/,
    'inherited schedules must fail closed until the date document is materialized');
assert.match(command, /schedule\/staff-unassigned/,
    'a stale popup must not write attendance after the teacher is removed');
assert.match(command, /schedule\/staff-absent/,
    'a main teacher marked VP/VDX must not receive worked attendance');
assert.match(command, /liveScheduleRow\.isClosed === true[\s\S]*_isTeachingScheduleSectionClosed\(dateKey, scheduleSection, liveCenterClosures\)[\s\S]*schedule\/shift-closed/,
    'row, exact section, parent period and all-day closures must reject the correction in-transaction');
assert.match(command, /isMainTeacherAbsent\(liveScheduleRow, staffId\)/);
assert.match(command, /getPayslipDraftLockState/,
    'published or received teaching payroll must block source edits');
assert.match(command, /Early10\.evaluateEarly10Request/,
    '+10 must use the canonical subject/mode/time policy');
assert.match(command, /isMonthlyBonusPenaltyActive/);
assert.match(command, /bonus10Status:\s*request\.status/,
    'raw bonus request statuses must be adapted to the canonical monthly-penalty contract');
assert.match(command, /requestRefs\.forEach\(ref => reads\.push\(transaction\.get\(ref\)\)\)/,
    'known monthly +10 requests must be re-read inside the correction transaction');
assert.match(command, /monthlyRequestDocs\.forEach\(doc => transactionRequestRefs\.set\(doc\.id, doc\.ref\)\)/,
    'all known monthly requests must be transactionally checked even when +10 was not toggled');
assert.match(command, /const canonicalRequestId = _canonicalBonus10RequestId\(\s*dateKey,\s*staffId,\s*targetSessionId,\s*targetShiftKey\s*\)/,
    'new popup requests must use the exact teaching-shift singleton ID');
assert.match(command, /transactionRequestRefs\.set\(canonicalRequestId, canonicalBonusRequestRef\)/,
    'the popup must always read the canonical request inside the transaction');
const beforeAttendanceTransaction = command.slice(0, command.indexOf('await db.runTransaction'));
assert.doesNotMatch(beforeAttendanceTransaction, /evaluateEarly10Request\(/,
    'clicked-row policy must not reject joined A+B before the transaction resolves the complete live set');
assert.match(command, /const bonus10Dirty = command\.bonus10Dirty === true \|\|/);
assert.match(command, /delete session\.bonus10/,
    'admin corrections must clean the obsolete session-wide +10 flag');
assert.match(command, /const requiresBonus10Policy = wantsBonus10 \|\| keepsExistingBonus10/,
    'preserved active +10 must be re-evaluated against the corrected time');
assert.match(command, /bonus10Dirty && bonusRequestSnapshot\?\.exists/,
    'a request may be cancelled only after an explicit +10 toggle');
assert.match(command, /liveSubjectSnapshots\.some\(snapshot => !snapshot\.exists\)/,
    'subject IDs must be re-read and verified inside the transaction');
assert.match(command, /missingSubjectIds/,
    'every supplied split subject ID must exist; non-empty IDs cannot fall back by name');
assert.match(schedule, /monthlyBonusRequests\.map\(request => \(\{ bonus10Status: request\.status \}\)\)/,
    'popup policy preview must recognize rejected +10 requests from the current month');
assert.match(command, /fingerprintSession/);
assert.match(command, /SESSION_OVERLAP/);
assert.match(command, /candidateStart \+ 24 \* 60 \* 60 \* 1000/,
    'another open session must span a bounded live interval instead of collapsing to zero length');
assert.match(command, /session\.linkedReceptionistShift \|\| session\.linkedOfficeShift \|\| hasOperationalRole/,
    'teaching correction must reject receptionist/office source sessions');
assert.match(command, /attendance\/session-operational-conflict/);
assert.match(command, /attendance\/session-link-conflict/,
    'a session linked to another shift/day/section must fail closed');
assert.match(command, /linkedScheduleShiftId/);
assert.match(command, /linkedScheduleCompositeKey/);
assert.match(command, /linkedScheduleSection/);
assert.match(command, /attendance\/session-role-conflict/,
    'a different teaching subject must not be silently retained or overwritten');
assert.match(command, /const concurrentTeaching = _resolveConcurrentTeachingSubjectSet\([\s\S]*const effectiveSubjectId = concurrentSubjectIds\.join\('\+'\)/,
    'every save path must compute the complete live concurrent subject set');
assert.match(command, /sessionRole:\s*subjectId,[\s\S]*subjectIds,[\s\S]*subjects:\s*liveSubjects/,
    '+10 policy must evaluate only the clicked teaching row, even when payroll stores a concurrent A+B role');
assert.match(command, /concurrentSubjectRefs\.map\(ref => transaction\.get\(ref\)\)/,
    'every subject in a merged role set must be re-read inside the attendance transaction');
assert.match(command, /const linksOneConcurrentRow = isConcurrentTeachingSession[\s\S]*concurrentTeaching\.rows\.some/,
    'a merged session must detect a link that identifies only one concurrent schedule row');
assert.match(command, /!isConcurrentTeachingSession && liveScheduleRow\.shiftId[\s\S]*!preservesConcurrentTeachingRoleSet/,
    'saving a merged session must retain its common section/start anchor instead of adding a row-only shift ID');
assert.match(command, /role:\s*effectiveSubjectId,[\s\S]*roleName:\s*effectiveSubjectName/,
    'new sessions must persist the canonical joined role and name');
assert.match(command, /transaction\.get\(cancelledRef\)/);
assert.match(command, /isScheduleRowCancelled\(liveScheduleRow, scheduleRowIndex\)/,
    'a cancelled-shift tombstone must gate the target row inside the transaction');
assert.match(command, /activeScheduleRows = scheduleRows\.filter\([\s\S]*!isScheduleRowCancelled/,
    'cancelled concurrent rows must be excluded from the joined payroll role');
assert.match(command, /canUpgradeGenericLegacyRole/,
    'unlinked legacy generic teacher roles remain safely upgradeable');
assert.match(command, /hasFrozenRoleRate/,
    'legacy role canonicalization must not retain or silently replace a frozen manual rate');
assert.match(command, /session\.linkedClassStart = scheduledStart/,
    'a validated legacy teaching session must be anchored to the current class');
assert.match(command, /const studentCountDirty = command\.studentCountDirty === true \|\|/);
assert.match(command, /_applyAdminStudentCountMutation\([\s\S]*studentCountDirty[\s\S]*validation\.studentCount/,
    'the transaction may change count review state only through the dirty-gated helper');
assert.match(command, /delete session\.isAbsent/,
    'saving an explicit worked state must clear a stale absence marker');
assert.match(command, /editHistory/);
assert.match(command, /const latestTimedSession = sessions\.reduce/,
    'legacy top-level times must mirror the latest session by time, not by array position');
assert.match(command, /linkedClassStart: scheduledStart/);
assert.doesNotMatch(command, /roleRate\s*=/,
    'schedule correction must not freeze or rewrite a historical salary rate');

assert.doesNotMatch(report, /DBService\.reviewStudentCountReport/);
assert.doesNotMatch(report, /DBService\.clearStudentCountReport/);
assert.doesNotMatch(report, /!isRecep\s*&&\s*isTargetTA/,
    'bonus approval block must use its in-scope isReceptionist variable');
assert.doesNotMatch(report, /if \(!isRecep\s*&&\s*chip\.studentCount/,
    'student-count approval block must use its in-scope isReceptionist variable');
assert.match(schedule, /function attendanceConcurrentSubjectSet\(entry\)[\s\S]*SECTIONS\.flatMap[\s\S]*isMainTeacherAbsent[\s\S]*getSubstituteTeachers/,
    'popup +10 preview must derive the same active concurrent A+B assignments as the transaction');
assert.match(schedule, /cancelledShiftKeys\.includes\(legacyCancelledKey\)[\s\S]*cancelledShiftKeys\.includes\(`shift:\$\{persistedShiftId\}`\)/,
    'popup A+B preview must exclude the same employee cancellation tombstones as the transaction');
assert.match(db, /getAdminTeachingAttendanceEditorContext[\s\S]*transaction|getAdminTeachingAttendanceEditorContext[\s\S]*cancelledShiftKeys/);
assert.match(schedule, /sessionRole:\s*concurrentSubjects\.ids\.join\('\+'\)/);
assert.match(report, /typeof bonus10PenaltyState\.active === 'boolean'[\s\S]*bonus10PenaltyState\.active[\s\S]*bonus10RequestsList\.some/,
    'explicit clear must override retained rejected audit requests in the current-month report');
assert.match(report, /dấu vết từ chối vẫn được giữ để đối chiếu/,
    'clear UI must not claim that rejected audit records were deleted');

const createBonusStart = db.indexOf('createBonus10Request: async');
const createBonusEnd = db.indexOf('\n    createApprovedBonus10Request:', createBonusStart);
const createBonusCommand = db.slice(createBonusStart, createBonusEnd);
assert.match(createBonusCommand, /_canonicalBonus10RequestId/);
assert.match(createBonusCommand, /db\.runTransaction/);
assert.match(createBonusCommand, /transaction\.get\(checkInProofRef\)/,
    'staff auto-approval must read the immutable server check-in receipt in its transaction');
assert.match(createBonusCommand, /checkIn:\s*proofTime/,
    'the award threshold must be recomputed from server time, not the client ISO claim');
assert.match(createBonusCommand, /status:\s*'approved'/,
    'an eligible authenticated staff request is approved without waiting for Admin');
assert.doesNotMatch(createBonusCommand, /collection\('bonus10_requests'\)\.add/,
    'random request IDs would reopen the duplicate-create race');

const approveBonusStart = db.indexOf('approveBonus10Request: async');
const approveBonusEnd = db.indexOf('\n    cancelApprovedBonus10:', approveBonusStart);
const approveBonusCommand = db.slice(approveBonusStart, approveBonusEnd);
assert.match(approveBonusCommand, /db\.runTransaction/);
assert.match(approveBonusCommand, /transaction\.get\(attendanceRef\)/);
assert.match(approveBonusCommand, /transaction\.get\(monthlyRef\)/);
assert.match(approveBonusCommand, /String\(request\.status \|\| ''\) !== 'pending'/);
assert.match(approveBonusCommand, /Early10\.evaluateEarly10Request/,
    'Admin approval must recompute policy from the live attendance/profile/subject documents');
assert.match(approveBonusCommand, /transaction\.update\(requestRef,[\s\S]*awardScope:\s*'teaching_shift'[\s\S]*targetShiftKey:/,
    'legacy Admin approval must migrate the request itself onto one exact teaching shift');
assert.doesNotMatch(approveBonusCommand, /transaction\.(?:set|update)\(attendanceRef/,
    'request approval must not recreate the obsolete session-wide bonus flag');

const rejectBonusStart = db.indexOf('cancelApprovedBonus10: async');
const rejectBonusEnd = db.indexOf('\n    rejectBonus10Request:', rejectBonusStart);
const rejectBonusCommand = db.slice(rejectBonusStart, rejectBonusEnd);
assert.match(rejectBonusCommand, /db\.runTransaction/);
assert.match(rejectBonusCommand, /_writeBonus10PenaltyState\([\s\S]*true/,
    'a rejected transition must transactionally activate the monthly sentinel');
assert.match(rejectBonusCommand, /transaction\.update\(requestRef,[\s\S]*status:\s*'rejected'/,
    'cancellation must reject only the selected request');
assert.doesNotMatch(rejectBonusCommand, /attendanceRef|tupleSnapshots|sessions\[/,
    'cancelling one target must not rewrite a sibling target sharing the attendance session');
assert.doesNotMatch(rejectBonusCommand, /collection\('bonus10_requests'\)\.add/);

const clearBonusStart = db.indexOf('clearBonus10PenaltyForMonth: async');
const clearBonusEnd = db.indexOf('\n    getMonthlyBonus10Requests:', clearBonusStart);
const clearBonusCommand = db.slice(clearBonusStart, clearBonusEnd);
assert.match(clearBonusCommand, /_writeBonus10PenaltyState\([\s\S]*false/);
assert.doesNotMatch(clearBonusCommand, /batch\.delete|\.delete\(/,
    'clearing a penalty must preserve rejected request audit records');
assert.match(early10, /typeof bonusPenaltyState\.active === 'boolean'[\s\S]*return bonusPenaltyState\.active/,
    'explicit false must override the legacy rejected-request fallback');
assert.match(rules, /isCanonicalBonus10RequestId\(requestId\)[\s\S]*requestId == 'b10~'/);
assert.match(rules, /match \/bonus10_requests\/\{requestId\}[\s\S]*allow create:[\s\S]*isCanonicalBonus10RequestId/,
    'rules must reject all new random-ID bonus requests while retaining legacy update/read');

const dayAttendanceStart = db.indexOf('getDayAttendance: async');
const dayAttendanceEnd = db.indexOf('\n    // Fail-closed source loader', dayAttendanceStart);
assert.ok(dayAttendanceStart >= 0 && dayAttendanceEnd > dayAttendanceStart);
const dayAttendance = db.slice(dayAttendanceStart, dayAttendanceEnd);
assert.match(dayAttendance, /catch \(e\)[\s\S]*throw e;/,
    'attendance read failures must propagate as unknown, not masquerade as an empty day');
assert.doesNotMatch(dayAttendance, /catch \(e\)[\s\S]*return new Map\(\)/);

// Joined-role compatibility is deliberately pure so its exact inclusion rules
// can be regression-tested without Firebase or production data.
{
    const helperStart = db.indexOf('function _normalizeScheduleSubjectIds');
    const helperEnd = db.indexOf('// SCHEDULE REGISTRATION HELPERS START', helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'merged teaching-role helpers must be isolated');
    const context = { Set, Array, String, Error };
    vm.createContext(context);
    vm.runInContext(`${db.slice(helperStart, helperEnd)}\nthis.testApi = {\n` +
        'normalize: _normalizeScheduleSubjectIds,\n' +
        'sameSet: _sameScheduleSubjectIdSet,\n' +
        'isClosed: _isTeachingScheduleSectionClosed,\n' +
        'applyStudentCount: _applyAdminStudentCountMutation,\n' +
        'resolve: _resolveConcurrentTeachingSubjectSet\n' +
        '};', context);

    for (const status of ['pending', 'rejected']) {
        const existing = {
            studentCount: 12,
            studentCountStatus: status,
            studentCountUpdatedAt: 'old-update',
            studentCountUpdatedBy: 'teacher',
            studentCountReviewedAt: 'old-review',
            studentCountReviewedBy: 'reviewer'
        };
        const before = JSON.stringify(existing);
        context.testApi.applyStudentCount(existing, false, 20, 'new-time', 'admin');
        assert.equal(JSON.stringify(existing), before,
            `a time-only save must preserve an existing ${status} count and all review metadata`);
    }

    const explicit = { studentCount: 8, studentCountStatus: 'pending' };
    context.testApi.applyStudentCount(explicit, true, 14, 'new-time', 'admin-user');
    assert.deepEqual(explicit, {
        studentCount: 14,
        studentCountStatus: 'approved',
        studentCountUpdatedAt: 'new-time',
        studentCountUpdatedBy: 'admin-user',
        studentCountReviewedAt: 'new-time',
        studentCountReviewedBy: 'admin-user'
    }, 'an explicit edit is approved by the verified Admin in one mutation');

    context.testApi.applyStudentCount(explicit, true, null, 'clear-time', 'admin-user');
    assert.deepEqual(explicit, {}, 'an explicit clear removes count and review metadata together');

    assert.equal(context.testApi.isClosed('2026-08-31', 'evening2', {
        '2026-08-31': ['all']
    }), true, 'all closes every section');
    assert.equal(context.testApi.isClosed('2026-08-31', 'evening2', {
        '2026-08-31': ['evening2']
    }), true, 'an exact section closure is enforced');
    assert.equal(context.testApi.isClosed('2026-08-31', 'evening2', {
        '2026-08-31': ['evening']
    }), true, 'a parent day-period closure is enforced for its child section');
    assert.equal(context.testApi.isClosed('2026-08-31', 'evening2', {
        '2026-08-31': ['afternoon']
    }), false, 'an unrelated day period must not close the section');

    const teacherState = {
        getMainTeachers: row => row.mains || [],
        getSubstituteTeachers: row => row.substitutes || [],
        isMainTeacherAbsent: (row, id) => (row.absentIds || []).includes(id)
    };
    const staff = { id: 'teacher-a' };
    const rows = [
        { start: '18:00', end: '19:30', lop: 'Toán 9', lopId: 'subject-a', mains: [staff] },
        { start: '18:00', end: '19:30', lop: 'TTD', mains: [staff] },
        { start: '18:00', end: '19:30', lop: 'Lớp thay', lopId: 'subject-sub', substitutes: [staff] },
        { start: '18:00', end: '19:30', lop: 'Đã đóng', lopId: 'subject-closed', mains: [staff], isClosed: true },
        { start: '18:00', end: '19:30', lop: 'Vắng đột xuất', lopId: 'subject-absent', mains: [staff], absentIds: ['teacher-a'] },
        { start: '19:30', end: '21:00', lop: 'Ca kế tiếp', lopId: 'subject-next', mains: [staff] },
        { start: '18:00', end: '19:30', lop: 'Người khác', lopId: 'subject-other', mains: [{ id: 'teacher-b' }] }
    ];
    const catalog = [
        { id: 'subject-a', name: 'Toán 9' },
        { id: 'subject-ttd', name: 'TTD' },
        { id: 'subject-sub', name: 'Lớp thay' }
    ];
    const merged = context.testApi.resolve(rows, 'teacher-a', '18:00', '19:30', catalog, teacherState);
    assert.deepEqual(Array.from(merged.ids), ['subject-a', 'subject-sub', 'subject-ttd'],
        'only active main/substitute rows in the exact window belong to the merged role set');
    assert.equal(merged.rows.length, 3);
    assert.deepEqual(Array.from(merged.resolvedByName, item => item.id), ['subject-ttd'],
        'a missing lopId such as TTD may resolve only by one exact catalog name');
    assert.equal(context.testApi.sameSet('subject-ttd+subject-a+subject-sub', merged.ids), true,
        'joined role comparison must be order independent');
    assert.equal(context.testApi.sameSet('subject-a+subject-sub', merged.ids), false,
        'a subset must not be accepted');
    assert.equal(context.testApi.sameSet('subject-a+subject-sub+subject-ttd+arbitrary', merged.ids), false,
        'an arbitrary superset must not be accepted');

    assert.throws(
        () => context.testApi.resolve(rows, 'teacher-a', '18:00', '19:30', [
            ...catalog,
            { id: 'subject-ttd-duplicate', name: 'TTD' }
        ], teacherState),
        error => error.code === 'schedule/subject-conflict',
        'duplicate exact names must fail closed instead of guessing a payroll role'
    );
}

const earlyIndex = html.indexOf('js/early10.js?v=20260905-payroll-sync-v3');
const helperIndex = html.indexOf('js/schedule-attendance-admin.js?v=20260905-payroll-sync-v3');
const dbIndex = html.indexOf('js/db-service.js?v=20260905-payroll-sync-v3');
const scheduleIndex = html.indexOf('js/schedule.js?v=20260905-payroll-sync-v3');
assert.ok(earlyIndex >= 0 && helperIndex > earlyIndex && dbIndex > helperIndex && scheduleIndex > dbIndex,
    'policy/helper/db/schedule scripts must load in a deterministic order');
assert.match(serviceWorker, /tdt-chamcong-v153-payroll-sync-20260905/);
assert.match(serviceWorker, /schedule-attendance-admin\.js\?v=20260905-payroll-sync-v3/);

console.log('schedule-admin-attendance-integration.test.js: all assertions passed');
