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
    const role = localStorage.getItem('currentRole');
    if (role === 'admin') {
        const controls = document.getElementById('admin-controls');
        if (controls) controls.style.display = 'flex';
        document.getElementById('page-title').innerText = 'Tính Lương & Duyệt Công';
        await populateStaffSelect();

        // Auto-select staff from URL param (e.g., from OT alert link: ?staffId=xxx)
        const urlParams = new URLSearchParams(window.location.search);
        const paramStaffId = urlParams.get('staffId');
        if (paramStaffId) {
            const select = document.getElementById('staff-select');
            if (select) {
                select.value = paramStaffId;
                _cachedStaffId = null; // force re-fetch
            }
        }
    } else {
        const controls = document.getElementById('admin-controls');
        if (controls) controls.style.display = 'none';
        document.getElementById('page-title').innerText = 'Bảng Công Cá Nhân';
    }

    // 2. Set to 1st of current month
    currentDate.setDate(1);

    // 3. Render
    renderMonthReport(currentDate);
}

async function populateStaffSelect() {
    const select = document.getElementById('staff-select');
    if (!select) return;

    _allStaffOptions = null; // Reset search cache when re-populating
    select.innerHTML = '<option value="all">-- Chọn nhân viên --</option>';

    let users = [];
    try {
        // Always fetch fresh from Firestore to include newly created employees
        users = await DBService.getUsers();
        // Update cache for other pages
        localStorage.setItem('users_data', JSON.stringify(users));
    } catch (e) {
        console.error("Failed to fetch users, falling back to cache:", e);
        users = JSON.parse(localStorage.getItem('users_data')) || [];
    }

    users.forEach(user => {
        if (user.role === 'admin' && user.username === 'admin') return;
        const option = document.createElement('option');
        option.value = user.id;
        option.innerText = `${user.name} (${user.username})`;
        select.appendChild(option);
    });

    // CRITICAL FIX: Trigger re-render when staff changes
    select.onchange = () => {
        _cachedStaffId = null; // Reset notes cache so Firestore re-fetches for new staff
        renderMonthReport(currentDate);
    };
}

// Search/filter staff select options
// Store all options so we can re-populate on filter (hiding <option> doesn't work on mobile)
let _allStaffOptions = null;
window.filterStaffSelect = function (query) {
    const select = document.getElementById('staff-select');
    if (!select) return;

    // Cache all options on first call
    if (!_allStaffOptions) {
        _allStaffOptions = Array.from(select.options).map(opt => ({
            value: opt.value,
            text: opt.textContent,
            selected: opt.selected
        }));
    }

    const normalizedQuery = (query || '').toLowerCase().trim();
    const currentValue = select.value;

    // Clear and re-populate with matching options
    select.innerHTML = '';

    _allStaffOptions.forEach(opt => {
        if (opt.value === 'all' || normalizedQuery === '' || opt.text.toLowerCase().includes(normalizedQuery)) {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            select.appendChild(option);
        }
    });

    // Restore previous selection if still visible
    if (Array.from(select.options).some(o => o.value === currentValue)) {
        select.value = currentValue;
    }
};

function changeReportMonth(offset) {
    currentDate.setMonth(currentDate.getMonth() + offset);
    renderMonthReport(currentDate);
}

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
    const role = localStorage.getItem('currentRole');
    let staffId = getTargetStaffId();

    // 0. Fetch User Context for Name Matching
    let currentUserContext = null;
    try {
        const userDoc = await DBService.refs.users().doc(staffId).get();
        if (userDoc.exists) currentUserContext = userDoc.data();
    } catch (e) { console.error("Error fetching user context", e); }

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

    // Build overtimeDateMap: "YYYY-MM-DD" -> { sessionId -> otData }
    const overtimeDateMap = {};
    overtimeRequestsList.forEach(ot => {
        if (!overtimeDateMap[ot.dateKey]) overtimeDateMap[ot.dateKey] = {};
        const existing = overtimeDateMap[ot.dateKey][ot.sessionId];
        if (!existing || ot.status === 'approved' || (ot.status === 'pending' && existing.status === 'rejected')) {
            overtimeDateMap[ot.dateKey][ot.sessionId] = ot;
        }
    });

    // === AUTO-CLOSE STALE SESSIONS ===
    // If any past-day session has no checkOut, auto-close it in Firestore (fire-and-forget)
    const todayKey = getLocalDateKey(new Date());
    Object.entries(attendanceMap).forEach(([dateKey, sessions]) => {
        if (dateKey >= todayKey) return; // Skip today and future
        sessions.forEach(s => {
            if (!s.checkOut && s.id) {
                // Fire-and-forget: close stale session in background
                DBService.autoCloseStaleSession(staffId, dateKey, s.id).then(closed => {
                    if (closed) {
                        // Update local data so display is correct even before next fetch
                        s.checkOut = new Date(`${dateKey}T23:59:00`).toISOString();
                        s.autoClosedReason = 'stale_session';
                    }
                });
            }
        });
    });


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

    // C. Receptionist Schedule Data (only for receptionist role staff)
    const receptionistShiftsMap = {}; // "YYYY-MM-DD" -> [{ shift, label, start, end }]
    const isReceptionistStaff = currentUserContext && currentUserContext.role === 'receptionist';

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
                        const defaultStart = branchConfig[shiftKey]?.start || '07:00';
                        const defaultEnd = branchConfig[shiftKey]?.end || '11:30';

                        // Add entry (allow same shift from different branches as separate entries)
                        receptionistShiftsMap[dateStr].push({
                            shift: shiftKey,
                            label: SHIFT_LABELS[shiftKey],
                            start: staffEntry.customStart || defaultStart,
                            end: staffEntry.customEnd || defaultEnd,
                            branch: result.branch
                        });
                    });
                });
            }

            console.log('[Report] Receptionist shifts loaded:', Object.keys(receptionistShiftsMap).length, 'days with shifts');
        } catch (e) {
            console.error('[Report] Error loading receptionist schedules:', e);
        }
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
                const isRegistered = (cls.registeredTeachers || []).some(t => t.id === staffId);
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
        if (role === 'admin') {
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

        const chips = calculateDailyChips(dailySchedule, dailyAttendance, staffId, dateStr, currentUserContext, dailyReceptionistShifts, overtimeDateMap[dateStr] || {});

        chips.forEach(chip => {
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
            div.title = `${chip.tooltip} (${chip.paidMinutes}m)`;

            // --- NEW: Role Selection Click Handler ---
            if (chip.isClickable) {
                // Only Admin or Owner (but report is mostly Admin managed now)
                // Actually openRoleSelect logic checks roles locally, but for creating new session, we need Admin.

                div.style.cursor = 'pointer';
                div.onclick = (e) => {
                    e.stopPropagation();
                    if (chip.sessionId) {
                        openRoleSelectModal(dateStr, chip.sessionData);
                    } else if (role === 'admin') {
                        // Creating new session from Registration
                        openManualModal(dateStr, chip.schedData);
                    }
                };
            }

            // Store for calculation
            if (chip.paidMinutes > 0) {
                window.currentMonthChips.push(chip);
            }

            // Add Edit Icon for Admin if there is an underlying session
            if (role === 'admin' && chip.sessionId) {
                const editBtn = document.createElement('span');
                editBtn.innerHTML = '✏️';
                editBtn.style.cursor = 'pointer';
                editBtn.style.fontSize = '0.8em';
                editBtn.style.marginLeft = '4px';
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    openEditModal(dateStr, chip.sessionId, chip.sessionData);
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
                        if (!confirm('Xác nhận giờ tăng ca này?')) return;
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
                        if (!confirm('Từ chối yêu cầu tăng ca này?')) return;
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
        const dailyTotalMinutes = chips.reduce((acc, chip) => acc + (chip.paidMinutes || 0), 0);
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

    if (role === 'admin') {
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
    section.style.display = role === 'admin' ? 'block' : 'none';
    if (role !== 'admin') return;

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
                const rate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                filteredSalary += (minutes / 60) * rate;
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
                if (chipRole === 'tiep-tan' || normalizedApps.includes('tiep') || normalizedApps.includes('le') || normalizedApps.includes('reception')) {
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

                if (chipRole === 'tiep-tan' || normalizedApps.includes('tiep') || normalizedApps.includes('le') || normalizedApps.includes('reception')) {
                    include = true;
                }
            }

            if (include) {
                const minutes = chip.paidMinutes || 0;
                filteredMinutes += minutes;

                // Calculate Money
                const rate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                filteredSalary += (minutes / 60) * rate;
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
    }

    // 4. Calculate Total Money
    let totalBonus = 0;
    document.querySelectorAll('.eval-amount').forEach(input => {
        totalBonus += parseFloat(input.value) || 0;
    });

    updateBonusDisplay(totalBonus);

    // Store base salary for Export PDF
    window.currentMonthSalary = filteredSalary;

    const totalSalary = filteredSalary + totalBonus;

    const finalDisplay = document.getElementById('final-salary-display');
    if (finalDisplay) finalDisplay.innerText = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalSalary);

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
    const role = localStorage.getItem('currentRole');
    if (role === 'admin') {
        const select = document.getElementById('staff-select');
        if (!select) {
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
// ================= ADMIN EDIT LOGIC =================
function openManualModal(dateKey, preFill = null) {
    document.getElementById('edit-time-modal').style.display = 'flex';
    document.getElementById('edit-date-key').value = dateKey;
    document.getElementById('edit-session-id').value = 'NEW'; // Marker for new session

    let startVal = '08:00';
    let endVal = '10:00';

    if (preFill) {
        if (preFill.start) startVal = preFill.start;
        if (preFill.end) endVal = preFill.end;
    }

    const d = new Date(dateKey); // Local date from string YYYY-MM-DD
    const isoDate = d.toISOString().split('T')[0];
    document.getElementById('edit-check-in').value = `${isoDate}T${startVal}`;
    document.getElementById('edit-check-out').value = `${isoDate}T${endVal}`;

    // Update Mode Title
    document.querySelector('#edit-time-modal h2').innerText = "Thêm Ca Làm Việc Mới";
    document.querySelector('#edit-time-modal button.btn-primary').innerText = "Tạo Ca";
}

function openEditModal(dateKey, sessionId, sessionData) {
    document.getElementById('edit-time-modal').style.display = 'flex';
    document.getElementById('edit-date-key').value = dateKey;
    document.getElementById('edit-session-id').value = sessionId;

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

    document.getElementById('edit-check-in').value = toLocalISO(sessionData.checkIn || sessionData.start);
    document.getElementById('edit-check-out').value = toLocalISO(sessionData.checkOut);

    // Update Mode Title
    document.querySelector('#edit-time-modal h2').innerText = "Chỉnh Sửa Giờ Làm";
    document.querySelector('#edit-time-modal button.btn-primary').innerText = "Lưu Thay Đổi";
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

    const checkInDate = new Date(checkIn);
    const checkOutDate = checkOut ? new Date(checkOut) : null;

    const checkInStr = checkInDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const checkOutStr = checkOutDate ? checkOutDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';

    const newData = {
        checkIn: checkInDate.toISOString(),
        start: checkInDate.toISOString(),
        checkOut: checkOutDate ? checkOutDate.toISOString() : null
    };

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
    if (!confirm("Bạn có chắc chắn muốn xóa phiên làm việc này không?")) return;

    const staffId = getTargetStaffId();
    const staffName = getTargetStaffName();
    const dateKey = document.getElementById('edit-date-key').value;
    const sessionId = document.getElementById('edit-session-id').value;
    const parsedSessionId = isNaN(sessionId) ? sessionId : Number(sessionId);

    try {
        await DBService.deleteSession(staffId, dateKey, parsedSessionId);
        // Send notification to staff
        await DBService.createAdminNotification(
            staffId, staffName, 'delete_session', dateKey,
            `Admin đã xóa một ca làm việc ngày ${dateKey}`
        );
        alert("Đã xóa!");
        closeEditModal();
        _cachedStaffId = null; // Force re-fetch from Firestore
        renderMonthReport(currentDate, true); // true = bypass Firestore cache
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
    document.getElementById('overtime-duration').value = '';

    const start = sessionData ? new Date(sessionData.checkIn || sessionData.start) : null;
    const end = sessionData && sessionData.checkOut ? new Date(sessionData.checkOut) : null;
    const startStr = start ? start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';
    const endStr = end ? end.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';

    const infoEl = document.getElementById('overtime-session-info');
    if (infoEl) infoEl.innerText = `Ca: ${dateKey} | ${startStr} – ${endStr}`;

    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('overtime-duration').focus(), 100);
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
