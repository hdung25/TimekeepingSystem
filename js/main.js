const APP_VERSION = '20260721-analytics-v3';

(function setupAppAutoUpdate() {
    if (!('serviceWorker' in navigator)) return;

    let refreshing = false;
    const reloadOnceForVersion = () => {
        if (refreshing) return;
        const reloadKey = 'tdt-app-reloaded-version';
        if (sessionStorage.getItem(reloadKey) === APP_VERSION) return;

        refreshing = true;
        sessionStorage.setItem(reloadKey, APP_VERSION);
        window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', reloadOnceForVersion);
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'APP_UPDATED') {
            reloadOnceForVersion();
        }
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker.getRegistration()
            .then(registration => {
                if (registration) registration.update();
            })
            .catch(err => console.warn('Service worker update check failed:', err));
    });
})();

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
                    if (act.status === 'Hết ca theo lịch') statusColor = '#059669';

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
            container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 1rem; display:flex; align-items:center; justify-content:center; gap:6px;">${window.getIconHtml('check-circle', {width: '18', height: '18'})} Không có yêu cầu nào chờ duyệt.</p>`;
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
                        <span style="background:#7C3AED;color:white;padding:3px 6px;border-radius:4px;font-size:0.75rem;font-weight:700;margin-right:0.5rem;display:inline-flex;align-items:center;gap:3px;">${window.getIconHtml('star', {width: '12', height: '12'})} SỚM 10P</span>
                        <strong>${req.staffName || 'N/A'}</strong>
                        <span style="color:var(--text-muted);margin-left:0.5rem;">Ngày ${req.dateKey || ''}</span>
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button class="btn" onclick="rejectBonus10FromDashboard('${req.id}', this)"
                            style="background:#FEE2E2;color:#DC2626;border:1px solid #FECACA;padding:0.4rem 0.75rem;font-size:0.85rem;cursor:pointer;border-radius:4px;display:inline-flex;align-items:center;">
                            ${window.getIconHtml('x-circle', {width: '14', height: '14', style: 'display:inline-block; vertical-align:middle; margin-right:3px;'})} Từ Chối
                        </button>
                        <button class="btn" onclick="approveBonus10FromDashboard('${req.id}', '${req.staffId}', '${req.dateKey}', '${req.sessionId || ''}', this)"
                            style="background:#10B981;color:white;border:none;padding:0.4rem 0.75rem;font-size:0.85rem;cursor:pointer;border-radius:4px;display:inline-flex;align-items:center;">
                            ${window.getIconHtml('check-circle', {width: '14', height: '14', style: 'display:inline-block; vertical-align:middle; margin-right:3px;'})} Duyệt
                        </button>
                        <a href="bao-cao.html?staffId=${req.staffId}&date=${req.dateKey}" class="btn"
                            style="background:#7C3AED;color:white;padding:0.4rem 0.75rem;font-size:0.85rem;text-decoration:none;border-radius:4px;display:inline-flex;align-items:center;">
                            Xem
                        </a>
                    </div>
                </div>
            `;
        });

        // Render Tăng ca requests
        overtimeRequests.forEach(ot => {
            html += `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;border-bottom:1px solid var(--border-color);background:#FFFBEB;">
                    <div>
                        <span style="background:#F59E0B;color:white;padding:3px 6px;border-radius:4px;font-size:0.75rem;font-weight:700;margin-right:0.5rem;display:inline-flex;align-items:center;gap:3px;">${window.getIconHtml('clock', {width: '12', height: '12'})} TĂNG CA</span>
                        <strong>${ot.staffName || 'N/A'}</strong>
                        <span style="color:var(--text-muted);margin-left:0.5rem;">Ngày ${ot.dateKey} — +${ot.duration}</span>
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button class="btn" onclick="rejectOvertimeFromDashboard('${ot.id}', this)"
                            style="background:#FEE2E2;color:#DC2626;border:1px solid #FECACA;padding:0.4rem 0.75rem;font-size:0.85rem;cursor:pointer;border-radius:4px;display:inline-flex;align-items:center;">
                            ${window.getIconHtml('x-circle', {width: '14', height: '14', style: 'display:inline-block; vertical-align:middle; margin-right:3px;'})} Từ Chối
                        </button>
                        <button class="btn" onclick="approveOvertimeFromDashboard('${ot.id}', this)"
                            style="background:#10B981;color:white;border:none;padding:0.4rem 0.75rem;font-size:0.85rem;cursor:pointer;border-radius:4px;display:inline-flex;align-items:center;">
                            ${window.getIconHtml('check-circle', {width: '14', height: '14', style: 'display:inline-block; vertical-align:middle; margin-right:3px;'})} Duyệt
                        </button>
                        <a href="bao-cao.html?staffId=${ot.staffId}&date=${ot.dateKey}" class="btn"
                            style="background:#F59E0B;color:white;padding:0.4rem 0.75rem;font-size:0.85rem;text-decoration:none;border-radius:4px;display:inline-flex;align-items:center;">
                            Xem
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
        // Reload alerts (await để đảm bảo refresh sau khi Firestore write xong)
        await loadUnregisteredAlerts();
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
        await loadUnregisteredAlerts(); // await để đảm bảo refresh sau khi Firestore write xong
        if (typeof UIService !== 'undefined') UIService.toast('Đã từ chối yêu cầu tăng ca.', 'info');
    } catch(e) {
        if (btn) btn.disabled = false;
        if (typeof UIService !== 'undefined') UIService.toast('Lỗi: ' + e.message, 'error');
    }
};

window.approveOvertimeFromDashboard = async function(requestId, btn) {
    if (btn) btn.disabled = true;
    const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';
    try {
        await DBService.approveOvertimeRequest(requestId, adminName);
        await loadUnregisteredAlerts();
        if (typeof UIService !== 'undefined') UIService.toast('Đã duyệt yêu cầu tăng ca.', 'success');
    } catch(e) {
        if (btn) btn.disabled = false;
        if (typeof UIService !== 'undefined') UIService.toast('Lỗi: ' + e.message, 'error');
    }
};

window.approveBonus10FromDashboard = async function(requestId, staffId, dateKey, sessionId, btn) {
    if (btn) btn.disabled = true;
    const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';
    try {
        await DBService.approveBonus10Request(requestId, adminName, staffId, dateKey, sessionId);
        await loadUnregisteredAlerts();
        if (typeof UIService !== 'undefined') UIService.toast('Đã duyệt yêu cầu sớm 10p.', 'success');
    } catch(e) {
        if (btn) btn.disabled = false;
        if (typeof UIService !== 'undefined') UIService.toast('Lỗi: ' + e.message, 'error');
    }
};

window.rejectBonus10FromDashboard = async function(requestId, btn) {
    if (btn) btn.disabled = true;
    const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';
    try {
        await DBService.rejectBonus10Request(requestId, adminName);
        await loadUnregisteredAlerts();
        if (typeof UIService !== 'undefined') UIService.toast('Đã từ chối yêu cầu sớm 10p.', 'info');
    } catch(e) {
        if (btn) btn.disabled = false;
        if (typeof UIService !== 'undefined') UIService.toast('Lỗi: ' + e.message, 'error');
    }
};

// DEDUPLICATE bonus10_requests — Chạy từ console trên bất kỳ trang nào:
// window._deduplicateBonus10Requests()
window._deduplicateBonus10Requests = async function () {
    try {
        console.log('[Dedup] Đang tải danh sách bonus10 pending...');
        const snap = await db.collection('bonus10_requests')
            .where('status', '==', 'pending')
            .get();
        if (snap.empty) {
            console.log('[Dedup] ✅ Không có pending nào cần kiểm tra.');
            return;
        }
        const seen = new Map();
        const toDelete = [];
        snap.docs.forEach(doc => {
            const d = doc.data();
            const key = `${d.staffId}_${d.dateKey}_${d.sessionId}`;
            if (seen.has(key)) toDelete.push(doc.ref);
            else seen.set(key, doc.id);
        });
        if (toDelete.length === 0) {
            console.log('[Dedup] ✅ Không có bản ghi trùng nào. Dữ liệu sạch!');
            return;
        }
        console.log(`[Dedup] Tìm thấy ${toDelete.length} bản duplicate. Đang xóa...`);
        const batch = db.batch();
        toDelete.forEach(ref => batch.delete(ref));
        await batch.commit();
        console.log(`[Dedup] ✅ Đã xóa ${toDelete.length} bản trùng lặp! Reload trang để thấy kết quả.`);
    } catch (e) {
        console.error('[Dedup] ❌ Lỗi:', e);
    }
};

// DEDUPLICATE overtime_requests — Chạy từ console: window._deduplicateOvertimeRequests()
window._deduplicateOvertimeRequests = async function () {
    try {
        console.log('[Dedup-OT] Đang tải danh sách overtime pending...');
        const snap = await db.collection('overtime_requests')
            .where('status', '==', 'pending')
            .get();
        if (snap.empty) {
            console.log('[Dedup-OT] ✅ Không có pending nào cần kiểm tra.');
            return;
        }
        console.log(`[Dedup-OT] Tổng pending: ${snap.size}`);
        const seen = new Map();
        const toDelete = [];
        snap.docs.forEach(doc => {
            const d = doc.data();
            const key = `${d.staffId}_${d.dateKey}_${d.sessionId}`;
            if (seen.has(key)) toDelete.push(doc.ref);
            else seen.set(key, doc.id);
        });
        if (toDelete.length === 0) {
            console.log('[Dedup-OT] ✅ Không có bản ghi trùng nào. Dữ liệu sạch!');
            return;
        }
        console.log(`[Dedup-OT] Tìm thấy ${toDelete.length} bản duplicate. Đang xóa...`);
        const batch = db.batch();
        toDelete.forEach(ref => batch.delete(ref));
        await batch.commit();
        console.log(`[Dedup-OT] ✅ Đã xóa ${toDelete.length} bản trùng! Reload trang để thấy kết quả.`);
    } catch (e) {
        console.error('[Dedup-OT] ❌ Lỗi:', e);
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    // Login Handling
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        console.log('Timekeeping System Loaded (Login Page)');
        loginForm.addEventListener('submit', handleLogin);
    } else {
        // Wait for Firebase Auth to restore session (critical for Firestore permissions)
        if (window.waitAuth) {
            await window.waitAuth();
        }

        const currentUser = localStorage.getItem('currentUser');
        const currentUserId = localStorage.getItem('currentUserId');
        const firebaseUser = firebase.auth().currentUser;

        // AUTH GUARD: Require login for ALL internal pages
        if (!currentUser || !currentUserId || !firebaseUser) {
            console.warn("Auth session missing or mismatched. Redirecting to login.");
            localStorage.removeItem('currentUser');
            localStorage.removeItem('currentUserId');
            localStorage.removeItem('currentRole');
            window.location.href = 'index.html';
            return;
        }

        // Backup security role sync: ensures user_roles collection has a valid document mapping Auth UID to their role
        try {
            const roleRef = window.db.collection('user_roles').doc(firebaseUser.uid);
            const docSnap = await roleRef.get();
            const roleRaw = localStorage.getItem('currentRole') || 'staff';
            const rolesArr = parseRoles(roleRaw);
            
            if (!docSnap.exists || !docSnap.data().username || !docSnap.data().userId) {
                await roleRef.set({
                    userId: currentUserId,
                    role: rolesArr[0] || 'staff',
                    roles: rolesArr,
                    username: currentUser,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log("[Security] Backup auto-synced user role and userId to user_roles collection.");
            }
        } catch (e) {
            console.warn("[Security] Backup role sync failed (non-critical, user may already have it):", e);
        }

        console.log('Timekeeping System Loaded');

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
            loadStaffPersonalSalary();
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

        // Check and render periodic meeting banner
        setTimeout(() => {
            checkAndRenderMeetingBanner();
        }, 1000);

        // ===== GLOBAL AUTO-CHECKOUT (runs on ALL pages) =====
        // Ensures receptionist/teacher shifts are auto-closed even if user
        // navigates away from the Chấm Công page.
        setTimeout(() => {
            globalCheckAutoCheckout(); // Run once after 5s
            setInterval(globalCheckAutoCheckout, 60 * 1000); // Then every 60s
            console.log('[Global] Auto-checkout interval started');
        }, 5000);

        // Initialize PWA System Notifications
        setTimeout(() => {
            if (typeof initPWANotifications === 'function') {
                initPWANotifications();
            }
        }, 3000);
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
                const shiftStart = getVietnamDateFromHM(dateKey, startStr);
                const shiftEnd = getVietnamDateFromHM(dateKey, endStr);

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
            if (typeof renderTodayChips === 'function') {
                renderTodayChips();
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
        const [_tcy, _tcm, _tcd] = dateKey.split('-').map(Number);

        // Thu thập TẤT CẢ lớp user đã nhận hôm nay (mọi branch)
        const allClasses = [];
        for (const branch of BRANCHES) {
            const compositeKey = `${branch}__${dateKey}`;
            const schedule = await DBService.getSchedule(compositeKey);
            if (!schedule) continue;
            sections.forEach(sec => {
                if (!schedule[sec]) return;
                schedule[sec].forEach(cls => {
                    const isAssigned = (cls.gvId && cls.gvId === userId) ||
                        (cls.gvThayTheId && cls.gvThayTheId === userId) ||
                        (cls.registeredTeachers || []).some(t => t.id === userId);
                    if (!isAssigned) return;
                    allClasses.push({ start: cls.start, end: cls.end, branch });
                });
            });
        }

        if (allClasses.length === 0) return;

        // Tìm lớp khớp checkInTime (khoảng cách giờ bắt đầu gần nhất trong vòng 60p, trước khi lớp kết thúc)
        let matchedClassEnd = null;
        let matchedClassEndStr = null;
        let minDiff = Infinity;
        for (const cls of allClasses) {
            if (!cls.start || !cls.end) continue;
            const classStart = getVietnamDateFromHM(dateKey, cls.start);
            const classEnd = getVietnamDateFromHM(dateKey, cls.end);
            if (!classStart || !classEnd) continue;

            const diffMs = Math.abs(checkInTime - classStart);
            if (diffMs < 60 * 60 * 1000 && checkInTime < new Date(classEnd.getTime() + 15 * 60 * 1000)) {
                if (diffMs < minDiff) {
                    minDiff = diffMs;
                    matchedClassEnd = classEnd;
                    matchedClassEndStr = cls.end;
                }
            }
        }

        if (!matchedClassEnd) return;

        // Mở rộng matchedClassEnd nếu có ca liên tiếp (end ca trước = start ca sau)
        // → không auto-checkout giữa chừng khi 2 ca nối tiếp nhau
        let extended = true;
        while (extended) {
            extended = false;
            for (const cls of allClasses) {
                if (cls.start === matchedClassEndStr) {
                    const newEnd = getVietnamDateFromHM(dateKey, cls.end);
                    if (newEnd && newEnd > matchedClassEnd) {
                        matchedClassEnd = newEnd;
                        matchedClassEndStr = cls.end;
                        extended = true;
                    }
                    break;
                }
            }
        }

        if (now >= matchedClassEnd) {
            console.log(`[GlobalAutoCheckout] Class(es) ended at ${matchedClassEnd.toLocaleTimeString()}. Auto checking out...`);
            await DBService.checkOutPersonal(userId, matchedClassEnd);
            if (typeof UIService !== 'undefined' && UIService.toast) {
                UIService.toast("Đã tự động Ra Ca (hết giờ lớp)", "success");
            }
            if (typeof renderGlobalCheckIn === 'function') {
                await renderGlobalCheckIn();
            }
            if (typeof renderTodayChips === 'function') {
                renderTodayChips();
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
            <span style="display:flex;align-items:center;">${window.getIconHtml('bell', {width: '22', height: '22', stroke: '#3B82F6'})}</span>
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
        'add_session': window.getIconHtml('plus-circle', {width: '14', height: '14', style: 'display:inline-block; vertical-align:middle; margin-right:4px; color:#3B82F6;'}) + ' Thêm ca',
        'edit_session': window.getIconHtml('edit', {width: '14', height: '14', style: 'display:inline-block; vertical-align:middle; margin-right:4px; color:#3B82F6;'}) + ' Sửa giờ',
        'delete_session': window.getIconHtml('trash-2', {width: '14', height: '14', style: 'display:inline-block; vertical-align:middle; margin-right:4px; color:#3B82F6;'}) + ' Xóa ca',
        'select_role': window.getIconHtml('target', {width: '14', height: '14', style: 'display:inline-block; vertical-align:middle; margin-right:4px; color:#3B82F6;'}) + ' Chọn vai trò'
    };

    const overlay = document.createElement('div');
    overlay.id = 'notif-popup-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:5rem;animation:fadeIn 0.2s ease';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const popup = document.createElement('div');
    popup.style.cssText = 'background:white;border-radius:16px;max-width:450px;width:90%;max-height:70vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:slideUp 0.3s ease';

    const header = `
        <div style="padding:1.25rem;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:white;border-radius:16px 16px 0 0;z-index:1">
            <h3 style="margin:0;font-size:1.1rem;font-weight:700;color:#1F2937;display:flex;align-items:center;gap:6px;">${window.getIconHtml('bell', {width: '20', height: '20', stroke: '#3B82F6'})} Thông Báo</h3>
            <span style="color:#6B7280;font-size:0.85rem">${notifications.length} mới</span>
        </div>
    `;

    const items = notifications.map(n => {
        const actionLabel = actionLabels[n.action] || n.action;
        const timeStr = n.createdAt ? new Date(n.createdAt.seconds * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';

        // Thông báo nội bộ (admin soạn gửi nhóm) — hiển thị theo màu + icon đã chọn
        if (n.action === 'announcement') {
            const colorHex = ({ blue: '#3B82F6', green: '#10B981', amber: '#F59E0B', red: '#EF4444', violet: '#8B5CF6' })[n.color] || '#3B82F6';
            const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `
            <div style="padding:1rem 1.25rem;border-bottom:1px solid #F3F4F6;border-left:4px solid ${colorHex}">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;gap:8px">
                    <span style="font-size:0.9rem;font-weight:700;color:${colorHex};display:inline-flex;align-items:center;gap:5px">${window.getIconHtml(n.icon || 'bell', { width: '15', height: '15', stroke: colorHex })} ${esc(n.title) || 'Thông báo'}</span>
                    <span style="font-size:0.75rem;color:#9CA3AF;flex-shrink:0">${timeStr}</span>
                </div>
                <div style="font-size:0.85rem;color:#374151;white-space:pre-wrap">${esc(n.details)}</div>
                <div style="font-size:0.75rem;color:#9CA3AF;margin-top:0.25rem">Từ: ${esc(n.adminName) || 'Admin'}</div>
            </div>`;
        }
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
            <button id="btn-mark-all-read" style="background:#3B82F6;color:white;border:none;padding:0.6rem 1.5rem;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.9rem;transition:opacity 0.2s;display:inline-flex;align-items:center;gap:6px;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">${window.getIconHtml('check-circle', {width: '16', height: '16'})} Đã đọc tất cả</button>
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
        { name: 'Họp Định Kỳ', link: 'hop-dinh-ky.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M9 16l2 2 4-4"></path>', roles: ['admin', 'senior_assistant'] },
        { name: 'Bảng Cá Nhân', link: 'nhan-vien.html', icon: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>', roles: ['staff', 'assistant', 'receptionist', 'receptionist_assistant', 'teaching_assistant', 'senior_assistant', 'admin'] },
        { name: 'Họp Của Tôi', link: 'hop-cua-toi.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M9 16l2 2 4-4"></path>', roles: ['staff', 'assistant', 'receptionist', 'receptionist_assistant', 'teaching_assistant', 'senior_assistant', 'admin'] },
        // Chấm Công: Visible for Staff, Assistant, Receptionist
        { name: 'Chấm Công', link: 'cham-cong.html', icon: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>', roles: ['staff', 'assistant', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'teaching_assistant'] },
        { name: scheduleName, link: 'lich-lam.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>', roles: ['admin', 'senior_assistant', 'staff', 'assistant', 'receptionist', 'receptionist_assistant', 'teaching_assistant'] },
        { name: 'Chấm Công Bù', link: 'cham-bu.html', icon: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>', roles: ['staff', 'assistant', 'receptionist', 'receptionist_assistant', 'teaching_assistant'] },
        { name: 'Lịch Tiếp Tân', link: 'lich-tiep-tan.html', icon: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>', roles: ['admin', 'senior_assistant', 'receptionist', 'receptionist_assistant'] },
        { name: 'Quan Sát Ca', link: 'quan-sat-ca.html', icon: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12"></path><circle cx="12" cy="12" r="3"></circle>', roles: ['admin', 'senior_assistant', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'] },
        { name: 'Nhật Ký Ca', link: 'nhat-ky-ca.html', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line>', roles: ['admin', 'senior_assistant'] },
        { name: 'Tường Trình', link: 'tuong-trinh.html', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="9" y1="15" x2="15" y2="15"></line>', roles: ['admin', 'senior_assistant'] },
        { name: reportName, link: 'bao-cao.html', icon: '<rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="16" y1="10" x2="16" y2="18"></line><line x1="8" y1="10" x2="12" y2="10"></line><line x1="8" y1="14" x2="12" y2="14"></line><line x1="8" y1="18" x2="12" y2="18"></line>', roles: ['admin', 'senior_assistant', 'staff', 'assistant', 'receptionist', 'receptionist_assistant', 'teaching_assistant'] },
        { name: 'Môn Học', link: 'mon-hoc.html', icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>', roles: ['admin'] },
        { name: 'Hệ Thống', link: 'he-thong.html', icon: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>', roles: ['admin', 'senior_assistant', 'assistant'] },
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

function withTimeout(promise, ms = 10000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Hết thời gian phản hồi từ máy chủ (Timeout). Vui lòng thử lại sau!")), ms))
    ]);
}

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
        await withTimeout(DBService.checkInPersonal(currentUserId, userFullName), 30000);
        if (typeof renderGlobalCheckIn === 'function') await renderGlobalCheckIn();
        if (typeof renderTodayChips === 'function') renderTodayChips();

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

        const BRANCHES = ['cs1', 'cs2', 'cs3'];
        let hasRegistered = false;
        let foundAnySchedule = false;

        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];

        for (const branch of BRANCHES) {
            const compositeKey = `${branch}__${dateKey}`;
            const schedule = await DBService.getSchedule(compositeKey);
            if (schedule && Object.keys(schedule).length > 0) {
                foundAnySchedule = true;
                sections.forEach(sec => {
                    if (schedule[sec]) {
                        schedule[sec].forEach(cls => {
                            const isRegistered = (cls.registeredTeachers || []).some(t => t.id === userId) ||
                                                (cls.gvId && cls.gvId === userId) ||
                                                (cls.gvThayTheId && cls.gvThayTheId === userId);
                            if (isRegistered) hasRegistered = true;
                        });
                    }
                });
            }
        }

        // Only alert if schedules exist across branches but they did not register or get assigned to any
        if (foundAnySchedule && !hasRegistered) {
            console.log('[AlertCheck] User NOT registered/assigned for any class across branches → creating alert');
            await DBService.createUnregisteredAlert(userId, userName, dateKey, now.toISOString());
        } else {
            console.log('[AlertCheck] User is registered/assigned or no schedules today → no alert');
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
        await withTimeout(DBService.checkOutPersonal(currentUserId), 10000);
        // alert("Check-out thành công!");
        if (typeof renderGlobalCheckIn === 'function') await renderGlobalCheckIn();
        if (typeof renderTodayChips === 'function') renderTodayChips();
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
            btn.innerHTML = window.getIconHtml('trash-2', {style: 'display:inline-block; vertical-align:middle; margin-right:4px;'}) + ' Xóa Dữ Liệu Trên Cloud';
        }
    }
};

// ================= PERIODIC MEETING AUTOMATION =================

window.TTV_NAMES = [
    'NGUYỄN THỊ NGỌC GIÀU',
    'ĐẬU THỊ THUỶ HẰNG',
    'ĐẬU THỊ THỦY HẰNG',
    'PHẠM KIM KHÁNH QUỲNH',
    'NGUYỄN NGỌC MỸ SANG',
    'NGUYỄN THÚY NGÂN',
    'NGUYỄN THUÝ NGÂN',
    'LÊ VÕ THANH NGÂN',
    'NGUYỄN PHAN THANH NHÂN',
    'PHẠM THỊ TRÚC MY',
    'PHẠM THỊ TRÚC MỸ',
    'ĐOÀN THỊ THU THÙY',
    'ĐOÀN THỊ THU THUÝ',
    'ĐOÀN THỊ THU THUY',
    'TRẦN VÂN KHÁNH',
    'VÕ MINH TRƯỜNG',
    'ĐẬU THỊ THÚY NA',
    'ĐẬU THỊ THUÝ NA',
    'HÀ HUY DŨNG',
    'VÕ QUANG MỸ',
    'VÕ QUANG MY',
    'PHÙNG THỊ THANH THẢO',
    'ĐẶNG THỊ NHƯ NGỌC',
    'LÊ NGỌC ANH'
];

window.TA_NAMES = [
    'TRẦN GIA BẢO',
    'TRẦN THỊ TRANG ANH',
    'QUANG HUY',
    'NGUYỄN HUỲNH UYÊN VY',
    'NGUYỄN THỊ NGỌC GIÀU',
    'PHẠM QUANG TIẾN',
    'PHAN MẠNH PHÁT',
    'NGUYỄN HOÀNG NGUYÊN',
    'NGUYỄN NGỌC MỸ SANG',
    'LÊ ĐĂNG KHOA',
    'PHẠM KHIẾT LINH',
    'VŨ LÊ ANH QUÂN',
    'VỦ LÊ ANH QUÂN',
    'LÊ MAI THANH NHÂN',
    'NGUYỄN NGỌC CÔNG',
    'THÁI NGUYỄN KIỀU MY',
    'THÁI NGUYỄN KIỀU MỸ',
    'PHẠM NGỌC SƠN',
    'ĐOÀN THỊ THU THÙY',
    'ĐOÀN THỊ THU THUY',
    'VŨ THỊ MAI LINH',
    'LÊ THỊ THANH TRÚC',
    'VÕ MINH TRƯỜNG',
    'NGUYỄN NGỌC MỸ YẾN',
    'NGUYỄN NGỌC MỸ YEN',
    'NGUYỄN TRÍ HẢI',
    'HÀ HUY DŨNG',
    'NGUYỄN LÊ MAI LINH',
    'LÊ THỊ PHƯƠNG THÙY',
    'LÊ THỊ PHƯƠNG THUY',
    'PHẠM THỊ PHƯƠNG THẢO',
    'PHÙNG THỊ THANH THẢO',
    'TRƯƠNG XUÂN NHI',
    'ĐINH THANH THẢO',
    'NGUYỄN THỊ TÂM ANH',
    'NGUYỄN THỊ TUYẾT MINH',
    'NGUYỄN THỊ THU PHƯƠNG',
    'TRẦN LÊ ANH',
    'NGUYỄN HOÀNG DIỄM MY',
    'DƯƠNG LÊ BẢO NGỌC',
    'NGUYỄN THỊ BÌNH PHƯƠNG',
    'TRẦN TIỂU NHI',
    'BÙI NHƯ QUỲNH',
    'NGUYỄN THỊ NHƯ QUỲNH'
];

window.formatUserSpecialty = function(user) {
    const nameUpper = (user.name || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const usernameLower = (user.username || '').trim().toLowerCase();
    
    const isTA = window.TA_NAMES.includes(nameUpper) || usernameLower === 'huy4';
    const isTTV = window.TTV_NAMES.includes(nameUpper);
    
    const userRolesArr = Array.isArray(user.roles) && user.roles.length > 0
        ? user.roles
        : (user.role ? [user.role] : ['staff']);
    
    const isReceptionist = userRolesArr.some(r => ['receptionist', 'receptionist_assistant'].includes(r));
    
    let parts = [];
    if (isTA) parts.push('TG TA');
    if (isTTV) parts.push('TG T-TV');
    
    if (parts.length === 0 && !isReceptionist) {
        parts.push('TG TA'); // Default to TG TA
    }
    
    if (isReceptionist) {
        parts.push('TIẾP TÂN');
    }
    
    return parts.length > 0 ? parts.join(' / ') : 'TG TA';
};

window.checkAndRenderMeetingBanner = async function() {
    const container = document.getElementById('meeting-banner-container');
    if (!container) return;

    const currentUserId = localStorage.getItem('currentUserId');
    if (!currentUserId) return;

    try {
        const todayMeetings = await DBService.getTodayMeetings();
        if (todayMeetings.length === 0) {
            container.style.display = 'none';
            return;
        }

        const users = await DBService.getUsers();
        const currentUser = users.find(u => u.id === currentUserId);
        if (!currentUser) return;

        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        let specLabel = '';
        try {
            const loggedMeetings = await DBService.getMonthlyMeetings(monthStr);
            if (loggedMeetings?.records?.[currentUserId]?.chuyen_mon) {
                specLabel = loggedMeetings.records[currentUserId].chuyen_mon;
            }
        } catch(e) {
            console.warn("Could not load monthly meetings in banner check:", e);
        }
        if (!specLabel) {
            specLabel = window.formatUserSpecialty(currentUser);
        }

        const userSpecs = specLabel.toUpperCase();
        
        const matchingMeetings = todayMeetings.filter(m => {
            if (m.attendees && Array.isArray(m.attendees)) {
                return m.attendees.includes(currentUserId);
            }
            let deptKey = m.department.toUpperCase();
            if (deptKey === 'TG TA') return userSpecs.includes('TG TA');
            if (deptKey === 'TG T-TV') return userSpecs.includes('TG T-TV');
            if (deptKey === 'TOÁN TƯ DUY' || deptKey === 'TTD') return userSpecs.includes('TOÁN TƯ DUY') || userSpecs.includes('TTD');
            if (deptKey === 'TIẾP TÂN' || deptKey === 'TT') return userSpecs.includes('TIẾP TÂN') || userSpecs.includes('TT');
            return false;
        });

        if (matchingMeetings.length === 0) {
            container.style.display = 'none';
            return;
        }

        let bannerHtml = '';
        const currentTime = new Date();
        
        for (const meeting of matchingMeetings) {
            const [_y, _m, _d] = meeting.date.split('-').map(Number);
            
            const [ciSH, ciSM] = meeting.checkInStart.split(':').map(Number);
            const ciStart = new Date(_y, _m - 1, _d, ciSH, ciSM, 0);
            
            const [eH, eM] = meeting.endTime.split(':').map(Number);
            const mEnd = new Date(_y, _m - 1, _d, eH, eM, 0);

            if (currentTime < ciStart || currentTime > mEnd) {
                continue;
            }

            const attendanceSnap = await db.collection('meeting_attendance').doc(`${meeting.id}_${currentUserId}`).get();
            const attendanceData = attendanceSnap.exists ? attendanceSnap.data() : null;

            container.style.display = 'block';
            
            const deptLabel = meeting.department === 'CUSTOM' ? 'Tự chọn thành viên' : meeting.department;
            const timeRange = `${meeting.startTime} - ${meeting.endTime}`;
            const ciRange = `${meeting.checkInStart} - ${meeting.checkInClose}`;

            if (attendanceData) {
                const checkInTimeStr = new Date(attendanceData.checkInTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                const isLate = attendanceData.status === 'Trễ';
                const statusColor = isLate ? '#D97706' : '#059669';
                
                bannerHtml += `
                    <div class="glass-panel" style="
                        background: linear-gradient(135deg, rgba(243, 244, 246, 0.9) 0%, rgba(249, 250, 251, 0.95) 100%);
                        border-left: 5px solid #7C3AED;
                        padding: 1.25rem;
                        border-radius: 12px;
                        margin-bottom: 1rem;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        box-shadow: var(--shadow-md);
                        backdrop-filter: blur(8px);
                    ">
                        <div>
                            <h3 style="color: #4C1D95; font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem; display: flex; align-items: center; gap: 8px;">
                                ${window.getIconHtml('calendar', {width: '18', height: '18', stroke: '#7C3AED'})}
                                Lịch Họp Định Kỳ: ${meeting.title || 'Họp bộ phận'}
                            </h3>
                            <div style="font-size: 0.85rem; color: #5B21B6; opacity: 0.9;">
                                <span style="display:inline-block; margin-right: 1.5rem;"><strong>Bộ phận:</strong> ${deptLabel}</span>
                                <span style="display:inline-flex; align-items:center; gap:4px; margin-right: 1.5rem;">${window.getIconHtml('clock', {width: '14', height: '14'})} ${timeRange}</span>
                            </div>
                        </div>
                        <div>
                            <span style="
                                display: inline-flex;
                                align-items: center;
                                gap: 6px;
                                background: ${isLate ? '#FEF3C7' : '#D1FAE5'};
                                color: ${statusColor};
                                padding: 6px 14px;
                                border-radius: 20px;
                                font-weight: 700;
                                font-size: 0.85rem;
                                border: 1.5px solid ${statusColor};
                            ">
                                ${window.getIconHtml('check-circle', {width: '16', height: '16', stroke: statusColor})}
                                Đã điểm danh (${attendanceData.status}) lúc ${checkInTimeStr}
                            </span>
                        </div>
                    </div>
                `;
            } else {
                bannerHtml += `
                    <div class="glass-panel" style="
                        background: linear-gradient(135deg, rgba(245, 243, 255, 0.9) 0%, rgba(255, 255, 255, 0.95) 100%);
                        border-left: 5px solid #7C3AED;
                        padding: 1.25rem;
                        border-radius: 12px;
                        margin-bottom: 1rem;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        box-shadow: var(--shadow-lg);
                        backdrop-filter: blur(8px);
                        animation: pulse-banner 2s infinite alternate;
                    ">
                        <div>
                            <h3 style="color: #4C1D95; font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem; display: flex; align-items: center; gap: 8px;">
                                ${window.getIconHtml('calendar', {width: '18', height: '18', stroke: '#7C3AED'})}
                                Lịch Họp Định Kỳ: ${meeting.title || 'Họp bộ phận'}
                            </h3>
                            <div style="font-size: 0.85rem; color: #5B21B6; opacity: 0.9;">
                                <span style="display:inline-flex; align-items:center; gap:4px; margin-right: 1.25rem;"><strong>Bộ phận:</strong> ${deptLabel}</span>
                                <span style="display:inline-flex; align-items:center; gap:4px; margin-right: 1.25rem;">${window.getIconHtml('clock', {width: '14', height: '14'})} ${timeRange}</span>
                                <span style="display:inline-flex; align-items:center; gap:4px;">${window.getIconHtml('clock', {width: '14', height: '14'})} Điểm danh: ${ciRange}</span>
                            </div>
                        </div>
                        <div>
                            <button class="btn" onclick="checkInToMeeting('${meeting.id}', this)" style="
                                background: linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%);
                                color: white;
                                padding: 0.6rem 1.25rem;
                                border-radius: 8px;
                                font-weight: 700;
                                box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
                                border: none;
                                display: inline-flex;
                                align-items: center;
                                gap: 6px;
                                cursor: pointer;
                                transition: all 0.2s;
                            " onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 6px 15px rgba(124, 58, 237, 0.45)';" onmouseout="this.style.transform='none'; this.style.boxShadow='0 4px 12px rgba(124, 58, 237, 0.3)';">
                                ${window.getIconHtml('check-circle', {width: '16', height: '16'})}
                                Điểm Danh Họp
                            </button>
                        </div>
                    </div>
                `;
            }
        }

        container.innerHTML = bannerHtml;
        if (bannerHtml === '') {
            container.style.display = 'none';
        } else {
            if (!document.getElementById('meeting-banner-animation-styles')) {
                const styleSheet = document.createElement("style");
                styleSheet.id = 'meeting-banner-animation-styles';
                styleSheet.innerText = `
                    @keyframes pulse-banner {
                        0% { box-shadow: 0 4px 10px rgba(124, 58, 237, 0.1); }
                        100% { box-shadow: 0 4px 18px rgba(124, 58, 237, 0.25); }
                    }
                `;
                document.head.appendChild(styleSheet);
            }
            if (window.lucide) window.lucide.createIcons();
        }

    } catch (error) {
        console.error("Error checking meeting banner:", error);
    }
};

window.checkInToMeeting = async function(meetingId, btn) {
    if (btn) btn.disabled = true;
    
    const currentUserId = localStorage.getItem('currentUserId');
    const userFullName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser');
    
    if (!currentUserId) {
        alert("Vui lòng đăng nhập lại!");
        if (btn) btn.disabled = false;
        return;
    }

    try {
        const meetingDoc = await db.collection('meetings').doc(meetingId).get();
        if (!meetingDoc.exists) {
            alert("Cuộc họp không tồn tại!");
            if (btn) btn.disabled = false;
            return;
        }

        const meeting = meetingDoc.data();
        const now = new Date();
        const [_y, _m, _d] = meeting.date.split('-').map(Number);
        
        const [ciCH, ciCM] = meeting.checkInClose.split(':').map(Number);
        const ciClose = new Date(_y, _m - 1, _d, ciCH, ciCM, 0);

        let status = 'Có';
        if (now > ciClose) {
            status = 'Trễ';
        }

        // Nhân viên tự điểm danh — chỉ ghi meeting_attendance (không đụng meetings_log của admin)
        await DBService.selfCheckInMeeting(meetingId, currentUserId, userFullName, status);

        if (typeof UIService !== 'undefined' && UIService.toast) {
            UIService.toast(`Điểm danh họp thành công! Trạng thái: ${status}`, "success");
        } else {
            alert(`Điểm danh họp thành công! Trạng thái: ${status}`);
        }

        await window.checkAndRenderMeetingBanner();
        
        if (window.location.pathname.includes('hop-dinh-ky.html') && typeof renderMeetingsGrid === 'function') {
            await renderMeetingsGrid();
        }
    } catch(err) {
        alert("Lỗi điểm danh: " + err.message);
        if (btn) btn.disabled = false;
    }
};

// ================= PASSWORD SELF-SERVICE =================

window.togglePasswordVisibility = function(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) {
            icon.setAttribute('data-lucide', 'eye-off');
            if (window.lucide) window.lucide.createIcons({ root: btn });
        }
    } else {
        input.type = 'password';
        if (icon) {
            icon.setAttribute('data-lucide', 'eye');
            if (window.lucide) window.lucide.createIcons({ root: btn });
        }
    }
};

window.openChangePasswordModal = function() {
    const modal = document.getElementById('change-password-modal');
    if (!modal) return;
    
    // Clear old inputs
    document.getElementById('pwd-current').value = '';
    document.getElementById('pwd-new').value = '';
    document.getElementById('pwd-confirm').value = '';
    
    // Reset inputs type to password and reset eye icons
    ['pwd-current', 'pwd-new', 'pwd-confirm'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.type = 'password';
    });
    
    modal.querySelectorAll('button[type="button"] i').forEach(icon => {
        icon.setAttribute('data-lucide', 'eye');
        if (window.lucide) window.lucide.createIcons({ root: icon.parentElement });
    });
    
    modal.style.display = 'flex';
};

window.closeChangePasswordModal = function() {
    const modal = document.getElementById('change-password-modal');
    if (modal) modal.style.display = 'none';
};

window.handleChangePassword = async function(event) {
    if (event) event.preventDefault();
    
    const currentPassword = document.getElementById('pwd-current').value;
    const newPassword = document.getElementById('pwd-new').value;
    const confirmPassword = document.getElementById('pwd-confirm').value;
    const btnSubmit = document.getElementById('btn-submit-password');
    
    if (newPassword.length < 6) {
        if (typeof UIService !== 'undefined' && UIService.toast) {
            UIService.toast("Mật khẩu mới phải có ít nhất 6 ký tự!", "error");
        } else {
            alert("Mật khẩu mới phải có ít nhất 6 ký tự!");
        }
        return;
    }
    
    if (newPassword !== confirmPassword) {
        if (typeof UIService !== 'undefined' && UIService.toast) {
            UIService.toast("Mật khẩu mới và xác nhận mật khẩu không khớp nhau!", "error");
        } else {
            alert("Mật khẩu mới và xác nhận mật khẩu không khớp nhau!");
        }
        return;
    }
    
    const originalText = btnSubmit.innerText;
    btnSubmit.innerText = 'Đang xử lý...';
    btnSubmit.disabled = true;
    
    try {
        const user = firebase.auth().currentUser;
        if (!user) {
            throw new Error("Không tìm thấy phiên đăng nhập. Vui lòng đăng nhập lại!");
        }
        
        // Reauthenticate
        const email = user.email;
        const credential = firebase.auth.EmailAuthProvider.credential(email, currentPassword);
        await user.reauthenticateWithCredential(credential);
        
        // Update Auth Password
        await user.updatePassword(newPassword);
        
        // Update Firestore password
        const currentUserId = localStorage.getItem('currentUserId');
        if (currentUserId && typeof db !== 'undefined') {
            await db.collection('users').doc(currentUserId).update({
                password: newPassword,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        if (typeof UIService !== 'undefined' && UIService.toast) {
            UIService.toast("Đổi mật khẩu thành công!", "success");
        } else {
            alert("Đổi mật khẩu thành công!");
        }
        window.closeChangePasswordModal();
    } catch (error) {
        console.error("Change Password Error:", error);
        let errorMsg = error.message;
        if (error.code === 'auth/wrong-password') {
            errorMsg = "Mật khẩu hiện tại không chính xác!";
        } else if (error.code === 'auth/weak-password') {
            errorMsg = "Mật khẩu mới quá yếu!";
        } else if (error.code === 'auth/requires-recent-login') {
            errorMsg = "Vui lòng đăng nhập lại trước khi đổi mật khẩu!";
        }
        
        if (typeof UIService !== 'undefined' && UIService.toast) {
            UIService.toast("Lỗi: " + errorMsg, "error");
        } else {
            alert("Lỗi: " + errorMsg);
        }
    } finally {
        btnSubmit.innerText = originalText;
        btnSubmit.disabled = false;
    }
};

// ================= PWA SYSTEM NOTIFICATIONS =================

window.initPWANotifications = function() {
    const currentUser = localStorage.getItem('currentUser');
    const currentUserId = localStorage.getItem('currentUserId');
    if (!currentUser || !currentUserId) return;

    // Request notification permission if not yet decided
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted' && typeof UIService !== 'undefined' && UIService.toast) {
                UIService.toast("Đã bật nhận thông báo hệ thống!", "success");
            }
        });
    }

    // Set up real-time listener for new meetings
    window.setupMeetingsNotificationListener();

    // Start periodic check for shift and meeting start reminders
    // First run after 5 seconds, then every 60 seconds
    setTimeout(window.checkUpcomingMeetingsAndShifts, 5000);
    setInterval(window.checkUpcomingMeetingsAndShifts, 60000);
    console.log('[Notification] System initialized');
};

window.requestNotificationPermission = async function() {
    if (!('Notification' in window)) {
        console.warn("Trình duyệt này không hỗ trợ thông báo.");
        return false;
    }
    if (Notification.permission === 'granted') {
        return true;
    }
    if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    }
    return false;
};

window.isUserMatchingMeeting = function(user, meeting) {
    if (!meeting || !user) return false;
    if (meeting.attendees && Array.isArray(meeting.attendees)) {
        return meeting.attendees.includes(user.id);
    }
    const specLabel = window.formatUserSpecialty(user) || '';
    const userSpecs = specLabel.toUpperCase();
    let deptKey = (meeting.department || '').toUpperCase();
    if (deptKey === 'TG TA') return userSpecs.includes('TG TA');
    if (deptKey === 'TG T-TV') return userSpecs.includes('TG T-TV');
    if (deptKey === 'TOÁN TƯ DUY' || deptKey === 'TTD') return userSpecs.includes('TOÁN TƯ DUY') || userSpecs.includes('TTD');
    if (deptKey === 'TIẾP TÂN' || deptKey === 'TT') return userSpecs.includes('TIẾP TÂN') || userSpecs.includes('TT');
    return false;
};

window.showLocalNotification = function(title, body, tag) {
    if (Notification.permission === 'granted') {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready.then(registration => {
                registration.showNotification(title, {
                    body: body,
                    icon: 'images/TUDUYTRE.jpg',
                    badge: 'images/TUDUYTRE.jpg',
                    tag: tag || undefined,
                    renotify: true,
                    vibrate: [200, 100, 200]
                });
            }).catch(err => {
                console.warn("Service Worker notification failed, falling back to window Notification:", err);
                new Notification(title, { body: body, icon: 'images/TUDUYTRE.jpg' });
            });
        } else {
            new Notification(title, { body: body, icon: 'images/TUDUYTRE.jpg' });
        }
    }
    
    // Also show toast if the page is currently visible/active!
    if (document.visibilityState === 'visible' && typeof UIService !== 'undefined' && UIService.toast) {
        UIService.toast(body, 'info');
    }
};

window.setupMeetingsNotificationListener = function() {
    const currentUserId = localStorage.getItem('currentUserId');
    if (!currentUserId || typeof db === 'undefined') return;

    db.collection('users').doc(currentUserId).get().then(userDoc => {
        if (!userDoc.exists) return;
        const user = { id: userDoc.id, ...userDoc.data() };

        const now = new Date();
        const todayStr = getLocalDateKeyFromDate(now);

        let isInitialLoad = true;
        
        db.collection('meetings')
            .where('date', '==', todayStr)
            .onSnapshot(snapshot => {
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        const meeting = { id: change.doc.id, ...change.doc.data() };
                        if (!isInitialLoad) {
                            if (window.isUserMatchingMeeting(user, meeting)) {
                                const notifiedKey = `notified_meeting_new_${meeting.id}`;
                                if (!localStorage.getItem(notifiedKey)) {
                                    window.showLocalNotification(
                                        `Lịch họp mới: ${meeting.title || 'Họp định kỳ'}`,
                                        `Cuộc họp diễn ra lúc ${meeting.startTime} hôm nay tại bộ phận ${meeting.department === 'CUSTOM' ? 'Tự chọn' : meeting.department}.`,
                                        `meeting_new_${meeting.id}`
                                    );
                                    localStorage.setItem(notifiedKey, 'true');
                                }
                            }
                        }
                    }
                });
                isInitialLoad = false;
            }, err => {
                console.warn("Error listening to meetings for notifications:", err);
            });
    }).catch(err => {
        console.warn("Error fetching user for meetings listener:", err);
    });
};

window.checkUpcomingMeetingsAndShifts = async function() {
    const currentUserId = localStorage.getItem('currentUserId');
    if (!currentUserId || typeof db === 'undefined' || typeof DBService === 'undefined') return;

    try {
        const user = await DBService.getUser(currentUserId);
        if (!user) return;

        const now = new Date();
        const dateKey = getLocalDateKeyFromDate(now);

        // 1. Check meeting reminders (for everyone matching)
        const todayMeetings = await DBService.getTodayMeetings();
        for (const meeting of todayMeetings) {
            if (window.isUserMatchingMeeting(user, meeting)) {
                const [mSH, mSM] = meeting.startTime.split(':').map(Number);
                const [_y, _m, _d] = meeting.date.split('-').map(Number);
                const meetingStart = new Date(_y, _m - 1, _d, mSH, mSM, 0, 0);

                const diffMs = meetingStart.getTime() - now.getTime();
                const diffMins = Math.ceil(diffMs / (60 * 1000));

                if (diffMins > 0 && diffMins <= 10) {
                    const notifiedKey = `notified_meeting_soon_${meeting.id}`;
                    if (!localStorage.getItem(notifiedKey)) {
                        const attendanceSnap = await db.collection('meeting_attendance')
                            .doc(`${meeting.id}_${currentUserId}`).get();
                        if (!attendanceSnap.exists) {
                            window.showLocalNotification(
                                `Sắp đến giờ họp: ${meeting.title || 'Họp định kỳ'}`,
                                `Cuộc họp sẽ bắt đầu lúc ${meeting.startTime} (còn ${diffMins} phút). Vui lòng chuẩn bị vào họp!`,
                                `meeting_soon_${meeting.id}`
                            );
                            localStorage.setItem(notifiedKey, 'true');
                        }
                    }
                }
            }
        }

        // 2. Check shift check-in reminder (Receptionists only)
        const userRolesArr = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : (user.role ? [user.role] : ['staff']);
        const isReceptionist = userRolesArr.some(r => ['receptionist', 'receptionist_assistant'].includes(r));

        if (isReceptionist) {
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

            for (const branch of BRANCHES) {
                const compositeKey = `${branch}__${mondayKey}`;
                const weekData = await DBService.getReceptionistSchedule(compositeKey);
                if (!weekData) continue;

                const branchShiftConfig = await DBService.getReceptionistShiftConfig(branch);

                for (const shiftKey of SHIFT_KEYS) {
                    const shiftData = weekData[shiftKey];
                    if (!shiftData || !shiftData[dayKey]) continue;

                    const staffEntry = shiftData[dayKey].find(s => s.id === currentUserId);
                    if (!staffEntry) continue;

                    const weekShiftCfg = weekData._shiftConfig?.[shiftKey];
                    const startStr = staffEntry.customStart || weekShiftCfg?.start || branchShiftConfig[shiftKey]?.start || '07:00';
                    const endStr = staffEntry.customEnd || weekShiftCfg?.end || branchShiftConfig[shiftKey]?.end || '11:30';

                    const [_acy, _acm, _acd] = dateKey.split('-').map(Number);
                    const [_ssh, _ssm] = startStr.split(':').map(Number);
                    const [_seh, _sem] = endStr.split(':').map(Number);
                    const shiftStart = new Date(_acy, _acm - 1, _acd, _ssh, _ssm, 0, 0);
                    const shiftEnd = new Date(_acy, _acm - 1, _acd, _seh, _sem, 0, 0);

                    const timeDiffMins = (shiftStart.getTime() - now.getTime()) / (60 * 1000);

                    // Trigger if shift starts in 15 mins OR started but <= 30 mins ago
                    if (timeDiffMins <= 15 && timeDiffMins >= -30) {
                        const notifiedKey = `notified_shift_checkin_${dateKey}_${shiftKey}`;
                        if (!localStorage.getItem(notifiedKey)) {
                            const attendance = await DBService.getPersonalAttendance(dateKey, currentUserId);
                            const hasOpenSession = attendance && attendance.sessions && attendance.sessions.some(s => s.checkIn && !s.checkOut);

                            if (!hasOpenSession) {
                                window.showLocalNotification(
                                    `Nhắc ca làm việc: ${shiftKey === 'morning' ? 'Ca Sáng' : shiftKey === 'afternoon' ? 'Ca Chiều' : 'Ca Tối'}`,
                                    `Đã đến giờ trực ca của bạn (${startStr} - ${endStr}). Vui lòng Chấm Công để Vào ca!`,
                                    `shift_checkin_${dateKey}_${shiftKey}`
                                );
                                localStorage.setItem(notifiedKey, 'true');
                            }
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.warn("Error in checkUpcomingMeetingsAndShifts:", err);
    }
};

// ==========================================
// PERSONAL SALARY VIEWER & CASH RECEIPT (Item 1 & 2)
// ==========================================

let currentPersonalSalaryDate = new Date();

function formatNumberWithCommas(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'number') {
        value = Math.round(value);
    } else {
        const cleanedStr = String(value).replace(/,/g, '');
        const parsedFloat = parseFloat(cleanedStr);
        if (!isNaN(parsedFloat)) {
            value = Math.round(parsedFloat);
        }
    }
    let clean = String(value).replace(/[^0-9-]/g, '');
    if (clean === '' || clean === '-') return clean;
    const num = parseInt(clean, 10);
    if (isNaN(num)) return '';
    return new Intl.NumberFormat('en-US').format(num);
}

function parseFormattedNumber(value) {
    if (!value) return 0;
    const cleaned = String(value).replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.round(num);
}


function renderDetailedSalaryTable(details, status) {
    const fmt = (n) => n ? formatNumberWithCommas(Math.round(n)) + ' ₫' : '0 ₫';
    const formatHoursDecimal = (mins) => {
        const h = mins / 60;
        if (Number.isInteger(h)) return h.toString() + ' giờ';
        return h.toFixed(2).replace('.', ',') + ' giờ';
    };
    const formatLateHours = (mins) => {
        if (!mins) return '0';
        const hours = mins / 60;
        const formatted = hours.toFixed(2).replace('.', ',');
        return formatted.startsWith('0,') ? formatted.substring(1) : formatted;
    };

    let rowsHtml = '';
    const styleLabelCell = 'padding: 0.75rem; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #374151;';
    const styleValueCell = 'padding: 0.75rem; border-bottom: 1px solid #E5E7EB; text-align: right; font-weight: 600; color: #111827;';
    const styleHeaderCell = 'padding: 0.75rem; border-bottom: 2px solid #D1D5DB; background: #F3F4F6; font-weight: 700; color: #1F2937; text-transform: uppercase;';
    const styleHeaderValCell = 'padding: 0.75rem; border-bottom: 2px solid #D1D5DB; background: #F3F4F6; text-align: right; font-weight: 700; color: #1F2937;';
    
    if (details.role === 'tiep-tan') {
        const totalI = (details.baseSalary || 0) + (details.phiTuVan || 0) + (details.chamBaiPhatSinh || 0) + (details.troCapChucVu || 0) + (details.luongHieuSuat || 0) + (details.doanhThuTong || 0) + (details.doanhThuCs2 || 0) + (details.doanhThuCs3 || 0) + (details.phatSinh || 0) + (details.attendanceAdjustments || 0);
        const finalNetTT = totalI - (details.advance || 0);
        
        rowsHtml = `
            <tr style="background: #FFFBEB;">
                <td colspan="2" style="${styleHeaderCell} color: #B45309;">TỔNG LƯƠNG (1)</td>
                <td style="${styleHeaderValCell} color: #B45309; font-size: 1.05rem;">${fmt(totalI)}</td>
            </tr>
            <tr>
                <td colspan="2" style="${styleLabelCell}">
                    TỔNG SỐ GIỜ: ${details.filteredMinutes > 0 ? formatHoursDecimal(details.filteredMinutes) : '0 giờ'}
                    <br>
                    <span style="font-weight: normal; font-size: 0.8rem; color: #6B7280;">LƯƠNG CƠ BẢN:</span>
                </td>
                <td style="${styleValueCell} vertical-align: top; font-weight: 700;">${details.baseSalary > 0 ? fmt(details.baseSalary) : '—'}</td>
            </tr>
            <tr>
                <td colspan="2" style="${styleLabelCell}">PHÍ TƯ VẤN:</td>
                <td style="${styleValueCell}">${details.phiTuVan > 0 ? fmt(details.phiTuVan) : '—'}</td>
            </tr>
            <tr>
                <td colspan="2" style="${styleLabelCell}">CHẤM BÀI / DẠY VẼ / ĐĂNG BÀI / SỰ KIỆN / PHÁT SINH:${details.chamBaiNote ? ' <span style="font-weight:normal; font-style:italic; color:#6B7280;">(' + details.chamBaiNote + ')</span>' : ''}</td>
                <td style="${styleValueCell}">${details.chamBaiPhatSinh > 0 ? fmt(details.chamBaiPhatSinh) : '—'}</td>
            </tr>
            <tr>
                <td colspan="2" style="${styleLabelCell}">TRỢ CẤP CHỨC VỤ:${details.troCapNote ? ' <span style="font-weight:normal; font-style:italic; color:#6B7280;">(' + details.troCapNote + ')</span>' : ''}</td>
                <td style="${styleValueCell}">${details.troCapChucVu > 0 ? fmt(details.troCapChucVu) : '—'}</td>
            </tr>
            <tr>
                <td colspan="2" style="${styleLabelCell}">LƯƠNG HIỆU SUẤT:${details.luongHieuSuatNote ? ' <span style="font-weight:normal; font-style:italic; color:#6B7280;">(' + details.luongHieuSuatNote + ')</span>' : ''}</td>
                <td style="${styleValueCell}">${details.luongHieuSuat > 0 ? fmt(details.luongHieuSuat) : '—'}</td>
            </tr>
            <tr>
                <td colspan="2" style="${styleLabelCell}">THU NHẬP TĂNG THÊM DOANH THU TỔNG:</td>
                <td style="${styleValueCell}">${details.doanhThuTong > 0 ? fmt(details.doanhThuTong) : '—'}</td>
            </tr>
            <tr>
                <td colspan="2" style="${styleLabelCell}">THU NHẬP TĂNG THÊM DOANH THU CS2:</td>
                <td style="${styleValueCell}">${details.doanhThuCs2 > 0 ? fmt(details.doanhThuCs2) : '—'}</td>
            </tr>
            <tr>
                <td colspan="2" style="${styleLabelCell}">THU NHẬP TĂNG THÊM DOANH THU CS3:</td>
                <td style="${styleValueCell}">${details.doanhThuCs3 > 0 ? fmt(details.doanhThuCs3) : '—'}</td>
            </tr>
            <tr>
                <td colspan="2" style="${styleLabelCell}">PHÁT SINH (I) + (II)</td>
                <td style="${styleValueCell}">${details.phatSinh > 0 ? fmt(details.phatSinh) : '—'}</td>
            </tr>
            ${details.attendanceAdjustments !== 0 ? `
            <tr style="color: #DC2626; background: #FEF2F2;">
                <td colspan="2" style="${styleLabelCell} color: #DC2626;">KHẤU TRỪ CHUYÊN CẦN:</td>
                <td style="${styleValueCell} color: #DC2626; font-weight: 700;">${fmt(details.attendanceAdjustments)}</td>
            </tr>
            ` : ''}
            
            <!-- Criteria Section -->
            <tr>
                <td rowspan="2" style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; text-align: center; font-weight: 700; color: #4B5563; background: #F9FAFB; border-right: 1px solid #E5E7EB; font-size: 0.8rem;">TIÊU<br>CHÍ<br>XÉT</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem; border-right: 1px solid #E5E7EB;">
                    <strong style="color: #374151;">(I) HIỆU SUẤT</strong><br>
                    Vắng phép: ${details.stats?.vpShifts || 0} &nbsp;&nbsp; Vắng đột xuất: ${details.stats?.vdxShifts || 0}<br>
                    Vắng không phép: ${details.stats?.vkpShifts || 0} &nbsp;&nbsp; Trễ: ${formatLateHours(details.stats?.totalLateMinutes || 0)} giờ
                </td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">
                    ${details.criteriaI?.amount ? fmt(details.criteriaI.amount) : '—'}
                </td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem;">
                    <strong style="color: #374151;">(II) ĐÁNH GIÁ CỦA TỔ TRƯỞNG:</strong> ${details.criteriaV?.note || '—'}
                </td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">
                    ${details.criteriaV?.amount ? fmt(details.criteriaV.amount) : '—'}
                </td>
            </tr>
            
            <tr style="background: #FDF2F8;">
                <td colspan="2" style="${styleLabelCell} color: #DB2777; font-weight: 700;">TẠM ỨNG (2)</td>
                <td style="${styleValueCell} color: #DB2777; font-weight: 700;">${details.advance > 0 ? fmt(details.advance) : '—'}</td>
            </tr>
            <tr style="background: #ECFDF5; border-top: 2px solid #10B981;">
                <td colspan="2" style="${styleHeaderCell} background: #ECFDF5; color: #065F46; font-size: 1.1rem;">THỰC LÃNH (1)-(2)</td>
                <td style="${styleHeaderValCell} background: #ECFDF5; color: #065F46; font-size: 1.3rem; font-weight: 800;">${fmt(finalNetTT)}</td>
            </tr>
        `;
    } else {
        const initialTotal = (details.totalBaseSalary || 0) + (details.totalTinHocSalary || 0) + (details.totalExtraSalary || 0) + (details.totalPreschoolSalary || 0) + (details.totalAffiliateSalary || 0) + (details.totalTutoringSalary || 0) + (details.troCapChucVu || 0) + (details.totalBonus || 0) + (details.attendanceAdjustments || 0);
        const finalNet = initialTotal - (details.advance || 0);
        
        const criteria0 = details.evalItems?.find(item => item.id === 0);
        const criteria1 = details.evalItems?.find(item => item.id === 1);
        const criteria2 = details.evalItems?.find(item => item.id === 2);
        const criteria3 = details.evalItems?.find(item => item.id === 3);
        const criteria4 = details.evalItems?.find(item => item.id === 4);
        const criteria5 = details.evalItems?.find(item => item.id === 5);
        const criteria6 = details.evalItems?.find(item => item.id === 6);
        const criteria7 = details.evalItems?.find(item => item.id === 7);
        const criteria8 = details.evalItems?.find(item => item.id === 8);
        const criteria9 = details.evalItems?.find(item => item.id === 9);

        rowsHtml = `
            <tr style="background: #FFFBEB;">
                <td colspan="3" style="${styleHeaderCell} color: #B45309;">TỔNG LƯƠNG (1)</td>
                <td style="${styleHeaderValCell} color: #B45309; font-size: 1.05rem;">${fmt(initialTotal)}</td>
            </tr>
            <tr>
                <td colspan="3" style="${styleLabelCell}">
                    TỔNG SỐ GIỜ: ${details.totalBaseMins > 0 ? formatHoursDecimal(details.totalBaseMins) : '0 giờ'}
                    <br>
                    <span style="font-weight: normal; font-size: 0.8rem; color: #6B7280;">LƯƠNG CƠ BẢN:</span>
                </td>
                <td style="${styleValueCell} vertical-align: top; font-weight: 700;">${details.totalBaseSalary > 0 ? fmt(details.totalBaseSalary) : '—'}</td>
            </tr>
            <tr>
                <td colspan="3" style="${styleLabelCell}">TỔNG SỐ GIỜ TIN HỌC: ${details.totalTinHocMins > 0 ? formatHoursDecimal(details.totalTinHocMins) : '0 giờ'}</td>
                <td style="${styleValueCell}">${details.totalTinHocSalary > 0 ? fmt(details.totalTinHocSalary) : '—'}</td>
            </tr>
            <tr>
                <td colspan="3" style="${styleLabelCell}">SOẠN BÀI / CHẤM BÀI / SỰ KIỆN / PHÁT SINH: ${details.totalExtraMins > 0 ? formatHoursDecimal(details.totalExtraMins) : '0 giờ'}</td>
                <td style="${styleValueCell}">${details.totalExtraSalary > 0 ? fmt(details.totalExtraSalary) : '—'}</td>
            </tr>
            <tr>
                <td colspan="3" style="${styleLabelCell}">TỔNG SỐ GIỜ MẦM NON: ${details.totalPreschoolMins > 0 ? formatHoursDecimal(details.totalPreschoolMins) : '0 giờ'}</td>
                <td style="${styleValueCell}">${details.totalPreschoolSalary > 0 ? fmt(details.totalPreschoolSalary) : '—'}</td>
            </tr>
            <tr>
                <td colspan="3" style="${styleLabelCell}">TỔNG SỐ GIỜ LIÊN KẾT: ${details.totalAffiliateMins > 0 ? formatHoursDecimal(details.totalAffiliateMins) : '0 giờ'}</td>
                <td style="${styleValueCell}">${details.totalAffiliateSalary > 0 ? fmt(details.totalAffiliateSalary) : '—'}</td>
            </tr>
            <tr>
                <td colspan="3" style="${styleLabelCell}">TỔNG SỐ GIỜ KÈM 1:1 (TẠI NHÀ): ${details.totalTutoringMins > 0 ? formatHoursDecimal(details.totalTutoringMins) : '0 giờ'}</td>
                <td style="${styleValueCell}">${details.totalTutoringSalary > 0 ? fmt(details.totalTutoringSalary) : '—'}</td>
            </tr>
            <tr>
                <td colspan="3" style="${styleLabelCell}">TRỢ CẤP CHỨC VỤ:${details.troCapNote ? ' <span style="font-weight:normal; font-style:italic; color:#6B7280;">(' + details.troCapNote + ')</span>' : ''}</td>
                <td style="${styleValueCell}">${details.troCapChucVu > 0 ? fmt(details.troCapChucVu) : '—'}</td>
            </tr>
            ${details.attendanceAdjustments !== 0 ? `
            <tr style="color: #DC2626; background: #FEF2F2;">
                <td colspan="3" style="${styleLabelCell} color: #DC2626;">KHẤU TRỪ CHUYÊN CẦN:</td>
                <td style="${styleValueCell} color: #DC2626; font-weight: 700;">${fmt(details.attendanceAdjustments)}</td>
            </tr>
            ` : ''}
            <tr style="background: #F3F4F6;">
                <td colspan="3" style="${styleLabelCell} font-weight: 700;">TỔNG THƯỞNG ĐÁNH GIÁ (I đến X):</td>
                <td style="${styleValueCell} font-weight: 700; color: #10B981;">+${fmt(details.totalBonus)}</td>
            </tr>
            
            <!-- Evaluation Details -->
            <tr>
                <td rowspan="10" style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; text-align: center; font-weight: 700; color: #4B5563; background: #F9FAFB; border-right: 1px solid #E5E7EB; font-size: 0.8rem;">TIÊU<br>CHÍ<br>ĐÁNH<br>GIÁ</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #4B5563; font-size: 0.8rem; border-right: 1px solid #E5E7EB;">(I) CHUYÊN CẦN</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem;">
                    Vắng phép: ${details.stats?.vpShifts || 0} &nbsp;&nbsp; Vắng đột xuất: ${details.stats?.vdxShifts || 0} &nbsp;&nbsp; Vắng KP: ${details.stats?.vkpShifts || 0}
                </td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">${criteria0?.amount ? fmt(criteria0.amount) : '—'}</td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #4B5563; font-size: 0.8rem; border-right: 1px solid #E5E7EB;">(II) ĐÚNG GIỜ</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem;">
                    Trễ: ${details.stats?.totalLateMinutes ? (details.stats.totalLateMinutes / 60).toFixed(2).replace('.', ',') + ' giờ' : '0 giờ'} &nbsp;&nbsp; số lần trễ: ${details.stats?.lateCount || 0} lần
                </td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">${criteria1?.amount ? fmt(criteria1.amount) : '—'}</td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #4B5563; font-size: 0.8rem; border-right: 1px solid #E5E7EB;">(III) TẬP TRUNG</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem;">${criteria2?.note || '—'}</td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">${criteria2?.amount ? fmt(criteria2.amount) : '—'}</td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #4B5563; font-size: 0.8rem; border-right: 1px solid #E5E7EB;">(IV) NHIỆT TÌNH</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem;">${criteria3?.note || '—'}</td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">${criteria3?.amount ? fmt(criteria3.amount) : '—'}</td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #4B5563; font-size: 0.8rem; border-right: 1px solid #E5E7EB;">(V) TRÁCH NHIỆM</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem;">${criteria4?.note || '—'}</td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">${criteria4?.amount ? fmt(criteria4.amount) : '—'}</td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #4B5563; font-size: 0.8rem; border-right: 1px solid #E5E7EB;">(VI) SOẠN BÀI</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem;">${criteria5?.note || '—'}</td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">${criteria5?.amount ? fmt(criteria5.amount) : '—'}</td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #4B5563; font-size: 0.8rem; border-right: 1px solid #E5E7EB;">(VII) CHUYÊN MÔN</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem;">${criteria6?.note || '—'}</td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">${criteria6?.amount ? fmt(criteria6.amount) : '—'}</td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #4B5563; font-size: 0.8rem; border-right: 1px solid #E5E7EB;">(VIII) SƯ PHẠM</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem;">${criteria7?.note || '—'}</td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">${criteria7?.amount ? fmt(criteria7.amount) : '—'}</td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #4B5563; font-size: 0.8rem; border-right: 1px solid #E5E7EB;">(IX) SỐ GIỜ LÀM</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem;">
                    Mốc xét thưởng: 50,65,80 ${criteria8?.note ? `<br style="margin-bottom:2px;">` + criteria8.note : ''}
                </td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">${criteria8?.amount ? fmt(criteria8.amount) : '—'}</td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #4B5563; font-size: 0.8rem; border-right: 1px solid #E5E7EB;">(X) HỌP ĐỊNH KÌ</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid #E5E7EB; color: #4B5563; font-size: 0.8rem;">${criteria9?.note || '—'}</td>
                <td style="${styleValueCell} font-size: 0.8rem; font-weight: normal; color: #4B5563;">${criteria9?.amount ? fmt(criteria9.amount) : '—'}</td>
            </tr>
            
            <tr style="background: #FDF2F8;">
                <td colspan="3" style="${styleLabelCell} color: #DB2777; font-weight: 700;">TẠM ỨNG (2)</td>
                <td style="${styleValueCell} color: #DB2777; font-weight: 700;">${details.advance > 0 ? fmt(details.advance) : '—'}</td>
            </tr>
            <tr style="background: #ECFDF5; border-top: 2px solid #10B981;">
                <td colspan="3" style="${styleHeaderCell} background: #ECFDF5; color: #065F46; font-size: 1.1rem;">THỰC LÃNH (1)-(2)</td>
                <td style="${styleHeaderValCell} background: #ECFDF5; color: #065F46; font-size: 1.3rem; font-weight: 800;">${fmt(finalNet)}</td>
            </tr>
        `;
    }

    return `
        <div class="detailed-salary-card" style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(12px); border-radius: 16px; border: 1.5px solid #E5E7EB; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02); transition: transform 0.2s;">
            <!-- Card Header -->
            <div style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); padding: 1.15rem 1.5rem; color: white; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 0.5rem;">
                        ${window.getIconHtml('file-text', {width: '20', height: '20'})}
                        Bảng Lương Chi Tiết
                    </h3>
                    <p style="margin: 0.35rem 0 0 0; font-size: 0.8rem; opacity: 0.9; font-weight: 500;">
                        Mã NV: <span style="font-weight:700;">${details.employeeId || '—'}</span> &nbsp;|&nbsp; Họ tên: <span style="font-weight:700;">${details.staffName?.toUpperCase() || '—'}</span>
                    </p>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    ${status === 'received' 
                        ? `<span style="background:#D1FAE5;color:#065F46;border:1px solid #10B981;padding:4px 10px;border-radius:9999px;font-size:0.75rem;font-weight:700;display:inline-block;">Đã nhận lương</span>`
                        : `<span style="background:#DBEAFE;color:#1E40AF;border:1px solid #3B82F6;padding:4px 10px;border-radius:9999px;font-size:0.75rem;font-weight:700;display:inline-block;">Đã công bố</span>`
                    }
                    <span style="background: rgba(255, 255, 255, 0.25); padding: 4px 12px; border-radius: 9999px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                        ${details.role === 'tiep-tan' ? 'Tiếp Tân' : 'Giáo Viên'}
                    </span>
                </div>
            </div>
            
            <!-- Table Container -->
            <div style="overflow-x: auto; padding: 0.75rem;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden;">
                    <colgroup>
                        ${details.role === 'tiep-tan' ? `
                            <col style="width: 12%;">
                            <col style="width: 58%;">
                            <col style="width: 30%;">
                        ` : `
                            <col style="width: 10%;">
                            <col style="width: 25%;">
                            <col style="width: 50%;">
                            <col style="width: 15%;">
                        `}
                    </colgroup>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
            
            <!-- Note Section inside Card -->
            <div style="padding: 1rem 1.5rem; background: #FAF9F6; border-top: 1.5px dashed #E5E7EB; font-size: 0.85rem; color: #4B5563; font-style: italic; line-height: 1.4;">
                <div><strong>Lưu ý:</strong> Nếu bảng lương có sai sót vui lòng liên hệ chị Thủy (bộ phận nhân sự) vào sáng giờ hành chính (7h-11h)</div>
                ${details.role === 'giao-vien' ? `<div style="color: #DC2626; font-weight: 600; margin-top: 4px;">*LƯU Ý: Lương chưa bao gồm phí soạn bài bên chị Tiên, phí soạn bài vui lòng liên hệ chị Tiên!</div>` : ''}
            </div>
        </div>
    `;
}

async function loadStaffPersonalSalary() {
    const staffId = localStorage.getItem('currentUserId');
    if (!staffId || typeof DBService === 'undefined') return;

    const statusContainer = document.getElementById('personal-salary-status-container');
    const contentContainer = document.getElementById('personal-salary-content');
    const monthTitle = document.getElementById('personal-salary-month-title');

    if (!statusContainer || !contentContainer || !monthTitle) return;

    // Format month title
    const year = currentPersonalSalaryDate.getFullYear();
    const month = currentPersonalSalaryDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    monthTitle.innerText = `Tháng ${month + 1}, ${year}`;

    // Show loading
    statusContainer.style.display = 'block';
    statusContainer.innerHTML = `
        <i data-lucide="loader-2" class="animate-spin" style="width: 32px; height: 32px; color: var(--primary-color); margin: 0 auto 0.5rem; display: block;"></i>
        <p style="margin: 0; font-weight: 500;">Đang tải dữ liệu bảng lương...</p>
    `;
    if (window.lucide) window.lucide.createIcons();
    contentContainer.style.display = 'none';

    try {
        const monthlySettings = await DBService.getMonthlySalarySettings(staffId, monthStr);
        const published = monthlySettings?.published;

        if (!published || published.status === 'uncalculated' || published.status === 'draft') {
            statusContainer.innerHTML = `
                <span style="display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size:1.5rem; margin-bottom:0.5rem;">
                    ${window.getIconHtml('help-circle', {width: '32', height: '32'})}
                </span>
                <p style="margin: 0; font-weight: 500;">Bảng lương đang được tổng hợp.</p>
            `;
            return;
        }

        // Show content container and hide loading status
        statusContainer.style.display = 'none';
        contentContainer.style.display = 'block';

        const basicView = document.getElementById('ps-basic-view');
        const detailedView = document.getElementById('ps-detailed-view');
        const breakdownContainer = document.getElementById('ps-breakdown-container');
        const confirmBtn = document.getElementById('btn-confirm-receipt');

        const hasDetailed = !!(published.details_gv || published.details_tt || published.details);
        let html = '';
        if (hasDetailed) {
            if (published.details_gv && (published.status_gv === 'published' || published.status_gv === 'received' || (!published.status_gv && published.status !== 'draft'))) {
                html += renderDetailedSalaryTable(published.details_gv, published.status_gv || published.status);
            }
            if (published.details_tt && (published.status_tt === 'published' || published.status_tt === 'received' || (!published.status_tt && published.status !== 'draft'))) {
                if (html) html += '<div style="height: 20px;"></div>';
                html += renderDetailedSalaryTable(published.details_tt, published.status_tt || published.status);
            }
            if (!published.details_gv && !published.details_tt && published.details) {
                html += renderDetailedSalaryTable(published.details, published.status);
            }
        }

        if (hasDetailed) {
            if (html) {
                // Show detailed table view
                if (basicView) basicView.style.display = 'none';
                if (breakdownContainer) breakdownContainer.style.display = 'none';
                if (detailedView) {
                    detailedView.style.display = 'block';
                    detailedView.innerHTML = html;
                }

                if (published.status === 'received') {
                    if (confirmBtn) confirmBtn.style.display = 'none';
                } else {
                    if (confirmBtn) confirmBtn.style.display = 'inline-flex';
                }
            } else {
                // Fallback to uncalculated / draft view
                statusContainer.style.display = 'block';
                statusContainer.innerHTML = `
                    <span style="display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size:1.5rem; margin-bottom:0.5rem;">
                        ${window.getIconHtml('help-circle', {width: '32', height: '32'})}
                    </span>
                    <p style="margin: 0; font-weight: 500;">Bảng lương đang được tổng hợp.</p>
                `;
                if (detailedView) detailedView.style.display = 'none';
                if (basicView) basicView.style.display = 'none';
                if (breakdownContainer) breakdownContainer.style.display = 'none';
                if (confirmBtn) confirmBtn.style.display = 'none';
                return;
            }
        } else {
            // Fallback to basic summary view
            if (detailedView) detailedView.style.display = 'none';
            if (basicView) basicView.style.display = 'grid';
            
            document.getElementById('ps-base-salary').innerText = formatNumberWithCommas(published.baseSalary || 0) + 'đ';
            document.getElementById('ps-total-bonus').innerText = '+' + formatNumberWithCommas(published.totalBonus || 0) + 'đ';
            
            const penaltyVal = (published.penalties?.vdx || 0) + (published.penalties?.vkp || 0) + (published.penalties?.late || 0);
            document.getElementById('ps-total-penalties').innerText = '-' + formatNumberWithCommas(penaltyVal) + 'đ';
            document.getElementById('ps-advance').innerText = '-' + formatNumberWithCommas(published.advance || 0) + 'đ';
            document.getElementById('ps-net-pay').innerText = formatNumberWithCommas(published.netPay || 0) + 'đ';

            // Status badge in basic card
            const badgeContainer = document.getElementById('ps-status-badge-container');
            if (badgeContainer) {
                if (published.status === 'received') {
                    badgeContainer.innerHTML = `<span style="background:#D1FAE5;color:#065F46;border:1px solid #10B981;padding:6px 12px;border-radius:9999px;font-size:0.8rem;font-weight:700;display:inline-block;">Đã nhận lương</span>`;
                    if (confirmBtn) confirmBtn.style.display = 'none';
                } else {
                    badgeContainer.innerHTML = `<span style="background:#DBEAFE;color:#1E40AF;border:1px solid #3B82F6;padding:6px 12px;border-radius:9999px;font-size:0.8rem;font-weight:700;display:inline-block;">Đã công bố</span>`;
                    if (confirmBtn) confirmBtn.style.display = 'inline-flex';
                }
            }

            // Subject Breakdown table (For teachers)
            if (breakdownContainer) {
                const breakdown = published.breakdown || [];
                const breakdownBody = document.getElementById('ps-breakdown-body');
                if (breakdown.length > 0 && breakdownBody) {
                    breakdownContainer.style.display = 'block';
                    breakdownBody.innerHTML = breakdown.map(item => {
                        return `
                            <tr style="border-bottom:1px solid var(--border-color);">
                                <td style="padding: 0.5rem; font-weight:600;">${item.name}</td>
                                <td style="padding: 0.5rem; text-align:center;">${item.hours}h</td>
                                <td style="padding: 0.5rem; text-align:right; color:var(--text-muted);">${formatNumberWithCommas(item.rate)}đ/h</td>
                                <td style="padding: 0.5rem; text-align:right; font-weight:700; color:var(--primary-color);">${formatNumberWithCommas(item.amount)}đ</td>
                            </tr>
                        `;
                    }).join('');
                } else {
                    breakdownContainer.style.display = 'none';
                }
            }
        }

        // Admin message
        const msgContainer = document.getElementById('ps-admin-message-container');
        const msgEl = document.getElementById('ps-admin-message');
        if (msgContainer && msgEl) {
            if (published.message) {
                msgContainer.style.display = 'block';
                msgEl.innerText = published.message;
            } else {
                msgContainer.style.display = 'none';
            }
        }

    } catch (e) {
        console.error("Error loading personal salary:", e);
        statusContainer.innerHTML = `
            <p style="margin: 0; color: #EF4444; font-weight: 500;">Lỗi khi tải bảng lương: ${e.message}</p>
        `;
    }
}

function changePersonalSalaryMonth(dir) {
    currentPersonalSalaryDate.setMonth(currentPersonalSalaryDate.getMonth() + dir);
    loadStaffPersonalSalary();
}

async function confirmPersonalSalaryReceipt() {
    if (!confirm("Bạn có chắc chắn xác nhận đã nhận đủ số tiền mặt này từ trung tâm?")) return;

    const staffId = localStorage.getItem('currentUserId');
    const year = currentPersonalSalaryDate.getFullYear();
    const month = currentPersonalSalaryDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    try {
        const btn = document.getElementById('btn-confirm-receipt');
        if (btn) btn.disabled = true;
        
        await DBService.confirmSalaryReceived(staffId, monthStr, 'employee');
        alert("Xác nhận nhận lương thành công!");
        await loadStaffPersonalSalary();
    } catch (e) {
        console.error("Error confirming salary receipt:", e);
        alert("Có lỗi xảy ra: " + e.message);
        const btn = document.getElementById('btn-confirm-receipt');
        if (btn) btn.disabled = false;
    }
}

// Bind to window for global access
window.loadStaffPersonalSalary = loadStaffPersonalSalary;
window.changePersonalSalaryMonth = changePersonalSalaryMonth;
window.confirmPersonalSalaryReceipt = confirmPersonalSalaryReceipt;

// ================= BROADCAST ANNOUNCEMENTS (Thông Báo Nội Bộ — admin.html) =================
// Gửi = ghi 1 doc admin_notifications/người nhận (action:'announcement') → chuông sẵn có
// của nhân viên tự nhận. Không collection mới, không cần đổi Firestore rules.

const ANN_COLORS = [
    { key: 'blue', label: 'Xanh dương', hex: '#3B82F6' },
    { key: 'green', label: 'Lục', hex: '#10B981' },
    { key: 'amber', label: 'Vàng', hex: '#F59E0B' },
    { key: 'red', label: 'Đỏ', hex: '#EF4444' },
    { key: 'violet', label: 'Tím', hex: '#8B5CF6' }
];
const ANN_ICONS = ['bell', 'calendar', 'clipboard-list', 'shield', 'clock', 'message-circle'];
const ANN_GROUPS = {
    all: { label: 'Tất cả nhân sự', roles: null },
    gv: { label: 'Giáo viên & Trợ giảng', roles: ['giao-vien', 'teacher', 'teaching_assistant', 'assistant'] },
    tt: { label: 'Tiếp tân', roles: ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'] }
};

function annEsc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function annUserRoles(u) {
    return Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role || ''];
}

// Người nhận hợp lệ: loại tài khoản admin/senior_assistant (họ không có chuông thông báo)
function annFilterRecipients(users, groupKey) {
    const g = ANN_GROUPS[groupKey] || ANN_GROUPS.all;
    return (users || []).filter(u => {
        if (!u.id) return false;
        const roles = annUserRoles(u);
        if (roles.includes('admin') || roles.includes('senior_assistant')) return false;
        if (!g.roles) return true;
        return roles.some(r => g.roles.includes(r));
    });
}

window.openAnnouncementComposer = async function () {
    const existing = document.getElementById('ann-composer-overlay');
    if (existing) existing.remove();

    if (!window._annUsers) {
        try { window._annUsers = await DBService.getUsers(); }
        catch (e) { alert('Không tải được danh sách nhân sự: ' + (e.message || e)); return; }
    }

    const colorChips = ANN_COLORS.map((c, i) => `
        <label style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border:1.5px solid ${i === 0 ? c.hex : '#E5E7EB'};border-radius:99px;cursor:pointer;font-size:0.8rem;font-weight:600;" data-ann-color="${c.key}">
            <input type="radio" name="ann-color" value="${c.key}" ${i === 0 ? 'checked' : ''} style="display:none;">
            <span style="width:10px;height:10px;border-radius:50%;background:${c.hex};display:inline-block;"></span>${c.label}
        </label>`).join('');

    const iconBtns = ANN_ICONS.map((ic, i) => `
        <label style="display:inline-flex;align-items:center;justify-content:center;width:46px;height:40px;border:1.5px solid ${i === 0 ? '#6366F1' : '#E5E7EB'};border-radius:10px;cursor:pointer;" data-ann-icon="${ic}">
            <input type="radio" name="ann-icon" value="${ic}" ${i === 0 ? 'checked' : ''} style="display:none;">
            ${window.getIconHtml(ic, { width: '18', height: '18', stroke: '#4B5563' })}
        </label>`).join('');

    const overlay = document.createElement('div');
    overlay.id = 'ann-composer-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
<div style="background:white;border-radius:16px;max-width:560px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;">
  <div style="padding:1.1rem 1.4rem;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center;">
    <h3 style="margin:0;font-size:1.05rem;font-weight:700;">Soạn thảo thông báo mới</h3>
    <button onclick="document.getElementById('ann-composer-overlay').remove()" style="background:#F3F4F6;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:1rem;">✕</button>
  </div>
  <div style="padding:1.25rem 1.4rem;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:1rem;">
    <div>
      <label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:5px;">Tiêu đề thông báo *</label>
      <input id="ann-title" type="text" maxlength="120" placeholder="VD: Cập nhật lịch trống tuần mới" style="width:100%;box-sizing:border-box;padding:0.65rem 0.85rem;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.9rem;outline:none;">
    </div>
    <div>
      <label style="font-size:0.78rem;font-weight:700;color:#6B7280;letter-spacing:0.03em;display:block;margin-bottom:5px;">NỘI DUNG THÔNG BÁO *</label>
      <textarea id="ann-message" rows="4" maxlength="1500" placeholder="Nhập nội dung nhắc nhở hoặc thông báo chi tiết..." style="width:100%;box-sizing:border-box;padding:0.65rem 0.85rem;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.9rem;outline:none;resize:vertical;font-family:inherit;"></textarea>
    </div>
    <div>
      <label style="font-size:0.78rem;font-weight:700;color:#6B7280;letter-spacing:0.03em;display:block;margin-bottom:6px;">MÀU SẮC CHỦ ĐỀ HIỂN THỊ</label>
      <div id="ann-color-row" style="display:flex;gap:6px;flex-wrap:wrap;">${colorChips}</div>
    </div>
    <div>
      <label style="font-size:0.78rem;font-weight:700;color:#6B7280;letter-spacing:0.03em;display:block;margin-bottom:6px;">BIỂU TƯỢNG THÔNG BÁO</label>
      <div id="ann-icon-row" style="display:flex;gap:6px;flex-wrap:wrap;">${iconBtns}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
      <div>
        <label style="font-size:0.78rem;font-weight:700;color:#6B7280;letter-spacing:0.03em;display:block;margin-bottom:5px;">NHÓM ĐỐI TƯỢNG NHẬN *</label>
        <select id="ann-group" onchange="annRefreshRecipientPicker()" style="width:100%;padding:0.6rem;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.88rem;">
          <option value="gv">Giáo viên & Trợ giảng</option>
          <option value="tt">Tiếp tân</option>
          <option value="all">Tất cả nhân sự</option>
        </select>
      </div>
      <div>
        <label style="font-size:0.78rem;font-weight:700;color:#6B7280;letter-spacing:0.03em;display:block;margin-bottom:5px;">PHẠM VI GỬI *</label>
        <select id="ann-scope" onchange="annRefreshRecipientPicker()" style="width:100%;padding:0.6rem;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.88rem;">
          <option value="group">Gửi cho toàn bộ nhóm</option>
          <option value="custom">Chọn người cụ thể</option>
        </select>
      </div>
    </div>
    <div id="ann-recipient-box" style="display:none;">
      <label style="font-size:0.78rem;font-weight:700;color:#6B7280;letter-spacing:0.03em;display:block;margin-bottom:5px;">CHỌN NGƯỜI NHẬN</label>
      <div id="ann-recipient-list" style="max-height:170px;overflow-y:auto;border:1.5px solid #E5E7EB;border-radius:10px;padding:0.4rem 0.6rem;display:flex;flex-direction:column;gap:2px;"></div>
    </div>
    <div id="ann-recipient-count" style="font-size:0.8rem;color:#6B7280;"></div>
  </div>
  <div style="padding:0.9rem 1.4rem;border-top:1px solid #E5E7EB;display:flex;gap:0.6rem;justify-content:flex-end;">
    <button onclick="document.getElementById('ann-composer-overlay').remove()" style="padding:0.6rem 1.2rem;background:#F3F4F6;border:none;border-radius:10px;cursor:pointer;font-weight:600;">Hủy</button>
    <button id="ann-send-btn" onclick="sendAnnouncementNow()" style="padding:0.6rem 1.4rem;background:#6366F1;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:700;display:inline-flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Gửi thông báo</button>
  </div>
</div>`;
    document.body.appendChild(overlay);

    // Highlight lựa chọn màu/icon khi bấm
    overlay.querySelectorAll('[data-ann-color]').forEach(el => el.addEventListener('click', () => {
        overlay.querySelectorAll('[data-ann-color]').forEach(x => x.style.borderColor = '#E5E7EB');
        el.style.borderColor = (ANN_COLORS.find(c => c.key === el.dataset.annColor) || {}).hex || '#6366F1';
    }));
    overlay.querySelectorAll('[data-ann-icon]').forEach(el => el.addEventListener('click', () => {
        overlay.querySelectorAll('[data-ann-icon]').forEach(x => x.style.borderColor = '#E5E7EB');
        el.style.borderColor = '#6366F1';
    }));

    annRefreshRecipientPicker();
};

window.annRefreshRecipientPicker = function () {
    const groupKey = document.getElementById('ann-group') ? document.getElementById('ann-group').value : 'all';
    const scope = document.getElementById('ann-scope') ? document.getElementById('ann-scope').value : 'group';
    const box = document.getElementById('ann-recipient-box');
    const listEl = document.getElementById('ann-recipient-list');
    const countEl = document.getElementById('ann-recipient-count');
    const candidates = annFilterRecipients(window._annUsers, groupKey);

    if (scope === 'custom') {
        box.style.display = 'block';
        listEl.innerHTML = candidates.length === 0
            ? '<div style="color:#9CA3AF;padding:0.5rem;">Nhóm này chưa có nhân sự.</div>'
            : candidates.map(u => `
                <label style="display:flex;align-items:center;gap:8px;padding:0.3rem 0.2rem;cursor:pointer;font-size:0.85rem;">
                    <input type="checkbox" class="ann-recipient-cb" value="${u.id}" data-name="${annEsc(u.name || u.username || '')}" onchange="annUpdateCount()">
                    <span>${annEsc(u.name || u.username || u.id)}</span>
                </label>`).join('');
    } else {
        box.style.display = 'none';
    }
    countEl.dataset.groupTotal = candidates.length;
    annUpdateCount();
};

window.annUpdateCount = function () {
    const scope = document.getElementById('ann-scope') ? document.getElementById('ann-scope').value : 'group';
    const countEl = document.getElementById('ann-recipient-count');
    if (!countEl) return;
    if (scope === 'group') {
        countEl.innerText = 'Sẽ gửi đến ' + (countEl.dataset.groupTotal || 0) + ' người trong nhóm.';
    } else {
        const n = document.querySelectorAll('.ann-recipient-cb:checked').length;
        countEl.innerText = 'Đã chọn ' + n + ' người nhận.';
    }
};

window.sendAnnouncementNow = async function () {
    const title = (document.getElementById('ann-title') ? document.getElementById('ann-title').value : '').trim();
    const message = (document.getElementById('ann-message') ? document.getElementById('ann-message').value : '').trim();
    const colorInp = document.querySelector('input[name=ann-color]:checked');
    const iconInp = document.querySelector('input[name=ann-icon]:checked');
    const color = colorInp ? colorInp.value : 'blue';
    const icon = iconInp ? iconInp.value : 'bell';
    const groupKey = document.getElementById('ann-group') ? document.getElementById('ann-group').value : 'all';
    const scope = document.getElementById('ann-scope') ? document.getElementById('ann-scope').value : 'group';

    if (!title) { alert('Vui lòng nhập tiêu đề thông báo!'); return; }
    if (!message) { alert('Vui lòng nhập nội dung thông báo!'); return; }

    let recipients;
    if (scope === 'custom') {
        recipients = Array.from(document.querySelectorAll('.ann-recipient-cb:checked'))
            .map(cb => ({ id: cb.value, name: cb.dataset.name }));
    } else {
        recipients = annFilterRecipients(window._annUsers, groupKey).map(u => ({ id: u.id, name: u.name || u.username || '' }));
    }
    if (recipients.length === 0) { alert('Chưa có người nhận nào!'); return; }

    const groupLabel = scope === 'custom' ? (recipients.length + ' người đã chọn') : ((ANN_GROUPS[groupKey] || {}).label || '');
    if (!confirm('Gửi thông báo "' + title + '" đến ' + recipients.length + ' người (' + groupLabel + ')?')) return;

    const btn = document.getElementById('ann-send-btn');
    if (btn) { btn.disabled = true; btn.innerText = 'Đang gửi...'; }
    try {
        await DBService.sendAnnouncement(recipients, { title: title, message: message, color: color, icon: icon });
        const ov = document.getElementById('ann-composer-overlay');
        if (ov) ov.remove();
        if (typeof UIService !== 'undefined' && UIService.toast) UIService.toast('Đã gửi thông báo đến ' + recipients.length + ' người!', 'success');
        else alert('Đã gửi thông báo đến ' + recipients.length + ' người!');
        loadSentAnnouncements();
    } catch (e) {
        console.error('[Announcement] Send error:', e);
        alert('Lỗi gửi thông báo: ' + (e.message || e));
        if (btn) { btn.disabled = false; btn.innerText = 'Gửi thông báo'; }
    }
};

async function loadSentAnnouncements() {
    const listEl = document.getElementById('sent-announcements-list');
    if (!listEl) return;
    try {
        const groups = await DBService.getRecentAnnouncements(8);
        if (groups.length === 0) {
            listEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">Chưa gửi thông báo nào.</p>';
            return;
        }
        listEl.innerHTML = groups.map(g => {
            const hex = (ANN_COLORS.find(c => c.key === g.color) || {}).hex || '#3B82F6';
            const timeStr = g.createdAt && g.createdAt.seconds ? new Date(g.createdAt.seconds * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
            const allRead = g.readCount >= g.total;
            return `
            <div style="display:flex;align-items:center;gap:10px;padding:0.6rem 0.25rem;border-bottom:1px solid #F3F4F6;">
                <span style="display:inline-flex;flex-shrink:0;color:${hex};">${window.getIconHtml(g.icon || 'bell', { width: '17', height: '17', stroke: hex })}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${annEsc(g.title)}</div>
                    <div style="font-size:0.75rem;color:#9CA3AF;">${timeStr} · ${annEsc(g.adminName)}</div>
                </div>
                <span style="flex-shrink:0;font-size:0.75rem;font-weight:700;padding:2px 8px;border-radius:99px;background:${allRead ? '#D1FAE5' : '#F3F4F6'};color:${allRead ? '#065F46' : '#6B7280'};">Đã đọc ${g.readCount}/${g.total}</span>
            </div>`;
        }).join('');
    } catch (e) {
        console.error('[Announcement] History error:', e);
        listEl.innerHTML = '<p style="color:#EF4444;text-align:center;padding:1rem;">Lỗi tải lịch sử thông báo.</p>';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!document.getElementById('sent-announcements-list')) return;
    if (window.waitAuth) { try { await window.waitAuth(); } catch (e) { } }
    loadSentAnnouncements();
});
