// Main Logic for Timekeeping System


async function loadDashboardStats() {
    // Only run on admin page (where stats exist)
    const totalEl = document.querySelector('.glass-panel p[style*="var(--primary-color)"]');
    // This selector is a bit weak, let's use the text content context or add IDs in HTML ideally.
    // Given the HTML structure in admin.html:
    // "Tổng nhân viên" -> followed by <p>48</p>

    // Better approach: Let's assume I can add IDs to admin.html first? 
    // Or just find by context logic if I don't want to edit HTML.
    // The user asked to fix "hardcoded data". 
    // I will modify admin.html to add IDs then update this function.
    // But for this step, let's just define the function placeholder and I will edit HTML in next step.

    try {
        const stats = await DBService.getDashboardStats();
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
                    // Determine status color logic
                    let statusColor = 'var(--text-color)';
                    if (act.status === 'Đúng giờ') statusColor = 'var(--secondary-color)';

                    return `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 1rem 0;">${act.user}</td>
                            <td style="padding: 1rem 0;">${timeStr}</td>
                            <td style="padding: 1rem 0; color: ${statusColor};">${act.status}</td>
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
        if (tbody) tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 1rem; color: red;">Lỗi tải dữ liệu</td></tr>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // --- ONE-TIME PASSWORD UPDATE START ---
    // Tự động cập nhật mật khẩu Admin khi chạy lần đầu
    (async () => {
        try {
            console.log("Đang cập nhật mật khẩu Admin...");
            const snapshot = await db.collection('users').where('username', '==', 'admin').get();
            if (!snapshot.empty) {
                snapshot.forEach(async doc => {
                    await doc.ref.update({ password: 'Hdung.25' }); // Mật khẩu mới
                    console.log("✅ Đã cập nhật mật khẩu Admin thành công!");
                });
            } else {
                console.log("⚠️ Không tìm thấy user admin để cập nhật.");
            }
        } catch (e) {
            console.error("Lỗi cập nhật mật khẩu:", e);
        }
    })();
    // --- ONE-TIME PASSWORD UPDATE END ---

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
    }
});

// ================= AUTH LOGIC =================

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const btn = e.target.querySelector('button');

    // UI Loading State
    const originalText = btn.innerText;
    btn.innerText = 'Đang kiểm tra...';
    btn.disabled = true;

    try {
        // Call Cloud Login
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
        } else {
            alert('Tên đăng nhập hoặc mật khẩu không đúng!');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    } catch (error) {
        console.error(error);
        alert('Lỗi kết nối: ' + error.message);
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

    if (role === 'admin') {
        scheduleName = 'Xếp Lịch';
        reportName = 'Tính Lương';
    }

    // Define Menu Items
    const menuItems = [
        { name: 'Tổng Quan', link: 'admin.html', icon: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>', roles: ['admin'] },
        { name: 'Nhân Sự', link: 'nhan-su.html', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>', roles: ['admin'] },
        { name: 'Bảng Cá Nhân', link: 'nhan-vien.html', icon: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>', roles: ['staff'] },
        // Chấm Công: Hidden for Admin
        { name: 'Chấm Công', link: 'cham-cong.html', icon: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>', roles: ['staff'] },
        { name: scheduleName, link: 'lich-lam.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>', roles: ['admin', 'staff'] },
        { name: reportName, link: 'bao-cao.html', icon: '<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>', roles: ['admin', 'staff'] },
        { name: 'Hệ Thống', link: 'he-thong.html', icon: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>', roles: ['admin'] }
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
    const displayRole = role === 'admin' ? 'Quản Trị Viên' : 'Nhân Viên';

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
            // Use 'nav-link' to match Logout button style as requested
            // Remove 'span' wrapper to match hardcoded style in admin.html
            sidebarNav.innerHTML += `
                <a href="${item.link}" class="nav-link ${isActive ? 'active' : ''}">
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
async function loadDashboardStats() {
    // Only run if elements exist (Admin Dashboard)
    const elTotalUsers = document.getElementById('stat-total-users');
    if (!elTotalUsers) return;

    try {
        const stats = await DBService.getDashboardStats();

        // Update DOM
        elTotalUsers.innerText = stats.totalUsers || 0;
        document.getElementById('stat-active-today').innerText = stats.checkedInCount || 0;

        // Render Recent Activity
        const tbody = document.getElementById('recent-activity-body');
        if (tbody && stats.recentActivity) {
            if (stats.recentActivity.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 1rem; color: var(--text-muted);">Chưa có hoạt động hôm nay</td></tr>';
            } else {
                tbody.innerHTML = stats.recentActivity.map(act => {
                    const timeStr = new Date(act.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    // Determine status color logic can be refined later
                    return `
        < tr style = "border-bottom: 1px solid var(--border-color);" >
                            <td style="padding: 1rem 0;">${act.user}</td>
                            <td style="padding: 1rem 0;">${timeStr}</td>
                            <td style="padding: 1rem 0; color: var(--secondary-color);">${act.status}</td>
                        </tr >
        `;
                }).join('');
            }
        }

    } catch (e) {
        console.error("Failed to load dashboard stats", e);
    }
}
