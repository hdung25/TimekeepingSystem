// Timekeeping Logic

document.addEventListener('DOMContentLoaded', async () => {
    if (window.waitAuth) {
        await window.waitAuth();
    }
    // Only initialize if we are on the timekeeping page
    if (document.getElementById('timekeeping-container')) {
        initTimekeeping();
        updateClock();
        setInterval(updateClock, 1000);
    }
});

async function initTimekeeping() {
    const container = document.getElementById('global-checkin-container');
    try {
        const settings = await DBService.getSystemSettings();
        window.centerClosures = settings?.centerClosures || {};
        
        // 1. Check Location Permission up-front!
        const campuses = [
            { lat: settings?.gpsCS1Lat, lng: settings?.gpsCS1Lng },
            { lat: settings?.gpsCS2Lat, lng: settings?.gpsCS2Lng },
            { lat: settings?.gpsCS3Lat, lng: settings?.gpsCS3Lng }
        ].filter(c => c.lat !== undefined && c.lat !== null && c.lat !== '');

        if (campuses.length > 0) {
            if (typeof DBService.prepareAttendanceLocationPermission === 'function') {
                try {
                    await DBService.prepareAttendanceLocationPermission();
                } catch (err) {
                    console.warn("Location check failed:", err);
                    if (container) {
                        container.innerHTML = `
                            <div class="glass-panel" style="background: #FEE2E2; border: 2px solid #EF4444; padding: 2rem; text-align: center;">
                                <h2 style="color: #DC2626; font-weight: 700; margin-bottom: 1rem;">IP Mạng không hợp lệ!</h2>
                                <p style="color: #B91C1C; font-size: 1.1rem; line-height: 1.5; margin-bottom: 1.5rem;">
                                    Vui lòng kết nối đúng Wifi của cơ sở để chấm công.
                                </p>
                                <button class="btn" style="background: #DC2626; color: white; padding: 0.75rem 1.5rem; font-size: 1rem; border-radius: 8px;" onclick="retryLocationPermission(this)">
                                    🔄 Thử kết nối lại Wifi
                                </button>
                            </div>
                        `;
                    }
                    return; // Stop initialization of check-in card
                }
            }
        }
    } catch (e) {
        console.warn("Error loading system settings:", e);
        window.centerClosures = {};
    }
    renderGlobalCheckIn();
    renderTodayChips();  // NEW: Show chip status for today's classes
    renderTodayClasses();

    // Run global auto-checkout check once immediately
    if (typeof globalCheckAutoCheckout === 'function') {
        globalCheckAutoCheckout();
    }
}

window.retryLocationPermission = async function (btn) {
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Đang kiểm tra...";
    }
    try {
        if (typeof DBService.prepareAttendanceLocationPermission === 'function') {
            await DBService.prepareAttendanceLocationPermission();
        }
        // If successful, reload/reinitialize timekeeping
        initTimekeeping();
    } catch (e) {
        console.warn("Location permission retry failed:", e);
        // Keep the warning message visible
        const container = document.getElementById('global-checkin-container');
        if (container) {
            container.innerHTML = `
                <div class="glass-panel" style="background: #FEE2E2; border: 2px solid #EF4444; padding: 2rem; text-align: center;">
                    <h2 style="color: #DC2626; font-weight: 700; margin-bottom: 1rem;">IP Mạng không hợp lệ!</h2>
                    <p style="color: #B91C1C; font-size: 1.1rem; line-height: 1.5; margin-bottom: 1.5rem;">
                        Vui lòng kết nối đúng Wifi của cơ sở để chấm công.
                    </p>
                    <button class="btn" style="background: #DC2626; color: white; padding: 0.75rem 1.5rem; font-size: 1rem; border-radius: 8px;" onclick="retryLocationPermission(this)">
                        🔄 Thử kết nối lại Wifi
                    </button>
                </div>
            `;
        }
    }
};

function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isCenterClosed(dateStr, shiftKey, centerClosures) {
    if (!centerClosures || !centerClosures[dateStr]) return false;
    const closures = centerClosures[dateStr];
    return closures.includes('all') || closures.includes(shiftKey);
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
    const dateKey = getLocalDateKey(now);

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
    if (!container) return;

    const today = new Date();
    const dateKey = getLocalDateKey(today);
    const currentUserId = localStorage.getItem('currentUserId');

    // Fetch from BOTH branches
    const BRANCHES = ['cs1', 'cs2', 'cs3'];
    const branchPromises = BRANCHES.map(branch => {
        const compositeKey = `${branch}__${dateKey}`;
        return DBService.getSchedule(compositeKey).then(data => ({ data: data || {}, branch, compositeKey }));
    });

    Promise.all(branchPromises).then(results => {
        let classes = [];
        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];

        results.forEach(({ data: todaySchedule, branch, compositeKey }) => {
            sections.forEach(sec => {
                if (todaySchedule[sec]) {
                    todaySchedule[sec].forEach((cls, idx) => {
                        const isRegistered = (cls.gvId && cls.gvId === currentUserId) ||
                            (cls.registeredTeachers || []).some(t => t.id === currentUserId);
                        if (!isRegistered) return;
                        classes.push({
                            ...cls,
                            section: sec,
                            index: idx,
                            id: `${dateKey}-${sec}-${idx}`,
                            _branch: branch,
                            _compositeKey: compositeKey,
                            _dateKey: dateKey
                        });
                    });
                }
            });
        });

        if (classes.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); padding: 3rem;">
                    <p>Bạn chưa nhận lớp nào hôm nay.</p>
                    <p style="font-size: 0.85rem; margin-top: 0.5rem;">Vào <strong>Lịch Làm</strong> để nhận lớp.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        classes.sort((a, b) => a.start.localeCompare(b.start));

        classes.forEach(cls => {
            const card = createClassCard(cls, cls._compositeKey);
            container.appendChild(card);
        });
    });
}

function createClassCard(cls, compositeKey) {
    const el = document.createElement('div');
    el.className = 'glass-panel class-card';
    el.style.marginBottom = '1.5rem';
    el.style.padding = '1.5rem';
    el.style.display = 'flex';
    el.style.justifyContent = 'space-between';
    el.style.alignItems = 'center';

    const isSectionClosed = isCenterClosed(cls._dateKey, cls.section, window.centerClosures);
    const isClassClosed = cls.isClosed === true;
    const isClosed = isSectionClosed || isClassClosed;
    
    if (isClosed) {
        el.style.borderLeft = isClassClosed ? '5px solid #EF4444' : '5px solid #9CA3AF';
        el.style.backgroundColor = isClassClosed ? '#FEF2F2' : '#F9FAFB';
    } else {
        el.style.borderLeft = '5px solid var(--primary-color)';
    }

    const currentUserId = localStorage.getItem('currentUserId');
    const registeredTeachers = cls.registeredTeachers || [];
    const isRegistered = (cls.gvId && cls.gvId === currentUserId) ||
        (cls.gvThayTheId && cls.gvThayTheId === currentUserId) ||
        registeredTeachers.some(t => t.id === currentUserId);

    // Branch badge
    const branchLabel = cls._branch ? cls._branch.toUpperCase() : 'CS1';
    const branchColors = { cs1: { bg: '#F0FDF4', fg: '#059669' }, cs2: { bg: '#EFF6FF', fg: '#3B82F6' }, cs3: { bg: '#FEF3C7', fg: '#D97706' } };
    const bColor = branchColors[cls._branch] || branchColors.cs1;
    const branchBadge = `<span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:0.7rem; font-weight:700; background:${bColor.bg}; color:${bColor.fg}; margin-left:0.5rem;">${branchLabel}</span>`;

    let statusBadge = '<span style="color: var(--text-muted);">Chưa nhận</span>';
    let actionBtn = `<button class="btn btn-primary" onclick="registerClass('${compositeKey}', '${cls.section}', ${cls.index}, this, '${cls.end}')">Nhận Lớp</button>`;

    if (isClosed) {
        if (isClassClosed) {
            statusBadge = '<span style="color: #EF4444; font-weight: bold;">Lớp nghỉ</span>';
            actionBtn = '<span style="color: #EF4444; font-size: 0.875rem; font-weight: 500;">Lớp đã bị Admin tắt</span>';
        } else {
            statusBadge = '<span style="color: #9CA3AF; font-weight: bold;">Lịch nghỉ trung tâm</span>';
            actionBtn = '<span style="color: #9CA3AF; font-size: 0.875rem;">Lớp đã bị tắt do trung tâm nghỉ</span>';
        }
    } else if (isRegistered) {
        statusBadge = '<span style="color: var(--secondary-color); font-weight: bold;">Đã nhận lớp</span>';
        actionBtn = `<button class="btn btn-secondary" onclick="registerClass('${compositeKey}', '${cls.section}', ${cls.index}, this, '${cls.end}')">Hủy Nhận</button>`;
    }

    el.innerHTML = `
        <div>
            <h3 style="font-size: 1.25rem; font-weight: 700;">${cls.lop || 'Lớp chưa nhập tên'}${branchBadge}</h3>
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

// 4. Register Class Handler (compositeKey = 'cs1__2026-02-21' or plain dateKey)
window.registerClass = async function (compositeKey, section, index, btn, endTimeStr) {
    if (btn) btn.disabled = true;

    const currentUserId = localStorage.getItem('currentUserId');
    const userFullName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser');

    if (!currentUserId) {
        UIService.toast("Vui lòng đăng nhập lại!", "error");
        if (btn) btn.disabled = false;
        return;
    }

    // Time Validation — extract pure dateKey for Date parsing
    if (endTimeStr) {
        const pureDateKey = compositeKey.includes('__') ? compositeKey.split('__')[1] : compositeKey;
        const now = new Date();
        const classEnd = new Date(`${pureDateKey}T${endTimeStr}`);
        if (now > classEnd) {
            UIService.toast("Đã hết giờ học! Không thể nhận lớp khi ca dạy đã kết thúc.", "error");
            if (btn) btn.disabled = false;
            return;
        }
    }

    if (!await UIService.confirm('Xác nhận thay đổi trạng thái nhận lớp?')) {
        if (btn) btn.disabled = false;
        return;
    }

    try {
        const rowMeta = { index };
        const user = { id: currentUserId, name: userFullName };

        await DBService.registerClass(compositeKey, section, rowMeta, user);

        UIService.toast("Cập nhật thành công!", "success");
        renderTodayClasses();
        localStorage.setItem('schedule_registration_updated', Date.now().toString());
    } catch (e) {
        UIService.toast("Lỗi: " + e, "error");
        if (btn) btn.disabled = false;
    }
}

// === NEW: Render Chips Status for Today's Classes ===
function renderTodayChips() {
    const container = document.getElementById('chips-container');
    if (!container) return;

    const today = new Date();
    const dateKey = getLocalDateKey(today);
    const currentUserId = localStorage.getItem('currentUserId');
    const currentUserContext = {
        userId: currentUserId,
        role: localStorage.getItem('currentRole') || 'staff',
        userName: localStorage.getItem('currentUserName') || 'Unknown'
    };

    const BRANCHES = ['cs1', 'cs2', 'cs3'];
    const branchPromises = BRANCHES.map(branch => {
        const compositeKey = `${branch}__${dateKey}`;
        return Promise.all([
            DBService.getSchedule(compositeKey),
            DBService.getPersonalAttendance(dateKey, currentUserId)
        ]).then(([schedule, attendance]) => ({
            schedule: schedule || {},
            attendance: attendance || {},
            branch,
            compositeKey
        }));
    });

    Promise.all(branchPromises).then(results => {
        try {
            // Merge all schedule data
            const mergedSchedule = {};
            const attendanceSessions = [];
            const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];

            results.forEach(({ schedule, attendance, branch }) => {
                sections.forEach(sec => {
                    if (schedule[sec]) {
                        if (!mergedSchedule[sec]) mergedSchedule[sec] = [];
                        mergedSchedule[sec] = mergedSchedule[sec].concat(
                            schedule[sec].map(c => ({ ...c, _branch: branch }))
                        );
                    }
                });
                // Collect attendance sessions from all branches
                if (attendance.sessions) {
                    attendanceSessions.push(...attendance.sessions);
                }
            });

            // Calculate chips for today
            const chips = calculateDailyChips(
                mergedSchedule,
                attendanceSessions,
                currentUserId,
                dateKey,
                currentUserContext
            );

            if (chips.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; color: var(--text-muted); padding: 1.5rem; background: #f9fafb; border-radius: 8px;">
                        <p style="font-size: 0.9rem;">Không có lớp nào hôm nay</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = '';
            chips.forEach(chip => {
                const chipEl = document.createElement('div');
                chipEl.className = `schedule-chip ${chip.class}`;
                chipEl.style.cssText = `
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 0.75rem;
                    padding: 0.75rem 1rem;
                    border-radius: 8px;
                `;
                chipEl.innerHTML = `<span>${chip.text}</span>`;
                
                // Show tooltip on hover
                if (chip.tooltip) {
                    chipEl.title = chip.tooltip;
                }
                
                container.appendChild(chipEl);
            });
        } catch (e) {
            console.error('Error rendering chips:', e);
            container.innerHTML = `<div style="color: var(--text-muted);">Lỗi tải dữ liệu</div>`;
        }
    }).catch(e => {
        console.error('Error loading schedule data:', e);
        container.innerHTML = `<div style="color: var(--text-muted);">Lỗi tải dữ liệu</div>`;
    });
}
