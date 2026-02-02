// Timekeeping Logic

document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if we are on the timekeeping page
    if (document.getElementById('timekeeping-container')) {
        initTimekeeping();
        updateClock();
        setInterval(updateClock, 1000);
    }
});

function initTimekeeping() {
    renderGlobalCheckIn();
    renderTodayClasses();
}

function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 1. Global Check-in Rendering
async function renderGlobalCheckIn() {
    const container = document.getElementById('global-checkin-container');
    if (!container) return;

    const currentUserId = localStorage.getItem('currentUserId');
    if (!currentUserId) {
        container.innerHTML = '<p class="text-muted">Vui lòng đăng nhập để chấm công</p>';
        return;
    }

    // Loading state
    container.innerHTML = '<button class="btn btn-secondary" disabled>Đang tải...</button>';

    // Look up Cloud Data
    const now = new Date();
    const dateKey = now.toISOString().split('T')[0];

    try {
        const attendanceRecord = await DBService.getPersonalAttendance(dateKey, currentUserId);

        // Logic: If record exists AND has checkIn but NO checkOut -> Active Session
        let isActiveSession = false;
        let lastCheckInTime = null;
        let sessions = attendanceRecord ? (attendanceRecord.sessions || []) : [];

        // Support backward compatibility (single field) if needed, but we just overwrote it
        const openSession = sessions.find(s => !s.checkOut);

        if (openSession) {
            isActiveSession = true;
            lastCheckInTime = new Date(openSession.checkIn || openSession.start);
        }

        if (isActiveSession) {
            const timeStr = lastCheckInTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            container.innerHTML = `
                <div class="glass-panel" style="background: #ECFDF5; border: 2px solid var(--primary-color); padding: 2rem; text-align: center;">
                    <h2 style="color: var(--primary-color); font-weight: 700; margin-bottom: 0.5rem;">ĐANG TRONG CA</h2>
                    <div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem;">(Ca hiện tại)</div>
                    <p style="font-size: 1.5rem; margin-bottom: 1.5rem;">Giờ vào: <strong>${timeStr}</strong></p>
                    <button class="btn" style="background: #EF4444; color: white; padding: 1rem 3rem; font-size: 1.25rem;" onclick="globalCheckOut(this)">
                        RA CA
                    </button>
                </div>
            `;
        } else {
            // Check previous sessions
            let title = "BẮT ĐẦU CA LÀM VIỆC";
            let sub = "Vui lòng bấm vào đây khi bạn đến trung tâm";

            if (sessions.length > 0) {
                title = "BẮT ĐẦU CA MỚI";
                sub = "Bạn đã kết thúc ca trước đó. Bấm để bắt đầu ca tiếp theo.";
            }

            container.innerHTML = `
                <div class="glass-panel" style="padding: 2rem; text-align: center;">
                    <h2 style="color: var(--primary-color); font-weight: 700; margin-bottom: 0.5rem;">${title}</h2>
                    <p style="color: var(--text-muted); margin-bottom: 1.5rem;">${sub}</p>
                    <button class="btn btn-primary" style="padding: 1rem 3rem; font-size: 1.25rem; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);" onclick="globalCheckIn(this)">
                        VÀO CA
                    </button>
                </div>
            `;
        }
    } catch (e) {
        console.error(e);
        container.innerHTML = '<p style="color:red">Lỗi tải trạng thái</p>';
    }

    // Call history render separate
    fetchAndRenderHistory(dateKey, currentUserId);
}

// 2. Render History
async function fetchAndRenderHistory(dateKey, userId) {
    const historyContainer = document.getElementById('attendance-history-list');
    if (!historyContainer) return;

    try {
        const record = await DBService.getPersonalAttendance(dateKey, userId);
        const sessions = record ? (record.sessions || []) : [];

        if (sessions.length === 0) {
            historyContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem; font-style: italic;">Chưa có dữ liệu chấm công hôm nay.</p>';
        } else {
            let html = '<table class="history-table"><thead><tr><th>Vào</th><th>Ra</th><th>Xóa</th></tr></thead><tbody>';
            // Show latest first
            [...sessions].reverse().forEach(session => {
                const inTime = new Date(session.checkIn || session.start).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                const outTime = session.checkOut
                    ? new Date(session.checkOut).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                    : '<span style="color: var(--primary-color); font-weight: bold;">---</span>';

                // Use session.id (timestamp) for deletion
                // If session.id is missing (legacy), skip delete button or use index?
                // Better to provide dummy ID or hide button.
                const deleteBtn = session.id
                    ? `<button class="btn-icon" style="color: #EF4444;" onclick="handleDeleteSession('${dateKey}', '${session.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path></svg>
                       </button>`
                    : '';

                html += `<tr><td>${inTime}</td><td>${outTime}</td><td>${deleteBtn}</td></tr>`;
            });
            html += '</tbody></table>';
            historyContainer.innerHTML = html;
        }

    } catch (e) { console.error(e); }
}

window.handleDeleteSession = async function (dateKey, sessionId) {
    if (!confirm("Bạn có chắc chắn muốn xóa lượt chấm công này không?")) return;

    const currentUserId = localStorage.getItem('currentUserId');
    try {
        await DBService.deleteSession(currentUserId, dateKey, sessionId);
        // Refresh UI
        renderGlobalCheckIn();
    } catch (e) {
        alert("Lỗi xóa: " + e.message);
    }
}

function renderTodayClasses() {
    const container = document.getElementById('class-list-container');
    if (!container) return; // Logic check

    const today = new Date();
    const dateKey = getLocalDateKey(today);

    // Get Schedule Data from Firestore? For now let's use global schedule.js logic or fetch
    // Since we are in transition, let's keep using localStorage for SCHEDULE 
    // BUT we need to upgrade this to Firestore for consistency with schedule.js
    // Actually, schedule.js reads from DBService.getSchedule() now.
    // So we should update this too.

    // For now, let's stick to localStorage for Schedule READING to keep it simple, 
    // assuming renderTable updates localStorage? 
    // Wait, schedule.js refactor REMOVED localStorage usage for schedule data.
    // So we MUST fetch from Firestore here too.

    DBService.getSchedule(dateKey).then(todaySchedule => {
        // Flatten
        let classes = [];
        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];

        sections.forEach(sec => {
            if (todaySchedule[sec]) {
                todaySchedule[sec].forEach((cls, idx) => {
                    classes.push({ ...cls, section: sec, index: idx, id: `${dateKey}-${sec}-${idx}` });
                });
            }
        });

        if (classes.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); padding: 3rem;">
                    <p>Hôm nay không có lịch dạy nào.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = '';

        // Sort by Start Time
        classes.sort((a, b) => a.start.localeCompare(b.start));

        classes.forEach(cls => {
            const card = createClassCard(cls, dateKey);
            container.appendChild(card);
        });
    });
}

function createClassCard(cls, dateKey) {
    const el = document.createElement('div');
    el.className = 'glass-panel class-card';
    el.style.marginBottom = '1.5rem';
    el.style.padding = '1.5rem';
    el.style.borderLeft = '5px solid var(--primary-color)';
    el.style.display = 'flex';
    el.style.justifyContent = 'space-between';
    el.style.alignItems = 'center';

    // Check Status (Registered or not)
    const currentUserId = localStorage.getItem('currentUserId');
    const registeredTeachers = cls.registeredTeachers || [];
    const isRegistered = registeredTeachers.some(t => t.id === currentUserId);

    let statusBadge = '<span style="color: var(--text-muted);">Chưa nhận</span>';
    let actionBtn = `<button class="btn btn-primary" onclick="registerClass('${dateKey}', '${cls.section}', ${cls.index}, this, '${cls.end}')">Nhận Lớp</button>`;

    if (isRegistered) {
        statusBadge = '<span style="color: var(--secondary-color); font-weight: bold;">Đã nhận lớp</span>';
        actionBtn = `<button class="btn btn-secondary" onclick="registerClass('${dateKey}', '${cls.section}', ${cls.index}, this, '${cls.end}')">Hủy Nhận</button>`;
    }

    el.innerHTML = `
        <div>
            <h3 style="font-size: 1.25rem; font-weight: 700;">${cls.lop || 'Lớp chưa nhập tên'}</h3>
            <div style="color: var(--text-muted); margin-top: 0.25rem;">
                <span style="display:inline-block; margin-right: 1rem;">🕒 ${cls.start} - ${cls.end}</span>
                <span>🚪 ${cls.phong || 'Chưa xếp phòng'}</span>
            </div>
            <div style="margin-top: 0.5rem; font-size: 0.875rem;">
                 ${registeredTeachers.length > 0 ? `GV: ${registeredTeachers.map(t => t.name).join(', ')}` : 'Chưa có GV'}
            </div>
        </div>
        <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem;">
            ${statusBadge}
            ${actionBtn}
        </div>
    `;

    return el;
}

// 4. Register Class Handler
// 4. Register Class Handler
window.registerClass = async function (dateKey, section, index, btn, endTimeStr) {
    if (btn) btn.disabled = true;

    const currentUserId = localStorage.getItem('currentUserId');
    const userFullName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser');

    if (!currentUserId) {
        UIService.toast("Vui lòng đăng nhập lại!", "error");
        if (btn) btn.disabled = false;
        return;
    }

    // Time Validation (Match logic in schedule.js)
    if (endTimeStr) {
        const now = new Date();
        const classEnd = new Date(`${dateKey}T${endTimeStr}`);
        if (now > classEnd) {
            UIService.toast("Đã hết giờ học! Không thể nhận lớp khi ca dạy đã kết thúc.", "error");
            if (btn) btn.disabled = false;
            return;
        }
    }

    // Confirm
    if (!await UIService.confirm('Xác nhận thay đổi trạng thái nhận lớp?')) {
        if (btn) btn.disabled = false;
        return;
    }

    try {
        const rowMeta = { index };
        const user = { id: currentUserId, name: userFullName };

        await DBService.registerClass(dateKey, section, rowMeta, user);

        UIService.toast("Cập nhật thành công!", "success");
        // Refresh
        renderTodayClasses();
    } catch (e) {
        UIService.toast("Lỗi: " + e, "error");
        if (btn) btn.disabled = false;
    }
}
