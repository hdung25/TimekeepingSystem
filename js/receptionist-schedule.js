// Receptionist Schedule — Week-view horizontal table
// Features: Branch tabs (CS1/CS2), Week picker, 3 shifts × 7 days, Admin edit modal
// Only shows staff with role = 'receptionist' in the picker

// ==================== STATE ====================
let currentBranch = localStorage.getItem('currentBranch') || 'cs1';
let currentWeekStart = getMonday(new Date());
let weekData = {};
let receptionistStaff = [];
let shiftConfig = {
    morning: { label: 'SÁNG', start: '07:00', end: '11:30' },
    afternoon: { label: 'CHIỀU', start: '14:00', end: '18:00' },
    evening: { label: 'TỐI', start: '17:30', end: '21:30' }
};
let editingCell = null;

const isEditor = (() => {
    const role = localStorage.getItem('currentRole') || 'staff';
    return role === 'admin' || role === 'assistant';
})();

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];
const SHIFTS = ['morning', 'afternoon', 'evening'];

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
    if (isEditor) {
        const saveArea = document.getElementById('save-area');
        if (saveArea) saveArea.style.display = '';
    }

    document.querySelectorAll('.branch-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${currentBranch}`)?.classList.add('active');

    // Load staff list — ONLY receptionist role
    try {
        const allUsers = await DBService.getUsers();
        receptionistStaff = allUsers.filter(u => u.role === 'receptionist');
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
        if (settings?.receptionistShifts) {
            const saved = settings.receptionistShifts;
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
        await DBService.saveSystemSettings({ receptionistShifts: data });
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
    loadAndRender();  // Fetch new data from Firestore
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
    weekData = data || {};

    // Ensure structure
    SHIFTS.forEach(shift => {
        if (!weekData[shift]) weekData[shift] = {};
        DAY_KEYS.forEach(day => {
            if (!weekData[shift][day]) weekData[shift][day] = [];
        });
    });
    if (!weekData._notes) weekData._notes = {};

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
                html += `<span class="staff-tag" style="background:${bg};color:${fg}">${s.name}</span>`;
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
            html += `
                <label class="staff-checkbox-item">
                    <input type="checkbox" value="${user.id}" data-name="${user.name}" data-color="${color}" ${checked}>
                    <span class="staff-color-dot" style="background:${color};color:${fg}">${user.name.charAt(0)}</span>
                    <span class="staff-pick-name">${user.name}</span>
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

    if (!weekData[shift]) weekData[shift] = {};
    weekData[shift][dayKey] = selectedStaff;

    const noteKey = `${shift}_${dayKey}`;
    const note = document.getElementById('cell-note-input').value.trim();
    if (!weekData._notes) weekData._notes = {};
    weekData._notes[noteKey] = note;

    closeCellModal();
    renderTable();  // LOCAL re-render only — no Firestore fetch!
}

// ==================== SAVE ====================

async function saveFullWeek() {
    await saveShiftConfigToFirestore();

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
        const msg = 'Lỗi khi lưu: ' + e.message;
        if (typeof UIService !== 'undefined') {
            UIService.toast(msg, 'error');
        } else {
            alert(msg);
        }
    }
}
