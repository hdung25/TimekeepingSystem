// Teacher Shift State - canonical, backward-compatible staffing state for one class shift.
// Kept dependency-free so schedule, attendance, reporting and regression tests can share
// the same interpretation instead of inferring absence from a generic daily note.
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.TeacherShiftState = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const ACTIVE = 'ACTIVE';
    const VP = 'VP';
    const VDX = 'VDX';
    const HISTORY_LIMIT = 60;

    function text(value) {
        return String(value == null ? '' : value).trim();
    }

    function cleanId(value) {
        return text(value);
    }

    function uniqueStrings(values) {
        return Array.from(new Set((values || []).map(cleanId).filter(Boolean)));
    }

    function compactObject(value) {
        if (Array.isArray(value)) return value.map(compactObject);
        if (!value || typeof value !== 'object') return value;
        return Object.entries(value).reduce((result, [key, item]) => {
            if (item !== undefined) result[key] = compactObject(item);
            return result;
        }, {});
    }

    function normalizeTeacher(raw) {
        if (!raw) return null;
        const id = cleanId(raw.id || raw.teacherId || raw.userId);
        const name = text(raw.name || raw.teacherName || raw.username);
        if (!id && !name) return null;
        const entry = { id, name };
        if (raw.pendingFixed === true) entry.pendingFixed = true;
        const replacesTeacherIds = uniqueStrings(raw.replacesTeacherIds || raw.replacementForIds);
        if (replacesTeacherIds.length) entry.replacesTeacherIds = replacesTeacherIds;
        return entry;
    }

    function mergeTeacherLists(lists) {
        const byKey = new Map();
        (lists || []).flat().forEach(raw => {
            const entry = normalizeTeacher(raw);
            if (!entry) return;
            const key = entry.id || `name:${entry.name.toLocaleLowerCase('vi')}`;
            const old = byKey.get(key) || {};
            byKey.set(key, {
                ...old,
                ...entry,
                replacesTeacherIds: uniqueStrings([
                    ...(old.replacesTeacherIds || []),
                    ...(entry.replacesTeacherIds || [])
                ])
            });
        });
        return Array.from(byKey.values()).map(entry => {
            if (!entry.replacesTeacherIds?.length) delete entry.replacesTeacherIds;
            return entry;
        });
    }

    function getMainTeachers(row) {
        const legacy = row && (row.gv || row.gvId)
            ? [{ id: row.gvId || '', name: row.gv || '' }]
            : [];
        return mergeTeacherLists([Array.isArray(row?.gvList) ? row.gvList : [], legacy]);
    }

    function getSubstituteTeachers(row) {
        const legacy = row && (row.gvThayTe || row.gvThayTeId || row.gvThayThe || row.gvThayTheId)
            ? [{
                id: row.gvThayTeId || row.gvThayTheId || '',
                name: row.gvThayTe || row.gvThayThe || ''
            }]
            : [];
        return mergeTeacherLists([
            Array.isArray(row?.gvThayTeList) ? row.gvThayTeList : [],
            Array.isArray(row?.gvThayTheList) ? row.gvThayTheList : [],
            legacy
        ]);
    }

    function normalizeAbsenceType(value) {
        const normalized = text(value).toUpperCase();
        if (normalized === VP || normalized === VDX) return normalized;
        return ACTIVE;
    }

    function getAbsenceRecord(row, teacherId) {
        const id = cleanId(teacherId);
        if (!id || !Array.isArray(row?.teacherAbsences)) return null;
        return row.teacherAbsences.find(item => cleanId(item?.teacherId || item?.id) === id) || null;
    }

    function isMainTeacherAbsent(row, teacherId) {
        const id = cleanId(teacherId);
        if (!id || !getMainTeachers(row).some(item => item.id === id)) return false;
        if (Array.isArray(row?.teacherAbsences)) return !!getAbsenceRecord(row, id);
        return getSubstituteTeachers(row).length > 0;
    }

    function getReplacementIdsForTeacher(row, teacherId) {
        const id = cleanId(teacherId);
        const record = getAbsenceRecord(row, id);
        const explicitRecordIds = uniqueStrings(record?.replacementIds);
        if (explicitRecordIds.length) return explicitRecordIds;

        const substitutes = getSubstituteTeachers(row);
        const mapped = substitutes
            .filter(item => uniqueStrings(item.replacesTeacherIds).includes(id))
            .map(item => item.id)
            .filter(Boolean);
        if (mapped.length) return uniqueStrings(mapped);

        // Legacy rows never stored a per-teacher mapping. Only infer all substitutes when
        // there is exactly one absent main teacher; multi-main rows stay pending until a
        // scheduler explicitly maps a replacement.
        const absentMainIds = getMainTeachers(row)
            .filter(item => isMainTeacherAbsent(row, item.id))
            .map(item => item.id);
        return absentMainIds.length === 1 && absentMainIds[0] === id
            ? substitutes.map(item => item.id).filter(Boolean)
            : [];
    }

    function getReplacementTeachersForTeacher(row, teacherId) {
        const ids = new Set(getReplacementIdsForTeacher(row, teacherId));
        return getSubstituteTeachers(row).filter(item => ids.has(item.id));
    }

    function statusLabel(value) {
        const type = normalizeAbsenceType(value);
        if (type === VP) return 'Vắng có phép';
        if (type === VDX) return 'Vắng đột xuất';
        return 'Đang dạy';
    }

    function arraysEqual(left, right) {
        const a = uniqueStrings(left).sort();
        const b = uniqueStrings(right).sort();
        return a.length === b.length && a.every((value, index) => value === b[index]);
    }

    function stableShiftId(row, suppliedId) {
        const explicit = cleanId(suppliedId || row?.shiftId);
        if (explicit) return explicit;
        const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        return `shift_${random}`;
    }

    function applyStaffingCommand(row, command, actor, nowISO) {
        const current = row && typeof row === 'object' ? row : {};
        const timestamp = text(nowISO) || new Date().toISOString();
        const who = {
            id: cleanId(actor?.id || actor?.userId || actor?.uid),
            name: text(actor?.name || actor?.displayName || actor?.username)
        };
        const mains = mergeTeacherLists([command?.mains || []]);
        if (!mains.length) throw new Error('Ca dạy phải có ít nhất một giáo viên chính.');

        const mainIds = new Set(mains.map(item => item.id).filter(Boolean));
        if (mainIds.size !== mains.length) throw new Error('Giáo viên chính phải có mã nhân sự hợp lệ và không trùng nhau.');

        const rawStatuses = command?.statuses || {};
        const statusById = new Map(mains.map(item => {
            const raw = rawStatuses[item.id] || {};
            return [item.id, {
                type: normalizeAbsenceType(raw.type || raw.status),
                reason: text(raw.reason).slice(0, 300),
                reportedAt: text(raw.reportedAt) || timestamp
            }];
        }));
        const absentIds = new Set(Array.from(statusById.entries())
            .filter(([, state]) => state.type !== ACTIVE)
            .map(([id]) => id));

        const substitutes = mergeTeacherLists([command?.substitutes || []]).map(item => ({
            ...item,
            replacesTeacherIds: uniqueStrings(item.replacesTeacherIds).filter(id => absentIds.has(id))
        }));
        const substituteIds = new Set();
        substitutes.forEach(item => {
            if (!item.id) throw new Error('Giáo viên thay phải có mã nhân sự hợp lệ.');
            if (substituteIds.has(item.id)) throw new Error('Danh sách giáo viên thay đang bị trùng.');
            if (mainIds.has(item.id)) throw new Error(`${item.name || 'Một giáo viên'} không thể vừa là GV chính vừa là GV thay trong cùng ca.`);
            if (!absentIds.size) throw new Error('Chỉ xếp giáo viên thay khi có giáo viên chính báo nghỉ.');
            if (!item.replacesTeacherIds.length) throw new Error(`Hãy chọn ${item.name || 'giáo viên thay'} thay cho giáo viên chính nào.`);
            substituteIds.add(item.id);
        });

        const oldAbsences = new Map((Array.isArray(current.teacherAbsences) ? current.teacherAbsences : [])
            .filter(Boolean)
            .map(item => [cleanId(item.teacherId || item.id), item]));
        const teacherAbsences = [];
        mains.forEach(main => {
            const state = statusById.get(main.id);
            if (!state || state.type === ACTIVE) return;
            const old = oldAbsences.get(main.id) || {};
            const replacements = substitutes.filter(item => item.replacesTeacherIds.includes(main.id));
            teacherAbsences.push(compactObject({
                ...old,
                teacherId: main.id,
                teacherName: main.name,
                type: state.type,
                status: replacements.length ? 'covered' : 'pending',
                reason: state.reason,
                // The command is initialized from the old value, so honoring it is
                // idempotent while still allowing an intentional time correction.
                reportedAt: state.reportedAt || old.reportedAt || timestamp,
                reportedById: old.reportedById || who.id,
                reportedByName: old.reportedByName || who.name,
                replacementIds: replacements.map(item => item.id),
                replacementNames: replacements.map(item => item.name),
                updatedAt: timestamp,
                updatedById: who.id,
                updatedByName: who.name,
                schemaVersion: 2
            }));
        });

        const newAbsences = new Map(teacherAbsences.map(item => [item.teacherId, item]));
        const history = Array.isArray(current.teacherAbsenceHistory)
            ? current.teacherAbsenceHistory.filter(Boolean).slice(-HISTORY_LIMIT)
            : [];
        const allTeacherIds = new Set([...oldAbsences.keys(), ...newAbsences.keys()]);
        allTeacherIds.forEach(teacherId => {
            const before = oldAbsences.get(teacherId) || null;
            const after = newAbsences.get(teacherId) || null;
            const beforeType = before ? normalizeAbsenceType(before.type) : ACTIVE;
            const afterType = after ? normalizeAbsenceType(after.type) : ACTIVE;
            const beforeReplacementIds = uniqueStrings(before?.replacementIds);
            const afterReplacementIds = uniqueStrings(after?.replacementIds);
            const reasonChanged = text(before?.reason) !== text(after?.reason);
            const reportedAtChanged = text(before?.reportedAt) !== text(after?.reportedAt);
            if (beforeType === afterType && arraysEqual(beforeReplacementIds, afterReplacementIds) && !reasonChanged && !reportedAtChanged) return;
            let event = 'updated';
            if (beforeType === ACTIVE && afterType !== ACTIVE) event = 'reported_absent';
            else if (beforeType !== ACTIVE && afterType === ACTIVE) event = 'restored';
            else if (beforeType !== afterType) event = 'absence_type_changed';
            else if (!arraysEqual(beforeReplacementIds, afterReplacementIds)) event = 'coverage_changed';
            else event = 'absence_details_changed';
            history.push(compactObject({
                event,
                teacherId,
                teacherName: after?.teacherName || before?.teacherName || '',
                fromStatus: beforeType,
                toStatus: afterType,
                fromReplacementIds: beforeReplacementIds,
                toReplacementIds: afterReplacementIds,
                fromReportedAt: before?.reportedAt || '',
                toReportedAt: after?.reportedAt || '',
                at: timestamp,
                byId: who.id,
                byName: who.name
            }));
        });

        const firstMain = mains[0] || {};
        const firstSub = substitutes[0] || {};
        const result = {
            ...current,
            shiftId: stableShiftId(current, command?.shiftId),
            staffingSchemaVersion: 2,
            gvList: mains,
            gv: firstMain.name || '',
            gvId: firstMain.id || '',
            gvThayTeList: substitutes,
            gvThayTheList: substitutes.map(item => ({ ...item })),
            gvThayTe: firstSub.name || '',
            gvThayTeId: firstSub.id || '',
            gvThayThe: firstSub.name || '',
            gvThayTheId: firstSub.id || '',
            gvThayTheAt: substitutes.length ? (current.gvThayTheAt || timestamp) : '',
            teacherAbsences,
            teacherAbsenceHistory: history.slice(-HISTORY_LIMIT),
            staffingUpdatedAt: timestamp,
            staffingUpdatedById: who.id,
            staffingUpdatedByName: who.name
        };
        return compactObject(result);
    }

    // A normal class transfer is deliberately separate from absence/substitution.
    // It must never manufacture teacherAbsences. A source absence is allowed only
    // through the explicit source_absence command, which records the scheduler's
    // chosen VP/VDX decision alongside the transfer history.
    function applyTeacherTransferCommand(row, command, actor, nowISO) {
        const current = row && typeof row === 'object' ? row : {};
        const timestamp = text(nowISO) || new Date().toISOString();
        const direction = text(command?.direction).toLowerCase();
        const mode = text(command?.mode).toLowerCase();
        const teacherId = cleanId(command?.teacherId);
        const teacherName = text(command?.teacherName);
        const transferId = cleanId(command?.transferId);
        const effectiveFrom = text(command?.effectiveFrom);
        const effectiveTo = text(command?.effectiveTo);
        const who = {
            id: cleanId(actor?.id || actor?.userId || actor?.uid),
            name: text(actor?.name || actor?.displayName || actor?.username)
        };
        if (!['out', 'in', 'source_absence'].includes(direction)) throw new Error('Chiều điều chuyển giáo viên không hợp lệ.');
        if (!['temporary', 'permanent'].includes(mode)) throw new Error('Loại điều chuyển không hợp lệ.');
        if (!teacherId || !transferId) throw new Error('Thiếu mã giáo viên hoặc mã giao dịch điều chuyển.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) ||
            (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) ||
            (mode === 'temporary' && !effectiveTo) ||
            (effectiveTo && effectiveTo < effectiveFrom)) {
            throw new Error('Khoảng thời gian điều chuyển không hợp lệ.');
        }

        const mains = getMainTeachers(current).filter(item => item.id);
        const substitutes = getSubstituteTeachers(current).filter(item => item.id);
        const existingMain = mains.find(item => item.id === teacherId);
        const existingSubstitute = substitutes.find(item => item.id === teacherId);
        const replacement = normalizeTeacher(command?.replacementTeacher);

        if (direction === 'out') {
            if (!existingMain) throw new Error('Giáo viên nguồn không còn trong lớp. Hãy tải lại lịch.');
            if (isMainTeacherAbsent(current, teacherId)) {
                throw new Error('Giáo viên nguồn đang ở trạng thái nghỉ. Hãy xử lý trạng thái nghỉ riêng trước khi đổi lớp.');
            }
            if (mains.length <= 1 && !replacement) {
                throw new Error('Lớp nguồn phải còn ít nhất một GV chính hoặc được chọn GV thay thế.');
            }
            if (replacement && (replacement.id === teacherId || mains.some(item => item.id === replacement.id) ||
                substitutes.some(item => item.id === replacement.id))) {
                throw new Error('GV thay thế đã có trong lớp nguồn hoặc trùng với GV đang chuyển.');
            }
            const nextMains = mains.filter(item => item.id !== teacherId);
            if (replacement) nextMains.push(replacement);
            return _finishTeacherTransfer(current, nextMains, substitutes, command, {
                ...who,
                teacherName: existingMain.name || teacherName,
                timestamp,
                direction,
                replacement
            });
        }

        if (direction === 'source_absence') {
            if (!existingMain) throw new Error('Giáo viên nguồn không còn trong lớp. Hãy tải lại lịch.');
            if (isMainTeacherAbsent(current, teacherId)) {
                throw new Error('Giáo viên nguồn đang ở trạng thái nghỉ. Hãy tải lại ca trước khi ghi nhận điều chuyển.');
            }
            const requestedAbsence = command?.sourceAbsence && typeof command.sourceAbsence === 'object'
                ? command.sourceAbsence
                : {};
            const absenceType = normalizeAbsenceType(requestedAbsence.type || requestedAbsence.status);
            if (absenceType === ACTIVE) {
                throw new Error('Hãy chọn Vắng có phép hoặc Vắng đột xuất cho lớp nguồn.');
            }
            const statuses = Object.fromEntries(mains.map(main => {
                if (main.id === teacherId) {
                    return [main.id, {
                        type: absenceType,
                        reason: text(requestedAbsence.reason || command.reason).slice(0, 300),
                        reportedAt: text(requestedAbsence.reportedAt) || timestamp
                    }];
                }
                const currentAbsence = getAbsenceRecord(current, main.id);
                return [main.id, currentAbsence ? {
                    type: currentAbsence.type,
                    reason: currentAbsence.reason,
                    reportedAt: currentAbsence.reportedAt
                } : { type: ACTIVE }];
            }));
            const sourceWithExplicitAbsence = applyStaffingCommand(current, {
                shiftId: current.shiftId || command.shiftId,
                mains,
                substitutes,
                statuses
            }, who, timestamp);
            return _finishTeacherTransfer(
                sourceWithExplicitAbsence,
                getMainTeachers(sourceWithExplicitAbsence),
                getSubstituteTeachers(sourceWithExplicitAbsence),
                command,
                {
                    ...who,
                    teacherName: existingMain.name || teacherName,
                    timestamp,
                    direction,
                    event: 'teacher_transfer_source_absence',
                    sourceAbsenceType: absenceType,
                    replacement: null,
                    teacherAbsences: sourceWithExplicitAbsence.teacherAbsences,
                    teacherAbsenceHistory: sourceWithExplicitAbsence.teacherAbsenceHistory
                }
            );
        }

        if (existingMain) throw new Error('Giáo viên này đã là GV chính của lớp đích.');
        const incoming = normalizeTeacher({ id: teacherId, name: teacherName || existingSubstitute?.name || '' });
        if (!incoming) throw new Error('Không xác định được tên giáo viên chuyển đến.');

        // If the incoming teacher was temporarily listed as a substitute in
        // the target class, convert that assignment to the normal main roster
        // and recalculate only the affected absence coverage.
        const nextSubstitutes = substitutes.filter(item => item.id !== teacherId)
            .map(item => ({ ...item, replacesTeacherIds: uniqueStrings(item.replacesTeacherIds).filter(id => id !== teacherId) }));
        const nextAbsences = (Array.isArray(current.teacherAbsences) ? current.teacherAbsences : [])
            .map(item => {
                if (!item || !uniqueStrings(item.replacementIds).includes(teacherId)) return item;
                const oldReplacementIds = uniqueStrings(item.replacementIds);
                const oldReplacementNames = uniqueStrings(item.replacementNames);
                const replacementIds = oldReplacementIds.filter(id => id !== teacherId);
                const replacementNames = oldReplacementIds
                    .map((id, index) => id === teacherId ? null : (oldReplacementNames[index] || ''))
                    .filter(Boolean);
                return compactObject({
                    ...item,
                    replacementIds,
                    replacementNames,
                    status: replacementIds.length ? 'covered' : 'pending',
                    updatedAt: timestamp,
                    updatedById: who.id,
                    updatedByName: who.name
                });
            });
        return _finishTeacherTransfer(current, [...mains, incoming], nextSubstitutes, command, {
            ...who,
            teacherName: incoming.name,
            timestamp,
            direction,
            replacement: null,
            teacherAbsences: nextAbsences
        });
    }

    function _finishTeacherTransfer(current, mains, substitutes, command, metadata) {
        const firstMain = mains[0] || {};
        const firstSub = substitutes[0] || {};
        const sourceRef = compactObject(command?.source || {});
        const targetRef = compactObject(command?.target || {});
        const history = Array.isArray(current.assignmentTransferHistory)
            ? current.assignmentTransferHistory.filter(Boolean).slice(-HISTORY_LIMIT)
            : [];
        history.push(compactObject({
            event: metadata.event || (metadata.direction === 'out' ? 'teacher_transfer_out' : 'teacher_transfer_in'),
            transferId: command.transferId,
            mode: command.mode,
            effectiveFrom: command.effectiveFrom,
            effectiveTo: command.effectiveTo || null,
            teacherId: command.teacherId,
            teacherName: metadata.teacherName,
            // Only the normal roster is inherited. Day-specific absences and
            // cover teachers are already cleared by schedule inheritance.
            rosterBefore: getMainTeachers(current),
            rosterAfter: mains.map(item => ({ ...item })),
            source: sourceRef,
            target: targetRef,
            replacementTeacherId: metadata.replacement?.id || '',
            replacementTeacherName: metadata.replacement?.name || '',
            ...(metadata.sourceAbsenceType ? { sourceAbsenceType: metadata.sourceAbsenceType } : {}),
            reason: text(command.reason).slice(0, 300),
            at: metadata.timestamp,
            byId: metadata.id,
            byName: metadata.name
        }));
        const result = {
            ...current,
            staffingSchemaVersion: 2,
            gvList: mains,
            gv: firstMain.name || '',
            gvId: firstMain.id || '',
            gvThayTeList: substitutes,
            gvThayTheList: substitutes.map(item => ({ ...item })),
            gvThayTe: firstSub.name || '',
            gvThayTeId: firstSub.id || '',
            gvThayThe: firstSub.name || '',
            gvThayTheId: firstSub.id || '',
            gvThayTheAt: substitutes.length ? (current.gvThayTheAt || metadata.timestamp) : '',
            teacherAbsences: metadata.teacherAbsences || (Array.isArray(current.teacherAbsences) ? current.teacherAbsences : []),
            teacherAbsenceHistory: metadata.teacherAbsenceHistory ||
                (Array.isArray(current.teacherAbsenceHistory) ? current.teacherAbsenceHistory : []),
            assignmentTransferHistory: history.slice(-HISTORY_LIMIT),
            staffingUpdatedAt: metadata.timestamp,
            staffingUpdatedById: metadata.id,
            staffingUpdatedByName: metadata.name
        };
        return compactObject(result);
    }

    // Read projection only: never rewrite a historical day to expire a transfer.
    // Undo expired deltas newest-first so nested temporary moves unwind correctly;
    // later permanent transfers of the same teacher take precedence.
    function projectInheritedRoster(row, targetDateKey) {
        const current = row && typeof row === 'object' ? row : {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text(targetDateKey))) return { ...current };
        const history = Array.isArray(current.assignmentTransferHistory) ? current.assignmentTransferHistory : [];
        let mains = getMainTeachers(current).map(item => ({ ...item }));
        const protectedIds = new Set();
        for (let index = history.length - 1; index >= 0; index--) {
            const event = history[index];
            if (!event || !event.teacherId) continue;
            const affected = [event.teacherId, event.replacementTeacherId].filter(Boolean);
            if (event.mode !== 'temporary' || !event.effectiveTo || targetDateKey <= event.effectiveTo) {
                affected.forEach(id => protectedIds.add(id));
                continue;
            }
            let before = Array.isArray(event.rosterBefore) ? event.rosterBefore : null;
            let after = Array.isArray(event.rosterAfter) ? event.rosterAfter : null;
            // Legacy transfer history still contains enough identity to reverse
            // its narrow add/remove operation without inventing an absence.
            if (!before || !after) {
                if (event.event === 'teacher_transfer_in') {
                    before = []; after = [{ id: event.teacherId, name: event.teacherName }];
                } else if (event.event === 'teacher_transfer_out') {
                    before = [{ id: event.teacherId, name: event.teacherName }];
                    after = event.replacementTeacherId ? [{ id: event.replacementTeacherId, name: event.replacementTeacherName }] : [];
                } else continue;
            }
            for (const id of affected) {
                if (protectedIds.has(id)) continue;
                const was = before.find(item => item.id === id);
                const became = after.find(item => item.id === id);
                if (!!was === !!became) continue;
                const isPresent = mains.some(item => item.id === id);
                // If a newer explicit edit already changed this membership,
                // preserve that edit rather than blindly replacing the roster.
                if (isPresent !== !!became) continue;
                mains = mains.filter(item => item.id !== id);
                if (was) mains.push({ ...was });
            }
        }
        const first = mains[0] || {};
        return { ...current, gvList: mains, gvId: first.id || '', gv: first.name || '' };
    }

    return {
        ACTIVE,
        VP,
        VDX,
        HISTORY_LIMIT,
        getMainTeachers,
        getSubstituteTeachers,
        getAbsenceRecord,
        isMainTeacherAbsent,
        getReplacementIdsForTeacher,
        getReplacementTeachersForTeacher,
        normalizeAbsenceType,
        statusLabel,
        stableShiftId,
        applyStaffingCommand,
        applyTeacherTransferCommand,
        projectInheritedRoster
    };
});
