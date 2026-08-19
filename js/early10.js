// ================= CHÍNH SÁCH SỚM 10 PHÚT =================
// Một ca chỉ được cộng 10p khi thỏa CẢ BA điều kiện:
//   1. Môn học của ca được đánh dấu "cho phép sớm 10p" (trang Môn Học).
//   2. Người dạy thuộc chế độ cũ HOẶC chưa phân loại. Chỉ chế độ mới bị chặn.
//   3. Giờ chấm công vào thực tế sớm hơn giờ vào ca ÍT NHẤT 10 phút.
//
// Quên bấm "Sớm 10p" thì không được cộng — hệ thống không tự đi tìm.
// File này chỉ chứa logic thuần (không đụng DOM/Firestore) để test được bằng Node.
(function (global) {
    'use strict';

    var EARLY10_BONUS_MINUTES = 10;      // số phút được cộng vào ca
    var EARLY10_REQUIRED_MINUTES = 10;   // phải đến sớm ít nhất bằng ngần này

    // --- Môn học ---------------------------------------------------------

    // subjects: [{ id, parentId, isGroup, allowEarly10 }]
    // Trả về Map id -> true/false. Môn con KHÔNG tự kế thừa nhóm cha lúc chạy;
    // giá trị kế thừa được ghi thẳng vào môn con lúc admin bật ở nhóm cha,
    // nên ở đây đọc đúng cờ của từng môn — dễ đoán, không có luật ngầm.
    function buildSubjectEarly10Map(subjects) {
        var map = {};
        (subjects || []).forEach(function (subject) {
            if (!subject || !subject.id) return;
            map[String(subject.id)] = subject.allowEarly10 === true;
        });
        return map;
    }

    // session.role lưu id môn, nhiều môn gộp thì nối bằng "+" (VD "abc+def").
    // Ca gộp được tính hợp lệ khi CÓ ÍT NHẤT MỘT môn cho phép.
    function splitSubjectIds(sessionRole) {
        if (!sessionRole) return [];
        return String(sessionRole)
            .split('+')
            .map(function (part) { return part.trim(); })
            .filter(function (part) { return part.length > 0; });
    }

    function uniqueSubjectIds(values) {
        var result = [];
        var seen = {};

        function add(value) {
            if (Array.isArray(value)) {
                value.forEach(add);
                return;
            }
            if (value === null || value === undefined) return;
            String(value).split('+').forEach(function (part) {
                var id = part.trim();
                if (!id || seen[id]) return;
                seen[id] = true;
                result.push(id);
            });
        }

        values.forEach(add);
        return result;
    }

    // Lấy mã môn thật gắn với chip. Không dùng session.role một mình vì role
    // có thể đã được tự gán thành mã vai trò/lương, không phải mã môn trong lịch.
    function getChipSubjectIds(chip) {
        var item = chip || {};
        var session = item.sessionData || {};
        var ids = [];

        ids.push(item.subjectIds, item.subjectId, item.lopId);
        ids.push(item.schedData && item.schedData.lopId);
        ids.push(session.subjectIds, session.subjectId, session.lopId);
        if (Array.isArray(item.mergedSegments)) {
            item.mergedSegments.forEach(function (segment) {
                ids.push(segment && (segment.subjectIds || segment.subjectId || segment.lopId));
            });
        }

        var resolved = uniqueSubjectIds(ids);
        // Compatibility với chip cũ chưa có subjectIds/lopId.
        if (resolved.length === 0) resolved = splitSubjectIds(session.role);
        return resolved;
    }

    function isSubjectIdsEarly10Allowed(subjectIds, subjectMap) {
        var ids = uniqueSubjectIds([subjectIds]);
        if (ids.length === 0) return false;
        return ids.some(function (id) { return subjectMap[id] === true; });
    }

    function isChipEarly10Allowed(chip, subjectMap) {
        return isSubjectIdsEarly10Allowed(getChipSubjectIds(chip), subjectMap || {});
    }

    function isSubjectEarly10Allowed(sessionRole, subjectMap) {
        var ids = splitSubjectIds(sessionRole);
        if (ids.length === 0) return false;
        return ids.some(function (id) { return subjectMap[id] === true; });
    }

    function getAllowingSubjectNames(sessionRole, subjects) {
        var ids = splitSubjectIds(sessionRole);
        return (subjects || [])
            .filter(function (s) { return s && ids.indexOf(String(s.id)) !== -1 && s.allowEarly10 === true; })
            .map(function (s) { return s.name; });
    }

    // --- Giáo viên -------------------------------------------------------

    // 'old' | 'new' | 'unset'. Cả old và unset đều được áp dụng Sớm 10p.
    function getTeachingMode(user) {
        var mode = user && user.teachingMode;
        if (mode === 'old' || mode === 'new') return mode;
        return 'unset';
    }

    function isOldModeTeacher(user) {
        return getTeachingMode(user) === 'old';
    }

    // --- Giờ giấc --------------------------------------------------------

    // "07:30" -> 450 phút. Trả null nếu không đọc được.
    function parseClockToMinutes(clock) {
        if (typeof clock !== 'string') return null;
        var match = clock.trim().match(/^(\d{1,2}):(\d{2})/);
        if (!match) return null;
        var hours = Number(match[1]);
        var minutes = Number(match[2]);
        if (!isFinite(hours) || !isFinite(minutes)) return null;
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
        return hours * 60 + minutes;
    }

    // Chấp nhận Date, chuỗi ISO, hoặc Firestore Timestamp ({seconds} / .toDate()).
    function toDate(value) {
        if (!value) return null;
        if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
        if (typeof value === 'object') {
            if (typeof value.toDate === 'function') {
                try {
                    var converted = value.toDate();
                    return converted instanceof Date && !isNaN(converted.getTime()) ? converted : null;
                } catch (e) { return null; }
            }
            if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
            return null;
        }
        var parsed = new Date(value);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    function getMinutesOfDay(value) {
        var date = toDate(value);
        if (!date) return null;
        return date.getHours() * 60 + date.getMinutes();
    }

    function getSecondsOfDay(value) {
        var date = toDate(value);
        if (!date) return null;
        return date.getHours() * 3600 + date.getMinutes() * 60 +
            date.getSeconds() + date.getMilliseconds() / 1000;
    }

    function formatMinutesOfDay(totalMinutes) {
        if (totalMinutes === null || totalMinutes === undefined) return '??:??';
        var normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
        var hours = Math.floor(normalized / 60);
        var minutes = normalized % 60;
        return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
    }

    // Số phút đến sớm so với giờ vào ca. Âm = đến muộn.
    function getEarlyMinutes(checkIn, classStart) {
        var checkInSeconds = getSecondsOfDay(checkIn);
        var startMinutes = parseClockToMinutes(classStart);
        if (checkInSeconds === null || startMinutes === null) return null;

        // Không bỏ qua giây: 07:20:01 so với ca 07:30 mới chỉ sớm 9p59s,
        // không được làm tròn thành đủ 10 phút.
        var diff = (startMinutes * 60 - checkInSeconds) / 60;
        // Ca đêm/qua ngày: chênh lệch quá nửa ngày thì quy về cùng vòng 24h.
        if (diff > 720) diff -= 1440;
        if (diff < -720) diff += 1440;
        return diff;
    }

    // Trạng thái chính sách dùng chung cho chip và bước xác nhận.
    function evaluatePolicyEligibility(input) {
        var options = input || {};
        var subjectMap = options.subjectMap || buildSubjectEarly10Map(options.subjects);
        var subjectAllowed = Array.isArray(options.subjectIds) && options.subjectIds.length > 0
            ? isSubjectIdsEarly10Allowed(options.subjectIds, subjectMap)
            : isSubjectEarly10Allowed(options.sessionRole, subjectMap);

        if (!subjectAllowed) {
            return {
                ok: false,
                code: 'subject',
                teachingMode: getTeachingMode(options.user),
                message: 'Môn học của ca này không áp dụng chính sách sớm 10 phút. ' +
                    'Chính sách chỉ áp dụng cho các môn được đánh dấu trong trang Môn Học.'
            };
        }

        var mode = getTeachingMode(options.user);
        if (mode === 'new') {
            return {
                ok: false,
                code: 'mode',
                teachingMode: mode,
                message: 'Nhân viên này đã được xác định là chế độ mới nên không áp dụng chính sách sớm 10 phút.'
            };
        }

        return { ok: true, code: 'ok', teachingMode: mode, message: '' };
    }

    // --- Quyết định ------------------------------------------------------

    // input: { sessionRole, subjectIds, subjectMap, subjects, user, checkIn, classStart }
    // return: { ok, code, message, earlyMinutes, checkInLabel, startLabel }
    function evaluateEarly10Request(input) {
        var options = input || {};
        var subjectMap = options.subjectMap || buildSubjectEarly10Map(options.subjects);
        var startLabel = options.classStart || '??:??';
        var checkInMinutes = getMinutesOfDay(options.checkIn);
        var checkInLabel = checkInMinutes === null ? '??:??' : formatMinutesOfDay(checkInMinutes);
        var earlyMinutesExact = getEarlyMinutes(options.checkIn, options.classStart);
        var earlyMinutes = earlyMinutesExact === null ? null : Math.floor(earlyMinutesExact + 1e-9);

        function fail(code, message) {
            return {
                ok: false,
                code: code,
                message: message,
                earlyMinutes: earlyMinutes,
                checkInLabel: checkInLabel,
                startLabel: startLabel
            };
        }

        var eligibility = evaluatePolicyEligibility({
            sessionRole: options.sessionRole,
            subjectIds: options.subjectIds,
            subjectMap: subjectMap,
            user: options.user
        });
        if (!eligibility.ok) return fail(eligibility.code, eligibility.message);

        if (checkInMinutes === null) {
            return fail('no-checkin', 'Ca này chưa có giờ chấm công vào nên không kiểm tra được điều kiện sớm 10 phút.');
        }

        if (earlyMinutes === null) {
            return fail('no-schedule', 'Ca này không có giờ vào ca theo lịch nên không kiểm tra được điều kiện sớm 10 phút.');
        }

        if (earlyMinutesExact < EARLY10_REQUIRED_MINUTES) {
            return fail('checkin', 'Giờ vào ca của bạn là ' + checkInLabel +
                ', không hợp lệ để nhận sớm 10 phút. Ca bắt đầu lúc ' + startLabel +
                ' nên bạn phải chấm công trước ' + formatMinutesOfDay(parseClockToMinutes(options.classStart) - EARLY10_REQUIRED_MINUTES) + '.');
        }

        return {
            ok: true,
            code: 'ok',
            message: 'Đã xác nhận vào sớm ' + earlyMinutes + ' phút (' + checkInLabel + ' so với giờ vào ca ' + startLabel + ').',
            earlyMinutes: earlyMinutes,
            checkInLabel: checkInLabel,
            startLabel: startLabel,
            teachingMode: eligibility.teachingMode
        };
    }

    // --- Hình phạt theo tháng -------------------------------------------

    // Admin hủy/từ chối MỘT ca sẽ khóa phụ cấp của CẢ THÁNG: mất toàn bộ 10p và
    // mất luôn đơn giá lớp đông (+N HS). Quy định của trung tâm, không phải lỗi.
    function isMonthlyBonusPenaltyActive(monthlySettings, chips) {
        if (monthlySettings && monthlySettings.studentCountBonusPenalty) return true;
        return (chips || []).some(function (chip) {
            if (!chip) return false;
            return chip.studentCountStatus === 'rejected' || chip.bonus10Status === 'rejected';
        });
    }

    var Early10 = {
        BONUS_MINUTES: EARLY10_BONUS_MINUTES,
        REQUIRED_MINUTES: EARLY10_REQUIRED_MINUTES,
        buildSubjectEarly10Map: buildSubjectEarly10Map,
        splitSubjectIds: splitSubjectIds,
        getChipSubjectIds: getChipSubjectIds,
        isSubjectIdsEarly10Allowed: isSubjectIdsEarly10Allowed,
        isChipEarly10Allowed: isChipEarly10Allowed,
        isSubjectEarly10Allowed: isSubjectEarly10Allowed,
        getAllowingSubjectNames: getAllowingSubjectNames,
        getTeachingMode: getTeachingMode,
        isOldModeTeacher: isOldModeTeacher,
        parseClockToMinutes: parseClockToMinutes,
        formatMinutesOfDay: formatMinutesOfDay,
        getEarlyMinutes: getEarlyMinutes,
        evaluateEarly10Request: evaluateEarly10Request,
        evaluatePolicyEligibility: evaluatePolicyEligibility,
        isMonthlyBonusPenaltyActive: isMonthlyBonusPenaltyActive
    };

    global.Early10 = Early10;
    if (typeof module !== 'undefined' && module.exports) module.exports = Early10;
})(typeof window !== 'undefined' ? window : globalThis);
