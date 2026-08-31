// Operational staff schedule — shared by receptionist and office pages.
// Each page supplies WORK_SCHEDULE_CONTEXT before this file loads. The two
// schedule types deliberately use different collections/settings/cancel keys.

const WORK_SCHEDULE_CONTEXT = Object.freeze((() => {
    const requestedType = window.WORK_SCHEDULE_CONTEXT?.type;
    const isOffice = requestedType === 'office';
    return {
        type: isOffice ? 'office' : 'receptionist',
        label: isOffice ? 'Văn phòng' : 'Tiếp tân',
        labelTitle: isOffice ? 'Văn Phòng' : 'Tiếp Tân',
        roleIds: isOffice
            ? ['office_staff']
            : ['receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff', 'senior_assistant'],
        settingsPrefix: isOffice ? 'officeShifts' : 'receptionistShifts'
    };
})());
const getWorkSchedule = key => WORK_SCHEDULE_CONTEXT.type === 'office'
    ? DBService.getOfficeSchedule(key)
    : DBService.getReceptionistSchedule(key);
const saveWorkSchedule = (key, data, expectedRevision) => WORK_SCHEDULE_CONTEXT.type === 'office'
    ? DBService.saveOfficeSchedule(key, data, expectedRevision)
    : DBService.saveReceptionistSchedule(key, data, expectedRevision);
const getCancelledShiftKey = (branch, monday, shift, day) => {
    const prefix = WORK_SCHEDULE_CONTEXT.type === 'office' ? 'office_' : '';
    return `${prefix}${branch}_${monday}_${shift}_${day}`;
};

// ==================== STATE ====================
let currentBranch = localStorage.getItem('currentBranch') || 'cs1';
let currentWeekStart = getMonday(new Date());
let weekData = {};
let loadedWeekSnapshot = null;
let loadedScheduleRevision = 0;
let receptionistStaff = [];
let allLoadedUsers = []; // Store all users to map shortName retroactively
let shiftConfig = {
    morning: { label: 'SÁNG', start: '07:00', end: '11:30' },
    afternoon: { label: 'CHIỀU', start: '14:00', end: '18:00' },
    evening: { label: 'TỐI', start: '17:30', end: '21:30' }
};
let editingCell = null;
let isInheritedTemplate = false; // True when showing a template from a previous week
let lastModalTrigger = null;
let activeAbsentPopup = null;
let absentPopupTrigger = null;
let absentPopupOutsideHandler = null;
let isSavingWeek = false;
let scheduleLoadGeneration = 0;
window.isFixedShiftMode = false;

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

window.toggleScheduleFixedShiftMode = function() {
    window.isFixedShiftMode = !window.isFixedShiftMode;
    const btn = document.getElementById('btn-mark-fixed');
    if (!btn) return;
    
    if (window.isFixedShiftMode) {
        btn.style.background = '#EF4444'; // Red to cancel
        btn.style.borderColor = '#F87171';
        btn.style.color = 'white';
        btn.innerText = 'Hủy Chọn CĐ';
        if (typeof UIService !== 'undefined') UIService.toast('Chế độ Ca Cố Định: Click vào nhãn tên trên lịch để chọn.', 'info');
    } else {
        btn.style.background = '#E0E7FF';
        btn.style.borderColor = '#C7D2FE';
        btn.style.color = '#4F46E5';
        btn.innerText = '⭐ Đánh dấu Ca Cố Định';
        if (typeof UIService !== 'undefined') UIService.toast('Đã tắt chế độ Ca Cố Định.', 'info');
    }
    renderTable();
};

window.toggleStaffFixedShift = function(event, shift, dayKey, staffId) {
    event.stopPropagation(); // Prevent cell modal from opening
    if (!window.isFixedShiftMode || isPastScheduleDay(dayKey)) return;
    
    if (weekData[shift] && weekData[shift][dayKey]) {
        const staffList = weekData[shift][dayKey];
        const staffObj = staffList.find(s => s.id === staffId);
        if (staffObj) {
            staffObj.isFixedShift = !staffObj.isFixedShift;
            renderTable(); // Re-render locally without fetching DB
        }
    }
};

const isEditor = (() => {
    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    let roles = [];
    try { const p = JSON.parse(roleRaw); roles = Array.isArray(p) ? p : [roleRaw]; }
    catch(e) { roles = [roleRaw]; }
    const editorRoles = WORK_SCHEDULE_CONTEXT.type === 'office'
        ? ['admin', 'assistant', 'senior_assistant']
        : ['admin', 'assistant', 'receptionist_assistant', 'receptionist_lead', 'senior_assistant'];
    return roles.some(r => editorRoles.includes(r));
})();

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];
const SHIFTS = ['morning', 'afternoon', 'evening'];

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
    if (window.waitAuth) {
        await window.waitAuth();
    }
    const saveArea = document.getElementById('save-area');
    if (saveArea) {
        saveArea.classList.toggle('schedule-actions-hidden', !isEditor);
        saveArea.style.display = isEditor ? 'flex' : 'none';
    }

    const cellModal = document.getElementById('cell-modal');
    if (cellModal) {
        cellModal.addEventListener('mousedown', event => {
            if (event.target === cellModal) closeCellModal();
        });
    }
    document.addEventListener('keydown', handleScheduleKeydown);
    window.addEventListener('resize', () => closeAbsentPopup(false));

    updateBranchTabs();

    // Chỉ tải nhân sự thuộc đúng loại lịch; không trộn hai roster.
    try {
        const allUsers = await DBService.getUsers();
        allLoadedUsers = allUsers; // Store globally
        receptionistStaff = allUsers.filter(u => {
            const roles = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : (u.role ? [u.role] : []);
            return roles.some(r => WORK_SCHEDULE_CONTEXT.roleIds.includes(r));
        });
    } catch (e) {
        console.error('Failed to load staff', e);
        receptionistStaff = [];
    }

    await loadShiftConfig();
    await loadAndRender();
});

// ==================== HELPERS ====================

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function formatDate(d) {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getWeekCompositeKey() {
    const y = currentWeekStart.getFullYear();
    const m = String(currentWeekStart.getMonth() + 1).padStart(2, '0');
    const d = String(currentWeekStart.getDate()).padStart(2, '0');
    return `${currentBranch}__${y}-${m}-${d}`;
}

function getContrastColor(hex) {
    hex = sanitizeScheduleColor(hex);
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#000' : '#fff';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function sanitizeScheduleColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '#E5E7EB';
}

function toTimeMinutes(value) {
    const [hours, minutes] = String(value).split(':').map(Number);
    return (hours * 60) + minutes;
}

function validateTimeRange(startValue, endValue, label = 'Khung giờ') {
    const start = String(startValue || '').trim();
    const end = String(endValue || '').trim();
    if (!TIME_PATTERN.test(start)) {
        throw new Error(`${label}: giờ bắt đầu phải đúng định dạng HH:mm (00:00–23:59).`);
    }
    if (!TIME_PATTERN.test(end)) {
        throw new Error(`${label}: giờ kết thúc phải đúng định dạng HH:mm (00:00–23:59).`);
    }
    if (toTimeMinutes(start) >= toTimeMinutes(end)) {
        throw new Error(`${label}: giờ bắt đầu phải sớm hơn giờ kết thúc.`);
    }
    return { start, end };
}

function notifyError(message) {
    if (typeof UIService !== 'undefined') UIService.toast(escapeHtml(message), 'error');
    else alert(message);
}

function focusInvalidTime(error, startEl, endEl) {
    const startInvalid = startEl && !TIME_PATTERN.test(startEl.value.trim());
    const target = startInvalid ? startEl : endEl;
    if (target) {
        target.classList.add('is-invalid');
        target.setAttribute('aria-invalid', 'true');
        target.focus();
    }
    notifyError(error.message || String(error));
}

function setWeekSaveBusy(isBusy) {
    document.querySelectorAll('[data-week-save-action]').forEach(button => {
        button.disabled = isBusy;
        button.setAttribute('aria-busy', String(isBusy));
    });
}

function updateBranchTabs() {
    document.querySelectorAll('.branch-tab').forEach(tab => {
        const isActive = tab.id === `tab-${currentBranch}`;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-pressed', String(isActive));
    });
}

// ==================== SHIFT CONFIG ====================

async function loadShiftConfig(branchId = currentBranch) {
    try {
        const settings = await DBService.getSystemSettings();
        if (branchId !== currentBranch) return false;
        // Per-branch config key, fallback to global
        const branchKey = `${WORK_SCHEDULE_CONTEXT.settingsPrefix}_${branchId}`;
        const saved = settings?.[branchKey] || settings?.[WORK_SCHEDULE_CONTEXT.settingsPrefix];
        if (saved) {
            SHIFTS.forEach(shift => {
                if (saved[shift]) {
                    shiftConfig[shift].start = saved[shift].start || shiftConfig[shift].start;
                    shiftConfig[shift].end = saved[shift].end || shiftConfig[shift].end;
                }
            });
        }
        window.centerClosures = settings?.centerClosures || {};
    } catch (e) {
        console.warn('Using default shift config');
    }
    if (branchId !== currentBranch) return false;
    renderShiftConfigToUI();
    return true;
}

function isCenterClosed(dateStr, shiftKey, centerClosures) {
    if (!centerClosures || !centerClosures[dateStr]) return false;
    const closures = centerClosures[dateStr];
    return closures.includes('all') || closures.includes(shiftKey);
}


function renderShiftConfigToUI() {
    SHIFTS.forEach(shift => {
        const startEl = document.getElementById(`shift-${shift}-start`);
        const endEl = document.getElementById(`shift-${shift}-end`);
        if (startEl && endEl) {
            startEl.value = shiftConfig[shift].start;
            endEl.value = shiftConfig[shift].end;
        }
    });
}

function readShiftConfigFromUI() {
    const nextConfig = {};
    document.querySelectorAll('.shift-time-inputs .time-text').forEach(input => {
        input.classList.remove('is-invalid');
        input.removeAttribute('aria-invalid');
    });

    SHIFTS.forEach(shift => {
        const startEl = document.getElementById(`shift-${shift}-start`);
        const endEl = document.getElementById(`shift-${shift}-end`);
        if (startEl && endEl) {
            try {
                nextConfig[shift] = validateTimeRange(
                    startEl.value,
                    endEl.value,
                    `Ca ${shiftConfig[shift].label.toLowerCase()}`
                );
            } catch (error) {
                error.startElement = startEl;
                error.endElement = endEl;
                throw error;
            }
        } else {
            nextConfig[shift] = validateTimeRange(
                shiftConfig[shift].start,
                shiftConfig[shift].end,
                `Ca ${shiftConfig[shift].label.toLowerCase()}`
            );
        }
    });
    SHIFTS.forEach(shift => {
        shiftConfig[shift].start = nextConfig[shift].start;
        shiftConfig[shift].end = nextConfig[shift].end;
    });
    return nextConfig;
}

async function saveShiftConfigToFirestore(configData) {
    const data = configData || readShiftConfigFromUI();
    const branchKey = `${WORK_SCHEDULE_CONTEXT.settingsPrefix}_${currentBranch}`;
    await DBService.saveSystemSettings({ [branchKey]: data });
    return data;
}

// ==================== NAVIGATION ====================

async function switchBranch(branchId) {
    if (isSavingWeek) {
        notifyError('Đang lưu lịch, vui lòng chờ hoàn tất trước khi đổi cơ sở.');
        return false;
    }
    closeCellModal(false);
    currentBranch = branchId;
    localStorage.setItem('currentBranch', branchId);
    updateBranchTabs();
    // Reset shift config to defaults before loading branch-specific config
    shiftConfig = {
        morning: { label: 'SÁNG', start: '07:00', end: '11:30' },
        afternoon: { label: 'CHIỀU', start: '14:00', end: '18:00' },
        evening: { label: 'TỐI', start: '17:30', end: '21:30' }
    };
    const configReady = await loadShiftConfig(branchId);
    if (configReady && branchId === currentBranch) await loadAndRender();
    return true;
}

function navigateWeek(offset) {
    if (isSavingWeek) {
        notifyError('Đang lưu lịch, vui lòng chờ hoàn tất trước khi đổi tuần.');
        return false;
    }
    closeCellModal(false);
    currentWeekStart.setDate(currentWeekStart.getDate() + offset * 7);
    loadAndRender();  // Fetch new data from Firestore
    return true;
}

// ==================== DATA LOADING ====================

// Load data from Firestore and render — used on init, branch switch, week change
async function loadAndRender() {
    const loadGeneration = ++scheduleLoadGeneration;
    const key = getWeekCompositeKey();
    const requestedBranch = currentBranch;
    const requestedWeekStart = new Date(currentWeekStart);
    let data;
    try {
        data = await getWorkSchedule(key);
    } catch (error) {
        if (loadGeneration === scheduleLoadGeneration) {
            notifyError(`Không thể tải lịch ${WORK_SCHEDULE_CONTEXT.label.toLowerCase()}. Dữ liệu hiện có được giữ nguyên; vui lòng kiểm tra mạng và thử lại.`);
        }
        return false;
    }
    if (loadGeneration !== scheduleLoadGeneration || key !== getWeekCompositeKey()) return false;

    // Load cancelled shifts for the month(s) in this week (supporting month spanning)
    const mondayDate = new Date(requestedWeekStart);
    const monthStr1 = `${mondayDate.getFullYear()}-${String(mondayDate.getMonth() + 1).padStart(2, '0')}`;
    
    const sundayDate = new Date(requestedWeekStart);
    sundayDate.setDate(sundayDate.getDate() + 6);
    const monthStr2 = `${sundayDate.getFullYear()}-${String(sundayDate.getMonth() + 1).padStart(2, '0')}`;
    
    let mergedMap = {};
    if (monthStr1 === monthStr2) {
        mergedMap = await DBService.getAllCancelledShifts(monthStr1);
    } else {
        const [map1, map2] = await Promise.all([
            DBService.getAllCancelledShifts(monthStr1),
            DBService.getAllCancelledShifts(monthStr2)
        ]);
        const allUserIds = new Set([...Object.keys(map1), ...Object.keys(map2)]);
        allUserIds.forEach(uid => {
            mergedMap[uid] = [...(map1[uid] || []), ...(map2[uid] || [])];
        });
    }
    if (loadGeneration !== scheduleLoadGeneration || key !== getWeekCompositeKey()) return false;
    window.allCancelledShiftsMap = mergedMap;

    isInheritedTemplate = false;
    let inheritedFromDate = null;

    if (data) {
        // This week has saved data — use it directly
        loadedScheduleRevision = Number.isInteger(data._revision) ? data._revision : 0;
        loadedWeekSnapshot = JSON.parse(JSON.stringify(data));
        weekData = JSON.parse(JSON.stringify(data));
        
        if (weekData._shiftConfig) {
            // Tuần này có snapshot giờ ca → dùng đúng giờ của tuần đó
            SHIFTS.forEach(shift => {
                if (weekData._shiftConfig[shift]) {
                    shiftConfig[shift].start = weekData._shiftConfig[shift].start;
                    shiftConfig[shift].end = weekData._shiftConfig[shift].end;
                }
            });
            renderShiftConfigToUI();
        } else {
            // Tuần cũ chưa có snapshot → KHÔNG dùng global (có thể bị sai)
            // Thay vào đó: tính ngược từ customStart của nhân viên đầu tiên có data
            SHIFTS.forEach(shift => {
                // Tìm customStart nhỏ nhất trong tất cả nhân viên ca này
                let earliestStart = null;
                let latestEnd = null;
                DAY_KEYS.forEach(day => {
                    (weekData[shift]?.[day] || []).forEach(s => {
                        if (s.customStart) {
                            if (!earliestStart || s.customStart < earliestStart) earliestStart = s.customStart;
                            if (!latestEnd || s.customEnd > latestEnd) latestEnd = s.customEnd;
                        }
                    });
                });
                if (earliestStart) {
                    shiftConfig[shift].start = earliestStart;
                    shiftConfig[shift].end = latestEnd || shiftConfig[shift].end;
                }
                // Nếu không có customStart nào → giữ nguyên shiftConfig hiện tại (không override)
            });
            renderShiftConfigToUI();
        }
    } else {
        loadedScheduleRevision = 0;
        loadedWeekSnapshot = null;
        // No data for this week — try to inherit from previous weeks (up to 4)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekEnd = new Date(currentWeekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        let found = false;
        // Only inherit if the week hasn't ended yet
        if (weekEnd >= today) {
            for (let i = 1; i <= 4; i++) {
                const prevMonday = new Date(requestedWeekStart);
                prevMonday.setDate(prevMonday.getDate() - i * 7);
                const y = prevMonday.getFullYear();
                const m = String(prevMonday.getMonth() + 1).padStart(2, '0');
                const d = String(prevMonday.getDate()).padStart(2, '0');
                const prevKey = `${requestedBranch}__${y}-${m}-${d}`;
                let prevData;
                try {
                    prevData = await getWorkSchedule(prevKey);
                } catch (error) {
                    if (loadGeneration === scheduleLoadGeneration) {
                        notifyError('Không thể kiểm tra lịch kế thừa. Tuần hiện tại chưa được thay đổi.');
                    }
                    return false;
                }
                if (loadGeneration !== scheduleLoadGeneration || key !== getWeekCompositeKey()) return false;
                if (prevData) {
                    // Found a template! Deep clone to avoid mutating original
                    weekData = JSON.parse(JSON.stringify(prevData));
                    isInheritedTemplate = true;
                    inheritedFromDate = `${d}/${m}/${y}`;
                    found = true;
                    break;
                }
            }
        }
        if (!found) {
            weekData = {};
        }
    }

    // Ensure structure
    SHIFTS.forEach(shift => {
        if (!weekData[shift]) weekData[shift] = {};
        DAY_KEYS.forEach(day => {
            if (!weekData[shift][day]) weekData[shift][day] = [];
        });
    });
    if (!weekData._notes) weekData._notes = {};

    // Show/hide banner
    const banner = document.getElementById('inherit-banner');
    if (banner) {
        if (isInheritedTemplate && isEditor) {
            banner.style.display = 'block';
            const text = document.getElementById('inherit-banner-text');
            if (text) {
                text.textContent = `Lịch này được copy từ tuần ${inheritedFromDate}. Bấm Xác Nhận để áp dụng cho tuần này.`;
            }
        } else {
            banner.style.display = 'none';
        }
    }

    // Apply opacity for inherited template
    const tableEl = document.getElementById('schedule-table');
    if (tableEl) {
        tableEl.style.opacity = isInheritedTemplate ? '0.55' : '1';
    }

    renderTable();
    return true;
}

// ==================== RENDER (local only, no fetch) ====================

function renderTable() {
    // Week label
    const sunday = new Date(currentWeekStart);
    sunday.setDate(sunday.getDate() + 6);
    document.getElementById('week-label').textContent =
        `Tuần ${formatDate(currentWeekStart)} – ${formatDate(sunday)}/${sunday.getFullYear()}`;

    // Update headers with dates
    const ths = document.querySelectorAll('#schedule-table thead th');
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(currentWeekStart);
        dayDate.setDate(dayDate.getDate() + i);
        if (ths[i + 1]) {
            ths[i + 1].innerHTML = `<strong>${DAY_LABELS[i]}</strong><br><span class="th-date">${formatDate(dayDate)}</span>`;
        }
    }

    // Render table body
    const tbody = document.getElementById('schedule-body');
    tbody.innerHTML = '';

    SHIFTS.forEach(shift => {
        const tr = document.createElement('tr');
        const cfg = shiftConfig[shift];

        // SHIFT LABEL CELL
        const shiftTd = document.createElement('td');
        shiftTd.className = 'shift-label-cell';

        if (isEditor) {
            shiftTd.innerHTML = `
                <div class="shift-name">${cfg.label}</div>
                <div class="shift-time-inputs">
                    <input type="text" class="time-text" id="shift-${shift}-start" value="${escapeHtml(cfg.start)}" maxlength="5" placeholder="HH:mm" inputmode="numeric" autocomplete="off" aria-label="Giờ bắt đầu ca ${cfg.label.toLowerCase()}" title="Giờ bắt đầu (VD: 07:00)">
                    <span class="shift-dash">–</span>
                    <input type="text" class="time-text" id="shift-${shift}-end" value="${escapeHtml(cfg.end)}" maxlength="5" placeholder="HH:mm" inputmode="numeric" autocomplete="off" aria-label="Giờ kết thúc ca ${cfg.label.toLowerCase()}" title="Giờ kết thúc (VD: 11:30)">
                </div>
            `;
        } else {
            shiftTd.innerHTML = `
                <div class="shift-name">${cfg.label}</div>
                <div class="shift-time-display">${escapeHtml(cfg.start)} – ${escapeHtml(cfg.end)}</div>
            `;
        }
        tr.appendChild(shiftTd);

        // Day cells
        // Day cells
        DAY_KEYS.forEach((day, dayIdx) => {
            const td = document.createElement('td');
            td.className = 'day-cell';
            const staffList = weekData[shift][day] || [];
            const note = weekData._notes?.[`${shift}_${day}`] || '';

            // Calculate actual date for this day cell
            const dayDate = new Date(currentWeekStart);
            dayDate.setDate(dayDate.getDate() + dayIdx);
            const dayDateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
            const monthStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}`;
            const isPastDay = dayDateStr < getLocalDateStr(new Date());

            // Composite key (branch__YYYY-MM-DD of Monday)
            const mondayKey = getWeekCompositeKey(); // e.g. cs1__2026-04-27

            const isClosed = isCenterClosed(dayDateStr, shift, window.centerClosures);

            if (isClosed) {
                td.style.cssText = 'background: repeating-linear-gradient(45deg, #f3f4f6, #f3f4f6 10px, #e5e7eb 10px, #e5e7eb 20px); color: #6b7280; font-size: 0.8rem; font-weight: bold; text-align: center; vertical-align: middle; padding: 0.75rem 0.25rem;';
                td.textContent = 'Lịch nghỉ trung tâm';
                tr.appendChild(td);
                return;
            }

            if (staffList.length === 0 && !note) {
                td.innerHTML = `<span class="empty-cell">—</span>`;
            } else {
                staffList.forEach(s => {
                    const bg = sanitizeScheduleColor(s.color);
                    const fg = getContrastColor(bg);
                    const globalUser = allLoadedUsers.find(u => u.id === s.id);
                    const shortName = globalUser?.shortName || s.shortName || (s.name ? s.name.trim().split(/\s+/).pop() : '?');
                    const isCustomTime = s.customStart && s.customStart !== shiftConfig[shift].start;
                    const customLabel = isCustomTime ? ` ${s.customStart}` : '';

                    const isFixed = s.isFixedShift ? true : false;
                    const fixedLabel = isFixed ? ' ⭐' : '';

                    const tooltipBase = isCustomTime ? `${s.name} (${s.customStart}–${s.customEnd || ''})` : s.name;
                    const tooltip = tooltipBase + (isFixed ? ' [Ca Cố Định]' : '');

                    let borderStyle = '';
                    if (isFixed && !window.isFixedShiftMode) {
                        borderStyle = 'border: 2px solid #8B5CF6; box-sizing: border-box;';
                    } else if (window.isFixedShiftMode) {
                        borderStyle = 'cursor: pointer; box-sizing: border-box; ';
                        if (isFixed) {
                            borderStyle += 'border: 2px solid #EF4444; ';
                        } else {
                            borderStyle += 'border: 2px dashed #9CA3AF; ';
                        }
                    }

                    // Check if cancelled
                    const branchPart = currentBranch;
                    const mondayDateStr = `${currentWeekStart.getFullYear()}-${String(currentWeekStart.getMonth() + 1).padStart(2, '0')}-${String(currentWeekStart.getDate()).padStart(2, '0')}`;
                    const shiftKey = getCancelledShiftKey(branchPart, mondayDateStr, shift, day);
                    const staffCancelledShifts = window.allCancelledShiftsMap ? window.allCancelledShiftsMap[s.id] || [] : [];
                    const isCancelled = staffCancelledShifts.includes(shiftKey);

                    let textDecoration = isCancelled ? 'text-decoration: line-through; opacity: 0.6;' : '';
                    const tooltipText = tooltip + (isCancelled ? ' [Đã Báo Vắng]' : '');

                    const tag = document.createElement('span');
                    tag.className = 'staff-tag';
                    tag.style.cssText = `background:${bg};color:${fg};${borderStyle}${textDecoration}`;
                    tag.title = tooltipText;
                    tag.textContent = `${shortName}${customLabel}${fixedLabel}`;

                    if (isEditor && !isPastDay && window.isFixedShiftMode) {
                        tag.setAttribute('role', 'button');
                        tag.tabIndex = 0;
                        tag.setAttribute('aria-label', `Đổi trạng thái ca cố định của ${shortName}`);
                        const toggleFixed = e => toggleStaffFixedShift(e, shift, day, s.id);
                        tag.onclick = toggleFixed;
                        tag.onkeydown = e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleFixed(e);
                            }
                        };
                    } else if (isEditor && !isPastDay && !window.isFixedShiftMode) {
                        // Click chip to show absent confirm popup
                        tag.style.cursor = 'pointer';
                        tag.setAttribute('role', 'button');
                        tag.tabIndex = 0;
                        tag.setAttribute('aria-label', `Thao tác ca làm của ${shortName}`);
                        const openStaffActions = e => {
                            e.stopPropagation(); // Don't open cell modal
                            showAbsentConfirmPopup(e, s, shift, day, dayDateStr, monthStr, mondayKey, shortName);
                        };
                        tag.onclick = openStaffActions;
                        tag.onkeydown = e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openStaffActions(e);
                            }
                        };
                    }

                    td.appendChild(tag);
                });

                if (note) {
                    const noteEl = document.createElement('span');
                    noteEl.className = 'staff-note';
                    noteEl.textContent = note;
                    td.appendChild(noteEl);
                }
            }

            if (isPastDay) {
                td.classList.add('past-locked');
                td.title = 'Lịch đã qua được khóa để bảo toàn chấm công và tính lương';
            }

            if (isEditor && !isPastDay && !window.isFixedShiftMode) {
                td.classList.add('editable');
                td.dataset.shift = shift;
                td.dataset.day = day;
                td.setAttribute('role', 'button');
                td.tabIndex = 0;
                td.setAttribute('aria-label', `Chỉnh lịch ${shiftConfig[shift].label.toLowerCase()}, ${DAY_LABELS[dayIdx]}`);
                const openEditor = event => {
                    lastModalTrigger = event.currentTarget;
                    openCellModal(shift, day, event.currentTarget);
                };
                td.onclick = openEditor;
                td.onkeydown = event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openEditor(event);
                    }
                };
            }

            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}

// ==================== ABSENT CONFIRMATION POPUP ====================

function closeAbsentPopup(restoreFocus = true) {
    if (absentPopupOutsideHandler) {
        document.removeEventListener('pointerdown', absentPopupOutsideHandler, true);
        absentPopupOutsideHandler = null;
    }
    const trigger = absentPopupTrigger;
    activeAbsentPopup?.remove();
    activeAbsentPopup = null;
    absentPopupTrigger = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
}

function positionAbsentPopup(popup, event) {
    const viewportMargin = 12;
    if (window.innerWidth <= 640) {
        popup.classList.add('is-mobile-sheet');
        popup.style.left = `${viewportMargin}px`;
        popup.style.right = `${viewportMargin}px`;
        popup.style.bottom = `calc(${viewportMargin}px + env(safe-area-inset-bottom, 0px))`;
        popup.style.top = 'auto';
        return;
    }

    const anchorRect = event.currentTarget?.getBoundingClientRect?.();
    const anchorX = Number.isFinite(event.clientX) && event.clientX > 0
        ? event.clientX
        : (anchorRect?.left || viewportMargin);
    const anchorY = Number.isFinite(event.clientY) && event.clientY > 0
        ? event.clientY
        : (anchorRect?.bottom || viewportMargin);
    const popupRect = popup.getBoundingClientRect();
    let left = anchorX + 8;
    let top = anchorY + 8;

    if (left + popupRect.width > window.innerWidth - viewportMargin) {
        left = Math.max(viewportMargin, window.innerWidth - popupRect.width - viewportMargin);
    }
    if (top + popupRect.height > window.innerHeight - viewportMargin) {
        const aboveAnchor = (anchorRect?.top || anchorY) - popupRect.height - 8;
        top = Math.max(viewportMargin, aboveAnchor);
    }

    popup.style.left = `${Math.max(viewportMargin, left)}px`;
    popup.style.top = `${Math.max(viewportMargin, top)}px`;
}

function showAbsentConfirmPopup(event, staffEntry, shift, dayKey, dayDateStr, monthStr, mondayKey, shortName) {
    closeAbsentPopup(false);
    absentPopupTrigger = event.currentTarget || null;

    const shiftLabel = shiftConfig[shift]?.label || shift;
    const [y, m, d] = dayDateStr.split('-');
    const displayDate = `${d}/${m}`;
    const mondayDateStr = `${currentWeekStart.getFullYear()}-${String(currentWeekStart.getMonth() + 1).padStart(2, '0')}-${String(currentWeekStart.getDate()).padStart(2, '0')}`;
    const shiftKey = getCancelledShiftKey(currentBranch, mondayDateStr, shift, dayKey);
    const staffCancelledShifts = window.allCancelledShiftsMap?.[staffEntry.id] || [];
    const isCancelled = staffCancelledShifts.includes(shiftKey);

    const popup = document.createElement('div');
    popup.className = 'absent-confirm-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'false');
    popup.setAttribute('aria-labelledby', 'absent-popup-title');
    popup.innerHTML = `
        <div class="absent-popup-kicker">THAO TÁC CA LÀM</div>
        <div class="absent-popup-title" id="absent-popup-title">${escapeHtml(shortName)} — ${escapeHtml(shiftLabel)} ${escapeHtml(displayDate)}</div>
        <div class="absent-popup-description">${isCancelled ? 'Ca đang được đánh dấu vắng. Có thể khôi phục khi nhân viên đi làm lại.' : 'Chọn thao tác phù hợp cho ca này.'}</div>
        <div class="absent-popup-actions">
            <button type="button" class="absent-popup-button ${isCancelled ? 'is-restore' : 'is-absence'}" data-popup-action="absence-toggle">${isCancelled ? '↩ Khôi phục ca làm' : '&#10003; Xác nhận vắng'}</button>
            <button type="button" class="absent-popup-button is-edit" data-popup-action="edit">✏️ Chỉnh sửa phân công</button>
            <button type="button" class="absent-popup-button is-cancel" data-popup-action="cancel">Đóng</button>
        </div>
    `;

    document.body.appendChild(popup);
    activeAbsentPopup = popup;
    positionAbsentPopup(popup, event);

    absentPopupOutsideHandler = outsideEvent => {
        if (!popup.contains(outsideEvent.target) && outsideEvent.target !== absentPopupTrigger) {
            closeAbsentPopup(true);
        }
    };
    setTimeout(() => {
        if (activeAbsentPopup === popup) {
            document.addEventListener('pointerdown', absentPopupOutsideHandler, true);
        }
    }, 0);

    popup.querySelector('[data-popup-action="cancel"]').onclick = e => {
        e.stopPropagation();
        closeAbsentPopup(true);
    };

    popup.querySelector('[data-popup-action="edit"]').onclick = e => {
        e.stopPropagation();
        const trigger = absentPopupTrigger;
        closeAbsentPopup(false);
        openCellModal(shift, dayKey, trigger);
    };

    popup.querySelector('[data-popup-action="absence-toggle"]').onclick = async e => {
        e.stopPropagation();
        const trigger = absentPopupTrigger;
        closeAbsentPopup(false);

        const confirmationMessage = isCancelled
            ? `Khôi phục ca ${shiftLabel} ngày ${displayDate} cho ${shortName}?\n(Ca sẽ xuất hiện lại trong Bảng Công và được tính theo chấm công thực tế.)`
            : `Xác nhận ${shortName} VẮNG ca ${shiftLabel} ngày ${displayDate}?\n(Ca được giữ trên lịch dưới trạng thái vắng và có thể khôi phục.)`;
        const ok = typeof UIService !== 'undefined' && typeof UIService.confirm === 'function'
            ? await UIService.confirm(escapeHtml(confirmationMessage))
            : confirm(confirmationMessage);
        if (!ok) {
            if (trigger?.isConnected) trigger.focus();
            return;
        }

        try {
            if (isCancelled) {
                await DBService.restoreCancelledShift(monthStr, staffEntry.id, shiftKey);
            } else {
                await DBService.cancelShift(monthStr, staffEntry.id, shiftKey);
            }
            
            // Update local state and re-render immediately; Firestore remains the source of truth.
            if (!window.allCancelledShiftsMap) window.allCancelledShiftsMap = {};
            if (!window.allCancelledShiftsMap[staffEntry.id]) window.allCancelledShiftsMap[staffEntry.id] = [];
            if (isCancelled) {
                window.allCancelledShiftsMap[staffEntry.id] = window.allCancelledShiftsMap[staffEntry.id]
                    .filter(key => key !== shiftKey);
            } else if (!window.allCancelledShiftsMap[staffEntry.id].includes(shiftKey)) {
                window.allCancelledShiftsMap[staffEntry.id].push(shiftKey);
            }
            renderTable();

            if (typeof UIService !== 'undefined') {
                UIService.toast(escapeHtml(isCancelled
                    ? `Đã khôi phục ca ${shiftLabel} ngày ${displayDate} cho ${shortName}`
                    : `Đã xác nhận ${shortName} vắng ca ${shiftLabel} ngày ${displayDate}`), 'success');
            }
        } catch (err) {
            notifyError('Lỗi: ' + (err.message || err));
            if (trigger?.isConnected) trigger.focus();
        }
    };

    popup.querySelector('[data-popup-action="absence-toggle"]')?.focus();
}

// ==================== CELL EDITOR MODAL ====================

function handleScheduleKeydown(event) {
    if (event.key === 'Escape' && activeAbsentPopup) {
        event.preventDefault();
        closeAbsentPopup(true);
        return;
    }

    const modal = document.getElementById('cell-modal');
    if (!modal?.classList.contains('open')) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeCellModal();
        return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => element.offsetParent !== null);
    if (focusable.length === 0) {
        event.preventDefault();
        modal.querySelector('.cell-modal-content')?.focus();
        return;
    }
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

function clearCellModalError() {
    const errorEl = document.getElementById('cell-modal-error');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.hidden = true;
    }
    document.querySelectorAll('#cell-modal .time-text.is-invalid').forEach(input => {
        input.classList.remove('is-invalid');
        input.removeAttribute('aria-invalid');
    });
}

function showCellModalError(message, target) {
    const errorEl = document.getElementById('cell-modal-error');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
    }
    if (target) {
        target.classList.add('is-invalid');
        target.setAttribute('aria-invalid', 'true');
        target.focus();
    }
}

function openCellModal(shift, dayKey, triggerElement = document.activeElement) {
    if (isPastScheduleDay(dayKey)) {
        notifyError('Lịch ngày đã qua được khóa để bảo toàn dữ liệu chấm công và tính lương.');
        return false;
    }
    closeAbsentPopup(false);
    editingCell = { shift, dayKey };
    lastModalTrigger = triggerElement?.isConnected ? triggerElement : lastModalTrigger;

    const dayIdx = DAY_KEYS.indexOf(dayKey);
    const dayDate = new Date(currentWeekStart);
    dayDate.setDate(dayDate.getDate() + dayIdx);
    const title = `${shiftConfig[shift].label} — ${DAY_LABELS[dayIdx]} (${formatDate(dayDate)})`;
    document.getElementById('cell-modal-title').textContent = title;

    // Current selections
    const currentStaff = weekData[shift]?.[dayKey] || [];
    const currentIds = currentStaff.map(s => s.id);

    // Danh sách đã được lọc đúng vai trò của trang hiện tại.
    const listEl = document.getElementById('staff-checkbox-list');
    let html = '';

    if (receptionistStaff.length === 0) {
        html = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">
            <p style="margin-bottom:0.5rem">Chưa có nhân viên ${WORK_SCHEDULE_CONTEXT.label.toLowerCase()} nào.</p>
            <p style="font-size:0.8rem">Vào <strong>Nhân Sự</strong> để tạo tài khoản với vai trò <strong>${WORK_SCHEDULE_CONTEXT.labelTitle}</strong>.</p>
        </div>`;
    } else {
        receptionistStaff.forEach(user => {
            const userId = String(user.id || '');
            const userName = String(user.name || 'Chưa đặt tên');
            const checked = currentIds.includes(user.id) ? 'checked' : '';
            const color = sanitizeScheduleColor(user.scheduleColor);
            const fg = getContrastColor(color);
            // Check if this user has custom times
            const existing = currentStaff.find(s => s.id === user.id);
            const hasCustom = existing?.customStart ? true : false;
            const customStart = existing?.customStart || '';
            const customEnd = existing?.customEnd || '';
            const initial = Array.from(userName.trim())[0] || '?';
            html += `
                <label class="staff-checkbox-item">
                    <input type="checkbox" value="${escapeHtml(userId)}" data-name="${escapeHtml(userName)}" data-color="${color}" ${checked}>
                    <span class="staff-color-dot" style="background:${color};color:${fg}">${escapeHtml(initial)}</span>
                    <span class="staff-pick-name">${escapeHtml(userName)}</span>
                    <button type="button" class="btn-custom-time" onclick="toggleCustomTime(this)" title="Giờ làm đặc biệt" aria-label="Đặt giờ làm đặc biệt cho ${escapeHtml(userName)}" aria-expanded="${hasCustom}" style="opacity:${hasCustom ? '1' : '0.45'}">⏰</button>
                </label>
                <div class="custom-time-row" data-open="${hasCustom}" style="display:${hasCustom ? 'flex' : 'none'};">
                    <span class="custom-time-label">Giờ đặc biệt:</span>
                    <input type="text" class="time-text custom-start" value="${escapeHtml(customStart)}" placeholder="HH:mm" maxlength="5" inputmode="numeric" autocomplete="off" aria-label="Giờ bắt đầu đặc biệt của ${escapeHtml(userName)}">
                    <span>–</span>
                    <input type="text" class="time-text custom-end" value="${escapeHtml(customEnd)}" placeholder="HH:mm" maxlength="5" inputmode="numeric" autocomplete="off" aria-label="Giờ kết thúc đặc biệt của ${escapeHtml(userName)}">
                </div>
            `;
        });
    }
    listEl.innerHTML = html;

    // Clear search input
    const searchInput = document.getElementById('modal-staff-search');
    if (searchInput) searchInput.value = '';
    clearCellModalError();

    // Note
    const noteKey = `${shift}_${dayKey}`;
    document.getElementById('cell-note-input').value = weekData._notes?.[noteKey] || '';

    const modal = document.getElementById('cell-modal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('schedule-modal-open');
    requestAnimationFrame(() => (searchInput || modal.querySelector('.cell-modal-content'))?.focus());
}

function closeCellModal(restoreFocus = true) {
    const modal = document.getElementById('cell-modal');
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('schedule-modal-open');
    editingCell = null;
    const trigger = lastModalTrigger;
    lastModalTrigger = null;
    if (restoreFocus && trigger?.isConnected) requestAnimationFrame(() => trigger.focus());
}

function saveCellData() {
    if (!editingCell) return false;
    const { shift, dayKey } = editingCell;
    if (isPastScheduleDay(dayKey)) {
        showCellModalError('Lịch ngày đã qua được khóa và không thể thay đổi nhân sự.');
        return false;
    }
    clearCellModalError();

    const checkboxes = document.querySelectorAll('#staff-checkbox-list input[type="checkbox"]:checked');
    const selectedStaff = [];
    const existingStaff = weekData[shift] && weekData[shift][dayKey] ? weekData[shift][dayKey] : [];

    for (const cb of checkboxes) {
        const uid = cb.value;
        const entry = {
            id: uid,
            name: cb.getAttribute('data-name'),
            color: sanitizeScheduleColor(cb.getAttribute('data-color'))
        };

        // Preserve isFixedShift state
        const existingEntry = existingStaff.find(s => s.id === uid);
        if (existingEntry && existingEntry.isFixedShift) {
            entry.isFixedShift = existingEntry.isFixedShift;
        }

        // Check for custom start/end times
        const customRow = cb.closest('.staff-checkbox-item')?.nextElementSibling;
        const startInput = customRow?.querySelector('.custom-start');
        const endInput = customRow?.querySelector('.custom-end');
        const customStart = startInput?.value?.trim() || '';
        const customEnd = endInput?.value?.trim() || '';
        if (customStart || customEnd) {
            try {
                const validated = validateTimeRange(customStart, customEnd, `Giờ đặc biệt của ${entry.name}`);
                entry.customStart = validated.start;
                entry.customEnd = validated.end;
            } catch (error) {
                const target = !TIME_PATTERN.test(customStart) ? startInput : endInput;
                showCellModalError(error.message, target);
                return false;
            }
        }
        selectedStaff.push(entry);
    }

    if (!weekData[shift]) weekData[shift] = {};
    weekData[shift][dayKey] = selectedStaff;

    const noteKey = `${shift}_${dayKey}`;
    const note = document.getElementById('cell-note-input').value.trim();
    if (!weekData._notes) weekData._notes = {};
    weekData._notes[noteKey] = note;

    closeCellModal(false);
    renderTable();  // LOCAL re-render only — no Firestore fetch!
    requestAnimationFrame(() => {
        document.querySelector(`.day-cell[data-shift="${shift}"][data-day="${dayKey}"]`)?.focus();
    });
    return true;
}

// ==================== CLEAR ====================

// Search/filter modal staff checkboxes
window.filterModalStaff = function (query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('#staff-checkbox-list .staff-checkbox-item').forEach(label => {
        const name = label.querySelector('.staff-pick-name');
        const text = name ? name.textContent.toLowerCase() : label.textContent.toLowerCase();
        const customRow = label.nextElementSibling;
        if (customRow && customRow.classList.contains('custom-time-row')) {
            label.style.display = text.includes(q) ? '' : 'none';
            customRow.style.display = text.includes(q) && customRow.dataset.open === 'true' ? 'flex' : 'none';
        } else {
            label.style.display = text.includes(q) ? '' : 'none';
        }
    });
};

// Toggle custom time inputs for a staff member
window.toggleCustomTime = function (btn) {
    const label = btn.closest('.staff-checkbox-item');
    const customRow = label.nextElementSibling;
    if (!customRow || !customRow.classList.contains('custom-time-row')) return;

    const isOpen = customRow.style.display === 'flex';
    customRow.style.display = isOpen ? 'none' : 'flex';
    customRow.dataset.open = isOpen ? 'false' : 'true';
    btn.style.opacity = isOpen ? '0.4' : '1';
    btn.setAttribute('aria-expanded', String(!isOpen));
    if (!isOpen) customRow.querySelector('.custom-start')?.focus();
};

async function clearCurrentWeek() {
    // Confirmation dialog
    const confirmed = typeof UIService !== 'undefined'
        ? await UIService.confirm(`⚠️ Bạn có chắc muốn XÓA TOÀN BỘ lịch ${WORK_SCHEDULE_CONTEXT.label.toLowerCase()} tuần này?\n\n(Dữ liệu chỉ bị xóa trên màn hình. Bấm "Lưu Lịch Tuần" để xác nhận.)`)
        : confirm('Bạn có chắc muốn xóa toàn bộ lịch tuần này?');

    if (!confirmed) return;

    // Clear only editable days. Historical rosters remain visible and are also
    // protected again at the transactional save boundary.
    if (!weekData._notes) weekData._notes = {};
    DAY_KEYS.forEach(day => {
        if (isPastScheduleDay(day)) return;
        SHIFTS.forEach(shift => {
            if (!weekData[shift]) weekData[shift] = {};
            weekData[shift][day] = [];
            delete weekData._notes[`${shift}_${day}`];
        });
    });

    // Re-render table (local only, no Firestore save)
    renderTable();

    if (typeof UIService !== 'undefined') {
        UIService.toast('Đã xóa lịch tuần. Bấm "Lưu Lịch Tuần" để lưu thay đổi.', 'info');
    }
}

// ==================== SAVE ====================

function getLocalDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function isPastScheduleDay(dayKey) {
    const dayIndex = DAY_KEYS.indexOf(dayKey);
    if (dayIndex < 0) return true;
    const targetDate = new Date(currentWeekStart);
    targetDate.setDate(targetDate.getDate() + dayIndex);
    return getLocalDateStr(targetDate) < getLocalDateStr(new Date());
}

function validateRosterCustomTimes() {
    SHIFTS.forEach(shift => {
        DAY_KEYS.forEach((dayKey, dayIndex) => {
            (weekData[shift]?.[dayKey] || []).forEach(staff => {
                if (!staff.customStart && !staff.customEnd) return;
                validateTimeRange(
                    staff.customStart,
                    staff.customEnd,
                    `${staff.name || 'Nhân viên'} — ${shiftConfig[shift].label}, ${DAY_LABELS[dayIndex]}`
                );
            });
        });
    });
}

async function saveFullWeek() {
    if (isSavingWeek) return false;
    if (isInheritedTemplate) {
        const message = 'Lịch hiện tại đang là lịch kế thừa từ tuần trước. Bạn có chắc chắn muốn LƯU và ÁP DỤNG toàn bộ lịch này cho tuần hiện tại không?';
        const confirmSave = typeof UIService !== 'undefined' && typeof UIService.confirm === 'function'
            ? await UIService.confirm(message)
            : confirm(message);
        if (!confirmSave) return false;
    }

    // Read and validate the UI first. Future snapshots must use these exact values.
    let nextShiftConfig;
    try {
        nextShiftConfig = readShiftConfigFromUI();
        validateRosterCustomTimes();
    } catch (error) {
        if (error.startElement || error.endElement) {
            focusInvalidTime(error, error.startElement, error.endElement);
        } else {
            notifyError(error.message || String(error));
        }
        return false;
    }

    isSavingWeek = true;
    setWeekSaveBusy(true);
    let scheduleSaved = false;
    try {
        // Preserve the immutable snapshot loaded into this editor. The
        // transaction below rejects the save if another scheduler changed it.
        const key = getWeekCompositeKey();
        const existingData = loadedWeekSnapshot
            ? JSON.parse(JSON.stringify(loadedWeekSnapshot))
            : null;

        const todayStr = getLocalDateStr(new Date());

        const previousWeekShiftConfig = weekData._shiftConfig
            ? JSON.parse(JSON.stringify(weekData._shiftConfig))
            : null;

        // 3. Lock past days to their historical values.
        DAY_KEYS.forEach((dayKey, idx) => {
            const dayDate = new Date(currentWeekStart);
            dayDate.setDate(dayDate.getDate() + idx);
            const dayStr = getLocalDateStr(dayDate);

            if (dayStr < todayStr) {
                SHIFTS.forEach(shift => {
                    const historicalRoster = existingData?.[shift]?.[dayKey];
                    weekData[shift][dayKey] = Array.isArray(historicalRoster)
                        ? JSON.parse(JSON.stringify(historicalRoster))
                        : [];
                    const noteKey = `${shift}_${dayKey}`;
                    const historicalNote = existingData?._notes?.[noteKey];
                    if (historicalNote) weekData._notes[noteKey] = historicalNote;
                    else delete weekData._notes[noteKey];
                });
            }
        });

        // 3b. Lock today/future days to the freshly validated UI values.
        DAY_KEYS.forEach((dayKey, idx) => {
            const dayDate = new Date(currentWeekStart);
            dayDate.setDate(dayDate.getDate() + idx);
            const dayStr = getLocalDateStr(dayDate);

            if (dayStr >= todayStr) {
                SHIFTS.forEach(shift => {
                    const staffList = weekData[shift]?.[dayKey] || [];
                    const previousDefault = previousWeekShiftConfig?.[shift];
                    weekData[shift][dayKey] = staffList.map(s => {
                        const usedPreviousDefault = previousDefault
                            && s.customStart === previousDefault.start
                            && s.customEnd === previousDefault.end;
                        return {
                            ...s,
                            customStart: (!s.customStart || usedPreviousDefault)
                                ? nextShiftConfig[shift].start
                                : s.customStart,
                            customEnd: (!s.customEnd || usedPreviousDefault)
                                ? nextShiftConfig[shift].end
                                : s.customEnd
                        };
                    });
                });
            }
        });

        // 3c. Persist the same validated values inside this week's document.
        weekData._shiftConfig = {};
        SHIFTS.forEach(shift => {
            weekData._shiftConfig[shift] = { ...nextShiftConfig[shift] };
        });

        // 4. Save the roster first. A roster failure must never change global
        // defaults. Then save defaults, propagating any error to the caller.
        const saveResult = await saveWorkSchedule(key, weekData, loadedScheduleRevision);
        scheduleSaved = true;
        loadedScheduleRevision = Number.isInteger(saveResult?.revision)
            ? saveResult.revision
            : loadedScheduleRevision + 1;
        weekData._revision = loadedScheduleRevision;
        loadedWeekSnapshot = JSON.parse(JSON.stringify(weekData));

        if (isInheritedTemplate) {
            isInheritedTemplate = false;
            const banner = document.getElementById('inherit-banner');
            if (banner) banner.style.display = 'none';
            const tableEl = document.getElementById('schedule-table');
            if (tableEl) tableEl.style.opacity = '1';
        }

        await saveShiftConfigToFirestore(nextShiftConfig);

        if (typeof UIService !== 'undefined') {
            UIService.toast(`Đã lưu lịch ${WORK_SCHEDULE_CONTEXT.label.toLowerCase()}!`, 'success');
        } else {
            alert(`Đã lưu lịch ${WORK_SCHEDULE_CONTEXT.label.toLowerCase()}!`);
        }
        return true;
    } catch (e) {
        console.error('Save error:', e);
        const detail = e.message || String(e);
        const msg = e?.code === 'SCHEDULE_CONFLICT'
            ? 'Lịch tuần vừa được người xếp lịch khác cập nhật. Dữ liệu của bạn chưa bị ghi đè; hãy tải lại tuần này rồi áp dụng thay đổi trên bản mới nhất.'
            : scheduleSaved
            ? `Lịch tuần đã được lưu, nhưng chưa cập nhật được giờ ca mặc định: ${detail}. Vui lòng thử lưu lại.`
            : `Không thể lưu lịch: ${detail}`;
        notifyError(msg);
        return false;
    } finally {
        isSavingWeek = false;
        setWeekSaveBusy(false);
    }
}

// ==================== CONFIRM INHERITED ====================

async function confirmInheritedSchedule() {
    if (!isInheritedTemplate) return false;
    return saveFullWeek();
}
