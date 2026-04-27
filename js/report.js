// Report & Salary Logic

document.addEventListener('DOMContentLoaded', () => {
    // Check if on report page (has calendar grid)
    if (document.getElementById('calendar-grid')) {
        initReport();
    }
});

let currentDate = new Date(); // Global View Date

async function initReport() {
    // 0. Wait for Firebase Auth to restore session (critical for Firestore permissions)
    await new Promise((resolve) => {
        const unsubscribe = firebase.auth().onAuthStateChanged(() => {
            unsubscribe();
            resolve();
        });
        // Timeout fallback: don't block forever if auth fails
        setTimeout(resolve, 3000);
    });

    // 1. Title & Admin Controls
    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    // parseRoles có thể chưa load — dùng fallback an toàn
    let roles = [];
    try {
        const parsed = JSON.parse(roleRaw);
        roles = Array.isArray(parsed) ? parsed : [roleRaw];
    } catch(e) {
        roles = [roleRaw];
    }
    const role = roles[0] || 'staff'; // primary role (compat)
    const isSalaryAdmin = roles.includes('admin');
    const isAdminLike = roles.some(r => r === 'admin' || r === 'senior_assistant');

    if (isAdminLike) {
        const controls = document.getElementById('admin-controls');
        if (controls) controls.style.display = 'flex';
        document.getElementById('page-title').innerText = isSalaryAdmin ? 'Tính Lương & Duyệt Công' : 'Duyệt Công Nhân Viên';
        await populateStaffSelect();

        // Auto-select staff from URL param
        const urlParams = new URLSearchParams(window.location.search);
        const paramStaffId = urlParams.get('staffId');
        if (paramStaffId) {
            const select = document.getElementById('staff-select');
            if (select) {
                select.value = paramStaffId;
                _cachedStaffId = null;

                // Hiện tên nhân viên trên ô search input
                const selectedOption = select.options[select.selectedIndex];
                const searchInput = document.getElementById('staff-search-input');
                if (searchInput && selectedOption && selectedOption.value) {
                    searchInput.value = selectedOption.text || '';
                }
            }
        }

        // Hide salary-related fields for senior_assistant
        if (!isSalaryAdmin) {
            // Hide: Tạm Ứng, Thưởng/Phạt, Dự Kiến Thực Lĩnh, Xuất PDF, Lưu & Tính
            const salaryAdvance = document.getElementById('salary-advance');
            if (salaryAdvance) salaryAdvance.closest('.modern-form-group').style.display = 'none';
            const bonusPenalty = document.getElementById('summary-bonus-penalty');
            if (bonusPenalty) bonusPenalty.closest('.modern-form-group').style.display = 'none';
            const controlFooter = document.querySelector('.control-footer');
            if (controlFooter) controlFooter.style.display = 'none';
        }

        const bonusBtn = document.getElementById('btn-manual-bonus');
        if (bonusBtn) bonusBtn.style.display = 'none';
        window.isBonusSelectMode = false;

    } else {
        const controls = document.getElementById('admin-controls');
        if (controls) controls.style.display = 'none';
        document.getElementById('page-title').innerText = 'Bảng Công Cá Nhân';

        const bonusBtn = document.getElementById('btn-manual-bonus');
        if (bonusBtn) {
            const canRequestBonus10 = roles.some(r => r === 'teaching_assistant');
            bonusBtn.style.display = canRequestBonus10 ? 'inline-block' : 'none';
        }
    }

    // Role specific buttons
    const markFixedBtn = document.getElementById('btn-mark-fixed');
    if (markFixedBtn && ['admin', 'senior_assistant', 'receptionist_assistant', 'assistant'].includes(role)) {
        markFixedBtn.style.display = 'inline-block';
    }

    // 2. Set to 1st of current month
    currentDate.setDate(1);

    // 3. Render
    renderMonthReport(currentDate);

    // Cross-tab update: refresh report if another tab changes class registration
    window.addEventListener('storage', (event) => {
        if (event.key === 'schedule_registration_updated' && event.storageArea === localStorage) {
            if (typeof renderMonthReport === 'function') {
                renderMonthReport(currentDate, true);
            }
        }
    });
}

async function populateStaffSelect() {
    const select = document.getElementById('staff-select');
    const dropdownList = document.getElementById('staff-dropdown-list');

    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    const roles = typeof parseRoles === 'function' ? parseRoles(roleRaw) : [roleRaw];
    const isAdmin = roles.some(r => r === 'admin' || r === 'senior_assistant');

    let users = await DBService.getUsers();

    // Admin thấy tất cả, staff chỉ thấy mình
    if (!isAdmin) {
        const myId = localStorage.getItem('currentUserId');
        users = users.filter(u => u.id === myId);
    }

    // Lưu global để filter
    window._allStaffList = users;

    // Populate hidden select (backward compat)
    if (select) {
        select.innerHTML = '<option value="">-- Chọn nhân viên --</option>';
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.name || u.username;
            select.appendChild(opt);
        });
    }

    // Render dropdown list
    if (dropdownList) {
        renderStaffDropdownItems(users);
    }

    // Nếu chỉ có 1 user (staff tự xem) → auto-select
    if (users.length === 1) {
        selectStaffFromDropdown(users[0]);
    }
}

function renderStaffDropdownItems(users) {
    const list = document.getElementById('staff-dropdown-list');
    if (!list) return;

    const ROLE_LABELS = {
        'admin': 'Quản Trị Viên',
        'senior_assistant': 'Trợ Lý Cấp Cao',
        'assistant': 'Trợ Lý',
        'teaching_assistant': 'Trợ giảng/ GV TA',
        'receptionist': 'Tiếp Tân',
        'receptionist_assistant': 'Trợ Lí Tiếp Tân',
        'staff': 'Nhân Viên'
    };

    if (users.length === 0) {
        list.innerHTML = '<div style="padding:1rem;text-align:center;color:#9CA3AF;font-size:0.9rem;">Không tìm thấy nhân viên</div>';
        return;
    }

    list.innerHTML = users.map(u => {
        const primaryRole = (u.roles && u.roles[0]) || u.role || '';
        const roleLabel = ROLE_LABELS[primaryRole] || primaryRole || '';
        const color = u.scheduleColor || '#E5E7EB';
        const initial = (u.name || u.username || '?').charAt(0).toUpperCase();
        return `
            <div
                class="staff-dropdown-item"
                data-id="${u.id}"
                onclick="selectStaffFromDropdown(${JSON.stringify(u).replace(/"/g, '&quot;')})"
                style="display:flex;align-items:center;gap:0.75rem;padding:0.65rem 1rem;cursor:pointer;transition:background 0.15s;"
                onmouseover="this.style.background='#F0FDF4'"
                onmouseout="this.style.background=''"
            >
                <div style="width:36px;height:36px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;color:white;flex-shrink:0;">${initial}</div>
                <div>
                    <div style="font-weight:600;font-size:0.9rem;color:#1F2937;">${u.name || u.username}</div>
                    <div style="font-size:0.75rem;color:#6B7280;">${roleLabel}${u.username ? ' · ' + u.username : ''}</div>
                </div>
            </div>
        `;
    }).join('');
}

function openStaffDropdown() {
    const list = document.getElementById('staff-dropdown-list');
    const input = document.getElementById('staff-search-input');
    if (!list) return;
    list.style.display = 'block';
    if (input) input.style.borderColor = 'var(--primary-color)';

    // Close when clicking outside
    setTimeout(() => {
        document.addEventListener('click', closeStaffDropdownOnOutside, { once: true });
    }, 0);
}

function closeStaffDropdownOnOutside(e) {
    const wrapper = document.getElementById('staff-search-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        closeStaffDropdown();
    } else {
        // Still inside — re-attach listener
        setTimeout(() => {
            document.addEventListener('click', closeStaffDropdownOnOutside, { once: true });
        }, 0);
    }
}

function closeStaffDropdown() {
    const list = document.getElementById('staff-dropdown-list');
    const input = document.getElementById('staff-search-input');
    if (list) list.style.display = 'none';
    if (input) input.style.borderColor = 'var(--border-color)';
}

function filterStaffDropdown(query) {
    if (!window._allStaffList) return;
    const q = query.toLowerCase().trim();
    const filtered = q
        ? window._allStaffList.filter(u =>
            (u.name || '').toLowerCase().includes(q) ||
            (u.username || '').toLowerCase().includes(q)
          )
        : window._allStaffList;

    renderStaffDropdownItems(filtered.filter(u => !(u.role === 'admin' && u.username === 'admin')));

    const list = document.getElementById('staff-dropdown-list');
    if (list) list.style.display = 'block';
}

function selectStaffFromDropdown(user) {
    // 1. Set hidden select value (giữ compat với getTargetStaffId)
    const select = document.getElementById('staff-select');
    if (select) select.value = user.id;

    // 2. Update input display
    const input = document.getElementById('staff-search-input');
    if (input) input.value = user.name || user.username;

    // 3. Close dropdown
    closeStaffDropdown();

    // Auto-detect salary-role-filter theo role nhân viên được chọn
    const filterEl = document.getElementById('salary-role-filter');
    if (filterEl) {
        const staffRoles = (user.roles && user.roles.length > 0)
            ? user.roles
            : [user.role || ''];
        const hasReceptionist = staffRoles.some(r =>
            r === 'receptionist' || r === 'receptionist_assistant'
        );
        const hasTeaching = staffRoles.some(r =>
            r === 'teaching_assistant' || r === 'assistant' ||
            r === 'staff'
        );
        if (hasReceptionist && !hasTeaching) {
            filterEl.value = 'tiep-tan';
        } else if (hasTeaching && !hasReceptionist) {
            filterEl.value = 'giao-vien';
        } else {
            filterEl.value = 'all'; // đa role → để admin chọn tay
        }
        if (typeof togglePdfTieptanInputs === 'function') togglePdfTieptanInputs();
    }

    // 4. Load report
    _cachedStaffId = null;
    renderMonthReport(currentDate);
}

function changeReportMonth(offset) {
    currentDate.setMonth(currentDate.getMonth() + offset);
    renderMonthReport(currentDate);
}

window.isBonusSelectMode = false;
window.toggleBonusSelectionMode = function(btn) {
    window.isBonusSelectMode = !window.isBonusSelectMode;
    if (window.isBonusSelectMode) {
        btn.style.background = '#EF4444'; // Red to cancel
        btn.innerText = 'Bỏ Chọn Thưởng';
        if (typeof UIService !== 'undefined') UIService.toast('Chế độ thưởng: Click vào các ca làm để cộng 10p.', 'info');
    } else {
        btn.style.background = '#10B981'; // Green
        btn.innerText = '+ Thưởng 10p';
        if (typeof UIService !== 'undefined') UIService.toast('Đã tắt chế độ thưởng.', 'info');
    }
    renderMonthReport(currentDate);
};

window.isBonus10SelectMode = false;

window.toggleBonus10SelectMode = function() {
    window.isBonus10SelectMode = !window.isBonus10SelectMode;
    const selectBtn = document.getElementById('btn-select-bonus10-mode');
    const approveBtn = document.getElementById('btn-approve-selected-bonus10');

    if (window.isBonus10SelectMode) {
        if (selectBtn) {
            selectBtn.innerHTML = '✕ Hủy chọn';
            selectBtn.style.background = '#FEE2E2';
            selectBtn.style.color = '#DC2626';
            selectBtn.style.borderColor = '#FECACA';
        }
        if (approveBtn) approveBtn.style.display = 'inline-flex';
        if (typeof UIService !== 'undefined') UIService.toast('Tick ☑ vào các ca muốn duyệt, rồi bấm "Duyệt đã chọn"', 'info');
    } else {
        if (selectBtn) {
            selectBtn.innerHTML = '☑ Chọn để duyệt';
            selectBtn.style.background = '#E0E7FF';
            selectBtn.style.color = '#4F46E5';
            selectBtn.style.borderColor = '#C7D2FE';
        }
        if (approveBtn) approveBtn.style.display = 'none';
    }
    // Re-render để hiện/ẩn checkboxes
    _cachedStaffId = null;
    renderMonthReport(currentDate);
};

window.isFixedShiftMode = false;
window.selectedFixedShifts = new Set();
window.toggleFixedShiftMode = function(btn) {
    window.isFixedShiftMode = !window.isFixedShiftMode;
    const saveBtn = document.getElementById('btn-save-fixed');
    
    if (window.isFixedShiftMode) {
        btn.style.background = '#EF4444'; // Red to cancel
        btn.innerText = 'Hủy Chọn CĐ';
        if (saveBtn) saveBtn.style.display = 'inline-block';
        if (typeof UIService !== 'undefined') UIService.toast('Chế độ Ca Cố Định: Click vào các ca tiếp tân để chọn.', 'info');
    } else {
        btn.style.background = '#6366F1'; // Indigo
        btn.innerText = 'Đánh dấu Ca Cố Định';
        if (saveBtn) saveBtn.style.display = 'none';
        window.selectedFixedShifts.clear();
        if (typeof UIService !== 'undefined') UIService.toast('Đã tắt chế độ Ca Cố Định.', 'info');
    }
    renderMonthReport(currentDate);
};

window.saveFixedShiftsToServer = async function() {
    if (!window.isFixedShiftMode) return;
    const staffId = document.getElementById('staff-select') ? document.getElementById('staff-select').value : null;
    if (!staffId || staffId === 'all') {
         if (typeof UIService !== 'undefined') UIService.toast('Vui lòng chọn nhân viên trước.', 'error');
         return;
    }
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const monthStr = `${year}-${month}`;
    
    try {
        const shiftsArr = Array.from(window.selectedFixedShifts);
        await DBService.saveFixedShifts(monthStr, staffId, shiftsArr);
        if (typeof UIService !== 'undefined') UIService.toast('Đã lưu các Ca Cố Định thành công!', 'success');
        
        // Turn off mode
        const btn = document.getElementById('btn-mark-fixed');
        if (btn) toggleFixedShiftMode(btn);
        
    } catch (e) {
        console.error("Error saving fixed shifts:", e);
        if (typeof UIService !== 'undefined') UIService.toast('Lỗi khi lưu.', 'error');
    }
};

function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getHolidayName(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);

    // 1. Fixed Solar Holidays
    if (m === 1 && d === 1) return "Tết Dương Lịch";
    if (m === 4 && d === 30) return "Giải phóng MN";
    if (m === 5 && d === 1) return "Quốc tế LĐ";
    if (m === 9 && d === 2) return "Quốc Khánh";
    if (m === 12 && d === 25) return "Giáng Sinh"; // Optional

    // 2. Variable Lunar Holidays (Hardcoded for 2024-2026)
    // 2024
    if (y === 2024) {
        if (m === 2 && (d >= 8 && d <= 14)) return "Tết Nguyên Đán";
        if (m === 4 && d === 18) return "Giỗ Tổ Hùng Vương";
    }
    // 2025
    if (y === 2025) {
        if (m === 1 && d >= 28) return "Tết Nguyên Đán";
        if (m === 2 && d <= 2) return "Tết Nguyên Đán";
        if (m === 4 && d === 7) return "Giỗ Tổ Hùng Vương";
    }
    // 2026
    if (y === 2026) {
        if (m === 2 && (d >= 17 && d <= 22)) return "Tết Nguyên Đán"; // 1st Tet is 17 Feb 2026
        if (m === 4 && d === 25) return "Giỗ Tổ Hùng Vương"; // 10/3 Lunar = Apr 25
    }

    // Sundays are not holidays by default logic here, just "Weekend"
    return null;
}


// ================= CORE REPORT RENDERING =================

// Cache for current staff's notes (loaded from Firestore)
let _cachedStaffNotes = {};
let _cachedStaffId = null;

function renderPersonalTimesheet() {
    renderMonthReport(currentDate);
}

async function renderMonthReport(date, forceServer = false) {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    // Loading State
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem;">Đang tải dữ liệu chấm công từ hệ thống...</div>';

    const monthDisplay = document.getElementById('report-month-title');
    const totalHoursEl = document.getElementById('total-hours-display');

    const year = date.getFullYear();
    const month = date.getMonth();

    if (monthDisplay) {
        monthDisplay.innerText = `Tháng ${month + 1}, ${year}`;
    }

    // Resolve Context (Who are we viewing?)
    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    let roles = [];
    try { const p = JSON.parse(roleRaw); roles = Array.isArray(p) ? p : [roleRaw]; }
    catch(e) { roles = [roleRaw]; }
    const role = roles[0] || 'staff'; // primary role cho compat
    const isAdminRole = roles.some(r => r === 'admin' || r === 'senior_assistant');
    let staffId = getTargetStaffId();

    // 0. Fetch User Context for Name Matching
    window.currentUserContext = null;
    try {
        const userDoc = await DBService.refs.users().doc(staffId).get();
        if (userDoc.exists) window.currentUserContext = userDoc.data();
    } catch (e) { console.error("Error fetching user context", e); }
    const currentUserContext = window.currentUserContext;

    // --- NEW: Toggle btn-approve-all-bonus10 ---
    const viewerRole = localStorage.getItem('currentRole') || 'staff';
    const viewerRoles = typeof parseRoles === 'function' ? parseRoles(viewerRole) : [viewerRole];
    const isAdminViewer = viewerRoles.some(r => r === 'admin' || r === 'senior_assistant');
    const staffRoles = currentUserContext
        ? (Array.isArray(currentUserContext.roles) && currentUserContext.roles.length > 0
            ? currentUserContext.roles
            : [currentUserContext.role || ''])
        : [];
    const isTeachingAssistant = staffRoles.includes('teaching_assistant');

    const approveAllBtn = document.getElementById('btn-approve-all-bonus10');
    const approveSelectedBtn = document.getElementById('btn-approve-selected-bonus10');
    const selectModeBtn = document.getElementById('btn-select-bonus10-mode');

    if (approveAllBtn) {
        if (isAdminViewer && isTeachingAssistant) {
            approveAllBtn.style.display = 'inline-flex';
        } else {
            approveAllBtn.style.display = 'none';
        }
    }
    if (selectModeBtn) {
        selectModeBtn.style.display = (isAdminViewer && isTeachingAssistant) ? 'inline-flex' : 'none';
    }
    if (approveSelectedBtn) {
        approveSelectedBtn.style.display = (isAdminViewer && isTeachingAssistant && window.isBonus10SelectMode) ? 'inline-flex' : 'none';
    }

    // 0.1 Load Daily Notes from Firestore (cache for this render cycle)
    if (_cachedStaffId !== staffId) {
        try {
            _cachedStaffNotes = await DBService.getDailyNotes(staffId);
            _cachedStaffId = staffId;
        } catch (e) {
            console.error("Error loading notes from Firestore:", e);
            _cachedStaffNotes = {};
        }
    }

    if (!staffId) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: red;">Vui lòng đăng nhập hoặc chọn nhân viên.</div>';
        return;
    }

    // 1. Fetch DATA (Attendance + Schedule)
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    // Fetch Fixed Shifts for the month
    window.savedFixedShiftsMonth = [];
    try {
        window.savedFixedShiftsMonth = await DBService.getFixedShifts(monthStr, staffId);
        // If we are currently IN selection mode, prepopulate the Set on first load
        if (window.isFixedShiftMode && window.selectedFixedShifts.size === 0 && window.savedFixedShiftsMonth.length > 0) {
            window.savedFixedShiftsMonth.forEach(id => window.selectedFixedShifts.add(id));
        }
    } catch(e) { console.error("Could not fetch fixed shifts:", e); }

    // Fetch Cancelled Shifts (Admin specifically excluded)
    let cancelledShifts = [];
    try {
        cancelledShifts = await DBService.getCancelledShifts(monthStr, staffId);
    } catch (e) {
        console.error("Could not fetch cancelled shifts:", e);
    }

    // A. Attendance Logs (Actual Check-in/out)
    // DBService.getMonthlyAttendance returns array of docs with { sessions: [...] }
    const attendanceRecords = await DBService.getMonthlyAttendance(monthStr, staffId, forceServer);

    // Normalize Attendance into a Map: "YYYY-MM-DD" -> [sessions]
    const attendanceMap = {};
    attendanceRecords.forEach(record => {
        // record.date is "YYYY-MM-DD"
        if (record.date) {
            attendanceMap[record.date] = record.sessions || [];
        }
    });

    // D. Overtime Requests for this staff+month
    let overtimeRequestsList = [];
    try {
        overtimeRequestsList = await DBService.getOvertimeRequestsForStaff(staffId, monthStr);
    } catch (e) { console.warn('[OT] Could not load OT requests:', e); }

    // Fetch bonus10 requests cho tháng này
    let bonus10RequestsList = [];
    try {
        bonus10RequestsList = await DBService.getBonus10RequestsForStaff(staffId, monthStr);
    } catch (e) { console.warn('[Bonus10] Could not load requests:', e); }

    // Build bonus10Map: sessionId (string) → request data
    const bonus10Map = {};
    bonus10RequestsList.forEach(req => {
        const key = String(req.sessionId);
        // Ưu tiên: approved > pending > rejected
        const existing = bonus10Map[key];
        if (!existing || req.status === 'approved' || (req.status === 'pending' && existing.status === 'rejected')) {
            bonus10Map[key] = req;
        }
    });

    // Build overtimeDateMap: "YYYY-MM-DD" -> { sessionId -> otData }
    const overtimeDateMap = {};
    overtimeRequestsList.forEach(ot => {
        if (!overtimeDateMap[ot.dateKey]) overtimeDateMap[ot.dateKey] = {};
        const existing = overtimeDateMap[ot.dateKey][ot.sessionId];
        if (!existing || ot.status === 'approved' || (ot.status === 'pending' && existing.status === 'rejected')) {
            overtimeDateMap[ot.dateKey][ot.sessionId] = ot;
        }
    });

    // === AUTO-CLOSE STALE SESSIONS — chạy SAU khi có scheduleMap (xem bên dưới) ===
    const todayKey = getLocalDateKey(new Date());


    // B. Schedule Data (For the whole month)
    // Fetch from BOTH branches (cs1, cs2) and merge
    const BRANCHES = ['cs1', 'cs2', 'cs3'];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const schedulePromises = [];
    for (let d = 1; d <= daysInMonth; d++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        BRANCHES.forEach(branch => {
            const compositeKey = `${branch}__${dateKey}`;
            schedulePromises.push(
                DBService.getSchedule(compositeKey).then(data => ({ date: dateKey, data: data || {}, branch }))
            );
        });
    }
    const scheduleResults = await Promise.all(schedulePromises);
    const scheduleMap = {}; // "YYYY-MM-DD" -> merged ScheduleObject
    scheduleResults.forEach(item => {
        if (!scheduleMap[item.date]) scheduleMap[item.date] = {};
        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
        sections.forEach(sec => {
            const rows = item.data[sec] || [];
            // Inject _branch into each class row for chip display
            const taggedRows = rows.map(row => ({ ...row, _branch: item.branch }));
            if (!scheduleMap[item.date][sec]) scheduleMap[item.date][sec] = [];
            scheduleMap[item.date][sec] = scheduleMap[item.date][sec].concat(taggedRows);
        });
    });

    // === AUTO-CLOSE STALE SESSIONS (chạy sau khi có scheduleMap) ===
    {
        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
        Object.entries(attendanceMap).forEach(([dateKey, sessions]) => {
            if (dateKey >= todayKey) return;
            const sched = scheduleMap[dateKey] || {};
            const [_sy, _sm, _sd] = dateKey.split('-').map(Number);
            sessions.forEach(s => {
                if (!s.checkOut && s.id) {
                    // Tìm giờ kết thúc lịch cho session này
                    let correctEndISO = null;
                    const checkIn = s.checkIn ? new Date(s.checkIn) : null;
                    if (checkIn) {
                        outer: for (const sec of sections) {
                            for (const cls of (sched[sec] || [])) {
                                const isAssigned = (cls.gvId && cls.gvId === staffId) ||
                                    (cls.gvThayTheId && cls.gvThayTheId === staffId) ||
                                    (cls.registeredTeachers || []).some(t => t.id === staffId);
                                if (!isAssigned) continue;
                                const [_h, _m] = cls.start.split(':').map(Number);
                                const clsStart = new Date(_sy, _sm - 1, _sd, _h, _m, 0, 0);
                                if (Math.abs(checkIn - clsStart) < 60 * 60 * 1000) {
                                    correctEndISO = new Date(`${dateKey}T${cls.end}:00`).toISOString();
                                    break outer;
                                }
                            }
                        }
                    }
                    const fallbackISO = new Date(`${dateKey}T23:59:00`).toISOString();
                    const closeISO = correctEndISO || fallbackISO;
                    DBService.autoCloseStaleSession(staffId, dateKey, s.id, closeISO).then(closed => {
                        if (closed) {
                            s.checkOut = closeISO;
                            s.autoClosedReason = 'stale_session';
                        }
                    });
                }
            });
        });
    }

    // C. Receptionist Schedule Data (only for receptionist role staff)
    const receptionistShiftsMap = {}; // "YYYY-MM-DD" -> [{ shift, label, start, end }]
    // FIX: staffRoles đã xử lý đúng cả roles[] lẫn role string — dùng lại thay vì parseRoles()
    // (parseRoles() không handle array từ Firestore, gây isReceptionistStaff = false sai)
    const isReceptionistStaff = currentUserContext && staffRoles.some(r =>
        ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant', 'admin'].includes(r)
    );

    if (isReceptionistStaff) {
        try {
            // 1. Get shift config PER BRANCH
            const shiftConfigMap = {}; // branch -> config
            for (const branch of BRANCHES) {
                shiftConfigMap[branch] = await DBService.getReceptionistShiftConfig(branch);
            }
            const SHIFT_LABELS = { morning: 'SÁNG', afternoon: 'CHIỀU', evening: 'TỐI' };
            const SHIFT_KEYS = ['morning', 'afternoon', 'evening'];
            const DAY_KEYS_MAP = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

            // 2. Calculate which week-start Mondays cover this month
            // Helper: getMonday for a given date
            const getMonday = (d) => {
                const date = new Date(d);
                const day = date.getDay();
                const diff = date.getDate() - day + (day === 0 ? -6 : 1);
                date.setDate(diff);
                date.setHours(0, 0, 0, 0);
                return date;
            };

            const mondaysSet = new Set();
            for (let d = 1; d <= daysInMonth; d++) {
                const dateObj = new Date(year, month, d);
                const monday = getMonday(dateObj);
                const mKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
                mondaysSet.add(mKey);
            }

            // 3. Fetch receptionist schedules for each unique Monday from all branches
            const recepPromises = [];
            const mondaysList = [...mondaysSet];
            BRANCHES.forEach(branch => {
                mondaysList.forEach(mondayKey => {
                    const compositeKey = `${branch}__${mondayKey}`;
                    recepPromises.push(
                        DBService.getReceptionistSchedule(compositeKey).then(data => ({
                            branch,
                            mondayKey,
                            data: data || {}
                        }))
                    );
                });
            });

            const recepResults = await Promise.all(recepPromises);

            // 4. For each day in the month, check if this staff was assigned
            for (let d = 1; d <= daysInMonth; d++) {
                const dateObj = new Date(year, month, d);
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const monday = getMonday(dateObj);
                const mondayKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

                // Calculate day of week index (0=mon, 1=tue, ..., 6=sun)
                const dayOfWeek = dateObj.getDay();
                const dayIdx = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert Sun=0 → 6, Mon=1 → 0, etc.
                const dayKey = DAY_KEYS_MAP[dayIdx];

                // Check all fetched receptionist schedules for this monday + day
                recepResults.forEach(result => {
                    if (result.mondayKey !== mondayKey) return;

                    SHIFT_KEYS.forEach(shiftKey => {
                        const shiftData = result.data[shiftKey];
                        if (!shiftData || !shiftData[dayKey]) return;

                        const staffList = shiftData[dayKey];
                        const staffEntry = staffList.find(s => s.id === staffId);
                        if (!staffEntry) return;

                        // This staff is assigned to this shift on this day!
                        if (!receptionistShiftsMap[dateStr]) receptionistShiftsMap[dateStr] = [];

                        // Use per-branch shift config, with custom times override
                        const branchConfig = shiftConfigMap[result.branch] || {};
                        // Ưu tiên shiftConfig snapshot từ weekData doc, fallback về branch global config
                        const weekShiftConfig = result.data?._shiftConfig?.[shiftKey];
                        const defaultStart = staffEntry.customStart || weekShiftConfig?.start || branchConfig[shiftKey]?.start || '07:00';
                        const defaultEnd = staffEntry.customEnd || weekShiftConfig?.end || branchConfig[shiftKey]?.end || '11:30';

                        // Add entry (allow same shift from different branches as separate entries)
                        receptionistShiftsMap[dateStr].push({
                            shift: shiftKey,
                            label: SHIFT_LABELS[shiftKey],
                            start: staffEntry.customStart || defaultStart,
                            end: staffEntry.customEnd || defaultEnd,
                            branch: result.branch,
                            isFixedShift: staffEntry.isFixedShift ? true : false
                        });
                    });
                });
            }

            console.log('[Report] Receptionist shifts loaded:', Object.keys(receptionistShiftsMap).length, 'days with shifts');
        } catch (e) {
            console.error('[Report] Error loading receptionist schedules:', e);
        }
    }

    // --- NEW: MERGE TOUCHING RECEPTIONIST SHIFTS ---
    if (Object.keys(receptionistShiftsMap).length > 0) {
        Object.keys(receptionistShiftsMap).forEach(dateStr => {
            let dailyShifts = receptionistShiftsMap[dateStr];
            if (dailyShifts.length > 1) {
                // Sort by start time just in case
                dailyShifts.sort((a, b) => a.start.localeCompare(b.start));
                let mergedShifts = [];
                let currentShift = { ...dailyShifts[0] };

                for (let i = 1; i < dailyShifts.length; i++) {
                    let nextShift = dailyShifts[i];
                    // If shifts touch or overlap (e.g., 18:00 >= 18:00)
                    if (currentShift.end >= nextShift.start) {
                        if (nextShift.end > currentShift.end) {
                            currentShift.end = nextShift.end;
                        }
                        currentShift.label = `${currentShift.label} + ${nextShift.label}`;
                    } else {
                        mergedShifts.push(currentShift);
                        currentShift = { ...nextShift };
                    }
                }
                mergedShifts.push(currentShift);
                receptionistShiftsMap[dateStr] = mergedShifts;
            }
        });
    }

    // === AUTO-CLOSE TODAY'S OVERDUE RECEPTIONIST/TEACHER SESSIONS ===
    // If today has an open session and the shift/class has ended, auto-close it
    const todaySessions = attendanceMap[todayKey] || [];
    const nowForAutoClose = new Date();
    todaySessions.forEach(s => {
        if (s.checkOut || !s.id) return;
        const checkInTime = new Date(s.checkIn || s.start);

        // Check receptionist shifts
        const todayRecepShifts = receptionistShiftsMap[todayKey] || [];
        let shiftEnded = false;
        todayRecepShifts.forEach(rs => {
            const shiftStart = new Date(`${todayKey}T${rs.start}`);
            const shiftEnd = new Date(`${todayKey}T${rs.end}`);
            if (Math.abs(checkInTime - shiftStart) < 60 * 60 * 1000 && nowForAutoClose >= shiftEnd) {
                shiftEnded = true;
            }
        });
        if (shiftEnded) {
            DBService.checkOutPersonal(staffId).then(() => {
                s.checkOut = nowForAutoClose.toISOString();
                console.log(`[Report AutoClose] Auto-closed today's overdue session for ${staffId}`);
            }).catch(e => console.warn('[Report AutoClose] Error:', e));
            return;
        }

        // Check teacher classes
        const todaySchedule = scheduleMap[todayKey] || {};
        ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'].forEach(sec => {
            (todaySchedule[sec] || []).forEach(cls => {
                const isRegistered = (cls.gvId && cls.gvId === staffId) ||
                    (cls.registeredTeachers || []).some(t => t.id === staffId);
                if (!isRegistered) return;
                const classStart = new Date(`${todayKey}T${cls.start}`);
                const classEnd = new Date(`${todayKey}T${cls.end}`);
                if (Math.abs(checkInTime - classStart) < 60 * 60 * 1000 && nowForAutoClose >= classEnd) {
                    DBService.checkOutPersonal(staffId).then(() => {
                        s.checkOut = nowForAutoClose.toISOString();
                        console.log(`[Report AutoClose] Auto-closed today's overdue class session for ${staffId}`);
                    }).catch(e => console.warn('[Report AutoClose] Error:', e));
                }
            });
        });
    });

    // 2. CALCULATE & RENDER
    let totalMinutes = 0;
    // let totalSalary = 0; // Moved to calculateSalary()
    window.currentMonthChips = []; // Store for filtering
    grid.innerHTML = '';

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0=Sun

    let startOffset = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

    // Empty Slots
    for (let i = 0; i < startOffset; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-cell disabled';
        grid.appendChild(empty);
    }

    // Days
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const cell = document.createElement('div');
        cell.className = 'calendar-cell';

        // Header
        const dateHeader = document.createElement('div');
        dateHeader.style.display = 'flex';
        dateHeader.style.justifyContent = 'space-between';
        dateHeader.style.marginBottom = '0.5rem';

        // Check if date has a note (from Firestore-cached data)
        const noteText = _cachedStaffNotes[dateStr] || '';
        const hasNote = !!noteText;

        if (hasNote) {
            // Highlighted date number with pin
            dateHeader.innerHTML = `<span style="font-weight: 700; color: var(--primary-color);">📌 ${d}</span>`;
            // Highlight entire cell background
            cell.style.backgroundColor = '#EFF6FF'; // Light blue
            cell.style.borderLeft = '3px solid var(--primary-color)';
        } else {
            dateHeader.innerHTML = `<span style="font-weight: 600;">${d}</span>`;
        }

        // --- HOLIDAY CHECK ---
        const holidayName = getHolidayName(dateStr);
        if (holidayName) {
            const holDiv = document.createElement('div');
            holDiv.style.fontSize = '0.7em';
            holDiv.style.color = '#EF4444';
            holDiv.style.marginTop = '2px';
            holDiv.style.fontWeight = 'bold';
            holDiv.innerText = `🚩 ${holidayName}`;
            dateHeader.appendChild(holDiv);

            // Highlight cell background slightly (holiday takes priority if also has note)
            if (!hasNote) cell.style.backgroundColor = '#FEF2F2';
        }

        // Note Button
        const controlsDiv = document.createElement('div');
        controlsDiv.style.display = 'flex';
        controlsDiv.style.gap = '4px';

        const noteBtn = document.createElement('button');
        noteBtn.innerHTML = '📝';
        noteBtn.className = 'action-btn';
        noteBtn.title = hasNote ? `Ghi chú: ${noteText.substring(0, 50)}...` : 'Thêm ghi chú';
        noteBtn.onclick = () => openNoteModal(dateStr);
        if (hasNote) noteBtn.style.color = 'var(--primary-color)';
        else noteBtn.style.color = '#ccc';

        controlsDiv.appendChild(noteBtn);

        // --- ADMIN ONLY: Manual Add Button ---
        if (isAdminRole) {
            const addBtn = document.createElement('button');
            addBtn.innerHTML = '➕';
            addBtn.className = 'action-btn';
            addBtn.title = 'Chấm công bù/thủ công';
            addBtn.style.color = '#10B981'; // Green
            addBtn.onclick = () => openManualModal(dateStr);
            controlsDiv.appendChild(addBtn);
        }

        dateHeader.appendChild(controlsDiv);
        cell.appendChild(dateHeader);

        // --- Render Chips based on Logic ---
        const dailySchedule = scheduleMap[dateStr] || {};
        const dailyAttendance = attendanceMap[dateStr] || [];
        const dailyReceptionistShifts = receptionistShiftsMap[dateStr] || [];

        const chips = calculateDailyChips(dailySchedule, dailyAttendance, staffId, dateStr, currentUserContext, dailyReceptionistShifts, overtimeDateMap[dateStr] || {}, cancelledShifts, bonus10Map);

        const displayFilterEl = document.getElementById('display-role-filter');
        const displayFilter = displayFilterEl ? displayFilterEl.value : 'all';

        let filteredChips = chips;
        if (displayFilter !== 'all') {
            filteredChips = chips.filter(chip => {
                const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData?.role));
                if (displayFilter === 'tt') return isTT;
                if (displayFilter === 'gv') return !isTT;
                return true;
            });
        }

        const currentRole = localStorage.getItem('currentRole') || 'staff';
        const canRequestBonus10 = ['teaching_assistant', 'admin', 'senior_assistant'].includes(currentRole);
        const isAdminRoleLoop = ['admin', 'senior_assistant'].includes(currentRole);

        filteredChips.forEach(chip => {
            const div = document.createElement('div');
            div.className = `schedule-chip ${chip.class}`;
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';

            div.innerHTML = `<span>${chip.text}</span>`;

            if (chip.isWarning) {
                const warningIcon = document.createElement('span');
                const isAdmin = chip.isAdminCreated;
                warningIcon.innerHTML = isAdmin
                    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
                    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
                warningIcon.style.cssText = 'cursor:pointer;margin-left:4px;display:inline-flex;align-items:center';
                warningIcon.title = isAdmin ? 'Admin đã thêm ca này' : 'Click để xem chi tiết';
                warningIcon.onclick = (e) => {
                    e.stopPropagation();

                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease';
                    overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };

                    const modal = document.createElement('div');
                    modal.style.cssText = 'background:white;border-radius:16px;padding:2rem;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);position:relative;animation:slideUp 0.3s ease';

                    if (chip.isReceptionist && !chip.sessionData) {
                        // === RECEPTIONIST ABSENT SHIFT MODAL ===
                        const schedInfo = chip.schedData || {};
                        modal.innerHTML = `
                            <div style="text-align:center;margin-bottom:1.5rem">
                                <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#FEF2F2;margin-bottom:0.75rem">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                </div>
                                <h3 style="font-size:1.25rem;font-weight:700;color:#1F2937;margin:0">Vắng Ca Tiếp Tân</h3>
                            </div>
                            <div style="background:#F9FAFB;border-radius:12px;padding:1rem;margin-bottom:1rem">
                                <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;align-items:center">
                                    <span style="font-size:1.25rem">📅</span>
                                    <div>
                                        <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ngày</div>
                                        <div style="font-weight:600;color:#1F2937">${dateStr}</div>
                                    </div>
                                </div>
                                <div style="display:flex;gap:1.5rem">
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="font-size:1.25rem">🟢</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ca bắt đầu</div>
                                            <div style="font-weight:600;color:#1F2937">${schedInfo.start || '???'}</div>
                                        </div>
                                    </div>
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="font-size:1.25rem">🔴</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ca kết thúc</div>
                                            <div style="font-weight:600;color:#1F2937">${schedInfo.end || '???'}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div style="background:#FEF2F2;border-radius:12px;padding:1rem;margin-bottom:0.75rem;border-left:3px solid #EF4444">
                                <div style="font-size:0.8rem;font-weight:600;color:#DC2626;margin-bottom:0.25rem">📋 Trạng thái</div>
                                <div style="font-size:0.85rem;color:#7F1D1D">Tiếp tân đã được xếp lịch cho ca này nhưng <strong>không có dữ liệu chấm công</strong>.</div>
                            </div>
                            <div style="background:#ECFDF5;border-radius:12px;padding:1rem;margin-bottom:1.5rem;border-left:3px solid #10B981">
                                <div style="font-size:0.8rem;font-weight:600;color:#059669;margin-bottom:0.25rem">💡 Giải pháp</div>
                                <div style="font-size:0.85rem;color:#065F46">Tiếp tân cần <strong>"Vào Ca"</strong> trên trang Chấm Công trước khi bắt đầu ca, hoặc Admin hãy chấm công bù.</div>
                            </div>
                            <button id="warning-modal-close-btn" style="width:100%;padding:0.75rem;background:var(--primary-color, #3B82F6);color:white;border:none;border-radius:10px;font-size:0.95rem;font-weight:600;cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Đã hiểu</button>
                        `;
                    } else if (isAdmin) {
                        // Admin-created session modal
                        const s = chip.sessionData || {};
                        const startTime = s.checkIn ? new Date(s.checkIn).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';
                        const endTime = s.checkOut ? new Date(s.checkOut).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Chưa ra ca';
                        modal.innerHTML = `
                            <div style="text-align:center;margin-bottom:1.5rem">
                                <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#EFF6FF;margin-bottom:0.75rem">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                                </div>
                                <h3 style="font-size:1.25rem;font-weight:700;color:#1F2937;margin:0">Ca Được Admin Thêm</h3>
                            </div>
                            <div style="background:#F9FAFB;border-radius:12px;padding:1rem;margin-bottom:1rem">
                                <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;align-items:center">
                                    <span style="font-size:1.25rem">📅</span>
                                    <div>
                                        <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ngày</div>
                                        <div style="font-weight:600;color:#1F2937">${dateStr}</div>
                                    </div>
                                </div>
                                <div style="display:flex;gap:1.5rem">
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="font-size:1.25rem">🟢</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Vào ca</div>
                                            <div style="font-weight:600;color:#1F2937">${startTime}</div>
                                        </div>
                                    </div>
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="font-size:1.25rem">🔴</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ra ca</div>
                                            <div style="font-weight:600;color:#1F2937">${endTime}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div style="background:#EFF6FF;border-radius:12px;padding:1rem;margin-bottom:1.5rem;border-left:3px solid #3B82F6">
                                <div style="font-size:0.8rem;font-weight:600;color:#2563EB;margin-bottom:0.25rem">🛠️ Thông tin</div>
                                <div style="font-size:0.85rem;color:#1E40AF">Ca này được <strong>Quản lý thêm thủ công</strong>. Nếu chưa chọn vai trò, hãy bấm vào chip để chọn.</div>
                            </div>
                            <button id="warning-modal-close-btn" style="width:100%;padding:0.75rem;background:#3B82F6;color:white;border:none;border-radius:10px;font-size:0.95rem;font-weight:600;cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Đã hiểu</button>
                        `;
                    } else if (!chip.sessionData && chip.schedData) {
                        // Teacher absent chip (has schedData, no sessionData)
                        const schedInfo = chip.schedData || {};
                        modal.innerHTML = `
                            <div style="text-align:center;margin-bottom:1.5rem">
                                <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#FEF2F2;margin-bottom:0.75rem">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                </div>
                                <h3 style="font-size:1.25rem;font-weight:700;color:#1F2937;margin:0">Vắng Ca</h3>
                            </div>
                            <div style="background:#F9FAFB;border-radius:12px;padding:1rem;margin-bottom:1rem">
                                <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;align-items:center">
                                    <span style="font-size:1.25rem">📅</span>
                                    <div>
                                        <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ngày</div>
                                        <div style="font-weight:600;color:#1F2937">${dateStr}</div>
                                    </div>
                                </div>
                                <div style="display:flex;gap:1.5rem">
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="font-size:1.25rem">🟢</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Giờ bắt đầu</div>
                                            <div style="font-weight:600;color:#1F2937">${schedInfo.start || '???'}</div>
                                        </div>
                                    </div>
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="font-size:1.25rem">🔴</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Giờ kết thúc</div>
                                            <div style="font-weight:600;color:#1F2937">${schedInfo.end || '???'}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div style="background:#FEF2F2;border-radius:12px;padding:1rem;margin-bottom:0.75rem;border-left:3px solid #EF4444">
                                <div style="font-size:0.8rem;font-weight:600;color:#DC2626;margin-bottom:0.25rem">📋 Trạng thái</div>
                                <div style="font-size:0.85rem;color:#7F1D1D">Đã nhận lớp nhưng <strong>không có dữ liệu chấm công</strong>.</div>
                            </div>
                            <div style="background:#ECFDF5;border-radius:12px;padding:1rem;margin-bottom:1.5rem;border-left:3px solid #10B981">
                                <div style="font-size:0.8rem;font-weight:600;color:#059669;margin-bottom:0.25rem">💡 Giải pháp</div>
                                <div style="font-size:0.85rem;color:#065F46">Trợ giảng cần <strong>"Vào Ca"</strong> trên trang Chấm Công trước khi bắt đầu lớp, hoặc Admin hãy chấm công bù.</div>
                            </div>
                            <button id="warning-modal-close-btn" style="width:100%;padding:0.75rem;background:var(--primary-color, #3B82F6);color:white;border:none;border-radius:10px;font-size:0.95rem;font-weight:600;cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Đã hiểu</button>
                        `;
                    } else {
                        // Regular "Ca Ngoài Lịch" modal (has sessionData)
                        const s = chip.sessionData || {};
                        const startTime = s.checkIn ? new Date(s.checkIn).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';
                        const endTime = s.checkOut ? new Date(s.checkOut).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Chưa ra ca';
                        modal.innerHTML = `
                            <div style="text-align:center;margin-bottom:1.5rem">
                                <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#FEF2F2;margin-bottom:0.75rem">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                </div>
                                <h3 style="font-size:1.25rem;font-weight:700;color:#1F2937;margin:0">Ca Ngoài Lịch</h3>
                            </div>
                            <div style="background:#F9FAFB;border-radius:12px;padding:1rem;margin-bottom:1rem">
                                <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;align-items:center">
                                    <span style="font-size:1.25rem">📅</span>
                                    <div>
                                        <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ngày</div>
                                        <div style="font-weight:600;color:#1F2937">${dateStr}</div>
                                    </div>
                                </div>
                                <div style="display:flex;gap:1.5rem">
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="font-size:1.25rem">🟢</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Vào ca</div>
                                            <div style="font-weight:600;color:#1F2937">${startTime}</div>
                                        </div>
                                    </div>
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="font-size:1.25rem">🔴</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ra ca</div>
                                            <div style="font-weight:600;color:#1F2937">${endTime}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div style="background:#FEF2F2;border-radius:12px;padding:1rem;margin-bottom:0.75rem;border-left:3px solid #EF4444">
                                <div style="font-size:0.8rem;font-weight:600;color:#DC2626;margin-bottom:0.25rem">📋 Lý do</div>
                                <div style="font-size:0.85rem;color:#7F1D1D">Thời gian chấm công không khớp với bất kỳ lớp/ca nào trong lịch đã xếp.</div>
                            </div>
                            <div style="background:#ECFDF5;border-radius:12px;padding:1rem;margin-bottom:1.5rem;border-left:3px solid #10B981">
                                <div style="font-size:0.8rem;font-weight:600;color:#059669;margin-bottom:0.25rem">💡 Giải pháp</div>
                                <div style="font-size:0.85rem;color:#065F46">Trợ giảng cần <strong>"Nhận Lớp"</strong> trong mục Lịch Làm, hoặc Tiếp tân cần được Admin <strong>xếp lịch</strong> trước khi Vào Ca.</div>
                            </div>
                            <button id="warning-modal-close-btn" style="width:100%;padding:0.75rem;background:var(--primary-color, #3B82F6);color:white;border:none;border-radius:10px;font-size:0.95rem;font-weight:600;cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Đã hiểu</button>
                        `;
                    }
                    overlay.appendChild(modal);
                    document.body.appendChild(overlay);
                    document.getElementById('warning-modal-close-btn').onclick = () => overlay.remove();
                };
                div.appendChild(warningIcon);
            }

            // --- NÚT SỚM 10P (per-chip, không cần selection mode) ---
            const roleRaw2 = localStorage.getItem('currentRole') || 'staff';
            let roles2 = [];
            try { const p = JSON.parse(roleRaw2); roles2 = Array.isArray(p) ? p : [roleRaw2]; }
            catch(e) { roles2 = [roleRaw2]; }
            
            // Fix: CHỈ hiện nút thưởng 10p khi nhân viên ĐƯỢC XEM là Trợ giảng/GV TA
            // Admin xem nhân viên không phải TA → không hiện
            const _targetCtx = window.currentUserContext;
            const _targetRoles = _targetCtx
                ? (Array.isArray(_targetCtx.roles) && _targetCtx.roles.length > 0
                    ? _targetCtx.roles
                    : [_targetCtx.role || ''])
                : [];
            const isTargetTA = _targetRoles.includes('teaching_assistant');
            const allowedRoles = ['teaching_assistant', 'admin', 'senior_assistant'];
            const canSeeBonus10 = roles2.some(r => allowedRoles.includes(r)) && !chip.isReceptionist && isTargetTA;
            const isAdminRole2 = roles2.some(r => ['admin','senior_assistant'].includes(r));

            if (canSeeBonus10 && chip.sessionId &&
                chip.class !== 'chip-blue' &&
                chip.class !== 'chip-gray' &&
                chip.class !== 'chip-future' &&
                chip.class !== 'chip-waiting') {

                const b10Btn = document.createElement('button');
                b10Btn.style.cssText = 'font-size:0.68rem;padding:1px 5px;border-radius:4px;border:none;cursor:pointer;margin-left:2px;vertical-align:middle;';

                const b10Status = chip.bonus10Status;
                const hasBonus = chip.sessionData && chip.sessionData.bonus10;

                if (b10Status === 'approved' || hasBonus) {
                    b10Btn.innerHTML = '⭐+10p';
                    b10Btn.style.background = '#D1FAE5';
                    b10Btn.style.color = '#059669';
                    b10Btn.disabled = true;
                    b10Btn.title = 'Đã được thưởng 10p';
                } else if (b10Status === 'pending') {
                    if (isAdminRole2) {
                        // Checkbox để multi-select
                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.style.cssText = 'margin-right:2px;cursor:pointer;vertical-align:middle;';
                        cb.dataset.bonus10Id = chip.bonus10Id;
                        cb.dataset.sessionId = chip.sessionId;
                        cb.dataset.dateStr = dateStr;
                        cb.dataset.staffId = staffId;
                        cb.className = 'bonus10-pending-cb';
                        cb.style.display = window.isBonus10SelectMode ? 'inline' : 'none';
                        cb.title = 'Chọn để duyệt hàng loạt';
                        cb.onclick = (e) => e.stopPropagation();
                        div.appendChild(cb);

                        b10Btn.innerHTML = '⭐ Duyệt';
                        b10Btn.style.background = '#FEF3C7';
                        b10Btn.style.color = '#D97706';
                        b10Btn.title = 'Duyệt thưởng 10p cho ca này';
                        b10Btn.onclick = (e) => {
                            e.stopPropagation();
                            approveBonus10(chip.bonus10Id, chip.sessionId, dateStr, staffId);
                        };
                    } else {
                        b10Btn.innerHTML = '⭐ Chờ duyệt';
                        b10Btn.style.background = '#FEF3C7';
                        b10Btn.style.color = '#D97706';
                        b10Btn.disabled = true;
                        b10Btn.title = 'Đang chờ admin duyệt';
                    }
                } else {
                    // Chưa có hoặc bị reject → cho submit
                    b10Btn.innerHTML = '⭐ Sớm 10p';
                    b10Btn.style.background = b10Status === 'rejected' ? '#FEE2E2' : '#F3F4F6';
                    b10Btn.style.color = b10Status === 'rejected' ? '#DC2626' : '#6B7280';
                    b10Btn.title = b10Status === 'rejected' ? 'Bị từ chối — bấm để gửi lại' : 'Yêu cầu thưởng 10p vào sớm';
                    b10Btn.onclick = (e) => {
                        e.stopPropagation();
                        submitBonus10Request(chip.sessionId, dateStr, staffId);
                    };
                }

                div.appendChild(b10Btn);
            }

            div.title = `${chip.tooltip} (${chip.paidMinutes}m)`;

            // Look for existing saved fixed shift or selected one
            const isFixed = chip.isFixedShift || (window.savedFixedShiftsMonth && window.savedFixedShiftsMonth.includes(chip.sessionId));
            chip.isFixedShift = isFixed;
            if (isFixed && !window.isFixedShiftMode) {
               div.innerHTML = `<span>${chip.text} <b>(CĐ)</b></span>`;
               div.style.border = '2px solid #8B5CF6'; 
            }

            // --- Role Selection / Bonus/Fixed Click Handler ---
            const isClickable = chip.isClickable || window.isBonusSelectMode || window.isFixedShiftMode;
            if (isClickable) {
                div.style.cursor = 'pointer';
                if (window.isBonusSelectMode) {
                    div.style.border = '2px dashed #10B981';
                } else if (window.isFixedShiftMode && chip.isReceptionist) {
                    // Only Receptionist shifts can be selected as Fixed
                    const isSelected = window.selectedFixedShifts.has(chip.sessionId);
                    div.style.border = isSelected ? '3px solid #6366F1' : '2px dashed #6366F1';
                    if (isSelected) div.style.background = '#E0E7FF'; // Highlight selected
                }
                
                div.onclick = async (e) => {
                    e.stopPropagation();
                    if (window.isBonusSelectMode) {
                        if (chip.sessionId) {
                            try {
                                const btn = e.currentTarget;
                                btn.style.opacity = '0.5';
                                await DBService.toggleSessionBonus10(staffId, dateStr, chip.sessionId);
                                if (typeof UIService !== 'undefined') UIService.toast("Đã cập nhật thưởng 10p!", "success");
                                renderMonthReport(currentDate); // re-render
                            } catch (err) {
                                if (typeof UIService !== 'undefined') UIService.toast(err.message || 'Lỗi', 'error');
                            }
                        } else {
                            if (typeof UIService !== 'undefined') UIService.toast('Ca này chưa có dữ liệu vào ra.', 'warning');
                        }
                    } else if (window.isFixedShiftMode) {
                        if (chip.isReceptionist && chip.sessionId) {
                            if (window.selectedFixedShifts.has(chip.sessionId)) {
                                window.selectedFixedShifts.delete(chip.sessionId);
                            } else {
                                window.selectedFixedShifts.add(chip.sessionId);
                            }
                            renderMonthReport(currentDate);
                        } else {
                            if (typeof UIService !== 'undefined') UIService.toast('Chỉ có thể chọn các ca tiếp tân có dữ liệu vào ra.', 'warning');
                        }
                    } else if (chip.isClickable) {
                        if (chip.sessionId) {
                            openRoleSelectModal(dateStr, chip.sessionData);
                        } else if (isAdminRole) {
                            // Creating new session from Registration, pass shift metadata so admin can delete this shift
                            openManualModal(
                                dateStr, 
                                chip.schedData,
                                chip.classCompositeKey,
                                chip.classSectionKey,
                                chip.classIndex,
                                chip.isReceptionist || chip.isTeaching
                            );
                        }
                    }
                };
            }

            // Store for calculation
            if (chip.paidMinutes > 0) {
                window.currentMonthChips.push(chip);
            }

            // Add Edit Icon for Admin if there is an underlying session
            if (isAdminRole && chip.sessionId) {
                const editBtn = document.createElement('span');
                editBtn.innerHTML = '✏️';
                editBtn.style.cursor = 'pointer';
                editBtn.style.fontSize = '0.8em';
                editBtn.style.marginLeft = '4px';
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    openEditModal(
                        dateStr, 
                        chip.sessionId, 
                        chip.sessionData, 
                        chip.classStart, 
                        chip.classCompositeKey, 
                        chip.classSectionKey, 
                        chip.classIndex,
                        chip.isReceptionist
                    );
                };
                div.appendChild(editBtn);

                // Admin: if this chip has a pending overtime, show Confirm/Reject buttons
                if (chip.overtimePending && chip.overtimeId) {
                    const confirmBtn = document.createElement('span');
                    confirmBtn.innerHTML = '✅';
                    confirmBtn.title = 'Xác nhận tăng ca';
                    confirmBtn.style.cssText = 'cursor:pointer;font-size:0.85em;margin-left:4px;';
                    confirmBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (!await UIService.confirm('Xác nhận giờ tăng ca này?')) return;
                        const adminName = localStorage.getItem('currentUserName') || 'Admin';
                        await DBService.approveOvertimeRequest(chip.overtimeId, adminName);
                        _cachedStaffId = null;
                        renderMonthReport(currentDate);
                    };
                    div.appendChild(confirmBtn);

                    const rejectBtn = document.createElement('span');
                    rejectBtn.innerHTML = '❌';
                    rejectBtn.title = 'Từ chối tăng ca';
                    rejectBtn.style.cssText = 'cursor:pointer;font-size:0.85em;margin-left:2px;';
                    rejectBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (!await UIService.confirm('Từ chối yêu cầu tăng ca này?')) return;
                        const adminName = localStorage.getItem('currentUserName') || 'Admin';
                        await DBService.rejectOvertimeRequest(chip.overtimeId, adminName);
                        _cachedStaffId = null;
                        renderMonthReport(currentDate);
                    };
                    div.appendChild(rejectBtn);
                }
            }

            // Staff: add ⏱️ Overtime Request button on completed sessions with no pending OT
            if (role !== 'admin' && chip.sessionId && chip.sessionData && chip.sessionData.checkOut && !chip.overtimePending && !chip.overtimeMinutes) {
                const otBtn = document.createElement('span');
                otBtn.innerHTML = '⏱️';
                otBtn.title = 'Yêu cầu tăng ca';
                otBtn.style.cssText = 'cursor:pointer;font-size:0.85em;margin-left:4px;opacity:0.6;';
                otBtn.onmouseover = () => otBtn.style.opacity = '1';
                otBtn.onmouseout = () => otBtn.style.opacity = '0.6';
                otBtn.onclick = (e) => {
                    e.stopPropagation();
                    openOvertimeModal(dateStr, chip.sessionId, chip.sessionData);
                };
                div.appendChild(otBtn);
            }

            cell.appendChild(div);

            totalMinutes += chip.paidMinutes;

            // --- SALARY ACCUMULATION ---
            // Moved to calculateSalary() via window.currentMonthChips
        });

        // --- Daily Total Footer ---
        const dailyTotalMinutes = filteredChips.reduce((acc, chip) => acc + (chip.paidMinutes || 0), 0);
        if (dailyTotalMinutes > 0) {
            const h = Math.floor(dailyTotalMinutes / 60);
            const m = Math.floor(dailyTotalMinutes % 60);

            const footer = document.createElement('div');
            // Remove margin-top auto to test visibility
            footer.style.marginTop = '0.5rem';
            footer.style.padding = '4px 8px';
            footer.style.borderRadius = '4px';
            footer.style.backgroundColor = '#F3F4F6'; // Light gray bg
            footer.style.border = '1px solid #D1D5DB';
            footer.style.fontSize = '0.75rem';
            footer.style.fontWeight = '700';
            footer.style.color = '#7C3AED'; // Violet text
            footer.style.textAlign = 'right';

            // Explicit text node to avoid innerText quirks
            footer.textContent = `Tổng: ${h}h ${m}p`;

            cell.appendChild(footer);
        }

        grid.appendChild(cell);
    }

    // Update Totals
    if (totalHoursEl) {
        const h = Math.floor(totalMinutes / 60);
        const m = Math.floor(totalMinutes % 60);
        totalHoursEl.innerText = `Tổng giờ làm: ${h} giờ ${m} phút`;
    }

    // Update Salary (Admin)
    window.lastTotalMinutes = totalMinutes;
    // window.currentMonthSalary set by calculateSalary()

    if (isAdminRole) {
        loadSalarySettings();
    }
}

// calculateDailyChips() → Moved to evaluation-service.js

// ================= SALARY CALCULATION & EVALUATION =================
// EVALUATION_CRITERIA → Moved to evaluation-service.js

let currentEvalIndex = null;

function renderEvaluationTable(savedData = []) {
    const section = document.getElementById('evaluation-section');
    if (!section) return;

    const role = localStorage.getItem('currentRole');
    const showEval = (role === 'admin'); // Only admin sees evaluation table
    section.style.display = showEval ? 'block' : 'none';
    if (!showEval) return;

    const thead = document.getElementById('eval-thead');
    const tbody = document.getElementById('evaluation-table-body');
    if (!tbody || !thead) return;

    // Headers
    let headerHtml = '<tr><th style="padding: 0.5rem; border: 1px solid #e5e7eb; width: 100px;">Nội dung</th>';
    EVALUATION_CRITERIA.forEach(item => {
        headerHtml += `<th style="padding: 0.5rem; border: 1px solid #e5e7eb; text-align: center;" title="${item.tooltip}">${item.label}</th>`;
    });
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;

    // Rows
    let totalBonus = 0;
    let trAmount = '<tr><td style="padding: 0.5rem; font-weight: 600;">Thưởng/Phạt</td>';
    let trNote = '<tr><td style="padding: 0.5rem; font-weight: 600;">Ghi chú</td>';

    EVALUATION_CRITERIA.forEach((item, index) => {
        const rowData = savedData[index] || {};
        const note = rowData.note || '';
        const amount = rowData.amount !== undefined ? rowData.amount : item.default;

        totalBonus += Number(amount);

        trAmount += `
            <td style="padding: 0.25rem; border: 1px solid #e5e7eb;">
                <input type="number" class="table-input eval-amount" 
                    value="${amount}" step="1000" data-index="${index}" oninput="calculateSalary()"
                    style="width: 100%; text-align: center; border: none; background: transparent; font-weight: 600;">
            </td>`;

        const noteBtnColor = note ? 'var(--primary-color)' : '#9ca3af';
        trNote += `
            <td style="padding: 0.25rem; border: 1px solid #e5e7eb; text-align: center;">
                <input type="hidden" class="eval-note" value="${note.replace(/"/g, '&quot;')}" data-index="${index}">
                <button type="button" onclick="openEvalNoteModal(${index})" style="background: none; border: none; cursor: pointer; color: ${noteBtnColor};" title="${note || 'Thêm ghi chú'}">
                   📝
                </button>
            </td>`;
    });

    trAmount += '</tr>';
    trNote += '</tr>';
    tbody.innerHTML = trAmount + trNote;

    updateBonusDisplay(totalBonus);
}

function updateBonusDisplay(amount) {
    const summaryInput = document.getElementById('summary-bonus-penalty');
    if (summaryInput) {
        summaryInput.value = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
        summaryInput.style.color = amount >= 0 ? 'var(--primary-color)' : '#EF4444';
    }
}

function calculateSalary() {
    // 1. Get Settings
    const roleFilter = document.getElementById('salary-role-filter') ? document.getElementById('salary-role-filter').value : 'all';

    // 2. Filter Chips & Calculate Minutes
    const hoursDisplay = document.getElementById('role-hours-display');
    if (hoursDisplay) hoursDisplay.innerText = "Đang xử lý...";

    let filteredMinutes = 0;
    let filteredSalary = 0; // Accumulate salary based on role rates
    const allChips = window.currentMonthChips || [];

    // Breakdown: teaching vs receptionist (for Item 7 — Tách giờ Trợ giảng)
    let teachingMinutes = 0;
    let receptionistMinutes = 0;
    allChips.forEach(chip => {
        const mins = chip.paidMinutes || 0;
        const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData?.role));
        if (isTT) receptionistMinutes += mins;
        else if (chip.isTeaching || (chip.sessionData && chip.sessionData.role)) teachingMinutes += mins;
    });
    const taBreakdown = document.getElementById('ta-hours-breakdown');
    if (taBreakdown) {
        if (teachingMinutes > 0 && receptionistMinutes > 0) {
            taBreakdown.style.display = 'block';
            const th = Math.floor(teachingMinutes / 60), tm = Math.floor(teachingMinutes % 60);
            const rh = Math.floor(receptionistMinutes / 60), rm = Math.floor(receptionistMinutes % 60);
            const td = document.getElementById('ta-teaching-hours');
            const rd = document.getElementById('ta-receptionist-hours');
            if (td) td.innerText = `Dạy: ${th}h ${tm}p`;
            if (rd) rd.innerText = `TT: ${rh}h ${rm}p`;
        } else {
            taBreakdown.style.display = 'none';
        }
    }

    // --- NEW: Calculate Fixed Shift stats globally ---
    let fixedWorkedCount = 0;
    let fixedAbsentCount = 0;
    allChips.forEach(chip => {
        let isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
        if (isTiepTan && chip.isFixedShift) {
            if (chip.sessionId) {
                fixedWorkedCount++;
            } else if (chip.class !== 'chip-future') {
                fixedAbsentCount++;
            }
        }
    });

    window.fixedWorkedCount = fixedWorkedCount;
    window.fixedAbsentCount = fixedAbsentCount;

    // Debug
    console.log("Calculating Salary. Filters:", roleFilter, "Chips:", allChips.length);

    if (roleFilter === 'all') {
        // Fallback to pre-calculated total if chips are empty (happens during initial render sometimes)
        if (window.lastTotalMinutes !== undefined && allChips.length === 0) {
            filteredMinutes = window.lastTotalMinutes;
            // Cannot calculate salary accurately without chips if they are empty, but usually they are not empty if we are here.
            filteredSalary = 0;
        } else {
            allChips.forEach(chip => {
                const minutes = chip.paidMinutes || 0;
                filteredMinutes += minutes;

                // Calculate Money
                let rate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;

                let isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
                if (isTiepTan && window.currentUserContext && window.currentUserContext.salary_config) {
                    const cfg = window.currentUserContext.salary_config;
                    let chipSalary = 0;
                    if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                        chip.mergedSegments.forEach(seg => {
                            const segMinutes = seg.schedMinutes || 0;
                            const segRate = seg.isFixedShift
                                ? Number(cfg.receptionist_fixed_rate || 0)
                                : Number(cfg.receptionist_normal_rate || 0);
                            chipSalary += (segMinutes / 60) * segRate;
                        });
                    } else {
                        const segRate = chip.isFixedShift
                            ? Number(cfg.receptionist_fixed_rate || 0)
                            : Number(cfg.receptionist_normal_rate || 0);
                        chipSalary += (minutes / 60) * segRate;
                    }
                    filteredSalary += chipSalary;
                } else {
                    filteredSalary += (minutes / 60) * rate;
                }
            });
        }
    } else {
        const filterType = roleFilter; // normalize var name to match PDF logic copy-paste convenience

        allChips.forEach(chip => {
            let include = false;

            // Logic copied from exportSalaryPDF to ensure consistency
            if (filterType === 'all') {
                include = true;
            } else if (filterType === 'giao-vien') {
                // Check Role Name/ID for keywords like in PDF
                const chipRole = (chip.sessionData && chip.sessionData.role) ? chip.sessionData.role : '';
                const roleName = (chip.sessionData && chip.sessionData.roleName) ? chip.sessionData.roleName.toLowerCase() : '';
                const normalizedApps = removeVietnameseTones(roleName);

                // Exclude Reception keys
                const isReceptionID = ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chipRole);
                if (isReceptionID || normalizedApps.includes('tiep') || normalizedApps.includes('le') || normalizedApps.includes('reception')) {
                    include = false;
                }
                // Include Teaching keys
                else if (chip.isTeaching || chipRole === 'giao-vien' || normalizedApps.includes('gv') || normalizedApps.includes('giao') || normalizedApps.includes('tro') || normalizedApps.includes('ta')) {
                    // Default assumption or explicit match
                    include = true;
                }
            } else if (filterType === 'tiep-tan') {
                const chipRole = (chip.sessionData && chip.sessionData.role) ? chip.sessionData.role : '';
                const roleName = (chip.sessionData && chip.sessionData.roleName) ? chip.sessionData.roleName.toLowerCase() : '';
                const normalizedApps = removeVietnameseTones(roleName);

                const isReceptionID = ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chipRole);
                if (isReceptionID || normalizedApps.includes('tiep') || normalizedApps.includes('le') || normalizedApps.includes('reception')) {
                    include = true;
                }
            }

            if (include) {
                const minutes = chip.paidMinutes || 0;
                filteredMinutes += minutes;

                // Calculate Money
                let rate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;

                let isTiepTan = chip.isReceptionist || (chip.sessionData && chip.sessionData.role === 'tiep-tan');
                if (isTiepTan && window.currentUserContext && window.currentUserContext.salary_config) {
                    const cfg = window.currentUserContext.salary_config;
                    let chipSalary = 0;
                    if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                        chip.mergedSegments.forEach(seg => {
                            const segMinutes = seg.schedMinutes || 0;
                            const segRate = seg.isFixedShift
                                ? Number(cfg.receptionist_fixed_rate || 0)
                                : Number(cfg.receptionist_normal_rate || 0);
                            chipSalary += (segMinutes / 60) * segRate;
                        });
                    } else {
                        const segRate = chip.isFixedShift
                            ? Number(cfg.receptionist_fixed_rate || 0)
                            : Number(cfg.receptionist_normal_rate || 0);
                        chipSalary += (minutes / 60) * segRate;
                    }
                    filteredSalary += chipSalary;
                } else {
                    filteredSalary += (minutes / 60) * rate;
                }
            }
        });
    }

    // 3. Update UI Display for Hours
    if (hoursDisplay) {
        const h = Math.floor(filteredMinutes / 60);
        const m = Math.floor(filteredMinutes % 60);

        let label = "Tổng giờ: ";
        if (roleFilter === 'tiep-tan') label = "Giờ Tiếp Tân: ";
        if (roleFilter === 'giao-vien') label = "Giờ Dạy: ";

        hoursDisplay.innerText = `${label}${h}h ${m}p`;
        
        // Render Fixed Shift stats
        let fixedStatsEl = document.getElementById('fixed-shift-stats');
        if (!fixedStatsEl) {
            fixedStatsEl = document.createElement('div');
            fixedStatsEl.id = 'fixed-shift-stats';
            fixedStatsEl.style.fontSize = '0.85rem';
            fixedStatsEl.style.marginTop = '6px';
            fixedStatsEl.style.color = '#4F46E5';
            fixedStatsEl.style.fontWeight = '600';
            hoursDisplay.parentNode.appendChild(fixedStatsEl);
        }
        
        if (fixedWorkedCount > 0 || fixedAbsentCount > 0) {
            fixedStatsEl.innerHTML = `[Ca Cố Định] Đi làm: <span style="color:#059669">${fixedWorkedCount}</span> | OFF: <span style="color:#DC2626">${fixedAbsentCount}</span>`;
            fixedStatsEl.style.display = 'block';
        } else {
            fixedStatsEl.style.display = 'none';
        }
    }

    // 4. Calculate Total Money
    let totalBonus = 0;
    const evalAmounts = document.querySelectorAll('.eval-amount');
    const evalNotes = document.querySelectorAll('.eval-note');

    // --- AUTO-CALCULATE ATTENDANCE BONUS (Criteria I) ---
    const cfg = window.currentUserContext?.salary_config || {};
    const attRate = Number(cfg.attendance_rate || 0);
    if (attRate > 0 && evalAmounts.length > 0) {
        const attInp = evalAmounts[0];
        const calculatedBonus = Math.round((filteredMinutes / 60) * attRate);
        
        // Update input value
        attInp.value = calculatedBonus;
        
        // Also update note if empty or contains previous auto-calculation
        const attNote = evalNotes[0];
        const autoNotePrefix = "Thưởng chuyên cần:";
        if (attNote && (!attNote.value || attNote.value.startsWith(autoNotePrefix))) {
            attNote.value = `${autoNotePrefix} ${attRate.toLocaleString()}đ/h x ${(filteredMinutes/60).toFixed(1)}h`;
            // Update button color/title if possible (though it's usually handled by renderEvaluationTable)
        }
    }

    evalAmounts.forEach(input => {
        totalBonus += parseFloat(input.value) || 0;
    });

    updateBonusDisplay(totalBonus);

    // Store base salary for Export PDF
    window.currentMonthSalary = filteredSalary;

    const totalSalary = filteredSalary + totalBonus;

    const finalDisplay = document.getElementById('final-salary-display');
    // Hide salary amount for senior_assistant
    const currentRole = localStorage.getItem('currentRole');
    if (finalDisplay) {
        if (currentRole === 'senior_assistant') {
            finalDisplay.innerText = '******';
        } else {
            finalDisplay.innerText = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalSalary);
        }
    }

    // Check Advance field
    // const advanceInput = document.getElementById('salary-advance');
    // const advance = advanceInput ? (parseFloat(advanceInput.value) || 0) : 0;
}

async function saveSalarySettings() {
    const staffId = document.getElementById('staff-select').value;
    if (staffId === 'all') return;

    const rate = 0; // Legacy
    const advance = document.getElementById('salary-advance').value || 0;
    const evaluationData = [];

    document.querySelectorAll('.eval-note').forEach((noteInp, index) => {
        const amountInp = document.querySelector(`.eval-amount[data-index="${index}"]`);
        evaluationData.push({
            id: index,
            note: noteInp.value,
            amount: parseFloat(amountInp.value) || 0
        });
    });

    const settingsObj = { rate, advance, evaluation: evaluationData };

    try {
        // Save to Firestore for cross-account sync
        await DBService.saveSalarySettings(staffId, settingsObj);
        // Also keep localStorage as fallback
        const allSettings = JSON.parse(localStorage.getItem('salary_settings')) || {};
        allSettings[staffId] = settingsObj;
        localStorage.setItem('salary_settings', JSON.stringify(allSettings));
        alert('Đã lưu bảng lương!');
    } catch (e) {
        console.error('Error saving salary settings to Firestore:', e);
        alert('Lỗi khi lưu bảng lương. Vui lòng thử lại.');
    }
}

async function loadSalarySettings() {
    const staffId = document.getElementById('staff-select').value;

    let settings = {};
    try {
        // Load from Firestore first
        settings = await DBService.getSalarySettings(staffId);
    } catch (e) {
        console.error('Error loading salary settings from Firestore:', e);
        // Fallback to localStorage
        const allSettings = JSON.parse(localStorage.getItem('salary_settings')) || {};
        settings = allSettings[staffId] || {};
    }

    document.getElementById('salary-advance').value = settings.advance || 0;
    renderEvaluationTable(settings.evaluation || []);
    calculateSalary();
}

// ================= NOTES =================

let currentNoteDateKey = null;

function openNoteModal(dateKey) {
    currentNoteDateKey = dateKey;
    currentEvalIndex = null;

    // Use cached notes from Firestore
    document.getElementById('note-modal-title').innerText = `Ghi Chú Ngày ${dateKey}`;
    document.getElementById('note-content').value = _cachedStaffNotes[dateKey] || '';
    document.getElementById('note-modal').style.display = 'flex';
}

function openEvalNoteModal(index) {
    currentEvalIndex = index;
    currentNoteDateKey = null;

    const noteInput = document.querySelector(`.eval-note[data-index="${index}"]`);
    let currentVal = noteInput ? noteInput.value : '';

    if (!currentVal || currentVal.trim() === '') {
        const item = EVALUATION_CRITERIA[index];
        if (item && item.template) currentVal = item.template;
    }

    document.getElementById('note-modal-title').innerText = `Ghi Chú: ${EVALUATION_CRITERIA[index].tooltip}`;
    document.getElementById('note-content').value = currentVal;
    document.getElementById('note-modal').style.display = 'flex';
}

function closeNoteModal() {
    document.getElementById('note-modal').style.display = 'none';
}

function saveNote() {
    if (currentNoteDateKey) saveCalendarNote();
    else if (currentEvalIndex !== null) saveEvaluationNote();
}

async function saveCalendarNote() {
    const staffId = getTargetStaffId();
    const note = document.getElementById('note-content').value.trim();

    // Update local cache immediately
    if (note) _cachedStaffNotes[currentNoteDateKey] = note;
    else delete _cachedStaffNotes[currentNoteDateKey];

    // Save to Firestore
    try {
        await DBService.saveDailyNotes(staffId, _cachedStaffNotes);
    } catch (e) {
        console.error('Error saving note to Firestore:', e);
    }

    closeNoteModal();
    renderMonthReport(currentDate);
}

function saveEvaluationNote() {
    const note = document.getElementById('note-content').value;
    const noteInput = document.querySelector(`.eval-note[data-index="${currentEvalIndex}"]`);
    if (noteInput) {
        noteInput.value = note;
        const btn = noteInput.nextElementSibling;
        if (btn) btn.style.color = note.trim() ? 'var(--primary-color)' : '#9ca3af';
    }
    closeNoteModal();
}

function getTargetStaffId() {
    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    let roles = [];
    try {
        const parsed = JSON.parse(roleRaw);
        roles = Array.isArray(parsed) ? parsed : [roleRaw];
    } catch(e) {
        roles = [roleRaw];
    }
    const isAdmin = roles.some(r => r === 'admin' || r === 'senior_assistant');

    if (isAdmin) {
        const select = document.getElementById('staff-select');
        if (!select || !select.value) {
            return localStorage.getItem('currentUserId') || localStorage.getItem('currentUser');
        }
        return select.value === 'all' ? localStorage.getItem('currentUserId') : select.value;
    } else {
        return localStorage.getItem('currentUserId') || localStorage.getItem('currentUser');
    }
}

function getTargetStaffName() {
    const select = document.getElementById('staff-select');
    if (select && select.value !== 'all') {
        return select.options[select.selectedIndex].text.split('(')[0].trim();
    }
    return localStorage.getItem('currentUserName') || 'N/A';
}


window.onclick = function (event) {
    const modal = document.getElementById('note-modal');
    if (event.target == modal) closeNoteModal();
}

// removeVietnameseTones() → Moved to evaluation-service.js

// ================= ADMIN EDIT LOGIC =================
let fpCheckIn = null;
let fpCheckOut = null;

function initFlatpickr() {
    if (typeof flatpickr !== 'undefined') {
        const config = {
            enableTime: true,
            dateFormat: "Y-m-d\\TH:i",
            altInput: true,
            altFormat: "d/m/Y H:i",  // Changed to 24-hour format (H instead of h)
            locale: "vn",
            time_24hr: true,          // Use 24-hour format
            minuteIncrement: 1        // Ensure 1-minute increment (no rounding to 5 or 10)
        };
        if (!fpCheckIn) fpCheckIn = flatpickr("#edit-check-in", config);
        if (!fpCheckOut) fpCheckOut = flatpickr("#edit-check-out", config);
    }
}

async function populateRoleDropdown(staffId, selectElementId, currentRoleId = null) {
    const select = document.getElementById(selectElementId);
    if (!select) return;

    select.innerHTML = '<option value="">-- Chưa chọn Role --</option>';

    try {
        const users = await DBService.getUsers();
        const user = users.find(u => u.id === staffId);
        if (user && user.salary_config && user.salary_config.roles) {
            user.salary_config.roles.forEach(role => {
                const opt = document.createElement('option');
                opt.value = role.id;
                opt.textContent = role.name;
                opt.dataset.rate = role.rate;
                if (currentRoleId && currentRoleId === role.id) opt.selected = true;
                select.appendChild(opt);
            });
        }
    } catch(e) {
        console.warn('Cannot load roles:', e);
    }
}

async function openManualModal(dateKey, preFill = null, classCompositeKey = '', classSectionKey = '', classIndex = '', isLinkable = false) {
    document.getElementById('edit-time-modal').style.display = 'flex';
    document.getElementById('edit-date-key').value = dateKey;
    document.getElementById('edit-session-id').value = 'NEW'; // Marker for new session

    // Reset class metadata fields just in case
    if(document.getElementById('edit-class-composite-key')) {
        document.getElementById('edit-class-composite-key').value = classCompositeKey || '';
        document.getElementById('edit-class-section-key').value = classSectionKey || '';
        document.getElementById('edit-class-index').value = classIndex !== undefined ? classIndex : '';
        document.getElementById('edit-class-is-receptionist').value = isLinkable ? 'true' : '';
    }

    let startVal = '08:00';
    let endVal = '10:00';

    if (preFill) {
        if (preFill.start) startVal = preFill.start;
        if (preFill.end) endVal = preFill.end;
    }

    // Safely map 'YYYY-MM-DD' directly instead of parsing with `new Date()`
    // to strictly prevent Timezone shifts or Day/Month swapping 
    const isoDate = dateKey; 
    const startIso = `${isoDate}T${startVal}`;
    const endIso = `${isoDate}T${endVal}`;

    initFlatpickr();

    if (fpCheckIn) {
        fpCheckIn.setDate(startIso);
    } else {
        document.getElementById('edit-check-in').value = startIso;
    }

    if (fpCheckOut) {
        fpCheckOut.setDate(endIso);
    } else {
        document.getElementById('edit-check-out').value = endIso;
    }

    const staffId = getTargetStaffId();
    await populateRoleDropdown(staffId, 'edit-role');

    // Update Mode Title
    document.querySelector('#edit-time-modal h2').innerText = "Thêm Ca Làm Việc Mới";
    document.querySelector('#edit-time-modal button.btn-primary').innerText = "Tạo Ca";
    
    // Show delete button if this shift belongs to a schedule (so admin can delete it entirely)
    const delSection = document.querySelector('#edit-time-modal .delete-section');
    if (delSection) {
        if (classCompositeKey && classSectionKey) {
            delSection.style.display = 'block';
        } else {
            delSection.style.display = 'none';
        }
    }
}

async function openEditModal(dateKey, sessionId, sessionData, classStart, classCompositeKey, classSectionKey, classIndex, isReceptionist) {
    document.getElementById('edit-time-modal').style.display = 'flex';
    document.getElementById('edit-date-key').value = dateKey;
    document.getElementById('edit-session-id').value = sessionId;
    // Store the original class start time (if editing a class-matched session)
    // so after saving, the session still links to its class via linkedClassStart
    const linkedEl = document.getElementById('edit-linked-class-start');
    if (linkedEl) linkedEl.value = classStart || (sessionData ? (sessionData.linkedClassStart || '') : '');

    // Store class metadata for deletion
    document.getElementById('edit-class-composite-key').value = classCompositeKey || '';
    document.getElementById('edit-class-section-key').value = classSectionKey || '';
    document.getElementById('edit-class-index').value = classIndex !== undefined ? classIndex : '';
    document.getElementById('edit-class-is-receptionist').value = isReceptionist ? 'true' : '';

    // Convert ISO string to datetime-local format (YYYY-MM-DDTHH:mm)
    const toLocalISO = (isoStr) => {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hour}:${min}`;
    };

    const inIso = toLocalISO(sessionData.checkIn || sessionData.start);
    const outIso = toLocalISO(sessionData.checkOut);

    initFlatpickr();

    if (fpCheckIn) {
        fpCheckIn.setDate(inIso);
    } else {
        document.getElementById('edit-check-in').value = inIso;
    }

    if (fpCheckOut) {
        fpCheckOut.setDate(outIso);
    } else {
        document.getElementById('edit-check-out').value = outIso;
    }

    const staffId = getTargetStaffId();
    await populateRoleDropdown(staffId, 'edit-role', sessionData ? sessionData.role : null);

    // Update Mode Title
    document.querySelector('#edit-time-modal h2').innerText = "Chỉnh Sửa Giờ Làm";
    document.querySelector('#edit-time-modal button.btn-primary').innerText = "Lưu Thay Đổi";
    // Show delete button in edit mode
    const delSection = document.querySelector('#edit-time-modal .delete-section');
    if (delSection) delSection.style.display = 'block';
}

function closeEditModal() {
    document.getElementById('edit-time-modal').style.display = 'none';
}

async function saveEditedTime() {
    const staffId = getTargetStaffId();
    const staffName = getTargetStaffName();
    const dateKey = document.getElementById('edit-date-key').value;
    const sessionIdRaw = document.getElementById('edit-session-id').value;

    const checkIn = document.getElementById('edit-check-in').value;
    const checkOut = document.getElementById('edit-check-out').value;

    if (!checkIn) {
        alert("Giờ vào không được để trống!");
        return;
    }

    // Helper function to parse datetime-local format (YYYY-MM-DDTHH:mm) properly
    // This ensures minutes are preserved exactly (e.g., 9:20 stays 9:20, not rounded to 9:10)
    const parseLocalDateTime = (localDateTimeStr) => {
        if (!localDateTimeStr) return null;
        
        // Format: "2026-04-17T09:20" -> Parse manually to preserve exact minutes
        const [datePart, timePart] = localDateTimeStr.split('T');
        if (!datePart || !timePart) {
            return new Date(localDateTimeStr); // Fallback to standard parsing
        }
        
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        
        // Create date using local time (not UTC)
        const date = new Date(year, month - 1, day, hour, minute, 0, 0);
        return date;
    };

    const checkInDate = parseLocalDateTime(checkIn);
    const checkOutDate = checkOut ? parseLocalDateTime(checkOut) : null;

    if (!checkInDate || isNaN(checkInDate.getTime())) {
        alert("Định dạng giờ vào không hợp lệ!");
        return;
    }

    if (checkOutDate && isNaN(checkOutDate.getTime())) {
        alert("Định dạng giờ ra không hợp lệ!");
        return;
    }

    const checkInStr = checkInDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const checkOutStr = checkOutDate ? checkOutDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';

    const linkedClassStart = document.getElementById('edit-linked-class-start')?.value || null;
    
    const roleSelect = document.getElementById('edit-role');
    const selectedRoleId = roleSelect?.value || null;
    const selectedRoleName = roleSelect?.options[roleSelect.selectedIndex]?.text || null;
    const selectedRoleRate = roleSelect?.options[roleSelect.selectedIndex]?.dataset?.rate || null;

    const newData = {
        checkIn: checkInDate.toISOString(),
        start: checkInDate.toISOString(),
        checkOut: checkOutDate ? checkOutDate.toISOString() : null,
        ...(linkedClassStart ? { linkedClassStart } : {}) // Preserve class link after edit
    };

    // Thêm vào sessionData khi update:
    if (selectedRoleId) {
        newData.role = selectedRoleId;
        newData.roleName = selectedRoleName;
        newData.roleRate = Number(selectedRoleRate);
    }

    try {
        if (sessionIdRaw === 'NEW') {
            await DBService.addSession(staffId, dateKey, newData);
            // Send notification to staff
            await DBService.createAdminNotification(
                staffId, staffName, 'add_session', dateKey,
                `Admin đã thêm ca làm việc mới: ${checkInStr} - ${checkOutStr}`
            );
            alert("Đã tạo ca làm việc mới!");
        } else {
            const parsedSessionId = isNaN(sessionIdRaw) ? sessionIdRaw : Number(sessionIdRaw);
            await DBService.updateSession(staffId, dateKey, parsedSessionId, newData);
            // Send notification to staff
            await DBService.createAdminNotification(
                staffId, staffName, 'edit_session', dateKey,
                `Admin đã chỉnh sửa giờ làm: ${checkInStr} - ${checkOutStr}`
            );
            alert("Cập nhật thành công!");
        }
        closeEditModal();
        _cachedStaffId = null; // Force re-fetch from Firestore after edit
        renderMonthReport(currentDate, true); // true = bypass Firestore cache
    } catch (e) {
        alert("Lỗi: " + e.message);
    }
}


async function deleteSessionFromModal() {
    // Remove confirmation popup as requested by user
    // if (!confirm("Bạn có chắc chắn muốn xóa phiên làm việc này không? Ca làm việc sẽ bị xóa hoàn toàn khỏi bảng.")) return;

    const staffId = getTargetStaffId();
    const staffName = getTargetStaffName();
    const dateKey = document.getElementById('edit-date-key').value;
    const sessionId = document.getElementById('edit-session-id').value;
    const parsedSessionId = isNaN(sessionId) ? sessionId : Number(sessionId);
    
    // Class unregistration metadata
    const classCompositeKey = document.getElementById('edit-class-composite-key').value;
    const classSectionKey = document.getElementById('edit-class-section-key').value;
    const classIndexRaw = document.getElementById('edit-class-index').value;
    const isReceptionistStr = document.getElementById('edit-class-is-receptionist').value;

    try {
        console.log("[DeleteSession] Starting deletion process...");
        console.log("[DeleteSession] Values:", {staffId, dateKey, sessionId, classCompositeKey, classSectionKey, classIndexRaw, isReceptionistStr});

        // Only attempt to delete an attendance session if one actually exists
        if (sessionId && sessionId !== 'NEW' && String(sessionId) !== 'null') {
            console.log("[DeleteSession] Deleting attendance session:", parsedSessionId);
            await DBService.deleteSession(staffId, dateKey, parsedSessionId);
        }
        
        // Unregister from class if linked
        if (classCompositeKey && classSectionKey && classIndexRaw !== '') {
            console.log("[DeleteSession] Unregistering from class...");
            const monthStr = dateKey.substring(0, 7);
            const cancelKey = `${classCompositeKey}_${classSectionKey}_${classIndexRaw}`;
            
            // 1. Ghi log huỷ ca vào DBService (BƯỚC QUAN TRỌNG NHẤT)
            await DBService.cancelShift(monthStr, staffId, cancelKey);
            
            if (isReceptionistStr === 'true') {
                // Delete from receptionist schedule
                await DBService.unassignReceptionist(classCompositeKey, classSectionKey, classIndexRaw, staffId);
            } else {
                // Delete from teaching schedule
                const classIndex = Number(classIndexRaw);
                const branch = classCompositeKey.split('_')[0];
                const mockUser = {
                    uid: staffId,
                    displayName: staffName
                };
                const rowMeta = {
                    branch: branch,
                    section: classSectionKey,
                    index: classIndex
                };
                await DBService.registerClass(classCompositeKey, null, rowMeta, mockUser);
            }
        }
        
        // Send notification to staff
        await DBService.createAdminNotification(
            staffId, staffName, 'delete_session', dateKey,
            `Admin đã xóa một ca làm việc ngày ${dateKey}`
        );
        alert("Đã xóa hoàn toàn!");
        closeEditModal();
        _cachedStaffId = null; // Force re-fetch from Firestore
        renderMonthReport(currentDate, true); // true = bypass Firestore cache
        localStorage.setItem('schedule_registration_updated', Date.now().toString());
    } catch (e) {
        alert("Lỗi xóa: " + e.message);
    }
}

// ================= DEBUG HELPER (TEMPORARY) =================
async function renderDebugInfo(staffId, year, month) {
    const debugContainer = document.getElementById('debug-container') || document.createElement('div');
    debugContainer.id = 'debug-container';
    debugContainer.style.background = '#000';
    debugContainer.style.color = '#0f0';
    debugContainer.style.padding = '10px';
    debugContainer.style.margin = '10px 0';
    debugContainer.style.fontFamily = 'monospace';
    debugContainer.style.fontSize = '12px';
    debugContainer.style.whiteSpace = 'pre-wrap';

    // Insert after title
    const title = document.getElementById('page-title');
    if (title && !document.getElementById('debug-container')) {
        title.parentNode.insertBefore(debugContainer, title.nextSibling);
    }

    debugContainer.innerText = `🔄 DEBUGGING...\nUserID: ${staffId}\nMonth: ${year}-${month + 1}`;

    try {
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
        const records = await DBService.getMonthlyAttendance(monthStr, staffId);

        let msg = `✅ DATA FETCHED: ${records.length} records found.\n`;
        records.forEach(r => {
            msg += `Date: ${r.date} | Sessions: ${r.sessions ? r.sessions.length : 0} | CheckIn: ${r.checkIn || 'N/A'}\n`;
            if (r.sessions) {
                r.sessions.forEach((s, i) => {
                    msg += `   [${i}] ID: ${s.id} (${typeof s.id}) | Start: ${s.start} | Out: ${s.checkOut}\n`;
                });
            }
        });

        // Check specific date Feb 1
        const feb1 = records.find(r => r.date === '2026-02-01');
        if (!feb1) msg += `⚠️ WARNING: No record found for 2026-02-01 in query results!\n`;
        else msg += `✅ FEB 1 RECORD FOUND. Check Logic.\n`;

        debugContainer.innerText += '\n' + msg;
    } catch (e) {
        debugContainer.innerText += `\n❌ ERROR: ${e.message}\n${e.stack}`;
        debugContainer.style.color = 'red';
    }
}
// ================= ROLE SELECTION LOGIC =================
async function openRoleSelectModal(dateKey, session) {
    const staffId = getTargetStaffId();
    console.log("[RoleSelect] Looking up staffId:", staffId);

    // Fetch User Roles
    let roles = [];
    try {
        const users = await DBService.getUsers();
        const user = users.find(u => u.id === staffId);
        console.log("[RoleSelect] User found:", user ? user.name : 'NOT FOUND', "salary_config:", user?.salary_config);
        if (user && user.salary_config && user.salary_config.roles) {
            roles = user.salary_config.roles;
        }
    } catch (e) {
        console.error("[RoleSelect] Error fetching users:", e);
    }

    if (roles.length === 0) {
        alert(`Chưa có cấu hình Vai trò cho nhân viên này. [staffId: ${staffId}]`);
        return;
    }

    document.getElementById('role-select-date').value = dateKey;
    document.getElementById('role-select-session').value = session.id;

    const container = document.getElementById('role-options-container');
    container.innerHTML = '';

    roles.forEach(role => {
        const btn = document.createElement('div');
        btn.style.padding = '1rem';
        btn.style.border = '1px solid var(--border-color)';
        btn.style.borderRadius = 'var(--radius-md)';
        btn.style.cursor = 'pointer';
        btn.style.background = '#F9FAFB';
        btn.style.transition = '0.2s';
        btn.innerHTML = `<strong>${role.name}</strong> <span style="float:right; color:green">${new Intl.NumberFormat('vi-VN').format(role.rate)}đ/h</span>`;

        btn.onmouseover = () => { btn.style.background = '#D1FAE5'; btn.style.borderColor = 'var(--primary-color)'; };
        btn.onmouseout = () => { btn.style.background = '#F9FAFB'; btn.style.borderColor = 'var(--border-color)'; };

        btn.onclick = () => selectRoleForSession(role);

        container.appendChild(btn);
    });

    document.getElementById('role-select-modal').style.display = 'flex';
}

function closeRoleSelectModal() {
    document.getElementById('role-select-modal').style.display = 'none';
}

async function selectRoleForSession(role) {
    const staffId = getTargetStaffId();
    const staffName = getTargetStaffName();
    const dateKey = document.getElementById('role-select-date').value;
    const sessionId = document.getElementById('role-select-session').value;

    try {
        await DBService.updateSessionRole(staffId, dateKey, sessionId, role);
        // Send notification to staff
        await DBService.createAdminNotification(
            staffId, staffName, 'select_role', dateKey,
            `Admin đã chọn vai trò "${role.name}" cho ca ngày ${dateKey}`
        );
        closeRoleSelectModal();
        renderMonthReport(new Date(dateKey));
    } catch (e) {
        alert("Lỗi lưu vai trò: " + e.message);
    }
}

// removeVietnameseTones() → Moved to evaluation-service.js

// ================= OVERTIME MODAL =================

function openOvertimeModal(dateKey, sessionId, sessionData) {
    const modal = document.getElementById('overtime-modal');
    if (!modal) return;

    document.getElementById('overtime-date-key').value = dateKey;
    document.getElementById('overtime-session-id').value = sessionId;
    // Reset spinners to default (0h 30m)
    const hoursEl = document.getElementById('overtime-hours');
    const minsEl = document.getElementById('overtime-minutes');
    if (hoursEl) hoursEl.value = '0';
    if (minsEl) minsEl.value = '30';

    const start = sessionData ? new Date(sessionData.checkIn || sessionData.start) : null;
    const end = sessionData && sessionData.checkOut ? new Date(sessionData.checkOut) : null;
    const startStr = start ? start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';
    const endStr = end ? end.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';

    const infoEl = document.getElementById('overtime-session-info');
    if (infoEl) infoEl.innerText = `Ca: ${dateKey} | ${startStr} – ${endStr}`;

    modal.style.display = 'flex';
    if (hoursEl) setTimeout(() => hoursEl.focus(), 100);
}

function closeOvertimeModal() {
    const modal = document.getElementById('overtime-modal');
    if (modal) modal.style.display = 'none';
}

async function submitOvertimeRequest() {
    const dateKey = document.getElementById('overtime-date-key').value;
    const sessionId = document.getElementById('overtime-session-id').value;

    // Read from the two number spinners
    const hours = parseInt(document.getElementById('overtime-hours').value || '0', 10);
    const mins = parseInt(document.getElementById('overtime-minutes').value || '0', 10);

    if (hours === 0 && mins === 0) {
        alert('Vui lòng nhập số giờ/phút tăng ca lớn hơn 0.');
        return;
    }

    // Build "HH:MM" string
    const duration = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

    const staffId = getTargetStaffId();
    const staffName = localStorage.getItem('currentUserName') || localStorage.getItem('currentUser') || 'N/A';

    try {
        await DBService.createOvertimeRequest(staffId, staffName, dateKey, sessionId, duration);
        alert('Đã gửi yêu cầu tăng ca! Admin sẽ xem xét và xác nhận.');
        closeOvertimeModal();
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch (e) {
        alert('Lỗi: ' + e.message);
    }
}

// ================= BONUS 10P UI FUNCTIONS =================

async function submitBonus10Request(sessionId, dateKey, staffId) {
    const confirmed = await UIService.confirm('Gửi yêu cầu thưởng 10p vào sớm cho ca này?');
    if (!confirmed) return;

    const staffName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'N/A';
    try {
        await DBService.createBonus10Request(staffId, staffName, dateKey, sessionId);
        UIService.toast('Đã gửi yêu cầu! Admin sẽ xem xét và duyệt.', 'success');
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch (e) {
        UIService.toast('Lỗi: ' + e.message, 'error');
    }
}

async function approveBonus10(requestId, sessionId, dateKey, staffId) {
    const confirmed = await UIService.confirm('Duyệt thưởng 10p cho ca này?');
    if (!confirmed) return;

    const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';
    try {
        await DBService.approveBonus10Request(requestId, adminName, staffId, dateKey, sessionId);
        UIService.toast('Đã duyệt thưởng 10p!', 'success');
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch (e) {
        UIService.toast('Lỗi: ' + e.message, 'error');
    }
}

async function approveAllBonus10() {
    const staffId = getTargetStaffId();
    if (!staffId) return;

    const confirmed = await UIService.confirm('Duyệt TẤT CẢ yêu cầu Sớm 10p đang chờ trong tháng này?');
    if (!confirmed) return;

    const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';

    try {
        const monthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        const pendingList = await DBService.getBonus10RequestsForStaff(staffId, monthStr);
        const pending = pendingList.filter(r => r.status === 'pending');

        if (pending.length === 0) {
            UIService.toast('Không có yêu cầu nào đang chờ duyệt.', 'info');
            return;
        }

        // Approve all in parallel
        await Promise.all(pending.map(req =>
            DBService.approveBonus10Request(req.id, adminName, req.staffId, req.dateKey, req.sessionId)
        ));

        UIService.toast(`Đã duyệt ${pending.length} yêu cầu Sớm 10p!`, 'success');
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch (e) {
        UIService.toast('Lỗi: ' + e.message, 'error');
    }
}

async function approveSelectedBonus10() {
    const checkboxes = document.querySelectorAll('.bonus10-pending-cb:checked');
    if (checkboxes.length === 0) {
        UIService.toast('Chưa chọn ca nào!', 'warning');
        return;
    }

    const confirmed = await UIService.confirm(`Duyệt ${checkboxes.length} ca Sớm 10p đã chọn?`);
    if (!confirmed) return;

    const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';

    try {
        await Promise.all([...checkboxes].map(cb =>
            DBService.approveBonus10Request(
                cb.dataset.bonus10Id,
                adminName,
                cb.dataset.staffId,
                cb.dataset.dateStr,
                cb.dataset.sessionId
            )
        ));
        UIService.toast(`Đã duyệt ${checkboxes.length} ca!`, 'success');
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch(e) {
        UIService.toast('Lỗi: ' + e.message, 'error');
    }
}

// TEMP CLEANUP — chạy 1 lần rồi xóa
window._cleanupBonus10ForStaff = async function(staffId) {
    if (!staffId) { console.error('Cần staffId'); return; }
    try {
        const snap = await db.collection('bonus10_requests')
            .where('staffId', '==', staffId).get();
        if (snap.empty) { console.log('Không có data nào'); return; }
        const batch = db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log(`Đã xóa ${snap.size} records của staffId: ${staffId}`);
    } catch(e) { console.error('Lỗi:', e); }
};
