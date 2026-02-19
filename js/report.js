// Report & Salary Logic

document.addEventListener('DOMContentLoaded', () => {
    // Check if on report page (has calendar grid)
    if (document.getElementById('calendar-grid')) {
        initReport();
    }
});

let currentDate = new Date(); // Global View Date

function initReport() {
    // 1. Title & Admin Controls
    const role = localStorage.getItem('currentRole');
    if (role === 'admin') {
        const controls = document.getElementById('admin-controls');
        if (controls) controls.style.display = 'flex';
        document.getElementById('page-title').innerText = 'Tính Lương & Duyệt Công';
        populateStaffSelect();
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

    select.innerHTML = '<option value="all">-- Chọn nhân viên --</option>';

    let users = JSON.parse(localStorage.getItem('users_data')) || [];

    // Fallback if local storage is empty
    if (users.length === 0) {
        try {
            console.log("Local users empty, fetching from DB...");
            users = await DBService.getUsers();
            // Cache for future
            localStorage.setItem('users_data', JSON.stringify(users));
        } catch (e) {
            console.error("Failed to fetch users for select:", e);
        }
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
        renderMonthReport(currentDate);
    };
}

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

function renderPersonalTimesheet() {
    renderMonthReport(currentDate);
}

async function renderMonthReport(date) {
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

    if (!staffId) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: red;">Vui lòng đăng nhập hoặc chọn nhân viên.</div>';
        return;
    }

    // 1. Fetch DATA (Attendance + Schedule)
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    // A. Attendance Logs (Actual Check-in/out)
    // DBService.getMonthlyAttendance returns array of docs with { sessions: [...] }
    const attendanceRecords = await DBService.getMonthlyAttendance(monthStr, staffId);

    // Normalize Attendance into a Map: "YYYY-MM-DD" -> [sessions]
    const attendanceMap = {};
    attendanceRecords.forEach(record => {
        // record.date is "YYYY-MM-DD"
        if (record.date) {
            attendanceMap[record.date] = record.sessions || [];
        }
    });

    // B. Schedule Data (For the whole month)
    // We need to fetch schedule for every day to see "Registered" classes.
    // Optimization: Parallel Fetch
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const schedulePromises = [];
    for (let d = 1; d <= daysInMonth; d++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        schedulePromises.push(DBService.getSchedule(dateKey).then(data => ({ date: dateKey, data: data || {} })));
    }
    const scheduleResults = await Promise.all(schedulePromises);
    const scheduleMap = {}; // "YYYY-MM-DD" -> ScheduleObject
    scheduleResults.forEach(item => {
        scheduleMap[item.date] = item.data;
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
        dateHeader.innerHTML = `<span style="font-weight: 600;">${d}</span>`;

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

            // Highlight cell background slightly
            cell.style.backgroundColor = '#FEF2F2';
        }

        // Note Button
        const controlsDiv = document.createElement('div');
        controlsDiv.style.display = 'flex';
        controlsDiv.style.gap = '4px';

        const noteBtn = document.createElement('button');
        noteBtn.innerHTML = '📝';
        noteBtn.className = 'action-btn';
        noteBtn.title = 'Ghi chú cá nhân';
        noteBtn.onclick = () => openNoteModal(dateStr);
        // Check local note cache (still local for now)
        const allNotes = JSON.parse(localStorage.getItem('daily_notes')) || {};
        const userNotes = allNotes[staffId] || {};
        if (userNotes[dateStr]) noteBtn.style.color = 'var(--primary-color)';
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

        const chips = calculateDailyChips(dailySchedule, dailyAttendance, staffId, dateStr, currentUserContext);

        chips.forEach(chip => {
            const div = document.createElement('div');
            div.className = `schedule-chip ${chip.class}`;
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';

            div.innerHTML = `<span>${chip.text}</span>`;

            if (chip.isWarning) {
                const warningIcon = document.createElement('span');
                warningIcon.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#EF4444" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                `;
                warningIcon.style.cursor = 'pointer';
                warningIcon.style.marginLeft = '4px';
                warningIcon.title = 'Click để xem chi tiết';
                warningIcon.onclick = (e) => {
                    e.stopPropagation();
                    const s = chip.sessionData;
                    const startTime = s.checkIn ? new Date(s.checkIn).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';
                    const endTime = s.checkOut ? new Date(s.checkOut).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Chưa ra ca';
                    let detail = `⚠️ CA NGOÀI LỊCH\n\n`;
                    detail += `📅 Ngày: ${dateStr}\n`;
                    detail += `🕐 Vào ca: ${startTime}\n`;
                    detail += `🕐 Ra ca: ${endTime}\n\n`;
                    detail += `📋 Lý do: Thời gian chấm công không khớp với bất kỳ lớp nào trong lịch đã xếp.\n\n`;
                    detail += `💡 Giải pháp: Nhân viên cần "Nhận Lớp" trong mục Lịch Làm trước khi Vào Ca, hoặc Admin xếp lịch cho khung giờ này.`;
                    alert(detail);
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

// Logic to Merge Schedule & Attendance
// Logic to Merge Schedule & Attendance
function calculateDailyChips(schedule, attendanceSessions, staffId, dateStr, currentUserContext) {
    const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
    const chips = [];
    const usedSessionIds = new Set();

    sections.forEach(secKey => {
        const classes = schedule[secKey] || [];
        classes.forEach((cls, idx) => {
            // 1. Check if User Registered OR Assigned by Name
            const registeredTeachers = cls.registeredTeachers || [];
            let isRegistered = registeredTeachers.some(t => t.id === staffId);

            // Fallback: Check if 'gv' field matches Name or Username
            if (!isRegistered && cls.gv) {
                if (currentUserContext) {
                    const name = removeVietnameseTones(currentUserContext.name || '').toLowerCase();
                    const username = removeVietnameseTones(currentUserContext.username || '').toLowerCase();
                    const gv = removeVietnameseTones(cls.gv).toLowerCase();

                    if ((name && gv.includes(name)) || (username && gv.includes(username))) {
                        isRegistered = true;
                    }
                }
            }

            if (!isRegistered) return; // Skip if not my class

            // 2. Check for Attendance Match
            const schedStart = new Date(`${dateStr}T${cls.start}`);

            const matchedSession = attendanceSessions.find(s => {
                const checkIn = new Date(s.checkIn || s.start);
                const diffMs = Math.abs(checkIn - schedStart);
                return diffMs < 60 * 60 * 1000;
            });

            if (matchedSession) usedSessionIds.add(matchedSession.id);

            // 3. Determine Status
            let minutes = 0;
            let cssClass = 'chip-blue';
            let label = `${cls.start}-${cls.end}`;
            let tooltip = `Lớp ${cls.lop || '?'}`;

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

                    if (diffMs < 0) { // Late
                        const lateMinutesRaw = Math.round(Math.abs(diffMs) / 60000);
                        if (lateMinutesRaw === 0) {
                            // Less than 1 minute late → treat as on-time
                            minutes = schedDuration;
                        } else {
                            const remainingSched = (schedEnd - actualStart) / 60000;
                            minutes = Math.max(0, Math.round(remainingSched));
                        }
                        label += ` (Trễ ${lateMinutesRaw}p)`;
                        cssClass = lateMinutesRaw > 0 ? 'chip-orange' : cssClass;
                    } else { // On Time
                        minutes = schedDuration;
                    }

                    // New: Role Logic
                    if (matchedSession.role) {
                        cssClass = 'chip-green';
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
                        cssClass = 'chip-waiting';
                        label += ` (Chọn Role?)`;
                        tooltip += ' - Bấm để chọn vai trò tính lương';
                    }

                    tooltip += ' - Đã chấm công đầy đủ';
                    isClickable = true;
                } else {
                    // No Check Out
                    const classEndTime = new Date(`${dateStr}T${cls.end}`);
                    if (now > new Date(classEndTime.getTime() + 30 * 60000)) {
                        minutes = schedDuration;
                        cssClass = 'chip-orange';
                        label += ' (Quên ra)';
                        tooltip += ' - Quên Check-out (Tính đủ giờ)';
                    } else {
                        minutes = 0;
                        cssClass = 'chip-blue';
                        label += ' (Đang dạy)';
                        tooltip += ' - Đang trong ca làm việc';
                    }
                }

                chips.push({
                    text: label,
                    class: cssClass,
                    paidMinutes: Math.max(0, Math.round(minutes)),
                    tooltip: tooltip,
                    sessionId: matchedSession.id,
                    sessionData: matchedSession,
                    isClickable: isClickable,
                    isTeaching: true // Flag for filter
                });

            } else {
                // --- CASE B: NO ATTENDANCE ---
                const classDateTime = new Date(`${dateStr}T${cls.start}`);
                if (classDateTime > now) {
                    // User requested to hide future classes (Sắp tới)
                    // Do nothing
                } else {
                    chips.push({
                        text: label + ' (Vắng)', // Keep text clean
                        class: 'chip-gray',
                        paidMinutes: 0,
                        tooltip: 'Không có dữ liệu chấm công',
                        sessionId: null,
                        schedData: { start: cls.start, end: cls.end },
                        isClickable: true,
                        isWarning: true // Set flag
                    });
                }
            }
        });
    });

    // 4. Handle Unmatched Sessions
    attendanceSessions.forEach(s => {
        if (!usedSessionIds.has(s.id)) {
            let label = 'Ca Ngoài Lịch';
            let duration = 0;
            let cssClass = 'chip-orange';
            let isClickable = false;

            const start = new Date(s.checkIn || s.start);
            const startStr = start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            let tooltip = `Chấm công không khớp lịch (Vào ca: ${startStr})`;

            if (s.checkOut) {
                const end = new Date(s.checkOut);
                const endStr = end.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                duration = (end - start) / 60000;

                // NEW: Role Logic
                if (s.role) {
                    cssClass = 'chip-green';
                    label = `${startStr}-${endStr} (${s.roleName})`;
                    tooltip += ` - Vai trò: ${s.roleName}`;
                } else {
                    cssClass = 'chip-waiting';
                    label = `${startStr}-${endStr} (Chọn Role?)`;
                    tooltip += ' - Bấm để chọn vai trò tính lương';
                }

                tooltip += ` - Làm việc ${Math.floor(duration / 60)}h${Math.floor(duration % 60)}p`;
                isClickable = true;
            } else {
                label = `${startStr}-??? (Đang dạy)`;
                cssClass = 'chip-blue';
            }

            chips.push({
                text: label, // Keep text clean
                class: cssClass,
                paidMinutes: Math.max(0, Math.round(duration)),
                tooltip: tooltip,
                sessionId: s.id,
                sessionData: s,
                isClickable: isClickable,
                isWarning: true // Set flag
            });
        }
    });

    return chips;
}

// ================= SALARY CALCULATION & EVALUATION =================

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

function saveSalarySettings() {
    const staffId = document.getElementById('staff-select').value;
    if (staffId === 'all') return;

    // const rate = document.getElementById('salary-rate').value; // Removed
    const rate = 0; // Legacy
    const advance = document.getElementById('salary-advance').value || 0; // NEW
    const evaluationData = [];

    document.querySelectorAll('.eval-note').forEach((noteInp, index) => {
        const amountInp = document.querySelector(`.eval-amount[data-index="${index}"]`);
        evaluationData.push({
            id: index,
            note: noteInp.value,
            amount: parseFloat(amountInp.value) || 0
        });
    });

    const allSettings = JSON.parse(localStorage.getItem('salary_settings')) || {};
    allSettings[staffId] = { rate, advance, evaluation: evaluationData }; // Added advance
    localStorage.setItem('salary_settings', JSON.stringify(allSettings));

    alert('Đã lưu bảng lương!');
}

function loadSalarySettings() {
    const staffId = document.getElementById('staff-select').value;
    const allSettings = JSON.parse(localStorage.getItem('salary_settings')) || {};
    const settings = allSettings[staffId] || {};

    // document.getElementById('salary-rate').value = settings.rate || 100000; // Removed
    document.getElementById('salary-advance').value = settings.advance || 0; // NEW
    renderEvaluationTable(settings.evaluation || []);
    calculateSalary();
}

// ================= NOTES =================

let currentNoteDateKey = null;

function openNoteModal(dateKey) {
    currentNoteDateKey = dateKey;
    currentEvalIndex = null;

    const staffId = getTargetStaffId();
    const allNotes = JSON.parse(localStorage.getItem('daily_notes')) || {};
    const userNotes = allNotes[staffId] || {};
    document.getElementById('note-modal-title').innerText = `Ghi Chú Ngày ${dateKey}`;
    document.getElementById('note-content').value = userNotes[dateKey] || '';
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

function saveCalendarNote() {
    const staffId = getTargetStaffId();
    const note = document.getElementById('note-content').value.trim();
    const allNotes = JSON.parse(localStorage.getItem('daily_notes')) || {};
    if (!allNotes[staffId]) allNotes[staffId] = {};

    if (note) allNotes[staffId][currentNoteDateKey] = note;
    else delete allNotes[staffId][currentNoteDateKey];

    localStorage.setItem('daily_notes', JSON.stringify(allNotes));
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
        // Handle missing staff-select (e.g., on nhan-vien.html in admin view)
        if (!select) {
            return localStorage.getItem('currentUserId') || localStorage.getItem('currentUser');
        }
        return select.value === 'all' ? localStorage.getItem('currentUserId') : select.value;
    } else {
        return localStorage.getItem('currentUserId') || localStorage.getItem('currentUser');
    }
}


window.onclick = function (event) {
    const modal = document.getElementById('note-modal');
    if (event.target == modal) closeNoteModal();
}

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
    str = str.replace(/Y|Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

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

    const newData = {
        checkIn: checkInDate.toISOString(),
        start: checkInDate.toISOString(),
        checkOut: checkOutDate ? checkOutDate.toISOString() : null
    };

    try {
        if (sessionIdRaw === 'NEW') {
            // CREATE NEW SESSION
            // We need to fetch current sessions, add new one, and save.
            await DBService.addSession(staffId, dateKey, newData);
            alert("Đã tạo ca làm việc mới!");
        } else {
            // UPDATE EXISTING
            const parsedSessionId = isNaN(sessionIdRaw) ? sessionIdRaw : Number(sessionIdRaw);
            await DBService.updateSession(staffId, dateKey, parsedSessionId, newData);
            alert("Cập nhật thành công!");
        }
        closeEditModal();
        renderMonthReport(currentDate);
    } catch (e) {
        alert("Lỗi: " + e.message);
    }
}

// ================= EXPORT PDF (CUSTOM FORM) =================

function exportSalaryPDF() {
    // 1. Get Data
    const staffSelect = document.getElementById('staff-select');
    const staffId = staffSelect.value;
    const staffName = staffSelect.options[staffSelect.selectedIndex].text.split('(')[0].trim();
    if (staffId === 'all') { alert("Vui lòng chọn nhân viên để xuất file"); return; }

    // const rate = parseFloat(document.getElementById('salary-rate').value) || 0; // Removed
    const rate = 0; // Legacy logic removal
    const advance = parseFloat(document.getElementById('salary-advance').value) || 0;

    // Evaluation Items
    let totalBonus = 0;
    const evalItems = [];
    document.querySelectorAll('.eval-amount').forEach((inp, idx) => {
        const val = parseFloat(inp.value) || 0;
        totalBonus += val;
        // Find saved note
        const noteInp = document.querySelector(`.eval-note[data-index="${idx}"]`);
        const item = EVALUATION_CRITERIA[idx];

        let displayNote = '';
        // If template exists and not much note, show template? Or show saved note? 
        // User form shows specific text like "Vắng phép: 0...". 
        // We will assume the Note input contains this text if edited, or empty.
        // If user didn't edit note, we might want to show default template if available?
        // Let's rely on what's in the note field (user should fill it).
        // Fallback: if note is empty, show template (if any)

        /// ACTUALLY: User form has specific text. The User should input this into the Note field using the Edit 📝 button.
        displayNote = noteInp.value || item.template || '';

        evalItems.push({
            label: item.label,
            title: item.tooltip,
            note: displayNote,
            amount: val
        });
    });

    // --- FIX: Use Filtered Data for PDF ---
    // Ensure data is fresh
    calculateSalary();

    const filterType = document.getElementById('salary-role-filter') ? document.getElementById('salary-role-filter').value : 'all';
    const chips = window.currentMonthChips || [];
    let filteredMinutes = 0;

    // Recalculate filtered minutes matching calculateSalary logic
    chips.forEach(chip => {
        if (!chip.sessionData) return;
        let include = false;
        if (filterType === 'all') {
            include = true;
        } else if (filterType === 'giao-vien') {
            const nameRaw = (chip.sessionData.roleName || '').toLowerCase();
            const name = removeVietnameseTones(nameRaw);
            if (name.includes('tiep') || name.includes('le') || name.includes('reception')) {
                include = false;
            } else if (chip.isTeaching || name.includes('gv') || name.includes('giao') || name.includes('tro') || name.includes('ta')) {
                include = true;
            }
        } else if (filterType === 'tiep-tan') {
            const nameRaw = (chip.sessionData.roleName || '').toLowerCase();
            const name = removeVietnameseTones(nameRaw);
            if (name.includes('tiep') || name.includes('le') || name.includes('reception')) {
                include = true;
            }
        }

        if (include) {
            filteredMinutes += (chip.paidMinutes || 0);
        }
    });

    const totalHoursDecimal = filteredMinutes / 60;
    const baseSalary = window.currentMonthSalary || 0; // Use global calc from calculateSalary()
    const initialTotal = baseSalary + totalBonus;
    const finalNet = initialTotal - advance;

    const month = currentDate.getMonth() + 1;
    const year = currentDate.getFullYear();

    const fmt = (n) => new Intl.NumberFormat('vi-VN').format(n);

    // 2. Build HTML
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Bang_Luong_${staffName}_${month}_${year}</title>
            <style>
                body { font-family: 'Times New Roman', serif; padding: 20px; }
                .header { text-align: center; font-weight: bold; margin-bottom: 20px; text-transform: uppercase; }
                .sub-header { margin-bottom: 10px; font-weight: bold; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                th, td { border: 1px solid black; padding: 8px; vertical-align: middle; }
                .red-text { color: red; font-weight: bold; }
                .bold { font-weight: bold; }
                .right { text-align: right; }
                .center { text-align: center; }
                .no-border-top { border-top: none; }
                .footer-note { font-style: italic; margin-top: 10px; font-size: 0.9em; }
                .warning { color: red; font-weight: bold; margin-top: 10px; }
            </style>
        </head>
        <body>
            <div class="header">
                TRUNG TÂM NGOẠI NGỮ TƯ DUY TRẺ
            </div>
            
            <div class="sub-header">
                MÃ NHÂN VIÊN: ${staffId.substring(0, 6).toUpperCase()} &nbsp;&nbsp;&nbsp;&nbsp; HỌ VÀ TÊN: ${staffName.toUpperCase()}
                <br>LOẠI CÔNG VIỆC: ${filterType === 'all' ? 'Tất cả' : (filterType === 'tiep-tan' ? 'Tiếp tân' : 'Giáo viên/Trợ giảng')}
            </div>
            <div style="margin-bottom: 15px;">
                Tổng số tháng làm việc năm ${year} (từ sau tết âm lịch): ...
            </div>

            <table>
                <!-- TOTAL SALARY ROW -->
                <tr>
                    <td class="bold red-text" style="width: 70%">TỔNG LƯƠNG (1)</td>
                    <td class="bold red-text right">${fmt(initialTotal)}</td>
                </tr>

                <!-- HOURS & RATE -->
                <tr>
                    <td class="bold">
                        TỔNG SỐ GIỜ: ${Math.floor(filteredMinutes / 60)} giờ ${Math.floor(filteredMinutes % 60)} phút
                        <br><br>
                        LƯƠNG CƠ BẢN:
                    </td>
                    <td class="bold right" style="vertical-align: top;">${fmt(baseSalary)}</td>
                </tr>

                <!-- PLACEHOLDERS FOR SPECIFIC TYPES -->
                <tr><td>SOẠN BÀI/ CHẤM BÀI/ SỰ KIỆN/ PHÁT SINH: giờ</td><td></td></tr>
                <tr><td>TỔNG SỐ GIỜ MẦM NON: giờ</td><td></td></tr>
                <tr><td>TỔNG SỐ GIỜ GTNL/TOEIC/IELTS: giờ</td><td></td></tr>
                <tr><td>TỔNG SỐ GIỜ LIÊN KẾT: giờ</td><td></td></tr>
                <tr><td>TỔNG SỐ GIỜ KÈM 1:1 TẠI NHÀ: giờ</td><td></td></tr>
                <tr><td>TRỢ CẤP CHỨC VỤ:</td><td></td></tr>

                <!-- TOTAL BONUS ROW -->
                <tr>
                    <td class="bold">TỔNG THƯỞNG (I+II+III+IV+V+VI+VII+VIII+IX):</td>
                    <td class="bold right">${fmt(totalBonus)}</td>
                </tr>

                <!-- EVALUATION ITEMS Rows -->
                ${evalItems.map(item => `
                    <tr>
                        <td>
                            <div style="display:flex;">
                                <div style="width: 40%; font-weight:bold;">(${item.label}) ${item.title}</div>
                                <div style="width: 60%;">${item.note}</div>
                            </div>
                        </td>
                        <td class="right">${item.amount !== 0 ? fmt(item.amount) : ''}</td>
                    </tr>
                `).join('')}

                <!-- ADVANCE -->
                <tr>
                    <td class="bold red-text">TẠM ỨNG (2)</td>
                    <td class="right">${advance !== 0 ? fmt(advance) : ''}</td>
                </tr>

                <!-- NET PAY -->
                <tr>
                    <td class="bold red-text">THỰC LÃNH (1)-(2)</td>
                    <td class="bold red-text right">${fmt(finalNet)}</td>
                </tr>
            </table>

            <div class="footer-note">
                Lưu ý: Nếu bảng lương có sai sót vui lòng liên hệ chị Thúy (bộ phận nhân sự) vào sáng giờ hành chính (7h-11h)
            </div>
            <div class="warning">
                *LƯU Ý: - Lương tháng ${month}/${year} chưa bao gồm phí soạn bài bên chị Tiên, phí soạn bài vui lòng liên hệ chị Tiên!
            </div>

            <script>
                window.print();
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

async function deleteSessionFromModal() {
    if (!confirm("Bạn có chắc chắn muốn xóa phiên làm việc này không?")) return;

    const staffId = getTargetStaffId();
    const dateKey = document.getElementById('edit-date-key').value;
    const sessionId = document.getElementById('edit-session-id').value;
    const parsedSessionId = isNaN(sessionId) ? sessionId : Number(sessionId);

    try {
        await DBService.deleteSession(staffId, dateKey, parsedSessionId);
        alert("Đã xóa!");
        closeEditModal();
        renderMonthReport(currentDate);
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
    const dateKey = document.getElementById('role-select-date').value;
    const sessionId = document.getElementById('role-select-session').value;

    try {
        await DBService.updateSessionRole(staffId, dateKey, sessionId, role);
        closeRoleSelectModal();
        renderMonthReport(new Date(dateKey)); // Reload report specifically around this date
    } catch (e) {
        alert("Lỗi lưu vai trò: " + e.message);
    }
}

// Helper for Vietnamese String Comparison
function removeVietnameseTones(str) {
    if (!str) return '';
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    // Some system encode vietnamese combining accent as individual utf-8 characters
    str = str.replace(/\u0300|\u0301|\u0303|\u0309|\u0323/g, ""); // ̀ ́ ̃ ̉ ̣ 
    str = str.replace(/\u02C6|\u0306|\u031B/g, ""); // ˆ ̆ ̛  Â, Ê, Ă, Ơ, Ư
    str = str.replace(/ + /g, " ");
    str = str.trim();
    return str;
}
