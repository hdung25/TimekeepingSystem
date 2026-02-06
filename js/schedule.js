// Schedule Management Logic

document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if we are on the page with schedule elements
    if (document.getElementById('schedule-table')) {
        initSchedule();
    }
});

let currentWeekStart = new Date(); // Start of the currently selected week (Monday)
let selectedDayIndex = 0; // 0 = Monday, 6 = Sunday
const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];

// Define 6 Sections (Shifts)
// Define 6 Sections (Shifts)
const SECTIONS = [
    { key: 'morning1', label: 'Sáng - Ca 1', defaultStart: '07:30', defaultEnd: '09:00' },
    { key: 'morning2', label: 'Sáng - Ca 2', defaultStart: '09:15', defaultEnd: '10:45' },
    { key: 'afternoon1', label: 'Chiều - Ca 1', defaultStart: '14:00', defaultEnd: '15:30' },
    { key: 'afternoon2', label: 'Chiều - Ca 2', defaultStart: '15:30', defaultEnd: '17:00' },
    { key: 'evening1', label: 'Tối - Ca 1', defaultStart: '18:00', defaultEnd: '19:30' },
    { key: 'evening2', label: 'Tối - Ca 2', defaultStart: '19:30', defaultEnd: '21:00' }
];

function initSchedule() {
    // 1. Align currentWeekStart to the previous Monday
    const day = currentWeekStart.getDay();
    const diff = currentWeekStart.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    currentWeekStart.setDate(diff);
    currentWeekStart.setHours(0, 0, 0, 0);

    // 2. Set today's tab as active initially
    const today = new Date().getDay(); // 0 is Sunday
    selectedDayIndex = today === 0 ? 6 : today - 1;

    // 3. Render initial views
    renderWeekPicker();
    renderDayTabs();
    renderTable();

    // 4. Check for Admin/Assistant Role to show Save Button
    const role = localStorage.getItem('currentRole');
    if (role === 'admin' || role === 'assistant') {
        const adminActions = document.getElementById('admin-actions');
        if (adminActions) adminActions.style.display = 'block';
    }

    // 5. Event Listeners
    document.getElementById('prev-week').addEventListener('click', () => changeWeek(-7));
    document.getElementById('next-week').addEventListener('click', () => changeWeek(7));
}

function changeWeek(offsetDays) {
    currentWeekStart.setDate(currentWeekStart.getDate() + offsetDays);
    renderWeekPicker();
    renderDayTabs();
    renderTable();
}

function renderWeekPicker() {
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const startStr = formatDateShort(currentWeekStart);
    const endStr = formatDateShort(weekEnd);

    document.getElementById('week-display').innerText = `${startStr} - ${endStr}`;
}

function renderDayTabs() {
    const container = document.getElementById('day-tabs');
    container.innerHTML = '';

    DAYS.forEach((dayName, index) => {
        const tabDate = new Date(currentWeekStart);
        tabDate.setDate(tabDate.getDate() + index);
        const dateKey = getLocalDateKey(tabDate);
        const holiday = getHolidayName(dateKey);

        const btn = document.createElement('div');
        btn.className = `day-tab ${index === selectedDayIndex ? 'active' : ''}`;

        let holidayHtml = '';
        if (holiday) {
            holidayHtml = `<div style="font-size: 0.65rem; color: #EF4444; font-weight: bold; margin-top: 2px;">🚩 ${holiday}</div>`;
            if (index !== selectedDayIndex) btn.style.backgroundColor = '#FEF2F2';
        }

        btn.innerHTML = `
            <div>${dayName}</div>
            <div style="font-size: 0.75rem; color: ${index === selectedDayIndex ? 'white' : 'var(--text-muted)'}">${formatDateDayOnly(tabDate)}</div>
            ${holidayHtml}
        `;
        btn.onclick = () => {
            selectedDayIndex = index;
            renderDayTabs();
            renderTable();
        };
        container.appendChild(btn);
    });
}

function getHolidayName(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (m === 1 && d === 1) return "Tết Dương";
    if (m === 4 && d === 30) return "30/4";
    if (m === 5 && d === 1) return "1/5";
    if (m === 9 && d === 2) return "2/9";

    if (y === 2024) {
        if (m === 2 && (d >= 8 && d <= 14)) return "Tết";
        if (m === 4 && d === 18) return "Giỗ Tổ";
    }
    if (y === 2025) {
        if (m === 1 && d >= 28) return "Tết";
        if (m === 2 && d <= 2) return "Tết";
        if (m === 4 && d === 7) return "Giỗ Tổ";
    }
    if (y === 2026) {
        if (m === 2 && (d >= 17 && d <= 22)) return "Tết";
        if (m === 4 && d === 25) return "Giỗ Tổ";
    }
    return null;
}

function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function renderTable() {
    const tbody = document.getElementById('table-body');
    const todayDate = new Date(currentWeekStart);
    todayDate.setDate(todayDate.getDate() + selectedDayIndex);

    const dateKey = getLocalDateKey(todayDate);

    // Check if this is "TODAY" for enabling Join buttons
    const realToday = getLocalDateKey(new Date());
    const isToday = dateKey === realToday;

    document.getElementById('current-day-label').innerText = `${DAYS[selectedDayIndex]}, ${formatDateFull(todayDate)}`;

    // Loading State
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--text-muted);">Đang tải dữ liệu...</td></tr>';

    // Load Data from Cloud
    const dayData = await DBService.getSchedule(dateKey) || {};
    // Note: Timesheet data for confirmation logic will be handled later or can be fetched here
    // For now we will assume local timesheet or fetch it. To avoid breaking, let's keep timesheet local or mock it until fully migrated.
    // Ideally we fetch timesheets too.
    const timesheetData = JSON.parse(localStorage.getItem('timesheet_data')) || {};

    // Determine Role
    const currentRole = localStorage.getItem('currentRole') || 'staff';
    const isAdmin = currentRole === 'admin' || currentRole === 'assistant'; // Assistant behaves like Admin in Schedule

    let html = '';

    SECTIONS.forEach(section => {
        const rows = dayData[section.key] || [];

        // Section Header
        html += `
            <tr>
                <td colspan="${isAdmin ? 8 : 7}" class="section-header">${section.label}</td>
            </tr>
        `;

        if (rows.length === 0 && !isAdmin) {
            html += `<tr><td colspan="7" style="text-align:center; color: var(--text-muted); font-size: 0.875rem; padding: 0.5rem;">không có lớp</td></tr>`;
        }

        rows.forEach((row, idx) => {
            const rowId = `${dateKey}-${section.key}-${idx}`;
            html += renderRow(row, idx, section.key, isAdmin, dateKey, rowId, isToday, timesheetData[rowId]);
        });

        if (isAdmin) {
            html += `
                <tr>
                    <td colspan="8" style="padding: 0.5rem;">
                        <button class="add-row-btn" onclick="addNewRow('${dateKey}', '${section.key}', '${section.defaultStart}', '${section.defaultEnd}')">+ Thêm lớp (${section.label})</button>
                    </td>
                </tr>
            `;
        }
    });

    tbody.innerHTML = html;
}

function renderRow(data, index, caType, isAdmin, dateKey, rowId, isToday, sessionData) {
    const inputClass = isAdmin ? 'table-input' : 'table-input read-only-input';
    const readonlyAttr = isAdmin ? '' : 'readonly';

    // Action Button Logic for Staff
    let actionCell = '';
    if (!isAdmin) {
        const currentUserId = localStorage.getItem('currentUserId');
        const registeredTeachers = data.registeredTeachers || [];
        const isRegistered = registeredTeachers.some(t => t.id === currentUserId);

        if (isRegistered) {
            actionCell = `
                <td style="text-align: center;">
                    <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background-color: var(--secondary-color);" onclick="registerClass('${dateKey}', '${caType}', ${index}, '${data.end}')">
                        Đã Nhận (Hủy)
                    </button>
                    ${registeredTeachers.length > 1 ? `<div style="font-size: 0.65rem; color: var(--text-muted);">+${registeredTeachers.length - 1} người khác</div>` : ''}
                </td>`;
        } else {
            actionCell = `
                <td style="text-align: center;">
                    <button class="btn btn-primary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="registerClass('${dateKey}', '${caType}', ${index}, '${data.end}')">
                        Nhận Lớp
                    </button>
                     ${registeredTeachers.length > 0 ? `<div style="font-size: 0.65rem; color: var(--text-muted);">${registeredTeachers.length} người đã nhận</div>` : ''}
                </td>`;
        }
    } else {
        // Admin View - Action is Delete
        actionCell = `
            <td style="text-align: center;">
                <button class="btn-icon" style="color: #EF4444;" onclick="deleteRow('${dateKey}', '${caType}', ${index})">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </td>`;
    }

    return `
        <tr>
            <td style="text-align: center;">${index + 1}</td>
            <td><input type="time" class="${inputClass}" value="${data.start || ''}" ${readonlyAttr} onchange="updateRow('${dateKey}', '${caType}', ${index}, 'start', this.value)"></td>
            <td><input type="time" class="${inputClass}" value="${data.end || ''}" ${readonlyAttr} onchange="updateRow('${dateKey}', '${caType}', ${index}, 'end', this.value)"></td>
            <td><input type="text" class="${inputClass}" value="${data.lop || ''}" placeholder="Tên lớp" ${readonlyAttr} onchange="updateRow('${dateKey}', '${caType}', ${index}, 'lop', this.value)"></td>
            <td><input type="text" class="${inputClass}" value="${data.phong || ''}" placeholder="Phòng" ${readonlyAttr} onchange="updateRow('${dateKey}', '${caType}', ${index}, 'phong', this.value)"></td>
            <td><input type="text" class="${inputClass}" value="${data.gv || ''}" placeholder="Giáo viên" ${readonlyAttr} onchange="updateRow('${dateKey}', '${caType}', ${index}, 'gv', this.value)"></td>
            <td><input type="text" class="${inputClass}" value="${data.note || ''}" placeholder="Ghi chú" ${readonlyAttr} onchange="updateRow('${dateKey}', '${caType}', ${index}, 'note', this.value)"></td>
            ${actionCell}
        </tr>
    `;
}

// ================= DATA ACTIONS =================

window.addNewRow = async function (dateKey, caType, defaultStart, defaultEnd) {
    const dayData = await DBService.getSchedule(dateKey) || {};
    if (!dayData[caType]) dayData[caType] = [];

    dayData[caType].push({
        start: defaultStart,
        end: defaultEnd,
        lop: '',
        phong: '',
        gv: '',
        note: ''
    });

    await DBService.saveSchedule(dateKey, dayData);
    renderTable();
};

window.updateRow = async function (dateKey, caType, index, field, value) {
    const dayData = await DBService.getSchedule(dateKey);
    if (!dayData || !dayData[caType] || !dayData[caType][index]) return;

    dayData[caType][index][field] = value;

    // Auto-save logic (could be optimized with debounce, but direct save is safer for now)
    await DBService.saveSchedule(dateKey, dayData);
};

window.deleteRow = async function (dateKey, caType, index) {
    if (!await UIService.confirm('Bạn có chắc muốn xóa lớp học này?')) return;

    const dayData = await DBService.getSchedule(dateKey);
    if (!dayData || !dayData[caType]) return;

    dayData[caType].splice(index, 1);

    await DBService.saveSchedule(dateKey, dayData);
    renderTable();
};

window.saveScheduleManual = function () {
    const btn = document.querySelector('#admin-actions button');
    if (btn) {
        // Since we save per row action, this might be redundant or could be used to push all data again.
        // For now, let's keep it as a visual confirmation.
        alert('Dữ liệu đã được lưu thành công! Lịch làm này sẽ được dùng làm mẫu cho các ngày tương lai chưa có lịch.');
    }
}

// 6. GLOBAL REGISTER CLASS
window.registerClass = async function (dateKey, caType, index, endTimeStr) {
    const currentUserId = localStorage.getItem('currentUserId');
    const userFullName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser');

    if (!currentUserId) {
        alert("Lỗi phiên đăng nhập. Vui lòng đăng nhập lại.");
        return;
    }

    // TIME VALIDATION STRICT MODE
    // If endTimeStr is provided, check if class has ended.
    if (endTimeStr) {
        const now = new Date();
        const classEnd = new Date(`${dateKey}T${endTimeStr}`);

        // Add 15 mins buffer? Or strict? User said "tránh việc vào ca ra ca rồi sau đó nút nhận lớp".
        // Strict END time seems appropriate.
        if (now > classEnd) {
            alert("Đã hết giờ học! Không thể nhận lớp sau khi ca dạy đã kết thúc.");
            return;
        }
    }

    const isConfirm = await UIService.confirm('Xác nhận thay đổi trạng thái đăng ký lớp này?');
    if (!isConfirm) return;

    // UI Optimistic Update (Optional, but let's just reload table after async)
    // Show loading? table body opacity 0.5?

    try {
        await DBService.registerClass(dateKey, caType, { index }, { id: currentUserId, name: userFullName });
        await renderTable(); // Reload to see changes
    } catch (e) {
        alert("Lỗi: " + e.message);
    }
};

// ================= HELPERS =================

function formatDateShort(date) {
    return `${date.getDate()}/${date.getMonth() + 1}`;
}

function formatDateDayOnly(date) {
    return `${date.getDate()}/${date.getMonth() + 1}`;
}

function formatDateFull(date) {
    return `Ngày ${date.getDate()} tháng ${date.getMonth() + 1} năm ${date.getFullYear()}`;
}
