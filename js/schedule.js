// Schedule Management Logic

document.addEventListener('DOMContentLoaded', async () => {
    if (window.waitAuth) {
        await window.waitAuth();
    }
    // Only initialize if we are on the page with schedule elements
    if (document.getElementById('schedule-table')) {
        try {
            const settings = await DBService.getSystemSettings();
            window.centerClosures = settings?.centerClosures || {};
        } catch (e) {
            console.warn("Error loading system settings:", e);
            window.centerClosures = {};
        }
        initSchedule();
    }
});

function isCenterClosed(dateStr, shiftKey, centerClosures) {
    if (!centerClosures || !centerClosures[dateStr]) return false;
    const closures = centerClosures[dateStr];
    return closures.includes('all') || closures.includes(shiftKey);
}

function isScheduleTimePast(compositeKey, startTimeStr) {
    if (!compositeKey || !startTimeStr || typeof startTimeStr !== 'string') return false;
    try {
        const parts = compositeKey.split('__');
        if (parts.length < 2) return false;
        const dateStr = parts[1]; // YYYY-MM-DD
        
        const [y, m, d] = dateStr.split('-').map(Number);
        const [hr, min] = startTimeStr.split(':').map(Number);
        
        if (isNaN(y) || isNaN(m) || isNaN(d) || isNaN(hr) || isNaN(min)) return false;
        
        const classStart = new Date(y, m - 1, d, hr, min, 0, 0);
        return new Date() > classStart;
    } catch (e) {
        console.error("Error checking isScheduleTimePast:", e);
        return false;
    }
}

function isPastShift(dateKey, section) {
    const realToday = getLocalDateKey(new Date());
    if (dateKey < realToday) return true;
    if (dateKey > realToday) return false;
    
    // If today: check if current time has passed the default start of the shift
    if (!section.defaultStart) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = section.defaultStart.split(':').map(Number);
    return currentMinutes >= (sh * 60 + sm);
}

window.toggleSectionClosure = async function (dateKey, shiftKey, isChecked) {
    try {
        const settings = await DBService.getSystemSettings();
        if (!settings.centerClosures) {
            settings.centerClosures = {};
        }
        if (!settings.centerClosures[dateKey]) {
            settings.centerClosures[dateKey] = [];
        }
        
        if (isChecked) {
            if (!settings.centerClosures[dateKey].includes(shiftKey)) {
                settings.centerClosures[dateKey].push(shiftKey);
            }
        } else {
            settings.centerClosures[dateKey] = settings.centerClosures[dateKey].filter(s => s !== shiftKey);
            if (settings.centerClosures[dateKey].length === 0) {
                delete settings.centerClosures[dateKey];
            }
        }
        
        await DBService.saveSystemSettings(settings);
        window.centerClosures = settings.centerClosures || {};
        
        await renderTable();
    } catch (e) {
        console.error("Error toggling section closure:", e);
        alert("Có lỗi xảy ra khi tắt/mở lớp!");
    }
};

window.toggleClassClosure = async function (compositeKey, caType, index, isChecked) {
    try {
        const dayData = await DBService.getSchedule(compositeKey);
        if (!dayData || !dayData[caType] || !dayData[caType][index]) return;
        
        // Update isClosed property
        dayData[caType][index].isClosed = isChecked;
        
        // Save to Firestore
        await DBService.saveSchedule(compositeKey, dayData);
        
        // Re-render table
        await renderTable();
    } catch (e) {
        console.error("Error toggling class closure:", e);
        alert("Có lỗi xảy ra khi tắt/mở lớp này!");
    }
};


let currentWeekStart = new Date(); // Start of the currently selected week (Monday)
let selectedDayIndex = 0; // 0 = Monday, 6 = Sunday
let currentBranch = 'cs1'; // Multi-branch support
let currentShiftFilter = 'all'; // Filter for shifts (all, morning, afternoon, evening)
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
        if (adminActions) adminActions.style.display = 'flex';
        // Load teacher list & subject list for dropdowns
        loadTeacherListForSchedule();
        loadSubjectListForSchedule();
    }

    // Nút "Vắng GV" — CHỈ dành cho chức vụ Trợ lý ('assistant'), theo yêu cầu:
    // trợ lý kiểm/chỉnh trạng thái Vắng phép / Vắng đột xuất cho giáo viên.
    // (Không mở cho role khác; admin đã có đường chỉnh qua Bảng Công.)
    if (roles.includes('assistant')) {
        const btnAbs = document.getElementById('btn-gv-absence');
        if (btnAbs) btnAbs.style.display = 'flex';
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

        const isClosedDay = isCenterClosed(dateKey, 'all', window.centerClosures);
        let closureHtml = '';
        if (isClosedDay) {
            closureHtml = `<div style="font-size: 0.65rem; color: #DC2626; font-weight: bold; margin-top: 2px;">[Nghỉ]</div>`;
            if (index !== selectedDayIndex) btn.style.backgroundColor = '#F3F4F6';
        }

        btn.innerHTML = `
            <div>${dayName}</div>
            <div style="font-size: 0.75rem; color: ${index === selectedDayIndex ? 'white' : 'var(--text-muted)'}">${formatDateDayOnly(tabDate)}</div>
            ${holidayHtml}
            ${closureHtml}
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

    // Giữ nguyên bảng cũ trong lúc tải (chỉ làm mờ) — nếu xoá bảng để hiện "Đang tải..."
    // thì trang co ngắn lại, trình duyệt tuột cuộn lên đầu, admin đang xếp lịch bị mất chỗ.
    const scrollYBefore = window.scrollY;
    if (tbody.dataset.rendered === '1') {
        tbody.style.opacity = '0.55';
    } else {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 2rem; color: var(--text-muted);">Đang tải dữ liệu...</td></tr>';
    }

    // Load Data from Cloud (branch-prefixed)
    const dayData = await DBService.getSchedule(compositeKey) || {};
    const timesheetData = JSON.parse(localStorage.getItem('timesheet_data')) || {};

    // Fetch attendance for GV absent highlight (past/today only)
    let presentUserIds = new Set();
    const todayRealKey = getLocalDateKey(new Date());
    if (dateKey <= todayRealKey) {
        try { presentUserIds = await DBService.getDayAttendance(dateKey); } catch(e) {}
    }

    // Fetch all cancelled shifts for the month
    let cancelledShiftsMap = {};
    try {
        const monthStr = dateKey.substring(0, 7);
        cancelledShiftsMap = await DBService.getAllCancelledShifts(monthStr);
    } catch (e) {
        console.error("Error loading cancelled shifts map:", e);
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
        // Bộ lọc: 'all' | buổi ('morning'/'afternoon'/'evening') | đúng 1 ca ('morning1', 'evening2'...)
        if (currentShiftFilter !== 'all' && section.key !== currentShiftFilter &&
            !(/^(morning|afternoon|evening)$/.test(currentShiftFilter) && section.key.startsWith(currentShiftFilter))) {
            return;
        }

        const isClosed = isCenterClosed(dateKey, section.key, window.centerClosures);

        // Section Header with Inline Toggle/Closure Feature
        let toggleHtml = '';
        if (isAdmin) {
            const isPast = isPastShift(dateKey, section);
            const disabledAttr = isPast ? 'disabled title="Không thể chỉnh sửa lịch đã qua"' : '';
            const checkedAttr = isClosed ? 'checked' : '';
            
            toggleHtml = `
                <div style="display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; font-weight: normal; vertical-align: middle;">
                    <label style="display: inline-flex; align-items: center; cursor: ${isPast ? 'not-allowed' : 'pointer'}; gap: 0.35rem; user-select: none;">
                        <input type="checkbox" ${checkedAttr} ${disabledAttr} 
                            onchange="toggleSectionClosure('${dateKey}', '${section.key}', this.checked)"
                            style="cursor: ${isPast ? 'not-allowed' : 'pointer'}; width: 15px; height: 15px;">
                        <span style="${isClosed ? 'color: #DC2626; font-weight: bold;' : 'color: #047857; font-weight: bold;'}">
                            ${isClosed ? '🔴 Đã tắt ca' : '🟢 Ca hoạt động'}
                        </span>
                    </label>
                </div>
            `;
        } else {
            if (isClosed) {
                toggleHtml = `
                    <span style="font-size: 0.8rem; font-weight: bold; color: #DC2626; vertical-align: middle;">
                        🔴 Đã tắt ca
                    </span>
                `;
            }
        }

        html += `<tr>
            <td colspan="${totalCols}" class="section-header" style="background: ${isClosed ? '#FEE2E2' : '#D1FAE5'} !important; color: ${isClosed ? '#991B1B' : 'var(--primary-color)'}; padding: 0.75rem !important;">
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 0 0.5rem;">
                    <span style="font-weight: 700;">${section.label}</span>
                    ${toggleHtml}
                </div>
            </td>
        </tr>`;

        if (isClosed) {
            html += `<tr><td colspan="${totalCols}" style="text-align:center; background-color:#F3F4F6; color: #9CA3AF; font-size: 0.875rem; padding: 1rem; font-weight: bold; font-style: italic;">[LỊCH NGHỈ TRUNG TÂM - ĐÃ TẮT LỚP]</td></tr>`;
            return;
        }

        const rows = dayData[section.key] || [];

        if (rows.length === 0 && !isAdmin) {
            html += `<tr><td colspan="${totalCols}" style="text-align:center; color: var(--text-muted); font-size: 0.875rem; padding: 0.5rem;">không có lớp</td></tr>`;
        }

        rows.forEach((row, idx) => {
            const rowId = `${dateKey}-${section.key}-${idx}`;
            html += renderRow(row, idx, section.key, isAdmin, compositeKey, rowId, isToday, timesheetData[rowId], isTeacherOrStaff, presentUserIds, dateKey, todayRealKey, cancelledShiftsMap);
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
    tbody.style.opacity = '';
    tbody.dataset.rendered = '1';
    window.scrollTo(0, scrollYBefore);
    syncDatePickerValue();
}

// Helper: get array of {id,name} from row data (backward compat)
function getGVList(row, fieldType) {
    const listField = fieldType + 'List';
    if (row[listField] && Array.isArray(row[listField]) && row[listField].length > 0) return row[listField];
    const name = fieldType === 'gv' ? (row.gv || '') : (row.gvThayThe || '');
    const id   = fieldType === 'gv' ? (row.gvId || '') : (row.gvThayTheId || '');
    return name ? [{ id, name }] : [];
}

// Render compact multi-teacher cell
function renderGVMultiCell(row, isAdmin, compositeKey, caType, index, fieldType, presentUserIds, isPastOrToday, dateKey, cancelledShiftsMap = {}) {
    const isGV = fieldType === 'gv';
    const gvList = getGVList(row, fieldType);

    let nameHtml = '';
    if (gvList.length === 0) {
        nameHtml = isAdmin
            ? `<span style="color:#9CA3AF;font-size:0.78rem;">+ Thêm GV</span>`
            : `<span style="color:#9CA3AF;">—</span>`;
    } else {
        let isShiftPastOrStarted = false;
        if (isPastOrToday && dateKey) {
            const todayRealKey = getLocalDateKey(new Date());
            if (dateKey < todayRealKey) {
                isShiftPastOrStarted = true;
            } else if (dateKey === todayRealKey) {
                const now = new Date();
                const currentMinutes = now.getHours() * 60 + now.getMinutes();
                if (row.start) {
                    const [sH, sM] = row.start.split(':').map(Number);
                    const shiftStartMinutes = sH * 60 + sM;
                    if (currentMinutes >= shiftStartMinutes) {
                        isShiftPastOrStarted = true;
                    }
                }
            }
        }

        const absent = isShiftPastOrStarted ? gvList.filter(g => {
            if (!g.id) return false;
            const userCancelledShifts = cancelledShiftsMap[g.id] || [];
            const isCancelled = userCancelledShifts.includes(`${compositeKey}_${caType}_${index}`);
            return !presentUserIds.has(g.id) && !isCancelled;
        }) : [];

        // Hiện ĐẦY ĐỦ tên từng GV (dạng thẻ, tự xuống dòng) thay vì "Tên +1" —
        // xếp lớp 2 GV thì phải nhìn thấy cả 2 người ngay trên bảng.
        const chips = gvList.map(g => {
            const userCancelledShifts = cancelledShiftsMap[g.id] || [];
            const isCancelled = userCancelledShifts.includes(`${compositeKey}_${caType}_${index}`);
            const isAbsent = !isCancelled && absent.some(a => a.id === g.id);

            let chipClass = 'gv-chip';
            if (isCancelled) chipClass += ' is-cancelled';
            else if (isAbsent) chipClass += ' is-absent';
            else if (!isGV) chipClass += ' is-substitute';

            const suffix = isCancelled ? ' (Admin Hủy)' : '';
            const fixedBadge = g.pendingFixed
                ? ` <span title="Chuẩn bị cố định từ tuần sau" style="color:#9A3412;font-weight:700;">⏳</span>`
                : '';
            const safeTitle = `${g.name || ''}${suffix}`.replace(/"/g, '&quot;');
            return `<span class="${chipClass}" title="${safeTitle}">${g.name || ''}${suffix}${fixedBadge}</span>`;
        }).join('');

        nameHtml = `<div class="gv-chip-list">${chips}</div>`;
        if (absent.length > 0) nameHtml += `<div style="font-size:0.65rem;color:#EF4444;margin-top:2px;">Vắng: ${absent.length}</div>`;
    }

    const safeList = encodeURIComponent(JSON.stringify(gvList));
    const clickFn = isAdmin
        ? `openGVPicker('${compositeKey}','${caType}',${index},'${fieldType}',this)`
        : `showGVPopup(this,'${safeList}')`;

    // fieldType của GV thay thế được viết là 'gvThayTe' (thiếu chữ h) nên nhãn trên bản mobile
    // trước đây hiện nhầm thành "GV chinh" — so theo isGV cho chắc.
    const label = isGV ? 'GV chinh' : 'GV thay the';
    return `<td data-label="${label}"><div class="gv-multi-btn" onclick="${clickFn}">
        <div class="gv-name-display">${nameHtml}</div>
        ${isAdmin ? '<span class="gv-edit-icon">✏</span>' : ''}
    </div></td>`;
}

// Ô giờ: chỉ người sửa được lịch mới cần ô nhập; người xem thấy chữ "07:30" gọn hơn nhiều.
// lang="vi" ép trình duyệt hiển thị 24h thay vì "07:30 AM" (rộng và khó đọc).
function renderTimeCell(label, value, canEdit, compositeKey, caType, index, field) {
    if (!canEdit) {
        return `<td data-label="${label}"><span class="time-text">${value || '—'}</span></td>`;
    }
    return `<td data-label="${label}"><input type="time" lang="vi" class="table-input time-input" value="${value || ''}"
        onchange="updateRow('${compositeKey}', '${caType}', ${index}, '${field}', this.value)"></td>`;
}

function renderRow(data, index, caType, isAdmin, compositeKey, rowId, isToday, sessionData, isTeacherOrStaff = false, presentUserIds = new Set(), dateKey = '', todayRealKey = '', cancelledShiftsMap = {}) {
    const isPastClass = isScheduleTimePast(compositeKey, data.start);
    const rowIsAdmin = isAdmin && !isPastClass;
    const inputClass = rowIsAdmin ? 'table-input' : 'table-input read-only-input';
    const readonlyAttr = rowIsAdmin ? '' : 'readonly';

    // === GV FIELD (multi-teacher) ===
    const isPastOrToday = dateKey && todayRealKey && dateKey <= todayRealKey;
    const gvCell = renderGVMultiCell(data, rowIsAdmin, compositeKey, caType, index, 'gv', presentUserIds, isPastOrToday, dateKey, cancelledShiftsMap);

    // === SỐ HS FIELD ===
    let soHSCell = '';
    if (rowIsAdmin) {
        soHSCell = `<td data-label="So HS"><input type="number" class="table-input" value="${data.soHS || ''}" placeholder="HS" min="0"
            style="width:60px;text-align:center;"
            onchange="updateRow('${compositeKey}', '${caType}', ${index}, 'soHS', parseInt(this.value)||0)"></td>`;
    } else {
        const hs = data.soHS || '';
        const hsStyle = hs > 10 ? 'color:var(--primary-color);font-weight:700;' : 'color:var(--text-muted);';
        soHSCell = `<td data-label="So HS" style="text-align:center;font-size:0.875rem;"><span style="${hsStyle}">${hs || '—'}</span></td>`;
    }

    // === ACTION CELL ===
    let actionCell = '';
    const isClassClosed = data.isClosed === true;
    if (rowIsAdmin) {
        const checkedAttr = isClassClosed ? 'checked' : '';
        actionCell = `
            <td data-label="Thao tác" style="text-align: center; white-space: nowrap;">
                <div style="display: inline-flex; align-items: center; gap: 0.4rem; justify-content: center;">
                    <label class="class-closure-toggle" style="display: inline-flex; align-items: center; cursor: pointer; font-size: 0.75rem; color: ${isClassClosed ? '#EF4444' : '#6B7280'}; font-weight: 600; user-select: none;" title="Tắt lớp này">
                        <input type="checkbox" ${checkedAttr} 
                            onchange="toggleClassClosure('${compositeKey}', '${caType}', ${index}, this.checked)"
                            style="cursor: pointer; width: 14px; height: 14px; margin: 0;">
                        <span>${isClassClosed ? 'Tắt' : 'Bật'}</span>
                    </label>
                    <button class="btn-icon" style="color: #EF4444; padding: 2px;" onclick="deleteRow('${compositeKey}', '${caType}', ${index})" title="Xóa lớp">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </td>`;
    } else {
        if (isClassClosed) {
            actionCell = `<td data-label="Thao tác" style="text-align: center;"><span style="color: #EF4444; font-size: 0.75rem; font-weight: bold; background: #FEE2E2; padding: 2px 6px; border-radius: 4px;">Đã tắt</span></td>`;
        } else {
            actionCell = `<td data-label="Thao tác"></td>`;
        }
    }

    // === CỘT LỚP (Môn học datalist) ===
    const lopVal = (data.lop || '').replace(/"/g, '&quot;');
    let lopCell = '';
    if (rowIsAdmin) {
        lopCell = `<td data-label="Mon / Lop"><input type="text" class="table-input" value="${lopVal}" placeholder="Môn học"
            list="subject-list"
            onchange="updateSubjectRow('${compositeKey}', '${caType}', ${index}, this.value)"></td>`;
    } else {
        const subjectColor = (window._subjectList || []).find(s => s.name === data.lop)?.color || '';
        const dotHtml = subjectColor ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${subjectColor};margin-right:4px;"></span>` : '';
        lopCell = `<td data-label="Mon / Lop" style="font-size:0.875rem;">${dotHtml}${data.lop || ''}</td>`;
    }

    // === CỘT GV THAY THẾ (multi-teacher) ===
    const gvTTCell = renderGVMultiCell(data, rowIsAdmin, compositeKey, caType, index, 'gvThayTe', presentUserIds, isPastOrToday, dateKey, cancelledShiftsMap);

    const rowBg = isClassClosed ? 'background: #F3F4F6; opacity: 0.75;' : '';

    return `
        <tr style="${rowBg}">
            <td data-label="SS" style="text-align: center;">${index + 1}</td>
            ${renderTimeCell('Bat dau', data.start, rowIsAdmin, compositeKey, caType, index, 'start')}
            ${renderTimeCell('Ket thuc', data.end, rowIsAdmin, compositeKey, caType, index, 'end')}
            ${lopCell}
            <td data-label="Phòng"><input type="text" class="${inputClass}" value="${data.phong || ''}" placeholder="Phòng" ${readonlyAttr} onchange="updateRow('${compositeKey}', '${caType}', ${index}, 'phong', this.value)"></td>
            ${gvCell}
            ${gvTTCell}
            ${soHSCell}
            <td data-label="Ghi chú"><input type="text" class="${inputClass}" value="${data.note || ''}" placeholder="Ghi chú" ${readonlyAttr} onchange="updateRow('${compositeKey}', '${caType}', ${index}, 'note', this.value)"></td>
            ${actionCell}
        </tr>
    `;
}

window.addNewRow = async function (compositeKey, caType, defaultStart, defaultEnd) {
    if (isScheduleTimePast(compositeKey, defaultStart)) {
        alert("Không thể thêm lớp học cho thời gian đã qua trong quá khứ!");
        return;
    }

    const dayData = await DBService.getSchedule(compositeKey) || {};
    if (!dayData[caType]) dayData[caType] = [];

    dayData[caType].push({
        start: defaultStart, end: defaultEnd,
        lop: '', lopId: '', phong: '',
        gv: '', gvId: '', gvList: [],
        gvThayThe: '', gvThayTheId: '', gvThayTheList: [],
        soHS: 0, note: ''
    });

    await DBService.saveSchedule(compositeKey, dayData);
    renderTable();
};

window.updateRow = async function (compositeKey, caType, index, field, value) {
    const dayData = await DBService.getSchedule(compositeKey);
    if (!dayData || !dayData[caType] || !dayData[caType][index]) return;

    const row = dayData[caType][index];
    if (isScheduleTimePast(compositeKey, row.start)) {
        alert("Không thể chỉnh sửa lớp học cho thời gian đã qua trong quá khứ!");
        renderTable();
        return;
    }

    dayData[caType][index][field] = value;
    await DBService.saveSchedule(compositeKey, dayData);
};

window.deleteRow = async function (compositeKey, caType, index) {
    const dayData = await DBService.getSchedule(compositeKey);
    if (!dayData || !dayData[caType] || !dayData[caType][index]) return;

    const row = dayData[caType][index];
    if (isScheduleTimePast(compositeKey, row.start)) {
        alert("Không thể xóa lớp học cho thời gian đã qua trong quá khứ!");
        return;
    }

    if (!await UIService.confirm('Bạn có chắc muốn xóa lớp học này?')) return;

    dayData[caType].splice(index, 1);

    await DBService.saveSchedule(compositeKey, dayData);
    renderTable();
};

window.saveScheduleManual = function () {
    const btn = document.querySelector('#admin-actions button');
    if (btn) {
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

    // Validation: Only allow teachers/TAs to register classes
    const currentRole = localStorage.getItem('currentRole');
    let currentRoles = [];
    try {
        const parsed = JSON.parse(currentRole);
        currentRoles = Array.isArray(parsed) ? parsed : [currentRole];
    } catch (e) {
        currentRoles = currentRole ? [currentRole] : [];
    }
    const isTeacherOrTA = currentRoles.some(r => ['giao-vien', 'teacher', 'teaching_assistant', 'senior_assistant', 'assistant'].includes(r));
    if (!isTeacherOrTA) {
        alert("Bạn không có chức danh Giáo viên hoặc Trợ giảng để nhận lớp này!");
        return;
    }

    const dayData = await DBService.getSchedule(compositeKey);
    if (!dayData || !dayData[caType] || !dayData[caType][index]) return;
    const row = dayData[caType][index];

    if (isScheduleTimePast(compositeKey, row.start)) {
        alert("Lớp học đã bắt đầu hoặc đã qua trong quá khứ! Không thể nhận lớp.");
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
    
    const row = dayData[caType][index];
    if (isScheduleTimePast(compositeKey, row.start)) {
        alert("Không thể chỉnh sửa môn học cho thời gian đã qua trong quá khứ!");
        renderTable();
        return;
    }

    dayData[caType][index].lop = subjectName;
    dayData[caType][index].lopId = lopId;
    await DBService.saveSchedule(compositeKey, dayData);
};

window.openGVPicker = function (compositeKey, caType, index, fieldType) {
    const existing = document.getElementById('gv-picker-overlay');
    if (existing) existing.remove();

    DBService.getSchedule(compositeKey).then(dayData => {
        if (!dayData || !dayData[caType] || !dayData[caType][index]) return;
        const row = dayData[caType][index];
        if (isScheduleTimePast(compositeKey, row.start)) {
            alert("Không thể chỉnh sửa nhân sự của lớp học đã qua trong quá khứ!");
            return;
        }
        const currentList = getGVList(row, fieldType);
        const currentIds = new Set(currentList.map(g => g.id || g.name));
        const teachers = window._teacherList || [];
        const isGVTT = fieldType === 'gvThayTe';
        const title = isGVTT ? 'GV Thay Thế' : 'GV Chính';
        const accent = isGVTT ? '#D97706' : '#059669';

        // Filter: only show users with teaching roles
        const filteredTeachers = teachers.filter(t => {
            const roles = Array.isArray(t.roles) ? t.roles : [t.role || ''];
            return roles.some(r => ['giao-vien', 'teacher', 'teaching_assistant', 'senior_assistant', 'assistant'].includes(r));
        });

        const rows = filteredTeachers.map(t => {
            const name = (t.name || t.username || '').replace(/"/g, '&quot;');
            const chk = currentIds.has(t.id) ? 'checked' : '';
            // "Chuẩn bị cố định tuần sau": ghi chú theo yêu cầu khách — GV tuần này chưa
            // cố định, tuần sau mới cố định. Chỉ là nhãn nhắc, không tự đổi lịch/lương.
            const curEntry = currentList.find(g => (g.id || g.name) === t.id);
            const cbcdOn = curEntry && curEntry.pendingFixed ? '1' : '0';
            return `<label class="gv-picker-item${chk ? ' selected' : ''}">
                <input type="checkbox" value="${t.id}" data-name="${name}" ${chk}
                    onchange="this.closest('label').classList.toggle('selected',this.checked)">
                <span style="flex:1;">${name}</span>
                <span class="cbcd-toggle" data-active="${cbcdOn}" title="Đánh dấu: GV này CHUẨN BỊ CỐ ĐỊNH từ tuần sau"
                    onclick="event.preventDefault();event.stopPropagation();toggleCBCDBadge(this)"
                    style="cursor:pointer;font-size:0.62rem;font-weight:700;padding:3px 8px;border-radius:99px;white-space:nowrap;flex-shrink:0;${cbcdOn === '1' ? 'background:#F97316;color:white;' : 'background:#F3F4F6;color:#9CA3AF;'}">⏳ CĐ tuần sau</span></label>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.id = 'gv-picker-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = `
<div style="background:white;border-radius:16px;max-width:400px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden;max-height:90vh;display:flex;flex-direction:column;">
  <div style="background:linear-gradient(135deg,${accent},#047857);padding:1.1rem 1.4rem;display:flex;justify-content:space-between;align-items:center;">
    <h3 style="color:white;margin:0;font-size:1rem;font-weight:700;">✏️ Chọn ${title}</h3>
    <button onclick="document.getElementById('gv-picker-overlay').remove()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:1.1rem;">✕</button>
  </div>
  <div style="padding:0.75rem;border-bottom:1px solid #E5E7EB;">
    <input type="text" placeholder="🔍 Tìm giáo viên..." oninput="filterGVPicker(this.value)"
      style="width:100%;box-sizing:border-box;padding:0.55rem 0.75rem;border:1.5px solid #E5E7EB;border-radius:8px;font-size:0.9rem;outline:none;">
  </div>
  <div id="gv-picker-list" style="padding:0.5rem 0.75rem;overflow-y:auto;flex:1;max-height:300px;display:flex;flex-direction:column;gap:2px;">${rows}</div>
  <div style="padding:0.9rem;border-top:1px solid #E5E7EB;display:flex;gap:0.6rem;">
    <button onclick="document.getElementById('gv-picker-overlay').remove()" style="flex:1;padding:0.6rem;background:#F3F4F6;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Hủy</button>
    <button onclick="saveGVPickerResult('${compositeKey}','${caType}',${index},'${fieldType}')" style="flex:2;padding:0.6rem;background:linear-gradient(135deg,${accent},#047857);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700;">✓ Lưu</button>
  </div>
</div>`;
        document.body.appendChild(overlay);
    });
};

window.toggleCBCDBadge = function (el) {
    const on = el.dataset.active === '1';
    el.dataset.active = on ? '0' : '1';
    el.style.background = on ? '#F3F4F6' : '#F97316';
    el.style.color = on ? '#9CA3AF' : 'white';
};

window.filterGVPicker = function (q) {
    document.querySelectorAll('#gv-picker-list .gv-picker-item').forEach(el => {
        el.style.display = el.querySelector('span').textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
    });
};

window.saveGVPickerResult = async function (compositeKey, caType, index, fieldType) {
    const checked = document.querySelectorAll('#gv-picker-list input[type=checkbox]:checked');
    const newList = Array.from(checked).map(cb => {
        const item = { id: cb.value, name: cb.dataset.name };
        // Nhãn "chuẩn bị cố định tuần sau" (chỉ lưu khi bật để Firestore không nhận undefined)
        const badge = cb.closest('label')?.querySelector('.cbcd-toggle');
        if (badge && badge.dataset.active === '1') item.pendingFixed = true;
        return item;
    });
    const dayData = await DBService.getSchedule(compositeKey);
    if (!dayData || !dayData[caType] || !dayData[caType][index]) return;

    const row = dayData[caType][index];
    if (isScheduleTimePast(compositeKey, row.start)) {
        alert("Không thể chỉnh sửa nhân sự của lớp học đã qua trong quá khứ!");
        const overlay = document.getElementById('gv-picker-overlay');
        if (overlay) overlay.remove();
        return;
    }

    // Validate selected users' roles
    const teachers = window._teacherList || [];
    for (const item of newList) {
        const u = teachers.find(t => t.id === item.id);
        if (u) {
            const roles = Array.isArray(u.roles) ? u.roles : [u.role || ''];
            const isTeacherOrTA = roles.some(r => ['giao-vien', 'teacher', 'teaching_assistant', 'senior_assistant', 'assistant'].includes(r));
            if (!isTeacherOrTA) {
                alert(`Không thể chọn nhân sự "${item.name}" vì không có chức danh Giáo viên hoặc Trợ giảng.`);
                return;
            }
        }
    }

    const listField = fieldType + 'List';

    // Thời điểm trợ lý xếp GV thay thế = thời điểm GV báo nghỉ. Lưu lại để hệ thống tự phân
    // loại Vắng phép (báo trước >= 24h) / Vắng đột xuất (báo trễ hơn) — xem autoMarkAbsence().
    let autoAbsenceInfo = null;
    if (fieldType !== 'gv') {
        const prevIds = new Set(getGVList(row, fieldType).map(g => g.id).filter(Boolean));
        const addedIds = newList.map(g => g.id).filter(id => id && !prevIds.has(id));
        if (addedIds.length > 0) {
            const markedAt = new Date().toISOString();
            dayData[caType][index].gvThayTheAt = markedAt;
            autoAbsenceInfo = { dateKey: compositeKey.split('__')[1] || '', start: row.start, markedAt };
        } else if (newList.length === 0) {
            dayData[caType][index].gvThayTheAt = '';
        }
    }

    dayData[caType][index][listField] = newList;
    // Backward compat: keep first as single field
    if (fieldType === 'gv') {
        dayData[caType][index].gv = newList[0]?.name || '';
        dayData[caType][index].gvId = newList[0]?.id || '';
    } else {
        dayData[caType][index].gvThayThe = newList[0]?.name || '';
        dayData[caType][index].gvThayTheId = newList[0]?.id || '';
    }
    await DBService.saveSchedule(compositeKey, dayData);

    if (autoAbsenceInfo) {
        const marked = await autoMarkAbsenceForMainTeachers(dayData[caType][index], autoAbsenceInfo);
        if (marked.length > 0) {
            const label = marked[0].type === 'VP' ? 'Vắng phép' : 'Vắng đột xuất';
            const msg = `Đã tự đánh dấu "${label}" cho ${marked.map(m => m.name).join(', ')}`;
            if (window.UIService && typeof UIService.toast === 'function') UIService.toast(msg, 'success');
            else console.log('[Vắng GV]', msg);
        }
    }

    document.getElementById('gv-picker-overlay').remove();
    renderTable();
};

window.showGVPopup = function (triggerEl, encodedList) {
    const existing = document.getElementById('gv-popup');
    if (existing) { existing.remove(); return; }
    let gvList;
    try { gvList = JSON.parse(decodeURIComponent(encodedList)); } catch { return; }
    if (!gvList || gvList.length === 0) return;
    const popup = document.createElement('div');
    popup.id = 'gv-popup';
    popup.style.cssText = 'position:fixed;background:white;border:1px solid #E5E7EB;border-radius:10px;padding:0.5rem 0.75rem;box-shadow:0 8px 24px rgba(0,0,0,0.15);z-index:9998;min-width:140px;';
    popup.innerHTML = gvList.map(g => {
        const cbcd = g.pendingFixed ? ` <span style="background:#FFEDD5;color:#9A3412;border-radius:99px;padding:1px 6px;font-size:0.62rem;font-weight:700;white-space:nowrap;">⏳ CĐ tuần sau</span>` : '';
        return `<div style="padding:0.3rem 0;font-size:0.85rem;border-bottom:1px solid #F3F4F6;">${g.name}${cbcd}</div>`;
    }).join('');
    const rect = triggerEl.getBoundingClientRect();
    const top = Math.min(rect.bottom + 4, window.innerHeight - 160);
    popup.style.top = top + 'px';
    popup.style.left = Math.max(4, rect.left - 30) + 'px';
    document.body.appendChild(popup);
    setTimeout(() => document.addEventListener('click', function h() { popup.remove(); document.removeEventListener('click', h); }, { once: true }), 50);
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
        let skippedPastDays = 0;
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

            // Set time to end of target day (23:59:59) so if today is the target day, we can still copy it
            const tgtDateEnd = new Date(ty, tm - 1, td + i, 23, 59, 59, 999);
            if (tgtDateEnd < new Date()) {
                skippedPastDays++;
                continue;
            }

            const srcData = await DBService.getSchedule(srcComposite);
            if (srcData && Object.keys(srcData).length > 0) {
                // Strip registeredTeachers and substitute teachers to avoid copying support/temp schedules
                const cleanData = {};
                const sections = ['morning1','morning2','afternoon1','afternoon2','evening1','evening2'];
                sections.forEach(sec => {
                    if (srcData[sec]) {
                        cleanData[sec] = srcData[sec].map(row => {
                            // Xoá GV thay thế theo CẢ 2 cách viết (The/Te) — trước đây chỉ xoá
                            // bản viết thiếu "h" nên gvThayThe/gvThayTheId (trường tính lương,
                            // đánh vắng) vẫn bị sao chép sang tuần sau.
                            const { registeredTeachers, isClosed,
                                gvThayThe, gvThayTheId, gvThayTheList,
                                gvThayTe, gvThayTeId, gvThayTeList, ...rest } = row;
                            return {
                                ...rest,
                                gvThayThe: '', gvThayTheId: '', gvThayTheList: [],
                                gvThayTe: '', gvThayTeId: '', gvThayTeList: []
                            };
                        });
                    }
                });
                await DBService.saveSchedule(tgtComposite, cleanData);
                copied++;
            }
        }
        document.getElementById('copy-week-modal').remove();
        if (skippedPastDays > 0) {
            alert(`Đã sao chép lịch ${copied} ngày sang tuần đã chọn (bỏ qua ${skippedPastDays} ngày trong quá khứ để bảo toàn dữ liệu)!`);
        } else {
            alert(`Đã sao chép lịch ${copied}/7 ngày sang tuần đã chọn!`);
        }
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

function syncDatePickerValue() {
    const dateInput = document.getElementById('schedule-date-picker');
    if (dateInput) {
        const currentDate = new Date(currentWeekStart);
        currentDate.setDate(currentDate.getDate() + selectedDayIndex);
        const y = currentDate.getFullYear();
        const m = String(currentDate.getMonth() + 1).padStart(2, '0');
        const d = String(currentDate.getDate()).padStart(2, '0');
        dateInput.value = `${y}-${m}-${d}`;
    }
}

window.goToDatePickerDate = function(dateVal) {
    if (!dateVal) return;
    const selectedDate = new Date(dateVal);
    if (isNaN(selectedDate.getTime())) return;
    
    // Find its Monday (start of the week)
    const day = selectedDate.getDay();
    const diff = selectedDate.getDate() - day + (day === 0 ? -6 : 1);
    
    currentWeekStart = new Date(selectedDate);
    currentWeekStart.setDate(diff);
    currentWeekStart.setHours(0, 0, 0, 0);
    
    // Find selectedDayIndex (0 = Mon, 6 = Sun)
    selectedDayIndex = day === 0 ? 6 : day - 1;
    
    // Sync the input value
    const dateInput = document.getElementById('schedule-date-picker');
    if (dateInput) dateInput.value = dateVal;
    
    renderWeekPicker();
    renderDayTabs();
    renderTable();
};

window.filterScheduleShifts = function(filterVal) {
    currentShiftFilter = filterVal;
    renderTable();
};

// ================= VẮNG GV (Trợ lý kiểm/chỉnh Vắng phép - Vắng đột xuất) =================
// Nguồn sự thật: daily_notes/{gvId}[dateKey]. classifyAbsentChip (report.js) đọc note này:
// chứa "đột xuất/vdx" → VĐX, chứa "phép/vp" → VP, không có → VKP. Ghi đúng chuẩn text ở đây
// thì Bảng Công / tiền phạt / PDF tự khớp — không đụng vào logic lương hay dữ liệu chấm công.
//
// TỰ ĐỘNG: khi trợ lý xếp GV thay thế cho một ca, hệ thống lưu mốc giờ thao tác
// (row.gvThayTheAt) rồi so với GIỜ BẮT ĐẦU của chính ca đó:
//   - báo trước >= 24h  → Vắng phép
//   - báo trước < 24h   → Vắng đột xuất
// Chỉ ghi khi ghi chú ngày còn TRỐNG, nên đánh dấu tay của trợ lý/admin luôn được giữ nguyên
// (trợ lý thao tác chậm làm sai trạng thái thì vẫn sửa lại bằng tay được).

const AUTO_ABSENCE_LEAD_MINUTES = 24 * 60; // báo trước đủ 24h mới tính là Vắng phép

function classifyAbsenceNote(noteText) {
    const t = (noteText || '').toLowerCase().trim();
    if (!t) return null;
    if (t.includes('đột xuất') || t.includes('vdx') || t.includes('đx')) return 'VDX';
    if (t.includes('phép') || t.includes('vp') || t.includes(' p ') || t.endsWith(' p') || t.startsWith('p ')) return 'VP';
    return null; // note tự do, không phải đánh dấu vắng
}

function getShiftStartDate(dateKey, startStr) {
    if (!dateKey || !startStr) return null;
    const [y, m, d] = String(dateKey).split('-').map(Number);
    const [hh, mm] = String(startStr).split(':').map(Number);
    if ([y, m, d, hh, mm].some(v => isNaN(v))) return null;
    return new Date(y, m - 1, d, hh, mm, 0, 0);
}

// Trả về { type: 'VP'|'VDX', leadMinutes } — leadMinutes là số phút báo trước giờ vào ca.
function classifyAbsenceByLeadTime(dateKey, startStr, markedAtISO) {
    const shiftStart = getShiftStartDate(dateKey, startStr);
    if (!shiftStart || !markedAtISO) return null;
    const markedAt = new Date(markedAtISO);
    if (isNaN(markedAt.getTime())) return null;
    const leadMinutes = Math.round((shiftStart.getTime() - markedAt.getTime()) / 60000);
    return { type: leadMinutes >= AUTO_ABSENCE_LEAD_MINUTES ? 'VP' : 'VDX', leadMinutes };
}

function formatLeadTime(leadMinutes) {
    if (leadMinutes === null || leadMinutes === undefined) return '';
    const abs = Math.abs(leadMinutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    const txt = h > 0 ? `${h}h${m > 0 ? ` ${m}p` : ''}` : `${m}p`;
    return leadMinutes >= 0 ? `báo trước ${txt}` : `báo trễ ${txt} sau giờ vào ca`;
}

// Ghi đánh dấu vắng cho GV chính của ca vừa được xếp GV thay thế.
// Chỉ ghi khi ghi chú ngày còn trống → không bao giờ đè lên đánh dấu/ghi chú đã có.
async function autoMarkAbsenceForMainTeachers(row, info) {
    const verdict = classifyAbsenceByLeadTime(info.dateKey, info.start, info.markedAt);
    if (!verdict) return [];
    const canonical = verdict.type === 'VP' ? 'Vắng phép' : 'Vắng đột xuất';
    const subIds = new Set(getGVList(row, 'gvThayTe').map(g => g.id).filter(Boolean));
    const marked = [];

    for (const g of getGVList(row, 'gv')) {
        if (!g.id) continue;
        if (subIds.has(g.id)) continue; // vừa là GV chính vừa là người dạy thay → không vắng
        try {
            const notes = { ...(await DBService.getDailyNotes(g.id) || {}) };
            if ((notes[info.dateKey] || '').trim()) continue; // đã có ghi chú → giữ nguyên
            notes[info.dateKey] = canonical;
            await DBService.saveDailyNotes(g.id, notes);
            marked.push({ id: g.id, name: g.name, type: verdict.type });
        } catch (e) {
            console.warn('Không tự đánh dấu vắng được cho', g.name, e);
        }
    }
    return marked;
}

function absenceStatusBadge(status, noteText) {
    if (status === 'VDX') return `<span style="background:#FFEDD5;color:#9A3412;border-radius:99px;padding:3px 10px;font-size:0.72rem;font-weight:700;">Vắng đột xuất</span>`;
    if (status === 'VP') return `<span style="background:#D1FAE5;color:#065F46;border-radius:99px;padding:3px 10px;font-size:0.72rem;font-weight:700;">Vắng phép</span>`;
    if (noteText) return `<span title="${noteText.replace(/"/g, '&quot;')}" style="background:#F3F4F6;color:#6B7280;border-radius:99px;padding:3px 10px;font-size:0.72rem;font-weight:600;">Có ghi chú khác</span>`;
    return `<span style="background:#F3F4F6;color:#9CA3AF;border-radius:99px;padding:3px 10px;font-size:0.72rem;font-weight:600;">Chưa đánh dấu</span>`;
}

window.openGVAbsenceModal = async function () {
    const existing = document.getElementById('gv-absence-overlay');
    if (existing) existing.remove();

    const dayDate = new Date(currentWeekStart);
    dayDate.setDate(dayDate.getDate() + selectedDayIndex);
    const dateKey = getLocalDateKey(dayDate);
    const compositeKey = getCompositeKey(dateKey);

    const overlay = document.createElement('div');
    overlay.id = 'gv-absence-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;box-sizing:border-box;';
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
<div style="background:white;border-radius:18px;max-width:760px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden;max-height:92vh;display:flex;flex-direction:column;">
  <div style="background:linear-gradient(135deg,#F97316,#EA580C);padding:1.1rem 1.4rem;display:flex;justify-content:space-between;align-items:center;gap:0.75rem;">
    <div style="min-width:0;">
      <h3 style="color:white;margin:0;font-size:1.15rem;font-weight:700;">Vắng GV — ${DAYS[selectedDayIndex]}, ${formatDateShort(dayDate)}</h3>
      <div style="color:rgba(255,255,255,0.9);font-size:0.75rem;margin-top:2px;">Tự phân loại theo giờ xếp GV thay thế · báo trước ≥ 24h = Vắng phép</div>
    </div>
    <button onclick="document.getElementById('gv-absence-overlay').remove()" style="background:rgba(255,255,255,0.22);border:none;color:white;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:1.2rem;flex-shrink:0;">✕</button>
  </div>
  <div id="gv-absence-list" style="padding:0.9rem 1.1rem;overflow-y:auto;flex:1;">
    <div style="text-align:center;color:#9CA3AF;padding:2rem;">Đang tải danh sách GV của ngày...</div>
  </div>
  <div style="padding:0.75rem 1.1rem;border-top:1px solid #E5E7EB;font-size:0.75rem;color:#6B7280;line-height:1.6;">
    Hệ thống tự đánh dấu khi trợ lý xếp <b>GV thay thế</b>; ghi chú ngày đã có sẵn thì giữ nguyên.
    Bấm nút để <b>sửa lại trạng thái</b> bất cứ lúc nào. Không đánh dấu = Vắng không phép (nếu GV vắng).
  </div>
</div>`;
    document.body.appendChild(overlay);

    // Gom GV được xếp trong ngày (GV chính + GV thay thế, mọi ca) — chỉ cơ sở đang xem
    const dayData = await DBService.getSchedule(compositeKey) || {};
    const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
    const seen = new Map(); // id -> { id, name, classes: [], absentShifts: [] }
    sections.forEach(sec => {
        (dayData[sec] || []).forEach(row => {
            const mains = getGVList(row, 'gv');
            const subs = getGVList(row, 'gvThayTe');
            const subIds = new Set(subs.map(g => g.id).filter(Boolean));

            [...mains, ...subs].forEach(g => {
                if (!g.id) return; // không có ID thì không ghi note được — bỏ qua
                if (!seen.has(g.id)) seen.set(g.id, { id: g.id, name: g.name, classes: [], absentShifts: [] });
                if (row.lop && !seen.get(g.id).classes.includes(row.lop)) seen.get(g.id).classes.push(row.lop);
            });

            // Ca có GV thay thế → GV chính của ca đó là người nghỉ
            if (subs.length === 0) return;
            mains.forEach(g => {
                if (!g.id || subIds.has(g.id)) return;
                seen.get(g.id).absentShifts.push({
                    start: row.start || '',
                    end: row.end || '',
                    lop: row.lop || '',
                    subNames: subs.map(s => s.name).filter(Boolean).join(', '),
                    verdict: classifyAbsenceByLeadTime(dateKey, row.start, row.gvThayTheAt)
                });
            });
        });
    });

    const listEl = document.getElementById('gv-absence-list');
    if (!listEl) return;
    if (seen.size === 0) {
        listEl.innerHTML = '<div style="text-align:center;color:#9CA3AF;padding:2rem;">Ngày này chưa xếp GV nào (cơ sở đang xem).</div>';
        return;
    }

    // Đọc note hiện tại của từng GV, và tự ghi đánh dấu cho GV có ca đã xếp người thay
    // nhưng ghi chú ngày còn trống (bù các lần thao tác trước khi có tính năng tự động).
    const teachers = Array.from(seen.values());
    const rows = await Promise.all(teachers.map(async t => {
        let noteText = '';
        try {
            const notes = await DBService.getDailyNotes(t.id);
            noteText = (notes && notes[dateKey]) || '';
        } catch (e) { console.warn('Không đọc được ghi chú của', t.name, e); }

        const suggestion = pickAbsenceSuggestion(t.absentShifts);
        if (!noteText.trim() && suggestion) {
            const canonical = suggestion.type === 'VP' ? 'Vắng phép' : 'Vắng đột xuất';
            try {
                const notes = { ...(await DBService.getDailyNotes(t.id) || {}) };
                notes[dateKey] = canonical;
                await DBService.saveDailyNotes(t.id, notes);
                noteText = canonical;
            } catch (e) { console.warn('Không tự đánh dấu vắng được cho', t.name, e); }
        }
        return { ...t, noteText, status: classifyAbsenceNote(noteText), suggestion };
    }));

    // Nhóm GV nghi vắng (có ca đã xếp người thay) lên đầu cho dễ thao tác
    const absentRows = rows.filter(r => r.absentShifts.length > 0);
    const otherRows = rows.filter(r => r.absentShifts.length === 0);

    const groupHeader = (text, color) =>
        `<div style="font-size:0.75rem;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.03em;margin:0.5rem 0 0.35rem;">${text}</div>`;

    listEl.innerHTML =
        (absentRows.length ? groupHeader(`Có xếp GV thay thế (${absentRows.length})`, '#9A3412') + absentRows.map(t => renderGVAbsenceRow(t, dateKey)).join('') : '') +
        (otherRows.length ? groupHeader(`GV còn lại trong ngày (${otherRows.length})`, '#6B7280') + otherRows.map(t => renderGVAbsenceRow(t, dateKey)).join('') : '');
};

// Trong 1 ngày GV có thể nghỉ nhiều ca; ghi chú ngày chỉ có 1 dòng nên lấy trường hợp
// NGHIÊM HƠN (Vắng đột xuất thắng Vắng phép) để không bỏ sót vi phạm báo trễ.
function pickAbsenceSuggestion(absentShifts) {
    const verdicts = (absentShifts || []).map(s => s.verdict).filter(Boolean);
    if (verdicts.length === 0) return null;
    return verdicts.find(v => v.type === 'VDX') || verdicts[0];
}

function renderGVAbsenceRow(t, dateKey) {
    const safeName = (t.name || '').replace(/"/g, '&quot;');
    const cls = t.classes.length ? `<div style="font-size:0.72rem;color:#9CA3AF;margin-top:2px;">${t.classes.join(', ')}</div>` : '';

    let shiftsHtml = '';
    if (t.absentShifts && t.absentShifts.length > 0) {
        shiftsHtml = '<div style="margin-top:5px;display:flex;flex-direction:column;gap:3px;">' + t.absentShifts.map(s => {
            const when = s.verdict
                ? `${formatLeadTime(s.verdict.leadMinutes)} → <b style="color:${s.verdict.type === 'VP' ? '#065F46' : '#9A3412'};">${s.verdict.type === 'VP' ? 'Vắng phép' : 'Vắng ĐX'}</b>`
                : '<span style="color:#9CA3AF;">chưa có mốc giờ xếp thay (lịch cũ)</span>';
            const label = [s.lop, s.start && s.end ? `${s.start}–${s.end}` : ''].filter(Boolean).join(' ');
            return `<div style="font-size:0.72rem;color:#6B7280;">↳ ${label || 'Ca'} · thay: ${s.subNames || '?'} · ${when}</div>`;
        }).join('') + '</div>';
    }

    const btn = (label, type, active, bg, fg) =>
        `<button onclick="setGVAbsence('${t.id}','${safeName}','${dateKey}','${type}')"
            style="padding:7px 13px;border-radius:9px;border:1.5px solid ${active ? fg : '#E5E7EB'};cursor:pointer;font-size:0.78rem;font-weight:700;background:${active ? bg : 'white'};color:${active ? fg : '#6B7280'};white-space:nowrap;">${label}</button>`;

    const shiftsData = encodeURIComponent(JSON.stringify(t.absentShifts || []));

    return `<div id="gv-abs-row-${t.id}" data-note="${(t.noteText || '').replace(/"/g, '&quot;')}" data-classes="${t.classes.join(', ').replace(/"/g, '&quot;')}" data-shifts="${shiftsData}"
        style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.7rem 0.4rem;border-bottom:1px solid #F3F4F6;flex-wrap:wrap;">
        <div style="flex:1;min-width:180px;">
            <div style="font-size:0.92rem;font-weight:600;display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">${t.name} ${absenceStatusBadge(t.status, t.noteText)}</div>
            ${cls}
            ${shiftsHtml}
        </div>
        <div style="display:flex;gap:0.4rem;flex-shrink:0;">
            ${btn('Vắng phép', 'VP', t.status === 'VP', '#D1FAE5', '#065F46')}
            ${btn('Vắng ĐX', 'VDX', t.status === 'VDX', '#FFEDD5', '#9A3412')}
            ${btn('Xoá', 'CLEAR', false, '', '')}
        </div>
    </div>`;
}

window.setGVAbsence = async function (teacherId, teacherName, dateKey, type) {
    const rowEl = document.getElementById(`gv-abs-row-${teacherId}`);
    const currentNote = rowEl ? (rowEl.dataset.note || '') : '';
    const canonical = type === 'VP' ? 'Vắng phép' : (type === 'VDX' ? 'Vắng đột xuất' : '');

    // An toàn dữ liệu: note ngày có thể do admin/GV ghi nội dung khác — hỏi trước khi ghi đè/xoá.
    const isPlainMark = !currentNote || classifyAbsenceNote(currentNote) !== null;
    if (type === 'CLEAR') {
        if (!currentNote) return; // không có gì để xoá
        if (!await UIService.confirm(`Xoá ghi chú ngày ${dateKey} của ${teacherName}?\n(Hiện tại: "${currentNote}")`)) return;
    } else if (!isPlainMark) {
        if (!await UIService.confirm(`${teacherName} đã có ghi chú khác ngày ${dateKey}:\n"${currentNote}"\n\nThay bằng "${canonical}"?`)) return;
    }

    try {
        // Clone để không sửa trực tiếp object trong cache; chỉ đụng đúng 1 ngày.
        const notes = { ...(await DBService.getDailyNotes(teacherId) || {}) };
        if (type === 'CLEAR') delete notes[dateKey];
        else notes[dateKey] = canonical;
        await DBService.saveDailyNotes(teacherId, notes);

        // Cập nhật lại đúng dòng trong modal (giữ nguyên phần mô tả ca đã xếp người thay)
        if (rowEl) {
            const noteText = type === 'CLEAR' ? '' : canonical;
            let absentShifts = [];
            try { absentShifts = JSON.parse(decodeURIComponent(rowEl.dataset.shifts || '%5B%5D')); } catch (e) { absentShifts = []; }
            const t = {
                id: teacherId, name: teacherName,
                classes: (rowEl.dataset.classes || '').split(', ').filter(Boolean),
                absentShifts,
                noteText, status: classifyAbsenceNote(noteText)
            };
            rowEl.outerHTML = renderGVAbsenceRow(t, dateKey);
        }
    } catch (e) {
        console.error('Lỗi lưu đánh dấu vắng:', e);
        alert('Có lỗi khi lưu đánh dấu vắng: ' + (e.message || e));
    }
};
