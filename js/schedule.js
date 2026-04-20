// Schedule Management Logic

document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if we are on the page with schedule elements
    if (document.getElementById('schedule-table')) {
        initSchedule();
    }
});

let currentWeekStart = new Date(); // Start of the currently selected week (Monday)
let selectedDayIndex = 0; // 0 = Monday, 6 = Sunday
let currentBranch = 'cs1'; // Multi-branch support
const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];

const SECTIONS = [
    { key: 'morning1', label: 'Sáng - Ca 1', defaultStart: '07:30', defaultEnd: '09:00' },
    { key: 'morning2', label: 'Sáng - Ca 2', defaultStart: '09:15', defaultEnd: '10:45' },
    { key: 'afternoon1', label: 'Chiều - Ca 1', defaultStart: '14:00', defaultEnd: '15:30' },
    { key: 'afternoon2', label: 'Chiều - Ca 2', defaultStart: '15:30', defaultEnd: '17:00' },
    { key: 'evening1', label: 'Tối - Ca 1', defaultStart: '18:00', defaultEnd: '19:30' },
    { key: 'evening2', label: 'Tối - Ca 2', defaultStart: '19:30', defaultEnd: '21:00' }
];

// Branch helpers
function getCompositeKey(dateKey) {
    return `${currentBranch}__${dateKey}`;
}

window.switchBranch = function (branchId) {
    currentBranch = branchId;
    // Update tab UI
    document.querySelectorAll('.branch-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.branch === branchId);
    });
    renderTable();
};

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
    const roleRaw = localStorage.getItem('currentRole');
    const roles = typeof parseRoles === 'function' ? parseRoles(roleRaw) : (roleRaw ? [roleRaw] : []);
    const isEditor = roles.some(r => ['admin', 'assistant', 'senior_assistant'].includes(r));
    if (isEditor) {
        const adminActions = document.getElementById('admin-actions');
        if (adminActions) adminActions.style.display = 'block';
        // Load teacher list & subject list for dropdowns
        loadTeacherListForSchedule();
        loadSubjectListForSchedule();
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
    const compositeKey = getCompositeKey(dateKey);

    // Check if this is "TODAY" for enabling Join buttons
    const realToday = getLocalDateKey(new Date());
    const isToday = dateKey === realToday;

    // Branch label in header
    const branchLabel = { cs1: 'Cơ Sở 1', cs2: 'Cơ Sở 2', cs3: 'Cơ Sở 3' }[currentBranch] || currentBranch.toUpperCase();
    document.getElementById('current-day-label').innerText = `${DAYS[selectedDayIndex]}, ${formatDateFull(todayDate)} — ${branchLabel}`;

    // Loading State
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 2rem; color: var(--text-muted);">Đang tải dữ liệu...</td></tr>';

    // Load Data from Cloud (branch-prefixed)
    const dayData = await DBService.getSchedule(compositeKey) || {};
    const timesheetData = JSON.parse(localStorage.getItem('timesheet_data')) || {};

    // Fetch attendance for GV absent highlight (past/today only)
    let presentUserIds = new Set();
    const todayRealKey = getLocalDateKey(new Date());
    if (dateKey <= todayRealKey) {
        try { presentUserIds = await DBService.getDayAttendance(dateKey); } catch(e) {}
    }

    // Determine Role
    const currentRole = localStorage.getItem('currentRole');
    const currentRoles = typeof parseRoles === 'function' ? parseRoles(currentRole) : (currentRole ? [currentRole] : []);
    const isAdmin = currentRoles.some(r => ['admin', 'assistant', 'senior_assistant'].includes(r)); // Assistant behaves like Admin in Schedule
    // isTeacherOrStaff: true nếu user có bất kỳ role nào liên quan đến dạy/nhân viên
    // (dù họ cũng có role admin) → đảm bảo họ thấy nút "Nhận Lớp"
    const _teacherKeywords = ['gv', 'teacher', 'trợ giảng', 'gv ta', 'nhân viên'];
    const isTeacherOrStaff = currentRoles.some(r => {
        const rl = r.toLowerCase();
        return _teacherKeywords.some(kw => rl.includes(kw)) ||
               ['staff', 'teaching_assistant', 'receptionist', 'receptionist_assistant'].includes(r);
    });

    let html = '';

    // Column counts: admin=10 (SS,Start,End,Lop,Phong,GV,GVTT,SoHS,Note,Del), non-admin=9
    const totalCols = isAdmin ? 10 : 9;

    SECTIONS.forEach(section => {
        const rows = dayData[section.key] || [];

        // Section Header
        html += `<tr><td colspan="${totalCols}" class="section-header">${section.label}</td></tr>`;

        if (rows.length === 0 && !isAdmin) {
            html += `<tr><td colspan="${totalCols}" style="text-align:center; color: var(--text-muted); font-size: 0.875rem; padding: 0.5rem;">không có lớp</td></tr>`;
        }

        rows.forEach((row, idx) => {
            const rowId = `${dateKey}-${section.key}-${idx}`;
            html += renderRow(row, idx, section.key, isAdmin, compositeKey, rowId, isToday, timesheetData[rowId], isTeacherOrStaff, presentUserIds, dateKey, todayRealKey);
        });

        if (isAdmin) {
            html += `
                <tr>
                    <td colspan="${totalCols}" style="padding: 0.5rem;">
                        <button class="add-row-btn" onclick="addNewRow('${compositeKey}', '${section.key}', '${section.defaultStart}', '${section.defaultEnd}')">+ Thêm lớp (${section.label})</button>
                    </td>
                </tr>
            `;
        }
    });

    tbody.innerHTML = html;
}

function renderRow(data, index, caType, isAdmin, compositeKey, rowId, isToday, sessionData, isTeacherOrStaff = false, presentUserIds = new Set(), dateKey = '', todayRealKey = '') {
    const inputClass = isAdmin ? 'table-input' : 'table-input read-only-input';
    const readonlyAttr = isAdmin ? '' : 'readonly';

    // === GV ABSENT HIGHLIGHT ===
    // A GV is "absent" if: assigned (gvId set), date is past/today, and NOT in attendance
    const gvId = data.gvId || '';
    const isPastOrToday = dateKey && todayRealKey && dateKey <= todayRealKey;
    const gvIsAbsent = isPastOrToday && gvId && !presentUserIds.has(gvId);
    const gvDisplayStyle = gvIsAbsent
        ? 'color:#EF4444;text-decoration:line-through;font-weight:600;'
        : '';
    const gvAbsentBadge = gvIsAbsent
        ? '<div style="font-size:0.65rem;color:#EF4444;margin-top:2px;">⚠ Vắng</div>'
        : '';

    // === GV FIELD ===
    let gvCell = '';
    if (isAdmin) {
        // Admin: editable text input with datalist autocomplete
        const gvVal = (data.gv || '').replace(/"/g, '&quot;');
        gvCell = `<td>
            <input type="text" class="table-input" value="${gvVal}" placeholder="Giáo viên"
                list="gv-teacher-list"
                onchange="updateGVRow('${compositeKey}', '${caType}', ${index}, this.value)">
        </td>`;
    } else {
        // Non-admin: read-only display with absent highlight
        gvCell = `<td style="font-size:0.875rem;">
            <span style="${gvDisplayStyle}">${data.gv || ''}</span>
            ${gvAbsentBadge}
        </td>`;
    }

    // === SỐ HS FIELD ===
    let soHSCell = '';
    if (isAdmin) {
        soHSCell = `<td><input type="number" class="table-input" value="${data.soHS || ''}" placeholder="HS" min="0"
            style="width:60px;text-align:center;"
            onchange="updateRow('${compositeKey}', '${caType}', ${index}, 'soHS', parseInt(this.value)||0)"></td>`;
    } else {
        const hs = data.soHS || '';
        const hsStyle = hs > 10 ? 'color:var(--primary-color);font-weight:700;' : 'color:var(--text-muted);';
        soHSCell = `<td style="text-align:center;font-size:0.875rem;"><span style="${hsStyle}">${hs || '—'}</span></td>`;
    }

    // === ACTION CELL ===
    let actionCell = '';
    if (isAdmin) {
        // Admin: Delete button
        actionCell = `
            <td style="text-align: center;">
                <button class="btn-icon" style="color: #EF4444;" onclick="deleteRow('${compositeKey}', '${caType}', ${index})">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </td>`;
    } else {
        // Non-admin: no action needed (GV auto-assigned by admin)
        actionCell = '<td></td>';
    }

    // === CỘT LỚP (Môn học datalist) ===
    const lopVal = (data.lop || '').replace(/"/g, '&quot;');
    let lopCell = '';
    if (isAdmin) {
        lopCell = `<td><input type="text" class="table-input" value="${lopVal}" placeholder="Môn học"
            list="subject-list"
            onchange="updateSubjectRow('${compositeKey}', '${caType}', ${index}, this.value)"></td>`;
    } else {
        const subjectColor = (window._subjectList || []).find(s => s.name === data.lop)?.color || '';
        const dotHtml = subjectColor ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${subjectColor};margin-right:4px;"></span>` : '';
        lopCell = `<td style="font-size:0.875rem;">${dotHtml}${data.lop || ''}</td>`;
    }

    // === CỘT GV THAY THẾ ===
    const gvTTId = data.gvThayTheId || '';
    const gvTTName = (data.gvThayThe || '').replace(/"/g, '&quot;');
    let gvTTCell = '';
    if (isAdmin) {
        const clearBtn = gvTTName
            ? `<button onclick="clearGVThayThe('${compositeKey}','${caType}',${index})" title="Xóa GV thay thế"
                style="background:none;border:none;cursor:pointer;color:#EF4444;font-size:0.8rem;padding:0 2px;vertical-align:middle;">✕</button>`
            : '';
        gvTTCell = `<td>
            <input type="text" class="table-input" value="${gvTTName}" placeholder="GV thay thế"
                list="gv-teacher-list"
                onchange="updateGVThayTheRow('${compositeKey}', '${caType}', ${index}, this.value)"
                style="${gvTTName ? 'color:#D97706;font-weight:600;' : ''}">
            ${clearBtn}
        </td>`;
    } else {
        if (gvTTName) {
            gvTTCell = `<td style="font-size:0.875rem;color:#D97706;font-weight:600;">↔ ${gvTTName}</td>`;
        } else {
            gvTTCell = `<td style="color:var(--text-muted);font-size:0.75rem;text-align:center;">—</td>`;
        }
    }

    return `
        <tr>
            <td style="text-align: center;">${index + 1}</td>
            <td><input type="time" class="${inputClass}" value="${data.start || ''}" ${readonlyAttr} onchange="updateRow('${compositeKey}', '${caType}', ${index}, 'start', this.value)"></td>
            <td><input type="time" class="${inputClass}" value="${data.end || ''}" ${readonlyAttr} onchange="updateRow('${compositeKey}', '${caType}', ${index}, 'end', this.value)"></td>
            ${lopCell}
            <td><input type="text" class="${inputClass}" value="${data.phong || ''}" placeholder="Phòng" ${readonlyAttr} onchange="updateRow('${compositeKey}', '${caType}', ${index}, 'phong', this.value)"></td>
            ${gvCell}
            ${gvTTCell}
            ${soHSCell}
            <td><input type="text" class="${inputClass}" value="${data.note || ''}" placeholder="Ghi chú" ${readonlyAttr} onchange="updateRow('${compositeKey}', '${caType}', ${index}, 'note', this.value)"></td>
            ${actionCell}
        </tr>
    `;
}

// ================= DATA ACTIONS =================

window.addNewRow = async function (compositeKey, caType, defaultStart, defaultEnd) {
    const dayData = await DBService.getSchedule(compositeKey) || {};
    if (!dayData[caType]) dayData[caType] = [];

    dayData[caType].push({
        start: defaultStart,
        end: defaultEnd,
        lop: '',
        lopId: '',
        phong: '',
        gv: '',
        gvId: '',
        gvThayThe: '',
        gvThayTheId: '',
        soHS: 0,
        note: ''
    });

    await DBService.saveSchedule(compositeKey, dayData);
    renderTable();
};

window.updateRow = async function (compositeKey, caType, index, field, value) {
    const dayData = await DBService.getSchedule(compositeKey);
    if (!dayData || !dayData[caType] || !dayData[caType][index]) return;

    dayData[caType][index][field] = value;
    await DBService.saveSchedule(compositeKey, dayData);
};

window.deleteRow = async function (compositeKey, caType, index) {
    if (!await UIService.confirm('Bạn có chắc muốn xóa lớp học này?')) return;

    const dayData = await DBService.getSchedule(compositeKey);
    if (!dayData || !dayData[caType]) return;

    dayData[caType].splice(index, 1);

    await DBService.saveSchedule(compositeKey, dayData);
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

// 6. GLOBAL REGISTER CLASS (compositeKey = 'cs1__2026-02-21')
window.registerClass = async function (compositeKey, caType, index, endTimeStr) {
    const currentUserId = localStorage.getItem('currentUserId');
    const userFullName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser');

    if (!currentUserId) {
        alert("Lỗi phiên đăng nhập. Vui lòng đăng nhập lại.");
        return;
    }

    // TIME VALIDATION — extract pure dateKey for Date parsing
    if (endTimeStr) {
        const pureDateKey = compositeKey.includes('__') ? compositeKey.split('__')[1] : compositeKey;
        const now = new Date();
        const classEnd = new Date(`${pureDateKey}T${endTimeStr}`);

        if (now > classEnd) {
            alert("Đã hết giờ học! Không thể nhận lớp sau khi ca dạy đã kết thúc.");
            return;
        }
    }

    const isConfirm = await UIService.confirm('Xác nhận thay đổi trạng thái đăng ký lớp này?');
    if (!isConfirm) return;

    try {
        await DBService.registerClass(compositeKey, caType, { index }, { id: currentUserId, name: userFullName });
        await renderTable();
        localStorage.setItem('schedule_registration_updated', Date.now().toString());
    } catch (e) {
        alert("Lỗi: " + e.message);
    }
};

// ================= GV DROPDOWN =================

async function loadSubjectListForSchedule() {
    try {
        const subjects = await DBService.getSubjects();
        window._subjectList = subjects || [];
        let dl = document.getElementById('subject-list');
        if (!dl) {
            dl = document.createElement('datalist');
            dl.id = 'subject-list';
            document.body.appendChild(dl);
        }
        dl.innerHTML = subjects.map(s => {
            const name = s.name.replace(/"/g, '&quot;');
            return `<option value="${name}" data-id="${s.id}">`;
        }).join('');
    } catch (e) {
        console.warn('Could not load subject list:', e);
    }
}

async function loadTeacherListForSchedule() {
    try {
        const users = await DBService.getUsers();
        window._teacherList = users || [];
        // Inject/update datalist in DOM
        let dl = document.getElementById('gv-teacher-list');
        if (!dl) {
            dl = document.createElement('datalist');
            dl.id = 'gv-teacher-list';
            document.body.appendChild(dl);
        }
        dl.innerHTML = users.map(u => {
            const name = (u.name || u.username || '').replace(/"/g, '&quot;');
            return `<option value="${name}" data-id="${u.id}">`;
        }).join('');
    } catch (e) {
        console.warn('Could not load teacher list:', e);
    }
}

window.updateSubjectRow = async function (compositeKey, caType, index, subjectName) {
    const subjects = window._subjectList || [];
    const match = subjects.find(s => s.name === subjectName);
    const lopId = match ? match.id : '';
    const dayData = await DBService.getSchedule(compositeKey);
    if (!dayData || !dayData[caType] || !dayData[caType][index]) return;
    dayData[caType][index].lop = subjectName;
    dayData[caType][index].lopId = lopId;
    await DBService.saveSchedule(compositeKey, dayData);
};

window.updateGVThayTheRow = async function (compositeKey, caType, index, gvName) {
    const teachers = window._teacherList || [];
    const match = teachers.find(t => (t.name || t.username || '') === gvName);
    const gvId = match ? match.id : '';
    const dayData = await DBService.getSchedule(compositeKey);
    if (!dayData || !dayData[caType] || !dayData[caType][index]) return;
    dayData[caType][index].gvThayThe = gvName;
    dayData[caType][index].gvThayTheId = gvId;
    await DBService.saveSchedule(compositeKey, dayData);
    renderTable(); // Refresh to update GV gốc highlight
};

window.clearGVThayThe = async function (compositeKey, caType, index) {
    const dayData = await DBService.getSchedule(compositeKey);
    if (!dayData || !dayData[caType] || !dayData[caType][index]) return;
    dayData[caType][index].gvThayThe = '';
    dayData[caType][index].gvThayTheId = '';
    await DBService.saveSchedule(compositeKey, dayData);
    renderTable();
};

window.updateGVRow = async function (compositeKey, caType, index, gvName) {
    const teachers = window._teacherList || [];
    const match = teachers.find(t => (t.name || t.username || '') === gvName);
    const gvId = match ? match.id : '';
    const dayData = await DBService.getSchedule(compositeKey);
    if (!dayData || !dayData[caType] || !dayData[caType][index]) return;
    dayData[caType][index].gv = gvName;
    dayData[caType][index].gvId = gvId;
    await DBService.saveSchedule(compositeKey, dayData);
};

// ================= COPY SCHEDULE =================

window.openCopyWeekModal = function () {
    const existing = document.getElementById('copy-week-modal');
    if (existing) existing.remove();

    // Calculate target week options (next 8 weeks)
    const options = [];
    for (let w = 1; w <= 8; w++) {
        const target = new Date(currentWeekStart);
        target.setDate(target.getDate() + w * 7);
        const end = new Date(target);
        end.setDate(end.getDate() + 6);
        const label = `${formatDateShort(target)} – ${formatDateShort(end)}`;
        const val = getLocalDateKey(target);
        options.push(`<option value="${val}">${label}</option>`);
    }

    const modal = document.createElement('div');
    modal.id = 'copy-week-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
        <div style="background:white;border-radius:16px;padding:2rem;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <h3 style="font-size:1.125rem;font-weight:700;margin-bottom:1.25rem;">Sao Chép Lịch Tuần Hiện Tại</h3>
            <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:1rem;">
                Chọn tuần đích để sao chép toàn bộ lịch cơ sở <strong>${currentBranch.toUpperCase()}</strong>
                của tuần đang xem sang.
            </p>
            <select id="copy-target-week" class="form-input" style="width:100%;margin-bottom:1.25rem;">
                ${options.join('')}
            </select>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
                <button class="btn btn-secondary" onclick="document.getElementById('copy-week-modal').remove()">Hủy</button>
                <button class="btn btn-primary" onclick="executeCopyWeek()">Sao Chép</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
};

window.executeCopyWeek = async function () {
    const targetMondayKey = document.getElementById('copy-target-week').value;
    if (!targetMondayKey) return;

    const btn = document.querySelector('#copy-week-modal .btn-primary');
    if (btn) { btn.disabled = true; btn.innerText = 'Đang sao chép...'; }

    try {
        let copied = 0;
        for (let i = 0; i < 7; i++) {
            // Source day
            const srcDate = new Date(currentWeekStart);
            srcDate.setDate(srcDate.getDate() + i);
            const srcKey = getLocalDateKey(srcDate);
            const srcComposite = `${currentBranch}__${srcKey}`;

            // Target day
            const [ty, tm, td] = targetMondayKey.split('-').map(Number);
            const tgtDate = new Date(ty, tm - 1, td + i);
            const tgtKey = getLocalDateKey(tgtDate);
            const tgtComposite = `${currentBranch}__${tgtKey}`;

            const srcData = await DBService.getSchedule(srcComposite);
            if (srcData && Object.keys(srcData).length > 0) {
                // Strip registeredTeachers to avoid copying old registrations
                const cleanData = {};
                const sections = ['morning1','morning2','afternoon1','afternoon2','evening1','evening2'];
                sections.forEach(sec => {
                    if (srcData[sec]) {
                        cleanData[sec] = srcData[sec].map(row => {
                            const { registeredTeachers, ...rest } = row;
                            return rest;
                        });
                    }
                });
                await DBService.saveSchedule(tgtComposite, cleanData);
                copied++;
            }
        }
        document.getElementById('copy-week-modal').remove();
        alert(`Đã sao chép lịch ${copied}/7 ngày sang tuần đã chọn!`);
    } catch (e) {
        alert('Lỗi sao chép: ' + e.message);
        const btn2 = document.querySelector('#copy-week-modal .btn-primary');
        if (btn2) { btn2.disabled = false; btn2.innerText = 'Sao Chép'; }
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
