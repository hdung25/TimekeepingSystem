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
    let staffId = null;

    if (role === 'admin') {
        const select = document.getElementById('staff-select');
        staffId = select ? select.value : 'all';
    } else {
        staffId = localStorage.getItem('currentUserId');
        if (!staffId) {
            // Fallback lookup
            const username = localStorage.getItem('currentUser');
            const users = JSON.parse(localStorage.getItem('users_data')) || [];
            const me = users.find(u => u.username === username);
            if (me) staffId = me.id;
        }
    }

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
            div.title = `${chip.tooltip} (${chip.paidMinutes}m)`;

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
        });

        // --- Daily Total Footer ---
        const dailyTotalMinutes = chips.reduce((acc, chip) => acc + (chip.paidMinutes || 0), 0);
        if (dailyTotalMinutes > 0) {
            const h = Math.floor(dailyTotalMinutes / 60);
            const m = Math.floor(dailyTotalMinutes % 60);
            const footer = document.createElement('div');
            footer.style.marginTop = 'auto'; // Push to bottom
            footer.style.paddingTop = '4px';
            footer.style.borderTop = '1px dashed #E5E7EB';
            footer.style.fontSize = '0.75rem';
            footer.style.fontWeight = '700';
            footer.style.color = '#7C3AED'; // Violet color for total
            footer.style.textAlign = 'right';
            footer.innerText = `Tổng: ${h}h ${m}p`;
            cell.appendChild(footer);
        }

        // Show "Extra" sessions (Check-in but no class match) - Optional improvement
        // For now, let's keep it simple as requested. BUt check for "Unmatched" logic later if needed.

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
    if (role === 'admin') {
        loadSalarySettings();
    }
}

// Logic to Merge Schedule & Attendance
function calculateDailyChips(schedule, attendanceSessions, staffId, dateStr, currentUserContext) {
    const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
    const chips = [];

    // We need to track which attendance sessions have been "consumed" (matched to a class)
    // so we can display extra attendance (unmatched) if any? 
    // For simplicity, we stick to the SECTION flow first.

    sections.forEach(secKey => {
        const classes = schedule[secKey] || [];
        classes.forEach((cls, idx) => {
            // 1. Check if User Registered OR Assigned by Name
            const registeredTeachers = cls.registeredTeachers || [];
            let isRegistered = registeredTeachers.some(t => t.id === staffId);

            // Fallback: Check if 'gv' field matches Name or Username
            if (!isRegistered && cls.gv) {
                // Try to match with normalize
                // We assume 'currentUserContext' is loaded at start of render
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

            // Find session close to start (within 60 mins)
            const matchedSession = attendanceSessions.find(s => {
                const checkIn = new Date(s.checkIn || s.start);
                const diffMs = Math.abs(checkIn - schedStart);
                return diffMs < 60 * 60 * 1000;
            });

            // 3. Determine Status
            let minutes = 0;
            let cssClass = 'chip-blue';
            let label = `${cls.start}-${cls.end}`;
            let tooltip = `Lớp ${cls.lop || '?'}`;

            const schedEnd = new Date(`${dateStr}T${cls.end}`);
            const schedDuration = (schedEnd - schedStart) / 60000;
            const now = new Date();

            if (matchedSession) {
                // --- CASE A: ATTENDED (Has Check-in) ---
                if (matchedSession.checkOut) {
                    // FULL CHECK-IN/OUT
                    const actualStart = new Date(matchedSession.checkIn || matchedSession.start);
                    // Use Schedule Duration for Pay if Registered (User Rule)
                    // But if Late? (Case: Late Check-in)

                    const diffMs = schedStart - actualStart;
                    const diffMins = Math.floor(diffMs / 60000);

                    if (diffMs < 0) {
                        // Late
                        const lateMinutesRaw = Math.floor(Math.abs(diffMs) / 60000);
                        const remainingSched = (schedEnd - actualStart) / 60000;
                        minutes = Math.max(0, remainingSched);
                        label += ` (Trễ ${lateMinutesRaw}p)`;
                        cssClass = 'chip-orange'; // Late is warning
                    } else {
                        // On Time / Early
                        minutes = schedDuration;
                        label += ' (Hoàn thành)'; // Changed from (v)
                        cssClass = 'chip-green';
                    }
                    tooltip += ' - Đã chấm công đầy đủ';
                } else {
                    // CHECKED IN, NO CHECK OUT
                    const classEndTime = new Date(`${dateStr}T${cls.end}`);
                    // If current time is past class end time + 30 mins -> Forgot Check-out
                    // Else -> Teaching
                    if (now > new Date(classEndTime.getTime() + 30 * 60000)) {
                        // FORGOT CHECK-OUT
                        minutes = schedDuration;
                        cssClass = 'chip-orange';
                        label += ' (Quên ra)';
                        tooltip += ' - Quên Check-out (Tính đủ giờ)';
                    } else {
                        // TEACHING (Still within valid time)
                        minutes = 0; // Not paid yet
                        cssClass = 'chip-blue'; // Active
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
                    sessionData: matchedSession
                });

            } else {
                // --- CASE B: NO ATTENDANCE RECORD ---
                const classDateTime = new Date(`${dateStr}T${cls.start}`);

                if (classDateTime > now) {
                    // FUTURE
                    minutes = 0;
                    cssClass = 'chip-blue';
                    label += ' (Sắp tới)';
                    tooltip += ' - Chưa diễn ra';
                } else {
                    // PAST (ABSENT)
                    minutes = 0;
                    cssClass = 'chip-gray'; // Gray for absent
                    label += ' (Vắng)';
                    tooltip += ' - Không có dữ liệu chấm công';
                }

                chips.push({
                    text: label,
                    class: cssClass,
                    paidMinutes: 0,
                    tooltip: tooltip,
                    sessionId: null
                });
            }
        });
    });

    // TODO: Handle "Attendance without Class"? 
    // If user checks in but no class registered. Currently ignored.
    // User requested "Calendar" logic matching "Registered Classes".

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
    const rateInput = document.getElementById('salary-rate');
    if (!rateInput) return;

    const rate = parseFloat(rateInput.value) || 0;
    let totalBonus = 0;
    document.querySelectorAll('.eval-amount').forEach(input => {
        totalBonus += parseFloat(input.value) || 0;
    });

    updateBonusDisplay(totalBonus);

    const minutes = window.lastTotalMinutes || 0;
    const hoursDecimal = minutes / 60;
    const totalSalary = (hoursDecimal * rate) + totalBonus;

    const finalDisplay = document.getElementById('final-salary-display');
    if (finalDisplay) finalDisplay.innerText = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalSalary);
}

function saveSalarySettings() {
    const staffId = document.getElementById('staff-select').value;
    if (staffId === 'all') return;

    const rate = document.getElementById('salary-rate').value;
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
    allSettings[staffId] = { rate, evaluation: evaluationData };
    localStorage.setItem('salary_settings', JSON.stringify(allSettings));

    alert('Đã lưu bảng lương!');
}

function loadSalarySettings() {
    const staffId = document.getElementById('staff-select').value;
    const allSettings = JSON.parse(localStorage.getItem('salary_settings')) || {};
    const settings = allSettings[staffId] || {};

    document.getElementById('salary-rate').value = settings.rate || 100000;
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
        return select.value === 'all' ? 'admin' : select.value;
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
function openEditModal(dateKey, sessionId, sessionData) {
    document.getElementById('edit-time-modal').style.display = 'flex';
    document.getElementById('edit-date-key').value = dateKey;
    document.getElementById('edit-session-id').value = sessionId;

    // Convert ISO string to datetime-local format (YYYY-MM-DDTHH:mm)
    const toLocalISO = (isoStr) => {
        if (!isoStr) return '';
        const date = new Date(isoStr);
        // Adjust to local time zone for input
        // Using a trick: new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        // BUT simplistic handling:
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
}

function closeEditModal() {
    document.getElementById('edit-time-modal').style.display = 'none';
}

async function saveEditedTime() {
    const staffId = getTargetStaffId();
    const dateKey = document.getElementById('edit-date-key').value;
    const sessionId = document.getElementById('edit-session-id').value; // String in hidden input

    // Note: sessionId might be timestamp number or string. DBService expects number usually for ID? 
    // Wait, original ID is number (Date.now()). But inputs are strings.
    // We should parse it if it looks like a number.
    const parsedSessionId = isNaN(sessionId) ? sessionId : Number(sessionId);

    const checkIn = document.getElementById('edit-check-in').value;
    const checkOut = document.getElementById('edit-check-out').value;

    if (!checkIn) {
        alert("Giờ vào không được để trống!");
        return;
    }

    // Convert back to ISO
    const checkInDate = new Date(checkIn);
    const checkOutDate = checkOut ? new Date(checkOut) : null;

    const newData = {
        checkIn: checkInDate.toISOString(),
        start: checkInDate.toISOString(), // Sync legacy field
        checkOut: checkOutDate ? checkOutDate.toISOString() : null
    };

    try {
        await DBService.updateSession(staffId, dateKey, parsedSessionId, newData);
        alert("Cập nhật thành công!");
        closeEditModal();
        renderMonthReport(currentDate); // Reload
    } catch (e) {
        alert("Lỗi cập nhật: " + e.message);
    }
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
