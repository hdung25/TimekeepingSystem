// Main Logic for Timekeeping System


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
}

document.addEventListener('DOMContentLoaded', () => {
    // ... (Startup logic)
    console.log('Timekeeping System Loaded');

    // Login Handling
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
        // ... animation ...
    } else {
        // We are inside the app, render sidebar
        renderSidebar();
        loadDashboardStats(); // Fetch real data

        // Check if "Back to Admin" button should be shown
        // Simplified: If current user is Admin (regardless of role state), show the button if it exists.
        const currentUser = localStorage.getItem('currentUser');
        if (currentUser === 'admin') {
            const btnBack = document.getElementById('btn-back-admin');
            if (btnBack) {
                btnBack.style.display = 'inline-flex';
                // Ensure correct styling override
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
            // Small delay to ensure Sidebar rendered
            setTimeout(() => switchTab(tab), 100);
        }
    }
});

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

    try {
        // Call Secure Cloud Login
        // DBService.loginUser now throws Error if fail
        const user = await DBService.loginUser(username, password);

        if (user) {
            // Save Session
            localStorage.setItem('currentUser', user.username);
            localStorage.setItem('currentRole', user.role);
            localStorage.setItem('currentUserId', user.id);
            localStorage.setItem('userFullName', user.name);

            // Redirect
            if (user.role === 'admin') {
                window.location.href = 'admin.html';
            } else {
                window.location.href = 'nhan-vien.html';
            }
        }
    } catch (error) {
        console.error(error);
        // Error message is already friendly from DBService
        alert(error.message);
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function switchRole() {
    const currentUser = localStorage.getItem('currentUser');
    const currentRole = localStorage.getItem('currentRole');

    if (currentUser !== 'admin') return;

    if (currentRole === 'admin') {
        localStorage.setItem('currentRole', 'staff');
        window.location.href = 'nhan-vien.html';
    } else {
        localStorage.setItem('currentRole', 'admin');
        window.location.href = 'admin.html';
    }
}

function renderSidebar() {
    const sidebarNav = document.getElementById('sidebar-nav') || document.querySelector('.sidebar nav');
    if (!sidebarNav) return;

    const role = localStorage.getItem('currentRole') || 'staff';

    // Dynamic Naming logic
    let scheduleName = 'Lịch Làm';
    let reportName = 'Bảng Công';

    if (role === 'admin' || role === 'assistant') {
        scheduleName = 'Xếp Lịch';
    }
    if (role === 'admin') {
        reportName = 'Tính Lương';
    }

    // Define Menu Items
    const menuItems = [
        { name: 'Tổng Quan', link: 'admin.html', icon: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>', roles: ['admin', 'assistant'] },
        { name: 'Nhân Sự', link: 'nhan-su.html', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>', roles: ['admin'] },
        { name: 'Bảng Cá Nhân', link: 'nhan-vien.html', icon: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>', roles: ['staff', 'assistant'] },
        // Chấm Công: Visible for Staff and Assistant
        { name: 'Chấm Công', link: 'cham-cong.html', icon: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>', roles: ['staff', 'assistant'] },
        { name: scheduleName, link: 'lich-lam.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>', roles: ['admin', 'staff', 'assistant'] },
        { name: reportName, link: 'bao-cao.html', icon: '<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>', roles: ['admin', 'staff', 'assistant'] },
        { name: 'Hệ Thống', link: 'he-thong.html', icon: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>', roles: ['admin'] },
        // NEW: Maintenance
        {
            name: 'Bảo Trì',
            link: '#',
            id: 'nav-maintenance',
            event: "switchTab('tab-maintenance', event); return false;",
            icon: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>',
            roles: ['admin']
        }
    ];

    let switchBtnHtml = '';
    const currentUser = localStorage.getItem('currentUser');

    if (currentUser === 'admin' && role === 'admin') {
        switchBtnHtml = `
            <a href="#" class="nav-link" onclick="switchRole(); return false;" style="color: var(--secondary-color);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
                Chế độ Nhân viên
            </a>
         `;
    }

    // Generate Profile Section
    const fullName = localStorage.getItem('userFullName') || 'Người Dùng';
    let displayRole = 'Nhân Viên';
    if (role === 'admin') displayRole = 'Quản Trị Viên';
    if (role === 'assistant') displayRole = 'Trợ Lý';

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
        if (item.roles.includes(role)) {
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
    sidebarNav.innerHTML += switchBtnHtml;
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
    // Inject Hamburger Button (Hidden on Desktop via CSS)
    const logoArea = document.querySelector('.logo-area');
    if (logoArea && !logoArea.querySelector('.hamburger-btn')) {
        const hamburger = document.createElement('button');
        hamburger.className = 'hamburger-btn';
        hamburger.innerHTML = '☰';
        hamburger.onclick = () => {
            const sidebar = document.querySelector('.sidebar');
            sidebar.classList.toggle('open');
            hamburger.innerHTML = sidebar.classList.contains('open') ? '✕' : '☰';
        };
        logoArea.appendChild(hamburger);
    }
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
        // alert("Check-in thành công!"); // Removed alert for smoother flow
        if (typeof renderGlobalCheckIn === 'function') await renderGlobalCheckIn();
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

// ================= ARCHIVER CONTROLLER (Maintenance Tab) =================
let archiveCache = null; // Store scan results

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
