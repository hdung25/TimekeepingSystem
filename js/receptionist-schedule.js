// Receptionist Schedule — Week-view horizontal table
// Features: Branch tabs (CS1/CS2), Week picker, 3 shifts × 7 days, Admin edit modal
// Only shows staff with role = 'receptionist' in the picker

// ==================== STATE ====================
let currentBranch = localStorage.getItem('currentBranch') || 'cs1';
let currentWeekStart = getMonday(new Date());
let weekData = {};
let receptionistStaff = [];
let allLoadedUsers = []; // Store all users to map shortName retroactively
let shiftConfig = {
    morning: { label: 'SÁNG', start: '07:00', end: '11:30' },
    afternoon: { label: 'CHIỀU', start: '14:00', end: '18:00' },
    evening: { label: 'TỐI', start: '17:30', end: '21:30' }
};
let editingCell = null;
let isInheritedTemplate = false; // True when showing a template from a previous week
window.isFixedShiftMode = false;

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
    if (!window.isFixedShiftMode) return;
    
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
    return roles.some(r => ['admin', 'assistant', 'receptionist_assistant', 'senior_assistant'].includes(r));
})();

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];
const SHIFTS = ['morning', 'afternoon', 'evening'];

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
    if (isEditor) {
        const saveArea = document.getElementById('save-area');
        if (saveArea) saveArea.style.display = 'flex';
    }

    document.querySelectorAll('.branch-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${currentBranch}`)?.classList.add('active');

    // Load staff list — ONLY receptionist, receptionist_assistant, senior_assistant roles
    try {
        const allUsers = await DBService.getUsers();
        allLoadedUsers = allUsers; // Store globally
        receptionistStaff = allUsers.filter(u => ['receptionist', 'receptionist_assistant', 'senior_assistant'].includes(u.role));
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
    if (!hex || hex.length < 7) return '#000';
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#000' : '#fff';
}

// ==================== SHIFT CONFIG ====================

async function loadShiftConfig() {
    try {
        const settings = await DBService.getSystemSettings();
        // Per-branch config key, fallback to global
        const branchKey = `receptionistShifts_${currentBranch}`;
        const saved = settings?.[branchKey] || settings?.receptionistShifts;
        if (saved) {
            SHIFTS.forEach(shift => {
                if (saved[shift]) {
                    shiftConfig[shift].start = saved[shift].start || shiftConfig[shift].start;
                    shiftConfig[shift].end = saved[shift].end || shiftConfig[shift].end;
                }
            });
        }
    } catch (e) {
        console.warn('Using default shift config');
    }
    renderShiftConfigToUI();
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
    SHIFTS.forEach(shift => {
        const startEl = document.getElementById(`shift-${shift}-start`);
        const endEl = document.getElementById(`shift-${shift}-end`);
        if (startEl && endEl) {
            shiftConfig[shift].start = startEl.value;
            shiftConfig[shift].end = endEl.value;
        }
    });
}

async function saveShiftConfigToFirestore() {
    readShiftConfigFromUI();
    const data = {};
    SHIFTS.forEach(s => { data[s] = { start: shiftConfig[s].start, end: shiftConfig[s].end }; });
    try {
        // Save per-branch config
        const branchKey = `receptionistShifts_${currentBranch}`;
        await DBService.saveSystemSettings({ [branchKey]: data });
    } catch (e) {
        console.warn('Failed to save shift config:', e);
    }
}

// ==================== NAVIGATION ====================

function switchBranch(branchId) {
    currentBranch = branchId;
    localStorage.setItem('currentBranch', branchId);
    document.querySelectorAll('.branch-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${branchId}`)?.classList.add('active');
    // Reset shift config to defaults before loading branch-specific config
    shiftConfig = {
        morning: { label: 'SÁNG', start: '07:00', end: '11:30' },
        afternoon: { label: 'CHIỀU', start: '14:00', end: '18:00' },
        evening: { label: 'TỐI', start: '17:30', end: '21:30' }
    };
    loadShiftConfig().then(() => loadAndRender());
}

function navigateWeek(offset) {
    currentWeekStart.setDate(currentWeekStart.getDate() + offset * 7);
    loadAndRender();  // Fetch new data from Firestore
}

// ==================== DATA LOADING ====================

// Load data from Firestore and render — used on init, branch switch, week change
async function loadAndRender() {
    const key = getWeekCompositeKey();
    const data = await DBService.getReceptionistSchedule(key);

    isInheritedTemplate = false;
    let inheritedFromDate = null;

    if (data) {
        // This week has saved data — use it directly
        weekData = data;
        
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
        // No data for this week — try to inherit from previous weeks (up to 4)
        let found = false;
        for (let i = 1; i <= 4; i++) {
            const prevMonday = new Date(currentWeekStart);
            prevMonday.setDate(prevMonday.getDate() - i * 7);
            const y = prevMonday.getFullYear();
            const m = String(prevMonday.getMonth() + 1).padStart(2, '0');
            const d = String(prevMonday.getDate()).padStart(2, '0');
            const prevKey = `${currentBranch}__${y}-${m}-${d}`;
            const prevData = await DBService.getReceptionistSchedule(prevKey);
            if (prevData) {
                // Found a template! Deep clone to avoid mutating original
                weekData = JSON.parse(JSON.stringify(prevData));
                isInheritedTemplate = true;
                inheritedFromDate = `${d}/${m}/${y}`;
                found = true;
                break;
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
                    <input type="text" class="time-text" id="shift-${shift}-start" value="${cfg.start}" maxlength="5" placeholder="HH:MM" title="Giờ bắt đầu (VD: 07:00)">
                    <span class="shift-dash">–</span>
                    <input type="text" class="time-text" id="shift-${shift}-end" value="${cfg.end}" maxlength="5" placeholder="HH:MM" title="Giờ kết thúc (VD: 11:30)">
                </div>
            `;
        } else {
            shiftTd.innerHTML = `
                <div class="shift-name">${cfg.label}</div>
                <div class="shift-time-display">${cfg.start} – ${cfg.end}</div>
            `;
        }
        tr.appendChild(shiftTd);

        // Day cells
        DAY_KEYS.forEach(day => {
            const td = document.createElement('td');
            td.className = 'day-cell';
            const staffList = weekData[shift][day] || [];
            const note = weekData._notes?.[`${shift}_${day}`] || '';

            let html = '';
            staffList.forEach(s => {
                const bg = s.color || '#E5E7EB';
                const fg = getContrastColor(bg);
                const globalUser = allLoadedUsers.find(u => u.id === s.id);
                const shortName = globalUser?.shortName || s.shortName || (s.name ? s.name.trim().split(/\s+/).pop() : '?');
                // Only show time if it differs from the column's standard start time
                const isCustomTime = s.customStart && s.customStart !== shiftConfig[shift].start;
                const customLabel = isCustomTime ? ` ${s.customStart}` : '';
                
                const isFixed = s.isFixedShift ? true : false;
                const fixedLabel = isFixed ? ' ⭐' : '';
                
                const tooltipBase = isCustomTime ? `${s.name} (${s.customStart}–${s.customEnd || ''})` : s.name;
                const tooltip = tooltipBase + (isFixed ? ' [Ca Cố Định]' : '');
                
                let borderStyle = '';
                if (isFixed && !window.isFixedShiftMode) {
                    borderStyle = 'border: 2px solid #8B5CF6; box-sizing: border-box;'; // Violet border for fixed
                } else if (window.isFixedShiftMode) {
                    borderStyle = 'cursor: pointer; box-sizing: border-box; ';
                    if (isFixed) {
                        borderStyle += 'border: 2px solid #EF4444; '; // Red border when selected in edit mode
                    } else {
                        borderStyle += 'border: 2px dashed #9CA3AF; '; // Dashed for selectable
                    }
                }
                
                const clickHandler = (isEditor && window.isFixedShiftMode) ? `onclick="toggleStaffFixedShift(event, '${shift}', '${day}', '${s.id}')"` : '';

                html += `<span class="staff-tag" style="background:${bg};color:${fg};${borderStyle}" title="${tooltip}" ${clickHandler}>${shortName}${customLabel}${fixedLabel}</span>`;
            });
            if (note) {
                html += `<span class="staff-note">${note}</span>`;
            }
            if (staffList.length === 0 && !note) {
                html = `<span class="empty-cell">—</span>`;
            }

            td.innerHTML = html;

            if (isEditor) {
                td.classList.add('editable');
                td.onclick = () => {
                    if (!window.isFixedShiftMode) {
                        openCellModal(shift, day);
                    }
                };
            }

            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}

// ==================== CELL EDITOR MODAL ====================

function openCellModal(shift, dayKey) {
    editingCell = { shift, dayKey };

    const dayIdx = DAY_KEYS.indexOf(dayKey);
    const dayDate = new Date(currentWeekStart);
    dayDate.setDate(dayDate.getDate() + dayIdx);
    const title = `${shiftConfig[shift].label} — ${DAY_LABELS[dayIdx]} (${formatDate(dayDate)})`;
    document.getElementById('cell-modal-title').textContent = title;

    // Current selections
    const currentStaff = weekData[shift]?.[dayKey] || [];
    const currentIds = currentStaff.map(s => s.id);

    // Render checkbox list — ONLY receptionist role
    const listEl = document.getElementById('staff-checkbox-list');
    let html = '';

    if (receptionistStaff.length === 0) {
        html = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">
            <p style="margin-bottom:0.5rem">Chưa có nhân viên tiếp tân nào.</p>
            <p style="font-size:0.8rem">Vào <strong>Nhân Sự</strong> để tạo tài khoản với vai trò <strong>Tiếp Tân</strong>.</p>
        </div>`;
    } else {
        receptionistStaff.forEach(user => {
            const checked = currentIds.includes(user.id) ? 'checked' : '';
            const color = user.scheduleColor || '#E5E7EB';
            const fg = getContrastColor(color);
            // Check if this user has custom times
            const existing = currentStaff.find(s => s.id === user.id);
            const hasCustom = existing?.customStart ? true : false;
            const customStart = existing?.customStart || '';
            const customEnd = existing?.customEnd || '';
            html += `
                <label class="staff-checkbox-item">
                    <input type="checkbox" value="${user.id}" data-name="${user.name}" data-color="${color}" ${checked}>
                    <span class="staff-color-dot" style="background:${color};color:${fg}">${user.name.charAt(0)}</span>
                    <span class="staff-pick-name">${user.name}</span>
                    <button type="button" class="btn-custom-time" onclick="toggleCustomTime(this)" title="Lịch đặc biệt" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:1.1rem;opacity:${hasCustom ? '1' : '0.4'}">⏰</button>
                </label>
                <div class="custom-time-row" style="display:${hasCustom ? 'flex' : 'none'};gap:0.5rem;align-items:center;padding:0.25rem 0 0.5rem 2.5rem;font-size:0.8rem;">
                    <span style="color:var(--text-muted)">Giờ đặc biệt:</span>
                    <input type="text" class="time-text custom-start" value="${customStart}" placeholder="HH:MM" maxlength="5" data-uid="${user.id}" style="width:55px;text-align:center;padding:0.2rem;border:1px solid var(--border-color);border-radius:6px;">
                    <span>–</span>
                    <input type="text" class="time-text custom-end" value="${customEnd}" placeholder="HH:MM" maxlength="5" data-uid="${user.id}" style="width:55px;text-align:center;padding:0.2rem;border:1px solid var(--border-color);border-radius:6px;">
                </div>
            `;
        });
    }
    listEl.innerHTML = html;

    // Clear search input
    const searchInput = document.getElementById('modal-staff-search');
    if (searchInput) searchInput.value = '';

    // Note
    const noteKey = `${shift}_${dayKey}`;
    document.getElementById('cell-note-input').value = weekData._notes?.[noteKey] || '';

    document.getElementById('cell-modal').classList.add('open');
}

function closeCellModal() {
    document.getElementById('cell-modal').classList.remove('open');
    editingCell = null;
}

function saveCellData() {
    if (!editingCell) return;
    const { shift, dayKey } = editingCell;

    const checkboxes = document.querySelectorAll('#staff-checkbox-list input[type="checkbox"]:checked');
    const selectedStaff = [];
    checkboxes.forEach(cb => {
        const uid = cb.value;
        const entry = {
            id: uid,
            name: cb.getAttribute('data-name'),
            color: cb.getAttribute('data-color')
        };
        // Check for custom start/end times
        const startInput = document.querySelector(`.custom-start[data-uid="${uid}"]`);
        const endInput = document.querySelector(`.custom-end[data-uid="${uid}"]`);
        if (startInput?.value?.trim()) {
            entry.customStart = startInput.value.trim();
            entry.customEnd = endInput?.value?.trim() || '';
        }
        selectedStaff.push(entry);
    });

    if (!weekData[shift]) weekData[shift] = {};
    weekData[shift][dayKey] = selectedStaff;

    const noteKey = `${shift}_${dayKey}`;
    const note = document.getElementById('cell-note-input').value.trim();
    if (!weekData._notes) weekData._notes = {};
    weekData._notes[noteKey] = note;

    closeCellModal();
    renderTable();  // LOCAL re-render only — no Firestore fetch!
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
};

async function clearCurrentWeek() {
    // Confirmation dialog
    const confirmed = typeof UIService !== 'undefined'
        ? await UIService.confirm('⚠️ Bạn có chắc muốn XÓA TOÀN BỘ lịch tiếp tân tuần này?\n\n(Dữ liệu sẽ bị xóa trên màn hình. Bấm "Lưu Lịch Tuần" để lưu thay đổi.)')
        : confirm('Bạn có chắc muốn xóa toàn bộ lịch tuần này?');

    if (!confirmed) return;

    // Reset all shifts and notes locally
    SHIFTS.forEach(shift => {
        weekData[shift] = {};
        DAY_KEYS.forEach(day => {
            weekData[shift][day] = [];
        });
    });
    weekData._notes = {};

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

async function saveFullWeek() {
    // 1. Fetch CURRENT global config from DB BEFORE we overwrite it, to use as fallback for past days
    let oldShiftConfig = {
        morning: { start: '07:00', end: '11:30' },
        afternoon: { start: '14:00', end: '18:00' },
        evening: { start: '17:30', end: '21:30' }
    };
    try {
        const settings = await DBService.getSystemSettings();
        const branchKey = `receptionistShifts_${currentBranch}`;
        oldShiftConfig = settings?.[branchKey] || settings?.receptionistShifts || oldShiftConfig;
    } catch(e) {}

    // 2. Fetch existing week data to preserve past days' exact schedules
    const key = getWeekCompositeKey();
    let existingData = null;
    try {
        existingData = await DBService.getReceptionistSchedule(key);
    } catch(e) {}

    const todayStr = getLocalDateStr(new Date());

    // 3. Process weekData to lock in shift times for past days
    DAY_KEYS.forEach((dayKey, idx) => {
        const dayDate = new Date(currentWeekStart);
        dayDate.setDate(dayDate.getDate() + idx);
        const dayStr = getLocalDateStr(dayDate);

        if (dayStr < todayStr) {
            SHIFTS.forEach(shift => {
                let currentStaffList = weekData[shift]?.[dayKey] || [];
                currentStaffList = currentStaffList.map(s => {
                    let existingEntry = null;
                    if (existingData && existingData[shift] && existingData[shift][dayKey]) {
                        existingEntry = existingData[shift][dayKey].find(pastS => pastS.id === s.id);
                    }
                    if (existingEntry && existingEntry.customStart) {
                        return { ...s, customStart: existingEntry.customStart, customEnd: existingEntry.customEnd };
                    } else {
                        return {
                            ...s,
                            customStart: s.customStart || oldShiftConfig[shift].start,
                            customEnd: s.customEnd || oldShiftConfig[shift].end
                        };
                    }
                });
                weekData[shift][dayKey] = currentStaffList;
            });
        }
    });

    // 3b. Lock shift times cho các ngày từ hôm nay trở đi (future days)
    // Snapshot giờ ca hiện tại vào customStart/customEnd để tránh bị ảnh hưởng khi global config thay đổi sau này
    DAY_KEYS.forEach((dayKey, idx) => {
        const dayDate = new Date(currentWeekStart);
        dayDate.setDate(dayDate.getDate() + idx);
        const dayStr = getLocalDateStr(dayDate);

        if (dayStr >= todayStr) {
            SHIFTS.forEach(shift => {
                const staffList = weekData[shift]?.[dayKey] || [];
                weekData[shift][dayKey] = staffList.map(s => ({
                    ...s,
                    // Snapshot giờ ca từ UI — ưu tiên customStart đã set, fallback về shiftConfig hiện tại
                    customStart: s.customStart || shiftConfig[shift].start,
                    customEnd: s.customEnd || shiftConfig[shift].end
                }));
            });
        }
    });

    // 3c. Snapshot shiftConfig vào weekData doc để tuần này luôn dùng đúng giờ ca
    readShiftConfigFromUI(); // Đảm bảo shiftConfig đã đọc từ UI
    weekData._shiftConfig = {};
    SHIFTS.forEach(shift => {
        weekData._shiftConfig[shift] = {
            start: shiftConfig[shift].start,
            end: shiftConfig[shift].end
        };
    });

    // 4. Save the new global config from the UI
    await saveShiftConfigToFirestore();

    try {
        // 5. Save the modified weekData to Firestore
        await DBService.saveReceptionistSchedule(key, weekData);

        // Clear inherited state after successful save
        if (isInheritedTemplate) {
            isInheritedTemplate = false;
            const banner = document.getElementById('inherit-banner');
            if (banner) banner.style.display = 'none';
            const tableEl = document.getElementById('schedule-table');
            if (tableEl) tableEl.style.opacity = '1';
        }

        if (typeof UIService !== 'undefined') {
            UIService.toast('Đã lưu lịch tiếp tân!', 'success');
        } else {
            alert('Đã lưu lịch tiếp tân!');
        }
    } catch (e) {
        console.error('Save error:', e);
        const msg = 'Lỗi khi lưu: ' + e.message;
        if (typeof UIService !== 'undefined') {
            UIService.toast(msg, 'error');
        } else {
            alert(msg);
        }
    }
}

// ==================== CONFIRM INHERITED ====================

async function confirmInheritedSchedule() {
    if (!isInheritedTemplate) return;
    // Save the inherited template as this week's data
    await saveFullWeek();
    if (typeof UIService !== 'undefined') {
        UIService.toast('Đã xác nhận lịch kế thừa cho tuần này!', 'success');
    }
}
