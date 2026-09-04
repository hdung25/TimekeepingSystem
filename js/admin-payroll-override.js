/*
 * AdminPayrollOverride
 * --------------------
 * Pure, versioned helpers for turning an explicit Admin payroll decision into
 * payable chips.  This module deliberately has no DOM/Firebase dependencies:
 * the writer/UI can be added independently while the calculation contract is
 * regression-tested here.
 *
 * Source attendance remains evidence. `adminPayrollOverride.allocations` says
 * how that evidence is allocated for payroll.  Legacy sessions without a
 * valid active override continue through the legacy evaluation engine.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AdminPayrollOverride = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var SCHEMA_VERSION = 1;
    var ACTIVE_MODES = new Set(['actual', 'manual']);
    var OPERATIONAL_ROLE_IDS = new Set([
        'tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant',
        'receptionist_lead', 'receptionist_staff',
        'van-phong', 'van_phong', 'office', 'office_staff'
    ]);

    function asText(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function toDate(value) {
        if (value === null || value === undefined || value === '') return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
        if (typeof value === 'object' && typeof value.toDate === 'function') {
            var converted = value.toDate();
            return converted instanceof Date && !Number.isNaN(converted.getTime())
                ? new Date(converted.getTime())
                : null;
        }
        if (typeof value === 'object' && Number.isFinite(Number(value.seconds))) {
            var millis = Number(value.seconds) * 1000 + (Number(value.nanoseconds) || 0) / 1000000;
            var timestampDate = new Date(millis);
            return Number.isNaN(timestampDate.getTime()) ? null : timestampDate;
        }
        var parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function toISO(value) {
        var date = toDate(value);
        return date ? date.toISOString() : '';
    }

    function uniqueStrings(value) {
        var source = Array.isArray(value)
            ? value
            : asText(value).split('+');
        return Array.from(new Set(source.map(asText).filter(Boolean)));
    }

    function normalizedRoleToken(value) {
        return asText(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[\s_]+/g, '-');
    }

    function inferKind(allocation, session) {
        var rawKind = normalizedRoleToken(allocation && (allocation.kind || allocation.type));
        if (['teaching', 'teacher', 'giao-vien', 'day'].includes(rawKind)) return 'teaching';
        if (['office', 'office-staff', 'van-phong'].includes(rawKind)) return 'office';
        if (['receptionist', 'tiep-tan', 'reception'].includes(rawKind)) return 'receptionist';
        // An explicit but unknown kind is a schema error. Do not silently turn a
        // typo into teaching payroll merely because teaching is the legacy fallback.
        if (rawKind) return '';

        var role = normalizedRoleToken(
            (allocation && (allocation.role || allocation.roleId)) || (session && session.role)
        );
        if (['office', 'office-staff', 'van-phong'].includes(role)) return 'office';
        if (OPERATIONAL_ROLE_IDS.has(role) || role.indexOf('reception') >= 0 || role.indexOf('tiep-tan') >= 0) {
            return 'receptionist';
        }
        return 'teaching';
    }

    function normalizeScheduleRef(input) {
        if (!input || typeof input !== 'object') return null;
        var type = normalizedRoleToken(input.type || input.kind || input.scheduleType);
        if (type === 'teacher' || type === 'giao-vien' || type === 'day') type = 'teaching';
        if (type === 'van-phong' || type === 'office-staff') type = 'office';
        if (type === 'tiep-tan' || type === 'reception') type = 'receptionist';
        var invalidType = !!type && !['teaching', 'receptionist', 'office'].includes(type);
        var normalized = {
            type: ['teaching', 'receptionist', 'office'].includes(type) ? type : '',
            branch: asText(input.branch).toLowerCase(),
            documentKey: asText(input.documentKey || input.compositeKey),
            shiftId: asText(input.shiftId),
            section: asText(input.section || input.sectionKey),
            rowIndex: input.rowIndex !== '' && input.rowIndex !== null && input.rowIndex !== undefined && Number.isInteger(Number(input.rowIndex))
                ? Number(input.rowIndex)
                : null,
            dayKey: asText(input.dayKey || input.weekday || (
                typeof input.rowIndex === 'string' && input.rowIndex !== '' && !Number.isInteger(Number(input.rowIndex))
                    ? input.rowIndex
                    : ''
            )),
            shiftKey: asText(input.shiftKey || input.shift),
            start: asText(input.start),
            end: asText(input.end)
        };
        // Validation-only marker: keep it out of the Firestore payload when a
        // caller serializes this normalized object.
        Object.defineProperty(normalized, 'invalidType', {
            value: invalidType,
            enumerable: false
        });
        var hasIdentity = Object.keys(normalized).some(function (key) {
            return key !== 'rowIndex' && !!normalized[key];
        }) || normalized.rowIndex !== null || invalidType;
        return hasIdentity ? normalized : null;
    }

    function normalizeAllocation(input, context) {
        var source = input && typeof input === 'object' ? input : {};
        context = context || {};
        var session = context.session || {};
        var kind = inferKind(source, session);
        var subjectIds = uniqueStrings(source.subjectIds || source.subjectId || '');
        var fallbackRole = asText(source.role || source.roleId || session.role);
        var role = fallbackRole;
        if (kind === 'teaching' && subjectIds.length) role = subjectIds.join('+');
        if (kind === 'receptionist') role = 'tiep-tan';
        if (kind === 'office') role = 'van-phong';

        var roleName = asText(source.roleName || source.label || source.name || session.roleName);
        if (!roleName) {
            roleName = kind === 'office'
                ? 'Văn Phòng'
                : (kind === 'receptionist' ? 'Tiếp Tân' : (role || 'Dạy học'));
        }

        var rawFrom = source.fromISO || source.from || source.start || source.checkIn;
        var rawTo = source.toISO || source.to || source.end || source.checkOut;
        if (context.fillActualBounds) {
            rawFrom = rawFrom || context.actualFrom;
            rawTo = rawTo || context.actualTo;
        }
        var fromISO = toISO(rawFrom);
        var toISOValue = toISO(rawTo);
        var fromDate = toDate(fromISO);
        var toDateValue = toDate(toISOValue);
        var manualRateValue = source.manualRate !== undefined && source.manualRate !== null && asText(source.manualRate) !== ''
            ? Number(source.manualRate)
            : null;
        var roleRateValue = source.roleRate !== undefined && source.roleRate !== null && asText(source.roleRate) !== ''
            ? Number(source.roleRate)
            : (session.roleRate !== undefined && session.roleRate !== null && asText(session.roleRate) !== '' ? Number(session.roleRate) : null);

        return {
            id: asText(source.id) || ('allocation-' + String((Number(context.index) || 0) + 1)),
            kind: kind,
            fromISO: fromISO,
            toISO: toISOValue,
            fromMs: fromDate ? fromDate.getTime() : NaN,
            toMs: toDateValue ? toDateValue.getTime() : NaN,
            subjectIds: subjectIds,
            role: role,
            roleName: roleName,
            rateMode: asText(source.rateMode || 'policy').toLowerCase(),
            manualRate: Number.isFinite(manualRateValue) ? manualRateValue : null,
            roleRate: Number.isFinite(roleRateValue) ? roleRateValue : null,
            fixed: source.fixed === true || source.isFixedShift === true,
            mergeGroupId: asText(source.mergeGroupId || source.groupId),
            scheduleRef: normalizeScheduleRef(source.scheduleRef),
            note: asText(source.note),
            sourceIndex: context.index
        };
    }

    // +10 phút do Admin quyết định là một phần của cùng nguồn chip tuyệt đối,
    // không phải một yêu cầu tự động dựa trên lịch.  Vẫn cố định đúng 10 phút
    // và phải gắn vào một phân bổ Dạy học cụ thể để không thể cộng mơ hồ cho
    // tiếp tân/văn phòng hoặc nhiều chip cùng lúc.
    function normalizeAdminEarly10(input) {
        var source = input && typeof input === 'object' ? input : {};
        return {
            enabled: source.enabled === true,
            minutes: Number(source.minutes),
            allocationId: asText(source.allocationId)
        };
    }

    function normalizeOverride(session) {
        var sourceSession = session && typeof session === 'object' ? session : {};
        var source = sourceSession.adminPayrollOverride && typeof sourceSession.adminPayrollOverride === 'object'
            ? sourceSession.adminPayrollOverride
            : {};
        var version = Number(source.version !== undefined ? source.version : source.schemaVersion);
        var mode = asText(source.mode).toLowerCase();
        var actualFrom = toISO(sourceSession.checkIn || sourceSession.start);
        var actualTo = toISO(sourceSession.checkOut || sourceSession.end);
        var rawAllocations = Array.isArray(source.allocations) ? source.allocations : [];

        if (mode === 'actual' && rawAllocations.length === 0) {
            rawAllocations = [{
                id: 'actual',
                kind: inferKind(null, sourceSession),
                role: sourceSession.role || '',
                roleName: sourceSession.roleName || '',
                roleRate: sourceSession.roleRate,
                fromISO: actualFrom,
                toISO: actualTo,
                scheduleRef: source.scheduleRef || null
            }];
        }

        var fillActualBounds = mode === 'actual' && rawAllocations.length === 1;
        var allocations = rawAllocations.map(function (allocation, index) {
            return normalizeAllocation(allocation, {
                session: sourceSession,
                index: index,
                fillActualBounds: fillActualBounds,
                actualFrom: actualFrom,
                actualTo: actualTo
            });
        });

        return {
            normalized: true,
            version: version,
            mode: mode,
            active: version === SCHEMA_VERSION && ACTIVE_MODES.has(mode),
            reason: asText(source.reason),
            revision: Number.isInteger(Number(source.revision)) && Number(source.revision) >= 0
                ? Number(source.revision)
                : 0,
            editedAt: source.editedAt || null,
            editedBy: source.editedBy || null,
            actualFrom: actualFrom,
            actualTo: actualTo,
            actualFromMs: toDate(actualFrom) ? toDate(actualFrom).getTime() : NaN,
            actualToMs: toDate(actualTo) ? toDate(actualTo).getTime() : NaN,
            allocations: allocations,
            adminEarly10: normalizeAdminEarly10(source.adminEarly10),
            session: sourceSession,
            sessionId: sourceSession.id
        };
    }

    function overlapMinutes(left, right) {
        if (!left || !right) return 0;
        var overlap = Math.min(left.toMs, right.toMs) - Math.max(left.fromMs, right.fromMs);
        return Math.max(0, Math.round(overlap / 60000));
    }

    function validateOverride(value, options) {
        var normalized = value && value.normalized === true ? value : normalizeOverride(value);
        var settings = options || {};
        var maxDurationMinutes = Number.isFinite(Number(settings.maxDurationMinutes))
            ? Math.max(1, Number(settings.maxDurationMinutes))
            : 24 * 60;
        var errors = [];
        var warnings = [];

        if (normalized.version !== SCHEMA_VERSION) {
            errors.push({ code: 'UNSUPPORTED_VERSION', message: 'Phiên bản adminPayrollOverride không được hỗ trợ.' });
        }
        if (!['schedule', 'actual', 'manual'].includes(normalized.mode)) {
            errors.push({ code: 'INVALID_MODE', message: 'Chế độ override phải là schedule, actual hoặc manual.' });
        }
        if (normalized.mode === 'schedule') {
            if (normalized.adminEarly10.enabled) {
                errors.push({
                    code: 'ADMIN_EARLY10_REQUIRES_ACTIVE_OVERRIDE',
                    message: 'Chỉ có thể cộng +10 phút theo quyết định Admin khi chip Admin đang được áp dụng.'
                });
            }
            return { ok: errors.length === 0, active: false, normalized: normalized, errors: errors, warnings: warnings };
        }
        if (!ACTIVE_MODES.has(normalized.mode)) {
            return { ok: false, active: false, normalized: normalized, errors: errors, warnings: warnings };
        }
        if (normalized.mode === 'actual') {
            if (!Number.isFinite(normalized.actualFromMs) || !Number.isFinite(normalized.actualToMs)) {
                errors.push({ code: 'MISSING_ACTUAL_TIME', message: 'Chế độ actual cần đủ giờ vào và giờ ra của phiên nguồn.' });
            } else if (normalized.actualToMs <= normalized.actualFromMs) {
                errors.push({ code: 'INVALID_ACTUAL_CHRONOLOGY', message: 'Giờ ra thực tế phải sau giờ vào thực tế.' });
            }
        }
        if (normalized.allocations.length === 0) {
            errors.push({ code: 'MISSING_ALLOCATIONS', message: 'Override cần ít nhất một phân bổ lương.' });
        }

        var seenIds = new Set();
        normalized.allocations.forEach(function (allocation) {
            if (seenIds.has(allocation.id)) {
                errors.push({
                    code: 'DUPLICATE_ALLOCATION_ID',
                    allocationId: allocation.id,
                    message: 'Mã phân bổ lương bị trùng.'
                });
            }
            seenIds.add(allocation.id);
            if (!['teaching', 'receptionist', 'office'].includes(allocation.kind)) {
                errors.push({ code: 'INVALID_KIND', allocationId: allocation.id, message: 'Loại công của phân bổ không hợp lệ.' });
            }
            if (!['policy', 'manual'].includes(allocation.rateMode)) {
                errors.push({ code: 'INVALID_RATE_MODE', allocationId: allocation.id, message: 'Cách áp đơn giá phải là policy hoặc manual.' });
            }
            if (allocation.scheduleRef && allocation.scheduleRef.type && allocation.kind && allocation.scheduleRef.type !== allocation.kind) {
                errors.push({
                    code: 'SCHEDULE_KIND_MISMATCH',
                    allocationId: allocation.id,
                    message: 'Loại lịch liên kết không khớp loại công của phân bổ.'
                });
            }
            if (allocation.scheduleRef && allocation.scheduleRef.invalidType) {
                errors.push({
                    code: 'INVALID_SCHEDULE_TYPE',
                    allocationId: allocation.id,
                    message: 'Loại lịch liên kết không hợp lệ.'
                });
            }
            if (!Number.isFinite(allocation.fromMs) || !Number.isFinite(allocation.toMs)) {
                errors.push({ code: 'INVALID_TIME', allocationId: allocation.id, message: 'Phân bổ cần đủ giờ bắt đầu và kết thúc hợp lệ.' });
                return;
            }
            if (allocation.toMs <= allocation.fromMs) {
                errors.push({ code: 'INVALID_CHRONOLOGY', allocationId: allocation.id, message: 'Giờ kết thúc phân bổ phải sau giờ bắt đầu.' });
                return;
            }
            var duration = (allocation.toMs - allocation.fromMs) / 60000;
            if (duration > maxDurationMinutes) {
                errors.push({ code: 'DURATION_TOO_LONG', allocationId: allocation.id, message: 'Phân bổ vượt quá giới hạn một ngày làm việc.' });
            }
            if (normalized.mode === 'actual' && Number.isFinite(normalized.actualFromMs) && Number.isFinite(normalized.actualToMs) &&
                (allocation.fromMs < normalized.actualFromMs || allocation.toMs > normalized.actualToMs)) {
                errors.push({ code: 'OUTSIDE_ACTUAL_RANGE', allocationId: allocation.id, message: 'Phân bổ actual phải nằm trong giờ vào/ra nguồn.' });
            }
            if (allocation.rateMode === 'manual' && (!Number.isFinite(allocation.manualRate) || allocation.manualRate < 0)) {
                errors.push({ code: 'INVALID_MANUAL_RATE', allocationId: allocation.id, message: 'Đơn giá nhập tay phải là số không âm.' });
            }
        });

        if (normalized.adminEarly10.enabled) {
            var early10Target = normalized.allocations
                .filter(function (allocation) { return allocation.id === normalized.adminEarly10.allocationId; })[0];
            if (normalized.adminEarly10.minutes !== 10) {
                errors.push({
                    code: 'INVALID_ADMIN_EARLY10_MINUTES',
                    message: 'Quyết định Admin chỉ được cộng đúng 10 phút.'
                });
            }
            if (!early10Target) {
                errors.push({
                    code: 'ADMIN_EARLY10_ALLOCATION_NOT_FOUND',
                    message: 'Không xác định được phân bổ Dạy học nhận +10 phút của Admin.'
                });
            } else if (early10Target.kind !== 'teaching') {
                errors.push({
                    code: 'ADMIN_EARLY10_REQUIRES_TEACHING',
                    message: '+10 phút theo quyết định Admin chỉ áp dụng cho phân bổ Dạy học.'
                });
            }
        }

        for (var leftIndex = 0; leftIndex < normalized.allocations.length; leftIndex++) {
            for (var rightIndex = leftIndex + 1; rightIndex < normalized.allocations.length; rightIndex++) {
                var overlap = overlapMinutes(normalized.allocations[leftIndex], normalized.allocations[rightIndex]);
                if (overlap > 0) {
                    warnings.push({
                        code: 'OVERLAPPING_ALLOCATIONS',
                        allocationIds: [normalized.allocations[leftIndex].id, normalized.allocations[rightIndex].id],
                        minutes: overlap,
                        message: 'Các phân bổ chồng giờ; phần giao chỉ được trả một lần.'
                    });
                }
            }
        }

        return {
            ok: errors.length === 0,
            active: errors.length === 0 && normalized.active,
            normalized: normalized,
            errors: errors,
            warnings: warnings
        };
    }

    function mergeRanges(ranges) {
        var sorted = (ranges || [])
            .filter(function (range) { return range && range.toMs > range.fromMs; })
            .map(function (range) { return { fromMs: range.fromMs, toMs: range.toMs }; })
            .sort(function (a, b) { return a.fromMs - b.fromMs || a.toMs - b.toMs; });
        var merged = [];
        sorted.forEach(function (range) {
            var previous = merged[merged.length - 1];
            if (!previous || range.fromMs > previous.toMs) {
                merged.push({ fromMs: range.fromMs, toMs: range.toMs });
            } else if (range.toMs > previous.toMs) {
                previous.toMs = range.toMs;
            }
        });
        return merged;
    }

    function subtractRanges(fromMs, toMs, claimedRanges) {
        var remaining = [{ fromMs: fromMs, toMs: toMs }];
        mergeRanges(claimedRanges).forEach(function (claimed) {
            var next = [];
            remaining.forEach(function (candidate) {
                if (claimed.toMs <= candidate.fromMs || claimed.fromMs >= candidate.toMs) {
                    next.push(candidate);
                    return;
                }
                if (claimed.fromMs > candidate.fromMs) {
                    next.push({ fromMs: candidate.fromMs, toMs: Math.min(claimed.fromMs, candidate.toMs) });
                }
                if (claimed.toMs < candidate.toMs) {
                    next.push({ fromMs: Math.max(claimed.toMs, candidate.fromMs), toMs: candidate.toMs });
                }
            });
            remaining = next;
        });
        return remaining.filter(function (range) { return range.toMs > range.fromMs; });
    }

    function allocationPriority(allocation) {
        // Teaching owns an overlapping interval first. This reproduces the
        // real-world rule for one 07:00-11:00 tap containing a 07:30-09:00
        // class: 90 teaching minutes + 150 operational minutes, never 330.
        if (allocation.kind === 'teaching') return 0;
        if (allocation.kind === 'office') return 1;
        return 2;
    }

    function formatClock(milliseconds) {
        var date = new Date(milliseconds);
        try {
            return new Intl.DateTimeFormat('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23'
            }).format(date);
        } catch (error) {
            return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
        }
    }

    function formatMinutes(minutes) {
        var whole = Math.max(0, Math.round(minutes));
        var hours = Math.floor(whole / 60);
        var remainder = whole % 60;
        if (hours && remainder) return hours + 'h' + remainder + 'p';
        if (hours) return hours + 'h';
        return remainder + 'p';
    }

    function scheduleBranch(allocation) {
        return allocation.scheduleRef ? allocation.scheduleRef.branch : '';
    }

    function sameStringSet(left, right) {
        var a = uniqueStrings(left).sort();
        var b = uniqueStrings(right).sort();
        return a.length === b.length && a.every(function (value, index) { return value === b[index]; });
    }

    function canMergeAllocations(left, right) {
        if (!left || !right || !left.mergeGroupId || left.mergeGroupId !== right.mergeGroupId) return false;
        if (left.kind !== right.kind || left.toMs !== right.fromMs) return false;
        if (scheduleBranch(left) !== scheduleBranch(right)) return false;
        if (left.role !== right.role || left.roleName !== right.roleName) return false;
        if (!sameStringSet(left.subjectIds, right.subjectIds)) return false;
        if (left.rateMode !== right.rateMode || left.manualRate !== right.manualRate || left.roleRate !== right.roleRate) return false;
        return left.fixed === right.fixed;
    }

    function makeDaySegments(assignedEntries) {
        var pieces = [];
        assignedEntries.forEach(function (entry) {
            entry.paidRanges.forEach(function (range) {
                pieces.push({
                    allocationKey: entry.key,
                    allocationId: entry.allocation.id,
                    // report.js already understands these two legacy values in
                    // the edit-popup day breakdown. Keep the canonical kind too.
                    kind: entry.allocation.kind === 'teaching' ? 'day' : 'tiep-tan',
                    payrollKind: entry.allocation.kind,
                    startMs: range.fromMs,
                    endMs: range.toMs,
                    start: formatClock(range.fromMs),
                    end: formatClock(range.toMs),
                    minutes: Math.round((range.toMs - range.fromMs) / 60000),
                    label: entry.allocation.roleName,
                    branch: scheduleBranch(entry.allocation),
                    scheduleRef: entry.allocation.scheduleRef
                });
            });
        });
        pieces.sort(function (a, b) { return a.startMs - b.startMs || a.endMs - b.endMs; });
        return pieces.reduce(function (result, piece) {
            var previous = result[result.length - 1];
            if (previous && previous.allocationKey === piece.allocationKey && previous.endMs === piece.startMs) {
                previous.endMs = piece.endMs;
                previous.end = piece.end;
                previous.minutes += piece.minutes;
            } else {
                result.push(piece);
            }
            return result;
        }, []);
    }

    function groupAssignedEntries(entries) {
        var sorted = entries.slice().sort(function (a, b) {
            return a.allocation.fromMs - b.allocation.fromMs || a.allocation.sourceIndex - b.allocation.sourceIndex;
        });
        var groups = [];
        sorted.forEach(function (entry) {
            var group = groups[groups.length - 1];
            var previous = group && group.entries[group.entries.length - 1];
            if (previous && canMergeAllocations(previous.allocation, entry.allocation)) {
                group.entries.push(entry);
            } else {
                groups.push({ entries: [entry] });
            }
        });
        return groups;
    }

    function buildChip(group, sessionResult, allDaySegments, normalizeName) {
        var entries = group.entries;
        var allocations = entries.map(function (entry) { return entry.allocation; });
        var first = allocations[0];
        var fromMs = Math.min.apply(Math, allocations.map(function (allocation) { return allocation.fromMs; }));
        var toMs = Math.max.apply(Math, allocations.map(function (allocation) { return allocation.toMs; }));
        var paidRanges = entries.flatMap(function (entry) { return entry.paidRanges; });
        var paidMinutes = paidRanges.reduce(function (sum, range) {
            return sum + Math.round((range.toMs - range.fromMs) / 60000);
        }, 0);
        var basePaidMinutes = paidMinutes;
        var requestedMinutes = allocations.reduce(function (sum, allocation) {
            return sum + Math.round((allocation.toMs - allocation.fromMs) / 60000);
        }, 0);
        var overlapDeduction = Math.max(0, requestedMinutes - paidMinutes);
        var scheduleRef = first.scheduleRef;
        var branch = scheduleBranch(first);
        var roleRate = first.rateMode === 'manual' ? first.manualRate : first.roleRate;
        var sourceSession = sessionResult.normalized.session;
        var clonedSession = Object.assign({}, sourceSession, {
            role: first.role,
            roleName: first.roleName,
            roleRate: Number.isFinite(roleRate) ? roleRate : (sourceSession.roleRate || 0),
            isFixedShift: first.fixed,
            isAdminEdited: true,
            adminPayrollOverride: sourceSession.adminPayrollOverride
        });
        if (scheduleRef && first.kind === 'teaching' && scheduleRef.start) {
            clonedSession.linkedClassStart = scheduleRef.start;
        }
        if (scheduleRef && first.kind === 'receptionist' && (scheduleRef.shiftKey || scheduleRef.start)) {
            clonedSession.linkedReceptionistShift = scheduleRef.shiftKey || scheduleRef.start;
        }
        if (scheduleRef && first.kind === 'office' && (scheduleRef.shiftKey || scheduleRef.start)) {
            clonedSession.linkedOfficeShift = scheduleRef.shiftKey || scheduleRef.start;
        }
        var allocationIds = allocations.map(function (allocation) { return allocation.id; });
        var adminEarly10 = sessionResult.normalized.adminEarly10 || {};
        var adminEarly10Applies = adminEarly10.enabled === true &&
            adminEarly10.minutes === 10 &&
            basePaidMinutes > 0 &&
            allocations.some(function (allocation) {
                return allocation.kind === 'teaching' && allocation.id === adminEarly10.allocationId;
            });
        if (adminEarly10Applies) paidMinutes += adminEarly10.minutes;
        var label = formatClock(fromMs) + '–' + formatClock(toMs) + ' (' + first.roleName + ')';
        if (basePaidMinutes === 0) label += ' (trùng giờ)';
        if (adminEarly10Applies) label += ' ★+10p Admin';
        var tooltip = 'Admin override ' + sessionResult.normalized.mode + ': ' +
            formatMinutes(basePaidMinutes) + ' được tính';
        if (overlapDeduction > 0) tooltip += ' | Đã loại ' + formatMinutes(overlapDeduction) + ' chồng giờ';
        if (adminEarly10Applies) tooltip += ' | Admin quyết định cộng +10 phút, không dùng điều kiện lịch tự động';
        if (branch) tooltip += ' | ' + branch.toUpperCase();
        var mergedSegments = allocations.length > 1
            ? allocations.map(function (allocation) {
                return {
                    id: allocation.id,
                    start: formatClock(allocation.fromMs),
                    end: formatClock(allocation.toMs),
                    schedMinutes: Math.round((allocation.toMs - allocation.fromMs) / 60000),
                    isFixedShift: allocation.fixed,
                    branch: scheduleBranch(allocation),
                    scheduleRef: allocation.scheduleRef,
                    lop: allocation.roleName,
                    lopId: allocation.subjectIds.join('+') || allocation.role
                };
            })
            : null;
        var chipFilterName = typeof normalizeName === 'function'
            ? normalizeName(first.roleName)
            : first.roleName;

        return {
            text: label,
            class: paidMinutes > 0 ? 'chip-green' : 'chip-orange',
            paidMinutes: paidMinutes,
            tooltip: tooltip,
            sessionId: sourceSession.id,
            sessionData: clonedSession,
            isClickable: true,
            isAdminEdited: true,
            isAdminPayrollOverride: true,
            adminPayrollOverrideMode: sessionResult.normalized.mode,
            isAdminEarly10Override: adminEarly10Applies,
            bonus10Status: adminEarly10Applies ? 'admin_override' : null,
            bonus10Minutes: adminEarly10Applies ? adminEarly10.minutes : 0,
            bonus10Source: adminEarly10Applies ? 'admin_payroll_override' : '',
            payrollAllocationId: allocationIds.length === 1 ? allocationIds[0] : null,
            payrollAllocationIds: allocationIds,
            payrollAllocationRanges: paidRanges.map(function (range) {
                return {
                    fromISO: new Date(range.fromMs).toISOString(),
                    toISO: new Date(range.toMs).toISOString(),
                    minutes: Math.round((range.toMs - range.fromMs) / 60000)
                };
            }),
            payrollOverrideRevision: sessionResult.normalized.revision,
            payrollRateMode: first.rateMode,
            payrollRate: Number.isFinite(roleRate) ? roleRate : null,
            payrollRateSource: first.rateMode === 'manual' ? 'admin-override' : 'policy',
            isReceptionist: first.kind === 'receptionist' || first.kind === 'office',
            isOffice: first.kind === 'office',
            isTeaching: first.kind === 'teaching',
            isFixedShift: first.fixed,
            isWarning: paidMinutes === 0,
            chipFilterName: chipFilterName,
            subjectIds: first.subjectIds.slice(),
            subjectId: first.subjectIds.length === 1 ? first.subjectIds[0] : null,
            branch: branch || null,
            classStart: scheduleRef && scheduleRef.start ? scheduleRef.start : null,
            classEnd: scheduleRef && scheduleRef.end ? scheduleRef.end : null,
            classCompositeKey: scheduleRef && scheduleRef.documentKey ? scheduleRef.documentKey : null,
            classSectionKey: scheduleRef && (scheduleRef.section || scheduleRef.shiftKey)
                ? (scheduleRef.section || scheduleRef.shiftKey)
                : null,
            classIndex: scheduleRef
                ? (scheduleRef.rowIndex !== null ? scheduleRef.rowIndex : (scheduleRef.dayKey || null))
                : null,
            linkedScheduleShiftId: scheduleRef && scheduleRef.shiftId ? scheduleRef.shiftId : null,
            mergedSegments: mergedSegments,
            daySegments: allDaySegments.map(function (segment) { return Object.assign({}, segment); })
        };
    }

    function buildOverrideChips(sessions, options) {
        var sourceSessions = Array.isArray(sessions) ? sessions : [];
        var settings = options || {};
        var validResults = [];
        var invalidOverrides = [];
        sourceSessions.forEach(function (session, sessionIndex) {
            if (!session || !session.adminPayrollOverride) return;
            var validation = validateOverride(session, settings);
            validation.sessionIndex = sessionIndex;
            if (validation.active) validResults.push(validation);
            else if (validation.normalized.mode !== 'schedule') invalidOverrides.push(validation);
        });

        if (validResults.length === 0) {
            return {
                applied: false,
                chips: [],
                totalPaidMinutes: 0,
                handledSessionIds: [],
                validations: [],
                invalidOverrides: invalidOverrides,
                warnings: invalidOverrides.flatMap(function (result) { return result.warnings || []; })
            };
        }

        var flattened = [];
        validResults.forEach(function (validation, validationIndex) {
            validation.normalized.allocations.forEach(function (allocation) {
                flattened.push({
                    key: validationIndex + ':' + allocation.id,
                    validationIndex: validationIndex,
                    sessionIndex: validation.sessionIndex,
                    allocation: allocation,
                    paidRanges: []
                });
            });
        });
        flattened.sort(function (left, right) {
            return allocationPriority(left.allocation) - allocationPriority(right.allocation) ||
                left.allocation.fromMs - right.allocation.fromMs ||
                asText(validResults[left.validationIndex].normalized.sessionId)
                    .localeCompare(asText(validResults[right.validationIndex].normalized.sessionId)) ||
                asText(left.allocation.id).localeCompare(asText(right.allocation.id)) ||
                left.sessionIndex - right.sessionIndex ||
                left.allocation.sourceIndex - right.allocation.sourceIndex;
        });

        var claimed = [];
        var unionWarnings = [];
        flattened.forEach(function (entry) {
            entry.paidRanges = subtractRanges(entry.allocation.fromMs, entry.allocation.toMs, claimed);
            var requestedMinutes = Math.round((entry.allocation.toMs - entry.allocation.fromMs) / 60000);
            var payableMinutes = entry.paidRanges.reduce(function (sum, range) {
                return sum + Math.round((range.toMs - range.fromMs) / 60000);
            }, 0);
            if (payableMinutes < requestedMinutes) {
                unionWarnings.push({
                    code: 'DUPLICATE_PAY_RANGE_REMOVED',
                    sessionId: validResults[entry.validationIndex].normalized.sessionId,
                    allocationId: entry.allocation.id,
                    minutes: requestedMinutes - payableMinutes,
                    message: 'Phần giờ trùng với phân bổ ưu tiên khác đã bị loại khỏi lương.'
                });
            }
            claimed = mergeRanges(claimed.concat(entry.paidRanges));
        });
        var daySegments = makeDaySegments(flattened);
        var chips = [];
        validResults.forEach(function (validation, validationIndex) {
            var entries = flattened.filter(function (entry) { return entry.validationIndex === validationIndex; });
            groupAssignedEntries(entries).forEach(function (group) {
                chips.push(buildChip(group, validation, daySegments, settings.normalizeChipFilterName));
            });
        });
        chips.sort(function (left, right) {
            var leftStart = left.payrollAllocationRanges[0]
                ? new Date(left.payrollAllocationRanges[0].fromISO).getTime()
                : Infinity;
            var rightStart = right.payrollAllocationRanges[0]
                ? new Date(right.payrollAllocationRanges[0].fromISO).getTime()
                : Infinity;
            return leftStart - rightStart;
        });

        return {
            applied: true,
            chips: chips,
            totalPaidMinutes: chips.reduce(function (sum, chip) { return sum + chip.paidMinutes; }, 0),
            handledSessionIds: validResults.map(function (result) { return result.normalized.sessionId; }),
            handledSessionIndexes: validResults.map(function (result) { return result.sessionIndex; }),
            validations: validResults,
            invalidOverrides: invalidOverrides,
            warnings: validResults.flatMap(function (result) { return result.warnings || []; }).concat(unionWarnings)
        };
    }

    return {
        SCHEMA_VERSION: SCHEMA_VERSION,
        normalizeAllocation: function (allocation, context) {
            return normalizeAllocation(allocation, context || { session: {}, index: 0 });
        },
        normalizeOverride: normalizeOverride,
        validateOverride: validateOverride,
        buildOverrideChips: buildOverrideChips,
        mergeRanges: mergeRanges,
        subtractRanges: subtractRanges,
        canMergeAllocations: canMergeAllocations
    };
}));
