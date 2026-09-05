// Database Service - Lớp trung gian xử lý dữ liệu
// Mục đích: Tách biệt logic gọi database khỏi giao diện (UI)

// Global helper: Generate YYYY-MM-DD using Vietnam timezone (UTC+7)
function getLocalDateKeyFromDate(date) {
    if (!(date instanceof Date)) return '';
    const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    const year = vnTime.getUTCFullYear();
    const month = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(vnTime.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Global helper: Create a Date object corresponding to a given HH:MM in Vietnam timezone (UTC+7)
function getVietnamDateFromHM(dateKey, hmStr) {
    if (!dateKey || !hmStr) return null;
    const [year, month, day] = dateKey.split('-').map(Number);
    const [hour, minute] = hmStr.split(':').map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute)) return null;
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
    return new Date(utcDate.getTime() - 7 * 60 * 60 * 1000);
}

// ===== Nhận diện GV của 1 lớp trong lịch (hỗ trợ lớp xếp NHIỀU GV) =====
// Trang xếp lịch lưu danh sách GV ở gvList / gvThayTeList (bản viết cũ: gvThayTheList);
// gvId / gvThayTheId chỉ giữ NGƯỜI ĐẦU TIÊN cho tương thích ngược. Nếu chỗ nào chỉ so gvId
// thì GV thứ 2 của lớp coi như không có ca → tự vào/tự ra, Bảng Công bắt admin chọn lại chức vụ.
function _collectScheduleTeacherIds(cls, listFields, singleFields) {
    const ids = new Set();
    if (!cls) return ids;
    listFields.forEach(field => {
        const list = cls[field];
        if (Array.isArray(list)) list.forEach(g => { if (g && g.id) ids.add(g.id); });
    });
    singleFields.forEach(field => { if (cls[field]) ids.add(cls[field]); });
    return ids;
}

function getScheduledMainTeacherIds(cls) {
    return _collectScheduleTeacherIds(cls, ['gvList'], ['gvId']);
}

function getScheduledSubstituteIds(cls) {
    return _collectScheduleTeacherIds(cls, ['gvThayTeList', 'gvThayTheList'], ['gvThayTeId', 'gvThayTheId']);
}

function isScheduledMainTeacher(cls, staffId) {
    return !!staffId && getScheduledMainTeacherIds(cls).has(staffId);
}

function isScheduledSubstitute(cls, staffId) {
    return !!staffId && getScheduledSubstituteIds(cls).has(staffId);
}

function hasScheduledSubstitute(cls) {
    return getScheduledSubstituteIds(cls).size > 0;
}

function createScheduleShiftId() {
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return `shift_${random}`;
}

function createAttendanceSessionId() {
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    return `session_${random}`;
}

// A bonus request is a singleton for one concrete teaching shift backed by one
// attendance session. Session-only identity is unsafe because one physical
// session can cover several teaching/reception payroll chips.
// `~` is intentionally outside every validated component alphabet, so two
// different tuples cannot collapse onto the same document ID (the old
// underscore + replacement scheme was ambiguous).
function _normalizeBonus10Identity(identity = {}) {
    const staffId = String(identity.staffId || '').trim();
    const dateKey = String(identity.dateKey || '').trim();
    const sessionId = String(identity.sessionId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(staffId) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId)) {
        const error = new Error('Định danh yêu cầu +10 phút không hợp lệ. Hãy tải lại dữ liệu công trước khi thao tác.');
        error.code = 'bonus10/invalid-identity';
        throw error;
    }
    const targetShiftKey = String(identity.targetShiftKey || '').trim();
    if (targetShiftKey && !/^[A-Za-z0-9_:-]{1,240}$/.test(targetShiftKey)) {
        const error = new Error('Định danh ca dạy nhận +10 phút không hợp lệ. Hãy tải lại bảng công.');
        error.code = 'bonus10/invalid-target';
        throw error;
    }
    return { staffId, dateKey, sessionId, targetShiftKey };
}

function _canonicalBonus10RequestId(dateKey, staffId, sessionId, targetShiftKey = '') {
    const identity = _normalizeBonus10Identity({ staffId, dateKey, sessionId, targetShiftKey });
    // v2 singleton is the teaching shift itself; sessionId remains evidence in
    // the document. This prevents minting the same shift repeatedly by changing
    // a session ID. Keep the old tuple only for Admin handling of legacy docs.
    return identity.targetShiftKey
        ? `b10~${identity.dateKey}~${identity.staffId}~${identity.targetShiftKey}`
        : `b10~${identity.dateKey}~${identity.staffId}~${identity.sessionId}`;
}

function _assertBonus10RequestIdentity(requestData, expected = {}) {
    const identity = _normalizeBonus10Identity(requestData || {});
    const normalizedExpected = _normalizeBonus10Identity(expected);
    if (identity.staffId !== normalizedExpected.staffId ||
        identity.dateKey !== normalizedExpected.dateKey ||
        identity.sessionId !== normalizedExpected.sessionId ||
        (normalizedExpected.targetShiftKey && identity.targetShiftKey !== normalizedExpected.targetShiftKey)) {
        const error = new Error('Yêu cầu +10 phút đang trỏ sang ca hoặc nhân sự khác. Đã dừng để tránh sửa nhầm công/lương.');
        error.code = 'bonus10/request-conflict';
        throw error;
    }
    return identity;
}

const BONUS10_SCHEDULE_SECTIONS = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];

function _cleanBonus10TargetPart(value) {
    return String(value == null ? '' : value)
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120);
}

function _bonus10TargetShiftKey(dateKey, scheduleDocId, section, rowIndex, shiftId = '', classStart = '', classEnd = '') {
    const stableShiftId = _cleanBonus10TargetPart(shiftId);
    const identity = stableShiftId
        ? `shift__${stableShiftId}`
        : `${_cleanBonus10TargetPart(scheduleDocId)}__${_cleanBonus10TargetPart(section)}__${String(classStart)}-${String(classEnd)}`;
    return `teaching__${_cleanBonus10TargetPart(dateKey)}__${identity}`.slice(0, 240);
}

function _normalizeBonus10ClaimMeta(meta = {}) {
    const scheduleDocId = String(meta.scheduleDocId || '').trim();
    const scheduleSection = String(meta.scheduleSection || '').trim();
    const scheduleIndex = Number(meta.scheduleIndex);
    const scheduleShiftId = String(meta.scheduleShiftId || '').trim();
    const targetShiftKey = String(meta.targetShiftKey || '').trim();
    const subjectId = String(meta.subjectId || '').trim();
    const classStart = String(meta.classStart || '').trim();
    const classEnd = String(meta.classEnd || '').trim();
    const checkInAt = String(meta.checkInAt || '').trim();
    const earlyMinutes = Number(meta.earlyMinutes);
    const scheduleRegistrationId = String(meta.scheduleRegistrationId || '').trim();
    const scheduleAssignmentList = String(meta.scheduleAssignmentList || '').trim();
    const scheduleAssignmentEntry = meta.scheduleAssignmentEntry &&
        typeof meta.scheduleAssignmentEntry === 'object' && !Array.isArray(meta.scheduleAssignmentEntry)
        ? { ...meta.scheduleAssignmentEntry }
        : {};
    const validAssignmentMeta = !scheduleAssignmentList || (
        ['gvList', 'gvThayTeList', 'gvThayTheList', 'registeredTeachers'].includes(scheduleAssignmentList) &&
        String(scheduleAssignmentEntry.id || '') === String(meta.staffId || '')
    );
    const valid = /^[A-Za-z0-9_-]{1,160}$/.test(scheduleDocId) &&
        BONUS10_SCHEDULE_SECTIONS.includes(scheduleSection) &&
        Number.isInteger(scheduleIndex) && scheduleIndex >= 0 && scheduleIndex <= 500 &&
        (!scheduleShiftId || /^[A-Za-z0-9_-]{1,160}$/.test(scheduleShiftId)) &&
        /^[A-Za-z0-9_:-]{1,240}$/.test(targetShiftKey) &&
        /^[A-Za-z0-9_-]{1,160}$/.test(subjectId) &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(classStart) &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(classEnd) &&
        checkInAt.length >= 20 && checkInAt.length <= 40 && Number.isFinite(Date.parse(checkInAt)) &&
        Number.isInteger(earlyMinutes) && earlyMinutes >= 10 && earlyMinutes <= 720 &&
        (!scheduleRegistrationId || /^[A-Za-z0-9_-]{1,180}$/.test(scheduleRegistrationId)) &&
        validAssignmentMeta;
    if (!valid) {
        const error = new Error('Thiếu định danh ca dạy hoặc bằng chứng vào sớm hợp lệ. Hãy tải lại bảng công rồi gửi lại.');
        error.code = 'bonus10/invalid-claim';
        throw error;
    }
    const expectedTarget = _bonus10TargetShiftKey(
        String(meta.dateKey || ''), scheduleDocId, scheduleSection, scheduleIndex, scheduleShiftId,
        classStart, classEnd
    );
    if (!meta.dateKey || targetShiftKey !== expectedTarget) {
        const error = new Error('Ca dạy đã thay đổi hoặc định danh +10 phút không còn khớp lịch.');
        error.code = 'bonus10/target-conflict';
        throw error;
    }
    return {
        awardScope: 'teaching_shift', targetShiftKey, subjectId,
        scheduleDocId, scheduleSection, scheduleIndex, scheduleShiftId,
        scheduleRegistrationId, scheduleAssignmentList, scheduleAssignmentEntry,
        classStart, classEnd, checkInAt, earlyMinutes
    };
}

function _nextBonus10PenaltyState(monthlySettings, active, actorUserId, details = {}) {
    const current = monthlySettings?.bonus10PenaltyState &&
        typeof monthlySettings.bonus10PenaltyState === 'object'
        ? monthlySettings.bonus10PenaltyState
        : {};
    const currentVersion = Number.isInteger(current.version) && current.version >= 0
        ? current.version
        : 0;
    const state = {
        schemaVersion: 1,
        active: active === true,
        version: currentVersion + 1,
        reason: active === true ? 'request_rejected' : 'admin_cleared',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: String(actorUserId || '').trim() || 'admin'
    };
    const requestId = String(details.requestId || '').trim();
    const sessionId = String(details.sessionId || '').trim();
    const dateKey = String(details.dateKey || '').trim();
    if (requestId) state.lastRequestId = requestId.slice(0, 500);
    if (sessionId) state.lastSessionId = sessionId.slice(0, 160);
    if (dateKey) state.lastDateKey = dateKey.slice(0, 10);
    if (active !== true) {
        state.clearedAt = firebase.firestore.FieldValue.serverTimestamp();
        state.clearedBy = state.updatedBy;
    }
    return state;
}

function _writeBonus10PenaltyState(transaction, monthlyRef, monthlySnapshot, active, actorUserId, details = {}) {
    const monthlySettings = monthlySnapshot?.exists ? (monthlySnapshot.data() || {}) : {};
    const bonus10PenaltyState = _nextBonus10PenaltyState(
        monthlySettings,
        active,
        actorUserId,
        details
    );
    if (monthlySnapshot?.exists) {
        // `update` replaces the whole top-level map, so stale cleared/rejected
        // metadata cannot leak into the next explicit state transition.
        transaction.update(monthlyRef, { bonus10PenaltyState });
    } else {
        transaction.set(monthlyRef, {
            userId: String(details.staffId || '').trim(),
            month: String(details.monthStr || '').trim(),
            bonus10PenaltyState
        });
    }
    return bonus10PenaltyState;
}

function _isBonus10PenaltyActive(monthlySettings, requests) {
    const chips = (Array.isArray(requests) ? requests : []).map(request => ({
        bonus10Status: request?.status,
        studentCountStatus: request?.studentCountStatus
    }));
    if (typeof window !== 'undefined' && window.Early10 &&
        typeof window.Early10.isMonthlyBonusPenaltyActive === 'function') {
        return window.Early10.isMonthlyBonusPenaltyActive(monthlySettings || {}, chips);
    }
    if (monthlySettings?.studentCountBonusPenalty) return true;
    if (chips.some(chip => chip.studentCountStatus === 'rejected')) return true;
    const marker = monthlySettings?.bonus10PenaltyState;
    if (marker && typeof marker.active === 'boolean') return marker.active;
    return chips.some(chip => chip.bonus10Status === 'rejected');
}

function _requireBonus10ManagerAuthorization(authorization) {
    const roles = Array.isArray(authorization?.roles) ? authorization.roles : [];
    const actorUserId = String(authorization?.userId || '').trim();
    if (!actorUserId || !roles.some(role => role === 'admin' || role === 'senior_assistant')) {
        const error = new Error('Chỉ Admin/quản lý được duyệt, từ chối hoặc gỡ khóa +10 phút.');
        error.code = 'auth/admin-required';
        throw error;
    }
    return actorUserId;
}

// A single physical teaching session can represent several classes that are
// intentionally scheduled for the same teacher in the exact same window. The
// schedule evaluator already pays that concurrent window once; the schedule
// attendance editor must therefore preserve the joined subject-role set rather
// than forcing the session back to whichever row happened to open the popup.
function _normalizeScheduleSubjectIds(value) {
    return Array.from(new Set(String(value || '')
        .split('+')
        .map(item => item.trim())
        .filter(Boolean)))
        .sort();
}

function _sameScheduleSubjectIdSet(left, right) {
    const a = _normalizeScheduleSubjectIds(Array.isArray(left) ? left.join('+') : left);
    const b = _normalizeScheduleSubjectIds(Array.isArray(right) ? right.join('+') : right);
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

function _isTeachingScheduleSectionClosed(dateKey, section, centerClosures) {
    const closures = centerClosures && Array.isArray(centerClosures[dateKey])
        ? centerClosures[dateKey]
        : [];
    const sectionKey = String(section || '').trim();
    if (closures.includes('all') || (sectionKey && closures.includes(sectionKey))) return true;
    const parentPeriod = /^(morning|afternoon|evening)[12]$/.exec(sectionKey)?.[1] || '';
    return !!parentPeriod && closures.includes(parentPeriod);
}

// ADMIN_STUDENT_COUNT_MUTATION_START
function _applyAdminStudentCountMutation(session, dirty, studentCount, nowISO, actorUserId) {
    if (!session || dirty !== true) return session;
    if (studentCount == null) {
        delete session.studentCount;
        delete session.studentCountStatus;
        delete session.studentCountUpdatedAt;
        delete session.studentCountUpdatedBy;
        delete session.studentCountReviewedAt;
        delete session.studentCountReviewedBy;
        return session;
    }
    session.studentCount = studentCount;
    session.studentCountStatus = 'approved';
    session.studentCountUpdatedAt = nowISO;
    session.studentCountUpdatedBy = actorUserId;
    session.studentCountReviewedAt = nowISO;
    session.studentCountReviewedBy = actorUserId;
    return session;
}
// ADMIN_STUDENT_COUNT_MUTATION_END

// Stable optimistic-concurrency token for the Bảng Công payroll-allocation
// editor.  The token intentionally covers raw clock evidence, legacy links and
// the complete override payload: an Admin must never save an old popup over a
// newer correction made in another tab.
function _adminPayrollSessionFingerprint(session) {
    const source = session && typeof session === 'object' ? session : {};
    const snapshot = {
        id: source.id ?? null,
        checkIn: source.checkIn || source.start || null,
        checkOut: source.checkOut || null,
        isAbsent: source.isAbsent === true,
        role: source.role || null,
        roleName: source.roleName || null,
        roleRate: source.roleRate ?? null,
        isFixedShift: source.isFixedShift === true,
        linkedClassStart: source.linkedClassStart || null,
        linkedReceptionistShift: source.linkedReceptionistShift || null,
        linkedOfficeShift: source.linkedOfficeShift || null,
        linkedScheduleShiftId: source.linkedScheduleShiftId || null,
        linkedScheduleCompositeKey: source.linkedScheduleCompositeKey || null,
        linkedScheduleSection: source.linkedScheduleSection || null,
        adminPayrollOverride: source.adminPayrollOverride || null
    };
    return JSON.stringify(snapshot);
}

function _serializedAdminPayrollOverride(normalized, revision, actor, reason) {
    const allocations = (normalized.allocations || []).map(allocation => ({
        id: String(allocation.id || '').trim(),
        kind: allocation.kind,
        fromISO: allocation.fromISO,
        toISO: allocation.toISO,
        subjectIds: Array.isArray(allocation.subjectIds) ? allocation.subjectIds.slice() : [],
        role: allocation.role || '',
        roleName: allocation.roleName || '',
        rateMode: allocation.rateMode === 'manual' ? 'manual' : 'policy',
        manualRate: Number.isFinite(allocation.manualRate) ? allocation.manualRate : null,
        roleRate: Number.isFinite(allocation.roleRate) ? allocation.roleRate : null,
        fixed: allocation.fixed === true,
        mergeGroupId: allocation.mergeGroupId || '',
        scheduleRef: allocation.scheduleRef || null,
        note: allocation.note || ''
    }));
    return {
        version: 1,
        mode: normalized.mode,
        revision,
        allocations,
        // This is an explicit Primary-Admin decision for one teaching
        // allocation. It deliberately lives beside the absolute payroll
        // allocation instead of impersonating a self-service schedule claim.
        adminEarly10: normalized.adminEarly10?.enabled === true ? {
            enabled: true,
            minutes: 10,
            allocationId: String(normalized.adminEarly10.allocationId || '').trim(),
            appliedBy: {
                authUid: actor.uid,
                userId: actor.userId
            },
            appliedAt: new Date().toISOString()
        } : { enabled: false },
        reason: String(reason || '').trim().slice(0, 500),
        editedBy: {
            authUid: actor.uid,
            userId: actor.userId
        },
        // This object is embedded in attendance_logs.sessions[]. Firestore
        // rejects a server timestamp sentinel anywhere inside an array, even
        // though the same sentinel is valid at the document root. Keep the
        // nested audit time as immutable display data; the surrounding
        // attendance document/audit document still receives server time.
        editedAt: new Date().toISOString()
    };
}

function _resolveConcurrentTeachingSubjectSet(rows, staffId, scheduledStart, scheduledEnd, subjects, teacherShiftState) {
    const employeeId = String(staffId || '').trim();
    const start = String(scheduledStart || '').trim();
    const end = String(scheduledEnd || '').trim();
    const catalog = Array.isArray(subjects) ? subjects : [];
    const state = teacherShiftState || {};
    const activeRows = (Array.isArray(rows) ? rows : []).filter(row => {
        if (!row || row.isClosed === true || String(row.start || '').trim() !== start ||
            String(row.end || '').trim() !== end) return false;
        const isActiveMain = typeof state.getMainTeachers === 'function' &&
            state.getMainTeachers(row).some(item => String(item?.id || '').trim() === employeeId) &&
            !(typeof state.isMainTeacherAbsent === 'function' && state.isMainTeacherAbsent(row, employeeId));
        const isSubstitute = typeof state.getSubstituteTeachers === 'function' &&
            state.getSubstituteTeachers(row).some(item => String(item?.id || '').trim() === employeeId);
        return isActiveMain || isSubstitute;
    });

    const ids = new Set();
    const resolvedByName = [];
    activeRows.forEach(row => {
        const explicitIds = _normalizeScheduleSubjectIds(row.lopId || '');
        if (explicitIds.length) {
            explicitIds.forEach(id => ids.add(id));
            return;
        }

        const subjectName = String(row.lop || '').trim();
        const exactMatches = catalog.filter(subject => String(subject?.name || '').trim() === subjectName);
        if (!subjectName || exactMatches.length !== 1 || !String(exactMatches[0]?.id || '').trim()) {
            const error = new Error(exactMatches.length > 1
                ? `Môn/Lớp “${subjectName || '?'}” của ca trùng giờ đang bị trùng tên dữ liệu.`
                : `Môn/Lớp “${subjectName || '?'}” của ca trùng giờ chưa có mã dữ liệu duy nhất.`);
            error.code = 'schedule/subject-conflict';
            throw error;
        }
        const resolvedId = String(exactMatches[0].id).trim();
        ids.add(resolvedId);
        resolvedByName.push({ id: resolvedId, name: subjectName });
    });

    return {
        ids: Array.from(ids).sort(),
        rows: activeRows,
        resolvedByName
    };
}

// SCHEDULE REGISTRATION HELPERS START
const SCHEDULE_SECTION_KEYS = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];

function _scheduleRegistrationRowSignature(row) {
    return [row?.start, row?.end, row?.lop, row?.phong]
        .map(value => String(value || '').trim())
        .join('|');
}

function _scheduleRegistrationHash(value, seed) {
    let hash = seed >>> 0;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36);
}

function _scheduleRegistrationId(scheduleKey, section, row, userId, rowIndex = -1) {
    // Signature is stable even for an inherited (not-yet-materialized) schedule;
    // inherited rows receive an ephemeral shiftId on each read.
    const locator = _scheduleRegistrationRowSignature(row);
    const raw = [scheduleKey, section, rowIndex, locator, userId].join('::');
    const safeUserId = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'staff';
    return `reg_${_scheduleRegistrationHash(raw, 2166136261)}_${_scheduleRegistrationHash(raw, 3335557771)}_${safeUserId}`;
}

function _scheduleRegistrationUpdatedMillis(registration) {
    const value = registration?.updatedAt || registration?.createdAt;
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (Number.isFinite(value?.seconds)) return value.seconds * 1000 + Number(value.nanoseconds || 0) / 1e6;
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
}

function _mergeScheduleRegistrations(schedule, registrations) {
    const merged = { ...(schedule || {}) };
    const bySection = new Map();
    (registrations || []).forEach(registration => {
        const section = String(registration?.section || '');
        if (!SCHEDULE_SECTION_KEYS.includes(section) || !registration?.userId) return;
        if (!bySection.has(section)) bySection.set(section, []);
        bySection.get(section).push(registration);
    });

    SCHEDULE_SECTION_KEYS.forEach(section => {
        if (!Array.isArray(schedule?.[section])) return;
        const sectionRegistrations = bySection.get(section) || [];
        merged[section] = schedule[section].map((row, rowIndex) => {
            const signature = _scheduleRegistrationRowSignature(row);
            const matching = sectionRegistrations.filter(registration => {
                const shiftMatches = registration.shiftId && row?.shiftId &&
                    String(registration.shiftId) === String(row.shiftId);
                const legacyMatches = String(registration.rowSignature || '') === signature &&
                    (!Number.isInteger(registration.rowIndex) || registration.rowIndex === rowIndex);
                return shiftMatches || legacyMatches;
            });
            if (!matching.length) return { ...row, registeredTeachers: [...(row.registeredTeachers || [])] };

            // At most one current registration per staff/row is expected. If a
            // locator changed in older data, the latest status deterministically wins.
            const latestByUser = new Map();
            matching.forEach(registration => {
                const userId = String(registration.userId);
                const previous = latestByUser.get(userId);
                if (!previous || _scheduleRegistrationUpdatedMillis(registration) >= _scheduleRegistrationUpdatedMillis(previous)) {
                    latestByUser.set(userId, registration);
                }
            });
            const teachers = new Map((row.registeredTeachers || [])
                .filter(item => item?.id)
                .map(item => [String(item.id), { ...item }]));
            latestByUser.forEach(registration => {
                const userId = String(registration.userId);
                teachers.delete(userId); // cancelled is a tombstone for legacy embedded data
                if (registration.status === 'active') {
                    teachers.set(userId, {
                        id: userId,
                        name: registration.userName || registration.name || 'Staff',
                        timestamp: registration.updatedAt || registration.createdAt || '',
                        branch: registration.branch || '',
                        registrationId: registration.id || '',
                        registrationSource: 'schedule_registrations'
                    });
                }
            });
            return { ...row, registeredTeachers: Array.from(teachers.values()) };
        });
    });
    return merged;
}

function _withoutSeparateScheduleRegistrations(schedule) {
    const clean = { ...(schedule || {}) };
    SCHEDULE_SECTION_KEYS.forEach(section => {
        if (!Array.isArray(schedule?.[section])) return;
        clean[section] = schedule[section].map(row => {
            // These locators exist only on the target-date projection returned
            // by getSchedule(). Once a scheduler materializes that day, the
            // stable inherited shiftId remains but the projection markers must
            // not become business data.
            const {
                _isInheritedSchedule,
                _inheritedFromScheduleDocId,
                _inheritedTargetScheduleDocId,
                _inheritedSection,
                _inheritedIndex,
                ...persistedRow
            } = row || {};
            return {
                ...persistedRow,
                registeredTeachers: (row?.registeredTeachers || [])
                    .filter(item => item?.registrationSource !== 'schedule_registrations')
                    .map(item => {
                        const { registrationId, registrationSource, ...legacy } = item || {};
                        return legacy;
                    })
            };
        });
    });
    return clean;
}
// SCHEDULE REGISTRATION HELPERS END

// Trạng thái GV báo nghỉ được lưu THEO TỪNG LỚP/CA, thay vì suy đoán từ việc
// đã có GV thay thế. Nhờ vậy người xếp lịch có thể ghi nhận "đang chờ người
// thay" từ sớm và vẫn khôi phục đúng một ca khi GV đi làm lại.
function getTeacherAbsenceRecord(cls, staffId) {
    if (!cls || !staffId || !Array.isArray(cls.teacherAbsences)) return null;
    return cls.teacherAbsences.find(item =>
        item && String(item.teacherId || item.id || '') === String(staffId)
    ) || null;
}

function isTeacherExplicitlyAbsent(cls, staffId) {
    return !!getTeacherAbsenceRecord(cls, staffId);
}

function isMainTeacherAbsentFromClass(cls, staffId) {
    if (!isScheduledMainTeacher(cls, staffId)) return false;
    // Có mảng mới (kể cả rỗng) thì nó là nguồn sự thật theo từng GV. Chỉ dữ
    // liệu cũ chưa có trường này mới phải suy đoán "có GV thay = GV chính nghỉ".
    return Array.isArray(cls?.teacherAbsences)
        ? isTeacherExplicitlyAbsent(cls, staffId)
        : hasScheduledSubstitute(cls);
}

function getMainTeacherAbsenceTypeForGuard(cls, staffId) {
    if (!isMainTeacherAbsentFromClass(cls, staffId)) return 'ACTIVE';
    const explicitType = String(getTeacherAbsenceRecord(cls, staffId)?.type || '').trim().toUpperCase();
    return explicitType === 'VP' ? 'VP' : 'VDX';
}

// GV được xếp cho lớp (GV chính, GV thay thế, hoặc tự nhận lớp)
function isAssignedToClass(cls, staffId) {
    return isScheduledMainTeacher(cls, staffId) ||
        isScheduledSubstitute(cls, staffId) ||
        ((cls && cls.registeredTeachers) || []).some(t => t.id === staffId);
}

const LOCATION_CACHE_TTL_MS = 2 * 60 * 1000;
const ATTENDANCE_LOCATION_RECOVERY_TIMEOUT_MS = 26000;
const ATTENDANCE_LOCATION_PUBLIC_MESSAGE = "IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để chấm công.";
const ATTENDANCE_LOCATION_DIAGNOSTIC_COLLECTION = 'attendance_location_events';
const ATTENDANCE_LOCATION_ACK_KEY = 'tdt-attendance-location-ack-v1';
let lastBrowserLocation = null;

function rememberAttendanceLocationAcknowledgement(userId) {
    const staffId = String(userId || '').trim();
    if (!staffId || typeof localStorage === 'undefined') return false;
    try {
        const raw = JSON.parse(localStorage.getItem(ATTENDANCE_LOCATION_ACK_KEY) || '{}');
        raw[staffId] = {
            origin: typeof location !== 'undefined' ? location.origin : '',
            acknowledgedAt: raw[staffId]?.acknowledgedAt || new Date().toISOString()
        };
        localStorage.setItem(ATTENDANCE_LOCATION_ACK_KEY, JSON.stringify(raw));
        return true;
    } catch (_) {
        return false;
    }
}

function hasAttendanceLocationAcknowledgement(userId) {
    const staffId = String(userId || '').trim();
    if (!staffId || typeof localStorage === 'undefined') return false;
    try {
        const raw = JSON.parse(localStorage.getItem(ATTENDANCE_LOCATION_ACK_KEY) || '{}');
        return !!raw?.[staffId]?.acknowledgedAt;
    } catch (_) {
        return false;
    }
}

function createAttendanceLocationError(code, cause = null) {
    const error = new Error(ATTENDANCE_LOCATION_PUBLIC_MESSAGE);
    error.name = 'AttendanceLocationError';
    error.code = code;
    // Keep the technical cause available to developers without changing the
    // staff-facing message or storing precise coordinates anywhere.
    if (cause) error.cause = cause;
    return error;
}

async function getAttendanceLocationPermissionState() {
    try {
        if (!navigator.permissions?.query) return 'unsupported';
        const status = await navigator.permissions.query({ name: 'geolocation' });
        return ['granted', 'prompt', 'denied'].includes(status?.state) ? status.state : 'unknown';
    } catch (_) {
        return 'unknown';
    }
}

function getAttendanceClientContext() {
    const ua = String(navigator.userAgent || '').toLowerCase();
    const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
        window.navigator.standalone === true;
    let browserContext = standalone ? 'standalone' : 'browser';
    if (/zalo/.test(ua)) browserContext = 'zalo';
    else if (/fbav|fban|instagram/.test(ua)) browserContext = 'social_webview';
    else if (/; wv\)|\bwv\b|version\/4\.0.*chrome/.test(ua)) browserContext = 'android_webview';

    let platform = 'desktop';
    if (/android/.test(ua)) platform = 'android';
    else if (/iphone|ipad|ipod/.test(ua)) platform = 'ios';

    return {
        browserContext,
        platform,
        secureContext: window.isSecureContext === true,
        online: navigator.onLine !== false
    };
}

async function recordAttendanceLocationFailure(userId, code, stage = 'location_gate') {
    try {
        const authUid = firebase.auth().currentUser?.uid;
        if (!authUid || !userId || !db) return false;
        const dateKey = getLocalDateKeyFromDate(new Date());
        const safeCode = String(code || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64);
        const safeStage = String(stage || 'location_gate').replace(/[^a-z0-9_]/gi, '_').slice(0, 32);
        const permissionState = await getAttendanceLocationPermissionState();
        const context = getAttendanceClientContext();
        const appVersion = typeof APP_VERSION !== 'undefined' ? String(APP_VERSION) : 'unknown';
        const eventId = `${dateKey}_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await db.collection(ATTENDANCE_LOCATION_DIAGNOSTIC_COLLECTION).doc(eventId).set({
            authUid,
            staffId: String(userId),
            dateKey,
            code: safeCode,
            stage: safeStage,
            permissionState,
            browserContext: context.browserContext,
            platform: context.platform,
            secureContext: context.secureContext,
            online: context.online,
            appVersion,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return true;
    } catch (diagnosticError) {
        console.warn('[AttendanceLocation] Diagnostic write failed:', diagnosticError?.code || diagnosticError?.message || 'UNKNOWN');
        return false;
    }
}

function mapBrowserLocationError(error) {
    const numericCode = Number(error?.code);
    if (numericCode === 1) return 'PERMISSION_DENIED';
    if (numericCode === 3) return 'TIMEOUT';
    return 'POSITION_UNAVAILABLE';
}

function cacheBrowserLocation(coords) {
    lastBrowserLocation = {
        coords,
        timestamp: Date.now()
    };
}

function getBrowserLocation(options = {}) {
    return new Promise((resolve, reject) => {
        const forceFresh = options.forceFresh === true;
        const maximumAge = forceFresh ? 0 : (options.maximumAge ?? LOCATION_CACHE_TTL_MS);
        if (
            !forceFresh &&
            lastBrowserLocation &&
            maximumAge > 0 &&
            Date.now() - lastBrowserLocation.timestamp <= maximumAge
        ) {
            resolve(lastBrowserLocation.coords);
            return;
        }

        if (typeof window === 'undefined' || !navigator.geolocation) {
            const error = new Error('Geolocation is unavailable.');
            error.locationCode = 'UNSUPPORTED';
            reject(error);
            return;
        }
        const handleSuccess = position => {
            cacheBrowserLocation(position.coords);
            resolve(position.coords);
        };

        navigator.geolocation.getCurrentPosition(
            handleSuccess,
            error => {
                if (
                    options.retryApproximate !== false &&
                    mapBrowserLocationError(error) !== 'PERMISSION_DENIED'
                ) {
                    navigator.geolocation.getCurrentPosition(
                        handleSuccess,
                        fallbackError => {
                            const finalError = new Error('Unable to acquire a browser location fix.');
                            finalError.locationCode = mapBrowserLocationError(fallbackError);
                            reject(finalError);
                        },
                        { enableHighAccuracy: false, timeout: 12000, maximumAge }
                    );
                    return;
                }

                const finalError = new Error('Unable to acquire a browser location fix.');
                finalError.locationCode = mapBrowserLocationError(error);
                reject(finalError);
            },
            { enableHighAccuracy: true, timeout: options.timeout ?? 15000, maximumAge }
        );
    });
}

function calculateDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in meters
}

function getConfiguredGPSCampuses(settings = {}) {
    return [
        { lat: settings.gpsCS1Lat, lng: settings.gpsCS1Lng, radius: settings.gpsCS1Radius || 200, name: 'CS1' },
        { lat: settings.gpsCS2Lat, lng: settings.gpsCS2Lng, radius: settings.gpsCS2Radius || 150, name: 'CS2' },
        { lat: settings.gpsCS3Lat, lng: settings.gpsCS3Lng, radius: settings.gpsCS3Radius || 200, name: 'CS3' }
    ].filter(campus => [campus.lat, campus.lng].every(value =>
        (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== ''
    )).map(campus => ({
        ...campus,
        lat: Number(campus.lat),
        lng: Number(campus.lng),
        radius: Number(campus.radius)
    })).filter(campus =>
        Number.isFinite(campus.lat) && campus.lat >= -90 && campus.lat <= 90 &&
        Number.isFinite(campus.lng) && campus.lng >= -180 && campus.lng <= 180 &&
        Number.isFinite(campus.radius) && campus.radius > 0
    );
}

function isAttendanceLocationAllowed(coords, campuses) {
    if (!coords || !Number.isFinite(Number(coords.latitude)) || !Number.isFinite(Number(coords.longitude))) {
        return false;
    }
    return campuses.some(campus => {
        const dist = calculateDistanceInMeters(
            Number(coords.latitude), Number(coords.longitude), campus.lat, campus.lng
        );
        const accuracy = Number.isFinite(Number(coords.accuracy)) ? Math.max(0, Number(coords.accuracy)) : 0;
        const allowedRadius = campus.radius + Math.min(accuracy, 250);
        return dist <= allowedRadius;
    });
}

// A single bounded fresh watch gives mobile/desktop providers time to warm up
// and improve a coarse first point. It never changes the configured radius and
// never resolves until a point passes the same campus check used below.
function getBrowserLocationFromWatch(campuses, options = {}) {
    return new Promise((resolve, reject) => {
        const geolocation = typeof window !== 'undefined' ? navigator.geolocation : null;
        if (!geolocation || typeof geolocation.watchPosition !== 'function') {
            const error = new Error('Geolocation watch is unavailable.');
            error.locationCode = 'UNSUPPORTED';
            reject(error);
            return;
        }

        const deadlineMs = Number.isFinite(Number(options.timeout))
            ? Math.max(1, Number(options.timeout))
            : ATTENDANCE_LOCATION_RECOVERY_TIMEOUT_MS;
        let watchId = null;
        let deadlineId = null;
        let settled = false;
        let sawPosition = false;
        let lastTransientCode = 'TIMEOUT';

        const cleanup = () => {
            if (deadlineId !== null) {
                clearTimeout(deadlineId);
                deadlineId = null;
            }
            if (watchId !== null && watchId !== undefined) {
                try {
                    geolocation.clearWatch(watchId);
                } catch (_) {
                    // Cleanup must never replace the attendance result.
                }
                watchId = null;
            }
        };
        const finishWithError = (locationCode, cause = null) => {
            if (settled) return;
            settled = true;
            cleanup();
            const error = new Error('Unable to acquire an allowed browser location fix.');
            error.locationCode = locationCode;
            if (cause) error.cause = cause;
            reject(error);
        };
        const finishWithPosition = coords => {
            if (settled) return;
            settled = true;
            cacheBrowserLocation(coords);
            cleanup();
            resolve(coords);
        };

        deadlineId = setTimeout(() => {
            finishWithError(sawPosition ? 'OUTSIDE_ALLOWED_RADIUS' : lastTransientCode);
        }, deadlineMs);

        try {
            const assignedWatchId = geolocation.watchPosition(
                position => {
                    if (settled) return;
                    const coords = position?.coords;
                    if (
                        !coords ||
                        !Number.isFinite(Number(coords.latitude)) ||
                        !Number.isFinite(Number(coords.longitude))
                    ) {
                        lastTransientCode = 'POSITION_UNAVAILABLE';
                        return;
                    }
                    sawPosition = true;
                    if (isAttendanceLocationAllowed(coords, campuses)) {
                        finishWithPosition(coords);
                    }
                },
                error => {
                    if (settled) return;
                    const locationCode = mapBrowserLocationError(error);
                    if (locationCode === 'PERMISSION_DENIED') {
                        finishWithError(locationCode, error);
                        return;
                    }
                    lastTransientCode = locationCode;
                },
                {
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: Math.min(20000, deadlineMs)
                }
            );
            watchId = assignedWatchId;
            // Defensive cleanup for non-standard mocks/providers that invoke a
            // callback synchronously before returning the watcher ID.
            if (settled && watchId !== null && watchId !== undefined) {
                try {
                    geolocation.clearWatch(watchId);
                } catch (_) {
                    // Cleanup must never replace the attendance result.
                }
                watchId = null;
            }
        } catch (error) {
            finishWithError(mapBrowserLocationError(error), error);
        }
    });
}

async function assertAttendanceLocationAllowed(settings = {}) {
    const campuses = getConfiguredGPSCampuses(settings);
    if (campuses.length === 0) throw createAttendanceLocationError('CONFIG_UNAVAILABLE');

    let firstCoords;
    try {
        // Each deliberate check-in needs a new fix, even if the user has
        // granted permission before or another account just used this tab.
        firstCoords = await getBrowserLocation({ forceFresh: true });
    } catch (e) {
        console.warn('[AttendanceLocation] Initial browser fix failed:', e?.locationCode || 'UNKNOWN');
        const initialCode = e?.locationCode || 'ACQUIRE_FAILED';
        // Some Safari providers return code 1 while Permissions reports granted.
        // Try one bounded fresh watch only in that contradictory state; never
        // re-prompt a denied/prompt/unknown permission or accept without a fix.
        const permissionContradiction = initialCode === 'PERMISSION_DENIED' &&
            await getAttendanceLocationPermissionState() === 'granted';
        if (!['TIMEOUT', 'POSITION_UNAVAILABLE'].includes(initialCode) && !permissionContradiction) {
            throw createAttendanceLocationError(initialCode, e);
        }

        // Some providers report unavailable while their first fix is warming up.
        // Wait through one bounded, fresh watcher instead of firing more one-shot
        // requests back-to-back.
        lastBrowserLocation = null;
        try {
            await getBrowserLocationFromWatch(campuses);
            return true;
        } catch (freshError) {
            console.warn('[AttendanceLocation] Recovery browser fix failed:', freshError?.locationCode || 'UNKNOWN');
            const freshCode = freshError?.locationCode || 'ACQUIRE_FAILED';
            throw createAttendanceLocationError(
                freshCode === 'OUTSIDE_ALLOWED_RADIUS' ? freshCode : `RECOVERY_${freshCode}`,
                freshError
            );
        }
    }

    if (isAttendanceLocationAllowed(firstCoords, campuses)) return true;

    // A browser may first return a cached/coarse position. One bounded fresh
    // watcher can wait for a better point without weakening the campus radius.
    lastBrowserLocation = null;
    try {
        await getBrowserLocationFromWatch(campuses);
        return true;
    } catch (e) {
        console.warn('[AttendanceLocation] Fresh browser fix failed:', e?.locationCode || 'UNKNOWN');
        const freshCode = e?.locationCode || 'ACQUIRE_FAILED';
        if (freshCode !== 'OUTSIDE_ALLOWED_RADIUS') {
            throw createAttendanceLocationError(`FRESH_${freshCode}`, e);
        }
    }

    throw createAttendanceLocationError('OUTSIDE_ALLOWED_RADIUS');
}

// ===== Authentication profile resolution =====
// Firebase Auth emails are generated from usernames, so comparison must be
// case-insensitive while preserving the original profile value for display.
function _normalizeAuthUsername(value) {
    return String(value || '').trim().toLocaleLowerCase('en-US');
}

function _getUsernameFromAuthUser(authUser) {
    const email = String(authUser?.email || '').trim();
    const separatorIndex = email.lastIndexOf('@');
    if (separatorIndex <= 0) return '';
    const domain = email.slice(separatorIndex + 1).toLocaleLowerCase('en-US');
    return domain === 'tuduytre.com' ? email.slice(0, separatorIndex) : '';
}

function _normalizeRoleList(value) {
    const rawRoles = Array.isArray(value?.roles) && value.roles.length
        ? value.roles
        : (value?.role ? [value.role] : []);
    return [...new Set(rawRoles
        .map(role => String(role || '').trim())
        .filter(Boolean))];
}

function _clearStoredAuthSession() {
    if (typeof window === 'undefined') return;
    if (typeof window.clearAuthSessionStorage === 'function') {
        window.clearAuthSessionStorage();
        return;
    }

    [
        'currentUser',
        'currentRole',
        'currentUserId',
        'currentAuthUid',
        'userFullName',
        'currentUserName'
    ].forEach(key => window.localStorage?.removeItem(key));
}

function _createAuthProfileError(message, code = 'auth/profile-mismatch') {
    const error = new Error(message);
    error.code = code;
    return error;
}

// A resumed PWA/WebView can still show the signed-in shell while its Firestore
// credential has just become stale (for example after the device restores a
// backgrounded tab). Check-in is a transaction, so retrying an arbitrary error
// would be unsafe: a network failure can happen after a commit. A permission
// denial, however, is a rejected commit. Refreshing the same Firebase user's
// token and retrying that operation exactly once is safe and lets the staff
// member recover without having to clear browser data.
function _isFirestorePermissionDenied(error) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    return code.includes('permission-denied') ||
        message.includes('missing or insufficient permissions');
}

function _attendanceAuthError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function _getAttendanceAuthUser(forceRefresh = false) {
    const primaryAuth = window.auth || (typeof firebase !== 'undefined' ? firebase.auth() : null);
    const actor = primaryAuth?.currentUser;
    if (!actor?.uid) {
        throw _attendanceAuthError(
            'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại trước khi Vào ca.',
            'auth/session-missing'
        );
    }
    if (typeof actor.getIdToken !== 'function') {
        throw _attendanceAuthError(
            'Không thể xác nhận phiên chấm công. Vui lòng đăng nhập lại.',
            'auth/attendance-token-unavailable'
        );
    }

    try {
        const token = await actor.getIdToken(forceRefresh === true);
        if (!token) {
            throw _attendanceAuthError(
                'Không thể xác nhận phiên chấm công. Vui lòng đăng nhập lại.',
                'auth/attendance-token-unavailable'
            );
        }
    } catch (error) {
        if (error?.code) throw error;
        throw _attendanceAuthError(
            'Không thể làm mới phiên chấm công. Vui lòng đăng nhập lại.',
            'auth/attendance-token-unavailable'
        );
    }
    if (primaryAuth.currentUser?.uid !== actor.uid) {
        throw _attendanceAuthError('Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại.', 'auth/session-changed');
    }
    return actor;
}

// Display text is trimmed in the UI. Rules validate the original profile
// value, so never use localStorage/display text as an authoritative write name.
function _canonicalStaffWriteName(profileSnapshot) {
    if (!profileSnapshot.exists) {
        throw _attendanceAuthError('Không tìm thấy hồ sơ nhân viên.', 'auth/profile-missing');
    }
    const profile = profileSnapshot.data();
    const name = [profile.name, profile.username].find(value =>
        typeof value === 'string' && value.trim().length > 0 && value.length <= 120);
    if (!name) throw _attendanceAuthError('Hồ sơ nhân viên cần được kiểm tra.', 'auth/profile-invalid');
    return name;
}

function _normalizeOvertimeRequest(record) {
    const result = { ...record };
    // The legacy Admin editor wrote its chosen minutes into numeric duration
    // and left minutes stale/missing. Staff requests use an HH:MM string.
    // Correct the read projection only; published payslip snapshots stay intact.
    if (result.status === 'approved' && typeof result.duration === 'number' &&
        Number.isSafeInteger(result.duration) && result.duration >= 0) {
        result.minutes = result.duration;
        result.duration = `${String(Math.floor(result.minutes / 60)).padStart(2, '0')}:${String(result.minutes % 60).padStart(2, '0')}`;
    }
    return result;
}

async function _runAttendanceFirestoreOperation(operation) {
    const initialActor = await _getAttendanceAuthUser(false);
    try {
        return await operation(initialActor);
    } catch (error) {
        if (!_isFirestorePermissionDenied(error)) throw error;

        console.warn('[Attendance] Firestore denied the current credential; refreshing it once before retrying.');
        const refreshedActor = await _getAttendanceAuthUser(true);
        if (refreshedActor.uid !== initialActor.uid) {
            throw _attendanceAuthError(
                'Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại trước khi Vào ca.',
                'auth/session-changed'
            );
        }

        // A permission-denied transaction did not commit, so this is the one
        // safe automatic retry. Network/timeout errors deliberately do not
        // enter this branch.
        return operation(refreshedActor);
    }
}

const DBService = {
    _cache: {},
    _cacheTime: {},
    _invalidate(pattern) {
        Object.keys(this._cache).forEach(key => {
            if (key.includes(pattern)) {
                delete this._cache[key];
                delete this._cacheTime[key];
            }
        });
    },
    _invalidateAttendance(dateKey, userId) {
        this._invalidate(`attendance_${dateKey}_${userId}`);
        if (dateKey && typeof dateKey === 'string') {
            const parts = dateKey.split('-');
            if (parts.length >= 2) {
                const monthStr = `${parts[0]}-${parts[1]}`;
                this._invalidate(`monthly_attendance_${monthStr}_${userId}`);
            }
        }
    },

    // 1. Kiểm tra kết nối
    testConnection: async () => {
        try {
            if (!window.db) throw new Error("Database chưa được khởi tạo");
            console.log("Database connection ready");
            return true;
        } catch (error) {
            console.error("Lỗi kết nối:", error);
            return false;
        }
    },

    // 2. Tham chiếu các Collection (Bảng dữ liệu)
    refs: {
        users: () => window.db.collection('users'),
        attendance: () => window.db.collection('attendance'),
        schedules: () => window.db.collection('schedules'),
        logs: () => window.db.collection('system_logs')
    },

    _getAuthenticatedDirectoryContext: async () => {
        const primaryAuth = window.auth || (typeof firebase !== 'undefined' ? firebase.auth() : null);
        const actor = primaryAuth?.currentUser;
        if (!actor?.uid) return { uid: '', userId: '', roles: [], canReadPrivateProfiles: false };
        const cacheKey = `directory_authz_${actor.uid}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];
        const promise = (async () => {
            try {
                const roleSnapshot = await db.collection('user_roles').doc(actor.uid).get();
                const roleData = roleSnapshot.exists ? (roleSnapshot.data() || {}) : {};
                const roles = _normalizeRoleList(roleData);
                return {
                    uid: actor.uid,
                    userId: String(roleData.userId || '').trim(),
                    roles,
                    canReadPrivateProfiles: roles.some(role => role === 'admin' || role === 'senior_assistant')
                };
            } catch (error) {
                console.warn('[Security] Cannot resolve directory scope; using public staff directory.', error?.code || 'unknown');
                return { uid: actor.uid, userId: '', roles: [], canReadPrivateProfiles: false };
            }
        })();
        DBService._cache[cacheKey] = promise;
        return promise;
    },

    // Authoritative authorization context for sensitive UI/actions. Unlike the
    // directory helper above, forceServer=true never falls back to a cached or
    // empty role silently: an Admin-only operation must fail closed when its
    // Firebase role mapping cannot be verified.
    getAuthenticatedAuthorizationContext: async (forceServer = false) => {
        const primaryAuth = window.auth || (typeof firebase !== 'undefined' ? firebase.auth() : null);
        const actor = primaryAuth?.currentUser;
        if (!actor?.uid) {
            const error = new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
            error.code = 'auth/session-missing';
            throw error;
        }
        const roleRef = db.collection('user_roles').doc(actor.uid);
        const roleSnapshot = forceServer
            ? await roleRef.get({ source: 'server' })
            : await roleRef.get();
        if (!roleSnapshot.exists) {
            const error = new Error('Tài khoản chưa có hồ sơ phân quyền hợp lệ.');
            error.code = 'auth/role-missing';
            throw error;
        }
        const roleData = roleSnapshot.data() || {};
        const mappedUserId = String(roleData.userId || '').trim();
        if (forceServer && !mappedUserId) {
            const error = new Error('Hồ sơ phân quyền chưa liên kết mã nhân sự. Vui lòng hoàn tất ánh xạ tài khoản trước khi dùng chức năng Admin.');
            error.code = 'auth/role-user-missing';
            throw error;
        }
        return {
            uid: actor.uid,
            userId: mappedUserId,
            roles: _normalizeRoleList(roleData),
            roleData
        };
    },

    _toStaffDirectoryProfile: (user) => {
        // Exact allow-list: payroll configuration, auth UID, password and
        // migration/audit metadata must never be copied to the shared roster.
        const publicKeys = [
            'id', 'name', 'displayName', 'username', 'role', 'roles',
            'specialty', 'specialties', 'branch', 'branches', 'department',
            'position', 'title', 'isActive', 'active', 'status', 'scheduleColor'
        ];
        const directoryProfile = {};
        publicKeys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(user || {}, key) && user[key] !== undefined) {
                directoryProfile[key] = user[key];
            }
        });
        return directoryProfile;
    },

    // Các hàm xử lý dữ liệu sẽ được thêm vào dưới đây (getUsers, checkIn, etc.)
    // 3. Resolve the Firestore profile that belongs to an authenticated UID.
    // The UID-keyed mapping is authoritative. Username lookup is retained only
    // for legacy mappings which do not yet contain userId.
    _findUserProfileCaseCompatible: async (username) => {
        const requestedUsername = String(username || '').trim();
        const normalizedUsername = _normalizeAuthUsername(requestedUsername);
        if (!normalizedUsername) return null;

        const usersRef = window.db.collection('users');
        const exactCandidates = [...new Set([requestedUsername, normalizedUsername].filter(Boolean))];
        for (const candidate of exactCandidates) {
            const exactSnapshot = await usersRef
                .where('username', '==', candidate)
                .limit(2)
                .get();
            if (exactSnapshot.size > 1) {
                throw _createAuthProfileError(
                    'Có nhiều hồ sơ trùng tên đăng nhập. Vui lòng liên hệ Admin!',
                    'auth/duplicate-profile'
                );
            }
            if (!exactSnapshot.empty) return exactSnapshot.docs[0];
        }

        // Firestore has no native case-insensitive equality. This scan only runs
        // for legacy mixed-case usernames after the indexed exact lookups fail.
        const legacySnapshot = await usersRef.get();
        const compatibleDocs = legacySnapshot.docs.filter(doc =>
            _normalizeAuthUsername(doc.data()?.username) === normalizedUsername
        );
        if (compatibleDocs.length > 1) {
            throw _createAuthProfileError(
                'Có nhiều hồ sơ trùng tên đăng nhập (khác chữ hoa/thường). Vui lòng liên hệ Admin!',
                'auth/duplicate-profile'
            );
        }
        return compatibleDocs[0] || null;
    },

    getAuthenticatedProfile: async (authUser, hints = {}) => {
        if (!authUser?.uid) {
            throw _createAuthProfileError('Phiên đăng nhập Firebase không hợp lệ!', 'auth/session-missing');
        }
        if (!window.db) {
            throw _createAuthProfileError('Không thể kết nối cơ sở dữ liệu!', 'auth/database-unavailable');
        }

        const authUsername = _getUsernameFromAuthUser(authUser);
        const normalizedAuthUsername = _normalizeAuthUsername(authUsername);
        const hintedUsername = String(hints.username || '').trim();
        if (!normalizedAuthUsername) {
            throw _createAuthProfileError('Tài khoản Firebase không có email đăng nhập hợp lệ!');
        }
        if (hintedUsername && _normalizeAuthUsername(hintedUsername) !== normalizedAuthUsername) {
            throw _createAuthProfileError('Tên đăng nhập không khớp với phiên Firebase!');
        }

        const roleSnapshot = await window.db.collection('user_roles').doc(authUser.uid).get();
        const roleMapping = roleSnapshot.exists ? roleSnapshot.data() : null;
        const mappedUserId = String(roleMapping?.userId || '').trim();
        const hintedUserId = String(hints.userId || '').trim();
        let profileDoc = null;

        if (mappedUserId) {
            // Never accept a localStorage user id that belongs to another UID.
            if (hintedUserId && hintedUserId !== mappedUserId) {
                throw _createAuthProfileError('Phiên đăng nhập không khớp hồ sơ nhân sự!');
            }
            const mappedSnapshot = await window.db.collection('users').doc(mappedUserId).get();
            if (!mappedSnapshot.exists) {
                throw _createAuthProfileError(
                    'Tài khoản đã xác thực nhưng hồ sơ được liên kết không tồn tại!',
                    'auth/profile-not-found'
                );
            }
            profileDoc = mappedSnapshot;
        } else {
            // Legacy compatibility: the Auth email is the lookup source, never a
            // role/user id supplied only by localStorage.
            profileDoc = await DBService._findUserProfileCaseCompatible(authUsername);
            if (!profileDoc) {
                throw _createAuthProfileError(
                    'Tài khoản xác thực thành công nhưng không tìm thấy dữ liệu hồ sơ!',
                    'auth/profile-not-found'
                );
            }
            if (hintedUserId && hintedUserId !== profileDoc.id) {
                throw _createAuthProfileError('Phiên đăng nhập không khớp hồ sơ nhân sự!');
            }
        }

        const { password: _legacyPassword, ...profileData } = profileDoc.data() || {};
        const userData = { id: profileDoc.id, ...profileData };
        const profileUsername = _normalizeAuthUsername(userData.username);
        if (!profileUsername || profileUsername !== normalizedAuthUsername) {
            throw _createAuthProfileError('Hồ sơ nhân sự không khớp tài khoản Firebase!');
        }
        if (roleMapping?.username
            && _normalizeAuthUsername(roleMapping.username) !== profileUsername) {
            throw _createAuthProfileError('UID Firebase đang được liên kết với tên đăng nhập khác!');
        }

        // Roles are read from the UID mapping when present. We never let a
        // browser session write or "repair" its own role mapping.
        const mappedRoles = _normalizeRoleList(roleMapping);
        const profileRoles = _normalizeRoleList(userData);
        const roles = roleMapping
            ? (mappedRoles.length ? mappedRoles : ['staff'])
            : (profileRoles.length ? profileRoles : ['staff']);
        const primaryRole = roles.includes(String(roleMapping?.role || '').trim())
            ? String(roleMapping.role).trim()
            : roles[0];

        return {
            ...userData,
            role: primaryRole,
            roles,
            authUid: authUser.uid,
            roleMappingVerified: Boolean(mappedUserId)
        };
    },

    // 4. Authenticate User (Firebase Auth + UID-bound profile)
    loginUser: async (username, password) => {
        const loginUsername = String(username || '').trim();
        try {
            if (!loginUsername) throw new Error('Vui lòng nhập tên đăng nhập!');

            // Password is intentionally passed through unchanged. Leading or
            // trailing spaces can be part of a valid Firebase password.
            const email = `${loginUsername}@tuduytre.com`.toLowerCase();
            const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
            return await DBService.getAuthenticatedProfile(userCredential.user, {
                username: loginUsername
            });
        } catch (error) {
            // A Firebase credential without a matching profile must never remain
            // signed in. Also remove stale client identity values on every error.
            try {
                const primaryAuth = window.auth || firebase.auth();
                if (primaryAuth) await primaryAuth.signOut();
            } catch (signOutError) {
                console.warn('Secure Login cleanup could not sign out Firebase:', signOutError);
            } finally {
                _clearStoredAuthSession();
            }

            console.error('Secure Login Error:', error);
            if (error.code === 'auth/wrong-password') throw new Error('Sai mật khẩu!');
            if (error.code === 'auth/user-not-found') throw new Error('Tài khoản không tồn tại!');
            if (error.code === 'auth/invalid-credential') throw new Error('Sai tên đăng nhập hoặc mật khẩu!');
            if (error.code === 'auth/too-many-requests') throw new Error('Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau!');
            if (error.code === 'auth/network-request-failed') throw new Error('Không thể kết nối máy chủ đăng nhập. Vui lòng kiểm tra mạng!');
            throw error;
        }
    },

    generateUniqueShortNames: (users) => {
        if (!users || !Array.isArray(users)) return users;

        // 1. Map users to parsing objects
        let parsingList = users.map(u => {
            const parts = u.name ? u.name.trim().split(/\s+/) : ['?'];
            return {
                ...u,
                nameParts: parts,
                lastName: parts[parts.length - 1],
                shortName: parts[parts.length - 1], // Default to just last name
                conflictLevel: 0
            };
        });

        let hasConflicts = true;
        let maxIterations = 5; // Prevent infinite loops just in case

        while (hasConflicts && maxIterations > 0) {
            hasConflicts = false;

            // Group by current shortName
            const nameGroups = {};
            parsingList.forEach(item => {
                if (!nameGroups[item.shortName]) nameGroups[item.shortName] = [];
                nameGroups[item.shortName].push(item);
            });

            // Resolve conflicts
            for (const [sName, group] of Object.entries(nameGroups)) {
                if (group.length > 1) { // Conflict found!
                    hasConflicts = true;
                    group.forEach(item => {
                        item.conflictLevel += 1;
                        if (item.nameParts.length > item.conflictLevel) {
                            // Prepend the initial of the previous name part
                            const idxToPrepend = item.nameParts.length - 1 - item.conflictLevel;
                            const initial = item.nameParts[idxToPrepend].charAt(0).toUpperCase();
                            item.shortName = `${initial}.${item.shortName}`;
                        } else {
                            // If we ran out of parts (e.g. 2 exactly same full names), we must append the ID or stop
                            item.shortName = `${item.shortName}(*${item.id.slice(-2)})`;
                        }
                    });
                }
            }
            maxIterations--;
        }

        // 2. Clean up and return original format with shortName attached
        return parsingList.map(item => {
            const { nameParts, lastName, conflictLevel, ...cleanUser } = item;
            return cleanUser;
        });
    },

    getUsers: async () => {
        const context = await DBService._getAuthenticatedDirectoryContext();
        const collectionName = context.canReadPrivateProfiles ? 'users' : 'staff_directory';
        const cacheKey = `users_all_${context.uid || 'anonymous'}_${collectionName}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                let snapshot;
                try {
                    snapshot = await db.collection(collectionName).get();
                } catch (directoryError) {
                    // Zero-downtime rollout: the frontend may reach production a
                    // few seconds before rules start allowing staff_directory.
                    // Falling back to the legacy collection is useful only while
                    // the old rules are active; final rules deny this list.
                    if (collectionName !== 'staff_directory') throw directoryError;
                    console.warn('[Security] Staff directory is not active yet; using rollout fallback.');
                    snapshot = await db.collection('users').get();
                }
                const rawUsers = snapshot.docs.map(doc => {
                    const { password: _legacyPassword, ...profile } = doc.data() || {};
                    return { id: doc.id, ...profile };
                });
                return DBService.generateUniqueShortNames(rawUsers);
            } catch (error) {
                console.error("Error getting users:", error);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getUser: async (userId) => {
        if (!userId) return null;
        const context = await DBService._getAuthenticatedDirectoryContext();
        const collectionName = context.canReadPrivateProfiles || context.userId === String(userId)
            ? 'users'
            : 'staff_directory';
        const cacheKey = `user_${userId}_${context.uid || 'anonymous'}_${collectionName}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                let profileDoc;
                try {
                    profileDoc = await db.collection(collectionName).doc(userId).get();
                } catch (directoryError) {
                    if (collectionName !== 'staff_directory') throw directoryError;
                    console.warn('[Security] Staff directory is not active yet; using rollout fallback.');
                    profileDoc = await db.collection('users').doc(userId).get();
                }
                if (!profileDoc.exists) return null;
                const { password: _legacyPassword, ...profile } = profileDoc.data() || {};
                return { id: profileDoc.id, ...profile };
            } catch (error) {
                console.error("Error getting user:", error);
                return null;
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    // Credentials are isolated from the staff profile collection. Only verified
    // managers may read this compatibility store; normal authenticated users can
    // never download colleagues' passwords through getUsers().
    getUserCredentialsMap: async () => {
        // The compatibility credential store is a primary-Admin boundary, not
        // an operational-manager directory.  A senior assistant can maintain
        // non-security profile fields, but must never download staff passwords.
        const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
        if (!authorization.roles.includes('admin')) return {};
        const snapshot = await db.collection('user_credentials').get();
        const result = {};
        snapshot.forEach(doc => {
            const data = doc.data() || {};
            result[doc.id] = { staffId: doc.id, password: data.password || '' };
        });
        return result;
    },

    updateOwnCredentialPassword: async (staffId, password) => {
        if (!staffId || !password) throw new Error('Thiếu thông tin cập nhật mật khẩu.');
        await db.collection('user_credentials').doc(staffId).set({
            staffId,
            password,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return true;
    },

    _authorizeUserProfileSave: async (user) => {
        const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
        const isPrimaryAdmin = authorization.roles.includes('admin');
        if (isPrimaryAdmin) {
            return { authorization, isPrimaryAdmin: true, existingProfile: null };
        }
        if (!authorization.roles.includes('senior_assistant')) {
            throw _createAuthProfileError(
                'Bạn không có quyền cập nhật hồ sơ nhân sự.',
                'auth/profile-save-forbidden'
            );
        }

        const userId = String(user?.id || '').trim();
        if (!userId) {
            throw _createAuthProfileError(
                'Thiếu mã nhân sự cần cập nhật.',
                'auth/profile-id-missing'
            );
        }
        if (Object.prototype.hasOwnProperty.call(user || {}, 'password')) {
            throw _createAuthProfileError(
                'Trợ lý cấp cao không được thay đổi mật khẩu nhân sự.',
                'auth/security-field-change'
            );
        }

        // Read the current private profile from the server before building the
        // batch.  This makes a senior save fail closed for new/deleted profiles
        // and prevents stale local data from changing identity or role fields.
        const existingSnapshot = await db.collection('users').doc(userId).get({ source: 'server' });
        if (!existingSnapshot.exists) {
            throw _createAuthProfileError(
                'Trợ lý cấp cao chỉ được cập nhật hồ sơ nhân sự đã tồn tại.',
                'auth/profile-create-forbidden'
            );
        }
        const existingProfile = existingSnapshot.data() || {};
        const protectedScalarFields = ['username', 'role', 'authUid'];
        const changedScalar = protectedScalarFields.find(field =>
            Object.prototype.hasOwnProperty.call(user || {}, field) &&
            String(user[field] ?? '') !== String(existingProfile[field] ?? '')
        );
        const rolesChanged = Object.prototype.hasOwnProperty.call(user || {}, 'roles') &&
            JSON.stringify(user.roles) !== JSON.stringify(existingProfile.roles);
        if (changedScalar || rolesChanged) {
            throw _createAuthProfileError(
                'Trợ lý cấp cao không được thay đổi tên đăng nhập, UID hoặc vai trò nhân sự.',
                'auth/security-field-change'
            );
        }

        return { authorization, isPrimaryAdmin: false, existingProfile };
    },

    _syncUserRoleMappingAsManager: async (user, batch = null, verifiedAuthorization = null) => {
        // Client storage is never authorization. Only a server-verified primary
        // Admin may write the UID-keyed security mapping; senior assistants are
        // deliberately limited to non-security profile maintenance.
        const authorization = verifiedAuthorization ||
            await DBService.getAuthenticatedAuthorizationContext(true);
        if (!authorization.roles.includes('admin')) return false;

        const targetAuthUid = String(user.authUid || '').trim();
        let targetRef = targetAuthUid ? db.collection('user_roles').doc(targetAuthUid) : null;
        if (!targetRef) {
            const targetSnapshot = await db.collection('user_roles')
                .where('username', '==', user.username)
                .limit(2)
                .get();
            if (targetSnapshot.empty) return false;
            if (targetSnapshot.size !== 1) {
                throw _createAuthProfileError(
                    'Có nhiều UID cùng tên đăng nhập; không thể đồng bộ vai trò an toàn.',
                    'auth/duplicate-role-mapping'
                );
            }
            targetRef = targetSnapshot.docs[0].ref;
        }
        const roles = _normalizeRoleList(user);
        const requestedPrimaryRole = String(user.role || '').trim();
        const rolePayload = {
            userId: user.id,
            username: user.username,
            role: roles.includes(requestedPrimaryRole) ? requestedPrimaryRole : (roles[0] || 'staff'),
            roles: roles.length ? roles : ['staff'],
            updatedByAdmin: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (batch) batch.set(targetRef, rolePayload, { merge: true });
        else await targetRef.set(rolePayload, { merge: true });
        return true;
    },

    saveUser: async (user) => {
        try {
            // user.id determines update or create
            const ref = db.collection('users').doc(user.id);
            const directoryRef = db.collection('staff_directory').doc(user.id);
            const { password, ...safeProfile } = user;
            const saveAuthorization = await DBService._authorizeUserProfileSave(user);
            const batch = db.batch();
            const roleWasSynced = saveAuthorization.isPrimaryAdmin
                ? await DBService._syncUserRoleMappingAsManager(
                    user,
                    batch,
                    saveAuthorization.authorization
                )
                : false;
            if (saveAuthorization.isPrimaryAdmin && user.authUid && !roleWasSynced) {
                throw new Error('Không thể tạo ánh xạ quyền cho tài khoản đăng nhập. Chưa lưu hồ sơ.');
            }
            const profilePatch = saveAuthorization.isPrimaryAdmin
                ? safeProfile
                : Object.fromEntries(Object.entries(safeProfile).filter(([key]) =>
                    !['id', 'username', 'role', 'roles', 'authUid'].includes(key)
                ));
            batch.set(ref, profilePatch, { merge: true });
            const directorySource = saveAuthorization.isPrimaryAdmin
                ? safeProfile
                : { ...saveAuthorization.existingProfile, ...safeProfile };
            batch.set(directoryRef, DBService._toStaffDirectoryProfile(directorySource));
            if (password && saveAuthorization.isPrimaryAdmin) {
                batch.set(db.collection('user_credentials').doc(user.id), {
                    staffId: user.id,
                    password,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
            await batch.commit();
            DBService._invalidate('users_all');
            DBService._invalidate(`user_${user.id}`);

            if (roleWasSynced) console.log('[Security] UID-verified manager synced user role mapping for', user.username);

            return true;
        } catch (error) {
            console.error("Error saving user:", error);
            throw error;
        }
    },

    // Firestore and Firebase Auth cannot share one atomic transaction. Delete the
    // Firestore side first, but return an in-memory recovery snapshot so the UI can
    // restore it immediately when the Auth deletion is refused or fails.
    deleteUser: async (userId, authUid = '') => {
        let pendingRecoverySnapshot = null;
        try {
            const normalizedUserId = String(userId || '').trim();
            const normalizedAuthUid = String(authUid || '').trim();
            if (!normalizedUserId) throw new Error('Thiếu mã nhân sự cần xóa.');

            const primaryAuth = window.auth || (
                typeof firebase !== 'undefined' && typeof firebase.auth === 'function'
                    ? firebase.auth()
                    : null
            );
            const currentActorAuthUid = String(primaryAuth?.currentUser?.uid || '').trim();
            const currentStaffId = String(window.localStorage?.getItem('currentUserId') || '').trim();
            if (currentStaffId === normalizedUserId || (
                normalizedAuthUid && currentActorAuthUid === normalizedAuthUid
            )) {
                const selfDeleteError = new Error('Không thể xóa chính tài khoản quản trị đang đăng nhập.');
                selfDeleteError.code = 'staff/delete-current-actor';
                throw selfDeleteError;
            }

            let roleRefs = [];
            if (normalizedAuthUid) {
                roleRefs = [db.collection('user_roles').doc(normalizedAuthUid)];
            } else {
                const mappings = await db.collection('user_roles')
                    .where('userId', '==', normalizedUserId)
                    .get();
                roleRefs = mappings.docs.map(doc => doc.ref);
            }
            if (currentActorAuthUid && roleRefs.some(ref => ref.id === currentActorAuthUid)) {
                const actorRoleError = new Error('Không thể xóa ánh xạ quyền của tài khoản quản trị đang đăng nhập.');
                actorRoleError.code = 'staff/delete-current-actor';
                throw actorRoleError;
            }

            const targets = [
                { collection: 'users', ref: db.collection('users').doc(normalizedUserId) },
                { collection: 'staff_directory', ref: db.collection('staff_directory').doc(normalizedUserId) },
                { collection: 'user_credentials', ref: db.collection('user_credentials').doc(normalizedUserId) },
                ...roleRefs.map(ref => ({ collection: 'user_roles', ref }))
            ];

            const recoverySnapshot = await db.runTransaction(async transaction => {
                const snapshots = await Promise.all(targets.map(target => transaction.get(target.ref)));
                const profileSnapshot = snapshots[0];
                if (!profileSnapshot.exists) {
                    const missingProfileError = new Error('Hồ sơ nhân sự không còn tồn tại; chưa thay đổi tài khoản đăng nhập.');
                    missingProfileError.code = 'staff/profile-not-found';
                    throw missingProfileError;
                }

                const profileData = profileSnapshot.data() || {};
                if (currentActorAuthUid &&
                    String(profileData.authUid || '').trim() === currentActorAuthUid) {
                    const profileActorError = new Error('Không thể xóa chính tài khoản quản trị đang đăng nhập.');
                    profileActorError.code = 'staff/delete-current-actor';
                    throw profileActorError;
                }
                if (normalizedAuthUid && profileData.authUid &&
                    String(profileData.authUid).trim() !== normalizedAuthUid) {
                    const profileUidError = new Error('UID đăng nhập không khớp hồ sơ; đã dừng xóa để bảo vệ tài khoản khác.');
                    profileUidError.code = 'staff/auth-uid-mismatch';
                    throw profileUidError;
                }

                snapshots.forEach((snapshot, index) => {
                    if (!snapshot.exists || targets[index].collection !== 'user_roles') return;
                    if (String(snapshot.data()?.userId || '').trim() !== normalizedUserId) {
                        const roleMismatchError = new Error('Ánh xạ quyền không khớp nhân sự; đã dừng xóa để bảo vệ tài khoản khác.');
                        roleMismatchError.code = 'staff/role-mapping-mismatch';
                        throw roleMismatchError;
                    }
                });

                const documents = [];
                snapshots.forEach((snapshot, index) => {
                    if (!snapshot.exists) return;
                    documents.push({
                        collection: targets[index].collection,
                        id: snapshot.id,
                        data: snapshot.data()
                    });
                    transaction.delete(targets[index].ref);
                });

                pendingRecoverySnapshot = {
                    schemaVersion: 1,
                    userId: normalizedUserId,
                    authUid: normalizedAuthUid,
                    documents
                };
                return pendingRecoverySnapshot;
            });

            DBService._invalidate('users_all');
            DBService._invalidate(`user_${normalizedUserId}`);
            return recoverySnapshot;
        } catch (error) {
            // A transaction can be committed remotely while its acknowledgement is
            // lost. If the callback already built a snapshot, restore/no-op before
            // allowing the UI to continue; Auth has not been touched at this point.
            if (pendingRecoverySnapshot) {
                try {
                    await DBService.restoreDeletedUser(pendingRecoverySnapshot);
                } catch (recoveryError) {
                    console.error('Firestore delete recovery could not be verified:', recoveryError);
                    error.message += ' Không thể xác minh việc khôi phục hồ sơ sau lỗi mạng.';
                }
            }
            console.error("Error deleting user:", error);
            throw error;
        }
    },

    restoreDeletedUser: async (recoverySnapshot) => {
        try {
            const normalizedUserId = String(recoverySnapshot?.userId || '').trim();
            const documents = Array.isArray(recoverySnapshot?.documents)
                ? recoverySnapshot.documents
                : [];
            const allowedCollections = new Set([
                'users', 'staff_directory', 'user_credentials', 'user_roles'
            ]);
            if (recoverySnapshot?.schemaVersion !== 1 || !normalizedUserId || !documents.length) {
                throw new Error('Ảnh khôi phục hồ sơ không hợp lệ.');
            }

            const seenPaths = new Set();
            const targets = documents.map(document => {
                const collection = String(document?.collection || '');
                const id = String(document?.id || '');
                if (!allowedCollections.has(collection) || !id || !document?.data) {
                    throw new Error('Ảnh khôi phục chứa tài liệu không hợp lệ.');
                }
                if (collection !== 'user_roles' && id !== normalizedUserId) {
                    throw new Error('Ảnh khôi phục không khớp mã nhân sự.');
                }
                if (collection === 'user_roles' &&
                    String(document.data.userId || '').trim() !== normalizedUserId) {
                    throw new Error('Ảnh khôi phục quyền không khớp mã nhân sự.');
                }
                const path = `${collection}/${id}`;
                if (seenPaths.has(path)) throw new Error('Ảnh khôi phục chứa tài liệu trùng lặp.');
                seenPaths.add(path);
                return { ref: db.collection(collection).doc(id), data: document.data };
            });

            await db.runTransaction(async transaction => {
                const currentSnapshots = await Promise.all(targets.map(target => transaction.get(target.ref)));
                const existingCount = currentSnapshots.filter(snapshot => snapshot.exists).length;
                // The delete transaction may have failed before committing. In that
                // case every original document is already present and compensation
                // is a successful no-op; never overwrite those current documents.
                if (existingCount === targets.length) return;
                if (existingCount > 0) {
                    const conflictError = new Error('Dữ liệu nhân sự đã được tạo lại; không ghi đè bằng ảnh khôi phục cũ.');
                    conflictError.code = 'staff/restore-conflict';
                    throw conflictError;
                }
                targets.forEach(target => transaction.set(target.ref, target.data));
            });

            DBService._invalidate('users_all');
            DBService._invalidate(`user_${normalizedUserId}`);
            return true;
        } catch (error) {
            console.error('Error restoring deleted user:', error);
            throw error;
        }
    },

    // ===== BRANCH HELPERS =====
    _parseBranchKey(compositeKey) {
        // 'cs1__2026-02-21' → { branch: 'cs1', dateKey: '2026-02-21', docId: 'cs1__2026-02-21' }
        // '2026-02-21' (legacy) → { branch: 'cs1', dateKey: '2026-02-21', docId: '2026-02-21' }
        if (compositeKey.includes('__')) {
            const [branch, ...rest] = compositeKey.split('__');
            return { branch, dateKey: rest.join('__'), docId: compositeKey };
        }
        return { branch: 'cs1', dateKey: compositeKey, docId: compositeKey };
    },

    _getScheduleRegistrations: async (compositeKey, options = {}) => {
        const userId = String(localStorage.getItem('currentUserId') || '').trim();
        if (!userId) return [];
        let roles = [];
        try {
            const stored = localStorage.getItem('currentRole') || '';
            const parsed = JSON.parse(stored);
            roles = Array.isArray(parsed) ? parsed : [stored];
        } catch (error) {
            roles = [localStorage.getItem('currentRole') || ''];
        }
        const canReadAll = roles.some(role => ['admin', 'senior_assistant', 'assistant'].includes(role));
        const collection = db.collection('schedule_registrations');
        const read = async (all) => {
            let query = collection.where('scheduleKey', '==', compositeKey);
            if (!all) query = query.where('userId', '==', userId);
            const snapshot = options.source === 'server'
                ? await query.get({ source: 'server' })
                : await query.get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        };
        try {
            return await read(canReadAll);
        } catch (error) {
            if (options.source === 'server') throw error;
            // A stale/tampered local role must not hide the schedule. Retry the
            // owner-scoped query that Firestore Rules can prove safely.
            if (canReadAll) {
                try { return await read(false); } catch (_) { /* report original below */ }
            }
            console.warn('[ScheduleRegistration] Could not load registrations:', error);
            return [];
        }
    },

    _attachScheduleRegistrations: async (compositeKey, data, options = {}) => {
        if (!data || typeof data !== 'object') return data || {};
        const registrations = await DBService._getScheduleRegistrations(compositeKey, options);
        return _mergeScheduleRegistrations(data, registrations);
    },

    // 4. Schedule Management
    getSchedule: async (compositeKey, options = {}) => {
        const cacheKey = `schedule_${compositeKey}`;
        const serverFresh = options.source === 'server';
        if (!serverFresh && DBService._cache[cacheKey]) return DBService._cache[cacheKey];
        const getDocument = ref => serverFresh
            ? ref.get({ source: 'server' })
            : ref.get();

        const promise = (async () => {
            try {
                const { branch, dateKey, docId } = DBService._parseBranchKey(compositeKey);
                const manifestName = `schedule_manifest_${branch}`;

                // 1. Try Direct Fetch (Lịch Riêng)
                const doc = await getDocument(db.collection('schedules').doc(docId));

                if (doc.exists) {
                    const data = doc.data();
                    const hasStructure = Object.keys(data).length > 0;
                    if (hasStructure) return DBService._attachScheduleRegistrations(compositeKey, data, options);
                }

                // 2. Fallback: Find Nearest Neighbor (Lịch Kế Thừa) — branch-specific manifest
                // Try branch-specific manifest first, then legacy fallback
                let manifestDoc = await getDocument(db.collection('settings').doc(manifestName));
                if (!manifestDoc.exists) {
                    // Legacy fallback: old manifest (for cs1 backward compat)
                    if (branch === 'cs1') {
                        manifestDoc = await getDocument(db.collection('settings').doc('schedule_manifest'));
                    }
                    if (!manifestDoc || !manifestDoc.exists) return {};
                }

                const manifest = manifestDoc.data();

                const [y, m, d] = dateKey.split('-').map(Number);
                const localDate = new Date(y, m - 1, d);
                const dayOfWeek = localDate.getDay();
                const dayKey = String(dayOfWeek);

                const availableDates = manifest[dayKey] || manifest[dayOfWeek] || [];
                const pastDates = availableDates.filter(d => d < docId);

                if (pastDates.length === 0) return {};

                pastDates.sort().reverse();
                const neighborDocId = pastDates[0];

                console.log(`[Schedule] Inheriting from ${neighborDocId} for ${docId}`);

                const neighborDoc = await getDocument(db.collection('schedules').doc(neighborDocId));
                if (!neighborDoc.exists) return {};

                const templateData = neighborDoc.data();

                // SANITIZATION: Clean up 'registeredTeachers' and temporary closure 'isClosed'
                Object.keys(templateData).forEach(key => {
                    if (Array.isArray(templateData[key])) {
                        templateData[key] = templateData[key].map((row, rowIndex) => {
                            const newRow = { ...row, registeredTeachers: [] };
                            delete newRow.isClosed;
                            // GV thay thế chỉ có hiệu lực đúng ngày được gán — không kế thừa
                            // sang tuần sau (dữ liệu cũ tồn tại cả 2 cách viết The/Te).
                            newRow.gvThayThe = ''; newRow.gvThayTheId = ''; newRow.gvThayTheList = [];
                            newRow.gvThayTe = ''; newRow.gvThayTeId = ''; newRow.gvThayTeList = [];
                            delete newRow.gvThayTheAt;
                            delete newRow.teacherAbsences;
                            delete newRow.teacherAbsenceHistory;
                            delete newRow.staffingUpdatedAt;
                            delete newRow.staffingUpdatedById;
                            delete newRow.staffingUpdatedByName;
                            // The old fallback generated a random shiftId on
                            // every read, so the same inherited class produced a
                            // different +10 target after refresh. Derive an ID
                            // from the target date + immutable row locator.
                            const inheritedLocator = [
                                docId,
                                key,
                                rowIndex,
                                _scheduleRegistrationRowSignature(newRow)
                            ].join('::');
                            newRow.shiftId = `shift_inherited_${
                                _scheduleRegistrationHash(inheritedLocator, 2166136261)
                            }_${_scheduleRegistrationHash(inheritedLocator, 3335557771)}`;
                            newRow._isInheritedSchedule = true;
                            newRow._inheritedFromScheduleDocId = neighborDocId;
                            newRow._inheritedTargetScheduleDocId = docId;
                            newRow._inheritedSection = key;
                            newRow._inheritedIndex = rowIndex;
                            newRow.staffingSchemaVersion = 2;
                            newRow.teacherAbsences = [];
                            newRow.teacherAbsenceHistory = [];
                            return newRow;
                        });
                    }
                });

                return DBService._attachScheduleRegistrations(compositeKey, templateData, options);

            } catch (error) {
                console.error("Error getting schedule:", error);
                if (serverFresh) throw error;
                return {};
            }
        })();

        if (!serverFresh) DBService._cache[cacheKey] = promise;
        return promise;
    },

    saveSchedule: async (compositeKey, data) => {
        try {
            const { docId } = DBService._parseBranchKey(compositeKey);
            // 1. Save the actual schedule data
            await db.collection('schedules').doc(docId).set(_withoutSeparateScheduleRegistrations(data));

            // 2. Update Manifest
            await DBService.updateScheduleManifest(compositeKey);

            DBService._invalidate(`schedule_${compositeKey}`);
            return true;
        } catch (error) {
            console.error("Error saving schedule:", error);
            throw error;
        }
    },

    updateScheduleManifest: async (compositeKey) => {
        try {
            const { branch, dateKey, docId } = DBService._parseBranchKey(compositeKey);
            const manifestName = `schedule_manifest_${branch}`;

            const [y, m, d] = dateKey.split('-').map(Number);
            const localDate = new Date(y, m - 1, d);
            const dayOfWeek = localDate.getDay();
            const dayKey = String(dayOfWeek);

            const ref = db.collection('settings').doc(manifestName);

            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                const data = doc.exists ? doc.data() : {};

                const list = data[dayKey] || [];
                if (!list.includes(docId)) {
                    list.push(docId);
                    list.sort();
                    data[dayKey] = list;
                    t.set(ref, data, { merge: true });
                }
            });
        } catch (e) {
            console.warn("Error updating manifest:", e);
        }
    },

    // 5. Class Registration (Nhận Lớp). Registrations live outside schedules so
    // staff can only mutate their own small document, never a whole schedule day.
    // A cancelled document acts as a tombstone for legacy registeredTeachers.
    registerClass: async (compositeKey, caType, rowMeta, user) => {
        try {
            const userId = user ? (user.id || user.uid) : null;
            const userName = user ? (user.name || user.displayName || user.username) : null;
            if (!userId) throw new Error("User ID is required for registration!");
            const { branch, dateKey, docId } = DBService._parseBranchKey(compositeKey);
            if (!SCHEDULE_SECTION_KEYS.includes(caType)) throw new Error('Nhóm ca không hợp lệ.');
            const schedule = await DBService.getSchedule(compositeKey);
            const rowIndex = Number(rowMeta?.index);
            const row = schedule?.[caType]?.[rowIndex];
            if (!row) throw new Error('Ca không còn tồn tại hoặc đã được người xếp lịch thay đổi.');

            const registrationId = _scheduleRegistrationId(compositeKey, caType, row, userId, rowIndex);
            const registrationRef = db.collection('schedule_registrations').doc(registrationId);
            const currentlyRegistered = (row.registeredTeachers || [])
                .some(item => String(item?.id || '') === String(userId));
            const nextStatus = currentlyRegistered ? 'cancelled' : 'active';
            const authUid = String((window.auth || firebase.auth())?.currentUser?.uid || '').trim();
            if (!authUid) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');

            await db.runTransaction(async transaction => {
                const [existingSnapshot, profileSnapshot] = await Promise.all([
                    transaction.get(registrationRef),
                    transaction.get(db.collection('users').doc(String(userId)))
                ]);
                const existing = existingSnapshot.exists ? existingSnapshot.data() : null;
                const immutable = existing || {
                    scheduleKey: compositeKey,
                    scheduleDocId: docId,
                    branch,
                    dateKey,
                    section: caType,
                    rowIndex,
                    shiftId: String(row.shiftId || ''),
                    rowSignature: _scheduleRegistrationRowSignature(row),
                    userId: String(userId),
                    authUid,
                    schemaVersion: 1,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                if (existing && (
                    String(existing.userId) !== String(userId) ||
                    String(existing.scheduleKey) !== String(compositeKey) ||
                    String(existing.section) !== String(caType)
                )) {
                    throw new Error('Khóa đăng ký lớp bị xung đột. Vui lòng tải lại trang.');
                }
                transaction.set(registrationRef, {
                    ...immutable,
                    userName: _canonicalStaffWriteName(profileSnapshot),
                    status: nextStatus,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            DBService._invalidate(`schedule_${compositeKey}`);
            return nextStatus;
        } catch (error) {
            console.error("Registration error:", error);
            throw error;
        }
    },

    updateAttendanceSession: async (dateKey, userId, sessionId, newData) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) throw new Error("Không tìm thấy phiên làm việc!");

                const data = doc.data();
                const sessionIndex = data.sessions.findIndex(s => String(s.id) === String(sessionId)); // Loose compare

                if (sessionIndex === -1) throw new Error("Không tìm thấy phiên này!");

                // Update specific fields
                const session = data.sessions[sessionIndex];

                // Merge all fields
                Object.assign(session, newData);

                // Sync top level if it's the latest session
                if (sessionIndex === data.sessions.length - 1) {
                    if (newData.checkIn) data.checkIn = newData.checkIn;
                    if (newData.checkOut !== undefined) data.checkOut = newData.checkOut;
                }

                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                t.set(ref, data);
            });
            DBService._invalidateAttendance(dateKey, userId);
        } catch (error) {
            console.error("Error in updateAttendanceSession:", error);
            throw error;
        }
    },

    // 6. Dashboard Stats
    _getDashboardSessionScheduledEnd: async (userId, dateKey, checkInTime) => {
        if (!userId || !dateKey || !checkInTime) return null;

        const BRANCHES = ['cs1', 'cs2', 'cs3'];
        const classSections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
        const [year, month, day] = dateKey.split('-').map(Number);
        const toLocalTime = (timeStr) => {
            if (!timeStr || !timeStr.includes(':')) return null;
            const [hour, minute] = timeStr.split(':').map(Number);
            return new Date(year, month - 1, day, hour, minute, 0, 0);
        };

        const classShifts = [];
        for (const branch of BRANCHES) {
            const schedule = await DBService.getSchedule(`${branch}__${dateKey}`);
            if (!schedule) continue;

            classSections.forEach(section => {
                (schedule[section] || []).forEach(cls => {
                    const isAssigned = isAssignedToClass(cls, userId);
                    if (!isAssigned) return;

                    const shiftStart = toLocalTime(cls.start);
                    const shiftEnd = toLocalTime(cls.end);
                    if (shiftStart && shiftEnd) {
                        classShifts.push({ start: cls.start, end: cls.end, shiftStart, shiftEnd });
                    }
                });
            });
        }

        const matchedClassEnd = DBService._matchDashboardShiftEnd(classShifts, checkInTime);
        if (matchedClassEnd) return matchedClassEnd;

        const receptionistShifts = await DBService._getDashboardReceptionistShifts(userId, dateKey);
        return DBService._matchDashboardShiftEnd(receptionistShifts, checkInTime);
    },

    _matchDashboardShiftEnd: (shifts, checkInTime) => {
        if (!Array.isArray(shifts) || shifts.length === 0) return null;

        shifts.sort((a, b) => a.shiftStart - b.shiftStart);
        const merged = [];
        shifts.forEach(shift => {
            const prev = merged[merged.length - 1];
            if (prev && prev.end === shift.start) {
                prev.end = shift.end;
                prev.shiftEnd = shift.shiftEnd;
            } else {
                merged.push({ ...shift });
            }
        });

        const matched = merged.find(shift => Math.abs(checkInTime - shift.shiftStart) <= 90 * 60 * 1000);
        return matched ? matched.shiftEnd : null;
    },

    _getDashboardReceptionistShifts: async (userId, dateKey) => {
        const SHIFT_KEYS = ['morning', 'afternoon', 'evening'];
        const DAY_KEYS_MAP = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const BRANCHES = ['cs1', 'cs2', 'cs3'];

        const date = new Date(`${dateKey}T00:00:00`);
        const monday = new Date(date);
        const dayOfWeek = monday.getDay();
        monday.setDate(monday.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
        const mondayKey = getLocalDateKeyFromDate(monday);
        const dayIdx = date.getDay() === 0 ? 6 : date.getDay() - 1;
        const dayKey = DAY_KEYS_MAP[dayIdx];
        const [year, month, day] = dateKey.split('-').map(Number);

        const shifts = [];
        for (const branch of BRANCHES) {
            const compositeKey = `${branch}__${mondayKey}`;
            const sources = await Promise.all([
                Promise.all([
                    DBService.getReceptionistSchedule(compositeKey),
                    DBService.getReceptionistShiftConfig(branch)
                ]).then(([weekData, config]) => ({ weekData, config, scheduleType: 'receptionist' })),
                Promise.all([
                    DBService.getOfficeSchedule(compositeKey),
                    DBService.getOfficeShiftConfig(branch)
                ]).then(([weekData, config]) => ({ weekData, config, scheduleType: 'office' }))
            ]);

            for (const source of sources) {
                const weekData = source.weekData;
                if (!weekData) continue;
                for (const shiftKey of SHIFT_KEYS) {
                    const shiftData = weekData[shiftKey];
                    const staffEntry = shiftData?.[dayKey]?.find(s => String(s.id) === String(userId));
                    if (!staffEntry) continue;

                    const weekShiftCfg = weekData._shiftConfig?.[shiftKey];
                    const start = staffEntry.customStart || weekShiftCfg?.start || source.config?.[shiftKey]?.start;
                    const end = staffEntry.customEnd || weekShiftCfg?.end || source.config?.[shiftKey]?.end;
                    if (!start || !end) continue;

                    const [startHour, startMinute] = start.split(':').map(Number);
                    const [endHour, endMinute] = end.split(':').map(Number);
                    shifts.push({
                        shift: shiftKey,
                        label: { morning: 'SÁNG', afternoon: 'CHIỀU', evening: 'TỐI' }[shiftKey],
                        start,
                        end,
                        branch,
                        scheduleType: source.scheduleType,
                        documentKey: compositeKey,
                        cancelCompositeKey: source.scheduleType === 'office'
                            ? `office_${branch}_${mondayKey}`
                            : `${branch}_${mondayKey}`,
                        isFixedShift: staffEntry.isFixedShift === true,
                        shiftStart: new Date(year, month - 1, day, startHour, startMinute, 0, 0),
                        shiftEnd: new Date(year, month - 1, day, endHour, endMinute, 0, 0)
                    });
                }
            }
        }

        return shifts;
    },

    getDashboardStats: async () => {
        try {
            // Count Users
            const usersSnap = await db.collection('users').get();
            const totalUsers = usersSnap.size;

            // Count Active Attendance Today (Local Time)
            const now = new Date();
            // Offset for timezone (simplistic vn hack: +7h)
            // But 'date' field in logs is YYYY-MM-DD local? 
            // Check checkInPersonal: `const dateKey = now.toISOString().split('T')[0];` -> This is UTC!
            // WE NEED TO FIX THIS to be Local Date.

            // Local Date Key calculation
            const localDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
            const todayKey = localDate.toISOString().split('T')[0];

            const logsSnap = await db.collection('attendance_logs').where('date', '==', todayKey).get();

            let checkedInCount = 0;
            let recentActivity = [];

            if (!logsSnap.empty) {
                checkedInCount = logsSnap.size;

                for (const doc of logsSnap.docs) {
                    const data = doc.data();
                    const sessions = data.sessions || [];

                    for (const s of sessions) {
                        const checkInTime = s.checkIn || s.start;
                        if (checkInTime) {
                            // Determine status
                            let status = 'Đúng giờ';
                            const checkInDate = new Date(checkInTime);
                            if (s.checkOut) {
                                status = 'Hoàn thành';
                            } else {
                                const scheduledEnd = await DBService._getDashboardSessionScheduledEnd(data.userId, todayKey, checkInDate);
                                status = scheduledEnd && now >= scheduledEnd ? 'Hết ca theo lịch' : 'Đang làm việc';
                            }

                            recentActivity.push({
                                user: data.name || 'N/A',
                                userId: data.userId || '',
                                time: checkInTime,
                                type: 'in',
                                status: status
                            });
                        }
                    }
                }

                // Sort by time desc, then dedup by userId keeping latest entry per employee
                recentActivity.sort((a, b) => new Date(b.time) - new Date(a.time));
                const seenUsers = new Set();
                recentActivity = recentActivity.filter(a => {
                    const key = a.userId || a.user;
                    if (seenUsers.has(key)) return false;
                    seenUsers.add(key);
                    return true;
                });
                recentActivity = recentActivity.slice(0, 5);
            }

            return {
                totalUsers,
                checkedInCount,
                recentActivity
            };
        } catch (error) {
            console.error("Error getting stats:", error);
            throw error; // Let main.js handle UI
        }
    },

    // 7. Personal Attendance (Isolated)
    getPersonalAttendance: async (dateKey, userId) => {
        const cacheKey = `attendance_${dateKey}_${userId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const docId = `${dateKey}_${userId}`;
                const doc = await db.collection('attendance_logs').doc(docId).get();

                if (!doc.exists) return null;

                let data = doc.data();

                // Read-time Migration for Legacy Data
                if (!data.sessions || !Array.isArray(data.sessions)) {
                    if (data.checkIn) {
                        data.sessions = [{
                            id: 'legacy', // Marker ID
                            start: data.checkIn,
                            checkIn: data.checkIn,
                            checkOut: data.checkOut || null
                        }];
                    } else {
                        data.sessions = [];
                    }
                }

                return data;
            } catch (error) {
                console.error("Get personal attendance error:", error);
                // A denied/offline read is not an absent attendance record.
                // Evict failures so a subsequent explicit retry can succeed.
                delete DBService._cache[cacheKey];
                throw error;
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getMonthlySchedule: async (monthStr) => {
        try {
            const [yearStr, monthNumStr] = monthStr.split('-');
            const year = parseInt(yearStr, 10);
            const month = parseInt(monthNumStr, 10) - 1; // 0-indexed
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            
            const BRANCHES = ['cs1', 'cs2', 'cs3'];
            const schedulePromises = [];
            
            for (let d = 1; d <= daysInMonth; d++) {
                const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                BRANCHES.forEach(branch => {
                    const compositeKey = `${branch}__${dateKey}`;
                    schedulePromises.push(
                        DBService.getSchedule(compositeKey).then(data => ({ date: dateKey, data: data || {}, branch, compositeKey }))
                    );
                });
            }
            
            const results = await Promise.all(schedulePromises);
            const scheduleMap = {};
            results.forEach(item => {
                if (!scheduleMap[item.date]) scheduleMap[item.date] = {};
                const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
                sections.forEach(sec => {
                    const rows = item.data[sec] || [];
                    const taggedRows = rows.map((row, idx) => ({ 
                        ...row, 
                        _branch: item.branch, 
                        _compositeKey: item.compositeKey,
                        _originalIndex: idx
                    }));
                    if (!scheduleMap[item.date][sec]) scheduleMap[item.date][sec] = [];
                    scheduleMap[item.date][sec] = scheduleMap[item.date][sec].concat(taggedRows);
                });
            });
            return scheduleMap;
        } catch (e) {
            console.error('getMonthlySchedule error:', e);
            return {};
        }
    },

    getMonthlyAttendance: async (monthStr, userId, forceServer = false) => {
        const cacheKey = `monthly_attendance_${monthStr}_${userId}`;
        if (!forceServer && DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const getOptions = forceServer ? { source: 'server' } : {};
                const snap = await db.collection('attendance_logs')
                    .where('userId', '==', userId)
                    .get(getOptions);

                let logs = [];
                snap.forEach(doc => {
                    let data = doc.data();
                    // Ensure date exists (poly-fill for legacy docs)
                    const date = data.date || doc.id.split('_')[0];
                    
                    if (date && date.startsWith(monthStr)) {
                        // Apply same read-time migration
                        if (!data.sessions || !Array.isArray(data.sessions)) {
                            if (data.checkIn) {
                                data.sessions = [{
                                    id: 'legacy',
                                    start: data.checkIn,
                                    checkIn: data.checkIn,
                                    checkOut: data.checkOut || null
                                }];
                            } else {
                                data.sessions = [];
                            }
                        }
                        data.date = date; // polyfill
                        logs.push(data);
                    }
                });
                return logs;
            } catch (error) {
                console.error("Monthly attendance error:", error);
                return [];
            }
        })();

        if (!forceServer) {
            DBService._cache[cacheKey] = promise;
        }
        return promise;
    },

    // 9a. Subjects (Môn học) CRUD
    getSubjects: async (forceServer = false) => {
        const cacheKey = 'subjects_all';
        if (!forceServer && DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const query = db.collection('subjects').orderBy('name');
                let snap;
                try {
                    snap = forceServer ? await query.get({ source: 'server' }) : await query.get();
                } catch (networkError) {
                    // PWA có thể đang offline; giữ khả năng xem dữ liệu cache nhưng không
                    // biến một lần mất mạng thành danh sách môn rỗng/"Không áp dụng" hàng loạt.
                    console.warn('getSubjects server refresh failed; using cache:', networkError);
                    snap = await query.get({ source: 'cache' });
                }
                const result = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                DBService._cache[cacheKey] = Promise.resolve(result);
                return result;
            } catch (e) {
                console.warn('getSubjects error:', e);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    saveSubject: async (data) => {
        try {
            let resId;
            if (data.id) {
                const { id, ...rest } = data;
                await db.collection('subjects').doc(id).set(rest, { merge: true });
                resId = data.id;
            } else {
                const ref = await db.collection('subjects').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
                resId = ref.id;
            }
            DBService._invalidate('subjects_all');
            return resId;
        } catch (e) { console.error('saveSubject error:', e); throw e; }
    },

    deleteSubject: async (id) => {
        try {
            await db.collection('subjects').doc(id).delete();
            DBService._invalidate('subjects_all');
        } catch (e) { console.error('deleteSubject error:', e); throw e; }
    },

    // Cập nhật nhiều môn cùng lúc — dùng khi bật/tắt "sớm 10p" cho cả nhóm,
    // hoặc khi chuyển môn sang nhóm khác. Một batch để không có trạng thái nửa vời.
    saveSubjectsBatch: async (updates) => {
        const list = (updates || []).filter(item => item && item.id);
        if (list.length === 0) return 0;
        try {
            const batch = db.batch();
            list.forEach(({ id, ...fields }) => {
                batch.set(db.collection('subjects').doc(id), fields, { merge: true });
            });
            await batch.commit();
            DBService._invalidate('subjects_all');
            return list.length;
        } catch (e) { console.error('saveSubjectsBatch error:', e); throw e; }
    },

    // Xóa nhiều môn cùng lúc (chọn nhiều trên trang Môn Học). Một batch để tránh
    // xóa được nửa chừng rồi lỗi, dẫn tới danh sách nửa cũ nửa mới.
    deleteSubjectsBatch: async (ids) => {
        const list = (ids || []).filter(Boolean);
        if (list.length === 0) return 0;
        try {
            const batch = db.batch();
            list.forEach(id => { batch.delete(db.collection('subjects').doc(id)); });
            await batch.commit();
            DBService._invalidate('subjects_all');
            return list.length;
        } catch (e) { console.error('deleteSubjectsBatch error:', e); throw e; }
    },

    // 9b. Get all user IDs who have attendance on a given day (for GV absent highlight)
    getDayAttendance: async (dateKey) => {
        try {
            const snap = await db.collection('attendance_logs').where('date', '==', dateKey).get();
            const evidenceByUser = new Map();
            snap.forEach(doc => {
                const d = doc.data();
                const sessions = Array.isArray(d.sessions)
                    ? d.sessions
                    : (d.checkIn ? [{ checkIn: d.checkIn, checkOut: d.checkOut || null }] : []);
                if (d.userId) {
                    const usable = sessions.filter(session =>
                        !session?.isAbsent && (session?.checkIn || session?.start)
                    );
                    if (usable.length) {
                        const key = String(d.userId);
                        evidenceByUser.set(key, [...(evidenceByUser.get(key) || []), ...usable]);
                    }
                }
            });
            return evidenceByUser;
        } catch (e) {
            console.warn('getDayAttendance error:', e);
            // An empty Map means "the read succeeded and nobody has usable
            // attendance". Returning it on a permission/network failure makes
            // every scheduled teacher look unverified, so callers must handle
            // the failed/unknown state explicitly instead.
            throw e;
        }
    },

    // Fail-closed source loader for the Admin correction panel in the schedule.
    // It deliberately distinguishes a missing attendance document from a failed
    // read so the UI can never turn a permission/network error into a duplicate
    // manual session.
    getAdminTeachingAttendanceEditorContext: async ({ staffIds, dateKey } = {}) => {
        const normalizedDateKey = String(dateKey || '').trim();
        const ids = Array.from(new Set((Array.isArray(staffIds) ? staffIds : [])
            .map(value => String(value || '').trim())
            .filter(Boolean)));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateKey) || ids.length === 0) {
            throw new Error('Thiếu ngày hoặc nhân sự để tải dữ liệu chấm công.');
        }

        const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
        if (!authorization.roles.includes('admin')) {
            const error = new Error('Chỉ Admin mới được xem và chỉnh công ngay trên lịch.');
            error.code = 'auth/admin-required';
            throw error;
        }

        const monthStr = normalizedDateKey.slice(0, 7);
        const subjectsQuery = db.collection('subjects').orderBy('name');
        const subjectsSnapshot = await subjectsQuery.get({ source: 'server' });
        const subjects = subjectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const entries = await Promise.all(ids.map(async staffId => {
            const attendanceRef = db.collection('attendance_logs').doc(`${normalizedDateKey}_${staffId}`);
            const salaryRef = db.collection('salary_settings_monthly').doc(`${monthStr}_${staffId}`);
            const profileRef = db.collection('users').doc(staffId);
            const cancelledRef = db.collection('cancelled_shifts').doc(`${monthStr}_${staffId}`);
            const bonusQuery = db.collection('bonus10_requests').where('staffId', '==', staffId);
            const [attendanceSnapshot, salarySnapshot, profileSnapshot, bonusSnapshot, cancelledSnapshot] = await Promise.all([
                attendanceRef.get({ source: 'server' }),
                salaryRef.get({ source: 'server' }),
                profileRef.get({ source: 'server' }),
                bonusQuery.get({ source: 'server' }),
                cancelledRef.get({ source: 'server' })
            ]);
            const monthlyBonusRequests = bonusSnapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => String(item.dateKey || '').startsWith(`${monthStr}-`));
            return {
                staffId,
                attendanceExists: attendanceSnapshot.exists,
                attendance: attendanceSnapshot.exists ? attendanceSnapshot.data() : null,
                monthlySettings: salarySnapshot.exists ? salarySnapshot.data() : {},
                profile: profileSnapshot.exists ? { id: profileSnapshot.id, ...profileSnapshot.data() } : { id: staffId },
                monthlyBonusRequests,
                cancelledShiftKeys: cancelledSnapshot.exists && Array.isArray(cancelledSnapshot.data()?.shifts)
                    ? cancelledSnapshot.data().shifts.map(value => String(value || '').trim())
                    : []
            };
        }));

        return {
            actor: authorization,
            dateKey: normalizedDateKey,
            subjects,
            entries
        };
    },

    getAttendanceRecordsForDate: async (dateKey) => {
        if (!dateKey) return [];
        try {
            const snap = await db.collection('attendance_logs').where('date', '==', dateKey).get();
            return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.warn('getAttendanceRecordsForDate error:', e);
            return [];
        }
    },

    // 9. System Settings
    getSystemSettings: async () => {
        const cacheKey = 'system_settings';
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const doc = await db.collection('settings').doc('system').get();
                return doc.exists ? doc.data() : {};
            } catch (error) {
                console.error("Error getting settings:", error);
                return {};
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    saveSystemSettings: async (data) => {
        try {
            await db.collection('settings').doc('system').set(data, { merge: true });
            DBService._invalidate('system_settings');
            DBService._invalidate('receptionist_config_');
            return true;
        } catch (error) {
            console.error("Error saving settings:", error);
            throw error;
        }
    },

    prepareAttendanceLocationPermission: async () => {
        const settings = await DBService.getSystemSettings();
        if (getConfiguredGPSCampuses(settings).length === 0) return false;
        return assertAttendanceLocationAllowed(settings);
    },

    // This marker is account-scoped UX state only. It records that this
    // account has successfully passed the location gate on this browser; it
    // never bypasses a fresh location check or the browser's own permission.
    hasAttendanceLocationAcknowledgement: (userId) => hasAttendanceLocationAcknowledgement(userId),

    // Copy/template workflows may create a whole day, but must never replace a
    // day that another scheduler already prepared. The existence check and
    // create happen in the same transaction.
    createScheduleIfMissing: async (compositeKey, data) => {
        const { docId } = DBService._parseBranchKey(compositeKey);
        const ref = db.collection('schedules').doc(docId);
        let created = false;
        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            if (snapshot.exists) return;
            transaction.set(ref, _withoutSeparateScheduleRegistrations({
                ...(data || {}),
                _revision: 1,
                _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                _updatedBy: localStorage.getItem('currentUserId') || null
            }));
            created = true;
        });
        if (!created) return false;
        await DBService.updateScheduleManifest(compositeKey);
        DBService._invalidate(`schedule_${compositeKey}`);
        return true;
    },

    // Update exactly one class row from the latest Firestore document. The old UI
    // rewrote the whole cached day, so two schedulers editing different classes could
    // silently overwrite each other. A stable shiftId is preferred; the signature is
    // a guarded fallback for legacy rows that have not been materialized with an ID yet.
    updateScheduleRowAtomic: async (compositeKey, section, locator, applyRow, fallbackDayData = null) => {
        if (!section || typeof applyRow !== 'function') {
            throw new Error('Thiếu thông tin ca cần cập nhật.');
        }
        const { dateKey, docId } = DBService._parseBranchKey(compositeKey);
        const ref = db.collection('schedules').doc(docId);
        let committedRow = null;
        const signatureOf = row => [row?.start, row?.end, row?.lop, row?.phong]
            .map(value => String(value || '').trim())
            .join('|');
        const absenceGuard = locator?.attendanceAbsenceGuard &&
            typeof locator.attendanceAbsenceGuard === 'object'
            ? locator.attendanceAbsenceGuard
            : null;
        const guardedStaffIds = Array.from(new Set((Array.isArray(absenceGuard?.staffIds)
            ? absenceGuard.staffIds
            : [])
            .map(value => String(value || '').trim())
            .filter(Boolean)));
        if (absenceGuard && (
            !/^\d{4}-\d{2}-\d{2}$/.test(String(absenceGuard.dateKey || '')) ||
            guardedStaffIds.length > 20 ||
            guardedStaffIds.some(staffId => !/^[A-Za-z0-9_-]{1,80}$/.test(staffId))
        )) {
            const invalidGuard = new Error('Dữ liệu đối chiếu công cho trạng thái nghỉ không hợp lệ. Hãy tải lại ca.');
            invalidGuard.code = 'schedule/attendance-guard-invalid';
            throw invalidGuard;
        }

        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            const source = snapshot.exists
                ? snapshot.data()
                : JSON.parse(JSON.stringify(fallbackDayData || {}));
            const rows = Array.isArray(source?.[section]) ? source[section].map(row => ({ ...row })) : [];
            const wantedShiftId = String(locator?.shiftId || '').trim();
            const expectedSignature = String(locator?.signature || '').trim();
            let rowIndex = wantedShiftId
                ? rows.findIndex(row => String(row?.shiftId || '') === wantedShiftId)
                : -1;

            if (rowIndex < 0 && Number.isInteger(locator?.index)) {
                const candidate = rows[locator.index];
                if (candidate && (!expectedSignature || signatureOf(candidate) === expectedSignature)) {
                    rowIndex = locator.index;
                }
            }
            if (rowIndex < 0 || !rows[rowIndex]) {
                const conflict = new Error('Ca đã được người khác thay đổi hoặc di chuyển. Vui lòng tải lại lịch rồi thử lại.');
                conflict.code = 'schedule/conflict';
                throw conflict;
            }

            const latestRow = JSON.parse(JSON.stringify(rows[rowIndex]));
            const rowBeforeMutation = JSON.parse(JSON.stringify(latestRow));
            const nextRow = applyRow(latestRow);
            if (!nextRow || typeof nextRow !== 'object') throw new Error('Dữ liệu điều phối ca không hợp lệ.');

            const nextMainIds = Array.from(getScheduledMainTeacherIds(nextRow));
            const changedAbsenceIds = nextMainIds.filter(staffId => {
                const nextType = getMainTeacherAbsenceTypeForGuard(nextRow, staffId);
                if (nextType === 'ACTIVE') return false;
                return getMainTeacherAbsenceTypeForGuard(rowBeforeMutation, staffId) !== nextType;
            });
            if (changedAbsenceIds.some(staffId => !guardedStaffIds.includes(staffId))) {
                const missingGuard = new Error('Trạng thái nghỉ vừa thay đổi nhưng chưa được đối chiếu công trong cùng giao dịch. Hãy tải lại ca.');
                missingGuard.code = 'schedule/attendance-guard-required';
                throw missingGuard;
            }

            if (absenceGuard) {
                const guardIdentityMatches = String(absenceGuard.dateKey || '') === String(dateKey || '') &&
                    String(absenceGuard.compositeKey || '') === String(compositeKey || '') &&
                    String(absenceGuard.section || '') === String(section || '') &&
                    String(absenceGuard.start || '') === String(rowBeforeMutation.start || '') &&
                    String(absenceGuard.end || '') === String(rowBeforeMutation.end || '') &&
                    (!String(absenceGuard.persistedShiftId || '') ||
                        String(absenceGuard.persistedShiftId || '') === String(rowBeforeMutation.shiftId || '')) &&
                    (!String(absenceGuard.signature || '') ||
                        String(absenceGuard.signature || '') === signatureOf(rowBeforeMutation));
                const guardedIdsAreCurrentAbsences = guardedStaffIds.every(staffId =>
                    nextMainIds.includes(staffId) &&
                    getMainTeacherAbsenceTypeForGuard(nextRow, staffId) !== 'ACTIVE'
                );
                if (!guardIdentityMatches || !guardedIdsAreCurrentAbsences) {
                    const staleGuard = new Error('Ca hoặc danh sách GV nghỉ đã thay đổi. Hãy tải lại trước khi lưu.');
                    staleGuard.code = 'schedule/attendance-guard-stale';
                    throw staleGuard;
                }

                const evidenceResolver = window.ScheduleAttendanceAdmin?.workedAttendanceConflictForShift;
                if (guardedStaffIds.length && typeof evidenceResolver !== 'function') {
                    const unavailableGuard = new Error('Không tải được bộ đối chiếu công. Đã dừng lưu trạng thái nghỉ để tránh sai chip.');
                    unavailableGuard.code = 'schedule/attendance-guard-unavailable';
                    throw unavailableGuard;
                }
                const attendanceRefs = guardedStaffIds.map(staffId =>
                    db.collection('attendance_logs').doc(`${dateKey}_${staffId}`)
                );
                const attendanceSnapshots = await Promise.all(
                    attendanceRefs.map(attendanceRef => transaction.get(attendanceRef))
                );
                const shiftIdentity = {
                    dateKey,
                    start: rowBeforeMutation.start,
                    end: rowBeforeMutation.end,
                    shiftId: String(absenceGuard.resolverShiftId || rowBeforeMutation.shiftId || ''),
                    compositeKey,
                    section
                };
                attendanceSnapshots.forEach((attendanceSnapshot, attendanceIndex) => {
                    if (!attendanceSnapshot.exists) return;
                    const staffId = guardedStaffIds[attendanceIndex];
                    const conflict = evidenceResolver(attendanceSnapshot.data() || {}, shiftIdentity);
                    if (!conflict?.conflict) return;
                    const attendanceConflict = new Error(conflict.kind === 'ambiguous'
                        ? `Nhân sự ${staffId} có nhiều phiên công cùng khớp ca. Hãy đối chiếu Bảng Công trước khi ghi VP/VĐX.`
                        : `Nhân sự ${staffId} đã có giờ vào/ra khớp ca. Không thể đồng thời ghi VP/VĐX.`);
                    attendanceConflict.code = conflict.kind === 'ambiguous'
                        ? 'schedule/attendance-ambiguous'
                        : 'schedule/attendance-work-conflict';
                    throw attendanceConflict;
                });
            }

            if (!nextRow.shiftId) nextRow.shiftId = createScheduleShiftId();
            rows[rowIndex] = nextRow;
            const currentRevision = Number.isInteger(source?._revision) ? source._revision : 0;
            transaction.set(ref, _withoutSeparateScheduleRegistrations({
                ...source,
                [section]: rows,
                _revision: currentRevision + 1,
                _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                _updatedBy: localStorage.getItem('currentUserId') || null
            }));
            committedRow = JSON.parse(JSON.stringify(nextRow));
        });

        await DBService.updateScheduleManifest(compositeKey);
        DBService._invalidate(`schedule_${compositeKey}`);
        try {
            localStorage.setItem('scheduleDataVersion', JSON.stringify({ compositeKey, at: Date.now() }));
        } catch (error) {
            // Cross-tab invalidation is best effort; Firestore remains the source of truth.
        }
        return committedRow;
    },

    // Explicitly move one teacher between concrete class rows. The normal
    // handoff removes the source teacher and adds that teacher as a main at the
    // target without inventing an absence. A source absence is supported only
    // when the scheduler explicitly chooses it. Every source roster mutation
    // re-checks its attendance in this same transaction. Multiple dates can
    // never be half-applied.
    transferTeacherBetweenShiftsAtomic: async (transfers = []) => {
        const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
        const canManageSchedule = (authorization.roles || []).some(role =>
            ['admin', 'senior_assistant', 'assistant'].includes(role)
        );
        if (!canManageSchedule) {
            const error = new Error('Bạn không có quyền điều chuyển giáo viên trên lịch.');
            error.code = 'schedule/transfer-not-authorized';
            throw error;
        }
        if (!window.TeacherShiftState?.applyTeacherTransferCommand) {
            throw new Error('Không tải được mô-đun điều chuyển giáo viên. Vui lòng tải lại trang.');
        }
        if (!Array.isArray(transfers) || transfers.length < 1 || transfers.length > 31) {
            throw new Error('Số ngày điều chuyển phải nằm trong khoảng từ 1 đến 31 ngày.');
        }

        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        const todayKey = getLocalDateKeyFromDate(new Date());
        const normalized = transfers.map((item, index) => {
            const source = item?.source || {};
            const target = item?.target || {};
            const sourceKey = String(source.compositeKey || '').trim();
            const targetKey = String(target.compositeKey || '').trim();
            const sourceMeta = DBService._parseBranchKey(sourceKey);
            const targetMeta = DBService._parseBranchKey(targetKey);
            const sourceSection = String(source.section || '').trim();
            const targetSection = String(target.section || '').trim();
            const effectiveFrom = String(item.effectiveFrom || '').trim();
            const effectiveTo = String(item.effectiveTo || '').trim();
            const mode = String(item.mode || '').trim().toLowerCase();
            const teacherId = String(item.teacherId || '').trim();
            const transferId = String(item.transferId || '').trim();
            const sourceDisposition = String(item.sourceDisposition || 'handoff').trim().toLowerCase();
            const rawSourceAbsence = item.sourceAbsence && typeof item.sourceAbsence === 'object'
                ? item.sourceAbsence
                : null;
            const sourceAbsence = rawSourceAbsence ? {
                type: String(rawSourceAbsence.type || rawSourceAbsence.status || '').trim().toUpperCase(),
                reason: String(rawSourceAbsence.reason || item.reason || '').trim().slice(0, 300),
                reportedAt: String(rawSourceAbsence.reportedAt || '').trim()
            } : null;
            if (!sourceKey || !targetKey || !sourceSection || !targetSection ||
                !SCHEDULE_SECTION_KEYS.includes(sourceSection) || !SCHEDULE_SECTION_KEYS.includes(targetSection)) {
                throw new Error(`Ngày ${index + 1}: thiếu định danh lớp nguồn/đích hợp lệ.`);
            }
            const dateOutsideRange = mode === 'temporary' &&
                (sourceMeta.dateKey < effectiveFrom || sourceMeta.dateKey > effectiveTo);
            if (!datePattern.test(sourceMeta.dateKey) || sourceMeta.dateKey !== targetMeta.dateKey ||
                (mode === 'permanent' && sourceMeta.dateKey < effectiveFrom) ||
                dateOutsideRange || sourceMeta.dateKey < todayKey) {
                throw new Error(`Ngày ${index + 1}: ngày điều chuyển không hợp lệ hoặc đã qua.`);
            }
            if (!['temporary', 'permanent'].includes(mode) || !datePattern.test(effectiveFrom) ||
                (mode === 'temporary' && (!datePattern.test(effectiveTo) || effectiveTo < effectiveFrom)) ||
                (mode === 'permanent' && effectiveTo) || !teacherId || !transferId) {
                throw new Error(`Ngày ${index + 1}: thông tin loại/khoảng thời gian điều chuyển không hợp lệ.`);
            }
            if (!['handoff', 'absence'].includes(sourceDisposition) ||
                (sourceDisposition === 'absence' && (!sourceAbsence || !['VP', 'VDX'].includes(sourceAbsence.type)))) {
                throw new Error(`Ngày ${index + 1}: hãy chọn cách xử lý lớp nguồn hợp lệ.`);
            }
            const rowLocator = locator => ({
                index: Number.isInteger(locator?.index) ? locator.index : null,
                shiftId: String(locator?.shiftId || '').trim(),
                signature: String(locator?.signature || '').trim()
            });
            const sourceLocator = rowLocator(source.locator);
            const targetLocator = rowLocator(target.locator);
            if (!sourceLocator.shiftId && (!Number.isInteger(sourceLocator.index) || !sourceLocator.signature) ||
                !targetLocator.shiftId && (!Number.isInteger(targetLocator.index) || !targetLocator.signature)) {
                throw new Error(`Ngày ${index + 1}: thiếu mã ca hoặc chữ ký ca để chống ghi nhầm.`);
            }
            return {
                ...item,
                source: { ...source, compositeKey: sourceKey, section: sourceSection, locator: sourceLocator },
                target: { ...target, compositeKey: targetKey, section: targetSection, locator: targetLocator },
                sourceMeta,
                targetMeta,
                mode,
                effectiveFrom,
                effectiveTo,
                teacherId,
                transferId,
                reason: String(item.reason || '').trim().slice(0, 300),
                sourceDisposition,
                sourceAbsence
            };
        });

        const first = normalized[0];
        if (first.reason.length < 3) throw new Error('Vui lòng nhập lý do điều chuyển (ít nhất 3 ký tự).');
        normalized.forEach(item => {
            if (item.teacherId !== first.teacherId || item.transferId !== first.transferId ||
                item.mode !== first.mode || item.effectiveFrom !== first.effectiveFrom ||
                item.effectiveTo !== first.effectiveTo || item.reason !== first.reason ||
                item.sourceDisposition !== first.sourceDisposition ||
                JSON.stringify(item.sourceAbsence || null) !== JSON.stringify(first.sourceAbsence || null)) {
                throw new Error('Các ngày trong một giao dịch điều chuyển phải dùng cùng giáo viên, loại và khoảng thời gian.');
            }
        });

        const documents = new Map();
        normalized.forEach(item => {
            [item.source, item.target].forEach(endpoint => {
                const meta = DBService._parseBranchKey(endpoint.compositeKey);
                if (!documents.has(meta.docId)) {
                    documents.set(meta.docId, {
                        ref: db.collection('schedules').doc(meta.docId),
                        compositeKey: endpoint.compositeKey,
                        fallbackData: endpoint.fallbackData && typeof endpoint.fallbackData === 'object'
                            ? JSON.parse(JSON.stringify(endpoint.fallbackData))
                            : null,
                        data: null,
                        sections: new Map()
                    });
                } else if (!documents.get(meta.docId).fallbackData && endpoint.fallbackData &&
                    typeof endpoint.fallbackData === 'object') {
                    documents.get(meta.docId).fallbackData = JSON.parse(JSON.stringify(endpoint.fallbackData));
                }
            });
        });

        const nowISO = new Date().toISOString();
        const actor = {
            id: authorization.userId || authorization.uid,
            userId: authorization.userId || '',
            uid: authorization.uid,
            name: localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || ''
        };
        const resolveRow = (rows, locator) => {
            const list = Array.isArray(rows) ? rows : [];
            if (locator.shiftId) {
                const byId = list.findIndex(row => String(row?.shiftId || '') === locator.shiftId);
                if (byId >= 0) return byId;
            }
            if (Number.isInteger(locator.index) && list[locator.index]) {
                const candidate = list[locator.index];
                const signature = [candidate?.start, candidate?.end, candidate?.lop, candidate?.phong]
                    .map(value => String(value || '').trim()).join('|');
                if (!locator.signature || signature === locator.signature) return locator.index;
            }
            const matches = list.map((row, rowIndex) => ({ row, rowIndex })).filter(({ row }) => {
                const signature = [row?.start, row?.end, row?.lop, row?.phong]
                    .map(value => String(value || '').trim()).join('|');
                return locator.signature && signature === locator.signature;
            });
            return matches.length === 1 ? matches[0].rowIndex : -1;
        };

        await db.runTransaction(async transaction => {
            const entries = Array.from(documents.values());
            const snapshots = await Promise.all(entries.map(entry => transaction.get(entry.ref)));
            snapshots.forEach((snapshot, index) => {
                const entry = entries[index];
                entry.data = snapshot.exists
                    ? snapshot.data()
                    : (entry.fallbackData ? JSON.parse(JSON.stringify(entry.fallbackData)) : {});
                if (!entry.data || typeof entry.data !== 'object' ||
                    (!snapshot.exists && !entry.fallbackData)) {
                    throw new Error(`Không tìm thấy lịch ${entry.compositeKey}. Hãy tải lại tuần trước khi điều chuyển.`);
                }
                SCHEDULE_SECTION_KEYS.forEach(section => {
                    entry.sections.set(section, Array.isArray(entry.data[section])
                        ? entry.data[section].map(row => JSON.parse(JSON.stringify(row)))
                        : []);
                });
            });

            // Both handoff and explicit VP/VDX change the source staffing. Check
            // the exact source shift in this same transaction before any write,
            // so a completed source attendance can never be detached or marked
            // absent by a later schedule edit.
            const sourceAttendanceChecks = [];
            normalized.forEach(item => {
                const sourceDoc = documents.get(item.sourceMeta.docId);
                const sourceRows = sourceDoc.sections.get(item.source.section) || [];
                const sourceIndex = resolveRow(sourceRows, item.source.locator);
                if (sourceIndex < 0 || !sourceRows[sourceIndex]) {
                    throw new Error(`Ca nguồn ngày ${item.sourceMeta.dateKey} đã thay đổi. Hãy tải lại lịch.`);
                }
                const sourceRow = sourceRows[sourceIndex];
                const sourceTeacher = window.TeacherShiftState.getMainTeachers(sourceRow)
                    .find(teacher => String(teacher.id || '') === item.teacherId);
                if (!sourceTeacher) {
                    throw new Error(`Giáo viên ${item.teacherId} không còn ở ca nguồn ngày ${item.sourceMeta.dateKey}.`);
                }
                sourceAttendanceChecks.push({ item, sourceRow, sourceTeacher });
            });
            if (sourceAttendanceChecks.length) {
                const attendanceSnapshots = await Promise.all(sourceAttendanceChecks.map(check =>
                    transaction.get(db.collection('attendance_logs').doc(
                        `${check.item.sourceMeta.dateKey}_${check.item.teacherId}`
                    ))
                ));
                const hasSourceAttendance = attendanceSnapshots.some(snapshot => snapshot.exists);
                const evidenceResolver = window.ScheduleAttendanceAdmin?.workedAttendanceConflictForShift;
                if (hasSourceAttendance && typeof evidenceResolver !== 'function') {
                    const unavailable = new Error('Không tải được bộ đối chiếu công. Đã dừng điều chuyển lớp nguồn để tránh sai chip.');
                    unavailable.code = 'schedule/attendance-guard-unavailable';
                    throw unavailable;
                }
                attendanceSnapshots.forEach((attendanceSnapshot, checkIndex) => {
                    if (!attendanceSnapshot.exists) return;
                    const check = sourceAttendanceChecks[checkIndex];
                    const conflict = evidenceResolver(attendanceSnapshot.data() || {}, {
                        dateKey: check.item.sourceMeta.dateKey,
                        start: check.sourceRow.start,
                        end: check.sourceRow.end,
                        shiftId: String(check.sourceRow.shiftId || ''),
                        compositeKey: check.item.source.compositeKey,
                        section: check.item.source.section
                    });
                    if (!conflict?.conflict) return;
                    const sourceAction = check.item.sourceDisposition === 'absence' ? 'ghi Vắng' : 'bàn giao lớp nguồn';
                    const error = new Error(conflict.kind === 'ambiguous'
                        ? `${check.sourceTeacher.name || check.item.teacherId} có nhiều phiên công cùng khớp ca nguồn. Hãy đối chiếu Bảng Công trước khi ${sourceAction}.`
                        : `${check.sourceTeacher.name || check.item.teacherId} đã có giờ vào/ra khớp ca nguồn. Không thể đồng thời ${sourceAction}.`);
                    error.code = conflict.kind === 'ambiguous'
                        ? 'schedule/attendance-ambiguous'
                        : 'schedule/attendance-work-conflict';
                    throw error;
                });
            }

            normalized.forEach(item => {
                const sourceDoc = documents.get(item.sourceMeta.docId);
                const targetDoc = documents.get(item.targetMeta.docId);
                const sourceRows = sourceDoc.sections.get(item.source.section) || [];
                const targetRows = targetDoc.sections.get(item.target.section) || [];
                const sourceIndex = resolveRow(sourceRows, item.source.locator);
                const targetIndex = resolveRow(targetRows, item.target.locator);
                if (sourceIndex < 0 || targetIndex < 0) {
                    throw new Error(`Ca nguồn hoặc ca đích ngày ${item.sourceMeta.dateKey} đã thay đổi. Hãy tải lại lịch.`);
                }
                if (sourceDoc === targetDoc && item.source.section === item.target.section && sourceIndex === targetIndex) {
                    throw new Error('Ca nguồn và ca đích không được là cùng một ca.');
                }
                const sourceRow = sourceRows[sourceIndex];
                const targetRow = targetRows[targetIndex];
                const sourceTeacher = window.TeacherShiftState.getMainTeachers(sourceRow)
                    .find(teacher => String(teacher.id || '') === item.teacherId);
                if (!sourceTeacher) throw new Error(`Giáo viên ${item.teacherId} không còn ở ca nguồn ngày ${item.sourceMeta.dateKey}.`);
                const replacementTeacher = item.replacementTeacher && typeof item.replacementTeacher === 'object'
                    ? {
                        id: String(item.replacementTeacher.id || '').trim(),
                        name: String(item.replacementTeacher.name || '').trim()
                    }
                    : null;
                const sourceDirection = item.sourceDisposition === 'absence' ? 'source_absence' : 'out';
                const sourceNext = window.TeacherShiftState.applyTeacherTransferCommand(
                    sourceRow,
                    {
                        direction: sourceDirection,
                        transferId: item.transferId,
                        mode: item.mode,
                        effectiveFrom: item.effectiveFrom,
                        effectiveTo: item.effectiveTo,
                        teacherId: item.teacherId,
                        teacherName: sourceTeacher.name,
                        replacementTeacher: sourceDirection === 'out' ? replacementTeacher : null,
                        sourceAbsence: sourceDirection === 'source_absence' ? item.sourceAbsence : null,
                        reason: item.reason,
                        source: {
                            compositeKey: item.source.compositeKey,
                            section: item.source.section,
                            shiftId: String(sourceRow.shiftId || ''),
                            signature: item.source.locator.signature
                        },
                        target: {
                            compositeKey: item.target.compositeKey,
                            section: item.target.section,
                            shiftId: String(targetRow.shiftId || ''),
                            signature: item.target.locator.signature
                        }
                    }, actor, nowISO
                );
                const targetNext = window.TeacherShiftState.applyTeacherTransferCommand(
                    targetRow,
                    {
                        direction: 'in',
                        transferId: item.transferId,
                        mode: item.mode,
                        effectiveFrom: item.effectiveFrom,
                        effectiveTo: item.effectiveTo,
                        teacherId: item.teacherId,
                        teacherName: sourceTeacher.name,
                        reason: item.reason,
                        source: {
                            compositeKey: item.source.compositeKey,
                            section: item.source.section,
                            shiftId: String(sourceRow.shiftId || ''),
                            signature: item.source.locator.signature
                        },
                        target: {
                            compositeKey: item.target.compositeKey,
                            section: item.target.section,
                            shiftId: String(targetRow.shiftId || ''),
                            signature: item.target.locator.signature
                        }
                    }, actor, nowISO
                );
                sourceRows[sourceIndex] = sourceNext;
                targetRows[targetIndex] = targetNext;
            });

            documents.forEach(entry => {
                const nextData = { ...entry.data };
                entry.sections.forEach((rows, section) => { nextData[section] = rows; });
                const currentRevision = Number.isInteger(entry.data?._revision) ? entry.data._revision : 0;
                transaction.set(entry.ref, _withoutSeparateScheduleRegistrations({
                    ...nextData,
                    _revision: currentRevision + 1,
                    _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    _updatedBy: actor.userId || actor.id
                }));
            });
        });

        for (const entry of documents.values()) {
            await DBService.updateScheduleManifest(entry.compositeKey);
            DBService._invalidate(`schedule_${entry.compositeKey}`);
            try {
                localStorage.setItem('scheduleDataVersion', JSON.stringify({
                    compositeKey: entry.compositeKey,
                    at: Date.now()
                }));
            } catch (_) { /* best effort cross-tab invalidation */ }
        }
        return { transferId: first.transferId, count: normalized.length, mode: first.mode };
    },

    // Add/delete/reorder rows against the latest section in one transaction.
    // This is the section-level companion to updateScheduleRowAtomic and keeps
    // edits in unrelated rows, including staffing/absence state, intact.
    mutateScheduleSectionAtomic: async (compositeKey, section, applyRows, fallbackDayData = null) => {
        if (!section || typeof applyRows !== 'function') {
            throw new Error('Thiếu thông tin danh sách ca cần cập nhật.');
        }
        const { docId } = DBService._parseBranchKey(compositeKey);
        const ref = db.collection('schedules').doc(docId);
        let committedRows = [];

        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            const source = snapshot.exists
                ? snapshot.data()
                : JSON.parse(JSON.stringify(fallbackDayData || {}));
            const rows = Array.isArray(source?.[section])
                ? source[section].map(row => JSON.parse(JSON.stringify(row)))
                : [];
            const nextRows = applyRows(rows);
            if (!Array.isArray(nextRows)) throw new Error('Danh sách ca sau cập nhật không hợp lệ.');
            nextRows.forEach(row => {
                if (!row || typeof row !== 'object') throw new Error('Ca làm việc không hợp lệ.');
                if (!row.shiftId) row.shiftId = createScheduleShiftId();
            });
            const currentRevision = Number.isInteger(source?._revision) ? source._revision : 0;
            transaction.set(ref, _withoutSeparateScheduleRegistrations({
                ...source,
                [section]: nextRows,
                _revision: currentRevision + 1,
                _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                _updatedBy: localStorage.getItem('currentUserId') || null
            }));
            committedRows = JSON.parse(JSON.stringify(nextRows));
        });

        await DBService.updateScheduleManifest(compositeKey);
        DBService._invalidate(`schedule_${compositeKey}`);
        try {
            localStorage.setItem('scheduleDataVersion', JSON.stringify({ compositeKey, at: Date.now() }));
        } catch (error) {
            // Cross-tab invalidation is best effort.
        }
        return committedRows;
    },

    checkInPersonal: async (userId, userFullName) => {
        // Reads and the final Firestore transaction each self-recover once
        // from a stale mobile token. The location gate remains outside the
        // retry, so one deliberate Vào ca action performs exactly one real
        // location check and no retry can bypass it.
        const initialAuthUid = (await _getAttendanceAuthUser()).uid;
        const settingsDoc = await _runAttendanceFirestoreOperation(() =>
            db.collection('settings').doc('system').get()
        );
        const settings = settingsDoc.exists ? settingsDoc.data() : {};
        // GPS is the real attendance gate. The exact Wifi/IP sentence
        // remains the only staff-facing explanation by policy.
        try {
            await assertAttendanceLocationAllowed(settings);
        } catch (locationError) {
            // Diagnostics must not hold the button indefinitely when
            // Firestore is offline. This is not an attendance write.
            void recordAttendanceLocationFailure(
                userId,
                locationError?.code || 'UNKNOWN',
                'location_gate'
            );
            throw locationError;
        }
        rememberAttendanceLocationAcknowledgement(userId);

        const dateKey = await _runAttendanceFirestoreOperation(async authUser => {
            if (authUser.uid !== initialAuthUid) {
                throw _attendanceAuthError('Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại.', 'auth/session-changed');
            }
            const now = new Date();
            const currentDateKey = getLocalDateKeyFromDate(now);
            const previousDateKey = getLocalDateKeyFromDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
            const ref = db.collection('attendance_logs').doc(`${currentDateKey}_${userId}`);
            const previousRef = db.collection('attendance_logs').doc(`${previousDateKey}_${userId}`);
            const newSessionId = createAttendanceSessionId();
            const authUid = String(authUser.uid || '').trim();
            if (!authUid) {
                throw _attendanceAuthError(
                    'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại trước khi Vào ca.',
                    'auth/session-missing'
                );
            }
            const checkInProofRef = db.collection('attendance_checkin_proofs')
                .doc(`${currentDateKey}~${userId}~${newSessionId}`);

            await db.runTransaction(async (t) => {
                const [doc, previousDoc, profileSnapshot] = await Promise.all([
                    t.get(ref), t.get(previousRef), t.get(db.collection('users').doc(userId))
                ]);
                let data = doc.exists ? doc.data() : {
                    userId,
                    name: _canonicalStaffWriteName(profileSnapshot),
                    date: currentDateKey,
                    sessions: []
                };

                // Initialize sessions if missing (migration)
                if (!data.sessions) {
                    // Migrate old single field data if exists
                    if (data.checkIn) {
                        data.sessions = [{
                            start: data.checkIn,
                            checkIn: data.checkIn,
                            checkOut: data.checkOut || null
                        }];
                    } else {
                        data.sessions = [];
                    }
                }

                // Check if ANY working session is currently OPEN (no checkOut)
                const openSession = data.sessions.find(s => !s.checkOut && !s.isAbsent);
                const previousData = previousDoc.exists ? previousDoc.data() : null;
                const previousSessions = previousData
                    ? (Array.isArray(previousData.sessions)
                        ? previousData.sessions
                        : (previousData.checkIn ? [{ checkIn: previousData.checkIn, checkOut: previousData.checkOut || null }] : []))
                    : [];
                const previousOpenSession = previousSessions.find(s => !s.checkOut && !s.isAbsent);
                if (previousOpenSession) {
                    const startTime = new Date(previousOpenSession.checkIn || previousOpenSession.start).toLocaleString('vi-VN');
                    throw new Error(`Bạn còn ca làm việc từ ${startTime} chưa kết thúc. Vui lòng Ra ca trước khi Vào ca mới.`);
                }
                if (openSession) {
                    const startTime = new Date(openSession.checkIn || openSession.start).toLocaleTimeString('vi-VN');
                    throw new Error(`Bạn đang có ca làm việc chưa kết thúc (bắt đầu lúc ${startTime})! Vui lòng Check-out hoặc Xóa ca cũ.`);
                }

                // Cooldown check-in removed as requested

                // Add new session
                const newSession = {
                    id: newSessionId,
                    anchorDateKey: currentDateKey,
                    status: 'open',
                    source: 'self',
                    start: now.toISOString(),
                    checkIn: now.toISOString(),
                    checkOut: null
                };

                data.sessions.push(newSession);

                // Sync top-level fields for query compatibility (optional but good for simple queries)
                data.checkIn = newSession.checkIn;
                data.checkOut = null;
                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

                t.set(ref, data);
                // The immutable companion receipt supplies server-authored time to
                // Firestore Rules. Client ISO timestamps remain display data only.
                t.set(checkInProofRef, {
                    staffId: userId,
                    dateKey: currentDateKey,
                    sessionId: newSessionId,
                    authUid,
                    recordedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    schemaVersion: 1
                });
            });
            return currentDateKey;
        });
        DBService._invalidateAttendance(dateKey, userId);
    },

    checkOutPersonal: async (userId, checkOutTime = null) => {
        const now = checkOutTime instanceof Date ? checkOutTime : new Date();
        const dateKey = getLocalDateKeyFromDate(now);
        const previousDateKey = getLocalDateKeyFromDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
        const candidates = Array.from(new Set([dateKey, previousDateKey])).map(key => ({
            key,
            ref: db.collection('attendance_logs').doc(`${key}_${userId}`)
        }));
        let anchorDateKey = dateKey;

        await db.runTransaction(async (t) => {
            const snapshots = await Promise.all(candidates.map(item => t.get(item.ref)));
            const openCandidates = [];
            snapshots.forEach((doc, candidateIndex) => {
                if (!doc.exists) return;
                const data = doc.data();
                if (!Array.isArray(data.sessions)) {
                    data.sessions = data.checkIn ? [{
                        id: 'legacy', start: data.checkIn, checkIn: data.checkIn,
                        checkOut: data.checkOut || null
                    }] : [];
                }
                data.sessions.forEach((session, sessionIndex) => {
                    if (!session?.checkOut && !session?.isAbsent && (session?.checkIn || session?.start)) {
                        openCandidates.push({
                            ref: candidates[candidateIndex].ref,
                            key: candidates[candidateIndex].key,
                            data,
                            sessionIndex,
                            startedAt: new Date(session.checkIn || session.start).getTime()
                        });
                    }
                });
            });
            openCandidates.sort((left, right) => right.startedAt - left.startedAt);
            const selected = openCandidates[0];
            if (!selected) throw new Error("Bạn chưa vào ca hoặc đã ra ca rồi!");
            if (!Number.isFinite(selected.startedAt) || now.getTime() < selected.startedAt) {
                throw new Error('Giờ Ra ca không thể sớm hơn giờ Vào ca.');
            }

            const { data, sessionIndex: openSessionIndex } = selected;
            anchorDateKey = selected.key;

            // Close session
            data.sessions[openSessionIndex].checkOut = now.toISOString();
            data.sessions[openSessionIndex].status = 'closed';
            data.sessions[openSessionIndex].anchorDateKey = data.sessions[openSessionIndex].anchorDateKey || selected.key;

            // Sync top level
            data.checkOut = now.toISOString();
            data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

            t.set(selected.ref, data);
        });
        DBService._invalidateAttendance(anchorDateKey, userId);
        if (anchorDateKey !== dateKey) DBService._invalidateAttendance(dateKey, userId);
    },

    // 7.1 Manual Add (Admin) — nhận giờ dạng "HH:mm".
    // Đi qua addSession để dùng CHUNG hàng rào chặn ca trùng giờ; trước đây hàm này tự
    // push thẳng nên là một cửa hậu tạo ca trùng (hiện chưa nơi nào gọi, nhưng để nguyên
    // thì lần sau ai nối vào là lại sinh lương đôi).
    addManualSession: async (userId, dateKey, checkInTime, checkOutTime, options = {}) => {
        const startDate = getVietnamDateFromHM(dateKey, checkInTime);
        let endDate = checkOutTime ? getVietnamDateFromHM(dateKey, checkOutTime) : null;
        if (!startDate) throw new Error('Giờ vào không hợp lệ.');
        if (endDate && endDate <= startDate) endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
        const startISO = startDate.toISOString();
        const endISO = endDate ? endDate.toISOString() : null;
        return DBService.addSession(userId, dateKey, {
            start: startISO,
            checkIn: startISO,
            checkOut: endISO,
            type: 'manual'
        }, options);
    },

    deleteSession: async (userId, dateKey, sessionId) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) return;

                const data = doc.data();

                // MIGRATION LOGIC (Important for consistency)
                if (!data.sessions || !Array.isArray(data.sessions)) {
                    if (data.checkIn) {
                        data.sessions = [{
                            id: 'legacy',
                            start: data.checkIn,
                            checkIn: data.checkIn,
                            checkOut: data.checkOut || null
                        }];
                    } else {
                        data.sessions = [];
                    }
                }

                // Filter out the session
                const originalLength = data.sessions.length;
                data.sessions = data.sessions.filter(s => String(s.id) !== String(sessionId));

                if (data.sessions.length === originalLength) {
                    // Try searching by index logic if needed, but ID is best.
                    // If timestamp ID match failed (maybe date string vs number), try loose compare
                }

                // Re-sync top level status if needed
                // If we deleted the open session, we are checked out?
                // Just keep last session's status or reset
                const lastSession = data.sessions[data.sessions.length - 1];
                if (lastSession) {
                    data.checkIn = lastSession.checkIn;
                    data.checkOut = lastSession.checkOut;
                } else {
                    data.checkIn = null;
                    data.checkOut = null;
                }

                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                t.set(ref, data);
            });
            DBService._invalidateAttendance(dateKey, userId);
        } catch (error) {
            console.error("Error in deleteSession:", error);
            throw error;
        }
    },

    updateSession: async (userId, dateKey, sessionId, newData) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) throw new Error("Attendance record not found");

                const data = doc.data();
                if (!data.sessions) throw new Error("No sessions found");

                const index = data.sessions.findIndex(s => String(s.id) === String(sessionId));
                if (index === -1) throw new Error("Session not found");

                // A manual time correction must not silently detach a session
                // from its scheduled class/shift.  Older callers do not send
                // link fields, so clearing them made a correctly linked 8h
                // shift appear as only its unmatched remainder on payroll.
                const session = data.sessions[index];
                const before = {
                    checkIn: session.checkIn || session.start || null,
                    checkOut: session.checkOut || null,
                    role: session.role || null,
                    linkedClassStart: session.linkedClassStart || null,
                    linkedReceptionistShift: session.linkedReceptionistShift || null,
                    linkedOfficeShift: session.linkedOfficeShift || null,
                    isAbsent: !!session.isAbsent
                };
                const hasOwn = (key) => Object.prototype.hasOwnProperty.call(newData || {}, key);
                const patch = Object.assign({}, newData || {});
                const clearScheduleLinks = patch.clearScheduleLinks === true;
                const editMeta = patch.editMeta || {};
                delete patch.clearScheduleLinks;
                delete patch.editMeta;

                ['role', 'roleName', 'roleRate', 'isFixedShift'].forEach((key) => {
                    if (hasOwn(key)) session[key] = patch[key];
                });

                const hasClassLink = hasOwn('linkedClassStart');
                const hasReceptionistLink = hasOwn('linkedReceptionistShift');
                const hasOfficeLink = hasOwn('linkedOfficeShift');
                if (clearScheduleLinks) {
                    delete session.linkedClassStart;
                    delete session.linkedReceptionistShift;
                    delete session.linkedOfficeShift;
                } else if (hasClassLink) {
                    if (patch.linkedClassStart) session.linkedClassStart = patch.linkedClassStart;
                    else delete session.linkedClassStart;
                    delete session.linkedReceptionistShift;
                    delete session.linkedOfficeShift;
                } else if (hasReceptionistLink) {
                    if (patch.linkedReceptionistShift) session.linkedReceptionistShift = patch.linkedReceptionistShift;
                    else delete session.linkedReceptionistShift;
                    delete session.linkedClassStart;
                    delete session.linkedOfficeShift;
                } else if (hasOfficeLink) {
                    if (patch.linkedOfficeShift) session.linkedOfficeShift = patch.linkedOfficeShift;
                    else delete session.linkedOfficeShift;
                    delete session.linkedClassStart;
                    delete session.linkedReceptionistShift;
                }

                // QUAN TRỌNG: admin đã sửa giờ tay -> bỏ cờ auto-close.
                // Nếu giữ cờ này, khối auto-close (report.js) sẽ coi ca vẫn "quên ra ca"
                // và GHI ĐÈ giờ ra của admin về giờ tan ca/23:59 ở lần tải trang sau.
                delete session.autoClosedReason;

                // Merge ordinary fields after protected role/link fields.
                Object.keys(patch).forEach((key) => {
                    if (['role', 'roleName', 'roleRate', 'isFixedShift', 'linkedClassStart', 'linkedReceptionistShift', 'linkedOfficeShift'].includes(key)) return;
                    session[key] = patch[key];
                });

                if (newData.checkIn) {
                    session.start = newData.checkIn; // Sync legacy
                }

                // Sync top level if this is the last session
                if (index === data.sessions.length - 1) {
                    data.checkIn = session.checkIn;
                    data.checkOut = session.checkOut;
                }

                // Keep a compact audit trail with this attendance session. It
                // supports investigation even before paid cloud backups exist.
                const after = {
                    checkIn: session.checkIn || session.start || null,
                    checkOut: session.checkOut || null,
                    role: session.role || null,
                    linkedClassStart: session.linkedClassStart || null,
                    linkedReceptionistShift: session.linkedReceptionistShift || null,
                    linkedOfficeShift: session.linkedOfficeShift || null,
                    isAbsent: !!session.isAbsent
                };
                const history = Array.isArray(session.editHistory) ? session.editHistory.slice(-19) : [];
                history.push({
                    at: new Date().toISOString(),
                    action: 'manual_edit',
                    source: editMeta.source || 'report',
                    editor: editMeta.editor || null,
                    before: before,
                    after: after
                });
                session.editHistory = history;

                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                t.set(ref, data);
            });
            DBService._invalidateAttendance(dateKey, userId);
        } catch (error) {
            console.error("Error in updateSession:", error);
            throw error;
        }
    },

    getAdminPayrollSessionFingerprint: (session) => _adminPayrollSessionFingerprint(session),

    // Primary-Admin-only, atomic writer for an absolute payroll-chip override.
    // Raw check-in/out remains the attendance evidence; the versioned
    // allocations describe exactly which portions are paid as teaching,
    // receptionist or office work.  Legacy schedule links are preserved unless
    // the command explicitly asks to clear them.
    saveAdminPayrollOverride: async (command = {}) => {
        const helper = window.AdminPayrollOverride;
        if (!helper || typeof helper.validateOverride !== 'function') {
            throw new Error('Mô-đun phân bổ công của Admin chưa được tải. Vui lòng tải lại trang.');
        }

        const staffId = String(command.staffId || '').trim();
        const dateKey = String(command.dateKey || '').trim();
        const sessionId = String(command.sessionId || '').trim();
        const expectedFingerprint = String(command.expectedFingerprint || '');
        const reason = String(command.reason || '').trim();
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(staffId) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) ||
            !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId)) {
            throw new Error('Nhân sự, ngày hoặc mã phiên công không hợp lệ.');
        }
        if (!expectedFingerprint) {
            const error = new Error('Popup thiếu phiên bản dữ liệu gốc. Hãy đóng và mở lại ca trước khi lưu.');
            error.code = 'attendance/context-required';
            throw error;
        }
        if (reason.length < 3) {
            throw new Error('Vui lòng ghi lý do điều chỉnh (ít nhất 3 ký tự) để lưu dấu vết.');
        }

        const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
        if (!authorization.roles.includes('admin')) {
            const error = new Error('Chỉ Admin chính mới được ghi đè chip tính lương.');
            error.code = 'auth/admin-required';
            throw error;
        }
        const actorUserId = String(authorization.userId || '').trim();
        if (!actorUserId) throw new Error('Tài khoản Admin chưa liên kết mã nhân sự.');

        const attendanceRef = db.collection('attendance_logs').doc(`${dateKey}_${staffId}`);
        const profileRef = db.collection('users').doc(staffId);
        const actorRoleRef = db.collection('user_roles').doc(authorization.uid);
        const monthlyRef = db.collection('salary_settings_monthly').doc(`${dateKey.slice(0, 7)}_${staffId}`);
        const auditId = `payroll_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
        const auditRef = db.collection('admin_payroll_override_audits').doc(auditId);
        const notificationRef = db.collection('admin_notifications').doc(`payroll_${auditId}`);
        const sessionPatch = command.sessionPatch && typeof command.sessionPatch === 'object'
            ? command.sessionPatch
            : {};
        const requestedMode = String(command.override?.mode || 'actual').trim().toLowerCase();
        const rawSubjectIds = Array.from(new Set(
            (Array.isArray(command.override?.allocations) ? command.override.allocations : [])
                .flatMap(allocation => Array.isArray(allocation?.subjectIds)
                    ? allocation.subjectIds
                    : String(allocation?.subjectId || '').split('+'))
                .map(value => String(value || '').trim())
                .filter(Boolean)
        ));
        const subjectRefs = rawSubjectIds.map(id => db.collection('subjects').doc(id));
        let savedOverride = null;
        let revisionRequired = false;

        await db.runTransaction(async transaction => {
            const snapshots = await Promise.all([
                transaction.get(attendanceRef),
                transaction.get(profileRef),
                transaction.get(actorRoleRef),
                transaction.get(monthlyRef),
                ...subjectRefs.map(ref => transaction.get(ref))
            ]);
            const attendanceSnapshot = snapshots[0];
            const profileSnapshot = snapshots[1];
            const actorRoleSnapshot = snapshots[2];
            const monthlySnapshot = snapshots[3];
            const subjectSnapshots = snapshots.slice(4);
            if (!attendanceSnapshot.exists) throw new Error('Không tìm thấy ngày công cần chỉnh.');
            if (!profileSnapshot.exists) throw new Error('Không tìm thấy hồ sơ nhân sự cần chỉnh.');
            const liveActorRoles = _normalizeRoleList(actorRoleSnapshot.exists ? actorRoleSnapshot.data() : {});
            if (!actorRoleSnapshot.exists || !liveActorRoles.includes('admin') ||
                String(actorRoleSnapshot.data()?.userId || '') !== actorUserId) {
                const error = new Error('Quyền Admin đã thay đổi. Hãy đăng nhập lại trước khi chỉnh công.');
                error.code = 'auth/admin-required';
                throw error;
            }
            const profileSubjectIds = new Set(
                (profileSnapshot.data()?.salary_config?.roles || [])
                    .map(role => String(role?.id || '').trim())
                    .filter(Boolean)
            );
            const invalidSubjectIndex = subjectSnapshots.findIndex((snapshot, subjectIndex) =>
                (snapshot.exists && snapshot.data()?.isGroup === true) ||
                (!snapshot.exists && !profileSubjectIds.has(rawSubjectIds[subjectIndex]))
            );
            if (invalidSubjectIndex >= 0) {
                throw new Error('Một Môn/Lớp trong phân bổ đã bị xóa hoặc chỉ là nhóm môn. Hãy mở lại popup và chọn lại.');
            }

            const attendance = attendanceSnapshot.data() || {};
            const sessions = Array.isArray(attendance.sessions)
                ? attendance.sessions.map(session => ({ ...session }))
                : [];
            const index = sessions.findIndex(session => String(session?.id || '') === sessionId);
            if (index < 0) throw new Error('Phiên công không còn tồn tại. Hãy tải lại bảng công.');
            const originalSession = sessions[index];
            if (_adminPayrollSessionFingerprint(originalSession) !== expectedFingerprint) {
                const error = new Error('Ca này vừa được chỉnh ở nơi khác. Đã dừng để không ghi đè thay đổi mới.');
                error.code = 'attendance/edit-conflict';
                throw error;
            }

            const allowedPatchKeys = [
                'checkIn', 'start', 'checkOut', 'isAbsent', 'role', 'roleName',
                'roleRate', 'isFixedShift', 'roleAssignmentSource',
                'subjectOverride', 'absentSubShifts'
            ];
            const session = { ...originalSession };
            allowedPatchKeys.forEach(key => {
                if (Object.prototype.hasOwnProperty.call(sessionPatch, key)) session[key] = sessionPatch[key];
            });
            if (sessionPatch.checkIn) session.start = sessionPatch.checkIn;
            const checkInMs = new Date(session.checkIn || session.start || '').getTime();
            const checkOutMs = session.checkOut ? new Date(session.checkOut).getTime() : NaN;
            if (!Number.isFinite(checkInMs)) throw new Error('Giờ vào không hợp lệ.');
            if (!Number.isFinite(checkOutMs) || checkOutMs <= checkInMs) {
                throw new Error('Ghi đè chip cần đủ giờ ra và giờ ra phải sau giờ vào.');
            }
            if (checkOutMs - checkInMs > 24 * 60 * 60 * 1000) {
                throw new Error('Một phiên công không thể dài quá 24 giờ.');
            }

            const oldRevision = Number(originalSession.adminPayrollOverride?.revision || 0);
            if (Number(command.expectedRevision || 0) !== oldRevision) {
                const error = new Error('Phiên bản phân bổ công đã thay đổi. Hãy mở lại popup.');
                error.code = 'attendance/edit-conflict';
                throw error;
            }

            const candidateOverride = {
                version: 1,
                mode: requestedMode,
                revision: oldRevision + 1,
                allocations: Array.isArray(command.override?.allocations)
                    ? command.override.allocations
                    : [],
                adminEarly10: command.override?.adminEarly10 && typeof command.override.adminEarly10 === 'object'
                    ? command.override.adminEarly10
                    : { enabled: false },
                reason
            };
            const candidateSession = { ...session, adminPayrollOverride: candidateOverride };
            const validation = helper.validateOverride(candidateSession, { maxDurationMinutes: 24 * 60 });
            if (!validation.ok) {
                const error = new Error(validation.errors?.[0]?.message || 'Phân bổ chip tính lương không hợp lệ.');
                error.code = validation.errors?.[0]?.code || 'attendance/invalid-payroll-override';
                throw error;
            }

            // Keep an inactive `schedule` envelope instead of deleting it so
            // revisions remain monotonic and the rollback decision is visible
            // on the attendance source itself. The evaluator treats schedule
            // mode as legacy/inactive by design.
            session.adminPayrollOverride = _serializedAdminPayrollOverride(
                validation.normalized,
                oldRevision + 1,
                { uid: authorization.uid, userId: actorUserId },
                reason
            );
            savedOverride = session.adminPayrollOverride;
            session.isAdminEdited = true;
            session.adminCorrectionAt = new Date().toISOString();
            session.adminCorrectionBy = actorUserId;
            delete session.autoClosedReason;
            if (session.isAbsent !== true) delete session.isAbsent;

            if (command.clearLegacyScheduleLinks === true) {
                delete session.linkedClassStart;
                delete session.linkedReceptionistShift;
                delete session.linkedOfficeShift;
                delete session.linkedScheduleShiftId;
                delete session.linkedScheduleCompositeKey;
                delete session.linkedScheduleSection;
            }

            // A second source session with substantial overlap is normally a
            // duplicate payroll record.  Primary Admin may deliberately keep it,
            // but must make that decision explicit; allocation-level overlap is
            // safe because the pure evaluator pays the union only once.
            const overlap = sessions.find((other, otherIndex) => {
                if (otherIndex === index || other?.isAbsent || !(other?.checkIn || other?.start) || !other?.checkOut) return false;
                const otherStart = new Date(other.checkIn || other.start).getTime();
                const otherEnd = new Date(other.checkOut).getTime();
                return Number.isFinite(otherStart) && Number.isFinite(otherEnd) &&
                    Math.min(checkOutMs, otherEnd) - Math.max(checkInMs, otherStart) >= 10 * 60 * 1000;
            });
            if (overlap && command.allowSessionOverlap !== true) {
                const error = new Error('Giờ mới trùng ít nhất 10 phút với một phiên công khác. Chỉ tiếp tục khi Admin xác nhận ngoại lệ trùng phiên.');
                error.code = 'SESSION_OVERLAP';
                error.clashSessionId = overlap.id;
                throw error;
            }

            const before = {
                checkIn: originalSession.checkIn || originalSession.start || null,
                checkOut: originalSession.checkOut || null,
                role: originalSession.role || null,
                adminPayrollOverride: originalSession.adminPayrollOverride || null
            };
            const after = {
                checkIn: session.checkIn || session.start || null,
                checkOut: session.checkOut || null,
                role: session.role || null,
                adminPayrollOverride: {
                    version: 1,
                    mode: requestedMode,
                    revision: oldRevision + 1,
                    adminEarly10: session.adminPayrollOverride?.adminEarly10?.enabled === true
                        ? {
                            enabled: true,
                            minutes: 10,
                            allocationId: session.adminPayrollOverride.adminEarly10.allocationId
                        }
                        : { enabled: false }
                }
            };
            const history = Array.isArray(session.editHistory) ? session.editHistory.slice(-19) : [];
            history.push({
                at: new Date().toISOString(),
                action: requestedMode === 'schedule' ? 'clear_admin_payroll_override' : 'save_admin_payroll_override',
                source: 'report_payroll_chip_editor',
                editor: { uid: authorization.uid, userId: actorUserId },
                reason,
                before,
                after
            });
            session.editHistory = history;
            sessions[index] = session;

            attendance.sessions = sessions;
            const latest = sessions.reduce((result, candidate, candidateIndex) => {
                const timestamp = new Date(candidate?.checkIn || candidate?.start || '').getTime();
                if (!Number.isFinite(timestamp)) return result;
                if (!result || timestamp > result.timestamp ||
                    (timestamp === result.timestamp && candidateIndex > result.index)) {
                    return { candidate, timestamp, index: candidateIndex };
                }
                return result;
            }, null);
            if (latest) {
                attendance.checkIn = latest.candidate.checkIn || latest.candidate.start || null;
                attendance.checkOut = latest.candidate.checkOut || null;
            }
            attendance.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
            attendance.lastAdminPayrollOverride = {
                authUid: authorization.uid,
                actorUserId,
                sessionId,
                auditId,
                at: firebase.firestore.FieldValue.serverTimestamp()
            };
            transaction.set(attendanceRef, attendance);

            const monthlyData = monthlySnapshot.exists ? (monthlySnapshot.data() || {}) : {};
            const published = monthlyData.published;
            revisionRequired = !!(published && typeof published === 'object' &&
                ['published', 'received'].some(status => [
                    published.status, published.status_gv, published.status_tt
                ].includes(status)));
            if (monthlySnapshot.exists) {
                transaction.set(monthlyRef, {
                    attendanceRevisionState: {
                        active: revisionRequired,
                        source: 'admin_payroll_override',
                        sessionId,
                        auditId,
                        sourceRevision: oldRevision + 1,
                        updatedBy: actorUserId,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }
                }, { merge: true });
            }

            transaction.set(auditRef, {
                authUid: authorization.uid,
                actorUserId,
                staffId,
                dateKey,
                sessionId,
                action: 'save_payroll_override',
                mode: requestedMode,
                revision: oldRevision + 1,
                reason: reason.slice(0, 500),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            transaction.set(notificationRef, {
                staffId,
                staffName: profileSnapshot.data()?.name || profileSnapshot.data()?.username || 'N/A',
                action: 'edit_payroll_override',
                dateKey,
                details: `Admin đã điều chỉnh phân bổ công (${requestedMode}) cho ca ${sessionId}.`,
                adminName: authorization.roleData?.name || authorization.roleData?.username || 'Admin',
                read: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        DBService._invalidateAttendance(dateKey, staffId);
        DBService._invalidate(`monthly_attendance_${dateKey.slice(0, 7)}_${staffId}`);
        DBService._invalidate(`all_monthly_salary_settings_${dateKey.slice(0, 7)}`);
        return { auditId, override: savedOverride, revisionRequired };
    },

    // Admin-only, auditable command used by the teaching schedule popup. Time,
    // approved student count and +10 policy state are committed in one Firestore
    // transaction so the chip and payroll source cannot be left half-updated.
    saveAdminTeachingAttendanceCorrection: async (command = {}) => {
        const helper = window.ScheduleAttendanceAdmin;
        if (!helper || typeof helper.validateDraft !== 'function') {
            throw new Error('Mô-đun kiểm tra công trên lịch chưa được tải. Vui lòng tải lại trang.');
        }
        if (!window.Early10 || typeof window.Early10.evaluateEarly10Request !== 'function' ||
            typeof window.Early10.splitSubjectIds !== 'function') {
            throw new Error('Mô-đun quy định +10 phút chưa được tải. Vui lòng tải lại trang.');
        }

        const staffId = String(command.staffId || '').trim();
        const dateKey = String(command.dateKey || '').trim();
        const scheduledStart = String(command.scheduledStart || '').trim();
        const scheduledEnd = String(command.scheduledEnd || '').trim();
        const scheduleIdentity = command.scheduleIdentity && typeof command.scheduleIdentity === 'object'
            ? command.scheduleIdentity
            : {};
        const compositeKey = String(command.compositeKey || scheduleIdentity.compositeKey || '').trim();
        const scheduleSection = String(command.section || scheduleIdentity.section || '').trim();
        const expectedScheduleSignature = String(
            command.expectedScheduleSignature || command.scheduleSignature || command.signature ||
            scheduleIdentity.signature || ''
        ).trim();
        const hasExpectedStaffingUpdatedAt = Object.prototype.hasOwnProperty.call(
            command,
            'expectedStaffingUpdatedAt'
        ) || Object.prototype.hasOwnProperty.call(scheduleIdentity, 'expectedStaffingUpdatedAt');
        const expectedStaffingUpdatedAt = String(
            command.expectedStaffingUpdatedAt ?? scheduleIdentity.expectedStaffingUpdatedAt ?? ''
        );
        const scheduleIndex = Number.isInteger(command.scheduleIndex)
            ? command.scheduleIndex
            : (Number.isInteger(command.index)
                ? command.index
                : (Number.isInteger(scheduleIdentity.index) ? scheduleIdentity.index : null));
        const hasPersistedShiftIdentity = Object.prototype.hasOwnProperty.call(
            scheduleIdentity,
            'persistedShiftId'
        );
        const requestedShiftId = String(
            hasPersistedShiftIdentity ? scheduleIdentity.persistedShiftId : command.shiftId || ''
        ).trim();
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(staffId) || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
            throw new Error('Nhân sự hoặc ngày chấm công không hợp lệ.');
        }
        if (!/^[A-Za-z0-9_-]{1,160}$/.test(compositeKey) ||
            !/^[A-Za-z0-9_-]{1,80}$/.test(scheduleSection) ||
            !expectedScheduleSignature || !hasExpectedStaffingUpdatedAt) {
            const error = new Error('Popup lịch thiếu dấu vết phiên bản của ca. Hãy tải lại lịch trước khi chỉnh công.');
            error.code = 'schedule/context-required';
            throw error;
        }

        const parsedScheduleKey = DBService._parseBranchKey(compositeKey);
        if (parsedScheduleKey.dateKey !== dateKey) {
            const error = new Error('Ngày của ô lịch không khớp ngày chấm công. Đã dừng để tránh sửa nhầm dữ liệu.');
            error.code = 'schedule/conflict';
            throw error;
        }
        const scheduleRef = db.collection('schedules').doc(parsedScheduleKey.docId);
        const teacherShiftState = window.TeacherShiftState;
        if (!teacherShiftState || typeof teacherShiftState.getMainTeachers !== 'function' ||
            typeof teacherShiftState.getSubstituteTeachers !== 'function' ||
            typeof teacherShiftState.isMainTeacherAbsent !== 'function') {
            throw new Error('Mô-đun điều phối giáo viên chưa được tải. Vui lòng tải lại trang.');
        }

        const shiftWindow = helper.buildShiftWindow(dateKey, scheduledStart, scheduledEnd);
        if (!shiftWindow) throw new Error('Khung giờ ca dạy không hợp lệ.');
        const validation = helper.validateDraft(command.draft || {}, shiftWindow, { now: new Date() });
        if (!validation?.ok) {
            const error = new Error(validation?.error || validation?.errors?.[0] || 'Dữ liệu chấm công chưa hợp lệ.');
            error.code = 'attendance/invalid-correction';
            throw error;
        }
        if (String(command.draft?.mode || '') === 'none') {
            throw new Error('Hãy chọn Đã vào ca hoặc Đủ vào/ra trước khi lưu.');
        }

        const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
        if (!authorization.roles.includes('admin')) {
            const error = new Error('Chỉ Admin mới được chỉnh công ngay trên lịch.');
            error.code = 'auth/admin-required';
            throw error;
        }

        const monthStr = dateKey.slice(0, 7);
        const profileRef = db.collection('users').doc(staffId);
        const monthlyRef = db.collection('salary_settings_monthly').doc(`${monthStr}_${staffId}`);
        const subjectQuery = db.collection('subjects').orderBy('name');
        const requestQuery = db.collection('bonus10_requests').where('staffId', '==', staffId);
        const [profileSnapshot, subjectSnapshot, requestSnapshot] = await Promise.all([
            profileRef.get({ source: 'server' }),
            subjectQuery.get({ source: 'server' }),
            requestQuery.get({ source: 'server' })
        ]);
        if (!profileSnapshot.exists) throw new Error('Không tìm thấy hồ sơ nhân sự cần chỉnh công.');

        const profile = { id: profileSnapshot.id, ...profileSnapshot.data() };
        const subjects = subjectSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const requestedSubjectName = String(command.subjectName || '').trim();
        const suppliedSubjectId = String(command.subjectId || '').trim();
        let subjectId = suppliedSubjectId;
        let subjectIds = [];
        if (suppliedSubjectId) {
            subjectIds = Array.from(new Set(window.Early10.splitSubjectIds(suppliedSubjectId)
                .map(value => String(value || '').trim())
                .filter(Boolean)));
            const knownSubjectIds = new Set(subjects.map(subject => String(subject.id || '')));
            const missingSubjectIds = subjectIds.filter(id => !knownSubjectIds.has(id));
            if (!subjectIds.length || missingSubjectIds.length) {
                const error = new Error('Mã Môn/Lớp của ca không còn tồn tại. Hãy cập nhật lại lịch trước khi ghi công để tránh Role?.');
                error.code = 'schedule/subject-conflict';
                throw error;
            }
        } else {
            const exactMatches = subjects.filter(subject =>
                String(subject.name || '').trim() === requestedSubjectName
            );
            if (exactMatches.length !== 1) {
                const error = new Error(exactMatches.length > 1
                    ? 'Tên Môn/Lớp đang trùng dữ liệu nên không thể tự chọn mã tính lương an toàn.'
                    : 'Môn/Lớp này chưa có mã dữ liệu. Hãy chọn lại Môn/Lớp trước khi ghi công để bảng lương không hiện “Role?”.');
                error.code = 'schedule/subject-conflict';
                throw error;
            }
            subjectId = String(exactMatches[0].id || '').trim();
            subjectIds = [subjectId];
        }
        const subjectRefs = subjectIds.map(id => db.collection('subjects').doc(id));

        const monthlyRequestDocs = requestSnapshot.docs
            .filter(doc => String(doc.data()?.dateKey || '').startsWith(`${monthStr}-`));
        const monthlyRequests = monthlyRequestDocs
            .map(doc => ({ id: doc.id, ...doc.data() }));
        // A time/count correction must not implicitly approve or cancel +10.
        // Only an explicit toggle from the Admin UI may mutate the approved
        // request for this exact teaching shift. Session-level flags are legacy
        // data and are never an award source.
        const bonus10Mutation = command.bonus10Mutation && typeof command.bonus10Mutation === 'object'
            ? command.bonus10Mutation
            : {};
        const bonus10Dirty = command.bonus10Dirty === true ||
            bonus10Mutation.dirty === true || command.draft?.bonus10Dirty === true;
        const desiredBonus10 = Object.prototype.hasOwnProperty.call(bonus10Mutation, 'desired')
            ? bonus10Mutation.desired === true
            : command.draft?.bonus10 === true;
        const wantsBonus10 = bonus10Dirty && desiredBonus10;
        // Student-count review state is financially significant (large-class
        // allowance and monthly penalties). A time-only edit must preserve the
        // existing count, pending/rejected status and reviewer metadata exactly.
        const studentCountMutation = command.studentCountMutation && typeof command.studentCountMutation === 'object'
            ? command.studentCountMutation
            : {};
        const studentCountDirty = command.studentCountDirty === true ||
            studentCountMutation.dirty === true || command.draft?.studentCountDirty === true;
        // The clicked teaching row is the award boundary. A concurrent class
        // may share the same physical attendance session, but its subject policy
        // must never grant +10 to this row.
        let policyVerdict = null;
        let awardedSubjectId = '';

        const expectedSessionId = String(command.sessionId || '').trim();
        const targetSessionId = expectedSessionId || createAttendanceSessionId();
        const targetShiftKey = _bonus10TargetShiftKey(
            dateKey,
            compositeKey,
            scheduleSection,
            Number.isInteger(scheduleIndex) ? scheduleIndex : 0,
            requestedShiftId,
            scheduledStart,
            scheduledEnd
        );
        const sameTargetRequests = monthlyRequests.filter(item =>
            String(item.dateKey || '') === dateKey &&
            item.awardScope === 'teaching_shift' &&
            String(item.targetShiftKey || '') === targetShiftKey
        );
        const activeRequests = sameTargetRequests.filter(item => ['pending', 'approved'].includes(String(item.status || '')));
        if (bonus10Dirty && activeRequests.length > 1) {
            throw new Error('Ca này có nhiều yêu cầu +10 phút đang hoạt động. Hãy xử lý trùng dữ liệu trong Bảng Công trước.');
        }
        const canonicalRequestId = _canonicalBonus10RequestId(
            dateKey,
            staffId,
            targetSessionId,
            targetShiftKey
        );
        const bonusRequestId = activeRequests[0]?.id || canonicalRequestId;

        const attendanceRef = db.collection('attendance_logs').doc(`${dateKey}_${staffId}`);
        const actorRoleRef = db.collection('user_roles').doc(authorization.uid);
        const settingsRef = db.collection('settings').doc('system');
        const cancelledRef = db.collection('cancelled_shifts').doc(`${monthStr}_${staffId}`);
        const canonicalBonusRequestRef = db.collection('bonus10_requests').doc(canonicalRequestId);
        const transactionRequestRefs = new Map();
        // Re-read every known request in the month even when the toggle was not
        // touched. Changing the time of a session that already carries +10 (or
        // has a pending/approved request) must re-validate the entitlement.
        monthlyRequestDocs.forEach(doc => transactionRequestRefs.set(doc.id, doc.ref));
        // Always read the singleton canonical document, even when this popup did
        // not touch +10. A competing create then conflicts/retries instead of
        // escaping the monthly-policy snapshot.
        transactionRequestRefs.set(canonicalRequestId, canonicalBonusRequestRef);
        if (bonus10Dirty) {
            transactionRequestRefs.set(
                bonusRequestId,
                db.collection('bonus10_requests').doc(bonusRequestId)
            );
        }
        const requestRefs = Array.from(transactionRequestRefs.values());
        const auditId = `schedule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
        const auditRef = db.collection('schedule_attendance_admin_audits').doc(auditId);
        const nowISO = new Date().toISOString();
        let savedSession = null;

        await db.runTransaction(async transaction => {
            const reads = [
                transaction.get(actorRoleRef),
                transaction.get(attendanceRef),
                transaction.get(monthlyRef),
                transaction.get(scheduleRef),
                transaction.get(profileRef),
                transaction.get(settingsRef),
                transaction.get(cancelledRef)
            ];
            subjectRefs.forEach(ref => reads.push(transaction.get(ref)));
            requestRefs.forEach(ref => reads.push(transaction.get(ref)));
            const snapshots = await Promise.all(reads);
            const actorRoleSnapshot = snapshots[0];
            const attendanceSnapshot = snapshots[1];
            const monthlySnapshot = snapshots[2];
            const scheduleSnapshot = snapshots[3];
            const liveProfileSnapshot = snapshots[4];
            const settingsSnapshot = snapshots[5];
            const cancelledSnapshot = snapshots[6];
            const subjectSnapshotStart = 7;
            const liveSubjectSnapshots = snapshots.slice(
                subjectSnapshotStart,
                subjectSnapshotStart + subjectRefs.length
            );
            const requestSnapshots = snapshots.slice(subjectSnapshotStart + subjectRefs.length);
            const requestSnapshotsById = new Map(requestSnapshots.map(snapshot => [snapshot.id, snapshot]));
            const liveMonthlyRequests = requestSnapshots
                .filter(snapshot => snapshot.exists)
                .map(snapshot => ({ id: snapshot.id, ...snapshot.data() }))
                .filter(item => String(item.dateKey || '').startsWith(`${monthStr}-`));
            const liveSameTargetRequests = liveMonthlyRequests.filter(item =>
                String(item.dateKey || '') === dateKey &&
                item.awardScope === 'teaching_shift' &&
                String(item.targetShiftKey || '') === targetShiftKey
            );
            const liveActiveRequests = liveSameTargetRequests.filter(item =>
                ['pending', 'approved'].includes(String(item.status || ''))
            );
            if (liveActiveRequests.length > 1) {
                throw new Error('Ca này có nhiều yêu cầu +10 phút đang hoạt động. Hãy xử lý trùng dữ liệu trong Bảng Công trước.');
            }
            const resolvedBonusRequestId = liveActiveRequests[0]?.id || canonicalRequestId;
            const bonusRequestRef = db.collection('bonus10_requests').doc(resolvedBonusRequestId);
            const bonusRequestSnapshot = requestSnapshotsById.get(resolvedBonusRequestId) || null;
            const canonicalRequestSnapshot = requestSnapshotsById.get(canonicalRequestId) || null;
            if (canonicalRequestSnapshot?.exists) {
                _assertBonus10RequestIdentity(canonicalRequestSnapshot.data(), {
                    staffId,
                    dateKey,
                    sessionId: targetSessionId,
                    targetShiftKey
                });
            }
            if (bonusRequestSnapshot?.exists) {
                _assertBonus10RequestIdentity(bonusRequestSnapshot.data(), {
                    staffId,
                    dateKey,
                    sessionId: targetSessionId,
                    targetShiftKey
                });
            }

            const actorRoleData = actorRoleSnapshot.exists ? (actorRoleSnapshot.data() || {}) : {};
            const actorRoles = _normalizeRoleList(actorRoleData);
            const actorUserId = String(actorRoleData.userId || '').trim();
            if (!actorRoles.includes('admin') || !actorUserId || actorRoleSnapshot.id !== authorization.uid) {
                const error = new Error('Quyền Admin đã thay đổi. Vui lòng đăng nhập lại trước khi chỉnh công.');
                error.code = 'auth/admin-required';
                throw error;
            }

            if (!liveProfileSnapshot.exists) {
                const error = new Error('Hồ sơ nhân sự vừa bị xóa hoặc thay đổi. Hãy tải lại popup.');
                error.code = 'attendance/conflict';
                throw error;
            }
            const liveProfile = { id: liveProfileSnapshot.id, ...(liveProfileSnapshot.data() || {}) };
            if (liveSubjectSnapshots.some(snapshot => !snapshot.exists)) {
                const error = new Error('Môn/Lớp vừa bị xóa hoặc thay đổi. Hãy tải lại lịch trước khi ghi công.');
                error.code = 'schedule/subject-conflict';
                throw error;
            }
            const liveSubjects = liveSubjectSnapshots.map(snapshot => ({
                id: snapshot.id,
                ...(snapshot.data() || {})
            }));

            const scheduleConflict = (message, code = 'schedule/conflict') => {
                const error = new Error(message);
                error.code = code;
                return error;
            };
            if (!scheduleSnapshot.exists) {
                throw scheduleConflict(
                    'Ngày này đang dùng lịch kế thừa và chưa có bản lịch riêng để khóa phiên bản. Hãy lưu/materialize lịch ngày trước khi chỉnh công.',
                    'schedule/not-materialized'
                );
            }
            const scheduleData = scheduleSnapshot.data() || {};
            const scheduleRows = Array.isArray(scheduleData[scheduleSection])
                ? scheduleData[scheduleSection]
                : [];
            const signatureOf = row => [row?.start, row?.end, row?.lop, row?.phong]
                .map(value => String(value || '').trim())
                .join('|');
            let scheduleRowIndex = requestedShiftId
                ? scheduleRows.findIndex(row => String(row?.shiftId || '').trim() === requestedShiftId)
                : -1;
            if (scheduleRowIndex < 0 && Number.isInteger(scheduleIndex)) {
                const legacyCandidate = scheduleRows[scheduleIndex];
                if (legacyCandidate && !String(legacyCandidate.shiftId || '').trim() &&
                    signatureOf(legacyCandidate) === expectedScheduleSignature) {
                    scheduleRowIndex = scheduleIndex;
                }
            }
            if (scheduleRowIndex < 0 || !scheduleRows[scheduleRowIndex]) {
                throw scheduleConflict('Ca đã bị xóa, di chuyển hoặc đổi mã. Hãy tải lại lịch trước khi chỉnh công.');
            }
            const liveScheduleRow = scheduleRows[scheduleRowIndex];
            if (signatureOf(liveScheduleRow) !== expectedScheduleSignature ||
                String(liveScheduleRow.staffingUpdatedAt || '') !== expectedStaffingUpdatedAt) {
                throw scheduleConflict(
                    'Ca hoặc phân công giáo viên vừa được người khác cập nhật. Hãy tải lại lịch trước khi chỉnh công.',
                    'schedule/staffing-conflict'
                );
            }
            if (String(liveScheduleRow.start || '').trim() !== scheduledStart ||
                String(liveScheduleRow.end || '').trim() !== scheduledEnd ||
                String(liveScheduleRow.lop || '').trim() !== requestedSubjectName) {
                throw scheduleConflict('Giờ hoặc Môn/Lớp của ca vừa thay đổi. Hãy tải lại lịch trước khi chỉnh công.');
            }
            const liveTargetShiftKey = _bonus10TargetShiftKey(
                dateKey,
                compositeKey,
                scheduleSection,
                scheduleRowIndex,
                liveScheduleRow.shiftId || '',
                liveScheduleRow.start || '',
                liveScheduleRow.end || ''
            );
            if (liveTargetShiftKey !== targetShiftKey) {
                throw scheduleConflict(
                    'Định danh ca nhận +10 phút vừa thay đổi. Hãy tải lại lịch trước khi chỉnh công.',
                    'schedule/bonus10-target-conflict'
                );
            }
            const liveCenterClosures = settingsSnapshot.exists
                ? (settingsSnapshot.data()?.centerClosures || {})
                : {};
            if (liveScheduleRow.isClosed === true ||
                _isTeachingScheduleSectionClosed(dateKey, scheduleSection, liveCenterClosures)) {
                throw scheduleConflict(
                    'Ca hoặc Môn/Lớp này đang được đánh dấu tắt/đóng. Hãy mở lại lịch trước khi ghi nhận có mặt.',
                    'schedule/shift-closed'
                );
            }
            const cancelledShiftKeys = cancelledSnapshot.exists &&
                Array.isArray(cancelledSnapshot.data()?.shifts)
                ? cancelledSnapshot.data().shifts.map(value => String(value || '').trim())
                : [];
            const isScheduleRowCancelled = (row, rowIndex) => {
                const legacyKey = `${compositeKey}_${scheduleSection}_${rowIndex}`;
                const persistedId = String(row?.shiftId || '').trim();
                return cancelledShiftKeys.includes(legacyKey) ||
                    (!!persistedId && cancelledShiftKeys.includes(`shift:${persistedId}`));
            };
            if (isScheduleRowCancelled(liveScheduleRow, scheduleRowIndex)) {
                throw scheduleConflict(
                    'Ca này đã bị hủy trong Bảng Công nên một phiên có mặt sẽ vẫn bị ẩn và không tính lương. Hãy khôi phục ca bị hủy trước rồi mở lại popup.',
                    'schedule/shift-cancelled'
                );
            }
            const liveRowSubjectId = String(liveScheduleRow.lopId || '').trim();
            if (liveRowSubjectId) {
                const rowSubjectIds = Array.from(new Set(window.Early10.splitSubjectIds(liveRowSubjectId)
                    .map(value => String(value || '').trim())
                    .filter(Boolean))).sort();
                const expectedSubjectIds = subjectIds.slice().sort();
                if (rowSubjectIds.length !== expectedSubjectIds.length ||
                    rowSubjectIds.some((id, index) => id !== expectedSubjectIds[index])) {
                    throw scheduleConflict(
                        'Mã Môn/Lớp của ca vừa thay đổi. Hãy tải lại lịch trước khi chỉnh công.',
                        'schedule/subject-conflict'
                    );
                }
            } else if (!liveSubjects.some(subject =>
                String(subject.name || '').trim() === requestedSubjectName
            )) {
                throw scheduleConflict(
                    'Tên Môn/Lớp của ca không còn ánh xạ duy nhất tới dữ liệu tính lương.',
                    'schedule/subject-conflict'
                );
            }

            const isCurrentMain = teacherShiftState.getMainTeachers(liveScheduleRow)
                .some(item => String(item?.id || '').trim() === staffId);
            const isCurrentSubstitute = teacherShiftState.getSubstituteTeachers(liveScheduleRow)
                .some(item => String(item?.id || '').trim() === staffId);
            if (isCurrentMain && teacherShiftState.isMainTeacherAbsent(liveScheduleRow, staffId)) {
                throw scheduleConflict(
                    'Giáo viên chính hiện đang ở trạng thái nghỉ trong ca này. Hãy khôi phục “Đang dạy” trước khi ghi công.',
                    'schedule/staff-absent'
                );
            }
            if (!isCurrentMain && !isCurrentSubstitute) {
                throw scheduleConflict(
                    'Nhân sự không còn được phân công trong ca này. Đã dừng để tránh ghi công/lương nhầm người.',
                    'schedule/staff-unassigned'
                );
            }

            // One physical teaching window may contain several schedule rows
            // assigned to the same person. Resolve that complete live set for
            // every save path (new, legacy and already-linked), excluding rows
            // that were explicitly cancelled for this employee.
            const activeScheduleRows = scheduleRows.filter((row, rowIndex) =>
                !isScheduleRowCancelled(row, rowIndex)
            );
            const concurrentTeaching = _resolveConcurrentTeachingSubjectSet(
                activeScheduleRows,
                staffId,
                scheduledStart,
                scheduledEnd,
                subjects,
                teacherShiftState
            );
            if (!concurrentTeaching.rows.includes(liveScheduleRow) || !concurrentTeaching.ids.length) {
                throw scheduleConflict(
                    'Không thể xác định đầy đủ các Môn/Lớp trùng giờ của nhân sự này. Hãy tải lại lịch.',
                    'schedule/subject-conflict'
                );
            }
            const concurrentSubjectIds = concurrentTeaching.ids.slice().sort();
            const concurrentSubjectRefs = concurrentSubjectIds.map(id => db.collection('subjects').doc(id));
            const concurrentSubjectSnapshots = await Promise.all(
                concurrentSubjectRefs.map(ref => transaction.get(ref))
            );
            if (concurrentSubjectSnapshots.some(snapshot => !snapshot.exists)) {
                throw scheduleConflict(
                    'Một Môn/Lớp trong ca trùng giờ vừa bị xóa. Hãy tải lại lịch trước khi sửa công.',
                    'schedule/subject-conflict'
                );
            }
            const concurrentSnapshotsById = new Map(
                concurrentSubjectSnapshots.map(snapshot => [String(snapshot.id), snapshot])
            );
            const renamedFallback = concurrentTeaching.resolvedByName.find(item =>
                String(concurrentSnapshotsById.get(item.id)?.data()?.name || '').trim() !== item.name
            );
            if (renamedFallback) {
                throw scheduleConflict(
                    `Môn/Lớp “${renamedFallback.name}” của ca trùng giờ vừa đổi tên hoặc đổi mã. Hãy tải lại lịch.`,
                    'schedule/subject-conflict'
                );
            }
            const effectiveSubjects = concurrentSubjectSnapshots.map(snapshot => ({
                id: snapshot.id,
                ...(snapshot.data() || {})
            }));
            const effectiveSubjectId = concurrentSubjectIds.join('+');
            const effectiveSubjectName = concurrentSubjectIds.map(id =>
                String(concurrentSnapshotsById.get(id)?.data()?.name || id).trim()
            ).join(' + ');
            const isConcurrentTeachingSession = concurrentTeaching.rows.length > 1;
            const concurrentShiftIds = concurrentTeaching.rows
                .map(row => String(row?.shiftId || '').trim())
                .filter(Boolean);
            const sharedConcurrentShiftId = concurrentShiftIds.length === concurrentTeaching.rows.length &&
                new Set(concurrentShiftIds).size === 1
                ? concurrentShiftIds[0]
                : '';

            const monthlySettings = monthlySnapshot.exists ? (monthlySnapshot.data() || {}) : {};
            const payrollLock = DBService.getPayslipDraftLockState(monthlySettings.published || {}, 'gv');
            if (payrollLock.locked) {
                const error = new Error('Phiếu lương giảng dạy tháng này đã phát hành/đã nhận nên nguồn chấm công đang khóa. Hãy mở lại kỳ lương theo quy trình trước khi sửa.');
                error.code = 'payslip/locked';
                throw error;
            }
            const attendance = attendanceSnapshot.exists ? (attendanceSnapshot.data() || {}) : {
                userId: staffId,
                name: liveProfile.name || liveProfile.username || command.staffName || 'N/A',
                date: dateKey,
                sessions: []
            };
            if (String(attendance.userId || staffId) !== staffId || String(attendance.date || dateKey) !== dateKey) {
                throw new Error('Tài liệu chấm công không khớp nhân sự/ngày; đã dừng để tránh sửa nhầm dữ liệu.');
            }
            const sessions = Array.isArray(attendance.sessions)
                ? attendance.sessions.map(session => ({ ...session }))
                : [];
            let sessionIndex = expectedSessionId
                ? sessions.findIndex(session => String(session?.id || '') === expectedSessionId)
                : -1;
            if (expectedSessionId && sessionIndex < 0) {
                const error = new Error('Phiên chấm công vừa bị thay đổi hoặc xóa ở nơi khác. Hãy tải lại popup.');
                error.code = 'attendance/conflict';
                throw error;
            }

            let session = sessionIndex >= 0 ? sessions[sessionIndex] : null;
            if (session) {
                const actualFingerprint = helper.fingerprintSession(session);
                if (!command.expectedFingerprint || actualFingerprint !== command.expectedFingerprint) {
                    const error = new Error('Giờ công vừa được người khác cập nhật. Hãy tải lại trước khi lưu để không ghi đè.');
                    error.code = 'attendance/conflict';
                    throw error;
                }
            }
            const sessionBeforeCorrection = session ? { ...session } : null;
            let shouldCanonicalizeTeachingRole = false;
            let preservesConcurrentTeachingRoleSet = false;
            let shouldDropRowOnlyScheduleLink = false;
            if (session) {
                const normalizedText = value => String(value || '')
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .trim()
                    .toLowerCase()
                    .replace(/[_-]+/g, ' ')
                    .replace(/\s+/g, ' ');
                const operationalRoleIds = new Set([
                    'tiep tan', 'receptionist', 'receptionist assistant',
                    'receptionist lead', 'receptionist staff', 'office staff',
                    'van phong', 'office'
                ]);
                const normalizedRole = normalizedText(session.role);
                const normalizedRoleName = normalizedText(session.roleName);
                const hasOperationalRole = operationalRoleIds.has(normalizedRole) ||
                    normalizedRoleName.includes('tiep tan') ||
                    normalizedRoleName.includes('reception') ||
                    normalizedRoleName.includes('van phong') ||
                    normalizedRoleName === 'office';
                if (session.linkedReceptionistShift || session.linkedOfficeShift || hasOperationalRole) {
                    const error = new Error('Phiên này thuộc nguồn Tiếp tân/Văn phòng, không thể sửa từ popup ca dạy. Hãy xử lý tại đúng Bảng Công tương ứng.');
                    error.code = 'attendance/session-operational-conflict';
                    throw error;
                }

                const normalizeClock = value => {
                    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
                    if (!match) return '';
                    const hour = Number(match[1]);
                    const minute = Number(match[2]);
                    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
                    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                };
                const sameScheduleComposite = (left, right) => {
                    const a = String(left || '').trim();
                    const b = String(right || '').trim();
                    if (!a || !b) return true;
                    if (a === b) return true;
                    const parsedA = DBService._parseBranchKey(a);
                    const parsedB = DBService._parseBranchKey(b);
                    return parsedA.branch === parsedB.branch && parsedA.dateKey === parsedB.dateKey;
                };
                const liveShiftId = String(liveScheduleRow.shiftId || '').trim();
                const linkedShiftId = String(session.linkedScheduleShiftId || '').trim();
                const linkedComposite = String(session.linkedScheduleCompositeKey || '').trim();
                const linkedSection = String(session.linkedScheduleSection || '').trim();
                const linkedClassStart = String(session.linkedClassStart || '').trim();
                const sameExplicitShiftId = !!liveShiftId && !!linkedShiftId && liveShiftId === linkedShiftId;

                const linksOneConcurrentRow = isConcurrentTeachingSession &&
                    concurrentTeaching.rows.some(row => String(row?.shiftId || '').trim() === linkedShiftId);
                if (linkedShiftId && liveShiftId && linkedShiftId !== liveShiftId && !linksOneConcurrentRow) {
                    const error = new Error('Phiên chấm công đang liên kết một mã ca dạy khác. Hãy xử lý liên kết trong Bảng Công trước.');
                    error.code = 'attendance/session-link-conflict';
                    throw error;
                }
                if (linkedComposite && !sameScheduleComposite(linkedComposite, compositeKey)) {
                    const error = new Error('Phiên chấm công đang liên kết lịch của ngày/cơ sở khác. Đã dừng để tránh chuyển nhầm nguồn lương.');
                    error.code = 'attendance/session-link-conflict';
                    throw error;
                }
                if (linkedSection && linkedSection !== scheduleSection) {
                    const error = new Error('Phiên chấm công đang liên kết một khu vực ca khác trong lịch. Hãy xử lý trong Bảng Công trước.');
                    error.code = 'attendance/session-link-conflict';
                    throw error;
                }
                if (linkedClassStart && normalizeClock(linkedClassStart) !== normalizeClock(scheduledStart) &&
                    !sameExplicitShiftId) {
                    const error = new Error('Phiên chấm công đang neo vào giờ bắt đầu của lớp khác. Đã dừng để tránh tính lương nhầm ca.');
                    error.code = 'attendance/session-link-conflict';
                    throw error;
                }
                if (linkedShiftId && !liveShiftId) {
                    const provesSameLegacyRow = !!linkedComposite && !!linkedSection && !!linkedClassStart &&
                        sameScheduleComposite(linkedComposite, compositeKey) &&
                        linkedSection === scheduleSection &&
                        normalizeClock(linkedClassStart) === normalizeClock(scheduledStart);
                    if (!provesSameLegacyRow) {
                        const error = new Error('Không thể xác minh mã liên kết cũ của phiên với ca dạy đời cũ. Hãy liên kết lại trong Bảng Công.');
                        error.code = 'attendance/session-link-conflict';
                        throw error;
                    }
                }

                const genericTeachingRoles = new Set([
                    'giao vien', 'teacher', 'teaching assistant', 'assistant', 'staff'
                ]);
                const manualRoleSources = new Set(['manual', 'admin manual', 'manual override']);
                const roleIds = Array.from(new Set(window.Early10.splitSubjectIds(session.role)
                    .map(value => String(value || '').trim())
                    .filter(Boolean))).sort();
                const expectedRoleIds = subjectIds.slice().sort();
                const roleMatchesCurrentSubject = roleIds.length === expectedRoleIds.length &&
                    roleIds.every((id, index) => id === expectedRoleIds[index]);
                const roleMatchesCompleteConcurrentSet = _sameScheduleSubjectIdSet(
                    roleIds,
                    concurrentSubjectIds
                );
                const roleSource = normalizedText(session.roleAssignmentSource);
                const numericRoleRate = Number(session.roleRate);
                const hasFrozenRoleRate = Number.isFinite(numericRoleRate) && numericRoleRate > 0;
                const hasProtectedManualRole = hasFrozenRoleRate ||
                    manualRoleSources.has(roleSource) || session.subjectOverride === true;
                const canUpgradeGenericLegacyRole = !hasProtectedManualRole &&
                    (genericTeachingRoles.has(normalizedRole) || !roleIds.length || roleMatchesCurrentSubject);

                if (roleMatchesCompleteConcurrentSet) {
                    preservesConcurrentTeachingRoleSet = isConcurrentTeachingSession;
                } else if (canUpgradeGenericLegacyRole) {
                    // Missing/generic roles and a safe legacy one-row role may be
                    // promoted to the complete concurrent set. Arbitrary subsets,
                    // supersets and manual/frozen overrides are never guessed.
                    shouldCanonicalizeTeachingRole = true;
                } else {
                    const error = new Error(hasProtectedManualRole
                        ? 'Phiên đang có đơn giá hoặc Môn/Lớp ghi đè thủ công. Hãy xác nhận lại trong Bảng Công trước.'
                        : 'Phiên chấm công đang mang bộ Môn/Lớp khác với toàn bộ ca trùng giờ. Hãy sửa liên kết/môn trong Bảng Công để tránh sai Role? hoặc đơn giá.');
                    error.code = 'attendance/session-role-conflict';
                    throw error;
                }

                if (isConcurrentTeachingSession && linkedShiftId &&
                    linkedShiftId !== sharedConcurrentShiftId) {
                    if (hasProtectedManualRole || !linksOneConcurrentRow) {
                        const error = new Error('Phiên trùng giờ đang liên kết riêng một dòng lịch không thể chuẩn hóa an toàn. Hãy xử lý liên kết trong Bảng Công.');
                        error.code = 'attendance/session-link-conflict';
                        throw error;
                    }
                    shouldDropRowOnlyScheduleLink = true;
                }
            }

            const keepsExistingBonus10 = !bonus10Dirty && liveActiveRequests.length > 0;
            const requiresBonus10Policy = wantsBonus10 || keepsExistingBonus10;
            if (requiresBonus10Policy && window.Early10.isMonthlyBonusPenaltyActive(
                monthlySettings,
                [
                    ...liveMonthlyRequests.map(request => ({ bonus10Status: request.status })),
                    ...sessions.map(candidate => ({ studentCountStatus: candidate?.studentCountStatus }))
                ]
            )) {
                throw new Error('Phụ cấp +10 phút của tháng này đang bị khóa. Hãy chủ động tắt/hủy +10 trước khi sửa phiên công.');
            }
            if (requiresBonus10Policy) {
                const livePolicyVerdict = window.Early10.evaluateEarly10Request({
                    sessionRole: subjectId,
                    subjectIds,
                    subjects: liveSubjects,
                    user: liveProfile,
                    checkIn: validation.checkInISO,
                    classStart: scheduledStart
                });
                if (!livePolicyVerdict?.ok) {
                    const error = new Error(
                        (livePolicyVerdict?.message || 'Ca này không còn đủ điều kiện +10 phút.') +
                        (!bonus10Dirty ? ' Hãy chủ động tắt/hủy +10 rồi lưu lại.' : '')
                    );
                    error.code = 'attendance/bonus10-policy-conflict';
                    throw error;
                }
                policyVerdict = livePolicyVerdict;
                awardedSubjectId = String(
                    liveSubjects.find(subject => subject.allowEarly10 === true)?.id || ''
                );
            }

            const proposedStart = new Date(validation.checkInISO).getTime();
            const proposedEnd = new Date(validation.checkOutISO || shiftWindow.end.toISOString()).getTime();
            const clash = sessions.find((candidate, index) => {
                if (index === sessionIndex || !candidate || candidate.isAbsent) return false;
                const candidateStart = new Date(candidate.checkIn || candidate.start || '').getTime();
                const candidateEndValue = candidate.checkOut || candidate.end || null;
                // An open session is not a zero-length point. Treat it as live
                // for at most 24h so an Admin cannot create a second overlapping
                // open session that checkout/auto-close would resolve ambiguously.
                const candidateEnd = candidateEndValue
                    ? new Date(candidateEndValue).getTime()
                    : candidateStart + 24 * 60 * 60 * 1000;
                if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd)) return false;
                return Math.min(proposedEnd, candidateEnd) - Math.max(proposedStart, candidateStart) >= 10 * 60 * 1000;
            });
            if (clash) {
                const error = new Error('Khung giờ này trùng từ 10 phút với một phiên công khác. Đã dừng để bảng lương không tính đôi.');
                error.code = 'SESSION_OVERLAP';
                throw error;
            }

            const before = sessionBeforeCorrection ? {
                checkIn: sessionBeforeCorrection.checkIn || sessionBeforeCorrection.start || null,
                checkOut: sessionBeforeCorrection.checkOut || null,
                role: sessionBeforeCorrection.role || null,
                roleAssignmentSource: sessionBeforeCorrection.roleAssignmentSource || null,
                linkedClassStart: sessionBeforeCorrection.linkedClassStart || null,
                linkedScheduleShiftId: sessionBeforeCorrection.linkedScheduleShiftId || null,
                linkedScheduleCompositeKey: sessionBeforeCorrection.linkedScheduleCompositeKey || null,
                linkedScheduleSection: sessionBeforeCorrection.linkedScheduleSection || null,
                linkedReceptionistShift: sessionBeforeCorrection.linkedReceptionistShift || null,
                linkedOfficeShift: sessionBeforeCorrection.linkedOfficeShift || null,
                isAbsent: !!sessionBeforeCorrection.isAbsent,
                bonus10: !!sessionBeforeCorrection.bonus10,
                studentCount: sessionBeforeCorrection.studentCount ?? null,
                studentCountStatus: sessionBeforeCorrection.studentCountStatus || null
            } : null;

            if (!session) {
                session = {
                    id: targetSessionId,
                    anchorDateKey: dateKey,
                    source: 'admin',
                    type: 'admin_schedule_correction',
                    role: effectiveSubjectId,
                    roleName: effectiveSubjectName,
                    roleAssignmentSource: 'schedule_admin_panel',
                    linkedClassStart: scheduledStart,
                    linkedScheduleCompositeKey: compositeKey,
                    linkedScheduleSection: scheduleSection
                };
                if (sharedConcurrentShiftId) {
                    session.linkedScheduleShiftId = sharedConcurrentShiftId;
                }
                sessions.push(session);
                sessionIndex = sessions.length - 1;
            } else {
                if (shouldCanonicalizeTeachingRole) {
                    session.role = effectiveSubjectId;
                    session.roleName = effectiveSubjectName;
                    session.roleAssignmentSource = 'schedule_admin_panel';
                    session.subjectOverride = false;
                }
                // An explicit, transaction-validated schedule correction is a
                // safe point to materialize missing teaching links. Existing
                // operational/other-schedule links were rejected above.
                session.linkedClassStart = scheduledStart;
                if (shouldDropRowOnlyScheduleLink) {
                    delete session.linkedScheduleShiftId;
                }
                if (sharedConcurrentShiftId) {
                    session.linkedScheduleShiftId = sharedConcurrentShiftId;
                } else if (!isConcurrentTeachingSession && liveScheduleRow.shiftId &&
                    !preservesConcurrentTeachingRoleSet) {
                    session.linkedScheduleShiftId = String(liveScheduleRow.shiftId);
                }
                session.linkedScheduleCompositeKey = compositeKey;
                session.linkedScheduleSection = scheduleSection;
            }

            session.start = validation.checkInISO;
            session.checkIn = validation.checkInISO;
            session.checkOut = validation.checkOutISO || null;
            session.status = validation.checkOutISO ? 'closed' : 'open';
            delete session.isAbsent;
            // Historical session-level flags are deliberately removed. +10 is
            // represented only by the approved request for this exact shift.
            delete session.bonus10;
            session.isAdminEdited = true;
            session.adminCorrectionAt = nowISO;
            session.adminCorrectionBy = actorUserId;
            delete session.autoClosedReason;

            _applyAdminStudentCountMutation(
                session,
                studentCountDirty,
                validation.studentCount,
                nowISO,
                actorUserId
            );

            const after = {
                checkIn: session.checkIn,
                checkOut: session.checkOut,
                role: session.role || null,
                roleAssignmentSource: session.roleAssignmentSource || null,
                linkedClassStart: session.linkedClassStart || null,
                linkedScheduleShiftId: session.linkedScheduleShiftId || null,
                linkedScheduleCompositeKey: session.linkedScheduleCompositeKey || null,
                linkedScheduleSection: session.linkedScheduleSection || null,
                linkedReceptionistShift: session.linkedReceptionistShift || null,
                linkedOfficeShift: session.linkedOfficeShift || null,
                isAbsent: false,
                bonus10: !!session.bonus10,
                studentCount: session.studentCount ?? null,
                studentCountStatus: session.studentCountStatus || null
            };
            const history = Array.isArray(session.editHistory) ? session.editHistory.slice(-19) : [];
            history.push({
                at: nowISO,
                action: 'admin_schedule_correction',
                source: 'schedule_attendance_popup',
                editor: { uid: authorization.uid, userId: actorUserId },
                before,
                after
            });
            session.editHistory = history;
            sessions[sessionIndex] = session;

            attendance.userId = staffId;
            attendance.name = attendance.name || liveProfile.name || liveProfile.username || command.staffName || 'N/A';
            attendance.date = dateKey;
            attendance.sessions = sessions;
            // Keep the legacy top-level mirror aligned with the chronologically
            // latest valid session. The Admin can move an older session later in
            // the day, so array position alone is not a safe definition of latest.
            const latestTimedSession = sessions.reduce((latest, candidate, index) => {
                const timestamp = new Date(candidate?.checkIn || candidate?.start || '').getTime();
                if (!Number.isFinite(timestamp)) return latest;
                if (!latest || timestamp > latest.timestamp ||
                    (timestamp === latest.timestamp && index > latest.index)) {
                    return { candidate, timestamp, index };
                }
                return latest;
            }, null);
            if (latestTimedSession) {
                attendance.checkIn = latestTimedSession.candidate.checkIn || latestTimedSession.candidate.start;
                attendance.checkOut = latestTimedSession.candidate.checkOut || null;
            }
            attendance.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
            attendance.lastScheduleAdminEdit = {
                authUid: authorization.uid,
                actorUserId,
                sessionId: targetSessionId,
                at: firebase.firestore.FieldValue.serverTimestamp()
            };
            transaction.set(attendanceRef, attendance);

            if (wantsBonus10) {
                const existingRequest = bonusRequestSnapshot?.exists ? (bonusRequestSnapshot.data() || {}) : {};
                const assignmentLists = [
                    'gvList', 'gvThayTeList', 'gvThayTheList', 'registeredTeachers'
                ];
                let scheduleAssignmentList = '';
                let scheduleAssignmentEntry = {};
                for (const field of assignmentLists) {
                    const entry = (Array.isArray(liveScheduleRow[field]) ? liveScheduleRow[field] : [])
                        .find(item => String(item?.id || '') === staffId);
                    if (!entry) continue;
                    scheduleAssignmentList = field;
                    scheduleAssignmentEntry = { ...entry };
                    break;
                }
                if (!awardedSubjectId) {
                    throw new Error('Không xác định được Môn/Lớp được phép nhận +10 phút cho đúng ca này.');
                }
                transaction.set(bonusRequestRef, {
                    staffId,
                    staffName: liveProfile.name || liveProfile.username || command.staffName || 'N/A',
                    dateKey,
                    sessionId: targetSessionId,
                    status: 'approved',
                    awardScope: 'teaching_shift',
                    targetShiftKey,
                    subjectId: awardedSubjectId,
                    scheduleDocId: compositeKey,
                    scheduleSection,
                    scheduleIndex: scheduleRowIndex,
                    scheduleShiftId: String(liveScheduleRow.shiftId || ''),
                    scheduleRegistrationId: '',
                    scheduleAssignmentList,
                    scheduleAssignmentEntry,
                    classStart: scheduledStart,
                    classEnd: scheduledEnd,
                    attendanceSessionIndex: sessionIndex,
                    earlyMinutes: policyVerdict?.earlyMinutes ?? null,
                    checkInAt: validation.checkInISO,
                    scheduledStart,
                    requestSource: 'admin_schedule_correction',
                    authUid: authorization.uid,
                    schemaVersion: 2,
                    policyVersion: 'early10-shift-v2',
                    createdAt: existingRequest.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
                    approvedBy: actorUserId,
                    approvedByName: authorization.roleData?.name || authorization.roleData?.username || 'Admin',
                    approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else if (bonus10Dirty && bonusRequestSnapshot?.exists && liveActiveRequests.length) {
                transaction.set(bonusRequestRef, {
                    status: 'cancelled',
                    cancelledBy: actorUserId,
                    cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
                    cancelSource: 'schedule_attendance_popup'
                }, { merge: true });
            }

            // This immutable companion write is the server-enforced boundary:
            // Firestore Rules allow it only for the literal `admin` role (not
            // senior_assistant/assistant), so the whole transaction fails for
            // every non-Admin even if they invoke this method from DevTools.
            transaction.set(auditRef, {
                authUid: authorization.uid,
                actorUserId,
                staffId,
                dateKey,
                sessionId: targetSessionId,
                action: 'save_correction',
                source: 'schedule_attendance_popup',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            savedSession = { ...session };
        });

        DBService._invalidateAttendance(dateKey, staffId);
        DBService._invalidate('bonus10_requests_');
        DBService._invalidate(`monthly_attendance_${monthStr}_${staffId}`);
        return { session: savedSession, policyVerdict, auditId };
    },

    updateSessionRole: async (userId, dateKey, sessionId, roleData) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) throw new Error("Attendance record not found");

                const data = doc.data();
                if (!data.sessions) throw new Error("No sessions found");

                const index = data.sessions.findIndex(s => String(s.id) === String(sessionId));
                if (index === -1) throw new Error("Session not found");

                // Update Role
                const session = data.sessions[index];
                session.role = roleData.id || '';
                session.roleName = roleData.name || '';
                // This API is reached from a deliberate role choice. Keep a
                // source marker so evaluation never mistakes a historical
                // auto-inferred role for an approved outside-schedule shift.
                session.roleAssignmentSource = 'manual';
                if (roleData.rate !== undefined && roleData.rate !== null) {
                    session.roleRate = roleData.rate;
                } else if (session.roleRate !== undefined) {
                    delete session.roleRate;
                }

                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                t.set(ref, data);
            });
            DBService._invalidateAttendance(dateKey, userId);
        } catch (error) {
            console.error("Error in updateSessionRole:", error);
            throw error;
        }
    },

    updateSessionStudentCount: async (userId, dateKey, sessionId, studentCount, status, updaterId, role) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        const clearing = studentCount === null || studentCount === undefined || studentCount === '' || Number(studentCount) <= 0;
        const normalizedCount = clearing ? null : Number(studentCount);
        if (!clearing && (!Number.isInteger(normalizedCount) || normalizedCount < 1 || normalizedCount > 500)) {
            throw new Error('Sĩ số phải là số nguyên từ 1 đến 500.');
        }
        if (status != null && !['pending', 'approved', 'rejected'].includes(status)) {
            throw new Error('Trạng thái sĩ số không hợp lệ.');
        }

        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) throw new Error("Attendance record not found");

                const data = doc.data();
                if (!data.sessions) throw new Error("No sessions found");

                const index = data.sessions.findIndex(s => String(s.id) === String(sessionId));
                if (index === -1) throw new Error("Session not found");

                const session = data.sessions[index];
                const isAdmin = ['admin', 'senior_assistant'].includes(role);

                // Enforce editing permissions
                if (!isAdmin) {
                    // Teacher permissions: can only edit if status is empty, or pending
                    const currentStatus = session.studentCountStatus;
                    if (currentStatus && currentStatus !== 'pending') {
                        throw new Error("Không thể chỉnh sửa ca đã được duyệt hoặc từ chối.");
                    }
                    if (clearing) {
                        delete session.studentCount;
                        delete session.studentCountStatus;
                        delete session.studentCountUpdatedAt;
                        delete session.studentCountUpdatedBy;
                    } else {
                        session.studentCount = normalizedCount;
                        session.studentCountStatus = 'pending';
                        session.studentCountUpdatedAt = new Date().toISOString();
                        session.studentCountUpdatedBy = updaterId || userId;
                    }
                } else {
                    // Admin permissions: can set to approved or rejected or clear
                    if (clearing) {
                        delete session.studentCount;
                        delete session.studentCountStatus;
                        delete session.studentCountUpdatedAt;
                        delete session.studentCountUpdatedBy;
                        delete session.studentCountReviewedAt;
                        delete session.studentCountReviewedBy;
                    } else {
                        session.studentCount = normalizedCount;
                        session.studentCountStatus = status || 'pending';
                        if (status === 'approved' || status === 'rejected') {
                            session.studentCountReviewedAt = new Date().toISOString();
                            session.studentCountReviewedBy = updaterId;
                        } else {
                            delete session.studentCountReviewedAt;
                            delete session.studentCountReviewedBy;
                        }
                    }
                }

                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                t.set(ref, data);
            });
            DBService._invalidateAttendance(dateKey, userId);
            return true;
        } catch (error) {
            console.error("Error in updateSessionStudentCount:", error);
            throw error;
        }
    },

    saveMonthlyStudentCountPenalty: async (staffId, monthStr, hasPenalty, adminId, reason = '') => {
        if (!staffId || !monthStr) {
            throw new Error('[MonthlySalarySettings] staffId and monthStr are required.');
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            const payload = {
                studentCountBonusPenalty: !!hasPenalty,
                studentCountBonusPenaltyAt: hasPenalty ? new Date().toISOString() : null,
                studentCountBonusPenaltyBy: hasPenalty ? adminId : null,
                studentCountBonusPenaltyReason: hasPenalty ? reason : null
            };
            await db.collection('salary_settings_monthly').doc(docId).set(payload, { merge: true });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return true;
        } catch (e) {
            console.error('[saveMonthlyStudentCountPenalty] Error saving penalty:', e);
            throw e;
        }
    },


    // Retained only so an old cached UI fails explicitly instead of silently
    // recreating the unsafe session-wide award. New callers must create/cancel a
    // shift-scoped bonus10_requests document.
    setSessionBonus10: async () => {
        const error = new Error('Cách cộng +10 theo cả phiên đã ngừng hỗ trợ. Hãy tải lại trang và chọn đúng chip ca dạy.');
        error.code = 'bonus10/legacy-session-writer-disabled';
        throw error;
    },

    toggleSessionBonus10: async () => {
        const error = new Error('Cách bật/tắt +10 theo cả phiên đã ngừng hỗ trợ. Hãy tải lại trang và chọn đúng chip ca dạy.');
        error.code = 'bonus10/legacy-session-writer-disabled';
        throw error;
    },

    // 7.2 Generic Add Session (Admin)
    // options.allowOverlap = true → cố tình thêm dù trùng giờ (người duyệt đã xác nhận).
    // Mặc định CHẶN: nhân viên chỉ bấm vào ca một lần, nên hai ca cùng khung giờ luôn là
    // do thêm tay/duyệt chấm bù hai lần cho hai lớp dạy cùng giờ → bảng công tính lương
    // đôi. Chặn ngay từ lúc ghi rẻ hơn nhiều so với đi dò lại bảng lương cuối tháng.
    addSession: async (userId, dateKey, sessionData, options = {}) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);
        const makeupApproval = options.makeupApproval && typeof options.makeupApproval === 'object'
            ? options.makeupApproval
            : null;
        const approvalRequestId = String(makeupApproval?.requestId || '').trim();
        const approvalRef = approvalRequestId
            ? db.collection('makeup_requests').doc(approvalRequestId)
            : null;
        const overtimeMinutes = Math.max(0, Number(makeupApproval?.overtimeMinutes) || 0);
        const overtimeRef = approvalRef && overtimeMinutes > 0
            ? db.collection('overtime_requests').doc(`makeup_${approvalRequestId.replace(/[^a-zA-Z0-9_-]/g, '_')}`)
            : null;
        if (approvalRef && String(sessionData?.makeupRequestId || '') !== approvalRequestId) {
            const error = new Error('Mã yêu cầu chấm bù không khớp phiên công cần ghi.');
            error.code = 'MAKEUP_REQUEST_STALE';
            throw error;
        }

        // Fetch user name if not exists (for display)
        let userName = 'N/A';
        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) userName = userDoc.data().name || userDoc.data().username;
        } catch (e) { }

        let newSessionId = null;
        try {
            await db.runTransaction(async (t) => {
                // For make-up approval, attendance + request status + overtime are
                // materialized atomically. This closes the old partial-write gap in
                // which a session could exist while the request remained pending.
                const [doc, approvalSnapshot] = await Promise.all([
                    t.get(ref),
                    approvalRef ? t.get(approvalRef) : Promise.resolve(null)
                ]);
                let data = doc.exists ? doc.data() : {
                    userId,
                    name: userName,
                    date: dateKey,
                    sessions: []
                };

                if (!data.sessions) data.sessions = [];

                let approvalData = null;
                if (approvalRef) {
                    if (!approvalSnapshot?.exists) {
                        const error = new Error('Yêu cầu chấm bù không còn tồn tại.');
                        error.code = 'MAKEUP_REQUEST_NOT_FOUND';
                        throw error;
                    }
                    approvalData = approvalSnapshot.data() || {};
                    if (String(approvalData.staffId || '') !== String(userId) ||
                        String(approvalData.dateKey || '') !== String(dateKey)) {
                        const error = new Error('Yêu cầu đã thay đổi nhân sự hoặc ngày. Hãy tải lại trước khi duyệt.');
                        error.code = 'MAKEUP_REQUEST_STALE';
                        throw error;
                    }
                    if (!['pending', 'approved'].includes(String(approvalData.status || ''))) {
                        const error = new Error('Yêu cầu không còn ở trạng thái chờ duyệt.');
                        error.code = 'MAKEUP_REQUEST_STALE';
                        throw error;
                    }
                }

                const existingMakeupSession = sessionData?.makeupRequestId
                    ? data.sessions.find(item =>
                        String(item?.makeupRequestId || '') === String(sessionData.makeupRequestId)
                    )
                    : null;
                if (existingMakeupSession) {
                    newSessionId = String(existingMakeupSession.id || '');
                    if (!newSessionId) {
                        const error = new Error('Phiên chấm bù cũ thiếu mã phiên. Cần kiểm tra dữ liệu trước khi duyệt lại.');
                        error.code = 'MAKEUP_APPROVAL_INCONSISTENT';
                        throw error;
                    }
                    if (approvalRef) {
                        const recordedSessionId = String(approvalData.materializedSessionId || '').trim();
                        if (approvalData.status === 'approved' && recordedSessionId && recordedSessionId !== newSessionId) {
                            const error = new Error('Yêu cầu đã trỏ tới một phiên công khác. Cần kiểm tra dữ liệu trước khi duyệt lại.');
                            error.code = 'MAKEUP_APPROVAL_INCONSISTENT';
                            throw error;
                        }
                        if (approvalData.status === 'pending') {
                            t.update(approvalRef, {
                                status: 'approved',
                                reviewedBy: makeupApproval.reviewedBy || 'Admin',
                                reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
                                materializedSessionId: newSessionId
                            });
                        }
                        if (overtimeRef) {
                            const hours = Math.floor(overtimeMinutes / 60);
                            const minutes = overtimeMinutes % 60;
                            t.set(overtimeRef, {
                                staffId: userId,
                                staffName: makeupApproval.staffName || 'N/A',
                                dateKey,
                                sessionId: newSessionId,
                                makeupRequestId: approvalRequestId,
                                duration: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
                                minutes: overtimeMinutes,
                                status: 'approved',
                                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                approvedBy: makeupApproval.reviewedBy || 'Admin',
                                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                            }, { merge: true });
                        }
                    }
                    return;
                }
                if (approvalData?.status === 'approved') {
                    const error = new Error('Yêu cầu đã duyệt nhưng không tìm thấy phiên công tương ứng. Cần kiểm tra dữ liệu.');
                    error.code = 'MAKEUP_APPROVAL_INCONSISTENT';
                    throw error;
                }

                // Helper to get Start Time from ISO or legacy
                const newStart = sessionData.checkIn || sessionData.start || new Date().toISOString();

                // === CHẶN CA TRÙNG GIỜ ===
                if (!options.allowOverlap && !sessionData.isAbsent && sessionData.checkOut) {
                    const a1 = new Date(newStart).getTime();
                    const a2 = new Date(sessionData.checkOut).getTime();
                    const clash = data.sessions.find(x => {
                        if (!x || x.isAbsent || !(x.checkIn || x.start)) return false;
                        const b1 = new Date(x.checkIn || x.start).getTime();
                        const b2 = x.checkOut ? new Date(x.checkOut).getTime() : b1;
                        // Chồng nhau từ 10 phút trở lên mới coi là trùng (tránh bắt lỗi ca
                        // nối tiếp lệch một hai phút).
                        return Math.min(a2, b2) - Math.max(a1, b1) >= 10 * 60 * 1000;
                    });
                    if (clash) {
                        const fmt = (iso) => iso
                            ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                            : '??:??';
                        const err = new Error(
                            `Ngày ${dateKey} đã có ca ${fmt(clash.checkIn || clash.start)}–${fmt(clash.checkOut)} ` +
                            `trùng khung giờ này. Thêm nữa là bảng công tính lương hai lần cho cùng một giờ làm.`
                        );
                        err.code = 'SESSION_OVERLAP';
                        err.clash = clash;
                        throw err;
                    }
                }

                const newSession = {
                    ...sessionData,
                    id: createAttendanceSessionId(),
                    anchorDateKey: dateKey,
                    status: sessionData.checkOut ? 'closed' : 'open',
                    source: sessionData.type || 'admin',
                    start: newStart,
                    checkIn: sessionData.checkIn,
                    checkOut: sessionData.checkOut || null,
                    type: sessionData.type || 'admin_add'
                };

                data.sessions.push(newSession);

                // Sync top level (last session wins)
                data.checkIn = newSession.checkIn;
                data.checkOut = newSession.checkOut;
                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

                t.set(ref, data);
                newSessionId = newSession.id;
                if (approvalRef) {
                    t.update(approvalRef, {
                        status: 'approved',
                        reviewedBy: makeupApproval.reviewedBy || 'Admin',
                        reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        materializedSessionId: String(newSessionId)
                    });
                    if (overtimeRef) {
                        const hours = Math.floor(overtimeMinutes / 60);
                        const minutes = overtimeMinutes % 60;
                        t.set(overtimeRef, {
                            staffId: userId,
                            staffName: makeupApproval.staffName || 'N/A',
                            dateKey,
                            sessionId: String(newSessionId),
                            makeupRequestId: approvalRequestId,
                            duration: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
                            minutes: overtimeMinutes,
                            status: 'approved',
                            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                            approvedBy: makeupApproval.reviewedBy || 'Admin',
                            approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    }
                }
            });
            DBService._invalidateAttendance(dateKey, userId);
            return newSessionId;
        } catch (error) {
            console.error("Error in addSession:", error);
            throw error;
        }
    },

    getDashboardStats: async () => {
        try {
            // Count Users (Optimized with cache)
            const users = await DBService.getUsers();
            const totalUsers = users.length;

            // Count Active Attendance Today (Local Time Logic)
            const now = new Date();
            const localDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
            const todayKey = localDate.toISOString().split('T')[0];

            const logsSnap = await db.collection('attendance_logs').where('date', '==', todayKey).get();

            let checkedInCount = 0;
            let recentActivity = [];

            if (!logsSnap.empty) {
                checkedInCount = logsSnap.size;

                for (const doc of logsSnap.docs) {
                    const data = doc.data();
                    const sessions = data.sessions || [];

                    for (const s of sessions) {
                        const checkInTime = s.checkIn || s.start;
                        if (checkInTime) {
                            // Determine status
                            let status = 'Đúng giờ';
                            const checkInDate = new Date(checkInTime);
                            if (s.checkOut) {
                                status = 'Hoàn thành';
                            } else {
                                const scheduledEnd = await DBService._getDashboardSessionScheduledEnd(data.userId, todayKey, checkInDate);
                                status = scheduledEnd && now >= scheduledEnd ? 'Hết ca theo lịch' : 'Đang làm việc';
                            }

                            recentActivity.push({
                                user: data.name || 'N/A',
                                userId: data.userId || '',
                                time: checkInTime,
                                type: 'in',
                                status: status
                            });
                        }
                    }
                }

                // Sort & Slice — dedup by userId keeping latest entry per employee
                recentActivity.sort((a, b) => new Date(b.time) - new Date(a.time));
                const seenUsers2 = new Set();
                recentActivity = recentActivity.filter(a => {
                    const key = a.userId || a.user;
                    if (seenUsers2.has(key)) return false;
                    seenUsers2.add(key);
                    return true;
                });
                recentActivity = recentActivity.slice(0, 5);
            }

            return {
                totalUsers,
                checkedInCount,
                recentActivity
            };
        } catch (error) {
            console.error("Error getting stats:", error);
            throw error;
        }
    },

    // ========== UNREGISTERED ALERTS ==========

    // Create alert when staff checks in without registering for any class
    createUnregisteredAlert: async (userId, userName, dateKey, checkInTime) => {
        try {
            const alertId = `${dateKey}_${userId}`;
            console.log('[Alert] Creating alert:', alertId, 'for', userName);
            const ref = db.collection('unregistered_alerts').doc(alertId);

            // Use set() directly — no need to check existence first
            // (Staff can't read this collection, and overwriting same-day alert is fine)
            await ref.set({
                userId: userId,
                userName: userName,
                date: dateKey,
                checkIn: checkInTime,
                resolved: false,
                resolvedBy: null,
                resolvedAt: null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('[Alert] Successfully created alert for', userName);
        } catch (e) {
            console.error('[Alert] FAILED to create alert:', e.code, e.message);
        }
    },

    // Get unresolved alerts for admin dashboard
    getUnregisteredAlerts: async () => {
        try {
            // Simple query without orderBy to avoid needing composite index
            const snapshot = await db.collection('unregistered_alerts')
                .where('resolved', '==', false)
                .limit(20)
                .get();

            const alerts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Sort client-side by date descending
            alerts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            return alerts;
        } catch (e) {
            console.warn("[Alert] Error getting alerts:", e);
            return [];
        }
    },

    // Admin resolves an alert
    resolveAlert: async (alertId, adminName) => {
        try {
            await db.collection('unregistered_alerts').doc(alertId).update({
                resolved: true,
                resolvedBy: adminName,
                resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            console.error("[Alert] Error resolving:", e);
            throw e;
        }
    },

    // ================= ADMIN NOTIFICATIONS =================

    // Create notification for staff when admin modifies their data
    createAdminNotification: async (staffId, staffName, action, dateKey, details) => {
        try {
            const currentUser = firebase.auth().currentUser;
            const adminName = currentUser ? (currentUser.displayName || currentUser.email || 'Admin') : 'Admin';

            await db.collection('admin_notifications').add({
                staffId: staffId,
                staffName: staffName || 'N/A',
                action: action, // 'add_session', 'edit_session', 'delete_session', 'select_role'
                dateKey: dateKey,
                details: details,
                adminName: adminName,
                read: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('[Notification] Created:', action, 'for', staffName);
        } catch (e) {
            console.warn('[Notification] Failed to create:', e.message);
            // Non-blocking: don't throw, notification failure shouldn't stop main action
        }
    },

    // Get unread notifications for a staff member
    getStaffNotifications: async (staffId) => {
        try {
            // Single WHERE to avoid composite index requirement
            const snap = await db.collection('admin_notifications')
                .where('staffId', '==', staffId)
                .limit(50)
                .get();

            // Client-side filter: only unread
            const results = snap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(n => n.read === false);

            // Sort client-side (newest first)
            results.sort((a, b) => {
                const ta = a.createdAt ? a.createdAt.seconds : 0;
                const tb = b.createdAt ? b.createdAt.seconds : 0;
                return tb - ta;
            });
            return results;
        } catch (e) {
            console.error('[Notification] Error fetching:', e.message);
            return [];
        }
    },

    // Mark a notification as read
    markNotificationRead: async (notifId) => {
        try {
            await db.collection('admin_notifications').doc(notifId).update({
                read: true,
                readAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            console.warn('[Notification] Error marking read:', e.message);
        }
    },

    // Mark ALL notifications for a staff as read
    markAllNotificationsRead: async (staffId) => {
        try {
            const snap = await db.collection('admin_notifications')
                .where('staffId', '==', staffId)
                .where('read', '==', false)
                .get();

            const batch = db.batch();
            snap.docs.forEach(doc => {
                batch.update(doc.ref, {
                    read: true,
                    readAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
            console.log('[Notification] Marked all read for', staffId);
        } catch (e) {
            console.warn('[Notification] Error marking all read:', e.message);
        }
    },

    // ================= MAKEUP REQUESTS (Tường trình — chấm công bù) =================
    // Nhân viên gửi yêu cầu chấm bù (ca có lịch quên chấm / ca ngoài lịch). Admin duyệt
    // → materialize session qua DBService.addSession (transaction có sẵn, an toàn dữ liệu).

    // Trường BẮT BUỘC của một yêu cầu chấm bù. Trả về danh sách phần còn THIẾU (rỗng = đủ).
    // Dùng ở CẢ 2 phía: nhân viên gửi (cham-bu.html) và quản lý duyệt (tuong-trinh.html) —
    // một nguồn duy nhất nên hai bên không bao giờ hiểu khác nhau về "thế nào là đủ".
    // Quy tắc GĐ: thiếu cơ sở / môn-lớp / người phân công thì quản lý không có căn cứ duyệt
    // và Bảng Công cũng không áp được đơn giá → không cho gửi, không cho duyệt.
    missingMakeupFields: (r) => {
        const req = r || {};
        const s = req.session || {};
        const missing = [];
        const isTT = ['tiep-tan', 'van-phong', 'office_staff'].includes(s.role) || ['tt', 'vp'].includes(req.shiftKind);
        if (!req.dateKey) missing.push('ngày');
        if (!req.branch) missing.push('cơ sở');
        if (req.type !== 'scheduled') {
            if (!isTT && !req.className) missing.push('môn/lớp');
            if (isTT && !req.shiftKey) missing.push('ca trực');
            if (!req.approvedBy) missing.push('người phân công');
        }
        if (!s.isAbsent && (!s.checkIn || !s.checkOut)) missing.push('giờ vào/ra');
        if (!String(req.reason || '').trim()) missing.push('lý do');
        return missing;
    },

    createMakeupRequests: async (requests) => {
        // Chặn ngay ở tầng dữ liệu, không chỉ ở giao diện: đơn thiếu trường vào được DB là
        // quản lý phải xử lý tay từng cái, và có nguy cơ duyệt một ca không tính được lương.
        const list = Array.isArray(requests) ? requests : [];
        if (list.length === 0) throw new Error('Không có yêu cầu nào để gửi.');
        for (const r of list) {
            const missing = DBService.missingMakeupFields(r);
            if (missing.length) {
                const err = new Error('Yêu cầu chấm bù còn thiếu: ' + missing.join(', ') + '. Vui lòng khai đủ rồi gửi lại.');
                err.code = 'MAKEUP_MISSING_FIELDS';
                err.missing = missing;
                throw err;
            }
        }
        const batchId = `mk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const batch = db.batch();
        list.forEach(r => {
            const ref = db.collection('makeup_requests').doc();
            batch.set(ref, { ...r, batchId, status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        });
        await batch.commit();
        return { batchId, count: list.length };
    },

    getMyMakeupRequests: async (staffId) => {
        try {
            const snap = await db.collection('makeup_requests').where('staffId', '==', staffId).limit(100).get();
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            list.sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0));
            return list;
        } catch (e) { console.error('[Makeup] get mine:', e); return []; }
    },

    // Trang Tường Trình lọc/sắp xếp ở phía client nên trần đọc CHÍNH LÀ trần dữ liệu.
    // Trả kèm _truncated để giao diện nói thật là "còn nữa", không im lặng cắt bớt.
    MAKEUP_FETCH_LIMIT: 500,
    getMakeupRequestsByStatus: async (status) => {
        try {
            const cap = DBService.MAKEUP_FETCH_LIMIT;
            const snap = await db.collection('makeup_requests').where('status', '==', status).limit(cap).get();
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            list.sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0));
            list._truncated = list.length >= cap;
            return list;
        } catch (e) { console.error('[Makeup] get by status:', e); return []; }
    },

    // Quản lý BỔ SUNG thông tin cho đơn cũ bị thiếu trường (đơn gửi trước khi có ràng buộc).
    // Chỉ cho sửa đúng những trường mô tả ca — không cho đụng vào status/staffId/giờ đã khai.
    updateMakeupRequest: async (reqId, patch, adminName) => {
        if (!reqId) throw new Error('Thiếu mã yêu cầu.');
        const allowed = ['branch', 'className', 'classId', 'room', 'shiftKey', 'approvedBy', 'shiftLabel', 'reason'];
        const data = {};
        allowed.forEach(k => {
            if (patch && patch[k] !== undefined && patch[k] !== null) data[k] = patch[k];
        });
        if (Object.keys(data).length === 0) throw new Error('Không có gì để cập nhật.');
        data.completedBy = adminName || 'Admin';
        data.completedAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('makeup_requests').doc(reqId).update(data);
    },

    // Final, server-fresh guard for scheduled make-up approval. The employee UI
    // is only a preview: immediately before writing payroll attendance, re-read
    // the request, exact schedule row(s), cancellation tombstones and attendance
    // absence sessions. A daily note is intentionally not consulted because it
    // has no shift identity.
    validateMakeupRequestForApproval: async (request) => {
        const requestId = String(request?.id || '').trim();
        if (!requestId) throw new Error('Thiếu mã yêu cầu chấm bù.');

        const fail = (message, code = 'MAKEUP_SHIFT_NOT_ELIGIBLE') => {
            const error = new Error(message);
            error.code = code;
            throw error;
        };
        const requestRef = db.collection('makeup_requests').doc(requestId);
        const requestSnapshot = await requestRef.get({ source: 'server' });
        if (!requestSnapshot.exists) fail('Yêu cầu chấm bù không còn tồn tại.', 'MAKEUP_REQUEST_NOT_FOUND');
        const live = { id: requestSnapshot.id || requestId, ...(requestSnapshot.data() || {}) };

        if ((request?.staffId && String(request.staffId) !== String(live.staffId)) ||
            (request?.dateKey && String(request.dateKey) !== String(live.dateKey))) {
            fail('Yêu cầu đã thay đổi nhân sự hoặc ngày. Hãy tải lại danh sách trước khi duyệt.', 'MAKEUP_REQUEST_STALE');
        }
        const staffId = String(live.staffId || '').trim();
        const dateKey = String(live.dateKey || '').trim();
        if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
            fail('Yêu cầu thiếu nhân sự hoặc ngày hợp lệ.', 'MAKEUP_REQUEST_INVALID');
        }

        const attendanceRef = db.collection('attendance_logs').doc(`${dateKey}_${staffId}`);
        const cancelledRef = db.collection('cancelled_shifts').doc(`${dateKey.slice(0, 7)}_${staffId}`);
        const [attendanceSnapshot, cancelledSnapshot] = await Promise.all([
            attendanceRef.get({ source: 'server' }),
            cancelledRef.get({ source: 'server' })
        ]);
        const attendanceData = attendanceSnapshot.exists ? (attendanceSnapshot.data() || {}) : {};
        const attendanceSessions = Array.isArray(attendanceData.sessions) ? attendanceData.sessions : [];
        const cancelledShifts = new Set(cancelledSnapshot.exists && Array.isArray(cancelledSnapshot.data()?.shifts)
            ? cancelledSnapshot.data().shifts
            : []);
        const existingSession = attendanceSessions.find(session =>
            String(session?.makeupRequestId || '') === requestId
        ) || null;

        if (live.status === 'approved') {
            const materializedId = String(live.materializedSessionId || existingSession?.id || '').trim();
            if (!materializedId || !attendanceSessions.some(session => String(session?.id || '') === materializedId)) {
                fail('Yêu cầu đã ghi duyệt nhưng không tìm thấy phiên công tương ứng. Cần kiểm tra dữ liệu trước khi thao tác tiếp.', 'MAKEUP_APPROVAL_INCONSISTENT');
            }
            return { request: live, existingSessionId: materializedId, alreadyApproved: true };
        }
        if (live.status !== 'pending') {
            fail('Yêu cầu không còn ở trạng thái chờ duyệt. Hãy tải lại danh sách.', 'MAKEUP_REQUEST_STALE');
        }
        if (live.type !== 'scheduled') {
            return { request: live, existingSessionId: existingSession?.id || '', alreadyApproved: false };
        }
        if (!window.ShiftAbsenceState?.resolveShift) {
            fail(
                'Không tải được bộ đối chiếu trạng thái vắng theo ca. Hãy tải lại trang trước khi duyệt.',
                'MAKEUP_SHIFT_STATE_UNAVAILABLE'
            );
        }
        if (live.session?.isAbsent) {
            fail('Yêu cầu có lịch đang khai là một phiên vắng, không phải ca quên chấm công.');
        }

        const toMinutes = value => {
            const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
            return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
        };
        const requestedStart = String(live.shiftStart || '').trim();
        const requestedEnd = String(live.shiftEnd || '').trim();
        const requestContains = (start, end) => {
            const a = toMinutes(requestedStart), b = toMinutes(requestedEnd);
            const c = toMinutes(start), d = toMinutes(end);
            return [a, b, c, d].every(Number.isFinite) && a <= c && d <= b;
        };
        if (!Number.isFinite(toMinutes(requestedStart)) || !Number.isFinite(toMinutes(requestedEnd))) {
            fail('Yêu cầu thiếu khung giờ lịch hợp lệ.', 'MAKEUP_REQUEST_INVALID');
        }

        const suppliedLocators = (Array.isArray(live.scheduleLocators) ? live.scheduleLocators : [])
            .filter(locator => locator && typeof locator === 'object');
        const shiftKind = ['tt', 'vp'].includes(String(live.shiftKind || ''))
            ? String(live.shiftKind)
            : 'gv';
        const branches = live.branch ? [String(live.branch)] : ['cs1', 'cs2', 'cs3'];
        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
        const resolvedStates = [];

        const checkResolvedState = (resolved, label) => {
            resolvedStates.push(resolved);
            if (!resolved?.isAbsent) return;
            const stateLabel = window.ShiftAbsenceState.absenceLabel(resolved) || 'Vắng';
            fail(`${label} hiện đã được ghi nhận ${stateLabel}. Không thể duyệt chấm bù cho tới khi trạng thái ca được khôi phục.`);
        };

        if (shiftKind === 'gv') {
            const scheduleCache = new Map();
            const loadScheduleFresh = async compositeKey => {
                if (scheduleCache.has(compositeKey)) return scheduleCache.get(compositeKey);
                const value = await DBService.getSchedule(compositeKey, { source: 'server' });
                scheduleCache.set(compositeKey, value || {});
                return value || {};
            };
            const resolveLocatedRow = async locator => {
                const compositeKey = String(locator.compositeKey || live.scheduleCompositeKey || `${live.branch}__${dateKey}`);
                const parsed = DBService._parseBranchKey(compositeKey);
                if (parsed.dateKey !== dateKey) fail('Định danh ca không khớp ngày yêu cầu.', 'MAKEUP_REQUEST_STALE');
                const schedule = await loadScheduleFresh(compositeKey);
                const candidateSections = locator.section ? [String(locator.section)] : sections;
                const exactIdMatches = [];
                const stableMatches = [];
                const locatorShiftId = String(locator.shiftId || live.scheduleShiftId || '').trim();
                candidateSections.forEach(section => {
                    const rows = Array.isArray(schedule?.[section]) ? schedule[section] : [];
                    rows.forEach((row, rowIndex) => {
                        const sameShiftId = !!locatorShiftId && String(row?.shiftId || '') === locatorShiftId;
                        if (locator.start && String(row?.start || '') !== String(locator.start)) return;
                        if (locator.end && String(row?.end || '') !== String(locator.end)) return;
                        if (locator.classId && row?.lopId && String(row.lopId) !== String(locator.classId)) return;
                        if (locator.className && row?.lop && String(row.lop) !== String(locator.className)) return;
                        if (!isAssignedToClass(row, staffId)) return;
                        const match = { row, rowIndex, section, compositeKey, branch: parsed.branch };
                        if (sameShiftId) exactIdMatches.push(match);
                        // Inherited schedules regenerate transient shiftId values on
                        // each materialization. Their stable locator is section +
                        // row index + time + class, while direct schedules still use
                        // the exact shiftId path above.
                        if (!Number.isInteger(locator.rowIndex) || Number(locator.rowIndex) === rowIndex) {
                            stableMatches.push(match);
                        }
                    });
                });
                const matches = exactIdMatches.length ? exactIdMatches : stableMatches;
                if (matches.length !== 1) {
                    fail(matches.length
                        ? 'Định danh yêu cầu khớp nhiều dòng lịch. Hãy tải lại và gửi lại đúng ca.'
                        : 'Ca nguồn của yêu cầu không còn trên lịch hoặc nhân sự không còn được phân công.', 'MAKEUP_REQUEST_STALE');
                }
                const match = matches[0];
                if (!requestContains(match.row.start, match.row.end)) {
                    fail('Khung giờ ca nguồn đã thay đổi so với yêu cầu. Hãy tải lại và gửi lại.', 'MAKEUP_REQUEST_STALE');
                }
                const cancelKey = `${match.compositeKey}_${match.section}_${match.rowIndex}`;
                checkResolvedState(window.ShiftAbsenceState.resolveTeachingShift({
                    row: match.row,
                    staffId,
                    isAssigned: true,
                    kind: 'gv',
                    dateKey,
                    start: match.row.start,
                    end: match.row.end,
                    branch: match.branch,
                    compositeKey: match.compositeKey,
                    section: match.section,
                    shiftId: match.row.shiftId || '',
                    cancelKey,
                    cancelledShifts,
                    attendanceSessions
                }), `${match.row.lop || 'Ca dạy'} ${match.row.start}–${match.row.end}`);
            };

            if (suppliedLocators.length) {
                const teachingLocators = suppliedLocators.filter(locator => !locator.kind || locator.kind === 'gv');
                if (!teachingLocators.length || teachingLocators.length !== suppliedLocators.length) {
                    fail('Loại ca trong định danh không khớp yêu cầu.', 'MAKEUP_REQUEST_STALE');
                }
                for (const locator of teachingLocators) await resolveLocatedRow(locator);
            } else {
                // Backward-compatible guarded lookup for pending requests created
                // before schedule locators existed. Every assigned row contained
                // in the requested span is checked; zero matches fails closed.
                const legacyMatches = [];
                for (const branch of branches) {
                    const compositeKey = `${branch}__${dateKey}`;
                    const schedule = await loadScheduleFresh(compositeKey);
                    sections.forEach(section => {
                        (schedule?.[section] || []).forEach((row, rowIndex) => {
                            if (!isAssignedToClass(row, staffId) || !requestContains(row.start, row.end)) return;
                            legacyMatches.push({
                                kind: 'gv', compositeKey, section, rowIndex,
                                shiftId: row.shiftId || '', start: row.start, end: row.end,
                                branch, classId: row.lopId || ''
                            });
                        });
                    });
                }
                if (!legacyMatches.length) fail('Không tìm thấy ca nguồn tương ứng trên lịch hiện tại.', 'MAKEUP_REQUEST_STALE');
                for (const locator of legacyMatches) await resolveLocatedRow(locator);
            }
        } else {
            const targetDate = new Date(`${dateKey}T12:00:00`);
            const weekDay = targetDate.getDay();
            const dayIndex = weekDay === 0 ? 6 : weekDay - 1;
            const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
            const dayKey = dayKeys[dayIndex];
            const monday = new Date(targetDate);
            monday.setDate(targetDate.getDate() - dayIndex);
            const mondayKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
            const defaultTimes = {
                morning: { start: '07:00', end: '11:30' },
                afternoon: { start: '14:00', end: '18:00' },
                evening: { start: '18:00', end: '21:30' }
            };
            const operationalLocators = suppliedLocators.length ? suppliedLocators : [{
                kind: shiftKind,
                compositeKey: `${live.branch}__${mondayKey}`,
                section: live.shiftKey || live.session?.linkedOfficeShift || live.session?.linkedReceptionistShift,
                dayKey
            }];
            if (operationalLocators.some(locator => locator.kind && locator.kind !== shiftKind)) {
                fail('Loại ca vận hành trong định danh không khớp yêu cầu.', 'MAKEUP_REQUEST_STALE');
            }
            for (const locator of operationalLocators) {
                const compositeKey = String(locator.compositeKey || `${live.branch}__${mondayKey}`);
                const parsed = DBService._parseBranchKey(compositeKey);
                if (parsed.dateKey !== mondayKey) fail('Định danh tuần của ca vận hành đã thay đổi.', 'MAKEUP_REQUEST_STALE');
                const cacheKey = `${shiftKind === 'vp' ? 'office_schedule' : 'receptionist_schedule'}_${compositeKey}`;
                DBService._invalidate(cacheKey);
                const weekData = shiftKind === 'vp'
                    ? await DBService.getOfficeSchedule(compositeKey, { source: 'server' })
                    : await DBService.getReceptionistSchedule(compositeKey, { source: 'server' });
                const shiftKey = String(locator.section || live.shiftKey || live.session?.linkedOfficeShift || live.session?.linkedReceptionistShift || '');
                const locatorDayKey = String(locator.dayKey || dayKey);
                const roster = weekData?.[shiftKey]?.[locatorDayKey];
                const entry = Array.isArray(roster) ? roster.find(item => String(item?.id || '') === staffId) : null;
                if (!entry) fail('Nhân sự không còn được phân công đúng ca vận hành nguồn.', 'MAKEUP_REQUEST_STALE');
                const config = weekData?._shiftConfig?.[shiftKey] || {};
                const defaults = defaultTimes[shiftKey] || {};
                const start = entry.customStart || config.start || defaults.start;
                const end = entry.customEnd || config.end || defaults.end;
                if (!requestContains(start, end)) fail('Giờ ca vận hành đã thay đổi so với yêu cầu.', 'MAKEUP_REQUEST_STALE');
                const cancelKey = `${shiftKind === 'vp' ? 'office_' : ''}${parsed.branch}_${mondayKey}_${shiftKey}_${locatorDayKey}`;
                checkResolvedState(window.ShiftAbsenceState.resolveOperationalShift({
                    kind: shiftKind,
                    dateKey,
                    start,
                    end,
                    branch: parsed.branch,
                    compositeKey,
                    section: shiftKey,
                    shiftKey,
                    cancelKey,
                    cancelledShifts,
                    attendanceSessions
                }), `${shiftKind === 'vp' ? 'Văn Phòng' : 'Tiếp Tân'} ${start}–${end}`);
            }
        }

        return {
            request: live,
            existingSessionId: existingSession?.id || '',
            alreadyApproved: false,
            resolvedStates
        };
    },

    // options.allowOverlap = true → quản lý đã xem cảnh báo "đã có công trùng giờ" và
    // vẫn quyết định duyệt. Mặc định chặn để một lần bấm nhầm không thành lương đôi.
    //
    // options.payoutMonth = 'YYYY-MM' → THÁNG TRẢ LƯƠNG cho ca này (quy định của GĐ Diễm
    // 06/08/2026): lỗi bên trung tâm (mất mạng, mất điện) thì trả ngay trong tháng dạy;
    // nhân viên quên chấm công thì trả vào tháng sau. Ca vẫn nằm nguyên ở THÁNG DẠY —
    // giờ công, đơn giá, Bảng Công đều không đổi — chỉ có tiền là dồn sang tháng được
    // chọn. Bỏ trống = trả trong tháng dạy (mặc định như trước nay).
    approveMakeupRequest: async (req, adminName, options = {}) => {
        // Never trust the list-row object held by the admin page. It can be stale
        // after a coordinator records an absence. Re-read the request, exact
        // source shift, cancellations and attendance from the server immediately
        // before the atomic materialization below.
        const approvalGuard = await DBService.validateMakeupRequestForApproval(req);
        if (approvalGuard.alreadyApproved) return approvalGuard.existingSessionId;
        req = approvalGuard.request;
        const s = req.session || {};
        const requestClassIds = Array.from(new Set([
            ...(Array.isArray(req.classIds) ? req.classIds : []),
            req.classId
        ].map(value => String(value || '').trim()).filter(Boolean)));
        const requestClassNames = Array.from(new Set([
            ...(Array.isArray(req.classNames) ? req.classNames : []),
            req.className
        ].map(value => String(value || '').trim()).filter(Boolean)));
        const sessionData = {
            checkIn: s.checkIn || null,
            checkOut: s.checkOut || null,
            role: s.role || (requestClassIds.length ? requestClassIds.join('+') : null),
            roleName: s.roleName || (requestClassNames.length ? requestClassNames.join(' + ') : null),
            isAdminEdited: true, // admin duyệt = admin xác nhận giờ (quy tắc admin-là-chuẩn)
            makeupRequestId: req.id,
            // 'makeup' (có lịch) → session thường, khớp lịch như chấm công thật;
            // 'admin_add' (ngoài lịch) → hiển thị "Ca Thêm" như admin thêm tay.
            type: req.type === 'unscheduled' ? 'admin_add' : 'makeup'
        };
        if (s.isAbsent) sessionData.isAbsent = true;
        // Neo ca vừa duyệt vào đúng ô lịch để Bảng Công không phải đoán:
        //  - ca có lịch  → linkedClassStart = giờ bắt đầu ca đã chọn
        //  - ca tiếp tân → linkedReceptionistShift = sáng/chiều/tối
        if (s.linkedOfficeShift) sessionData.linkedOfficeShift = s.linkedOfficeShift;
        else if (req.shiftKind === 'vp' && req.shiftKey) sessionData.linkedOfficeShift = req.shiftKey;
        else if (s.linkedReceptionistShift) sessionData.linkedReceptionistShift = s.linkedReceptionistShift;
        else if (req.shiftKind === 'tt' && req.shiftKey) sessionData.linkedReceptionistShift = req.shiftKey;
        else if (req.shiftStart) sessionData.linkedClassStart = req.shiftStart;
        if (req.type === 'scheduled') {
            const scheduleLocators = (Array.isArray(req.scheduleLocators) ? req.scheduleLocators : [])
                .filter(locator => locator && typeof locator === 'object')
                .map(locator => ({ ...locator }));
            const uniqueLocatorValue = key => {
                const values = Array.from(new Set(scheduleLocators
                    .map(locator => String(locator[key] || '').trim())
                    .filter(Boolean)));
                return values.length === 1 ? values[0] : '';
            };
            const linkedShiftId = String(req.scheduleShiftId || uniqueLocatorValue('shiftId')).trim();
            const linkedCompositeKey = String(req.scheduleCompositeKey || uniqueLocatorValue('compositeKey')).trim();
            const linkedSection = String(req.scheduleSection || uniqueLocatorValue('section')).trim();
            if (linkedShiftId) sessionData.linkedScheduleShiftId = linkedShiftId;
            if (linkedCompositeKey) sessionData.linkedScheduleCompositeKey = linkedCompositeKey;
            if (linkedSection) sessionData.linkedScheduleSection = linkedSection;
            if (scheduleLocators.length) sessionData.linkedScheduleLocators = scheduleLocators;
        }
        if (req.branch) sessionData.branch = req.branch;
        if (req.className) sessionData.className = req.className;
        if (req.room) sessionData.room = req.room;

        // Chỉ ghi payoutMonth khi KHÁC tháng dạy — ca trả đúng tháng thì không cần đánh dấu
        const teachMonth = String(req.dateKey || '').slice(0, 7);
        if (options.payoutMonth && teachMonth && options.payoutMonth !== teachMonth) {
            sessionData.payoutMonth = options.payoutMonth;
            sessionData.payoutDeferredFrom = teachMonth;
            if (options.payoutReason) sessionData.payoutReason = options.payoutReason;
        }
        const sid = await DBService.addSession(req.staffId, req.dateKey, sessionData, {
            allowOverlap: !!options.allowOverlap,
            makeupApproval: {
                requestId: req.id,
                reviewedBy: adminName || 'Admin',
                staffName: req.staffName || 'N/A',
                overtimeMinutes: Number(s.overtimeMinutes) || 0
            }
        });
        return sid;
    },

    rejectMakeupRequest: async (reqId, adminName, reason) => {
        await db.collection('makeup_requests').doc(reqId).update({
            status: 'rejected', reviewedBy: adminName || 'Admin',
            reviewedAt: firebase.firestore.FieldValue.serverTimestamp(), rejectReason: reason || ''
        });
    },

    // ================= BROADCAST ANNOUNCEMENTS (Thông báo nội bộ) =================
    // Tái dùng collection admin_notifications: mỗi người nhận 1 doc (action:'announcement')
    // → chuông + popup + đánh dấu đã đọc CÓ SẴN của nhân viên tự hoạt động, không cần rules mới.

    // recipients: [{id, name}], payload: {title, message, color, icon}
    sendAnnouncement: async (recipients, payload) => {
        const currentUser = firebase.auth().currentUser;
        const adminName = currentUser ? (currentUser.displayName || currentUser.email || 'Admin') : 'Admin';
        const batchId = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const todayKey = new Date().toISOString().split('T')[0];

        // Firestore batch tối đa 500 op — chia khúc 400 cho an toàn
        for (let i = 0; i < recipients.length; i += 400) {
            const chunk = recipients.slice(i, i + 400);
            const batch = db.batch();
            chunk.forEach(r => {
                const ref = db.collection('admin_notifications').doc();
                batch.set(ref, {
                    staffId: r.id,
                    staffName: r.name || 'N/A',
                    action: 'announcement',
                    title: payload.title,
                    details: payload.message,
                    color: payload.color || 'blue',
                    icon: payload.icon || 'bell',
                    batchId: batchId,
                    dateKey: todayKey,
                    adminName: adminName,
                    read: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
        }
        return { batchId, count: recipients.length };
    },

    // Lịch sử thông báo đã gửi — gom theo batchId, kèm số người đã đọc
    getRecentAnnouncements: async (maxGroups = 8) => {
        try {
            // 1 WHERE duy nhất để không cần composite index
            const snap = await db.collection('admin_notifications')
                .where('action', '==', 'announcement')
                .limit(400)
                .get();
            const groups = {};
            snap.docs.forEach(doc => {
                const d = doc.data();
                const key = d.batchId || doc.id;
                if (!groups[key]) {
                    groups[key] = { batchId: key, title: d.title || '(không tiêu đề)', details: d.details || '', color: d.color || 'blue', icon: d.icon || 'bell', adminName: d.adminName || 'Admin', createdAt: d.createdAt, total: 0, readCount: 0 };
                }
                groups[key].total++;
                if (d.read === true) groups[key].readCount++;
                const t = d.createdAt && d.createdAt.seconds ? d.createdAt.seconds : 0;
                const cur = groups[key].createdAt && groups[key].createdAt.seconds ? groups[key].createdAt.seconds : 0;
                if (t > cur) groups[key].createdAt = d.createdAt;
            });
            return Object.values(groups)
                .sort((a, b) => ((b.createdAt?.seconds) || 0) - ((a.createdAt?.seconds) || 0))
                .slice(0, maxGroups);
        } catch (e) {
            console.error('[Announcement] Error fetching history:', e);
            return [];
        }
    },

    // ================= AUTO-CLOSE STALE SESSIONS =================
    // Close open sessions from past days that were never checked out
    autoCloseStaleSession: async (userId, dateKey, sessionId, correctEndISO = null) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            return db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) return false;

                const data = doc.data();
                if (!data.sessions || !Array.isArray(data.sessions)) return false;

                // Find the open session by ID. A previous version could have
                // auto-closed the session at the end of the receptionist shift
                // before discovering a directly-connected teaching shift. In
                // that case allow a later, safer end time to extend only the
                // system-generated stale close; never touch a user/admin close.
                const idx = data.sessions.findIndex(s =>
                    String(s.id) === String(sessionId) &&
                    !s.isAdminEdited &&
                    (!s.checkOut || s.autoClosedReason === 'stale_session')
                );
                if (idx === -1) return false; // Already closed or not found

                // Dùng giờ kết thúc lịch nếu được truyền vào, fallback 23:59
                const endOfDayISO = correctEndISO || new Date(`${dateKey}T23:59:00`).toISOString();
                const currentEnd = data.sessions[idx].checkOut ? new Date(data.sessions[idx].checkOut) : null;
                const nextEnd = new Date(endOfDayISO);
                // Không rút ngắn một giờ đóng tự động đã có; chỉ mở rộng khi
                // chuỗi ca liên tiếp chứng minh mốc kết thúc muộn hơn.
                if (currentEnd && !isNaN(currentEnd.getTime()) &&
                    (!isNaN(nextEnd.getTime()) && nextEnd <= currentEnd)) {
                    return false;
                }
                data.sessions[idx].checkOut = endOfDayISO;
                data.sessions[idx].autoClosedReason = 'stale_session'; // Marker

                // Sync top level if last session
                if (idx === data.sessions.length - 1) {
                    data.checkOut = endOfDayISO;
                }
                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

                t.set(ref, data);
                console.log(`[AutoClose] Closed stale session ${sessionId} for ${userId} on ${dateKey}`);
                return true;
            });
        } catch (e) {
            console.warn('[AutoClose] Error:', e);
            return false;
        }
    },

    // ================= RECEPTIONIST SCHEDULE =================

    async getReceptionistSchedule(compositeKey, options = {}) {
        const cacheKey = `receptionist_schedule_${compositeKey}`;
        const serverFresh = options.source === 'server';
        if (!serverFresh && DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const ref = db.collection('receptionist_schedules').doc(compositeKey);
                const doc = serverFresh ? await ref.get({ source: 'server' }) : await ref.get();
                return doc.exists ? doc.data() : null;
            } catch (e) {
                console.error('[ReceptionistSchedule] Error getting:', e);
                throw e;
            }
        })();

        const guardedPromise = promise.catch(error => {
            DBService._invalidate(cacheKey);
            throw error;
        });
        if (!serverFresh) DBService._cache[cacheKey] = guardedPromise;
        return guardedPromise;
    },

    // Cùng schema tuần với lịch tiếp tân nhưng tách collection để mọi thao tác
    // xếp/xóa lịch văn phòng không thể ảnh hưởng lịch tiếp tân hiện hữu.
    async getOfficeSchedule(compositeKey, options = {}) {
        const cacheKey = `office_schedule_${compositeKey}`;
        const serverFresh = options.source === 'server';
        if (!serverFresh && DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const ref = db.collection('office_schedules').doc(compositeKey);
                const doc = serverFresh ? await ref.get({ source: 'server' }) : await ref.get();
                return doc.exists ? doc.data() : null;
            } catch (e) {
                console.error('[OfficeSchedule] Error getting:', e);
                throw e;
            }
        })();

        const guardedPromise = promise.catch(error => {
            DBService._invalidate(cacheKey);
            throw error;
        });
        if (!serverFresh) DBService._cache[cacheKey] = guardedPromise;
        return guardedPromise;
    },

    // Read the weekly receptionist roster back into concrete daily shifts for
    // a month.  Payroll history needs the exact same source as the current
    // month view; it must never infer a receptionist shift from an attendance
    // session or write anything while loading a historical payslip.
    getMonthlyReceptionistShifts: async (monthStr, staffId) => {
        if (!monthStr || !staffId) return [];

        const cacheKey = `monthly_operational_shifts_${monthStr}_${staffId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const [yearStr, monthNumStr] = String(monthStr).split('-');
                const year = Number.parseInt(yearStr, 10);
                const month = Number.parseInt(monthNumStr, 10) - 1;
                if (!Number.isInteger(year) || month < 0 || month > 11) return [];

                const branches = ['cs1', 'cs2', 'cs3'];
                const shiftKeys = ['morning', 'afternoon', 'evening'];
                const shiftLabels = { morning: 'SÁNG', afternoon: 'CHIỀU', evening: 'TỐI' };
                const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const pad = value => String(value).padStart(2, '0');
                const dateKeyOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
                const getMonday = date => {
                    const monday = new Date(date);
                    const weekday = monday.getDay();
                    monday.setDate(monday.getDate() - weekday + (weekday === 0 ? -6 : 1));
                    monday.setHours(0, 0, 0, 0);
                    return monday;
                };

                const monthDays = Array.from({ length: daysInMonth }, (_, index) => new Date(year, month, index + 1));
                const mondayKeys = [...new Set(monthDays.map(day => dateKeyOf(getMonday(day))))];
                const [shiftConfigs, officeShiftConfigs, rosterRows] = await Promise.all([
                    Promise.all(branches.map(branch => DBService.getReceptionistShiftConfig(branch))),
                    Promise.all(branches.map(branch => DBService.getOfficeShiftConfig(branch))),
                    Promise.all(branches.flatMap(branch => mondayKeys.map(mondayKey =>
                        Promise.all([
                            DBService.getReceptionistSchedule(`${branch}__${mondayKey}`).then(data => ({
                                branch,
                                mondayKey,
                                scheduleType: 'receptionist',
                                documentKey: `${branch}__${mondayKey}`,
                                data: data || {}
                            })),
                            DBService.getOfficeSchedule(`${branch}__${mondayKey}`).then(data => ({
                                branch,
                                mondayKey,
                                scheduleType: 'office',
                                documentKey: `${branch}__${mondayKey}`,
                                data: data || {}
                            }))
                        ])
                    )))
                ]);
                const shiftConfigByBranch = Object.fromEntries(branches.map((branch, index) => [branch, shiftConfigs[index] || {}]));
                const officeShiftConfigByBranch = Object.fromEntries(branches.map((branch, index) => [branch, officeShiftConfigs[index] || {}]));
                const flatRosterRows = rosterRows.flat();
                const shiftsByDate = {};

                monthDays.forEach(day => {
                    const dateKey = dateKeyOf(day);
                    const mondayKey = dateKeyOf(getMonday(day));
                    const dayIndex = day.getDay() === 0 ? 6 : day.getDay() - 1;
                    const dayKey = dayKeys[dayIndex];

                    flatRosterRows.forEach(roster => {
                        if (roster.mondayKey !== mondayKey) return;

                        shiftKeys.forEach(shiftKey => {
                            const staffList = roster.data?.[shiftKey]?.[dayKey];
                            if (!Array.isArray(staffList)) return;

                            const staffEntry = staffList.find(entry => String(entry?.id || '') === String(staffId));
                            if (!staffEntry) return;

                            const branchConfig = roster.scheduleType === 'office'
                                ? (officeShiftConfigByBranch[roster.branch] || {})
                                : (shiftConfigByBranch[roster.branch] || {});
                            const weekConfig = roster.data?._shiftConfig?.[shiftKey] || {};
                            const defaultStart = staffEntry.customStart || weekConfig.start || branchConfig[shiftKey]?.start || '07:00';
                            const defaultEnd = staffEntry.customEnd || weekConfig.end || branchConfig[shiftKey]?.end || '11:30';
                            if (!shiftsByDate[dateKey]) shiftsByDate[dateKey] = [];
                            shiftsByDate[dateKey].push({
                                shift: shiftKey,
                                label: shiftLabels[shiftKey],
                                start: staffEntry.customStart || defaultStart,
                                end: staffEntry.customEnd || defaultEnd,
                                branch: roster.branch,
                                scheduleType: roster.scheduleType,
                                documentKey: roster.documentKey,
                                cancelCompositeKey: roster.scheduleType === 'office'
                                    ? `office_${roster.branch}_${mondayKey}`
                                    : `${roster.branch}_${mondayKey}`,
                                isFixedShift: staffEntry.isFixedShift === true
                            });
                        });
                    });
                });

                return Object.keys(shiftsByDate)
                    .sort()
                    .map(id => ({ id, shifts: shiftsByDate[id] }));
            } catch (error) {
                console.error('[ReceptionistSchedule] Error getting monthly roster:', error);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    async saveReceptionistSchedule(compositeKey, data, expectedRevision = null) {
        try {
            const ref = db.collection('receptionist_schedules').doc(compositeKey);
            let revision = 0;
            await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);
                const currentRevision = snapshot.exists && Number.isInteger(snapshot.data()?._revision)
                    ? snapshot.data()._revision
                    : 0;
                if (Number.isInteger(expectedRevision) && currentRevision !== expectedRevision) {
                    const conflict = new Error('Lịch tiếp tân đã thay đổi kể từ khi bạn mở trang.');
                    conflict.code = 'SCHEDULE_CONFLICT';
                    throw conflict;
                }
                revision = currentRevision + 1;
                transaction.set(ref, {
                    ...data,
                    _revision: revision,
                    _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    _updatedBy: localStorage.getItem('currentUserId') || null
                });
            });
            DBService._invalidate(`receptionist_schedule_${compositeKey}`);
            return { revision };
        } catch (e) {
            console.error('[ReceptionistSchedule] Error saving:', e);
            throw e;
        }
    },

    async saveOfficeSchedule(compositeKey, data, expectedRevision = null) {
        try {
            const ref = db.collection('office_schedules').doc(compositeKey);
            let revision = 0;
            await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);
                const currentRevision = snapshot.exists && Number.isInteger(snapshot.data()?._revision)
                    ? snapshot.data()._revision
                    : 0;
                if (Number.isInteger(expectedRevision) && currentRevision !== expectedRevision) {
                    const conflict = new Error('Lịch văn phòng đã thay đổi kể từ khi bạn mở trang.');
                    conflict.code = 'SCHEDULE_CONFLICT';
                    throw conflict;
                }
                revision = currentRevision + 1;
                transaction.set(ref, {
                    ...data,
                    _revision: revision,
                    _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    _updatedBy: localStorage.getItem('currentUserId') || null
                });
            });
            DBService._invalidate(`office_schedule_${compositeKey}`);
            return { revision };
        } catch (e) {
            console.error('[OfficeSchedule] Error saving:', e);
            throw e;
        }
    },

    async unassignReceptionist(compositeKey, shiftKey, dayKey, staffId) {
        try {
            console.log(`[UnassignReceptionist] Start: composite=${compositeKey}, shift=${shiftKey}, day=${dayKey}, staff=${staffId}`);
            const result = await db.runTransaction(async (t) => {
                const docRef = db.collection('receptionist_schedules').doc(compositeKey);
                const doc = await t.get(docRef);
                if (!doc.exists) {
                    console.log(`[UnassignReceptionist] Doc not found: ${compositeKey}`);
                    return false;
                }

                const data = doc.data();
                if (!data[shiftKey] || !data[shiftKey][dayKey]) {
                    console.log(`[UnassignReceptionist] Path not found: ${shiftKey}.${dayKey}`);
                    return false;
                }

                const originalLength = data[shiftKey][dayKey].length;
                data[shiftKey][dayKey] = data[shiftKey][dayKey].filter(s => s.id !== staffId);

                console.log(`[UnassignReceptionist] Filtered from ${originalLength} to ${data[shiftKey][dayKey].length}`);

                if (data[shiftKey][dayKey].length < originalLength) {
                    const currentRevision = Number.isInteger(data._revision) ? data._revision : 0;
                    t.update(docRef, {
                        [shiftKey]: data[shiftKey],
                        _revision: currentRevision + 1,
                        _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        _updatedBy: localStorage.getItem('currentUserId') || null
                    });
                    console.log(`[UnassignReceptionist] Success! Updated doc.`);
                    return true;
                }
                console.log(`[UnassignReceptionist] No match found for staffId: ${staffId}`);
                return false;
            });
            DBService._invalidate(`receptionist_schedule_${compositeKey}`);
            return result;
        } catch (e) {
            console.error('[ReceptionistSchedule] Error unassigning:', e);
            throw e;
        }
    },

    async unassignOfficeStaff(compositeKey, shiftKey, dayKey, staffId) {
        try {
            const result = await db.runTransaction(async (transaction) => {
                const docRef = db.collection('office_schedules').doc(compositeKey);
                const doc = await transaction.get(docRef);
                if (!doc.exists) return false;

                const data = doc.data();
                if (!data[shiftKey] || !Array.isArray(data[shiftKey][dayKey])) return false;

                const originalLength = data[shiftKey][dayKey].length;
                data[shiftKey][dayKey] = data[shiftKey][dayKey]
                    .filter(staff => String(staff?.id || '') !== String(staffId));
                if (data[shiftKey][dayKey].length === originalLength) return false;

                const currentRevision = Number.isInteger(data._revision) ? data._revision : 0;
                transaction.update(docRef, {
                    [shiftKey]: data[shiftKey],
                    _revision: currentRevision + 1,
                    _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    _updatedBy: localStorage.getItem('currentUserId') || null
                });
                return true;
            });
            DBService._invalidate(`office_schedule_${compositeKey}`);
            return result;
        } catch (e) {
            console.error('[OfficeSchedule] Error unassigning:', e);
            throw e;
        }
    },

    // Get receptionist shift time config from system settings (per-branch)
    async getReceptionistShiftConfig(branch) {
        const cacheKey = `receptionist_config_${branch || 'global'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            const defaults = {
                morning: { start: '07:00', end: '11:30' },
                afternoon: { start: '14:00', end: '18:00' },
                evening: { start: '17:30', end: '21:30' }
            };
            try {
                const settings = await this.getSystemSettings();
                // Try per-branch key first, then fallback to global
                if (branch) {
                    const branchKey = `receptionistShifts_${branch}`;
                    if (settings?.[branchKey]) return settings[branchKey];
                }
                return settings?.receptionistShifts || defaults;
            } catch (e) {
                console.warn('[ReceptionistSchedule] Using default shift config');
                return defaults;
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    // Cấu hình ca văn phòng dùng cùng cấu trúc với tiếp tân nhưng có namespace
    // riêng để thay đổi giờ văn phòng không ảnh hưởng lịch tiếp tân hiện hữu.
    async getOfficeShiftConfig(branch) {
        const cacheKey = `office_config_${branch || 'global'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            const defaults = {
                morning: { start: '07:00', end: '11:30' },
                afternoon: { start: '14:00', end: '18:00' },
                evening: { start: '17:30', end: '21:30' }
            };
            try {
                const settings = await this.getSystemSettings();
                if (branch) {
                    const branchKey = `officeShifts_${branch}`;
                    if (settings?.[branchKey]) return settings[branchKey];
                }
                return settings?.officeShifts || defaults;
            } catch (e) {
                console.warn('[OfficeSchedule] Using default shift config');
                return defaults;
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    // ================= SHIFT OVERSIGHT (RECEPTIONIST -> TEACHER) =================

    _buildReceptionistPresenceId(dateKey, branch, shiftKey, staffId) {
        return [dateKey, branch, shiftKey, staffId]
            .map(value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_'))
            .join('_');
    },

    async getReceptionistShiftPresence(dateKey, branch, shiftKey, staffIds = []) {
        const uniqueIds = [...new Set((staffIds || []).filter(Boolean))];
        if (uniqueIds.length === 0) return [];

        try {
            const docs = await Promise.all(uniqueIds.map(staffId => {
                const id = DBService._buildReceptionistPresenceId(dateKey, branch, shiftKey, staffId);
                return db.collection('receptionist_shift_presence').doc(id).get();
            }));
            return docs.filter(doc => doc.exists).map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error('[ShiftOversight] Error loading shift presence:', e);
            return [];
        }
    },

    async activateReceptionistShift(dateKey, branch, shiftKey, staffId, staffName) {
        const authUser = firebase.auth().currentUser;
        if (!authUser) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        if (!dateKey || !branch || !shiftKey || !staffId) {
            throw new Error('Thiếu thông tin ca trực.');
        }

        const id = DBService._buildReceptionistPresenceId(dateKey, branch, shiftKey, staffId);
        const ref = db.collection('receptionist_shift_presence').doc(id);
        await ref.set({
            dateKey,
            branch,
            shiftKey,
            staffId,
            staffName: staffName || localStorage.getItem('userFullName') || '',
            authUid: authUser.uid,
            status: 'active',
            activatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return id;
    },

    async getShiftObservationsForDate(dateKey, staffId = '') {
        if (!dateKey) return [];
        try {
            // Firestore authorizes queries from their constraints, not from a
            // client-side filter after downloading the result. Staff-facing
            // callers therefore pass staffId so the query proves ownership;
            // oversight screens omit it and are authorized by their role map.
            let query = db.collection('shift_observations')
                .where('dateKey', '==', dateKey);
            if (staffId) query = query.where('teacherId', '==', staffId);
            const snap = await query.get();
            return snap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => !staffId || item.teacherId === staffId)
                .sort((a, b) => String(b.createdAt?.seconds || 0).localeCompare(String(a.createdAt?.seconds || 0)));
        } catch (e) {
            console.error('[ShiftOversight] Error loading observations for date:', e);
            return [];
        }
    },

    async getShiftObservationsForMonth(monthStr, staffId = '') {
        if (!/^\d{4}-\d{2}$/.test(monthStr || '')) return [];
        const cacheKey = `shift_observations_${monthStr}_${staffId || 'all'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            const start = `${monthStr}-01`;
            const [year, month] = monthStr.split('-').map(Number);
            const nextMonth = new Date(year, month, 1);
            const end = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;
            try {
                // A staff-scoped equality query is required so Firestore rules can
                // prove teachers only read their own observations. Date filtering
                // stays client-side to avoid requiring a new composite index.
                let query = db.collection('shift_observations');
                if (staffId) {
                    query = query.where('teacherId', '==', staffId);
                } else {
                    query = query.where('dateKey', '>=', start).where('dateKey', '<', end);
                }
                const snap = await query.get();
                return snap.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(item => item.dateKey >= start && item.dateKey < end)
                    .filter(item => !staffId || item.teacherId === staffId);
            } catch (e) {
                console.error('[ShiftOversight] Error loading monthly observations:', e);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    async getShiftObservationsByRange(fromDate, toDate) {
        if (!fromDate || !toDate) return [];
        try {
            const snap = await db.collection('shift_observations')
                .where('dateKey', '>=', fromDate)
                .where('dateKey', '<=', toDate)
                .get();
            return snap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => {
                    const dateCmp = String(b.dateKey || '').localeCompare(String(a.dateKey || ''));
                    if (dateCmp !== 0) return dateCmp;
                    return Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0);
                });
        } catch (e) {
            console.error('[ShiftOversight] Error loading observation range:', e);
            return [];
        }
    },

    async createShiftObservation(payload) {
        const authUser = firebase.auth().currentUser;
        if (!authUser) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');

        const required = ['dateKey', 'branch', 'shiftKey', 'teacherId', 'classStart', 'classEnd'];
        const missing = required.find(field => !payload?.[field]);
        if (missing) throw new Error(`Thiếu dữ liệu bắt buộc: ${missing}`);

        const lateMinutes = Math.max(0, Math.min(240, Math.round(Number(payload.lateMinutes) || 0)));
        const note = String(payload.note || '').trim().slice(0, 500);
        if (lateMinutes === 0 && !note) {
            throw new Error('Vui lòng nhập số phút trễ hoặc nội dung ghi chú.');
        }

        const creatorStaffId = localStorage.getItem('currentUserId') || '';
        const creatorName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || '';
        if (!creatorStaffId) throw new Error('Không xác định được người tạo lệnh.');

        const ref = await db.collection('shift_observations').add({
            dateKey: payload.dateKey,
            branch: payload.branch,
            shiftKey: payload.shiftKey,
            scheduleCompositeKey: payload.scheduleCompositeKey || `${payload.branch}__${payload.dateKey}`,
            classSectionKey: payload.classSectionKey || '',
            classIndex: Number.isInteger(payload.classIndex) ? payload.classIndex : Number(payload.classIndex || 0),
            classStart: payload.classStart,
            classEnd: payload.classEnd,
            className: String(payload.className || '').slice(0, 160),
            subjectId: payload.subjectId || '',
            teacherId: payload.teacherId,
            teacherName: String(payload.teacherName || '').slice(0, 160),
            lateMinutes,
            systemLateAtCreation: Math.max(0, Math.round(Number(payload.systemLateAtCreation) || 0)),
            effectiveLateAtCreation: Math.max(lateMinutes, Math.round(Number(payload.systemLateAtCreation) || 0)),
            note,
            kind: lateMinutes > 0 ? 'late_adjustment' : 'note',
            status: 'active',
            createdByStaffId: creatorStaffId,
            createdByName: creatorName,
            createdByAuthUid: authUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        DBService._invalidate('shift_observations_');
        return ref.id;
    },

    async cancelShiftObservation(observationId, reason = '') {
        if (!observationId) throw new Error('Thiếu mã lệnh cần hủy.');
        const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';
        await db.collection('shift_observations').doc(observationId).update({
            status: 'cancelled',
            cancelledByName: adminName,
            cancelReason: String(reason || '').trim().slice(0, 300),
            cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        DBService._invalidate('shift_observations_');
        return true;
    },

    // ================= DAILY NOTES (Firestore-synced) =================

    // Get all daily notes for a staff member
    async getDailyNotes(staffId, options = {}) {
        if (!staffId || staffId.trim() === '') {
            console.warn('[DailyNotes] staffId is empty, skipping.');
            return {};
        }
        const cacheKey = `daily_notes_${staffId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = db.collection('daily_notes').doc(staffId).get()
            .then(doc => doc.exists ? doc.data() : {});

        DBService._cache[cacheKey] = promise;
        try {
            return await promise;
        } catch (e) {
            DBService._invalidate(cacheKey);
            console.error('[DailyNotes] Error getting:', e);
            if (options.strict === true) throw e;
            return {};
        }
    },

    // Save daily notes for a staff member (full object: { "2026-03-01": "note text", ... })
    async saveDailyNotes(staffId, notesObj) {
        try {
            await db.collection('daily_notes').doc(staffId).set(notesObj);
            DBService._invalidate(`daily_notes_${staffId}`);
            return true;
        } catch (e) {
            console.error('[DailyNotes] Error saving:', e);
            throw e;
        }
    },

    // ================= SALARY SETTINGS (Firestore-synced) =================

    // Get salary settings for a staff member
    async getSalarySettings(staffId) {
        if (!staffId || staffId.trim() === '') {
            console.warn('[SalarySettings] staffId is empty, skipping.');
            return {};
        }
        try {
            const doc = await db.collection('salary_settings').doc(staffId).get();
            return doc.exists ? doc.data() : {};
        } catch (e) {
            console.error('[SalarySettings] Error getting:', e);
            return {};
        }
    },

    // ================= PAYROLL AUTOMATION PROFILES =================
    // Kept separate from users.salary_config and salary_settings_monthly so a
    // future automation rollout cannot overwrite a legacy rate or payslip.
    async getStaffPayrollProfile(staffId) {
        if (!staffId || String(staffId).trim() === '') return { exists: false };
        try {
            const doc = await db.collection('staff_payroll_profiles').doc(staffId).get();
            return doc.exists ? Object.assign({ exists: true }, doc.data()) : { exists: false };
        } catch (e) {
            console.error('[PayrollProfile] Error getting:', e);
            throw e;
        }
    },

    async saveStaffPayrollProfile(staffId, profile) {
        if (!staffId || String(staffId).trim() === '') {
            throw new Error('[PayrollProfile] staffId is required.');
        }
        const payload = Object.assign({}, profile || {}, {
            staffId: staffId,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await db.collection('staff_payroll_profiles').doc(staffId).set(payload, { merge: true });
        return true;
    },

    // Save salary settings for a staff member
    async saveSalarySettings(staffId, settingsObj) {
        try {
            await db.collection('salary_settings').doc(staffId).set(settingsObj, { merge: true });
            return true;
        } catch (e) {
            console.error('[SalarySettings] Error saving:', e);
            throw e;
        }
    },

    // Get monthly salary settings for a staff member and specific month
    async getMonthlySalarySettings(staffId, monthStr) {
        if (!staffId || staffId.trim() === '' || !monthStr) {
            console.warn('[MonthlySalarySettings] staffId or monthStr is empty, skipping.');
            return {};
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            const doc = await db.collection('salary_settings_monthly').doc(docId).get();
            return doc.exists ? doc.data() : {};
        } catch (e) {
            console.error('[MonthlySalarySettings] Error getting:', e);
            return {};
        }
    },

    // Save monthly salary settings for a staff member and specific month
    async saveMonthlySalarySettings(staffId, monthStr, settingsObj) {
        if (!staffId || !monthStr) {
            throw new Error('[MonthlySalarySettings] staffId and monthStr are required.');
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            await db.collection('salary_settings_monthly').doc(docId).set(settingsObj, { merge: true });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return true;
        } catch (e) {
            console.error('[MonthlySalarySettings] Error saving:', e);
            throw e;
        }
    },

    // Pure lifecycle adapters are public so report.js and regression tests use
    // exactly the same legacy-compatible transition contract.
    getPayslipLifecycleState(published = {}) {
        return _getPayslipLifecycleState(published);
    },

    getPayslipPaymentBreakdown(published = {}) {
        return _getPayslipPaymentBreakdown(published);
    },

    getPayslipDraftLockState(published = {}, component = 'gv') {
        return _getPayslipDraftLockState(published, component);
    },

    preparePayslipDraftUpdate(currentPublished = {}, calculatedPublished = {}, component = 'gv', nowIso) {
        return _preparePayslipDraftUpdate(currentPublished, calculatedPublished, component, nowIso);
    },

    preparePayslipComponentPublish(published = {}, targets = {}, nowIso) {
        return _preparePayslipComponentPublish(published, targets, nowIso);
    },

    // Save a calculated draft against the latest Firestore state. This closes
    // the race where a stale report tab recalculated while another tab published
    // or confirmed the same component.
    async savePayslipDraft(staffId, monthStr, calculatedPublished, component = 'gv') {
        if (!staffId || !monthStr) {
            throw new Error('[SavePayslipDraft] staffId and monthStr are required.');
        }
        const docId = `${monthStr}_${staffId}`;
        const docRef = db.collection('salary_settings_monthly').doc(docId);
        let transition = null;

        try {
            await db.runTransaction(async transaction => {
                const docSnap = await transaction.get(docRef);
                const currentPublished = docSnap.exists ? (docSnap.data().published || {}) : {};
                transition = _preparePayslipDraftUpdate(
                    currentPublished,
                    calculatedPublished || {},
                    component
                );
                if (!transition.saved) return;

                if (docSnap.exists) {
                    transaction.update(docRef, { published: transition.published });
                } else {
                    transaction.set(docRef, { published: transition.published }, { merge: true });
                }
            });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return {
                ...transition,
                status: transition.saved ? 'draft_saved' : 'locked'
            };
        } catch (e) {
            console.error('[SavePayslipDraft] Error saving:', e);
            throw e;
        }
    },

    // Update exactly one calendar day. This avoids read-modify-write data loss
    // when two tabs edit different notes concurrently or a prior read failed.
    async updateDailyNote(staffId, dateKey, note) {
        if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) {
            throw new Error('Thiếu nhân sự hoặc ngày ghi chú hợp lệ.');
        }
        const normalizedNote = String(note || '').trim().slice(0, 2000);
        const ref = db.collection('daily_notes').doc(staffId);
        try {
            await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);
                if (normalizedNote) {
                    transaction.set(ref, { [dateKey]: normalizedNote }, { merge: true });
                } else if (snapshot.exists) {
                    transaction.update(ref, {
                        [dateKey]: firebase.firestore.FieldValue.delete()
                    });
                }
            });
            DBService._invalidate(`daily_notes_${staffId}`);
            return normalizedNote;
        } catch (e) {
            console.error('[DailyNotes] Error updating one day:', e);
            throw e;
        }
    },

    // Publish selected components from the current stored calculation. Used by
    // bulk publish so a stale modal cannot lower `received` back to `published`.
    async publishPayslipComponents(staffId, monthStr, targets = {}, message = '') {
        if (!staffId || !monthStr) {
            throw new Error('[PublishPayslipComponents] staffId and monthStr are required.');
        }
        const docId = `${monthStr}_${staffId}`;
        const docRef = db.collection('salary_settings_monthly').doc(docId);
        const nowIso = new Date().toISOString();
        let transition = null;

        try {
            await db.runTransaction(async transaction => {
                const docSnap = await transaction.get(docRef);
                const currentPublished = docSnap.exists ? (docSnap.data().published || {}) : {};
                transition = _preparePayslipComponentPublish(currentPublished, targets, nowIso);
                if (String(message || '').trim() && transition.publishedComponents.length > 0) {
                    transition.published.message = String(message).trim();
                }
                if (transition.publishedComponents.length === 0) return;

                if (docSnap.exists) {
                    transaction.update(docRef, { published: transition.published });
                } else {
                    transaction.set(docRef, { published: transition.published }, { merge: true });
                }
            });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return {
                ok: transition.publishedComponents.length > 0 || transition.lockedComponents.length > 0,
                status: transition.state.overallStatus,
                publishedComponents: transition.publishedComponents,
                lockedComponents: transition.lockedComponents,
                skippedComponents: transition.skippedComponents,
                lifecycle: transition.state
            };
        } catch (e) {
            console.error('[PublishPayslipComponents] Error publishing:', e);
            throw e;
        }
    },

    // Publish salary details to employee. The transaction prevents an older
    // browser tab from overwriting a receipt confirmation made in the meantime.
    async publishSalary(staffId, monthStr, payload) {
        if (!staffId || !monthStr) {
            throw new Error('[PublishSalary] staffId and monthStr are required.');
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            const docRef = db.collection('salary_settings_monthly').doc(docId);
            const nowIso = new Date().toISOString();
            let transition = null;

            await db.runTransaction(async transaction => {
                const docSnap = await transaction.get(docRef);
                const currentPublished = docSnap.exists ? (docSnap.data().published || {}) : {};
                transition = _preparePayslipPublishUpdate(currentPublished, payload || {}, nowIso);

                const requestedComponents = Object.values(transition.targets).filter(Boolean).length;
                if (requestedComponents === 0) {
                    const error = new Error('Không có thành phần bảng lương hợp lệ để gửi.');
                    error.code = 'payslip/no-publishable-component';
                    throw error;
                }
                if (transition.publishedComponents.length === 0
                    && transition.lockedComponents.length === 0) {
                    const error = new Error('Thành phần được chọn chưa có dữ liệu tính lương để gửi.');
                    error.code = 'payslip/no-component-details';
                    throw error;
                }

                if (docSnap.exists) {
                    transaction.update(docRef, { published: transition.published });
                } else {
                    transaction.set(docRef, { published: transition.published }, { merge: true });
                }
            });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return {
                ok: true,
                status: transition.state.overallStatus,
                publishedComponents: transition.publishedComponents,
                lockedComponents: transition.lockedComponents,
                skippedComponents: transition.skippedComponents,
                lifecycle: transition.state
            };
        } catch (e) {
            console.error('[PublishSalary] Error publishing:', e);
            throw e;
        }
    },

    // Confirm only components that are actually published. A dual-role payslip
    // reaches aggregate `received` only after both relevant components do.
    async confirmSalaryReceived(staffId, monthStr, confirmedBy = 'employee', component = 'all') {
        if (!staffId || !monthStr) {
            throw new Error('[ConfirmSalary] staffId and monthStr are required.');
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            const docRef = db.collection('salary_settings_monthly').doc(docId);
            const nowIso = new Date().toISOString();
            let transition = null;

            await db.runTransaction(async transaction => {
                const docSnap = await transaction.get(docRef);
                const currentPublished = docSnap.exists ? (docSnap.data().published || {}) : {};
                transition = _preparePayslipConfirmation(currentPublished, confirmedBy, nowIso, component);

                const receiptRequest = _getPayslipReceiptRequestState(currentPublished, component);
                if (!transition.changed && !receiptRequest.allReceived) {
                    const error = new Error('Bảng lương chưa được gửi nên chưa thể xác nhận đã nhận.');
                    error.code = 'payslip/not-published';
                    throw error;
                }

                if (docSnap.exists) {
                    transaction.update(docRef, { published: transition.published });
                } else {
                    transaction.set(docRef, { published: transition.published }, { merge: true });
                }
            });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return {
                ok: true,
                status: transition.state.overallStatus,
                receivedComponents: transition.receivedComponents,
                changed: transition.changed,
                lifecycle: transition.state
            };
        } catch (e) {
            console.error('[ConfirmSalary] Error confirming receipt:', e);
            throw e;
        }
    },

    // Get all monthly salary settings for a given month
    async getAllMonthlySalarySettings(monthStr) {
        if (!monthStr) return {};
        const cacheKey = `all_monthly_salary_settings_${monthStr}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snapshot = await db.collection('salary_settings_monthly').get();
                const results = {};
                snapshot.forEach(doc => {
                    if (doc.id.startsWith(monthStr + '_')) {
                        const sId = doc.id.substring(monthStr.length + 1);
                        results[sId] = doc.data();
                    }
                });
                return results;
            } catch (e) {
                console.error('[MonthlySalarySettings] Error getting all:', e);
                return {};
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    // Get receptionist collective bonus pool mốc configuration
    async getReceptionistBonusConfig() {
        try {
            const doc = await db.collection('settings').doc('receptionist_bonus').get();
            if (doc.exists) {
                return doc.data();
            }
            // Return defaults if document does not exist yet
            return {
                center_tiers: [
                    { revenue: 475000000, bonus: 1000000 },
                    { revenue: 500000000, bonus: 4000000 },
                    { revenue: 525000000, bonus: 7000000 }
                ],
                cs2_tiers: [
                    { revenue: 65000000, bonus: 500000 }
                ]
            };
        } catch (e) {
            console.error('[ReceptionistBonusConfig] Error getting config:', e);
            return {
                center_tiers: [
                    { revenue: 475000000, bonus: 1000000 },
                    { revenue: 500000000, bonus: 4000000 },
                    { revenue: 525000000, bonus: 7000000 }
                ],
                cs2_tiers: [
                    { revenue: 65000000, bonus: 500000 }
                ]
            };
        }
    },

    // Save receptionist collective bonus pool mốc configuration
    async saveReceptionistBonusConfig(config) {
        try {
            await db.collection('settings').doc('receptionist_bonus').set(config, { merge: true });
            return true;
        } catch (e) {
            console.error('[ReceptionistBonusConfig] Error saving config:', e);
            throw e;
        }
    },

    // ================= OVERTIME REQUESTS =================

    // Staff submits an overtime request (status: pending)
    // duration: "HH:MM" string, sessionId: the attendance session this OT belongs to
    createOvertimeRequest: async (staffId, staffName, dateKey, sessionId, duration) => {
        try {
            // Check duplicate: chỉ dùng 2 WHERE để tránh lỗi composite index Firestore,
            // filter sessionId + status ở client-side
            const dupSnap = await db.collection('overtime_requests')
                .where('staffId', '==', staffId)
                .where('dateKey', '==', dateKey)
                .get();
            const alreadyExists = dupSnap.docs.some(doc => {
                const d = doc.data();
                return String(d.sessionId) === String(sessionId) && d.status === 'pending';
            });
            if (alreadyExists) {
                throw new Error('Bạn đã gửi yêu cầu tăng ca cho ca này rồi!');
            }

            // Convert HH:MM to minutes
            const [h, m] = duration.split(':').map(Number);
            const minutes = (h || 0) * 60 + (m || 0);
            if (minutes <= 0) throw new Error('Số giờ tăng ca phải lớn hơn 0.');

            const docRef = await db.collection('overtime_requests').add({
                staffId,
                staffName: staffName || 'N/A',
                dateKey,
                sessionId: String(sessionId),
                duration,     // "HH:MM"
                minutes,
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                approvedBy: null,
                approvedAt: null
            });
            DBService._invalidate('overtime_requests_staff_');
            console.log('[OT] Request created:', docRef.id);
            return docRef.id;
        } catch (e) {
            console.error('[OT] Error creating request:', e);
            throw e;
        }
    },

    // Admin: get all pending overtime requests
    getPendingOvertimeRequests: async () => {
        try {
            const snap = await db.collection('overtime_requests')
                .where('status', '==', 'pending')
                .limit(50)
                .get();
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            list.sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || ''));
            return list;
        } catch (e) {
            console.warn('[OT] Error getting pending requests:', e);
            return [];
        }
    },

    // Admin approves an overtime request → mark approved
    approveOvertimeRequest: async (requestId, adminName) => {
        try {
            await db.collection('overtime_requests').doc(requestId).update({
                status: 'approved',
                approvedBy: adminName || 'Admin',
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            DBService._invalidate('overtime_requests_staff_');
            console.log('[OT] Approved:', requestId);
        } catch (e) {
            console.error('[OT] Error approving:', e);
            throw e;
        }
    },

    // Admin rejects an overtime request
    rejectOvertimeRequest: async (requestId, adminName) => {
        try {
            await db.collection('overtime_requests').doc(requestId).update({
                status: 'rejected',
                approvedBy: adminName || 'Admin',
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            DBService._invalidate('overtime_requests_staff_');
            console.log('[OT] Rejected:', requestId);
        } catch (e) {
            console.error('[OT] Error rejecting:', e);
            throw e;
        }
    },

    saveAdminOvertimeConfig: async (staffId, staffName, dateKey, sessionId, minutes) => {
        try {
            const numericMinutes = Number(minutes);
            if (!Number.isSafeInteger(numericMinutes) || numericMinutes < 0) {
                throw new Error('Số phút tăng ca phải là số nguyên từ 0 trở lên.');
            }
            if (!staffId || !sessionId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
                throw new Error('Thiếu ngày hoặc phiên công cần chỉnh tăng ca.');
            }
            const snap = await db.collection('overtime_requests')
                .where('staffId', '==', staffId)
                .where('dateKey', '==', dateKey)
                .get();
            const matching = snap.docs.filter(doc => String(doc.data()?.sessionId) === String(sessionId));
            if (!matching.length && numericMinutes === 0) return;
            const canonicalId = 'ot_admin_' + [dateKey, staffId, String(sessionId)].map(encodeURIComponent).join('~');
            const ids = matching.length ? matching.map(doc => doc.id) : [canonicalId];
            if (ids.length > 100) throw new Error('Có quá nhiều bản tăng ca trùng phiên; cần kiểm tra trước khi lưu.');
            const refs = ids.map(id => db.collection('overtime_requests').doc(id));
            const adminName = localStorage.getItem('currentUserName') || 'Admin';
            const duration = `${String(Math.floor(numericMinutes / 60)).padStart(2, '0')}:${String(numericMinutes % 60).padStart(2, '0')}`;
            await db.runTransaction(async transaction => {
                const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
                snapshots.forEach((snapshot, index) => {
                    const previous = snapshot.exists ? snapshot.data() : null;
                    if (previous && (previous.staffId !== staffId || previous.dateKey !== dateKey || String(previous.sessionId) !== String(sessionId))) {
                        throw new Error('Phiên tăng ca đã thay đổi. Vui lòng tải lại trước khi lưu.');
                    }
                    transaction.set(refs[index], {
                        ...(previous || {}),
                        staffId, staffName: staffName || previous?.staffName || '', dateKey,
                        sessionId: String(sessionId), minutes: numericMinutes, duration,
                        status: numericMinutes > 0 ? 'approved' : 'rejected',
                        approvedBy: adminName,
                        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        ...(!previous ? {createdAt: firebase.firestore.FieldValue.serverTimestamp()} : {})
                    });
                });
            });
            DBService._invalidate('overtime_requests_staff_');
            console.log('[OT] Saved admin overtime config:', staffId, sessionId, minutes);
        } catch (e) {
            console.error('[OT] Error saving overtime config:', e);
            throw e;
        }
    },

    // Get overtime requests for a specific staff member in a month ("YYYY-MM")
    getOvertimeRequestsForStaff: async (staffId, monthStr) => {
        if (!staffId || staffId.trim() === '') return [];
        const cacheKey = `overtime_requests_staff_${staffId}_${monthStr || 'all'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snap = await db.collection('overtime_requests')
                    .where('staffId', '==', staffId)
                    .limit(100)
                    .get();
                const list = snap.docs.map(doc => _normalizeOvertimeRequest({ id: doc.id, ...doc.data() }));
                // Filter by month client-side to avoid composite index
                return monthStr
                    ? list.filter(r => r.dateKey && r.dateKey.startsWith(monthStr))
                    : list;
            } catch (e) {
                console.warn('[OT] Error getting staff requests:', e);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    // 10. Fixed Shifts (Receptionist)
    getFixedShifts: async (monthStr, userId) => {
        if (!userId || userId.trim() === '') {
            console.warn('[FixedShifts] userId is empty, skipping.');
            return [];
        }
        const cacheKey = `fixed_shifts_${monthStr}_${userId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const docId = `${monthStr}_${userId}`;
                const doc = await db.collection('fixed_shifts').doc(docId).get();
                return doc.exists ? doc.data().shifts || [] : [];
            } catch (error) {
                console.error("Error getting fixed shifts:", error);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    saveFixedShifts: async (monthStr, userId, shiftsArr) => {
        try {
            const docId = `${monthStr}_${userId}`;
            await db.collection('fixed_shifts').doc(docId).set({
                userId,
                month: monthStr,
                shifts: shiftsArr,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            DBService._invalidate(`fixed_shifts_${monthStr}_${userId}`);
            return true;
        } catch (error) {
            console.error("Error saving fixed shifts:", error);
            throw error;
        }
    },

    // ================= CANCELLED SHIFTS (ADMIN) =================

    getCancelledShifts: async (monthStr, staffId) => {
        if (!staffId || staffId.trim() === '') {
            console.warn('[CancelledShifts] staffId is empty, skipping.');
            return [];
        }
        const cacheKey = `cancelled_shifts_${monthStr}_${staffId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const docId = `${monthStr}_${staffId}`;
                const doc = await db.collection('cancelled_shifts').doc(docId).get();
                return doc.exists ? doc.data().shifts || [] : [];
            } catch (error) {
                console.error("[CancelledShifts] Error getting:", error);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getAllCancelledShifts: async (monthStr) => {
        try {
            const snapshot = await db.collection('cancelled_shifts').where('month', '==', monthStr).get();
            const map = {};
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.userId && data.shifts) {
                    map[data.userId] = data.shifts;
                }
            });
            return map;
        } catch (error) {
            console.error("[CancelledShifts] Error getting all:", error);
            return {};
        }
    },

    cancelShift: async (monthStr, staffId, shiftKey) => {
        try {
            const docId = `${monthStr}_${staffId}`;
            const res = await db.runTransaction(async (t) => {
                const docRef = db.collection('cancelled_shifts').doc(docId);
                const doc = await t.get(docRef);
                let shifts = [];
                if (doc.exists) {
                    shifts = doc.data().shifts || [];
                }

                if (!shifts.includes(shiftKey)) {
                    shifts.push(shiftKey);
                }

                t.set(docRef, {
                    userId: staffId,
                    month: monthStr,
                    shifts: shifts,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                return true;
            });
            DBService._invalidate(`cancelled_shifts_${monthStr}_${staffId}`);
            return res;
        } catch (error) {
            console.error("[CancelledShifts] Error saving:", error);
            throw error;
        }
    },

    // Shared input bundle for calculateDailyChips(). Chấm Công previously passed only
    // schedule + attendance while Bảng Công also passed cancellations, overtime,
    // receptionist observations and bonus state, producing different chips for one day.
    loadDailyEvaluationContext: async (staffId, dateKey) => {
        if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) {
            throw new Error('Thiếu nhân sự hoặc ngày cần đánh giá.');
        }
        const monthStr = dateKey.slice(0, 7);
        const [cancelledShifts, observations, overtimeRequests, bonusRequests, monthlySettings] = await Promise.all([
            DBService.getCancelledShifts(monthStr, staffId),
            DBService.getShiftObservationsForDate(dateKey, staffId),
            DBService.getOvertimeRequestsForStaff(staffId, monthStr),
            DBService.getBonus10RequestsForStaff(staffId, monthStr),
            DBService.getMonthlySalarySettings(staffId, monthStr)
        ]);
        const overtimeMap = {};
        (overtimeRequests || []).filter(item => item.dateKey === dateKey).forEach(item => {
            const key = String(item.sessionId || '');
            if (!key) return;
            const existing = overtimeMap[key];
            if (!existing || item.status === 'approved' || (item.status === 'pending' && existing.status === 'rejected')) {
                overtimeMap[key] = item;
            }
        });
        const bonus10Map = {};
        (bonusRequests || []).forEach(item => {
            const key = String(item.sessionId || '');
            if (!key) return;
            if (!Array.isArray(bonus10Map[key])) bonus10Map[key] = [];
            bonus10Map[key].push(item);
        });
        return {
            cancelledShifts: cancelledShifts || [],
            shiftObservations: (observations || []).filter(item => !item.teacherId || item.teacherId === staffId),
            overtimeMap,
            bonus10Map,
            monthFlags: {
                early10PenaltyActive: _isBonus10PenaltyActive(monthlySettings || {}, bonusRequests || [])
            }
        };
    },

    restoreCancelledShift: async (monthStr, staffId, shiftKey) => {
        try {
            const docId = `${monthStr}_${staffId}`;
            const result = await db.runTransaction(async transaction => {
                const docRef = db.collection('cancelled_shifts').doc(docId);
                const doc = await transaction.get(docRef);
                if (!doc.exists) return false;

                const data = doc.data() || {};
                const shifts = (Array.isArray(data.shifts) ? data.shifts : [])
                    .filter(key => key !== shiftKey);

                transaction.set(docRef, {
                    userId: staffId,
                    month: monthStr,
                    shifts,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                return true;
            });
            DBService._invalidate(`cancelled_shifts_${monthStr}_${staffId}`);
            return result;
        } catch (error) {
            console.error('[CancelledShifts] Error restoring:', error);
            throw error;
        }
    },

    // ================= BONUS 10P REQUESTS =================

    createBonus10Request: async (staffId, staffName, dateKey, sessionId, eligibilityMeta = null) => {
        try {
            const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
            const actorUserId = String(authorization.userId || '').trim();
            const isManager = (authorization.roles || [])
                .some(role => role === 'admin' || role === 'senior_assistant');
            if (!actorUserId || (actorUserId !== String(staffId) && !isManager)) {
                const error = new Error('Bạn chỉ có thể gửi yêu cầu +10 phút cho chính mình.');
                error.code = 'auth/owner-required';
                throw error;
            }
            const claim = _normalizeBonus10ClaimMeta({
                ...(eligibilityMeta || {}),
                dateKey,
                staffId
            });
            const identity = _normalizeBonus10Identity({
                staffId, dateKey, sessionId, targetShiftKey: claim.targetShiftKey
            });
            const monthStr = identity.dateKey.slice(0, 7);
            const requestId = _canonicalBonus10RequestId(
                identity.dateKey,
                identity.staffId,
                identity.sessionId,
                identity.targetShiftKey
            );
            const requestRef = db.collection('bonus10_requests').doc(requestId);
            const monthlyRef = db.collection('salary_settings_monthly')
                .doc(`${monthStr}_${identity.staffId}`);
            const attendanceRef = db.collection('attendance_logs')
                .doc(`${identity.dateKey}_${identity.staffId}`);
            const checkInProofRef = db.collection('attendance_checkin_proofs')
                .doc(`${identity.dateKey}~${identity.staffId}~${identity.sessionId}`);
            const profileRef = db.collection('users').doc(identity.staffId);
            const subjectRef = db.collection('subjects').doc(claim.subjectId);
            const scheduleRef = db.collection('schedules').doc(claim.scheduleDocId);
            const registrationRef = claim.scheduleRegistrationId
                ? db.collection('schedule_registrations').doc(claim.scheduleRegistrationId)
                : null;
            const knownSnapshot = await db.collection('bonus10_requests')
                .where('staffId', '==', identity.staffId)
                .limit(400)
                .get();
            const requestRefsById = new Map([[requestId, requestRef]]);
            knownSnapshot.docs
                .filter(doc => String(doc.data()?.dateKey || '').startsWith(`${monthStr}-`))
                .forEach(doc => requestRefsById.set(doc.id, doc.ref));
            const requestRefs = Array.from(requestRefsById.values());

            await db.runTransaction(async transaction => {
                const snapshots = await Promise.all([
                    transaction.get(monthlyRef),
                    transaction.get(attendanceRef),
                    transaction.get(profileRef),
                    transaction.get(subjectRef),
                    transaction.get(scheduleRef),
                    transaction.get(checkInProofRef),
                    ...(registrationRef ? [transaction.get(registrationRef)] : []),
                    ...requestRefs.map(ref => transaction.get(ref))
                ]);
                const monthlySnapshot = snapshots[0];
                const attendanceSnapshot = snapshots[1];
                const profileSnapshot = snapshots[2];
                const subjectSnapshot = snapshots[3];
                const scheduleSnapshot = snapshots[4];
                const checkInProofSnapshot = snapshots[5];
                const registrationSnapshot = registrationRef ? snapshots[6] : null;
                const requestSnapshots = snapshots.slice(registrationRef ? 7 : 6);
                const monthlyRequests = requestSnapshots
                    .filter(snapshot => snapshot.exists)
                    .map(snapshot => ({ id: snapshot.id, ...snapshot.data() }))
                    .filter(request => String(request.dateKey || '').startsWith(`${monthStr}-`));
                if (_isBonus10PenaltyActive(
                    monthlySnapshot.exists ? monthlySnapshot.data() : {},
                    monthlyRequests
                )) {
                    throw new Error('Phụ cấp +10 phút của tháng này đang bị khóa; không thể gửi thêm yêu cầu.');
                }
                if (!scheduleSnapshot.exists) {
                    const error = new Error('Ca này vẫn là lịch kế thừa. Admin cần lưu lịch riêng cho ngày này trước khi gửi +10 phút.');
                    error.code = 'bonus10/schedule-not-materialized';
                    throw error;
                }
                if (!attendanceSnapshot.exists || !profileSnapshot.exists || !subjectSnapshot.exists ||
                    !checkInProofSnapshot.exists) {
                    throw new Error('Không tìm thấy đủ dữ liệu nhân sự, chấm công, môn học hoặc lịch dạy để tự duyệt +10 phút.');
                }
                const existingRequest = requestSnapshots.find(snapshot => snapshot.id === requestId);
                if (existingRequest?.exists) {
                    const existingData = existingRequest.data() || {};
                    _assertBonus10RequestIdentity(existingData, identity);
                    if (existingData.status === 'approved' &&
                        existingData.awardScope === 'teaching_shift' &&
                        existingData.targetShiftKey === identity.targetShiftKey) return;
                    throw new Error('Ca này đã có một yêu cầu +10 phút khác trạng thái. Hãy tải lại bảng công.');
                }
                const duplicate = monthlyRequests.find(request =>
                    String(request.dateKey || '') === identity.dateKey &&
                    String(request.sessionId || '') === identity.sessionId &&
                    String(request.targetShiftKey || '') === identity.targetShiftKey &&
                    ['pending', 'approved'].includes(String(request.status || ''))
                );
                if (duplicate) {
                    throw new Error('Bạn đã gửi yêu cầu sớm 10p cho ca này rồi!');
                }

                const attendance = attendanceSnapshot.data() || {};
                const sessions = Array.isArray(attendance.sessions) ? attendance.sessions : [];
                const attendanceSessionIndex = sessions.findIndex(session =>
                    String(session?.id || '') === identity.sessionId
                );
                if (attendanceSessionIndex < 0) {
                    throw new Error('Không tìm thấy phiên vào/ra dùng làm bằng chứng cho ca này.');
                }
                const liveSession = sessions[attendanceSessionIndex] || {};
                const liveCheckIn = String(liveSession.checkIn || liveSession.start || '').trim();
                if (!liveCheckIn || liveCheckIn !== claim.checkInAt) {
                    const error = new Error('Giờ vào ca vừa thay đổi. Hãy tải lại bảng công trước khi gửi +10 phút.');
                    error.code = 'bonus10/policy-conflict';
                    throw error;
                }
                const checkInProof = checkInProofSnapshot.data() || {};
                const proofTime = checkInProof.recordedAt;
                if (String(checkInProof.staffId || '') !== identity.staffId ||
                    String(checkInProof.dateKey || '') !== identity.dateKey ||
                    String(checkInProof.sessionId || '') !== identity.sessionId ||
                    (actorUserId === identity.staffId && String(checkInProof.authUid || '') !== authorization.uid) ||
                    !proofTime || typeof proofTime.toDate !== 'function') {
                    const error = new Error('Bằng chứng giờ vào ca từ máy chủ không hợp lệ. Hãy Vào ca lại bằng phiên bản ứng dụng mới nhất.');
                    error.code = 'bonus10/checkin-proof-required';
                    throw error;
                }

                const schedule = scheduleSnapshot.data() || {};
                const scheduleRows = Array.isArray(schedule[claim.scheduleSection])
                    ? schedule[claim.scheduleSection]
                    : [];
                const row = scheduleRows[claim.scheduleIndex];
                if (!row || String(row.start || '') !== claim.classStart ||
                    String(row.end || '') !== claim.classEnd ||
                    String(row.shiftId || '') !== claim.scheduleShiftId) {
                    const error = new Error('Lịch dạy đã thay đổi. Hãy tải lại bảng công trước khi gửi +10 phút.');
                    error.code = 'bonus10/policy-conflict';
                    throw error;
                }
                const liveTargetShiftKey = _bonus10TargetShiftKey(
                    identity.dateKey,
                    claim.scheduleDocId,
                    claim.scheduleSection,
                    claim.scheduleIndex,
                    row.shiftId || '',
                    row.start || '',
                    row.end || ''
                );
                const rowSubjectIds = _normalizeScheduleSubjectIds(row.lopId);
                if (liveTargetShiftKey !== claim.targetShiftKey || !rowSubjectIds.includes(claim.subjectId)) {
                    const error = new Error('Môn/Lớp hoặc định danh ca dạy vừa thay đổi. Hãy tải lại bảng công.');
                    error.code = 'bonus10/policy-conflict';
                    throw error;
                }

                const claimedAssignmentList = claim.scheduleAssignmentList;
                const claimedAssignmentEntry = claim.scheduleAssignmentEntry;
                const liveAssignmentEntry = claimedAssignmentList
                    ? (Array.isArray(row[claimedAssignmentList]) ? row[claimedAssignmentList] : [])
                        .find(entry => String(entry?.id || '') === identity.staffId)
                    : null;
                if (claimedAssignmentList && !liveAssignmentEntry) {
                    throw new Error('Thông tin phân công của ca đã thay đổi. Hãy tải lại bảng công trước khi gửi +10 phút.');
                }
                let hasVerifiedAssignment = isAssignedToClass(row, identity.staffId);
                if (!hasVerifiedAssignment && registrationSnapshot?.exists) {
                    const registration = registrationSnapshot.data() || {};
                    hasVerifiedAssignment = registration.status === 'active' &&
                        String(registration.userId || '') === identity.staffId &&
                        String(registration.scheduleDocId || '') === claim.scheduleDocId &&
                        String(registration.section || '') === claim.scheduleSection &&
                        Number(registration.rowIndex) === claim.scheduleIndex &&
                        (!claim.scheduleShiftId || String(registration.shiftId || '') === claim.scheduleShiftId);
                }
                if (!hasVerifiedAssignment) {
                    throw new Error('Nhân viên không còn được xếp hoặc đăng ký dạy ca này.');
                }

                const subject = { id: subjectSnapshot.id, ...subjectSnapshot.data() };
                const profile = { id: profileSnapshot.id, ...profileSnapshot.data() };
                const policyVerdict = window.Early10.evaluateEarly10Request({
                    subjectIds: [claim.subjectId],
                    subjects: [subject],
                    user: profile,
                    // Entitlement uses the immutable server receipt. The ISO value
                    // in attendance_logs is retained only as display/link data.
                    checkIn: proofTime,
                    classStart: row.start
                });
                if (!policyVerdict?.ok) {
                    const error = new Error(policyVerdict?.message || 'Ca này không còn đủ điều kiện +10 phút.');
                    error.code = 'bonus10/policy-conflict';
                    throw error;
                }
                const actorDisplayName = String(
                    authorization.roleData?.name || authorization.roleData?.username || staffName || actorUserId
                ).trim().slice(0, 120);
                transaction.set(requestRef, {
                    staffId: identity.staffId,
                    staffName: String(profile.name || profile.username || staffName || 'N/A').slice(0, 120),
                    dateKey: identity.dateKey,
                    sessionId: identity.sessionId,
                    status: 'approved',
                    awardScope: claim.awardScope,
                    targetShiftKey: claim.targetShiftKey,
                    subjectId: claim.subjectId,
                    scheduleDocId: claim.scheduleDocId,
                    scheduleSection: claim.scheduleSection,
                    scheduleIndex: claim.scheduleIndex,
                    scheduleShiftId: claim.scheduleShiftId,
                    scheduleRegistrationId: claim.scheduleRegistrationId,
                    scheduleAssignmentList: claim.scheduleAssignmentList,
                    scheduleAssignmentEntry: claim.scheduleAssignmentList
                        ? { ...claimedAssignmentEntry }
                        : {},
                    classStart: claim.classStart,
                    classEnd: claim.classEnd,
                    attendanceSessionIndex,
                    earlyMinutes: policyVerdict.earlyMinutes,
                    checkInAt: liveCheckIn,
                    scheduledStart: row.start,
                    requestSource: 'staff_auto_approved',
                    authUid: authorization.uid,
                    schemaVersion: 2,
                    policyVersion: 'early10-shift-v2',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    approvedBy: actorUserId,
                    approvedByName: actorDisplayName,
                    approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            DBService._invalidate('bonus10_requests_');
            console.log('[Bonus10] Shift-scoped request auto-approved:', requestId);
            return requestId;
        } catch (e) {
            console.error('[Bonus10] Error creating:', e);
            throw e;
        }
    },

    // Compatibility entry point used by the report UI. The transaction above
    // re-reads all live policy evidence; Firestore rules independently constrain
    // the approved document to the authenticated owner and exact schedule/session.
    createApprovedBonus10Request: async (staffId, staffName, dateKey, sessionId, meta) => {
        return DBService.createBonus10Request(staffId, staffName, dateKey, sessionId, meta);
    },

    getBonus10RequestsForStaff: async (staffId, monthStr) => {
        if (!staffId || staffId.trim() === '') {
            console.warn('[Bonus10] staffId is empty, skipping.');
            return [];
        }
        const cacheKey = `bonus10_requests_staff_${staffId}_${monthStr || 'all'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snap = await db.collection('bonus10_requests')
                    .where('staffId', '==', staffId)
                    .limit(200)
                    .get();
                const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                return monthStr
                    ? list.filter(r => r.dateKey && r.dateKey.startsWith(monthStr))
                    : list;
            } catch (e) {
                console.warn('[Bonus10] Error getting staff requests:', e);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getPendingBonus10Requests: async () => {
        try {
            const snap = await db.collection('bonus10_requests')
                .where('status', '==', 'pending')
                .limit(100)
                .get();
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            list.sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || ''));
            return list;
        } catch (e) {
            console.warn('[Bonus10] Error getting pending:', e);
            return [];
        }
    },

    _approveBonus10RequestLegacyDisabled: async (requestId, adminName, staffId, dateKey, sessionId) => {
        try {
            const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
            const actorUserId = _requireBonus10ManagerAuthorization(authorization);
            const actorDisplayName = String(
                authorization.roleData?.name || authorization.roleData?.username || adminName || actorUserId
            ).trim().slice(0, 120);
            const identity = _normalizeBonus10Identity({ staffId, dateKey, sessionId });
            const normalizedRequestId = String(requestId || '').trim();
            if (!normalizedRequestId || normalizedRequestId.includes('/')) {
                throw new Error('Mã yêu cầu +10 phút không hợp lệ.');
            }
            const monthStr = identity.dateKey.slice(0, 7);
            const requestRef = db.collection('bonus10_requests').doc(normalizedRequestId);
            const attendanceRef = db.collection('attendance_logs')
                .doc(`${identity.dateKey}_${identity.staffId}`);
            const monthlyRef = db.collection('salary_settings_monthly')
                .doc(`${monthStr}_${identity.staffId}`);
            const profileRef = db.collection('users').doc(identity.staffId);

            // Resolve only the current session's role IDs outside the transaction;
            // all source documents are re-read below and any changed role set is
            // rejected rather than approved against stale policy inputs.
            const [preAttendanceSnapshot, knownSnapshot] = await Promise.all([
                attendanceRef.get({ source: 'server' }),
                db.collection('bonus10_requests')
                    .where('staffId', '==', identity.staffId)
                    .limit(400)
                    .get({ source: 'server' })
            ]);
            const preSession = (preAttendanceSnapshot.data()?.sessions || [])
                .find(session => String(session?.id || '') === identity.sessionId);
            if (!preSession) throw new Error('Không tìm thấy phiên vào/ra tương ứng để cộng 10 phút.');
            const roleIds = window.Early10.splitSubjectIds(preSession.role)
                .map(value => String(value || '').trim())
                .filter(Boolean);
            if (!roleIds.length) throw new Error('Phiên công chưa có mã Môn/Lớp hợp lệ để duyệt +10 phút.');
            const subjectRefs = Array.from(new Set(roleIds))
                .map(id => db.collection('subjects').doc(id));
            const requestRefsById = new Map([[normalizedRequestId, requestRef]]);
            knownSnapshot.docs
                .filter(doc => String(doc.data()?.dateKey || '').startsWith(`${monthStr}-`))
                .forEach(doc => requestRefsById.set(doc.id, doc.ref));
            const requestRefs = Array.from(requestRefsById.values());

            await db.runTransaction(async transaction => {
                const snapshots = await Promise.all([
                    transaction.get(attendanceRef),
                    transaction.get(monthlyRef),
                    transaction.get(profileRef),
                    ...subjectRefs.map(ref => transaction.get(ref)),
                    ...requestRefs.map(ref => transaction.get(ref))
                ]);
                const attendanceSnapshot = snapshots[0];
                const monthlySnapshot = snapshots[1];
                const profileSnapshot = snapshots[2];
                const subjectSnapshots = snapshots.slice(3, 3 + subjectRefs.length);
                const requestSnapshots = snapshots.slice(3 + subjectRefs.length);
                const requestSnapshot = requestSnapshots.find(snapshot => snapshot.id === normalizedRequestId);
                if (!requestSnapshot?.exists) throw new Error('Yêu cầu +10 phút không còn tồn tại.');
                if (!attendanceSnapshot.exists) throw new Error('Không tìm thấy dữ liệu chấm công của ca này.');
                if (!profileSnapshot.exists || subjectSnapshots.some(snapshot => !snapshot.exists)) {
                    throw new Error('Hồ sơ nhân sự hoặc Môn/Lớp đã thay đổi; chưa thể duyệt +10 phút.');
                }

                const request = requestSnapshot.data() || {};
                _assertBonus10RequestIdentity(request, identity);
                if (String(request.status || '') !== 'pending') {
                    throw new Error('Chỉ yêu cầu đang chờ duyệt mới được duyệt +10 phút.');
                }
                const monthlyRequests = requestSnapshots
                    .filter(snapshot => snapshot.exists)
                    .map(snapshot => ({ id: snapshot.id, ...snapshot.data() }))
                    .filter(item => String(item.dateKey || '').startsWith(`${monthStr}-`));
                const monthlySettings = monthlySnapshot.exists ? monthlySnapshot.data() : {};
                const attendance = attendanceSnapshot.data() || {};
                const sessions = Array.isArray(attendance.sessions)
                    ? attendance.sessions.map(session => ({ ...session }))
                    : [];
                if (_isBonus10PenaltyActive(monthlySettings, [
                    ...monthlyRequests,
                    ...sessions.map(candidate => ({
                        studentCountStatus: candidate?.studentCountStatus
                    }))
                ])) {
                    throw new Error('Phụ cấp +10 phút của tháng này đang bị khóa; không thể duyệt yêu cầu.');
                }
                const index = sessions.findIndex(session => String(session?.id || '') === identity.sessionId);
                if (index < 0) throw new Error('Không tìm thấy phiên vào/ra tương ứng để cộng 10 phút.');
                const liveRoleIds = window.Early10.splitSubjectIds(sessions[index].role)
                    .map(value => String(value || '').trim())
                    .filter(Boolean);
                if (!_sameScheduleSubjectIdSet(liveRoleIds, roleIds)) {
                    const error = new Error('Môn/Lớp của phiên công vừa thay đổi. Hãy mở lại yêu cầu trước khi duyệt.');
                    error.code = 'bonus10/policy-conflict';
                    throw error;
                }
                const scheduledStart = String(
                    sessions[index].linkedClassStart || request.scheduledStart || ''
                ).trim();
                const policyVerdict = window.Early10.evaluateEarly10Request({
                    sessionRole: sessions[index].role,
                    subjectIds: liveRoleIds,
                    subjects: subjectSnapshots.map(snapshot => ({ id: snapshot.id, ...snapshot.data() })),
                    user: { id: profileSnapshot.id, ...profileSnapshot.data() },
                    checkIn: sessions[index].checkIn || sessions[index].start,
                    classStart: scheduledStart
                });
                if (!policyVerdict?.ok) {
                    const error = new Error(policyVerdict?.message || 'Ca này không còn đủ điều kiện +10 phút.');
                    error.code = 'bonus10/policy-conflict';
                    throw error;
                }
                transaction.update(requestRef, {
                    status: 'approved',
                    approvedBy: actorUserId,
                    approvedByName: actorDisplayName,
                    approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    earlyMinutes: policyVerdict.earlyMinutes ?? null,
                    checkInAt: policyVerdict.checkInLabel ?? null,
                    scheduledStart: policyVerdict.startLabel ?? scheduledStart
                });
                transaction.set(attendanceRef, {
                    sessions,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            });
            DBService._invalidate('bonus10_requests_');
            DBService._invalidateAttendance(identity.dateKey, identity.staffId);
            console.log('[Bonus10] Approved:', requestId);
        } catch (e) {
            console.error('[Bonus10] Error approving:', e);
            throw e;
        }
    },

    // Admin approval upgrades an old pending request into the same exact
    // teaching-shift schema used by self auto-approval. It may resolve an old
    // session-only request, but only when current server data yields one and
    // only one eligible schedule row; ambiguity is never guessed.
    approveBonus10Request: async (requestId, adminName, staffId, dateKey, sessionId) => {
        try {
            if (!window.Early10 || typeof window.Early10.evaluateEarly10Request !== 'function') {
                throw new Error('Mô-đun quy định +10 phút chưa được tải. Vui lòng tải lại trang.');
            }
            const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
            const actorUserId = _requireBonus10ManagerAuthorization(authorization);
            const actorDisplayName = String(
                authorization.roleData?.name || authorization.roleData?.username || adminName || actorUserId
            ).trim().slice(0, 120);
            const identity = _normalizeBonus10Identity({ staffId, dateKey, sessionId });
            const normalizedRequestId = String(requestId || '').trim();
            if (!normalizedRequestId || normalizedRequestId.includes('/')) {
                throw new Error('Mã yêu cầu +10 phút không hợp lệ.');
            }

            const monthStr = identity.dateKey.slice(0, 7);
            const requestRef = db.collection('bonus10_requests').doc(normalizedRequestId);
            const attendanceRef = db.collection('attendance_logs').doc(`${identity.dateKey}_${identity.staffId}`);
            const monthlyRef = db.collection('salary_settings_monthly').doc(`${monthStr}_${identity.staffId}`);
            const profileRef = db.collection('users').doc(identity.staffId);
            const cancelledRef = db.collection('cancelled_shifts').doc(`${monthStr}_${identity.staffId}`);
            const scheduleKeys = [
                `cs1__${identity.dateKey}`,
                `cs2__${identity.dateKey}`,
                `cs3__${identity.dateKey}`,
                identity.dateKey
            ];
            const preflight = await Promise.all([
                attendanceRef.get({ source: 'server' }),
                profileRef.get({ source: 'server' }),
                cancelledRef.get({ source: 'server' }),
                db.collection('subjects').orderBy('name').get({ source: 'server' }),
                db.collection('bonus10_requests').where('staffId', '==', identity.staffId)
                    .limit(400).get({ source: 'server' }),
                ...scheduleKeys.map(key => DBService.getSchedule(key, { source: 'server' }))
            ]);
            const preAttendanceSnapshot = preflight[0];
            const preProfileSnapshot = preflight[1];
            const preCancelledSnapshot = preflight[2];
            const preSubjectSnapshot = preflight[3];
            const knownSnapshot = preflight[4];
            const preRequestSnapshot = knownSnapshot.docs.find(doc => doc.id === normalizedRequestId);
            if (!preRequestSnapshot) throw new Error('Yêu cầu +10 phút không còn tồn tại.');
            const preRequest = preRequestSnapshot.data() || {};
            _assertBonus10RequestIdentity(preRequest, identity);
            if (String(preRequest.status || '') !== 'pending') {
                throw new Error('Chỉ yêu cầu đang chờ duyệt mới được duyệt +10 phút.');
            }
            if (!preAttendanceSnapshot.exists || !preProfileSnapshot.exists) {
                throw new Error('Không tìm thấy dữ liệu chấm công hoặc hồ sơ nhân sự.');
            }
            const preSessions = Array.isArray(preAttendanceSnapshot.data()?.sessions)
                ? preAttendanceSnapshot.data().sessions : [];
            const preSessionIndex = preSessions.findIndex(item => String(item?.id || '') === identity.sessionId);
            const preSession = preSessions[preSessionIndex];
            if (!preSession || preSession.isAbsent) {
                throw new Error('Không tìm thấy phiên có mặt dùng làm bằng chứng +10 phút.');
            }
            const preProfile = { id: preProfileSnapshot.id, ...(preProfileSnapshot.data() || {}) };
            if (preProfile.teachingMode === 'new') {
                throw new Error('Nhân viên chế độ mới không áp dụng chính sách sớm 10 phút.');
            }
            const subjects = preSubjectSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const subjectMap = window.Early10.buildSubjectEarly10Map(subjects);
            const cancelled = preCancelledSnapshot.exists && Array.isArray(preCancelledSnapshot.data()?.shifts)
                ? preCancelledSnapshot.data().shifts.map(String) : [];
            const requestedStart = String(
                preRequest.classStart || preRequest.scheduledStart || preSession.linkedClassStart || ''
            ).trim();
            const candidates = new Map();
            const assignmentFields = ['gvList', 'gvThayTeList', 'gvThayTheList', 'registeredTeachers'];
            scheduleKeys.forEach((compositeKey, scheduleOffset) => {
                const daySchedule = preflight[5 + scheduleOffset] || {};
                BONUS10_SCHEDULE_SECTIONS.forEach(section => {
                    (daySchedule[section] || []).forEach((row, rowIndex) => {
                        if (!row || row.isClosed === true || !row.start || !row.end) return;
                        if (requestedStart && String(row.start) !== requestedStart) return;
                        const originalIndex = row._originalIndex !== undefined ? row._originalIndex : rowIndex;
                        if (cancelled.includes(`${compositeKey}_${section}_${originalIndex}`) ||
                            (row.shiftId && cancelled.includes(`shift:${row.shiftId}`))) return;
                        if (!isAssignedToClass(row, identity.staffId) ||
                            (isScheduledMainTeacher(row, identity.staffId) &&
                                isMainTeacherAbsentFromClass(row, identity.staffId))) return;
                        const rowSubjectIds = _normalizeScheduleSubjectIds(row.lopId);
                        const allowedSubjectIds = rowSubjectIds.filter(id => subjectMap[id] === true);
                        if (!allowedSubjectIds.length) return;
                        if (preRequest.subjectId && !rowSubjectIds.includes(String(preRequest.subjectId))) return;
                        const subjectId = preRequest.subjectId || allowedSubjectIds[0];
                        const verdict = window.Early10.evaluateEarly10Request({
                            subjectIds: [subjectId], subjects, user: preProfile,
                            checkIn: preSession.checkIn || preSession.start,
                            classStart: row.start
                        });
                        if (!verdict?.ok) return;
                        const shiftStart = getVietnamDateFromHM(identity.dateKey, row.start);
                        let shiftEnd = getVietnamDateFromHM(identity.dateKey, row.end);
                        if (shiftStart && shiftEnd && shiftEnd <= shiftStart) {
                            shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
                        }
                        const actualStart = new Date(preSession.checkIn || preSession.start).getTime();
                        const actualEnd = preSession.checkOut
                            ? new Date(preSession.checkOut).getTime()
                            : (shiftEnd ? shiftEnd.getTime() : NaN);
                        if (!shiftStart || !shiftEnd || !Number.isFinite(actualStart) || !Number.isFinite(actualEnd) ||
                            Math.min(actualEnd, shiftEnd.getTime()) - Math.max(actualStart, shiftStart.getTime()) < 10 * 60 * 1000) return;
                        const targetShiftKey = _bonus10TargetShiftKey(
                            identity.dateKey, compositeKey, section, originalIndex,
                            row.shiftId || '', row.start, row.end
                        );
                        if (preRequest.awardScope === 'teaching_shift' &&
                            String(preRequest.targetShiftKey || '') !== targetShiftKey) return;
                        let scheduleAssignmentList = '';
                        let scheduleAssignmentEntry = {};
                        for (const field of assignmentFields) {
                            const entry = (Array.isArray(row[field]) ? row[field] : [])
                                .find(item => String(item?.id || '') === identity.staffId);
                            if (!entry) continue;
                            scheduleAssignmentList = field;
                            scheduleAssignmentEntry = { ...entry };
                            break;
                        }
                        const sourceScheduleDocId = String(
                            row._inheritedFromScheduleDocId || compositeKey
                        );
                        const sourceScheduleIndex = Number.isInteger(row._inheritedIndex)
                            ? row._inheritedIndex : originalIndex;
                        candidates.set(targetShiftKey, {
                            targetShiftKey, subjectId, verdict, compositeKey, section,
                            scheduleIndex: originalIndex, scheduleShiftId: String(row.shiftId || ''),
                            classStart: String(row.start), classEnd: String(row.end),
                            scheduleAssignmentList, scheduleAssignmentEntry,
                            scheduleRegistrationId: String(scheduleAssignmentEntry.registrationId || ''),
                            sourceScheduleDocId, sourceScheduleIndex,
                            sourceSignature: _scheduleRegistrationRowSignature(row),
                            isInherited: row._isInheritedSchedule === true
                        });
                    });
                });
            });
            if (candidates.size !== 1) {
                const error = new Error(candidates.size
                    ? 'Yêu cầu cũ khớp nhiều ca dạy. Hãy mở đúng chip trên lịch để duyệt +10 phút.'
                    : 'Yêu cầu cũ không còn khớp duy nhất một ca dạy/môn hợp lệ.');
                error.code = 'bonus10/ambiguous-legacy-target';
                throw error;
            }
            const resolved = candidates.values().next().value;
            const subjectRef = db.collection('subjects').doc(resolved.subjectId);
            const sourceScheduleRef = db.collection('schedules').doc(resolved.sourceScheduleDocId);
            const requestRefsById = new Map([[normalizedRequestId, requestRef]]);
            knownSnapshot.docs
                .filter(doc => String(doc.data()?.dateKey || '').startsWith(`${monthStr}-`))
                .forEach(doc => requestRefsById.set(doc.id, doc.ref));
            const requestRefs = Array.from(requestRefsById.values());

            await db.runTransaction(async transaction => {
                const snapshots = await Promise.all([
                    transaction.get(attendanceRef), transaction.get(monthlyRef),
                    transaction.get(profileRef), transaction.get(subjectRef),
                    transaction.get(sourceScheduleRef), transaction.get(cancelledRef),
                    ...requestRefs.map(ref => transaction.get(ref))
                ]);
                const attendanceSnapshot = snapshots[0];
                const monthlySnapshot = snapshots[1];
                const profileSnapshot = snapshots[2];
                const subjectSnapshot = snapshots[3];
                const sourceScheduleSnapshot = snapshots[4];
                const cancelledSnapshot = snapshots[5];
                const requestSnapshots = snapshots.slice(6);
                const requestSnapshot = requestSnapshots.find(snapshot => snapshot.id === normalizedRequestId);
                if (!requestSnapshot?.exists || !attendanceSnapshot.exists || !profileSnapshot.exists ||
                    !subjectSnapshot.exists || !sourceScheduleSnapshot.exists) {
                    throw new Error('Dữ liệu nguồn vừa thay đổi; chưa thể duyệt +10 phút.');
                }
                const request = requestSnapshot.data() || {};
                _assertBonus10RequestIdentity(request, identity);
                if (String(request.status || '') !== 'pending') {
                    throw new Error('Yêu cầu +10 phút không còn ở trạng thái chờ duyệt.');
                }
                if (request.targetShiftKey && String(request.targetShiftKey) !== resolved.targetShiftKey) {
                    throw new Error('Định danh ca của yêu cầu vừa thay đổi. Hãy tải lại dữ liệu.');
                }
                const liveSessions = Array.isArray(attendanceSnapshot.data()?.sessions)
                    ? attendanceSnapshot.data().sessions : [];
                const liveSessionIndex = liveSessions.findIndex(item => String(item?.id || '') === identity.sessionId);
                const liveSession = liveSessions[liveSessionIndex];
                if (!liveSession || liveSession.isAbsent ||
                    String(liveSession.checkIn || liveSession.start || '') !== String(preSession.checkIn || preSession.start || '')) {
                    throw new Error('Phiên chấm công vừa thay đổi. Hãy tải lại dữ liệu.');
                }
                const sourceRows = sourceScheduleSnapshot.data()?.[resolved.section];
                const sourceRow = Array.isArray(sourceRows) ? sourceRows[resolved.sourceScheduleIndex] : null;
                if (!sourceRow || _scheduleRegistrationRowSignature(sourceRow) !== resolved.sourceSignature ||
                    !_normalizeScheduleSubjectIds(sourceRow.lopId).includes(resolved.subjectId) ||
                    !isAssignedToClass(sourceRow, identity.staffId)) {
                    throw new Error('Lịch hoặc phân công giáo viên vừa thay đổi. Hãy tải lại dữ liệu.');
                }
                const liveCancelled = cancelledSnapshot.exists && Array.isArray(cancelledSnapshot.data()?.shifts)
                    ? cancelledSnapshot.data().shifts.map(String) : [];
                if (liveCancelled.includes(`${resolved.compositeKey}_${resolved.section}_${resolved.scheduleIndex}`) ||
                    liveCancelled.includes(`shift:${resolved.scheduleShiftId}`)) {
                    throw new Error('Ca dạy đã bị hủy nên không thể duyệt +10 phút.');
                }
                const policyVerdict = window.Early10.evaluateEarly10Request({
                    subjectIds: [resolved.subjectId],
                    subjects: [{ id: subjectSnapshot.id, ...subjectSnapshot.data() }],
                    user: { id: profileSnapshot.id, ...profileSnapshot.data() },
                    checkIn: liveSession.checkIn || liveSession.start,
                    classStart: resolved.classStart
                });
                if (!policyVerdict?.ok) {
                    const error = new Error(policyVerdict?.message || 'Ca này không còn đủ điều kiện +10 phút.');
                    error.code = 'bonus10/policy-conflict';
                    throw error;
                }
                const monthlyRequests = requestSnapshots
                    .filter(snapshot => snapshot.exists)
                    .map(snapshot => ({ id: snapshot.id, ...snapshot.data() }))
                    .filter(item => String(item.dateKey || '').startsWith(`${monthStr}-`));
                if (_isBonus10PenaltyActive(monthlySnapshot.exists ? monthlySnapshot.data() : {}, [
                    ...monthlyRequests,
                    ...liveSessions.map(item => ({ studentCountStatus: item?.studentCountStatus }))
                ])) {
                    throw new Error('Phụ cấp +10 phút của tháng này đang bị khóa; không thể duyệt yêu cầu.');
                }
                transaction.update(requestRef, {
                    status: 'approved', awardScope: 'teaching_shift',
                    targetShiftKey: resolved.targetShiftKey, subjectId: resolved.subjectId,
                    scheduleDocId: resolved.compositeKey, scheduleSection: resolved.section,
                    scheduleIndex: resolved.scheduleIndex, scheduleShiftId: resolved.scheduleShiftId,
                    scheduleSourceDocId: resolved.sourceScheduleDocId,
                    scheduleWasInherited: resolved.isInherited,
                    scheduleRegistrationId: resolved.scheduleRegistrationId,
                    scheduleAssignmentList: resolved.scheduleAssignmentList,
                    scheduleAssignmentEntry: resolved.scheduleAssignmentEntry,
                    classStart: resolved.classStart, classEnd: resolved.classEnd,
                    attendanceSessionIndex: liveSessionIndex,
                    earlyMinutes: policyVerdict.earlyMinutes,
                    checkInAt: String(liveSession.checkIn || liveSession.start || ''),
                    scheduledStart: resolved.classStart,
                    requestSource: preRequest.requestSource || 'admin_legacy_migration',
                    schemaVersion: 2, policyVersion: 'early10-shift-v2',
                    approvedBy: actorUserId, approvedByName: actorDisplayName,
                    approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            DBService._invalidate('bonus10_requests_');
            console.log('[Bonus10] Approved exact teaching shift:', normalizedRequestId, resolved.targetShiftKey);
        } catch (e) {
            console.error('[Bonus10] Error approving:', e);
            throw e;
        }
    },

    // Reject/cancel exactly one request. The monthly penalty intentionally
    // suppresses every +10 award until cleared, but request A must not rewrite
    // request B merely because both teaching shifts share one attendance session.
    cancelApprovedBonus10: async (requestId, staffId, dateKey, sessionId, actorName = '') => {
        try {
            const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
            const actorUserId = _requireBonus10ManagerAuthorization(authorization);
            const actorDisplayName = String(
                authorization.roleData?.name || authorization.roleData?.username || actorName || actorUserId
            ).trim().slice(0, 120);
            const identity = _normalizeBonus10Identity({ staffId, dateKey, sessionId });
            const monthStr = identity.dateKey.slice(0, 7);
            const normalizedRequestId = String(requestId || '').trim();
            if (!normalizedRequestId || normalizedRequestId.includes('/')) {
                throw new Error('Phải chọn đúng yêu cầu +10 phút cần hủy.');
            }
            const requestRef = db.collection('bonus10_requests').doc(normalizedRequestId);
            const monthlyRef = db.collection('salary_settings_monthly')
                .doc(`${monthStr}_${identity.staffId}`);

            await db.runTransaction(async transaction => {
                const snapshots = await Promise.all([
                    transaction.get(monthlyRef),
                    transaction.get(requestRef)
                ]);
                const monthlySnapshot = snapshots[0];
                const selectedSnapshot = snapshots[1];
                if (!selectedSnapshot.exists) throw new Error('Yêu cầu +10 phút không còn tồn tại.');
                const selected = selectedSnapshot.data() || {};
                _assertBonus10RequestIdentity(selected, identity);
                if (String(selected.status || '') === 'rejected') {
                    throw new Error('Yêu cầu +10 phút này đã bị hủy trước đó.');
                }
                const rejectedAt = firebase.firestore.FieldValue.serverTimestamp();
                transaction.update(requestRef, {
                    status: 'rejected',
                    rejectedBy: actorUserId,
                    rejectedByName: actorDisplayName,
                    rejectedAt,
                    rejectionSource: 'admin_cancel_bonus10'
                });
                _writeBonus10PenaltyState(
                    transaction,
                    monthlyRef,
                    monthlySnapshot,
                    true,
                    actorUserId,
                    {
                        staffId: identity.staffId,
                        monthStr,
                        dateKey: identity.dateKey,
                        sessionId: identity.sessionId,
                        requestId: normalizedRequestId,
                        targetShiftKey: String(selected.targetShiftKey || '')
                    }
                );
            });
            DBService._invalidate('bonus10_requests_');
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            console.log('[Bonus10] Rejected atomically with monthly marker:', requestId, identity.sessionId);
        } catch (e) {
            console.error('[Bonus10] Error cancelling approved bonus:', e);
            throw e;
        }
    },

    rejectBonus10Request: async (requestId, adminName) => {
        try {
            const normalizedRequestId = String(requestId || '').trim();
            if (!normalizedRequestId || normalizedRequestId.includes('/')) {
                throw new Error('Mã yêu cầu +10 phút không hợp lệ.');
            }
            const requestSnapshot = await db.collection('bonus10_requests')
                .doc(normalizedRequestId)
                .get({ source: 'server' });
            if (!requestSnapshot.exists) throw new Error('Yêu cầu +10 phút không còn tồn tại.');
            const identity = _normalizeBonus10Identity(requestSnapshot.data() || {});
            await DBService.cancelApprovedBonus10(
                normalizedRequestId,
                identity.staffId,
                identity.dateKey,
                identity.sessionId,
                adminName || 'Admin'
            );
            console.log('[Bonus10] Rejected:', requestId);
        } catch (e) {
            console.error('[Bonus10] Error rejecting:', e);
            throw e;
        }
    },

    // Gỡ hình phạt tháng bằng một trạng thái explicit `active:false`. Các request
    // rejected vẫn được giữ làm audit; legacy fallback chỉ áp dụng khi tháng chưa
    // có marker explicit.
    clearBonus10PenaltyForMonth: async (staffId, monthStr) => {
        try {
            const normalizedStaffId = String(staffId || '').trim();
            const normalizedMonth = String(monthStr || '').trim();
            if (!/^[A-Za-z0-9_-]{1,80}$/.test(normalizedStaffId) ||
                !/^\d{4}-\d{2}$/.test(normalizedMonth)) {
                throw new Error('Nhân sự hoặc tháng gỡ khóa +10 phút không hợp lệ.');
            }
            const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
            const actorUserId = _requireBonus10ManagerAuthorization(authorization);
            const snap = await db.collection('bonus10_requests')
                .where('staffId', '==', normalizedStaffId)
                .limit(400)
                .get({ source: 'server' });
            const targets = snap.docs.filter(doc => {
                const data = doc.data();
                return data.status === 'rejected' &&
                    String(data.dateKey || '').startsWith(`${normalizedMonth}-`);
            });
            const monthlyRef = db.collection('salary_settings_monthly')
                .doc(`${normalizedMonth}_${normalizedStaffId}`);
            let changedCount = targets.length;
            await db.runTransaction(async transaction => {
                const monthlySnapshot = await transaction.get(monthlyRef);
                const monthlySettings = monthlySnapshot.exists ? monthlySnapshot.data() : {};
                if (monthlySettings?.bonus10PenaltyState?.active === true) {
                    changedCount = Math.max(1, changedCount);
                }
                _writeBonus10PenaltyState(
                    transaction,
                    monthlyRef,
                    monthlySnapshot,
                    false,
                    actorUserId,
                    { staffId: normalizedStaffId, monthStr: normalizedMonth }
                );
            });
            DBService._invalidate('bonus10_requests_');
            DBService._invalidate(`all_monthly_salary_settings_${normalizedMonth}`);
            console.log('[Bonus10] Cleared monthly penalty marker; audit retained:', normalizedStaffId, normalizedMonth, targets.length);
            return changedCount;
        } catch (e) {
            console.error('[Bonus10] Error clearing penalty:', e);
            throw e;
        }
    },

    getMonthlyBonus10Requests: async (monthStr, staffId) => {
        if (!staffId) return [];
        const cacheKey = `bonus10_requests_month_${staffId}_${monthStr || 'all'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snap = await db.collection('bonus10_requests')
                    .where('staffId', '==', staffId)
                    .limit(400)
                    .get();
                const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                return monthStr
                    ? list.filter(r => r.dateKey && String(r.dateKey).startsWith(monthStr))
                    : list;
            } catch (e) {
                console.warn('[Bonus10] Error getting monthly requests:', e);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getMonthlyMeetings: async (monthStr) => {
        const cacheKey = `monthly_meetings_${monthStr}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const doc = await db.collection('meetings_log').doc(monthStr).get();
                if (doc.exists) {
                    return doc.data() || { month: monthStr, records: {} };
                }
                return { month: monthStr, records: {} };
            } catch (error) {
                console.error("[MeetingsLog] Error getting:", error);
                return { month: monthStr, records: {} };
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    saveMonthlyMeetings: async (monthStr, records) => {
        try {
            const docRef = db.collection('meetings_log').doc(monthStr);
            await docRef.set({
                month: monthStr,
                records: records,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            DBService._invalidate(`monthly_meetings_${monthStr}`);
            return true;
        } catch (error) {
            console.error("[MeetingsLog] Error saving:", error);
            throw error;
        }
    },

    // ================= PERIODIC MEETING AUTOMATION =================

    createMeeting: async (meetingData) => {
        try {
            const docRef = await db.collection('meetings').add({
                ...meetingData,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            DBService._invalidate('today_meetings_');
            DBService._invalidate('meetings_month_');
            return docRef.id;
        } catch (error) {
            console.error("[Meetings] Error creating:", error);
            throw error;
        }
    },

    deleteMeeting: async (meetingId) => {
        try {
            await db.collection('meetings').doc(meetingId).delete();
            const attendanceSnap = await db.collection('meeting_attendance')
                .where('meetingId', '==', meetingId)
                .get();
            const batch = db.batch();
            attendanceSnap.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            DBService._invalidate('today_meetings_');
            DBService._invalidate('meetings_month_');
            return true;
        } catch (error) {
            console.error("[Meetings] Error deleting:", error);
            throw error;
        }
    },

    getMeetingsForMonth: async (monthStr) => {
        const cacheKey = `meetings_month_${monthStr}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snapshot = await db.collection('meetings').get();
                const meetings = [];
                snapshot.forEach(doc => {
                    const data = doc.data();
                    if (data.date && data.date.startsWith(monthStr)) {
                        meetings.push({ id: doc.id, ...data });
                    }
                });
                meetings.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
                return meetings;
            } catch (error) {
                console.error("[Meetings] Error getting for month:", error);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getTodayMeetings: async () => {
        try {
            const d = new Date();
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const todayStr = `${year}-${month}-${day}`;

            const cacheKey = `today_meetings_${todayStr}`;
            const now = Date.now();
            if (DBService._cache[cacheKey] && (now - (DBService._cacheTime[cacheKey] || 0) < 300000)) {
                return DBService._cache[cacheKey];
            }

            const promise = (async () => {
                const snapshot = await db.collection('meetings')
                    .where('date', '==', todayStr)
                    .get();
                const meetings = [];
                snapshot.forEach(doc => {
                    meetings.push({ id: doc.id, ...doc.data() });
                });
                return meetings;
            })();

            DBService._cache[cacheKey] = promise;
            DBService._cacheTime[cacheKey] = now;
            return promise;
        } catch (error) {
            console.error("[Meetings] Error getting today meetings:", error);
            return [];
        }
    },

    checkInMeeting: async (meetingId, userId, userName, status) => {
        try {
            const attendanceRef = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
            const checkInTime = new Date().toISOString();
            await attendanceRef.set({
                meetingId,
                userId,
                userName,
                status,
                checkInTime,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            const meetingDoc = await db.collection('meetings').doc(meetingId).get();
            if (meetingDoc.exists) {
                const mData = meetingDoc.data();
                const dept = mData.department;
                const mDate = mData.date;
                if (dept && mDate) {
                    const monthStr = mDate.substring(0, 7);
                    
                    let fieldName = '';
                    if (dept === 'TG TA') fieldName = 'hop_tg_tieng_anh';
                    else if (dept === 'TG T-TV') fieldName = 'hop_tg_t_tv';
                    else if (dept === 'TOÁN TƯ DUY') fieldName = 'hop_toan_tu_duy';
                    else if (dept === 'TIẾP TÂN') fieldName = 'hop_tiep_tan';

                    if (fieldName) {
                        const logRef = db.collection('meetings_log').doc(monthStr);
                        const updateKey = `records.${userId}.${fieldName}`;
                        const updateData = {};
                        updateData[updateKey] = status;
                        
                        await logRef.update(updateData).catch(async (err) => {
                            if (err.code === 'not-found') {
                                const initialData = { month: monthStr, records: {} };
                                initialData.records[userId] = { [fieldName]: status };
                                await logRef.set(initialData, { merge: true });
                            }
                        });
                    }
                }
            }
            return { checkInTime, status };
        } catch (error) {
            console.error("[Meetings] Error check-in:", error);
            throw error;
        }
    },

    getMeetingAttendance: async (meetingId) => {
        try {
            const snapshot = await db.collection('meeting_attendance')
                .where('meetingId', '==', meetingId)
                .get();
            const attendance = [];
            snapshot.forEach(doc => {
                attendance.push({ id: doc.id, ...doc.data() });
            });
            return attendance;
        } catch (error) {
            console.error("[Meetings] Error getting attendance:", error);
            return [];
        }
    },

    // Nhân viên TỰ điểm danh: CHỈ ghi vào meeting_attendance (rules cho phép mọi user đăng nhập ghi).
    // KHÔNG đụng tới meetings_log (chỉ admin mới ghi được — tránh lỗi permission-denied ở phía nhân viên).
    // Bảng lương/điểm danh của admin sẽ tự phản ánh qua fallback đọc meeting_attendance trong lưới.
    selfCheckInMeeting: async (meetingId, userId, userName, status) => {
        try {
            const attendanceRef = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
            const checkInTime = new Date().toISOString();
            await attendanceRef.set({
                meetingId,
                userId,
                userName,
                status,
                checkInTime,
                selfCheckIn: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return { checkInTime, status };
        } catch (error) {
            console.error("[Meetings] Error self check-in:", error);
            throw error;
        }
    },

    // Nhân viên XÁC NHẬN tham gia họp (RSVP) — ghi vào meeting_attendance (staff ghi được).
    // willAttend=false + lý do -> đánh 'Vắng phép' ngay (trừ khi sau đó vẫn điểm danh thì
    // selfCheckInMeeting ghi đè 'Có'/'Trễ'). willAttend=true -> chỉ lưu ý định, chưa đổi status;
    // nếu trước đó lỡ 'Vắng phép' do bấm không đi thì xoá để về trạng thái chờ điểm danh.
    selfRsvpMeeting: async (meetingId, userId, userName, willAttend, reason) => {
        try {
            const ref = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
            const data = {
                meetingId, userId, userName,
                rsvp: willAttend ? 'yes' : 'no',
                rsvpReason: willAttend ? '' : (reason || ''),
                rsvpAt: new Date().toISOString(),
                selfRsvp: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (!willAttend) {
                data.status = 'Vắng phép';
            } else {
                const cur = await ref.get();
                if (cur.exists && cur.data().status === 'Vắng phép') {
                    data.status = firebase.firestore.FieldValue.delete();
                }
            }
            await ref.set(data, { merge: true });
            return { rsvp: data.rsvp };
        } catch (error) {
            console.error("[Meetings] Error self RSVP:", error);
            throw error;
        }
    },

    // Chốt "Vắng không phép": họp đã kết thúc, nhân viên bấm ĐI (rsvp yes) nhưng KHÔNG điểm danh.
    // Chỉ ghi khi chưa có status hợp lệ (không đè lên 'Có'/'Trễ'/'Vắng phép'/admin sửa).
    resolveMeetingNoShow: async (meetingId, userId, userName) => {
        try {
            const ref = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
            await ref.set({
                meetingId, userId, userName,
                status: 'Vắng không phép',
                autoNoShow: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return true;
        } catch (error) {
            console.error("[Meetings] Error resolve no-show:", error);
            return false;
        }
    },

    // GPS cho điểm danh HỌP — họp tổ chức tại Cơ Sở 1, nên ưu tiên kiểm tra đúng CS1;
    // nếu CS1 chưa cấu hình toạ độ thì chấp nhận bất kỳ cơ sở nào (giống chấm công).
    // Chưa cấu hình GPS nào -> trả false (bỏ qua kiểm tra, không chặn điểm danh).
    assertMeetingLocationAllowed: async () => {
        const settings = await DBService.getSystemSettings();
        const campuses = getConfiguredGPSCampuses(settings);
        if (campuses.length === 0) return false;
        let coords;
        try {
            coords = await getBrowserLocation();
        } catch (e) {
            console.error("Location meeting check error:", e);
            // Giữ nguyên cách nói "IP mạng/Wifi" như chấm công — không lộ là GPS.
            throw new Error("IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để điểm danh.");
        }
        const cs1 = campuses.find(c => c.name === 'CS1');
        const targets = cs1 ? [cs1] : campuses;
        const ok = targets.some(campus => {
            const dist = calculateDistanceInMeters(coords.latitude, coords.longitude, campus.lat, campus.lng);
            const allowedRadius = campus.radius + Math.min(coords.accuracy || 0, 250);
            return dist <= allowedRadius;
        });
        if (!ok) {
            throw new Error("IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để điểm danh.");
        }
        return true;
    },

    // Lấy trạng thái điểm danh của 1 user trong 1 cuộc họp (đọc trực tiếp theo id ghép)
    getMyMeetingStatus: async (meetingId, userId) => {
        try {
            const doc = await db.collection('meeting_attendance').doc(`${meetingId}_${userId}`).get();
            return doc.exists ? { id: doc.id, ...doc.data() } : null;
        } catch (error) {
            console.error("[Meetings] Error getting my meeting status:", error);
            return null;
        }
    },

    updateMeetingAttendanceStatus: async (meetingId, userId, userName, status) => {
        try {
            const attendanceRef = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
            await attendanceRef.set({
                meetingId,
                userId,
                userName,
                status,
                // Admin chỉnh tay -> luôn được coi là hợp lệ, kể cả khi ngoài khung giờ điểm danh
                adminOverride: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            const meetingDoc = await db.collection('meetings').doc(meetingId).get();
            if (meetingDoc.exists) {
                const mData = meetingDoc.data();
                const dept = mData.department;
                const mDate = mData.date;
                if (dept && mDate) {
                    const monthStr = mDate.substring(0, 7);
                    let fieldName = '';
                    if (dept === 'TG TA') fieldName = 'hop_tg_tieng_anh';
                    else if (dept === 'TG T-TV') fieldName = 'hop_tg_t_tv';
                    else if (dept === 'TOÁN TƯ DUY') fieldName = 'hop_toan_tu_duy';
                    else if (dept === 'TIẾP TÂN') fieldName = 'hop_tiep_tan';

                    if (fieldName) {
                        const logRef = db.collection('meetings_log').doc(monthStr);
                        const updateKey = `records.${userId}.${fieldName}`;
                        const updateData = {};
                        updateData[updateKey] = status;
                        
                        await logRef.update(updateData).catch(async (err) => {
                            if (err.code === 'not-found') {
                                const initialData = { month: monthStr, records: {} };
                                initialData.records[userId] = { [fieldName]: status };
                                await logRef.set(initialData, { merge: true });
                            }
                        });
                    }
                }
            }
            return true;
        } catch (error) {
            console.error("[Meetings] Error updating attendance status:", error);
            throw error;
        }
    },

    checkInMeetingBulk: async (meetingId, attendees, status) => {
        try {
            const meetingDoc = await db.collection('meetings').doc(meetingId).get();
            if (!meetingDoc.exists) return false;
            
            const mData = meetingDoc.data();
            const mDate = mData.date;
            if (!mDate) return false;
            
            const monthStr = mDate.substring(0, 7);
            const checkInTime = new Date().toISOString();
            const batch = db.batch();
            
            // Read or initialize the monthly meetings log document
            const logRef = db.collection('meetings_log').doc(monthStr);
            const logDoc = await logRef.get();
            let logData = logDoc.exists ? logDoc.data() : { month: monthStr, records: {} };
            if (!logData.records) logData.records = {};
            
            attendees.forEach(att => {
                const userId = att.id;
                const userName = att.name;
                const spec = att.specialty || '';
                
                // Write/merge the attendance document
                const attendanceRef = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
                batch.set(attendanceRef, {
                    meetingId,
                    userId,
                    userName,
                    status,
                    checkInTime,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
                // Merge in meetings_log
                if (!logData.records[userId]) {
                    logData.records[userId] = {};
                }
                
                const specUpper = spec.toUpperCase();
                if (specUpper.includes('TG TA')) {
                    logData.records[userId].hop_tg_tieng_anh = status;
                }
                if (specUpper.includes('TG T-TV')) {
                    logData.records[userId].hop_tg_t_tv = status;
                }
                if (specUpper.includes('TOÁN TƯ DUY') || specUpper.includes('TTD')) {
                    logData.records[userId].hop_toan_tu_duy = status;
                }
                if (specUpper.includes('TIẾP TÂN') || specUpper.includes('TT')) {
                    logData.records[userId].hop_tiep_tan = status;
                }
            });
            
            batch.set(logRef, logData, { merge: true });
            await batch.commit();
            
            DBService._invalidate(`monthly_meetings_${monthStr}`);
            return true;
        } catch (error) {
            console.error("[Meetings] Error bulk check-in:", error);
            throw error;
        }
    }
};

// PAYSLIP LIFECYCLE HELPERS START
const _PAYSLIP_STATUS_RANK = Object.freeze({ draft: 0, published: 1, received: 2 });

function _normalizePayslipStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(_PAYSLIP_STATUS_RANK, normalized)
        ? normalized
        : 'draft';
}

function _hasExplicitPayslipStatus(published, component) {
    const field = component === 'tt' ? 'status_tt' : 'status_gv';
    const raw = String(published?.[field] || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(_PAYSLIP_STATUS_RANK, raw);
}

function _hasPayslipComponentDetails(published, component) {
    if (!published || typeof published !== 'object') return false;
    const detailField = component === 'tt' ? 'details_tt' : 'details_gv';
    if (published[detailField] !== undefined && published[detailField] !== null) return true;

    const role = String(published.role || '').trim().toLowerCase();
    const isSingleComponentRole = component === 'tt'
        ? ['tiep-tan', 'tiep_tan', 'receptionist'].includes(role)
        : ['giao-vien', 'giao_vien', 'teacher'].includes(role);
    return isSingleComponentRole && published.details !== undefined && published.details !== null;
}

function _derivePayslipOverallStatus(componentStates, fallbackStatus = 'draft') {
    const relevant = [];
    if (componentStates.has_gv) relevant.push(componentStates.status_gv);
    if (componentStates.has_tt) relevant.push(componentStates.status_tt);
    if (relevant.length === 0) return _normalizePayslipStatus(fallbackStatus);
    if (relevant.every(status => status === 'received')) return 'received';
    if (relevant.some(status => status === 'published' || status === 'received')) return 'published';
    return 'draft';
}

function _getPayslipLifecycleState(published = {}) {
    const globalStatus = _normalizePayslipStatus(published.status);
    const explicitGV = _hasExplicitPayslipStatus(published, 'gv');
    const explicitTT = _hasExplicitPayslipStatus(published, 'tt');
    const hasAnyExplicitComponentStatus = explicitGV || explicitTT;
    const hasGVDetails = _hasPayslipComponentDetails(published, 'gv');
    const hasTTDetails = _hasPayslipComponentDetails(published, 'tt');
    let statusGV = explicitGV ? _normalizePayslipStatus(published.status_gv) : 'draft';
    let statusTT = explicitTT ? _normalizePayslipStatus(published.status_tt) : 'draft';

    // Legacy individual publications had only the aggregate status. Once either
    // component status exists, a missing sibling means that sibling is still a
    // draft (the partial bulk-publish contract).
    if (!explicitGV && hasGVDetails && globalStatus !== 'draft' && !hasAnyExplicitComponentStatus) {
        statusGV = globalStatus;
    }
    if (!explicitTT && hasTTDetails && globalStatus !== 'draft' && !hasAnyExplicitComponentStatus) {
        statusTT = globalStatus;
    }

    const hasGV = hasGVDetails || (explicitGV && statusGV !== 'draft');
    const hasTT = hasTTDetails || (explicitTT && statusTT !== 'draft');
    const state = {
        status_gv: statusGV,
        status_tt: statusTT,
        has_gv: hasGV,
        has_tt: hasTT,
        explicit_gv: explicitGV,
        explicit_tt: explicitTT
    };
    state.overallStatus = _derivePayslipOverallStatus(state, globalStatus);
    state.locked_gv = statusGV === 'published' || statusGV === 'received';
    state.locked_tt = statusTT === 'published' || statusTT === 'received';
    return state;
}

function _getPayslipPaymentBreakdown(published = {}) {
    const lifecycle = _getPayslipLifecycleState(published);
    const aggregateValue = Number(published?.netPay);
    const componentSpecs = [];

    if (lifecycle.has_gv) {
        componentSpecs.push({ key: 'gv', status: lifecycle.status_gv, details: published.details_gv });
    }
    if (lifecycle.has_tt) {
        componentSpecs.push({ key: 'tt', status: lifecycle.status_tt, details: published.details_tt });
    }

    // Legacy single-role documents stored their amount in `details` only.
    if (componentSpecs.length === 1 && !componentSpecs[0].details && published.details) {
        componentSpecs[0].details = published.details;
    }

    let knownTotal = 0;
    let paid = 0;
    let unpaid = 0;
    componentSpecs.forEach(component => {
        const value = Number(component.details?.netPay);
        if (!Number.isFinite(value)) return;
        knownTotal += value;
        if (component.status === 'received') paid += value;
        else unpaid += value;
    });

    const total = Number.isFinite(aggregateValue) ? aggregateValue : knownTotal;
    const unallocated = total - knownTotal;
    if (Math.abs(unallocated) > 0.0001) {
        // Malformed/legacy partial documents may not have component amounts.
        // Keep the dashboard conservative: money is unpaid unless every known
        // component is already received.
        const everyComponentReceived = componentSpecs.length > 0
            && componentSpecs.every(component => component.status === 'received');
        if (everyComponentReceived || lifecycle.overallStatus === 'received') paid += unallocated;
        else unpaid += unallocated;
    }

    return { total, paid, unpaid, lifecycle };
}

function _syncPayslipAggregateStatus(published, nowIso) {
    const state = _getPayslipLifecycleState(published);
    published.status = state.overallStatus;
    if (state.overallStatus === 'published' || state.overallStatus === 'received') {
        published.publishedAt = published.publishedAt || nowIso;
    }
    if (state.overallStatus === 'received') {
        published.receivedAt = published.receivedAt || nowIso;
    } else {
        // Component-level receipt metadata remains intact. Aggregate receipt
        // metadata is meaningful only after every relevant component is received.
        delete published.receivedAt;
        delete published.confirmedBy;
    }
    return state;
}

function _preparePayslipComponentPublish(published = {}, targets = {}, nowIso = new Date().toISOString()) {
    const next = { ...published };
    const before = _getPayslipLifecycleState(next);
    const publishedComponents = [];
    const lockedComponents = [];
    const skippedComponents = [];

    if (before.has_gv) next.status_gv = before.status_gv;
    if (before.has_tt) next.status_tt = before.status_tt;

    [['gv', !!targets.gv], ['tt', !!targets.tt]].forEach(([component, requested]) => {
        if (!requested) return;
        if (!_hasPayslipComponentDetails(next, component)) {
            skippedComponents.push(component);
            return;
        }

        const statusField = component === 'tt' ? 'status_tt' : 'status_gv';
        const publishedAtField = component === 'tt' ? 'publishedAt_tt' : 'publishedAt_gv';
        const currentStatus = component === 'tt' ? before.status_tt : before.status_gv;
        if (currentStatus === 'received') {
            next[statusField] = 'received';
            lockedComponents.push(component);
        } else {
            next[statusField] = 'published';
            next[publishedAtField] = next[publishedAtField] || next.publishedAt || nowIso;
            publishedComponents.push(component);
        }
    });

    // A draft sibling is allowed to change while another component is locked,
    // so the aggregate fields deliberately keep the last published snapshot
    // during draft editing. Once that sibling is actually published, rebuild
    // the legacy/dashboard totals from the two component snapshots in the same
    // transaction; otherwise a dual-role payslip can show an old total forever.
    if (publishedComponents.length > 0) {
        _recalculatePayslipScalarTotals(next);
    }

    const state = _syncPayslipAggregateStatus(next, nowIso);
    return { published: next, state, publishedComponents, lockedComponents, skippedComponents };
}

function _recalculatePayslipScalarTotals(published) {
    const details = [published.details_gv, published.details_tt]
        .filter(item => item && typeof item === 'object');
    if (details.length < 2) return published;

    ['netPay', 'baseSalary', 'totalBonus', 'advance'].forEach(field => {
        if (details.every(item => Number.isFinite(Number(item[field])))) {
            published[field] = details.reduce((sum, item) => sum + Number(item[field]), 0);
        }
    });
    return published;
}

function _preparePayslipPublishUpdate(currentPublished = {}, payload = {}, nowIso = new Date().toISOString()) {
    const targets = {
        gv: payload.details_gv !== undefined && payload.details_gv !== null,
        tt: payload.details_tt !== undefined && payload.details_tt !== null
    };
    const role = String(payload.role || '').trim().toLowerCase();
    if (!targets.gv && ['giao-vien', 'giao_vien', 'teacher'].includes(role) && payload.details) targets.gv = true;
    if (!targets.tt && ['tiep-tan', 'tiep_tan', 'receptionist'].includes(role) && payload.details) targets.tt = true;

    const before = _getPayslipLifecycleState(currentPublished);
    const safePayload = { ...payload };
    [
        'status', 'status_gv', 'status_tt',
        'publishedAt', 'publishedAt_gv', 'publishedAt_tt',
        'receivedAt', 'receivedAt_gv', 'receivedAt_tt',
        'confirmedBy', 'confirmedBy_gv', 'confirmedBy_tt'
    ].forEach(field => delete safePayload[field]);

    const requested = [targets.gv ? 'gv' : null, targets.tt ? 'tt' : null].filter(Boolean);
    const allRequestedAlreadyReceived = requested.length > 0 && requested.every(component =>
        component === 'tt' ? before.status_tt === 'received' : before.status_gv === 'received'
    );

    // A received component is an immutable snapshot. A repeated publish remains
    // idempotent and cannot alter its monetary/detail payload.
    const next = allRequestedAlreadyReceived
        ? { ...currentPublished }
        : { ...currentPublished, ...safePayload };
    if (before.status_gv === 'received' && currentPublished.details_gv !== undefined) {
        next.details_gv = currentPublished.details_gv;
    }
    if (before.status_tt === 'received' && currentPublished.details_tt !== undefined) {
        next.details_tt = currentPublished.details_tt;
    }
    if (allRequestedAlreadyReceived && currentPublished.details !== undefined) {
        next.details = currentPublished.details;
    }

    const transition = _preparePayslipComponentPublish(next, targets, nowIso);
    _recalculatePayslipScalarTotals(transition.published);
    transition.state = _getPayslipLifecycleState(transition.published);
    return { ...transition, targets };
}

function _preparePayslipConfirmation(currentPublished = {}, confirmedBy = 'employee', nowIso = new Date().toISOString(), component = 'all') {
    const next = { ...currentPublished };
    const before = _getPayslipLifecycleState(next);
    if (before.has_gv) next.status_gv = before.status_gv;
    if (before.has_tt) next.status_tt = before.status_tt;

    const requestedGV = component === 'all' || component === 'gv';
    const requestedTT = component === 'all' || component === 'tt';
    const receivedComponents = [];

    if (requestedGV && before.has_gv && before.status_gv === 'published') {
        next.status_gv = 'received';
        next.receivedAt_gv = next.receivedAt_gv || nowIso;
        next.confirmedBy_gv = next.confirmedBy_gv || confirmedBy;
        receivedComponents.push('gv');
    }
    if (requestedTT && before.has_tt && before.status_tt === 'published') {
        next.status_tt = 'received';
        next.receivedAt_tt = next.receivedAt_tt || nowIso;
        next.confirmedBy_tt = next.confirmedBy_tt || confirmedBy;
        receivedComponents.push('tt');
    }

    const state = _syncPayslipAggregateStatus(next, nowIso);
    if (state.overallStatus === 'received') {
        next.confirmedBy = next.confirmedBy || confirmedBy;
    }
    return { published: next, state, receivedComponents, changed: receivedComponents.length > 0 };
}

function _getPayslipReceiptRequestState(published = {}, component = 'all') {
    const lifecycle = _getPayslipLifecycleState(published);
    const requestedComponents = [];
    if ((component === 'all' || component === 'gv') && lifecycle.has_gv) requestedComponents.push('gv');
    if ((component === 'all' || component === 'tt') && lifecycle.has_tt) requestedComponents.push('tt');
    const requestedStatuses = requestedComponents.map(item => (
        item === 'tt' ? lifecycle.status_tt : lifecycle.status_gv
    ));
    return {
        lifecycle,
        requestedComponents,
        requestedStatuses,
        allReceived: requestedStatuses.length > 0
            && requestedStatuses.every(status => status === 'received')
    };
}

function _getPayslipDraftLockState(published = {}, component = 'gv') {
    const normalizedComponent = component === 'tt' ? 'tt' : 'gv';
    const lifecycle = _getPayslipLifecycleState(published);
    const status = normalizedComponent === 'tt' ? lifecycle.status_tt : lifecycle.status_gv;
    return {
        component: normalizedComponent,
        status,
        locked: status === 'published' || status === 'received',
        requiresRevision: status === 'published' || status === 'received',
        lifecycle
    };
}

function _preparePayslipDraftUpdate(currentPublished = {}, calculatedPublished = {}, component = 'gv', nowIso = new Date().toISOString()) {
    const lockState = _getPayslipDraftLockState(currentPublished, component);
    if (lockState.locked) {
        return {
            published: { ...currentPublished },
            saved: false,
            locked: true,
            requiresRevision: true,
            component: lockState.component,
            componentStatus: lockState.status,
            lifecycle: lockState.lifecycle
        };
    }

    const before = lockState.lifecycle;
    const next = { ...calculatedPublished };
    const copyOrDelete = (field) => {
        if (currentPublished[field] === undefined) delete next[field];
        else next[field] = currentPublished[field];
    };

    ['gv', 'tt'].forEach(item => {
        const isLocked = item === 'gv' ? before.locked_gv : before.locked_tt;
        const statusField = item === 'gv' ? 'status_gv' : 'status_tt';
        const detailField = item === 'gv' ? 'details_gv' : 'details_tt';
        const publishedAtField = item === 'gv' ? 'publishedAt_gv' : 'publishedAt_tt';
        const receivedAtField = item === 'gv' ? 'receivedAt_gv' : 'receivedAt_tt';
        const confirmedByField = item === 'gv' ? 'confirmedBy_gv' : 'confirmedBy_tt';

        if (isLocked) {
            [statusField, detailField, publishedAtField, receivedAtField, confirmedByField]
                .forEach(copyOrDelete);
            return;
        }

        if (_hasPayslipComponentDetails(next, item)) next[statusField] = 'draft';
        else delete next[statusField];
        delete next[publishedAtField];
        delete next[receivedAtField];
        delete next[confirmedByField];
    });

    const hasLockedSnapshot = before.locked_gv || before.locked_tt;
    if (hasLockedSnapshot) {
        // Aggregate fields are the snapshot shown in legacy dashboards/PDFs.
        // Updating an unlocked sibling draft must not mutate a published amount.
        [
            'netPay', 'baseSalary', 'totalBonus', 'advance', 'penalties',
            'stats', 'breakdown', 'details', 'message', 'publishedAt'
        ].forEach(copyOrDelete);
    } else {
        delete next.publishedAt;
        delete next.receivedAt;
        delete next.confirmedBy;
    }

    const lifecycle = _syncPayslipAggregateStatus(next, nowIso);
    return {
        published: next,
        saved: true,
        locked: false,
        requiresRevision: false,
        component: lockState.component,
        componentStatus: lockState.status,
        preservedPublishedSnapshot: hasLockedSnapshot,
        lifecycle
    };
}
// PAYSLIP LIFECYCLE HELPERS END
