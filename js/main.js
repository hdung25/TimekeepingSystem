// Main Logic for Timekeeping System

function parseRoles(roleStr) {
    try {
        const parsed = JSON.parse(roleStr);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch(e) {
        return roleStr ? [roleStr] : [];
    }
}
function hasRole(roleStr, targetRole) {
    return parseRoles(roleStr).includes(targetRole);
}
function hasAnyRole(roleStr, targetRoles) {
    return parseRoles(roleStr).some(r => targetRoles.includes(r));
}

// SELF-XSS WARNING
console.log("%cDừng lại!", "color: red; font-size: 50px; font-weight: bold; text-shadow: 1px 1px 5px black;");
console.log("%cĐây là tính năng của trình duyệt dành cho các nhà phát triển. Nếu ai đó bảo bạn sao chép-dán nội dung nào đó vào đây để bật một tính năng hoặc 'hack' tài khoản của người khác, thì đó là hành vi lừa đảo và sẽ khiến họ có thể truy cập vào tài khoản của bạn.", "font-size: 18px; color: #333;");


async function loadDashboardStats() {
    // Only run on admin page (where stats exist)
    const elTotalUsers = document.getElementById('stat-total-users');
    // If element doesn't exist, we are likely not on admin.html
    if (!elTotalUsers) return;

    try {
        // Show loading state if needed, or keep "..."
        if (typeof DBService === 'undefined' || typeof DBService.getDashboardStats !== 'function') {
            console.warn("DBService not ready");
            return;
        }

        const stats = await DBService.getDashboardStats();

        // Update DOM
        if (elTotalUsers) elTotalUsers.innerText = stats.totalUsers || 0;

        const activeToday = document.getElementById('stat-active-today');
        if (activeToday) activeToday.innerText = stats.checkedInCount || 0;

        // Render Recent Activity
        const tbody = document.getElementById('recent-activity-body');
        if (tbody && stats.recentActivity) {
            if (stats.recentActivity.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 1rem; color: var(--text-muted);">Chưa có hoạt động hôm nay</td></tr>';
            } else {
                tbody.innerHTML = stats.recentActivity.map(act => {
                    const timeStr = new Date(act.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

                    let statusColor = 'var(--text-color)';
                    if (act.status === 'Đúng giờ') statusColor = 'var(--secondary-color)';
                    if (act.status === 'Đang làm việc') statusColor = 'var(--primary-color)';

                    return `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 1rem 0;">${act.user}</td>
                            <td style="padding: 1rem 0;">${timeStr}</td>
                            <td style="padding: 1rem 0; color: ${statusColor}; font-weight: 500;">${act.status}</td>
                        </tr>
                    `;
                }).join('');
            }
        }
    } catch (e) {
        console.error("Failed to load dashboard stats", e);
        if (elTotalUsers) elTotalUsers.innerText = '-';
        const activeToday = document.getElementById('stat-active-today');
        if (activeToday) activeToday.innerText = '-';
        const tbody = document.getElementById('recent-activity-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 1rem; color: #EF4444;">Lỗi tải dữ liệu: ' + e.message + '</td></tr>';
    }

    // Also load unregistered alerts
    loadUnregisteredAlerts();
}

async function loadUnregisteredAlerts() {
    const container = document.getElementById('unregistered-alerts-body');
    const badge = document.getElementById('alert-count-badge');
    if (!container) return;

    try {
        // Fetch tăng ca + sớm 10p pending song song
        const [overtimeRequests, bonus10Requests] = await Promise.all([
            DBService.getPendingOvertimeRequests().catch(() => []),
            DBService.getPendingBonus10Requests().catch(() => [])
        ]);

        const totalCount = overtimeRequests.length + bonus10Requests.length;

        if (totalCount === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 1rem;">✅ Không có yêu cầu nào chờ duyệt.</p>';
            if (badge) badge.style.display = 'none';
            return;
        }

        if (badge) {
            badge.innerText = totalCount;
            badge.style.display = 'inline';
        }

        let html = '';

        // Render Sớm 10p requests
        bonus10Requests.forEach(req => {
            html += `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;border-bottom:1px solid var(--border-color);background:#F5F3FF;">
                    <div>
                        <span style="background:#7C3AED;color:white;padding:1px 6px;border-radius:4px;font-size:0.75rem;font-weight:700;margin-right:0.5rem;">⭐ SỚM 10P</span>
                        <strong>${req.staffName || 'N/A'}</strong>
                        <span style="color:var(--text-muted);margin-left:0.5rem;">Ngày ${req.dateKey || ''}</span>
                    </div>
                    <a href="bao-cao.html?staffId=${req.staffId}" class="btn"
                        style="background:#7C3AED;color:white;padding:0.4rem 1rem;font-size:0.85rem;text-decoration:none;">
                        Xem &amp; Duyệt
                    </a>
                </div>
            `;
        });

        // Render Tăng ca requests
        overtimeRequests.forEach(ot => {
            html += `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;border-bottom:1px solid var(--border-color);background:#FFFBEB;">
                    <div>
                        <span style="background:#F59E0B;color:white;padding:1px 6px;border-radius:4px;font-size:0.75rem;font-weight:700;margin-right:0.5rem;">⏱️ TĂNG CA</span>
                        <strong>${ot.staffName || 'N/A'}</strong>
                        <span style="color:var(--text-muted);margin-left:0.5rem;">Ngày ${ot.dateKey} — +${ot.duration}</span>
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button class="btn" onclick="rejectOvertimeFromDashboard('${ot.id}', this)"
                            style="background:#FEE2E2;color:#DC2626;border:1px solid #FECACA;padding:0.4rem 0.75rem;font-size:0.85rem;">
                            ❌ Từ Chối
                        </button>
                        <a href="bao-cao.html?staffId=${ot.staffId}" class="btn"
                            style="background:#F59E0B;color:white;padding:0.4rem 1rem;font-size:0.85rem;text-decoration:none;">
                            Xem &amp; Duyệt
                        </a>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

    } catch (e) {
        console.warn('[Alerts] Error loading:', e);
        container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">Không tải được yêu cầu.</p>';
    }
}

// Auto-refresh alerts every 30 seconds on admin dashboard
if (document.getElementById('unregistered-alerts-body')) {
    setInterval(() => loadUnregisteredAlerts(), 30000);
}

window.resolveAlertBtn = async function (alertId, btn) {
    if (btn) btn.disabled = true;
    const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';
    try {
        await DBService.resolveAlert(alertId, adminName);
        // Reload alerts
        loadUnregisteredAlerts();
    } catch (e) {
        alert("Lỗi: " + e.message);
        if (btn) btn.disabled = false;
    }
};

window.rejectOvertimeFromDashboard = async function(requestId, btn) {
    if (btn) btn.disabled = true;
    const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';
    try {
        await DBService.rejectOvertimeRequest(requestId, adminName);
        loadUnregisteredAlerts(); // Refresh list
        if (typeof UIService !== 'undefined') UIService.toast('Đã từ chối yêu cầu tăng ca.', 'info');
    } catch(e) {
        if (btn) btn.disabled = false;
        if (typeof UIService !== 'undefined') UIService.toast('Lỗi: ' + e.message, 'error');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // ... (Startup logic)
    console.log('Timekeeping System Loaded');

    // Login Handling
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
        // ... animation ...
    } else {
        // AUTH GUARD: Require login for ALL internal pages
        const currentUser = localStorage.getItem('currentUser');
        const currentUserId = localStorage.getItem('currentUserId');
        if (!currentUser || !currentUserId) {
            // Not logged in → redirect to login page
            window.location.href = 'index.html';
            return;
        }

        // We are inside the app, render sidebar
        renderSidebar();
        loadDashboardStats(); // Fetch real data
        
        // Refresh alerts khi user quay lại tab/window này
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                if (document.getElementById('unregistered-alerts-body')) {
                    loadUnregisteredAlerts();
                }
            }
        });

        // ===== STAFF NOTIFICATION BELL =====
        const roleRaw = localStorage.getItem('currentRole') || 'staff';
        const roles = parseRoles(roleRaw);
        if (!roles.some(r => r === 'admin' || r === 'senior_assistant')) {
            loadStaffNotifications();
            loadStaffPersonalCharts();
        }
        // Senior assistant uses admin dashboard, no personal charts needed

        // Check if "Back to Admin" button should be shown
        if (currentUser === 'admin') {
            const btnBack = document.getElementById('btn-back-admin');
            if (btnBack) {
                btnBack.style.display = 'inline-flex';
                btnBack.style.setProperty('display', 'inline-flex', 'important');
            }
        }

        // Live Clock
        const clockElement = document.getElementById('live-clock');
        if (clockElement) {
            updateClock();
            setInterval(updateClock, 1000);
        }

        // Check for openTab param
        const urlParams = new URLSearchParams(window.location.search);
        const tab = urlParams.get('openTab');
        if (tab && typeof switchTab === 'function') {
            setTimeout(() => switchTab(tab), 100);
        }

        // ===== GLOBAL AUTO-CHECKOUT (runs on ALL pages) =====
        // Ensures receptionist/teacher shifts are auto-closed even if user
        // navigates away from the Chấm Công page.
        setTimeout(() => {
            globalCheckAutoCheckout(); // Run once after 5s
            setInterval(globalCheckAutoCheckout, 60 * 1000); // Then every 60s
            console.log('[Global] Auto-checkout interval started');
        }, 5000);
    }
});

// ================= GLOBAL AUTO-CHECKOUT FUNCTION =================
// Runs on ALL pages. Checks if user has an open session and their shift/class has ended.
async function globalCheckAutoCheckout() {
    const currentUserId = localStorage.getItem('currentUserId');
    if (!currentUserId) return;
    if (typeof DBService === 'undefined') return;

    const now = new Date();
    const dateKey = getLocalDateKeyFromDate(now);

    try {
        // 1. Check if user has an open session today
        const attendance = await DBService.getPersonalAttendance(dateKey, currentUserId);
        if (!attendance) return;
        const sessions = attendance.sessions || [];
        const openSession = sessions.find(s => !s.checkOut);
        if (!openSession) return; // No open session → nothing to auto-close

        // 2. Determine when the user's current shift/class ends
        const roleRaw = localStorage.getItem('currentRole') || 'staff';
        let rolesAC = [];
        try { const p = JSON.parse(roleRaw); rolesAC = Array.isArray(p) ? p : [roleRaw]; }
        catch(e) { rolesAC = [roleRaw]; }
        const checkInTime = new Date(openSession.checkIn || openSession.start);

        const isReceptionistRole = rolesAC.some(r =>
            ['receptionist', 'receptionist_assistant', 'senior_assistant'].includes(r)
        );

        if (isReceptionistRole) {
            // === RECEPTIONIST: find shift end based on schedule ===
            await autoCheckoutReceptionist(currentUserId, checkInTime, now, dateKey);
        } else {
            // === TEACHER/STAFF: find class end from schedule ===
            await autoCheckoutTeacher(currentUserId, checkInTime, now, dateKey);
        }
    } catch (e) {
        console.warn("[GlobalAutoCheckout] Error:", e);
    }
}

async function autoCheckoutReceptionist(userId, checkInTime, now, dateKey) {
    try {
        const SHIFT_KEYS = ['morning', 'afternoon', 'evening'];
        const DAY_KEYS_MAP = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const BRANCHES = ['cs1', 'cs2', 'cs3'];

        const getMonday = (d) => {
            const date = new Date(d);
            const day = date.getDay();
            const diff = date.getDate() - day + (day === 0 ? -6 : 1);
            date.setDate(diff);
            date.setHours(0, 0, 0, 0);
            return date;
        };

        const monday = getMonday(now);
        const mondayKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
        const dayOfWeek = now.getDay();
        const dayIdx = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const dayKey = DAY_KEYS_MAP[dayIdx];

        // Tìm TẤT CẢ shifts của nhân viên hôm nay
        let allShifts = []; // [{ shiftStart, shiftEnd }]

        for (const branch of BRANCHES) {
            const compositeKey = `${branch}__${mondayKey}`;
            const weekData = await DBService.getReceptionistSchedule(compositeKey);
            if (!weekData) continue;

            const branchShiftConfig = await DBService.getReceptionistShiftConfig(branch);

            for (const shiftKey of SHIFT_KEYS) {
                const shiftData = weekData[shiftKey];
                if (!shiftData || !shiftData[dayKey]) continue;

                const staffEntry = shiftData[dayKey].find(s => s.id === userId);
                if (!staffEntry) continue;

                // Dùng _shiftConfig từ weekData nếu có
                const weekShiftCfg = weekData._shiftConfig?.[shiftKey];
                const startStr = staffEntry.customStart || weekShiftCfg?.start || branchShiftConfig[shiftKey]?.start || '07:00';
                const endStr = staffEntry.customEnd || weekShiftCfg?.end || branchShiftConfig[shiftKey]?.end || '11:30';

                // FIX: dùng local time, tránh UTC parse gây lệch 7h
                const [_acy, _acm, _acd] = dateKey.split('-').map(Number);
                const [_ssh, _ssm] = startStr.split(':').map(Number);
                const [_seh, _sem] = endStr.split(':').map(Number);
                const shiftStart = new Date(_acy, _acm - 1, _acd, _ssh, _ssm, 0, 0);
                const shiftEnd = new Date(_acy, _acm - 1, _acd, _seh, _sem, 0, 0);

                allShifts.push({ shiftStart, shiftEnd, startStr, endStr });
            }
        }

        if (allShifts.length === 0) return;

        // Merge các ca tiếp giáp (end === start)
        allShifts.sort((a, b) => a.shiftStart - b.shiftStart);
        const mergedShifts = [{ ...allShifts[0] }];
        for (let i = 1; i < allShifts.length; i++) {
            const prev = mergedShifts[mergedShifts.length - 1];
            const curr = allShifts[i];
            if (prev.endStr === curr.startStr) {
                // Tiếp giáp → merge
                prev.shiftEnd = curr.shiftEnd;
                prev.endStr = curr.endStr;
            } else {
                mergedShifts.push({ ...curr });
            }
        }

        // Tìm shift khớp với checkInTime (±60p của shift start)
        const matchedShift = mergedShifts.find(s => {
            const diffMs = Math.abs(checkInTime - s.shiftStart);
            return diffMs < 60 * 60 * 1000;
        });

        if (!matchedShift) return;

        // Checkout đúng giờ kết thúc ca
        if (now >= matchedShift.shiftEnd) {
            console.log(`[GlobalAutoCheckout] Receptionist shift ended at ${matchedShift.shiftEnd.toLocaleTimeString()}. Auto checking out...`);
            await DBService.checkOutPersonal(userId);
            if (typeof UIService !== 'undefined' && UIService.toast) {
                UIService.toast('Đã tự động Ra Ca (hết giờ ca tiếp tân)', 'success');
            }
            if (typeof renderGlobalCheckIn === 'function') {
                await renderGlobalCheckIn();
            }
        }
    } catch (e) {
        console.warn('[GlobalAutoCheckout] Receptionist error:', e);
    }
}

async function autoCheckoutTeacher(userId, checkInTime, now, dateKey) {
    try {
        const BRANCHES = ['cs1', 'cs2', 'cs3'];
        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];

        // Find the class that matches the check-in time
        let matchedClassEnd = null;

        for (const branch of BRANCHES) {
            const compositeKey = `${branch}__${dateKey}`;
            const schedule = await DBService.getSchedule(compositeKey);
            if (!schedule) continue;

            sections.forEach(sec => {
                if (!schedule[sec]) return;
                schedule[sec].forEach(cls => {
                    const isRegistered = (cls.registeredTeachers || []).some(t => t.id === userId);
                    if (!isRegistered) return;

                    // FIX: dùng local time, tránh UTC parse gây lệch 7h
                    const [_tcy, _tcm, _tcd] = dateKey.split('-').map(Number);
                    const [_csh, _csm] = cls.start.split(':').map(Number);
                    const [_ceh, _cem] = cls.end.split(':').map(Number);
                    const classStart = new Date(_tcy, _tcm - 1, _tcd, _csh, _csm, 0, 0);
                    const classEnd = new Date(_tcy, _tcm - 1, _tcd, _ceh, _cem, 0, 0);

                    // Match: check-in is within ±60 min of class start
                    const diffMs = Math.abs(checkInTime - classStart);
                    if (diffMs < 60 * 60 * 1000) {
                        if (!matchedClassEnd || classEnd < matchedClassEnd) {
                            matchedClassEnd = classEnd;
                        }
                    }
                });
            });
        }

        if (matchedClassEnd && now >= matchedClassEnd) {
            console.log(`[GlobalAutoCheckout] Class ended at ${matchedClassEnd.toLocaleTimeString()}. Auto checking out...`);
            await DBService.checkOutPersonal(userId);
            if (typeof UIService !== 'undefined' && UIService.toast) {
                UIService.toast("Đã tự động Ra Ca (hết giờ lớp)", "success");
            }
            if (typeof renderGlobalCheckIn === 'function') {
                await renderGlobalCheckIn();
            }
        }
    } catch (e) {
        console.warn("[GlobalAutoCheckout] Teacher error:", e);
    }
}

// ================= STAFF NOTIFICATIONS =================
async function loadStaffNotifications() {
    const staffId = localStorage.getItem('currentUserId');

    if (!staffId || typeof DBService === 'undefined') {
        return;
    }

    try {
        const notifications = await DBService.getStaffNotifications(staffId);
        if (notifications.length === 0) return;

        // Create floating bell
        const bell = document.createElement('div');
        bell.id = 'notif-bell';
        bell.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:999;cursor:pointer;background:white;border-radius:50%;width:48px;height:48px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 15px rgba(0,0,0,0.15);border:2px solid #3B82F6;transition:transform 0.2s';
        bell.innerHTML = `
            <span style="font-size:1.5rem">🔔</span>
            <span id="notif-badge" style="position:absolute;top:-4px;right:-4px;background:#EF4444;color:white;font-size:0.7rem;font-weight:700;min-width:20px;height:20px;border-radius:10px;display:flex;align-items:center;justify-content:center;padding:0 4px">${notifications.length}</span>
        `;
        bell.onmouseover = () => { bell.style.transform = 'scale(1.1)'; };
        bell.onmouseout = () => { bell.style.transform = 'scale(1)'; };
        bell.onclick = () => showNotificationPopup(notifications);
        document.body.appendChild(bell);

        // Pulse animation
        bell.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(1.15)' },
            { transform: 'scale(1)' }
        ], { duration: 600, iterations: 3 });

    } catch (e) {
        console.error('[Notif Bell] Error:', e);
    }
}

function showNotificationPopup(notifications) {
    // Remove existing popup
    const existing = document.getElementById('notif-popup-overlay');
    if (existing) existing.remove();

    const actionLabels = {
        'add_session': '➕ Thêm ca',
        'edit_session': '✏️ Sửa giờ',
        'delete_session': '🗑️ Xóa ca',
        'select_role': '🎯 Chọn vai trò'
    };

    const overlay = document.createElement('div');
    overlay.id = 'notif-popup-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:5rem;animation:fadeIn 0.2s ease';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const popup = document.createElement('div');
    popup.style.cssText = 'background:white;border-radius:16px;max-width:450px;width:90%;max-height:70vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:slideUp 0.3s ease';

    const header = `
        <div style="padding:1.25rem;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:white;border-radius:16px 16px 0 0;z-index:1">
            <h3 style="margin:0;font-size:1.1rem;font-weight:700;color:#1F2937">🔔 Thông Báo</h3>
            <span style="color:#6B7280;font-size:0.85rem">${notifications.length} mới</span>
        </div>
    `;

    const items = notifications.map(n => {
        const actionLabel = actionLabels[n.action] || n.action;
        const timeStr = n.createdAt ? new Date(n.createdAt.seconds * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
        return `
            <div style="padding:1rem 1.25rem;border-bottom:1px solid #F3F4F6">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem">
                    <span style="font-size:0.85rem;font-weight:600;color:#3B82F6">${actionLabel}</span>
                    <span style="font-size:0.75rem;color:#9CA3AF">${timeStr}</span>
                </div>
                <div style="font-size:0.85rem;color:#374151">${n.details || ''}</div>
                <div style="font-size:0.75rem;color:#9CA3AF;margin-top:0.25rem">Ngày: ${n.dateKey || ''} · Bởi: ${n.adminName || 'Admin'}</div>
            </div>
        `;
    }).join('');

    const footer = `
        <div style="padding:1rem 1.25rem;border-top:1px solid #E5E7EB;text-align:center;position:sticky;bottom:0;background:white;border-radius:0 0 16px 16px">
            <button id="btn-mark-all-read" style="background:#3B82F6;color:white;border:none;padding:0.6rem 1.5rem;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.9rem;transition:opacity 0.2s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">✅ Đã đọc tất cả</button>
        </div>
    `;

    popup.innerHTML = header + items + footer;
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    document.getElementById('btn-mark-all-read').onclick = async () => {
        const staffId = localStorage.getItem('currentUserId');
        await DBService.markAllNotificationsRead(staffId);
        overlay.remove();
        const bell = document.getElementById('notif-bell');
        if (bell) bell.remove();
    };
}

// ================= STAFF PERSONAL CHARTS =================
async function loadStaffPersonalCharts() {
    const punctCanvas = document.getElementById('staff-chart-punctuality');
    const weeklyCanvas = document.getElementById('staff-chart-weekly');
    if (!punctCanvas || !weeklyCanvas) return;
    if (typeof Chart === 'undefined' || typeof ChartService === 'undefined') return;

    const userId = localStorage.getItem('currentUserId');
    if (!userId) return;

    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    try {
        // Single batch fetch, then synchronous processing
        const { allLogs, schedules } = await ChartService.loadMonthData(monthStr);
        const punctData = ChartService.getStaffPunctuality(allLogs, schedules, userId);
        const weeklyData = ChartService.getWeeklyHours(allLogs, monthStr, userId);

        // Punctuality Doughnut
        if (punctData.total > 0) {
            new Chart(punctCanvas, {
                type: 'doughnut',
                data: {
                    labels: ['Đúng giờ', 'Trễ', 'Vắng'],
                    datasets: [{
                        data: [punctData.ontime, punctData.late, punctData.absent],
                        backgroundColor: ['rgba(16,185,129,0.8)', 'rgba(245,158,11,0.85)', 'rgba(156,163,175,0.8)'],
                        borderWidth: 3, borderColor: '#fff', hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, cutout: '62%',
                    plugins: {
                        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16 } },
                        tooltip: {
                            backgroundColor: 'rgba(17,24,39,0.9)', padding: 12, cornerRadius: 8,
                            callbacks: {
                                label: (ctx) => {
                                    const pct = Math.round(ctx.raw / punctData.total * 100);
                                    return `  ${ctx.label}: ${ctx.raw} ca (${pct}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Weekly Hours Bar
        if (weeklyData.length > 0 && weeklyData.some(d => d.hours > 0)) {
            const avg = weeklyData.reduce((a, b) => a + b.hours, 0) / weeklyData.length;
            new Chart(weeklyCanvas, {
                type: 'bar',
                data: {
                    labels: weeklyData.map(d => d.week),
                    datasets: [{
                        label: 'Giờ làm',
                        data: weeklyData.map(d => d.hours),
                        backgroundColor: weeklyData.map(d => d.hours >= avg ? 'rgba(16,185,129,0.8)' : 'rgba(245,158,11,0.85)'),
                        borderRadius: 10, borderSkipped: false, barThickness: 36
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(17,24,39,0.9)', padding: 12, cornerRadius: 8,
                            callbacks: { label: (ctx) => `  ${ctx.raw} giờ` }
                        }
                    },
                    scales: {
                        y: { beginAtZero: true, title: { display: true, text: 'Giờ', font: { size: 11 }, color: '#9CA3AF' }, grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    } catch (e) {
        console.warn('[StaffCharts] Error:', e);
    }
}
// ================= AUTH LOGIC =================

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const btn = e.target.querySelector('button');
    console.log("Login button clicked");

    // Quick Debug: Check DB
    if (typeof db === 'undefined') {
        alert("Lỗi: Kết nối Database thất bại (db undefined). Kiểm tra internet!");
        return;
    }

    // UI Loading State
    const originalText = btn.innerText;
    btn.innerText = 'Đang kiểm tra...';
    btn.disabled = true;

    // Hide previous error
    const errorDiv = document.getElementById('login-error');
    if (errorDiv) errorDiv.style.display = 'none';

    try {
        // Call Secure Cloud Login
        // DBService.loginUser now throws Error if fail
        const user = await DBService.loginUser(username, password);

        if (user) {
            // Save Session
            localStorage.setItem('currentUser', user.username);
            // Lưu roles: nếu user.roles là array thì stringify, nếu không thì dùng user.role
            const rolesValue = Array.isArray(user.roles) && user.roles.length > 0
                ? JSON.stringify(user.roles)
                : (user.role || 'staff');
            localStorage.setItem('currentRole', rolesValue);
            localStorage.setItem('currentUserId', user.id);
            localStorage.setItem('userFullName', user.name);

            // Redirect
            const loginRoles = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role];
            if (loginRoles.some(r => r === 'admin' || r === 'senior_assistant')) {
                window.location.href = 'admin.html';
            } else {
                window.location.href = 'nhan-vien.html';
            }
        }
    } catch (error) {
        console.error(error);
        // Show red error message inline
        if (errorDiv) {
            errorDiv.innerText = error.message;
            errorDiv.style.display = 'block';
        }
        btn.innerText = originalText;
        btn.disabled = false;
    }
}



function renderSidebar() {
    const sidebarNav = document.getElementById('sidebar-nav') || document.querySelector('.sidebar nav');
    if (!sidebarNav) return;

    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    const roles = parseRoles(roleRaw);
    // Compat: role = role ưu tiên cao nhất (admin > senior_assistant > assistant > teaching_assistant > receptionist > receptionist_assistant > staff)
    const ROLE_PRIORITY = ['admin','senior_assistant','assistant','teaching_assistant','receptionist','receptionist_assistant','staff'];
    const role = ROLE_PRIORITY.find(r => roles.includes(r)) || roles[0] || 'staff';

    // Dynamic Naming logic
    let scheduleName = 'Lịch Làm';
    let reportName = 'Bảng Công';

    if (roles.some(r => ['admin', 'assistant', 'senior_assistant'].includes(r))) {
        scheduleName = 'Xếp Lịch';
    }
    if (roles.some(r => ['admin', 'senior_assistant'].includes(r))) {
        reportName = 'Tính Lương';
    }

    // Define Menu Items
    const menuItems = [
        { name: 'Tổng Quan', link: 'admin.html', icon: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>', roles: ['admin', 'senior_assistant'] },
        { name: 'Nhân Sự', link: 'nhan-su.html', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>', roles: ['admin', 'senior_assistant'] },
        { name: 'Bảng Cá Nhân', link: 'nhan-vien.html', icon: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>', roles: ['staff', 'assistant', 'receptionist', 'receptionist_assistant', 'teaching_assistant'] },
        // Chấm Công: Visible for Staff, Assistant, Receptionist
        { name: 'Chấm Công', link: 'cham-cong.html', icon: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>', roles: ['staff', 'assistant', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'teaching_assistant'] },
        { name: scheduleName, link: 'lich-lam.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>', roles: ['admin', 'senior_assistant', 'staff', 'assistant', 'receptionist', 'receptionist_assistant', 'teaching_assistant'] },
        { name: 'Lịch Tiếp Tân', link: 'lich-tiep-tan.html', icon: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>', roles: ['admin', 'senior_assistant', 'receptionist', 'receptionist_assistant'] },
        { name: reportName, link: 'bao-cao.html', icon: '<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>', roles: ['admin', 'senior_assistant', 'staff', 'assistant', 'receptionist', 'receptionist_assistant', 'teaching_assistant'] },
        { name: 'Hệ Thống', link: 'he-thong.html', icon: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>', roles: ['admin', 'senior_assistant'] },
        // NEW: Maintenance
        {
            name: 'Bảo Trì',
            link: '#',
            id: 'nav-maintenance',
            event: "switchTab('tab-maintenance', event); return false;",
            icon: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>',
            roles: ['admin', 'senior_assistant']
        },
        // NEW: Analytics
        {
            name: 'Thống Kê',
            link: '#',
            id: 'nav-analytics',
            event: "switchTab('tab-analytics', event); return false;",
            icon: '<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>',
            roles: ['admin', 'senior_assistant']
        }
    ];



    // Generate Profile Section
    const fullName = localStorage.getItem('userFullName') || 'Người Dùng';
    let displayRole = 'Nhân Viên';
    if (role === 'admin') displayRole = 'Quản Trị Viên';
    if (role === 'assistant') displayRole = 'Trợ Lý';
    if (role === 'receptionist') displayRole = 'Tiếp Tân';
    if (role === 'receptionist_assistant') displayRole = 'Trợ Lí Tiếp Tân';
    if (role === 'teaching_assistant') displayRole = 'Trợ giảng/ GV TA';
    if (role === 'senior_assistant') displayRole = 'Trợ Lý Cấp Cao';

    // Nếu có nhiều role → ghép lại
    if (roles.length > 1) {
        const roleLabels = {
            'admin': 'Quản Trị Viên',
            'senior_assistant': 'Trợ Lý Cấp Cao',
            'assistant': 'Trợ Lý',
            'teaching_assistant': 'Trợ giảng/ GV TA',
            'receptionist': 'Tiếp Tân',
            'receptionist_assistant': 'Trợ Lí Tiếp Tân',
            'staff': 'Nhân Viên'
        };
        displayRole = roles.map(r => roleLabels[r] || r).join(' · ');
    }

    const profileHtml = `
        <div class="user-profile-widget" style="
            padding: 1rem;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, var(--bg-body) 0%, #FFFFFF 100%);
            border-radius: var(--radius-md);
            border: 1px solid var(--border-color);
            color: var(--text-main);
            box-shadow: var(--shadow-sm);
        ">
            <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7; color: var(--text-muted);">Xin chào,</div>
            <div style="font-weight: 700; font-size: 1rem; margin: 0.25rem 0; color: var(--primary-color);">${fullName}</div>
            <div style="font-size: 0.75rem; background: rgba(5, 150, 105, 0.1); color: var(--primary-color); display: inline-block; padding: 2px 8px; border-radius: 12px; font-weight: 500;">
                ${displayRole}
            </div>
        </div>
    `;

    sidebarNav.innerHTML = profileHtml;

    // Ensure Back Button Visibility with a retry mechanism
    if (localStorage.getItem('currentUser') === 'admin') {
        const checkBtnInterval = setInterval(() => {
            const btnBack = document.getElementById('btn-back-admin');
            if (btnBack) {
                btnBack.style.setProperty('display', 'inline-flex', 'important');
                clearInterval(checkBtnInterval);
            }
        }, 500);
        // Clear interval after 5 seconds to avoid infinite loop
        setTimeout(() => clearInterval(checkBtnInterval), 5000);
    }

    menuItems.forEach(item => {
        if (item.roles.some(r => roles.includes(r))) {
            const isActive = window.location.pathname.includes(item.link);
            const clickAttr = item.event ? `onclick="${item.event}"` : '';
            const idAttr = item.id ? `id="${item.id}"` : '';

            sidebarNav.innerHTML += `
                <a href="${item.link}" class="nav-link ${isActive ? 'active' : ''}" ${idAttr} ${clickAttr}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        ${item.icon}
                    </svg>
                    ${item.name}
                </a>
            `;
        }
    });

    sidebarNav.innerHTML += `
        <a href="index.html" class="nav-link" style="margin-top: auto; color: #ef4444;" onclick="localStorage.removeItem('currentUser'); localStorage.removeItem('currentRole'); localStorage.removeItem('currentUserId');">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            Đăng Xuất
        </a>
        `;

    // ===== LOGO → HOMEPAGE LINK =====
    const logoArea = document.querySelector('.logo-area');
    if (logoArea) {
        const homePage = (role === 'admin' || role === 'assistant' || role === 'senior_assistant') ? 'admin.html' : 'nhan-vien.html';
        const logoImg = logoArea.querySelector('img');
        const logoText = logoArea.querySelector('span');

        // Wrap logo content in a link
        if (logoImg && !logoArea.querySelector('a.logo-link')) {
            const link = document.createElement('a');
            link.href = homePage;
            link.className = 'logo-link';
            link.style.cssText = 'display:flex; align-items:center; gap:0.5rem; text-decoration:none; color:inherit;';
            link.appendChild(logoImg.cloneNode(true));
            if (logoText) link.appendChild(logoText.cloneNode(true));

            // Clear and re-add
            logoArea.innerHTML = '';
            logoArea.appendChild(link);
        }
    }

    // ===== MOBILE: Header Bar + Slide-in Sidebar =====
    _setupMobileNav(role);

    // ===== Close sidebar when clicking a nav link on mobile =====
    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) _closeMobileSidebar();
        });
    });
}

// ===== Mobile Nav Setup =====
function _setupMobileNav(role) {
    // Only create once
    if (document.querySelector('.mobile-header')) return;

    const homePage = (role === 'admin' || role === 'assistant' || role === 'senior_assistant') ? 'admin.html' : 'nhan-vien.html';

    // Create mobile header bar
    const header = document.createElement('div');
    header.className = 'mobile-header';
    header.style.display = 'none'; // CSS shows it on mobile via !important
    header.innerHTML = `
        <button class="hamburger-btn" onclick="_toggleMobileSidebar()" aria-label="Menu">☰</button>
        <a href="${homePage}" class="mobile-logo">
            <img src="images/TUDUYTRE.jpg" alt="Logo">
            <span>NGOẠI NGỮ & TOÁN TƯ DUY TRẺ</span>
        </a>
    `;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.onclick = () => _closeMobileSidebar();

    // Insert before admin-container
    const container = document.querySelector('.admin-container');
    if (container) {
        container.parentNode.insertBefore(header, container);
        container.parentNode.insertBefore(overlay, container);
    }
}

function _toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    const btn = document.querySelector('.mobile-header .hamburger-btn');

    if (sidebar) {
        const isOpen = sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('active', isOpen);
        if (btn) btn.innerHTML = isOpen ? '✕' : '☰';
    }
}

function _closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    const btn = document.querySelector('.mobile-header .hamburger-btn');

    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    if (btn) btn.innerHTML = '☰';
}


// ... (Rest of logic: updateClock, Global Check-in etc.) ...
// Note: Global Functions (confirmClass, globalCheckIn/Out) are mainly for Staff, 
// but we keep them here for consistency or testing.
// ================= UTILITIES =================

function updateClock() {
    const now = new Date();
    const clockElement = document.getElementById('live-clock');
    if (clockElement) {
        // Format: HH:MM:SS - DD/MM/YYYY
        const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false });
        const dateStr = now.toLocaleDateString('vi-VN');
        clockElement.innerText = `${timeStr} - ${dateStr} `;
    }
}

function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year} -${month} -${day} `;
}

window.confirmClass = async function (id) {
    if (!await UIService.confirm('Xác nhận nhận lớp này?')) return;
    const timesheetData = JSON.parse(localStorage.getItem('timesheet_data')) || {};
    const now = new Date();
    timesheetData[id] = {
        confirmedAt: now.toISOString(),
        type: 'confirmed'
    };
    localStorage.setItem('timesheet_data', JSON.stringify(timesheetData));
    if (window.location.pathname.includes('cham-cong.html')) {
        if (typeof renderTodayClasses === 'function') renderTodayClasses();
    } else if (window.location.pathname.includes('lich-lam.html')) {
        if (typeof renderTable === 'function') renderTable();
    } else {
        window.location.reload();
    }
};

// 1. GLOBAL CHECK-IN/OUT (Cloud Isolated)
window.globalCheckIn = async function (btn) {
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Đang xử lý...";
    }

    // Fallback if btn not passed (called from onclick="globalCheckIn()")
    // We try to find the button in DOM if argument missing
    if (!btn) {
        btn = document.querySelector('#global-checkin-container button');
        if (btn) btn.disabled = true;
    }

    const currentUserId = localStorage.getItem('currentUserId');
    const userFullName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser');

    if (!currentUserId) {
        alert("Vui lòng đăng nhập lại!");
        if (btn) btn.disabled = false;
        return;
    }

    try {
        await DBService.checkInPersonal(currentUserId, userFullName);
        if (typeof renderGlobalCheckIn === 'function') await renderGlobalCheckIn();

        // Check if user has registered for any class today → alert Admin if not
        await checkAndAlertUnregistered(currentUserId, userFullName);
    } catch (e) {
        alert("Lỗi: " + e.message);
        if (btn) {
            btn.disabled = false;
            btn.innerText = "VÀO CA"; // Reset text
        }
        // Force refresh UI just in case state is desynced
        if (typeof renderGlobalCheckIn === 'function') renderGlobalCheckIn();
    }
};

// Check if user registered for any class today. If not → create alert for Admin.
async function checkAndAlertUnregistered(userId, userName) {
    try {
        const now = new Date();
        const dateKey = getLocalDateKeyFromDate(now);
        console.log('[AlertCheck] Checking registration for', userName, 'on', dateKey);
        const schedule = await DBService.getSchedule(dateKey);
        if (!schedule) {
            // No schedule today → create alert (checking in without any class)
            console.log('[AlertCheck] No schedule today → creating alert');
            await DBService.createUnregisteredAlert(userId, userName, dateKey, now.toISOString());
            return;
        }

        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
        let hasRegistered = false;

        sections.forEach(sec => {
            if (schedule[sec]) {
                schedule[sec].forEach(cls => {
                    const isRegistered = (cls.registeredTeachers || []).some(t => t.id === userId);
                    if (isRegistered) hasRegistered = true;
                });
            }
        });

        if (!hasRegistered) {
            console.log('[AlertCheck] User NOT registered for any class → creating alert');
            await DBService.createUnregisteredAlert(userId, userName, dateKey, now.toISOString());
        } else {
            console.log('[AlertCheck] User is registered for at least one class → no alert');
        }
    } catch (e) {
        console.error('[AlertCheck] Error:', e);
    }
}

window.globalCheckOut = async function (btn) {
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Đang xử lý...";
    }
    if (!btn) {
        btn = document.querySelector('#global-checkin-container button');
        if (btn) btn.disabled = true;
    }

    const currentUserId = localStorage.getItem('currentUserId');
    if (!currentUserId) {
        alert("Vui lòng đăng nhập lại!");
        if (btn) btn.disabled = false;
        return;
    }

    try {
        await DBService.checkOutPersonal(currentUserId);
        // alert("Check-out thành công!");
        if (typeof renderGlobalCheckIn === 'function') await renderGlobalCheckIn();
    } catch (e) {
        alert("Lỗi: " + e.message);
        if (btn) {
            btn.disabled = false;
            btn.innerText = "RA CA";
        }
        if (typeof renderGlobalCheckIn === 'function') renderGlobalCheckIn();
    }
};

// 2. DASHBOARD STATS (Cloud Only)

// ================= ARCHIVER CONTROLLER (Maintenance Tab) =================var archiveCache = null; // Store scan results

window.runArchiveScan = async function () {
    const days = document.getElementById('archive-days').value;
    const btn = document.querySelector('button[onclick="runArchiveScan()"]');

    if (btn) {
        btn.disabled = true;
        btn.innerText = "Đang quét...";
    }

    try {
        const result = await Archiver.scanOldData(parseInt(days));
        archiveCache = result; // Store for export/delete

        // Update UI
        const resultArea = document.getElementById('archive-result');
        const countLabel = document.getElementById('archive-count');
        const deleteBtn = document.getElementById('btn-delete-archive');
        const hint = document.getElementById('delete-hint');

        if (resultArea) resultArea.style.display = 'block';
        if (countLabel) countLabel.innerText = `${result.count} bản ghi`;

        // Reset Delete Button state
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.style.cursor = 'not-allowed';
            deleteBtn.style.background = '#ccc';
        }
        if (hint) hint.style.visibility = 'visible';

        if (result.count === 0) {
            UIService.toast("Không tìm thấy dữ liệu nào cũ hơn mốc thời gian này.", "info");
        } else {
            UIService.toast(`Tìm thấy ${result.count} bản ghi cũ. Vui lòng TẢI VỀ trước khi xóa.`, "success");
        }

    } catch (e) {
        alert("Lỗi quét dữ liệu: " + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Quét Dữ Liệu";
        }
    }
};

window.runArchiveExport = function () {
    if (!archiveCache || archiveCache.count === 0) {
        alert("Chưa có dữ liệu để tải. Vui lòng quét trước!");
        return;
    }

    try {
        Archiver.exportToCSV(archiveCache.docs);

        // Enable Delete Button after successful export initiation
        const deleteBtn = document.getElementById('btn-delete-archive');
        const hint = document.getElementById('delete-hint');

        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.background = '#EF4444'; // Red color

            // Auto unlock effect
            UIService.toast("Đã mở khóa tính năng XÓA DỮ LIỆU.", "warning");
        }
        if (hint) hint.style.visibility = 'hidden';

    } catch (e) {
        alert("Lỗi xuất file: " + e.message);
    }
};

window.runArchiveDelete = async function () {
    if (!archiveCache || archiveCache.count === 0) return;

    if (!confirm(`CẢNH BÁO: Hành động này sẽ XÓA VĨNH VIỄN ${archiveCache.count} bản ghi khỏi server.\n\nBạn chắc chắn đã kiểm tra file backup vừa tải về chưa?`)) {
        return;
    }

    // Double Confirm for safety
    const code = Math.floor(1000 + Math.random() * 9000);
    const userInput = prompt(`Nhập mã xác nhận "${code}" để tiến hành xóa:`);

    if (userInput != code) {
        alert("Mã xác nhận không đúng. Đã hủy thao tác.");
        return;
    }

    const btn = document.getElementById('btn-delete-archive');
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Đang xóa...";
    }

    try {
        // Extract IDs
        const ids = archiveCache.docs.map(d => d.id);
        await Archiver.deleteData(ids);

        alert("Dọn dẹp thành công! Hệ thống đã nhẹ hơn.");
        window.location.reload(); // Refresh to clear state
    } catch (e) {
        alert("Lỗi xóa dữ liệu: " + e.message);
        if (btn) {
            btn.disabled = false;
            btn.innerText = "🗑️ Xóa Dữ Liệu Trên Cloud";
        }
    }
};
