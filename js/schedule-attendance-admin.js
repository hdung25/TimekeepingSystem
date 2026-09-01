/*
 * ScheduleAttendanceAdmin
 * -----------------------
 * Pure helpers shared by the schedule-side attendance editor.  This module
 * deliberately knows nothing about Firebase or the DOM, so matching and
 * validation can be exercised before any write is attempted.
 *
 * Public contracts:
 *   buildShiftWindow(dateKey, shiftOrStart, end?)
 *   toDateTimeLocal(value)
 *   resolveSessionForShift(sessions, shift, window?)
 *   fingerprintSession(session)
 *   createDraft(session, window?)
 *   validateDraft(draft, window?, { now? })
 *   previewState(draft, validation?)
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ScheduleAttendanceAdmin = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var HOUR_MS = 60 * 60 * 1000;
    var DAY_MS = 24 * HOUR_MS;
    var WINDOW_MARGIN_MS = 12 * HOUR_MS;

    function codedError(code, message) {
        var error = new Error(message);
        error.code = code;
        return error;
    }

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    function parseDateKey(dateKey) {
        var match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        var year = Number(match[1]);
        var month = Number(match[2]);
        var day = Number(match[3]);
        var date = new Date(year, month - 1, day, 0, 0, 0, 0);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            return null;
        }
        return { year: year, month: month, day: day };
    }

    function parseClock(value) {
        var match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!match) return null;
        var hour = Number(match[1]);
        var minute = Number(match[2]);
        var second = Number(match[3] || 0);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
            return null;
        }
        return {
            hour: hour,
            minute: minute,
            second: second,
            label: pad2(hour) + ':' + pad2(minute)
        };
    }

    function localDate(parts, clock) {
        return new Date(
            parts.year,
            parts.month - 1,
            parts.day,
            clock.hour,
            clock.minute,
            clock.second,
            0
        );
    }

    function buildShiftWindow(dateKey, shiftOrStart, endValue) {
        var dateParts = parseDateKey(dateKey);
        if (!dateParts) {
            throw codedError('INVALID_DATE_KEY', 'Ngày của ca phải có định dạng YYYY-MM-DD.');
        }

        var shift = shiftOrStart && typeof shiftOrStart === 'object'
            ? shiftOrStart
            : { start: shiftOrStart, end: endValue };
        var startClock = parseClock(shift.startClock || shift.start);
        var endClock = parseClock(shift.endClock || shift.end);
        if (!startClock || !endClock) {
            throw codedError('INVALID_SHIFT_TIME', 'Ca phải có giờ bắt đầu và kết thúc hợp lệ.');
        }

        var startDate = localDate(dateParts, startClock);
        var endDate = localDate(dateParts, endClock);
        var overnight = endDate.getTime() <= startDate.getTime();
        if (overnight) endDate = new Date(endDate.getTime() + DAY_MS);

        var durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
        if (durationMinutes <= 0 || durationMinutes > 24 * 60) {
            throw codedError('INVALID_SHIFT_WINDOW', 'Khung giờ ca phải dài hơn 0 và không quá 24 giờ.');
        }

        return {
            dateKey: String(dateKey),
            shiftId: shift.shiftId || shift.linkedScheduleShiftId || null,
            startClock: startClock.label,
            endClock: endClock.label,
            // Short aliases are the write-path contract.  The explicit
            // startDate/endDate names remain useful at form boundaries.
            start: startDate,
            end: endDate,
            startDate: startDate,
            endDate: endDate,
            startMs: startDate.getTime(),
            endMs: endDate.getTime(),
            startISO: startDate.toISOString(),
            endISO: endDate.toISOString(),
            overnight: overnight,
            durationMinutes: durationMinutes
        };
    }

    function valueToDate(value) {
        if (value === null || value === undefined || value === '') return null;
        if (value instanceof Date) return new Date(value.getTime());
        if (value && typeof value.toDate === 'function') {
            var timestampDate = value.toDate();
            return timestampDate instanceof Date ? new Date(timestampDate.getTime()) : null;
        }
        var parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    function toDateTimeLocal(value) {
        var date = valueToDate(value);
        if (!date) return '';
        return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
            'T' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
    }

    function normalizeClock(value) {
        var parsed = parseClock(value);
        return parsed ? parsed.label : '';
    }

    function matchResult(status, method, session, candidates, error, reason) {
        return {
            status: status,
            kind: status,
            method: method || null,
            matchType: method || null,
            session: session || null,
            candidates: candidates || [],
            matched: status === 'matched',
            ambiguous: status === 'ambiguous',
            code: status === 'ambiguous' ? 'AMBIGUOUS_SESSION' : null,
            reason: reason || null,
            error: error || null
        };
    }

    function chooseUnique(matches, method, reasonLabel) {
        if (matches.length === 1) {
            // Do not clone.  The caller fingerprints this exact object before a
            // write and can compare it with the freshly loaded session later.
            return matchResult('matched', method, matches[0], matches, null, null);
        }
        if (matches.length > 1) {
            return matchResult(
                'ambiguous',
                method,
                null,
                matches,
                'Có nhiều phiên chấm công cùng khớp ' + reasonLabel + '. Không thể tự chọn an toàn.',
                'multiple-' + method
            );
        }
        return null;
    }

    function resolveWindow(shift, suppliedWindow) {
        if (suppliedWindow && Number.isFinite(suppliedWindow.startMs) && Number.isFinite(suppliedWindow.endMs)) {
            return suppliedWindow;
        }
        if (shift && Number.isFinite(shift.startMs) && Number.isFinite(shift.endMs)) return shift;
        if (shift && shift.dateKey && (shift.start || shift.startClock) && (shift.end || shift.endClock)) {
            try {
                return buildShiftWindow(shift.dateKey, shift);
            } catch (_error) {
                return null;
            }
        }
        return null;
    }

    function resolveSessionForShift(sessions, shift, suppliedWindow) {
        var window = resolveWindow(shift, suppliedWindow);
        var shiftId = String((shift && (shift.shiftId || shift.linkedScheduleShiftId)) ||
            (window && window.shiftId) || '').trim();
        var shiftCompositeKey = String(shift && shift.compositeKey || '').trim();
        var shiftSection = String(shift && (shift.section || shift.scheduleSection) || '').trim();
        var source = Array.isArray(sessions) ? sessions.filter(function (session) {
            if (!session || typeof session !== 'object') return false;
            // Office/reception attendance can overlap a teaching period but is
            // a different payroll source. It must never drive a class chip or
            // be selected by the schedule correction editor.
            if (String(session.linkedReceptionistShift || '').trim() ||
                String(session.linkedOfficeShift || '').trim()) return false;
            // Once a session has an explicit schedule identity, do not let the
            // looser start/overlap fallbacks attach it to another class.
            var linkedShiftId = String(session.linkedScheduleShiftId || '').trim();
            var linkedCompositeKey = String(session.linkedScheduleCompositeKey || '').trim();
            var linkedSection = String(session.linkedScheduleSection || '').trim();
            if (shiftId && linkedShiftId && linkedShiftId !== shiftId) return false;
            if (shiftCompositeKey && linkedCompositeKey && linkedCompositeKey !== shiftCompositeKey) return false;
            if (shiftSection && linkedSection && linkedSection !== shiftSection) return false;
            return true;
        }) : [];
        var shiftStart = normalizeClock(
            (shift && (shift.startClock || shift.start)) || (window && window.startClock)
        );

        if (shiftId) {
            var linkedById = source.filter(function (session) {
                return String(session.linkedScheduleShiftId || '').trim() === shiftId;
            });
            var idResult = chooseUnique(linkedById, 'linkedScheduleShiftId', 'mã ca');
            if (idResult) return idResult;
        }

        if (shiftStart) {
            var linkedByStart = source.filter(function (session) {
                return normalizeClock(session.linkedClassStart) === shiftStart;
            });
            var startResult = chooseUnique(linkedByStart, 'linkedClassStart', 'giờ bắt đầu ca');
            if (startResult) return startResult;
        }

        if (!window) {
            return matchResult('none', null, null, [], null, 'missing-shift-window');
        }

        var minimumOverlapMs = 10 * 60 * 1000;
        var overlapping = source.filter(function (session) {
            var startDate = valueToDate(session.checkIn || session.start);
            if (!startDate) return false;
            var sessionStart = startDate.getTime();
            var endDate = valueToDate(session.checkOut);
            if (endDate) {
                var sessionEnd = endDate.getTime();
                if (sessionEnd <= sessionStart) return false;
                // A few seconds/minutes leaking across an adjacent class boundary
                // is not evidence that the session belongs to this row.  Keep the
                // resolver aligned with the payroll overlap guard and require a
                // meaningful 10-minute intersection before using the loose legacy
                // fallback. Explicit schedule links above still take precedence.
                var overlapMs = Math.min(sessionEnd, window.endMs) -
                    Math.max(sessionStart, window.startMs);
                var sessionDurationMs = sessionEnd - sessionStart;
                var shiftDurationMs = window.endMs - window.startMs;
                var shorterIntervalMs = Math.min(sessionDurationMs, shiftDurationMs);
                return overlapMs >= minimumOverlapMs && shorterIntervalMs > 0 &&
                    overlapMs / shorterIntervalMs >= 0.5;
            }

            // An open session has no interval end yet.  Match it only when its
            // check-in is inside the shift or less than one hour early. Treating
            // it as infinite (or allowing the full 90-minute adjacent-period
            // gap) would incorrectly attach a ca-1 session to ca-2.
            return sessionStart > window.startMs - 60 * 60 * 1000 && sessionStart < window.endMs;
        });
        var overlapResult = chooseUnique(overlapping, 'overlap', 'khung giờ');
        if (overlapResult) return overlapResult;
        return matchResult('none', null, null, [], null, 'no-session-match');
    }

    // Shared schedule/attendance evidence boundary. Both the popup preview and
    // the server transaction use the resolver above, so a VP/VĐX save cannot
    // disagree with the chip about which physical session belongs to the row.
    function workedAttendanceConflictForShift(attendance, shift, suppliedWindow) {
        var source = attendance && typeof attendance === 'object' ? attendance : null;
        var hasCanonicalSessions = Array.isArray(source && source.sessions) && source.sessions.length > 0;
        var sessions = hasCanonicalSessions
            ? source.sessions
            : (source && source.checkIn ? [{
                id: 'legacy',
                checkIn: source.checkIn,
                checkOut: source.checkOut || null,
                start: source.checkIn,
                isAbsent: !!source.isAbsent
            }] : []);
        // Absence markers are not worked evidence and must be removed before
        // priority matching. Otherwise an exact-linked absent marker could win
        // ahead of a second, genuinely worked overlapping session.
        var workedSessions = sessions.filter(function (session) {
            return !!session && !session.isAbsent && !!(session.checkIn || session.start);
        });
        var resolution = resolveSessionForShift(workedSessions, shift || {}, suppliedWindow);
        if (resolution.status === 'ambiguous') {
            return {
                conflict: true,
                kind: 'ambiguous',
                resolution: resolution,
                session: null
            };
        }
        var session = resolution.status === 'matched' ? resolution.session : null;
        var worked = !!session;
        return {
            conflict: worked,
            kind: worked ? 'worked' : 'none',
            resolution: resolution,
            session: session
        };
    }

    function stableValue(value, seen) {
        if (value === undefined) return { $undefined: true };
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (Number.isNaN(value)) return { $number: 'NaN' };
            if (value === Infinity) return { $number: 'Infinity' };
            if (value === -Infinity) return { $number: '-Infinity' };
            return value;
        }
        if (value instanceof Date) return { $date: value.toISOString() };
        if (value && typeof value.toDate === 'function') {
            var converted = value.toDate();
            if (converted instanceof Date && Number.isFinite(converted.getTime())) {
                return { $timestamp: converted.toISOString() };
            }
        }
        if (typeof value === 'function') return { $function: String(value) };
        if (typeof value !== 'object') return String(value);
        if (seen.indexOf(value) !== -1) {
            throw codedError('CIRCULAR_SESSION', 'Không thể tạo fingerprint cho dữ liệu phiên bị tham chiếu vòng.');
        }
        seen.push(value);
        var normalized;
        if (Array.isArray(value)) {
            normalized = value.map(function (item) { return stableValue(item, seen); });
        } else {
            normalized = {};
            Object.keys(value).sort().forEach(function (key) {
                normalized[key] = stableValue(value[key], seen);
            });
        }
        seen.pop();
        return normalized;
    }

    function fingerprintSession(session) {
        return 'schedule-attendance-v1:' + JSON.stringify(stableValue(session === undefined ? null : session, []));
    }

    function createDraft(session, window) {
        var sourceSession = session && typeof session === 'object' ? session : null;
        var sessionCheckIn = sourceSession && (sourceSession.checkIn || sourceSession.start);
        var sessionCheckOut = sourceSession && sourceSession.checkOut;
        var state = 'none';
        if (sessionCheckIn && sessionCheckOut) state = 'closed';
        else if (sessionCheckIn) state = 'open';

        var defaultCheckIn = window && window.startDate ? toDateTimeLocal(window.startDate) : '';
        var defaultCheckOut = window && window.endDate ? toDateTimeLocal(window.endDate) : '';
        var count = sourceSession && sourceSession.studentCount !== null && sourceSession.studentCount !== undefined
            ? sourceSession.studentCount
            : '';

        return {
            mode: state,
            state: state,
            checkIn: sessionCheckIn ? toDateTimeLocal(sessionCheckIn) : defaultCheckIn,
            checkOut: sessionCheckOut ? toDateTimeLocal(sessionCheckOut) : (state === 'none' ? defaultCheckOut : ''),
            isAbsent: !!(sourceSession && sourceSession.isAbsent),
            studentCount: count,
            studentCountStatus: (sourceSession && sourceSession.studentCountStatus) || null,
            // Merely opening the popup or editing time must not approve, reject
            // or clear an existing class-size review. The UI flips this flag
            // only after an explicit count edit/clear/use-planned action.
            studentCountDirty: false,
            bonus10: !!(sourceSession && sourceSession.bonus10),
            sessionId: sourceSession ? sourceSession.id : null,
            linkedScheduleShiftId: sourceSession ? (sourceSession.linkedScheduleShiftId || null) :
                ((window && window.shiftId) || null),
            linkedClassStart: sourceSession ? (sourceSession.linkedClassStart || null) :
                ((window && window.startClock) || null),
            originalFingerprint: fingerprintSession(sourceSession),
            sourceSession: sourceSession
        };
    }

    function parseLocalDateTime(value) {
        if (value === null || value === undefined || value === '') return null;
        if (value instanceof Date || (value && typeof value.toDate === 'function') || typeof value === 'number') {
            return valueToDate(value);
        }
        var raw = String(value).trim();
        var localMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/);
        if (localMatch) {
            var year = Number(localMatch[1]);
            var month = Number(localMatch[2]);
            var day = Number(localMatch[3]);
            var hour = Number(localMatch[4]);
            var minute = Number(localMatch[5]);
            var second = Number(localMatch[6] || 0);
            if (hour > 23 || minute > 59 || second > 59) return null;
            var local = new Date(year, month - 1, day, hour, minute, second, 0);
            if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day ||
                local.getHours() !== hour || local.getMinutes() !== minute || local.getSeconds() !== second) {
                return null;
            }
            return local;
        }
        return valueToDate(raw);
    }

    function normalizeStudentCount(value) {
        if (value === null || value === undefined || String(value).trim() === '') {
            return { ok: true, value: null };
        }
        var numeric = Number(value);
        if (!Number.isInteger(numeric) || numeric < 1 || numeric > 500) {
            return {
                ok: false,
                value: null,
                code: 'INVALID_STUDENT_COUNT',
                message: 'Sĩ số phải là số nguyên từ 1 đến 500.'
            };
        }
        return { ok: true, value: numeric };
    }

    function validateDraft(draft, window, options) {
        var input = draft || {};
        var opts = options || {};
        // `mode` is canonical in the popup.  `state` remains accepted for
        // callers/tests created before the form contract was finalized.
        var state = String(input.mode || input.state || '').trim().toLowerCase();
        var errors = [];
        var countResult = normalizeStudentCount(input.studentCount);
        var checkInDate = null;
        var checkOutDate = null;

        function addError(code, message, field) {
            errors.push({ code: code, message: message, field: field || null });
        }

        if (['none', 'open', 'closed'].indexOf(state) === -1) {
            addError('INVALID_STATE', 'Trạng thái chấm công phải là none, open hoặc closed.', 'state');
        }
        if (!countResult.ok) {
            addError(countResult.code, countResult.message, 'studentCount');
        }

        if (state !== 'none') {
            checkInDate = parseLocalDateTime(input.checkIn);
            if (!checkInDate) addError('CHECKIN_REQUIRED', 'Giờ vào không hợp lệ hoặc đang để trống.', 'checkIn');
        }

        if (state === 'open') {
            if (input.checkOut !== null && input.checkOut !== undefined && String(input.checkOut).trim() !== '') {
                addError('OPEN_HAS_CHECKOUT', 'Ca đang mở không được có giờ ra.', 'checkOut');
            }
        } else if (state === 'closed') {
            checkOutDate = parseLocalDateTime(input.checkOut);
            if (!checkOutDate) addError('CHECKOUT_REQUIRED', 'Ca đã đóng phải có giờ ra hợp lệ.', 'checkOut');
        }

        if (checkInDate && checkOutDate) {
            var duration = checkOutDate.getTime() - checkInDate.getTime();
            if (duration <= 0) {
                addError('CHECKOUT_NOT_AFTER_CHECKIN', 'Giờ ra phải sau giờ vào.', 'checkOut');
            } else if (duration > DAY_MS) {
                addError('SESSION_TOO_LONG', 'Một phiên chấm công không được dài quá 24 giờ.', 'checkOut');
            }
        }

        var nowDate = parseLocalDateTime(opts.now) || new Date();
        var nowMs = nowDate.getTime();
        if (checkInDate && checkInDate.getTime() > nowMs) {
            addError('FUTURE_CHECKIN', 'Không thể chấm giờ vào ở tương lai.', 'checkIn');
        }
        if (checkOutDate && checkOutDate.getTime() > nowMs) {
            addError('FUTURE_CHECKOUT', 'Không thể chấm giờ ra ở tương lai.', 'checkOut');
        }

        if (state === 'open' && window && Number.isFinite(window.endMs) && nowMs > window.endMs) {
            addError('PAST_SHIFT_CANNOT_STAY_OPEN', 'Ca đã kết thúc không thể để ở trạng thái đang mở.', 'state');
        }

        if (window && Number.isFinite(window.startMs) && Number.isFinite(window.endMs)) {
            var allowedStart = window.startMs - WINDOW_MARGIN_MS;
            var allowedEnd = window.endMs + WINDOW_MARGIN_MS;
            if (checkInDate && (checkInDate.getTime() < allowedStart || checkInDate.getTime() > allowedEnd)) {
                addError('CHECKIN_OUTSIDE_SHIFT_WINDOW', 'Giờ vào phải nằm trong phạm vi 12 giờ quanh ca.', 'checkIn');
            }
            if (checkOutDate && (checkOutDate.getTime() < allowedStart || checkOutDate.getTime() > allowedEnd)) {
                addError('CHECKOUT_OUTSIDE_SHIFT_WINDOW', 'Giờ ra phải nằm trong phạm vi 12 giờ quanh ca.', 'checkOut');
            }
        }

        var first = errors[0] || null;
        return {
            ok: errors.length === 0,
            error: first ? first.message : null,
            code: first ? first.code : null,
            errors: errors,
            mode: state,
            state: state,
            checkInISO: checkInDate ? checkInDate.toISOString() : null,
            checkOutISO: checkOutDate ? checkOutDate.toISOString() : null,
            studentCount: countResult.ok ? countResult.value : null
        };
    }

    function previewState(draft, validation) {
        var input = draft || {};
        var state = String(input.mode || input.state || 'none').toLowerCase();
        var descriptor;

        if (validation && validation.ok === false) {
            descriptor = {
                key: 'invalid',
                label: 'Dữ liệu chưa hợp lệ',
                tone: 'danger',
                chipClass: 'chip-orange',
                description: validation.error || 'Kiểm tra lại dữ liệu chấm công.'
            };
        } else if (input.isAbsent === true && state !== 'none') {
            descriptor = {
                key: 'absent',
                label: 'Vắng mặt',
                tone: 'muted',
                chipClass: 'chip-gray',
                description: 'Phiên được đánh dấu vắng và không tính phút làm.'
            };
        } else if (state === 'open') {
            descriptor = {
                key: 'open',
                label: 'Đang trong ca',
                tone: 'info',
                chipClass: 'chip-blue',
                description: 'Đã có giờ vào và chưa có giờ ra.'
            };
        } else if (state === 'closed') {
            descriptor = {
                key: 'closed',
                label: 'Đã hoàn tất',
                tone: 'success',
                chipClass: 'chip-green',
                description: 'Phiên có đủ giờ vào và giờ ra.'
            };
        } else {
            descriptor = {
                key: 'none',
                label: 'Chưa chấm công',
                tone: 'neutral',
                chipClass: 'chip-waiting',
                description: 'Ca chưa có phiên chấm công liên kết.'
            };
        }

        return {
            key: descriptor.key,
            state: descriptor.key,
            label: descriptor.label,
            tone: descriptor.tone,
            chipClass: descriptor.chipClass,
            className: descriptor.chipClass,
            description: descriptor.description
        };
    }

    return Object.freeze({
        buildShiftWindow: buildShiftWindow,
        toDateTimeLocal: toDateTimeLocal,
        resolveSessionForShift: resolveSessionForShift,
        workedAttendanceConflictForShift: workedAttendanceConflictForShift,
        fingerprintSession: fingerprintSession,
        createDraft: createDraft,
        validateDraft: validateDraft,
        previewState: previewState
    });
}));
