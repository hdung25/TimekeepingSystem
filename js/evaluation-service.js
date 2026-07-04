// evaluation-service.js — Pure Data & Calculation Logic — v2026.04.15c
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

function calculateDailyChips(schedule, attendanceSessions, staffId, dateStr, currentUserContext, receptionistShifts = [], overtimeMap = {}, cancelledShifts = [], bonus10Map = {}) {
    const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
    const chips = [];
    const usedSessionIdsTeaching = new Set();
    const usedSessionIdsReceptionist = new Set();
    const teachingMinutesMap = {}; // sessionId -> total teaching minutes
    const teachingSessionsMap = {}; // sessionId -> array of teaching shifts {start, end, paidMinutes}

    // Collect VĐX (Vắng đã xác nhận) slots for this staff on this day to hide overlapping receptionist absent chips
    const vdxSlots = [];
    sections.forEach(sk => {
        (schedule[sk] || []).forEach(c => {
            if (!c.start || !c.end) return;
            const isOriginalVDX = c.gvThayTheId && c.gvId === staffId;
            if (isOriginalVDX) {
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
                const _isSubstitute = c.gvThayTheId && c.gvThayTheId === staffId;
                const _isOriginalVDX = c.gvThayTheId && c.gvId === staffId;
                const _isReg = _isSubstitute ||
                    (!_isOriginalVDX && (
                        (c.registeredTeachers || []).some(t => t.id === staffId) || (c.gvId && c.gvId === staffId)
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
                const _isSubstitute = c.gvThayTheId && c.gvThayTheId === staffId;
                const _isOriginalVDX = c.gvThayTheId && c.gvId === staffId;
                const _isReg = _isSubstitute ||
                    (!_isOriginalVDX && (
                        (c.registeredTeachers || []).some(t => t.id === staffId) || (c.gvId && c.gvId === staffId)
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
                const _isSubstitute = c.gvThayTheId && c.gvThayTheId === staffId;
                const _isOriginalVDX = c.gvThayTheId && c.gvId === staffId;
                const _isReg = _isSubstitute ||
                    (!_isOriginalVDX && (
                        (c.registeredTeachers || []).some(t => t.id === staffId) || (c.gvId && c.gvId === staffId)
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
            const isSubstitute = cls.gvThayTheId && cls.gvThayTheId === staffId;
            const isOriginalVDX = cls.gvThayTheId && cls.gvId === staffId;

            // GV gốc bị thay → tạo chip VĐX riêng (không tính giờ/lương) rồi return
            if (isOriginalVDX) {
                const lopLabel = cls.lop ? `${cls.lop}` : 'ca dạy';
                const branchLabel = cls._branch ? cls._branch.toUpperCase() : '';
                chips.push({
                    text: `VĐX: ${lopLabel} ${cls.start}–${cls.end}${branchLabel ? ' (' + branchLabel + ')' : ''}`,
                    class: 'chip-red',
                    paidMinutes: 0,
                    isWarning: false,
                    isVDX: true,
                    chipFilterName: normalizeChipFilterName(cls.lop),
                    tooltip: `Vắng đột xuất — GV thay thế: ${cls.gvThayThe || '?'}`
                });
                return;
            }

            // 2. Check if user is assigned: substitute, admin-set gvId, or legacy registeredTeachers
            const isRegistered = isSubstitute ||
                (cls.gvId && cls.gvId === staffId) ||
                (cls.registeredTeachers || []).some(t => t.id === staffId);

            if (!isRegistered) return; // Skip if not assigned to this class
            if (!cls.start || !cls.end) return; // skip malformed rows missing start/end

            // Dedup: bỏ qua nếu đã có entry cùng (branch+start+end) → tránh chip V giả
            const _mainSlotKey = `${cls._branch || ''}_${cls.start}_${cls.end}`;
            if (_mainSeenSlots.has(_mainSlotKey)) return;
            _mainSeenSlots.add(_mainSlotKey);

            if (cls.isClosed === true) return; // Skip closed class

            // --- NEW: Check Cancelled Shifts ---
            const classCompositeKey = cls._compositeKey || null;
            const originalIdx = cls._originalIndex !== undefined ? cls._originalIndex : idx;
            if (classCompositeKey && cancelledShifts.includes(`${classCompositeKey}_${secKey}_${originalIdx}`)) {
                return; // Skip this explicitly cancelled shift
            }

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
            const [_sH, _sM] = cls.start.split(':').map(Number);
            const schedStart = new Date(_sy, _sm - 1, _sd, _sH, _sM, 0, 0);
            const _effectiveEndStr = _mergedEnd || cls.end;
            const [_eH, _eM] = _effectiveEndStr.split(':').map(Number);
            const schedEnd = new Date(_sy, _sm - 1, _sd, _eH, _eM, 0, 0);

            let matchedSession = attendanceSessions.find(s => {
                if (usedSessionIdsTeaching.has(s.id)) return false;
                return s.linkedClassStart === cls.start; // Exact link preserved after admin edit
            });

            if (!matchedSession) {
                matchedSession = attendanceSessions.find(s => {
                    if (usedSessionIdsTeaching.has(s.id)) return false;
                    if (s.linkedClassStart) return false; // Already linked to another class
                    const checkIn = safeDate(s.checkIn || s.start);
                    if (!checkIn) return false;
                    const checkOut = safeDate(s.checkOut);
                    if (!checkOut) return false;
                    return checkIn < schedEnd && checkOut > schedStart;
                });
            }

            if (!matchedSession) {
                matchedSession = attendanceSessions.find(s => {
                    if (usedSessionIdsTeaching.has(s.id)) return false;
                    if (s.linkedClassStart) return false; // Already linked to another class
                    const checkIn = safeDate(s.checkIn || s.start);
                    if (!checkIn) return false;
                    const diffMs = Math.abs(checkIn - schedStart);
                    return diffMs < 60 * 60 * 1000;
                });
            }

            if (matchedSession) {
                usedSessionIdsTeaching.add(matchedSession.id);
                _matchedTimeSlots.add(`${cls.start}_${cls.end}`);
                
                // Consume all other teaching sessions overlapping with this time window
                attendanceSessions.forEach(s => {
                    if (usedSessionIdsTeaching.has(s.id)) return;
                    if (s.linkedClassStart) return; // Already linked to another class
                    const checkIn = safeDate(s.checkIn || s.start);
                    if (!checkIn) return;
                    const checkOut = safeDate(s.checkOut);
                    if (!checkOut) return;
                    if (checkIn < schedEnd && checkOut > schedStart) {
                        usedSessionIdsTeaching.add(s.id);
                    }
                });
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
            let label = `${cls.start}–${_effectiveEndStr}${_labelBranchSuffix}`;
            let tooltip = `Lớp ${cls.lop || '?'}${branchTag}`;
            if (_mergedEnd) tooltip += _isCrossBranch ? ` (2 ca gộp – ${(_chainBranches || []).map(b => b.toUpperCase()).join('/')})` : ` (2 ca gộp)`;

            const schedDuration = (schedEnd - schedStart) / 60000;
            const now = new Date();

            if (matchedSession) {
                let isClickable = false;
                const b10DataT = bonus10Map[String(matchedSession.id)];
                const b10StatusT = b10DataT ? b10DataT.status : null;

                // Clone sessionData to prevent shared reference modifications
                const chipSessionData = { ...matchedSession };

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

                    let isLate = false;
                    if (matchedSession.isAdminEdited) {
                        label = `${actualStartStr}–${actualEndStr}${_labelBranchSuffix}`;
                    } else {
                        const effectiveStart = new Date(Math.max(schedStart.getTime(), actualStart.getTime()));
                        const effectiveEnd = new Date(Math.min(schedEnd.getTime(), actualEnd.getTime()));
                        minutes = Math.max(0, Math.round((effectiveEnd - effectiveStart) / 60000));

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
                    }

                    // Hiển thị thông tin nếu ra muộn (chỉ để tham khảo, không tính lương)
                    if (actualEnd > schedEnd) {
                        const overMins = Math.round((actualEnd - schedEnd) / 60000);
                        tooltip += ` | Ra muộn ${overMins}p`;
                    }

                    // Determine combined subject label for merged teaching shifts
                    let mergedSubjectNames = '';
                    if (_chainSegments && _chainSegments.length > 0) {
                        const lops = _chainSegments.map(seg => seg.lop).filter(Boolean);
                        mergedSubjectNames = [...new Set(lops)].join(' + ');
                    }

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
                    chipSessionData.roleName = resolvedRoleName;
                    chipSessionData.roleRate = resolvedRoleRate;

                    // Role Logic Display
                    if (chipSessionData.role && !['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chipSessionData.role)) {
                        let _displayRoleName = chipSessionData.roleName || chipSessionData.role;
                        if (mergedSubjectNames) {
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

                    // BONUS 10P (từ request được duyệt)
                    if (b10StatusT === 'approved' || matchedSession.bonus10) {
                        minutes += 10;
                        label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p';
                        tooltip += ` | Thưởng 10p (đã duyệt)`;
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

                    if (isPastDay || now > new Date(classEndTime.getTime() + 90 * 60000)) {
                        minutes = schedDuration;
                        cssClass = 'chip-green';
                        tooltip += ' - Tự ra ca (Tính đủ giờ)';
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
                        label += ' ' + window.getIconHtml('clock', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+' + otData.duration;
                    } else if (otData.status === 'pending') {
                        otPending = true;
                        label += ' ' + window.getIconHtml('clock', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '?';
                    }
                }

                // Track teaching minutes and shifts details for subtracting from receptionist time (Issue 1)
                if (minutes > 0) {
                    if (!teachingMinutesMap[matchedSession.id]) {
                        teachingMinutesMap[matchedSession.id] = 0;
                        teachingSessionsMap[matchedSession.id] = [];
                    }
                    teachingMinutesMap[matchedSession.id] += minutes;
                    teachingSessionsMap[matchedSession.id].push({
                        start: cls.start,
                        end: cls.end,
                        paidMinutes: minutes
                    });
                }

                chips.push({
                    text: label,
                    class: cssClass,
                    paidMinutes: Math.max(0, Math.round(minutes + otMinutes)),
                    tooltip: tooltip,
                    sessionId: matchedSession.id,
                    sessionData: chipSessionData, // Use cloned chipSessionData
                    isClickable: isClickable,
                    isTeaching: true,
                    studentCount: chipSessionData.studentCount || null,
                    studentCountStatus: chipSessionData.studentCountStatus || null,
                    chipFilterName: normalizeChipFilterName(cls.lop),
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
                    mergedSegments: (_mergeInfo[_mk] && _mergeInfo[_mk].chainSegments) || null
                });

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
                        text: label,
                        class: 'chip-future',
                        paidMinutes: 0,
                        tooltip: `Đã nhận lớp - chờ chấm công | Lớp ${cls.lop || '?'}${branchTag}`,
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


        // Find matching attendance session
        const matchedSession = attendanceSessions.find(s => {
            if (usedSessionIdsReceptionist.has(s.id)) return false;

            // FIX bug Ánh: session do admin thêm tay từ chip Vắng đã link cứng vào ca này
            // → match thẳng, bỏ qua kiểm tra khung giờ (vì admin có thể đã nhập giờ lệch).
            if (s.linkedReceptionistShift && s.linkedReceptionistShift === rs.shift) {
                return true;
            }

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
            usedSessionIdsReceptionist.add(matchedSession.id);

            let minutes = 0;
            let cssClass = 'chip-blue';
            let isClickable = false;
            let isLate = false;

            const b10DataR = bonus10Map[String(matchedSession.id)];
            const b10StatusR = b10DataR ? b10DataR.status : null;

            const chipSessionData = { ...matchedSession };

            if (matchedSession.checkOut) {
                // === HAS CHECK-OUT ===
                const actualStart = safeDate(matchedSession.checkIn || matchedSession.start);
                const actualEnd = safeDate(matchedSession.checkOut);
                
                // Lấy thời gian làm việc thực tế nằm trong khung giờ lịch
                const effectiveStartR = new Date(Math.max(schedStart.getTime(), actualStart.getTime()));
                const effectiveEndR = new Date(Math.min(schedEnd.getTime(), actualEnd.getTime()));
                minutes = Math.max(0, Math.round((effectiveEndR - effectiveStartR) / 60000));

                // Subtract overlapping teaching minutes! (Issue 1)
                const teachingShifts = teachingSessionsMap[matchedSession.id] || [];
                let overlappingTeachingMinutes = 0;
                teachingShifts.forEach(ts => {
                    const tsStartParts = ts.start.split(':');
                    const tsEndParts = ts.end.split(':');
                    const tsStart = new Date(_ry, _rm - 1, _rd, parseInt(tsStartParts[0], 10), parseInt(tsStartParts[1], 10), 0, 0);
                    const tsEnd = new Date(_ry, _rm - 1, _rd, parseInt(tsEndParts[0], 10), parseInt(tsEndParts[1], 10), 0, 0);
                    
                    const recepStart = matchedSession.isAdminEdited ? actualStart : schedStart;
                    const recepEnd = matchedSession.isAdminEdited ? actualEnd : schedEnd;
                    const overlapStart = new Date(Math.max(recepStart.getTime(), tsStart.getTime()));
                    const overlapEnd = new Date(Math.min(recepEnd.getTime(), tsEnd.getTime()));
                    if (overlapStart < overlapEnd) {
                        overlappingTeachingMinutes += Math.max(0, Math.round((overlapEnd - overlapStart) / 60000));
                    }
                });
                minutes = Math.max(0, minutes - overlappingTeachingMinutes);

                const actualStartStr = actualStart ? actualStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '??:??';
                const actualEndStr = actualEnd ? actualEnd.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '??:??';

                if (matchedSession.isAdminEdited) {
                    const fullActualMinutes = Math.max(0, Math.round((actualEnd - actualStart) / 60000));
                    minutes = Math.max(0, fullActualMinutes - overlappingTeachingMinutes);
                    label = `${labelShort} ${actualStartStr}–${actualEndStr}${branchShortR}`;
                } else {
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
                    minutes += 10;
                    label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p';
                    tooltip += ` | Thưởng 10p (đã duyệt)`;
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

                    // Subtract overlapping teaching minutes! (Issue 1)
                    const teachingShifts = teachingSessionsMap[matchedSession.id] || [];
                    let overlappingTeachingMinutes = 0;
                    teachingShifts.forEach(ts => {
                        const tsStartParts = ts.start.split(':');
                        const tsEndParts = ts.end.split(':');
                        const tsStart = new Date(_ry, _rm - 1, _rd, parseInt(tsStartParts[0], 10), parseInt(tsStartParts[1], 10), 0, 0);
                        const tsEnd = new Date(_ry, _rm - 1, _rd, parseInt(tsEndParts[0], 10), parseInt(tsEndParts[1], 10), 0, 0);
                        
                        const overlapStart = new Date(Math.max(schedStart.getTime(), tsStart.getTime()));
                        const overlapEnd = new Date(Math.min(schedEnd.getTime(), tsEnd.getTime()));
                        if (overlapStart < overlapEnd) {
                            overlappingTeachingMinutes += Math.max(0, Math.round((overlapEnd - overlapStart) / 60000));
                        }
                    });
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
                chipFilterName: normalizeChipFilterName(rs.label ? 'Tiếp Tân (' + rs.label + ')' : 'Tiếp Tân'),
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
                        cssClass = 'chip-green'; // Đã checkin+checkout → luôn green dù chưa chọn role
                        tooltip = diffToSched < 0
                            ? `Vào sớm ${Math.round(-diffToSched / 60000)}p (lịch ${schedStartStr})`
                            : `Đúng giờ (${schedStartStr})`;
                    }

                    // Subtract teaching minutes (Issue 1)
                    const teachingMins = teachingMinutesMap[s.id] || 0;
                    duration = Math.max(0, duration - teachingMins);

                    if (chipSessionData.role) {
                        const _dnU1 = chipSessionData.roleName || chipSessionData.role;
                        cssClass = lateMin > 0 ? 'chip-orange' : 'chip-green';
                        label = `${schedStartStr}–${endStr}${lateSuffix} (${_dnU1})`;
                        tooltip += ` - Vai trò: ${_dnU1}`;
                        // Rate cho tiếp tân
                        if ((chipSessionData.role === 'tiep-tan' || chipSessionData.role === 'receptionist') && currentUserContext?.salary_config?.receptionist_normal_rate) {
                            chipSessionData.roleRate = Number(currentUserContext.salary_config.receptionist_normal_rate);
                        }
                    } else {
                        cssClass = 'chip-waiting';
                        label = `${schedStartStr}–${endStr}${lateSuffix} (Role?)`;
                        tooltip += ' - Bấm để chọn vai trò tính lương';
                    }
                } else {
                    // Không có ca gần: hiển thị thời gian thực tế (logic cũ)
                    duration = (sessionEnd - sessionStart) / 60000;

                    // Subtract teaching minutes (Issue 1)
                    const teachingMins = teachingMinutesMap[s.id] || 0;
                    duration = Math.max(0, duration - teachingMins);

                    if (chipSessionData.role) {
                        const _dnU2 = chipSessionData.roleName || chipSessionData.role;
                        cssClass = 'chip-green';
                        label = `${startStr}–${endStr} (${_dnU2})`;
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

                // BONUS 10P cho unmatched session
                b10DataU = bonus10Map[String(s.id)];
                b10StatusU = b10DataU ? b10DataU.status : null;
                if (b10StatusU === 'approved' || s.bonus10) {
                    duration += 10;
                    label += ' ' + window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p';
                    tooltip += ` | Thưởng 10p (đã duyệt)`;
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
                    label = `${startStr}–???`;
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
            if (isUsedForTeaching && paidMinutes <= 0 && !otPendingU) {
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
