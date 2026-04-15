// evaluation-service.js — Pure Data & Calculation Logic
// Tách từ report.js — Chứa logic tính toán lương, đánh giá, và xử lý dữ liệu thuần túy.
// Không chứa bất kỳ DOM manipulation nào.
//
// Exports (via window):
//   - window.EVALUATION_CRITERIA — Mảng 10 tiêu chí đánh giá
//   - window.calculateDailyChips() — Merge schedule + attendance → chips[]
//   - window.removeVietnameseTones() — Utility xử lý chuỗi tiếng Việt

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
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function mergeAdjacentShifts(shifts) {
    if (!shifts || shifts.length === 0) return shifts;

    const sorted = [...shifts].sort((a, b) => a.start.localeCompare(b.start));
    const merged = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
        const prev = merged[merged.length - 1];
        const curr = sorted[i];

        // Merge nếu: cùng branch VÀ end của prev === start của curr (tuyệt đối)
        if (prev.branch === curr.branch && prev.end === curr.start) {
            merged[merged.length - 1] = {
                ...prev,
                end: curr.end,
                _mergedWith: curr,
                mergedSegments: [
                    ...(prev.mergedSegments || [{
                        start: prev.start,
                        end: prev.end,
                        schedMinutes: timeStrToMin(prev.end) - timeStrToMin(prev.start),
                        isFixedShift: prev.isFixedShift
                    }]),
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

function calculateDailyChips(schedule, attendanceSessions, staffId, dateStr, currentUserContext, receptionistShifts = [], overtimeMap = {}, cancelledShifts = [], bonus10Map = {}) {
    const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
    const chips = [];
    const usedSessionIds = new Set();

    // PRE-PROCESS: xây dựng mergeInfo cho các ca liên tiếp (end ca A = start ca B, cùng branch)
    // mergeInfo["secKey_idx"] = { mergedEnd: string } → ca đầu chuỗi dùng giờ kết thúc mở rộng
    // mergeInfo["secKey_idx"] = { skip: true }         → ca tiếp theo bị bỏ qua (đã được merge vào ca trước)
    const _mergeInfo = {};
    {
        const _allReg = [];
        sections.forEach(sk => {
            (schedule[sk] || []).forEach((c, i) => {
                if (!(c.registeredTeachers || []).some(t => t.id === staffId)) return;
                const ck = c._compositeKey || null;
                if (ck && cancelledShifts.includes(`${ck}_${sk}_${i}`)) return;
                _allReg.push({ start: c.start, end: c.end, branch: c._branch || '', secKey: sk, idx: i });
            });
        });
        _allReg.sort((a, b) => a.start.localeCompare(b.start));
        for (let _mi = 0; _mi < _allReg.length; _mi++) {
            const _a = _allReg[_mi];
            const _ka = `${_a.secKey}_${_a.idx}`;
            if (_mergeInfo[_ka] && _mergeInfo[_ka].skip) continue;
            let _chainEnd = _a.end;
            let _mj = _mi + 1;
            while (_mj < _allReg.length) {
                const _b = _allReg[_mj];
                if (_b.start === _chainEnd && _b.branch === _a.branch) {
                    _mergeInfo[`${_b.secKey}_${_b.idx}`] = { skip: true };
                    _chainEnd = _b.end;
                    _mj++;
                } else break;
            }
            if (_chainEnd !== _a.end) {
                _mergeInfo[_ka] = { mergedEnd: _chainEnd };
            }
        }
    }

    sections.forEach(secKey => {
        const classes = schedule[secKey] || [];
        classes.forEach((cls, idx) => {
            // 1. Check if User Registered via "Nhận Lớp" button
            const registeredTeachers = cls.registeredTeachers || [];
            const isRegistered = registeredTeachers.some(t => t.id === staffId);

            if (!isRegistered) return; // Skip if not registered for this class

            // --- NEW: Check Cancelled Shifts ---
            const classCompositeKey = cls._compositeKey || null;
            if (classCompositeKey && cancelledShifts.includes(`${classCompositeKey}_${secKey}_${idx}`)) {
                return; // Skip this explicitly cancelled shift
            }

            // --- MERGE: bỏ qua ca không phải đầu chuỗi (đã được gộp vào ca trước) ---
            const _mk = `${secKey}_${idx}`;
            if (_mergeInfo[_mk] && _mergeInfo[_mk].skip) return;
            // Giờ kết thúc hiệu dụng: dùng mergedEnd nếu ca này là đầu chuỗi
            const _mergedEnd = (_mergeInfo[_mk] && _mergeInfo[_mk].mergedEnd) || null;

            // 2. Check for Attendance Match
            // Priority 1: Exact match by linkedClassStart (set when admin edits a session)
            // Priority 2: Proximity match within 60 min of class start
            // FIX: dùng local time thay vì ISO string (tránh UTC parse gây lệch 7h)
            const [_sy, _sm, _sd] = dateStr.split('-').map(Number);
            const [_sH, _sM] = cls.start.split(':').map(Number);
            const schedStart = new Date(_sy, _sm - 1, _sd, _sH, _sM, 0, 0);

            let matchedSession = attendanceSessions.find(s => {
                if (usedSessionIds.has(s.id)) return false;
                return s.linkedClassStart === cls.start; // Exact link preserved after admin edit
            });

            if (!matchedSession) {
                matchedSession = attendanceSessions.find(s => {
                    if (usedSessionIds.has(s.id)) return false;
                    if (s.linkedClassStart) return false; // Already linked to another class
                    const checkIn = safeDate(s.checkIn || s.start);
                    if (!checkIn) return false;
                    const diffMs = Math.abs(checkIn - schedStart);
                    return diffMs < 60 * 60 * 1000;
                });
            }

            if (matchedSession) usedSessionIds.add(matchedSession.id);

            // 3. Determine Status
            let minutes = 0;
            let cssClass = 'chip-blue';
            // Branch tag — abbreviated (no brackets)
            const branchTag = cls._branch ? ` [${cls._branch.toUpperCase()}]` : '';
            const branchShort = cls._branch ? ` ${cls._branch.toUpperCase()}` : '';
            const _effectiveEndStr = _mergedEnd || cls.end;
            let label = `${cls.start}–${_effectiveEndStr}${branchShort}`;
            let tooltip = `Lớp ${cls.lop || '?'}${branchTag}`;
            if (_mergedEnd) tooltip += ` (2 ca gộp)`;

            const [_eH, _eM] = _effectiveEndStr.split(':').map(Number);
            const schedEnd = new Date(_sy, _sm - 1, _sd, _eH, _eM, 0, 0);
            const schedDuration = (schedEnd - schedStart) / 60000;
            const now = new Date();

            if (matchedSession) {
                let isClickable = false;
                const b10DataT = bonus10Map[String(matchedSession.id)];
                const b10StatusT = b10DataT ? b10DataT.status : null;

                // --- CASE A: ATTENDED (Has Check-in) ---
                if (matchedSession.checkOut) {
                    // FULL CHECK-IN/OUT
                    const actualStart = safeDate(matchedSession.checkIn || matchedSession.start);
                    const actualEnd = safeDate(matchedSession.checkOut);

                    const diffMs = schedStart - actualStart; // >0 = vào sớm, <0 = trễ

                    const actualStartStr = actualStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

                    // Admin override: nếu checkOut thực tế vượt qua giờ kết thúc ca, dùng actualEnd
                    const effectiveEnd = actualEnd > schedEnd ? actualEnd : schedEnd;
                    const effectiveDuration = (effectiveEnd - schedStart) / 60000;

                    // Cập nhật label: hiển thị giờ ra thực tế nếu admin đã chỉnh vượt lịch
                    if (actualEnd > schedEnd) {
                        const aeH = String(actualEnd.getHours()).padStart(2, '0');
                        const aeM = String(actualEnd.getMinutes()).padStart(2, '0');
                        label = `${cls.start}–${aeH}:${aeM}${branchShort}`;
                    }

                    let isLate = false;
                    if (diffMs < 0) { // Late
                        const lateMinutesRaw = Math.round(Math.abs(diffMs) / 60000);
                        if (lateMinutesRaw === 0) {
                            // Less than 1 minute late → treat as on-time
                            minutes = effectiveDuration;
                        } else {
                            // Tính từ lúc vào thực tế đến effectiveEnd
                            const remainingSched = (effectiveEnd - actualStart) / 60000;
                            minutes = Math.max(0, Math.round(remainingSched));
                            isLate = true;
                        }
                        label += ` (T${lateMinutesRaw}p)`;
                    } else if (diffMs > 0) { // Early — không thưởng tự động
                        minutes = effectiveDuration;
                        const earlyMins = Math.round(diffMs / 60000);
                        tooltip += ` | Vào sớm ${earlyMins}p`;
                    } else { // Exact on-time
                        minutes = effectiveDuration;
                    }

                    // Hiển thị thông tin nếu admin đã chỉnh giờ ra vượt ca
                    if (actualEnd > schedEnd) {
                        const overMins = Math.round((actualEnd - schedEnd) / 60000);
                        tooltip += ` | Ra muộn ${overMins}p (admin đã chỉnh)`;
                    }

                    // Role Logic
                    if (matchedSession.role) {
                        label += ` (${matchedSession.roleName})`;
                        tooltip += ` - Vai trò: ${matchedSession.roleName}`;

                        // Fallback: If roleRate is missing (legacy data), try to find in user config
                        if (!matchedSession.roleRate && currentUserContext && currentUserContext.salary_config && currentUserContext.salary_config.roles) {
                            const foundRole = currentUserContext.salary_config.roles.find(r => r.id === matchedSession.role);
                            if (foundRole) {
                                matchedSession.roleRate = foundRole.rate;
                            }
                        }
                    } else {
                        label += ` (Role?)`;
                        tooltip += ' - Bấm để chọn vai trò tính lương';
                    }

                    // BONUS 10P (từ request được duyệt)
                    if (b10StatusT === 'approved' || matchedSession.bonus10) {
                        minutes += 10;
                        label += ` ⭐+10p`;
                        tooltip += ` | Thưởng 10p (đã duyệt)`;
                    } else if (b10StatusT === 'pending') {
                        label += ` ⭐?`;
                        tooltip += ` | Yêu cầu Sớm 10p đang chờ duyệt`;
                    }

                    // FIX 1: Late → always orange, regardless of role
                    if (isLate) {
                        cssClass = 'chip-orange';
                    } else if (matchedSession.role) {
                        cssClass = 'chip-green';
                    } else {
                        cssClass = 'chip-waiting';
                    }

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

                    if (isPastDay || now > new Date(classEndTime.getTime() + 90 * 60000)) {
                        minutes = schedDuration;
                        cssClass = 'chip-orange';
                        label += ' (QR)';
                        tooltip += ' - Quên Check-out (Tính đủ giờ)';
                        isClickable = true;
                    } else {
                        minutes = 0;
                        cssClass = 'chip-blue';
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
                        label += ` ⏱️+${otData.duration}`;
                    } else if (otData.status === 'pending') {
                        otPending = true;
                        label += ` ⏱️?`;
                    }
                }

                chips.push({
                    text: label,
                    class: cssClass,
                    paidMinutes: Math.max(0, Math.round(minutes + otMinutes)),
                    tooltip: tooltip,
                    sessionId: matchedSession.id,
                    sessionData: matchedSession,
                    isClickable: isClickable,
                    isTeaching: true,
                    classStart: cls.start, // Store original class start for edit-match preservation
                    classEnd: cls.end,
                    classCompositeKey: cls._compositeKey || null,
                    classSectionKey: secKey,
                    classIndex: idx,
                    overtimeId: otId,
                    overtimePending: otPending,
                    overtimeMinutes: otMinutes,
                    bonus10Status: b10StatusT,
                    bonus10Id: b10DataT ? b10DataT.id : null
                });

            } else {
                // --- CASE B: NO ATTENDANCE ---
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
                        text: label,
                        class: 'chip-future',
                        paidMinutes: 0,
                        tooltip: `Đã nhận lớp - chờ chấm công | Lớp ${cls.lop || '?'}${branchTag}`,
                        sessionId: null,
                        schedData: { start: cls.start, end: cls.end, lop: cls.lop, phong: cls.phong },
                        isClickable: false,
                        isTeaching: true,
                        classStart: cls.start,
                        classEnd: cls.end,
                        classCompositeKey: cls._compositeKey || null,
                        classSectionKey: secKey,
                        classIndex: idx,
                        isScheduledOnly: true
                    });
                } else {
                    chips.push({
                        text: label + ' (V)',
                        class: 'chip-gray',
                        paidMinutes: 0,
                        tooltip: 'Không có dữ liệu chấm công (Vắng)',
                        sessionId: null,
                        schedData: { start: cls.start, end: cls.end },
                        isClickable: true,
                        isWarning: true,
                        isTeaching: true,
                        classStart: cls.start,
                        classEnd: cls.end,
                        classCompositeKey: cls._compositeKey || null,
                        classSectionKey: secKey,
                        classIndex: idx
                    });
                }
            }
        });
    });

    // ==================== RECEPTIONIST SHIFTS ====================
    // Process receptionist schedule shifts (from lich-tiep-tan.html)
    // receptionistShifts = [{ shift: 'morning', label: 'SÁNG', start: '07:00', end: '11:30' }, ...]

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
        const schedStart = new Date(_ry, _rm - 1, _rd, parseInt(startParts[0], 10), parseInt(startParts[1], 10), 0, 0);
        const schedEnd = new Date(_ry, _rm - 1, _rd, parseInt(endParts[0], 10), parseInt(endParts[1], 10), 0, 0);

        if (isNaN(schedStart.getTime()) || isNaN(schedEnd.getTime())) return;

        const schedDuration = (schedEnd - schedStart) / 60000;
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

        // --- NEW: Check Cancelled Shifts ---
        if (cancelledShifts.includes(`${compositeKeyLocal}_${rs.shift}_${dayKeyLocal}`)) {
            return; // Skip this explicitly cancelled shift
        }


        // Find matching attendance session
        const matchedSession = attendanceSessions.find(s => {
            if (usedSessionIds.has(s.id)) return false;
            const checkIn = safeDate(s.checkIn || s.start);
            if (!checkIn) return false;

            if (rs.isFixedShift) {
                // Ca Cố Định: Sử dụng logic bao trùm khung giờ
                if (s.checkOut) {
                    const checkOut = safeDate(s.checkOut);
                    if (!checkOut) return false;
                    return checkIn <= schedEnd && checkOut >= schedStart;
                } else {
                    // Session đang mở (chưa checkout): match nếu checkIn trong khung ±90p
                    const earlyLimit = new Date(schedStart.getTime() - 90 * 60 * 1000);
                    return checkIn >= earlyLimit && checkIn <= schedEnd;
                }
            } else {
                // Ca thường: Match nếu check-in nằm trong khoảng (schedStart - 90 phút) đến schedEnd
                const earlyLimit = new Date(schedStart.getTime() - 90 * 60 * 1000);
                return checkIn >= earlyLimit && checkIn <= schedEnd;
            }
        });

        if (matchedSession) {
            usedSessionIds.add(matchedSession.id);

            let minutes = 0;
            let cssClass = 'chip-blue';
            let isClickable = false;
            let isLate = false;

            const b10DataR = bonus10Map[String(matchedSession.id)];
            const b10StatusR = b10DataR ? b10DataR.status : null;

            if (matchedSession.checkOut) {
                // === HAS CHECK-OUT ===
                const actualStart = safeDate(matchedSession.checkIn || matchedSession.start);
                const actualEnd = safeDate(matchedSession.checkOut);
                const diffMs = actualStart ? (schedStart - actualStart) : 0;
                const actualStartStr = actualStart ? actualStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '??:??';

                // Giờ tính luôn theo lịch, không tính thêm nếu ra muộn hơn lịch
                const effectiveEndR = schedEnd;
                const effectiveDurationR = (effectiveEndR - schedStart) / 60000;

                // Label luôn hiển thị giờ theo lịch (không đổi khi ra muộn)
                // Thông tin ra muộn sẽ hiện trong tooltip bên dưới

                if (diffMs < 0) {
                    // Late
                    const lateMinutesRaw = Math.round(Math.abs(diffMs) / 60000);
                    if (lateMinutesRaw === 0) {
                        minutes = effectiveDurationR;
                    } else {
                        const remainingSched = (effectiveEndR - actualStart) / 60000;
                        minutes = Math.max(0, Math.round(remainingSched));
                        isLate = true;
                    }
                    label += ` (T${lateMinutesRaw}p)`;
                } else if (diffMs > 0) { // Early — không thưởng tự động
                    minutes = effectiveDurationR;
                    const earlyMins = Math.round(diffMs / 60000);
                    tooltip += ` | Vào sớm ${earlyMins}p`;
                } else {
                    minutes = effectiveDurationR;
                }

                // Hiển thị nếu admin đã chỉnh giờ ra vượt ca
                if (actualEnd > schedEnd) {
                    const overMins = Math.round((actualEnd - schedEnd) / 60000);
                    tooltip += ` | Ra muộn ${overMins}p (admin đã chỉnh)`;
                }

                // Role Logic for receptionist
                if (matchedSession.role) {
                    label += ` (${matchedSession.roleName})`;
                    tooltip += ` - Vai trò: ${matchedSession.roleName}`;

                    if (!matchedSession.roleRate && currentUserContext && currentUserContext.salary_config && currentUserContext.salary_config.roles) {
                        const foundRole = currentUserContext.salary_config.roles.find(r => r.id === matchedSession.role);
                        if (foundRole) {
                            matchedSession.roleRate = foundRole.rate;
                        }
                    }
                } else {
                    label += ` (Role?)`;
                    tooltip += ' - Bấm để chọn vai trò tính lương';
                }

                // BONUS 10P (từ request được duyệt)
                if (b10StatusR === 'approved' || matchedSession.bonus10) {
                    minutes += 10;
                    label += ` ⭐+10p`;
                    tooltip += ` | Thưởng 10p (đã duyệt)`;
                } else if (b10StatusR === 'pending') {
                    label += ` ⭐?`;
                    tooltip += ` | Yêu cầu Sớm 10p đang chờ duyệt`;
                }

                if (isLate) {
                    cssClass = 'chip-orange';
                } else if (matchedSession.role) {
                    cssClass = 'chip-green';
                } else {
                    cssClass = 'chip-waiting';
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
                    cssClass = 'chip-orange';
                    label += ' (QR)';
                    tooltip += ' - Quên Ra Ca (Tính đủ giờ theo ca)';
                    isClickable = true;
                } else {
                    minutes = 0;
                    cssClass = 'chip-blue';
                    label += ` (Đang làm)`;
                    tooltip += ` - Đang trong ca | Vào: ${actualStartStrNoCO}`;
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
                    label += ` ⏱️+${otDataR.duration}`;
                } else if (otDataR.status === 'pending') {
                    otPendingR = true;
                    label += ` ⏱️?`;
                }
            }

            chips.push({
                text: label,
                class: cssClass,
                paidMinutes: Math.max(0, Math.round(minutes + otMinutesR)),
                tooltip: tooltip,
                sessionId: matchedSession.id,
                sessionData: matchedSession,
                isClickable: isClickable,
                isReceptionist: true,
                classCompositeKey: compositeKeyLocal,
                classSectionKey: rs.shift,
                classIndex: dayKeyLocal,
                overtimeId: otIdR,
                overtimePending: otPendingR,
                overtimeMinutes: otMinutesR,
                isFixedShift: rs.isFixedShift,
                mergedSegments: rs.mergedSegments || null,
                bonus10Status: b10StatusR,
                bonus10Id: b10DataR ? b10DataR.id : null
            });

        } else {
            // === NO ATTENDANCE FOR THIS SHIFT ===
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
                    classCompositeKey: compositeKeyLocal,
                    classSectionKey: rs.shift,
                    classIndex: dayKeyLocal,
                    isFixedShift: rs.isFixedShift
                });
            }
        }
    });

    // 4. Handle Unmatched Sessions
    attendanceSessions.forEach(s => {
        if (!usedSessionIds.has(s.id)) {
            const isAdminCreated = (s.type === 'admin_add' || s.type === 'manual');
            let label = isAdminCreated ? 'Ca Thêm' : 'Ca Ngoài Lịch';
            let duration = 0;
            let cssClass = 'chip-orange';
            let isClickable = false;

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
            const USE_SCHED = !isAdminCreated && nearestSchedStart && nearestDiff < 90 * 60 * 1000;

            let b10DataU, b10StatusU;

            if (s.checkOut) {
                const sessionEnd = safeDate(s.checkOut);
                const endStr = sessionEnd ? sessionEnd.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '??:??';

                if (USE_SCHED) {
                    // Tính sớm/trễ theo giờ lịch
                    const diffToSched = sessionStart - nearestSchedStart; // + = trễ, - = sớm
                    const schedStartStr = nearestSchedStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    const effectiveEnd = sessionEnd > nearestSchedEnd ? sessionEnd : nearestSchedEnd;
                    const lateMin = diffToSched >= 60000 ? Math.round(diffToSched / 60000) : 0;
                    const lateSuffix = lateMin > 0 ? ` (T${lateMin}p)` : '';

                    if (lateMin > 0) {
                        // Trễ: tính từ lúc vào thực tế đến cuối ca lịch
                        duration = Math.max(0, (nearestSchedEnd - sessionStart) / 60000);
                        cssClass = 'chip-orange';
                        tooltip = `Vào trễ ${lateMin}p so với lịch (${schedStartStr})`;
                    } else {
                        // Sớm hoặc đúng giờ: tính từ giờ bắt đầu lịch
                        duration = (effectiveEnd - nearestSchedStart) / 60000;
                        cssClass = s.role ? 'chip-green' : 'chip-waiting';
                        tooltip = diffToSched < 0
                            ? `Vào sớm ${Math.round(-diffToSched / 60000)}p (lịch ${schedStartStr})`
                            : `Đúng giờ (${schedStartStr})`;
                    }

                    if (s.role) {
                        cssClass = lateMin > 0 ? 'chip-orange' : 'chip-green';
                        label = `${schedStartStr}–${endStr}${lateSuffix} (${s.roleName})`;
                        tooltip += ` - Vai trò: ${s.roleName}`;
                    } else {
                        label = `${schedStartStr}–${endStr}${lateSuffix} (Role?)`;
                        tooltip += ' - Bấm để chọn vai trò tính lương';
                    }
                } else {
                    // Không có ca gần: hiển thị thời gian thực tế (logic cũ)
                    duration = (sessionEnd - sessionStart) / 60000;
                    if (s.role) {
                        cssClass = 'chip-green';
                        label = `${startStr}–${endStr} (${s.roleName})`;
                        tooltip += ` - Vai trò: ${s.roleName}`;
                    } else {
                        cssClass = isAdminCreated ? 'chip-waiting' : 'chip-orange';
                        label = `${startStr}–${endStr} (Role?)`;
                        tooltip += ' - Bấm để chọn vai trò tính lương';
                    }
                }

                // BONUS 10P cho unmatched session
                b10DataU = bonus10Map[String(s.id)];
                b10StatusU = b10DataU ? b10DataU.status : null;
                if (b10StatusU === 'approved' || s.bonus10) {
                    duration += 10;
                    label += ` ⭐+10p`;
                    tooltip += ` | Thưởng 10p (đã duyệt)`;
                } else if (b10StatusU === 'pending') {
                    label += ` ⭐?`;
                    tooltip += ` | Yêu cầu Sớm 10p đang chờ duyệt`;
                }

                tooltip += ` - Làm việc ${Math.floor(duration / 60)}h${Math.floor(duration % 60)}p`;
                isClickable = true;
            } else {
                // Không có check-out
                const todayStrU = typeof getLocalDateKey === 'function' ? getLocalDateKey(new Date()) : new Date().toISOString().split('T')[0];
                const isPastDayU = dateStr < todayStrU;

                if (isPastDayU) {
                    const checkInTime = safeDate(s.checkIn || s.start) || new Date();
                    const endOfDay = new Date(`${dateStr}T23:59:00`);
                    duration = Math.min((endOfDay - checkInTime) / 60000, 120);
                    label = `${startStr}–??? (QR)`;
                    cssClass = 'chip-orange';
                    tooltip += ' - Quên Ra Ca (ngày đã qua)';
                    isClickable = true;
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
                    label += ` ⏱️+${otDataU.duration}`;
                } else if (otDataU.status === 'pending') {
                    otPendingU = true;
                    label += ` ⏱️?`;
                }
            }

            chips.push({
                text: label,
                class: cssClass,
                paidMinutes: Math.max(0, Math.round(duration + otMinutesU)),
                tooltip: tooltip,
                sessionId: s.id,
                sessionData: s,
                isClickable: isClickable,
                isWarning: true,
                isAdminCreated: isAdminCreated,
                overtimeId: otIdU,
                overtimePending: otPendingU,
                overtimeMinutes: otMinutesU,
                bonus10Status: b10DataU ? b10DataU.status : null,
                bonus10Id: b10DataU ? b10DataU.id : null
            });
        }
    });

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
