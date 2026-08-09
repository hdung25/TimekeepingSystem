// evaluation-service.js — Pure Data & Calculation Logic — v2026.07.26-shift-coverage
// Tách từ report.js — Chứa logic tính toán lương, đánh giá, và xử lý dữ liệu thuần túy.
// Không chứa bất kỳ DOM manipulation nào.
//
// Exports (via window):
//   - window.EVALUATION_CRITERIA — Mảng 10 tiêu chí đánh giá
//   - window.calculateDailyChips() — Merge schedule + attendance → chips[]
//   - window.removeVietnameseTones() — Utility xử lý chuỗi tiếng Việt

// ================= STRING NORMALIZATION UTILITY =================

function normalizeChipFilterName(rawName) {
    if (!rawName) return 'Dạy học';
    let name = String(rawName).trim();
    
    // Replace multiple spaces with a single space
    name = name.replace(/\s+/g, ' ');
    
    // Standardize parentheses spacing (e.g. "( Tin Học )" -> "(Tin Học)")
    name = name.replace(/\(\s*/g, '(');
    name = name.replace(/\s*\)/g, ')');
    
    // Convert to Title Case for casing differences (e.g. "(tin học)" -> "(Tin Học)")
    name = name.toLowerCase().replace(/(^|\s)\S/g, L => L.toUpperCase());
    
    return name.trim();
}
window.normalizeChipFilterName = normalizeChipFilterName;

function getClassRate(cls, currentUserContext) {
    if (!cls || !cls.lop) return 0;
    const normalizedName = normalizeChipFilterName(cls.lop);
    const cfg = currentUserContext?.salary_config || {};
    
    if (cfg.class_rates && cfg.class_rates[normalizedName] !== undefined) {
        const r = Number(cfg.class_rates[normalizedName]);
        if (r > 0) return r;
    }
    
    if (cfg.roles && Array.isArray(cfg.roles)) {
        let matchedRole = cfg.roles.find(r => normalizeChipFilterName(r.id) === normalizedName || normalizeChipFilterName(r.name) === normalizedName);
        if (matchedRole && Number(matchedRole.rate) > 0) {
            return Number(matchedRole.rate);
        }
        
        const normalizedNameLower = normalizedName.toLowerCase();
        matchedRole = cfg.roles.find(r => {
            const roleIdLower = String(r.id).toLowerCase();
            const roleNameLower = String(r.name).toLowerCase();
            return normalizedNameLower.includes(roleIdLower) || normalizedNameLower.includes(roleNameLower) ||
                   roleIdLower.includes(normalizedNameLower) || roleNameLower.includes(normalizedNameLower);
        });
        if (matchedRole && Number(matchedRole.rate) > 0) {
            return Number(matchedRole.rate);
        }
    }
    
    return Number(cfg.attendance_rate || 0);
}
window.getClassRate = getClassRate;

function isCenterClosed(dateStr, shiftKey, centerClosures) {
    if (!centerClosures || !centerClosures[dateStr]) return false;
    const closures = centerClosures[dateStr];
    if (closures.includes('all')) return true;
    if (closures.includes(shiftKey)) return true;
    
    if (shiftKey === 'morning' && (closures.includes('morning1') || closures.includes('morning2'))) return true;
    if (shiftKey === 'afternoon' && (closures.includes('afternoon1') || closures.includes('afternoon2'))) return true;
    if (shiftKey === 'evening' && (closures.includes('evening1') || closures.includes('evening2'))) return true;
    
    if ((shiftKey === 'morning1' || shiftKey === 'morning2') && closures.includes('morning')) return true;
    if ((shiftKey === 'afternoon1' || shiftKey === 'afternoon2') && closures.includes('afternoon')) return true;
    if ((shiftKey === 'evening1' || shiftKey === 'evening2') && closures.includes('evening')) return true;

    return false;
}
window.isCenterClosed = isCenterClosed;

// ================= EVALUATION CRITERIA (10 Tiêu Chí) =================

const EVALUATION_CRITERIA = [
    { label: 'I', tooltip: 'CHUYÊN CẦN – TÁC PHONG', default: 0, template: 'Vắng phép: ...; Vắng đột xuất: ...; Vắng không phép: ...' },
    { label: 'II', tooltip: 'ĐÚNG GIỜ', default: 0, template: 'Trễ: ... giờ; Số lần trễ: ... lần' },
    { label: 'III', tooltip: 'TẬP TRUNG LÀM VIỆC', default: 0 },
    { label: 'IV', tooltip: 'NHIỆT TÌNH', default: 0 },
    { label: 'V', tooltip: 'TRÁCH NHIỆM', default: 0 },
    { label: 'VI', tooltip: 'SOẠN BÀI / NHẬN XÉT', default: 0 },
    { label: 'VII', tooltip: 'CHUYÊN MÔN', default: 0 },
    { label: 'VIII', tooltip: 'KỸ NĂNG SƯ PHẠM', default: 0 },
    { label: 'IX', tooltip: 'SỐ GIỜ LÀM', default: 0 },
    { label: 'X', tooltip: 'HỌP ĐỊNH KÌ', default: 0, template: 'Tiếng Anh: ...; T-TV: ...; TTD: ...; (0: vắng; có: đi họp; x: không dạy)' }
];

// ================= DAILY CHIPS CALCULATION =================
// Logic to Merge Schedule & Attendance → Returns chip array for a single day

// Helper: parse checkIn/checkOut bất kể lưu dạng ISO string hay Firestore Timestamp object
// (data cũ có thể lưu dạng {seconds, nanoseconds} hoặc đối tượng có .toDate())
function safeDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate();
    if (typeof val === 'object' && typeof val.seconds === 'number') {
        return new Date(val.seconds * 1000 + (val.nanoseconds || 0) / 1000000);
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}

function timeStrToMin(t) {
    if (!t || typeof t !== 'string' || !t.includes(':')) return 0;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
    return h * 60 + m;
}

function mergeAdjacentShifts(shifts) {
    if (!shifts || shifts.length === 0) return shifts;

    const sorted = [...shifts].sort((a, b) => a.start.localeCompare(b.start));
    const merged = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
        const prev = merged[merged.length - 1];
        const curr = sorted[i];

        // Merge nếu: cùng branch VÀ cùng loại CĐ/thường VÀ end của prev === start của curr (tuyệt đối).
        // Ca CĐ kề ca thường → giữ riêng để hiển thị/stats/lương không lẫn lộn.
        const sameFixedType = (prev.isFixedShift || false) === (curr.isFixedShift || false);
        if (sameFixedType && prev.branch === curr.branch && prev.end === curr.start) {
            // Nếu shift đã có mergedSegments từ pre-merge (report.js), giữ nguyên
            const prevSegs = prev.mergedSegments || [{
                start: prev.start,
                end: prev.end,
                schedMinutes: timeStrToMin(prev.end) - timeStrToMin(prev.start),
                isFixedShift: prev.isFixedShift
            }];
            merged[merged.length - 1] = {
                ...prev,
                end: curr.end,
                isFixedShift: prev.isFixedShift,
                _mergedWith: curr,
                mergedSegments: [
                    ...prevSegs,
                    {
                        start: curr.start,
                        end: curr.end,
                        schedMinutes: timeStrToMin(curr.end) - timeStrToMin(curr.start),
                        isFixedShift: curr.isFixedShift
                    }
                ]
            };
        } else {
            merged.push({ ...curr });
        }
    }

    return merged;
}

// Trễ quá ngưỡng này so với giờ bắt đầu một ca con (trong ca gộp) → ca con đó tính VẮNG.
const LATE_ABSENT_THRESHOLD_MS = 50 * 60 * 1000;

// Quy tắc GĐ: cùng một khung giờ chỉ có thể dạy ở MỘT lớp. Nếu GV có session chấm công
// thực (đi làm) phủ trùng khung giờ lớp này ≥10 phút — tức đang dạy/hỗ trợ lớp khác —
// thì lớp này KHÔNG được tính vắng (VD: chị Nhàn bị mượn sang dạy Dự thính, lớp TV4
// cố định có GV thay thế → không đánh VĐX/Vắng cho chị ở lớp TV4 nữa).
function hasOverlappingWorkSession(attendanceSessions, dateStr, startStr, endStr) {
    if (!startStr || !endStr) return false;
    const [y, m, d] = dateStr.split('-').map(Number);
    const [sH, sM] = String(startStr).split(':').map(Number);
    const [eH, eM] = String(endStr).split(':').map(Number);
    const clsStart = new Date(y, m - 1, d, sH, sM, 0, 0);
    const clsEnd = new Date(y, m - 1, d, eH, eM, 0, 0);

    return (attendanceSessions || []).some(s => {
        if (!s || s.isAbsent) return false;
        const ci = safeDate(s.checkIn || s.start);
        if (!ci) return false;
        let co = safeDate(s.checkOut);
        // Quên check-out (auto-close 23:59): không rõ làm tới đâu → không dùng để miễn vắng
        if (typeof s.checkOut === 'string' && s.checkOut.includes('T23:59')) co = ci;
        if (!co) {
            // Chưa ra ca: hôm nay thì coi như đang làm tới hiện tại; ngày cũ thì không rõ
            const todayStr = typeof getLocalDateKey === 'function'
                ? getLocalDateKey(new Date()) : new Date().toISOString().split('T')[0];
            co = dateStr === todayStr ? new Date() : ci;
        }
        const overlapMs = Math.min(co.getTime(), clsEnd.getTime()) - Math.max(ci.getTime(), clsStart.getTime());
        return overlapMs >= 10 * 60 * 1000; // ≥10 phút để loại session bấm nhầm
    });
}

// Gộp các ca con CHỒNG giờ (double-book cùng khoảng) thành 1 khoảng union; giữ RIÊNG các ca con
// chỉ KỀ nhau (VD 14:00-18:00 + 18:00-21:10). Dùng cho auto-tách ca để không tạo "vắng ảo".
// Trả về [{ _startDate, _endDate, _origStarts: [start-string...] }].
function collapseOverlappingSegments(segments, y, m, d) {
    const toDate = (t) => {
        const parts = String(t).split(':');
        return new Date(y, m - 1, d, parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
    };
    const sorted = [...segments].sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const out = [];
    sorted.forEach(seg => {
        const s = toDate(seg.start);
        const e = toDate(seg.end);
        const prev = out[out.length - 1];
        if (prev && s < prev._endDate) { // CHỒNG thực sự (không phải chỉ kề nhau)
            if (e > prev._endDate) prev._endDate = e;
            prev._origStarts.push(seg.start);
        } else {
            out.push({ _startDate: s, _endDate: e, _origStarts: [seg.start] });
        }
    });
    return out;
}

// NGÀY LÀM 2 CHỨC NĂNG (vừa tiếp tân vừa dạy) — chia khung ca tiếp tân thành các KHÚC.
// VD: ca tiếp tân 07:00–11:00, trong đó có lớp dạy 07:30–09:00 →
//     [07:00–07:30 tiếp tân] [07:30–09:00 dạy] [09:00–11:00 tiếp tân].
// Nhân viên vẫn CHỈ bấm vào ca 1 lần; hệ thống tự cắt khúc để mỗi phần được tính đúng đơn giá
// (không gộp thành 1 chip cứng, admin sửa từng khúc được). Trả về mảng đã sắp theo giờ.
function buildCrossRoleDaySegments(windowStart, windowEnd, teachingShifts, y, m, d, unpaidScheduledShifts = []) {
    const segments = [];
    if (!windowStart || !windowEnd || windowEnd <= windowStart) return segments;

    const hm = (dt) => `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    const toDate = (t) => {
        const parts = String(t).split(':');
        return new Date(y, m - 1, d, parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
    };
    const clippedInterval = (shift, kind) => {
        const rawStart = toDate(shift.start);
        const rawEnd = toDate(shift.end);
        if (!rawStart || !rawEnd || rawEnd <= rawStart) return null;
        const start = new Date(Math.max(windowStart.getTime(), rawStart.getTime()));
        const end = new Date(Math.min(windowEnd.getTime(), rawEnd.getTime()));
        if (end <= start) return null;
        return { start, end, kind, lop: shift.lop || '' };
    };

    // A day can contain three distinct states: receptionist work, real
    // teaching attendance, and a scheduled teaching slot with no attendance.
    // The latter must remain visible to admin but must never become paid time.
    const intervals = [
        ...(teachingShifts || []).map(shift => clippedInterval(shift, 'day')).filter(Boolean),
        ...(unpaidScheduledShifts || []).map(shift => clippedInterval(shift, 'missing')).filter(Boolean)
    ];
    const boundaries = new Set([windowStart.getTime(), windowEnd.getTime()]);
    intervals.forEach(item => {
        boundaries.add(item.start.getTime());
        boundaries.add(item.end.getTime());
    });
    const points = Array.from(boundaries).sort((a, b) => a - b);

    const appendSegment = (kind, start, end, label, scheduledMinutes) => {
        if (!(end > start)) return;
        const previous = segments[segments.length - 1];
        if (previous && previous.kind === kind && previous.end === hm(start)) {
            previous.end = hm(end);
            const labels = Array.from(new Set(
                `${previous.label || ''} + ${label || ''}`.split('+').map(item => item.trim()).filter(Boolean)
            ));
            previous.label = labels.join(' + ');
            if (kind === 'missing') previous.scheduledMinutes += scheduledMinutes;
            else previous.minutes += Math.round((end - start) / 60000);
            return;
        }
        segments.push({
            start: hm(start),
            end: hm(end),
            // Missing scheduled time is deliberately zero in payable minutes.
            minutes: kind === 'missing' ? 0 : Math.round((end - start) / 60000),
            ...(kind === 'missing' ? { scheduledMinutes } : {}),
            kind,
            label
        });
    };

    for (let index = 0; index < points.length - 1; index += 1) {
        const start = new Date(points[index]);
        const end = new Date(points[index + 1]);
        const actualTeaching = intervals.filter(item =>
            item.kind === 'day' && item.start <= start && item.end >= end
        );
        const missingTeaching = intervals.filter(item =>
            item.kind === 'missing' && item.start <= start && item.end >= end
        );
        const labels = list => Array.from(new Set(list.map(item => item.lop).filter(Boolean))).join(' + ');

        // Real attendance always wins if erroneous data overlaps a missing
        // marker. This prevents a display warning from suppressing work.
        if (actualTeaching.length > 0) {
            appendSegment('day', start, end, labels(actualTeaching) || 'Ca dạy');
        } else if (missingTeaching.length > 0) {
            appendSegment('missing', start, end, labels(missingTeaching) || 'Ca dạy', Math.round((end - start) / 60000));
        } else {
            appendSegment('tiep-tan', start, end, 'Tiếp Tân');
        }
    }
    return segments;
}
window.buildCrossRoleDaySegments = buildCrossRoleDaySegments;

// Ghép trạng thái "đã chấm công" cho danh sách ca theo nguyên tắc một phiên chỉ
// thuộc một chuỗi ca LIỀN KỀ. Phiên 15:30–21:00 đã ghép với ca 15:30–17:00
// không được nhảy qua khoảng nghỉ 17:00–18:00 để che hai ca tối.
//
// NGOẠI LỆ (bắt buộc): hai lớp CHỒNG KHUNG GIỜ của cùng một người — ví dụ 1 GV ôm
// Toán 6 và Toán 7 cùng 07:30–09:00 — chỉ có MỘT lần vào ca, nên một phiên phải che
// được cả hai. Trước đây lớp thứ hai bị coi là "chưa chấm công" → nhân viên đi tạo
// chấm công bù cho nó → duyệt vào là lương đôi (Bảng Công lại gộp hai lớp này thành
// một ô "Toán 6+Toán 7" và chỉ trả một lần).
// Trả về mảng boolean theo đúng thứ tự đầu vào.
function matchScheduledShiftCoverage(shifts, attendanceSessions, dateStr) {
    const result = (Array.isArray(shifts) ? shifts : []).map(() => false);
    if (!dateStr || result.length === 0) return result;

    const [year, month, day] = String(dateStr).split('-').map(Number);
    if (![year, month, day].every(Number.isFinite)) return result;

    const todayKey = typeof getLocalDateKey === 'function'
        ? getLocalDateKey(new Date())
        : new Date().toISOString().split('T')[0];
    const isPastDay = dateStr < todayKey;

    const toLocalDate = (timeStr) => {
        if (!timeStr || !String(timeStr).includes(':')) return null;
        const [hour, minute] = String(timeStr).split(':').map(Number);
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
        return new Date(year, month - 1, day, hour, minute, 0, 0);
    };

    const sessionStates = (Array.isArray(attendanceSessions) ? attendanceSessions : [])
        .map((session, index) => {
            if (!session || session.isAbsent) return null;
            const checkIn = safeDate(session.checkIn || session.start);
            if (!checkIn) return null;
            let checkOut = safeDate(session.checkOut);
            if (!checkOut && !isPastDay) checkOut = new Date();
            return {
                session,
                index,
                checkIn,
                checkOut,
                used: false,
                lastShiftEnd: null,
                // Khoảng thời gian đã được phiên này "nhận" (ms) — dùng để nhận ra lớp
                // chồng giờ với ca đã ghép, tức là dạy song song chứ không phải ca mới.
                coveredStart: null,
                coveredEnd: null
            };
        })
        .filter(Boolean);

    const orderedShifts = (Array.isArray(shifts) ? shifts : [])
        .map((shift, index) => ({ ...shift, _inputIndex: index }))
        .filter(shift => shift.start && shift.end)
        .sort((a, b) => String(a.start).localeCompare(String(b.start)));

    const overlapsEnough = (state, shiftStart, shiftEnd) => {
        const effectiveOut = state.checkOut || shiftEnd; // ngày cũ quên checkout: tự khép theo ca
        const overlapMs = Math.min(effectiveOut.getTime(), shiftEnd.getTime()) -
            Math.max(state.checkIn.getTime(), shiftStart.getTime());
        return overlapMs >= 10 * 60 * 1000;
    };

    orderedShifts.forEach(shift => {
        const shiftStart = toLocalDate(shift.start);
        const shiftEnd = toLocalDate(shift.end);
        if (!shiftStart || !shiftEnd || shiftEnd <= shiftStart) return;

        // Lớp dạy SONG SONG: chồng khung giờ với phần phiên này đã nhận → cùng một lần
        // vào ca, không phải ca mới. Xét trước để không bị lấy nhầm phiên khác.
        let state = sessionStates.find(item =>
            item.used &&
            item.coveredStart !== null &&
            Math.min(item.coveredEnd, shiftEnd.getTime()) -
            Math.max(item.coveredStart, shiftStart.getTime()) >= 10 * 60 * 1000 &&
            overlapsEnough(item, shiftStart, shiftEnd)
        );

        // Một phiên đã nhận ca trước chỉ được đi tiếp nếu ca kế tiếp liền đúng mốc giờ.
        if (!state) state = sessionStates.find(item =>
            item.used &&
            item.lastShiftEnd === shift.start &&
            (!item.checkOut || item.checkOut > shiftStart) &&
            overlapsEnough(item, shiftStart, shiftEnd)
        );

        if (!state) {
            const exactLinked = sessionStates.find(item =>
                !item.used &&
                item.session.linkedClassStart &&
                item.session.linkedClassStart === shift.start
            );

            state = exactLinked || sessionStates.find(item => {
                if (item.used || item.session.linkedClassStart) return false;
                const startDistance = Math.abs(item.checkIn.getTime() - shiftStart.getTime());
                return startDistance < 60 * 60 * 1000 && overlapsEnough(item, shiftStart, shiftEnd);
            });
        }

        if (!state) return;
        result[shift._inputIndex] = true;
        state.used = true;
        // Lớp song song kết thúc sớm hơn không được kéo lùi mốc nối ca.
        if (!state.lastShiftEnd || String(shift.end) > state.lastShiftEnd) state.lastShiftEnd = shift.end;
        state.coveredStart = state.coveredStart === null
            ? shiftStart.getTime()
            : Math.min(state.coveredStart, shiftStart.getTime());
        state.coveredEnd = state.coveredEnd === null
            ? shiftEnd.getTime()
            : Math.max(state.coveredEnd, shiftEnd.getTime());
    });

    return result;
}
window.matchScheduledShiftCoverage = matchScheduledShiftCoverage;

function getClassObservationSummary(observations, staffId, cls, secKey, classIndex, dateStr) {
    const activeItems = (Array.isArray(observations) ? observations : []).filter(item => {
        if (!item || item.status === 'cancelled') return false;
        if (item.dateKey && item.dateKey !== dateStr) return false;
        if (item.teacherId && item.teacherId !== staffId) return false;
        if (item.classStart && item.classStart !== cls.start) return false;
        if (item.branch && cls._branch && item.branch !== cls._branch) return false;

        const hasExactScheduleIdentity = item.scheduleCompositeKey && item.classSectionKey;
        if (hasExactScheduleIdentity) {
            return item.scheduleCompositeKey === cls._compositeKey &&
                item.classSectionKey === secKey &&
                Number(item.classIndex) === Number(classIndex);
        }
        return true;
    });

    const manualLateMinutes = activeItems.reduce(
        (max, item) => Math.max(max, Math.max(0, Math.round(Number(item.lateMinutes) || 0))),
        0
    );
    const notes = activeItems
        .map(item => String(item.note || '').trim())
        .filter(Boolean);

    return {
        items: activeItems,
        manualLateMinutes,
        notes,
        ids: activeItems.map(item => item.id).filter(Boolean)
    };
}

// isScheduledMainTeacher / isScheduledSubstitute / hasScheduledSubstitute: định nghĩa ở
// db-service.js (nạp trước mọi trang) — dùng chung để lớp nhiều GV không bị sót GV thứ 2.

function calculateDailyChips(schedule, attendanceSessions, staffId, dateStr, currentUserContext, receptionistShifts = [], overtimeMap = {}, cancelledShifts = [], bonus10Map = {}, shiftObservations = [], monthFlags = {}) {
    // Admin hủy 1 ca sớm 10p → khóa 10p của CẢ THÁNG (và cả phụ cấp lớp đông,
    // xử lý bên report.js). Cờ này do nơi gọi tính sẵn cho cả tháng rồi truyền xuống.
    const early10PenaltyActive = !!(monthFlags && monthFlags.early10PenaltyActive);
    const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
    const chips = [];
    const usedSessionIdsTeaching = new Set();

    // MỘT LẦN VÀO CA CÓ THỂ PHỦ NHIỀU CA DẠY RỜI NHAU.
    // Nhân viên chỉ bấm vào ca một lần rồi ở lại trung tâm: phiên 14:52–21:02 phủ cả lớp
    // 15:00–16:30 lẫn chuỗi 18:00–21:00. Trước đây phiên đã dùng cho một ca là bị khoá
    // hẳn, nên ca sau không tìm được phiên nào → bị in chip "Vắng" và mất công, dù người
    // ta có mặt suốt. Nay ghi lại ĐÚNG những khung giờ mà phiên đã được tính, và chỉ chặn
    // khi ca mới CHỒNG lên khung đã tính (chống tính lương hai lần cho cùng một giờ).
    const _sessionClaimedRanges = {}; // sessionId -> [{ from: ms, to: ms }]

    const _claimSessionRange = (sessionId, from, to) => {
        if (sessionId == null || !from || !to) return;
        const a = from.getTime ? from.getTime() : from;
        const b = to.getTime ? to.getTime() : to;
        if (!(b > a)) return;
        const key = String(sessionId);
        (_sessionClaimedRanges[key] = _sessionClaimedRanges[key] || []).push({ from: a, to: b });
    };

    // Phiên này còn rảnh cho khung giờ [from,to) không? (chưa từng được tính cho khung đó)
    const _sessionFreeFor = (sessionId, from, to) => {
        const list = _sessionClaimedRanges[String(sessionId)];
        if (!list || list.length === 0) return true;
        if (!from || !to) return false;
        const a = from.getTime ? from.getTime() : from;
        const b = to.getTime ? to.getTime() : to;
        return !list.some(r => Math.min(b, r.to) - Math.max(a, r.from) >= 10 * 60 * 1000);
    };

    // Phiên đã dùng cho ca dạy khác nhưng KHÔNG chồng khung giờ ca đang xét → vẫn dùng được.
    const _sessionBlockedForClass = (sessionId, from, to) =>
        usedSessionIdsTeaching.has(sessionId) && !_sessionFreeFor(sessionId, from, to);
    const usedSessionIdsReceptionist = new Set();
    const teachingMinutesMap = {}; // sessionId -> total teaching minutes
    const teachingSessionsMap = {}; // sessionId -> array of teaching shifts {start, end, paidMinutes}
    // Nhóm daySegments theo id phiên để phiên dạy riêng vẫn nhìn thấy cùng một
    // chuỗi ngày làm khi phiên tiếp tân và phiên dạy được tạo thành 2 bản ghi.
    // Đây chỉ là chỉ mục trong bộ nhớ, không ghi ngược vào Firestore.
    const crossRoleDaySegmentsBySession = {};

    // === MỘT KHUNG GIỜ CHỈ TÍNH CÔNG MỘT LẦN ===
    // GV dạy 2 lớp cùng khung giờ (hoặc có 2 phiên chấm bù trùng giờ) thì bảng công sinh
    // 2 chip, mỗi chip tính đủ 1h30 → tổng ngày phồng gấp đôi. Lớp xếp chồng giờ đã được
    // gộp ở bước dedup phía trên, nhưng phiên chấm công KHÔNG khớp lịch thì mỗi phiên tự
    // tính riêng. Danh sách dưới ghi lại các khoảng giờ đã trả công để trừ phần trùng.
    const _paidClockRanges = []; // [{ from: ms, to: ms, sessionId: string|null }]

    const _msOf = (value) => (value && value.getTime ? value.getTime() : value);

    const _addPaidClockRange = (from, to, sessionId) => {
        const a = _msOf(from), b = _msOf(to);
        if (!a || !b || !(b > a)) return;
        _paidClockRanges.push({ from: a, to: b, sessionId: sessionId != null ? String(sessionId) : null });
    };

    // Số phút của [from,to] đã nằm trong khoảng đã trả công của phiên KHÁC. Bỏ qua khoảng
    // của chính phiên này vì phần đó đã được trừ riêng qua teachingMinutesMap.
    const _alreadyPaidMinutes = (from, to, sessionId) => {
        const a = _msOf(from), b = _msOf(to);
        if (!a || !b || !(b > a)) return 0;
        const key = sessionId != null ? String(sessionId) : null;
        const parts = _paidClockRanges
            .filter(r => key === null || r.sessionId !== key)
            .map(r => ({ from: Math.max(a, r.from), to: Math.min(b, r.to) }))
            .filter(r => r.to > r.from)
            .sort((x, y) => x.from - y.from);
        let total = 0, cursor = a;
        parts.forEach(p => {
            const start = Math.max(p.from, cursor);
            if (p.to > start) { total += p.to - start; cursor = p.to; }
        });
        return Math.round(total / 60000);
    };

    // Collect VĐX (Vắng đã xác nhận) slots for this staff on this day to hide overlapping receptionist absent chips
    const vdxSlots = [];
    sections.forEach(sk => {
        (schedule[sk] || []).forEach((c, idx) => {
            if (!c.start || !c.end) return;
            const isOriginalVDX = hasScheduledSubstitute(c) && isScheduledMainTeacher(c, staffId);
            const ck = c._compositeKey || null;
            const originalIdx = c._originalIndex !== undefined ? c._originalIndex : idx;
            if (isOriginalVDX) {
                if (ck && cancelledShifts.includes(`${ck}_${sk}_${originalIdx}`)) return;
                vdxSlots.push({ start: c.start, end: c.end });
            }
        });
    });

    // Extract staff roles to determine receptionist vs teaching status
    const staffRoles = currentUserContext
        ? (Array.isArray(currentUserContext.roles) && currentUserContext.roles.length > 0
            ? currentUserContext.roles
            : [currentUserContext.role || ''])
        : [];
    const hasReceptionistRole = staffRoles.some(r => ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(r));
    const hasTeachingRole = staffRoles.some(r => ['giao-vien', 'teacher', 'teaching_assistant', 'senior_assistant', 'assistant'].includes(r));

    // DEDUPLICATE OVERLAPPING CLASSES (Keep highest paying one)
    let processedSchedule = { ...schedule };
    if (hasTeachingRole) {
        const rawRegisteredClasses = [];
        sections.forEach(sk => {
            (schedule[sk] || []).forEach((c, i) => {
                if (!c.start || !c.end) return;
                const _isSubstitute = isScheduledSubstitute(c, staffId);
                const _isOriginalVDX = hasScheduledSubstitute(c) && isScheduledMainTeacher(c, staffId);
                const _isReg = _isSubstitute ||
                    (!_isOriginalVDX && (
                        (c.registeredTeachers || []).some(t => t.id === staffId) || isScheduledMainTeacher(c, staffId)
                    ));
                if (_isReg) {
                    rawRegisteredClasses.push({
                        ...c,
                        _sectionKey: sk,
                        _origIndex: i,
                        _isSubstitute,
                        _isOriginalVDX
                    });
                }
            });
        });

        const teachingClasses = rawRegisteredClasses.filter(c => !c._isOriginalVDX);
        const vdxClasses = rawRegisteredClasses.filter(c => c._isOriginalVDX);

        teachingClasses.forEach(c => {
            c._rate = getClassRate(c, currentUserContext);
        });
        teachingClasses.sort((a, b) => b._rate - a._rate);

        const selectedClasses = [];
        teachingClasses.forEach(c => {
            const overlappingSel = selectedClasses.find(sel => {
                const [sH1, sM1] = c.start.split(':').map(Number);
                const [eH1, eM1] = c.end.split(':').map(Number);
                const start1 = sH1 * 60 + sM1;
                const end1 = eH1 * 60 + eM1;

                const [sH2, sM2] = sel.start.split(':').map(Number);
                const [eH2, eM2] = sel.end.split(':').map(Number);
                const start2 = sH2 * 60 + sM2;
                const end2 = eH2 * 60 + eM2;

                return start1 < end2 && start2 < end1;
            });
            if (!overlappingSel) {
                selectedClasses.push({
                    ...c,
                    _originalLop: c.lop,
                    _allLops: [c.lop]
                });
            } else {
                if (c.lop && !overlappingSel._allLops.includes(c.lop)) {
                    overlappingSel._allLops.push(c.lop);
                    const sortedLops = [...overlappingSel._allLops].sort();
                    overlappingSel.lop = sortedLops.join('+');
                }
            }
        });

        const localSchedule = {};
        sections.forEach(sk => {
            localSchedule[sk] = [];
            (schedule[sk] || []).forEach((c, i) => {
                const _isSubstitute = isScheduledSubstitute(c, staffId);
                const _isOriginalVDX = hasScheduledSubstitute(c) && isScheduledMainTeacher(c, staffId);
                const _isReg = _isSubstitute ||
                    (!_isOriginalVDX && (
                        (c.registeredTeachers || []).some(t => t.id === staffId) || isScheduledMainTeacher(c, staffId)
                    ));

                if (!_isReg) {
                    localSchedule[sk].push(c);
                } else {
                    const matchedSelected = selectedClasses.find(sc => sc._sectionKey === sk && sc._origIndex === i);
                    const matchedVDX = vdxClasses.find(vc => vc._sectionKey === sk && vc._origIndex === i);
                    if (matchedSelected) {
                        localSchedule[sk].push(matchedSelected);
                    } else if (matchedVDX) {
                        localSchedule[sk].push(c);
                    }
                }
            });
        });
        processedSchedule = localSchedule;
    }
    schedule = processedSchedule;

    // Tập giờ bắt đầu của các ca mà GV này ĐANG được xếp trong ngày.
    // `linkedClassStart` là cái neo giữa phiên chấm công và ô lịch (admin sửa ca, duyệt
    // chấm bù). Nếu sau đó lịch đổi giờ / xóa ca / đổi GV thì cái neo trỏ vào hư không:
    // phiên bị mọi vòng ghép từ chối ("đã neo vào ca khác") nên rơi xuống chip tím
    // "(Role?)", còn ca trong lịch lại bị ẩn vì đã có phiên chồng giờ → cả ca dạy biến
    // mất khỏi bảng công. Neo mồ côi phải bị bỏ qua để phiên được ghép theo giờ như thường.
    const _assignedClassStarts = new Set();
    sections.forEach(sk => {
        (schedule[sk] || []).forEach((c, i) => {
            if (!c || !c.start || !c.end) return;
            if (c.isClosed === true) return;
            const _isSubstitute = isScheduledSubstitute(c, staffId);
            const _isOriginalVDX = hasScheduledSubstitute(c) && isScheduledMainTeacher(c, staffId);
            const _isReg = _isSubstitute ||
                (!_isOriginalVDX && (
                    (c.registeredTeachers || []).some(t => t.id === staffId) || isScheduledMainTeacher(c, staffId)
                ));
            if (!_isReg) return;
            const ck = c._compositeKey || null;
            const originalIdx = c._originalIndex !== undefined ? c._originalIndex : i;
            if (ck && cancelledShifts.includes(`${ck}_${sk}_${originalIdx}`)) return;
            _assignedClassStarts.add(c.start);
        });
    });
    // Phiên có neo còn hiệu lực (giờ neo vẫn ứng với một ca thật của GV trong ngày)
    const _hasLiveClassLink = (s) => !!(s && s.linkedClassStart && _assignedClassStarts.has(s.linkedClassStart));

    // PRE-PROCESS: xây dựng mergeInfo cho các ca liên tiếp (end ca A = start ca B)
    // Không check cùng branch → hỗ trợ merge ca khác cơ sở
    // mergeInfo["secKey_idx"] = { mergedEnd: string, crossBranch: bool } → ca đầu chuỗi
    // mergeInfo["secKey_idx"] = { skip: true }                           → ca tiếp theo, bỏ qua
    const _mergeInfo = {};
    {
        const _allReg = [];
        // Dedup: tránh cùng ca (start+end+branch) bị đếm 2 lần khi admin set cả gvId lẫn registeredTeachers
        const _seenSlots = new Set();
        sections.forEach(sk => {
            (schedule[sk] || []).forEach((c, i) => {
                if (!c.start || !c.end) return; // skip malformed rows missing start/end
                if (c.isClosed === true) return; // skip explicitly closed classes
                // Là GV thay thế → tính như GV chính; GV gốc bị VĐX → không merge (skip ngay)
                const _isSubstitute = isScheduledSubstitute(c, staffId);
                const _isOriginalVDX = hasScheduledSubstitute(c) && isScheduledMainTeacher(c, staffId);
                const _isReg = _isSubstitute ||
                    (!_isOriginalVDX && (
                        (c.registeredTeachers || []).some(t => t.id === staffId) || isScheduledMainTeacher(c, staffId)
                    ));
                if (!_isReg) return;
                const ck = c._compositeKey || null;
                const originalIdx = c._originalIndex !== undefined ? c._originalIndex : i;
                if (ck && cancelledShifts.includes(`${ck}_${sk}_${originalIdx}`)) return;
                // Bỏ qua nếu đã có entry cùng (branch + start + end) → tránh chip V giả do duplicate class entry
                const _slotKey = `${c._branch || ''}_${c.start}_${c.end}`;
                if (_seenSlots.has(_slotKey)) return;
                _seenSlots.add(_slotKey);

                // Compute scheduled duration
                const [_sH, _sM] = c.start.split(':').map(Number);
                const [_eH, _eM] = c.end.split(':').map(Number);
                const schedMinutes = (_eH * 60 + _eM) - (_sH * 60 + _sM);

                _allReg.push({ 
                    start: c.start, 
                    end: c.end, 
                    branch: c._branch || '', 
                    secKey: sk, 
                    idx: i,
                    compositeKey: ck,
                    originalIdx,
                    lop: c.lop || '',
                    lopId: c.lopId || '',
                    schedMinutes: Math.max(0, schedMinutes)
                });
            });
        });
        _allReg.sort((a, b) => a.start.localeCompare(b.start));
        for (let _mi = 0; _mi < _allReg.length; _mi++) {
            const _a = _allReg[_mi];
            const _ka = `${_a.secKey}_${_a.idx}`;
            if (_mergeInfo[_ka] && _mergeInfo[_ka].skip) continue;
            let _chainEnd = _a.end;
            let _chainSameBranch = true;
            const _chainBranches = [_a.branch]; // lưu thứ tự các branch trong chuỗi
            
            const _chainSegments = [{
                start: _a.start,
                end: _a.end,
                branch: _a.branch,
                secKey: _a.secKey,
                idx: _a.idx,
                compositeKey: _a.compositeKey,
                originalIdx: _a.originalIdx,
                lop: _a.lop,
                lopId: _a.lopId,
                schedMinutes: _a.schedMinutes
            }];

            let _mj = _mi + 1;
            while (_mj < _allReg.length) {
                const _b = _allReg[_mj];
                if (_b.start === _chainEnd) {
                    if (_b.branch !== _a.branch) _chainSameBranch = false;
                    _chainBranches.push(_b.branch);
                    
                    _chainSegments.push({
                        start: _b.start,
                        end: _b.end,
                        branch: _b.branch,
                        secKey: _b.secKey,
                        idx: _b.idx,
                        compositeKey: _b.compositeKey,
                        originalIdx: _b.originalIdx,
                        lop: _b.lop,
                        lopId: _b.lopId,
                        schedMinutes: _b.schedMinutes
                    });

                    _mergeInfo[`${_b.secKey}_${_b.idx}`] = { skip: true };
                    _chainEnd = _b.end;
                    _mj++;
                } else break;
            }
            if (_chainEnd !== _a.end) {
                _mergeInfo[_ka] = {
                    mergedEnd: _chainEnd,
                    crossBranch: !_chainSameBranch,
                    chainBranches: _chainBranches, // ví dụ: ['cs1', 'cs3']
                    chainSegments: _chainSegments
                };
            }
        }
    }

    // Dedup set cho loop chính: tránh cùng (branch+start+end) sinh 2 chip
    const _mainSeenSlots = new Set();
    // Track time slots đã có session khớp: tránh chip Vắng khi cùng giờ đã match ở branch khác
    const _matchedTimeSlots = new Set();

    sections.forEach(secKey => {
        const classes = schedule[secKey] || [];
        classes.forEach((cls, idx) => {
            // 1. Kiểm tra GV thay thế
            const isSubstitute = isScheduledSubstitute(cls, staffId);
            const isOriginalVDX = hasScheduledSubstitute(cls) && isScheduledMainTeacher(cls, staffId);

            const classCompositeKey = cls._compositeKey || null;
            const originalIdx = cls._originalIndex !== undefined ? cls._originalIndex : idx;

            // --- CHECK CANCELLED SHIFTS FIRST ---
            if (classCompositeKey && cancelledShifts.includes(`${classCompositeKey}_${secKey}_${originalIdx}`)) {
                return; // Skip this explicitly cancelled/deleted shift
            }

            // GV gốc bị thay → tạo chip VĐX riêng (không tính giờ/lương) rồi return
            if (isOriginalVDX) {
                // Cùng giờ đó GV có chấm công đi làm (bị mượn dạy lớp khác) → KHÔNG tính vắng
                if (hasOverlappingWorkSession(attendanceSessions, dateStr, cls.start, cls.end)) return;
                const lopLabel = cls.lop ? `${cls.lop}` : 'ca dạy';
                const branchLabel = cls._branch ? cls._branch.toUpperCase() : '';
                chips.push({
                    text: `VĐX: ${lopLabel} ${cls.start}–${cls.end}${branchLabel ? ' (' + branchLabel + ')' : ''}`,
                    class: 'chip-red',
                    paidMinutes: 0,
                    isWarning: false,
                    isVDX: true,
                    chipFilterName: normalizeChipFilterName(cls.lop),
                    tooltip: `Vắng đột xuất — GV thay thế: ${cls.gvThayThe || '?'}`,
                    sessionId: null,
                    schedData: { start: cls.start, end: cls.end },
                    isClickable: true,
                    classCompositeKey: classCompositeKey,
                    classSectionKey: secKey,
                    classIndex: originalIdx
                });
                return;
            }

            // 2. Check if user is assigned: substitute, admin-set GV chính (mọi GV trong gvList),
            //    or legacy registeredTeachers
            const isRegistered = isSubstitute ||
                isScheduledMainTeacher(cls, staffId) ||
                (cls.registeredTeachers || []).some(t => t.id === staffId);

            if (!isRegistered) return; // Skip if not assigned to this class
            if (!cls.start || !cls.end) return; // skip malformed rows missing start/end

            // Dedup: bỏ qua nếu đã có entry cùng (branch+start+end) → tránh chip V giả
            const _mainSlotKey = `${cls._branch || ''}_${cls.start}_${cls.end}`;
            if (_mainSeenSlots.has(_mainSlotKey)) return;
            _mainSeenSlots.add(_mainSlotKey);

            if (cls.isClosed === true) return; // Skip closed class

            // --- MERGE: bỏ qua ca không phải đầu chuỗi (đã được gộp vào ca trước) ---
            const _mk = `${secKey}_${idx}`;
            if (_mergeInfo[_mk] && _mergeInfo[_mk].skip) return;
            // Giờ kết thúc hiệu dụng: dùng mergedEnd nếu ca này là đầu chuỗi
            const _mergedEnd = (_mergeInfo[_mk] && _mergeInfo[_mk].mergedEnd) || null;
            const _chainSegments = (_mergeInfo[_mk] && _mergeInfo[_mk].chainSegments) || null;

            // 2. Check for Attendance Match
            // Priority 1: Exact match by linkedClassStart (set when admin edits a session)
            // Priority 2: A longer session overlaps/covers the class window
            // Priority 3: Proximity match within 60 min of class start
            // FIX: dùng local time thay vì ISO string (tránh UTC parse gây lệch 7h)
            const [_sy, _sm, _sd] = dateStr.split('-').map(Number);
            const _toClassDate = (timeStr) => {
                const [hour, minute] = String(timeStr).split(':').map(Number);
                return new Date(_sy, _sm - 1, _sd, hour, minute, 0, 0);
            };
            let _displayStartStr = cls.start;
            let _effectiveEndStr = _mergedEnd || cls.end;
            let schedStart = _toClassDate(_displayStartStr);
            let schedEnd = _toClassDate(_effectiveEndStr);
            let _splitAbsentSegments = [];
            let _workedChainSegments = _chainSegments;

            const _chainStarts = new Set(
                (_chainSegments && _chainSegments.length > 0
                    ? _chainSegments.map(seg => seg.start)
                    : [cls.start])
            );
            const _chainStartDates = [..._chainStarts].map(_toClassDate);

            let matchedSession = attendanceSessions.find(s => {
                if (_sessionBlockedForClass(s.id, schedStart, schedEnd)) return false;
                return s.linkedClassStart && _chainStarts.has(s.linkedClassStart);
            });

            if (!matchedSession) {
                matchedSession = attendanceSessions.find(s => {
                    if (_sessionBlockedForClass(s.id, schedStart, schedEnd)) return false;
                    if (_hasLiveClassLink(s)) return false; // Already linked to another class
                    const checkIn = safeDate(s.checkIn || s.start);
                    if (!checkIn) return false;
                    const checkOut = safeDate(s.checkOut);
                    if (!checkOut) return false;
                    return checkIn < schedEnd && checkOut > schedStart;
                });
            }

            if (!matchedSession) {
                matchedSession = attendanceSessions.find(s => {
                    if (_sessionBlockedForClass(s.id, schedStart, schedEnd)) return false;
                    if (_hasLiveClassLink(s)) return false; // Already linked to another class
                    const checkIn = safeDate(s.checkIn || s.start);
                    if (!checkIn) return false;
                    const minDiffMs = Math.min(..._chainStartDates.map(start => Math.abs(checkIn - start)));
                    return minDiffMs < 60 * 60 * 1000;
                });
            }

            let _matchedTeachingSessions = [];
            if (matchedSession) {
                _matchedTeachingSessions.push(matchedSession);

                // Gom các phiên còn lại thuộc cùng chuỗi ca. Trước đây các phiên này bị
                // đánh dấu "đã dùng" nhưng phút làm chỉ lấy từ phiên đầu, làm mất công ca 2.
                attendanceSessions.forEach(s => {
                    if (_sessionBlockedForClass(s.id, schedStart, schedEnd)) return;
                    if (_matchedTeachingSessions.some(item => item.id === s.id)) return;
                    if (s.isAbsent) return;
                    if (_hasLiveClassLink(s) && !_chainStarts.has(s.linkedClassStart)) return;
                    const checkIn = safeDate(s.checkIn || s.start);
                    if (!checkIn) return;
                    const checkOut = safeDate(s.checkOut);
                    const overlapsChain = checkOut && checkIn < schedEnd && checkOut > schedStart;
                    const isNearChainStart = Math.min(..._chainStartDates.map(start => Math.abs(checkIn - start))) <
                        60 * 60 * 1000;
                    if (overlapsChain || isNearChainStart) {
                        _matchedTeachingSessions.push(s);
                    }
                });

                _matchedTeachingSessions.forEach(s => usedSessionIdsTeaching.add(s.id));
                (_chainSegments || [{ start: cls.start, end: cls.end }]).forEach(seg => {
                    _matchedTimeSlots.add(`${seg.start}_${seg.end}`);
                });

                // Hai yêu cầu chấm bù cho hai ca kề nhau tạo hai session riêng. Dùng
                // khoảng bao từ phiên sớm nhất tới phiên muộn nhất để tính đủ chuỗi ca.
                const _workedSessions = _matchedTeachingSessions.filter(s => !s.isAbsent);
                if (_workedSessions.length > 0 && matchedSession.isAbsent) {
                    matchedSession = _workedSessions[0];
                }
                if (_workedSessions.length > 1 && _workedSessions.every(s => safeDate(s.checkOut))) {
                    const _starts = _workedSessions.map(s => safeDate(s.checkIn || s.start)).filter(Boolean);
                    const _ends = _workedSessions.map(s => safeDate(s.checkOut)).filter(Boolean);
                    if (_starts.length === _workedSessions.length && _ends.length === _workedSessions.length) {
                        const _combinedStart = new Date(Math.min(..._starts.map(d => d.getTime())));
                        const _combinedEnd = new Date(Math.max(..._ends.map(d => d.getTime())));
                        matchedSession = {
                            ...matchedSession,
                            start: _combinedStart.toISOString(),
                            checkIn: _combinedStart.toISOString(),
                            checkOut: _combinedEnd.toISOString(),
                            isAdminEdited: _workedSessions.every(s => !!s.isAdminEdited),
                            _combinedSessionIds: _workedSessions.map(s => s.id)
                        };
                    }
                }

                // Nếu chuỗi ca chỉ được chấm một phần, giữ phần đã làm và sinh chip Vắng
                // riêng cho ca con còn thiếu (VD 18:00–19:30 có công, 19:30–21:00 vắng).
                if (_chainSegments && _chainSegments.length > 1 && !matchedSession.isAbsent) {
                    const _todayKey = typeof getLocalDateKey === 'function'
                        ? getLocalDateKey(new Date())
                        : new Date().toISOString().split('T')[0];
                    const _isPastDay = dateStr < _todayKey;
                    const _segmentWorked = (seg) => {
                        const segStart = _toClassDate(seg.start);
                        const segEnd = _toClassDate(seg.end);
                        return _workedSessions.some(s => {
                            const checkIn = safeDate(s.checkIn || s.start);
                            if (!checkIn || checkIn >= segEnd) return false;
                            if (checkIn - segStart > LATE_ABSENT_THRESHOLD_MS) return false;
                            let checkOut = safeDate(s.checkOut);
                            if (!checkOut) checkOut = _isPastDay ? segEnd : new Date();
                            const overlapMs = Math.min(checkOut.getTime(), segEnd.getTime()) -
                                Math.max(checkIn.getTime(), segStart.getTime());
                            return overlapMs >= 10 * 60 * 1000;
                        });
                    };

                    const _workedSegments = _chainSegments.filter(_segmentWorked);
                    _splitAbsentSegments = _chainSegments.filter(seg => !_segmentWorked(seg));
                    if (_workedSegments.length > 0 && _splitAbsentSegments.length > 0) {
                        _workedSegments.sort((a, b) => a.start.localeCompare(b.start));
                        _workedChainSegments = _workedSegments;
                        _displayStartStr = _workedSegments[0].start;
                        _effectiveEndStr = _workedSegments[_workedSegments.length - 1].end;
                        schedStart = _toClassDate(_displayStartStr);
                        schedEnd = _toClassDate(_effectiveEndStr);
                    } else {
                        _splitAbsentSegments = [];
                    }
                }
            }

            // 3. Determine Status
            let minutes = 0;
            let cssClass = 'chip-blue';
            // Branch tag — abbreviated (no brackets)
            const branchTag = cls._branch ? ` [${cls._branch.toUpperCase()}]` : '';
            const branchShort = cls._branch ? ` ${cls._branch.toUpperCase()}` : '';
            const _isCrossBranch = (_mergeInfo[_mk] && _mergeInfo[_mk].crossBranch) || false;
            const _chainBranches = (_mergeInfo[_mk] && _mergeInfo[_mk].chainBranches) || null;
            // Cross-branch: hiện "CS1/CS3" theo thứ tự ca (ca trước/ca sau)
            // Same-branch merge hoặc không merge: hiện branch bình thường
            let _labelBranchSuffix;
            if (_isCrossBranch && _chainBranches) {
                const _uniqueBranches = _chainBranches
                    .map(b => b.toUpperCase())
                    .filter((b, i, arr) => arr.indexOf(b) === i); // deduplicate giữ thứ tự
                _labelBranchSuffix = ` ${_uniqueBranches.join('/')}`;
            } else {
                _labelBranchSuffix = branchShort;
            }
            let label = `${_displayStartStr}–${_effectiveEndStr}${_labelBranchSuffix}`;
            // Tên lớp/môn của ca theo lịch (gộp cả chuỗi ca liên tiếp). Chip VẮNG và chip SẮP TỚI
            // trước đây chỉ ghi giờ + cơ sở nên bảng công hiện "09:15–10:45 CS1 (V)" — admin không
            // biết vắng lớp nào để duyệt/tính lương. Nay luôn kèm tên lớp; nếu lịch chưa điền lớp
            // thì ghi rõ "(CHƯA CHỌN LỚP)" để người xếp lịch biết mà bổ sung.
            const _schedLops = (_chainSegments && _chainSegments.length > 0)
                ? [...new Set(_chainSegments.map(seg => seg.lop).filter(Boolean))]
                : (cls.lop ? [cls.lop] : []);
            const _schedSubjectLabel = _schedLops.length > 0 ? _schedLops.join(' + ') : '';
            const _schedSubjectSuffix = _schedSubjectLabel
                ? ` (${_schedSubjectLabel})`
                : ' (CHƯA CHỌN LỚP)';
            let tooltip = `Lớp ${cls.lop || 'CHƯA CHỌN LỚP — lịch thiếu môn/lớp'}${branchTag}`;
            if (_mergedEnd) tooltip += _isCrossBranch ? ` (2 ca gộp – ${(_chainBranches || []).map(b => b.toUpperCase()).join('/')})` : ` (2 ca gộp)`;

            const _splitAbsentAfter = [];
            _splitAbsentSegments.forEach(seg => {
                const segBranch = seg.branch ? ` ${seg.branch.toUpperCase()}` : '';
                const absentChip = {
                    text: `${seg.start}–${seg.end}${segBranch}${seg.lop ? ` (${seg.lop})` : ' (CHƯA CHỌN LỚP)'} (V)`,
                    class: 'chip-gray',
                    paidMinutes: 0,
                    missingSubject: !seg.lop,
                    tooltip: 'Không có dữ liệu chấm công cho ca con trong chuỗi ca liên tiếp (Vắng)',
                    sessionId: null,
                    schedData: { start: seg.start, end: seg.end, lop: seg.lop, lopId: seg.lopId },
                    isClickable: true,
                    isWarning: true,
                    isTeaching: true,
                    isSplitAbsent: true,
                    chipFilterName: normalizeChipFilterName(seg.lop),
                    classStart: seg.start,
                    classEnd: seg.end,
                    classCompositeKey: seg.compositeKey || null,
                    classSectionKey: seg.secKey,
                    classIndex: seg.originalIdx !== undefined ? seg.originalIdx : seg.idx
                };
                if (seg.start < _displayStartStr) chips.push(absentChip);
                else _splitAbsentAfter.push(absentChip);
            });

            const schedDuration = (schedEnd - schedStart) / 60000;
            const now = new Date();

            if (matchedSession) {
                let isClickable = false;
                const b10DataT = bonus10Map[String(matchedSession.id)];
                const b10StatusT = b10DataT ? b10DataT.status : null;

                // Clone sessionData to prevent shared reference modifications
                const chipSessionData = { ...matchedSession };

                if (matchedSession.isAbsent) {
                    chips.push({
                        text: `${cls.lop || 'ca dạy'} (Vắng)`,
                        class: 'chip-gray',
                        paidMinutes: 0,
                        tooltip: 'Admin đánh dấu vắng mặt',
                        sessionId: matchedSession.id,
                        sessionData: chipSessionData,
                        isClickable: true,
                        isTeaching: true,
                        isAdminEdited: !!matchedSession.isAdminEdited,
                        chipFilterName: normalizeChipFilterName(cls.lop),
                        classStart: cls.start,
                        classEnd: cls.end,
                        classCompositeKey: cls._compositeKey || null,
                        classSectionKey: secKey,
                        classIndex: cls._originalIndex !== undefined ? cls._originalIndex : idx
                    });
                    return;
                }

                const observationSummary = getClassObservationSummary(
                    shiftObservations,
                    staffId,
                    cls,
                    secKey,
                    originalIdx,
                    dateStr
                );
                const actualStartForLate = safeDate(matchedSession.checkIn || matchedSession.start);
                const systemLateMinutes = actualStartForLate && actualStartForLate > schedStart
                    ? Math.max(0, Math.round((actualStartForLate - schedStart) / 60000))
                    : 0;
                const manualLateMinutes = observationSummary.manualLateMinutes;
                const effectiveLateMinutes = Math.max(systemLateMinutes, manualLateMinutes);

                const appendLateDetails = () => {
                    if (effectiveLateMinutes > 0) {
                        label += ` (T${effectiveLateMinutes}p)`;
                    }
                    if (manualLateMinutes > 0) {
                        tooltip += ` | Tiếp tân ghi nhận ${manualLateMinutes}p`;
                    }
                    if (observationSummary.notes.length > 0) {
                        tooltip += ` | Ghi chú: ${observationSummary.notes.join(' / ')}`;
                    }
                };

                // Khoảng giờ THỰC SỰ được trả công của chip này — dùng để chặn ca khác
                // tính lại cùng khung giờ (xem _paidClockRanges).
                let _paidFrom = null, _paidTo = null;
                let useScheduledSubject = false;
                let scheduledSubjectName = '';

                // --- CASE A: ATTENDED (Has Check-in) ---
                if (matchedSession.checkOut) {
                    // FULL CHECK-IN/OUT
                    const actualStart = safeDate(matchedSession.checkIn || matchedSession.start);
                    const actualEnd = safeDate(matchedSession.checkOut);
                    if (!actualStart || !actualEnd) return; // skip sessions with invalid timestamps

                    const diffMs = schedStart - actualStart; // >0 = vào sớm, <0 = trễ

                    const actualStartStr = actualStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    const actualEndStr = actualEnd.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

                    // Lấy thời gian làm việc thực tế nằm trong khung giờ lịch
                    const effectiveStart = new Date(Math.max(schedStart.getTime(), actualStart.getTime()));
                    const effectiveEnd = new Date(Math.min(schedEnd.getTime(), actualEnd.getTime()));
                    minutes = Math.max(0, Math.round((effectiveEnd - effectiveStart) / 60000));

                    let isLate = effectiveLateMinutes > 0;
                    if (matchedSession.isAdminEdited) {
                        // QUY TẮC GĐ: giờ admin đã sửa là NGUỒN SỰ THẬT — tính đủ phút theo đúng
                        // khoảng admin đặt, KHÔNG cắt theo khung giờ lịch. (Trước đây admin sửa
                        // 18:00–20:00 vẫn bị cắt còn 1h30 theo lịch 18:00–19:30; sửa 17:50–19:30
                        // bị cắt còn 40p vì lịch lớp 17:00–18:30 — giống nhánh tiếp tân đã làm đúng.)
                        minutes = Math.max(0, Math.round((actualEnd - actualStart) / 60000));
                        label = `${actualStartStr}–${actualEndStr}${_labelBranchSuffix}`;
                    } else {
                        const effectiveStart = new Date(Math.max(schedStart.getTime(), actualStart.getTime()));
                        const effectiveEnd = new Date(Math.min(schedEnd.getTime(), actualEnd.getTime()));
                        minutes = Math.max(0, Math.round((effectiveEnd - effectiveStart) / 60000));

                        // Ghi chú vào sớm. Trễ được áp dụng thống nhất ở dưới.
                        if (actualStart < schedStart) {
                            const earlyMins = Math.round((schedStart - actualStart) / 60000);
                            if (earlyMins > 0) {
                                tooltip += ` | Vào sớm ${earlyMins}p`;
                            }
                        }

                        // Ghi chú về sớm
                        if (actualEnd < schedEnd) {
                            const earlyCheckoutMins = Math.round((schedEnd - actualEnd) / 60000);
                            if (earlyCheckoutMins > 0) {
                                label += ` (V${earlyCheckoutMins}p)`;
                            }
                        }
                    }

                    if (matchedSession.isAdminEdited) {
                        // Admin đã xác nhận giờ → không gắn cờ trễ (T..p) theo lịch cũ nữa;
                        // chỉ giữ ghi nhận trễ TAY của tiếp tân (nếu có) và ghi chú quan sát.
                        isLate = manualLateMinutes > 0;
                        if (manualLateMinutes > 0) {
                            label += ` (T${manualLateMinutes}p)`;
                            tooltip += ` | Tiếp tân ghi nhận ${manualLateMinutes}p`;
                            minutes = Math.max(0, minutes - manualLateMinutes);
                        } else if (systemLateMinutes > 0) {
                            tooltip += ` | Vào sau giờ lịch ${systemLateMinutes}p (admin đã xác nhận giờ)`;
                        }
                        if (observationSummary.notes.length > 0) {
                            tooltip += ` | Ghi chú: ${observationSummary.notes.join(' / ')}`;
                        }
                    } else {
                        // Khoảng chấm công đã tự khấu trừ số phút trễ hệ thống.
                        // Chỉ khấu trừ phần lệnh tiếp tân vượt quá số phút đó.
                        if (manualLateMinutes > systemLateMinutes) {
                            minutes = Math.max(0, minutes - (manualLateMinutes - systemLateMinutes));
                        }
                        appendLateDetails();
                    }

                    _paidFrom = matchedSession.isAdminEdited ? actualStart : effectiveStart;
                    _paidTo = matchedSession.isAdminEdited ? actualEnd : effectiveEnd;

                    // Hiển thị thông tin nếu ra muộn (chỉ để tham khảo, không tính lương)
                    if (actualEnd > schedEnd) {
                        const overMins = Math.round((actualEnd - schedEnd) / 60000);
                        tooltip += ` | Ra muộn ${overMins}p`;
                    }

                    // Determine combined subject label for merged teaching shifts
                    let mergedSubjectNames = '';
                    if (_workedChainSegments && _workedChainSegments.length > 0) {
                        const lops = _workedChainSegments.map(seg => seg.lop).filter(Boolean);
                        mergedSubjectNames = [...new Set(lops)].join(' + ');
                    }
                    // A valid schedule link identifies the class window. The
                    // schedule then owns the display/filter subject unless an
                    // admin explicitly marked a manual subject override. This
                    // prevents stale roleName values (for example PRE-I1) from
                    // changing a linked Pre-I2 class and its salary group.
                    const hasLiveScheduleLink = !!(
                        matchedSession.linkedClassStart && _chainStarts.has(matchedSession.linkedClassStart)
                    );
                    const scheduledSubjectIds = Array.from(new Set(
                        (_workedChainSegments && _workedChainSegments.length > 0
                            ? _workedChainSegments
                            : [{ lopId: cls.lopId || '' }])
                            .flatMap(segment => String(segment?.lopId || '').split('+'))
                            .map(id => id.trim())
                            .filter(Boolean)
                    ));
                    const sessionSubjectIds = String(matchedSession.role || '')
                        .split('+')
                        .map(id => id.trim())
                        .filter(Boolean);
                    // Legacy rows had no subjectOverride flag. When both the
                    // schedule and the session carry different concrete IDs,
                    // keep the old manual choice. When the schedule itself is
                    // missing an ID (the Huy incident), the class name remains
                    // the only reliable schedule identity and therefore wins.
                    const legacyExplicitMismatch = scheduledSubjectIds.length > 0 &&
                        sessionSubjectIds.length > 0 &&
                        !sessionSubjectIds.some(id => scheduledSubjectIds.includes(id));
                    useScheduledSubject = hasLiveScheduleLink &&
                        matchedSession.subjectOverride !== true &&
                        !legacyExplicitMismatch;
                    scheduledSubjectName = mergedSubjectNames || _schedSubjectLabel || cls.lop || '';

                    // Resolve Teaching Role & Rate for the chip (Issue 2)
                    let resolvedRole = matchedSession.role;
                    let resolvedRoleName = matchedSession.roleName;
                    let resolvedRoleRate = matchedSession.roleRate;

                    const isRecepRole = ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(resolvedRole);
                    const hasNoOrRecepRole = !resolvedRole || isRecepRole;

                    if (hasNoOrRecepRole && currentUserContext && currentUserContext.salary_config && currentUserContext.salary_config.roles) {
                        const _cfgAuto = currentUserContext.salary_config.roles;
                        const _autoMatch = cls.lopId ? _cfgAuto.find(r => r.id === cls.lopId) : null;
                        if (_autoMatch) {
                            resolvedRole = _autoMatch.id;
                            resolvedRoleName = _autoMatch.name || cls.lop || 'Môn học';
                            resolvedRoleRate = _autoMatch.rate;
                            
                            // Auto-save session role if currently empty in DB
                            if (!matchedSession.role) {
                                matchedSession.role = _autoMatch.id;
                                matchedSession.roleName = _autoMatch.name || cls.lop || 'Môn học';
                                matchedSession.roleRate = _autoMatch.rate;
                                matchedSession._autoAssignedRole = true;
                            }
                        } else {
                            const defaultTeachingRole = _cfgAuto.find(r => r.isDefault);
                            if (defaultTeachingRole) {
                                resolvedRole = defaultTeachingRole.id;
                                resolvedRoleName = defaultTeachingRole.name;
                                resolvedRoleRate = defaultTeachingRole.rate;
                                
                                if (!matchedSession.role) {
                                    matchedSession.role = defaultTeachingRole.id;
                                    matchedSession.roleName = defaultTeachingRole.name;
                                    matchedSession.roleRate = defaultTeachingRole.rate;
                                    matchedSession._autoAssignedRole = true;
                                }
                            } else if (_cfgAuto.length === 1) {
                                resolvedRole = _cfgAuto[0].id;
                                resolvedRoleName = _cfgAuto[0].name;
                                resolvedRoleRate = _cfgAuto[0].rate;
                                
                                if (!matchedSession.role) {
                                    matchedSession.role = _cfgAuto[0].id;
                                    matchedSession.roleName = _cfgAuto[0].name;
                                    matchedSession.roleRate = _cfgAuto[0].rate;
                                    matchedSession._autoAssignedRole = true;
                                }
                            }
                        }
                    }

                    // Apply the resolved teaching role details to the cloned session data
                    chipSessionData.role = resolvedRole;
                    chipSessionData.roleName = useScheduledSubject && scheduledSubjectName
                        ? scheduledSubjectName
                        : resolvedRoleName;
                    chipSessionData.roleRate = resolvedRoleRate;

                    // Role Logic Display
                    if (chipSessionData.role && !['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chipSessionData.role)) {
                        let _displayRoleName = useScheduledSubject && scheduledSubjectName
                            ? scheduledSubjectName
                            : (chipSessionData.roleName || chipSessionData.role);
                        if (!useScheduledSubject && mergedSubjectNames) {
                            _displayRoleName = mergedSubjectNames;
                        }
                        label += ` (${_displayRoleName})`;
                        tooltip += ` - Vai trò: ${_displayRoleName}`;
                    } else {
                        // Fallback: display the class name and allow user to click to choose role
                        const _subjectLabel = mergedSubjectNames || cls.lop || null;
                        label += _subjectLabel ? ` (${_subjectLabel})` : '';
                        tooltip += _subjectLabel ? ` - Lớp: ${_subjectLabel}` : ' - Bấm để chọn vai trò tính lương';
                    }

                    // TRẦN AN TOÀN cho 1 ca dạy: không tính quá GIỜ LỊCH + biên 60 phút.
                    // Chặn ca admin sửa giờ rộng bất thường / dữ liệu lỗi (VD 07:00–21:00 cho lớp 2h)
                    // làm phồng tổng giờ; vẫn cho phép chạy trội hợp lý (VD lớp 1h30, làm 1h40).
                    // Giờ lịch đã tính theo cả chuỗi lớp GỘP. Tăng ca duyệt & thưởng 10p cộng RIÊNG bên dưới.
                    const _maxTeachingMinutes = schedDuration + 60;
                    if (minutes > _maxTeachingMinutes) {
                        minutes = Math.max(0, Math.round(_maxTeachingMinutes));
                        tooltip += ` | Đã giới hạn theo giờ lịch (chống tính dư)`;
                    }

                    // BONUS 10P (từ request được duyệt)
                    if (b10StatusT === 'approved' || matchedSession.bonus10) {
                        if (early10PenaltyActive) {
                            label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p (hủy)';
                            tooltip += ` | Thưởng 10p bị khóa vì có ca bị từ chối trong tháng`;
                        } else {
                            minutes += 10;
                            label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p';
                            tooltip += ` | Thưởng 10p (đã duyệt)`;
                        }
                    } else if (b10StatusT === 'pending') {
                        label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '?';
                        tooltip += ` | Yêu cầu Sớm 10p đang chờ duyệt`;
                    }

                    cssClass = isLate ? 'chip-orange' : 'chip-green';
                    tooltip += ' - Đã chấm công đầy đủ';
                    isClickable = true;
                } else {
                    // No Check Out
                    const actualStartNoCO = safeDate(matchedSession.checkIn || matchedSession.start);
                    const actualStartStrNoCO = actualStartNoCO ? actualStartNoCO.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '??:??';
                    const classEndTime = new Date(`${dateStr}T${cls.end}`);

                    // Check if this is a past day (session date < today)
                    const todayStr = getLocalDateKey ? getLocalDateKey(now) : now.toISOString().split('T')[0];
                    const isPastDay = dateStr < todayStr;

                    appendLateDetails();
                    if (isPastDay || now > new Date(classEndTime.getTime() + 90 * 60000)) {
                        minutes = Math.max(0, schedDuration - effectiveLateMinutes);
                        _paidFrom = (actualStartNoCO && actualStartNoCO > schedStart) ? actualStartNoCO : schedStart;
                        _paidTo = schedEnd;
                        cssClass = effectiveLateMinutes > 0 ? 'chip-orange' : 'chip-green';
                        tooltip += effectiveLateMinutes > 0
                            ? ' - Tự ra ca (đã khấu trừ phút trễ hiệu lực)'
                            : ' - Tự ra ca (Tính đủ giờ)';
                        isClickable = true;
                    } else {
                        minutes = 0;
                        cssClass = effectiveLateMinutes > 0 ? 'chip-orange' : 'chip-blue';
                        label += ` (Đang làm)`;
                        tooltip += ` - Đang làm | Vào: ${actualStartStrNoCO}`;
                    }
                }

                // === OVERTIME INTEGRATION ===
                const sessionKey = String(matchedSession.id);
                const otData = overtimeMap[sessionKey];
                let otMinutes = 0;
                let otPending = false;
                let otId = null;
                if (otData) {
                    otId = otData.id;
                    if (otData.status === 'approved') {
                        otMinutes = otData.minutes || 0;
                        label += ' ' + window.getIconHtml('clock', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+' + otData.duration;
                    } else if (otData.status === 'pending') {
                        otPending = true;
                        label += ' ' + window.getIconHtml('clock', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '?';
                    }
                }

                // Track teaching minutes and shifts details for subtracting from receptionist time (Issue 1)
                if (minutes > 0) {
                    _addPaidClockRange(_paidFrom, _paidTo, matchedSession.id);
                    // Đánh dấu ĐÚNG khung giờ mà phiên vừa được tính, để ca dạy khác trong
                    // ngày vẫn dùng lại được phiên này nếu không chồng giờ.
                    (matchedSession._combinedSessionIds || [matchedSession.id]).forEach(sid =>
                        _claimSessionRange(sid, _paidFrom || schedStart, _paidTo || schedEnd));
                    if (!teachingMinutesMap[matchedSession.id]) {
                        teachingMinutesMap[matchedSession.id] = 0;
                        teachingSessionsMap[matchedSession.id] = [];
                    }
                    teachingMinutesMap[matchedSession.id] += minutes;
                    // Ghi ĐỦ các ca con thực làm của chuỗi ca gộp (trước đây chỉ ghi ca đầu
                    // `cls.start–cls.end` nên ngày vừa dạy vừa trực bị trừ thiếu giờ dạy →
                    // giờ tiếp tân bị cộng dư). Kèm tên lớp để ô chi tiết hiển thị từng khúc.
                    const _teachSegs = (_workedChainSegments && _workedChainSegments.length > 0)
                        ? _workedChainSegments
                        : [{ start: _displayStartStr, end: _effectiveEndStr, lop: cls.lop || '' }];
                    _teachSegs.forEach(seg => {
                        teachingSessionsMap[matchedSession.id].push({
                            start: seg.start,
                            end: seg.end,
                            lop: seg.lop || cls.lop || '',
                            paidMinutes: minutes,
                            branch: seg.branch || cls._branch || ''
                        });
                    });
                }

                const _chipSubjectIds = Array.from(new Set(
                    (_workedChainSegments && _workedChainSegments.length > 0
                        ? _workedChainSegments
                        : [{ lopId: cls.lopId || null }])
                        .flatMap(segment => String(segment?.lopId || '').split('+'))
                        .map(id => id.trim())
                        .filter(Boolean)
                ));

                // Khi admin sửa/chọn lại môn cho một phiên, tên vai trò trong phiên là
                // nguồn sự thật của chip. Lịch có thể vẫn giữ môn cũ (ví dụ lịch là Nhảy
                // nhưng ca đã sửa thành BTH); nếu gom lương theo cls.lop thì giờ bị đẩy
                // nhầm sang môn cũ dù chip đang hiển thị môn mới.
                const chipFilterName = useScheduledSubject && scheduledSubjectName
                    ? normalizeChipFilterName(scheduledSubjectName)
                    : (matchedSession.isAdminEdited && (chipSessionData.roleName || chipSessionData.role)
                        ? normalizeChipFilterName(chipSessionData.roleName || chipSessionData.role)
                        : normalizeChipFilterName(cls.lop));

                chips.push({
                    text: label,
                    class: cssClass,
                    paidMinutes: Math.max(0, Math.round(minutes + otMinutes)),
                    tooltip: tooltip,
                    sessionId: matchedSession.id,
                    sessionData: chipSessionData, // Use cloned chipSessionData
                    isClickable: isClickable,
                    isAdminEdited: !!(matchedSession && matchedSession.isAdminEdited),
                    isTeaching: true,
                    studentCount: chipSessionData.studentCount || null,
                    studentCountStatus: chipSessionData.studentCountStatus || null,
                    chipFilterName: chipFilterName,
                    subjectIds: _chipSubjectIds,
                    subjectId: _chipSubjectIds.length === 1 ? _chipSubjectIds[0] : null,
                    lopId: cls.lopId || null,
                    classStart: cls.start,
                    classEnd: cls.end,
                    classCompositeKey: cls._compositeKey || null,
                    classSectionKey: secKey,
                    classIndex: cls._originalIndex !== undefined ? cls._originalIndex : idx,
                    overtimeId: otId,
                    overtimePending: otPending,
                    overtimeMinutes: otMinutes,
                    bonus10Status: b10StatusT,
                    bonus10Id: b10DataT ? b10DataT.id : null,
                    mergedSegments: (_mergeInfo[_mk] && _mergeInfo[_mk].chainSegments) || null,
                    systemLateMinutes,
                    manualLateMinutes,
                    effectiveLateMinutes,
                    shiftObservationIds: observationSummary.ids,
                    shiftObservationNotes: observationSummary.notes,
                    usesScheduledSubject: useScheduledSubject,
                    scheduledSubjectName: useScheduledSubject ? scheduledSubjectName : null
                });
                if (_splitAbsentAfter.length > 0) chips.push(..._splitAbsentAfter);

            } else {
                // --- CASE B: NO ATTENDANCE ---
                if (isCenterClosed(dateStr, secKey, window.centerClosures)) {
                    chips.push({
                        text: `${cls.lop || 'ca dạy'} (Nghỉ)`,
                        class: 'chip-gray',
                        paidMinutes: 0,
                        tooltip: 'Trung tâm cho nghỉ (tắt lớp)',
                        sessionId: null,
                        isClickable: false,
                        isCenterOff: true,
                        isTeaching: true,
                        chipFilterName: normalizeChipFilterName(cls.lop),
                        classStart: cls.start,
                        classEnd: cls.end,
                        classCompositeKey: cls._compositeKey || null,
                        classSectionKey: secKey,
                        classIndex: cls._originalIndex !== undefined ? cls._originalIndex : idx
                    });
                    return;
                }

                // FIX: So sánh chuỗi ngày thay vì Date object để tránh lỗi timezone
                const todayStrClass = typeof getLocalDateKey === 'function' ? getLocalDateKey(now) : now.toISOString().split('T')[0];
                const nowTimeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
                const isFutureDateClass = dateStr > todayStrClass;
                const isTodayFutureTimeClass = (dateStr === todayStrClass) && (cls.start > nowTimeStr);

                if (isFutureDateClass || isTodayFutureTimeClass) {
                    // --- NEW: Show chip-future if user registered but no check-in yet ---
                    // Kiểm tra nếu GV đã nhận lớp (registeredTeachers có user) nhưng chưa check-in
                    // → Tạo chip-future để hiển thị "Đã nhận lớp, chờ chấm công" = Sắp tới
                    chips.push({
                        text: label + _schedSubjectSuffix,
                        class: 'chip-future',
                        paidMinutes: 0,
                        tooltip: `Đã nhận lớp - chờ chấm công | Lớp ${_schedSubjectLabel || 'CHƯA CHỌN LỚP'}${branchTag}`,
                        missingSubject: !_schedSubjectLabel,
                        sessionId: null,
                        schedData: { start: cls.start, end: cls.end, lop: cls.lop, phong: cls.phong },
                        isClickable: false,
                        isTeaching: true,
                        chipFilterName: normalizeChipFilterName(cls.lop),
                        classStart: cls.start,
                        classEnd: cls.end,
                        classCompositeKey: cls._compositeKey || null,
                        classSectionKey: secKey,
                        classIndex: cls._originalIndex !== undefined ? cls._originalIndex : idx,
                        isScheduledOnly: true
                    });
                } else {
                    // Nếu đã có session khớp ở branch khác cùng giờ → bỏ qua, không sinh chip Vắng
                    if (_matchedTimeSlots.has(`${cls.start}_${cls.end}`)) return;
                    // Chỉ phiên CHƯA được ghép cho ca trước mới được dùng để chứng minh
                    // đang dạy/hỗ trợ lớp khác. Nếu không, một phiên 15:30–21:00 đã
                    // thuộc ca 15:30 sẽ che sai các ca tối sau khoảng nghỉ.
                    const availableWorkSessions = attendanceSessions.filter(
                        session => !_sessionBlockedForClass(session.id, schedStart, schedEnd)
                    );
                    if (hasOverlappingWorkSession(availableWorkSessions, dateStr, cls.start, cls.end)) return;
                    chips.push({
                        text: label + _schedSubjectSuffix + ' (V)',
                        class: 'chip-gray',
                        paidMinutes: 0,
                        tooltip: _schedSubjectLabel
                            ? `Không có dữ liệu chấm công (Vắng) — Lớp ${_schedSubjectLabel}`
                            : 'Không có dữ liệu chấm công (Vắng) — LỊCH CHƯA ĐIỀN MÔN/LỚP nên không tính được lương. Vui lòng bổ sung lớp trong Lịch Làm.',
                        sessionId: null,
                        schedData: { start: cls.start, end: cls.end, lop: cls.lop, lopId: cls.lopId },
                        isClickable: true,
                        isWarning: true,
                        isTeaching: true,
                        missingSubject: !_schedSubjectLabel,
                        chipFilterName: normalizeChipFilterName(cls.lop),
                        classStart: cls.start,
                        classEnd: cls.end,
                        classCompositeKey: cls._compositeKey || null,
                        classSectionKey: secKey,
                        classIndex: cls._originalIndex !== undefined ? cls._originalIndex : idx
                    });
                }
            }
        });
    });

    // ==================== RECEPTIONIST SHIFTS ====================
    // Process receptionist schedule shifts (from lich-tiep-tan.html)
    // receptionistShifts = [{ shift: 'morning', label: 'SÁNG', start: '07:00', end: '11:30' }, ...]

    // Một ngày có thể được lưu thành 2 phiên độc lập: phiên tiếp tân kết thúc
    // đúng lúc phiên dạy bắt đầu. Trước đây phần tiếp tân chỉ tìm teaching
    // segments theo đúng id phiên của nó, nên sau khi admin xoá/tạo lại chip dạy
    // thì chuỗi bị đứt dù lịch và dữ liệu chấm công đều hợp lệ.
    //
    // Quy tắc an toàn của chỉ mục này:
    // - Chỉ xét phiên dạy đã được calculate ở trên và có checkout thật.
    // - Chỉ nối đúng mốc lịch liên tục (ca tiếp tân kết thúc = ca dạy bắt đầu).
    // - Không sửa object attendanceSessions và không tạo bản ghi mới.
    const _attendanceByIdForCrossRole = new Map(
        (Array.isArray(attendanceSessions) ? attendanceSessions : [])
            .filter(s => s && s.id !== undefined && s.id !== null)
            .map(s => [String(s.id), s])
    );
    const _toCrossRoleDate = (timeStr) => {
        if (!timeStr || !String(timeStr).includes(':')) return null;
        const [h, m] = String(timeStr).split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        const [y, mo, d] = String(dateStr).split('-').map(Number);
        const result = new Date(y, mo - 1, d, h, m, 0, 0);
        return Number.isNaN(result.getTime()) ? null : result;
    };
    const _formatCrossRoleTime = dt => dt
        ? `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
        : '';
    const _isReceptionistSession = session => {
        const role = String(session?.role || '').toLowerCase();
        const roleName = removeVietnameseTones(String(session?.roleName || '').toLowerCase());
        return ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(role) ||
            roleName.includes('tieptan') || roleName.includes('reception');
    };

    // Build the scheduled teaching chain for a branch. This is used only as a
    // display boundary when a later, real teaching session is present but an
    // earlier segment has no attendance record. It must never create paid
    // minutes or a Firestore session.
    const _scheduledTeachingChain = (chainStart, branch) => {
        const slots = [];
        const seen = new Set();
        sections.forEach(secKey => {
            (schedule[secKey] || []).forEach((cls, idx) => {
                if (!cls || !cls.start || !cls.end) return;
                if (cls.isClosed === true) return;
                const originalIdx = cls._originalIndex !== undefined ? cls._originalIndex : idx;
                const compositeKey = cls._compositeKey || null;
                if (compositeKey && cancelledShifts.includes(`${compositeKey}_${secKey}_${originalIdx}`)) return;
                const assigned = isScheduledSubstitute(cls, staffId) ||
                    isScheduledMainTeacher(cls, staffId) ||
                    (cls.registeredTeachers || []).some(t => t.id === staffId);
                if (!assigned) return;
                if (branch && cls._branch && cls._branch !== branch) return;

                const key = `${cls._branch || ''}|${cls.start}|${cls.end}`;
                if (seen.has(key)) return;
                seen.add(key);
                slots.push({
                    start: cls.start,
                    end: cls.end,
                    lop: cls.lop || '',
                    lopId: cls.lopId || '',
                    branch: cls._branch || branch || '',
                    compositeKey,
                    secKey,
                    originalIdx
                });
            });
        });

        slots.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
        const chain = [];
        let cursor = chainStart;
        while (true) {
            const next = slots.find(slot => slot.start === _formatCrossRoleTime(cursor));
            if (!next) break;
            chain.push(next);
            cursor = _toCrossRoleDate(next.end);
            if (!cursor) break;
        }
        return chain.length > 0 ? { segments: chain, end: cursor } : null;
    };

    const _findAdjacentTeachingChain = (receptionSession, receptionEnd, branch) => {
        if (!receptionSession || !receptionEnd) return null;

        const receptionCheckOut = safeDate(receptionSession.checkOut);
        // Không kéo dài một ca đã checkout trước giờ kết thúc lịch để “ăn” vào
        // một ca dạy sau đó. Trường hợp này cần admin xác nhận riêng.
        if (!receptionCheckOut || receptionCheckOut < receptionEnd) return null;

        let cursor = receptionEnd;
        const selectedSessionIds = [];
        const selectedSegments = [];
        const consumedSessionIds = new Set();
        let changed = true;

        while (changed) {
            changed = false;
            for (const [sessionId, rawSegments] of Object.entries(teachingSessionsMap)) {
                if (String(sessionId) === String(receptionSession.id) || consumedSessionIds.has(String(sessionId))) continue;
                const teachingSession = _attendanceByIdForCrossRole.get(String(sessionId));
                if (!teachingSession || teachingSession.isAbsent) continue;

                const teachingCheckIn = safeDate(teachingSession.checkIn || teachingSession.start);
                const teachingCheckOut = safeDate(teachingSession.checkOut);
                if (!teachingCheckIn || !teachingCheckOut) continue;

                const segments = (Array.isArray(rawSegments) ? rawSegments : [])
                    .map(seg => ({ ...seg, _startDate: _toCrossRoleDate(seg.start), _endDate: _toCrossRoleDate(seg.end) }))
                    .filter(seg => seg._startDate && seg._endDate && seg._endDate > seg._startDate)
                    .filter(seg => !branch || !seg.branch || seg.branch === branch)
                    .sort((a, b) => a._startDate - b._startDate);
                if (segments.length === 0) continue;

                const first = segments.find(seg =>
                    seg._startDate.getTime() === cursor.getTime() &&
                    teachingCheckIn <= seg._startDate &&
                    teachingCheckOut >= seg._endDate
                );
                if (!first) continue;

                const chain = [first];
                let chainEnd = first._endDate;
                segments.forEach(seg => {
                    if (seg === first) return;
                    if (seg._startDate.getTime() === chainEnd.getTime() && teachingCheckOut >= seg._endDate) {
                        chain.push(seg);
                        chainEnd = seg._endDate;
                    }
                });

                consumedSessionIds.add(String(sessionId));
                selectedSessionIds.push(sessionId);
                chain.forEach(seg => {
                    const { _startDate, _endDate, ...cleanSegment } = seg;
                    selectedSegments.push(cleanSegment);
                });
                cursor = chainEnd;
                changed = true;
                break;
            }
        }

        if (selectedSegments.length === 0) {
            // Recovery for the exact incident where an earlier teaching chip
            // was removed but a later real teaching session remains. Extend
            // the receptionist display to the end of the continuous schedule,
            // while keeping only real attendance segments for payroll.
            // Restrict this fallback to admin-edited attendance so normal
            // employee clocking cannot be converted into schedule-only pay.
            if (!receptionSession.isAdminEdited) return null;
            const scheduledChain = _scheduledTeachingChain(receptionEnd, branch);
            if (!scheduledChain || scheduledChain.segments.length < 2) return null;

            const actualSegments = [];
            const actualSessionIds = [];
            const actualSegmentKeys = new Set();
            const addActualSegment = (sessionId, segment) => {
                if (!segment || !segment.start || !segment.end) return;
                const key = `${segment.start}|${segment.end}`;
                if (actualSegmentKeys.has(key)) return;
                actualSegmentKeys.add(key);
                actualSegments.push({ ...segment });
                if (!actualSessionIds.some(id => String(id) === String(sessionId))) {
                    actualSessionIds.push(sessionId);
                }
            };
            scheduledChain.segments.forEach(scheduled => {
                for (const [sessionId, rawSegments] of Object.entries(teachingSessionsMap)) {
                    const teachingSession = _attendanceByIdForCrossRole.get(String(sessionId));
                    if (!teachingSession || teachingSession.isAbsent) continue;
                    const teachingCheckIn = safeDate(teachingSession.checkIn || teachingSession.start);
                    const teachingCheckOut = safeDate(teachingSession.checkOut);
                    if (!teachingCheckIn || !teachingCheckOut) continue;
                    const isCovered = teachingCheckIn <= _toCrossRoleDate(scheduled.start) &&
                        teachingCheckOut >= _toCrossRoleDate(scheduled.end);
                    if (!isCovered) continue;
                    const segment = (Array.isArray(rawSegments) ? rawSegments : [])
                        .find(seg => seg.start === scheduled.start && seg.end === scheduled.end);
                    if (!segment) continue;
                    addActualSegment(sessionId, segment);
                    break;
                }

                // The report may have been opened with a legacy/manual session
                // whose generated teaching index is incomplete. A live class
                // link plus real check-in/out is still enough evidence to show
                // the chain boundary. We read it directly here, but never turn
                // it into a Firestore record or invent paid minutes.
                const scheduledKey = `${scheduled.start}|${scheduled.end}`;
                if (actualSegmentKeys.has(scheduledKey)) return;
                const scheduledStart = _toCrossRoleDate(scheduled.start);
                const scheduledEnd = _toCrossRoleDate(scheduled.end);
                if (!scheduledStart || !scheduledEnd) return;
                const rawMatch = (Array.isArray(attendanceSessions) ? attendanceSessions : []).find(session => {
                    if (!session || String(session.id) === String(receptionSession.id) || session.isAbsent) return false;
                    if (_isReceptionistSession(session)) return false;
                    if (String(session.linkedClassStart || '') !== String(scheduled.start)) return false;
                    const checkIn = safeDate(session.checkIn || session.start);
                    const checkOut = safeDate(session.checkOut);
                    return !!(checkIn && checkOut && checkIn <= scheduledStart && checkOut >= scheduledEnd);
                });
                if (rawMatch) {
                    addActualSegment(rawMatch.id, {
                        start: scheduled.start,
                        end: scheduled.end,
                        lop: scheduled.lop,
                        lopId: scheduled.lopId || '',
                        branch: scheduled.branch || branch || '',
                        paidMinutes: Math.round((scheduledEnd - scheduledStart) / 60000)
                    });
                }
            });

            if (actualSegments.length === 0) return null;
            const actualStarts = new Set(actualSegments.map(seg => seg.start));
            const missingSegments = scheduledChain.segments.filter(seg => !actualStarts.has(seg.start));
            return {
                sessionIds: actualSessionIds,
                segments: actualSegments,
                end: scheduledChain.end,
                endText: _formatCrossRoleTime(scheduledChain.end),
                inferredFromSchedule: true,
                missingSegments
            };
        }
        return {
            sessionIds: selectedSessionIds,
            segments: selectedSegments,
            end: cursor,
            endText: _formatCrossRoleTime(cursor)
        };
    };

    receptionistShifts = mergeAdjacentShifts(receptionistShifts);

    // Yêu cầu: process ca Cố Định trước, rồi mới process ca thường
    receptionistShifts.sort((a, b) => {
        const aFixed = a.isFixedShift ? 1 : 0;
        const bFixed = b.isFixedShift ? 1 : 0;
        if (bFixed !== aFixed) return bFixed - aFixed;
        // Cùng loại thì sort theo giờ bắt đầu
        return a.start.localeCompare(b.start);
    });

    receptionistShifts.forEach(rs => {
        if (!rs.start || !rs.end || typeof rs.start !== 'string' || typeof rs.end !== 'string') return;

        const startParts = rs.start.split(':');
        const endParts = rs.end.split(':');
        if (startParts.length < 2 || endParts.length < 2) return;

        // FIX: tách năm/tháng/ngày từ dateStr để tạo local Date, tránh UTC parse
        const [_ry, _rm, _rd] = dateStr.split('-').map(Number);
        // let (không phải const) vì "tách ca gộp" có thể thu hẹp mốc giờ lịch về ca con thực làm.
        let schedStart = new Date(_ry, _rm - 1, _rd, parseInt(startParts[0], 10), parseInt(startParts[1], 10), 0, 0);
        let schedEnd = new Date(_ry, _rm - 1, _rd, parseInt(endParts[0], 10), parseInt(endParts[1], 10), 0, 0);

        if (isNaN(schedStart.getTime()) || isNaN(schedEnd.getTime())) return;

        let schedDuration = (schedEnd - schedStart) / 60000;
        // Lưu FULL danh sách ca con gốc (trước khi tách) để ô sửa còn cho phép bỏ đánh dấu vắng.
        const _fullSubShifts = rs.mergedSegments ? rs.mergedSegments.slice() : null;
        const now = new Date();

        // Branch tag for receptionist shifts — abbreviated
        const branchTag = rs.branch ? ` [${rs.branch.toUpperCase()}]` : '';
        const branchShortR = rs.branch ? ` ${rs.branch.toUpperCase()}` : '';
        // Shift label abbreviation: SÁNG→S, CHIỀU→C, TỐI→T
        const shiftAbbr = { 'SÁNG': 'S', 'CHIỀU': 'C', 'TỐI': 'T' };
        const labelShort = shiftAbbr[rs.label] || rs.label;

        // Label format: "C 15:00–18:30 CS2"
        let label = `${labelShort} ${rs.start}–${rs.end}${branchShortR}`;
        let tooltip = `Ca Tiếp Tân: ${rs.label} (${rs.start}–${rs.end})${branchTag}`;

        // Calculate keys for un-assignment logic
        const dateParts = dateStr.split('-');
        const dateObjLocal = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]));
        const dayIdxLocal = dateObjLocal.getDay() === 0 ? 6 : dateObjLocal.getDay() - 1;
        const DAY_KEYS_LOCAL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const dayKeyLocal = DAY_KEYS_LOCAL[dayIdxLocal];

        const mondayLocal = new Date(dateObjLocal);
        mondayLocal.setDate(mondayLocal.getDate() - dayIdxLocal);
        const mondayKeyLocal = `${mondayLocal.getFullYear()}-${String(mondayLocal.getMonth() + 1).padStart(2, '0')}-${String(mondayLocal.getDate()).padStart(2, '0')}`;
        const compositeKeyLocal = `${rs.branch}_${mondayKeyLocal}`;


        // Find matching attendance session
        const matchedSession = attendanceSessions.find(s => {
            // FIX bug Ánh: session do admin thêm tay từ chip Vắng đã link cứng vào ca này
            // → match thẳng, bỏ qua kiểm tra khung giờ (vì admin có thể đã nhập giờ lệch).
            if (s.linkedReceptionistShift && s.linkedReceptionistShift === rs.shift) {
                return true;
            }

            const checkIn = safeDate(s.checkIn || s.start);
            if (!checkIn) return false;
            const checkOut = safeDate(s.checkOut);

            // KHỚP-TRÙM (ngày làm LIÊN TỤC nhiều ca khác chức năng — VD tiếp tân → dạy → tiếp tân):
            // 1 lần chấm công có giờ RA bao trùm khung giờ ca này (chồng ≥ 10 phút) thì khớp,
            // KỂ CẢ khi session đã dùng cho ca tiếp tân khác trong ngày. Nhờ vậy sáng chấm 1 lần
            // + ra chiều sẽ tự phủ cả ca sáng, ca dạy (nhánh dạy đã xử riêng) và ca chiều, không báo
            // vắng oan. Mỗi ca chỉ tính phần giờ NẰM TRONG khung ca của nó + đã trừ giờ dạy trùng,
            // nên không cộng trùng.
            if (checkOut) {
                const ovStart = Math.max(checkIn.getTime(), schedStart.getTime());
                const ovEnd = Math.min(checkOut.getTime(), schedEnd.getTime());
                if (ovEnd - ovStart >= 10 * 60 * 1000) return true;
            }

            // Các cách khớp cũ: chỉ nhận session CHƯA bị dùng cho ca tiếp tân khác.
            if (usedSessionIdsReceptionist.has(s.id)) return false;

            if (rs.isFixedShift) {
                // Ca Cố Định: chỉ nhận một phiên đã thực sự làm trong ca.
                // Không dùng điều kiện "checkOut >= schedStart" vì một phiên
                // kết thúc lệch vài giây sau giờ bắt đầu (ví dụ 13:30:10)
                // sẽ bị ghép nhầm vào ca 13:30–18:00, tạo nhãn V270p và chiếm
                // mất phiên vào ca đúng lúc 13:33.
                if (checkOut) return false;

                // Session đang mở (chưa checkout): match nếu checkIn trong khung ±90p.
                const earlyLimit = new Date(schedStart.getTime() - 90 * 60 * 1000);
                return checkIn >= earlyLimit && checkIn <= schedEnd;
            }

            // Ca thường: Match nếu check-in nằm trong khoảng (schedStart - 90 phút) đến schedEnd.
            const earlyLimit = new Date(schedStart.getTime() - 90 * 60 * 1000);
            return checkIn >= earlyLimit && checkIn <= schedEnd;
        });

        if (matchedSession) {
            usedSessionIdsReceptionist.add(matchedSession.id);

            let minutes = 0;
            let cssClass = 'chip-blue';
            let isClickable = false;
            let isLate = false;
            // Các khúc trong ngày (tiếp tân / dạy) — dùng cho ô "Chi tiết ca trong ngày" ở popup sửa
            let _daySegments = [];

            const b10DataR = bonus10Map[String(matchedSession.id)];
            const b10StatusR = b10DataR ? b10DataR.status : null;

            const chipSessionData = { ...matchedSession };

            if (matchedSession.isAbsent) {
                chips.push({
                    text: `${rs.label ? 'Tiếp Tân (' + rs.label + ')' : 'Tiếp Tân'} (Vắng)`,
                    class: 'chip-gray',
                    paidMinutes: 0,
                    tooltip: 'Admin đánh dấu vắng mặt',
                    sessionId: matchedSession.id,
                    sessionData: chipSessionData,
                    isClickable: true,
                    isReceptionist: true,
                    isAdminEdited: !!matchedSession.isAdminEdited,
                    chipFilterName: normalizeChipFilterName(rs.label ? 'Tiếp Tân (' + rs.label + ')' : 'Tiếp Tân'),
                    classCompositeKey: compositeKeyLocal,
                    classSectionKey: rs.shift,
                    classIndex: dayKeyLocal,
                    isFixedShift: rs.isFixedShift,
                    mergedSegments: rs.mergedSegments || null,
                    bonus10Status: b10StatusR
                });
                return;
            }

            // === TÁCH CA GỘP (TỰ ĐỘNG + admin ghi đè) ===
            // Quy tắc GĐ: ca gộp gồm nhiều ca con kề nhau. Dựa vào giờ VÀO/RA thực tế:
            //  - Ca con đến SAU khi nó đã kết thúc → VẮNG (bỏ lỡ cả ca đó).
            //  - Ca con ra-về TRƯỚC khi nó bắt đầu → VẮNG.
            //  - Giờ trễ tính theo ca con thực làm đầu tiên (không tính từ mốc ca gộp).
            // Admin có thể ghi đè bằng ô tick (absentSubShifts): [] = ép "làm đủ", có phần tử = vắng tay.
            let _splitAbsentStartsForChip = null; // ghi lên chip để ô sửa hiển thị đúng ca con vắng
            if (rs.mergedSegments && rs.mergedSegments.length > 1) {
                let _absentStarts = new Set();
                if (Array.isArray(matchedSession.absentSubShifts)) {
                    // Admin đã đụng tay → tôn trọng lựa chọn tay (kể cả [] nghĩa là "làm đủ, đừng tách").
                    _absentStarts = new Set(matchedSession.absentSubShifts);
                } else {
                    // TỰ ĐỘNG suy ra từ giờ chấm công.
                    const _ci = safeDate(matchedSession.checkIn || matchedSession.start);
                    const _co = safeDate(matchedSession.checkOut); // có thể null (quên/chưa ra ca)
                    if (_ci) {
                        // Gộp ca con CHỒNG giờ (double-book) trước để không tạo vắng ảo.
                        const _collapsed = collapseOverlappingSegments(rs.mergedSegments, _ry, _rm, _rd);
                        _collapsed.forEach(cseg => {
                            // Quy tắc GĐ: trễ quá 50 phút so với giờ bắt đầu ca con → VẮNG cả ca con đó.
                            // (VD ca 14:00–18:00, vào 17:17 = trễ 197p → VẮNG ca chiều, không còn tính
                            //  "làm cả ca chiều nhưng trễ 197p" như trước.)
                            // Vẫn giữ điều kiện cũ "vào sau khi ca con đã kết thúc" để ca con ngắn
                            // (dưới 50 phút) không bị lọt.
                            const _lateMs = _ci - cseg._startDate;                // >0 = vào trễ so với ca con
                            const _missedByLate = _lateMs > LATE_ABSENT_THRESHOLD_MS || _ci >= cseg._endDate;
                            const _missedByEarly = _co && _co <= cseg._startDate; // về trước khi ca con bắt đầu
                            if (_missedByLate || _missedByEarly) {
                                cseg._origStarts.forEach(st => _absentStarts.add(st));
                            }
                        });
                    }
                }

                const _workedSegs = rs.mergedSegments.filter(s => !_absentStarts.has(s.start));
                const _absentSegs = rs.mergedSegments.filter(s => _absentStarts.has(s.start));

                // Chỉ tách khi vừa có ca con làm, vừa có ca con vắng (tránh làm hỏng dữ liệu).
                if (_absentStarts.size > 0 && _workedSegs.length > 0 && _absentSegs.length > 0) {
                    _splitAbsentStartsForChip = _absentSegs.map(s => s.start);
                    // 1) Mỗi ca con bị vắng → 1 chip Vắng riêng
                    _absentSegs.forEach(seg => {
                        chips.push({
                            text: `${labelShort} ${seg.start}–${seg.end}${branchShortR} (Tiếp Tân) (Vắng)`,
                            class: 'chip-gray',
                            paidMinutes: 0,
                            tooltip: 'Tách ca gộp: ca con này VẮNG (theo giờ chấm công / đánh dấu tay)',
                            sessionId: null,
                            schedData: { start: seg.start, end: seg.end },
                            isClickable: false,
                            isWarning: true,
                            isReceptionist: true,
                            isSplitAbsent: true,
                            chipFilterName: normalizeChipFilterName(rs.label ? 'Tiếp Tân (' + rs.label + ')' : 'Tiếp Tân'),
                            classCompositeKey: compositeKeyLocal,
                            classSectionKey: rs.shift,
                            classIndex: dayKeyLocal,
                            isFixedShift: seg.isFixedShift
                        });
                    });

                    // 2) Thu hẹp ca làm về các ca con thực làm → tính giờ trễ theo ca thật
                    const _workedStart = _workedSegs.reduce((m, s) => (s.start < m ? s.start : m), _workedSegs[0].start);
                    const _workedEnd = _workedSegs.reduce((m, s) => (s.end > m ? s.end : m), _workedSegs[0].end);
                    rs.start = _workedStart;
                    rs.end = _workedEnd;
                    rs.mergedSegments = _workedSegs.length > 1 ? _workedSegs : null;
                    const [_wsH, _wsM] = _workedStart.split(':').map(Number);
                    const [_weH, _weM] = _workedEnd.split(':').map(Number);
                    schedStart = new Date(_ry, _rm - 1, _rd, _wsH, _wsM, 0, 0);
                    schedEnd = new Date(_ry, _rm - 1, _rd, _weH, _weM, 0, 0);
                    schedDuration = (schedEnd - schedStart) / 60000;
                    label = `${labelShort} ${_workedStart}–${_workedEnd}${branchShortR}`;
                }
            }

            // Nhận diện chuỗi tiếp tân -> dạy từ 2 phiên chấm công độc lập.
            // `matchedSession` vẫn là phiên tiếp tân gốc để sửa/xoá đúng bản ghi;
            // chỉ dùng `_crossRoleChain` cho cách tính và hiển thị trong bộ nhớ.
            const _crossRoleChain = _findAdjacentTeachingChain(matchedSession, schedEnd, rs.branch);
            const _crossRoleTeachingShifts = _crossRoleChain ? _crossRoleChain.segments : [];
            const _crossRoleEnd = _crossRoleChain ? _crossRoleChain.end : null;

            if (matchedSession.checkOut) {
                // === HAS CHECK-OUT ===
                const actualStart = safeDate(matchedSession.checkIn || matchedSession.start);
                const actualEnd = safeDate(matchedSession.checkOut);
                
                // Lấy thời gian làm việc thực tế nằm trong khung giờ lịch
                const effectiveStartR = new Date(Math.max(schedStart.getTime(), actualStart.getTime()));
                const logicalEndR = _crossRoleEnd || actualEnd;
                const logicalSchedEndR = _crossRoleEnd || schedEnd;
                const effectiveEndR = new Date(Math.min(logicalSchedEndR.getTime(), logicalEndR.getTime()));
                minutes = Math.max(0, Math.round((effectiveEndR - effectiveStartR) / 60000));

                // Subtract overlapping teaching minutes! (Issue 1)
                // NGÀY 2 CHỨC NĂNG: khung ca tiếp tân bị lớp dạy "khoét" ra. Cắt khung thành các
                // khúc rồi chỉ cộng khúc tiếp tân → 1 lần bấm vào ca vẫn ra đúng: dạy tính giá
                // dạy, tiếp tân tính giá tiếp tân, không đoạn nào bị tính 2 lần.
                const teachingShifts = [
                    ...(teachingSessionsMap[matchedSession.id] || []),
                    ..._crossRoleTeachingShifts
                ];
                // Giờ vào thực tế sớm hơn lịch vẫn giữ nguyên trong sessionData để
                // đối soát, nhưng phần tính/hiển thị của chip phải bám giờ bắt đầu
                // của chip. Ví dụ check-in 13:29 cho ca 13:30 thì tính từ 13:30.
                const _effectiveActualStartR = actualStart && actualStart < schedStart
                    ? schedStart
                    : actualStart;
                const _recepWinStart = matchedSession.isAdminEdited ? _effectiveActualStartR : schedStart;
                const _recepWinEnd = matchedSession.isAdminEdited
                    ? logicalEndR
                    : logicalSchedEndR;
                _daySegments = buildCrossRoleDaySegments(
                    _recepWinStart,
                    _recepWinEnd,
                    teachingShifts,
                    _ry,
                    _rm,
                    _rd,
                    _crossRoleChain?.inferredFromSchedule ? _crossRoleChain.missingSegments : []
                );
                const overlappingTeachingMinutes = _daySegments
                    .filter(seg => seg.kind === 'day')
                    .reduce((sum, seg) => sum + seg.minutes, 0);
                const inferredMissingTeachingMinutes = _crossRoleChain?.inferredFromSchedule
                    ? _crossRoleChain.missingSegments.reduce((sum, seg) => {
                        const missingStart = _toCrossRoleDate(seg.start);
                        const missingEnd = _toCrossRoleDate(seg.end);
                        return sum + (missingStart && missingEnd
                            ? Math.max(0, Math.round((missingEnd - missingStart) / 60000))
                            : 0);
                    }, 0)
                    : 0;
                // The inferred schedule gap is reserved for teaching in the
                // combined work window, but is not paid as teaching. Subtract
                // it from the receptionist side to preserve the original
                // total until the missing attendance is explicitly restored.
                minutes = Math.max(0, minutes - overlappingTeachingMinutes - inferredMissingTeachingMinutes);

                const actualStartStr = actualStart ? actualStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '??:??';
                const actualEndStr = actualEnd ? actualEnd.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '??:??';

                if (matchedSession.isAdminEdited) {
                    const fullActualMinutes = Math.max(0, Math.round((logicalEndR - _effectiveActualStartR) / 60000));
                    minutes = Math.max(0, fullActualMinutes - overlappingTeachingMinutes - inferredMissingTeachingMinutes);
                    const displayActualStartStr = _effectiveActualStartR
                        ? _effectiveActualStartR.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                        : actualStartStr;
                    const displayActualEndStr = logicalEndR
                        ? logicalEndR.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                        : actualEndStr;
                    label = `${labelShort} ${displayActualStartStr}–${displayActualEndStr}${branchShortR}`;
                    
                    // Ghi chú đi trễ kể cả khi admin đã sửa
                    if (actualStart > schedStart) {
                        const lateMinutesRaw = Math.round((actualStart - schedStart) / 60000);
                        if (lateMinutesRaw > 0) {
                            isLate = true;
                            label += ` (T${lateMinutesRaw}p)`;
                        }
                    } else if (actualStart < schedStart) {
                        const earlyMins = Math.round((schedStart - actualStart) / 60000);
                        if (earlyMins > 0) {
                            tooltip += ` | Vào sớm ${earlyMins}p`;
                        }
                    }

                    // Ghi chú về sớm kể cả khi admin đã sửa
                    if (actualEnd < schedEnd) {
                        const earlyCheckoutMins = Math.round((schedEnd - actualEnd) / 60000);
                        if (earlyCheckoutMins > 0) {
                            label += ` (V${earlyCheckoutMins}p)`;
                        }
                    }

                    // Hiển thị nếu ra muộn vượt ca kể cả khi admin đã sửa
                    if (actualEnd > schedEnd) {
                        const overMins = Math.round((actualEnd - schedEnd) / 60000);
                        tooltip += ` | Ra muộn ${overMins}p`;
                    }
                } else {
                    if (_crossRoleChain) {
                        const displayStartR = schedStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                        label = `${labelShort} ${displayStartR}–${_crossRoleChain.endText}${branchShortR}`;
                    }
                    // Ghi chú đi trễ
                    if (actualStart > schedStart) {
                        const lateMinutesRaw = Math.round((actualStart - schedStart) / 60000);
                        if (lateMinutesRaw > 0) {
                            isLate = true;
                            label += ` (T${lateMinutesRaw}p)`;
                        }
                    } else if (actualStart < schedStart) {
                        const earlyMins = Math.round((schedStart - actualStart) / 60000);
                        if (earlyMins > 0) {
                            tooltip += ` | Vào sớm ${earlyMins}p`;
                        }
                    }

                    // Ghi chú về sớm
                    if (actualEnd < schedEnd) {
                        const earlyCheckoutMins = Math.round((schedEnd - actualEnd) / 60000);
                        if (earlyCheckoutMins > 0) {
                            label += ` (V${earlyCheckoutMins}p)`;
                        }
                    }

                    // Hiển thị nếu ra muộn vượt ca (chỉ tham khảo, không tính lương)
                    if (actualEnd > schedEnd) {
                        const overMins = Math.round((actualEnd - schedEnd) / 60000);
                        tooltip += ` | Ra muộn ${overMins}p`;
                    }
                }

                // TRẦN AN TOÀN cho ca tiếp tân: không tính quá giờ lịch ca (đã theo chuỗi gộp) + biên 60p.
                // Chặn ca admin sửa giờ rộng bất thường làm phồng tổng giờ. Tăng ca duyệt cộng RIÊNG bên dưới.
                const _maxRecepMinutes = schedDuration + 60;
                if (minutes > _maxRecepMinutes) {
                    minutes = Math.max(0, Math.round(_maxRecepMinutes));
                    tooltip += ` | Đã giới hạn theo giờ lịch (chống tính dư)`;
                }

                // Force receptionist role details on the cloned chip session data (Issue 2)
                chipSessionData.role = 'tiep-tan';
                chipSessionData.roleName = 'Tiếp Tân';
                if (currentUserContext?.salary_config?.receptionist_normal_rate) {
                    chipSessionData.roleRate = Number(currentUserContext.salary_config.receptionist_normal_rate);
                }

                // Auto-assign: ca khớp lịch tiếp tân → tự động gán 'tiep-tan'
                if (!matchedSession.role) {
                    matchedSession.role = 'tiep-tan';
                    matchedSession.roleName = 'Tiếp Tân';
                    matchedSession._autoAssignedRole = true; // Flag để auto-save sau
                }
                const _displayRoleNameR = chipSessionData.roleName || chipSessionData.role;
                label += ` (${_displayRoleNameR})`;
                tooltip += ` - Vai trò: ${_displayRoleNameR}`;

                // Tiếp Tân role: lấy rate từ receptionist config
                if (chipSessionData.role === 'tiep-tan' || chipSessionData.role === 'receptionist') {
                    if (currentUserContext?.salary_config?.receptionist_normal_rate) {
                        chipSessionData.roleRate = Number(currentUserContext.salary_config.receptionist_normal_rate);
                    }
                } else if (currentUserContext && currentUserContext.salary_config && currentUserContext.salary_config.roles) {
                    const _cfgRolesR = currentUserContext.salary_config.roles;
                    const foundRoleR = _cfgRolesR.find(r => r.id === chipSessionData.role);
                    if (foundRoleR) chipSessionData.roleRate = foundRoleR.rate;
                }

                // BONUS 10P (từ request được duyệt)
                if (b10StatusR === 'approved' || matchedSession.bonus10) {
                    if (early10PenaltyActive) {
                        label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p (hủy)';
                        tooltip += ` | Thưởng 10p bị khóa vì có ca bị từ chối trong tháng`;
                    } else {
                        minutes += 10;
                        label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p';
                        tooltip += ` | Thưởng 10p (đã duyệt)`;
                    }
                } else if (b10StatusR === 'pending') {
                    label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '?';
                    tooltip += ` | Yêu cầu Sớm 10p đang chờ duyệt`;
                }

                if (isLate) {
                    cssClass = 'chip-orange';
                } else {
                    cssClass = 'chip-green';
                }

                tooltip += ' - Đã chấm công đầy đủ';
                isClickable = true;

            } else {
                // === NO CHECK-OUT (Quên ra ca) ===
                const actualStartNoCO = safeDate(matchedSession.checkIn || matchedSession.start);
                const actualStartStrNoCO = actualStartNoCO ? actualStartNoCO.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '??:??';

                // Check if this is a past day
                const todayStrR = typeof getLocalDateKey === 'function' ? getLocalDateKey(now) : now.toISOString().split('T')[0];
                const isPastDayR = dateStr < todayStrR;

                if (isPastDayR || now > schedEnd) {
                    minutes = schedDuration;

                    // Subtract overlapping teaching minutes! (Issue 1) — xem chú thích ở nhánh có giờ ra
                    const teachingShifts = teachingSessionsMap[matchedSession.id] || [];
                    _daySegments = buildCrossRoleDaySegments(
                        schedStart, schedEnd, teachingShifts, _ry, _rm, _rd
                    );
                    const overlappingTeachingMinutes = _daySegments
                        .filter(seg => seg.kind === 'day')
                        .reduce((sum, seg) => sum + seg.minutes, 0);
                    minutes = Math.max(0, minutes - overlappingTeachingMinutes);

                    cssClass = 'chip-green';
                    tooltip += ' - Tự ra ca (Tính đủ giờ theo ca)';
                    isClickable = true;
                } else {
                    minutes = 0;
                    cssClass = 'chip-blue';
                    label += ` (Đang làm)`;
                    tooltip += ` - Đang trong ca | Vào: ${actualStartStrNoCO}`;
                }

                // Force receptionist role details on the cloned chip session data (Issue 2)
                chipSessionData.role = 'tiep-tan';
                chipSessionData.roleName = 'Tiếp Tân';
                if (currentUserContext?.salary_config?.receptionist_normal_rate) {
                    chipSessionData.roleRate = Number(currentUserContext.salary_config.receptionist_normal_rate);
                }
            }

            // Ngày vừa trực vừa dạy: ghi rõ ngay trên chip là đã trừ mấy giờ dạy, để admin/nhân
            // viên không tưởng "ca 07:00–11:00 mà chỉ được 2h30 là hệ thống tính thiếu".
            const _teachingSegs = _daySegments.filter(seg => seg.kind === 'day');
            if (_teachingSegs.length > 0) {
                const _tMin = _teachingSegs.reduce((sum, seg) => sum + seg.minutes, 0);
                const _tH = Math.floor(_tMin / 60), _tM = _tMin % 60;
                const _tStr = _tH > 0 ? `${_tH}h${_tM > 0 ? _tM + 'p' : ''}` : `${_tM}p`;
                label += ` (−${_tStr} dạy)`;
                tooltip += ` | Ngày làm 2 chức năng: đã trừ ${_tStr} giờ dạy (${_teachingSegs.map(s => `${s.start}–${s.end} ${s.label}`).join(', ')}) — phần dạy tính ở chip riêng`;
            }

            if (_crossRoleChain && _daySegments.length > 1) {
                const relatedSessionIds = [matchedSession.id, ..._crossRoleChain.sessionIds];
                relatedSessionIds.forEach(id => {
                    crossRoleDaySegmentsBySession[String(id)] = _daySegments;
                });
                tooltip += ' | Hệ thống nhận diện chuỗi tiếp tân → dạy liên tục từ các phiên chấm công riêng';
                if (_crossRoleChain.inferredFromSchedule && _crossRoleChain.missingSegments?.length) {
                    const missingMinutes = _crossRoleChain.missingSegments.reduce((sum, seg) => {
                        const start = _toCrossRoleDate(seg.start);
                        const end = _toCrossRoleDate(seg.end);
                        return sum + (start && end ? Math.max(0, Math.round((end - start) / 60000)) : 0);
                    }, 0);
                    const missingHours = Math.floor(missingMinutes / 60);
                    const missingRemainder = missingMinutes % 60;
                    const missingText = missingHours > 0
                        ? `${missingHours}h${missingRemainder > 0 ? missingRemainder + 'p' : ''}`
                        : `${missingRemainder}p`;
                    tooltip += ` | Lịch còn ${missingText} chưa có phiên chấm công thực tế; không tính lương phần này`;
                }
            }

            // === OVERTIME INTEGRATION (Receptionist) ===
            const sessionKeyR = String(matchedSession.id);
            const otDataR = overtimeMap[sessionKeyR];
            let otMinutesR = 0;
            let otPendingR = false;
            let otIdR = null;
            if (otDataR) {
                otIdR = otDataR.id;
                if (otDataR.status === 'approved') {
                    otMinutesR = otDataR.minutes || 0;
                    label += ' ' + window.getIconHtml('clock', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+' + otDataR.duration;
                } else if (otDataR.status === 'pending') {
                    otPendingR = true;
                    label += ' ' + window.getIconHtml('clock', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '?';
                }
            }

            chips.push({
                text: label,
                class: cssClass,
                paidMinutes: Math.max(0, Math.round(minutes + otMinutesR)),
                tooltip: tooltip,
                sessionId: matchedSession.id,
                sessionData: chipSessionData, // Use cloned chipSessionData
                isClickable: isClickable,
                isReceptionist: true,
                isAdminEdited: !!(matchedSession && matchedSession.isAdminEdited),
                chipFilterName: normalizeChipFilterName(rs.label ? 'Tiếp Tân (' + rs.label + ')' : 'Tiếp Tân'),
                classCompositeKey: compositeKeyLocal,
                classSectionKey: rs.shift,
                classIndex: dayKeyLocal,
                overtimeId: otIdR,
                overtimePending: otPendingR,
                overtimeMinutes: otMinutesR,
                isFixedShift: rs.isFixedShift,
                mergedSegments: rs.mergedSegments || null,
                allSubShifts: _fullSubShifts, // full danh sách ca con gốc (cho ô sửa tách ca)
                splitAbsentStarts: _splitAbsentStartsForChip, // ca con đang bị coi là vắng (auto/tay)
                daySegments: _daySegments, // các khúc trong ngày: tiếp tân / dạy (popup sửa hiển thị)
                bonus10Status: b10StatusR,
                bonus10Id: b10DataR ? b10DataR.id : null
            });

        } else {
            // === NO ATTENDANCE FOR THIS SHIFT ===
            // Hide receptionist absent chip if it overlaps with a VĐX teaching shift
            const hasOverlapWithVDX = vdxSlots.some(vdx => rs.start < vdx.end && rs.end > vdx.start);
            if (hasOverlapWithVDX) {
                return;
            }

            if (isCenterClosed(dateStr, rs.shift, window.centerClosures)) {
                chips.push({
                    text: label + ' (Nghỉ)',
                    class: 'chip-gray',
                    paidMinutes: 0,
                    tooltip: 'Trung tâm cho nghỉ (tắt ca)',
                    sessionId: null,
                    isClickable: false,
                    isCenterOff: true,
                    isReceptionist: true,
                    chipFilterName: normalizeChipFilterName(rs.label ? 'Tiếp Tân (' + rs.label + ')' : 'Tiếp Tân'),
                    classCompositeKey: compositeKeyLocal,
                    classSectionKey: rs.shift,
                    classIndex: dayKeyLocal,
                    isFixedShift: rs.isFixedShift
                });
            } else {
                // Check if this shift was explicitly cancelled (marked absent on receptionist schedule)
                const isShiftCancelled = cancelledShifts.includes(`${compositeKeyLocal}_${rs.shift}_${dayKeyLocal}`);

                if (isShiftCancelled) {
                    chips.push({
                        text: label + ' (V)',
                        class: 'chip-gray',
                        paidMinutes: 0,
                        tooltip: 'Ca tiếp tân - Vắng (Đã báo vắng)',
                        sessionId: null,
                        schedData: { start: rs.start, end: rs.end },
                        isClickable: true,
                        isWarning: false, // Excused absence
                        isReceptionist: true,
                        chipFilterName: normalizeChipFilterName(rs.label ? 'Tiếp Tân (' + rs.label + ')' : 'Tiếp Tân'),
                        classCompositeKey: compositeKeyLocal,
                        classSectionKey: rs.shift,
                        classIndex: dayKeyLocal,
                        isFixedShift: rs.isFixedShift,
                        isCancelled: true
                    });
                } else {
                    // FIX: So sánh chuỗi ngày thay vì Date object để tránh lỗi timezone
                    const todayStrShift = typeof getLocalDateKey === 'function' ? getLocalDateKey(now) : now.toISOString().split('T')[0];
                    const nowTimeStrShift = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
                    const isFutureDateShift = dateStr > todayStrShift;
                    const isTodayFutureTimeShift = (dateStr === todayStrShift) && (rs.start > nowTimeStrShift);

                    if (isFutureDateShift || isTodayFutureTimeShift) {
                        // Ca chưa diễn ra → hiện (ST) để tiếp tân thấy lịch sắp tới
                        chips.push({
                            text: label + ' (ST)',
                            class: 'chip-future',
                            paidMinutes: 0,
                            tooltip: `Ca tiếp tân sắp tới - ${rs.label} (${rs.start}–${rs.end})`,
                            sessionId: null,
                            schedData: { start: rs.start, end: rs.end },
                            isClickable: false,
                            isReceptionist: true,
                            chipFilterName: normalizeChipFilterName(rs.label ? 'Tiếp Tân (' + rs.label + ')' : 'Tiếp Tân'),
                            classCompositeKey: compositeKeyLocal,
                            classSectionKey: rs.shift,
                            classIndex: dayKeyLocal,
                            isFixedShift: rs.isFixedShift
                        });
                    } else {
                        chips.push({
                            text: label + ' (V)',
                            class: 'chip-gray',
                            paidMinutes: 0,
                            tooltip: 'Ca tiếp tân - Không có dữ liệu chấm công (Vắng)',
                            sessionId: null,
                            schedData: { start: rs.start, end: rs.end },
                            isClickable: true,
                            isWarning: true,
                            isReceptionist: true,
                            chipFilterName: normalizeChipFilterName(rs.label ? 'Tiếp Tân (' + rs.label + ')' : 'Tiếp Tân'),
                            classCompositeKey: compositeKeyLocal,
                            classSectionKey: rs.shift,
                            classIndex: dayKeyLocal,
                            isFixedShift: rs.isFixedShift
                        });
                    }
                }
            }
        }
    });

    // 4. Handle Unmatched Sessions
    attendanceSessions.forEach(s => {
        const isUsedForTeaching = usedSessionIdsTeaching.has(s.id);
        if (!usedSessionIdsReceptionist.has(s.id) && (!isUsedForTeaching || hasReceptionistRole)) {
            usedSessionIdsReceptionist.add(s.id);
            
            const chipSessionData = { ...s };

            // Auto-assign role if role is not set
            if (!chipSessionData.role) {
                let autoRole = null;
                let autoRoleName = null;
                let autoRoleRate = 0;

                const teachingRoles = currentUserContext?.salary_config?.roles || [];

                if (hasReceptionistRole && !hasTeachingRole) {
                    autoRole = 'tiep-tan';
                    autoRoleName = 'Tiếp Tân';
                } else if (chipSessionData.linkedReceptionistShift) {
                    autoRole = 'tiep-tan';
                    autoRoleName = 'Tiếp Tân';
                } else if (chipSessionData.linkedClassStart) {
                    // Try to find matching class in schedule to assign its subject role
                    let matchedClass = null;
                    sections.forEach(secKey => {
                        (schedule[secKey] || []).forEach(cls => {
                            if (cls.start === chipSessionData.linkedClassStart) {
                                matchedClass = cls;
                            }
                        });
                    });

                    if (matchedClass) {
                        const targetLopId = matchedClass.lopId;
                        const matchedRole = teachingRoles.find(r => r.id === targetLopId);
                        if (matchedRole) {
                            autoRole = matchedRole.id;
                            autoRoleName = matchedRole.name;
                            autoRoleRate = Number(matchedRole.rate || 0);
                        } else if (targetLopId) {
                            autoRole = targetLopId;
                            autoRoleName = matchedClass.lop || 'Môn học';
                        }
                    }
                }

                // Fallback to single configured teaching role if they only have one
                if (!autoRole && teachingRoles.length === 1) {
                    autoRole = teachingRoles[0].id;
                    autoRoleName = teachingRoles[0].name;
                    autoRoleRate = Number(teachingRoles[0].rate || 0);
                }

                if (autoRole) {
                    if (autoRole === 'tiep-tan' || autoRole === 'receptionist') {
                        if (currentUserContext?.salary_config?.receptionist_normal_rate) {
                            autoRoleRate = Number(currentUserContext.salary_config.receptionist_normal_rate);
                        }
                    }
                    chipSessionData.role = autoRole;
                    chipSessionData.roleName = autoRoleName;
                    chipSessionData.roleRate = autoRoleRate;
                    chipSessionData._autoAssignedRole = true;

                    s.role = autoRole;
                    s.roleName = autoRoleName;
                    s.roleRate = autoRoleRate;
                    s._autoAssignedRole = true;
                }
            }

            if (s.isAbsent) {
                const isChipReceptionist = (chipSessionData.role === 'tiep-tan');
                const unmatchedChipFilterName = isChipReceptionist ? 'tiep-tan' : (chipSessionData.role || 'giao-vien');
                
                chips.push({
                    text: `${chipSessionData.roleName || 'Ca làm'} (Vắng)`,
                    class: 'chip-gray',
                    paidMinutes: 0,
                    tooltip: 'Admin đánh dấu vắng mặt',
                    sessionId: s.id,
                    sessionData: chipSessionData,
                    isClickable: true,
                    isAdminEdited: !!s.isAdminEdited,
                    isReceptionist: isChipReceptionist,
                    isTeaching: !isChipReceptionist,
                    studentCount: chipSessionData.studentCount || null,
                    studentCountStatus: chipSessionData.studentCountStatus || null,
                    chipFilterName: normalizeChipFilterName(unmatchedChipFilterName)
                });
                return;
            }

            const isAdminCreated = (s.type === 'admin_add' || s.type === 'manual');
            let label = isAdminCreated ? 'Ca Thêm' : 'Ca Ngoài Lịch';
            let duration = 0;
            let cssClass = 'chip-orange';
            let isClickable = false;
            let isUnmatchedWarning = true;

            const sessionStart = safeDate(s.checkIn || s.start);
            const startStr = sessionStart ? sessionStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '??:??';
            let tooltip = isAdminCreated
                ? `Admin đã thêm ca này thủ công (Vào: ${startStr})`
                : `Chấm công không khớp lịch (Vào ca: ${startStr})`;
            if (!sessionStart) { // Dữ liệu lỗi — bỏ qua session này
                console.warn('[evaluation-service] Skipping session with invalid checkIn:', s.id);
                return;
            }

            // FIX: Tìm ca/lớp gần nhất trong lịch để tính giờ sớm/trễ đúng
            // (session không khớp lịch vẫn có thể gần một ca — hiển thị theo giờ lịch)
            let nearestSchedStart = null, nearestSchedEnd = null, nearestDiff = Infinity;
            if (!isAdminCreated) {
                const [_uy, _um, _ud] = dateStr.split('-').map(Number);
                // Kiểm tra lớp học
                sections.forEach(sec => {
                    (schedule[sec] || []).forEach(cls => {
                        if (!cls.start || !cls.end) return; // skip malformed rows
                        const [_cH, _cM] = cls.start.split(':').map(Number);
                        const csStart = new Date(_uy, _um - 1, _ud, _cH, _cM, 0, 0);
                        const diff = Math.abs(sessionStart - csStart);
                        if (diff < nearestDiff) {
                            nearestDiff = diff;
                            nearestSchedStart = csStart;
                            const [_eH, _eM] = cls.end.split(':').map(Number);
                            nearestSchedEnd = new Date(_uy, _um - 1, _ud, _eH, _eM, 0, 0);
                        }
                    });
                });
                // Kiểm tra ca tiếp tân
                receptionistShifts.forEach(rs => {
                    if (!rs.start || !rs.end) return;
                    const [_rH, _rM] = rs.start.split(':').map(Number);
                    const rsStart = new Date(_uy, _um - 1, _ud, _rH, _rM, 0, 0);
                    const diff = Math.abs(sessionStart - rsStart);
                    if (diff < nearestDiff) {
                        nearestDiff = diff;
                        nearestSchedStart = rsStart;
                        const [_reH, _reM] = rs.end.split(':').map(Number);
                        nearestSchedEnd = new Date(_uy, _um - 1, _ud, _reH, _reM, 0, 0);
                    }
                });
            }
            // Dùng lịch gần nhất nếu trong vòng 90 phút
            const USE_SCHED = !isUsedForTeaching && !isAdminCreated && !s.isAdminEdited && nearestSchedStart && nearestDiff < 90 * 60 * 1000;

            let b10DataU, b10StatusU;

            // Ca tự-đóng (autoClosedReason='stale_session') GIỜ ĐÃ được khép đúng theo giờ tan
            // ca/lớp trong lịch, nên vẫn là giờ ra HỢP LỆ. Trước đây khối này loại luôn mọi ca
            // stale → chip hiện "10:24–???" (cam, cảnh báo) dù ca đó đã có giờ ra 16:30 và đã
            // được tính đủ ở chip xanh → nhân viên hoang mang "vừa đúng vừa sai".
            // Chỉ ca bị khép về 23:59 (không dò được lịch) mới coi là "quên check-out".
            if (s.checkOut && !s.checkOut.includes('T23:59:00')) {
                const sessionEnd = safeDate(s.checkOut);
                const endStr = sessionEnd ? sessionEnd.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '??:??';

                // === ẨN CA BẤM NHẦM ===
                // Session vào ≈ ra (≤ 2 phút) là bấm nhầm/bấm trùng (VD "14:00–14:00", "18:00–18:01").
                // Quy tắc <10 phút bên dưới vốn đã cho 0 phút lương nên ẩn chip KHÔNG đổi tổng giờ/lương,
                // chỉ dọn rác khỏi bảng công. Không đụng ca admin thêm/sửa tay, và ca "quên check-out"
                // (không có checkOut) vẫn giữ để admin theo dõi.
                if (!isAdminCreated && !s.isAdminEdited && sessionEnd &&
                    (sessionEnd - sessionStart) <= 2 * 60 * 1000) {
                    return;
                }

                // Khoảng giờ được trả công của chip ngoài lịch này (chặn tính trùng khung giờ)
                let _uPaidFrom = null, _uPaidTo = null;

                // === GIỜ RA ≤ GIỜ VÀO (dữ liệu hỏng) ===
                // Ca admin thêm/sửa tay hoặc chấm bù bị gõ ngược giờ (VD vào 15:30, ra 15:16)
                // trước đây vẫn chạy tiếp và in nhãn "15:30–15:16" — người xem tưởng phần mềm
                // lỗi, còn ca thì lặng lẽ 0 phút không ai biết vì sao. Nay ghi rõ để admin sửa.
                if (sessionEnd && sessionEnd <= sessionStart) {
                    duration = 0;
                    cssClass = 'chip-orange';
                    isUnmatchedWarning = true;
                    isClickable = true;
                    const _roleSuffixInv = chipSessionData.role
                        ? ` (${chipSessionData.roleName || chipSessionData.role})`
                        : '';
                    label = `${startStr}–${endStr}${_roleSuffixInv} (Giờ ra ≤ giờ vào)`;
                    tooltip = `Giờ ra (${endStr}) không sau giờ vào (${startStr}) — dữ liệu ca bị sai, ` +
                        `không tính được phút làm. Bấm để sửa lại giờ cho ca này.`;
                } else if (USE_SCHED) {
                    // Tính sớm/trễ theo giờ lịch
                    const diffToSched = sessionStart - nearestSchedStart; // + = trễ, - = sớm
                    const schedStartStr = nearestSchedStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    // Mốc đầu HIỂN THỊ trên chip. Ca kết thúc trước cả giờ vào lịch (bấm nhầm vài
                    // phút) mà lấy giờ lịch làm mốc thì ra khoảng ngược "15:30–15:16" → dùng giờ
                    // vào thực tế cho nhãn, tooltip vẫn ghi giờ lịch để đối chiếu.
                    const dispStartStr = sessionEnd <= nearestSchedStart ? startStr : schedStartStr;
                    const effectiveEnd = sessionEnd > nearestSchedEnd ? sessionEnd : nearestSchedEnd;
                    const lateMin = diffToSched >= 60000 ? Math.round(diffToSched / 60000) : 0;
                    const lateSuffix = lateMin > 0 ? ` (T${lateMin}p)` : '';

                    if (lateMin > 0) {
                        // Trễ: tính từ lúc vào thực tế đến cuối ca lịch
                        duration = Math.max(0, (nearestSchedEnd - sessionStart) / 60000);
                        _uPaidFrom = sessionStart; _uPaidTo = nearestSchedEnd;
                        cssClass = 'chip-orange';
                        tooltip = `Vào trễ ${lateMin}p so với lịch (${schedStartStr})`;
                    } else {
                        // Sớm hoặc đúng giờ: tính từ giờ bắt đầu lịch
                        duration = (effectiveEnd - nearestSchedStart) / 60000;
                        _uPaidFrom = nearestSchedStart; _uPaidTo = effectiveEnd;
                        cssClass = 'chip-green'; // Đã checkin+checkout → luôn green dù chưa chọn role
                        tooltip = diffToSched < 0
                            ? `Vào sớm ${Math.round(-diffToSched / 60000)}p (lịch ${schedStartStr})`
                            : `Đúng giờ (${schedStartStr})`;
                    }

                    // Check for invalid/accidental sessions
                    const actualSessionDurationMs = sessionEnd - sessionStart;
                    if (actualSessionDurationMs < 10 * 60 * 1000 || sessionEnd <= nearestSchedStart || sessionStart >= nearestSchedEnd) {
                        duration = 0;
                    }

                    // Subtract teaching minutes (Issue 1)
                    const teachingMins = teachingMinutesMap[s.id] || 0;
                    duration = Math.max(0, duration - teachingMins);

                    if (chipSessionData.role) {
                        const _dnU1 = chipSessionData.roleName || chipSessionData.role;
                        cssClass = lateMin > 0 ? 'chip-orange' : 'chip-green';
                        label = `${dispStartStr}–${endStr}${lateSuffix} (${_dnU1})`;
                        tooltip += ` - Vai trò: ${_dnU1}`;
                        // Rate cho tiếp tân
                        if ((chipSessionData.role === 'tiep-tan' || chipSessionData.role === 'receptionist') && currentUserContext?.salary_config?.receptionist_normal_rate) {
                            chipSessionData.roleRate = Number(currentUserContext.salary_config.receptionist_normal_rate);
                        }
                    } else {
                        cssClass = 'chip-waiting';
                        label = `${dispStartStr}–${endStr}${lateSuffix} (Role?)`;
                        tooltip += ' - Bấm để chọn vai trò tính lương';
                    }
                } else {
                    // Không có ca gần: hiển thị thời gian thực tế (logic cũ)
                    duration = (sessionEnd - sessionStart) / 60000;
                    _uPaidFrom = sessionStart; _uPaidTo = sessionEnd;

                    // Subtract teaching minutes (Issue 1)
                    const teachingMins = teachingMinutesMap[s.id] || 0;
                    duration = Math.max(0, duration - teachingMins);

                    if (chipSessionData.role) {
                        const _dnU2 = chipSessionData.roleName || chipSessionData.role;
                        cssClass = 'chip-green';
                        label = `${startStr}–${endStr} (${_dnU2})`;
                        // Ca được duyệt "trả tháng sau": giờ công vẫn nằm ở tháng này, chỉ
                        // tiền là dồn sang tháng sau — ghi rõ để admin không tưởng thiếu.
                        if (chipSessionData.payoutMonth) {
                            const [_py, _pm] = String(chipSessionData.payoutMonth).split('-');
                            label += ` (trả T${Number(_pm)}/${_py})`;
                            tooltip += ` | Tiền ca này trả vào tháng ${Number(_pm)}/${_py}` +
                                (chipSessionData.payoutReason ? ` — ${chipSessionData.payoutReason}` : '');
                        }
                        tooltip += ` - Vai trò: ${_dnU2}`;
                        // Rate cho tiếp tân
                        if ((chipSessionData.role === 'tiep-tan' || chipSessionData.role === 'receptionist') && currentUserContext?.salary_config?.receptionist_normal_rate) {
                            chipSessionData.roleRate = Number(currentUserContext.salary_config.receptionist_normal_rate);
                        }
                    } else {
                        cssClass = 'chip-waiting';
                        label = `${startStr}–${endStr} (Role?)`;
                        tooltip += ' - Bấm để chọn vai trò tính lương';
                    }
                }

                // === CHẶN TÍNH TRÙNG KHUNG GIỜ ===
                // GV dạy 2 lớp cùng giờ (hoặc 2 phiên chấm bù trùng giờ) sinh 2 chip cùng
                // khung 09:15–10:45; trước đây mỗi chip tính đủ 1h30 nên tổng ngày dôi ra
                // đúng một ca. Khung giờ đã trả công ở chip trước thì chip sau không tính lại.
                const _dupMins = _alreadyPaidMinutes(_uPaidFrom, _uPaidTo, s.id);
                if (_dupMins > 0 && duration > 0) {
                    duration = Math.max(0, duration - _dupMins);
                    label += ' (trùng giờ)';
                    tooltip += ` | Khung giờ này đã được tính công ở ca khác trong ngày ` +
                        `(dạy 2 lớp cùng giờ / ca khai trùng) — không tính lương lần hai.`;
                    isClickable = true;
                }
                // Ca bị trùng hoàn toàn thì cũng KHÔNG được cộng thưởng sớm 10p, nếu không
                // chip 0 phút lại hoá 10 phút và tổng ngày vẫn lệch.
                const _zeroedByDuplicate = _dupMins > 0 && duration === 0;
                if (duration > 0) _addPaidClockRange(_uPaidFrom, _uPaidTo, s.id);

                // TRẦN AN TOÀN cho ca ngoài lịch / ca thêm (chống tính dư do giờ rộng bất thường):
                //  - Có ca gần trong lịch → không quá giờ ca gần + 60p.
                //  - Không có ca gần → chặn ở mức hợp lý tối đa 12h/ca (chắc chắn là dữ liệu lỗi).
                // Tăng ca duyệt & thưởng 10p cộng RIÊNG bên dưới.
                let _maxUnmatched;
                if (USE_SCHED && nearestSchedStart && nearestSchedEnd) {
                    _maxUnmatched = (nearestSchedEnd - nearestSchedStart) / 60000 + 60;
                } else {
                    _maxUnmatched = 12 * 60;
                }
                if (duration > _maxUnmatched) {
                    duration = Math.max(0, Math.round(_maxUnmatched));
                    tooltip += ` | Đã giới hạn (chống tính dư)`;
                }

                // BONUS 10P cho unmatched session
                b10DataU = bonus10Map[String(s.id)];
                b10StatusU = b10DataU ? b10DataU.status : null;
                if (_zeroedByDuplicate) {
                    if (b10StatusU === 'approved' || s.bonus10 || b10StatusU === 'pending') {
                        tooltip += ` | Không cộng thưởng 10p cho ca trùng giờ.`;
                    }
                } else if (b10StatusU === 'approved' || s.bonus10) {
                    if (early10PenaltyActive) {
                        label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p (hủy)';
                        tooltip += ` | Thưởng 10p bị khóa vì có ca bị từ chối trong tháng`;
                    } else {
                        duration += 10;
                        label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p';
                        tooltip += ` | Thưởng 10p (đã duyệt)`;
                    }
                } else if (b10StatusU === 'pending') {
                    label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '?';
                    tooltip += ` | Yêu cầu Sớm 10p đang chờ duyệt`;
                }

                tooltip += ` - Làm việc ${Math.floor(duration / 60)}h${Math.floor(duration % 60)}p`;
                isClickable = true;
            } else {
                // Không có check-out
                const todayStrU = typeof getLocalDateKey === 'function' ? getLocalDateKey(new Date()) : new Date().toISOString().split('T')[0];
                const isPastDayU = dateStr < todayStrU;

                if (isPastDayU) {
                    duration = 0;
                    const roleSuffix = chipSessionData.role ? ` (${chipSessionData.roleName || chipSessionData.role})` : '';
                    label = `${startStr}–???${roleSuffix}`;
                    cssClass = 'chip-orange';
                    tooltip += ' - Quên check-out (ngày đã qua)';
                    isClickable = true;
                    isUnmatchedWarning = true;
                } else {
                    label = `${startStr}–??? (Đang làm)`;
                    cssClass = 'chip-blue';
                }
            }

            // === OVERTIME INTEGRATION (Unmatched sessions) ===
            const sessionKeyU = String(s.id);
            const otDataU = overtimeMap[sessionKeyU];
            let otMinutesU = 0;
            let otPendingU = false;
            let otIdU = null;
            if (otDataU) {
                otIdU = otDataU.id;
                if (otDataU.status === 'approved') {
                    otMinutesU = otDataU.minutes || 0;
                    label += ' ' + window.getIconHtml('clock', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+' + otDataU.duration;
                } else if (otDataU.status === 'pending') {
                    otPendingU = true;
                    label += ' ' + window.getIconHtml('clock', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '?';
                }
            }

            let unmatchedChipFilterName = 'Ca Ngoài Lịch';
            let isChipReceptionist = false;
            if (chipSessionData.role) {
                if (['tiep-tan', 'receptionist', 'receptionist_assistant'].includes(chipSessionData.role)) {
                    unmatchedChipFilterName = 'Tiếp Tân';
                    isChipReceptionist = true;
                } else {
                    unmatchedChipFilterName = chipSessionData.roleName || chipSessionData.role;
                }
            } else if (isAdminCreated) {
                unmatchedChipFilterName = 'Ca Thêm';
            }

            const paidMinutes = Math.max(0, Math.round(duration + otMinutesU));
            // Phiên đã được dùng cho chip ca DẠY: chỉ sinh thêm chip "phần dư" khi thật sự còn
            // thời gian chưa được tính (>=30p, VD sáng dạy xong ở lại trực tiếp tân).
            // `duration` ở đây ĐÃ trừ số phút dạy. Không dùng paidMinutes (đã cộng tăng ca) và
            // KHÔNG miễn trừ cho tăng ca đang chờ duyệt: yêu cầu tăng ca/thưởng 10p vốn đã hiển
            // thị ngay trên chip ca dạy gốc, nên chip dư chỉ là bản sao gây nhiễu bảng công.
            if (isUsedForTeaching && Math.round(duration) < 30) {
                return;
            }

            chips.push({
                text: label,
                class: cssClass,
                paidMinutes: paidMinutes,
                tooltip: tooltip,
                sessionId: s.id,
                sessionData: chipSessionData, // Use cloned chipSessionData
                isClickable: isClickable,
                isWarning: isUnmatchedWarning,
                isAdminCreated: isAdminCreated,
                isAdminEdited: !!s.isAdminEdited,
                isReceptionist: isChipReceptionist,
                isTeaching: !isChipReceptionist,
                studentCount: chipSessionData.studentCount || null,
                studentCountStatus: chipSessionData.studentCountStatus || null,
                chipFilterName: normalizeChipFilterName(unmatchedChipFilterName),
                overtimeId: otIdU,
                overtimePending: otPendingU,
                overtimeMinutes: otMinutesU,
                bonus10Status: b10DataU ? b10DataU.status : null,
                bonus10Id: b10DataU ? b10DataU.id : null
            });
        }
    });

    // NGÀY 2 CHỨC NĂNG: chép bảng chia khúc sang chip ca DẠY cùng phiên, để admin bấm vào bất
    // kỳ chip nào của ngày đó cũng thấy đủ 3 khúc (trực – dạy – trực) trong ô chỉnh sửa.
    {
        const segsBySession = { ...crossRoleDaySegmentsBySession };
        chips.forEach(c => {
            if (c.sessionId && Array.isArray(c.daySegments) && c.daySegments.length > 1) {
                segsBySession[String(c.sessionId)] = c.daySegments;
            }
        });
        chips.forEach(c => {
            if (!c.daySegments && c.sessionId && segsBySession[String(c.sessionId)]) {
                c.daySegments = segsBySession[String(c.sessionId)];
            }
        });
    }

    // FIX 5: Sort chips by start time (morning → evening)
    chips.sort((a, b) => {
        const getTime = (text) => {
            const match = text.match(/(\d{1,2}:\d{2})/);
            if (!match) return '99:99';
            return match[1].padStart(5, '0');
        };
        return getTime(a.text).localeCompare(getTime(b.text));
    });

    return chips;
}

// ================= VIETNAMESE STRING UTILITY =================

function removeVietnameseTones(str) {
    if (!str) return '';
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/o|ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/u|ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/y|ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    // Handle combining accents (unicode normalization)
    str = str.replace(/\u0300|\u0301|\u0303|\u0309|\u0323/g, ""); // ̀ ́ ̃ ̉ ̣ 
    str = str.replace(/\u02C6|\u0306|\u031B/g, ""); // ˆ ̆ ̛  Â, Ê, Ă, Ơ, Ư
    str = str.replace(/ + /g, " ");
    str = str.trim();
    return str;
}

// ================= EXPOSE TO GLOBAL SCOPE =================

window.EVALUATION_CRITERIA = EVALUATION_CRITERIA;
window.calculateDailyChips = calculateDailyChips;
window.removeVietnameseTones = removeVietnameseTones;
