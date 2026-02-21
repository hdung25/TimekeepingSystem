// Receptionist Schedule — Week-view horizontal table
// Features: Branch tabs (CS1/CS2), Week picker, 3 shifts × 7 days, Admin edit modal

// ==================== STATE ====================
let currentBranch = localStorage.getItem('currentBranch') || 'cs1';
let currentWeekStart = getMonday(new Date());  // Always a Monday
let weekData = {};  // { morning: { mon: [...], tue: [...] }, afternoon: {...}, evening: {...} }
let allStaff = [];  // Cached user list
let shiftConfig = {
    morning: { start: '07:00', end: '11:30' },
    afternoon: { start: '14:00', end: '18:00' },
    evening: { start: '17:30', end: '21:30' }
};
let editingCell = null;  // { shift, dayKey }
const isAdmin = (() => {
    const role = localStorage.getItem('currentRole') || 'staff';
    return role === 'admin' || role === 'assistant';
})();

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];
const SHIFTS = ['morning', 'afternoon', 'evening'];
const SHIFT_LABELS = {
    morning: 'SÁNG',
    afternoon: 'CHIỀU',
    evening: 'TỐI'
};

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
    // Show admin controls
    if (isAdmin) {
        const saveArea = document.getElementById('save-area');
        if (saveArea) saveArea.style.display = '';
        const configArea = document.getElementById('shift-config-area');
        if (configArea) configArea.style.display = '';
    }

    // Set active branch tab
    document.getElementById(`tab-${currentBranch}`)?.classList.add('active');

    // Load staff list
    try {
        allStaff = await DBService.getUsers();
    } catch (e) {
        console.error('Failed to load staff', e);
        allStaff = [];
    }

    // Load saved shift config
    await loadShiftConfig();

    // First render
    await renderWeek();
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
    if (!hex) return '#000';
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#000' : '#fff';
}

// ==================== SHIFT CONFIG ====================

async function loadShiftConfig() {
    try {
        const settings = await DBService.getSystemSettings();
        if (settings?.receptionistShifts) {
            shiftConfig = settings.receptionistShifts;
        }
    } catch (e) {
        console.warn('Using default shift config');
    }

    // Apply to UI inputs
    Object.keys(shiftConfig).forEach(shift => {
        const startEl = document.getElementById(`shift-${shift}-start`);
        const endEl = document.getElementById(`shift-${shift}-end`);
        if (startEl) startEl.value = shiftConfig[shift].start;
        if (endEl) endEl.value = shiftConfig[shift].end;
    });
}

async function saveShiftConfig() {
    // Read from UI
    SHIFTS.forEach(shift => {
        const startEl = document.getElementById(`shift-${shift}-start`);
        const endEl = document.getElementById(`shift-${shift}-end`);
        if (startEl && endEl) {
            shiftConfig[shift] = { start: startEl.value, end: endEl.value };
        }
    });

    try {
        await DBService.saveSystemSettings({ receptionistShifts: shiftConfig });
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

    renderWeek();
}

function navigateWeek(offset) {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() + offset * 7);
    currentWeekStart = newDate;
    renderWeek();
}

// ==================== DATA & RENDER ====================

async function renderWeek() {
    // Update week label
    const sunday = new Date(currentWeekStart);
    sunday.setDate(sunday.getDate() + 6);
    const yearStr = sunday.getFullYear();
    const label = `Tuần ${formatDate(currentWeekStart)} - ${formatDate(sunday)}/${yearStr}`;
    document.getElementById('week-label').textContent = label;

    // Update table headers with actual dates
    const ths = document.querySelectorAll('#schedule-table thead th');
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(currentWeekStart);
        dayDate.setDate(dayDate.getDate() + i);
        if (ths[i + 1]) {
            ths[i + 1].innerHTML = `${DAY_LABELS[i]}<br><span style="font-weight:400;font-size:0.75rem;color:var(--text-muted)">${formatDate(dayDate)}</span>`;
        }
    }

    // Fetch data
    const key = getWeekCompositeKey();
    const data = await DBService.getReceptionistSchedule(key);
    weekData = data || { morning: {}, afternoon: {}, evening: {} };

    // Ensure structure
    SHIFTS.forEach(shift => {
        if (!weekData[shift]) weekData[shift] = {};
        DAY_KEYS.forEach(day => {
            if (!weekData[shift][day]) weekData[shift][day] = [];
        });
    });

    // Load notes
    if (!weekData._notes) weekData._notes = {};

    // Render table body
    const tbody = document.getElementById('schedule-body');
    tbody.innerHTML = '';

    SHIFTS.forEach(shift => {
        const tr = document.createElement('tr');

        // Shift label cell
        const shiftTd = document.createElement('td');
        const times = shiftConfig[shift];
        shiftTd.innerHTML = `${SHIFT_LABELS[shift]}<br><span style="font-size:0.7rem;font-weight:400">${times.start}-${times.end}</span>`;
        tr.appendChild(shiftTd);

        // Day cells
        DAY_KEYS.forEach(day => {
            const td = document.createElement('td');
            const staffList = weekData[shift][day] || [];
            const note = weekData._notes?.[`${shift}_${day}`] || '';

            // Render staff tags
            let html = '';
            staffList.forEach(s => {
                const bg = s.color || '#E5E7EB';
                const fg = getContrastColor(bg);
                html += `<span class="staff-tag" style="background:${bg};color:${fg}">${s.name}</span>`;
            });
            if (note) {
                html += `<span class="staff-note">${note}</span>`;
            }
            if (staffList.length === 0 && !note) {
                html = '<span style="color:#ccc;font-size:0.75rem">—</span>';
            }

            td.innerHTML = html;

            if (isAdmin) {
                td.classList.add('editable');
                td.onclick = () => openCellModal(shift, day);
            }

            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}

// ==================== CELL EDITOR MODAL ====================

function openCellModal(shift, dayKey) {
    editingCell = { shift, dayKey };

    // Day label
    const dayIdx = DAY_KEYS.indexOf(dayKey);
    const dayDate = new Date(currentWeekStart);
    dayDate.setDate(dayDate.getDate() + dayIdx);
    const title = `${SHIFT_LABELS[shift]} — ${DAY_LABELS[dayIdx]} (${formatDate(dayDate)})`;
    document.getElementById('cell-modal-title').textContent = title;

    // Current selections
    const currentStaff = weekData[shift]?.[dayKey] || [];
    const currentIds = currentStaff.map(s => s.id);

    // Render checkbox list
    const listEl = document.getElementById('staff-checkbox-list');
    let html = '';

    if (allStaff.length === 0) {
        html = '<p style="color:var(--text-muted);padding:1rem">Không có nhân viên nào trong hệ thống.</p>';
    } else {
        allStaff.forEach(user => {
            if (user.role === 'admin') return; // Don't show admin in staff picker
            const checked = currentIds.includes(user.id) ? 'checked' : '';
            const color = user.scheduleColor || '#E5E7EB';
            html += `
                <label class="staff-checkbox-item">
                    <input type="checkbox" value="${user.id}" data-name="${user.name}" data-color="${color}" ${checked}>
                    <span class="staff-color-dot" style="background:${color}"></span>
                    <span>${user.name}</span>
                    <span style="font-size:0.75rem;color:var(--text-muted);margin-left:auto">${user.role || 'staff'}</span>
                </label>
            `;
        });
    }
    listEl.innerHTML = html;

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
        selectedStaff.push({
            id: cb.value,
            name: cb.getAttribute('data-name'),
            color: cb.getAttribute('data-color')
        });
    });

    // Update weekData
    if (!weekData[shift]) weekData[shift] = {};
    weekData[shift][dayKey] = selectedStaff;

    // Note
    const noteKey = `${shift}_${dayKey}`;
    const note = document.getElementById('cell-note-input').value.trim();
    if (!weekData._notes) weekData._notes = {};
    weekData._notes[noteKey] = note;

    closeCellModal();
    renderWeek();
}

// ==================== SAVE ====================

async function saveFullWeek() {
    // Save shift config first
    await saveShiftConfig();

    const key = getWeekCompositeKey();

    try {
        await DBService.saveReceptionistSchedule(key, weekData);
        if (typeof UIService !== 'undefined') {
            UIService.toast('Đã lưu lịch tiếp tân!', 'success');
        } else {
            alert('Đã lưu lịch tiếp tân!');
        }
    } catch (e) {
        console.error('Save error:', e);
        if (typeof UIService !== 'undefined') {
            UIService.toast('Lỗi khi lưu: ' + e.message, 'error');
        } else {
            alert('Lỗi khi lưu: ' + e.message);
        }
    }
}
