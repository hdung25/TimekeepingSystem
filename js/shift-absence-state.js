// shift-absence-state.js — Pure, per-shift absence resolver.
//
// A daily note describes a day; it does not identify a shift.  This module keeps
// the evidence boundary explicit so a note for one class can never mark every
// other class on the same date absent.  It has no Firestore or DOM dependency and
// is shared by Chấm Bù, the chip evaluator and payroll classification.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ShiftAbsenceState = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const ACTIVE = 'ACTIVE';
    const VP = 'VP';
    const VDX = 'VDX';

    function clean(value) {
        return String(value == null ? '' : value).trim();
    }

    function normalizeAbsenceType(value) {
        const normalized = clean(value).toUpperCase();
        return normalized === VP || normalized === VDX ? normalized : null;
    }

    function foldVietnamese(value) {
        return clean(value)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd');
    }

    function absenceTypeFromNote(note) {
        const text = foldVietnamese(note);
        if (!text) return null;
        if (/\b(vdx|dx)\b/.test(text) || /dot\s*xuat/.test(text)) return VDX;
        if (/\bvp\b/.test(text) || /vang\s*(?:co\s*)?phep/.test(text)) return VP;
        return null;
    }

    function listIds(items) {
        return new Set((Array.isArray(items) ? items : [])
            .map(item => clean(item && (item.id || item.teacherId || item.userId)))
            .filter(Boolean));
    }

    function mainTeacherIds(row) {
        const ids = listIds(row && row.gvList);
        const legacyId = clean(row && row.gvId);
        if (legacyId) ids.add(legacyId);
        return ids;
    }

    function substituteTeacherIds(row) {
        const ids = listIds(row && row.gvThayTeList);
        listIds(row && row.gvThayTheList).forEach(id => ids.add(id));
        const modernId = clean(row && row.gvThayTeId);
        const legacyId = clean(row && row.gvThayTheId);
        if (modernId) ids.add(modernId);
        if (legacyId) ids.add(legacyId);
        return ids;
    }

    function getTeacherAbsenceRecord(row, staffId) {
        const id = clean(staffId);
        if (!id || !Array.isArray(row && row.teacherAbsences)) return null;
        return row.teacherAbsences.find(item =>
            clean(item && (item.teacherId || item.id)) === id
        ) || null;
    }

    function hasCancellation(cancelledShifts, cancelKey) {
        const key = clean(cancelKey);
        if (!key) return false;
        if (cancelledShifts instanceof Set) return cancelledShifts.has(key);
        return Array.isArray(cancelledShifts) && cancelledShifts.includes(key);
    }

    function localShiftRange(dateKey, start, end) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(dateKey)) ||
            !/^\d{2}:\d{2}$/.test(clean(start)) ||
            !/^\d{2}:\d{2}$/.test(clean(end))) return null;
        const startMs = new Date(`${dateKey}T${start}:00`).getTime();
        let endMs = new Date(`${dateKey}T${end}:00`).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
        if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000;
        return { startMs, endMs };
    }

    function sessionRange(session) {
        if (!session) return null;
        const startValue = session.checkIn || session.start;
        if (!startValue) return null;
        const startMs = new Date(startValue).getTime();
        const endMs = session.checkOut ? new Date(session.checkOut).getTime() : startMs;
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
        return { startMs, endMs: Math.max(startMs, endMs) };
    }

    function normalizeKind(kind) {
        const value = clean(kind).toLowerCase();
        if (['vp', 'van-phong', 'van_phong', 'office', 'office_staff'].includes(value)) return 'vp';
        if (['tt', 'tiep-tan', 'tiep_tan', 'receptionist'].includes(value)) return 'tt';
        return 'gv';
    }

    function sessionRoleKind(session) {
        const role = clean(session && session.role).toLowerCase();
        if (['van-phong', 'van_phong', 'office', 'office_staff'].includes(role)) return 'vp';
        if (['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(role)) return 'tt';
        return role ? 'gv' : '';
    }

    function sessionMatchesShift(session, options) {
        if (!session || session.isAbsent !== true) return false;

        const kind = normalizeKind(options.kind);
        const targetBranch = clean(options.branch).toLowerCase();
        const sessionBranch = clean(session.branch).toLowerCase();
        if (targetBranch && sessionBranch && targetBranch !== sessionBranch) return false;

        const roleKind = sessionRoleKind(session);
        if (roleKind && roleKind !== kind) return false;

        const shiftId = clean(options.shiftId || (options.row && options.row.shiftId));
        const linkedShiftId = clean(session.linkedScheduleShiftId || session.scheduleShiftId);
        if (linkedShiftId) return !!shiftId && linkedShiftId === shiftId;

        const compositeKey = clean(options.compositeKey);
        const section = clean(options.section);
        const linkedCompositeKey = clean(session.linkedScheduleCompositeKey);
        const linkedSection = clean(session.linkedScheduleSection || session.linkedClassSection);
        if (linkedCompositeKey && compositeKey && linkedCompositeKey !== compositeKey) return false;
        if (linkedSection && section && linkedSection !== section) return false;
        if ((linkedCompositeKey && compositeKey) || (linkedSection && section)) {
            const linkedStart = clean(session.linkedClassStart);
            return !linkedStart || linkedStart === clean(options.start);
        }

        if (kind === 'vp' && session.linkedOfficeShift) {
            return clean(session.linkedOfficeShift) === clean(options.shiftKey || options.section);
        }
        if (kind === 'tt' && session.linkedReceptionistShift) {
            return clean(session.linkedReceptionistShift) === clean(options.shiftKey || options.section);
        }
        if (kind === 'gv' && session.linkedClassStart) {
            return clean(session.linkedClassStart) === clean(options.start);
        }

        // A link for another kind is positive evidence that this is not the target.
        if (session.linkedClassStart || session.linkedReceptionistShift || session.linkedOfficeShift) return false;

        const target = localShiftRange(options.dateKey, options.start, options.end);
        const actual = sessionRange(session);
        if (!target || !actual) return false;
        if (actual.endMs === actual.startMs) {
            return actual.startMs >= target.startMs && actual.startMs < target.endMs;
        }
        return Math.min(target.endMs, actual.endMs) - Math.max(target.startMs, actual.startMs) >= 10 * 60 * 1000;
    }

    function findMatchingAbsentSession(attendanceSessions, options) {
        return (Array.isArray(attendanceSessions) ? attendanceSessions : [])
            .find(session => sessionMatchesShift(session, options)) || null;
    }

    function state(values) {
        return {
            isAbsent: !!values.isAbsent,
            type: normalizeAbsenceType(values.type),
            source: values.source || 'none',
            hasCanonicalState: !!values.hasCanonicalState,
            isLegacy: !!values.isLegacy,
            record: values.record || null,
            matchedSession: values.matchedSession || null
        };
    }

    function resolveTeachingShift(options) {
        const input = options || {};
        const row = input.row || {};
        const staffId = clean(input.staffId);
        const isMain = mainTeacherIds(row).has(staffId);
        const isSubstitute = substituteTeacherIds(row).has(staffId);
        const isAssigned = isMain || isSubstitute || input.isAssigned === true;
        const hasCanonicalState = Array.isArray(row.teacherAbsences);
        const record = isMain ? getTeacherAbsenceRecord(row, staffId) : null;
        if (record) {
            return state({
                isAbsent: true,
                type: normalizeAbsenceType(record.type) || VDX,
                source: 'teacher-absence',
                hasCanonicalState: true,
                record
            });
        }

        if (isAssigned && hasCancellation(input.cancelledShifts, input.cancelKey)) {
            return state({ isAbsent: true, type: VP, source: 'cancellation', hasCanonicalState });
        }

        const matchedSession = isAssigned ? findMatchingAbsentSession(input.attendanceSessions, {
            ...input,
            kind: 'gv',
            row
        }) : null;
        if (matchedSession) {
            return state({
                isAbsent: true,
                type: normalizeAbsenceType(matchedSession.absenceType) || absenceTypeFromNote(input.dateNote),
                source: 'attendance-session',
                hasCanonicalState,
                matchedSession
            });
        }

        // An explicit empty array is a deliberate restored/active state. It wins
        // over the legacy inference "a substitute exists, therefore main is absent".
        if (hasCanonicalState) {
            return state({ isAbsent: false, source: 'teacher-active', hasCanonicalState: true });
        }

        if (isMain && !isSubstitute && substituteTeacherIds(row).size > 0) {
            return state({
                isAbsent: true,
                type: absenceTypeFromNote(input.dateNote) || VDX,
                source: 'legacy-substitute',
                isLegacy: true
            });
        }

        return state({ isAbsent: false, source: 'none', isLegacy: !hasCanonicalState });
    }

    function resolveOperationalShift(options) {
        const input = options || {};
        if (hasCancellation(input.cancelledShifts, input.cancelKey)) {
            return state({ isAbsent: true, type: VP, source: 'cancellation' });
        }
        const matchedSession = findMatchingAbsentSession(input.attendanceSessions, input);
        if (matchedSession) {
            return state({
                isAbsent: true,
                type: normalizeAbsenceType(matchedSession.absenceType) || absenceTypeFromNote(input.dateNote),
                source: 'attendance-session',
                matchedSession
            });
        }
        return state({ isAbsent: false, source: 'none' });
    }

    function resolveShift(options) {
        return normalizeKind(options && options.kind) === 'gv'
            ? resolveTeachingShift(options)
            : resolveOperationalShift(options);
    }

    function absenceLabel(resolved) {
        const value = resolved || {};
        if (!value.isAbsent) return '';
        if (value.source === 'cancellation') return 'Vắng phép (đã báo trước)';
        if (value.source === 'attendance-session') return 'Đã ghi nhận Vắng (quản lý cập nhật)';
        const label = value.type === VP ? 'Vắng có phép' : 'Vắng đột xuất';
        if (value.source === 'legacy-substitute') return `${label} (dữ liệu cũ có GV thay)`;
        const replacements = Array.isArray(value.record && value.record.replacementIds)
            ? value.record.replacementIds.filter(Boolean)
            : [];
        return `${label}${replacements.length ? ' (đã có GV thay)' : ' (đang tìm GV thay)'}`;
    }

    function toChipMetadata(resolved) {
        const value = resolved || state({ isAbsent: false });
        const type = normalizeAbsenceType(value.type);
        return {
            absenceState: value.isAbsent ? (type || 'RECORDED') : ACTIVE,
            ...(type ? { absenceType: type } : {}),
            absenceStateSource: value.source || 'none',
            absenceEvidence: !!value.isAbsent,
            hasCanonicalAbsenceState: !!value.hasCanonicalState
        };
    }

    function classifyChipAbsence(chip, notesMap) {
        const value = chip || {};
        const source = clean(value.absenceStateSource);
        const stateType = normalizeAbsenceType(value.absenceState);
        const chipType = normalizeAbsenceType(value.absenceType);

        // This marker is emitted only after reading an explicit teacherAbsences
        // array. In particular, [] means restored/active and must beat a stale note.
        if (value.hasCanonicalAbsenceState === true && value.absenceState === ACTIVE && !value.absenceEvidence) {
            return 'VKP';
        }
        if (value.isCancelled || source === 'cancellation') return VP;
        if (source === 'teacher-absence') return stateType || chipType || VDX;

        // A daily note may classify proven legacy/admin absence, never create
        // absence evidence for an otherwise ordinary missing-attendance chip.
        if (source === 'legacy-substitute' || source === 'attendance-session') {
            const noteType = absenceTypeFromNote((notesMap || {})[value.dateStr]);
            return noteType || stateType || chipType || (value.isVDX ? VDX : 'VKP');
        }

        if (stateType) return stateType;
        if (chipType) return chipType;
        if (value.isVDX) return VDX;
        return 'VKP';
    }

    return {
        ACTIVE,
        VP,
        VDX,
        normalizeAbsenceType,
        absenceTypeFromNote,
        getTeacherAbsenceRecord,
        sessionMatchesShift,
        findMatchingAbsentSession,
        resolveTeachingShift,
        resolveOperationalShift,
        resolveShift,
        absenceLabel,
        toChipMetadata,
        classifyChipAbsence
    };
});
