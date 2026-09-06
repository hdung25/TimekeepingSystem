// Schedule Management Logic

function hasTeachingEmploymentRole(value) {
    if (window.RolePolicy) return window.RolePolicy.hasTeachingEmploymentRole(value);
    const roles = Array.isArray(value)
        ? value
        : (Array.isArray(value?.roles) && value.roles.length ? value.roles : [value?.role || '']);
    return roles.some(r => ['giao-vien', 'teacher', 'teaching_assistant', 'assistant', 'staff'].includes(r));
}

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
    if (closures.includes('all') || closures.includes(shiftKey)) return true;
    const parentPeriod = /^(morning|afternoon|evening)[12]$/.exec(String(shiftKey || '').trim())?.[1] || '';
    return !!parentPeriod && closures.includes(parentPeriod);
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
        const row = dayData[caType][index];
        await DBService.updateScheduleRowAtomic(
            compositeKey,
            caType,
            scheduleRowLocator(row, index),
            latestRow => ({ ...latestRow, isClosed: isChecked === true }),
            dayData
        );
        
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
let scheduleRenderGeneration = 0;
let scheduleAttendanceEvidenceWarningKey = '';
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

    // Danh sách điều phối nhanh theo ngày dành cho mọi vai trò được phép xếp lịch.
    // Quyền thật vẫn được kiểm soát ở Firestore Rules, không dựa vào việc ẩn nút.
    if (isEditor) {
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

        // Dùng class thay cho font-size inline: bản mobile cần thu nhỏ để đủ 7 ngày trên
        // một màn hình, mà style inline thì CSS không đè được.
        btn.innerHTML = `
            <div class="day-tab-name">${dayName}</div>
            <div class="day-tab-date" style="color: ${index === selectedDayIndex ? 'white' : 'var(--text-muted)'}">${formatDateDayOnly(tabDate)}</div>
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
    const renderGeneration = ++scheduleRenderGeneration;
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
    if (!isScheduleRenderCurrent(renderGeneration, compositeKey)) return;
    const timesheetData = JSON.parse(localStorage.getItem('timesheet_data')) || {};

    // Fetch attendance for GV absent highlight (past/today only)
    let attendanceEvidence = new Map();
    const todayRealKey = getLocalDateKey(new Date());
    if (dateKey <= todayRealKey) {
        try {
            attendanceEvidence = await DBService.getDayAttendance(dateKey);
            if (!(attendanceEvidence instanceof Map)) {
                throw new Error('Nguồn trạng thái công trả về dữ liệu không hợp lệ.');
            }
            if (scheduleAttendanceEvidenceWarningKey === dateKey) scheduleAttendanceEvidenceWarningKey = '';
        } catch (error) {
            attendanceEvidence = null;
            console.error('Không tải được trạng thái công cho lịch:', error);
            if (scheduleAttendanceEvidenceWarningKey !== dateKey) {
                scheduleAttendanceEvidenceWarningKey = dateKey;
                window.UIService?.toast?.('Chưa tải được trạng thái công. Lịch vẫn hiển thị nhưng không kết luận ai chưa chấm công.', 'warning');
            }
        }
        if (!isScheduleRenderCurrent(renderGeneration, compositeKey)) return;
    }

    // Fetch all cancelled shifts for the month
    let cancelledShiftsMap = {};
    try {
        const monthStr = dateKey.substring(0, 7);
        cancelledShiftsMap = await DBService.getAllCancelledShifts(monthStr);
    } catch (e) {
        console.error("Error loading cancelled shifts map:", e);
    }
    if (!isScheduleRenderCurrent(renderGeneration, compositeKey)) return;

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
                            <span class="shift-state-dot">${isClosed ? '🔴' : '🟢'}</span> ${isClosed ? 'Đã tắt ca' : 'Ca hoạt động'}
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
            html += renderRow(row, idx, section.key, isAdmin, compositeKey, rowId, isToday, timesheetData[rowId], isTeacherOrStaff, attendanceEvidence, dateKey, todayRealKey, cancelledShiftsMap);
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

    if (!isScheduleRenderCurrent(renderGeneration, compositeKey)) return;
    tbody.innerHTML = html;
    tbody.style.opacity = '';
    tbody.dataset.rendered = '1';
    window.scrollTo(0, scrollYBefore);
    syncDatePickerValue();
}

// Helper: get array of {id,name} from row data (backward compat)
function getGVList(row, fieldType) {
    if (window.TeacherShiftState) {
        return fieldType === 'gv'
            ? TeacherShiftState.getMainTeachers(row)
            : TeacherShiftState.getSubstituteTeachers(row);
    }
    const isMain = fieldType === 'gv';
    const listFields = isMain ? ['gvList'] : ['gvThayTeList', 'gvThayTheList'];
    const values = listFields.flatMap(field => Array.isArray(row?.[field]) ? row[field] : []);
    if (values.length) return values;
    const name = isMain ? (row?.gv || '') : (row?.gvThayTe || row?.gvThayThe || '');
    const id = isMain ? (row?.gvId || '') : (row?.gvThayTeId || row?.gvThayTheId || '');
    return name ? [{ id, name }] : [];
}

function isScheduleRenderCurrent(renderGeneration, compositeKey) {
    if (renderGeneration !== scheduleRenderGeneration) return false;
    const activeDate = new Date(currentWeekStart);
    activeDate.setDate(activeDate.getDate() + selectedDayIndex);
    return getCompositeKey(getLocalDateKey(activeDate)) === compositeKey;
}

function scheduleShiftDateTime(dateKey, timeValue) {
    const match = String(timeValue || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    const dateMatch = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match || !dateMatch) return null;
    const result = new Date(
        Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
        Number(match[1]), Number(match[2]), 0, 0
    );
    return Number.isNaN(result.getTime()) ? null : result;
}

function resolveAttendanceEvidenceForShift(
    evidenceByUser,
    userId,
    dateKey,
    startValue,
    endValue,
    shiftId = '',
    compositeKey = '',
    section = ''
) {
    if (!(evidenceByUser instanceof Map)) {
        return { status: 'unavailable', session: null, candidates: [], error: 'Không tải được trạng thái công.' };
    }
    const sessions = evidenceByUser.get(String(userId)) || evidenceByUser.get(userId) || [];
    const usableSessions = Array.isArray(sessions) ? sessions.filter(session => session && !session.isAbsent) : [];
    if (!usableSessions.length) return { status: 'none', session: null, candidates: [] };
    if (!window.ScheduleAttendanceAdmin?.buildShiftWindow || !window.ScheduleAttendanceAdmin?.resolveSessionForShift) {
        return { status: 'unavailable', session: null, candidates: [], error: 'Mô-đun đối chiếu công chưa sẵn sàng.' };
    }
    try {
        const shiftWindow = ScheduleAttendanceAdmin.buildShiftWindow(dateKey, startValue, endValue);
        return ScheduleAttendanceAdmin.resolveSessionForShift(usableSessions, {
            dateKey,
            start: startValue,
            end: endValue,
            shiftId: String(shiftId || ''),
            compositeKey: String(compositeKey || ''),
            section: String(section || '')
        }, shiftWindow);
    } catch (error) {
        console.warn('Không thể đối chiếu phiên công với ca lịch:', error);
        return { status: 'unavailable', session: null, candidates: [], error: error?.message || 'Khung giờ ca không hợp lệ.' };
    }
}

function findAttendanceEvidenceForShift(
    evidenceByUser,
    userId,
    dateKey,
    startValue,
    endValue,
    _now = new Date(),
    shiftId = '',
    compositeKey = '',
    section = ''
) {
    const resolution = resolveAttendanceEvidenceForShift(
        evidenceByUser, userId, dateKey, startValue, endValue, shiftId, compositeKey, section
    );
    return resolution.status === 'matched' ? resolution.session : null;
}

function hasAttendanceEvidenceForShift(
    evidenceByUser,
    userId,
    dateKey,
    startValue,
    endValue,
    now = new Date(),
    shiftId = '',
    compositeKey = '',
    section = ''
) {
    return !!findAttendanceEvidenceForShift(
        evidenceByUser, userId, dateKey, startValue, endValue, now, shiftId, compositeKey, section
    );
}

function scheduleEscapeHTML(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function scheduleEscapeAttr(value) {
    return scheduleEscapeHTML(value).replace(/`/g, '&#096;');
}

function getMappedReplacementIds(row, teacherId) {
    if (window.TeacherShiftState) {
        return TeacherShiftState.getReplacementIdsForTeacher(row, teacherId);
    }
    const record = getRowTeacherAbsence(row, teacherId);
    return Array.isArray(record?.replacementIds) ? record.replacementIds : [];
}

function getRowTeacherAbsence(row, teacherId) {
    if (typeof getTeacherAbsenceRecord === 'function') {
        return getTeacherAbsenceRecord(row, teacherId);
    }
    return (Array.isArray(row?.teacherAbsences) ? row.teacherAbsences : []).find(item =>
        item && String(item.teacherId || item.id || '') === String(teacherId)
    ) || null;
}

function isRowMainTeacherAbsent(row, teacherId) {
    if (typeof isMainTeacherAbsentFromClass === 'function') {
        return isMainTeacherAbsentFromClass(row, teacherId);
    }
    if (!getGVList(row, 'gv').some(g => String(g.id) === String(teacherId))) return false;
    return Array.isArray(row?.teacherAbsences)
        ? !!getRowTeacherAbsence(row, teacherId)
        : getGVList(row, 'gvThayTe').length > 0;
}

// Render compact multi-teacher cell
function renderGVMultiCell(row, isAdmin, compositeKey, caType, index, fieldType, attendanceEvidence, isPastOrToday, dateKey, cancelledShiftsMap = {}) {
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

        const attendanceResolutionByTeacher = new Map();
        if (isShiftPastOrStarted) {
            gvList.forEach(g => {
                if (!g.id) return;
                attendanceResolutionByTeacher.set(String(g.id), resolveAttendanceEvidenceForShift(
                    attendanceEvidence,
                    g.id,
                    dateKey,
                    row.start,
                    row.end,
                    stableScheduleShiftLocatorId(compositeKey, caType, row, index),
                    compositeKey,
                    caType
                ));
            });
        }
        const unverified = isShiftPastOrStarted ? gvList.filter(g => {
            if (!g.id) return false;
            const userCancelledShifts = cancelledShiftsMap[g.id] || [];
            const isCancelled = userCancelledShifts.includes(`${compositeKey}_${caType}_${index}`);
            const isDeclaredAbsent = isGV && isRowMainTeacherAbsent(row, g.id);
            const resolution = attendanceResolutionByTeacher.get(String(g.id));
            return !isCancelled && !isDeclaredAbsent && resolution?.status === 'none';
        }) : [];

        // Hiện ĐẦY ĐỦ tên từng GV (dạng thẻ, tự xuống dòng) thay vì "Tên +1" —
        // xếp lớp 2 GV thì phải nhìn thấy cả 2 người ngay trên bảng.
        const chips = gvList.map(g => {
            const userCancelledShifts = cancelledShiftsMap[g.id] || [];
            const isCancelled = userCancelledShifts.includes(`${compositeKey}_${caType}_${index}`);
            const isUnverified = !isCancelled && unverified.some(a => a.id === g.id);
            const attendanceResolution = isShiftPastOrStarted && !isCancelled
                ? attendanceResolutionByTeacher.get(String(g.id))
                : null;
            const attendanceSession = attendanceResolution?.status === 'matched'
                ? attendanceResolution.session
                : null;
            const attendanceAmbiguous = attendanceResolution?.status === 'ambiguous';
            const attendanceUnavailable = attendanceResolution?.status === 'unavailable';
            const declaredAbsence = isGV ? getRowTeacherAbsence(row, g.id) : null;
            const isDeclaredAbsent = !isCancelled && isGV && isRowMainTeacherAbsent(row, g.id);
            const hasAttendanceAbsenceConflict = isDeclaredAbsent && !!attendanceSession;

            const absenceType = String(declaredAbsence?.type || '').toUpperCase();
            const mappedReplacementIds = isGV ? getMappedReplacementIds(row, g.id) : [];
            let chipClass = 'gv-chip';
            if (isCancelled) chipClass += ' is-cancelled';
            else if (hasAttendanceAbsenceConflict) chipClass += ' is-attendance-conflict';
            else if (attendanceAmbiguous) chipClass += ' is-attendance-ambiguous';
            else if (isDeclaredAbsent) chipClass += absenceType === 'VP' ? ' is-absence-vp' : ' is-absence-vdx';
            else if (attendanceUnavailable) chipClass += ' is-attendance-unavailable';
            else if (isUnverified) chipClass += ' is-unverified';
            else if (attendanceSession?.checkOut) chipClass += ' is-attendance-closed';
            else if (attendanceSession) chipClass += ' is-attendance-open';
            else if (!isGV) chipClass += ' is-substitute';

            const attendanceSuffix = attendanceSession
                ? ` · ${attendanceSession.checkOut ? 'Đủ vào/ra' : 'Đã vào ca'}` +
                    (attendanceSession.bonus10 ? ' · +10p' : '') +
                    (Number.isInteger(Number(attendanceSession.studentCount)) && attendanceSession.studentCountStatus === 'approved'
                        ? ` · ${Number(attendanceSession.studentCount)} HS`
                        : '')
                : '';
            let suffix = attendanceSuffix;
            if (isCancelled) {
                suffix = ' (Admin Hủy)';
            } else if (hasAttendanceAbsenceConflict) {
                suffix = ` · Xung đột: lịch ${absenceType === 'VP' ? 'VP' : 'VĐX'} nhưng đang có công`;
            } else if (attendanceAmbiguous) {
                suffix = ' · Cần đối chiếu nhiều phiên công';
            } else if (isDeclaredAbsent) {
                suffix = ` · ${absenceType === 'VP' ? 'VP' : 'VĐX'} · ${mappedReplacementIds.length ? 'Đã có GV thay' : 'Chờ GV thay'}`;
            } else if (attendanceUnavailable) {
                suffix = ' · Chưa tải được trạng thái công';
            } else if (isUnverified) {
                suffix = ' · Chưa xác minh chấm công';
            }
            const fixedBadge = g.pendingFixed
                ? ` <span title="Chuẩn bị cố định từ tuần sau" style="color:#9A3412;font-weight:700;">⏳</span>`
                : '';
            const safeName = scheduleEscapeHTML(g.name || '');
            const safeTitle = scheduleEscapeAttr(`${g.name || ''}${suffix}${declaredAbsence?.reason ? ` · ${declaredAbsence.reason}` : ''}`);
            return `<span class="${chipClass}" title="${safeTitle}">${safeName}${scheduleEscapeHTML(suffix)}${fixedBadge}</span>`;
        }).join('');

        nameHtml = `<div class="gv-chip-list">${chips}</div>`;
        if (unverified.length > 0) nameHtml += `<div style="font-size:0.65rem;color:#B45309;margin-top:2px;">Chưa xác minh chấm công: ${unverified.length}</div>`;
    }

    const safeList = encodeURIComponent(JSON.stringify(gvList));
    const clickFn = isAdmin
        ? `openGVPicker('${compositeKey}','${caType}',${index},'${fieldType}',this)`
        : `showGVPopup(this,'${safeList}')`;

    // fieldType của GV thay thế được viết là 'gvThayTe' (thiếu chữ h) nên nhãn trên bản mobile
    // trước đây hiện nhầm thành "GV chinh" — so theo isGV cho chắc.
    const label = isGV ? 'GV chính' : 'GV thay thế';
    return `<td data-field="${isGV ? 'gv' : 'gvtt'}" data-label="${label}"><div class="gv-multi-btn" onclick="${clickFn}">
        <div class="gv-name-display">${nameHtml}</div>
        ${isAdmin ? '<span class="gv-edit-icon">✏</span>' : ''}
    </div></td>`;
}

// Ô giờ: chỉ người sửa được lịch mới cần ô nhập; người xem thấy chữ "07:30" gọn hơn nhiều.
// lang="vi" ép trình duyệt hiển thị 24h thay vì "07:30 AM" (rộng và khó đọc).
function renderTimeCell(label, value, canEdit, compositeKey, caType, index, field) {
    // data-field: khoá ASCII cố định để CSS (bản mobile) bắt đúng ô — không phụ thuộc dấu
    // tiếng Việt trong data-label, tránh lỗi selector khi file bị lệch bảng mã.
    const fieldKey = field === 'start' ? 'start' : 'end';
    const safeValue = scheduleEscapeAttr(value || '');
    if (!canEdit) {
        return `<td data-field="${fieldKey}" data-label="${label}"><span class="time-text">${scheduleEscapeHTML(value || '—')}</span></td>`;
    }
    return `<td data-field="${fieldKey}" data-label="${label}"><input type="time" lang="vi" class="table-input time-input" value="${safeValue}"
        onchange="updateRow('${compositeKey}', '${caType}', ${index}, '${field}', this.value)"></td>`;
}

function renderRow(data, index, caType, isAdmin, compositeKey, rowId, isToday, sessionData, isTeacherOrStaff = false, attendanceEvidence = new Map(), dateKey = '', todayRealKey = '', cancelledShiftsMap = {}) {
    const isPastClass = isScheduleTimePast(compositeKey, data.start);
    const rowIsAdmin = isAdmin && !isPastClass;
    const inputClass = rowIsAdmin ? 'table-input' : 'table-input read-only-input';
    const readonlyAttr = rowIsAdmin ? '' : 'readonly';

    // === GV FIELD (multi-teacher) ===
    const isPastOrToday = dateKey && todayRealKey && dateKey <= todayRealKey;
    // Personnel status remains editable for schedule managers after a shift starts so
    // an actual last-minute absence can be recorded. Subject/time/room stay locked.
    const gvCell = renderGVMultiCell(data, isAdmin, compositeKey, caType, index, 'gv', attendanceEvidence, isPastOrToday, dateKey, cancelledShiftsMap);

    // === SỐ HS FIELD ===
    let soHSCell = '';
    if (rowIsAdmin) {
        soHSCell = `<td data-field="hs" data-label="Số HS"><input type="number" class="table-input" value="${scheduleEscapeAttr(data.soHS || '')}" placeholder="HS" min="0"
            style="width:60px;text-align:center;"
            onchange="updateRow('${compositeKey}', '${caType}', ${index}, 'soHS', parseInt(this.value)||0)"></td>`;
    } else {
        const hs = data.soHS || '';
        const hsStyle = hs > 10 ? 'color:var(--primary-color);font-weight:700;' : 'color:var(--text-muted);';
        soHSCell = `<td data-field="hs" data-label="Số HS" style="text-align:center;font-size:0.875rem;"><span style="${hsStyle}">${scheduleEscapeHTML(hs || '—')}</span></td>`;
    }

    // === ACTION CELL ===
    let actionCell = '';
    const isClassClosed = data.isClosed === true;
    if (rowIsAdmin) {
        const checkedAttr = isClassClosed ? 'checked' : '';
        actionCell = `
            <td data-field="action" data-label="Thao tác" style="text-align: center; white-space: nowrap;">
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
            actionCell = `<td data-field="action" data-label="Thao tác" style="text-align: center;"><span style="color: #EF4444; font-size: 0.75rem; font-weight: bold; background: #FEE2E2; padding: 2px 6px; border-radius: 4px;">Đã tắt</span></td>`;
        } else {
            actionCell = `<td data-field="action" data-label="Thao tác"></td>`;
        }
    }

    // === CỘT LỚP (Môn học datalist) ===
    const lopVal = scheduleEscapeAttr(data.lop || '');
    // Ca đã có GV nhưng CHƯA có Môn/Lớp → Bảng Công không áp được đơn giá, chip hiện
    // "(CHƯA CHỌN LỚP)". Đánh dấu đỏ ngay trên lịch để người xếp lịch bổ sung.
    const _hasAnyTeacher = !!(data.gvId || data.gvThayTeId || data.gvThayTheId ||
        (data.gvList || []).length > 0 || (data.gvThayTeList || []).length > 0 || (data.gvThayTheList || []).length > 0 ||
        (data.registeredTeachers || []).length > 0);
    const _missingSubject = !String(data.lop || '').trim() && _hasAnyTeacher;
    const _missingBadge = _missingSubject
        ? `<div style="margin-top:3px;font-size:0.68rem;font-weight:700;color:#B91C1C;background:#FEE2E2;border-radius:4px;padding:1px 5px;display:inline-block;">⚠ Thiếu Môn/Lớp — không tính lương được</div>`
        : '';
    let lopCell = '';
    if (rowIsAdmin) {
        lopCell = `<td data-field="subject" data-label="Môn / Lớp"><input type="text" class="table-input" value="${lopVal}" placeholder="Môn học"
            list="subject-list" style="${_missingSubject ? 'border:1.5px solid #EF4444;background:#FEF2F2;' : ''}"
            onchange="updateSubjectRow('${compositeKey}', '${caType}', ${index}, this.value)">${_missingBadge}</td>`;
    } else {
        const rawSubjectColor = (window._subjectList || []).find(s => s.name === data.lop)?.color || '';
        const subjectColor = /^#[0-9a-f]{6}$/i.test(rawSubjectColor) ? rawSubjectColor : '';
        const dotHtml = subjectColor ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${subjectColor};margin-right:4px;"></span>` : '';
        lopCell = `<td data-field="subject" data-label="Môn / Lớp" style="font-size:0.875rem;">${dotHtml}${scheduleEscapeHTML(data.lop || '')}${_missingBadge}</td>`;
    }

    // === CỘT GV THAY THẾ (multi-teacher) ===
    const gvTTCell = renderGVMultiCell(data, isAdmin, compositeKey, caType, index, 'gvThayTe', attendanceEvidence, isPastOrToday, dateKey, cancelledShiftsMap);

    const rowBg = isClassClosed ? 'background: #F3F4F6; opacity: 0.75;' : '';

    return `
        <tr style="${rowBg}">
            <td data-field="ss" data-label="SS" style="text-align: center;">${index + 1}</td>
            ${renderTimeCell('Bắt đầu', data.start, rowIsAdmin, compositeKey, caType, index, 'start')}
            ${renderTimeCell('Kết thúc', data.end, rowIsAdmin, compositeKey, caType, index, 'end')}
            ${lopCell}
            <td data-field="room" data-label="Phòng"><input type="text" class="${inputClass}" value="${scheduleEscapeAttr(data.phong || '')}" placeholder="Phòng" ${readonlyAttr} onchange="updateRow('${compositeKey}', '${caType}', ${index}, 'phong', this.value)"></td>
            ${gvCell}
            ${gvTTCell}
            ${soHSCell}
            <td data-field="note" data-label="Ghi chú"><input type="text" class="${inputClass}" value="${scheduleEscapeAttr(data.note || '')}" placeholder="Ghi chú" ${readonlyAttr} onchange="updateRow('${compositeKey}', '${caType}', ${index}, 'note', this.value)"></td>
            ${actionCell}
        </tr>
    `;
}

window.addNewRow = async function (compositeKey, caType, defaultStart, defaultEnd) {
    if (isScheduleTimePast(compositeKey, defaultStart)) {
        alert("Không thể thêm lớp học cho thời gian đã qua trong quá khứ!");
        return;
    }

    const newRow = {
        shiftId: window.TeacherShiftState ? TeacherShiftState.stableShiftId({}) : `shift_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        staffingSchemaVersion: 2,
        start: defaultStart, end: defaultEnd,
        lop: '', lopId: '', phong: '',
        gv: '', gvId: '', gvList: [],
        gvThayThe: '', gvThayTheId: '', gvThayTheList: [],
        gvThayTe: '', gvThayTeId: '', gvThayTeList: [],
        teacherAbsences: [], teacherAbsenceHistory: [],
        soHS: 0, note: ''
    };

    try {
        await DBService.mutateScheduleSectionAtomic(compositeKey, caType, rows => [...rows, newRow]);
        await renderTable();
    } catch (error) {
        showScheduleMutationError(error);
    }
};

window.updateRow = async function (compositeKey, caType, index, field, value) {
    const editableFields = new Set(['start', 'end', 'phong', 'note', 'soHS']);
    if (!editableFields.has(field)) return;
    const dayData = await DBService.getSchedule(compositeKey);
    if (!dayData || !dayData[caType] || !dayData[caType][index]) return;

    const row = dayData[caType][index];
    if (isScheduleTimePast(compositeKey, row.start)) {
        alert("Không thể chỉnh sửa lớp học cho thời gian đã qua trong quá khứ!");
        renderTable();
        return;
    }

    try {
        await DBService.updateScheduleRowAtomic(
            compositeKey,
            caType,
            scheduleRowLocator(row, index),
            latestRow => {
                if (isScheduleTimePast(compositeKey, latestRow.start)) {
                    const error = new Error('Ca đã bắt đầu hoặc đã qua và không thể chỉnh sửa.');
                    error.code = 'schedule/past';
                    throw error;
                }
                return { ...latestRow, [field]: value };
            },
            dayData
        );
        await renderTable();
    } catch (error) {
        showScheduleMutationError(error);
        await renderTable();
    }
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

    const locator = scheduleRowLocator(row, index);
    try {
        await DBService.mutateScheduleSectionAtomic(compositeKey, caType, rows => {
            const latestIndex = resolveScheduleRowIndex(rows, locator);
            if (latestIndex < 0) throw scheduleRowConflictError();
            if (isScheduleTimePast(compositeKey, rows[latestIndex].start)) {
                const error = new Error('Ca đã bắt đầu hoặc đã qua và không thể xóa.');
                error.code = 'schedule/past';
                throw error;
            }
            return rows.filter((_, rowIndex) => rowIndex !== latestIndex);
        }, dayData);
        await renderTable();
    } catch (error) {
        showScheduleMutationError(error);
        await renderTable();
    }
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
    const isTeacherOrTA = hasTeachingEmploymentRole(currentRoles);
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

    // Ca chưa điền Môn/Lớp thì Bảng Công không biết áp đơn giá nào → chip hiện "(CHƯA CHỌN LỚP)"
    // và giờ đó không tính được lương. Chặn ngay từ khâu nhận lớp.
    if (!String(row.lop || '').trim()) {
        alert("Ca này chưa có Môn / Lớp. Vui lòng nhờ người xếp lịch điền Môn/Lớp trước khi nhận lớp — nếu không, giờ dạy sẽ không tính được lương.");
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
        const registrationStatus = await DBService.registerClass(
            compositeKey,
            caType,
            { index },
            { id: currentUserId, name: userFullName }
        );
        await renderTable();
        localStorage.setItem('schedule_registration_updated', Date.now().toString());
        UIService.toast(registrationStatus === 'active' ? 'Đã nhận lớp.' : 'Đã hủy nhận lớp.', 'success');
    } catch (e) {
        alert("Lỗi: " + e.message);
    }
};
// ================= GV DROPDOWN =================

async function loadSubjectListForSchedule() {
    try {
        // Nhóm môn (isGroup) chỉ là thư mục trong trang Môn Học — không xếp lịch được.
        const subjects = (await DBService.getSubjects() || []).filter(s => s.isGroup !== true);
        window._subjectList = subjects;
        let dl = document.getElementById('subject-list');
        if (!dl) {
            dl = document.createElement('datalist');
            dl.id = 'subject-list';
            document.body.appendChild(dl);
        }
        dl.innerHTML = subjects.map(s => {
            const name = scheduleEscapeAttr(s.name || '');
            return `<option value="${name}" data-id="${scheduleEscapeAttr(s.id || '')}">`;
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
            const name = scheduleEscapeAttr(u.name || u.username || '');
            return `<option value="${name}" data-id="${scheduleEscapeAttr(u.id || '')}">`;
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

    try {
        await DBService.updateScheduleRowAtomic(
            compositeKey,
            caType,
            scheduleRowLocator(row, index),
            latestRow => {
                if (isScheduleTimePast(compositeKey, latestRow.start)) {
                    const error = new Error('Ca đã bắt đầu hoặc đã qua và không thể đổi môn học.');
                    error.code = 'schedule/past';
                    throw error;
                }
                return { ...latestRow, lop: subjectName, lopId };
            },
            dayData
        );
        await renderTable();
    } catch (error) {
        showScheduleMutationError(error);
        await renderTable();
    }
};

let teacherShiftManagerState = null;
let teacherPickerGeneration = 0;

function scheduleRowSignature(row) {
    return [row?.start, row?.end, row?.lop, row?.phong]
        .map(value => String(value || '').trim())
        .join('|');
}

function scheduleIdentityHash(value, seed = 2166136261) {
    let hash = seed >>> 0;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36);
}

function stableScheduleShiftLocatorId(compositeKey, section, row, index) {
    const explicit = String(row?.shiftId || '').trim();
    if (explicit) return explicit;
    const raw = [compositeKey, section, index, scheduleRowSignature(row)].join('::');
    return `legacy_shift_${scheduleIdentityHash(raw)}_${scheduleIdentityHash(raw, 3335557771)}`;
}

function normalizedScheduleSubjectName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

function locallyClaimedScheduleRoles() {
    const raw = localStorage.getItem('currentRole');
    if (typeof parseRoles === 'function') return parseRoles(raw);
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch (_error) {
        return raw ? [raw] : [];
    }
}

function scheduleRowLocator(row, index) {
    return {
        index,
        shiftId: String(row?.shiftId || ''),
        signature: scheduleRowSignature(row)
    };
}

function resolveScheduleRowIndex(rows, locator) {
    const list = Array.isArray(rows) ? rows : [];
    const shiftId = String(locator?.shiftId || '');
    if (shiftId) {
        const byId = list.findIndex(row => String(row?.shiftId || '') === shiftId);
        if (byId >= 0) return byId;
    }
    if (Number.isInteger(locator?.index)) {
        const candidate = list[locator.index];
        if (candidate && (!locator.signature || scheduleRowSignature(candidate) === locator.signature)) {
            return locator.index;
        }
    }
    return -1;
}

function scheduleRowConflictError() {
    const error = new Error('Ca đã được người khác thay đổi hoặc di chuyển. Vui lòng tải lại lịch rồi thử lại.');
    error.code = 'schedule/conflict';
    return error;
}

function showScheduleMutationError(error) {
    console.error('Schedule mutation failed:', error);
    const message = error?.message || 'Không thể cập nhật lịch.';
    if (typeof UIService !== 'undefined' && typeof UIService.toast === 'function') {
        UIService.toast(scheduleEscapeHTML(message), 'error');
    } else {
        alert(message);
    }
}

function toLocalDateTimeInput(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function getTeachingRoleLabel(teacher) {
    const roles = Array.isArray(teacher?.roles) ? teacher.roles : [teacher?.role || ''];
    if (roles.includes('teacher')) return 'Giáo viên';
    if (roles.includes('teaching_assistant')) return 'Trợ giảng';
    if (roles.includes('assistant')) return 'Trợ lý';
    return 'Nhân sự giảng dạy';
}

function closeTeacherShiftManager(force = false) {
    if (!force && isAttendanceSaveInFlight()) {
        window.UIService?.toast?.('Đang lưu công nguyên tử. Vui lòng chờ hoàn tất trước khi đóng popup.', 'warning');
        return false;
    }
    teacherPickerGeneration += 1;
    const state = teacherShiftManagerState;
    document.getElementById('gv-picker-overlay')?.remove();
    document.body.classList.remove('teacher-shift-modal-open');
    teacherShiftManagerState = null;
    if (state?.triggerEl && document.contains(state.triggerEl)) state.triggerEl.focus?.();
    return true;
}

function teacherManagerMainEntries() {
    const state = teacherShiftManagerState;
    return (state?.mainIds || []).map(id => state.teacherById.get(id)).filter(Boolean);
}

function teacherManagerAbsentMainEntries() {
    const state = teacherShiftManagerState;
    return teacherManagerMainEntries().filter(item => (state.statuses[item.id]?.type || 'ACTIVE') !== 'ACTIVE');
}

function teacherManagerSubEntries() {
    const state = teacherShiftManagerState;
    return (state?.substituteIds || []).map(id => state.substituteById.get(id)).filter(Boolean);
}

function teacherManagerReplacementTarget() {
    const state = teacherShiftManagerState;
    const teacherId = String(state?.replacementTargetId || '').trim();
    if (!teacherId || (state.statuses?.[teacherId]?.type || 'ACTIVE') === 'ACTIVE') return null;
    return state.teacherById?.get(teacherId) || null;
}

// Keep replacement coverage scoped to one absent main teacher. Removing a
// pending coverage must never remove a substitute who still covers another
// teacher in the same class.
function clearTeacherReplacementMappings(state, teacherId) {
    const mainId = String(teacherId || '').trim();
    if (!state || !mainId) return false;
    let changed = false;
    state.substituteById.forEach(substitute => {
        const previousIds = Array.from(new Set((substitute?.replacesTeacherIds || []).map(String)));
        const nextIds = previousIds.filter(id => id !== mainId);
        if (nextIds.length !== previousIds.length) changed = true;
        substitute.replacesTeacherIds = nextIds;
    });
    const retainedIds = (state.substituteIds || []).filter(id => {
        const substitute = state.substituteById.get(id);
        if ((substitute?.replacesTeacherIds || []).length) return true;
        if (substitute) {
            state.substituteById.delete(id);
            changed = true;
        }
        return false;
    });
    if (retainedIds.length !== (state.substituteIds || []).length) changed = true;
    state.substituteIds = retainedIds;
    if (String(state.replacementTargetId || '') === mainId) state.replacementTargetId = '';
    return changed;
}

function assignTeacherReplacement(state, substituteId, teacherId) {
    const mainId = String(teacherId || '').trim();
    const replacementId = String(substituteId || '').trim();
    const isAbsentMain = state?.mainIds?.includes(mainId) &&
        (state.statuses?.[mainId]?.type || 'ACTIVE') !== 'ACTIVE';
    const teacher = state?.teacherById?.get(replacementId);
    if (!isAbsentMain || !replacementId || !teacher || state.mainIds.includes(replacementId)) return false;

    const current = state.substituteById.get(replacementId) || {};
    const replacesTeacherIds = Array.from(new Set([
        ...(current.replacesTeacherIds || []).map(String),
        mainId
    ]));
    state.substituteById.set(replacementId, {
        ...current,
        id: replacementId,
        name: current.name || teacher.name || teacher.username || 'Chưa đặt tên',
        replacesTeacherIds
    });
    if (!state.substituteIds.includes(replacementId)) state.substituteIds.push(replacementId);
    state.replacementTargetId = '';
    return true;
}

function teacherRosterItem(teacher, kind, checked, disabled) {
    const id = scheduleEscapeAttr(teacher.id);
    const name = teacher.name || teacher.username || 'Chưa đặt tên';
    const searchable = scheduleEscapeAttr(`${name} ${teacher.username || ''}`.toLocaleLowerCase('vi'));
    return `<label class="teacher-roster-item${checked ? ' is-selected' : ''}" data-search="${searchable}">
        <input type="checkbox" data-action="toggle-${kind}" data-teacher-id="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="teacher-roster-avatar" aria-hidden="true">${scheduleEscapeHTML(name.charAt(0).toUpperCase())}</span>
        <span class="teacher-roster-copy"><strong>${scheduleEscapeHTML(name)}</strong><small>${scheduleEscapeHTML(getTeachingRoleLabel(teacher))}</small></span>
        <span class="teacher-roster-check" aria-hidden="true">✓</span>
    </label>`;
}

function teacherStatusCard(teacher) {
    const state = teacherShiftManagerState;
    const status = state.statuses[teacher.id] || { type: 'ACTIVE', reason: '', reportedAt: new Date().toISOString() };
    const type = status.type || 'ACTIVE';
    const id = scheduleEscapeAttr(teacher.id);
    const pendingFixed = !!state.mainMeta[teacher.id]?.pendingFixed;
    const absence = type !== 'ACTIVE';
    const replacements = teacherManagerSubEntries().filter(sub => (sub.replacesTeacherIds || []).includes(teacher.id));
    const coverage = absence
        ? (replacements.length
            ? `<span class="coverage-pill is-covered">Đã có GV thay · ${scheduleEscapeHTML(replacements.map(item => item.name).join(', '))}</span>`
            : '<span class="coverage-pill is-pending">Đang tìm GV thay</span>')
        : '<span class="coverage-pill is-active">Sẵn sàng đứng lớp</span>';
    const coverageActions = absence ? `<div class="coverage-decision-actions" role="group" aria-label="Điều phối giáo viên thay cho ${scheduleEscapeAttr(teacher.name)}">
            <button type="button" data-action="mark-pending" data-teacher-id="${id}" class="${replacements.length ? '' : 'is-active'}">Chưa có GV thay</button>
            <button type="button" data-action="pick-replacement" data-teacher-id="${id}" class="is-pick">${replacements.length ? 'Đổi / thêm GV thay' : 'Chọn GV thay'}</button>
        </div>` : '';
    return `<article class="teacher-status-card status-${type.toLowerCase()}" data-main-card="${id}">
        <div class="teacher-status-card-head">
            <div><strong>${scheduleEscapeHTML(teacher.name)}</strong><span>GV chính</span></div>
            ${coverage}
        </div>
        <div class="teacher-status-segment" role="group" aria-label="Trạng thái của ${scheduleEscapeAttr(teacher.name)}">
            <button type="button" data-action="set-status" data-teacher-id="${id}" data-status="ACTIVE" class="${type === 'ACTIVE' ? 'is-active' : ''}">Đang dạy</button>
            <button type="button" data-action="set-status" data-teacher-id="${id}" data-status="VP" class="${type === 'VP' ? 'is-active' : ''}">Vắng có phép</button>
            <button type="button" data-action="set-status" data-teacher-id="${id}" data-status="VDX" class="${type === 'VDX' ? 'is-active' : ''}">Vắng đột xuất</button>
        </div>
        ${absence ? `<div class="teacher-absence-fields">
            <label><span>Thời điểm báo</span><input type="datetime-local" data-action="reported-at" data-teacher-id="${id}" value="${scheduleEscapeAttr(toLocalDateTimeInput(status.reportedAt))}"></label>
            <label class="reason-field"><span>Lý do / ghi chú điều phối</span><input type="text" maxlength="300" data-action="absence-reason" data-teacher-id="${id}" value="${scheduleEscapeAttr(status.reason || '')}" placeholder="Ví dụ: báo bệnh, việc gia đình..."></label>
        </div>${coverageActions}` : ''}
        <button type="button" class="fixed-next-week-btn${pendingFixed ? ' is-active' : ''}" data-action="toggle-fixed" data-teacher-id="${id}">⏳ ${pendingFixed ? 'Đã đánh dấu cố định tuần sau' : 'Đánh dấu cố định từ tuần sau'}</button>
    </article>`;
}

function replacementTargetPickerMarkup() {
    const state = teacherShiftManagerState;
    const target = teacherManagerReplacementTarget();
    if (!state || !target) return '';
    const candidates = state.teachers
        .filter(teacher => teacher?.id && !state.mainIds.includes(String(teacher.id)));
    const cards = candidates.map(teacher => {
        const substitute = state.substituteById.get(String(teacher.id));
        const alreadyAssigned = (substitute?.replacesTeacherIds || []).map(String).includes(String(target.id));
        return `<button type="button" class="replacement-candidate${alreadyAssigned ? ' is-selected' : ''}" data-action="assign-replacement" data-substitute-id="${scheduleEscapeAttr(teacher.id)}" data-main-id="${scheduleEscapeAttr(target.id)}">
            <span><strong>${scheduleEscapeHTML(teacher.name || teacher.username || 'Chưa đặt tên')}</strong><small>${scheduleEscapeHTML(getTeachingRoleLabel(teacher))}</small></span>
            <b>${alreadyAssigned ? 'Đã chọn' : 'Chọn'}</b>
        </button>`;
    }).join('');
    return `<section class="replacement-target-panel" aria-live="polite">
        <div class="replacement-target-head"><div><strong>Chọn GV thay cho ${scheduleEscapeHTML(target.name)}</strong><span>Người được chọn sẽ được gắn đúng ca nghỉ này.</span></div><button type="button" data-action="cancel-replacement-target">Hủy</button></div>
        <div class="replacement-candidate-list">${cards || '<div class="no-absence-hint">Không còn GV giảng dạy nào để chọn trong danh sách này. Hãy giữ trạng thái “Chưa có GV thay” và lưu ca.</div>'}</div>
    </section>`;
}

function substituteCoverageCard(substitute) {
    const absent = teacherManagerAbsentMainEntries();
    const id = scheduleEscapeAttr(substitute.id);
    return `<article class="substitute-coverage-card">
        <div><strong>${scheduleEscapeHTML(substitute.name)}</strong><span>Chọn GV chính mà người này sẽ thay</span></div>
        <div class="replacement-map-options">
            ${absent.length ? absent.map(main => {
                const selected = (substitute.replacesTeacherIds || []).includes(main.id);
                return `<button type="button" data-action="toggle-map" data-substitute-id="${id}" data-main-id="${scheduleEscapeAttr(main.id)}" class="${selected ? 'is-active' : ''}">${selected ? '✓ ' : ''}${scheduleEscapeHTML(main.name)}</button>`;
            }).join('') : '<span class="no-absence-hint">Hãy chọn trạng thái nghỉ cho GV chính trước.</span>'}
        </div>
    </article>`;
}

function attendanceAdminEntryList() {
    const state = teacherShiftManagerState;
    return Array.from(state?.attendance?.entries?.values?.() || []);
}

function selectedAttendanceAdminEntry() {
    const state = teacherShiftManagerState;
    if (!state?.attendance?.selectedId) return null;
    return state.attendance.entries.get(state.attendance.selectedId) || null;
}

function isAttendanceSaveInFlight(state = teacherShiftManagerState) {
    return !!state?.attendance?.savingId;
}

function attendanceEntryHasWorkedEvidence(entry) {
    if (!entry || entry.sourceWasAbsent) return false;
    return ['open', 'closed'].includes(String(entry.draft?.mode || ''));
}

function attendanceAbsenceConflict(state = teacherShiftManagerState, teacherId = '') {
    if (!state?.attendance?.entries) return null;
    const ids = teacherId ? [String(teacherId)] : (state.mainIds || []).map(String);
    for (const id of ids) {
        if ((state.statuses?.[id]?.type || 'ACTIVE') === 'ACTIVE') continue;
        const entry = state.attendance.entries.get(id);
        if (entry?.resolution?.status === 'ambiguous' || attendanceEntryHasWorkedEvidence(entry)) return entry;
    }
    return null;
}

function attendanceConcurrentSubjectSet(entry) {
    const state = teacherShiftManagerState;
    const early10 = window.Early10;
    if (!entry || !state?.dayData || !early10 || !window.TeacherShiftState) {
        return { ids: [], error: 'Chưa tải được đầy đủ các ca trùng giờ để kiểm tra +10 phút.' };
    }
    const staffId = String(entry.staffId || '');
    const cancelledShiftKeys = Array.isArray(entry.source?.cancelledShiftKeys)
        ? entry.source.cancelledShiftKeys
        : [];
    const rows = SECTIONS.flatMap(section => Array.isArray(state.dayData?.[section.key])
        ? state.dayData[section.key].map((row, rowIndex) => ({ row, rowIndex, section: section.key }))
        : []
    ).filter(candidate => {
        const { row, rowIndex, section } = candidate;
        if (!row || row.isClosed === true || String(row.start || '') !== String(state.originalRow.start || '') ||
            String(row.end || '') !== String(state.originalRow.end || '')) return false;
        const legacyCancelledKey = `${state.compositeKey}_${section}_${rowIndex}`;
        const persistedShiftId = String(row.shiftId || '').trim();
        if (cancelledShiftKeys.includes(legacyCancelledKey) ||
            (persistedShiftId && cancelledShiftKeys.includes(`shift:${persistedShiftId}`))) return false;
        const isActiveMain = TeacherShiftState.getMainTeachers(row)
            .some(item => String(item?.id || '') === staffId) &&
            !TeacherShiftState.isMainTeacherAbsent(row, staffId);
        const isSubstitute = TeacherShiftState.getSubstituteTeachers(row)
            .some(item => String(item?.id || '') === staffId);
        return isActiveMain || isSubstitute;
    }).map(candidate => candidate.row);
    const ids = new Set();
    const subjects = Array.isArray(state.attendanceContext?.subjects)
        ? state.attendanceContext.subjects
        : [];
    for (const row of rows) {
        const explicitIds = early10.splitSubjectIds(row.lopId)
            .map(value => String(value || '').trim())
            .filter(Boolean);
        if (explicitIds.length) {
            explicitIds.forEach(id => ids.add(id));
            continue;
        }
        const name = String(row.lop || '').trim();
        const matches = subjects.filter(subject => String(subject?.name || '').trim() === name);
        if (!name || matches.length !== 1 || !String(matches[0]?.id || '').trim()) {
            return {
                ids: [],
                error: matches.length > 1
                    ? `Môn/Lớp “${name || '?'}” trong ca ghép đang trùng tên dữ liệu.`
                    : `Môn/Lớp “${name || '?'}” trong ca ghép chưa có mã dữ liệu duy nhất.`
            };
        }
        ids.add(String(matches[0].id).trim());
    }
    if (!ids.size) early10.splitSubjectIds(state.subjectId).forEach(id => ids.add(id));
    return { ids: Array.from(ids).sort(), error: '' };
}

function attendancePenaltyTimestampLabel(value) {
    const date = value?.toDate?.() || (Number.isFinite(Number(value?.seconds))
        ? new Date(Number(value.seconds) * 1000)
        : (value ? new Date(value) : null));
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    }).format(date);
}

function attendancePenaltyMessage(entry) {
    const marker = entry?.bonus10PenaltyState;
    if (marker?.active === true) {
        const details = [
            marker.lastDateKey ? `ca ngày ${marker.lastDateKey}` : '',
            marker.updatedBy ? `người ghi ${marker.updatedBy}` : '',
            attendancePenaltyTimestampLabel(marker.updatedAt)
        ].filter(Boolean).join(' · ');
        return `Khóa +10p cả tháng do một yêu cầu bị từ chối${details ? ` (${details})` : ''}. Chỉ gỡ khóa có audit tại Bảng Công.`;
    }
    if (entry?.legacyRejectedBonusRequest) {
        return `Khóa +10p cả tháng theo yêu cầu cũ bị từ chối ngày ${entry.legacyRejectedBonusRequest.dateKey || 'không rõ'}. Gỡ khóa tại Bảng Công sẽ giữ nguyên dấu vết này.`;
    }
    return 'Phụ cấp +10 phút và lớp đông của tháng này đang bị khóa do trạng thái sĩ số/phụ cấp bị từ chối.';
}

function attendanceEarly10Verdict(entry) {
    const state = teacherShiftManagerState;
    if (state?.subjectResolutionError) {
        return { ok: false, message: state.subjectResolutionError };
    }
    if (!entry || !state?.attendanceContext || !window.Early10) {
        return { ok: false, message: 'Chưa tải được quy định +10 phút.' };
    }
    if (entry.penaltyActive) {
        return { ok: false, message: attendancePenaltyMessage(entry) };
    }
    const concurrentSubjects = attendanceConcurrentSubjectSet(entry);
    if (concurrentSubjects.error || !concurrentSubjects.ids.length) {
        return { ok: false, message: concurrentSubjects.error || 'Ca này chưa có mã Môn/Lớp hợp lệ.' };
    }
    return Early10.evaluateEarly10Request({
        sessionRole: concurrentSubjects.ids.join('+'),
        subjectIds: concurrentSubjects.ids,
        subjects: state.attendanceContext.subjects,
        user: entry.profile,
        checkIn: entry.draft.checkIn,
        classStart: state.originalRow.start
    });
}

function attendanceEntryBlockedReason(entry, validation, bonusVerdict) {
    const state = teacherShiftManagerState;
    if (!entry) return 'Chưa chọn nhân sự.';
    if (state.attendanceShiftClosed) return 'Ca/lớp đang tắt. Hãy mở lại ca trên lịch trước khi ghi công.';
    if (state.subjectResolutionError) return state.subjectResolutionError;
    if (entry.payrollLocked) return 'Phiếu lương giảng dạy tháng này đã phát hành/đã nhận nên đang khóa nguồn công.';
    if (entry.resolution.status === 'ambiguous') return entry.resolution.error || 'Có nhiều phiên công trùng ca; hãy xử lý trong Bảng Công.';
    if (entry.isMain && (entry.originalAbsent || (state.statuses[entry.staffId]?.type || 'ACTIVE') !== 'ACTIVE')) {
        return 'GV chính đang ở trạng thái nghỉ. Hãy khôi phục “Đang dạy”, lưu điều phối ca rồi mở lại popup trước khi ghi công.';
    }
    if ((entry.draft.mode || 'none') === 'none') return 'Hãy chọn “Đã vào ca” hoặc “Đủ vào/ra” trước khi lưu.';
    if (!validation?.ok) return validation?.error || validation?.errors?.[0] || 'Dữ liệu giờ công chưa hợp lệ.';
    if (entry.draft.bonus10 && !bonusVerdict?.ok && (entry.bonus10Dirty || entry.bonus10Status === 'approved')) {
        return bonusVerdict?.message || 'Chưa đủ điều kiện +10 phút.';
    }
    return '';
}

function attendanceAdminPanelMarkup() {
    const state = teacherShiftManagerState;
    if (!state?.canEditAttendance) {
        if (!state?.likelyPrimaryAdmin || !state.attendanceAuthorizationError) return '';
        const retrying = state.attendanceAuthorizationRetrying === true;
        const message = state.attendanceAuthorizationError?.message || 'Không thể xác minh quyền Admin trực tiếp từ Firebase.';
        return `<section class="attendance-admin-panel attendance-auth-warning" aria-live="polite">
            <div class="attendance-admin-head"><div><h4>3 · Công & chip nhân viên</h4><p>Chức năng nhạy cảm đang khóa an toàn vì chưa xác minh được quyền Admin từ máy chủ.</p></div><span class="section-count has-alert">ĐÃ KHÓA</span></div>
            <div class="attendance-admin-error">${scheduleEscapeHTML(message)}</div>
            <button type="button" class="btn-attendance-save" data-action="attendance-auth-retry" ${retrying ? 'disabled' : ''}>${retrying ? 'Đang xác minh lại…' : 'Xác minh lại quyền Admin'}</button>
        </section>`;
    }
    const attendance = state.attendance;
    if (attendance.loading) {
        return `<section class="attendance-admin-panel"><div class="attendance-admin-head"><div><h4>3 · Công & chip nhân viên</h4><p>Chỉ Admin · giờ, +10 phút và sĩ số dùng chung nguồn với Bảng Công/Bảng Lương.</p></div><span class="section-count">ADMIN</span></div><div class="attendance-admin-loading">Đang tải dữ liệu công mới nhất từ Firebase…</div></section>`;
    }
    if (attendance.error) {
        return `<section class="attendance-admin-panel"><div class="attendance-admin-head"><div><h4>3 · Công & chip nhân viên</h4><p>Không tạo dữ liệu thay thế khi đọc Firebase thất bại.</p></div><span class="section-count has-alert">ADMIN</span></div><div class="attendance-admin-error">${scheduleEscapeHTML(attendance.error)}</div><button type="button" class="btn-attendance-save" data-action="attendance-retry">Tải lại dữ liệu công</button></section>`;
    }

    const entries = attendanceAdminEntryList();
    if (!entries.length) {
        return `<section class="attendance-admin-panel"><div class="attendance-admin-head"><div><h4>3 · Công & chip nhân viên</h4><p>Chỉ chỉnh công cho nhân sự đã được lưu trong ca hiện tại.</p></div><span class="section-count">ADMIN</span></div><div class="teacher-empty-state compact">Hãy lưu GV chính/GV thay trước, sau đó mở lại popup để chỉnh công.</div></section>`;
    }
    const entry = selectedAttendanceAdminEntry() || entries[0];
    const shiftWindow = state.shiftWindow;
    const validation = ScheduleAttendanceAdmin.validateDraft(entry.draft, shiftWindow, { now: new Date() });
    const bonusVerdict = attendanceEarly10Verdict(entry);
    const blockedReason = attendanceEntryBlockedReason(entry, validation, bonusVerdict);
    const preview = ScheduleAttendanceAdmin.previewState(entry.draft, validation);
    const mode = entry.draft.mode || 'none';
    const hasSession = !!entry.sessionId;
    const savingLocked = isAttendanceSaveInFlight(state);
    const mainStatusBlocked = entry.isMain && (entry.originalAbsent || (state.statuses[entry.staffId]?.type || 'ACTIVE') !== 'ACTIVE');
    const editorLocked = savingLocked || state.attendanceShiftClosed || entry.payrollLocked ||
        entry.resolution.status === 'ambiguous' || mainStatusBlocked || !!state.subjectResolutionError;
    const fieldsDisabled = mode === 'none' || editorLocked;
    const bonusDisabled = fieldsDisabled || (!entry.draft.bonus10 && !bonusVerdict.ok);
    const tabs = entries.map(item => {
        const selected = item.staffId === entry.staffId;
        const tabToken = scheduleIdentityHash(item.staffId);
        const stateLabel = item.resolution.status === 'ambiguous'
            ? 'Cần xử lý'
            : (item.bonus10Status === 'pending' && !item.bonus10Dirty
                ? 'Chờ +10p'
                : (item.draft.mode === 'closed' ? 'Đủ vào/ra' : (item.draft.mode === 'open' ? 'Đã vào ca' : 'Chưa có công')));
        return `<button type="button" id="attendance-tab-${tabToken}" class="attendance-person-tab${selected ? ' is-active' : ''}" data-action="attendance-select" data-teacher-id="${scheduleEscapeAttr(item.staffId)}" role="tab" aria-selected="${selected}" aria-controls="attendance-editor-panel" tabindex="${selected ? '0' : '-1'}" ${savingLocked ? 'disabled' : ''}>${scheduleEscapeHTML(item.name)} · ${scheduleEscapeHTML(stateLabel)}</button>`;
    }).join('');
    const plannedCount = Number(state.originalRow.soHS);
    const policyClass = bonusVerdict.ok ? ' is-eligible' : '';
    const policyState = bonusVerdict.ok ? 'eligible' : 'blocked';
    const previewClass = preview?.className || (mode === 'none' ? 'is-warning' : '');
    const panelToken = scheduleIdentityHash(entry.staffId);
    const pendingBonus = entry.bonus10Status === 'pending' && !entry.bonus10Dirty;
    const bonusDecisionText = entry.bonus10Dirty
        ? (entry.draft.bonus10 ? 'Sẽ duyệt và áp dụng khi lưu.' : 'Sẽ hủy yêu cầu, không kích hoạt phạt tháng.')
        : (entry.bonus10Status === 'approved'
            ? 'Đã duyệt và đang áp dụng.'
            : (pendingBonus ? 'Yêu cầu đang chờ Admin quyết định; lưu giờ/sĩ số sẽ không tự hủy.' : 'Chưa áp dụng.'));
    const pendingApproveDisabled = fieldsDisabled || !bonusVerdict.ok;
    const pendingCancelDisabled = fieldsDisabled;
    const studentCountStatus = String(entry.draft.studentCountStatus || '').toLowerCase();
    const studentCountDecisionText = entry.studentCountDirty || entry.draft.studentCountDirty
        ? (entry.draft.studentCount == null
            ? 'Sẽ xóa sĩ số và trạng thái duyệt khi lưu.'
            : 'Sẽ lưu sĩ số ở trạng thái Đã duyệt khi lưu.')
        : (studentCountStatus
            ? `Chưa thay đổi; giữ nguyên trạng thái ${studentCountStatus === 'approved' ? 'Đã duyệt' : (studentCountStatus === 'pending' ? 'Chờ duyệt' : 'Đã từ chối')}.`
            : 'Chưa thay đổi sĩ số.');
    const bonusControl = pendingBonus || (entry.bonus10Status === 'pending' && entry.bonus10Dirty)
        ? `<div class="attendance-bonus-status is-pending" role="status">Yêu cầu +10p đang chờ duyệt</div>
            <div class="attendance-bonus-actions" role="group" aria-label="Quyết định yêu cầu cộng 10 phút">
                <button type="button" data-action="attendance-bonus-set" data-desired="true" class="${entry.bonus10Dirty && entry.draft.bonus10 ? 'is-active' : ''}" aria-pressed="${entry.bonus10Dirty && entry.draft.bonus10}" ${pendingApproveDisabled ? 'disabled' : ''}>Duyệt +10p</button>
                <button type="button" data-action="attendance-bonus-set" data-desired="false" class="${entry.bonus10Dirty && !entry.draft.bonus10 ? 'is-active is-negative' : ''}" aria-pressed="${entry.bonus10Dirty && !entry.draft.bonus10}" ${pendingCancelDisabled ? 'disabled' : ''}>Không áp dụng · không phạt tháng</button>
            </div>`
        : `<label class="attendance-bonus-toggle"><input type="checkbox" data-action="attendance-bonus10" ${entry.draft.bonus10 ? 'checked' : ''} ${bonusDisabled ? 'disabled' : ''}><span>${entry.draft.bonus10 ? 'Đang áp dụng' : 'Chưa áp dụng'}</span></label>`;

    return `<section class="attendance-admin-panel">
        <div class="attendance-admin-head">
            <div><h4>3 · Công & chip nhân viên</h4><p>Chỉ Admin · chỉnh đúng dữ liệu nguồn; chip sẽ tự đổi và Bảng Lương đọc lại cùng một phiên công.</p></div>
            <span class="section-count">ADMIN</span>
        </div>
        <div class="attendance-person-tabs" role="tablist" aria-label="Nhân sự trong ca">${tabs}</div>
        <article id="attendance-editor-panel" class="attendance-editor-card" data-attendance-editor="${scheduleEscapeAttr(entry.staffId)}" role="tabpanel" aria-labelledby="attendance-tab-${panelToken}" ${savingLocked ? 'aria-busy="true"' : ''}>
            <div class="attendance-chip-preview ${scheduleEscapeAttr(previewClass)}">${scheduleEscapeHTML(preview?.label || 'Chưa xác minh chấm công')}</div>
            <div class="attendance-state-segment" role="group" aria-label="Trạng thái công của ${scheduleEscapeAttr(entry.name)}">
                <button type="button" data-action="attendance-mode" data-state="none" class="${mode === 'none' ? 'is-active' : ''}" aria-pressed="${mode === 'none'}" ${hasSession || editorLocked ? 'disabled title="Không xóa phiên công từ popup lịch; dùng Bảng Công để xử lý có kiểm soát."' : ''}>Chưa có công</button>
                <button type="button" data-action="attendance-mode" data-state="open" class="${mode === 'open' ? 'is-active' : ''}" aria-pressed="${mode === 'open'}" ${editorLocked ? 'disabled' : ''}>Đã vào ca</button>
                <button type="button" data-action="attendance-mode" data-state="closed" class="${mode === 'closed' ? 'is-active' : ''}" aria-pressed="${mode === 'closed'}" ${editorLocked ? 'disabled' : ''}>Đủ vào / ra</button>
            </div>
            <div class="attendance-time-grid">
                <label><span>Giờ vào chính xác</span><input type="datetime-local" step="1" data-action="attendance-check-in" value="${scheduleEscapeAttr(entry.draft.checkIn || '')}" ${fieldsDisabled ? 'disabled' : ''}></label>
                <label><span>Giờ ra chính xác</span><input type="datetime-local" step="1" data-action="attendance-check-out" value="${scheduleEscapeAttr(entry.draft.checkOut || '')}" ${fieldsDisabled || mode !== 'closed' ? 'disabled' : ''}></label>
            </div>
            <div class="attendance-extra-grid">
                <div class="attendance-extra-card">
                    <strong>Điền nhanh theo lịch</strong><small>${scheduleEscapeHTML(`${state.originalRow.start || '--:--'}–${state.originalRow.end || '--:--'}`)}. Admin vẫn phải kiểm tra giờ thực tế trước khi lưu.</small>
                    <button type="button" data-action="attendance-use-schedule" ${editorLocked ? 'disabled' : ''}>Dùng giờ của ca</button>
                </div>
                <div class="attendance-extra-card">
                    <label><span>Sĩ số thực tế tính lương</span><input type="number" min="1" max="500" step="1" data-action="attendance-student-count" value="${scheduleEscapeAttr(entry.draft.studentCount ?? '')}" placeholder="Để trống nếu không áp dụng" ${fieldsDisabled ? 'disabled' : ''}></label>
                    <small>${scheduleEscapeHTML(studentCountDecisionText)} Không tự ghi đè cột Số HS kế hoạch.</small>
                    ${Number.isInteger(plannedCount) && plannedCount > 0 ? `<button type="button" data-action="attendance-use-planned-count" ${fieldsDisabled ? 'disabled' : ''}>Dùng số đang xếp: ${plannedCount}</button>` : ''}
                </div>
                <div class="attendance-extra-card">
                    <strong>Phụ cấp vào sớm +10p</strong>
                    ${bonusControl}
                    <small>${scheduleEscapeHTML(bonusDecisionText)} Chỉ duyệt khi đúng môn, đúng chế độ GV, vào sớm đủ 10 phút và tháng không bị khóa.</small>
                    ${entry.penaltyActive ? `<div class="attendance-admin-error" role="alert">${scheduleEscapeHTML(attendancePenaltyMessage(entry))}</div>` : ''}
                </div>
            </div>
            <div class="attendance-policy-note${policyClass}" data-state="${policyState}">${scheduleEscapeHTML(bonusVerdict.message || (bonusVerdict.ok ? 'Đủ điều kiện +10 phút.' : 'Chưa đủ điều kiện +10 phút.'))}</div>
            ${entry.linkNote ? `<div class="attendance-policy-note">${scheduleEscapeHTML(entry.linkNote)}</div>` : ''}
            ${blockedReason ? `<div class="attendance-admin-error">${scheduleEscapeHTML(blockedReason)}</div>` : ''}
            <button type="button" class="btn-attendance-save" data-action="attendance-save" ${blockedReason || attendance.savingId ? 'disabled' : ''}>${attendance.savingId === entry.staffId ? 'Đang lưu nguyên tử…' : '✓ Lưu công & cập nhật chip'}</button>
        </article>
    </section>`;
}

async function loadAdminAttendanceEditor(state = teacherShiftManagerState) {
    if (!state?.canEditAttendance || teacherShiftManagerState !== state) return;
    if (!state.attendance.teacherIds.length) {
        state.attendance.loading = false;
        state.attendance.error = '';
        state.attendance.entries = new Map();
        renderTeacherShiftManager();
        return;
    }
    state.attendance.loading = true;
    state.attendance.error = '';
    renderTeacherShiftManager();
    try {
        const context = await DBService.getAdminTeachingAttendanceEditorContext({
            staffIds: state.attendance.teacherIds,
            dateKey: state.dateKey
        });
        if (teacherShiftManagerState !== state) return;
        state.attendanceContext = context;
        const serverSubjects = Array.isArray(context.subjects) ? context.subjects : [];
        const rowSubjectId = String(state.originalRow.lopId || '').trim();
        const normalizedSubjectName = normalizedScheduleSubjectName(state.originalRow.lop);
        const subjectsByName = normalizedSubjectName
            ? serverSubjects.filter(subject => normalizedScheduleSubjectName(subject?.name) === normalizedSubjectName)
            : [];
        const serverSubjectIds = new Set(serverSubjects.map(subject => String(subject?.id || '').trim()).filter(Boolean));
        if (rowSubjectId) {
            const rowSubjectIds = Array.from(new Set(Early10.splitSubjectIds(rowSubjectId)));
            const missingSubjectIds = rowSubjectIds.filter(subjectId => !serverSubjectIds.has(subjectId));
            state.subjectId = rowSubjectIds.length && missingSubjectIds.length === 0
                ? rowSubjectIds.join('+')
                : '';
            state.subjectResolutionError = state.subjectId
                ? ''
                : `Mã Môn/Lớp trên dòng lịch không còn hợp lệ trên Firebase${missingSubjectIds.length ? `: ${missingSubjectIds.join(', ')}` : ''}. Đã khóa lưu công để tránh sai chip và đơn giá.`;
        } else {
            const resolvedSubject = subjectsByName.length === 1 ? subjectsByName[0] : null;
            state.subjectId = String(resolvedSubject?.id || '').trim();
            state.subjectResolutionError = state.subjectId
                ? ''
                : (subjectsByName.length > 1
                    ? 'Có nhiều Môn/Lớp trùng tên trên Firebase. Hãy gắn đúng mã Môn/Lớp vào dòng lịch trước khi ghi công.'
                    : 'Không xác minh được mã Môn/Lớp trên Firebase. Đã khóa lưu công để tránh chip “Role?” và sai đơn giá.');
        }
        const entries = new Map();
        state.attendance.teacherIds.forEach(staffId => {
            const teacher = state.teacherById.get(staffId) || { id: staffId, name: 'Nhân sự' };
            const source = context.entries.find(item => item.staffId === staffId) || {
                staffId, attendance: null, profile: teacher, monthlySettings: {}, monthlyBonusRequests: []
            };
            const hasCanonicalSessions = Array.isArray(source.attendance?.sessions) && source.attendance.sessions.length > 0;
            const sessions = hasCanonicalSessions
                ? source.attendance.sessions
                : (source.attendance?.checkIn ? [{
                    id: '',
                    checkIn: source.attendance.checkIn,
                    checkOut: source.attendance.checkOut || null,
                    start: source.attendance.checkIn
                }] : []);
            const resolution = ScheduleAttendanceAdmin.resolveSessionForShift(sessions, {
                dateKey: state.dateKey,
                start: state.originalRow.start,
                end: state.originalRow.end,
                shiftId: state.shiftId,
                subjectId: state.subjectId,
                compositeKey: state.compositeKey,
                section: state.caType
            }, state.shiftWindow);
            const session = resolution.status === 'matched' ? resolution.session : null;
            const draft = ScheduleAttendanceAdmin.createDraft(session, state.shiftWindow);
            // The schedule's VP/VĐX controls own absence state. This editor's
            // open/closed modes are explicit "worked" targets, so saving an
            // attendance session previously marked absent must clear that flag.
            if (session?.isAbsent) draft.isAbsent = false;
            const monthlyBonusRequests = Array.isArray(source.monthlyBonusRequests) ? source.monthlyBonusRequests : [];
            const matchingBonusRequests = session
                ? monthlyBonusRequests.filter(item => String(item.sessionId || '') === String(session.id || ''))
                : [];
            const approvedBonus = matchingBonusRequests.find(item => item.status === 'approved') || null;
            const pendingBonus = matchingBonusRequests.find(item => item.status === 'pending') || null;
            const legacyRejectedBonusRequest = monthlyBonusRequests.find(item => item.status === 'rejected') || null;
            const bonus10PenaltyState = source.monthlySettings?.bonus10PenaltyState &&
                typeof source.monthlySettings.bonus10PenaltyState === 'object'
                ? source.monthlySettings.bonus10PenaltyState
                : null;
            if (approvedBonus) draft.bonus10 = true;
            const isMain = state.originalMainIds.includes(staffId);
            entries.set(staffId, {
                staffId,
                name: teacher.name || teacher.username || 'Nhân sự',
                profile: { ...teacher, ...(source.profile || {}) },
                source,
                resolution,
                draft,
                sourceWasAbsent: !!session?.isAbsent,
                sessionId: session && hasCanonicalSessions ? String(session.id || '') : '',
                expectedFingerprint: session && hasCanonicalSessions ? ScheduleAttendanceAdmin.fingerprintSession(session) : '',
                bonus10Status: approvedBonus ? 'approved' : (pendingBonus ? 'pending' : 'none'),
                bonus10RequestId: approvedBonus?.id || pendingBonus?.id || '',
                bonus10Dirty: false,
                bonus10PenaltyState,
                legacyRejectedBonusRequest,
                studentCountDirty: false,
                isMain,
                originalAbsent: isMain && isRowMainTeacherAbsent(state.originalRow, staffId),
                payrollLocked: !!DBService.getPayslipDraftLockState(source.monthlySettings?.published || {}, 'gv').locked,
                penaltyActive: Early10.isMonthlyBonusPenaltyActive(
                    source.monthlySettings || {},
                    [
                        ...monthlyBonusRequests.map(request => ({ bonus10Status: request.status })),
                        ...sessions.map(candidate => ({ studentCountStatus: candidate?.studentCountStatus }))
                    ]
                ),
                linkNote: [
                    session?.isAbsent
                        ? 'Phiên nguồn đang được đánh dấu vắng; khi Admin lưu giờ vào/ra, hệ thống sẽ chuyển phiên này thành có mặt và ghi lịch sử.'
                        : '',
                    session && !hasCanonicalSessions
                        ? 'Đây là dữ liệu công đời cũ. Khi Admin lưu, hệ thống sẽ chuẩn hóa thành phiên có ID và ghi lịch sử; không tự đổi nếu bạn chưa bấm lưu.'
                        : (session?.linkedClassStart && session.linkedClassStart !== state.originalRow.start
                            ? `Phiên này đang gắn ca ${session.linkedClassStart}; popup giữ nguyên liên kết để không làm sai lịch sử lương.`
                            : (resolution.method === 'overlap' && session
                                ? 'Đã ghép theo khung giờ trùng duy nhất; liên kết lịch cũ (nếu có) sẽ được giữ nguyên.'
                                : ''))
                ].filter(Boolean).join(' ')
            });
        });
        state.attendance.entries = entries;
        if (!entries.has(state.attendance.selectedId)) state.attendance.selectedId = entries.keys().next().value || '';
        state.attendance.loading = false;
        state.attendance.error = '';
        renderTeacherShiftManager();
    } catch (error) {
        if (teacherShiftManagerState !== state) return;
        console.error('Không tải được dữ liệu công cho popup lịch:', error);
        state.attendance.loading = false;
        state.attendance.error = error?.message || 'Không tải được dữ liệu công mới nhất.';
        renderTeacherShiftManager();
    }
}

async function saveAdminAttendanceEntry() {
    const state = teacherShiftManagerState;
    const entry = selectedAttendanceAdminEntry();
    if (!state?.canEditAttendance || !entry || state.attendance.savingId) return;
    const validation = ScheduleAttendanceAdmin.validateDraft(entry.draft, state.shiftWindow, { now: new Date() });
    const blockedReason = attendanceEntryBlockedReason(entry, validation, attendanceEarly10Verdict(entry));
    if (blockedReason) {
        UIService.toast(blockedReason, 'error');
        return;
    }
    state.attendance.savingId = entry.staffId;
    renderTeacherShiftManager();
    try {
        const bonus10Mutation = {
            dirty: entry.bonus10Dirty === true,
            desired: entry.draft.bonus10 === true
        };
        const studentCountMutation = {
            dirty: entry.studentCountDirty === true || entry.draft.studentCountDirty === true,
            value: validation.studentCount
        };
        await DBService.saveAdminTeachingAttendanceCorrection({
            staffId: entry.staffId,
            staffName: entry.name,
            dateKey: state.dateKey,
            sessionId: entry.sessionId,
            expectedFingerprint: entry.expectedFingerprint,
            scheduledStart: state.originalRow.start,
            scheduledEnd: state.originalRow.end,
            subjectId: state.subjectId,
            subjectName: state.originalRow.lop,
            shiftId: state.shiftId,
            compositeKey: state.compositeKey,
            section: state.caType,
            scheduleIndex: state.index,
            expectedScheduleSignature: state.signature,
            expectedStaffingUpdatedAt: state.expectedStaffingUpdatedAt,
            bonus10Dirty: bonus10Mutation.dirty,
            studentCountDirty: studentCountMutation.dirty,
            scheduleIdentity: {
                compositeKey: state.compositeKey,
                section: state.caType,
                index: state.index,
                shiftId: state.shiftId,
                persistedShiftId: String(state.originalRow.shiftId || ''),
                isInherited: state.originalRow._isInheritedSchedule === true,
                sourceDocId: String(state.originalRow._inheritedFromScheduleDocId || ''),
                sourceIndex: Number.isInteger(state.originalRow._inheritedIndex)
                    ? state.originalRow._inheritedIndex
                    : state.index,
                signature: state.signature,
                expectedStaffingUpdatedAt: state.expectedStaffingUpdatedAt,
                staffId: entry.staffId,
                scheduledStart: state.originalRow.start,
                scheduledEnd: state.originalRow.end,
                subjectId: state.subjectId
            },
            bonus10Mutation,
            studentCountMutation,
            draft: {
                ...entry.draft,
                bonus10Dirty: bonus10Mutation.dirty,
                studentCountDirty: studentCountMutation.dirty
            }
        });
        UIService.toast(`Đã lưu công của ${entry.name}; chip và nguồn Bảng Lương đã đồng bộ.`, 'success');
        if (teacherShiftManagerState === state) {
            state.attendance.savingId = '';
            await loadAdminAttendanceEditor(state);
        }
        await renderTable();
    } catch (error) {
        console.error('Lỗi lưu công từ popup lịch:', error);
        UIService.toast(error?.message || 'Không thể lưu công.', 'error');
        if (teacherShiftManagerState === state) {
            state.attendance.savingId = '';
            renderTeacherShiftManager();
        }
    }
}

function teacherShiftManagerMarkup() {
    const state = teacherShiftManagerState;
    const mains = teacherManagerMainEntries();
    const substitutes = teacherManagerSubEntries();
    const absent = teacherManagerAbsentMainEntries();
    const primaryRoster = state.teachers.map(teacher => teacherRosterItem(
        teacher,
        'main',
        state.mainIds.includes(teacher.id),
        state.isPast
    )).join('');
    const substituteRoster = state.teachers
        .filter(teacher => !state.mainIds.includes(teacher.id))
        .map(teacher => teacherRosterItem(teacher, 'substitute', state.substituteIds.includes(teacher.id), false))
        .join('');
    return `<div class="teacher-shift-workspace">
        <section class="teacher-command-column">
            <div class="teacher-command-section-head">
                <div><span class="step-number">1</span><h4>GV chính & trạng thái</h4></div>
                <span class="section-count">${mains.length} GV chính</span>
            </div>
            <div class="teacher-status-list">
                ${mains.length ? mains.map(teacherStatusCard).join('') : '<div class="teacher-empty-state">Chưa có GV chính. Chọn một người ở danh sách bên cạnh.</div>'}
            </div>
            <div class="teacher-command-section-head replacement-head">
                <div><span class="step-number">2</span><h4>Điều phối GV dạy thay</h4></div>
                <span class="section-count ${absent.length ? 'has-alert' : ''}">${absent.length ? `${absent.length} ca nghỉ` : 'Không có ca nghỉ'}</span>
            </div>
            <div class="substitute-coverage-list">
                ${substitutes.length ? substitutes.map(substituteCoverageCard).join('') : `<div class="teacher-empty-state compact">${absent.length ? 'Chưa chọn GV thay — ca sẽ được lưu ở trạng thái “Đang tìm GV thay”.' : 'Khi GV chính báo nghỉ, chọn người dạy thay ở danh sách bên cạnh.'}</div>`}
            </div>
            ${attendanceAdminPanelMarkup()}
        </section>
        <aside class="teacher-roster-column">
            <div class="roster-tabs" role="tablist">
                <button type="button" role="tab" data-action="roster-tab" data-tab="main" class="${state.activeTab === 'main' ? 'is-active' : ''}">GV chính <span>${state.mainIds.length}</span></button>
                <button type="button" role="tab" data-action="roster-tab" data-tab="substitute" class="${state.activeTab === 'substitute' ? 'is-active' : ''}">GV dạy thay <span>${state.substituteIds.length}</span></button>
            </div>
            <div class="roster-pane ${state.activeTab === 'main' ? 'is-active' : ''}" data-roster-pane="main">
                <label class="teacher-search"><span aria-hidden="true">⌕</span><input type="search" data-action="roster-search" data-kind="main" value="${scheduleEscapeAttr(state.search.main)}" placeholder="Tìm GV chính..."></label>
                ${state.isPast ? '<div class="roster-lock-note">Ca đã bắt đầu: khóa thay đổi danh sách GV chính, nhưng vẫn cho phép cập nhật nghỉ và GV thay.</div>' : ''}
                <div class="teacher-roster-list" data-roster-list="main">${primaryRoster}</div>
            </div>
            <div class="roster-pane ${state.activeTab === 'substitute' ? 'is-active' : ''}" data-roster-pane="substitute">
                ${replacementTargetPickerMarkup()}
                <label class="teacher-search"><span aria-hidden="true">⌕</span><input type="search" data-action="roster-search" data-kind="substitute" value="${scheduleEscapeAttr(state.search.substitute)}" placeholder="Tìm GV dạy thay..."></label>
                <div class="teacher-roster-list" data-roster-list="substitute">${substituteRoster}</div>
            </div>
        </aside>
    </div>`;
}

function applyTeacherRosterFilter(kind) {
    const state = teacherShiftManagerState;
    const query = String(state?.search?.[kind] || '').trim().toLocaleLowerCase('vi');
    document.querySelectorAll(`[data-roster-list="${kind}"] .teacher-roster-item`).forEach(item => {
        item.hidden = !!query && !String(item.dataset.search || '').includes(query);
    });
}

function syncTeacherShiftManagerChrome() {
    const state = teacherShiftManagerState;
    const overlay = document.getElementById('gv-picker-overlay');
    if (!state || !overlay) return;
    const attendanceLocked = isAttendanceSaveInFlight(state);
    const interactionLocked = attendanceLocked || state.saving === true;
    const dialog = overlay.querySelector('.teacher-shift-dialog');
    if (dialog) {
        dialog.classList.toggle('is-saving-attendance', attendanceLocked);
        dialog.setAttribute('aria-busy', interactionLocked ? 'true' : 'false');
    }
    overlay.querySelectorAll('[data-action="close-manager"], [data-action="save-manager"]').forEach(control => {
        control.disabled = interactionLocked;
    });
    if (attendanceLocked) {
        overlay.querySelectorAll('#teacher-shift-manager-body button, #teacher-shift-manager-body input, #teacher-shift-manager-body select, #teacher-shift-manager-body textarea')
            .forEach(control => { control.disabled = true; });
    }
}

function renderTeacherShiftManager() {
    const body = document.getElementById('teacher-shift-manager-body');
    if (!body || !teacherShiftManagerState) return;
    const commandColumn = body.querySelector('.teacher-command-column');
    const personTabs = body.querySelector('.attendance-person-tabs');
    const active = body.contains(document.activeElement) ? document.activeElement : null;
    const activeKey = active?.dataset?.action ? {
        action: active.dataset.action,
        teacherId: active.dataset.teacherId || '',
        kind: active.dataset.kind || '',
        state: active.dataset.state || '',
        desired: active.dataset.desired || ''
    } : null;
    const selectionStart = Number.isInteger(active?.selectionStart) ? active.selectionStart : null;
    const viewport = {
        bodyTop: body.scrollTop,
        commandTop: commandColumn?.scrollTop || 0,
        tabsLeft: personTabs?.scrollLeft || 0,
        roster: Array.from(body.querySelectorAll('[data-roster-list]')).map(list => ({
            kind: list.dataset.rosterList,
            top: list.scrollTop
        }))
    };
    body.innerHTML = teacherShiftManagerMarkup();
    applyTeacherRosterFilter('main');
    applyTeacherRosterFilter('substitute');
    const mains = teacherManagerMainEntries().length;
    const absent = teacherManagerAbsentMainEntries().length;
    const subs = teacherManagerSubEntries().length;
    const summary = document.getElementById('teacher-shift-manager-summary');
    if (summary) summary.textContent = `${mains} GV chính · ${absent ? `${absent} GV nghỉ` : 'đủ nhân sự'} · ${subs} GV thay`;
    body.scrollTop = viewport.bodyTop;
    const nextCommandColumn = body.querySelector('.teacher-command-column');
    if (nextCommandColumn) nextCommandColumn.scrollTop = viewport.commandTop;
    const nextPersonTabs = body.querySelector('.attendance-person-tabs');
    if (nextPersonTabs) nextPersonTabs.scrollLeft = viewport.tabsLeft;
    viewport.roster.forEach(saved => {
        const list = Array.from(body.querySelectorAll('[data-roster-list]'))
            .find(item => item.dataset.rosterList === saved.kind);
        if (list) list.scrollTop = saved.top;
    });
    if (activeKey) {
        const nextActive = Array.from(body.querySelectorAll('[data-action]')).find(element =>
            element.dataset.action === activeKey.action &&
            (element.dataset.teacherId || '') === activeKey.teacherId &&
            (element.dataset.kind || '') === activeKey.kind &&
            (element.dataset.state || '') === activeKey.state &&
            (element.dataset.desired || '') === activeKey.desired
        );
        if (nextActive && !nextActive.disabled) {
            try { nextActive.focus({ preventScroll: true }); } catch (_error) { nextActive.focus(); }
            if (selectionStart !== null && typeof nextActive.setSelectionRange === 'function') {
                try { nextActive.setSelectionRange(selectionStart, selectionStart); } catch (_error) {}
            }
            body.scrollTop = viewport.bodyTop;
            if (nextCommandColumn) nextCommandColumn.scrollTop = viewport.commandTop;
        }
    }
    syncTeacherShiftManagerChrome();
}

let teacherTransferModalState = null;

function getScheduleDateKeysInclusive(fromKey, toKey) {
    const fromParts = String(fromKey || '').split('-').map(Number);
    const toParts = String(toKey || '').split('-').map(Number);
    if (fromParts.length !== 3 || toParts.length !== 3 || fromParts.some(Number.isNaN) || toParts.some(Number.isNaN)) return [];
    const from = new Date(fromParts[0], fromParts[1] - 1, fromParts[2]);
    const to = new Date(toParts[0], toParts[1] - 1, toParts[2]);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return [];
    const result = [];
    for (let cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
        result.push(getLocalDateKey(cursor));
        if (result.length > 31) return [];
    }
    return result;
}

function getTransferTargetOptions(state) {
    const options = [];
    SECTIONS.forEach(section => {
        const rows = Array.isArray(state?.dayData?.[section.key]) ? state.dayData[section.key] : [];
        rows.forEach((row, index) => {
            if (section.key === state.caType && index === state.index) return;
            const teachers = window.TeacherShiftState
                ? window.TeacherShiftState.getMainTeachers(row).map(item => item.name).filter(Boolean).join(', ')
                : String(row.gv || '');
            options.push({
                value: `${section.key}::${index}`,
                section: section.key,
                index,
                row,
                label: `${section.label} · ${row.start || '--:--'}–${row.end || '--:--'} · ${row.lop || 'Chưa chọn lớp'}${row.phong ? ` · P.${row.phong}` : ''}${teachers ? ` · GV: ${teachers}` : ''}`
            });
        });
    });
    return options;
}

function closeTeacherTransferModal() {
    document.getElementById('teacher-transfer-overlay')?.remove();
    teacherTransferModalState = null;
}

function updateTeacherTransferModeHint() {
    const modal = document.getElementById('teacher-transfer-overlay');
    if (!modal) return;
    const mode = modal.querySelector('[data-action="transfer-mode"]')?.value || 'temporary';
    const sourceAction = modal.querySelector('[data-action="transfer-source-action"]')?.value || '';
    const toLabel = modal.querySelector('[data-transfer-scope-label]');
    const hint = modal.querySelector('[data-transfer-mode-hint]');
    const replacementTitle = modal.querySelector('[data-transfer-replacement-title]');
    const replacementSelect = modal.querySelector('[data-action="transfer-replacement"]');
    if (toLabel) toLabel.textContent = mode === 'permanent'
        ? 'Ngày cuối cập nhật các lịch đang có (bản ghi không hết hạn)'
        : 'Ngày kết thúc tạm thời';
    if (replacementSelect) {
        const isHandoff = sourceAction === 'handoff';
        replacementSelect.disabled = !isHandoff;
        if (!isHandoff) replacementSelect.value = '';
        replacementSelect.style.background = isHandoff ? '#fff' : '#F1F5F9';
    }
    if (replacementTitle) replacementTitle.textContent = sourceAction === 'handoff'
        ? 'GV tiếp quản lớp nguồn '
        : 'GV tiếp quản lớp nguồn (không dùng khi ghi Vắng) ';
    const periodHint = mode === 'permanent'
        ? '“Chuyển hẳn” không tạo ngày kết thúc. Ngày cuối ở trên chỉ giới hạn các lịch đã tồn tại được cập nhật trong lượt này để tránh tự ý sửa hàng loạt.'
        : 'Các ngày trong khoảng này sẽ được cập nhật cùng một giao dịch.';
    const sourceHint = sourceAction === 'handoff'
        ? 'Bàn giao: GV chuyển sẽ rời lớp nguồn và trở thành GV chính ở lớp đích. Nếu lớp nguồn chỉ có một GV chính, bắt buộc chọn người tiếp quản.'
        : sourceAction === 'absence-vp'
            ? 'Vắng có phép: GV chuyển vẫn được giữ ở lớp nguồn nhưng được ghi Vắng có phép/chờ GV thay; đồng thời trở thành GV chính ở lớp đích.'
            : sourceAction === 'absence-vdx'
                ? 'Vắng đột xuất: GV chuyển vẫn được giữ ở lớp nguồn nhưng được ghi Vắng đột xuất/chờ GV thay; đồng thời trở thành GV chính ở lớp đích.'
                : 'Hãy chọn cách xử lý lớp nguồn. Nếu GV đang là hỗ trợ ở lớp đích, hệ thống sẽ chuyển người đó thành GV chính sau khi lưu.';
    if (hint) hint.textContent = `${sourceHint} ${periodHint}`;
}

function handleTeacherTransferModalChange(event) {
    if (['transfer-mode', 'transfer-source-action', 'transfer-teacher'].includes(event.target?.dataset?.action)) {
        updateTeacherTransferModeHint();
    }
}

function openTeacherTransferModal(state) {
    if (!state?.canTransfer || state.isPast) return;
    const existing = document.getElementById('teacher-transfer-overlay');
    if (existing) existing.remove();
    const targets = getTransferTargetOptions(state);
    if (!targets.length) {
        UIService.toast('Ngày đang xem chưa có lớp đích để điều chuyển.', 'warning');
        return;
    }
    const mains = (state.mainIds || []).map(id => ({
        id,
        name: state.teacherById.get(id)?.name || id
    }));
    if (!mains.length) {
        UIService.toast('Ca nguồn chưa có GV chính để điều chuyển.', 'warning');
        return;
    }
    teacherTransferModalState = { state, targets };
    const todayKey = getLocalDateKey(new Date());
    const defaultFrom = state.dateKey >= todayKey ? state.dateKey : todayKey;
    const defaultTo = defaultFrom;
    const overlay = document.createElement('div');
    overlay.id = 'teacher-transfer-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.62);z-index:10020;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    overlay.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="teacher-transfer-title" style="background:#fff;border-radius:18px;max-width:640px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 24px 80px rgba(15,23,42,.3);padding:22px;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:8px;">
            <div><div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#059669;font-weight:800;">Điều chuyển có kiểm soát</div><h3 id="teacher-transfer-title" style="margin:4px 0;font-size:1.2rem;color:#0f172a;">Đổi lớp / Chuyển giáo viên</h3><p style="margin:0;color:#64748b;font-size:.84rem;">Nguồn: ${scheduleEscapeHTML(state.originalRow.lop || 'Ca dạy')} · ${scheduleEscapeHTML(state.dateKey)} · ${scheduleEscapeHTML(`${state.originalRow.start || '--:--'}–${state.originalRow.end || '--:--'}`)}</p></div>
            <button type="button" data-action="close-transfer" aria-label="Đóng" style="border:0;background:#F1F5F9;border-radius:10px;width:34px;height:34px;font-size:1.2rem;cursor:pointer;">×</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:16px;">
            <label style="font-size:.78rem;color:#334155;font-weight:700;">GV chuyển
                <select data-action="transfer-teacher" style="display:block;width:100%;margin-top:5px;height:40px;border:1px solid #CBD5E1;border-radius:9px;padding:0 8px;background:#fff;">${mains.map(item => `<option value="${scheduleEscapeAttr(item.id)}">${scheduleEscapeHTML(item.name)}</option>`).join('')}</select>
            </label>
            <label style="font-size:.78rem;color:#334155;font-weight:700;">Lớp đích
                <select data-action="transfer-target" style="display:block;width:100%;margin-top:5px;height:40px;border:1px solid #CBD5E1;border-radius:9px;padding:0 8px;background:#fff;">${targets.map(item => `<option value="${scheduleEscapeAttr(item.value)}">${scheduleEscapeHTML(item.label)}</option>`).join('')}</select>
            </label>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px;">
            <label style="font-size:.78rem;color:#334155;font-weight:700;">Xử lý lớp nguồn <span style="color:#DC2626;">*</span>
                <select data-action="transfer-source-action" style="display:block;width:100%;margin-top:5px;height:40px;border:1px solid #CBD5E1;border-radius:9px;padding:0 8px;background:#fff;"><option value="">— Chọn cách xử lý —</option><option value="handoff">Bàn giao cho GV tiếp quản</option><option value="absence-vp">Giữ lịch nguồn · Vắng có phép</option><option value="absence-vdx">Giữ lịch nguồn · Vắng đột xuất</option></select>
            </label>
            <label style="font-size:.78rem;color:#334155;font-weight:700;"><span data-transfer-replacement-title>GV tiếp quản lớp nguồn</span>
                <select data-action="transfer-replacement" disabled style="display:block;width:100%;margin-top:5px;height:40px;border:1px solid #CBD5E1;border-radius:9px;padding:0 8px;background:#F1F5F9;"><option value="">— Chọn khi bàn giao —</option>${state.teachers.filter(item => !state.mainIds.includes(item.id) && !state.substituteIds.includes(item.id)).map(item => `<option value="${scheduleEscapeAttr(item.id)}">${scheduleEscapeHTML(item.name || item.id)}</option>`).join('')}</select>
            </label>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px;">
            <label style="font-size:.78rem;color:#334155;font-weight:700;">Loại điều chuyển
                <select data-action="transfer-mode" style="display:block;width:100%;margin-top:5px;height:40px;border:1px solid #CBD5E1;border-radius:9px;padding:0 8px;background:#fff;"><option value="temporary">Tạm thời</option><option value="permanent">Chuyển hẳn</option></select>
            </label>
            <label style="font-size:.78rem;color:#334155;font-weight:700;">Ngày bắt đầu hiệu lực
                <input data-action="transfer-from" type="date" value="${scheduleEscapeAttr(defaultFrom)}" min="${scheduleEscapeAttr(todayKey)}" style="display:block;width:100%;margin-top:5px;height:40px;border:1px solid #CBD5E1;border-radius:9px;padding:0 8px;box-sizing:border-box;">
            </label>
        </div>
        <label style="display:block;margin-top:12px;font-size:.78rem;color:#334155;font-weight:700;" data-transfer-scope-label>Ngày cuối cập nhật các lịch đang có
            <input data-action="transfer-scope-to" type="date" value="${scheduleEscapeAttr(defaultTo)}" min="${scheduleEscapeAttr(defaultFrom)}" style="display:block;width:100%;margin-top:5px;height:40px;border:1px solid #CBD5E1;border-radius:9px;padding:0 8px;box-sizing:border-box;">
        </label>
        <div data-transfer-mode-hint style="margin-top:10px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:10px;color:#166534;font-size:.78rem;line-height:1.45;"></div>
        <label style="display:block;margin-top:12px;font-size:.78rem;color:#334155;font-weight:700;">Lý do bắt buộc
            <textarea data-action="transfer-reason" rows="3" maxlength="300" placeholder="Ví dụ: GV chuyển sang lớp khác trong tuần 1–7/9 theo phân công..." style="display:block;width:100%;margin-top:5px;border:1px solid #CBD5E1;border-radius:9px;padding:9px;box-sizing:border-box;resize:vertical;"></textarea>
        </label>
        <div data-transfer-preview style="margin-top:12px;color:#64748b;font-size:.78rem;">Hệ thống sẽ kiểm tra từng ngày và chỉ lưu khi tất cả ca nguồn/đích còn đúng.</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
            <button type="button" data-action="close-transfer" style="border:1px solid #CBD5E1;background:#fff;color:#334155;border-radius:9px;padding:10px 14px;cursor:pointer;">Hủy</button>
            <button type="button" data-action="submit-transfer" style="border:0;background:#059669;color:#fff;border-radius:9px;padding:10px 16px;font-weight:800;cursor:pointer;">Kiểm tra & lưu điều chuyển</button>
        </div>
    </div>`;
    overlay.addEventListener('click', event => {
        if (event.target === overlay || event.target.closest('[data-action="close-transfer"]')) closeTeacherTransferModal();
        if (event.target.closest('[data-action="submit-transfer"]')) submitTeacherTransferModal();
    });
    overlay.addEventListener('change', handleTeacherTransferModalChange);
    document.body.appendChild(overlay);
    updateTeacherTransferModeHint();
}

function findTransferRowIndex(dayData, endpoint) {
    const rows = Array.isArray(dayData?.[endpoint.section]) ? dayData[endpoint.section] : [];
    const locator = endpoint.locator || {};
    const signatureOf = row => scheduleRowSignature(row);
    if (locator.shiftId) {
        const byId = rows.findIndex(row => String(row?.shiftId || '') === locator.shiftId);
        if (byId >= 0) return byId;
    }
    if (Number.isInteger(locator.index) && rows[locator.index] &&
        (!locator.signature || signatureOf(rows[locator.index]) === locator.signature)) return locator.index;
    const matches = rows.map((row, index) => ({ row, index }))
        .filter(item => locator.signature && signatureOf(item.row) === locator.signature);
    return matches.length === 1 ? matches[0].index : -1;
}

function transferEndpoint(compositeKey, section, index, row, fallbackData) {
    return {
        compositeKey,
        section,
        locator: {
            index,
            shiftId: String(row?.shiftId || ''),
            signature: scheduleRowSignature(row)
        },
        fallbackData
    };
}

async function submitTeacherTransferModal() {
    const modal = document.getElementById('teacher-transfer-overlay');
    const modalState = teacherTransferModalState;
    if (!modal || !modalState?.state) return;
    const state = modalState.state;
    const mode = modal.querySelector('[data-action="transfer-mode"]')?.value || 'temporary';
    const teacherId = modal.querySelector('[data-action="transfer-teacher"]')?.value || '';
    const targetValue = modal.querySelector('[data-action="transfer-target"]')?.value || '';
    const sourceAction = modal.querySelector('[data-action="transfer-source-action"]')?.value || '';
    const replacementId = modal.querySelector('[data-action="transfer-replacement"]')?.value || '';
    const fromKey = modal.querySelector('[data-action="transfer-from"]')?.value || '';
    const scopeToKey = modal.querySelector('[data-action="transfer-scope-to"]')?.value || '';
    const reason = modal.querySelector('[data-action="transfer-reason"]')?.value.trim() || '';
    const target = modalState.targets.find(item => item.value === targetValue);
    const teacher = state.teacherById.get(teacherId);
    const sourceDisposition = sourceAction === 'handoff'
        ? 'handoff'
        : ['absence-vp', 'absence-vdx'].includes(sourceAction) ? 'absence' : '';
    const sourceAbsenceType = sourceAction === 'absence-vp' ? 'VP'
        : sourceAction === 'absence-vdx' ? 'VDX' : '';
    const replacement = sourceDisposition === 'handoff' && replacementId
        ? state.teacherById.get(replacementId)
        : null;
    const dateKeys = getScheduleDateKeysInclusive(fromKey, scopeToKey);
    if (!teacher || !target || !sourceDisposition || !dateKeys.length || reason.length < 3) {
        UIService.toast('Vui lòng chọn GV, lớp đích, cách xử lý lớp nguồn, khoảng ngày hợp lệ và nhập lý do.', 'warning');
        return;
    }
    const sourceHasAnotherMain = state.mainIds.some(id => String(id) !== String(teacherId));
    if (sourceDisposition === 'handoff' && !sourceHasAnotherMain && !replacement) {
        UIService.toast('Lớp nguồn chỉ có GV này. Hãy chọn GV tiếp quản hoặc chọn Vắng có phép/Vắng đột xuất.', 'warning');
        return;
    }
    if (dateKeys.length > 31) {
        UIService.toast('Mỗi giao dịch tối đa 31 ngày để tránh sửa nhầm hàng loạt.', 'warning');
        return;
    }
    const submitButton = modal.querySelector('[data-action="submit-transfer"]');
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Đang kiểm tra lịch...'; }
    const preview = modal.querySelector('[data-transfer-preview]');
    try {
        const branch = String(state.compositeKey || '').split('__')[0] || 'cs1';
        const transferId = `transfer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const sourceTemplate = { section: state.caType, index: state.index, row: state.originalRow };
        const targetTemplate = { section: target.section, index: target.index, row: target.row };
        const sourceAbsence = sourceDisposition === 'absence' ? {
            type: sourceAbsenceType,
            reason: `Điều chuyển sang ${target.row?.lop || 'lớp đích'}: ${reason}`.slice(0, 300)
        } : null;
        const operations = [];
        for (const dateKey of dateKeys) {
            const compositeKey = `${branch}__${dateKey}`;
            const dayData = dateKey === state.dateKey
                ? state.dayData
                : await DBService.getSchedule(compositeKey, { source: 'server' });
            if (!dayData || !Object.keys(dayData).length) {
                throw new Error(`Ngày ${dateKey} chưa có lịch cụ thể để điều chuyển.`);
            }
            const sourceIndex = findTransferRowIndex(dayData, {
                section: sourceTemplate.section,
                locator: {
                    index: sourceTemplate.index,
                    shiftId: String(sourceTemplate.row?.shiftId || ''),
                    signature: scheduleRowSignature(sourceTemplate.row)
                }
            });
            const targetIndex = findTransferRowIndex(dayData, {
                section: targetTemplate.section,
                locator: {
                    index: targetTemplate.index,
                    shiftId: String(targetTemplate.row?.shiftId || ''),
                    signature: scheduleRowSignature(targetTemplate.row)
                }
            });
            if (sourceIndex < 0 || targetIndex < 0) {
                throw new Error(`Ngày ${dateKey} không tìm thấy đúng ca nguồn/đích (có thể lịch đã thay đổi).`);
            }
            const sourceRow = dayData[sourceTemplate.section][sourceIndex];
            const targetRow = dayData[targetTemplate.section][targetIndex];
            if (!window.TeacherShiftState.getMainTeachers(sourceRow).some(item => item.id === teacherId)) {
                throw new Error(`Ngày ${dateKey}: GV được chọn không còn ở ca nguồn.`);
            }
            operations.push({
                transferId,
                mode,
                effectiveFrom: fromKey,
                effectiveTo: mode === 'temporary' ? scopeToKey : '',
                teacherId,
                replacementTeacher: replacement ? { id: replacement.id, name: replacement.name } : null,
                sourceDisposition,
                sourceAbsence,
                reason,
                source: transferEndpoint(compositeKey, sourceTemplate.section, sourceIndex, sourceRow, dayData),
                target: transferEndpoint(compositeKey, targetTemplate.section, targetIndex, targetRow, dayData)
            });
        }
        const sourceSummary = sourceDisposition === 'absence'
            ? `${teacher.name || 'GV chuyển'} sẽ được ghi ${sourceAbsenceType === 'VP' ? 'Vắng có phép' : 'Vắng đột xuất'} ở lớp nguồn`
            : replacement
                ? `${replacement.name || 'GV tiếp quản'} sẽ tiếp quản lớp nguồn`
                : 'lớp nguồn vẫn còn GV chính khác';
        if (preview) preview.textContent = `Đã kiểm tra ${operations.length} ngày. ${sourceSummary}; ${teacher.name || 'GV chuyển'} sẽ là GV chính ở lớp đích. Đang lưu nguyên tử...`;
        const result = await DBService.transferTeacherBetweenShiftsAtomic(operations);
        closeTeacherTransferModal();
        closeTeacherShiftManager();
        const completedSource = sourceDisposition === 'absence'
            ? `đã ghi ${sourceAbsenceType === 'VP' ? 'Vắng có phép' : 'Vắng đột xuất'} ở lớp nguồn`
            : 'đã bàn giao lớp nguồn';
        UIService.toast(`Đã ${mode === 'temporary' ? 'điều chuyển tạm thời' : 'ghi nhận chuyển hẳn'} ${result.count} ngày: ${completedSource}; ${teacher.name || 'GV chuyển'} là GV chính ở lớp đích.`, 'success');
        await renderTable();
    } catch (error) {
        console.error('Lỗi điều chuyển giáo viên:', error);
        UIService.toast(error?.message || 'Không thể điều chuyển giáo viên.', 'error');
        if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Kiểm tra & lưu điều chuyển'; }
        if (preview) preview.textContent = 'Chưa lưu: hệ thống đã dừng trước khi ghi để bảo toàn lịch.';
    }
}

async function retryTeacherAttendanceAuthorization(state = teacherShiftManagerState) {
    if (!state || teacherShiftManagerState !== state || state.attendanceAuthorizationRetrying) return;
    state.attendanceAuthorizationRetrying = true;
    renderTeacherShiftManager();
    try {
        const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
        if (teacherShiftManagerState !== state) return;
        if (!Array.isArray(authorization.roles) || !authorization.roles.includes('admin')) {
            const error = new Error('Firebase không xác nhận vai trò Admin cho tài khoản đang đăng nhập.');
            error.code = 'auth/admin-required';
            throw error;
        }
        state.strictAuthorization = authorization;
        state.canEditAttendance = true;
        state.attendanceAuthorizationError = null;
        state.attendanceAuthorizationRetrying = false;
        if (!state.shiftWindow) {
            state.shiftWindow = ScheduleAttendanceAdmin.buildShiftWindow(
                state.dateKey, state.originalRow.start, state.originalRow.end
            );
        }
        state.attendance.loading = true;
        renderTeacherShiftManager();
        await loadAdminAttendanceEditor(state);
    } catch (error) {
        if (teacherShiftManagerState !== state) return;
        state.canEditAttendance = false;
        state.attendanceAuthorizationError = error;
        state.attendanceAuthorizationRetrying = false;
        renderTeacherShiftManager();
    }
}

function handleTeacherShiftManagerClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !teacherShiftManagerState) return;
    const state = teacherShiftManagerState;
    const action = button.dataset.action;
    if (action === 'close-manager') return closeTeacherShiftManager();
    if (action === 'attendance-auth-retry') return retryTeacherAttendanceAuthorization(state);
    if (isAttendanceSaveInFlight(state)) {
        UIService.toast('Đang lưu công nguyên tử. Các thao tác khác tạm khóa để tránh lệch dữ liệu.', 'warning');
        return;
    }
    if (action === 'open-transfer' && state.canTransfer && !state.isPast) {
        return openTeacherTransferModal(state);
    }
    if (action === 'save-manager') return saveTeacherShiftCommand();
    if (action === 'attendance-retry' && state.canEditAttendance) return loadAdminAttendanceEditor(state);
    if (action === 'attendance-select' && state.canEditAttendance) {
        const teacherId = String(button.dataset.teacherId || '');
        if (state.attendance.entries.has(teacherId)) state.attendance.selectedId = teacherId;
        return renderTeacherShiftManager();
    }
    if (action === 'attendance-mode' && state.canEditAttendance) {
        const entry = selectedAttendanceAdminEntry();
        if (!entry) return;
        const nextMode = ['none', 'open', 'closed'].includes(button.dataset.state) ? button.dataset.state : 'none';
        if (nextMode === 'none' && entry.sessionId) return;
        entry.draft.mode = nextMode;
        if (nextMode === 'open') entry.draft.checkOut = '';
        if (nextMode !== 'none' && !entry.draft.checkIn) {
            entry.draft.checkIn = ScheduleAttendanceAdmin.toDateTimeLocal(state.shiftWindow.start);
        }
        if (nextMode === 'closed' && !entry.draft.checkOut) {
            entry.draft.checkOut = ScheduleAttendanceAdmin.toDateTimeLocal(state.shiftWindow.end);
        }
        return renderTeacherShiftManager();
    }
    if (action === 'attendance-use-schedule' && state.canEditAttendance) {
        const entry = selectedAttendanceAdminEntry();
        if (!entry) return;
        entry.draft.mode = 'closed';
        entry.draft.checkIn = ScheduleAttendanceAdmin.toDateTimeLocal(state.shiftWindow.start);
        entry.draft.checkOut = ScheduleAttendanceAdmin.toDateTimeLocal(state.shiftWindow.end);
        return renderTeacherShiftManager();
    }
    if (action === 'attendance-use-planned-count' && state.canEditAttendance) {
        const entry = selectedAttendanceAdminEntry();
        const count = Number(state.originalRow.soHS);
        if (entry && Number.isInteger(count) && count > 0 && count <= 500) {
            entry.draft.studentCount = count;
            entry.draft.studentCountDirty = true;
            entry.studentCountDirty = true;
        }
        return renderTeacherShiftManager();
    }
    if (action === 'attendance-bonus-set' && state.canEditAttendance) {
        const entry = selectedAttendanceAdminEntry();
        if (!entry) return;
        const desired = button.dataset.desired === 'true';
        if (desired) {
            const verdict = attendanceEarly10Verdict(entry);
            if (!verdict.ok) {
                UIService.toast(verdict.message || 'Chưa đủ điều kiện +10 phút.', 'error');
                return;
            }
        }
        entry.draft.bonus10 = desired;
        entry.bonus10Dirty = true;
        return renderTeacherShiftManager();
    }
    if (action === 'attendance-save' && state.canEditAttendance) return saveAdminAttendanceEntry();
    if (action === 'roster-tab') {
        state.activeTab = button.dataset.tab === 'substitute' ? 'substitute' : 'main';
        if (state.activeTab !== 'substitute') state.replacementTargetId = '';
        return renderTeacherShiftManager();
    }
    const teacherId = button.dataset.teacherId;
    if (action === 'set-status' && state.statuses[teacherId]) {
        const nextType = ['ACTIVE', 'VP', 'VDX'].includes(button.dataset.status) ? button.dataset.status : 'ACTIVE';
        const attendanceEntry = state.attendance?.entries?.get?.(String(teacherId));
        if (nextType !== 'ACTIVE' && state.canEditAttendance &&
            (state.attendance.loading || state.attendance.error || !attendanceEntry)) {
            UIService.toast('Chưa đối chiếu xong dữ liệu công của nhân sự này. Hãy tải lại dữ liệu công trước khi ghi nhận nghỉ.', 'warning');
            return;
        }
        if (nextType !== 'ACTIVE' && attendanceEntry?.resolution?.status === 'ambiguous') {
            UIService.toast('Có nhiều phiên công cùng khớp ca của nhân sự này. Hãy đối chiếu trong Bảng Công trước khi ghi nhận nghỉ.', 'error');
            return;
        }
        if (nextType !== 'ACTIVE' && attendanceEntryHasWorkedEvidence(attendanceEntry)) {
            UIService.toast(`${attendanceEntry.name} đang có phiên công vào/ra. Hãy xử lý phiên công trong Bảng Công trước khi chuyển sang trạng thái nghỉ.`, 'error');
            return;
        }
        state.statuses[teacherId].type = nextType;
        if (nextType !== 'ACTIVE' && !state.statuses[teacherId].reportedAt) state.statuses[teacherId].reportedAt = new Date().toISOString();
        if (nextType === 'ACTIVE') {
            clearTeacherReplacementMappings(state, teacherId);
        }
        return renderTeacherShiftManager();
    }
    if (action === 'mark-pending') {
        if ((state.statuses?.[teacherId]?.type || 'ACTIVE') === 'ACTIVE') return;
        clearTeacherReplacementMappings(state, teacherId);
        UIService.toast('Đã đánh dấu “Chưa có GV thay”. Bấm Lưu điều phối ca để xác nhận.', 'info');
        return renderTeacherShiftManager();
    }
    if (action === 'pick-replacement') {
        if ((state.statuses?.[teacherId]?.type || 'ACTIVE') === 'ACTIVE') return;
        state.replacementTargetId = teacherId;
        state.activeTab = 'substitute';
        state.search.substitute = '';
        return renderTeacherShiftManager();
    }
    if (action === 'cancel-replacement-target') {
        state.replacementTargetId = '';
        return renderTeacherShiftManager();
    }
    if (action === 'assign-replacement') {
        const mainId = String(button.dataset.mainId || '');
        const substituteId = String(button.dataset.substituteId || '');
        const main = state.teacherById.get(mainId);
        const substitute = state.teacherById.get(substituteId);
        if (!assignTeacherReplacement(state, substituteId, mainId)) {
            UIService.toast('Không thể chọn GV thay cho trạng thái ca hiện tại. Hãy tải lại ca và thử lại.', 'error');
            return;
        }
        state.activeTab = 'main';
        UIService.toast(`Đã chọn ${substitute?.name || 'giáo viên này'} dạy thay cho ${main?.name || 'GV chính'}. Bấm Lưu điều phối ca để xác nhận.`, 'info');
        return renderTeacherShiftManager();
    }
    if (action === 'toggle-fixed' && state.mainMeta[teacherId]) {
        state.mainMeta[teacherId].pendingFixed = !state.mainMeta[teacherId].pendingFixed;
        return renderTeacherShiftManager();
    }
    if (action === 'toggle-map') {
        const sub = state.substituteById.get(button.dataset.substituteId);
        const mainId = button.dataset.mainId;
        if (!sub || !mainId) return;
        const ids = new Set(sub.replacesTeacherIds || []);
        if (ids.has(mainId)) ids.delete(mainId); else ids.add(mainId);
        sub.replacesTeacherIds = Array.from(ids);
        return renderTeacherShiftManager();
    }
}

function handleTeacherShiftManagerChange(event) {
    const input = event.target;
    const state = teacherShiftManagerState;
    if (!state || !input?.dataset?.action) return;
    if (isAttendanceSaveInFlight(state)) return;
    const id = input.dataset.teacherId;
    if (state.canEditAttendance && input.dataset.action.startsWith('attendance-')) {
        const entry = selectedAttendanceAdminEntry();
        if (!entry) return;
        if (input.dataset.action === 'attendance-check-in') entry.draft.checkIn = input.value;
        if (input.dataset.action === 'attendance-check-out') entry.draft.checkOut = input.value;
        if (input.dataset.action === 'attendance-student-count') {
            entry.draft.studentCount = input.value === '' ? null : Number(input.value);
            entry.draft.studentCountDirty = true;
            entry.studentCountDirty = true;
        }
        if (input.dataset.action === 'attendance-bonus10') {
            entry.draft.bonus10 = input.checked === true;
            entry.bonus10Dirty = true;
        }
        return renderTeacherShiftManager();
    }
    if (input.dataset.action === 'toggle-main') {
        if (state.isPast) return;
        if (input.checked) {
            if (!state.mainIds.includes(id)) state.mainIds.push(id);
            state.mainMeta[id] = state.mainMeta[id] || {};
            state.statuses[id] = state.statuses[id] || { type: 'ACTIVE', reason: '', reportedAt: new Date().toISOString() };
            if (state.substituteIds.includes(id)) {
                state.substituteIds = state.substituteIds.filter(value => value !== id);
                state.substituteById.delete(id);
            }
        } else {
            if (state.mainIds.length === 1) {
                input.checked = true;
                UIService.toast('Ca dạy phải còn ít nhất một GV chính.', 'warning');
                return;
            }
            state.mainIds = state.mainIds.filter(value => value !== id);
            delete state.mainMeta[id];
            delete state.statuses[id];
            if (String(state.replacementTargetId || '') === String(id)) state.replacementTargetId = '';
            state.substituteById.forEach(item => {
                item.replacesTeacherIds = (item.replacesTeacherIds || []).filter(value => value !== id);
            });
        }
        return renderTeacherShiftManager();
    }
    if (input.dataset.action === 'toggle-substitute') {
        if (input.checked) {
            if (!state.substituteIds.includes(id)) state.substituteIds.push(id);
            const absentIds = teacherManagerAbsentMainEntries().map(item => item.id);
            state.substituteById.set(id, {
                id,
                name: state.teacherById.get(id)?.name || '',
                replacesTeacherIds: absentIds.length === 1 ? absentIds : []
            });
        } else {
            state.substituteIds = state.substituteIds.filter(value => value !== id);
            state.substituteById.delete(id);
        }
        return renderTeacherShiftManager();
    }
    if (input.dataset.action === 'absence-reason' && state.statuses[id]) {
        state.statuses[id].reason = input.value.slice(0, 300);
    }
    if (input.dataset.action === 'reported-at' && state.statuses[id]) {
        const date = new Date(input.value);
        if (!Number.isNaN(date.getTime())) state.statuses[id].reportedAt = date.toISOString();
    }
}

function handleTeacherShiftManagerInput(event) {
    const input = event.target;
    if (!teacherShiftManagerState) return;
    if (isAttendanceSaveInFlight(teacherShiftManagerState)) return;
    if (teacherShiftManagerState.canEditAttendance && input.dataset.action?.startsWith('attendance-')) {
        const entry = selectedAttendanceAdminEntry();
        if (!entry) return;
        if (input.dataset.action === 'attendance-check-in') entry.draft.checkIn = input.value;
        if (input.dataset.action === 'attendance-check-out') entry.draft.checkOut = input.value;
        if (input.dataset.action === 'attendance-student-count') {
            entry.draft.studentCount = input.value === '' ? null : Number(input.value);
            entry.draft.studentCountDirty = true;
            entry.studentCountDirty = true;
        }
        return;
    }
    if (input.dataset.action === 'absence-reason') {
        const status = teacherShiftManagerState.statuses[input.dataset.teacherId];
        if (status) status.reason = input.value.slice(0, 300);
        return;
    }
    if (input.dataset.action !== 'roster-search') return;
    const kind = input.dataset.kind === 'substitute' ? 'substitute' : 'main';
    teacherShiftManagerState.search[kind] = input.value;
    applyTeacherRosterFilter(kind);
}

function trapTeacherManagerFocus(event) {
    if (event.target?.matches?.('.attendance-person-tab[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        const tabs = Array.from(event.currentTarget.querySelectorAll('.attendance-person-tab[role="tab"]:not([disabled])'));
        const currentIndex = tabs.indexOf(event.target);
        if (currentIndex >= 0 && tabs.length > 0) {
            event.preventDefault();
            let nextIndex = currentIndex;
            if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
            if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = tabs.length - 1;
            const nextTeacherId = String(tabs[nextIndex].dataset.teacherId || '');
            if (teacherShiftManagerState?.attendance?.entries?.has(nextTeacherId)) {
                teacherShiftManagerState.attendance.selectedId = nextTeacherId;
                renderTeacherShiftManager();
                const nextTab = Array.from(event.currentTarget.querySelectorAll('.attendance-person-tab[role="tab"]'))
                    .find(tab => String(tab.dataset.teacherId || '') === nextTeacherId);
                nextTab?.focus?.({ preventScroll: true });
            }
        }
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        closeTeacherShiftManager();
        return;
    }
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget.querySelector('.teacher-shift-dialog');
    const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
        .filter(element => !element.hidden && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

window.openGVPicker = async function (compositeKey, caType, index, fieldType, triggerEl) {
    if (isAttendanceSaveInFlight()) {
        UIService.toast('Đang lưu công. Vui lòng chờ hoàn tất trước khi mở ca khác.', 'warning');
        return;
    }
    if (closeTeacherShiftManager() === false) return;
    const pickerGeneration = teacherPickerGeneration;
    try {
        const [dayData, strictAuthorizationResult] = await Promise.all([
            DBService.getSchedule(compositeKey),
            DBService.getAuthenticatedAuthorizationContext(true)
                .then(value => ({ value, error: null }))
                .catch(error => ({ value: { roles: [] }, error }))
        ]);
        if (pickerGeneration !== teacherPickerGeneration) return;
        const row = dayData?.[caType]?.[index];
        if (!row) throw new Error('Ca dạy không còn tồn tại. Hãy tải lại lịch.');
        if (!String(row.lop || '').trim()) {
            throw new Error('Vui lòng chọn Môn / Lớp trước khi điều phối giáo viên để hệ thống tính lương đúng.');
        }
        if (!window.TeacherShiftState) throw new Error('Không tải được mô-đun trạng thái ca dạy. Vui lòng tải lại trang.');

        const teachers = (window._teacherList || []).filter(teacher => {
            const roles = Array.isArray(teacher.roles) ? teacher.roles : [teacher.role || ''];
            return teacher.id && hasTeachingEmploymentRole(roles);
        }).map(teacher => ({ ...teacher, name: teacher.name || teacher.username || 'Chưa đặt tên' }));
        const teacherById = new Map(teachers.map(teacher => [String(teacher.id), teacher]));
        const mains = TeacherShiftState.getMainTeachers(row).filter(item => item.id);
        const substitutes = TeacherShiftState.getSubstituteTeachers(row).filter(item => item.id);
        mains.forEach(item => {
            if (!teacherById.has(item.id)) {
                const legacy = { id: item.id, name: item.name || 'GV không còn hoạt động', roles: ['teacher'] };
                teachers.push(legacy);
                teacherById.set(item.id, legacy);
            }
        });
        substitutes.forEach(item => {
            if (!teacherById.has(item.id)) {
                const legacy = { id: item.id, name: item.name || 'GV không còn hoạt động', roles: ['teacher'] };
                teachers.push(legacy);
                teacherById.set(item.id, legacy);
            }
        });

        const statuses = {};
        const mainMeta = {};
        mains.forEach(main => {
            const record = TeacherShiftState.getAbsenceRecord(row, main.id);
            const isUnambiguousLegacyAbsence = !Array.isArray(row.teacherAbsences) && mains.length === 1 && substitutes.length > 0;
            statuses[main.id] = {
                type: record
                    ? TeacherShiftState.normalizeAbsenceType(record.type)
                    : (isUnambiguousLegacyAbsence
                        ? (classifyAbsenceByLeadTime(
                            compositeKey.includes('__') ? compositeKey.split('__').slice(1).join('__') : compositeKey,
                            row.start,
                            row.gvThayTheAt
                        )?.type || 'VDX')
                        : 'ACTIVE'),
                reason: record?.reason || '',
                reportedAt: record?.reportedAt || new Date().toISOString()
            };
            mainMeta[main.id] = { pendingFixed: !!main.pendingFixed };
        });
        const absentIds = mains.filter(main => statuses[main.id].type !== 'ACTIVE').map(main => main.id);
        const substituteById = new Map(substitutes.map(sub => {
            let replacesTeacherIds = Array.isArray(sub.replacesTeacherIds) ? sub.replacesTeacherIds.slice() : [];
            if (!replacesTeacherIds.length) {
                replacesTeacherIds = absentIds.filter(mainId => TeacherShiftState.getReplacementIdsForTeacher(row, mainId).includes(sub.id));
            }
            if (!replacesTeacherIds.length && absentIds.length === 1) replacesTeacherIds = absentIds.slice();
            return [sub.id, { ...sub, replacesTeacherIds }];
        }));

        const strictAuthorization = strictAuthorizationResult.value || { roles: [] };
        const canEditAttendance = Array.isArray(strictAuthorization.roles) && strictAuthorization.roles.includes('admin');
        const likelyPrimaryAdmin = locallyClaimedScheduleRoles().includes('admin');
        const originalMainIds = mains.map(item => String(item.id));
        const originalSubstituteIds = substitutes.map(item => String(item.id));
        const attendanceTeacherIds = Array.from(new Set([...originalMainIds, ...originalSubstituteIds]));
        const dateKey = compositeKey.includes('__') ? compositeKey.split('__').slice(1).join('__') : compositeKey;
        const shiftWindow = window.ScheduleAttendanceAdmin?.buildShiftWindow(dateKey, row.start, row.end);
        if (canEditAttendance && !shiftWindow) throw new Error('Khung giờ ca dạy không hợp lệ nên không thể mở trình chỉnh công.');

        if (pickerGeneration !== teacherPickerGeneration) return;
        teacherShiftManagerState = {
            compositeKey,
            caType,
            index,
            dayData: JSON.parse(JSON.stringify(dayData)),
            originalRow: JSON.parse(JSON.stringify(row)),
            shiftId: stableScheduleShiftLocatorId(compositeKey, caType, row, index),
            expectedStaffingUpdatedAt: row.staffingUpdatedAt || '',
            signature: scheduleRowSignature(row),
            isPast: isScheduleTimePast(compositeKey, row.start),
            attendanceShiftClosed: row.isClosed === true || isCenterClosed(dateKey, caType, window.centerClosures),
            dateKey,
            shiftWindow,
            subjectId: String(
                row.lopId ||
                (window.Early10?.resolveScheduleSubjectIdByName
                    ? window.Early10.resolveScheduleSubjectIdByName(row.lop, window._subjectList || [])
                    : '') ||
                (window._subjectList || []).find(subject => subject.name === row.lop)?.id || ''
            ),
            subjectResolutionError: '',
            triggerEl: triggerEl || document.activeElement,
            teachers,
            teacherById,
            mainIds: mains.map(item => item.id),
            mainMeta,
            statuses,
            substituteIds: substitutes.map(item => item.id),
            substituteById,
            originalMainIds,
            originalSubstituteIds,
            activeTab: fieldType === 'gvThayTe' ? 'substitute' : 'main',
            replacementTargetId: '',
            search: { main: '', substitute: '' },
            strictAuthorization,
            canEditAttendance,
            canTransfer: Array.isArray(strictAuthorization.roles) && strictAuthorization.roles.some(role =>
                ['admin', 'senior_assistant', 'assistant'].includes(role)
            ),
            likelyPrimaryAdmin,
            attendanceAuthorizationError: strictAuthorizationResult.error || null,
            attendanceAuthorizationRetrying: false,
            attendanceContext: null,
            attendance: {
                teacherIds: attendanceTeacherIds,
                selectedId: attendanceTeacherIds[0] || '',
                entries: new Map(),
                loading: canEditAttendance,
                error: '',
                savingId: ''
            },
            saving: false
        };

        const branchLabel = ({ cs1: 'Cơ sở 1', cs2: 'Cơ sở 2', cs3: 'Cơ sở 3' })[compositeKey.split('__')[0]] || 'Cơ sở 1';
        const overlay = document.createElement('div');
        overlay.id = 'gv-picker-overlay';
        overlay.className = 'teacher-shift-overlay';
        overlay.innerHTML = `<div class="teacher-shift-dialog" role="dialog" aria-modal="true" aria-labelledby="teacher-shift-manager-title">
            <header class="teacher-shift-header">
                <div class="teacher-shift-title-wrap">
                    <span class="teacher-shift-kicker">Bảng điều khiển ca dạy</span>
                    <h3 id="teacher-shift-manager-title">${scheduleEscapeHTML(row.lop || 'Ca dạy')}</h3>
                    <div class="teacher-shift-context">
                        <span>${scheduleEscapeHTML(branchLabel)}</span><span>${scheduleEscapeHTML(dateKey)}</span><span>${scheduleEscapeHTML(`${row.start || '--:--'}–${row.end || '--:--'}`)}</span><span>Phòng ${scheduleEscapeHTML(row.phong || '—')}</span>
                    </div>
                </div>
                <button type="button" class="teacher-shift-close" data-action="close-manager" aria-label="Đóng bảng điều phối">×</button>
            </header>
            ${teacherShiftManagerState.isPast ? '<div class="teacher-shift-alert"><strong>Ca đã bắt đầu hoặc đã qua.</strong> Bạn vẫn có thể ghi nhận Vắng đột xuất, khôi phục trạng thái và điều phối GV thay; danh sách GV chính được khóa để bảo toàn lịch sử.</div>' : ''}
            <div id="teacher-shift-manager-body" class="teacher-shift-body"></div>
            <footer class="teacher-shift-footer">
                <div><span class="save-state-dot" aria-hidden="true"></span><strong id="teacher-shift-manager-summary"></strong><small>Mọi thay đổi trạng thái đều được lưu lịch sử.</small></div>
                <div class="teacher-shift-footer-actions">
                    ${teacherShiftManagerState.canTransfer && !teacherShiftManagerState.isPast
                        ? '<button type="button" class="btn-manager-cancel" data-action="open-transfer">↔ Đổi lớp / Chuyển GV</button>'
                        : ''}
                    <button type="button" class="btn-manager-cancel" data-action="close-manager">Hủy</button>
                    <button type="button" class="btn-manager-save" data-action="save-manager"><span>✓</span> Lưu điều phối ca</button>
                </div>
            </footer>
        </div>`;
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeTeacherShiftManager();
            else handleTeacherShiftManagerClick(event);
        });
        overlay.addEventListener('change', handleTeacherShiftManagerChange);
        overlay.addEventListener('input', handleTeacherShiftManagerInput);
        overlay.addEventListener('keydown', trapTeacherManagerFocus);
        if (pickerGeneration !== teacherPickerGeneration) return;
        document.getElementById('gv-picker-overlay')?.remove();
        document.body.appendChild(overlay);
        document.body.classList.add('teacher-shift-modal-open');
        renderTeacherShiftManager();
        if (teacherShiftManagerState.canEditAttendance) loadAdminAttendanceEditor(teacherShiftManagerState);
        requestAnimationFrame(() => overlay.querySelector('[data-action="close-manager"]')?.focus());
    } catch (error) {
        if (pickerGeneration !== teacherPickerGeneration) return;
        console.error('Không mở được bảng điều phối ca:', error);
        if (window.UIService?.toast) UIService.toast(error.message || 'Không mở được ca dạy.', 'error');
        else alert(error.message || error);
    }
};

window.saveTeacherShiftCommand = async function () {
    const state = teacherShiftManagerState;
    if (!state) return;
    if (isAttendanceSaveInFlight(state)) {
        UIService.toast('Đang lưu công nguyên tử. Hãy chờ hoàn tất trước khi lưu điều phối ca.', 'warning');
        return;
    }
    if (state.saving) return;
    const newlyAbsentId = (state.mainIds || []).find(id =>
        (state.statuses?.[id]?.type || 'ACTIVE') !== 'ACTIVE' &&
        !isRowMainTeacherAbsent(state.originalRow, id)
    );
    if (state.canEditAttendance && newlyAbsentId &&
        (state.attendance.loading || state.attendance.error || !state.attendance.entries.has(String(newlyAbsentId)))) {
        UIService.toast('Chưa đối chiếu được dữ liệu công của GV sắp chuyển sang nghỉ. Hãy tải dữ liệu công rồi thử lại.', 'error');
        return;
    }
    const attendanceConflict = attendanceAbsenceConflict(state);
    if (attendanceConflict) {
        const conflictMessage = attendanceConflict.resolution?.status === 'ambiguous'
            ? `${attendanceConflict.name} có nhiều phiên công cùng khớp ca. Hãy đối chiếu trong Bảng Công trước khi lưu trạng thái nghỉ.`
            : `${attendanceConflict.name} đang có phiên công vào/ra nhưng lại được đặt trạng thái nghỉ. Hãy xử lý phiên công hoặc khôi phục “Đang dạy” trước khi lưu.`;
        UIService.toast(conflictMessage, 'error');
        return;
    }
    const saveButton = document.querySelector('[data-action="save-manager"]');
    state.saving = true;
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.innerHTML = '<span class="manager-spinner"></span> Đang lưu...';
    }
    try {
        const mains = state.mainIds.map(id => ({
            id,
            name: state.teacherById.get(id)?.name || '',
            ...(state.mainMeta[id]?.pendingFixed ? { pendingFixed: true } : {})
        }));
        const substitutes = state.substituteIds.map(id => {
            const item = state.substituteById.get(id);
            return {
                id,
                name: item?.name || state.teacherById.get(id)?.name || '',
                replacesTeacherIds: Array.from(new Set(item?.replacesTeacherIds || []))
            };
        });
        const statuses = Object.fromEntries(state.mainIds.map(id => [id, { ...state.statuses[id] }]));
        const guardedAbsenceStaffIds = state.mainIds.filter(id =>
            ['VP', 'VDX'].includes(String(statuses[id]?.type || '').toUpperCase())
        );
        const actor = {
            id: localStorage.getItem('currentUserId') || '',
            name: localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || ''
        };
        const command = { shiftId: state.shiftId, mains, substitutes, statuses };
        const nowISO = new Date().toISOString();
        await DBService.updateScheduleRowAtomic(
            state.compositeKey,
            state.caType,
            {
                index: state.index,
                shiftId: state.originalRow.shiftId || '',
                signature: state.signature,
                expectedStaffingUpdatedAt: state.expectedStaffingUpdatedAt,
                ...(guardedAbsenceStaffIds.length ? {
                    attendanceAbsenceGuard: {
                        staffIds: guardedAbsenceStaffIds,
                        dateKey: state.dateKey,
                        compositeKey: state.compositeKey,
                        section: state.caType,
                        start: state.originalRow.start,
                        end: state.originalRow.end,
                        persistedShiftId: state.originalRow.shiftId || '',
                        resolverShiftId: state.shiftId || '',
                        signature: state.signature
                    }
                } : {})
            },
            latestRow => {
                const expected = String(state.expectedStaffingUpdatedAt || '');
                const actual = String(latestRow.staffingUpdatedAt || '');
                if (expected !== actual) {
                    const conflict = new Error('Một người xếp lịch khác vừa cập nhật ca này. Hãy tải lại dữ liệu trước khi lưu tiếp.');
                    conflict.code = 'schedule/staffing-conflict';
                    throw conflict;
                }
                return TeacherShiftState.applyStaffingCommand(latestRow, command, actor, nowISO);
            },
            state.dayData
        );
        closeTeacherShiftManager();
        UIService.toast('Đã lưu điều phối ca và đồng bộ trạng thái GV.', 'success');
        await renderTable();
    } catch (error) {
        console.error('Lỗi lưu điều phối ca:', error);
        state.saving = false;
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.innerHTML = '<span>✓</span> Lưu điều phối ca';
        }
        UIService.toast(error.message || 'Không thể lưu điều phối ca.', 'error');
    }
};

// Compatibility aliases for old inline calls and cached HTML during a rolling deploy.
window.saveGVPickerResult = window.saveTeacherShiftCommand;
window.filterGVPicker = function (query) {
    if (!teacherShiftManagerState) return;
    teacherShiftManagerState.search[teacherShiftManagerState.activeTab] = query || '';
    applyTeacherRosterFilter(teacherShiftManagerState.activeTab);
};
window.toggleCBCDBadge = function () {};

window.showGVPopup = function (triggerEl, encodedList) {
    const existing = document.getElementById('gv-popup');
    if (existing) { existing.remove(); return; }
    let gvList;
    try { gvList = JSON.parse(decodeURIComponent(encodedList)); } catch { return; }
    if (!gvList || gvList.length === 0) return;
    const popup = document.createElement('div');
    popup.id = 'gv-popup';
    popup.style.cssText = 'position:fixed;background:white;border:1px solid #E5E7EB;border-radius:10px;padding:0.5rem 0.75rem;box-shadow:0 8px 24px rgba(0,0,0,0.15);z-index:9998;min-width:140px;';
    gvList.forEach(g => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:0.3rem 0;font-size:0.85rem;border-bottom:1px solid #F3F4F6;';
        item.appendChild(document.createTextNode(String(g?.name || '')));
        if (g?.pendingFixed) {
            const badge = document.createElement('span');
            badge.style.cssText = 'margin-left:4px;background:#FFEDD5;color:#9A3412;border-radius:99px;padding:1px 6px;font-size:0.62rem;font-weight:700;white-space:nowrap;';
            badge.textContent = '⏳ CĐ tuần sau';
            item.appendChild(badge);
        }
        popup.appendChild(item);
    });
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
                của tuần đang xem sang. Các ngày đích đã có lịch sẽ được giữ nguyên.
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
    const sourceWeekStart = new Date(currentWeekStart);
    const sourceBranch = currentBranch;

    const btn = document.querySelector('#copy-week-modal .btn-primary');
    if (btn) { btn.disabled = true; btn.innerText = 'Đang sao chép...'; }

    try {
        let copied = 0;
        let skippedPastDays = 0;
        let skippedExistingDays = 0;
        for (let i = 0; i < 7; i++) {
            // Source day
            const srcDate = new Date(sourceWeekStart);
            srcDate.setDate(srcDate.getDate() + i);
            const srcKey = getLocalDateKey(srcDate);
            const srcComposite = `${sourceBranch}__${srcKey}`;

            // Target day
            const [ty, tm, td] = targetMondayKey.split('-').map(Number);
            const tgtDate = new Date(ty, tm - 1, td + i);
            const tgtKey = getLocalDateKey(tgtDate);
            const tgtComposite = `${sourceBranch}__${tgtKey}`;

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
                                gvThayTe, gvThayTeId, gvThayTeList,
                                gvThayTheAt, teacherAbsences, teacherAbsenceHistory,
                                staffingUpdatedAt, staffingUpdatedById, staffingUpdatedByName,
                                shiftId, ...rest } = row;
                            return {
                                ...rest,
                                shiftId: window.TeacherShiftState ? TeacherShiftState.stableShiftId({}) : `shift_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                                staffingSchemaVersion: 2,
                                gvThayThe: '', gvThayTheId: '', gvThayTheList: [],
                                gvThayTe: '', gvThayTeId: '', gvThayTeList: [],
                                teacherAbsences: [], teacherAbsenceHistory: []
                            };
                        });
                    }
                });
                const created = await DBService.createScheduleIfMissing(tgtComposite, cleanData);
                if (created) copied++;
                else skippedExistingDays++;
            }
        }
        document.getElementById('copy-week-modal').remove();
        if (skippedPastDays > 0 || skippedExistingDays > 0) {
            alert(`Đã sao chép ${copied} ngày. Giữ nguyên ${skippedExistingDays} ngày đã có lịch và bỏ qua ${skippedPastDays} ngày trong quá khứ.`);
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

// ===== KHÔNG ĐÁNH VẮNG NGƯỜI ĐANG ĐI LÀM (quy tắc Giám đốc: một giờ một lớp) =====
// Ca có GV thay thế KHÔNG đồng nghĩa GV chính nghỉ. Kiểu hay gặp nhất là ĐỔI LỚP: lớp của
// thầy A được người khác dạy vì cùng khung giờ đó thầy A được mượn sang dạy lớp khác.
// Trước đây hệ thống cứ thấy có người dạy thay là ghi "Vắng đột xuất" vào ghi chú ngày —
// mà ghi chú ngày chính là nguồn phân loại vắng phép/đột xuất khi tính lương.

function _hmToMinutes(t) {
    const p = String(t || '').split(':');
    const h = Number(p[0]), m = Number(p[1]);
    return (isNaN(h) || isNaN(m)) ? null : h * 60 + m;
}

function _windowsOverlap(aStart, aEnd, bStart, bEnd) {
    const a1 = _hmToMinutes(aStart), a2 = _hmToMinutes(aEnd);
    const b1 = _hmToMinutes(bStart), b2 = _hmToMinutes(bEnd);
    if ([a1, a2, b1, b2].some(v => v === null)) return false;
    return a1 < b2 && b1 < a2;
}

// GV này có được xếp DẠY THAY một lớp khác trùng khung giờ không? Biết ngay lúc xếp lịch,
// không cần chờ tới giờ chấm công.
function isTeacherCoveringElsewhere(dayData, teacherId, start, end) {
    if (!dayData || !teacherId) return false;
    const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
    return sections.some(sec => (dayData[sec] || []).some(r => {
        if (!r || !r.start || !r.end) return false;
        if (!_windowsOverlap(start, end, r.start, r.end)) return false;
        return getGVList(r, 'gvThayTe').some(g => g.id === teacherId);
    }));
}

// GV này có chấm công phủ lên khung giờ đó không (đi làm thật)?
async function teacherWorkedDuring(teacherId, dateKey, start, end) {
    const s = _hmToMinutes(start), e = _hmToMinutes(end);
    if (s === null || e === null) return false;
    let rec = null;
    try { rec = await DBService.getPersonalAttendance(dateKey, teacherId); } catch (err) { return false; }
    const sessions = (rec && rec.sessions) || [];
    return sessions.some(x => {
        if (!x || x.isAbsent) return false;
        const ci = x.checkIn || x.start;
        if (!ci) return false;
        const inD = new Date(ci);
        const outD = x.checkOut ? new Date(x.checkOut) : null;
        if (isNaN(inD.getTime())) return false;
        const inMin = inD.getHours() * 60 + inD.getMinutes();
        const outMin = outD && !isNaN(outD.getTime()) ? outD.getHours() * 60 + outD.getMinutes() : inMin;
        return Math.min(e, outMin) - Math.max(s, inMin) >= 10; // phủ >= 10 phút
    });
}

// Ghi đánh dấu vắng cho GV chính của ca vừa được xếp GV thay thế.
// Chỉ ghi khi ghi chú ngày còn trống → không bao giờ đè lên đánh dấu/ghi chú đã có.
async function autoMarkAbsenceForMainTeachers(row, info, dayData) {
    const verdict = classifyAbsenceByLeadTime(info.dateKey, info.start, info.markedAt);
    if (!verdict) return [];
    const canonical = verdict.type === 'VP' ? 'Vắng phép' : 'Vắng đột xuất';
    const subIds = new Set(getGVList(row, 'gvThayTe').map(g => g.id).filter(Boolean));
    const replacements = getGVList(row, 'gvThayTe');
    const marked = [];
    if (!Array.isArray(row.teacherAbsences)) row.teacherAbsences = [];

    for (const g of getGVList(row, 'gv')) {
        if (!g.id) continue;
        if (subIds.has(g.id)) continue; // vừa là GV chính vừa là người dạy thay → không vắng
        // Đổi lớp: cùng giờ đó GV đang dạy thay lớp khác → đi làm, không phải vắng.
        if (isTeacherCoveringElsewhere(dayData, g.id, info.start, row.end)) continue;
        // Đã có chấm công phủ lên khung giờ đó → đi làm, không phải vắng.
        if (await teacherWorkedDuring(g.id, info.dateKey, info.start, row.end)) continue;
        try {
            const existingIndex = row.teacherAbsences.findIndex(item =>
                String(item?.teacherId || item?.id || '') === String(g.id)
            );
            const existing = existingIndex >= 0 ? row.teacherAbsences[existingIndex] : null;
            const record = {
                ...(existing || {}),
                teacherId: g.id,
                teacherName: g.name,
                type: existing?.type || verdict.type,
                status: 'covered',
                reportedAt: existing?.reportedAt || info.markedAt,
                replacementIds: replacements.map(item => item.id).filter(Boolean),
                replacementNames: replacements.map(item => item.name).filter(Boolean),
                updatedAt: new Date().toISOString()
            };
            if (existingIndex >= 0) row.teacherAbsences[existingIndex] = record;
            else row.teacherAbsences.push(record);

            const notes = { ...(await DBService.getDailyNotes(g.id) || {}) };
            if (!(notes[info.dateKey] || '').trim()) {
                notes[info.dateKey] = existing?.type === 'VP' ? 'Vắng phép' :
                    (existing?.type === 'VDX' ? 'Vắng đột xuất' : canonical);
                await DBService.saveDailyNotes(g.id, notes);
            }
            marked.push({ id: g.id, name: g.name, type: record.type });
        } catch (e) {
            console.warn('Không tự đánh dấu vắng được cho', g.name, e);
        }
    }
    return marked;
}

function absenceStatusBadge(status, noteText) {
    if (status === 'VDX') return `<span style="background:#FFEDD5;color:#9A3412;border-radius:99px;padding:3px 10px;font-size:0.72rem;font-weight:700;">Vắng đột xuất</span>`;
    if (status === 'VP') return `<span style="background:#D1FAE5;color:#065F46;border-radius:99px;padding:3px 10px;font-size:0.72rem;font-weight:700;">Vắng phép</span>`;
    if (noteText) return `<span title="${scheduleEscapeAttr(noteText)}" style="background:#F3F4F6;color:#6B7280;border-radius:99px;padding:3px 10px;font-size:0.72rem;font-weight:600;">Có ghi chú khác</span>`;
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
      <div style="color:rgba(255,255,255,0.9);font-size:0.75rem;margin-top:2px;">Ghi nhận nghỉ theo từng ca · có thể lưu “chưa tìm được người thay” · báo trước ≥ 24h = Vắng phép</div>
    </div>
    <button onclick="document.getElementById('gv-absence-overlay').remove()" style="background:rgba(255,255,255,0.22);border:none;color:white;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:1.2rem;flex-shrink:0;">✕</button>
  </div>
  <div id="gv-absence-list" style="padding:0.9rem 1.1rem;overflow-y:auto;flex:1;">
    <div style="text-align:center;color:#9CA3AF;padding:2rem;">Đang tải danh sách GV của ngày...</div>
  </div>
  <div style="padding:0.75rem 1.1rem;border-top:1px solid #E5E7EB;font-size:0.75rem;color:#6B7280;line-height:1.6;">
    Trạng thái nghỉ được quản lý <b>theo từng ca và từng giáo viên</b>. Mở một ca để chọn Vắng có phép, Vắng đột xuất, người dạy thay hoặc khôi phục đi dạy.
  </div>
</div>`;
    document.body.appendChild(overlay);

    // Gom GV được xếp trong ngày (GV chính + GV thay thế, mọi ca) — chỉ cơ sở đang xem
    const dayData = await DBService.getSchedule(compositeKey) || {};
    const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
    const seen = new Map(); // id -> { id, name, classes, scheduledShifts, absentShifts }
    sections.forEach(sec => {
        (dayData[sec] || []).forEach((row, rowIndex) => {
            const mains = getGVList(row, 'gv');
            const subs = getGVList(row, 'gvThayTe');
            const subIds = new Set(subs.map(g => g.id).filter(Boolean));

            [...mains, ...subs].forEach(g => {
                if (!g.id) return; // không có ID thì không ghi note được — bỏ qua
                if (!seen.has(g.id)) seen.set(g.id, { id: g.id, name: g.name, classes: [], scheduledShifts: [], absentShifts: [] });
                if (row.lop && !seen.get(g.id).classes.includes(row.lop)) seen.get(g.id).classes.push(row.lop);
            });

            mains.forEach(g => {
                if (!g.id || subIds.has(g.id)) return;
                const explicit = getRowTeacherAbsence(row, g.id);
                const legacyImplicit = !Array.isArray(row.teacherAbsences) && subs.length > 0;
                const absence = explicit || (legacyImplicit ? {
                    teacherId: g.id,
                    teacherName: g.name,
                    type: classifyAbsenceByLeadTime(dateKey, row.start, row.gvThayTheAt)?.type || 'VDX',
                    status: 'covered',
                    reportedAt: row.gvThayTheAt || ''
                } : null);
                const shiftInfo = {
                    compositeKey,
                    section: sec,
                    index: rowIndex,
                    start: row.start || '',
                    end: row.end || '',
                    lop: row.lop || '',
                    subNames: subs.map(s => s.name).filter(Boolean).join(', '),
                    absence,
                    verdict: absence
                        ? { type: absence.type || 'VDX', leadMinutes: classifyAbsenceByLeadTime(dateKey, row.start, absence.reportedAt || row.gvThayTheAt)?.leadMinutes }
                        : null
                };
                seen.get(g.id).scheduledShifts.push(shiftInfo);
                if (absence) seen.get(g.id).absentShifts.push(shiftInfo);
            });
        });
    });

    const listEl = document.getElementById('gv-absence-list');
    if (!listEl) return;
    if (seen.size === 0) {
        listEl.innerHTML = '<div style="text-align:center;color:#9CA3AF;padding:2rem;">Ngày này chưa xếp GV nào (cơ sở đang xem).</div>';
        return;
    }

    // Modal danh sách chỉ đọc/điều hướng. Việc mở modal tuyệt đối không được tự ghi
    // daily_notes hoặc thay đổi lương; nguồn sự thật là teacherAbsences theo từng ca.
    const teachers = Array.from(seen.values());
    const rows = await Promise.all(teachers.map(async t => {
        let noteText = '';
        try {
            const notes = await DBService.getDailyNotes(t.id);
            noteText = (notes && notes[dateKey]) || '';
        } catch (e) { console.warn('Không đọc được ghi chú của', t.name, e); }

        // Bỏ khỏi danh sách nghi vắng những ca mà GV thực tế ĐANG LÀM VIỆC: cùng giờ đó
        // đang dạy thay lớp khác (đổi lớp), hoặc đã có chấm công phủ lên khung giờ.
        const stillAbsent = [];
        for (const s of (t.absentShifts || [])) {
            if (isTeacherCoveringElsewhere(dayData, t.id, s.start, s.end)) continue;
            if (await teacherWorkedDuring(t.id, dateKey, s.start, s.end)) continue;
            stillAbsent.push(s);
        }
        t.absentShifts = stillAbsent;

        const suggestion = pickAbsenceSuggestion(t.absentShifts);
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

function renderTeacherShiftAbsenceActions(t, dateKey) {
    const shifts = Array.isArray(t.scheduledShifts) ? t.scheduledShifts : [];
    if (shifts.length === 0) return '';

    return '<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">' + shifts.map(s => {
        const label = [s.lop || 'Ca dạy', s.start && s.end ? `${s.start}–${s.end}` : ''].filter(Boolean).join(' ');
        const absence = s.absence || null;
        const replacementNames = Array.isArray(absence?.replacementNames)
            ? absence.replacementNames.filter(Boolean)
            : [];
        const covered = !!absence && replacementNames.length > 0;
        const status = absence
            ? (covered
                ? `<span style="color:#065F46;font-weight:700;">${absence.type === 'VP' ? 'Vắng có phép' : 'Vắng đột xuất'} · GV thay: ${scheduleEscapeHTML(replacementNames.join(', '))}</span>`
                : `<span style="color:#9A3412;font-weight:700;">${absence.type === 'VP' ? 'Vắng có phép' : 'Vắng đột xuất'} · Đang tìm GV thay</span>`)
            : '<span style="color:#6B7280;">Đang đi dạy</span>';

        return `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:9px;padding:7px 8px;">
            <div style="font-size:0.74rem;color:#374151;font-weight:600;">${scheduleEscapeHTML(label)}</div>
            <div style="font-size:0.7rem;margin-top:2px;">${status}</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;">
                <button onclick="document.getElementById('gv-absence-overlay')?.remove();openGVPicker('${scheduleEscapeAttr(s.compositeKey)}','${scheduleEscapeAttr(s.section)}',${s.index},'gv',this)" style="padding:6px 10px;border-radius:8px;border:1px solid #6EE7B7;background:#ECFDF5;color:#047857;font-size:0.7rem;font-weight:700;cursor:pointer;">Mở bảng điều phối ca</button>
            </div>
        </div>`;
    }).join('') + '</div>';
}

window.openReplacementPickerFromAbsence = function (compositeKey, section, index) {
    document.getElementById('gv-absence-overlay')?.remove();
    openGVPicker(compositeKey, section, index, 'gvThayTe');
};

function renderGVAbsenceRow(t, dateKey) {
    const cls = t.classes.length ? `<div style="font-size:0.72rem;color:#9CA3AF;margin-top:2px;">${scheduleEscapeHTML(t.classes.join(', '))}</div>` : '';

    const shiftsHtml = renderTeacherShiftAbsenceActions(t, dateKey);

    const shiftsData = encodeURIComponent(JSON.stringify(t.absentShifts || []));
    const scheduledShiftsData = encodeURIComponent(JSON.stringify(t.scheduledShifts || []));

    return `<div id="gv-abs-row-${scheduleEscapeAttr(t.id)}" data-note="${scheduleEscapeAttr(t.noteText || '')}" data-classes="${scheduleEscapeAttr(t.classes.join(', '))}" data-shifts="${shiftsData}" data-scheduled-shifts="${scheduledShiftsData}"
        style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.7rem 0.4rem;border-bottom:1px solid #F3F4F6;flex-wrap:wrap;">
        <div style="flex:1;min-width:180px;">
            <div style="font-size:0.92rem;font-weight:600;display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">${scheduleEscapeHTML(t.name)} ${absenceStatusBadge(t.status, t.noteText)}</div>
            ${cls}
            ${shiftsHtml}
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
            let scheduledShifts = [];
            try { absentShifts = JSON.parse(decodeURIComponent(rowEl.dataset.shifts || '%5B%5D')); } catch (e) { absentShifts = []; }
            try { scheduledShifts = JSON.parse(decodeURIComponent(rowEl.dataset.scheduledShifts || '%5B%5D')); } catch (e) { scheduledShifts = []; }
            const t = {
                id: teacherId, name: teacherName,
                classes: (rowEl.dataset.classes || '').split(', ').filter(Boolean),
                absentShifts,
                scheduledShifts,
                noteText, status: classifyAbsenceNote(noteText)
            };
            rowEl.outerHTML = renderGVAbsenceRow(t, dateKey);
        }
    } catch (e) {
        console.error('Lỗi lưu đánh dấu vắng:', e);
        alert('Có lỗi khi lưu đánh dấu vắng: ' + (e.message || e));
    }
};

function getScheduleRows(dayData) {
    return ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2']
        .flatMap(section => (dayData?.[section] || []));
}

async function hasRemainingTeacherAbsence(dateKey, teacherId) {
    const schedules = await Promise.all(['cs1', 'cs2', 'cs3'].map(branch =>
        DBService.getSchedule(`${branch}__${dateKey}`).catch(() => ({}))
    ));
    return schedules.some(dayData => getScheduleRows(dayData).some(row => {
        if (!getGVList(row, 'gv').some(g => String(g.id) === String(teacherId))) return false;
        return Array.isArray(row.teacherAbsences)
            ? !!getRowTeacherAbsence(row, teacherId)
            : getGVList(row, 'gvThayTe').length > 0;
    }));
}

async function syncTeacherDailyAbsenceNote(teacherId, dateKey, type, restoring) {
    const notes = { ...(await DBService.getDailyNotes(teacherId) || {}) };
    const current = String(notes[dateKey] || '').trim();
    const currentType = classifyAbsenceNote(current);

    if (!restoring) {
        // Không đè ghi chú tự do. Nếu ngày đã là VĐX thì không hạ xuống VP chỉ
        // vì ca mới được báo sớm hơn.
        if (!current || currentType === 'VP') {
            notes[dateKey] = type === 'VDX' ? 'Vắng đột xuất' : 'Vắng phép';
            await DBService.saveDailyNotes(teacherId, notes);
        }
        return;
    }

    if (currentType && !(await hasRemainingTeacherAbsence(dateKey, teacherId))) {
        delete notes[dateKey];
        await DBService.saveDailyNotes(teacherId, notes);
    }
}

window.setTeacherShiftAbsence = async function (compositeKey, section, index, teacherId, encodedTeacherName, dateKey, action) {
    const teacherName = decodeURIComponent(encodedTeacherName || '');
    const dayData = await DBService.getSchedule(compositeKey);
    const row = dayData?.[section]?.[index];
    if (!row) return;
    if (!getGVList(row, 'gv').some(g => String(g.id) === String(teacherId))) {
        alert('Giáo viên không còn được xếp ở ca này. Hãy tải lại lịch.');
        return;
    }

    const shiftLabel = `${row.lop || 'Ca dạy'} ${row.start || ''}–${row.end || ''}`.trim();
    const existing = getRowTeacherAbsence(row, teacherId);
    if (action === 'PENDING' && isScheduleTimePast(compositeKey, row.start)) {
        alert('Ca đã bắt đầu hoặc đã qua. Chỉ có thể ghi nhận báo nghỉ sớm cho ca chưa diễn ra.');
        return;
    }

    const confirmed = await UIService.confirm(action === 'RESTORE'
        ? `Khôi phục ${shiftLabel} cho ${teacherName}?\n\nNếu ca này chỉ có một người báo nghỉ, GV thay thế đã xếp cũng sẽ được gỡ khỏi ca.`
        : `Ghi nhận ${teacherName} báo nghỉ ${shiftLabel}?\n\nTrạng thái sẽ là “Chưa tìm được người thay” và có thể khôi phục bất cứ lúc nào.`);
    if (!confirmed) return;

    try {
        const nowISO = new Date().toISOString();
        if (!Array.isArray(row.teacherAbsences)) row.teacherAbsences = [];

        if (action === 'RESTORE') {
            row.teacherAbsences = row.teacherAbsences.filter(item =>
                String(item?.teacherId || item?.id || '') !== String(teacherId)
            );
            if (row.teacherAbsences.length === 0) {
                row.gvThayTeList = [];
                row.gvThayTheList = [];
                row.gvThayThe = '';
                row.gvThayTheId = '';
                row.gvThayTe = '';
                row.gvThayTeId = '';
                row.gvThayTheAt = '';
            }
            await DBService.saveSchedule(compositeKey, dayData);
            await syncTeacherDailyAbsenceNote(teacherId, dateKey, existing?.type || 'VP', true);
            UIService.toast(`Đã khôi phục ca cho ${teacherName}.`, 'success');
        } else {
            const verdict = classifyAbsenceByLeadTime(dateKey, row.start, nowISO) || { type: 'VP' };
            row.teacherAbsences.push({
                teacherId,
                teacherName,
                type: verdict.type,
                status: 'pending',
                reportedAt: nowISO,
                reportedById: localStorage.getItem('currentUserId') || '',
                reportedByName: localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || '',
                replacementIds: [],
                replacementNames: [],
                updatedAt: nowISO
            });
            await DBService.saveSchedule(compositeKey, dayData);
            await syncTeacherDailyAbsenceNote(teacherId, dateKey, verdict.type, false);
            UIService.toast(`${teacherName}: đã lưu “Chưa tìm được người thay”.`, 'success');
        }

        await renderTable();
        await openGVAbsenceModal();
    } catch (error) {
        console.error('Lỗi cập nhật nghỉ theo ca:', error);
        alert('Không thể cập nhật trạng thái nghỉ: ' + (error.message || error));
    }
};

// Rolling-deploy compatibility: old cached buttons may still call the former
// quick actions. Route them into the canonical per-shift controller so every
// VP/VĐX/restoration change uses the same transaction, mapping and audit trail.
window.setGVAbsence = async function () {
    if (typeof UIService !== 'undefined') {
        UIService.toast('Trạng thái nghỉ được quản lý theo từng ca dạy.', 'info');
    }
    return openGVAbsenceModal();
};

window.setTeacherShiftAbsence = async function (compositeKey, section, index) {
    document.getElementById('gv-absence-overlay')?.remove();
    return openGVPicker(compositeKey, section, index, 'gv');
};
