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
                _mergedWith: curr
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

            // 2. Check for Attendance Match
            // Priority 1: Exact match by linkedClassStart (set when admin edits a session)
            // Priority 2: Proximity match within 60 min of class start
            const schedStart = new Date(`${dateStr}T${cls.start}`);

            let matchedSession = attendanceSessions.find(s => {
                if (usedSessionIds.has(s.id)) return false;
                return s.linkedClassStart === cls.start; // Exact link preserved after admin edit
            });

            if (!matchedSession) {
                matchedSession = attendanceSessions.find(s => {
                    if (usedSessionIds.has(s.id)) return false;
                    if (s.linkedClassStart) return false; // Already linked to another class
                    const checkIn = new Date(s.checkIn || s.start);
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
            let label = `${cls.start}–${cls.end}${branchShort}`;
            let tooltip = `Lớp ${cls.lop || '?'}${branchTag}`;

            const schedEnd = new Date(`${dateStr}T${cls.end}`);
            const schedDuration = (schedEnd - schedStart) / 60000;
            const now = new Date();

            if (matchedSession) {
                let isClickable = false;

                // --- CASE A: ATTENDED (Has Check-in) ---
                if (matchedSession.checkOut) {
                    // FULL CHECK-IN/OUT
                    const actualStart = new Date(matchedSession.checkIn || matchedSession.start);

                    const diffMs = schedStart - actualStart;
                    // const diffMins = Math.floor(diffMs / 60000);

                    const actualStartStr = actualStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

                    let isLate = false;
                    if (diffMs < 0) { // Late
                        const lateMinutesRaw = Math.round(Math.abs(diffMs) / 60000);
                        if (lateMinutesRaw === 0) {
                            // Less than 1 minute late → treat as on-time
                            minutes = schedDuration;
                        } else {
                            const remainingSched = (schedEnd - actualStart) / 60000;
                            minutes = Math.max(0, Math.round(remainingSched));
                            isLate = true;
                        }
                        label += ` (T${lateMinutesRaw}p)`;
                    } else if (diffMs > 0) { // Early — không thưởng tự động
                        minutes = schedDuration;
                        const earlyMins = Math.round(diffMs / 60000);
                        tooltip += ` | Vào sớm ${earlyMins}p`;
                    } else { // Exact on-time
                        minutes = schedDuration;
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
                    const b10DataT = bonus10Map[String(matchedSession.id)];
                    const b10StatusT = b10DataT ? b10DataT.status : null;
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
                    const actualStartNoCO = new Date(matchedSession.checkIn || matchedSession.start);
                    const actualStartStrNoCO = actualStartNoCO.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
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
                const classDateTime = new Date(`${dateStr}T${cls.start}`);
                if (classDateTime > now) {
                    // User requested to hide future classes (Sắp tới)
                    // Do nothing
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
    receptionistShifts.forEach(rs => {
        const schedStart = new Date(`${dateStr}T${rs.start}`);
        const schedEnd = new Date(`${dateStr}T${rs.end}`);
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
        // Match if check-in is within: 60 min before shift start → shift end
        // This ensures late check-ins during the shift are recognized as "Trễ" not "Vắng"
        const matchedSession = attendanceSessions.find(s => {
            if (usedSessionIds.has(s.id)) return false;
            const checkIn = new Date(s.checkIn || s.start);
            const earlyLimit = new Date(schedStart.getTime() - 60 * 60 * 1000);
            return checkIn >= earlyLimit && checkIn <= schedEnd;
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
                const actualStart = new Date(matchedSession.checkIn || matchedSession.start);
                const diffMs = schedStart - actualStart;
                const actualStartStr = actualStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

                if (diffMs < 0) {
                    // Late
                    const lateMinutesRaw = Math.round(Math.abs(diffMs) / 60000);
                    if (lateMinutesRaw === 0) {
                        minutes = schedDuration;
                    } else {
                        const remainingSched = (schedEnd - actualStart) / 60000;
                        minutes = Math.max(0, Math.round(remainingSched));
                        isLate = true;
                    }
                    label += ` (T${lateMinutesRaw}p)`;
                } else if (diffMs > 0) { // Early — không thưởng tự động
                    minutes = schedDuration;
                    const earlyMins = Math.round(diffMs / 60000);
                    tooltip += ` | Vào sớm ${earlyMins}p`;
                } else {
                    minutes = schedDuration;
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
                const actualStartNoCO = new Date(matchedSession.checkIn || matchedSession.start);
                const actualStartStrNoCO = actualStartNoCO.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

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
                bonus10Status: b10StatusR,
                bonus10Id: b10DataR ? b10DataR.id : null
            });

        } else {
            // === NO ATTENDANCE FOR THIS SHIFT ===
            const shiftDateTime = new Date(`${dateStr}T${rs.start}`);
            if (shiftDateTime > now) {
                // Future shift → show as "Sắp tới" so receptionist can see upcoming schedule
                chips.push({
                    text: label + ' (ST)',
                    class: 'chip-future',
                    paidMinutes: 0,
                    tooltip: `Ca tiếp tân sắp tới - ${rs.label} (${rs.start}–${rs.end})`,
                    sessionId: null,
                    schedData: { start: rs.start, end: rs.end },
                    isClickable: false, // User requested future shifts not to be clickable for checkin, though admin could delete them if needed
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
    // 4. Handle Unmatched Sessions
    attendanceSessions.forEach(s => {
        if (!usedSessionIds.has(s.id)) {
            const isAdminCreated = (s.type === 'admin_add' || s.type === 'manual');
            let label = isAdminCreated ? 'Ca Thêm' : 'Ca Ngoài Lịch';
            let duration = 0;
            let cssClass = 'chip-orange';
            let isClickable = false;

            const start = new Date(s.checkIn || s.start);
            const startStr = start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            let tooltip = isAdminCreated
                ? `Admin đã thêm ca này thủ công (Vào: ${startStr})`
                : `Chấm công không khớp lịch (Vào ca: ${startStr})`;

            if (s.checkOut) {
                const end = new Date(s.checkOut);
                const endStr = end.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                duration = (end - start) / 60000;

                // Role Logic for unmatched sessions
                if (s.role) {
                    cssClass = 'chip-green';
                    label = `${startStr}–${endStr} (${s.roleName})`;
                    tooltip += ` - Vai trò: ${s.roleName}`;
                } else {
                    cssClass = isAdminCreated ? 'chip-waiting' : 'chip-orange';
                    label = `${startStr}–${endStr} (Role?)`;
                    tooltip += ' - Bấm để chọn vai trò tính lương';
                }

                // BONUS 10P cho unmatched session
                const b10DataU = bonus10Map[String(s.id)];
                const b10StatusU = b10DataU ? b10DataU.status : null;
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
                // Check if this is a past day — if so, treat as "Quên ra" instead of "Đang dạy"
                const todayStrU = typeof getLocalDateKey === 'function' ? getLocalDateKey(new Date()) : new Date().toISOString().split('T')[0];
                const isPastDayU = dateStr < todayStrU;

                if (isPastDayU) {
                    const checkInTime = new Date(s.checkIn || s.start);
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

            chips.push({
                text: label,
                class: cssClass,
                paidMinutes: Math.max(0, Math.round(duration)),
                tooltip: tooltip,
                sessionId: s.id,
                sessionData: s,
                isClickable: isClickable,
                isWarning: true,
                isAdminCreated: isAdminCreated,
                bonus10Status: typeof b10DataU !== 'undefined' ? (b10DataU ? b10DataU.status : null) : null,
                bonus10Id: typeof b10DataU !== 'undefined' && b10DataU ? b10DataU.id : null
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
