// Report & Salary Logic

document.addEventListener('DOMContentLoaded', () => {
    // Check if on report page (has calendar grid)
    if (document.getElementById('calendar-grid')) {
        initReport();
    }
});

let currentDate = new Date(); // Global View Date

async function initReport() {
    // Reset role filter select to default 'all'
    const roleFilterEl = document.getElementById('salary-role-filter');
    if (roleFilterEl) roleFilterEl.value = 'all';

    // Restore saved month if available
    const savedMonthStr = localStorage.getItem('lastSelectedMonthStr');
    if (savedMonthStr) {
        const parsedDate = new Date(savedMonthStr);
        if (!isNaN(parsedDate.getTime())) {
            currentDate = parsedDate;
        }
    }
    
    // Support URL focus date param
    const urlParams = new URLSearchParams(window.location.search);
    const dateParam = urlParams.get('date');
    if (dateParam) {
        const parsedDate = new Date(dateParam);
        if (!isNaN(parsedDate.getTime())) {
            currentDate = parsedDate;
        }
    }
    
    // Restore saved staff ID if available
    window.initialTargetStaffId = urlParams.get('staffId') || localStorage.getItem('lastSelectedStaffId') || '';

    // 0. Wait for Firebase Auth to restore session (critical for Firestore permissions)
    await new Promise((resolve) => {
        const unsubscribe = firebase.auth().onAuthStateChanged(() => {
            unsubscribe();
            resolve();
        });
        // Timeout fallback: don't block forever if auth fails
        setTimeout(resolve, 3000);
    });

    try {
        const settings = await DBService.getSystemSettings();
        window.centerClosures = settings?.centerClosures || {};
    } catch (e) {
        console.warn("Error loading system settings in report:", e);
        window.centerClosures = {};
    }

    // 1. Title & Admin Controls
    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    // parseRoles có thể chưa load — dùng fallback an toàn
    let roles = [];
    try {
        const parsed = JSON.parse(roleRaw);
        roles = Array.isArray(parsed) ? parsed : [roleRaw];
    } catch (e) {
        roles = [roleRaw];
    }
    const role = roles[0] || 'staff'; // primary role (compat)
    const isSalaryAdmin = roles.includes('admin');
    const isAdminLike = roles.some(r => r === 'admin' || r === 'senior_assistant');

    if (isAdminLike) {
        const tabContainer = document.getElementById('admin-tab-container');
        if (tabContainer) tabContainer.style.display = 'block';

        const controls = document.getElementById('admin-controls');
        if (controls) controls.style.display = 'flex';
        const headerRevs = document.getElementById('admin-header-revenues');
        if (headerRevs) headerRevs.style.display = 'flex';
        document.getElementById('page-title').innerText = isSalaryAdmin ? 'Tính Lương & Duyệt Công' : 'Duyệt Công Nhân Viên';
        await populateStaffSelect();

        // Auto-select staff from URL param
        const urlParams = new URLSearchParams(window.location.search);
        const paramStaffId = urlParams.get('staffId');
        if (paramStaffId) {
            const select = document.getElementById('staff-select');
            if (select) {
                select.value = paramStaffId;
                _cachedStaffId = null;

                // Hiện tên nhân viên trên ô search input
                const selectedOption = select.options[select.selectedIndex];
                const searchInput = document.getElementById('staff-search-input');
                if (searchInput && selectedOption && selectedOption.value) {
                    searchInput.value = selectedOption.text || '';
                }
            }
        }

        // Hide salary-related fields for senior_assistant
        if (!isSalaryAdmin) {
            // Hide: Tạm Ứng, Thưởng/Phạt, Dự Kiến Thực Lĩnh, Xuất PDF, Lưu & Tính
            const salaryAdvance = document.getElementById('salary-advance');
            if (salaryAdvance) salaryAdvance.closest('.modern-form-group').style.display = 'none';
            const bonusPenalty = document.getElementById('summary-bonus-penalty');
            if (bonusPenalty) bonusPenalty.closest('.modern-form-group').style.display = 'none';
            const controlFooter = document.querySelector('.control-footer');
            if (controlFooter) controlFooter.style.display = 'none';
        }

        const bonusBtn = document.getElementById('btn-manual-bonus');
        if (bonusBtn) bonusBtn.style.display = 'none';
        window.isBonusSelectMode = false;

    } else {
        const controls = document.getElementById('admin-controls');
        if (controls) controls.style.display = 'none';
        const headerRevs = document.getElementById('admin-header-revenues');
        if (headerRevs) headerRevs.style.display = 'none';
        document.getElementById('page-title').innerText = 'Bảng Công Cá Nhân';

        const bonusBtn = document.getElementById('btn-manual-bonus');
        if (bonusBtn) {
            const canRequestBonus10 = roles.some(r => r === 'teaching_assistant');
            bonusBtn.style.display = canRequestBonus10 ? 'inline-block' : 'none';
        }
    }

    // Role specific buttons
    const markFixedBtn = document.getElementById('btn-mark-fixed');
    if (markFixedBtn && ['admin', 'senior_assistant', 'receptionist_assistant', 'assistant'].includes(role)) {
        markFixedBtn.style.display = 'inline-block';
    }

    // 2. Set to 1st of current month
    currentDate.setDate(1);

    // 3. Render
    if (!isAdminLike) {
        renderMonthReport(currentDate);
    }

    // Cross-tab update: refresh report if another tab changes class registration
    window.addEventListener('storage', (event) => {
        if (event.key === 'schedule_registration_updated' && event.storageArea === localStorage) {
            if (typeof renderMonthReport === 'function') {
                renderMonthReport(currentDate, true);
            }
        }
    });
}

async function populateStaffSelect() {
    const select = document.getElementById('staff-select');
    const dropdownList = document.getElementById('staff-dropdown-list');

    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    const roles = typeof parseRoles === 'function' ? parseRoles(roleRaw) : [roleRaw];
    const isAdmin = roles.some(r => r === 'admin' || r === 'senior_assistant');

    let users = await DBService.getUsers();

    // Admin thấy tất cả, staff chỉ thấy mình
    if (!isAdmin) {
        const myId = localStorage.getItem('currentUserId');
        users = users.filter(u => u.id === myId);
    } else {
        // Filter out non-personnel and admin accounts
        users = users.filter(u => {
            if (!u.username || !u.name) return false;
            const uname = u.username.toLowerCase();
            return uname !== 'admin' && uname !== 'admin1';
        });
    }

    // Extract employee numerical codes from usernames and sort them
    users.forEach(u => {
        const match = (u.username || '').match(/\d+$/);
        u.msnvStr = match ? match[0] : '';
        u.msnv = match ? parseInt(match[0], 10) : null;
    });

    users.sort((a, b) => {
        if (a.msnv !== null && b.msnv !== null) {
            return a.msnv - b.msnv;
        }
        if (a.msnv !== null) return -1;
        if (b.msnv !== null) return 1;
        return (a.username || '').localeCompare(b.username || '');
    });

    // Lưu global để filter
    window._allStaffList = users;

    // Run filter to populate select and dropdown
    if (typeof filterStaffListByRole === 'function') {
        filterStaffListByRole();
    }

    // Nếu chỉ có 1 user (staff tự xem) → auto-select
    const list = window._filteredStaffList || users;
    if (list.length === 1) {
        selectStaffFromDropdown(list[0]);
    }
}

window.navigateStaff = function(direction) {
    const list = window._filteredStaffList || window._allStaffList || [];
    if (list.length === 0) return;
    const currentId = getTargetStaffId();
    let index = list.findIndex(u => u.id === currentId);
    
    if (index === -1) {
        index = direction > 0 ? 0 : list.length - 1;
    } else {
        index = (index + direction + list.length) % list.length;
    }
    
    const targetUser = list[index];
    if (targetUser) {
        selectStaffFromDropdown(targetUser);
    }
};

function renderStaffDropdownItems(users) {
    const list = document.getElementById('staff-dropdown-list');
    if (!list) return;

    const ROLE_LABELS = {
        'admin': 'Quản Trị Viên',
        'senior_assistant': 'Trợ Lý Cấp Cao',
        'assistant': 'Trợ Lý',
        'teaching_assistant': 'Trợ giảng/ GV TA',
        'receptionist': 'Tiếp Tân',
        'receptionist_assistant': 'Trợ Lí Tiếp Tân',
        'staff': 'Nhân Viên'
    };

    if (users.length === 0) {
        list.innerHTML = '<div style="padding:1rem;text-align:center;color:#9CA3AF;font-size:0.9rem;">Không tìm thấy nhân viên</div>';
        return;
    }

    list.innerHTML = users.map(u => {
        const primaryRole = (u.roles && u.roles[0]) || u.role || '';
        const roleLabel = ROLE_LABELS[primaryRole] || primaryRole || '';
        const color = u.scheduleColor || '#E5E7EB';
        const initial = (u.name || u.username || '?').charAt(0).toUpperCase();
        return `
            <div
                class="staff-dropdown-item"
                data-id="${u.id}"
                onclick="selectStaffFromDropdownById('${u.id}')"
                style="display:flex;align-items:center;gap:0.75rem;padding:0.65rem 1rem;cursor:pointer;transition:background 0.15s;"
                onmouseover="this.style.background='#F0FDF4'"
                onmouseout="this.style.background=''"
            >
                <div style="width:36px;height:36px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;color:white;flex-shrink:0;">${initial}</div>
                <div>
                    <div style="font-weight:600;font-size:0.9rem;color:#1F2937;">${u.name || u.username}</div>
                    <div style="font-size:0.75rem;color:#6B7280;">${roleLabel}${u.username ? ' · ' + u.username : ''}</div>
                </div>
            </div>
        `;
    }).join('');
}

function openStaffDropdown() {
    const list = document.getElementById('staff-dropdown-list');
    const input = document.getElementById('staff-search-input');
    if (!list) return;
    list.style.display = 'block';
    if (input) input.style.borderColor = 'var(--primary-color)';

    // Close when clicking outside
    setTimeout(() => {
        document.addEventListener('click', closeStaffDropdownOnOutside, { once: true });
    }, 0);
}

function closeStaffDropdownOnOutside(e) {
    const wrapper = document.getElementById('staff-search-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        closeStaffDropdown();
    } else {
        // Still inside — re-attach listener
        setTimeout(() => {
            document.addEventListener('click', closeStaffDropdownOnOutside, { once: true });
        }, 0);
    }
}

function closeStaffDropdown() {
    const list = document.getElementById('staff-dropdown-list');
    const input = document.getElementById('staff-search-input');
    if (list) list.style.display = 'none';
    if (input) input.style.borderColor = 'var(--border-color)';
}

function filterStaffDropdown(query) {
    const listToSearch = window._filteredStaffList || window._allStaffList || [];
    const q = query.toLowerCase().trim();
    const filtered = q
        ? listToSearch.filter(u =>
            (u.name || '').toLowerCase().includes(q) ||
            (u.username || '').toLowerCase().includes(q)
        )
        : listToSearch;

    renderStaffDropdownItems(filtered.filter(u => !(u.role === 'admin' && u.username === 'admin')));

    const list = document.getElementById('staff-dropdown-list');
    if (list) list.style.display = 'block';
}

window.selectStaffFromDropdownById = function(id) {
    const user = (window._allStaffList || []).find(u => u.id === id);
    if (user) {
        selectStaffFromDropdown(user);
    } else {
        console.warn("Could not find staff user with ID:", id);
    }
};

function selectStaffFromDropdown(user) {
    // 1. Set hidden select value (giữ compat với getTargetStaffId)
    const select = document.getElementById('staff-select');
    if (select) select.value = user.id;

    // 2. Update input display
    const input = document.getElementById('staff-search-input');
    if (input) input.value = user.name || user.username;

    // Save to localStorage
    if (user && user.id) {
        localStorage.setItem('lastSelectedStaffId', user.id);
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('staffId', user.id);
            window.history.replaceState({}, '', url.toString());
        } catch (e) {
            console.warn('Failed to update URL param:', e);
        }
    }

    // 3. Close dropdown
    closeStaffDropdown();

    if (typeof togglePdfTieptanInputs === 'function') {
        togglePdfTieptanInputs();
    }

    // 4. Load report
    _cachedStaffId = null;
    renderMonthReport(currentDate);
}

window.filterStaffListByRole = function() {
    const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
    
    if (!window._allStaffList) return;
    
    let filteredUsers = window._allStaffList;
    if (filterVal === 'tiep-tan') {
        filteredUsers = window._allStaffList.filter(u => {
            const roles = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role || ''];
            return roles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
        });
    } else if (filterVal === 'giao-vien') {
        filteredUsers = window._allStaffList.filter(u => {
            const roles = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role || ''];
            return roles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
        });
    }
    
    window._filteredStaffList = filteredUsers;
    
    const select = document.getElementById('staff-select');
    const currentSelectedId = select ? (select.value || window.initialTargetStaffId) : window.initialTargetStaffId;
    
    // Update the hidden select (staff-select) options — always populate with all users to keep selection valid
    if (select) {
        select.innerHTML = '<option value="">-- Chọn nhân viên --</option>';
        window._allStaffList.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.name || u.username;
            select.appendChild(opt);
        });
        if (currentSelectedId) {
            select.value = currentSelectedId;
        }
    }
    
    // Update the searchable dropdown items (only show filtered users in search dropdown)
    renderStaffDropdownItems(filteredUsers);
    
    // Check if current selected user is in the filtered list
    const isCurrentInFiltered = filteredUsers.some(u => u.id === currentSelectedId);
    
    if (isCurrentInFiltered) {
        const targetUser = filteredUsers.find(u => u.id === currentSelectedId);
        selectStaffFromDropdown(targetUser);
        window.initialTargetStaffId = '';
    } else if (filteredUsers.length > 0) {
        // Automatically select the first user in the filtered list if current is filtered out
        selectStaffFromDropdown(filteredUsers[0]);
    } else if (filteredUsers.length === 0) {
        // Clear selection
        if (select) select.value = '';
        const input = document.getElementById('staff-search-input');
        if (input) input.value = '';
        _cachedStaffId = null;
        
        localStorage.removeItem('lastSelectedStaffId');
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('staffId');
            window.history.replaceState({}, '', url.toString());
        } catch (e) {
            console.warn('Failed to delete URL param:', e);
        }
        
        renderMonthReport(currentDate);
    } else {
        // If current is still in list, just refresh salary settings loading
        loadSalarySettings();
    }
};

function changeReportMonth(offset) {
    currentDate.setMonth(currentDate.getMonth() + offset);
    localStorage.setItem('lastSelectedMonthStr', currentDate.toISOString());
    renderMonthReport(currentDate);
}

window.isBonusSelectMode = false;
window.toggleBonusSelectionMode = function (btn) {
    window.isBonusSelectMode = !window.isBonusSelectMode;
    if (window.isBonusSelectMode) {
        btn.style.background = '#EF4444'; // Red to cancel
        btn.innerText = 'Bỏ Chọn Thưởng';
        if (typeof UIService !== 'undefined') UIService.toast('Chế độ thưởng: Click vào các ca làm để cộng 10p.', 'info');
    } else {
        btn.style.background = '#10B981'; // Green
        btn.innerText = '+ Thưởng 10p';
        if (typeof UIService !== 'undefined') UIService.toast('Đã tắt chế độ thưởng.', 'info');
    }
    renderMonthReport(currentDate);
};

window.isBonus10SelectMode = false;

window.toggleBonus10SelectMode = function () {
    window.isBonus10SelectMode = !window.isBonus10SelectMode;
    const selectBtn = document.getElementById('btn-select-bonus10-mode');
    const approveBtn = document.getElementById('btn-approve-selected-bonus10');

    if (window.isBonus10SelectMode) {
        if (selectBtn) {
            selectBtn.innerHTML = '✕ Hủy chọn';
            selectBtn.style.background = '#FEE2E2';
            selectBtn.style.color = '#DC2626';
            selectBtn.style.borderColor = '#FECACA';
        }
        if (approveBtn) approveBtn.style.display = 'inline-flex';
        if (typeof UIService !== 'undefined') UIService.toast('Tick ☑ vào các ca muốn duyệt, rồi bấm "Duyệt đã chọn"', 'info');
    } else {
        if (selectBtn) {
            selectBtn.innerHTML = '☑ Chọn để duyệt';
            selectBtn.style.background = '#E0E7FF';
            selectBtn.style.color = '#4F46E5';
            selectBtn.style.borderColor = '#C7D2FE';
        }
        if (approveBtn) approveBtn.style.display = 'none';
    }
    // Re-render để hiện/ẩn checkboxes
    _cachedStaffId = null;
    renderMonthReport(currentDate);
};

window.isFixedShiftMode = false;
window.selectedFixedShifts = new Set();
window.toggleFixedShiftMode = function (btn) {
    window.isFixedShiftMode = !window.isFixedShiftMode;
    const saveBtn = document.getElementById('btn-save-fixed');

    if (window.isFixedShiftMode) {
        btn.style.background = '#EF4444'; // Red to cancel
        btn.innerText = 'Hủy Chọn CĐ';
        if (saveBtn) saveBtn.style.display = 'inline-block';
        if (typeof UIService !== 'undefined') UIService.toast('Chế độ Ca Cố Định: Click vào các ca tiếp tân để chọn.', 'info');
    } else {
        btn.style.background = '#6366F1'; // Indigo
        btn.innerText = 'Đánh dấu Ca Cố Định';
        if (saveBtn) saveBtn.style.display = 'none';
        window.selectedFixedShifts.clear();
        if (typeof UIService !== 'undefined') UIService.toast('Đã tắt chế độ Ca Cố Định.', 'info');
    }
    renderMonthReport(currentDate);
};

window.saveFixedShiftsToServer = async function () {
    if (!window.isFixedShiftMode) return;
    const staffId = document.getElementById('staff-select') ? document.getElementById('staff-select').value : null;
    if (!staffId || staffId === 'all') {
        if (typeof UIService !== 'undefined') UIService.toast('Vui lòng chọn nhân viên trước.', 'error');
        return;
    }
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const monthStr = `${year}-${month}`;

    try {
        const shiftsArr = Array.from(window.selectedFixedShifts);
        await DBService.saveFixedShifts(monthStr, staffId, shiftsArr);
        if (typeof UIService !== 'undefined') UIService.toast('Đã lưu các Ca Cố Định thành công!', 'success');

        // Turn off mode
        const btn = document.getElementById('btn-mark-fixed');
        if (btn) toggleFixedShiftMode(btn);

    } catch (e) {
        console.error("Error saving fixed shifts:", e);
        if (typeof UIService !== 'undefined') UIService.toast('Lỗi khi lưu.', 'error');
    }
};

window.isStudentCountSelectMode = false;
window.selectedStudentCountChips = {}; // key: "dateKey_sessionId", value: { dateStr, sessionId, studentCount, status }

window.toggleStudentCountSelectMode = function () {
    window.isStudentCountSelectMode = !window.isStudentCountSelectMode;
    const btn = document.getElementById('btn-select-student-count-mode');
    const bar = document.getElementById('student-count-select-bar');
    const teacherPanel = document.getElementById('student-count-teacher-panel');
    const adminPanel = document.getElementById('student-count-admin-panel');

    // Parse Roles
    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    let roles = [];
    try { const parsed = JSON.parse(roleRaw); roles = Array.isArray(parsed) ? parsed : [roleRaw]; } catch (e) { roles = [roleRaw]; }
    const isAdminViewer = roles.some(r => r === 'admin' || r === 'senior_assistant');

    if (window.isStudentCountSelectMode) {
        // Enforce lock month check for teachers
        const pubStatus = window.currentMonthlySalarySettingsAll?.published?.status;
        const isMonthLocked = pubStatus === 'published' || pubStatus === 'received';
        if (!isAdminViewer && isMonthLocked) {
            window.isStudentCountSelectMode = false;
            if (typeof UIService !== 'undefined') UIService.toast('Bảng công tháng này đã được khóa (đã gửi/xác nhận), không thể chỉnh sửa.', 'error');
            return;
        }

        // Initialize selections
        window.selectedStudentCountChips = {};
        if (!isAdminViewer) {
            // Teacher mode: pre-populate with existing pending/approved/rejected tags of the month
            window.allMonthChips.forEach(chip => {
                if (chip.sessionId && chip.studentCount > 0) {
                    window.selectedStudentCountChips[chip.dateStr + '_' + chip.sessionId] = {
                        dateStr: chip.dateStr,
                        sessionId: chip.sessionId,
                        studentCount: chip.studentCount,
                        status: chip.studentCountStatus || 'approved'
                    };
                }
            });
        }

        // Toggle UI
        if (btn) {
            btn.innerHTML = '✕ Thoát chế độ chọn';
            btn.style.background = '#FEE2E2';
            btn.style.color = '#DC2626';
            btn.style.borderColor = '#FECACA';
        }
        if (bar) bar.style.display = 'flex';
        if (isAdminViewer) {
            if (adminPanel) adminPanel.style.display = 'flex';
            if (teacherPanel) teacherPanel.style.display = 'none';
        } else {
            if (teacherPanel) teacherPanel.style.display = 'flex';
            if (adminPanel) adminPanel.style.display = 'none';
        }
    } else {
        // Reset UI
        if (btn) {
            btn.innerHTML = '<i data-lucide="users" style="width:14px; height:14px;"></i> Ca đông học sinh';
            btn.style.background = '#F0FDF4';
            btn.style.color = '#166534';
            btn.style.borderColor = '#BBF7D0';
            if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
        }
        if (bar) bar.style.display = 'none';
        if (teacherPanel) teacherPanel.style.display = 'none';
        if (adminPanel) adminPanel.style.display = 'none';
        window.selectedStudentCountChips = {};
    }

    renderMonthReport(currentDate);
};

window.exitStudentCountSelectMode = function () {
    window.isStudentCountSelectMode = false;
    window.toggleStudentCountSelectMode();
};

window.saveStudentCountSelections = async function () {
    const pubStatus = window.currentMonthlySalarySettingsAll?.published?.status;
    const isMonthLocked = pubStatus === 'published' || pubStatus === 'received';
    if (isMonthLocked) {
        if (typeof UIService !== 'undefined') UIService.toast('Bảng công tháng này đã được khóa, không thể lưu.', 'error');
        return;
    }

    const staffId = getTargetStaffId();
    if (!staffId) return;

    const loggedInUser = firebase.auth().currentUser;
    const updaterId = loggedInUser ? loggedInUser.uid : staffId;

    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang lưu sĩ số học sinh...');

        const promises = [];
        
        for (const chip of window.allMonthChips) {
            if (!chip.sessionId || chip.isReceptionist) continue;
            
            const key = chip.dateStr + '_' + chip.sessionId;
            const selection = window.selectedStudentCountChips[key];
            const originalCount = chip.studentCount || null;
            const originalStatus = chip.studentCountStatus || null;

            if (selection) {
                if (selection.studentCount !== originalCount || originalStatus !== 'approved') {
                    if (originalStatus === 'rejected') {
                        continue; // Cannot edit rejected
                    }
                    promises.push(
                        DBService.updateSessionStudentCount(staffId, chip.dateStr, chip.sessionId, selection.studentCount, 'approved', updaterId, 'staff')
                    );
                }
            } else {
                if (originalCount !== null) {
                    if (originalStatus === 'rejected') {
                        continue; // Cannot edit rejected
                    }
                    promises.push(
                        DBService.updateSessionStudentCount(staffId, chip.dateStr, chip.sessionId, null, null, updaterId, 'staff')
                    );
                }
            }
        }

        await Promise.all(promises);
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast('Đã lưu sĩ số học sinh thành công!', 'success');
        }

        window.exitStudentCountSelectMode();
    } catch (error) {
        console.error("Error saving student counts:", error);
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast(error.message || 'Lỗi khi lưu.', 'error');
        }
    }
};

window.adminReviewStudentCount = async function (newStatus) {
    const staffId = getTargetStaffId();
    if (!staffId) return;

    const loggedInUser = firebase.auth().currentUser;
    if (!loggedInUser) return;
    const updaterId = loggedInUser.uid;

    const keys = Object.keys(window.selectedStudentCountChips);
    if (keys.length === 0) {
        if (typeof UIService !== 'undefined') UIService.toast('Vui lòng chọn ít nhất 1 ca để thực hiện.', 'warning');
        return;
    }

    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang cập nhật trạng thái duyệt...');

        const promises = [];
        for (const key of keys) {
            const item = window.selectedStudentCountChips[key];
            promises.push(
                DBService.updateSessionStudentCount(staffId, item.dateStr, item.sessionId, item.studentCount, newStatus, updaterId, 'admin')
            );
        }
        await Promise.all(promises);

        if (newStatus === 'rejected') {
            const year = currentDate.getFullYear();
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            const monthStr = `${year}-${month}`;
            await DBService.saveMonthlyStudentCountPenalty(staffId, monthStr, true, updaterId, 'Từ chối ca đông học sinh');
        }

        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast('Cập nhật trạng thái duyệt thành công!', 'success');
        }

        window.exitStudentCountSelectMode();
        
        if (typeof loadSalarySettings === 'function') {
            await loadSalarySettings();
        }
    } catch (error) {
        console.error("Error in adminReviewStudentCount:", error);
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast(error.message || 'Lỗi khi cập nhật trạng thái duyệt.', 'error');
        }
    }
};

window.openStudentCountReviewModal = function (dateStr, sessionId, chipText, checkIn, checkOut, studentCount, status) {
    document.getElementById('scr-date-key').value = dateStr;
    document.getElementById('scr-session-id').value = sessionId;
    
    document.getElementById('scr-class-name').innerHTML = `Lớp: ${chipText}`;
    document.getElementById('scr-session-time').innerText = `Thời gian: ${checkIn || '--'} - ${checkOut || '--'}`;
    document.getElementById('scr-reported-count').innerText = `Sĩ số khai báo: ${studentCount} học sinh`;
    
    const modal = document.getElementById('student-count-review-modal');
    if (modal) modal.style.display = 'flex';
};

window.closeStudentCountReviewModal = function () {
    const modal = document.getElementById('student-count-review-modal');
    if (modal) modal.style.display = 'none';
};

window.adminQuickAction = async function (action) {
    const dateStr = document.getElementById('scr-date-key').value;
    const sessionId = document.getElementById('scr-session-id').value;
    const staffId = getTargetStaffId();
    if (!staffId || !dateStr || !sessionId) return;

    const loggedInUser = firebase.auth().currentUser;
    if (!loggedInUser) return;
    const updaterId = loggedInUser.uid;

    window.closeStudentCountReviewModal();

    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang xử lý...');

        const chip = window.allMonthChips.find(c => c.dateStr === dateStr && c.sessionId === sessionId);
        const currentCount = chip ? chip.studentCount : 10;

        if (action === 'approved') {
            await DBService.updateSessionStudentCount(staffId, dateStr, sessionId, currentCount, 'approved', updaterId, 'admin');
            if (typeof UIService !== 'undefined') UIService.toast('Đã duyệt ca đông học sinh!', 'success');
        } else if (action === 'rejected') {
            await DBService.updateSessionStudentCount(staffId, dateStr, sessionId, currentCount, 'rejected', updaterId, 'admin');
            
            // Save penalty settings for this month
            const year = currentDate.getFullYear();
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            const monthStr = `${year}-${month}`;
            await DBService.saveMonthlyStudentCountPenalty(staffId, monthStr, true, updaterId, 'Từ chối ca đông học sinh');
            
            if (typeof UIService !== 'undefined') UIService.toast('Đã từ chối và áp dụng phạt phụ cấp tháng này!', 'success');
        } else if (action === 'delete') {
            await DBService.updateSessionStudentCount(staffId, dateStr, sessionId, null, null, updaterId, 'admin');
            if (typeof UIService !== 'undefined') UIService.toast('Đã xóa thông tin sĩ số khai báo!', 'success');
        }

        if (typeof UIService !== 'undefined') UIService.hideLoading();

        // Refresh report
        renderMonthReport(currentDate);
        
        if (typeof loadSalarySettings === 'function') {
            await loadSalarySettings();
        }
    } catch (err) {
        console.error("Error in adminQuickAction:", err);
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast(err.message || 'Lỗi xảy ra', 'error');
        }
    }
};

function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getHolidayName(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);

    // 1. Fixed Solar Holidays
    if (m === 1 && d === 1) return "Tết Dương Lịch";
    if (m === 4 && d === 30) return "Giải phóng MN";
    if (m === 5 && d === 1) return "Quốc tế LĐ";
    if (m === 9 && d === 2) return "Quốc Khánh";
    if (m === 12 && d === 25) return "Giáng Sinh"; // Optional

    // 2. Variable Lunar Holidays (Hardcoded for 2024-2026)
    // 2024
    if (y === 2024) {
        if (m === 2 && (d >= 8 && d <= 14)) return "Tết Nguyên Đán";
        if (m === 4 && d === 18) return "Giỗ Tổ Hùng Vương";
    }
    // 2025
    if (y === 2025) {
        if (m === 1 && d >= 28) return "Tết Nguyên Đán";
        if (m === 2 && d <= 2) return "Tết Nguyên Đán";
        if (m === 4 && d === 7) return "Giỗ Tổ Hùng Vương";
    }
    // 2026
    if (y === 2026) {
        if (m === 2 && (d >= 17 && d <= 22)) return "Tết Nguyên Đán"; // 1st Tet is 17 Feb 2026
        if (m === 4 && d === 25) return "Giỗ Tổ Hùng Vương"; // 10/3 Lunar = Apr 25
    }

    // Sundays are not holidays by default logic here, just "Weekend"
    return null;
}


// ================= CORE REPORT RENDERING =================

// Cache for current staff's notes (loaded from Firestore)
let _cachedStaffNotes = {};
let _cachedStaffId = null;

function renderPersonalTimesheet() {
    renderMonthReport(currentDate);
}

async function renderMonthReport(date, forceServer = false) {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    // Loading State
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem;">Đang tải dữ liệu chấm công từ hệ thống...</div>';

    const monthDisplay = document.getElementById('report-month-title');
    const totalHoursEl = document.getElementById('total-hours-display');

    const year = date.getFullYear();
    const month = date.getMonth();

    if (monthDisplay) {
        monthDisplay.innerText = `Tháng ${month + 1}, ${year}`;
    }

    // Resolve Context (Who are we viewing?)
    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    let roles = [];
    try { const p = JSON.parse(roleRaw); roles = Array.isArray(p) ? p : [roleRaw]; }
    catch (e) { roles = [roleRaw]; }
    const role = roles[0] || 'staff'; // primary role cho compat
    const isAdminRole = roles.some(r => r === 'admin' || r === 'senior_assistant');
    let staffId = getTargetStaffId();

    // Exit select mode if we are switching staff
    if (window.isStudentCountSelectMode && _cachedStaffId !== staffId) {
        window.isStudentCountSelectMode = false;
        const btn = document.getElementById('btn-select-student-count-mode');
        const bar = document.getElementById('student-count-select-bar');
        const teacherPanel = document.getElementById('student-count-teacher-panel');
        const adminPanel = document.getElementById('student-count-admin-panel');
        if (btn) {
            btn.innerHTML = '<i data-lucide="users" style="width:14px; height:14px;"></i> Ca đông học sinh';
            btn.style.background = '#F0FDF4';
            btn.style.color = '#166534';
            btn.style.borderColor = '#BBF7D0';
            if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
        }
        if (bar) bar.style.display = 'none';
        if (teacherPanel) teacherPanel.style.display = 'none';
        if (adminPanel) adminPanel.style.display = 'none';
        window.selectedStudentCountChips = {};
    }

    // 0. Fetch User Context for Name Matching
    window.currentUserContext = null;
    try {
        const userDoc = await DBService.refs.users().doc(staffId).get();
        if (userDoc.exists) window.currentUserContext = userDoc.data();
    } catch (e) { console.error("Error fetching user context", e); }
    const currentUserContext = window.currentUserContext;

    // Load monthly settings for all users to ensure penalty flag and publish status are present
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    try {
        window.currentMonthlySalarySettingsAll = await DBService.getMonthlySalarySettings(staffId, monthStr) || {};
    } catch (e) {
        console.error("Error fetching monthly salary settings in render:", e);
        window.currentMonthlySalarySettingsAll = {};
    }

    // Re-sync tieptan inputs box visibility now that currentUserContext is resolved
    if (typeof togglePdfTieptanInputs === 'function') togglePdfTieptanInputs();

    // --- NEW: Toggle btn-approve-all-bonus10 ---
    const viewerRole = localStorage.getItem('currentRole') || 'staff';
    const viewerRoles = typeof parseRoles === 'function' ? parseRoles(viewerRole) : [viewerRole];
    const isAdminViewer = viewerRoles.some(r => r === 'admin' || r === 'senior_assistant');
    const staffRoles = currentUserContext
        ? (Array.isArray(currentUserContext.roles) && currentUserContext.roles.length > 0
            ? currentUserContext.roles
            : [currentUserContext.role || ''])
        : [];
    const isTeachingAssistant = staffRoles.includes('teaching_assistant');

    const approveAllBtn = document.getElementById('btn-approve-all-bonus10');
    const approveSelectedBtn = document.getElementById('btn-approve-selected-bonus10');
    const selectModeBtn = document.getElementById('btn-select-bonus10-mode');
    const btnSelectStudentCount = document.getElementById('btn-select-student-count-mode');

    if (approveAllBtn) {
        if (isAdminViewer && isTeachingAssistant) {
            approveAllBtn.style.display = 'inline-flex';
        } else {
            approveAllBtn.style.display = 'none';
        }
    }
    if (selectModeBtn) {
        selectModeBtn.style.display = (isAdminViewer && isTeachingAssistant) ? 'inline-flex' : 'none';
    }
    if (approveSelectedBtn) {
        approveSelectedBtn.style.display = (isAdminViewer && isTeachingAssistant && window.isBonus10SelectMode) ? 'inline-flex' : 'none';
    }
    if (btnSelectStudentCount) {
        if (isTeachingAssistant) {
            btnSelectStudentCount.style.display = 'inline-flex';
        } else {
            btnSelectStudentCount.style.display = 'none';
        }
    }

    // 0.1 Load Daily Notes from Firestore (cache for this render cycle)
    if (_cachedStaffId !== staffId) {
        try {
            _cachedStaffNotes = await DBService.getDailyNotes(staffId);
            _cachedStaffId = staffId;
        } catch (e) {
            console.error("Error loading notes from Firestore:", e);
            _cachedStaffNotes = {};
        }
    }

    if (!staffId) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: red;">Vui lòng đăng nhập hoặc chọn nhân viên.</div>';
        return;
    }

    // 1. Fetch DATA (Attendance + Schedule)

    // Fetch Fixed Shifts for the month
    window.savedFixedShiftsMonth = [];
    try {
        window.savedFixedShiftsMonth = await DBService.getFixedShifts(monthStr, staffId);
        // If we are currently IN selection mode, prepopulate the Set on first load
        if (window.isFixedShiftMode && window.selectedFixedShifts.size === 0 && window.savedFixedShiftsMonth.length > 0) {
            window.savedFixedShiftsMonth.forEach(id => window.selectedFixedShifts.add(id));
        }
    } catch (e) { console.error("Could not fetch fixed shifts:", e); }

    // Fetch Cancelled Shifts (Admin specifically excluded)
    let cancelledShifts = [];
    try {
        cancelledShifts = await DBService.getCancelledShifts(monthStr, staffId);
    } catch (e) {
        console.error("Could not fetch cancelled shifts:", e);
    }

    // A. Attendance Logs (Actual Check-in/out)
    // DBService.getMonthlyAttendance returns array of docs with { sessions: [...] }
    const attendanceRecords = await DBService.getMonthlyAttendance(monthStr, staffId, forceServer);

    // Normalize Attendance into a Map: "YYYY-MM-DD" -> [sessions]
    const attendanceMap = {};
    attendanceRecords.forEach(record => {
        // record.date is "YYYY-MM-DD"
        if (record.date) {
            attendanceMap[record.date] = record.sessions || [];
        }
    });

    // D. Overtime Requests for this staff+month
    let overtimeRequestsList = [];
    try {
        overtimeRequestsList = await DBService.getOvertimeRequestsForStaff(staffId, monthStr);
    } catch (e) { console.warn('[OT] Could not load OT requests:', e); }

    // Fetch bonus10 requests cho tháng này
    let bonus10RequestsList = [];
    try {
        bonus10RequestsList = await DBService.getBonus10RequestsForStaff(staffId, monthStr);
    } catch (e) { console.warn('[Bonus10] Could not load requests:', e); }

    // Build bonus10Map: sessionId (string) → request data
    const bonus10Map = {};
    bonus10RequestsList.forEach(req => {
        const key = String(req.sessionId);
        // Ưu tiên: approved > pending > rejected
        const existing = bonus10Map[key];
        if (!existing || req.status === 'approved' || (req.status === 'pending' && existing.status === 'rejected')) {
            bonus10Map[key] = req;
        }
    });

    // Build overtimeDateMap: "YYYY-MM-DD" -> { sessionId -> otData }
    const overtimeDateMap = {};
    overtimeRequestsList.forEach(ot => {
        if (!overtimeDateMap[ot.dateKey]) overtimeDateMap[ot.dateKey] = {};
        const existing = overtimeDateMap[ot.dateKey][ot.sessionId];
        if (!existing || ot.status === 'approved' || (ot.status === 'pending' && existing.status === 'rejected')) {
            overtimeDateMap[ot.dateKey][ot.sessionId] = ot;
        }
    });

    // === AUTO-CLOSE STALE SESSIONS — chạy SAU khi có scheduleMap (xem bên dưới) ===
    const todayKey = getLocalDateKey(new Date());


    // B. Schedule Data (For the whole month)
    // Fetch from BOTH branches (cs1, cs2) and merge
    const BRANCHES = ['cs1', 'cs2', 'cs3'];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const schedulePromises = [];
    for (let d = 1; d <= daysInMonth; d++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        BRANCHES.forEach(branch => {
            const compositeKey = `${branch}__${dateKey}`;
            schedulePromises.push(
                DBService.getSchedule(compositeKey).then(data => ({ date: dateKey, data: data || {}, branch, compositeKey }))
            );
        });
    }
    const scheduleResults = await Promise.all(schedulePromises);
    const scheduleMap = {}; // "YYYY-MM-DD" -> merged ScheduleObject
    scheduleResults.forEach(item => {
        if (!scheduleMap[item.date]) scheduleMap[item.date] = {};
        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
        sections.forEach(sec => {
            const rows = item.data[sec] || [];
            // Inject _branch and _compositeKey into each class row for chip display + delete
            const taggedRows = rows.map((row, idx) => ({ ...row, _branch: item.branch, _compositeKey: item.compositeKey, _originalIndex: idx }));
            if (!scheduleMap[item.date][sec]) scheduleMap[item.date][sec] = [];
            scheduleMap[item.date][sec] = scheduleMap[item.date][sec].concat(taggedRows);
        });
    });



    // C. Receptionist Schedule Data (only for receptionist role staff)
    const receptionistShiftsMap = {}; // "YYYY-MM-DD" -> [{ shift, label, start, end }]
    // FIX: staffRoles đã xử lý đúng cả roles[] lẫn role string — dùng lại thay vì parseRoles()
    // (parseRoles() không handle array từ Firestore, gây isReceptionistStaff = false sai)
    const isReceptionistStaff = currentUserContext && staffRoles.some(r =>
        ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant', 'admin'].includes(r)
    );

    if (isReceptionistStaff) {
        try {
            // 1. Get shift config PER BRANCH
            const shiftConfigMap = {}; // branch -> config
            for (const branch of BRANCHES) {
                shiftConfigMap[branch] = await DBService.getReceptionistShiftConfig(branch);
            }
            const SHIFT_LABELS = { morning: 'SÁNG', afternoon: 'CHIỀU', evening: 'TỐI' };
            const SHIFT_KEYS = ['morning', 'afternoon', 'evening'];
            const DAY_KEYS_MAP = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

            // 2. Calculate which week-start Mondays cover this month
            // Helper: getMonday for a given date
            const getMonday = (d) => {
                const date = new Date(d);
                const day = date.getDay();
                const diff = date.getDate() - day + (day === 0 ? -6 : 1);
                date.setDate(diff);
                date.setHours(0, 0, 0, 0);
                return date;
            };

            const mondaysSet = new Set();
            for (let d = 1; d <= daysInMonth; d++) {
                const dateObj = new Date(year, month, d);
                const monday = getMonday(dateObj);
                const mKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
                mondaysSet.add(mKey);
            }

            // 3. Fetch receptionist schedules for each unique Monday from all branches
            const recepPromises = [];
            const mondaysList = [...mondaysSet];
            BRANCHES.forEach(branch => {
                mondaysList.forEach(mondayKey => {
                    const compositeKey = `${branch}__${mondayKey}`;
                    recepPromises.push(
                        DBService.getReceptionistSchedule(compositeKey).then(data => ({
                            branch,
                            mondayKey,
                            data: data || {}
                        }))
                    );
                });
            });

            const recepResults = await Promise.all(recepPromises);

            // 4. For each day in the month, check if this staff was assigned
            for (let d = 1; d <= daysInMonth; d++) {
                const dateObj = new Date(year, month, d);
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const monday = getMonday(dateObj);
                const mondayKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

                // Calculate day of week index (0=mon, 1=tue, ..., 6=sun)
                const dayOfWeek = dateObj.getDay();
                const dayIdx = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert Sun=0 → 6, Mon=1 → 0, etc.
                const dayKey = DAY_KEYS_MAP[dayIdx];

                // Check all fetched receptionist schedules for this monday + day
                recepResults.forEach(result => {
                    if (result.mondayKey !== mondayKey) return;

                    SHIFT_KEYS.forEach(shiftKey => {
                        const shiftData = result.data[shiftKey];
                        if (!shiftData || !shiftData[dayKey]) return;

                        const staffList = shiftData[dayKey];
                        const staffEntry = staffList.find(s => s.id === staffId);
                        if (!staffEntry) return;

                        // This staff is assigned to this shift on this day!
                        if (!receptionistShiftsMap[dateStr]) receptionistShiftsMap[dateStr] = [];

                        // Use per-branch shift config, with custom times override
                        const branchConfig = shiftConfigMap[result.branch] || {};
                        // Ưu tiên shiftConfig snapshot từ weekData doc, fallback về branch global config
                        const weekShiftConfig = result.data?._shiftConfig?.[shiftKey];
                        const defaultStart = staffEntry.customStart || weekShiftConfig?.start || branchConfig[shiftKey]?.start || '07:00';
                        const defaultEnd = staffEntry.customEnd || weekShiftConfig?.end || branchConfig[shiftKey]?.end || '11:30';

                        // Add entry (allow same shift from different branches as separate entries)
                        receptionistShiftsMap[dateStr].push({
                            shift: shiftKey,
                            label: SHIFT_LABELS[shiftKey],
                            start: staffEntry.customStart || defaultStart,
                            end: staffEntry.customEnd || defaultEnd,
                            branch: result.branch,
                            isFixedShift: staffEntry.isFixedShift ? true : false
                        });
                    });
                });
            }

            console.log('[Report] Receptionist shifts loaded:', Object.keys(receptionistShiftsMap).length, 'days with shifts');
        } catch (e) {
            console.error('[Report] Error loading receptionist schedules:', e);
        }
    }

    // --- NEW: MERGE TOUCHING RECEPTIONIST SHIFTS ---
    if (Object.keys(receptionistShiftsMap).length > 0) {
        Object.keys(receptionistShiftsMap).forEach(dateStr => {
            let dailyShifts = receptionistShiftsMap[dateStr];
            if (dailyShifts.length > 1) {
                // Sort by start time just in case
                dailyShifts.sort((a, b) => a.start.localeCompare(b.start));
                let mergedShifts = [];

                const timeStrToMin2 = (t) => {
                    if (!t) return 0;
                    const parts = t.split(':');
                    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
                };

                // Khởi tạo segment đầu tiên
                let currentShift = { ...dailyShifts[0] };
                // Lưu segments để tính lương đúng từng đoạn CĐ/thường
                let currentSegments = [{
                    start: dailyShifts[0].start,
                    end: dailyShifts[0].end,
                    schedMinutes: timeStrToMin2(dailyShifts[0].end) - timeStrToMin2(dailyShifts[0].start),
                    isFixedShift: dailyShifts[0].isFixedShift || false
                }];

                for (let i = 1; i < dailyShifts.length; i++) {
                    let nextShift = dailyShifts[i];
                    
                    const currentEndMin = timeStrToMin2(currentShift.end);
                    const nextStartMin = timeStrToMin2(nextShift.start);

                    // Chỉ merge khi 2 ca cùng loại (cùng CĐ hoặc cùng thường).
                    // Ca CĐ kề ca thường → giữ riêng để stats/lương/hiển thị không lẫn lộn.
                    const sameFixedType = (currentShift.isFixedShift || false) === (nextShift.isFixedShift || false);

                    // Merge if shifts touch, overlap, or have a gap of <= 60 minutes
                    if (sameFixedType && nextStartMin - currentEndMin <= 60) {
                        if (nextShift.end > currentShift.end) {
                            currentShift.end = nextShift.end;
                        }
                        currentShift.label = `${currentShift.label} + ${nextShift.label}`;
                        currentSegments.push({
                            start: nextShift.start,
                            end: nextShift.end,
                            schedMinutes: timeStrToMin2(nextShift.end) - timeStrToMin2(nextShift.start),
                            isFixedShift: nextShift.isFixedShift || false
                        });
                    } else {
                        // Gắn segments vào shift nếu có nhiều hơn 1
                        if (currentSegments.length > 1) currentShift.mergedSegments = currentSegments;
                        mergedShifts.push(currentShift);
                        currentShift = { ...nextShift };
                        currentSegments = [{
                            start: nextShift.start,
                            end: nextShift.end,
                            schedMinutes: timeStrToMin2(nextShift.end) - timeStrToMin2(nextShift.start),
                            isFixedShift: nextShift.isFixedShift || false
                        }];
                    }
                }
                if (currentSegments.length > 1) currentShift.mergedSegments = currentSegments;
                mergedShifts.push(currentShift);
                receptionistShiftsMap[dateStr] = mergedShifts;
            }
        });
    }

    // === AUTO-CLOSE STALE SESSIONS (chạy sau khi có scheduleMap và receptionistShiftsMap) ===
    {
        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
        Object.entries(attendanceMap).forEach(([dateKey, sessions]) => {
            if (dateKey >= todayKey) return;
            const sched = scheduleMap[dateKey] || {};
            sessions.forEach(s => {
                if (s.id && (!s.checkOut || s.autoClosedReason === 'stale_session' || (s.checkOut && s.checkOut.includes('T23:59:00')))) {
                    // Tìm giờ kết thúc lịch cho session này
                    let correctEndISO = null;
                    const checkIn = s.checkIn ? new Date(s.checkIn) : null;
                    if (checkIn) {
                        // 1. Kiểm tra ca dạy (Teaching classes)
                        const staffClasses = [];
                        sections.forEach(sec => {
                            (sched[sec] || []).forEach(cls => {
                                const isAssigned = (cls.gvId && cls.gvId === staffId) ||
                                    (cls.gvThayTheId && cls.gvThayTheId === staffId) ||
                                    (cls.registeredTeachers || []).some(t => t.id === staffId);
                                if (isAssigned && cls.start && cls.end) {
                                    staffClasses.push(cls);
                                }
                            });
                        });

                        let matchedClass = null;
                        let minDiff = Infinity;
                        staffClasses.forEach(cls => {
                            const clsStart = getVietnamDateFromHM(dateKey, cls.start);
                            const clsEnd = getVietnamDateFromHM(dateKey, cls.end);
                            if (!clsStart || !clsEnd) return;

                            const diffMs = Math.abs(checkIn - clsStart);
                            if (diffMs < 60 * 60 * 1000 && checkIn < new Date(clsEnd.getTime() + 15 * 60 * 1000)) {
                                if (diffMs < minDiff) {
                                    minDiff = diffMs;
                                    matchedClass = cls;
                                }
                            }
                        });

                        if (matchedClass) {
                            let currentEndStr = matchedClass.end;
                            let extended = true;
                            while (extended) {
                                extended = false;
                                for (const cls of staffClasses) {
                                    if (cls.start === currentEndStr) {
                                        currentEndStr = cls.end;
                                        extended = true;
                                        break;
                                    }
                                }
                            }
                            const finalEndDate = getVietnamDateFromHM(dateKey, currentEndStr);
                            if (finalEndDate) {
                                correctEndISO = finalEndDate.toISOString();
                            }
                        }

                        // 2. Nếu không khớp ca dạy, kiểm tra ca Tiếp Tân (Receptionist shifts)
                        if (!correctEndISO && receptionistShiftsMap[dateKey]) {
                            let matchedRecepShift = null;
                            let minRecepDiff = Infinity;
                            receptionistShiftsMap[dateKey].forEach(rs => {
                                const shiftStart = getVietnamDateFromHM(dateKey, rs.start);
                                const shiftEnd = getVietnamDateFromHM(dateKey, rs.end);
                                if (!shiftStart || !shiftEnd) return;

                                const diffMs = Math.abs(checkIn - shiftStart);
                                if (diffMs < 90 * 60 * 1000) {
                                    if (diffMs < minRecepDiff) {
                                        minRecepDiff = diffMs;
                                        matchedRecepShift = rs;
                                    }
                                }
                            });

                            if (matchedRecepShift) {
                                const finalEndDate = getVietnamDateFromHM(dateKey, matchedRecepShift.end);
                                if (finalEndDate) {
                                    correctEndISO = finalEndDate.toISOString();
                                }
                            }
                        }
                    }
                    const fallbackISO = getVietnamDateFromHM(dateKey, "23:59")?.toISOString() || new Date(`${dateKey}T23:59:00Z`).toISOString();
                    const closeISO = correctEndISO || fallbackISO;
                    
                    if (s.checkOut !== closeISO) {
                        // Cập nhật local ngay lập tức để render đúng đồng thì
                        s.checkOut = closeISO;
                        s.autoClosedReason = 'stale_session';
                        DBService.autoCloseStaleSession(staffId, dateKey, s.id, closeISO);
                    }
                }
            });
        });
    }

    // === AUTO-CLOSE TODAY'S OVERDUE RECEPTIONIST/TEACHER SESSIONS ===
    // If today has an open session and the shift/class has ended, auto-close it
    const todaySessions = attendanceMap[todayKey] || [];
    const nowForAutoClose = new Date();
    todaySessions.forEach(s => {
        if (s.checkOut || !s.id) return;
        const checkInTime = new Date(s.checkIn || s.start);

        // Check receptionist shifts
        const todayRecepShifts = receptionistShiftsMap[todayKey] || [];
        let shiftEnded = false;
        todayRecepShifts.forEach(rs => {
            const shiftStart = getVietnamDateFromHM(todayKey, rs.start);
            const shiftEnd = getVietnamDateFromHM(todayKey, rs.end);
            if (shiftStart && shiftEnd) {
                if (Math.abs(checkInTime - shiftStart) < 60 * 60 * 1000 && nowForAutoClose >= shiftEnd) {
                    shiftEnded = true;
                }
            }
        });
        if (shiftEnded) {
            DBService.checkOutPersonal(staffId).then(() => {
                s.checkOut = nowForAutoClose.toISOString();
                console.log(`[Report AutoClose] Auto-closed today's overdue session for ${staffId}`);
            }).catch(e => console.warn('[Report AutoClose] Error:', e));
            return;
        }

        // Check teacher classes
        const todaySchedule = scheduleMap[todayKey] || {};
        const staffClasses = [];
        ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'].forEach(sec => {
            (todaySchedule[sec] || []).forEach(cls => {
                const isRegistered = (cls.gvId && cls.gvId === staffId) ||
                    (cls.gvThayTheId && cls.gvThayTheId === staffId) ||
                    (cls.registeredTeachers || []).some(t => t.id === staffId);
                if (isRegistered && cls.start && cls.end) {
                    staffClasses.push(cls);
                }
            });
        });

        // Find closest starting class within 60 mins window
        let matchedClass = null;
        let minDiff = Infinity;
        staffClasses.forEach(cls => {
            const clsStart = getVietnamDateFromHM(todayKey, cls.start);
            const clsEnd = getVietnamDateFromHM(todayKey, cls.end);
            if (!clsStart || !clsEnd) return;

            const diffMs = Math.abs(checkInTime - clsStart);
            if (diffMs < 60 * 60 * 1000 && checkInTime < new Date(clsEnd.getTime() + 15 * 60 * 1000)) {
                if (diffMs < minDiff) {
                    minDiff = diffMs;
                    matchedClass = cls;
                }
            }
        });

        if (matchedClass) {
            // Find the end of any consecutive class chain today
            let currentEndStr = matchedClass.end;
            let extended = true;
            while (extended) {
                extended = false;
                for (const cls of staffClasses) {
                    if (cls.start === currentEndStr) {
                        currentEndStr = cls.end;
                        extended = true;
                        break;
                    }
                }
            }
            const finalEndDate = getVietnamDateFromHM(todayKey, currentEndStr);
            if (finalEndDate && nowForAutoClose >= finalEndDate) {
                DBService.checkOutPersonal(staffId).then(() => {
                    s.checkOut = nowForAutoClose.toISOString();
                    console.log(`[Report AutoClose] Auto-closed today's overdue class session for ${staffId}`);
                }).catch(e => console.warn('[Report AutoClose] Error:', e));
            }
        }
    });

    // 2. CALCULATE & RENDER
    let totalMinutes = 0;
    // let totalSalary = 0; // Moved to calculateSalary()
    window.currentMonthChips = []; // Store for filtering (paidMinutes > 0 only)
    window.allMonthChips = [];    // Store ALL chips including absent (chip-gray) for stats
    window.unfilteredAllMonthChips = []; // Track ALL chips without filter applied
    grid.innerHTML = '';
    
    // Populate Day Select Dropdown
    const daySelect = document.getElementById('select-calendar-day');
    if (daySelect) {
        daySelect.innerHTML = '<option value="">Chọn Ngày</option>';
        for (let dNum = 1; dNum <= daysInMonth; dNum++) {
            const opt = document.createElement('option');
            opt.value = dNum;
            opt.textContent = `Ngày ${dNum}`;
            daySelect.appendChild(opt);
        }
    }
    
    // Reset Week Select Dropdown
    const weekSelect = document.getElementById('select-calendar-week');
    if (weekSelect) {
        weekSelect.value = '';
    }

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0=Sun

    let startOffset = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

    // Empty Slots (Muted previous month days)
    const prevMonthDate = new Date(year, month, 0);
    const prevMonthDays = prevMonthDate.getDate();
    for (let i = startOffset - 1; i >= 0; i--) {
        const dNum = prevMonthDays - i;
        const empty = document.createElement('div');
        empty.className = 'calendar-cell disabled';
        empty.style.opacity = '0.35';
        empty.style.background = '#F9FAFB';
        empty.style.border = '1px solid var(--border-color)';
        
        const dateHeader = document.createElement('div');
        dateHeader.style.display = 'flex';
        dateHeader.style.justifyContent = 'space-between';
        dateHeader.style.marginBottom = '0.5rem';
        dateHeader.innerHTML = `<span style="font-weight: 500; color: #9CA3AF;">${dNum}</span>`;
        
        empty.appendChild(dateHeader);
        grid.appendChild(empty);
    }

    // Days
    for (let d = 1; d <= daysInMonth; d++) { try {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const cell = document.createElement('div');
        cell.className = 'calendar-cell';
        cell.id = 'calendar-cell-' + dateStr;

        // Header
        const dateHeader = document.createElement('div');
        dateHeader.style.display = 'flex';
        dateHeader.style.justifyContent = 'space-between';
        dateHeader.style.marginBottom = '0.5rem';

        // Check if date has a note (from Firestore-cached data)
        const noteText = _cachedStaffNotes[dateStr] || '';
        const hasNote = !!noteText;

        if (hasNote) {
            // Highlighted date number with pin
            dateHeader.innerHTML = `<span style="font-weight: 700; color: var(--primary-color);">📌 ${d}</span>`;
            // Highlight entire cell background
            cell.style.backgroundColor = '#EFF6FF'; // Light blue
            cell.style.borderLeft = '3px solid var(--primary-color)';
        } else {
            dateHeader.innerHTML = `<span style="font-weight: 600;">${d}</span>`;
        }

        // --- HOLIDAY CHECK ---
        const holidayName = getHolidayName(dateStr);
        if (holidayName) {
            const holDiv = document.createElement('div');
            holDiv.style.fontSize = '0.7em';
            holDiv.style.color = '#EF4444';
            holDiv.style.marginTop = '2px';
            holDiv.style.fontWeight = 'bold';
            holDiv.innerHTML = `${window.getIconHtml('flag', {width: '14', height: '14', style: 'display:inline-block; vertical-align:middle; margin-right:4px;'})} ${holidayName}`;
            dateHeader.appendChild(holDiv);

            // Highlight cell background slightly (holiday takes priority if also has note)
            if (!hasNote) cell.style.backgroundColor = '#FEF2F2';
        }

        // Note Button
        const controlsDiv = document.createElement('div');
        controlsDiv.style.display = 'flex';
        controlsDiv.style.gap = '4px';

        const noteBtn = document.createElement('button');
        noteBtn.innerHTML = window.getIconHtml('file-text', {width: '14', height: '14'});
        noteBtn.className = 'action-btn';
        noteBtn.title = hasNote ? `Ghi chú: ${noteText.substring(0, 50)}...` : 'Thêm ghi chú';
        noteBtn.onclick = () => openNoteModal(dateStr);
        if (hasNote) noteBtn.style.color = 'var(--primary-color)';
        else noteBtn.style.color = '#ccc';

        controlsDiv.appendChild(noteBtn);

        // --- ADMIN ONLY: Manual Add Button ---
        if (isAdminRole) {
            const addBtn = document.createElement('button');
            addBtn.innerHTML = window.getIconHtml('plus', {width: '14', height: '14'});
            addBtn.className = 'action-btn';
            addBtn.title = 'Chấm công bù/thủ công';
            addBtn.style.color = '#10B981'; // Green
            addBtn.onclick = () => openManualModal(dateStr);
            controlsDiv.appendChild(addBtn);
        }

        dateHeader.appendChild(controlsDiv);
        cell.appendChild(dateHeader);

        // --- Render Chips based on Logic ---
        const dailySchedule = scheduleMap[dateStr] || {};
        const dailyAttendance = attendanceMap[dateStr] || [];
        const dailyReceptionistShifts = receptionistShiftsMap[dateStr] || [];

        const chips = calculateDailyChips(dailySchedule, dailyAttendance, staffId, dateStr, currentUserContext, dailyReceptionistShifts, overtimeDateMap[dateStr] || {}, cancelledShifts, bonus10Map);
        // Inject dateStr so we can auto-save roles later
        chips.forEach(c => {
            c.dateStr = dateStr;
            window.unfilteredAllMonthChips.push(c);
        });

        const salaryRoleFilterEl = document.getElementById('salary-role-filter');
        const salaryRoleFilter = salaryRoleFilterEl ? salaryRoleFilterEl.value : 'all';

        let filteredChips = chips;
        if (salaryRoleFilter === 'tiep-tan') {
            filteredChips = chips.filter(chip => chip.isReceptionist === true);
        } else if (salaryRoleFilter === 'giao-vien') {
            filteredChips = chips.filter(chip => chip.isReceptionist !== true);
        }

        const displayFilterEl = document.getElementById('display-role-filter');
        const displayFilter = displayFilterEl ? displayFilterEl.value : 'all';

        if (displayFilter !== 'all') {
            if (displayFilter === 'ca-co-dinh') {
                filteredChips = filteredChips.filter(chip => chip.isFixedShift === true);
            } else if (displayFilter === 'ca-binh-thuong') {
                filteredChips = filteredChips.filter(chip => chip.isFixedShift === false);
            } else {
                filteredChips = filteredChips.filter(chip => chip.chipFilterName === displayFilter);
            }
        }

        const currentRoleRaw2 = localStorage.getItem('currentRole') || 'staff';
        let currentRolesArr = [];
        try { const _cp = JSON.parse(currentRoleRaw2); currentRolesArr = Array.isArray(_cp) ? _cp : [currentRoleRaw2]; } catch (e) { currentRolesArr = [currentRoleRaw2]; }
        const canRequestBonus10 = currentRolesArr.some(r => ['teaching_assistant', 'admin', 'senior_assistant'].includes(r));
        const isAdminRoleLoop = currentRolesArr.some(r => ['admin', 'senior_assistant'].includes(r));
        // Có quyền xác nhận vắng cho tiếp tân
        const canConfirmAbsent = currentRolesArr.some(r => ['admin', 'senior_assistant', 'assistant', 'receptionist_assistant'].includes(r));

        filteredChips.forEach(chip => {
            const div = document.createElement('div');
            div.className = `schedule-chip ${chip.class}`;
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';

            let badgeHtml = '';
            if (chip.studentCount && chip.studentCount > 0) {
                const isPenaltyActive = !!window.currentMonthlySalarySettingsAll?.studentCountBonusPenalty || !!window.hasAnyRejectedStudentCountSessionInMonth;
                const status = chip.studentCountStatus === 'rejected' ? 'rejected' : 'approved';
                
                let badgeText = '';
                let badgeClass = '';
                
                if (isPenaltyActive) {
                    if (status === 'approved') {
                        badgeText = `${chip.studentCount}hs (Đã duyệt - Bị phạt)`;
                        badgeClass = 'student-count-badge penalty-applied';
                    } else {
                        badgeText = `${chip.studentCount}hs (Từ chối - Hủy phụ cấp tháng)`;
                        badgeClass = 'student-count-badge rejected';
                    }
                } else {
                    if (status === 'approved') {
                        badgeText = `${chip.studentCount}hs (Đã duyệt)`;
                        badgeClass = 'student-count-badge approved';
                    } else {
                        badgeText = `${chip.studentCount}hs (Từ chối)`;
                        badgeClass = 'student-count-badge rejected';
                    }
                }
                badgeHtml = `<span class="${badgeClass}">${badgeText}</span>`;
            }

            let editedHtml = '';
            if (chip.isAdminEdited && !chip.isAdminCreated) {
                editedHtml = ` <span title="Admin đã chỉnh sửa" style="cursor:help; margin-left:4px; display:inline-flex; align-items:center; vertical-align:middle;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>`;
            }

            div.innerHTML = `<span>${chip.text}${editedHtml}${badgeHtml}</span>`;

            if (chip.isWarning) {
                const warningIcon = document.createElement('span');
                const isAdmin = chip.isAdminCreated;
                warningIcon.innerHTML = isAdmin
                    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
                    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
                warningIcon.style.cssText = 'cursor:pointer;margin-left:4px;display:inline-flex;align-items:center';
                warningIcon.title = isAdmin ? 'Admin đã thêm ca này' : 'Click để xem chi tiết';
                warningIcon.onclick = (e) => {
                    e.stopPropagation();

                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease';
                    overlay.onclick = (ev) => { if (ev.target === overlay) overlay.remove(); };

                    const modal = document.createElement('div');
                    modal.style.cssText = 'background:white;border-radius:16px;padding:2rem;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);position:relative;animation:slideUp 0.3s ease';

                    if (chip.isReceptionist && !chip.sessionData) {
                        // === RECEPTIONIST ABSENT SHIFT MODAL ===
                        const schedInfo = chip.schedData || {};
                        modal.innerHTML = `
                            <div style="text-align:center;margin-bottom:1.5rem">
                                <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#FEF2F2;margin-bottom:0.75rem">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                </div>
                                <h3 style="font-size:1.25rem;font-weight:700;color:#1F2937;margin:0">Vắng Ca Tiếp Tân</h3>
                            </div>
                            <div style="background:#F9FAFB;border-radius:12px;padding:1rem;margin-bottom:1rem">
                                <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;align-items:center">
                                    <span style="display:inline-flex; align-items:center;">${window.getIconHtml('calendar', {width: '20', height: '20'})}</span>
                                    <div>
                                        <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ngày</div>
                                        <div style="font-weight:600;color:#1F2937">${dateStr}</div>
                                    </div>
                                </div>
                                <div style="display:flex;gap:1.5rem">
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="display:inline-flex; align-items:center; color:#10B981;">${window.getIconHtml('play-circle', {width: '20', height: '20'})}</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ca bắt đầu</div>
                                            <div style="font-weight:600;color:#1F2937">${schedInfo.start || '???'}</div>
                                        </div>
                                    </div>
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="display:inline-flex; align-items:center; color:#EF4444;">${window.getIconHtml('stop-circle', {width: '20', height: '20'})}</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ca kết thúc</div>
                                            <div style="font-weight:600;color:#1F2937">${schedInfo.end || '???'}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div style="background:#FEF2F2;border-radius:12px;padding:1rem;margin-bottom:0.75rem;border-left:3px solid #EF4444">
                                <div style="font-size:0.8rem;font-weight:600;color:#DC2626;margin-bottom:0.25rem;display:flex;align-items:center;gap:4px;">${window.getIconHtml('clipboard', {width: '16', height: '16'})} Trạng thái</div>
                                <div style="font-size:0.85rem;color:#7F1D1D">Tiếp tân đã được xếp lịch cho ca này nhưng <strong>không có dữ liệu chấm công</strong>.</div>
                            </div>
                            <div style="background:#ECFDF5;border-radius:12px;padding:1rem;margin-bottom:1.5rem;border-left:3px solid #10B981">
                                <div style="font-size:0.8rem;font-weight:600;color:#059669;margin-bottom:0.25rem;display:flex;align-items:center;gap:4px;">${window.getIconHtml('info', {width: '16', height: '16'})} Giải pháp</div>
                                <div style="font-size:0.85rem;color:#065F46">Tiếp tân cần <strong>"Vào Ca"</strong> trên trang Chấm Công trước khi bắt đầu ca, hoặc Admin hãy chấm công bù.</div>
                            </div>
                            <button id="warning-modal-close-btn" style="width:100%;padding:0.75rem;background:var(--primary-color, #3B82F6);color:white;border:none;border-radius:10px;font-size:0.95rem;font-weight:600;cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Đã hiểu</button>
                        `;
                    } else if (isAdmin) {
                        // Admin-created session modal
                        const s = chip.sessionData || {};
                        const startTime = s.checkIn ? new Date(s.checkIn).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';
                        const endTime = s.checkOut ? new Date(s.checkOut).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Chưa ra ca';
                        modal.innerHTML = `
                            <div style="text-align:center;margin-bottom:1.5rem">
                                <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#EFF6FF;margin-bottom:0.75rem">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                                </div>
                                <h3 style="font-size:1.25rem;font-weight:700;color:#1F2937;margin:0">Ca Được Admin Thêm</h3>
                            </div>
                            <div style="background:#F9FAFB;border-radius:12px;padding:1rem;margin-bottom:1rem">
                                <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;align-items:center">
                                    <span style="display:inline-flex; align-items:center;">${window.getIconHtml('calendar', {width: '20', height: '20'})}</span>
                                    <div>
                                        <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ngày</div>
                                        <div style="font-weight:600;color:#1F2937">${dateStr}</div>
                                    </div>
                                </div>
                                <div style="display:flex;gap:1.5rem">
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="display:inline-flex; align-items:center; color:#10B981;">${window.getIconHtml('play-circle', {width: '20', height: '20'})}</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Vào ca</div>
                                            <div style="font-weight:600;color:#1F2937">${startTime}</div>
                                        </div>
                                    </div>
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="display:inline-flex; align-items:center; color:#EF4444;">${window.getIconHtml('stop-circle', {width: '20', height: '20'})}</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ra ca</div>
                                            <div style="font-weight:600;color:#1F2937">${endTime}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div style="background:#EFF6FF;border-radius:12px;padding:1rem;margin-bottom:1.5rem;border-left:3px solid #3B82F6">
                                <div style="font-size:0.8rem;font-weight:600;color:#2563EB;margin-bottom:0.25rem;display:flex;align-items:center;gap:4px;">${window.getIconHtml('wrench', {width: '16', height: '16'})} Thông tin</div>
                                <div style="font-size:0.85rem;color:#1E40AF">Ca này được <strong>Quản lý thêm thủ công</strong>. Nếu chưa chọn vai trò, hãy bấm vào chip để chọn.</div>
                            </div>
                            <button id="warning-modal-close-btn" style="width:100%;padding:0.75rem;background:#3B82F6;color:white;border:none;border-radius:10px;font-size:0.95rem;font-weight:600;cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Đã hiểu</button>
                        `;
                    } else if (!chip.sessionData && chip.schedData) {
                        // Teacher absent chip (has schedData, no sessionData)
                        const schedInfo = chip.schedData || {};
                        modal.innerHTML = `
                            <div style="text-align:center;margin-bottom:1.5rem">
                                <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#FEF2F2;margin-bottom:0.75rem">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                </div>
                                <h3 style="font-size:1.25rem;font-weight:700;color:#1F2937;margin:0">Vắng Ca</h3>
                            </div>
                            <div style="background:#F9FAFB;border-radius:12px;padding:1rem;margin-bottom:1rem">
                                <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;align-items:center">
                                    <span style="display:inline-flex; align-items:center;">${window.getIconHtml('calendar', {width: '20', height: '20'})}</span>
                                    <div>
                                        <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ngày</div>
                                        <div style="font-weight:600;color:#1F2937">${dateStr}</div>
                                    </div>
                                </div>
                                <div style="display:flex;gap:1.5rem">
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="display:inline-flex; align-items:center; color:#10B981;">${window.getIconHtml('play-circle', {width: '20', height: '20'})}</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Giờ bắt đầu</div>
                                            <div style="font-weight:600;color:#1F2937">${schedInfo.start || '???'}</div>
                                        </div>
                                    </div>
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="display:inline-flex; align-items:center; color:#EF4444;">${window.getIconHtml('stop-circle', {width: '20', height: '20'})}</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Giờ kết thúc</div>
                                            <div style="font-weight:600;color:#1F2937">${schedInfo.end || '???'}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div style="background:#FEF2F2;border-radius:12px;padding:1rem;margin-bottom:0.75rem;border-left:3px solid #EF4444">
                                <div style="font-size:0.8rem;font-weight:600;color:#DC2626;margin-bottom:0.25rem;display:flex;align-items:center;gap:4px;">${window.getIconHtml('clipboard', {width: '16', height: '16'})} Trạng thái</div>
                                <div style="font-size:0.85rem;color:#7F1D1D">Đã nhận lớp nhưng <strong>không có dữ liệu chấm công</strong>.</div>
                            </div>
                            <div style="background:#ECFDF5;border-radius:12px;padding:1rem;margin-bottom:1.5rem;border-left:3px solid #10B981">
                                <div style="font-size:0.8rem;font-weight:600;color:#059669;margin-bottom:0.25rem;display:flex;align-items:center;gap:4px;">${window.getIconHtml('info', {width: '16', height: '16'})} Giải pháp</div>
                                <div style="font-size:0.85rem;color:#065F46">Trợ giảng cần <strong>"Vào Ca"</strong> trên trang Chấm Công trước khi bắt đầu lớp, hoặc Admin hãy chấm công bù.</div>
                            </div>
                            <button id="warning-modal-close-btn" style="width:100%;padding:0.75rem;background:var(--primary-color, #3B82F6);color:white;border:none;border-radius:10px;font-size:0.95rem;font-weight:600;cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Đã hiểu</button>
                        `;
                    } else {
                        // Regular "Ca Ngoài Lịch" modal (has sessionData)
                        const s = chip.sessionData || {};
                        const startTime = s.checkIn ? new Date(s.checkIn).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';
                        const endTime = s.checkOut ? new Date(s.checkOut).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Chưa ra ca';
                        modal.innerHTML = `
                            <div style="text-align:center;margin-bottom:1.5rem">
                                <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#FEF2F2;margin-bottom:0.75rem">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                </div>
                                <h3 style="font-size:1.25rem;font-weight:700;color:#1F2937;margin:0">Ca Ngoài Lịch</h3>
                            </div>
                            <div style="background:#F9FAFB;border-radius:12px;padding:1rem;margin-bottom:1rem">
                                <div style="display:flex;gap:0.75rem;margin-bottom:0.75rem;align-items:center">
                                    <span style="display:inline-flex; align-items:center;">${window.getIconHtml('calendar', {width: '20', height: '20'})}</span>
                                    <div>
                                        <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ngày</div>
                                        <div style="font-weight:600;color:#1F2937">${dateStr}</div>
                                    </div>
                                </div>
                                <div style="display:flex;gap:1.5rem">
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="display:inline-flex; align-items:center; color:#10B981;">${window.getIconHtml('play-circle', {width: '20', height: '20'})}</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Vào ca</div>
                                            <div style="font-weight:600;color:#1F2937">${startTime}</div>
                                        </div>
                                    </div>
                                    <div style="display:flex;gap:0.5rem;align-items:center">
                                        <span style="display:inline-flex; align-items:center; color:#EF4444;">${window.getIconHtml('stop-circle', {width: '20', height: '20'})}</span>
                                        <div>
                                            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">Ra ca</div>
                                            <div style="font-weight:600;color:#1F2937">${endTime}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div style="background:#FEF2F2;border-radius:12px;padding:1rem;margin-bottom:0.75rem;border-left:3px solid #EF4444">
                                <div style="font-size:0.8rem;font-weight:600;color:#DC2626;margin-bottom:0.25rem;display:flex;align-items:center;gap:4px;">${window.getIconHtml('clipboard', {width: '16', height: '16'})} Lý do</div>
                                <div style="font-size:0.85rem;color:#7F1D1D">Thời gian chấm công không khớp với bất kỳ lớp/ca nào trong lịch đã xếp.</div>
                            </div>
                            <div style="background:#ECFDF5;border-radius:12px;padding:1rem;margin-bottom:1.5rem;border-left:3px solid #10B981">
                                <div style="font-size:0.8rem;font-weight:600;color:#059669;margin-bottom:0.25rem;display:flex;align-items:center;gap:4px;">${window.getIconHtml('info', {width: '16', height: '16'})} Giải pháp</div>
                                <div style="font-size:0.85rem;color:#065F46">Trợ giảng cần <strong>"Nhận Lớp"</strong> trong mục Lịch Làm, hoặc Tiếp tân cần được Admin <strong>xếp lịch</strong> trước khi Vào Ca.</div>
                            </div>
                            <button id="warning-modal-close-btn" style="width:100%;padding:0.75rem;background:var(--primary-color, #3B82F6);color:white;border:none;border-radius:10px;font-size:0.95rem;font-weight:600;cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Đã hiểu</button>
                        `;
                    }
                    overlay.appendChild(modal);
                    document.body.appendChild(overlay);
                    document.getElementById('warning-modal-close-btn').onclick = () => overlay.remove();
                };
                div.appendChild(warningIcon);

                // (Nút Xác nhận Vắng đã chuyển sang trang Lịch Tiếp Tân — click vào chip tên nhân viên)
            }

            // --- NÚT SỚM 10P (per-chip, không cần selection mode) ---
            const roleRaw2 = localStorage.getItem('currentRole') || 'staff';
            let roles2 = [];
            try { const p = JSON.parse(roleRaw2); roles2 = Array.isArray(p) ? p : [roleRaw2]; }
            catch (e) { roles2 = [roleRaw2]; }

            // Fix: CHỈ hiện nút thưởng 10p khi nhân viên ĐƯỢC XEM là Trợ giảng/GV TA
            // Admin xem nhân viên không phải TA → không hiện
            const _targetCtx = window.currentUserContext;
            const _targetRoles = _targetCtx
                ? (Array.isArray(_targetCtx.roles) && _targetCtx.roles.length > 0
                    ? _targetCtx.roles
                    : [_targetCtx.role || ''])
                : [];
            const isTargetTA = _targetRoles.includes('teaching_assistant');
            const allowedRoles = ['teaching_assistant', 'admin', 'senior_assistant'];
            const canSeeBonus10 = roles2.some(r => allowedRoles.includes(r)) && !chip.isReceptionist && isTargetTA;
            const isAdminRole2 = roles2.some(r => ['admin', 'senior_assistant'].includes(r));

            if (canSeeBonus10 && chip.sessionId &&
                chip.class !== 'chip-blue' &&
                chip.class !== 'chip-gray' &&
                chip.class !== 'chip-future' &&
                chip.class !== 'chip-waiting') {

                const b10Btn = document.createElement('button');
                b10Btn.style.cssText = 'font-size:0.68rem;padding:1px 5px;border-radius:4px;border:none;cursor:pointer;margin-left:2px;vertical-align:middle;';

                const b10Status = chip.bonus10Status;
                const hasBonus = chip.sessionData && chip.sessionData.bonus10;

                if (b10Status === 'approved' || hasBonus) {
                    b10Btn.innerHTML = window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p';
                    b10Btn.style.background = '#D1FAE5';
                    b10Btn.style.color = '#059669';
                    if (isAdminRole2) {
                        b10Btn.style.cursor = 'pointer';
                        b10Btn.title = 'Đã duyệt - Bấm để hủy duyệt thưởng 10p';
                        b10Btn.onclick = async (e) => {
                            e.stopPropagation();
                            if (!confirm("Bạn có muốn hủy duyệt thưởng 10p cho ca này không?")) return;
                            try {
                                if (typeof UIService !== 'undefined') UIService.showLoading('Đang hủy duyệt...');
                                await DBService.cancelApprovedBonus10(chip.bonus10Id, staffId, dateStr, chip.sessionId);
                                if (typeof UIService !== 'undefined') {
                                    UIService.hideLoading();
                                    UIService.toast("Đã hủy duyệt thưởng 10p!", "success");
                                }
                                renderMonthReport(currentDate); // re-render
                            } catch (err) {
                                if (typeof UIService !== 'undefined') {
                                    UIService.hideLoading();
                                    UIService.toast(err.message || 'Lỗi', 'error');
                                }
                            }
                        };
                    } else {
                        b10Btn.disabled = true;
                        b10Btn.title = 'Đã được thưởng 10p';
                    }
                } else if (b10Status === 'pending') {
                    if (isAdminRole2) {
                        // Checkbox để multi-select
                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.style.cssText = 'margin-right:2px;cursor:pointer;vertical-align:middle;';
                        cb.dataset.bonus10Id = chip.bonus10Id;
                        cb.dataset.sessionId = chip.sessionId;
                        cb.dataset.dateStr = dateStr;
                        cb.dataset.staffId = staffId;
                        cb.className = 'bonus10-pending-cb';
                        cb.style.display = window.isBonus10SelectMode ? 'inline' : 'none';
                        cb.title = 'Chọn để duyệt hàng loạt';
                        cb.onclick = (e) => e.stopPropagation();
                        div.appendChild(cb);

                        b10Btn.innerHTML = window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + ' Duyệt';
                        b10Btn.style.background = '#FEF3C7';
                        b10Btn.style.color = '#D97706';
                        b10Btn.title = 'Duyệt thưởng 10p cho ca này';
                        b10Btn.onclick = (e) => {
                            e.stopPropagation();
                            approveBonus10(chip.bonus10Id, chip.sessionId, dateStr, staffId);
                        };
                    } else {
                        b10Btn.innerHTML = window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + ' Chờ';
                        b10Btn.style.background = '#FEF3C7';
                        b10Btn.style.color = '#D97706';
                        b10Btn.disabled = true;
                        b10Btn.title = 'Đang chờ admin duyệt';
                    }
                } else {
                    // Chưa có hoặc bị reject → cho submit
                    b10Btn.innerHTML = window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + ' Sớm';
                    b10Btn.style.background = b10Status === 'rejected' ? '#FEE2E2' : '#F3F4F6';
                    b10Btn.style.color = b10Status === 'rejected' ? '#DC2626' : '#6B7280';
                    b10Btn.title = b10Status === 'rejected' ? 'Bị từ chối — bấm để gửi lại' : 'Yêu cầu thưởng 10p vào sớm';
                    b10Btn.onclick = (e) => {
                        e.stopPropagation();
                        submitBonus10Request(chip.sessionId, dateStr, staffId);
                    };
                }

                div.appendChild(b10Btn);
            }

            div.title = `${chip.tooltip} (${chip.paidMinutes}m)`;

            // Look for existing saved fixed shift or selected one
            const isFixed = chip.isFixedShift || (window.savedFixedShiftsMonth && window.savedFixedShiftsMonth.includes(chip.sessionId));
            chip.isFixedShift = isFixed;
            if (isFixed && !window.isFixedShiftMode) {
                div.innerHTML = `<span>${chip.text} <b>(CĐ)</b>${badgeHtml}</span>`;
                div.style.border = '2px solid #8B5CF6';
            }

            // --- Role Selection / Bonus/Fixed Click Handler ---
            const isClickable = chip.isClickable || window.isBonusSelectMode || window.isFixedShiftMode || window.isStudentCountSelectMode || isAdminRole;
            if (isClickable) {
                div.style.cursor = 'pointer';
                if (window.isBonusSelectMode) {
                    div.style.border = '2px dashed #10B981';
                } else if (window.isFixedShiftMode && chip.isReceptionist) {
                    // Only Receptionist shifts can be selected as Fixed
                    const isSelected = window.selectedFixedShifts.has(chip.sessionId);
                    div.style.border = isSelected ? '3px solid #6366F1' : '2px dashed #6366F1';
                    if (isSelected) div.style.background = '#E0E7FF'; // Highlight selected
                } else if (window.isStudentCountSelectMode && !chip.isReceptionist && chip.sessionId) {
                    const key = chip.dateStr + '_' + chip.sessionId;
                    const isSelected = !!window.selectedStudentCountChips[key];
                    div.classList.add('student-count-selecting');
                    if (isSelected) {
                        div.classList.add(isAdminViewer ? 'student-count-admin-selected' : 'student-count-selected');
                    }
                }

                div.onclick = async (e) => {
                    e.stopPropagation();
                    if (window.isStudentCountSelectMode) {
                        if (chip.isReceptionist || !chip.sessionId) {
                            if (typeof UIService !== 'undefined') UIService.toast('Chỉ có thể chọn ca dạy của giáo viên.', 'warning');
                            return;
                        }
                        const key = chip.dateStr + '_' + chip.sessionId;
                        const isSelected = !!window.selectedStudentCountChips[key];

                        if (isAdminViewer) {
                            if (isSelected) {
                                delete window.selectedStudentCountChips[key];
                            } else {
                                window.selectedStudentCountChips[key] = {
                                    dateStr: chip.dateStr,
                                    sessionId: chip.sessionId,
                                    studentCount: chip.studentCount || 10,
                                    status: chip.studentCountStatus || 'pending'
                                };
                            }
                            renderMonthReport(currentDate);
                        } else {
                            const pubStatus = window.currentMonthlySalarySettingsAll?.published?.status;
                            const isMonthLocked = pubStatus === 'published' || pubStatus === 'received';
                            if (isMonthLocked) {
                                if (typeof UIService !== 'undefined') UIService.toast('Bảng công tháng này đã khóa, không thể sửa.', 'error');
                                return;
                            }

                            if (chip.studentCountStatus === 'rejected') {
                                if (typeof UIService !== 'undefined') UIService.toast('Ca này đã bị từ chối, không thể chỉnh sửa.', 'warning');
                                return;
                            }

                            const thresholdInput = document.getElementById('input-student-count-threshold');
                            const thresholdValue = thresholdInput ? parseInt(thresholdInput.value, 10) || 10 : 10;

                            if (isSelected) {
                                const currentItem = window.selectedStudentCountChips[key];
                                if (currentItem.studentCount === thresholdValue) {
                                    delete window.selectedStudentCountChips[key];
                                } else {
                                    currentItem.studentCount = thresholdValue;
                                    currentItem.status = 'approved';
                                }
                            } else {
                                window.selectedStudentCountChips[key] = {
                                    dateStr: chip.dateStr,
                                    sessionId: chip.sessionId,
                                    studentCount: thresholdValue,
                                    status: 'approved'
                                };
                            }
                            renderMonthReport(currentDate);
                        }
                    } else if (window.isBonusSelectMode) {
                        if (chip.sessionId) {
                            try {
                                const btn = e.currentTarget;
                                btn.style.opacity = '0.5';
                                await DBService.toggleSessionBonus10(staffId, dateStr, chip.sessionId);
                                if (typeof UIService !== 'undefined') UIService.toast("Đã cập nhật thưởng 10p!", "success");
                                renderMonthReport(currentDate); // re-render
                            } catch (err) {
                                if (typeof UIService !== 'undefined') UIService.toast(err.message || 'Lỗi', 'error');
                            }
                        } else {
                            if (typeof UIService !== 'undefined') UIService.toast('Ca này chưa có dữ liệu vào ra.', 'warning');
                        }
                    } else if (window.isFixedShiftMode) {
                        if (chip.isReceptionist && chip.sessionId) {
                            if (window.selectedFixedShifts.has(chip.sessionId)) {
                                window.selectedFixedShifts.delete(chip.sessionId);
                            } else {
                                window.selectedFixedShifts.add(chip.sessionId);
                            }
                            renderMonthReport(currentDate);
                        } else {
                            if (typeof UIService !== 'undefined') UIService.toast('Chỉ có thể chọn các ca tiếp tân có dữ liệu vào ra.', 'warning');
                        }
                    } else if (chip.isClickable) {
                        if (chip.sessionId) {
                            if (isAdminViewer) {
                                openEditModal(
                                    dateStr,
                                    chip.sessionId,
                                    chip,
                                    chip.classStart,
                                    chip.classCompositeKey,
                                    chip.classSectionKey,
                                    chip.classIndex,
                                    chip.isReceptionist
                                );
                            } else {
                                openRoleSelectModal(dateStr, chip.sessionData);
                            }
                        } else if (isAdminRole) {
                            // Creating new session from Registration, pass shift metadata so admin can delete this shift
                            openManualModal(
                                dateStr,
                                chip.schedData,
                                chip.classCompositeKey,
                                chip.classSectionKey,
                                chip.classIndex,
                                chip.isReceptionist ? true : false
                            );
                        }
                    }
                };
            }

            // Store for calculation
            window.allMonthChips.push(chip); // Track ALL chips (including absent) for stats
            if (chip.paidMinutes > 0) {
                window.currentMonthChips.push(chip);
            }

            // Add Edit Icon for Admin if there is an underlying session
            if (isAdminRole && chip.sessionId) {
                const editBtn = document.createElement('span');
                editBtn.innerHTML = window.getIconHtml('pencil', {width: '12', height: '12'});
                editBtn.style.cursor = 'pointer';
                editBtn.style.fontSize = '0.8em';
                editBtn.style.marginLeft = '4px';
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    openEditModal(
                        dateStr,
                        chip.sessionId,
                        chip,
                        chip.classStart,
                        chip.classCompositeKey,
                        chip.classSectionKey,
                        chip.classIndex,
                        chip.isReceptionist
                    );
                };
                div.appendChild(editBtn);
            }

            // Staff: add ⏱️ Overtime Request button on completed sessions with no pending OT
            if (role !== 'admin' && chip.sessionId && chip.sessionData && chip.sessionData.checkOut && !chip.overtimePending && !chip.overtimeMinutes) {
                const otBtn = document.createElement('span');
                otBtn.innerHTML = window.getIconHtml('clock', {width: '14', height: '14'});
                otBtn.title = 'Yêu cầu tăng ca';
                otBtn.style.cssText = 'cursor:pointer;font-size:0.85em;margin-left:4px;opacity:0.6;';
                otBtn.onmouseover = () => otBtn.style.opacity = '1';
                otBtn.onmouseout = () => otBtn.style.opacity = '0.6';
                otBtn.onclick = (e) => {
                    e.stopPropagation();
                    openOvertimeModal(dateStr, chip.sessionId, chip.sessionData);
                };
                div.appendChild(otBtn);
            }

            cell.appendChild(div);

            totalMinutes += chip.paidMinutes;

            // --- SALARY ACCUMULATION ---
            // Moved to calculateSalary() via window.currentMonthChips
        });

        // --- Daily Total Footer ---
        const dailyTotalMinutes = filteredChips.reduce((acc, chip) => acc + (chip.paidMinutes || 0), 0);
        if (dailyTotalMinutes > 0) {
            const h = Math.floor(dailyTotalMinutes / 60);
            const m = Math.floor(dailyTotalMinutes % 60);

            const footer = document.createElement('div');
            // Remove margin-top auto to test visibility
            footer.style.marginTop = '0.5rem';
            footer.style.padding = '4px 8px';
            footer.style.borderRadius = '4px';
            footer.style.backgroundColor = '#F3F4F6'; // Light gray bg
            footer.style.border = '1px solid #D1D5DB';
            footer.style.fontSize = '0.75rem';
            footer.style.fontWeight = '700';
            footer.style.color = '#7C3AED'; // Violet text
            footer.style.textAlign = 'right';

            // Explicit text node to avoid innerText quirks
            footer.textContent = `Tổng: ${h}h ${m}p`;

            cell.appendChild(footer);
        }

        grid.appendChild(cell);
    } catch (cellErr) { console.error('[Calendar] Error rendering day', d, cellErr); } }

    // Trailing Slots (Muted next month days to complete the 7-column grid)
    const totalCells = startOffset + daysInMonth;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-cell disabled';
        empty.style.opacity = '0.35';
        empty.style.background = '#F9FAFB';
        empty.style.border = '1px solid var(--border-color)';
        
        const dateHeader = document.createElement('div');
        dateHeader.style.display = 'flex';
        dateHeader.style.justifyContent = 'space-between';
        dateHeader.style.marginBottom = '0.5rem';
        dateHeader.innerHTML = `<span style="font-weight: 500; color: #9CA3AF;">${i}</span>`;
        
        empty.appendChild(dateHeader);
        grid.appendChild(empty);
    }

    // Update Totals
    if (totalHoursEl) {
        const h = Math.floor(totalMinutes / 60);
        const m = Math.floor(totalMinutes % 60);
        totalHoursEl.innerText = `Tổng giờ làm: ${h} giờ ${m} phút`;
    }

    // Auto-save any auto-assigned roles
    const autoAssigned = window.allMonthChips.filter(c => c.sessionData && c.sessionData._autoAssignedRole);
    if (autoAssigned.length > 0) {
        autoAssigned.forEach(chip => {
            const dateStr = chip.dateStr;
            if (chip.sessionId && dateStr) {
                const roleObj = { id: chip.sessionData.role, name: chip.sessionData.roleName };
                if (chip.sessionData.roleRate !== undefined) roleObj.rate = chip.sessionData.roleRate;
                // Call DBService.updateSessionRole silently
                DBService.updateSessionRole(staffId, dateStr, chip.sessionId, roleObj).catch(e => console.warn('Auto-save role failed:', e));
                chip.sessionData._autoAssignedRole = false; // prevent double save
            }
        });
    }

    // Dynamic chip dropdown population
    const displayFilterEl = document.getElementById('display-role-filter');
    if (displayFilterEl) {
        const currentSelectedVal = displayFilterEl.value || 'all';
        displayFilterEl.innerHTML = '';
        
        // Default Option (All)
        const defaultOpt = document.createElement('option');
        defaultOpt.value = 'all';
        defaultOpt.textContent = 'Tất cả lớp / ca';
        displayFilterEl.appendChild(defaultOpt);

        // Check if viewing a receptionist
        const staffRoles = currentUserContext
            ? (Array.isArray(currentUserContext.roles) && currentUserContext.roles.length > 0
                ? currentUserContext.roles
                : [currentUserContext.role || ''])
            : [];
        const isReceptionistStaff = currentUserContext && staffRoles.some(r =>
            ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant', 'admin'].includes(r)
        );
        const isTeachingStaff = currentUserContext && staffRoles.some(r =>
            ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r)
        );
        const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
        const activeFilter = (filterVal === 'tiep-tan') || (filterVal === 'all' && isReceptionistStaff && !isTeachingStaff) ? 'tiep-tan' : 'giao-vien';

        if (activeFilter === 'tiep-tan') {
            const optFixed = document.createElement('option');
            optFixed.value = 'ca-co-dinh';
            optFixed.textContent = 'Ca Cố Định (CĐ)';
            displayFilterEl.appendChild(optFixed);

            const optNormal = document.createElement('option');
            optNormal.value = 'ca-binh-thuong';
            optNormal.textContent = 'Ca Bình Thường (TT)';
            displayFilterEl.appendChild(optNormal);
        }
        
        // Find unique filter names from window.unfilteredAllMonthChips
        const uniqueFilterNames = [];
        (window.unfilteredAllMonthChips || []).forEach(chip => {
            if (chip.chipFilterName && !uniqueFilterNames.includes(chip.chipFilterName)) {
                uniqueFilterNames.push(chip.chipFilterName);
            }
        });
        
        // Sort and populate
        uniqueFilterNames.sort().forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            displayFilterEl.appendChild(opt);
        });
        
        // Restore selected value if valid, otherwise set to 'all'
        const validValues = [...uniqueFilterNames];
        if (activeFilter === 'tiep-tan') {
            validValues.push('ca-co-dinh', 'ca-binh-thuong');
        }
        if (validValues.includes(currentSelectedVal)) {
            displayFilterEl.value = currentSelectedVal;
        } else {
            displayFilterEl.value = 'all';
        }
    }

    // Toggle button visibility
    const classRateBtn = document.getElementById('btn-class-rates-setup');
    if (classRateBtn) {
        classRateBtn.style.display = isAdminRole ? 'inline-flex' : 'none';
    }

    // Update Salary (Admin)
    window.lastTotalMinutes = totalMinutes;
    // window.currentMonthSalary set by calculateSalary()

    if (isAdminRole) {
        loadSalarySettings();
    }

    // Highlight and scroll to focus date if parameter exists
    const urlParamsFocus = new URLSearchParams(window.location.search);
    const dateParamFocus = urlParamsFocus.get('date');
    if (dateParamFocus) {
        setTimeout(() => {
            const targetCell = document.getElementById('calendar-cell-' + dateParamFocus);
            if (targetCell) {
                document.querySelectorAll('.focused-calendar-day').forEach(el => el.classList.remove('focused-calendar-day'));
                
                targetCell.classList.add('focused-calendar-day');
                
                if (!document.getElementById('focus-day-style')) {
                    const styleEl = document.createElement('style');
                    styleEl.id = 'focus-day-style';
                    styleEl.innerHTML = `
                        @keyframes borderPulse {
                            0% { box-shadow: 0 0 0 0px rgba(16, 185, 129, 0.7); border-color: #10B981; }
                            50% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); border-color: #10B981; }
                            100% { box-shadow: 0 0 0 0px rgba(16, 185, 129, 0); border-color: #10B981; }
                        }
                        .focused-calendar-day {
                            animation: borderPulse 2s infinite ease-in-out;
                            border: 2px solid #10B981 !important;
                            position: relative;
                            z-index: 10;
                            background-color: #ECFDF5 !important;
                        }
                    `;
                    document.head.appendChild(styleEl);
                }
                
                targetCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Clean URL param silently without reload
                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('date');
                window.history.replaceState({}, '', cleanUrl);
            }
        }, 400);
    }
}

// calculateDailyChips() → Moved to evaluation-service.js

// ================= SALARY CALCULATION & EVALUATION =================
// EVALUATION_CRITERIA → Moved to evaluation-service.js
const RECEP_EVALUATION_CRITERIA = [
    { label: 'I', tooltip: 'HIỆU SUẤT', index: 0, default: 0, template: 'Vắng phép: ...; Vắng đột xuất: ...; Vắng không phép: ...' },
    { label: 'II', tooltip: 'ĐÁNH GIÁ CỦA TỔ TRƯỞNG CỦA TỔ TRƯỞNG', index: 4, default: 0 },
    { label: 'III', tooltip: 'PHÍ TƯ VẤN', index: 1, default: 0 },
    { label: 'IV', tooltip: 'CHẤM BÀI / DẠY VẼ / ĐĂNG BÀI / SỰ KIỆN / PHÁT SINH', index: 2, default: 0 },
    { label: 'V', tooltip: 'TRỢ CẤP CHỨC VỤ', index: 3, default: 0 },
    { label: 'VI', tooltip: 'LƯƠNG HIỆU SUẤT', index: 5, default: 0 },
    { label: 'VII', tooltip: 'THƯỞNG DOANH THU CS3 (Thủ công)', index: 6, default: 0 }
];

let currentEvalIndex = null;

function renderEvaluationTable(savedData = []) {
    const section = document.getElementById('evaluation-section');
    if (!section) return;

    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    let roles = [];
    try {
        const parsed = JSON.parse(roleRaw);
        roles = Array.isArray(parsed) ? parsed : [roleRaw];
    } catch (e) {
        roles = [roleRaw];
    }
    const showEval = roles.some(r => ['admin', 'senior_assistant'].includes(r)); // Allow admin and senior_assistant to see evaluation table
    section.style.display = showEval ? 'block' : 'none';
    if (!showEval) return;

    const user = window.currentUserContext;
    let hasReceptionist = false;
    let hasTeaching = false;
    if (user) {
        const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
        hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
        hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
    }
    const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
    const isRecep = (filterVal === 'tiep-tan') || (filterVal === 'all' && hasReceptionist && !hasTeaching);
    const criteriaList = isRecep ? RECEP_EVALUATION_CRITERIA : EVALUATION_CRITERIA;

    const thead = document.getElementById('eval-thead');
    const tbody = document.getElementById('evaluation-table-body');
    if (!tbody || !thead) return;

    // Headers
    let headerHtml = '<tr><th style="padding: 0.5rem; border: 1px solid #e5e7eb; width: 100px;">Nội dung</th>';
    criteriaList.forEach(item => {
        headerHtml += `<th style="padding: 0.5rem; border: 1px solid #e5e7eb; text-align: center;" title="${item.tooltip}">${item.label}</th>`;
    });
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;

    // Rows
    let totalBonus = 0;
    let trAmount = '<tr><td style="padding: 0.5rem; font-weight: 600;">Thưởng/Phạt</td>';
    let trNote = '<tr><td style="padding: 0.5rem; font-weight: 600;">Ghi chú</td>';

    criteriaList.forEach((item, index) => {
        const criteriaIndex = isRecep ? item.index : index;
        const rowData = savedData.find(e => e.id === criteriaIndex) || {};
        const note = rowData.note || '';
        const amount = rowData.amount !== undefined ? rowData.amount : item.default;

        totalBonus += Number(amount);

        const isReadOnlyAttr = isRecep 
            ? 'readonly style="width: 100%; text-align: center; border: none; background: transparent; font-weight: 600; color: #4B5563;"' 
            : 'style="width: 100%; text-align: center; border: none; background: transparent; font-weight: 600;"';

        trAmount += `
            <td style="padding: 0.25rem; border: 1px solid #e5e7eb;">
                <input type="text" class="table-input eval-amount money-input" 
                    value="${formatNumberWithCommas(amount)}" data-index="${criteriaIndex}" oninput="calculateSalary()"
                    ${isReadOnlyAttr}>
            </td>`;

        const noteBtnColor = note ? 'var(--primary-color)' : '#9ca3af';
        const noteButtonHtml = isRecep ? `
            <span title="${note || 'Không có ghi chú'}" style="font-size: 0.85rem; color: #4B5563;">
                ${note ? '📝' : '—'}
            </span>
        ` : `
            <button type="button" onclick="openEvalNoteModal(${index})" style="background: none; border: none; cursor: pointer; color: ${noteBtnColor};" title="${note || 'Thêm ghi chú'}">
               📝
            </button>
        `;

        trNote += `
            <td style="padding: 0.25rem; border: 1px solid #e5e7eb; text-align: center;">
                <input type="hidden" class="eval-note" value="${note.replace(/"/g, '&quot;')}" data-index="${criteriaIndex}">
                ${noteButtonHtml}
            </td>`;
    });

    trAmount += '</tr>';
    trNote += '</tr>';
    tbody.innerHTML = trAmount + trNote;

    updateBonusDisplay(totalBonus);
    bindMoneyInputFormatters();
}

function updateBonusDisplay(amount) {
    const summaryInput = document.getElementById('summary-bonus-penalty');
    if (summaryInput) {
        summaryInput.value = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
        summaryInput.style.color = amount >= 0 ? 'var(--primary-color)' : '#EF4444';
    }
}

function calculateSalary() {
    // 1. Get Settings
    const roleFilter = document.getElementById('salary-role-filter')?.value || 'all';

    // 2. Filter Chips & Calculate Minutes
    const hoursDisplay = document.getElementById('role-hours-display');
    if (hoursDisplay) hoursDisplay.innerText = "Đang xử lý...";

    let filteredMinutes = 0;
    let filteredSalary = 0; // Accumulate salary based on role rates
    const allChips = window.currentMonthChips || [];

    // Breakdown: teaching vs receptionist (for Item 7 — Tách giờ Trợ giảng)
    let teachingMinutes = 0;
    let receptionistMinutes = 0;
    allChips.forEach(chip => {
        const mins = chip.paidMinutes || 0;
        const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData?.role));
        if (isTT) receptionistMinutes += mins;
        else if (chip.isTeaching || (chip.sessionData && chip.sessionData.role)) teachingMinutes += mins;
    });
    const taBreakdown = document.getElementById('ta-hours-breakdown');
    if (taBreakdown) {
        if (teachingMinutes > 0 && receptionistMinutes > 0) {
            taBreakdown.style.display = 'block';
            const th = Math.floor(teachingMinutes / 60), tm = Math.floor(teachingMinutes % 60);
            const rh = Math.floor(receptionistMinutes / 60), rm = Math.floor(receptionistMinutes % 60);
            const td = document.getElementById('ta-teaching-hours');
            const rd = document.getElementById('ta-receptionist-hours');
            if (td) td.innerText = `Dạy: ${th}h ${tm}p`;
            if (rd) rd.innerText = `TT: ${rh}h ${rm}p`;
        } else {
            taBreakdown.style.display = 'none';
        }
    }

    // --- Calculate Fixed Shift & Absent stats from allMonthChips (includes chip-gray) ---
    let fixedWorkedCount = 0;
    let fixedAbsentCount = 0;
    let fixedWorkedMinutes = 0;  // Tổng giờ ca cố định
    let fixedAbsentCount2 = 0;   // Vắng ca cố định
    let normalWorkedCount = 0;   // Ca thường đã đi (tiếp tân, không phải fixed)
    let normalAbsentCount = 0;   // Vắng ca thường

    // Dùng allMonthChips để bao gồm cả chip-gray (vắng, paidMinutes=0)
    const allChipsForStats = window.allMonthChips || allChips;
    allChipsForStats.forEach(chip => {
        if (chip.class === 'chip-future' || chip.isCenterOff) return; // Bỏ ca tương lai và ca nghỉ trung tâm
        const isTiepTan = chip.isReceptionist || (chip.sessionData &&
            ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
        if (!isTiepTan) return; // Chỉ tính tiếp tân

        // FIX Bug 1: Nếu chip có mergedSegments (ca thường gộp với ca CĐ),
        // đếm đúng theo từng segment thay vì đánh đồng cả chip là CĐ.
        if (chip.mergedSegments && chip.mergedSegments.length > 1) {
            const isWorked = chip.class !== 'chip-gray';
            let hasFixed = chip.mergedSegments.some(s => s.isFixedShift);
            let hasNormal = chip.mergedSegments.some(s => !s.isFixedShift);
            if (isWorked) {
                if (hasFixed) {
                    fixedWorkedCount++;
                    // Tính giờ CĐ theo segment
                    const fixedMins = chip.mergedSegments
                        .filter(s => s.isFixedShift)
                        .reduce((acc, s) => acc + (s.schedMinutes || 0), 0);
                    fixedWorkedMinutes += fixedMins;
                }
                if (hasNormal) normalWorkedCount++;
            } else {
                if (hasFixed) { fixedAbsentCount++; fixedAbsentCount2++; }
                if (hasNormal) normalAbsentCount++;
            }
            return;
        }

        if (chip.isFixedShift) {
            if (chip.class !== 'chip-gray') {
                // Đã đi (chip-green, chip-orange, chip-waiting, v.v.)
                fixedWorkedCount++;
                fixedWorkedMinutes += (chip.paidMinutes || 0);
            } else {
                // Vắng ca cố định (chip-gray + isFixedShift)
                fixedAbsentCount++;
                fixedAbsentCount2++;
            }
        } else {
            // Ca thường (không phải fixed)
            if (chip.class !== 'chip-gray') {
                normalWorkedCount++;
            } else {
                normalAbsentCount++;
            }
        }
    });

    window.fixedWorkedCount = fixedWorkedCount;
    window.fixedAbsentCount = fixedAbsentCount;
    window.fixedWorkedMinutes = fixedWorkedMinutes;
    window.normalAbsentCount = normalAbsentCount;
    window.normalWorkedCount = normalWorkedCount;
    window.fixedAbsentCount2 = fixedAbsentCount2;

    // Debug
    console.log("Calculating Salary. Filters:", roleFilter, "Chips:", allChips.length);

    if (roleFilter === 'all') {
        // Fallback to pre-calculated total if chips are empty (happens during initial render sometimes)
        if (window.lastTotalMinutes !== undefined && allChips.length === 0) {
            filteredMinutes = window.lastTotalMinutes;
            // Cannot calculate salary accurately without chips if they are empty, but usually they are not empty if we are here.
            filteredSalary = 0;
        } else {
            const subjectBreakdown = {};
            allChips.forEach(chip => {
                const minutes = chip.paidMinutes || 0;
                filteredMinutes += minutes;

                // Priority: Class / Ca rate from monthly settings or salary_config.class_rates
                let rate = 0;
                let hasClassRate = false;
                
                const isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
                const monthlyAll = window.currentMonthlySalarySettingsAll || {};
                const cfg = window.currentUserContext?.salary_config || {};
                
                let classRates = {};
                if (isTiepTan) {
                    const ttMonthly = monthlyAll['tiep_tan'] || monthlyAll['tiep-tan'] || {};
                    classRates = ttMonthly.class_rates || cfg.class_rates || {};
                } else {
                    const gvMonthly = monthlyAll['giao_vien'] || monthlyAll['giao-vien'] || {};
                    classRates = gvMonthly.class_rates || cfg.class_rates || {};
                }
                
                if (chip.chipFilterName && classRates[chip.chipFilterName] !== undefined && Number(classRates[chip.chipFilterName]) > 0) {
                    rate = Number(classRates[chip.chipFilterName]);
                    hasClassRate = true;
                }

                if (chip.mergedSegments && chip.mergedSegments.length > 0 && !isTiepTan) {
                    let remainingMinutes = minutes;
                    const totalSched = chip.mergedSegments.reduce((sum, seg) => sum + (seg.schedMinutes || 0), 0);
                    
                    chip.mergedSegments.forEach((seg, sIdx) => {
                        let segMins = 0;
                        if (totalSched <= 0) {
                            segMins = sIdx === chip.mergedSegments.length - 1 ? remainingMinutes : Math.round(minutes / chip.mergedSegments.length);
                        } else {
                            if (sIdx === chip.mergedSegments.length - 1) {
                                segMins = remainingMinutes;
                            } else {
                                segMins = Math.round(minutes * ((seg.schedMinutes || 0) / totalSched));
                                remainingMinutes -= segMins;
                            }
                        }
                        
                        const normalizeFn = window.normalizeChipFilterName || (x => x);
                        const segName = normalizeFn(seg.lop) || "Khác";
                        
                        let segRate = 0;
                        if (segName && classRates[segName] !== undefined && Number(classRates[segName]) > 0) {
                            segRate = Number(classRates[segName]);
                        } else {
                            segRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                        }
                        const amount = (segMins / 60) * segRate;
                        filteredSalary += amount;

                        if (!subjectBreakdown[segName]) {
                            subjectBreakdown[segName] = { minutes: 0, rate: segRate, amount: 0 };
                        }
                        subjectBreakdown[segName].minutes += segMins;
                        subjectBreakdown[segName].amount += amount;

                        // Student Count Bonus
                        if (chip.studentCount && chip.studentCountStatus !== 'rejected') {
                            const bonusName = `${segName} (+${chip.studentCount} HS)`;
                            let bonusRate = 0;
                            if (classRates[bonusName] !== undefined && Number(classRates[bonusName]) > 0) {
                                bonusRate = Number(classRates[bonusName]);
                            }
                            const hasRejectedChip = (window.unfilteredAllMonthChips || []).some(c => c.studentCountStatus === 'rejected');
                            const isPenaltyActive = !!monthlyAll?.studentCountBonusPenalty || hasRejectedChip;
                            const bonusAmount = isPenaltyActive ? 0 : (segMins / 60) * bonusRate;
                            
                            if (!subjectBreakdown[bonusName]) {
                                subjectBreakdown[bonusName] = { minutes: 0, rate: isPenaltyActive ? 0 : bonusRate, amount: 0 };
                            }
                            subjectBreakdown[bonusName].minutes += segMins;
                            subjectBreakdown[bonusName].amount += bonusAmount;
                            filteredSalary += bonusAmount;
                        }
                    });
                } else {
                    if (hasClassRate) {
                        const amount = (minutes / 60) * rate;
                        filteredSalary += amount;
                        if (!isTiepTan) {
                            const segName = chip.chipFilterName || "Chưa phân lớp";
                            if (!subjectBreakdown[segName]) {
                                subjectBreakdown[segName] = { minutes: 0, rate: rate, amount: 0 };
                            }
                            subjectBreakdown[segName].minutes += minutes;
                            subjectBreakdown[segName].amount += amount;

                            // Student Count Bonus
                            if (chip.studentCount && chip.studentCountStatus !== 'rejected') {
                                const bonusName = `${segName} (+${chip.studentCount} HS)`;
                                let bonusRate = 0;
                                if (classRates[bonusName] !== undefined && Number(classRates[bonusName]) > 0) {
                                    bonusRate = Number(classRates[bonusName]);
                                }
                                const hasRejectedChip = (window.unfilteredAllMonthChips || []).some(c => c.studentCountStatus === 'rejected');
                                const isPenaltyActive = !!monthlyAll?.studentCountBonusPenalty || hasRejectedChip;
                                const bonusAmount = isPenaltyActive ? 0 : (minutes / 60) * bonusRate;
                                
                                if (!subjectBreakdown[bonusName]) {
                                    subjectBreakdown[bonusName] = { minutes: 0, rate: isPenaltyActive ? 0 : bonusRate, amount: 0 };
                                }
                                subjectBreakdown[bonusName].minutes += minutes;
                                subjectBreakdown[bonusName].amount += bonusAmount;
                                filteredSalary += bonusAmount;
                            }
                        }
                    } else if (isTiepTan && window.currentUserContext && window.currentUserContext.salary_config) {
                        let chipSalary = 0;
                        let fixedRate = classRates["Tiếp Tân (Ca Cố Định)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Cố Định)"]) : Number(cfg.receptionist_fixed_rate || 0);
                        let normalRate = classRates["Tiếp Tân (Ca Bình Thường)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Bình Thường)"]) : Number(cfg.receptionist_normal_rate || 0);
                        
                        if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                            let remainingMinutes = minutes;
                            const totalSched = chip.mergedSegments.reduce((sum, seg) => sum + (seg.schedMinutes || 0), 0);
                            chip.mergedSegments.forEach((seg, sIdx) => {
                                let segMins = 0;
                                if (totalSched <= 0) {
                                    segMins = sIdx === chip.mergedSegments.length - 1 ? remainingMinutes : Math.round(minutes / chip.mergedSegments.length);
                                } else {
                                    segMins = Math.round(((seg.schedMinutes || 0) / totalSched) * minutes);
                                    if (sIdx === chip.mergedSegments.length - 1) {
                                        segMins = remainingMinutes;
                                    } else {
                                        remainingMinutes -= segMins;
                                    }
                                }
                                const segRate = seg.isFixedShift ? fixedRate : normalRate;
                                chipSalary += (segMins / 60) * segRate;
                            });
                        } else {
                            const segRate = chip.isFixedShift ? fixedRate : normalRate;
                            chipSalary += (minutes / 60) * segRate;
                        }
                        filteredSalary += chipSalary;
                    } else {
                        let defaultRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                        const amount = (minutes / 60) * defaultRate;
                        filteredSalary += amount;
                        if (!isTiepTan) {
                            const segName = chip.chipFilterName || "Chưa phân lớp";
                            if (!subjectBreakdown[segName]) {
                                subjectBreakdown[segName] = { minutes: 0, rate: defaultRate, amount: 0 };
                            }
                            subjectBreakdown[segName].minutes += minutes;
                            subjectBreakdown[segName].amount += amount;

                            // Student Count Bonus
                            if (chip.studentCount && chip.studentCountStatus !== 'rejected') {
                                const bonusName = `${segName} (+${chip.studentCount} HS)`;
                                let bonusRate = 0;
                                if (classRates[bonusName] !== undefined && Number(classRates[bonusName]) > 0) {
                                    bonusRate = Number(classRates[bonusName]);
                                }
                                const hasRejectedChip = (window.unfilteredAllMonthChips || []).some(c => c.studentCountStatus === 'rejected');
                                const isPenaltyActive = !!monthlyAll?.studentCountBonusPenalty || hasRejectedChip;
                                const bonusAmount = isPenaltyActive ? 0 : (minutes / 60) * bonusRate;
                                
                                if (!subjectBreakdown[bonusName]) {
                                    subjectBreakdown[bonusName] = { minutes: 0, rate: isPenaltyActive ? 0 : bonusRate, amount: 0 };
                                }
                                subjectBreakdown[bonusName].minutes += minutes;
                                subjectBreakdown[bonusName].amount += bonusAmount;
                                filteredSalary += bonusAmount;
                            }
                        }
                    }
                }
            });
            window.currentSubjectBreakdown = Object.keys(subjectBreakdown).map(subj => {
                return {
                    name: subj,
                    hours: Number((subjectBreakdown[subj].minutes / 60).toFixed(2)),
                    rate: subjectBreakdown[subj].rate,
                    amount: Math.round(subjectBreakdown[subj].amount)
                };
            });
        }
    } else {
        const filterType = roleFilter; // normalize var name to match PDF logic copy-paste convenience

        allChips.forEach(chip => {
            let include = false;

            // Logic copied from exportSalaryPDF to ensure consistency
            if (filterType === 'all') {
                include = true;
            } else if (filterType === 'giao-vien') {
                // Check Role Name/ID for keywords like in PDF
                const chipRole = (chip.sessionData && chip.sessionData.role) ? chip.sessionData.role : '';
                const roleName = (chip.sessionData && chip.sessionData.roleName) ? chip.sessionData.roleName.toLowerCase() : '';
                const normalizedApps = removeVietnameseTones(roleName);

                // Exclude Reception keys
                const isReceptionID = ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chipRole);
                if (isReceptionID || normalizedApps.includes('tiep') || normalizedApps.includes('le') || normalizedApps.includes('reception')) {
                    include = false;
                }
                // Include Teaching keys
                else if (chip.isTeaching || chipRole === 'giao-vien' || normalizedApps.includes('gv') || normalizedApps.includes('giao') || normalizedApps.includes('tro') || normalizedApps.includes('ta')) {
                    // Default assumption or explicit match
                    include = true;
                }
            } else if (filterType === 'tiep-tan') {
                const chipRole = (chip.sessionData && chip.sessionData.role) ? chip.sessionData.role : '';
                const roleName = (chip.sessionData && chip.sessionData.roleName) ? chip.sessionData.roleName.toLowerCase() : '';
                const normalizedApps = removeVietnameseTones(roleName);

                const isReceptionID = ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chipRole);
                if (isReceptionID || normalizedApps.includes('tiep') || normalizedApps.includes('le') || normalizedApps.includes('reception')) {
                    include = true;
                }
            }

            if (include) {
                const minutes = chip.paidMinutes || 0;
                filteredMinutes += minutes;

                // Priority: Class / Ca rate from monthly settings or salary_config.class_rates
                let rate = 0;
                let hasClassRate = false;
                
                const isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
                const monthlyAll = window.currentMonthlySalarySettingsAll || {};
                const cfg = window.currentUserContext?.salary_config || {};
                
                let classRates = {};
                if (isTiepTan) {
                    const ttMonthly = monthlyAll['tiep_tan'] || monthlyAll['tiep-tan'] || {};
                    classRates = ttMonthly.class_rates || cfg.class_rates || {};
                } else {
                    const gvMonthly = monthlyAll['giao_vien'] || monthlyAll['giao-vien'] || {};
                    classRates = gvMonthly.class_rates || cfg.class_rates || {};
                }
                
                if (chip.chipFilterName && classRates[chip.chipFilterName] !== undefined && Number(classRates[chip.chipFilterName]) > 0) {
                    rate = Number(classRates[chip.chipFilterName]);
                    hasClassRate = true;
                }

                if (chip.mergedSegments && chip.mergedSegments.length > 0 && !isTiepTan) {
                    let remainingMinutes = minutes;
                    const totalSched = chip.mergedSegments.reduce((sum, seg) => sum + (seg.schedMinutes || 0), 0);
                    
                    chip.mergedSegments.forEach((seg, sIdx) => {
                        let segMins = 0;
                        if (totalSched <= 0) {
                            segMins = sIdx === chip.mergedSegments.length - 1 ? remainingMinutes : Math.round(minutes / chip.mergedSegments.length);
                        } else {
                            if (sIdx === chip.mergedSegments.length - 1) {
                                segMins = remainingMinutes;
                            } else {
                                segMins = Math.round(minutes * ((seg.schedMinutes || 0) / totalSched));
                                remainingMinutes -= segMins;
                            }
                        }
                        
                        const normalizeFn = window.normalizeChipFilterName || (x => x);
                        const segName = normalizeFn(seg.lop);
                        
                        let segRate = 0;
                        if (segName && classRates[segName] !== undefined && Number(classRates[segName]) > 0) {
                            segRate = Number(classRates[segName]);
                        } else {
                            segRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                        }
                        filteredSalary += (segMins / 60) * segRate;
                    });
                } else {
                    if (hasClassRate) {
                        filteredSalary += (minutes / 60) * rate;
                    } else if (isTiepTan && window.currentUserContext && window.currentUserContext.salary_config) {
                        let chipSalary = 0;
                        let fixedRate = classRates["Tiếp Tân (Ca Cố Định)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Cố Định)"]) : Number(cfg.receptionist_fixed_rate || 0);
                        let normalRate = classRates["Tiếp Tân (Ca Bình Thường)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Bình Thường)"]) : Number(cfg.receptionist_normal_rate || 0);
                        
                        if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                            let remainingMinutes = minutes;
                            const totalSched = chip.mergedSegments.reduce((sum, seg) => sum + (seg.schedMinutes || 0), 0);
                            chip.mergedSegments.forEach((seg, sIdx) => {
                                let segMins = 0;
                                if (totalSched <= 0) {
                                    segMins = sIdx === chip.mergedSegments.length - 1 ? remainingMinutes : Math.round(minutes / chip.mergedSegments.length);
                                } else {
                                    segMins = Math.round(((seg.schedMinutes || 0) / totalSched) * minutes);
                                    if (sIdx === chip.mergedSegments.length - 1) {
                                        segMins = remainingMinutes;
                                    } else {
                                        remainingMinutes -= segMins;
                                    }
                                }
                                const segRate = seg.isFixedShift ? fixedRate : normalRate;
                                chipSalary += (segMins / 60) * segRate;
                            });
                        } else {
                            const segRate = chip.isFixedShift ? fixedRate : normalRate;
                            chipSalary += (minutes / 60) * segRate;
                        }
                        filteredSalary += chipSalary;
                    } else {
                        let defaultRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                        filteredSalary += (minutes / 60) * defaultRate;
                    }
                }
            }
        });
    }

    // 3. Update UI Display for Hours
    if (hoursDisplay) {
        const h = Math.floor(filteredMinutes / 60);
        const m = Math.floor(filteredMinutes % 60);

        let label = "Tổng giờ: ";
        if (roleFilter === 'tiep-tan') label = "Giờ Tiếp Tân: ";
        if (roleFilter === 'giao-vien') label = "Giờ Dạy: ";

        hoursDisplay.innerText = `${label}${h}h ${m}p`;

        // Render Fixed Shift stats (Yêu cầu 2 & 3)
        let fixedStatsEl = document.getElementById('fixed-shift-stats');
        if (!fixedStatsEl) {
            fixedStatsEl = document.createElement('div');
            fixedStatsEl.id = 'fixed-shift-stats';
            fixedStatsEl.style.fontSize = '0.82rem';
            fixedStatsEl.style.marginTop = '6px';
            fixedStatsEl.style.color = '#4F46E5';
            fixedStatsEl.style.fontWeight = '600';
            hoursDisplay.parentNode.appendChild(fixedStatsEl);
        }

        // Yêu cầu 2: tính giờ ca cố định
        const _fwH = Math.floor((window.fixedWorkedMinutes || 0) / 60);
        const _fwM = Math.floor((window.fixedWorkedMinutes || 0) % 60);
        const fixedHoursStr = (window.fixedWorkedMinutes || 0) > 0 ? ` (${_fwH}h${_fwM > 0 ? ' ' + _fwM + 'p' : ''})` : '';

        // Yêu cầu 3: tách vắng thường vs vắng cố định
        const _normalAbsent = window.normalAbsentCount || 0;
        const _fixedAbsent = window.fixedAbsentCount2 || 0;
        const _fixedWorked = fixedWorkedCount || 0;

        const _normalWorked = window.normalWorkedCount || 0;

        let statsHtml = '';
        // Hiện stats ca thường nếu có tiếp tân
        if (_normalWorked > 0 || _normalAbsent > 0) {
            statsHtml += `<div style="color:#059669;margin-top:4px;">[TT] Đi: <span style="font-weight:700;">${_normalWorked} ca</span> | Vắng: <span style="color:#EF4444;font-weight:700;">${_normalAbsent} ca</span></div>`;
        }
        // Hiện stats ca cố định nếu có
        if (_fixedWorked > 0 || _fixedAbsent > 0) {
            statsHtml += `<div style="color:#4F46E5;margin-top:2px;">[CĐ] Đi: <span style="color:#4F46E5;font-weight:700;">${_fixedWorked} ca${fixedHoursStr}</span> | Vắng: <span style="color:#DC2626;font-weight:700;">${_fixedAbsent} ca</span></div>`;
        }
        // Tổng vắng (nếu có cả 2 loại)
        if ((_normalAbsent > 0 || _fixedAbsent > 0) && (_fixedWorked > 0 || _normalWorked > 0)) {
            const totalAbsent = _normalAbsent + _fixedAbsent;
            statsHtml += `<div style="color:#6B7280;margin-top:2px;font-size:0.78rem;">Tổng vắng: <span style="color:#EF4444;font-weight:700;">${totalAbsent} ca</span> (TT: ${_normalAbsent} | CĐ: ${_fixedAbsent})</div>`;
        }
        if (statsHtml) {
            fixedStatsEl.innerHTML = statsHtml;
            fixedStatsEl.style.display = 'block';
        } else {
            fixedStatsEl.style.display = 'none';
        }
    }

    // 4. Calculate Total Money
    let totalBonus = 0;
    const evalAmounts = document.querySelectorAll('.eval-amount');
    const evalNotes = document.querySelectorAll('.eval-note');

    // --- AUTO-CALCULATE ATTENDANCE BONUS (Criteria I) ---
    const cfg = window.currentUserContext?.salary_config || {};
    const attRate = Number(cfg.attendance_rate || 0);
    if (attRate > 0 && evalAmounts.length > 0) {
        const attInp = evalAmounts[0];
        const calculatedBonus = Math.round((filteredMinutes / 60) * attRate);

        // Update input value
        attInp.value = calculatedBonus;

        // Also update note if empty or contains previous auto-calculation
        const attNote = evalNotes[0];
        const autoNotePrefix = "Thưởng chuyên cần:";
        if (attNote && (!attNote.value || attNote.value.startsWith(autoNotePrefix))) {
            attNote.value = `${autoNotePrefix} ${attRate.toLocaleString()}đ/h x ${(filteredMinutes / 60).toFixed(1)}h`;
        }
    }

    evalAmounts.forEach(input => {
        totalBonus += parseFormattedNumber(input.value) || 0;
    });

    // Determine if selected staff is receptionist to show/calculate receptionist-specific bonuses
    const staffUser = window.currentUserContext;
    let isRecep = false;
    if (staffUser) {
        const staffRoles = (staffUser.roles && staffUser.roles.length > 0) ? staffUser.roles : [staffUser.role || ''];
        isRecep = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
    }

    // Redistribution logic for Receptionist collective bonus pool
    if (isRecep) {
        const actualCenterRevenue = parseFormattedNumber(document.getElementById('header-actual-revenue-total')?.value || '0');
        const actualCs2Revenue = parseFormattedNumber(document.getElementById('header-actual-revenue-cs2')?.value || '0');
        
        let P_tong = 0;
        let P_cs2 = 0;
        
        if (actualCenterRevenue >= 525000000) P_tong = 7000000;
        else if (actualCenterRevenue >= 500000000) P_tong = 4000000;
        else if (actualCenterRevenue >= 475000000) P_tong = 1500000;

        if (actualCs2Revenue >= 65000000) P_cs2 = 500000;
        
        const staffId = document.getElementById('staff-select').value;
        const currentRecepData = (window.allReceptionistsData || []).find(r => r.id === staffId);
        
        let myCenterBonus = 0;
        let myCs2Bonus = 0;
        
        if (currentRecepData) {
            const sumC = (window.allReceptionistsData || []).reduce((sum, r) => sum + r.C_j, 0);
            if (sumC > 0) {
                myCenterBonus = P_tong * (currentRecepData.C_j / sumC);
            }
            
            const sumC_cs2 = (window.allReceptionistsData || []).filter(r => r.hasCs2Shift).reduce((sum, r) => sum + r.C_j_cs2, 0);
            if (sumC_cs2 > 0 && currentRecepData.hasCs2Shift) {
                myCs2Bonus = P_cs2 * (currentRecepData.C_j_cs2 / sumC_cs2);
            }
        }
        
        const outputTong = document.getElementById('pdf-doanh-thu-tong');
        const outputCs2 = document.getElementById('pdf-doanh-thu-cs2');
        if (outputTong) outputTong.value = formatNumberWithCommas(Math.round(myCenterBonus));
        if (outputCs2) outputCs2.value = formatNumberWithCommas(Math.round(myCs2Bonus));
        
        // Read and populate read-only Phi tu van and Doanh thu CS3 from the receptionist settings
        const monthlyAll = window.currentMonthlySalarySettingsAll || {};
        const user = window.currentUserContext;
        let hasReceptionist = false;
        let hasTeaching = false;
        if (user) {
            const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
            hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
            hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
        }
        const isPureRecep = hasReceptionist && !hasTeaching;
        const recepSettings = (window.currentLoadedRoleKey === 'tiep_tan')
            ? (window.currentLoadedSalarySettings || {})
            : (monthlyAll['tiep_tan'] || monthlyAll['tiep-tan'] || {});
        
        const evaluation = recepSettings.evaluation || [];
        const phiTuVanObj = evaluation.find(e => e.id === 1);
        const doanhThuCs3Obj = evaluation.find(e => e.id === 6);
        const phiTuVan = phiTuVanObj ? (Number(phiTuVanObj.amount) || 0) : 0;
        const doanhThuCs3 = doanhThuCs3Obj ? (Number(doanhThuCs3Obj.amount) || 0) : 0;

        // Lấy giá trị phí tư vấn và doanh thu CS3 từ settings (đã lưu)
        const phiTuVanDisplay = document.getElementById('pdf-phi-tu-van');
        const doanhThuCs3Display = document.getElementById('pdf-doanh-thu-cs3');
        
        // Đọc trực tiếp từ DOM input, nếu không tồn tại thì dùng settings/0 (vì DOM đã được loadSalarySettings khởi tạo đúng từ database)
        const phiTuVanActual = phiTuVanDisplay
            ? (parseFormattedNumber(phiTuVanDisplay.value) || 0)
            : phiTuVan;
        const doanhThuCs3Actual = doanhThuCs3Display
            ? (parseFormattedNumber(doanhThuCs3Display.value) || 0)
            : doanhThuCs3;
        
        // Cập nhật hiển thị nếu user không đang gõ vào input đó
        if (phiTuVanDisplay && document.activeElement !== phiTuVanDisplay) phiTuVanDisplay.value = formatNumberWithCommas(phiTuVanActual);
        if (doanhThuCs3Display && document.activeElement !== doanhThuCs3Display) doanhThuCs3Display.value = formatNumberWithCommas(doanhThuCs3Actual);
        
        // Kiểm tra xem eval table đang hiển thị criteria GV hay TT
        // Nếu eval table đang render TT criteria: phí tư vấn ĐÃ có trong evalAmounts (readonly nhưng có value)
        //   → KHÔNG cộng lại ở đây để tránh double-count
        // Nếu eval table đang render GV criteria (dual-role, xem tab GV): phí tư vấn TT CHƯA có trong evalAmounts
        //   → CẦN cộng trực tiếp vào totalBonus ở đây
        const loadedRoleKey = window.currentLoadedRoleKey || 'giao_vien';
        const evalTableShowingGV = (loadedRoleKey === 'giao_vien');
        if (evalTableShowingGV) {
            // Chỉ cộng phí tư vấn TT khi eval table đang hiện GV (tránh double-count)
            totalBonus += phiTuVanActual + doanhThuCs3Actual;
        } else {
            // Eval table đang hiện TT criteria - phí tư vấn ĐÃ có trong evalAmounts
            // Sync giá trị mới nhất vào eval inputs và điều chỉnh totalBonus theo hiệu số
            const phiTuVanEvalInput = document.querySelector('.eval-amount[data-index="1"]');
            if (phiTuVanEvalInput) {
                const oldVal = parseFormattedNumber(phiTuVanEvalInput.value) || 0;
                if (oldVal !== phiTuVanActual) {
                    phiTuVanEvalInput.value = formatNumberWithCommas(phiTuVanActual);
                    // evalAmounts.forEach đã cộng oldVal → điều chỉnh lại với giá trị mới
                    totalBonus += (phiTuVanActual - oldVal);
                }
            }
            const doanhThuCs3EvalInput = document.querySelector('.eval-amount[data-index="6"]');
            if (doanhThuCs3EvalInput) {
                const oldCs3Val = parseFormattedNumber(doanhThuCs3EvalInput.value) || 0;
                if (oldCs3Val !== doanhThuCs3Actual) {
                    doanhThuCs3EvalInput.value = formatNumberWithCommas(doanhThuCs3Actual);
                    totalBonus += (doanhThuCs3Actual - oldCs3Val);
                }
            }
        }
        
        // Cộng thêm bonus doanh thu tập thể (trung tâm + CS2)
        totalBonus += Math.round(myCenterBonus) + Math.round(myCs2Bonus);
    }

    // Store base salary for Export PDF
    window.currentMonthSalary = filteredSalary;

    const loadedSettings = window.currentLoadedSalarySettings || {};
    let adjustVDX = Number(loadedSettings.adjust_vdx || 0);
    let adjustVKP = Number(loadedSettings.adjust_vkp || 0);
    let adjustLate = Number(loadedSettings.adjust_late || 0);
    const advanceInput = document.getElementById('salary-advance');
    let advance = advanceInput ? (parseFormattedNumber(advanceInput.value) || 0) : 0;

    // Support dual-role aggregation when filtering by "All"
    if (roleFilter === 'all') {
        const monthlyAll = window.currentMonthlySalarySettingsAll || {};
        
        // Helper to identify chip roles
        const checkIsReceptionist = c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(c.sessionData.role));
        
        const hasTeachingChips = allChips.some(c => !checkIsReceptionist(c));
        const hasReceptionistChips = allChips.some(c => checkIsReceptionist(c));
        
        if (hasTeachingChips && hasReceptionistChips) {
            // Dual-role employee!
            // Use window.currentLoadedRoleKey (reliable flag) instead of object reference comparison
            const loadedRoleKey = window.currentLoadedRoleKey || 'giao_vien';
            const otherRole = loadedRoleKey === 'tiep_tan' ? 'giao_vien' : 'tiep_tan';
            
            const otherSettings = monthlyAll[otherRole] || monthlyAll[otherRole.replace('_', '-')] || {};
            
            // Add other role's evaluations, adjustments and advance
            // Nếu otherRole là tiep_tan: phí tư vấn (id=1) và DT CS3 (id=6) đã được cộng
            // trong block isRecep ở trên → loại chúng ra để tránh double-count
            const evalIdsAlreadyCounted = otherRole === 'tiep_tan' ? [1, 6] : [];
            const otherBonus = (otherSettings.evaluation || []).reduce((sum, e) => {
                if (evalIdsAlreadyCounted.includes(e.id)) return sum; // đã tính trong isRecep block
                return sum + (Number(e.amount) || 0);
            }, 0);
            totalBonus += otherBonus;
            
            // If the 'other' role is tiep_tan, also add myCenterBonus and myCs2Bonus if available
            // (they are computed in the isRecep block above for the active user)
            // But we only add those when the OTHER role is tiep_tan (loaded role is giao_vien)
            if (otherRole === 'tiep_tan') {
                // centerBonus/cs2Bonus may have been computed above if isRecep was true
                // They are already added in the isRecep block (totalBonus += Math.round(myCenterBonus) + Math.round(myCs2Bonus))
                // But isRecep check uses staffUser roles, so if recep, it's already included above
            }
            
            adjustVDX += Number(otherSettings.adjust_vdx || 0);
            adjustVKP += Number(otherSettings.adjust_vkp || 0);
            adjustLate += Number(otherSettings.adjust_late || 0);
            advance += Number(otherSettings.advance || 0);
        }
    }

    updateBonusDisplay(totalBonus);

    const totalSalary = filteredSalary + totalBonus - adjustVDX - adjustVKP - adjustLate - advance;

    const finalDisplay = document.getElementById('final-salary-display');
    if (finalDisplay) {
        finalDisplay.innerText = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalSalary);
    }
    applySalaryVisibility();

    // Update Subject Breakdown UI
    const breakdownSection = document.getElementById('subject-breakdown-section');
    const breakdownBody = document.getElementById('subject-breakdown-body');
    if (breakdownSection && breakdownBody) {
        breakdownBody.innerHTML = '';
        const breakdown = window.currentSubjectBreakdown || [];
        if (breakdown.length > 0) {
            breakdownSection.style.display = 'block';
            let grandMins = 0;
            let grandAmount = 0;
            breakdown.forEach(item => {
                const totalMinutes = item.hours * 60;
                const hrs = Math.floor(totalMinutes / 60);
                const mins = Math.round(totalMinutes % 60);
                const hoursStr = `${hrs}h${mins > 0 ? ' ' + mins + 'p' : ''}`;
                
                grandMins += totalMinutes;
                grandAmount += item.amount;
                
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--border-color)';
                tr.style.fontSize = '0.9rem';
                tr.innerHTML = `
                    <td style="padding: 0.75rem 0.5rem; font-weight: 600; color: var(--text-color);">${item.name}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: center;">${hoursStr}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-muted);">${formatNumberWithCommas(item.rate)}đ/h</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 700; color: var(--primary-color);">${formatNumberWithCommas(item.amount)}đ</td>
                `;
                breakdownBody.appendChild(tr);
            });
            
            // Total row
            const trTotal = document.createElement('tr');
            trTotal.style.fontWeight = '700';
            trTotal.style.background = '#F9FAFB';
            trTotal.style.fontSize = '0.95rem';
            const totHrs = Math.floor(grandMins / 60);
            const totMins = Math.round(grandMins % 60);
            const totHoursStr = `${totHrs}h${totMins > 0 ? ' ' + totMins + 'p' : ''}`;
            
            trTotal.innerHTML = `
                <td style="padding: 0.75rem 0.5rem;">Tổng cộng</td>
                <td style="padding: 0.75rem 0.5rem; text-align: center;">${totHoursStr}</td>
                <td style="padding: 0.75rem 0.5rem;"></td>
                <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--secondary-color);">${formatNumberWithCommas(Math.round(grandAmount))}đ</td>
            `;
            breakdownBody.appendChild(trTotal);
        } else {
            breakdownSection.style.display = 'none';
        }
    }

    // Update Admin Edited History UI
    const adminEditedSection = document.getElementById('admin-edited-history-section');
    const adminEditedBody = document.getElementById('admin-edited-history-body');
    if (adminEditedSection && adminEditedBody) {
        adminEditedBody.innerHTML = '';
        
        const editedChips = [];
        const seenSessionIds = new Set();
        const allMonthChips = window.allMonthChips || [];
        
        allMonthChips.forEach(chip => {
            if (chip.isAdminEdited && chip.sessionId && !seenSessionIds.has(chip.sessionId)) {
                seenSessionIds.add(chip.sessionId);
                editedChips.push(chip);
            }
        });
        
        const viewerRole = localStorage.getItem('currentRole') || 'staff';
        let viewerRoles = [];
        try {
            const parsed = JSON.parse(viewerRole);
            viewerRoles = Array.isArray(parsed) ? parsed : [viewerRole];
        } catch(e) {
            viewerRoles = [viewerRole];
        }
        const isAdminViewer = viewerRoles.some(r => r === 'admin' || r === 'senior_assistant');

        if (isAdminViewer && editedChips.length > 0) {
            adminEditedSection.style.display = 'block';
            
            // Sort by date key ascending
            editedChips.sort((a, b) => {
                const dA = a.dateStr || '';
                const dB = b.dateStr || '';
                return dA.localeCompare(dB);
            });

            editedChips.forEach(chip => {
                const s = chip.sessionData || {};
                
                let dateDisplay = 'N/A';
                if (chip.dateStr) {
                    const parts = chip.dateStr.split('-');
                    if (parts.length === 3) {
                        dateDisplay = `${parts[2]}/${parts[1]}/${parts[0]}`;
                    }
                }
                
                const checkInTime = s.checkIn ? new Date(s.checkIn).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '??:??';
                const checkOutTime = s.checkOut ? new Date(s.checkOut).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Chưa ra ca';
                
                let workDetails = chip.text || 'N/A';
                if (s.isAbsent) {
                    workDetails += ' <span style="color:#DC2626; font-weight:700;">(Vắng)</span>';
                }
                
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--border-color)';
                tr.style.fontSize = '0.9rem';
                tr.innerHTML = `
                    <td style="padding: 0.75rem 0.5rem; font-weight: 600; color: var(--text-color);">${dateDisplay}</td>
                    <td style="padding: 0.75rem 0.5rem; font-weight: 500; display: flex; align-items: center; gap: 4px;">
                        ${workDetails}
                        <span title="Admin đã chỉnh sửa" style="cursor:help; display:inline-flex; align-items:center; vertical-align:middle;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>
                    </td>
                    <td style="padding: 0.75rem 0.5rem; text-align: center; color: #2563EB; font-weight: 500;">${checkInTime}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: center; color: #DC2626; font-weight: 500;">${checkOutTime}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 600; color: var(--secondary-color);">${s.roleName || (s.role === 'tiep-tan' ? 'Tiếp Tân' : 'Dạy học')}</td>
                `;
                adminEditedBody.appendChild(tr);
            });
        } else {
            adminEditedSection.style.display = 'none';
        }
    }
}

function applySalaryVisibility() {
    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    let roles = [];
    try {
        const parsed = JSON.parse(roleRaw);
        roles = Array.isArray(parsed) ? parsed : [roleRaw];
    } catch(e) {
        roles = [roleRaw];
    }
    const isSeniorAssistant = roles.includes('senior_assistant') && !roles.includes('admin');

    if (isSeniorAssistant) {
        const modalTables = document.querySelectorAll('#class-rate-modal table');
        modalTables.forEach(modalTable => {
            const ths = modalTable.querySelectorAll('thead th');
            if (ths.length >= 4) {
                ths[2].style.display = 'none';
                ths[3].style.display = 'none';
            }
            const rows = modalTable.querySelectorAll('tbody tr');
            rows.forEach(r => {
                const tds = r.querySelectorAll('td');
                if (tds.length >= 4) {
                    tds[2].style.display = 'none';
                    tds[3].style.display = 'none';
                }
            });
        });

        const modalFinalDisplay = document.getElementById('modal-final-salary-display');
        if (modalFinalDisplay) modalFinalDisplay.innerText = '******';

        const finalDisplay = document.getElementById('final-salary-display');
        if (finalDisplay) finalDisplay.innerText = '******';

        const historyContainer = document.getElementById('modal-history-content');
        if (historyContainer) {
            const historyNetPayEl = historyContainer.querySelector('div[style*="ECFDF5"] strong');
            if (historyNetPayEl) historyNetPayEl.innerText = '******';
        }

        const pdfBtns = document.querySelectorAll('button[onclick*="exportSalaryPDF"]');
        pdfBtns.forEach(btn => btn.style.display = 'none');
    } else {
        const modalTables = document.querySelectorAll('#class-rate-modal table');
        modalTables.forEach(modalTable => {
            const ths = modalTable.querySelectorAll('thead th');
            if (ths.length >= 4) {
                ths[2].style.display = '';
                ths[3].style.display = '';
            }
            const rows = modalTable.querySelectorAll('tbody tr');
            rows.forEach(r => {
                const tds = r.querySelectorAll('td');
                if (tds.length >= 4) {
                    tds[2].style.display = '';
                    tds[3].style.display = '';
                }
            });
        });
        
        const pdfBtns = document.querySelectorAll('button[onclick*="exportSalaryPDF"]');
        pdfBtns.forEach(btn => btn.style.display = '');
    }
}

async function saveSalarySettings() {
    const staffId = document.getElementById('staff-select').value;
    if (staffId === 'all') return;
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    const user = window.currentUserContext;
    let hasReceptionist = false;
    let hasTeaching = false;
    if (user) {
        const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
        hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
        hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
    }
    const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
    const activeFilter = (filterVal === 'tiep-tan') || (filterVal === 'all' && hasReceptionist && !hasTeaching) ? 'tiep-tan' : 'giao-vien';
    const roleKey = activeFilter === 'tiep-tan' ? 'tiep_tan' : 'giao_vien';

    const rate = 0; // Legacy
    const advance = parseFormattedNumber(document.getElementById('salary-advance').value) || 0;
    const evaluationData = [];

    document.querySelectorAll('.eval-note').forEach((noteInp) => {
        const criteriaIndex = parseInt(noteInp.dataset.index, 10);
        if (isNaN(criteriaIndex)) return;
        const amountInp = document.querySelector(`.eval-amount[data-index="${criteriaIndex}"]`);
        evaluationData.push({
            id: criteriaIndex,
            note: noteInp.value,
            amount: amountInp ? (parseFormattedNumber(amountInp.value) || 0) : 0
        });
    });

    // Nếu là tiếp tân: override phí tư vấn (id=1) và DT CS3 (id=6) từ các ô riêng
    // vì eval table của TT là readonly và có thể chưa sync với giá trị mới nhất
    if (activeFilter === 'tiep-tan') {
        const phiTuVanInput = document.getElementById('pdf-phi-tu-van');
        const doanhThuCs3Input = document.getElementById('pdf-doanh-thu-cs3');
        
        if (phiTuVanInput) {
            const phiTuVanVal = parseFormattedNumber(phiTuVanInput.value) || 0;
            const existing = evaluationData.find(e => e.id === 1);
            if (existing) {
                existing.amount = phiTuVanVal;
            } else {
                evaluationData.push({ id: 1, note: '', amount: phiTuVanVal });
            }
        }
        if (doanhThuCs3Input) {
            const doanhThuCs3Val = parseFormattedNumber(doanhThuCs3Input.value) || 0;
            const existingCs3 = evaluationData.find(e => e.id === 6);
            if (existingCs3) {
                existingCs3.amount = doanhThuCs3Val;
            } else {
                evaluationData.push({ id: 6, note: '', amount: doanhThuCs3Val });
            }
        }
    }

    const loadedSettings = window.currentLoadedSalarySettings || {};
    const settingsObj = {
        rate,
        advance,
        evaluation: evaluationData,
        adjust_vdx: loadedSettings.adjust_vdx !== undefined ? loadedSettings.adjust_vdx : 0,
        adjust_vkp: loadedSettings.adjust_vkp !== undefined ? loadedSettings.adjust_vkp : 0,
        adjust_late: loadedSettings.adjust_late !== undefined ? loadedSettings.adjust_late : 0
    };

    try {
        // Save to Monthly Settings
        const firestorePayload = {};
        firestorePayload[roleKey] = settingsObj;
        await DBService.saveMonthlySalarySettings(staffId, monthStr, firestorePayload);
        
        if (!window.currentMonthlySalarySettingsAll) {
            window.currentMonthlySalarySettingsAll = {};
        }
        window.currentMonthlySalarySettingsAll[roleKey] = settingsObj;
        
        // Save revenues to recep_revenue_${monthStr} if tiep-tan
        if (activeFilter === 'tiep-tan') {
            const totalRev = parseFloat(document.getElementById('pdf-actual-revenue-total')?.value) || 0;
            const cs2Rev = parseFloat(document.getElementById('pdf-actual-revenue-cs2')?.value) || 0;
            try {
                await window.db.collection('settings').doc(`recep_revenue_${monthStr}`).set({
                    total: totalRev,
                    cs2: cs2Rev
                }, { merge: true });
            } catch (e) {
                console.error('Error saving receptionist revenues:', e);
            }
        }

        // Proactively update user context class rates if needed
        if (window.currentUserContext && window.currentUserContext.salary_config) {
            window.currentUserContext.salary_config.evaluation = evaluationData;
        }

        // Auto-save calculated payroll as a draft
        await saveCalculationDraftToDb(staffId, monthStr);

        UIService.toast('Đã lưu bảng lương thành công!', 'success');
    } catch (e) {
        console.error('Error saving salary settings:', e);
        UIService.toast('Lỗi khi lưu bảng lương: ' + e.message, 'error');
    }
}

async function loadSalarySettings() {
    const staffId = document.getElementById('staff-select').value;
    if (!staffId || staffId === 'all') return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    const user = window.currentUserContext;
    let hasReceptionist = false;
    let hasTeaching = false;
    if (user) {
        const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
        hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
        hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
    }
    const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
    let activeFilter = 'giao-vien';
    if (filterVal === 'tiep-tan') {
        activeFilter = 'tiep-tan';
    } else if (filterVal === 'giao-vien') {
        activeFilter = 'giao-vien';
    } else {
        // filterVal === 'all'
        if (hasReceptionist && !hasTeaching) {
            activeFilter = 'tiep-tan';
        } else if (hasTeaching && !hasReceptionist) {
            activeFilter = 'giao-vien';
        } else if (hasTeaching && hasReceptionist) {
            // Dual-role employee: check actual shifts worked to default
            let receptionistShiftCount = 0;
            let teachingShiftCount = 0;
            (window.unfilteredAllMonthChips || []).forEach(chip => {
                if (chip.class === 'chip-future' || chip.isCenterOff) return;
                const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
                if (isTT) receptionistShiftCount++;
                else teachingShiftCount++;
            });
            
            if (receptionistShiftCount > 0 && teachingShiftCount === 0) {
                activeFilter = 'tiep-tan';
            } else if (teachingShiftCount > 0 && receptionistShiftCount === 0) {
                activeFilter = 'giao-vien';
            } else if (receptionistShiftCount > 0 && teachingShiftCount > 0) {
                activeFilter = teachingShiftCount >= receptionistShiftCount ? 'giao-vien' : 'tiep-tan';
            } else {
                activeFilter = 'giao-vien';
            }
        }
    }
    const roleKey = activeFilter === 'tiep-tan' ? 'tiep_tan' : 'giao_vien';
    // Track the currently loaded role key for reliable dual-role detection
    window.currentLoadedRoleKey = roleKey;

    let settings = {};
    try {
        // Load monthly settings first
        const monthlySettings = await DBService.getMonthlySalarySettings(staffId, monthStr) || {};
        window.currentMonthlySalarySettingsAll = monthlySettings;
        
        let gvSettings = monthlySettings['giao_vien'] || monthlySettings['giao-vien'];
        let ttSettings = monthlySettings['tiep_tan'] || monthlySettings['tiep-tan'];
        
        // If teaching role is needed but not in monthly settings, fallback to general settings
        if (hasTeaching && !gvSettings) {
            gvSettings = await DBService.getSalarySettings(staffId) || {};
            window.currentMonthlySalarySettingsAll['giao_vien'] = gvSettings;
        }
        
        // If receptionist role is needed but not in monthly settings, fallback to general settings
        if (hasReceptionist && !ttSettings) {
            ttSettings = await DBService.getSalarySettings(staffId) || {};
            if (!ttSettings.evaluation) {
                ttSettings.evaluation = [];
            }
            window.currentMonthlySalarySettingsAll['tiep_tan'] = ttSettings;
        }
        
        settings = roleKey === 'tiep_tan' ? ttSettings : gvSettings;
        if (!settings) settings = {};
    } catch (e) {
        console.error('Error loading salary settings:', e);
        // Fallback to localStorage
        const allSettings = JSON.parse(localStorage.getItem('salary_settings')) || {};
        settings = allSettings[staffId] || {};
    }

    window.currentLoadedSalarySettings = settings;
    document.getElementById('salary-advance').value = formatNumberWithCommas(settings.advance || 0);

    // Reset/populate receptionist extra inputs from loaded database values to avoid carry-over
    const phiTuVanInput = document.getElementById('pdf-phi-tu-van');
    const doanhThuCs3Input = document.getElementById('pdf-doanh-thu-cs3');
    if (phiTuVanInput || doanhThuCs3Input) {
        const monthlyAll = window.currentMonthlySalarySettingsAll || {};
        const ttSettings = monthlyAll['tiep_tan'] || monthlyAll['tiep-tan'] || {};
        const ttEvaluation = ttSettings.evaluation || [];
        const dbPhiTuVan = ttEvaluation.find(e => e.id === 1)?.amount || 0;
        const dbDoanhThuCs3 = ttEvaluation.find(e => e.id === 6)?.amount || 0;

        if (phiTuVanInput) {
            phiTuVanInput.value = formatNumberWithCommas(dbPhiTuVan);
        }
        if (doanhThuCs3Input) {
            doanhThuCs3Input.value = formatNumberWithCommas(dbDoanhThuCs3);
        }
    }
    
    // Load monthly actual revenues unconditionally for the header
    try {
        const revDoc = await window.db.collection('settings').doc(`recep_revenue_${monthStr}`).get();
        const revenues = revDoc.exists ? revDoc.data() : { total: 0, cs2: 0 };
        
        const headerTotal = document.getElementById('header-actual-revenue-total');
        const headerCs2 = document.getElementById('header-actual-revenue-cs2');
        
        if (headerTotal) headerTotal.value = formatNumberWithCommas(revenues.total || 0);
        if (headerCs2) headerCs2.value = formatNumberWithCommas(revenues.cs2 || 0);
    } catch (e) {
        console.error('Error loading global monthly revenues:', e);
    }

    if (activeFilter === 'tiep-tan') {
        try {
            // Load and compute cống hiến points for all receptionists in background
            loadAndComputeAllReceptionists(monthStr).catch(err => {
                console.error("Error computing all receptionist scores:", err);
            });
        } catch (e) {
            console.error('Error loading receptionist cống hiến points:', e);
        }
    }
    
    renderEvaluationTable(settings.evaluation || []);
    calculateSalary();
    bindMoneyInputFormatters();

    // Update publish status badge and publish button
    const publishBadge = document.getElementById('salary-publish-status-badge');
    const publishBtn = document.getElementById('btn-publish-salary');
    
    if (publishBadge && publishBtn) {
        const publishedObj = window.currentMonthlySalarySettingsAll?.published;
        if (publishedObj && publishedObj.status) {
            publishBadge.style.display = 'inline-block';
            if (publishedObj.status === 'received') {
                publishBadge.innerText = 'Đã Nhận Lương';
                publishBadge.style.backgroundColor = '#D1FAE5';
                publishBadge.style.color = '#065F46';
                publishBadge.style.border = '1px solid #10B981';
                publishBtn.innerHTML = `${window.getIconHtml('send', {width: '14', height: '14'})} Gửi Lại Bảng Lương`;
            } else if (publishedObj.status === 'published') {
                publishBadge.innerText = 'Đã Gửi Bảng Lương';
                publishBadge.style.backgroundColor = '#DBEAFE';
                publishBadge.style.color = '#1E40AF';
                publishBadge.style.border = '1px solid #3B82F6';
                publishBtn.innerHTML = `${window.getIconHtml('send', {width: '14', height: '14'})} Gửi Lại Bảng Lương`;
            } else if (publishedObj.status === 'draft') {
                publishBadge.innerText = 'Đã tính (Chưa gửi)';
                publishBadge.style.backgroundColor = '#FEF3C7';
                publishBadge.style.color = '#D97706';
                publishBadge.style.border = '1px solid #FDE68A';
                publishBtn.innerHTML = `${window.getIconHtml('send', {width: '14', height: '14'})} Gửi Bảng Lương`;
            }
        } else {
            publishBadge.style.display = 'none';
            publishBtn.innerHTML = `${window.getIconHtml('send', {width: '14', height: '14'})} Gửi Bảng Lương`;
        }
        publishBtn.style.display = 'inline-flex';
    }
}

async function saveHeaderRevenues() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    const totalRev = parseFormattedNumber(document.getElementById('header-actual-revenue-total')?.value || '0');
    const cs2Rev = parseFormattedNumber(document.getElementById('header-actual-revenue-cs2')?.value || '0');

    try {
        await window.db.collection('settings').doc(`recep_revenue_${monthStr}`).set({
            total: totalRev,
            cs2: cs2Rev
        }, { merge: true });

        UIService.toast('Da luu doanh thu thanh cong!', 'success');
        
        // Recalculate cống hiến points and salary for everyone in receptionist group
        await loadAndComputeAllReceptionists(monthStr);
    } catch (e) {
        console.error('Error saving header revenues:', e);
        UIService.toast('Loi khi luu doanh thu: ' + e.message, 'error');
    }
}
window.saveHeaderRevenues = saveHeaderRevenues;

// ================= NOTES =================

let currentNoteDateKey = null;

function openNoteModal(dateKey) {
    currentNoteDateKey = dateKey;
    currentEvalIndex = null;

    // Use cached notes from Firestore
    document.getElementById('note-modal-title').innerText = `Ghi Chú Ngày ${dateKey}`;
    document.getElementById('note-content').value = _cachedStaffNotes[dateKey] || '';
    document.getElementById('note-modal').style.display = 'flex';
}

function openEvalNoteModal(index) {
    currentEvalIndex = index;
    currentNoteDateKey = null;

    const noteInput = document.querySelector(`.eval-note[data-index="${index}"]`);
    let currentVal = noteInput ? noteInput.value : '';

    if (!currentVal || currentVal.trim() === '') {
        const item = EVALUATION_CRITERIA[index];
        if (item && item.template) currentVal = item.template;
    }

    document.getElementById('note-modal-title').innerText = `Ghi Chú: ${EVALUATION_CRITERIA[index].tooltip}`;
    document.getElementById('note-content').value = currentVal;
    document.getElementById('note-modal').style.display = 'flex';
}

function closeNoteModal() {
    document.getElementById('note-modal').style.display = 'none';
}

function saveNote() {
    if (currentNoteDateKey) saveCalendarNote();
    else if (currentEvalIndex !== null) saveEvaluationNote();
}

async function saveCalendarNote() {
    const staffId = getTargetStaffId();
    const note = document.getElementById('note-content').value.trim();

    // Update local cache immediately
    if (note) _cachedStaffNotes[currentNoteDateKey] = note;
    else delete _cachedStaffNotes[currentNoteDateKey];

    // Save to Firestore
    try {
        await DBService.saveDailyNotes(staffId, _cachedStaffNotes);
    } catch (e) {
        console.error('Error saving note to Firestore:', e);
    }

    closeNoteModal();
    renderMonthReport(currentDate);
}

function saveEvaluationNote() {
    const note = document.getElementById('note-content').value;
    const noteInput = document.querySelector(`.eval-note[data-index="${currentEvalIndex}"]`);
    if (noteInput) {
        noteInput.value = note;
        const btn = noteInput.nextElementSibling;
        if (btn) btn.style.color = note.trim() ? 'var(--primary-color)' : '#9ca3af';
    }
    closeNoteModal();
}

function getTargetStaffId() {
    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    let roles = [];
    try {
        const parsed = JSON.parse(roleRaw);
        roles = Array.isArray(parsed) ? parsed : [roleRaw];
    } catch (e) {
        roles = [roleRaw];
    }
    const isAdmin = roles.some(r => r === 'admin' || r === 'senior_assistant');

    if (isAdmin) {
        const select = document.getElementById('staff-select');
        if (!select || !select.value) {
            return localStorage.getItem('currentUserId') || localStorage.getItem('currentUser');
        }
        return select.value === 'all' ? localStorage.getItem('currentUserId') : select.value;
    } else {
        return localStorage.getItem('currentUserId') || localStorage.getItem('currentUser');
    }
}

function getTargetStaffName() {
    const select = document.getElementById('staff-select');
    if (select && select.value !== 'all') {
        return select.options[select.selectedIndex].text.split('(')[0].trim();
    }
    return localStorage.getItem('currentUserName') || 'N/A';
}


window.onclick = function (event) {
    const modal = document.getElementById('note-modal');
    if (event.target == modal) closeNoteModal();
}

// removeVietnameseTones() → Moved to evaluation-service.js

// ================= ADMIN EDIT LOGIC =================
let fpCheckIn = null;
let fpCheckOut = null;

function initFlatpickr() {
    if (typeof flatpickr !== 'undefined') {
        const config = {
            enableTime: true,
            dateFormat: "Y-m-d\\TH:i",
            altInput: true,
            altFormat: "d/m/Y H:i",  // Changed to 24-hour format (H instead of h)
            locale: "vn",
            time_24hr: true,          // Use 24-hour format
            minuteIncrement: 1,        // Ensure 1-minute increment (no rounding to 5 or 10)
            allowInput: true,         // Allow typing manually
            parseDate: (datestr, format) => {
                if (!datestr) return null;
                let cleanStr = datestr.trim().replace(/h/gi, ':');
                
                // Match DD/MM/YYYY HH:mm
                const dmyRegex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{2})$/;
                const matchDmy = cleanStr.match(dmyRegex);
                if (matchDmy) {
                    const day = parseInt(matchDmy[1], 10);
                    const month = parseInt(matchDmy[2], 10);
                    const year = parseInt(matchDmy[3], 10);
                    const hour = parseInt(matchDmy[4], 10);
                    const minute = parseInt(matchDmy[5], 10);
                    return new Date(year, month - 1, day, hour, minute, 0, 0);
                }
                
                // Match YYYY-MM-DD HH:mm or YYYY-MM-DDTHH:mm
                const isoRegex = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[T\s](\d{1,2}):(\d{2})$/;
                const matchIso = cleanStr.match(isoRegex);
                if (matchIso) {
                    const year = parseInt(matchIso[1], 10);
                    const month = parseInt(matchIso[2], 10);
                    const day = parseInt(matchIso[3], 10);
                    const hour = parseInt(matchIso[4], 10);
                    const minute = parseInt(matchIso[5], 10);
                    return new Date(year, month - 1, day, hour, minute, 0, 0);
                }
                
                // Match HH:mm (uses current date in modal as context)
                const timeRegex = /^(\d{1,2}):(\d{2})$/;
                const matchTime = cleanStr.match(timeRegex);
                if (matchTime) {
                    const hour = parseInt(matchTime[1], 10);
                    const minute = parseInt(matchTime[2], 10);
                    const dateKey = document.getElementById('edit-date-key')?.value;
                    if (dateKey) {
                        const [year, month, day] = dateKey.split('-').map(Number);
                        return new Date(year, month - 1, day, hour, minute, 0, 0);
                    }
                }
                
                const parsed = new Date(cleanStr);
                if (!isNaN(parsed.getTime())) return parsed;
                return null;
            }
        };
        if (!fpCheckIn) fpCheckIn = flatpickr("#edit-check-in", config);
        if (!fpCheckOut) fpCheckOut = flatpickr("#edit-check-out", config);
    }
}

// Searchable Role Dropdown Helpers
window.openRoleDropdown = function() {
    const list = document.getElementById('role-dropdown-list');
    if (list) {
        list.style.display = 'block';
        window.renderRoleOptions();
    }
};

window.closeRoleDropdown = function() {
    setTimeout(() => {
        const list = document.getElementById('role-dropdown-list');
        if (list) list.style.display = 'none';
    }, 200);
};

window.filterRoleDropdown = function(query) {
    const term = query.toLowerCase().trim();
    const items = document.querySelectorAll('.role-dropdown-item');
    items.forEach(item => {
        const name = item.textContent.toLowerCase();
        if (name.includes(term)) {
            item.style.display = 'block';
        } else {
            item.style.display = 'none';
        }
    });
};

window.selectRoleItem = function(val, text, rate) {
    const select = document.getElementById('edit-role');
    const input = document.getElementById('role-search-input');
    const clearBtn = document.getElementById('role-search-clear');
    
    if (select) {
        select.value = val;
        const event = new Event('change');
        select.dispatchEvent(event);
    }
    if (input) {
        input.value = text;
    }
    if (clearBtn) {
        clearBtn.style.display = val ? 'inline' : 'none';
    }
    
    const shiftTypeContainer = document.getElementById('edit-shift-type-container');
    if (shiftTypeContainer) {
        shiftTypeContainer.style.display = (val === 'tiep-tan') ? 'block' : 'none';
    }
    const subjectsContainer = document.getElementById('edit-subjects-container');
    if (subjectsContainer) {
        subjectsContainer.style.display = (val === 'giao-vien') ? 'block' : 'none';
    }
    
    const list = document.getElementById('role-dropdown-list');
    if (list) list.style.display = 'none';
};

window.clearRoleSearch = function() {
    window.selectRoleItem('', '-- Chưa chọn Role --', 0);
};

window.renderRoleOptions = function() {
    const select = document.getElementById('edit-role');
    const list = document.getElementById('role-dropdown-list');
    if (!select || !list) return;

    list.innerHTML = '';
    Array.from(select.options).forEach(opt => {
        const div = document.createElement('div');
        div.className = 'role-dropdown-item';
        div.style.padding = '0.75rem 1rem';
        div.style.cursor = 'pointer';
        div.style.fontSize = '0.95rem';
        div.style.transition = 'background 0.2s';
        div.style.borderBottom = '1px solid #F3F4F6';
        div.textContent = opt.textContent;
        div.onclick = () => {
            window.selectRoleItem(opt.value, opt.textContent, opt.dataset.rate);
        };
        div.onmouseenter = () => { div.style.background = '#F3F4F6'; };
        div.onmouseleave = () => { div.style.background = 'transparent'; };
        list.appendChild(div);
    });
};

// Global click listener to close role and subject dropdowns
document.addEventListener('click', function(e) {
    const wrapper = document.getElementById('role-search-wrapper');
    const list = document.getElementById('role-dropdown-list');
    if (wrapper && !wrapper.contains(e.target)) {
        if (list) list.style.display = 'none';
    }
    const subWrapper = document.getElementById('subject-search-wrapper');
    const subList = document.getElementById('subject-dropdown-list');
    if (subWrapper && !subWrapper.contains(e.target)) {
        if (subList) subList.style.display = 'none';
    }
});

// Searchable Subject Multi-select Dropdown Helpers
let editSelectedSubjectIds = [];
let allAvailableSubjects = [];

window.openSubjectDropdown = function() {
    const list = document.getElementById('subject-dropdown-list');
    if (list) {
        list.style.display = 'block';
    }
};

window.closeSubjectDropdown = function() {
    setTimeout(() => {
        const list = document.getElementById('subject-dropdown-list');
        if (list) list.style.display = 'none';
    }, 200);
};

window.filterSubjectDropdown = function(query) {
    const term = query.toLowerCase().trim();
    const items = document.querySelectorAll('.subject-dropdown-item');
    items.forEach(item => {
        const name = item.dataset.name.toLowerCase();
        if (name.includes(term)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
};

window.toggleSubjectSelection = function(subId, subName, subRate) {
    const idx = editSelectedSubjectIds.indexOf(subId);
    if (idx > -1) {
        editSelectedSubjectIds.splice(idx, 1);
    } else {
        editSelectedSubjectIds.push(subId);
    }
    renderSelectedSubjectBadges();
    
    // Update checkbox visual state
    const cb = document.getElementById(`subject-cb-${subId}`);
    if (cb) cb.checked = idx === -1;
};

window.clearSubjectSearch = function() {
    const input = document.getElementById('subject-search-input');
    if (input) {
        input.value = '';
        window.filterSubjectDropdown('');
    }
};

function renderSelectedSubjectBadges() {
    const container = document.getElementById('selected-subjects-badges');
    if (!container) return;
    container.innerHTML = '';
    
    if (editSelectedSubjectIds.length === 0) {
        container.innerHTML = '<span style="color: #9CA3AF; font-size: 0.85rem; font-style: italic;">Chưa chọn môn học nào</span>';
        return;
    }
    
    editSelectedSubjectIds.forEach(subId => {
        const sub = allAvailableSubjects.find(s => s.id === subId);
        if (!sub) return;
        
        const badge = document.createElement('div');
        badge.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: #EEF2FF;
            color: #4338CA;
            border: 1px solid #C7D2FE;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 0.85rem;
            font-weight: 600;
        `;
        badge.innerHTML = `
            <span>${sub.name}</span>
            <span onclick="window.toggleSubjectSelection('${sub.id}', '${sub.name}', ${sub.rate}); event.stopPropagation();" style="cursor: pointer; font-weight: bold; color: #9CA3AF; margin-left: 4px;">✕</span>
        `;
        container.appendChild(badge);
    });
}

async function loadAndRenderSubjects(staffId) {
    const list = document.getElementById('subject-dropdown-list');
    if (!list) return;
    list.innerHTML = '<div style="padding: 0.75rem 1rem; color: #9CA3AF; font-size: 0.9rem;">Đang tải danh sách môn học...</div>';
    
    try {
        const users = await DBService.getUsers();
        const user = users.find(u => u.id === staffId);
        if (!user) return;
        
        const subjects = await DBService.getSubjects();
        const configuredRoles = (user.salary_config && user.salary_config.roles) ? user.salary_config.roles : [];
        const fallbackRate = (configuredRoles.length > 0) ? configuredRoles[0].rate : (user.salary_config?.attendance_rate || 0);
        
        allAvailableSubjects = [];
        
        // 1. Add configured roles first
        configuredRoles.forEach(r => {
            allAvailableSubjects.push({
                id: r.id,
                name: r.name,
                rate: Number(r.rate)
            });
        });
        
        // 2. Add other subjects from database
        subjects.forEach(s => {
            if (!allAvailableSubjects.some(item => item.id === s.id)) {
                allAvailableSubjects.push({
                    id: s.id,
                    name: s.name,
                    rate: Number(fallbackRate)
                });
            }
        });
        
        list.innerHTML = '';
        allAvailableSubjects.forEach(sub => {
            const isChecked = editSelectedSubjectIds.includes(sub.id);
            const item = document.createElement('div');
            item.className = 'subject-dropdown-item';
            item.dataset.name = sub.name;
            item.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 0.75rem 1rem;
                cursor: pointer;
                border-bottom: 1px solid #F3F4F6;
                transition: background 0.2s;
            `;
            item.onmouseenter = () => { item.style.background = '#F3F4F6'; };
            item.onmouseleave = () => { item.style.background = 'transparent'; };
            item.onclick = () => window.toggleSubjectSelection(sub.id, sub.name, sub.rate);
            
            item.innerHTML = `
                <input type="checkbox" id="subject-cb-${sub.id}" ${isChecked ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #10B981; pointer-events: none;">
                <span style="font-size: 0.95rem; color: #374151;">${sub.name}</span>
                <span style="margin-left: auto; font-size: 0.8rem; color: #9CA3AF; font-weight: 500;">${sub.rate.toLocaleString('vi-VN')}đ/h</span>
            `;
            list.appendChild(item);
        });
        
        renderSelectedSubjectBadges();
    } catch (e) {
        console.warn("Failed to load subjects for edit modal:", e);
        list.innerHTML = '<div style="padding: 0.75rem 1rem; color: #EF4444; font-size: 0.9rem;">Lỗi tải danh sách môn học.</div>';
    }
}

async function populateRoleDropdown(staffId, selectElementId, currentRoleId = null) {
    const select = document.getElementById(selectElementId);
    if (!select) return;

    select.innerHTML = '<option value="">-- Chưa chọn Role --</option>';

    try {
        const users = await DBService.getUsers();
        const user = users.find(u => u.id === staffId);
        if (!user) return;

        const userRolesArr = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : (user.role ? [user.role] : []);
        const hasReceptionistRole = userRolesArr.some(r => ['receptionist', 'receptionist_assistant'].includes(r));
        const hasTeachingRole = userRolesArr.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));

        let hasSelected = false;

        // 1. Option Tiếp Tân
        if (hasReceptionistRole) {
            const opt = document.createElement('option');
            opt.value = 'tiep-tan';
            opt.textContent = 'Tiếp Tân';
            opt.dataset.rate = user.salary_config?.receptionist_normal_rate || 0;
            if (currentRoleId === 'tiep-tan' || currentRoleId === 'receptionist') {
                opt.selected = true;
                hasSelected = true;
            }
            select.appendChild(opt);
        }

        // 2. Option Giáo Viên / Trợ Giảng
        if (hasTeachingRole) {
            const opt = document.createElement('option');
            opt.value = 'giao-vien';
            opt.textContent = 'Giáo Viên / Trợ Giảng';
            if (!hasSelected || (currentRoleId && currentRoleId !== 'tiep-tan' && currentRoleId !== 'receptionist')) {
                opt.selected = true;
            }
            select.appendChild(opt);
        }
    } catch (e) {
        console.warn('Cannot load roles:', e);
    }

    // Sync searchable inputs
    const selectedOpt = select.options[select.selectedIndex];
    const input = document.getElementById('role-search-input');
    const clearBtn = document.getElementById('role-search-clear');
    if (input) {
        input.value = selectedOpt ? selectedOpt.text : '-- Chưa chọn Role --';
    }
    if (clearBtn) {
        clearBtn.style.display = (selectedOpt && selectedOpt.value) ? 'inline' : 'none';
    }
    
    const val = selectedOpt ? selectedOpt.value : '';
    const shiftTypeContainer = document.getElementById('edit-shift-type-container');
    if (shiftTypeContainer) {
        shiftTypeContainer.style.display = (val === 'tiep-tan') ? 'block' : 'none';
    }
    const subjectsContainer = document.getElementById('edit-subjects-container');
    if (subjectsContainer) {
        subjectsContainer.style.display = (val === 'giao-vien') ? 'block' : 'none';
    }
}

async function openManualModal(dateKey, preFill = null, classCompositeKey = '', classSectionKey = '', classIndex = '', isLinkable = false) {
    document.getElementById('edit-time-modal').style.display = 'flex';
    document.getElementById('edit-date-key').value = dateKey;
    document.getElementById('edit-session-id').value = 'NEW'; // Marker for new session
    const statusEl = document.getElementById('edit-session-status');
    if (statusEl) statusEl.value = 'worked';

    // Reset class metadata fields just in case
    if (document.getElementById('edit-class-composite-key')) {
        document.getElementById('edit-class-composite-key').value = classCompositeKey || '';
        document.getElementById('edit-class-section-key').value = classSectionKey || '';
        document.getElementById('edit-class-index').value = classIndex !== undefined ? classIndex : '';
        document.getElementById('edit-class-is-receptionist').value = isLinkable ? 'true' : '';
    }
    const linkedEl = document.getElementById('edit-linked-class-start');
    if (linkedEl) {
        linkedEl.value = (!isLinkable && preFill) ? (preFill.start || '') : '';
    }

    let startVal = '08:00';
    let endVal = '10:00';

    if (preFill) {
        if (preFill.start) startVal = preFill.start;
        if (preFill.end) endVal = preFill.end;
    }

    const isoDate = dateKey;
    const startIso = `${isoDate}T${startVal}`;
    const endIso = `${isoDate}T${endVal}`;

    initFlatpickr();

    if (fpCheckIn) {
        fpCheckIn.setDate(startIso);
    } else {
        document.getElementById('edit-check-in').value = startIso;
    }

    if (fpCheckOut) {
        fpCheckOut.setDate(endIso);
    } else {
        document.getElementById('edit-check-out').value = endIso;
    }

    const staffId = getTargetStaffId();
    let matchedRoleId = null;
    if (isLinkable) {
        matchedRoleId = 'tiep-tan';
    } else {
        try {
            if (preFill) {
                const users = await DBService.getUsers();
                const user = users.find(u => u.id === staffId);
                if (user && user.salary_config && user.salary_config.roles) {
                    const teachingRoles = user.salary_config.roles.filter(r => r.id !== 'tiep-tan' && r.id !== 'receptionist');
                    
                    // 1. Try matching by preFill.lopId
                    if (preFill.lopId) {
                        const found = teachingRoles.find(r => r.id === preFill.lopId);
                        if (found) matchedRoleId = found.id;
                    }
                    
                    // 2. Try matching by string matching on preFill.lop
                    if (!matchedRoleId && preFill.lop) {
                        const clean = s => s.toLowerCase().replace(/\s+/g, '');
                        const classLopClean = clean(preFill.lop);
                        const found = teachingRoles.find(r => 
                            clean(r.name) === classLopClean || 
                            classLopClean.includes(clean(r.name)) || 
                            clean(r.name).includes(classLopClean)
                        );
                        if (found) matchedRoleId = found.id;
                    }
                    
                    // 3. Fallback to single configured teaching role if they only have one
                    if (!matchedRoleId && teachingRoles.length === 1) {
                        matchedRoleId = teachingRoles[0].id;
                    }
                }
            }
        } catch (err) {
            console.warn("Failed to auto-select role:", err);
        }
    }
    if (isLinkable) {
        editSelectedSubjectIds = [];
    } else {
        editSelectedSubjectIds = matchedRoleId ? [matchedRoleId] : [];
    }

    await populateRoleDropdown(staffId, 'edit-role', matchedRoleId);
    await loadAndRenderSubjects(staffId);

    // Default shift type to normal
    const radios = document.getElementsByName('edit-shift-type');
    radios.forEach(r => {
        if (r.value === 'fixed') r.checked = false;
        if (r.value === 'normal') r.checked = true;
    });

    // Update Mode Title
    document.querySelector('#edit-time-modal h2').innerText = "Thêm Ca Làm Việc Mới";
    document.querySelector('#edit-time-modal button.btn-primary').innerText = "Tạo Ca";

    // Show delete button if this shift belongs to a schedule (so admin can delete it entirely)
    const delSection = document.querySelector('#edit-time-modal .delete-section');
    if (delSection) {
        if (classCompositeKey && classSectionKey) {
            delSection.style.display = 'block';
        } else {
            delSection.style.display = 'none';
        }
    }
}

async function openEditModal(dateKey, sessionId, chip, classStart, classCompositeKey, classSectionKey, classIndex, isReceptionist) {
    const sessionData = chip.sessionData || chip;
    document.getElementById('edit-time-modal').style.display = 'flex';
    document.getElementById('edit-date-key').value = dateKey;
    document.getElementById('edit-session-id').value = sessionId;
    const statusEl = document.getElementById('edit-session-status');
    if (statusEl) statusEl.value = (sessionData && sessionData.isAbsent) ? 'absent' : 'worked';
    const linkedEl = document.getElementById('edit-linked-class-start');
    if (linkedEl) linkedEl.value = classStart || (sessionData ? (sessionData.linkedClassStart || '') : '');

    document.getElementById('edit-class-composite-key').value = classCompositeKey || '';
    document.getElementById('edit-class-section-key').value = classSectionKey || '';
    document.getElementById('edit-class-index').value = classIndex !== undefined ? classIndex : '';
    document.getElementById('edit-class-is-receptionist').value = isReceptionist ? 'true' : '';

    const toLocalISO = (isoStr) => {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hour}:${min}`;
    };

    const inIso = toLocalISO(sessionData.checkIn || sessionData.start);
    const outIso = toLocalISO(sessionData.checkOut);

    initFlatpickr();

    if (fpCheckIn) {
        fpCheckIn.setDate(inIso);
    } else {
        document.getElementById('edit-check-in').value = inIso;
    }

    if (fpCheckOut) {
        fpCheckOut.setDate(outIso);
    } else {
        document.getElementById('edit-check-out').value = outIso;
    }

    const staffId = getTargetStaffId();

    const isRecep = sessionData && (sessionData.role === 'tiep-tan' || sessionData.role === 'receptionist');
    if (isRecep) {
        editSelectedSubjectIds = [];
    } else {
        editSelectedSubjectIds = (sessionData && sessionData.role) ? sessionData.role.split('+') : [];
    }

    await populateRoleDropdown(staffId, 'edit-role', sessionData ? sessionData.role : null);
    await loadAndRenderSubjects(staffId);

    // Update shift type radio buttons
    const isFixed = sessionData && sessionData.isFixedShift === true;
    const radios = document.getElementsByName('edit-shift-type');
    radios.forEach(r => {
        if (r.value === 'fixed') {
            r.checked = isFixed;
        } else if (r.value === 'normal') {
            r.checked = !isFixed;
        }
    });

    // --- ADMIN APPROVAL & EXTRA CONFIGS DYNAMIC POPULATION ---
    const adminApprovalSec = document.getElementById('admin-approval-section');
    if (adminApprovalSec) {
        const currentRoleRaw = localStorage.getItem('currentRole') || 'staff';
        let currentUserRoles = [];
        try {
            const _parsed = JSON.parse(currentRoleRaw);
            currentUserRoles = Array.isArray(_parsed) ? _parsed : [currentRoleRaw];
        } catch (e) {
            currentUserRoles = [currentRoleRaw];
        }

        const currentUserContext = window.currentUserContext; // current target user context
        const uRoles = currentUserContext?.roles || (currentUserContext?.role ? [currentUserContext.role] : []);
        const isTargetTA = uRoles.includes('teaching_assistant');
        const isAdminRole = window.currentUserContext && (window.currentUserContext.role === 'admin' || (window.currentUserContext.roles || []).includes('admin'));
        const isAdminViewer = isAdminRole || (currentUserRoles || []).includes('admin') || (currentUserRoles || []).includes('senior_assistant');

        if (isAdminViewer && sessionId && sessionId !== 'NEW' && String(sessionId) !== 'null') {
            adminApprovalSec.style.display = 'block';

            // 1. BONUS 10P (Early check-in)
            const b10Container = document.getElementById('modal-bonus10-container');
            const b10Actions = document.getElementById('modal-bonus10-actions');
            const canSeeBonus10 = !isRecep && isTargetTA;

            if (canSeeBonus10) {
                b10Container.style.display = 'flex';
                b10Actions.innerHTML = '';
                const b10Status = chip.bonus10Status;
                const hasBonus = sessionData && sessionData.bonus10;

                if (b10Status === 'approved' || hasBonus) {
                    b10Actions.innerHTML = `
                        <span style="color: #059669; font-weight: 600; font-size: 0.9rem; margin-right: 8px;">★ Đã duyệt</span>
                        <button type="button" class="btn" style="padding: 4px 10px; font-size: 0.8rem; background: #EF4444; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="modalCancelApprovedBonus10('${chip.bonus10Id || ''}', '${staffId}', '${dateKey}', '${sessionId}')">Hủy thưởng</button>
                    `;
                } else if (b10Status === 'pending') {
                    b10Actions.innerHTML = `
                        <span style="color: #D97706; font-weight: 600; font-size: 0.9rem; margin-right: 8px;">⏱️ Chờ duyệt</span>
                        <button type="button" class="btn" style="padding: 4px 10px; font-size: 0.8rem; background: #10B981; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 4px;" onclick="modalApproveBonus10('${chip.bonus10Id}', '${sessionId}', '${dateKey}', '${staffId}')">Duyệt</button>
                        <button type="button" class="btn" style="padding: 4px 10px; font-size: 0.8rem; background: #EF4444; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="modalRejectBonus10('${chip.bonus10Id}')">Từ chối</button>
                    `;
                } else {
                    b10Actions.innerHTML = `
                        <span style="color: #6B7280; font-size: 0.9rem; margin-right: 8px;">Chưa yêu cầu</span>
                        <button type="button" class="btn" style="padding: 4px 10px; font-size: 0.8rem; background: #3B82F6; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="modalSubmitBonus10Request('${sessionId}', '${dateKey}', '${staffId}')">Thưởng +10p</button>
                    `;
                }
            } else {
                b10Container.style.display = 'none';
            }

            // 2. OVERTIME
            const otPendingStatus = document.getElementById('modal-overtime-pending-status');
            const otActions = document.getElementById('modal-overtime-actions');
            const otInput = document.getElementById('edit-overtime-minutes');

            otPendingStatus.innerHTML = '';
            otActions.innerHTML = '';
            otInput.value = chip.overtimeMinutes || 0;

            if (chip.overtimePending && chip.overtimeId) {
                const otMinutesRequested = sessionData ? sessionData.overtimeMinutes : '';
                otPendingStatus.innerHTML = `⚠️ Nhân viên yêu cầu tăng ca: <strong>${otMinutesRequested || '??'} phút</strong>`;
                otActions.innerHTML = `
                    <button type="button" class="btn" style="padding: 4px 10px; font-size: 0.8rem; background: #10B981; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 4px;" onclick="modalApproveOvertime('${chip.overtimeId}')">Duyệt</button>
                    <button type="button" class="btn" style="padding: 4px 10px; font-size: 0.8rem; background: #EF4444; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="modalRejectOvertime('${chip.overtimeId}')">Từ chối</button>
                `;
            } else if (chip.overtimeMinutes > 0) {
                otPendingStatus.innerHTML = `✅ Đã duyệt tăng ca: <strong>${chip.overtimeMinutes} phút</strong>`;
                otActions.innerHTML = `
                    <button type="button" class="btn" style="padding: 4px 10px; font-size: 0.8rem; background: #EF4444; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="modalCancelApprovedOvertime('${chip.overtimeId || ''}', '${staffId}', '${dateKey}', '${sessionId}')">Hủy tăng ca</button>
                `;
            } else {
                otPendingStatus.innerHTML = 'Không có yêu cầu tăng ca.';
            }

            // 3. STUDENT COUNT (Many students)
            const scContainer = document.getElementById('modal-student-count-container');
            const scLabel = document.getElementById('modal-student-count-label');
            const scBadge = document.getElementById('modal-student-count-status-badge');

            if (!isRecep && chip.studentCount > 0) {
                scContainer.style.display = 'flex';
                scLabel.innerText = `Sĩ số khai báo: ${chip.studentCount} học sinh`;

                let statusText = 'Chờ duyệt';
                let badgeBg = '#FEF3C7';
                let badgeColor = '#D97706';

                if (chip.studentCountStatus === 'approved') {
                    statusText = 'Đã duyệt';
                    badgeBg = '#D1FAE5';
                    badgeColor = '#059669';
                } else if (chip.studentCountStatus === 'rejected') {
                    statusText = 'Từ chối (Phạt)';
                    badgeBg = '#FEE2E2';
                    badgeColor = '#DC2626';
                }

                scBadge.innerText = statusText;
                scBadge.style.background = badgeBg;
                scBadge.style.color = badgeColor;

                document.getElementById('btn-modal-sc-approve').onclick = async () => {
                    await modalStudentCountAction('approve', dateKey, sessionId);
                };
                document.getElementById('btn-modal-sc-reject').onclick = async () => {
                    await modalStudentCountAction('reject', dateKey, sessionId);
                };
                document.getElementById('btn-modal-sc-delete').onclick = async () => {
                    await modalStudentCountAction('delete', dateKey, sessionId);
                };
            } else {
                scContainer.style.display = 'none';
            }

        } else {
            adminApprovalSec.style.display = 'none';
        }
    }

    document.querySelector('#edit-time-modal h2').innerText = "Chỉnh Sửa Giờ Làm";
    document.querySelector('#edit-time-modal button.btn-primary').innerText = "Lưu Thay Đổi";
    const delSection = document.querySelector('#edit-time-modal .delete-section');
    if (delSection) delSection.style.display = 'block';
}

function closeEditModal() {
    document.getElementById('edit-time-modal').style.display = 'none';
}

async function saveEditedTime() {
    const staffId = getTargetStaffId();
    const staffName = getTargetStaffName();
    const dateKey = document.getElementById('edit-date-key').value;
    const sessionIdRaw = document.getElementById('edit-session-id').value;

    const checkIn = document.getElementById('edit-check-in').value;
    const checkOut = document.getElementById('edit-check-out').value;

    if (!checkIn) {
        alert("Giờ vào không được để trống!");
        return;
    }

    const parseLocalDateTime = (localDateTimeStr) => {
        if (!localDateTimeStr) return null;
        const [datePart, timePart] = localDateTimeStr.split('T');
        if (!datePart || !timePart) {
            return new Date(localDateTimeStr);
        }
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        return new Date(year, month - 1, day, hour, minute, 0, 0);
    };

    const checkInDate = parseLocalDateTime(checkIn);
    const checkOutDate = checkOut ? parseLocalDateTime(checkOut) : null;

    if (!checkInDate || isNaN(checkInDate.getTime())) {
        alert("Định dạng giờ vào không hợp lệ!");
        return;
    }

    if (checkOutDate && isNaN(checkOutDate.getTime())) {
        alert("Định dạng giờ ra không hợp lệ!");
        return;
    }

    const checkInStr = checkInDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const checkOutStr = checkOutDate ? checkOutDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';

    const linkedClassStart = document.getElementById('edit-linked-class-start')?.value || null;
    const classSectionKey = document.getElementById('edit-class-section-key')?.value || '';
    const classIsReceptionist = document.getElementById('edit-class-is-receptionist')?.value === 'true';

    const roleSelect = document.getElementById('edit-role');
    const selectedRoleId = roleSelect?.value || null;
    const selectedRoleName = roleSelect?.options[roleSelect.selectedIndex]?.text || null;
    const selectedRoleRate = roleSelect?.options[roleSelect.selectedIndex]?.dataset?.rate || null;

    const statusVal = document.getElementById('edit-session-status')?.value || 'worked';
    const isAbsent = (statusVal === 'absent');

    const newData = {
        checkIn: checkInDate.toISOString(),
        start: checkInDate.toISOString(),
        checkOut: checkOutDate ? checkOutDate.toISOString() : null,
        isAdminEdited: true,
        isAbsent: isAbsent,
        ...(linkedClassStart ? { linkedClassStart } : {}),
        ...(classSectionKey && classIsReceptionist ? { linkedReceptionistShift: classSectionKey } : {})
    };

    if (selectedRoleId === 'tiep-tan') {
        newData.role = 'tiep-tan';
        newData.roleName = 'Tiếp Tân';
        
        const checkedRadio = document.querySelector('input[name="edit-shift-type"]:checked');
        const isFixed = (checkedRadio && checkedRadio.value === 'fixed');
        newData.isFixedShift = isFixed;
        if (isFixed) {
            try {
                const users = await DBService.getUsers();
                const user = users.find(u => u.id === staffId);
                if (user && user.salary_config) {
                    newData.roleRate = Number(user.salary_config.receptionist_fixed_rate || 0);
                }
            } catch (err) {
                console.warn("Failed to get fixed rate for receptionist:", err);
            }
        } else {
            newData.roleRate = Number(selectedRoleRate || 0);
        }
    } else if (selectedRoleId === 'giao-vien') {
        newData.isFixedShift = false;
        
        if (editSelectedSubjectIds.length === 0) {
            alert("Vui lòng chọn ít nhất một môn học!");
            return;
        }
        
        // Combine subjects
        const selectedSubjects = editSelectedSubjectIds.map(subId => {
            return allAvailableSubjects.find(s => s.id === subId);
        }).filter(Boolean);
        
        newData.role = selectedSubjects.map(s => s.id).join('+');
        newData.roleName = selectedSubjects.map(s => s.name).join(' + ');
        // Average rate
        const totalRate = selectedSubjects.reduce((sum, s) => sum + s.rate, 0);
        newData.roleRate = totalRate / selectedSubjects.length;
    } else {
        newData.isFixedShift = false;
        newData.role = null;
        newData.roleName = null;
        newData.roleRate = 0;
    }

    try {
        let finalSessionId = null;
        if (sessionIdRaw === 'NEW') {
            finalSessionId = await DBService.addSession(staffId, dateKey, newData);
            // Send notification to staff
            await DBService.createAdminNotification(
                staffId, staffName, 'add_session', dateKey,
                `Admin đã thêm ca làm việc mới: ${checkInStr} - ${checkOutStr}`
            );
            alert("Đã tạo ca làm việc mới!");
        } else {
            const parsedSessionId = isNaN(sessionIdRaw) ? sessionIdRaw : Number(sessionIdRaw);
            await DBService.updateSession(staffId, dateKey, parsedSessionId, newData);
            finalSessionId = parsedSessionId;
            // Send notification to staff
            await DBService.createAdminNotification(
                staffId, staffName, 'edit_session', dateKey,
                `Admin đã chỉnh sửa giờ làm: ${checkInStr} - ${checkOutStr}`
            );
            alert("Cập nhật thành công!");
        }

        // Save Overtime Minutes if modified (Admin Only)
        const otInput = document.getElementById('edit-overtime-minutes');
        const currentRoleRaw = localStorage.getItem('currentRole') || 'staff';
        let currentUserRoles = [];
        try {
            const _parsed = JSON.parse(currentRoleRaw);
            currentUserRoles = Array.isArray(_parsed) ? _parsed : [currentRoleRaw];
        } catch (e) {
            currentUserRoles = [currentRoleRaw];
        }
        const isAdminRole = window.currentUserContext && (window.currentUserContext.role === 'admin' || (window.currentUserContext.roles || []).includes('admin'));
        const isAdminViewer = isAdminRole || (currentUserRoles || []).includes('admin') || (currentUserRoles || []).includes('senior_assistant');
        
        if (otInput && finalSessionId && isAdminViewer) {
            const newOtMinutes = parseInt(otInput.value, 10) || 0;
            await DBService.saveAdminOvertimeConfig(staffId, staffName, dateKey, finalSessionId, newOtMinutes);
        }

        closeEditModal();
        _cachedStaffId = null; // Force re-fetch from Firestore after edit
        renderMonthReport(currentDate, true); // true = bypass Firestore cache
    } catch (e) {
        alert("Lỗi: " + e.message);
    }
}

// Modal approval helper functions
window.modalApproveBonus10 = async function(requestId, sessionId, dateKey, staffId) {
    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang duyệt...');
        const adminName = localStorage.getItem('currentUserName') || 'Admin';
        await DBService.approveBonus10Request(requestId, adminName, staffId, dateKey, sessionId);
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast("Đã duyệt thưởng 10p!", "success");
        }
        closeEditModal();
        renderMonthReport(currentDate);
    } catch (e) {
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast(e.message || 'Lỗi', 'error');
        }
    }
};

window.modalRejectBonus10 = async function(requestId) {
    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang từ chối...');
        const adminName = localStorage.getItem('currentUserName') || 'Admin';
        await DBService.rejectBonus10Request(requestId, adminName);
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast("Đã từ chối thưởng 10p!", "success");
        }
        closeEditModal();
        renderMonthReport(currentDate);
    } catch (e) {
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast(e.message || 'Lỗi', 'error');
        }
    }
};

window.modalCancelApprovedBonus10 = async function(requestId, staffId, dateKey, sessionId) {
    try {
        if (!confirm("Bạn có muốn hủy duyệt thưởng 10p cho ca này không?")) return;
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang hủy...');
        await DBService.cancelApprovedBonus10(requestId, staffId, dateKey, sessionId);
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast("Đã hủy duyệt thưởng 10p!", "success");
        }
        closeEditModal();
        renderMonthReport(currentDate);
    } catch (e) {
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast(e.message || 'Lỗi', 'error');
        }
    }
};

window.modalSubmitBonus10Request = async function(sessionId, dateKey, staffId) {
    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang gửi yêu cầu...');
        const staffName = getTargetStaffName();
        await DBService.createBonus10Request(staffId, staffName, dateKey, sessionId);
        const snap = await db.collection('bonus10_requests')
            .where('sessionId', '==', sessionId)
            .where('staffId', '==', staffId)
            .where('dateKey', '==', dateKey)
            .get();
        if (!snap.empty) {
            const reqId = snap.docs[0].id;
            const adminName = localStorage.getItem('currentUserName') || 'Admin';
            await DBService.approveBonus10Request(reqId, adminName, staffId, dateKey, sessionId);
        }
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast("Đã tặng thưởng 10p thành công!", "success");
        }
        closeEditModal();
        renderMonthReport(currentDate);
    } catch (e) {
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast(e.message || 'Lỗi', 'error');
        }
    }
};

window.modalApproveOvertime = async function(requestId) {
    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang duyệt...');
        const adminName = localStorage.getItem('currentUserName') || 'Admin';
        await DBService.approveOvertimeRequest(requestId, adminName);
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast("Đã duyệt tăng ca!", "success");
        }
        closeEditModal();
        renderMonthReport(currentDate);
    } catch (e) {
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast(e.message || 'Lỗi', 'error');
        }
    }
};

window.modalRejectOvertime = async function(requestId) {
    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang từ chối...');
        const adminName = localStorage.getItem('currentUserName') || 'Admin';
        await DBService.rejectOvertimeRequest(requestId, adminName);
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast("Đã từ chối tăng ca!", "success");
        }
        closeEditModal();
        renderMonthReport(currentDate);
    } catch (e) {
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast(e.message || 'Lỗi', 'error');
        }
    }
};

window.modalCancelApprovedOvertime = async function(requestId, staffId, dateKey, sessionId) {
    try {
        if (!confirm("Bạn có muốn hủy duyệt tăng ca cho ca này không?")) return;
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang hủy...');
        if (requestId) {
            await db.collection('overtime_requests').doc(requestId).delete();
        }
        await DBService.saveAdminOvertimeConfig(staffId, '', dateKey, sessionId, 0);
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast("Đã hủy duyệt tăng ca!", "success");
        }
        closeEditModal();
        renderMonthReport(currentDate);
    } catch (e) {
        if (typeof UIService !== 'undefined') {
            UIService.hideLoading();
            UIService.toast(e.message || 'Lỗi', 'error');
        }
    }
};

window.modalStudentCountAction = async function(action, dateKey, sessionId) {
    const staffId = getTargetStaffId();
    if (!staffId || !dateKey || !sessionId) return;
    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang xử lý...');
        const adminName = localStorage.getItem('currentUserName') || 'Admin';

        if (action === 'approve') {
            const chip = window.allMonthChips.find(c => String(c.sessionId) === String(sessionId));
            const count = chip ? chip.studentCount : 10;
            await DBService.reviewStudentCountReport(staffId, dateKey, sessionId, count, 'approved', adminName);
            if (typeof UIService !== 'undefined') UIService.toast('Đã duyệt sĩ số!', 'success');
        } else if (action === 'reject') {
            const chip = window.allMonthChips.find(c => String(c.sessionId) === String(sessionId));
            const count = chip ? chip.studentCount : 10;
            await DBService.reviewStudentCountReport(staffId, dateKey, sessionId, count, 'rejected', adminName);
            if (typeof UIService !== 'undefined') UIService.toast('Đã từ chối sĩ số (phạt cả tháng)!', 'error');
        } else if (action === 'delete') {
            await DBService.clearStudentCountReport(staffId, dateKey, sessionId);
            if (typeof UIService !== 'undefined') UIService.toast('Đã xóa sĩ số khai báo!', 'success');
        }
        
        closeEditModal();
        renderMonthReport(currentDate);
    } catch (e) {
        if (typeof UIService !== 'undefined') UIService.toast(e.message || 'Lỗi xử lý.', 'error');
    } finally {
        if (typeof UIService !== 'undefined') UIService.hideLoading();
    }
};

async function deleteSessionFromModal() {
    // Remove confirmation popup as requested by user
    // if (!confirm("Bạn có chắc chắn muốn xóa phiên làm việc này không? Ca làm việc sẽ bị xóa hoàn toàn khỏi bảng.")) return;

    const staffId = getTargetStaffId();
    const staffName = getTargetStaffName();
    const dateKey = document.getElementById('edit-date-key').value;
    const sessionId = document.getElementById('edit-session-id').value;
    const parsedSessionId = isNaN(sessionId) ? sessionId : Number(sessionId);

    // Class unregistration metadata
    const classCompositeKey = document.getElementById('edit-class-composite-key').value;
    const classSectionKey = document.getElementById('edit-class-section-key').value;
    const classIndexRaw = document.getElementById('edit-class-index').value;
    const isReceptionistStr = document.getElementById('edit-class-is-receptionist').value;

    try {
        console.log("[DeleteSession] Starting deletion process...");
        console.log("[DeleteSession] Values:", { staffId, dateKey, sessionId, classCompositeKey, classSectionKey, classIndexRaw, isReceptionistStr });

        // Only attempt to delete an attendance session if one actually exists
        if (sessionId && sessionId !== 'NEW' && String(sessionId) !== 'null') {
            console.log("[DeleteSession] Deleting attendance session:", parsedSessionId);
            await DBService.deleteSession(staffId, dateKey, parsedSessionId);
        }

        // Unregister from class if linked
        if (classCompositeKey && classSectionKey && classIndexRaw !== '') {
            console.log("[DeleteSession] Unregistering from class...");
            const monthStr = dateKey.substring(0, 7);
            const cancelKey = `${classCompositeKey}_${classSectionKey}_${classIndexRaw}`;

            // 1. Ghi log huỷ ca vào DBService (BƯỚC QUAN TRỌNG NHẤT)
            await DBService.cancelShift(monthStr, staffId, cancelKey);

            if (isReceptionistStr === 'true') {
                // Delete from receptionist schedule
                await DBService.unassignReceptionist(classCompositeKey, classSectionKey, classIndexRaw, staffId);
            } else {
                // Delete from teaching schedule
                const classIndex = Number(classIndexRaw);
                const branch = classCompositeKey.split('_')[0];
                const mockUser = {
                    id: staffId,
                    name: staffName,
                    uid: staffId,
                    displayName: staffName
                };
                const rowMeta = {
                    branch: branch,
                    section: classSectionKey,
                    index: classIndex
                };
                await DBService.registerClass(classCompositeKey, classSectionKey, rowMeta, mockUser);
            }
        }

        // Send notification to staff
        await DBService.createAdminNotification(
            staffId, staffName, 'delete_session', dateKey,
            `Admin đã xóa một ca làm việc ngày ${dateKey}`
        );
        alert("Đã xóa hoàn toàn!");
        closeEditModal();
        _cachedStaffId = null; // Force re-fetch from Firestore
        renderMonthReport(currentDate, true); // true = bypass Firestore cache
        localStorage.setItem('schedule_registration_updated', Date.now().toString());
    } catch (e) {
        alert("Lỗi xóa: " + e.message);
    }
}

// ================= DEBUG HELPER (TEMPORARY) =================
async function renderDebugInfo(staffId, year, month) {
    const debugContainer = document.getElementById('debug-container') || document.createElement('div');
    debugContainer.id = 'debug-container';
    debugContainer.style.background = '#000';
    debugContainer.style.color = '#0f0';
    debugContainer.style.padding = '10px';
    debugContainer.style.margin = '10px 0';
    debugContainer.style.fontFamily = 'monospace';
    debugContainer.style.fontSize = '12px';
    debugContainer.style.whiteSpace = 'pre-wrap';

    // Insert after title
    const title = document.getElementById('page-title');
    if (title && !document.getElementById('debug-container')) {
        title.parentNode.insertBefore(debugContainer, title.nextSibling);
    }

    debugContainer.innerText = `🔄 DEBUGGING...\nUserID: ${staffId}\nMonth: ${year}-${month + 1}`;

    try {
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
        const records = await DBService.getMonthlyAttendance(monthStr, staffId);

        let msg = `✅ DATA FETCHED: ${records.length} records found.\n`;
        records.forEach(r => {
            msg += `Date: ${r.date} | Sessions: ${r.sessions ? r.sessions.length : 0} | CheckIn: ${r.checkIn || 'N/A'}\n`;
            if (r.sessions) {
                r.sessions.forEach((s, i) => {
                    msg += `   [${i}] ID: ${s.id} (${typeof s.id}) | Start: ${s.start} | Out: ${s.checkOut}\n`;
                });
            }
        });

        // Check specific date Feb 1
        const feb1 = records.find(r => r.date === '2026-02-01');
        if (!feb1) msg += `⚠️ WARNING: No record found for 2026-02-01 in query results!\n`;
        else msg += `✅ FEB 1 RECORD FOUND. Check Logic.\n`;

        debugContainer.innerText += '\n' + msg;
    } catch (e) {
        debugContainer.innerText += `\n❌ ERROR: ${e.message}\n${e.stack}`;
        debugContainer.style.color = 'red';
    }
}
// ================= ROLE SELECTION LOGIC =================
async function openRoleSelectModal(dateKey, session) {
    const staffId = getTargetStaffId();
    console.log("[RoleSelect] Looking up staffId:", staffId);

    let user = null;
    try {
        const users = await DBService.getUsers();
        user = users.find(u => u.id === staffId);
    } catch (e) {
        console.error("[RoleSelect] Error fetching users:", e);
    }

    if (!user) {
        alert(`Không tìm thấy nhân viên. [staffId: ${staffId}]`);
        return;
    }

    const userRolesArr = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : (user.role ? [user.role] : []);
    const hasReceptionistRole = userRolesArr.some(r => ['receptionist', 'receptionist_assistant'].includes(r));
    const hasTeachingRole = userRolesArr.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
    const teachingRoles = (user.salary_config && user.salary_config.roles) ? user.salary_config.roles : [];

    // Kiểm tra có ít nhất 1 option để chọn
    if (!hasReceptionistRole && teachingRoles.length === 0) {
        // Suppress alert silently for teachers as they calculate by subject
        return;
    }

    document.getElementById('role-select-date').value = dateKey;
    document.getElementById('role-select-session').value = session.id;

    const container = document.getElementById('role-options-container');
    container.innerHTML = '';

    // Thêm option Tiếp Tân
    if (hasReceptionistRole) {
        const cfg = user.salary_config || {};
        const recRate = cfg.receptionist_normal_rate || 0;
        const recRole = { id: 'tiep-tan', name: 'Tiếp Tân', rate: recRate, isReceptionist: true };

        const btn = document.createElement('div');
        btn.style.padding = '1rem';
        btn.style.border = '2px solid #DBEAFE';
        btn.style.borderRadius = 'var(--radius-md)';
        btn.style.cursor = 'pointer';
        btn.style.background = '#EFF6FF';
        btn.style.transition = '0.2s';
        btn.innerHTML = `<strong>💼 Tiếp Tân</strong> <span style="float:right; color:#1E40AF">${new Intl.NumberFormat('vi-VN').format(recRate)}đ/h</span>`;

        btn.onmouseover = () => { btn.style.background = '#DBEAFE'; btn.style.borderColor = '#3B82F6'; };
        btn.onmouseout = () => { btn.style.background = '#EFF6FF'; btn.style.borderColor = '#DBEAFE'; };
        btn.onclick = () => selectRoleForSession(recRole);
        container.appendChild(btn);
    }

    // Thêm các môn học (chỉ hiện nếu có role dạy)
    if (hasTeachingRole) {
        if (teachingRoles.length === 0 && !hasReceptionistRole) {
            const emptyDiv = document.createElement('div');
            emptyDiv.style.cssText = 'padding:0.75rem;color:var(--text-muted);text-align:center;font-size:0.9rem;';
            emptyDiv.textContent = 'Chưa có môn học nào. Hãy cài đặt lương trong trang Nhân Sự.';
            container.appendChild(emptyDiv);
        } else {
            if (hasReceptionistRole && teachingRoles.length > 0) {
                const sep = document.createElement('div');
                sep.style.cssText = 'font-size:0.78rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;margin-top:0.5rem;margin-bottom:0.25rem;';
                sep.textContent = 'Môn Học (Dạy):'
                container.appendChild(sep);
            }
            teachingRoles.forEach(role => {
                const btn = document.createElement('div');
                btn.style.padding = '1rem';
                btn.style.border = '1px solid var(--border-color)';
                btn.style.borderRadius = 'var(--radius-md)';
                btn.style.cursor = 'pointer';
                btn.style.background = '#F9FAFB';
                btn.style.transition = '0.2s';
                btn.innerHTML = `<strong>${role.name}</strong> <span style="float:right; color:green">${new Intl.NumberFormat('vi-VN').format(role.rate)}đ/h</span>`;

                btn.onmouseover = () => { btn.style.background = '#D1FAE5'; btn.style.borderColor = 'var(--primary-color)'; };
                btn.onmouseout = () => { btn.style.background = '#F9FAFB'; btn.style.borderColor = 'var(--border-color)'; };
                btn.onclick = () => selectRoleForSession(role);
                container.appendChild(btn);
            });
        }
    }

    document.getElementById('role-select-modal').style.display = 'flex';
}

function closeRoleSelectModal() {
    document.getElementById('role-select-modal').style.display = 'none';
}

async function selectRoleForSession(role) {
    const staffId = getTargetStaffId();
    const staffName = getTargetStaffName();
    const dateKey = document.getElementById('role-select-date').value;
    const sessionId = document.getElementById('role-select-session').value;

    try {
        await DBService.updateSessionRole(staffId, dateKey, sessionId, role);
        // Send notification to staff
        await DBService.createAdminNotification(
            staffId, staffName, 'select_role', dateKey,
            `Admin đã chọn vai trò "${role.name}" cho ca ngày ${dateKey}`
        );
        closeRoleSelectModal();
        renderMonthReport(new Date(dateKey));
    } catch (e) {
        alert("Lỗi lưu vai trò: " + e.message);
    }
}

// removeVietnameseTones() → Moved to evaluation-service.js

// ================= OVERTIME MODAL =================

function openOvertimeModal(dateKey, sessionId, sessionData) {
    const modal = document.getElementById('overtime-modal');
    if (!modal) return;

    document.getElementById('overtime-date-key').value = dateKey;
    document.getElementById('overtime-session-id').value = sessionId;
    // Reset spinners to default (0h 30m)
    const hoursEl = document.getElementById('overtime-hours');
    const minsEl = document.getElementById('overtime-minutes');
    if (hoursEl) hoursEl.value = '0';
    if (minsEl) minsEl.value = '30';

    const start = sessionData ? new Date(sessionData.checkIn || sessionData.start) : null;
    const end = sessionData && sessionData.checkOut ? new Date(sessionData.checkOut) : null;
    const startStr = start ? start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';
    const endStr = end ? end.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';

    const infoEl = document.getElementById('overtime-session-info');
    if (infoEl) infoEl.innerText = `Ca: ${dateKey} | ${startStr} – ${endStr}`;

    modal.style.display = 'flex';
    if (hoursEl) setTimeout(() => hoursEl.focus(), 100);
}

function closeOvertimeModal() {
    const modal = document.getElementById('overtime-modal');
    if (modal) modal.style.display = 'none';
}

async function submitOvertimeRequest() {
    const dateKey = document.getElementById('overtime-date-key').value;
    const sessionId = document.getElementById('overtime-session-id').value;

    // Read from the two number spinners
    const hours = parseInt(document.getElementById('overtime-hours').value || '0', 10);
    const mins = parseInt(document.getElementById('overtime-minutes').value || '0', 10);

    if (hours === 0 && mins === 0) {
        alert('Vui lòng nhập số giờ/phút tăng ca lớn hơn 0.');
        return;
    }

    // Build "HH:MM" string
    const duration = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

    const staffId = getTargetStaffId();
    const staffName = localStorage.getItem('currentUserName') || localStorage.getItem('currentUser') || 'N/A';

    try {
        await DBService.createOvertimeRequest(staffId, staffName, dateKey, sessionId, duration);
        alert('Đã gửi yêu cầu tăng ca! Admin sẽ xem xét và xác nhận.');
        closeOvertimeModal();
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch (e) {
        alert('Lỗi: ' + e.message);
    }
}

// ================= BONUS 10P UI FUNCTIONS =================

async function submitBonus10Request(sessionId, dateKey, staffId) {
    const confirmed = await UIService.confirm('Gửi yêu cầu thưởng 10p vào sớm cho ca này?');
    if (!confirmed) return;

    const staffName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'N/A';
    try {
        await DBService.createBonus10Request(staffId, staffName, dateKey, sessionId);
        UIService.toast('Đã gửi yêu cầu! Admin sẽ xem xét và duyệt.', 'success');
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch (e) {
        UIService.toast('Lỗi: ' + e.message, 'error');
    }
}

async function approveBonus10(requestId, sessionId, dateKey, staffId) {
    const confirmed = await UIService.confirm('Duyệt thưởng 10p cho ca này?');
    if (!confirmed) return;

    const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';
    try {
        await DBService.approveBonus10Request(requestId, adminName, staffId, dateKey, sessionId);
        UIService.toast('Đã duyệt thưởng 10p!', 'success');
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch (e) {
        UIService.toast('Lỗi: ' + e.message, 'error');
    }
}

async function approveAllBonus10() {
    const staffId = getTargetStaffId();
    if (!staffId) return;

    const confirmed = await UIService.confirm('Duyệt TẤT CẢ yêu cầu Sớm 10p đang chờ trong tháng này?');
    if (!confirmed) return;

    const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';

    try {
        const monthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        const pendingList = await DBService.getBonus10RequestsForStaff(staffId, monthStr);
        const pending = pendingList.filter(r => r.status === 'pending');

        if (pending.length === 0) {
            UIService.toast('Không có yêu cầu nào đang chờ duyệt.', 'info');
            return;
        }

        // Approve all in parallel
        await Promise.all(pending.map(req =>
            DBService.approveBonus10Request(req.id, adminName, req.staffId, req.dateKey, req.sessionId)
        ));

        UIService.toast(`Đã duyệt ${pending.length} yêu cầu Sớm 10p!`, 'success');
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch (e) {
        UIService.toast('Lỗi: ' + e.message, 'error');
    }
}

async function approveSelectedBonus10() {
    const checkboxes = document.querySelectorAll('.bonus10-pending-cb:checked');
    if (checkboxes.length === 0) {
        UIService.toast('Chưa chọn ca nào!', 'warning');
        return;
    }

    const confirmed = await UIService.confirm(`Duyệt ${checkboxes.length} ca Sớm 10p đã chọn?`);
    if (!confirmed) return;

    const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';

    try {
        await Promise.all([...checkboxes].map(cb =>
            DBService.approveBonus10Request(
                cb.dataset.bonus10Id,
                adminName,
                cb.dataset.staffId,
                cb.dataset.dateStr,
                cb.dataset.sessionId
            )
        ));
        UIService.toast(`Đã duyệt ${checkboxes.length} ca!`, 'success');
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch (e) {
        UIService.toast('Lỗi: ' + e.message, 'error');
    }
}

// TEMP CLEANUP — chạy 1 lần rồi xóa
window._cleanupBonus10ForStaff = async function (staffId) {
    if (!staffId) { console.error('Cần staffId'); return; }
    try {
        const snap = await db.collection('bonus10_requests')
            .where('staffId', '==', staffId).get();
        if (snap.empty) { console.log('Không có data nào'); return; }
        const batch = db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log(`Đã xóa ${snap.size} records của staffId: ${staffId}`);
    } catch (e) { console.error('Lỗi:', e); }
};

// DEDUPLICATE — Xóa bản ghi bonus10 pending bị trùng, chỉ giữ lại 1 bản per (staffId, dateKey, sessionId)
// Chạy từ console: window._deduplicateBonus10Requests()
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
            if (seen.has(key)) {
                toDelete.push(doc.ref); // bản trùng → đánh dấu xóa
            } else {
                seen.set(key, doc.id); // giữ bản đầu tiên
            }
        });

        if (toDelete.length === 0) {
            console.log('[Dedup] ✅ Không có bản ghi trùng nào. Dữ liệu đã sạch!');
            return;
        }

        console.log(`[Dedup] Tìm thấy ${toDelete.length} bản ghi duplicate. Đang xóa...`);
        const batch = db.batch();
        toDelete.forEach(ref => batch.delete(ref));
        await batch.commit();
        console.log(`[Dedup] ✅ Đã xóa ${toDelete.length} bản ghi trùng lặp thành công!`);
    } catch (e) {
        console.error('[Dedup] ❌ Lỗi:', e);
    }
};

// ================= CLASS/SHIFT SPECIFIC WAGE CONFIGURATION MODAL =================

// ================= CLASS/SHIFT SPECIFIC WAGE CONFIGURATION MODAL =================

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

function isStudentCountBonusRow(name) {
    if (!name) return false;
    return name.includes('(+') && name.includes('HS)');
}

function classifyAbsentChip(chip, notesMap) {
    if (chip.isCancelled) {
        return 'VP';
    }
    const dateStr = chip.dateStr;
    const noteText = (notesMap[dateStr] || '').toLowerCase().trim();
    if (chip.isVDX || noteText.includes('đột xuất') || noteText.includes('vdx') || noteText.includes('đx')) {
        return 'VDX';
    }
    if (noteText.includes('phép') || noteText.includes('vp') || noteText.includes(' p ') || noteText.endsWith(' p') || noteText.startsWith('p ')) {
        return 'VP';
    }
    return 'VKP';
}

function bindMoneyInputFormatters() {
    const moneyInputs = document.querySelectorAll('.money-input');
    moneyInputs.forEach(input => {
        input.removeEventListener('input', handleMoneyInput);
        input.addEventListener('input', handleMoneyInput);
    });
}

function handleMoneyInput(e) {
    let cursorPosition = this.selectionStart;
    let originalLength = this.value.length;
    
    let rawVal = this.value;
    let clean = rawVal.replace(/[^0-9-]/g, '');
    let formatted = formatNumberWithCommas(clean);
    this.value = formatted;
    
    let newLength = formatted.length;
    let newCursor = cursorPosition + (newLength - originalLength);
    this.setSelectionRange(newCursor, newCursor);
    
    const isInModal = this.closest('#class-rate-modal') !== null;
    if (isInModal) {
        recalculateSalaryModal();
    } else {
        const user = window.currentUserContext;
        let hasReceptionist = false;
        let hasTeaching = false;
        if (user) {
            const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
            hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
            hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
        }
        const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
        const activeFilter = (filterVal === 'tiep-tan') || (filterVal === 'all' && hasReceptionist && !hasTeaching) ? 'tiep-tan' : 'giao-vien';

        if (!window.currentMonthlySalarySettingsAll) window.currentMonthlySalarySettingsAll = {};
        let ttSettings = window.currentMonthlySalarySettingsAll['tiep_tan'] || window.currentMonthlySalarySettingsAll['tiep-tan'];
        if (!ttSettings) {
            ttSettings = { evaluation: [] };
            window.currentMonthlySalarySettingsAll['tiep_tan'] = ttSettings;
        }
        if (!ttSettings.evaluation) ttSettings.evaluation = [];

        if (this.id === 'pdf-phi-tu-van' || this.id === 'pdf-doanh-thu-cs3') {
            const val = parseFormattedNumber(formatted);
            const critId = this.id === 'pdf-phi-tu-van' ? 1 : 6;
            
            // Only update DOM if receptionist table is active
            if (activeFilter === 'tiep-tan') {
                const evalAmt = document.querySelector(`.eval-amount[data-index="${critId}"]`);
                if (evalAmt) {
                    evalAmt.value = formatted;
                }
            }
            
            let found = ttSettings.evaluation.find(e => e.id === critId);
            if (found) {
                found.amount = val;
            } else {
                ttSettings.evaluation.push({ id: critId, amount: val, note: '' });
            }
            
            // Sync with window.currentLoadedSalarySettings if tiep-tan is active
            if (activeFilter === 'tiep-tan') {
                window.currentLoadedSalarySettings = ttSettings;
            }
        }
        
        calculateSalary();
    }
}

function getPerformanceFactorByRate(rate) {
    const kRate = rate > 1000 ? rate / 1000 : rate;
    if (kRate < 22) return 0.0;
    if (kRate <= 22) return 1.0;
    if (kRate <= 25) return 1.1;
    if (kRate <= 27) return 1.2;
    if (kRate <= 30) return 1.3;
    return 1.4;
}

function getRecepDynamicFixedFactor(chips) {
    let workedMinutes = 0;
    let absentMinutes = 0;
    
    (chips || []).forEach(chip => {
        const isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
        if (!isTiepTan) return;
        if (chip.class === 'chip-future' || chip.isCenterOff) return;
        
        if (chip.mergedSegments && chip.mergedSegments.length > 0) {
            chip.mergedSegments.forEach(seg => {
                if (!seg.isFixedShift) return;
                const segMins = seg.schedMinutes || 0;
                if (chip.class === 'chip-gray' || chip.class === 'chip-red' || chip.isVDX) {
                    absentMinutes += segMins;
                } else {
                    workedMinutes += segMins;
                }
            });
        } else {
            // Check if it's a fixed shift
            const isFixed = chip.isFixedShift || (window.savedFixedShiftsMonth && window.savedFixedShiftsMonth.includes(chip.sessionId));
            if (!isFixed) return;
            
            let chipMinutes = 0;
            if (chip.schedData && chip.schedData.start && chip.schedData.end) {
                const [sH, sM] = chip.schedData.start.split(':').map(Number);
                const [eH, eM] = chip.schedData.end.split(':').map(Number);
                chipMinutes = (eH * 60 + eM) - (sH * 60 + sM);
            } else {
                chipMinutes = chip.paidMinutes || 0;
            }

            if (chip.class === 'chip-gray' || chip.class === 'chip-red' || chip.isVDX) {
                absentMinutes += chipMinutes;
            } else {
                workedMinutes += chipMinutes;
            }
        }
    });

    const workedHours = workedMinutes / 60;
    const absentHours = absentMinutes / 60;
    const totalHours = workedHours + absentHours;
    
    if (totalHours <= 0) return 1.5;
    const ratio = absentHours / totalHours;
    if (ratio <= 0.1) {
        return 1.5;
    } else {
        return Math.max(0, 1.5 - ((ratio - 0.1) * 5));
    }
}

async function openClassRateModal() {
    const staffId = getTargetStaffId();
    if (!staffId || staffId === 'all') {
        alert("Vui lòng chọn nhân viên để tính lương!");
        return;
    }

    const user = window.currentUserContext;
    if (!user) {
        alert("Chưa tải được dữ liệu nhân viên. Vui lòng thử lại.");
        return;
    }

    // Determine actual worked/scheduled roles based on month chips
    let receptionistShiftCount = 0;
    let teachingShiftCount = 0;
    (window.unfilteredAllMonthChips || []).forEach(chip => {
        if (chip.class === 'chip-future' || chip.isCenterOff) return;
        const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
        if (isTT) receptionistShiftCount++;
        else teachingShiftCount++;
    });

    const staffRoles = user
        ? (Array.isArray(user.roles) && user.roles.length > 0
            ? user.roles
            : [user.role || ''])
        : [];
        
    const cfg = user.salary_config || {};
    const hasTeachingConfig = (cfg.roles && cfg.roles.length > 0) || (Number(cfg.rate) > 0);
    const hasReceptionistConfig = (Number(cfg.receptionist_normal_rate) > 0) || (Number(cfg.receptionist_fixed_rate) > 0);
        
    let hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff', 'giao-vien', 'teacher', 'gv', 'tro-giang'].includes(r)) || teachingShiftCount > 0 || hasTeachingConfig;
    let hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'tiep-tan', 'tiep_tan', 'receptionist_lead', 'receptionist_staff'].includes(r)) || receptionistShiftCount > 0 || hasReceptionistConfig;
    
    const roleToggle = document.getElementById('modal-role-toggle-container');
    if (hasTeaching && hasReceptionist) {
        if (roleToggle) roleToggle.style.display = 'flex';
        
        // Default based on actual shifts worked
        if (receptionistShiftCount > 0 && teachingShiftCount === 0) {
            window.modalActiveRole = 'tiep-tan';
        } else if (teachingShiftCount > 0 && receptionistShiftCount === 0) {
            window.modalActiveRole = 'giao-vien';
        } else if (receptionistShiftCount > 0 && teachingShiftCount > 0) {
            window.modalActiveRole = teachingShiftCount >= receptionistShiftCount ? 'giao-vien' : 'tiep-tan';
        } else {
            window.modalActiveRole = 'giao-vien';
        }
        
        const btnGv = document.getElementById('btn-modal-role-gv');
        const btnTt = document.getElementById('btn-modal-role-tt');
        if (btnGv && btnTt) {
            if (window.modalActiveRole === 'giao-vien') {
                btnGv.style.background = '#4338CA';
                btnGv.style.color = 'white';
                btnTt.style.background = 'white';
                btnTt.style.color = '#374151';
                btnTt.style.border = '1px solid #D1D5DB';
            } else {
                btnTt.style.background = '#4338CA';
                btnTt.style.color = 'white';
                btnGv.style.background = 'white';
                btnGv.style.color = '#374151';
                btnGv.style.border = '1px solid #D1D5DB';
            }
        }
    } else {
        if (roleToggle) roleToggle.style.display = 'none';
        window.modalActiveRole = hasReceptionist ? 'tiep-tan' : 'giao-vien';
    }

    // Default to tab 'current'
    await switchSalaryModalTab('current');
    
    const modal = document.getElementById('class-rate-modal');
    if (modal) modal.style.display = 'flex';
}

function closeClassRateModal() {
    const modal = document.getElementById('class-rate-modal');
    if (modal) modal.style.display = 'none';
}

async function populateModalCurrentTab() {
    const staffId = getTargetStaffId();
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    let monthlySettingsAll = window.currentMonthlySalarySettingsAll || {};
    let meetingsLog = null;
    try {
        meetingsLog = await DBService.getMonthlyMeetings(monthStr);
    } catch (err) {
        console.error("Error fetching monthly meetings:", err);
    }

    if (!monthlySettingsAll || Object.keys(monthlySettingsAll).length === 0) {
        try {
            monthlySettingsAll = await DBService.getMonthlySalarySettings(staffId, monthStr) || {};
        } catch (err) {
            console.error("Error fetching monthly salary settings:", err);
            monthlySettingsAll = {};
        }
    }

    // Fallback to general settings if missing in monthlySettingsAll
    const user = window.currentUserContext || {};
    const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
    const hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
    const hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
    
    let gvSettings = monthlySettingsAll['giao_vien'] || monthlySettingsAll['giao-vien'];
    let ttSettings = monthlySettingsAll['tiep_tan'] || monthlySettingsAll['tiep-tan'];
    
    if (hasTeaching && !gvSettings) {
        gvSettings = await DBService.getSalarySettings(staffId) || {};
        monthlySettingsAll['giao_vien'] = gvSettings;
    }
    if (hasReceptionist && !ttSettings) {
        ttSettings = await DBService.getSalarySettings(staffId) || {};
        if (!ttSettings.evaluation) {
            ttSettings.evaluation = [];
        }
        monthlySettingsAll['tiep_tan'] = ttSettings;
    }

    // Keep cache updated
    window.currentMonthlySalarySettingsAll = monthlySettingsAll;
    
    const activeRoleKey = window.modalActiveRole === 'tiep-tan' ? 'tiep_tan' : 'giao_vien';
    const roleSettings = monthlySettingsAll[activeRoleKey] || {};
    
    // 1. Calculate Attendance Stats
    let workedShifts = 0;
    let vpShifts = 0;
    let vdxShifts = 0;
    let vkpShifts = 0;
    let lateCount = 0;
    let totalLateMinutes = 0;
    let grandTotalMinutes = 0; // High-scope to access in evaluations auto-fill
    
    (window.unfilteredAllMonthChips || []).forEach(chip => {
        if (chip.class === 'chip-future' || chip.isCenterOff) return;
        
        const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
        if (window.modalActiveRole === 'tiep-tan' && !isTT) return;
        if (window.modalActiveRole === 'giao-vien' && isTT) return;
        
        if (chip.class === 'chip-gray' || chip.isVDX || chip.class === 'chip-red') {
            const type = classifyAbsentChip(chip, _cachedStaffNotes);
            if (type === 'VP') vpShifts++;
            else if (type === 'VDX') vdxShifts++;
            else vkpShifts++;
        } else {
            workedShifts++;
        }
        
        const match = chip.text.match(/\(T(\d+)p\)/);
        if (match) {
            lateCount++;
            totalLateMinutes += parseInt(match[1], 10);
        }
    });
    
    const statWorked = document.getElementById('modal-stat-worked-shifts');
    const statVp = document.getElementById('modal-stat-vp-shifts');
    const statVdx = document.getElementById('modal-stat-vdx-shifts');
    const statVkp = document.getElementById('modal-stat-vkp-shifts');
    const statLate = document.getElementById('modal-stat-late-shifts');
    
    if (statWorked) statWorked.innerText = `${workedShifts} ca`;
    if (statVp) statVp.innerText = `${vpShifts} ca`;
    if (statVdx) statVdx.innerText = `${vdxShifts} ca`;
    if (statVkp) statVkp.innerText = `${vkpShifts} ca`;
    if (statLate) statLate.innerText = `${lateCount} lần (${totalLateMinutes} phút)`;
    
    const adjustVdxInp = document.getElementById('modal-adjust-vdx');
    const adjustVkpInp = document.getElementById('modal-adjust-vkp');
    const adjustLateInp = document.getElementById('modal-adjust-late');
    
    if (adjustVdxInp) adjustVdxInp.value = formatNumberWithCommas(roleSettings.adjust_vdx !== undefined ? roleSettings.adjust_vdx : 0);
    if (adjustVkpInp) adjustVkpInp.value = formatNumberWithCommas(roleSettings.adjust_vkp !== undefined ? roleSettings.adjust_vkp : 0);
    if (adjustLateInp) adjustLateInp.value = formatNumberWithCommas(roleSettings.adjust_late !== undefined ? roleSettings.adjust_late : 0);
    
    // 2. Populate Class Rates Table
    const cfg = user.salary_config || {};
    const classRates = roleSettings.class_rates || cfg.class_rates || {};
    
    const groups = {};
    (window.unfilteredAllMonthChips || []).forEach(chip => {
        const name = chip.chipFilterName;
        if (!name) return;
        
        const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
        if (window.modalActiveRole === 'tiep-tan' && !isTT) return;
        if (window.modalActiveRole === 'giao-vien' && isTT) return;
        
        if (window.modalActiveRole === 'tiep-tan') {
            if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                let remainingMinutes = chip.paidMinutes || 0;
                const totalSched = chip.mergedSegments.reduce((sum, seg) => sum + (seg.schedMinutes || 0), 0);
                chip.mergedSegments.forEach((seg, sIdx) => {
                    const groupName = seg.isFixedShift ? "Tiếp Tân (Ca Cố Định)" : "Tiếp Tân (Ca Bình Thường)";
                    let segMins = 0;
                    if (totalSched <= 0) {
                        segMins = sIdx === chip.mergedSegments.length - 1 ? remainingMinutes : Math.round((chip.paidMinutes || 0) / chip.mergedSegments.length);
                    } else {
                        segMins = Math.round(((seg.schedMinutes || 0) / totalSched) * (chip.paidMinutes || 0));
                        if (sIdx === chip.mergedSegments.length - 1) {
                            segMins = remainingMinutes;
                        } else {
                            remainingMinutes -= segMins;
                        }
                    }
                    if (!groups[groupName]) {
                        groups[groupName] = {
                            name: groupName,
                            chips: [],
                            totalMinutes: 0
                        };
                    }
                    groups[groupName].chips.push(chip);
                    groups[groupName].totalMinutes += segMins;
                });
            } else {
                const groupName = chip.isFixedShift ? "Tiếp Tân (Ca Cố Định)" : "Tiếp Tân (Ca Bình Thường)";
                const mins = chip.paidMinutes || 0;
                if (!groups[groupName]) {
                    groups[groupName] = {
                        name: groupName,
                        chips: [],
                        totalMinutes: 0
                    };
                }
                groups[groupName].chips.push(chip);
                groups[groupName].totalMinutes += mins;
            }
        } else {
            if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                let remainingMinutes = chip.paidMinutes || 0;
                const totalSched = chip.mergedSegments.reduce((sum, seg) => sum + (seg.schedMinutes || 0), 0);
                
                chip.mergedSegments.forEach((seg, sIdx) => {
                    let segMins = 0;
                    if (totalSched <= 0) {
                        segMins = sIdx === chip.mergedSegments.length - 1 ? remainingMinutes : Math.round((chip.paidMinutes || 0) / chip.mergedSegments.length);
                    } else {
                        if (sIdx === chip.mergedSegments.length - 1) {
                            segMins = remainingMinutes;
                        } else {
                            segMins = Math.round((chip.paidMinutes || 0) * ((seg.schedMinutes || 0) / totalSched));
                            remainingMinutes -= segMins;
                        }
                    }
                    
                    const normalizeFn = window.normalizeChipFilterName || (x => x);
                    const segName = normalizeFn(seg.lop);
                    if (segName) {
                        if (!groups[segName]) {
                            groups[segName] = {
                                name: segName,
                                chips: [],
                                totalMinutes: 0
                            };
                        }
                        groups[segName].chips.push(chip);
                        groups[segName].totalMinutes += segMins;

                        // Split into student count bonus row if studentCount exists!
                        if (chip.studentCount && chip.studentCount > 0) {
                            const bonusName = `${segName} (+${chip.studentCount} HS)`;
                            if (!groups[bonusName]) {
                                groups[bonusName] = {
                                    name: bonusName,
                                    chips: [],
                                    totalMinutes: 0
                                };
                            }
                            groups[bonusName].chips.push(chip);
                            if (chip.studentCountStatus !== 'rejected') {
                                groups[bonusName].totalMinutes += segMins;
                            }
                        }
                    }
                });
            } else {
                if (!groups[name]) {
                    groups[name] = {
                        name: name,
                        chips: [],
                        totalMinutes: 0
                    };
                }
                groups[name].chips.push(chip);
                groups[name].totalMinutes += (chip.paidMinutes || 0);

                // Split into student count bonus row if studentCount exists!
                if (chip.studentCount && chip.studentCount > 0) {
                    const bonusName = `${name} (+${chip.studentCount} HS)`;
                    if (!groups[bonusName]) {
                        groups[bonusName] = {
                            name: bonusName,
                            chips: [],
                            totalMinutes: 0
                        };
                    }
                    groups[bonusName].chips.push(chip);
                    if (chip.studentCountStatus !== 'rejected') {
                        groups[bonusName].totalMinutes += (chip.paidMinutes || 0);
                    }
                }
            }
        }
    });
    
    const tableBody = document.getElementById('class-rate-table-body');
    if (tableBody) {
        tableBody.innerHTML = '';
        
        grandTotalMinutes = 0;
        let grandTotalSalary = 0;
        
        const groupKeys = Object.keys(groups).sort();
        if (groupKeys.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">Không có lớp hoặc ca làm việc nào trong tháng này.</td></tr>';
        } else {
            groupKeys.forEach(name => {
                const group = groups[name];
                const mins = group.totalMinutes;
                grandTotalMinutes += mins;
                
                let prefillRate = 0;
                if (classRates[name] !== undefined && Number(classRates[name]) > 0) {
                    prefillRate = Number(classRates[name]);
                } else {
                    if (name.includes('+')) {
                        const components = name.split('+').map(s => s.trim());
                        let maxRate = 0;
                        components.forEach(comp => {
                            let compRate = 0;
                            if (classRates[comp] !== undefined && Number(classRates[comp]) > 0) {
                                compRate = Number(classRates[comp]);
                            } else {
                                const foundCompRole = cfg.roles && cfg.roles.find(r => {
                                    const rName = r.name || r.id || '';
                                    const normalizeFn = window.normalizeChipFilterName || (x => x);
                                    return normalizeFn(rName) === normalizeFn(comp) || r.id === comp;
                                });
                                if (foundCompRole) {
                                    compRate = Number(foundCompRole.rate || 0);
                                }
                            }
                            if (compRate > maxRate) {
                                maxRate = compRate;
                            }
                        });
                        prefillRate = maxRate;
                    }

                    if (prefillRate === 0) {
                        const isTT = name.startsWith('Tiếp Tân');
                        if (isTT) {
                            if (name.includes('Cố Định')) {
                                prefillRate = Number(cfg.receptionist_fixed_rate || 0);
                            } else {
                                prefillRate = Number(cfg.receptionist_normal_rate || 0);
                            }
                        } else {
                            const foundRoleInConfig = cfg.roles && cfg.roles.find(r => {
                                const rName = r.name || r.id || '';
                                const normalizeFn = window.normalizeChipFilterName || (x => x);
                                return normalizeFn(rName) === normalizeFn(name) || r.id === name;
                            });
                            if (foundRoleInConfig) {
                                prefillRate = Number(foundRoleInConfig.rate || 0);
                            } else {
                                const firstWithRate = group.chips.find(c => c.sessionData && Number(c.sessionData.roleRate) > 0);
                                prefillRate = firstWithRate ? Number(firstWithRate.sessionData.roleRate) : 0;
                            }
                        }
                    }
                }
                
                const hasRejectedChip = window.unfilteredAllMonthChips?.some(c => c.studentCountStatus === 'rejected');
                const isPenaltyActive = !!window.currentMonthlySalarySettingsAll?.studentCountBonusPenalty || hasRejectedChip;
                const isBonus = isStudentCountBonusRow(name);
                const isRowDisabled = isBonus && isPenaltyActive;
                
                const hours = mins / 60;
                let amount = isRowDisabled ? 0 : hours * prefillRate;
                grandTotalSalary += amount;
                
                const h = Math.floor(mins / 60);
                const m = Math.floor(mins % 60);
                const timeStr = `${h}h${m > 0 ? ' ' + m + 'p' : ''}`;
                
                const nameStyle = isBonus ? 'padding-left: 2.25rem; font-weight: 600; color: #166534; font-size: 0.85rem;' : 'font-weight: 500; color: #374151;';
                const displayName = isBonus ? `↳ ${name}` : name;
                
                const inputBg = isRowDisabled ? 'background-color: #E5E7EB; cursor: not-allowed;' : '';
                const inputDisabledAttr = isRowDisabled ? 'disabled' : '';

                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid #E5E7EB';
                if (isRowDisabled) {
                    row.classList.add('salary-row-student-count-disabled');
                }
                row.innerHTML = `
                    <td style="padding: 0.75rem 1rem; ${nameStyle}">${displayName}</td>
                    <td style="padding: 0.75rem 1rem; text-align: center; color: #4B5563;">${timeStr}</td>
                    <td style="padding: 0.5rem 1rem; text-align: right;">
                        <input type="text" class="class-rate-input table-input money-input" 
                            data-name="${name.replace(/"/g, '&quot;')}" 
                            data-minutes="${mins}"
                            value="${formatNumberWithCommas(prefillRate)}" 
                            oninput="recalculateSalaryModal()"
                            ${inputDisabledAttr}
                            style="width: 100%; text-align: right; border: 1.5px solid #D1D5DB; border-radius: 6px; padding: 4px 8px; font-weight: 600; ${inputBg}">
                    </td>
                    <td class="class-row-total" style="padding: 0.75rem 1rem; text-align: right; font-weight: 700; color: #111827;">
                        ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount)}
                    </td>
                `;
                tableBody.appendChild(row);
            });
        }
        
        // Add Totals Row
        const totalsRow = document.createElement('tr');
        totalsRow.style.background = '#F9FAFB';
        totalsRow.style.fontWeight = '700';
        totalsRow.style.borderTop = '2px solid #D1D5DB';
        
        const grandH = Math.floor(grandTotalMinutes / 60);
        const grandM = Math.floor(grandTotalMinutes % 60);
        const grandTimeStr = `${grandH}h${grandM > 0 ? ' ' + grandM + 'p' : ''}`;
        
        totalsRow.innerHTML = `
            <td style="padding: 0.75rem 1rem; color: #111827;">Tổng Cộng</td>
            <td style="padding: 0.75rem 1rem; text-align: center; color: #111827;" id="class-rate-total-hours">${grandTimeStr}</td>
            <td style="padding: 0.75rem 1rem;"></td>
            <td style="padding: 0.75rem 1rem; text-align: right; color: #4338CA; font-size: 1rem;" id="class-rate-total-salary">
                ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(grandTotalSalary)}
            </td>
        `;
        tableBody.appendChild(totalsRow);
    }
    
    // 3. Advance & Evaluations Grid
    const modalAdvanceInp = document.getElementById('modal-salary-advance');
    if (modalAdvanceInp) modalAdvanceInp.value = formatNumberWithCommas(roleSettings.advance !== undefined ? roleSettings.advance : 0);
    
    // Recep contribution factors
    const tiepTanContrBox = document.getElementById('modal-tieptan-contribution-factors');
    if (tiepTanContrBox) {
        if (window.modalActiveRole === 'tiep-tan') {
            tiepTanContrBox.style.display = 'block';
            
            // Calculate dynamic fixed shift factor (Excel formula scaled dynamically)
            const calculatedFixed = getRecepDynamicFixedFactor(window.unfilteredAllMonthChips || []);
            document.getElementById('modal-recep-fixed-factor').value = calculatedFixed;
            
            // Calculate dynamic performance factor (based on base salary hourly rate)
            let normalRate = classRates["Tiếp Tân (Ca Bình Thường)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Bình Thường)"]) : Number(cfg.receptionist_normal_rate || 0);
            let calculatedAtt = getPerformanceFactorByRate(normalRate);
            if (normalRate > 0 && normalRate < 22000) {
                calculatedAtt = 0.0;
            }
            const attInp = document.getElementById('modal-recep-attendance-factor');
            if (attInp) {
                attInp.value = calculatedAtt.toFixed(1);
                if (normalRate > 0 && normalRate < 22000) {
                    attInp.readOnly = true;
                    attInp.style.backgroundColor = "#F3F4F6";
                    attInp.style.cursor = "not-allowed";
                } else {
                    attInp.readOnly = false;
                    attInp.style.backgroundColor = "";
                    attInp.style.cursor = "";
                }
            }
            
            // Handle dropdown select value for team leader rating (responsibility factor)
            const respVal = roleSettings.responsibility_factor !== undefined ? roleSettings.responsibility_factor : 1.0;
            const respSelect = document.getElementById('modal-recep-responsibility-factor');
            if (respSelect) {
                const allowedValues = ['1.1', '1.0', '0.9', '0.7'];
                // clear any dynamically added 'Khác' option first to avoid duplicates
                const prevKhac = respSelect.querySelector('option[value="' + respVal + '"]');
                if (!allowedValues.includes(String(respVal)) && !prevKhac) {
                    const opt = document.createElement('option');
                    opt.value = respVal;
                    opt.innerText = `Khác (${respVal})`;
                    respSelect.appendChild(opt);
                }
                respSelect.value = String(respVal);
            }
        } else {
            tiepTanContrBox.style.display = 'none';
        }
    }
    
    const evalTableBody = document.getElementById('modal-eval-table-body');
    if (evalTableBody) {
        evalTableBody.innerHTML = '';
        
        const isRecep = (window.modalActiveRole === 'tiep-tan');
        const activeCriteriaList = isRecep ? RECEP_EVALUATION_CRITERIA : EVALUATION_CRITERIA;
        
        activeCriteriaList.forEach((item, index) => {
            const criteriaIndex = isRecep ? item.index : index;
            const saved = (roleSettings.evaluation || []).find(e => e.id === criteriaIndex) || {};
            let amountVal = saved.amount !== undefined ? saved.amount : (item.default || 0);
            let noteVal = saved.note || '';

            // AUTO-POPULATE CRITERIA
            if (isRecep) {
                if (criteriaIndex === 0) {
                    if (!noteVal || noteVal.trim() === '' || noteVal.startsWith('Vắng phép:') || noteVal.startsWith('Vắng phép: ...')) {
                        noteVal = `Vắng phép: ${vpShifts}; Vắng đột xuất: ${vdxShifts}; Vắng không phép: ${vkpShifts}`;
                    }
                    if (saved.amount === undefined) {
                        const attRate = Number(roleSettings.attendance_rate || user.salary_config?.attendance_rate || 0);
                        if (attRate > 0) {
                            amountVal = Math.round((grandTotalMinutes / 60) * attRate);
                        }
                    }
                }
            } else {
                if (index === 0) {
                    if (!noteVal || noteVal.trim() === '' || noteVal.startsWith('Vắng phép:') || noteVal.startsWith('Vắng phép: ...')) {
                        noteVal = `Vắng phép: ${vpShifts}; Vắng đột xuất: ${vdxShifts}; Vắng không phép: ${vkpShifts}`;
                    }
                    if (saved.amount === undefined) {
                        const attRate = Number(roleSettings.attendance_rate || user.salary_config?.attendance_rate || 0);
                        if (attRate > 0) {
                            amountVal = Math.round((grandTotalMinutes / 60) * attRate);
                        }
                    }
                } else if (index === 1) {
                    if (!noteVal || noteVal.trim() === '' || noteVal.startsWith('Trễ:') || noteVal.startsWith('Trễ: ...')) {
                        noteVal = `Trễ: ${totalLateMinutes} phút; Số lần trễ: ${lateCount} lần`;
                    }
                } else if (index === 9) {
                    if (!noteVal || noteVal.trim() === '' || noteVal.startsWith('Tiếng Anh:') || noteVal.startsWith('Tiếng Anh: ...')) {
                        const rec = (meetingsLog && meetingsLog.records) ? meetingsLog.records[staffId] : null;
                        const status_ta = (rec && rec.hop_tg_tieng_anh) ? rec.hop_tg_tieng_anh : 'x';
                        const status_ttv = (rec && rec.hop_tg_t_tv) ? rec.hop_tg_t_tv : 'x';
                        const status_ttd = (rec && rec.hop_toan_tu_duy) ? rec.hop_toan_tu_duy : 'x';
                        const status_receptionist = (rec && rec.hop_tiep_tan) ? rec.hop_tiep_tan : 'x';
                        noteVal = `Tiếng Anh: ${status_ta}; T-TV: ${status_ttv}; TTD: ${status_ttd}; Tiếp Tân: ${status_receptionist}; (0: vắng; có: đi họp; vắng phép...)`;
                    }
                }
            }
            
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid #E5E7EB';
            row.innerHTML = `
                <td style="padding: 0.5rem; font-weight: 500; color: #374151;">
                    ${item.label}. ${item.tooltip}
                </td>
                <td style="padding: 0.25rem 0.5rem; text-align: right;">
                    <input type="text" class="modal-eval-amount table-input money-input" 
                        data-index="${criteriaIndex}" 
                        value="${formatNumberWithCommas(amountVal)}" 
                        style="width: 100%; text-align: right; border: 1.5px solid #D1D5DB; border-radius: 6px; padding: 4px; font-weight: 600;"
                        oninput="recalculateSalaryModal()">
                </td>
                <td style="padding: 0.25rem 0.5rem;">
                    <input type="text" class="modal-eval-note table-input" 
                        data-index="${criteriaIndex}" 
                        value="${noteVal.replace(/"/g, '&quot;')}" 
                        placeholder="${item.template || 'Nhập ghi chú...'}" 
                        style="width: 100%; border: 1.5px solid #D1D5DB; border-radius: 6px; padding: 4px; font-size: 0.8rem;">
                </td>
            `;
            evalTableBody.appendChild(row);
        });
    }
    
    bindMoneyInputFormatters();
    recalculateSalaryModal();
}

function recalculateSalaryModal() {
    let basePay = 0;
    
    let fixedMinutes = 0;
    let normalMinutes = 0;
    let normalRate = 0;
    
    const classRateInputs = document.querySelectorAll('.class-rate-input');
    classRateInputs.forEach(input => {
        const name = input.dataset.name;
        const mins = Number(input.dataset.minutes || 0);
        const rate = parseFormattedNumber(input.value);
        const amount = (mins / 60) * rate;
        basePay += amount;
        
        if (name === "Tiếp Tân (Ca Cố Định)") {
            fixedMinutes = mins;
        } else if (name === "Tiếp Tân (Ca Bình Thường)") {
            normalMinutes = mins;
            normalRate = rate;
        }
        
        const row = input.closest('tr');
        if (row) {
            const totalCell = row.querySelector('.class-row-total');
            if (totalCell) {
                totalCell.innerText = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
            }
        }
    });
    
    // Calculate Personal Score for Receptionist
    if (window.modalActiveRole === 'tiep-tan') {
        // Automatically calculate and update dynamic factors before reading them
        const calculatedFixed = getRecepDynamicFixedFactor(window.unfilteredAllMonthChips || []);
        const fixedInp = document.getElementById('modal-recep-fixed-factor');
        if (fixedInp) fixedInp.value = calculatedFixed;
        
        let autoAttFactor = getPerformanceFactorByRate(normalRate);
        if (normalRate > 0 && normalRate < 22000) {
            autoAttFactor = 0.0;
        }
        const attInp = document.getElementById('modal-recep-attendance-factor');
        if (attInp) {
            attInp.value = autoAttFactor.toFixed(1);
            if (normalRate > 0 && normalRate < 22000) {
                attInp.readOnly = true;
                attInp.style.backgroundColor = "#F3F4F6";
                attInp.style.cursor = "not-allowed";
            } else {
                attInp.readOnly = false;
                attInp.style.backgroundColor = "";
                attInp.style.cursor = "";
            }
        }

        const fixedFactor = parseFloat(document.getElementById('modal-recep-fixed-factor')?.value) || 1.5;
        const attFactor = parseFloat(document.getElementById('modal-recep-attendance-factor')?.value) || 1.0;
        const respFactor = parseFloat(document.getElementById('modal-recep-responsibility-factor')?.value) || 1.0;
        
        const fixedHours = fixedMinutes / 60;
        const normalHours = normalMinutes / 60;
        
        const score = (fixedHours * fixedFactor + normalHours * 1) * attFactor * respFactor;
        const scoreEl = document.getElementById('modal-recep-personal-score');
        if (scoreEl) {
            scoreEl.innerText = score.toFixed(1);
        }
    }
    
    const classRateTotalCell = document.getElementById('class-rate-total-salary');
    if (classRateTotalCell) {
        classRateTotalCell.innerText = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(basePay);
    }
    
    let criteriaPay = 0;
    const evalAmountInputs = document.querySelectorAll('.modal-eval-amount');
    evalAmountInputs.forEach(input => {
        const amt = parseFormattedNumber(input.value);
        criteriaPay += amt;
    });
    
    const penaltyVDX = parseFormattedNumber(document.getElementById('modal-adjust-vdx')?.value || '0');
    const penaltyVKP = parseFormattedNumber(document.getElementById('modal-adjust-vkp')?.value || '0');
    const penaltyLate = parseFormattedNumber(document.getElementById('modal-adjust-late')?.value || '0');
    const advance = parseFormattedNumber(document.getElementById('modal-salary-advance')?.value || '0');
    
    const attendanceAdjustments = - penaltyVDX - penaltyVKP - penaltyLate;
    
    let recepPoolPay = 0;
    if (window.modalActiveRole === 'tiep-tan') {
        recepPoolPay += parseFormattedNumber(document.getElementById('pdf-doanh-thu-tong')?.value || '0');
        recepPoolPay += parseFormattedNumber(document.getElementById('pdf-doanh-thu-cs2')?.value || '0');
    }
    
    const netPay = basePay + criteriaPay + recepPoolPay + attendanceAdjustments - advance;
    
    const displayCell = document.getElementById('modal-final-salary-display');
    if (displayCell) {
        displayCell.innerText = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(netPay);
    }
    applySalaryVisibility();
}

async function saveSalarySettingsFromModal() {
    const staffId = getTargetStaffId();
    if (!staffId || staffId === 'all') return;
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    const classRates = {};
    const classRateInputs = document.querySelectorAll('.class-rate-input');
    classRateInputs.forEach(input => {
        const name = input.dataset.name;
        const rate = parseFormattedNumber(input.value);
        if (name) {
            classRates[name] = rate;
        }
    });
    
    const evaluationData = [];
    document.querySelectorAll('.modal-eval-note').forEach(noteInp => {
        const index = parseInt(noteInp.dataset.index, 10);
        const amountInp = document.querySelector(`.modal-eval-amount[data-index="${index}"]`);
        evaluationData.push({
            id: index,
            note: noteInp.value,
            amount: parseFormattedNumber(amountInp?.value || '0')
        });
    });
    
    const adjustVDX = parseFormattedNumber(document.getElementById('modal-adjust-vdx')?.value || '0');
    const adjustVKP = parseFormattedNumber(document.getElementById('modal-adjust-vkp')?.value || '0');
    const adjustLate = parseFormattedNumber(document.getElementById('modal-adjust-late')?.value || '0');
    const advance = parseFormattedNumber(document.getElementById('modal-salary-advance')?.value || '0');
    
    const settingsObj = {
        class_rates: classRates,
        evaluation: evaluationData,
        adjust_vdx: adjustVDX,
        adjust_vkp: adjustVKP,
        adjust_late: adjustLate,
        advance: advance
    };
    
    if (window.modalActiveRole === 'tiep-tan') {
        settingsObj.fixed_shift_factor = parseFloat(document.getElementById('modal-recep-fixed-factor')?.value) || 1.5;
        settingsObj.attendance_factor = parseFloat(document.getElementById('modal-recep-attendance-factor')?.value) || 1.0;
        settingsObj.responsibility_factor = parseFloat(document.getElementById('modal-recep-responsibility-factor')?.value) || 1.0;
        
        const scoreEl = document.getElementById('modal-recep-personal-score');
        settingsObj.personal_score = scoreEl ? parseFloat(scoreEl.innerText) : 0;
    }
    
    try {
        const firestorePayload = {};
        const roleKey = window.modalActiveRole === 'tiep-tan' ? 'tiep_tan' : 'giao_vien';
        firestorePayload[roleKey] = settingsObj;
        
        await DBService.saveMonthlySalarySettings(staffId, monthStr, firestorePayload);
        
        if (window.currentUserContext) {
            if (!window.currentUserContext.salary_config) {
                window.currentUserContext.salary_config = {};
            }
            window.currentUserContext.salary_config.class_rates = classRates;
            window.currentUserContext.salary_config.evaluation = evaluationData;
        }
        
        window.currentLoadedRoleKey = roleKey;
        window.currentLoadedSalarySettings = settingsObj;
        if (!window.currentMonthlySalarySettingsAll) {
            window.currentMonthlySalarySettingsAll = {};
        }
        window.currentMonthlySalarySettingsAll[roleKey] = settingsObj;
        
        // Sync to background page elements
        const backgroundAdvanceInp = document.getElementById('salary-advance');
        if (backgroundAdvanceInp) {
            backgroundAdvanceInp.value = formatNumberWithCommas(advance);
        }
        
        if (roleKey === 'tiep_tan') {
            const phiTuVanObj = evaluationData.find(e => e.id === 1);
            const doanhThuCs3Obj = evaluationData.find(e => e.id === 6);
            const backgroundPhiTuVanInp = document.getElementById('pdf-phi-tu-van');
            const backgroundDoanhThuCs3Inp = document.getElementById('pdf-doanh-thu-cs3');
            if (backgroundPhiTuVanInp && phiTuVanObj) {
                backgroundPhiTuVanInp.value = formatNumberWithCommas(phiTuVanObj.amount || 0);
            }
            if (backgroundDoanhThuCs3Inp && doanhThuCs3Obj) {
                backgroundDoanhThuCs3Inp.value = formatNumberWithCommas(doanhThuCs3Obj.amount || 0);
            }
        }
        
        if (typeof renderEvaluationTable === 'function') {
            renderEvaluationTable(settingsObj.evaluation || []);
        }
        
        UIService.toast('Đã lưu bảng lương và tính thành công!', 'success');
        closeClassRateModal();
        calculateSalary();
        await saveCalculationDraftToDb(staffId, monthStr);
    } catch (e) {
        console.error('Error saving salary settings:', e);
        UIService.toast('Lỗi khi lưu bảng lương: ' + e.message, 'error');
    }
}

async function toggleModalCalculationRole(role) {
    window.modalActiveRole = role;
    
    const btnGv = document.getElementById('btn-modal-role-gv');
    const btnTt = document.getElementById('btn-modal-role-tt');
    
    if (btnGv && btnTt) {
        if (role === 'giao-vien') {
            btnGv.style.background = '#4338CA';
            btnGv.style.color = 'white';
            btnTt.style.background = 'white';
            btnTt.style.color = '#374151';
            btnTt.style.border = '1px solid #D1D5DB';
        } else {
            btnTt.style.background = '#4338CA';
            btnTt.style.color = 'white';
            btnGv.style.background = 'white';
            btnGv.style.color = '#374151';
            btnGv.style.border = '1px solid #D1D5DB';
        }
    }
    
    const tabCurrent = document.getElementById('salary-modal-tab-content-current');
    if (tabCurrent && tabCurrent.style.display !== 'none') {
        await populateModalCurrentTab();
    } else {
        const staffId = getTargetStaffId();
        const prevDate = new Date(currentDate);
        prevDate.setMonth(prevDate.getMonth() - 1);
        const prevYear = prevDate.getFullYear();
        const prevMonth = prevDate.getMonth();
        const prevMonthStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}`;
        await loadPreviousMonthHistory(staffId, prevMonthStr, window.currentUserContext);
    }
}

async function switchSalaryModalTab(tab) {
    const tabCurrent = document.getElementById('salary-modal-tab-content-current');
    const tabHistory = document.getElementById('salary-modal-tab-content-history');
    
    const btnCurrent = document.getElementById('btn-salary-tab-current');
    const btnHistory = document.getElementById('btn-salary-tab-history');
    
    if (tab === 'current') {
        if (tabCurrent) tabCurrent.style.display = 'block';
        if (tabHistory) tabHistory.style.display = 'none';
        
        if (btnCurrent) {
            btnCurrent.style.borderBottomColor = '#4338CA';
            btnCurrent.style.color = '#4338CA';
            btnCurrent.style.fontWeight = '700';
        }
        if (btnHistory) {
            btnHistory.style.borderBottomColor = 'transparent';
            btnHistory.style.color = '#6B7280';
            btnHistory.style.fontWeight = '600';
        }
        
        await populateModalCurrentTab();
    } else {
        if (tabCurrent) tabCurrent.style.display = 'none';
        if (tabHistory) tabHistory.style.display = 'block';
        
        if (btnHistory) {
            btnHistory.style.borderBottomColor = '#4338CA';
            btnHistory.style.color = '#4338CA';
            btnHistory.style.fontWeight = '700';
        }
        if (btnCurrent) {
            btnCurrent.style.borderBottomColor = 'transparent';
            btnCurrent.style.color = '#6B7280';
            btnCurrent.style.fontWeight = '600';
        }
        
        const staffId = getTargetStaffId();
        const prevDate = new Date(currentDate);
        prevDate.setMonth(prevDate.getMonth() - 1);
        const prevYear = prevDate.getFullYear();
        const prevMonth = prevDate.getMonth();
        const prevMonthStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}`;
        
        await loadPreviousMonthHistory(staffId, prevMonthStr, window.currentUserContext);
    }
}

async function loadPreviousMonthHistory(staffId, prevMonthStr, user) {
    const historyContainer = document.getElementById('modal-history-content');
    const loadingEl = document.getElementById('modal-history-loading');
    
    if (loadingEl) loadingEl.style.display = 'block';
    if (historyContainer) historyContainer.style.display = 'none';
    
    try {
        const [prevYearStr, prevMonthNumStr] = prevMonthStr.split('-');
        const prevYear = parseInt(prevYearStr, 10);
        const prevMonth = parseInt(prevMonthNumStr, 10) - 1; // 0-indexed
        
        const prevNotes = await DBService.getDailyNotes(staffId);
        const cancelledShifts = await DBService.getCancelledShifts(prevMonthStr, staffId);
        const savedFixedShifts = await DBService.getFixedShifts(prevMonthStr, staffId);
        const attendanceRecords = await DBService.getMonthlyAttendance(prevMonthStr, staffId);
        const receptionistShifts = await DBService.getMonthlyReceptionistShifts(prevMonthStr, staffId);
        const overtimeRecords = await DBService.getMonthlyOvertimeRequests(prevMonthStr, staffId);
        const bonus10Records = await DBService.getMonthlyBonus10Requests(prevMonthStr, staffId);
        const scheduleMap = await DBService.getMonthlySchedule(prevMonthStr);
        
        const attendanceMap = {};
        attendanceRecords.forEach(rec => {
            if (rec.id && rec.sessions) attendanceMap[rec.id] = rec.sessions;
        });
        
        const receptionistShiftsMap = {};
        receptionistShifts.forEach(rec => {
            if (rec.id && rec.shifts) receptionistShiftsMap[rec.id] = rec.shifts;
        });
        
        const overtimeDateMap = {};
        overtimeRecords.forEach(req => {
            if (req.dateKey && req.status === 'approved') {
                if (!overtimeDateMap[req.dateKey]) overtimeDateMap[req.dateKey] = {};
                overtimeDateMap[req.dateKey][req.sessionId] = req;
            }
        });
        
        const bonus10Map = {};
        bonus10Records.forEach(req => {
            if (req.dateKey && req.status === 'approved') {
                if (!bonus10Map[req.dateKey]) bonus10Map[req.dateKey] = {};
                bonus10Map[req.dateKey][req.sessionId] = req;
            }
        });
        
        const daysInMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
        const prevChips = [];
        
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dailySchedule = scheduleMap[dateStr] || {};
            const dailyAttendance = attendanceMap[dateStr] || [];
            const dailyReceptionistShifts = receptionistShiftsMap[dateStr] || [];
            
            const chips = calculateDailyChips(
                dailySchedule,
                dailyAttendance,
                staffId,
                dateStr,
                user,
                dailyReceptionistShifts,
                overtimeDateMap[dateStr] || {},
                cancelledShifts,
                bonus10Map
            );
            
            chips.forEach(c => {
                c.dateStr = dateStr;
                prevChips.push(c);
            });
        }
        
        const prevMonthlySettingsAll = await DBService.getMonthlySalarySettings(staffId, prevMonthStr);
        const prevRoleSettings = prevMonthlySettingsAll[window.modalActiveRole] || prevMonthlySettingsAll[window.modalActiveRole.replace('-', '_')] || {};
        
        let workedShifts = 0;
        let vpShifts = 0;
        let vdxShifts = 0;
        let vkpShifts = 0;
        let lateCount = 0;
        let totalLateMinutes = 0;
        
        prevChips.forEach(chip => {
            if (chip.class === 'chip-future' || chip.isCenterOff) return;
            
            const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
            if (window.modalActiveRole === 'tiep-tan' && !isTT) return;
            if (window.modalActiveRole === 'giao-vien' && isTT) return;
            
            if (chip.class === 'chip-gray' || chip.isVDX || chip.class === 'chip-red') {
                const type = classifyAbsentChip(chip, prevNotes);
                if (type === 'VP') vpShifts++;
                else if (type === 'VDX') vdxShifts++;
                else vkpShifts++;
            } else {
                workedShifts++;
            }
            
            const match = chip.text.match(/\(T(\d+)p\)/);
            if (match) {
                lateCount++;
                totalLateMinutes += parseInt(match[1], 10);
            }
        });
        
        const classRates = prevRoleSettings.class_rates || user.salary_config?.class_rates || {};
        const groups = {};
        prevChips.forEach(chip => {
            const name = chip.chipFilterName;
            if (!name) return;
            
            const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
            if (window.modalActiveRole === 'tiep-tan' && !isTT) return;
            if (window.modalActiveRole === 'giao-vien' && isTT) return;
            
            if (window.modalActiveRole === 'tiep-tan') {
                if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                    let remainingMinutes = chip.paidMinutes || 0;
                    const totalSched = chip.mergedSegments.reduce((sum, seg) => sum + (seg.schedMinutes || 0), 0);
                    chip.mergedSegments.forEach((seg, sIdx) => {
                        const groupName = seg.isFixedShift ? "Tiếp Tân (Ca Cố Định)" : "Tiếp Tân (Ca Bình Thường)";
                        let segMins = 0;
                        if (totalSched <= 0) {
                            segMins = sIdx === chip.mergedSegments.length - 1 ? remainingMinutes : Math.round((chip.paidMinutes || 0) / chip.mergedSegments.length);
                        } else {
                            segMins = Math.round(((seg.schedMinutes || 0) / totalSched) * (chip.paidMinutes || 0));
                            if (sIdx === chip.mergedSegments.length - 1) {
                                segMins = remainingMinutes;
                            } else {
                                remainingMinutes -= segMins;
                            }
                        }
                        if (!groups[groupName]) {
                            groups[groupName] = { name: groupName, chips: [], totalMinutes: 0 };
                        }
                        groups[groupName].chips.push(chip);
                        groups[groupName].totalMinutes += segMins;
                    });
                } else {
                    const groupName = chip.isFixedShift ? "Tiếp Tân (Ca Cố Định)" : "Tiếp Tân (Ca Bình Thường)";
                    const mins = chip.paidMinutes || 0;
                    if (!groups[groupName]) {
                        groups[groupName] = { name: groupName, chips: [], totalMinutes: 0 };
                    }
                    groups[groupName].chips.push(chip);
                    groups[groupName].totalMinutes += mins;
                }
            } else {
                if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                    let remainingMinutes = chip.paidMinutes || 0;
                    const totalSched = chip.mergedSegments.reduce((sum, seg) => sum + (seg.schedMinutes || 0), 0);
                    
                    chip.mergedSegments.forEach((seg, sIdx) => {
                        let segMins = 0;
                        if (totalSched <= 0) {
                            segMins = sIdx === chip.mergedSegments.length - 1 ? remainingMinutes : Math.round((chip.paidMinutes || 0) / chip.mergedSegments.length);
                        } else {
                            if (sIdx === chip.mergedSegments.length - 1) {
                                segMins = remainingMinutes;
                            } else {
                                segMins = Math.round((chip.paidMinutes || 0) * ((seg.schedMinutes || 0) / totalSched));
                                remainingMinutes -= segMins;
                            }
                        }
                        
                        const normalizeFn = window.normalizeChipFilterName || (x => x);
                        const segName = normalizeFn(seg.lop);
                        if (segName) {
                            if (!groups[segName]) {
                                groups[segName] = { name: segName, chips: [], totalMinutes: 0 };
                            }
                            groups[segName].chips.push(chip);
                            groups[segName].totalMinutes += segMins;
                        }
                    });
                } else {
                    if (!groups[name]) {
                        groups[name] = { name: name, chips: [], totalMinutes: 0 };
                    }
                    groups[name].chips.push(chip);
                    groups[name].totalMinutes += (chip.paidMinutes || 0);
                }
            }
        });
        
        let basePay = 0;
        let classRatesRowsHtml = '';
        const groupKeys = Object.keys(groups).sort();
        
        if (groupKeys.length === 0) {
            classRatesRowsHtml = '<tr><td colspan="4" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">Không có lớp hoặc ca làm việc nào.</td></tr>';
        } else {
            groupKeys.forEach(name => {
                const group = groups[name];
                const mins = group.totalMinutes;
                
                let rate = 0;
                if (classRates[name] !== undefined && Number(classRates[name]) > 0) {
                    rate = Number(classRates[name]);
                } else {
                    const isTT = name.startsWith('Tiếp Tân');
                    if (isTT) {
                        if (name.includes('Cố Định')) {
                            rate = Number(user.salary_config?.receptionist_fixed_rate || 0);
                        } else {
                            rate = Number(user.salary_config?.receptionist_normal_rate || 0);
                        }
                    } else {
                        const cfg = user.salary_config || {};
                        const foundRoleInConfig = cfg.roles && cfg.roles.find(r => {
                            const rName = r.name || r.id || '';
                            const normalizeFn = window.normalizeChipFilterName || (x => x);
                            return normalizeFn(rName) === normalizeFn(name) || r.id === name;
                        });
                        if (foundRoleInConfig) {
                            rate = Number(foundRoleInConfig.rate || 0);
                        } else {
                            const firstWithRate = group.chips.find(c => c.sessionData && Number(c.sessionData.roleRate) > 0);
                            rate = firstWithRate ? Number(firstWithRate.sessionData.roleRate) : 0;
                        }
                    }
                }
                
                const hours = mins / 60;
                const amt = hours * rate;
                basePay += amt;
                
                const h = Math.floor(mins / 60);
                const m = Math.floor(mins % 60);
                const timeStr = `${h}h${m > 0 ? ' ' + m + 'p' : ''}`;
                
                classRatesRowsHtml += `
                    <tr style="border-bottom: 1px solid #E5E7EB;">
                        <td style="padding: 0.65rem 1rem; font-weight: 500; color: #374151;">${name}</td>
                        <td style="padding: 0.65rem 1rem; text-align: center; color: #4B5563;">${timeStr}</td>
                        <td style="padding: 0.65rem 1rem; text-align: right; font-weight: 600; color: #374151;">${formatNumberWithCommas(rate)} ₫</td>
                        <td style="padding: 0.65rem 1rem; text-align: right; font-weight: 700; color: #111827;">${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amt)}</td>
                    </tr>
                `;
            });
        }
        
        const grandH = Math.floor(prevChips.reduce((acc, c) => {
            const isTT = c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(c.sessionData.role));
            if (window.modalActiveRole === 'tiep-tan' && !isTT) return acc;
            if (window.modalActiveRole === 'giao-vien' && isTT) return acc;
            return acc + (c.paidMinutes || 0);
        }, 0) / 60);
        const grandM = Math.floor(prevChips.reduce((acc, c) => {
            const isTT = c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(c.sessionData.role));
            if (window.modalActiveRole === 'tiep-tan' && !isTT) return acc;
            if (window.modalActiveRole === 'giao-vien' && isTT) return acc;
            return acc + (c.paidMinutes || 0);
        }, 0) % 60);
        const grandTimeStr = `${grandH}h${grandM > 0 ? ' ' + grandM + 'p' : ''}`;
        
        let criteriaPay = 0;
        let criteriaRowsHtml = '';
        const isRecep = (window.modalActiveRole === 'tiep-tan');
        const activeCriteriaList = isRecep ? RECEP_EVALUATION_CRITERIA : EVALUATION_CRITERIA;
        
        activeCriteriaList.forEach((item, index) => {
            const criteriaIndex = isRecep ? item.index : index;
            const saved = (prevRoleSettings.evaluation || []).find(e => e.id === criteriaIndex) || {};
            const amountVal = saved.amount !== undefined ? saved.amount : (item.default || 0);
            const noteVal = saved.note || '';
            criteriaPay += amountVal;
            
            criteriaRowsHtml += `
                <tr style="border-bottom: 1px solid #E5E7EB;">
                    <td style="padding: 0.5rem; font-weight: 500; color: #374151;">${item.label}. ${item.tooltip}</td>
                    <td style="padding: 0.5rem; text-align: right; font-weight: 600; color: ${amountVal >= 0 ? '#059669' : '#DC2626'}">${formatNumberWithCommas(amountVal)} ₫</td>
                    <td style="padding: 0.5rem; color: #4B5563; font-style: italic; font-size: 0.8rem;">${noteVal || '—'}</td>
                </tr>
            `;
        });
        
        const pVDX = prevRoleSettings.adjust_vdx || 0;
        const pVKP = prevRoleSettings.adjust_vkp || 0;
        const pLate = prevRoleSettings.adjust_late || 0;
        const adv = prevRoleSettings.advance || 0;
        
        const netPay = basePay + criteriaPay - pVDX - pVKP - pLate - adv;
        
        if (historyContainer) {
            historyContainer.innerHTML = `
                <div style="margin-bottom: 1rem; font-size: 1.1rem; font-weight: 700; color: #1E3A8A; border-bottom: 2px solid #E5E7EB; padding-bottom: 0.5rem;">
                    Bảng Lương Tháng ${prevMonth + 1}/${prevYear} (Đã Lưu)
                </div>
                
                <div style="margin-bottom: 1.5rem; padding: 1rem; border: 1px solid #E5E7EB; border-radius: 12px; background: #F9FAFB; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.85rem; color: #374151;">
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #E5E7EB; padding-bottom: 2px;">
                            <span>Tổng số ca đi làm:</span> <strong>${workedShifts} ca</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #E5E7EB; padding-bottom: 2px;">
                            <span>Vắng có phép (VP):</span> <strong>${vpShifts} ca</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #E5E7EB; padding-bottom: 2px;">
                            <span>Vắng đột xuất (VDX):</span> <strong style="color: #D97706;">${vdxShifts} ca</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #E5E7EB; padding-bottom: 2px;">
                            <span>Vắng không phép (VKP):</span> <strong style="color: #DC2626;">${vkpShifts} ca</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #E5E7EB; padding-bottom: 2px;">
                            <span>Trễ giờ ca làm:</span> <strong style="color: #EF4444;">${lateCount} lần (${totalLateMinutes} phút)</strong>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; justify-content: center; font-size: 0.85rem;">
                        <div style="display: flex; justify-content: space-between;">
                            <span>Phạt Vắng đột xuất:</span> <strong>${formatNumberWithCommas(pVDX)} ₫</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>Phạt Vắng không phép:</span> <strong>${formatNumberWithCommas(pVKP)} ₫</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>Phạt Đi trễ:</span> <strong>${formatNumberWithCommas(pLate)} ₫</strong>
                        </div>
                    </div>
                </div>
                
                <div style="margin-bottom: 1.5rem; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                        <thead>
                            <tr style="background: #F3F4F6; border-bottom: 2px solid #E5E7EB; color: #374151; font-weight: 700;">
                                <th style="padding: 0.65rem 1rem;">Lớp / Ca</th>
                                <th style="padding: 0.65rem 1rem; text-align: center; width: 110px;">Tổng Số Giờ</th>
                                <th style="padding: 0.65rem 1rem; text-align: right; width: 140px;">Lương / Giờ</th>
                                <th style="padding: 0.65rem 1rem; text-align: right; width: 140px;">Thành Tiền</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${classRatesRowsHtml}
                            <tr style="background: #F9FAFB; font-weight: 700; border-top: 2px solid #D1D5DB;">
                                <td style="padding: 0.75rem 1rem; color: #111827;">Tổng Cộng</td>
                                <td style="padding: 0.75rem 1rem; text-align: center; color: #111827;">${grandTimeStr}</td>
                                <td style="padding: 0.75rem 1rem;"></td>
                                <td style="padding: 0.75rem 1rem; text-align: right; color: #4338CA; font-size: 1rem;">${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(basePay)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                <div style="border: 1px solid #E5E7EB; border-radius: 12px; padding: 1rem; background: #FAFBFD; margin-bottom: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid #E5E7EB; padding-bottom: 0.5rem; font-size: 0.9rem;">
                        <span style="font-weight: 700; color: #111827;">Tạm Ứng:</span>
                        <strong style="color: #DC2626;">${formatNumberWithCommas(adv)} ₫</strong>
                    </div>
                    <div style="max-height: 250px; overflow-y: auto; padding-right: 4px;">
                        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                            <thead>
                                <tr style="border-bottom: 1px solid #E5E7EB; color: #4B5563; font-weight: 700;">
                                    <th style="padding: 0.35rem 0.5rem;">Tiêu Chí Xét</th>
                                    <th style="padding: 0.35rem 0.5rem; text-align: right; width: 140px;">Thưởng / Phạt</th>
                                    <th style="padding: 0.35rem 0.5rem; width: 280px;">Ghi Chú Chi Tiết</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${criteriaRowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div style="margin-top: 1.5rem; padding: 1rem; border-radius: 12px; background: #ECFDF5; border: 1px solid #A7F3D0; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 700; color: #065F46; font-size: 1rem;">THỰC LĨNH THÁNG TRƯỚC:</span>
                    <strong style="font-size: 1.4rem; color: #047857;">${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(netPay)}</strong>
                </div>
            `;
        }
        
        if (loadingEl) loadingEl.style.display = 'none';
        if (historyContainer) historyContainer.style.display = 'block';
        applySalaryVisibility();
    } catch (e) {
        console.error("Error loading previous month history:", e);
        if (loadingEl) loadingEl.innerText = "Lỗi khi tải lịch sử lương tháng trước: " + e.message;
    }
}

function exportSalaryPDFFromModal() {
    const advance = parseFormattedNumber(document.getElementById('modal-salary-advance')?.value || '0');
    const penaltyVDX = parseFormattedNumber(document.getElementById('modal-adjust-vdx')?.value || '0');
    const penaltyVKP = parseFormattedNumber(document.getElementById('modal-adjust-vkp')?.value || '0');
    const penaltyLate = parseFormattedNumber(document.getElementById('modal-adjust-late')?.value || '0');
    
    const evaluationData = [];
    const isRecep = window.modalActiveRole === 'tiep-tan';
    const activeCriteria = isRecep ? RECEP_EVALUATION_CRITERIA : EVALUATION_CRITERIA;
    
    document.querySelectorAll('.modal-eval-note').forEach(noteInp => {
        const index = parseInt(noteInp.dataset.index, 10);
        const amountInp = document.querySelector(`.modal-eval-amount[data-index="${index}"]`);
        const item = isRecep ? activeCriteria.find(e => e.index === index) : activeCriteria[index];
        if (!item) return;
        evaluationData.push({
            id: index,
            label: item.label,
            title: item.tooltip,
            note: noteInp.value,
            amount: parseFormattedNumber(amountInp?.value || '0')
        });
    });
    
    exportSalaryPDF({
        customAdvance: advance,
        customEvalItems: evaluationData,
        customPenalties: {
            vdx: penaltyVDX,
            vkp: penaltyVKP,
            late: penaltyLate
        },
        customFilterType: window.modalActiveRole
    });
}

// Receptionist Collective Bonus Config & Redistribution functions

function toggleRecepBonusConfigUI() {
    const el = document.getElementById('recep-bonus-config-ui');
    if (el) {
        if (el.style.display === 'none') {
            el.style.display = 'flex';
            renderRecepBonusConfigUI();
        } else {
            el.style.display = 'none';
        }
    }
}

function closeRecepBonusConfigUI() {
    const el = document.getElementById('recep-bonus-config-ui');
    if (el) el.style.display = 'none';
}

function renderRecepBonusConfigUI() {
    const config = window.recepBonusConfig || { center_tiers: [], cs2_tiers: [] };
    
    const centerContainer = document.getElementById('recep-config-center-tiers-inputs');
    if (centerContainer) {
        centerContainer.innerHTML = '';
        const tiers = config.center_tiers || [];
        tiers.forEach((tier, index) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.gap = '0.25rem';
            row.style.alignItems = 'center';
            row.innerHTML = `
                <input type="number" class="recep-center-tier-rev modern-input" value="${tier.revenue}" style="flex:1; padding:4px; font-size:0.75rem;" placeholder="Doanh thu">
                <input type="number" class="recep-center-tier-bonus modern-input" value="${tier.bonus}" style="flex:1; padding:4px; font-size:0.75rem;" placeholder="Quỹ thưởng">
                <button type="button" onclick="removeRecepCenterTier(${index})" style="background:none; border:none; color:#EF4444; font-size:0.8rem; cursor:pointer;">✕</button>
            `;
            centerContainer.appendChild(row);
        });
        
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.innerText = '+ Thêm mốc';
        addBtn.style.alignSelf = 'flex-start';
        addBtn.style.background = '#EEF2FF';
        addBtn.style.border = '1px dashed #4338CA';
        addBtn.style.color = '#4338CA';
        addBtn.style.padding = '2px 6px';
        addBtn.style.borderRadius = '4px';
        addBtn.style.fontSize = '0.65rem';
        addBtn.style.fontWeight = '700';
        addBtn.style.cursor = 'pointer';
        addBtn.style.marginTop = '2px';
        addBtn.onclick = () => {
            if (!config.center_tiers) config.center_tiers = [];
            config.center_tiers.push({ revenue: 0, bonus: 0 });
            renderRecepBonusConfigUI();
        };
        centerContainer.appendChild(addBtn);
    }
    
    const cs2Container = document.getElementById('recep-config-cs2-tiers-inputs');
    if (cs2Container) {
        cs2Container.innerHTML = '';
        const tiers = config.cs2_tiers || [];
        tiers.forEach((tier, index) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.gap = '0.25rem';
            row.style.alignItems = 'center';
            row.innerHTML = `
                <input type="number" class="recep-cs2-tier-rev modern-input" value="${tier.revenue}" style="flex:1; padding:4px; font-size:0.75rem;" placeholder="Doanh thu">
                <input type="number" class="recep-cs2-tier-bonus modern-input" value="${tier.bonus}" style="flex:1; padding:4px; font-size:0.75rem;" placeholder="Quỹ thưởng">
                <button type="button" onclick="removeRecepCs2Tier(${index})" style="background:none; border:none; color:#EF4444; font-size:0.8rem; cursor:pointer;">✕</button>
            `;
            cs2Container.appendChild(row);
        });
        
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.innerText = '+ Thêm mốc';
        addBtn.style.alignSelf = 'flex-start';
        addBtn.style.background = '#EEF2FF';
        addBtn.style.border = '1px dashed #4338CA';
        addBtn.style.color = '#4338CA';
        addBtn.style.padding = '2px 6px';
        addBtn.style.borderRadius = '4px';
        addBtn.style.fontSize = '0.65rem';
        addBtn.style.fontWeight = '700';
        addBtn.style.cursor = 'pointer';
        addBtn.style.marginTop = '2px';
        addBtn.onclick = () => {
            if (!config.cs2_tiers) config.cs2_tiers = [];
            config.cs2_tiers.push({ revenue: 0, bonus: 0 });
            renderRecepBonusConfigUI();
        };
        cs2Container.appendChild(addBtn);
    }
}

function removeRecepCenterTier(index) {
    if (window.recepBonusConfig && window.recepBonusConfig.center_tiers) {
        window.recepBonusConfig.center_tiers.splice(index, 1);
        renderRecepBonusConfigUI();
    }
}

function removeRecepCs2Tier(index) {
    if (window.recepBonusConfig && window.recepBonusConfig.cs2_tiers) {
        window.recepBonusConfig.cs2_tiers.splice(index, 1);
        renderRecepBonusConfigUI();
    }
}

async function saveRecepBonusConfigUI() {
    const centerRevs = document.querySelectorAll('.recep-center-tier-rev');
    const centerBonuses = document.querySelectorAll('.recep-center-tier-bonus');
    const cs2Revs = document.querySelectorAll('.recep-cs2-tier-rev');
    const cs2Bonuses = document.querySelectorAll('.recep-cs2-tier-bonus');
    
    const center_tiers = [];
    centerRevs.forEach((input, index) => {
        const revenue = parseFloat(input.value) || 0;
        const bonus = parseFloat(centerBonuses[index].value) || 0;
        if (revenue > 0 || bonus > 0) {
            center_tiers.push({ revenue, bonus });
        }
    });
    center_tiers.sort((a, b) => a.revenue - b.revenue);
    
    const cs2_tiers = [];
    cs2Revs.forEach((input, index) => {
        const revenue = parseFloat(input.value) || 0;
        const bonus = parseFloat(cs2Bonuses[index].value) || 0;
        if (revenue > 0 || bonus > 0) {
            cs2_tiers.push({ revenue, bonus });
        }
    });
    cs2_tiers.sort((a, b) => a.revenue - b.revenue);
    
    const newConfig = { center_tiers, cs2_tiers };
    try {
        await DBService.saveReceptionistBonusConfig(newConfig);
        window.recepBonusConfig = newConfig;
        UIService.toast('Đã lưu cấu hình mốc thưởng!', 'success');
        closeRecepBonusConfigUI();
        calculateSalary();
    } catch (e) {
        console.error('Error saving receptionist bonus config:', e);
        UIService.toast('Lỗi khi lưu cấu hình: ' + e.message, 'error');
    }
}

async function loadAndComputeAllReceptionists(monthStr) {
    const allUsers = window._allStaffList || [];
    const receptionists = allUsers.filter(u => {
        const roles = Array.isArray(u.roles) ? u.roles : [u.role || ''];
        return roles.some(r => ['receptionist', 'receptionist_assistant', 'tiep-tan', 'tiep_tan', 'receptionist_lead', 'receptionist_staff', 'admin', 'senior_assistant', 'assistant'].includes(r));
    });
    
    const allMonthlySettings = await DBService.getAllMonthlySalarySettings(monthStr);
    
    const BRANCHES = ['cs1', 'cs2', 'cs3'];
    const shiftConfigMap = {};
    for (const branch of BRANCHES) {
        shiftConfigMap[branch] = await DBService.getReceptionistShiftConfig(branch);
    }
    
    const [yearStr, monthValStr] = monthStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthValStr, 10) - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const getMonday = (d) => {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        date.setDate(diff);
        date.setHours(0, 0, 0, 0);
        return date;
    };

    const mondaysSet = new Set();
    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month, d);
        const monday = getMonday(dateObj);
        const mKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
        mondaysSet.add(mKey);
    }
    const mondaysList = [...mondaysSet];
    
    const recepPromises = [];
    BRANCHES.forEach(branch => {
        mondaysList.forEach(mondayKey => {
            const compositeKey = `${branch}__${mondayKey}`;
            recepPromises.push(
                DBService.getReceptionistSchedule(compositeKey).then(data => ({
                    branch,
                    mondayKey,
                    data: data || {}
                }))
            );
        });
    });
    const recepResults = await Promise.all(recepPromises);
    
    const staffDataPromises = receptionists.map(async (u) => {
        const rId = u.id;
        const [attendanceRecords, notes, cancelledShifts] = await Promise.all([
            DBService.getMonthlyAttendance(monthStr, rId),
            DBService.getDailyNotes(rId),
            DBService.getCancelledShifts(monthStr, rId)
        ]);
        return {
            id: rId,
            user: u,
            attendanceRecords,
            notes,
            cancelledShifts
        };
    });
    const staffDataList = await Promise.all(staffDataPromises);
    
    const results = [];
    staffDataList.forEach(item => {
        const rId = item.id;
        const u = item.user;
        const attendanceRecords = item.attendanceRecords || [];
        const notes = item.notes || {};
        const cancelledShifts = item.cancelledShifts || [];
        
        const receptionistShiftsMap = {};
        const SHIFT_LABELS = { morning: 'SÁNG', afternoon: 'CHIỀU', evening: 'TỐI' };
        const SHIFT_KEYS = ['morning', 'afternoon', 'evening'];
        const DAY_KEYS_MAP = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month, d);
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const monday = getMonday(dateObj);
            const mondayKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

            const dayOfWeek = dateObj.getDay();
            const dayIdx = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            const dayKey = DAY_KEYS_MAP[dayIdx];

            recepResults.forEach(result => {
                if (result.mondayKey !== mondayKey) return;

                SHIFT_KEYS.forEach(shiftKey => {
                    const shiftData = result.data[shiftKey];
                    if (!shiftData || !shiftData[dayKey]) return;

                    const staffList = shiftData[dayKey];
                    const staffEntry = staffList.find(s => s.id === rId);
                    if (!staffEntry) return;

                    if (!receptionistShiftsMap[dateStr]) receptionistShiftsMap[dateStr] = [];

                    const branchConfig = shiftConfigMap[result.branch] || {};
                    const weekShiftConfig = result.data?._shiftConfig?.[shiftKey];
                    const defaultStart = staffEntry.customStart || weekShiftConfig?.start || branchConfig[shiftKey]?.start || '07:00';
                    const defaultEnd = staffEntry.customEnd || weekShiftConfig?.end || branchConfig[shiftKey]?.end || '11:30';

                    receptionistShiftsMap[dateStr].push({
                        shift: shiftKey,
                        label: SHIFT_LABELS[shiftKey],
                        start: staffEntry.customStart || defaultStart,
                        end: staffEntry.customEnd || defaultEnd,
                        branch: result.branch,
                        isFixedShift: staffEntry.isFixedShift ? true : false
                    });
                });
            });
        }
        
        const attendanceMap = {};
        attendanceRecords.forEach(record => {
            if (record.date) {
                attendanceMap[record.date] = record.sessions || [];
            }
        });
        
        const allChips = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dailySchedule = {};
            const dailyAttendance = attendanceMap[dateStr] || [];
            const dailyReceptionistShifts = receptionistShiftsMap[dateStr] || [];

            const chips = calculateDailyChips(dailySchedule, dailyAttendance, rId, dateStr, u, dailyReceptionistShifts, {}, cancelledShifts, {});
            chips.forEach(c => {
                if (c.class !== 'chip-future' && !c.isCenterOff) {
                    allChips.push(c);
                }
            });
        }
        
        let fixedWorkedMinutes = 0;
        let normalWorkedMinutes = 0;
        let hasCs2Shift = false;
        let fixedWorkedMinutesCs2 = 0;
        let normalWorkedMinutesCs2 = 0;

        allChips.forEach(chip => {
            const isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
            if (!isTiepTan) return;
            if (chip.class === 'chip-gray') return;
            
            const isCs2 = chip.branch === 'cs2' || chip.sessionData?.branch === 'cs2' || (chip.mergedSegments && chip.mergedSegments.some(s => s.branch === 'cs2' || s.lop?.includes('CS2')));
            if (isCs2) {
                hasCs2Shift = true;
            }

            if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                chip.mergedSegments.forEach(seg => {
                    const segMins = seg.schedMinutes || 0;
                    const segIsCs2 = seg.branch === 'cs2' || seg.lop?.includes('CS2') || chip.branch === 'cs2';
                    if (seg.isFixedShift) {
                        fixedWorkedMinutes += segMins;
                        if (segIsCs2) fixedWorkedMinutesCs2 += segMins;
                    } else {
                        normalWorkedMinutes += segMins;
                        if (segIsCs2) normalWorkedMinutesCs2 += segMins;
                    }
                });
            } else {
                const mins = chip.paidMinutes || 0;
                if (chip.isFixedShift) {
                    fixedWorkedMinutes += mins;
                    if (isCs2) fixedWorkedMinutesCs2 += mins;
                } else {
                    normalWorkedMinutes += mins;
                    if (isCs2) normalWorkedMinutesCs2 += mins;
                }
            }
        });
        
        const staffSettings = allMonthlySettings[rId] || {};
        const roleSettings = staffSettings.tiep_tan || staffSettings['tiep-tan'] || {};
        
        // Calculate dynamic fixed shift factor (Excel formula scaled dynamically)
        const fixedFactor = getRecepDynamicFixedFactor(allChips);
        
        // Calculate dynamic performance factor (based on base salary hourly rate)
        const cfg = u.salary_config || {};
        const classRates = roleSettings.class_rates || cfg.class_rates || {};
        let normalRate = classRates["Tiếp Tân (Ca Bình Thường)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Bình Thường)"]) : Number(cfg.receptionist_normal_rate || 0);
        let attFactor = roleSettings.attendance_factor !== undefined ? roleSettings.attendance_factor : getPerformanceFactorByRate(normalRate);
        if (normalRate > 0 && normalRate < 22000) {
            attFactor = 0.0;
        }
        const respFactor = roleSettings.responsibility_factor !== undefined ? roleSettings.responsibility_factor : 1.0;
        
        const A_j = fixedWorkedMinutes / 60;
        const B_j = normalWorkedMinutes / 60;
        const C_j = parseFloat(((A_j * fixedFactor + B_j * 1) * attFactor * respFactor).toFixed(1));
        
        const A_j_cs2 = fixedWorkedMinutesCs2 / 60;
        const B_j_cs2 = normalWorkedMinutesCs2 / 60;
        const C_j_cs2 = parseFloat(((A_j_cs2 * fixedFactor + B_j_cs2 * 1) * attFactor * respFactor).toFixed(1));
        
        results.push({
            id: rId,
            name: u.name || u.username,
            C_j,
            C_j_cs2,
            hasCs2Shift
        });
    });
    
    window.allReceptionistsData = results;
    console.log('[Redistribution] Computed cống hiến point for receptionists:', results);
    calculateSalary();
}

// Expose modal handlers to window scope
window.openClassRateModal = openClassRateModal;
window.closeClassRateModal = closeClassRateModal;
window.recalculateSalaryModal = recalculateSalaryModal;
window.saveSalarySettingsFromModal = saveSalarySettingsFromModal;
window.toggleModalCalculationRole = toggleModalCalculationRole;
window.switchSalaryModalTab = switchSalaryModalTab;
window.exportSalaryPDFFromModal = exportSalaryPDFFromModal;

// Expose receptionist collective bonus pool functions to window scope
window.toggleRecepBonusConfigUI = toggleRecepBonusConfigUI;
window.closeRecepBonusConfigUI = closeRecepBonusConfigUI;
window.saveRecepBonusConfigUI = saveRecepBonusConfigUI;
window.removeRecepCenterTier = removeRecepCenterTier;
window.removeRecepCs2Tier = removeRecepCs2Tier;
window.loadAndComputeAllReceptionists = loadAndComputeAllReceptionists;

async function saveRecepExtras() {
    const staffId = document.getElementById('staff-select').value;
    if (!staffId || staffId === 'all') {
        alert("Vui lòng chọn nhân viên Tiếp Tân!");
        return;
    }
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    const roleKey = 'tiep_tan';
    
    const btn = document.querySelector('#pdf-tieptan-inputs button');
    let btnOriginalHtml = '';
    if (btn) {
        btn.disabled = true;
        btnOriginalHtml = btn.innerHTML;
        btn.innerHTML = 'Đang lưu...';
    }
    
    try {
        // 1. Get the current monthly settings from DB to prevent wiping other data
        const monthlySettings = await DBService.getMonthlySalarySettings(staffId, monthStr) || {};
        let settings = monthlySettings[roleKey] || monthlySettings[roleKey.replace('_', '-')] || {};
        if (Object.keys(settings).length === 0) {
            // Check if they are a pure receptionist
            const user = window.currentUserContext;
            let hasReceptionist = false;
            let hasTeaching = false;
            if (user) {
                const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
                hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
                hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
            }
            const isPureRecep = hasReceptionist && !hasTeaching;
            if (isPureRecep) {
                settings = await DBService.getSalarySettings(staffId) || {};
            } else {
                settings = { evaluation: [] };
            }
        }
        
        // 2. Read new values from inputs
        const phiTuVanVal = parseFormattedNumber(document.getElementById('pdf-phi-tu-van')?.value || '0');
        const doanhThuCs3Val = parseFormattedNumber(document.getElementById('pdf-doanh-thu-cs3')?.value || '0');
        
        // 3. Update or initialize the evaluation array
        if (!settings.evaluation) {
            settings.evaluation = [];
        }
        
        // Find or create Phí tư vấn (id: 1)
        let phiTuVanObj = settings.evaluation.find(e => e.id === 1);
        if (phiTuVanObj) {
            phiTuVanObj.amount = phiTuVanVal;
        } else {
            settings.evaluation.push({ id: 1, amount: phiTuVanVal, note: '' });
        }
        
        // Find or create Thưởng DT CS3 (id: 6)
        let doanhThuCs3Obj = settings.evaluation.find(e => e.id === 6);
        if (doanhThuCs3Obj) {
            doanhThuCs3Obj.amount = doanhThuCs3Val;
        } else {
            settings.evaluation.push({ id: 6, amount: doanhThuCs3Val, note: '' });
        }
        
        // 4. Save back to Firestore
        const firestorePayload = {};
        firestorePayload[roleKey] = settings;
        await DBService.saveMonthlySalarySettings(staffId, monthStr, firestorePayload);
        
        // 5. Update local cache/state
        monthlySettings[roleKey] = settings;
        monthlySettings[roleKey.replace('_', '-')] = settings;
        window.currentMonthlySalarySettingsAll = monthlySettings;
        
        const user = window.currentUserContext;
        let hasReceptionist = false;
        let hasTeaching = false;
        if (user) {
            const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
            hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
            hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
        }
        const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
        const activeFilter = (filterVal === 'tiep-tan') || (filterVal === 'all' && hasReceptionist && !hasTeaching) ? 'tiep-tan' : 'giao-vien';
        const loadedRoleKey = activeFilter === 'tiep-tan' ? 'tiep_tan' : 'giao_vien';
        
        if (loadedRoleKey === 'tiep_tan') {
            window.currentLoadedSalarySettings = settings;
            
            // Update DOM inputs if they exist (in case admin is viewing and has the table rendered)
            const phiTuVanEvalAmt = document.querySelector(`.eval-amount[data-index="1"]`);
            if (phiTuVanEvalAmt) phiTuVanEvalAmt.value = formatNumberWithCommas(phiTuVanVal);
            
            const doanhThuCs3EvalAmt = document.querySelector(`.eval-amount[data-index="6"]`);
            if (doanhThuCs3EvalAmt) doanhThuCs3EvalAmt.value = formatNumberWithCommas(doanhThuCs3Val);
        }
        
        UIService.toast('Đã lưu thông tin bổ sung thành công!', 'success');
        calculateSalary();
        await saveCalculationDraftToDb(staffId, monthStr);
    } catch (e) {
        console.error('Error saving receptionist extras:', e);
        UIService.toast('Lỗi khi lưu thông tin: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = btnOriginalHtml || '<i data-lucide="save" style="width: 14px; height: 14px;"></i> Lưu Thông Tin';
            if (window.lucide) window.lucide.createIcons();
        }
    }
}
window.saveRecepExtras = saveRecepExtras;

// ==========================================
// SALARY PUBLISHING & RECEIPTS DASHBOARD (Item 1 & 2)
// ==========================================

async function publishSalary() {
    const staffId = document.getElementById('staff-select').value;
    if (!staffId || staffId === 'all') return;
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    // Get netPay, advance, baseSalary, etc.
    const netPayText = document.getElementById('final-salary-display')?.innerText || '0';
    const netPay = parseFormattedNumber(netPayText);
    const advance = parseFormattedNumber(document.getElementById('salary-advance')?.value || '0');
    
    // Base salary (window.currentMonthSalary has the calculated base salary)
    const baseSalary = window.currentMonthSalary || 0;
    
    // Total bonus is the sum of evalAmounts
    let totalBonus = 0;
    document.querySelectorAll('.eval-amount').forEach(input => {
        totalBonus += parseFormattedNumber(input.value) || 0;
    });
    
    // Penalties (VDX, VKP, Late)
    const loadedSettings = window.currentLoadedSalarySettings || {};
    const penalties = {
        vdx: Number(loadedSettings.adjust_vdx || 0),
        vkp: Number(loadedSettings.adjust_vkp || 0),
        late: Number(loadedSettings.adjust_late || 0)
    };
    
    // Stats: workedShifts, lateCount, etc.
    const stats = {
        workedShifts: window.normalWorkedCount || 0,
        fixedWorkedShifts: window.fixedWorkedCount || 0,
        vdxShifts: window.fixedAbsentCount2 || 0,
        vkpShifts: window.normalAbsentCount || 0
    };
    
    // Breakdown: window.currentSubjectBreakdown (array of subjects)
    const breakdown = window.currentSubjectBreakdown || [];
    
    // Message/Note
    const message = document.getElementById('pdf-message')?.value || '';
    
    // Determine role & build full detailed payloads
    const user = window.currentUserContext;
    let hasReceptionist = false;
    let hasTeaching = false;
    if (user) {
        const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
        hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
        hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
    }
    
    let payloadGV = null;
    let payloadTT = null;
    if (hasTeaching) {
        payloadGV = getCurrentCalculationPayload('giao-vien');
    }
    if (hasReceptionist) {
        payloadTT = getCurrentCalculationPayload('tiep-tan');
    }

    const payload = {
        role: hasTeaching && hasReceptionist ? 'dual' : (hasReceptionist ? 'tiep-tan' : 'giao-vien'),
        receivedAt: null,
        confirmedBy: null
    };

    if (hasTeaching && hasReceptionist) {
        const hasRecepWork = payloadTT && (payloadTT.details.filteredMinutes > 0 || payloadTT.netPay > 0);
        const hasTeachingWork = payloadGV && (payloadGV.details.totalBaseMins > 0 || payloadGV.details.totalTinHocMins > 0 || payloadGV.details.totalExtraMins > 0 || payloadGV.details.totalPreschoolMins > 0 || payloadGV.details.totalAffiliateMins > 0 || payloadGV.details.totalTutoringMins > 0 || payloadGV.netPay > 0);

        payload.details_gv = hasTeachingWork ? { ...payloadGV.details, netPay: payloadGV.netPay } : null;
        payload.details_tt = hasRecepWork ? { ...payloadTT.details, netPay: payloadTT.netPay } : null;
        
        // Default fallback if both are empty
        if (!payload.details_gv && !payload.details_tt) {
            const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
            const activeFilter = (filterVal === 'tiep-tan') || (filterVal === 'all' && hasReceptionist && !hasTeaching) ? 'tiep-tan' : 'giao-vien';
            if (activeFilter === 'tiep-tan') {
                payload.details_tt = payloadTT ? { ...payloadTT.details, netPay: payloadTT.netPay } : null;
            } else {
                payload.details_gv = payloadGV ? { ...payloadGV.details, netPay: payloadGV.netPay } : null;
            }
        }

        payload.netPay = (payload.details_gv ? payloadGV.netPay : 0) + (payload.details_tt ? payloadTT.netPay : 0);
        payload.baseSalary = (payload.details_gv ? payloadGV.baseSalary : 0) + (payload.details_tt ? payloadTT.baseSalary : 0);
        payload.totalBonus = (payload.details_gv ? payloadGV.totalBonus : 0) + (payload.details_tt ? payloadTT.totalBonus : 0);
        payload.advance = (payload.details_gv ? payloadGV.advance : 0) + (payload.details_tt ? payloadTT.advance : 0);

        payload.penalties = {
            vdx: (hasTeachingWork ? (payloadGV?.penalties?.vdx || 0) : 0) + (hasRecepWork ? (payloadTT?.penalties?.vdx || 0) : 0),
            vkp: (hasTeachingWork ? (payloadGV?.penalties?.vkp || 0) : 0) + (hasRecepWork ? (payloadTT?.penalties?.vkp || 0) : 0),
            late: (hasTeachingWork ? (payloadGV?.penalties?.late || 0) : 0) + (hasRecepWork ? (payloadTT?.penalties?.late || 0) : 0)
        };
        payload.stats = {
            workedShifts: (hasTeachingWork ? (payloadGV?.stats?.workedShifts || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.workedShifts || 0) : 0),
            vpShifts: (hasTeachingWork ? (payloadGV?.stats?.vpShifts || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.vpShifts || 0) : 0),
            vdxShifts: (hasTeachingWork ? (payloadGV?.stats?.vdxShifts || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.vdxShifts || 0) : 0),
            vkpShifts: (hasTeachingWork ? (payloadGV?.stats?.vkpShifts || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.vkpShifts || 0) : 0),
            lateCount: (hasTeachingWork ? (payloadGV?.stats?.lateCount || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.lateCount || 0) : 0),
            totalLateMinutes: (hasTeachingWork ? (payloadGV?.stats?.totalLateMinutes || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.totalLateMinutes || 0) : 0)
        };
        payload.breakdown = payloadGV?.breakdown || [];
        payload.details = payload.details_gv || payload.details_tt || null;
    } else if (hasReceptionist) {
        payload.netPay = payloadTT.netPay;
        payload.baseSalary = payloadTT.baseSalary;
        payload.totalBonus = payloadTT.totalBonus;
        payload.advance = payloadTT.advance;
        payload.penalties = payloadTT.penalties;
        payload.stats = payloadTT.stats;
        payload.breakdown = [];
        payload.details_tt = { ...payloadTT.details, netPay: payloadTT.netPay };
        payload.details = { ...payloadTT.details, netPay: payloadTT.netPay };
    } else {
        payload.netPay = payloadGV.netPay;
        payload.baseSalary = payloadGV.baseSalary;
        payload.totalBonus = payloadGV.totalBonus;
        payload.advance = payloadGV.advance;
        payload.penalties = payloadGV.penalties;
        payload.stats = payloadGV.stats;
        payload.breakdown = payloadGV.breakdown;
        payload.details_gv = { ...payloadGV.details, netPay: payloadGV.netPay };
        payload.details = { ...payloadGV.details, netPay: payloadGV.netPay };
    }

    const activePayload = (hasReceptionist && !hasTeaching) ? payloadTT : payloadGV;
    if (activePayload && activePayload.message) {
        payload.message = activePayload.message;
    } else {
        payload.message = message;
    }
    
    try {
        UIService.showLoading();
        await DBService.publishSalary(staffId, monthStr, payload);
        UIService.toast('Gửi bảng lương thành công!', 'success');
        
        // Reload settings to update UI
        await loadSalarySettings();
    } catch (e) {
        console.error('Error publishing salary:', e);
        UIService.toast('Gửi bảng lương thất bại: ' + e.message, 'error');
    } finally {
        UIService.hideLoading();
    }
}

async function loadSalaryDashboard() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    try {
        UIService.showLoading();
        const allSettings = await DBService.getAllMonthlySalarySettings(monthStr);
        window.currentMonthAllSettings = allSettings || {};
        renderSalaryDashboardTable();
    } catch (e) {
        console.error("Error loading salary dashboard:", e);
        UIService.toast("Lỗi khi tải dữ liệu dashboard: " + e.message, "error");
    } finally {
        UIService.hideLoading();
    }
}

function renderSalaryDashboardTable() {
    const tableBody = document.getElementById('dash-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    const staffList = window._allStaffList || [];
    const allSettings = window.currentMonthAllSettings || {};
    
    let totalPayroll = 0;
    let totalPaid = 0;
    let totalUnpaid = 0;
    
    const searchText = (document.getElementById('dash-search')?.value || '').toLowerCase().trim();
    const statusFilter = document.getElementById('dash-filter-status')?.value || 'all';
    const roleFilter = document.getElementById('dash-filter-role')?.value || 'all';
    
    const rows = [];
    
    staffList.forEach(u => {
        const name = (u.name || '').toLowerCase();
        const username = (u.username || '').toLowerCase();
        const msnv = (u.msnvStr || '').toLowerCase();
        
        if (searchText && !name.includes(searchText) && !username.includes(searchText) && !msnv.includes(searchText)) {
            return;
        }
        
        const uRoles = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role || ''];
        const isTeacher = uRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
        const isRecep = uRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
        
        let primaryRole = 'Staff';
        if (isTeacher && isRecep) primaryRole = 'Dual (GV & TT)';
        else if (isTeacher) primaryRole = 'Giáo Viên';
        else if (isRecep) primaryRole = 'Tiếp Tân';
        
        if (roleFilter === 'giao-vien' && !isTeacher) return;
        if (roleFilter === 'tiep-tan' && !isRecep) return;
        
        const docData = allSettings[u.id] || {};
        const pub = docData.published;
        
        let status = 'uncalculated';
        let baseSalary = 0;
        let totalBonus = 0;
        let advance = 0;
        let netPay = 0;
        let infoStr = '—';
        let statusBadge = '';
        
        if (pub) {
            status = pub.status || 'published';
            baseSalary = pub.baseSalary || 0;
            totalBonus = pub.totalBonus || 0;
            advance = pub.advance || 0;
            netPay = pub.netPay || 0;
            
            totalPayroll += netPay;
            if (status === 'received') {
                totalPaid += netPay;
            } else {
                totalUnpaid += netPay;
            }
            
            if (status === 'received') {
                const date = new Date(pub.receivedAt);
                const dateStr = isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN');
                const by = pub.confirmedBy === 'admin' ? 'Admin' : 'Nhân viên';
                infoStr = `<div style="font-size:0.8rem;color:#059669;font-weight:600;">Nhận: ${dateStr}</div><div style="font-size:0.7rem;color:#6B7280;">Bởi: ${by}</div>`;
                
                statusBadge = `<span style="background:#D1FAE5;color:#065F46;border:1px solid #10B981;padding:4px 8px;border-radius:9999px;font-size:0.75rem;font-weight:700;">Đã nhận</span>`;
            } else {
                const date = new Date(pub.publishedAt);
                const dateStr = isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN');
                infoStr = `<div style="font-size:0.8rem;color:#1E40AF;font-weight:600;">Gửi: ${dateStr}</div>`;
                
                statusBadge = `<span style="background:#DBEAFE;color:#1E40AF;border:1px solid #3B82F6;padding:4px 8px;border-radius:9999px;font-size:0.75rem;font-weight:700;">Đã gửi</span>`;
            }
        } else {
            statusBadge = `<span style="background:#F3F4F6;color:#4B5563;border:1px solid #D1D5DB;padding:4px 8px;border-radius:9999px;font-size:0.75rem;font-weight:700;">Chưa gửi</span>`;
        }
        
        if (statusFilter !== 'all' && status !== statusFilter) {
            return;
        }
        
        rows.push({
            user: u,
            primaryRole: primaryRole,
            baseSalary: baseSalary,
            totalBonus: totalBonus,
            advance: advance,
            netPay: netPay,
            status: status,
            statusBadge: statusBadge,
            infoStr: infoStr
        });
    });
    
    document.getElementById('dash-total-payroll').innerText = formatNumberWithCommas(totalPayroll) + 'đ';
    document.getElementById('dash-total-paid').innerText = formatNumberWithCommas(totalPaid) + 'đ';
    document.getElementById('dash-total-unpaid').innerText = formatNumberWithCommas(totalUnpaid) + 'đ';
    
    if (rows.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" style="padding:2rem;text-align:center;color:#9CA3AF;">Không tìm thấy kết quả phù hợp</td></tr>`;
        return;
    }
    
    tableBody.innerHTML = rows.map(row => {
        const u = row.user;
        const color = u.scheduleColor || '#E5E7EB';
        const initial = (u.name || u.username || '?').charAt(0).toUpperCase();
        
        let actionButtons = '';
        if (row.status === 'published') {
            actionButtons = `
                <button class="btn btn-sm btn-primary" onclick="adminConfirmPaid('${u.id}')" style="background:#10B981;color:white;border:none;padding:4px 8px;font-size:0.75rem;font-weight:700;border-radius:4px;cursor:pointer;">
                    Đã chi
                </button>
                <button class="btn btn-sm" onclick="viewPersonalReportFromDash('${u.id}')" style="background:#EEF2FF;color:#4338CA;border:1px solid #C7D2FE;padding:4px 8px;font-size:0.75rem;font-weight:700;border-radius:4px;cursor:pointer;margin-left:4px;">
                    Chi tiết
                </button>
            `;
        } else if (row.status === 'received') {
            actionButtons = `
                <button class="btn btn-sm" onclick="viewPersonalReportFromDash('${u.id}')" style="background:#EEF2FF;color:#4338CA;border:1px solid #C7D2FE;padding:4px 8px;font-size:0.75rem;font-weight:700;border-radius:4px;cursor:pointer;">
                    Chi tiết
                </button>
            `;
        } else {
            actionButtons = `
                <button class="btn btn-sm btn-primary" onclick="viewPersonalReportFromDash('${u.id}')" style="background:#3B82F6;color:white;border:none;padding:4px 8px;font-size:0.75rem;font-weight:700;border-radius:4px;cursor:pointer;">
                    Tính & Gửi
                </button>
            `;
        }
        
        return `
            <tr style="border-bottom:1px solid var(--border-color);font-size:0.9rem;">
                <td style="padding:0.75rem 0.75rem;display:flex;align-items:center;gap:0.5rem;">
                    <div style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;color:white;">${initial}</div>
                    <div>
                        <div style="font-weight:600;color:var(--text-color);">${u.name || u.username}</div>
                        <div style="font-size:0.7rem;color:#9CA3AF;">MSNV: ${u.username || '—'}</div>
                    </div>
                </td>
                <td style="padding:0.75rem 0.75rem;color:#4B5563;font-weight:500;">${row.primaryRole}</td>
                <td style="padding:0.75rem 0.75rem;text-align:right;color:#374151;">${row.baseSalary > 0 ? formatNumberWithCommas(row.baseSalary) + 'đ' : '—'}</td>
                <td style="padding:0.75rem 0.75rem;text-align:right;color:#374151;">${row.totalBonus > 0 ? formatNumberWithCommas(row.totalBonus) + 'đ' : '—'}</td>
                <td style="padding:0.75rem 0.75rem;text-align:right;color:#EF4444;">${row.advance > 0 ? '-' + formatNumberWithCommas(row.advance) + 'đ' : '—'}</td>
                <td style="padding:0.75rem 0.75rem;text-align:right;font-weight:700;color:var(--primary-color);">${row.netPay > 0 ? formatNumberWithCommas(row.netPay) + 'đ' : '—'}</td>
                <td style="padding:0.75rem 0.75rem;text-align:center;">${row.statusBadge}</td>
                <td style="padding:0.75rem 0.75rem;">${row.infoStr}</td>
                <td style="padding:0.75rem 0.75rem;text-align:center;">
                    <div style="display:flex;justify-content:center;gap:4px;">
                        ${actionButtons}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function adminConfirmPaid(staffId) {
    if (!confirm("Xác nhận chi tiền mặt cho nhân viên này?")) return;
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    try {
        UIService.showLoading();
        await DBService.confirmSalaryReceived(staffId, monthStr, 'admin');
        UIService.toast('Xác nhận đã chi thành công!', 'success');
        await loadSalaryDashboard();
    } catch (e) {
        console.error("Error confirming paid:", e);
        UIService.toast("Lỗi khi xác nhận chi: " + e.message, "error");
    } finally {
        UIService.hideLoading();
    }
}

function viewPersonalReportFromDash(staffId) {
    const select = document.getElementById('staff-select');
    if (select) {
        select.value = staffId;
        const targetUser = (window._allStaffList || []).find(u => u.id === staffId);
        if (targetUser) {
            selectStaffFromDropdown(targetUser);
        }
    }
    switchAdminTab('personal');
}

function switchAdminTab(tab) {
    const personalBtn = document.getElementById('tab-personal-report');
    const dashBtn = document.getElementById('tab-salary-dashboard');
    const personalView = document.getElementById('personal-report-view');
    const dashView = document.getElementById('salary-dashboard-view');
    const personalHeaderControls = document.getElementById('personal-specific-header-controls');
    const totalHoursDisplay = document.getElementById('total-hours-display');
    const pageTitle = document.getElementById('page-title');
    
    if (!personalBtn || !dashBtn || !personalView || !dashView) return;
    
    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    let roles = [];
    try { roles = JSON.parse(roleRaw); if(!Array.isArray(roles)) roles = [roleRaw]; } catch(e) { roles = [roleRaw]; }
    const isSalaryAdmin = roles.includes('admin');
    
    if (tab === 'personal') {
        personalBtn.classList.add('active');
        personalBtn.style.color = 'var(--primary-color)';
        personalBtn.style.borderBottomColor = 'var(--primary-color)';
        
        dashBtn.classList.remove('active');
        dashBtn.style.color = 'var(--text-muted)';
        dashBtn.style.borderBottomColor = 'transparent';
        
        personalView.style.display = 'block';
        dashView.style.display = 'none';
        
        if (personalHeaderControls) personalHeaderControls.style.display = 'inline-flex';
        if (totalHoursDisplay) totalHoursDisplay.style.display = 'block';
        if (pageTitle) pageTitle.innerText = isSalaryAdmin ? 'Tính Lương & Duyệt Công' : 'Duyệt Công Nhân Viên';
    } else {
        dashBtn.classList.add('active');
        dashBtn.style.color = 'var(--primary-color)';
        dashBtn.style.borderBottomColor = 'var(--primary-color)';
        
        personalBtn.classList.remove('active');
        personalBtn.style.color = 'var(--text-muted)';
        personalBtn.style.borderBottomColor = 'transparent';
        
        personalView.style.display = 'none';
        dashView.style.display = 'block';
        
        if (personalHeaderControls) personalHeaderControls.style.display = 'none';
        if (totalHoursDisplay) totalHoursDisplay.style.display = 'none';
        if (pageTitle) pageTitle.innerText = 'Dashboard Nhận Lương';
        
        loadSalaryDashboard();
    }
}

// Bind to window for global access
window.publishSalary = publishSalary;
window.loadSalaryDashboard = loadSalaryDashboard;
window.adminConfirmPaid = adminConfirmPaid;
window.viewPersonalReportFromDash = viewPersonalReportFromDash;
window.switchAdminTab = switchAdminTab;
window.filterDashboardTable = renderSalaryDashboardTable;

// ==========================================
// BULK PAYROLL PUBLISHING FUNCTIONS (NEW)
// ==========================================

function getCurrentCalculationPayload(role) {
    const user = window.currentUserContext;
    let hasReceptionist = false;
    let hasTeaching = false;
    if (user) {
        const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
        hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
        hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
    }
    
    const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
    const activeFilter = (filterVal === 'tiep-tan') || (filterVal === 'all' && hasReceptionist && !hasTeaching) ? 'tiep-tan' : 'giao-vien';
    const isActiveRole = (role === activeFilter);
    
    const monthlyAll = window.currentMonthlySalarySettingsAll || {};
    const roleKey = role === 'tiep-tan' ? 'tiep_tan' : 'giao_vien';
    const roleSettings = monthlyAll[roleKey] || monthlyAll[roleKey.replace('_', '-')] || {};
    
    // 1. Advance
    let advance = 0;
    if (isActiveRole) {
        advance = parseFormattedNumber(document.getElementById('salary-advance')?.value || '0');
    } else {
        advance = Number(roleSettings.advance || 0);
    }
    
    // 2. Evaluation Items & totalBonus
    let totalBonus = 0;
    const evalItems = [];
    const activeCriteria = role === 'tiep-tan' 
        ? RECEP_EVALUATION_CRITERIA 
        : (typeof EVALUATION_CRITERIA !== 'undefined' ? EVALUATION_CRITERIA : window.EVALUATION_CRITERIA);
    
    // Helper to calculate receptionist attendance rate dynamically
    const getRecepAttBonus = (mins) => {
        const cfg = window.currentUserContext?.salary_config || {};
        const attRate = Number(cfg.attendance_rate || 0);
        return Math.round((mins / 60) * attRate);
    };

    const getRecepAttNote = (mins) => {
        const cfg = window.currentUserContext?.salary_config || {};
        const attRate = Number(cfg.attendance_rate || 0);
        return `Thưởng chuyên cần: ${attRate.toLocaleString()}đ/h x ${(mins / 60).toFixed(1)}h`;
    };

    // First calculate hours and salaries programmatically
    const chips = window.currentMonthChips || [];
    let normalMinutes = 0;
    let fixedMinutes = 0;
    let normalSalary = 0;
    let fixedSalary = 0;
    
    let totalBaseMins = 0;
    let totalBaseSalary = 0;
    let totalTinHocMins = 0;
    let totalTinHocSalary = 0;
    let totalPreschoolMins = 0;
    let totalPreschoolSalary = 0;
    let totalAffiliateMins = 0;
    let totalAffiliateSalary = 0;
    let totalTutoringMins = 0;
    let totalTutoringSalary = 0;
    let totalExtraMins = 0;
    let totalExtraSalary = 0;
    const subjectBreakdown = {};

    chips.forEach(chip => {
        const isReceptionistChip = chip.isReceptionist === true;
        if (!chip.sessionData && !isReceptionistChip) return;
        let include = false;
        
        if (role === 'giao-vien') {
            const roleId = chip.sessionData ? (chip.sessionData.role || '') : '';
            const nameRaw = chip.sessionData ? ((chip.sessionData.roleName || '').toLowerCase()) : '';
            const name = removeVietnameseTones(nameRaw);
            const isReceptionID = ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(roleId);
            if (isReceptionID || name.includes('tiep') || name.includes('le') || name.includes('reception')) {
                include = false;
            } else if (chip.isTeaching || name.includes('gv') || name.includes('giao') || name.includes('tro') || name.includes('ta')) {
                include = true;
            }
        } else if (role === 'tiep-tan') {
            if (isReceptionistChip) {
                include = true;
            } else {
                const roleId = chip.sessionData ? (chip.sessionData.role || '') : '';
                const nameRaw = chip.sessionData ? ((chip.sessionData.roleName || '').toLowerCase()) : '';
                const name = removeVietnameseTones(nameRaw);
                const isReceptionID = ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(roleId);
                if (isReceptionID || name.includes('tiep') || name.includes('le') || name.includes('reception')) {
                    include = true;
                }
            }
        }

        if (include) {
            const minutes = chip.paidMinutes || 0;
            let rate = 0;
            let hasClassRate = false;
            
            const isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
            
            let classRates = {};
            const cfg = window.currentUserContext?.salary_config || {};
            if (isTiepTan) {
                const ttMonthly = monthlyAll['tiep_tan'] || monthlyAll['tiep-tan'] || {};
                classRates = ttMonthly.class_rates || cfg.class_rates || {};
            } else {
                const gvMonthly = monthlyAll['giao_vien'] || monthlyAll['giao-vien'] || {};
                classRates = gvMonthly.class_rates || cfg.class_rates || {};
            }
            
            if (chip.chipFilterName && classRates[chip.chipFilterName] !== undefined && Number(classRates[chip.chipFilterName]) > 0) {
                rate = Number(classRates[chip.chipFilterName]);
                hasClassRate = true;
            }

            if (isTiepTan) {
                let fixedRate = classRates["Tiếp Tân (Ca Cố Định)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Cố Định)"]) : Number(cfg.receptionist_fixed_rate || 0);
                let normalRate = classRates["Tiếp Tân (Ca Bình Thường)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Bình Thường)"]) : Number(cfg.receptionist_normal_rate || 0);
                
                if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                    let remainingMinutes = minutes;
                    const totalSched = chip.mergedSegments.reduce((sum, seg) => sum + (seg.schedMinutes || 0), 0);
                    chip.mergedSegments.forEach((seg, sIdx) => {
                        let segMins = 0;
                        if (totalSched <= 0) {
                            segMins = sIdx === chip.mergedSegments.length - 1 ? remainingMinutes : Math.round(minutes / chip.mergedSegments.length);
                        } else {
                            segMins = Math.round(((seg.schedMinutes || 0) / totalSched) * minutes);
                            if (sIdx === chip.mergedSegments.length - 1) {
                                segMins = remainingMinutes;
                            } else {
                                remainingMinutes -= segMins;
                            }
                        }
                        const segRate = seg.isFixedShift ? fixedRate : normalRate;
                        const segSalary = (segMins / 60) * segRate;
                        
                        if (seg.isFixedShift) {
                            fixedMinutes += segMins;
                            fixedSalary += segSalary;
                        } else {
                            normalMinutes += segMins;
                            normalSalary += segSalary;
                        }
                    });
                } else {
                    const segRate = chip.isFixedShift ? fixedRate : normalRate;
                    const salary = (minutes / 60) * segRate;
                    if (chip.isFixedShift) {
                        fixedMinutes += minutes;
                        fixedSalary += salary;
                    } else {
                        normalMinutes += minutes;
                        normalSalary += salary;
                    }
                }
            } else {
                if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                    let remainingMinutes = minutes;
                    const totalSched = chip.mergedSegments.reduce((sum, seg) => sum + (seg.schedMinutes || 0), 0);
                    
                    chip.mergedSegments.forEach((seg, sIdx) => {
                        let segMins = 0;
                        if (totalSched <= 0) {
                            segMins = sIdx === chip.mergedSegments.length - 1 ? remainingMinutes : Math.round(minutes / chip.mergedSegments.length);
                        } else {
                            if (sIdx === chip.mergedSegments.length - 1) {
                                  segMins = remainingMinutes;
                            } else {
                                  segMins = Math.round(minutes * ((seg.schedMinutes || 0) / totalSched));
                                  remainingMinutes -= segMins;
                            }
                        }
                        
                        const normalizeFn = window.normalizeChipFilterName || (x => x);
                        const segName = normalizeFn(seg.lop);
                        
                        let segRate = 0;
                        if (segName && classRates[segName] !== undefined && Number(classRates[segName]) > 0) {
                            segRate = Number(classRates[segName]);
                        } else {
                            segRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                        }
                        const salary = (segMins / 60) * segRate;
                        
                        if (!subjectBreakdown[segName]) {
                            subjectBreakdown[segName] = { minutes: 0, rate: segRate, amount: 0 };
                        }
                        subjectBreakdown[segName].minutes += segMins;
                        subjectBreakdown[segName].amount += salary;
                        
                        const filterNameRaw = (segName || '').toLowerCase();
                        const filterNameNorm = removeVietnameseTones(filterNameRaw);
                        if (filterNameNorm.includes('tin hoc')) {
                            totalTinHocMins += segMins;
                            totalTinHocSalary += salary;
                        } else if (filterNameNorm.includes('mam non')) {
                            totalPreschoolMins += segMins;
                            totalPreschoolSalary += salary;
                        } else if (filterNameNorm.includes('lien ket')) {
                            totalAffiliateMins += segMins;
                            totalAffiliateSalary += salary;
                        } else if (filterNameNorm.includes('kem 1:1') || filterNameNorm.includes('kem 1-1') || filterNameNorm.includes('tai nha')) {
                            totalTutoringMins += segMins;
                            totalTutoringSalary += salary;
                        } else if (filterNameNorm.includes('soan') || filterNameNorm.includes('cham') || filterNameNorm.includes('su kien') || filterNameNorm.includes('phat sinh')) {
                            totalExtraMins += segMins;
                            totalExtraSalary += salary;
                        } else {
                            totalBaseMins += segMins;
                            totalBaseSalary += salary;
                        }

                        // Split into student count bonus row if studentCount exists and is not rejected!
                        if (chip.studentCount && chip.studentCountStatus !== 'rejected') {
                            const bonusName = `${segName} (+${chip.studentCount} HS)`;
                            let bonusRate = 0;
                            if (classRates[bonusName] !== undefined && Number(classRates[bonusName]) > 0) {
                                bonusRate = Number(classRates[bonusName]);
                            }
                            const hasRejectedChip = (window.unfilteredAllMonthChips || []).some(c => c.studentCountStatus === 'rejected');
                            const isPenaltyActive = !!monthlyAll?.studentCountBonusPenalty || hasRejectedChip;
                            const bonusSalary = isPenaltyActive ? 0 : (segMins / 60) * bonusRate;

                            if (!subjectBreakdown[bonusName]) {
                                subjectBreakdown[bonusName] = { minutes: 0, rate: isPenaltyActive ? 0 : bonusRate, amount: 0 };
                            }
                            subjectBreakdown[bonusName].minutes += segMins;
                            subjectBreakdown[bonusName].amount += bonusSalary;

                            const bFilterNameRaw = (bonusName || '').toLowerCase();
                            const bFilterNameNorm = removeVietnameseTones(bFilterNameRaw);
                            if (bFilterNameNorm.includes('tin hoc')) {
                                totalTinHocMins += segMins;
                                totalTinHocSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('mam non')) {
                                totalPreschoolMins += segMins;
                                totalPreschoolSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('lien ket')) {
                                totalAffiliateMins += segMins;
                                totalAffiliateSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('kem 1:1') || bFilterNameNorm.includes('kem 1-1') || bFilterNameNorm.includes('tai nha')) {
                                totalTutoringMins += segMins;
                                totalTutoringSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('soan') || bFilterNameNorm.includes('cham') || bFilterNameNorm.includes('su kien') || bFilterNameNorm.includes('phat sinh')) {
                                totalExtraMins += segMins;
                                totalExtraSalary += bonusSalary;
                            } else {
                                totalBaseMins += segMins;
                                totalBaseSalary += bonusSalary;
                            }
                        }
                    });
                } else {
                    if (hasClassRate) {
                        const salary = (minutes / 60) * rate;
                        const filterNameRaw = (chip.chipFilterName || '').toLowerCase();
                        const filterNameNorm = removeVietnameseTones(filterNameRaw);
                        if (filterNameNorm.includes('tin hoc')) {
                            totalTinHocMins += minutes;
                            totalTinHocSalary += salary;
                        } else if (filterNameNorm.includes('mam non')) {
                            totalPreschoolMins += minutes;
                            totalPreschoolSalary += salary;
                        } else if (filterNameNorm.includes('lien ket')) {
                            totalAffiliateMins += minutes;
                            totalAffiliateSalary += salary;
                        } else if (filterNameNorm.includes('kem 1:1') || filterNameNorm.includes('kem 1-1') || filterNameNorm.includes('tai nha')) {
                            totalTutoringMins += minutes;
                            totalTutoringSalary += salary;
                        } else if (filterNameNorm.includes('soan') || filterNameNorm.includes('cham') || filterNameNorm.includes('su kien') || filterNameNorm.includes('phat sinh')) {
                            totalExtraMins += minutes;
                            totalExtraSalary += salary;
                        } else {
                            totalBaseMins += minutes;
                            totalBaseSalary += salary;
                        }
                        
                        const segName = chip.chipFilterName || "Chưa phân lớp";
                        if (!subjectBreakdown[segName]) {
                            subjectBreakdown[segName] = { minutes: 0, rate: rate, amount: 0 };
                        }
                        subjectBreakdown[segName].minutes += minutes;
                        subjectBreakdown[segName].amount += salary;

                        // Split into student count bonus row if studentCount exists and is not rejected!
                        if (chip.studentCount && chip.studentCountStatus !== 'rejected') {
                            const bonusName = `${segName} (+${chip.studentCount} HS)`;
                            let bonusRate = 0;
                            if (classRates[bonusName] !== undefined && Number(classRates[bonusName]) > 0) {
                                bonusRate = Number(classRates[bonusName]);
                            }
                            const hasRejectedChip = (window.unfilteredAllMonthChips || []).some(c => c.studentCountStatus === 'rejected');
                            const isPenaltyActive = !!monthlyAll?.studentCountBonusPenalty || hasRejectedChip;
                            const bonusSalary = isPenaltyActive ? 0 : (minutes / 60) * bonusRate;

                            if (!subjectBreakdown[bonusName]) {
                                subjectBreakdown[bonusName] = { minutes: 0, rate: isPenaltyActive ? 0 : bonusRate, amount: 0 };
                            }
                            subjectBreakdown[bonusName].minutes += minutes;
                            subjectBreakdown[bonusName].amount += bonusSalary;

                            const bFilterNameRaw = (bonusName || '').toLowerCase();
                            const bFilterNameNorm = removeVietnameseTones(bFilterNameRaw);
                            if (bFilterNameNorm.includes('tin hoc')) {
                                totalTinHocMins += minutes;
                                totalTinHocSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('mam non')) {
                                totalPreschoolMins += minutes;
                                totalPreschoolSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('lien ket')) {
                                totalAffiliateMins += minutes;
                                totalAffiliateSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('kem 1:1') || bFilterNameNorm.includes('kem 1-1') || bFilterNameNorm.includes('tai nha')) {
                                totalTutoringMins += minutes;
                                totalTutoringSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('soan') || bFilterNameNorm.includes('cham') || bFilterNameNorm.includes('su kien') || bFilterNameNorm.includes('phat sinh')) {
                                totalExtraMins += minutes;
                                totalExtraSalary += bonusSalary;
                            } else {
                                totalBaseMins += minutes;
                                totalBaseSalary += bonusSalary;
                            }
                        }
                    } else {
                        let defaultRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                        const salary = (minutes / 60) * defaultRate;
                        totalBaseMins += minutes;
                        totalBaseSalary += salary;
                        
                        const segName = chip.chipFilterName || "Chưa phân lớp";
                        if (!subjectBreakdown[segName]) {
                            subjectBreakdown[segName] = { minutes: 0, rate: defaultRate, amount: 0 };
                        }
                        subjectBreakdown[segName].minutes += minutes;
                        subjectBreakdown[segName].amount += salary;

                        // Split into student count bonus row if studentCount exists and is not rejected!
                        if (chip.studentCount && chip.studentCountStatus !== 'rejected') {
                            const bonusName = `${segName} (+${chip.studentCount} HS)`;
                            let bonusRate = 0;
                            if (classRates[bonusName] !== undefined && Number(classRates[bonusName]) > 0) {
                                bonusRate = Number(classRates[bonusName]);
                            }
                            const hasRejectedChip = (window.unfilteredAllMonthChips || []).some(c => c.studentCountStatus === 'rejected');
                            const isPenaltyActive = !!monthlyAll?.studentCountBonusPenalty || hasRejectedChip;
                            const bonusSalary = isPenaltyActive ? 0 : (minutes / 60) * bonusRate;

                            if (!subjectBreakdown[bonusName]) {
                                subjectBreakdown[bonusName] = { minutes: 0, rate: isPenaltyActive ? 0 : bonusRate, amount: 0 };
                            }
                            subjectBreakdown[bonusName].minutes += minutes;
                            subjectBreakdown[bonusName].amount += bonusSalary;

                            const bFilterNameRaw = (bonusName || '').toLowerCase();
                            const bFilterNameNorm = removeVietnameseTones(bFilterNameRaw);
                            if (bFilterNameNorm.includes('tin hoc')) {
                                totalTinHocMins += minutes;
                                totalTinHocSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('mam non')) {
                                totalPreschoolMins += minutes;
                                totalPreschoolSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('lien ket')) {
                                totalAffiliateMins += minutes;
                                totalAffiliateSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('kem 1:1') || bFilterNameNorm.includes('kem 1-1') || bFilterNameNorm.includes('tai nha')) {
                                totalTutoringMins += minutes;
                                totalTutoringSalary += bonusSalary;
                            } else if (bFilterNameNorm.includes('soan') || bFilterNameNorm.includes('cham') || bFilterNameNorm.includes('su kien') || bFilterNameNorm.includes('phat sinh')) {
                                totalExtraMins += minutes;
                                totalExtraSalary += bonusSalary;
                            } else {
                                totalBaseMins += minutes;
                                totalBaseSalary += bonusSalary;
                            }
                        }
                    }
                }
            }
        }
    });

    const filteredMinutes = normalMinutes + fixedMinutes;
    const baseSalary = role === 'tiep-tan' ? (normalSalary + fixedSalary) : (totalBaseSalary + totalTinHocSalary + totalPreschoolSalary + totalAffiliateSalary + totalTutoringSalary + totalExtraSalary);

    if (isActiveRole) {
        // Read directly from DOM
        document.querySelectorAll('.eval-amount').forEach(inp => {
            const val = parseFormattedNumber(inp.value) || 0;
            const criteriaIndex = parseInt(inp.dataset.index, 10);
            if (isNaN(criteriaIndex)) return;
            const noteInp = document.querySelector(`.eval-note[data-index="${criteriaIndex}"]`);
            
            const item = activeCriteria.find(e => (role === 'tiep-tan' ? e.index === criteriaIndex : activeCriteria.indexOf(e) === criteriaIndex)) || { label: '', tooltip: 'Đánh giá' };
            const displayNote = noteInp ? noteInp.value : '';
            
            evalItems.push({
                id: criteriaIndex,
                label: item.label,
                title: item.tooltip,
                note: displayNote,
                amount: val
            });
        });
    } else {
        // Programmatic calculation from roleSettings (from DB)
        const savedEval = roleSettings.evaluation || [];
        activeCriteria.forEach((item, index) => {
            const criteriaIndex = role === 'tiep-tan' ? item.index : index;
            const rowData = savedEval.find(e => e.id === criteriaIndex) || {};
            let amount = rowData.amount !== undefined ? rowData.amount : (item.default || 0);
            let note = rowData.note || '';
            
            // Special auto-calculated receptionist attendance bonus (HIỆU SUẤT / index: 0)
            if (role === 'tiep-tan' && criteriaIndex === 0) {
                amount = getRecepAttBonus(filteredMinutes);
                const autoNotePrefix = "Thưởng chuyên cần:";
                if (!note || note.startsWith(autoNotePrefix)) {
                    note = getRecepAttNote(filteredMinutes);
                }
            }
            
            evalItems.push({
                id: criteriaIndex,
                label: item.label,
                title: item.tooltip,
                note: note,
                amount: amount
            });
        });
    }
    
    totalBonus = evalItems.reduce((acc, i) => acc + i.amount, 0);
    
    // Với tiếp tân (active role): đảm bảo phí tư vấn và DT CS3 dùng giá trị từ DOM inputs
    // vì eval table có thể hiển thị giá trị cũ chưa sync
    if (role === 'tiep-tan' && isActiveRole) {
        const phiTuVanInput = document.getElementById('pdf-phi-tu-van');
        const doanhThuCs3Input = document.getElementById('pdf-doanh-thu-cs3');
        
        if (phiTuVanInput) {
            const actualPhiTuVan = parseFormattedNumber(phiTuVanInput.value) || 0;
            const existingItem = evalItems.find(e => e.id === 1);
            if (existingItem) {
                totalBonus += (actualPhiTuVan - existingItem.amount);
                existingItem.amount = actualPhiTuVan;
            } else {
                evalItems.push({ id: 1, label: 'III', title: 'PHÍ TƯ VẤN', note: '', amount: actualPhiTuVan });
                totalBonus += actualPhiTuVan;
            }
        }
        if (doanhThuCs3Input) {
            const actualDoanhThuCs3 = parseFormattedNumber(doanhThuCs3Input.value) || 0;
            const existingCs3 = evalItems.find(e => e.id === 6);
            if (existingCs3) {
                totalBonus += (actualDoanhThuCs3 - existingCs3.amount);
                existingCs3.amount = actualDoanhThuCs3;
            } else {
                evalItems.push({ id: 6, label: 'VII', title: 'THƯỞNG DT CS3', note: '', amount: actualDoanhThuCs3 });
                totalBonus += actualDoanhThuCs3;
            }
        }
    }
    
    // For receptionists, add center and cs2 bonuses
    let centerBonus = 0;
    let cs2Bonus = 0;
    if (role === 'tiep-tan') {
        const outputTong = document.getElementById('pdf-doanh-thu-tong');
        const outputCs2 = document.getElementById('pdf-doanh-thu-cs2');
        if (isActiveRole && outputTong && outputCs2) {
            centerBonus = parseFormattedNumber(outputTong.value) || 0;
            cs2Bonus = parseFormattedNumber(outputCs2.value) || 0;
        } else {
            // Programmatically compute from header revenues
            const actualCenterRevenue = parseFormattedNumber(document.getElementById('header-actual-revenue-total')?.value || '0');
            const actualCs2Revenue = parseFormattedNumber(document.getElementById('header-actual-revenue-cs2')?.value || '0');
            let P_tong = 0;
            let P_cs2 = 0;
            if (actualCenterRevenue >= 525000000) P_tong = 7000000;
            else if (actualCenterRevenue >= 500000000) P_tong = 4000000;
            else if (actualCenterRevenue >= 475000000) P_tong = 1500000;
            if (actualCs2Revenue >= 65000000) P_cs2 = 500000;
            
            const staffId = document.getElementById('staff-select').value;
            const currentRecepData = (window.allReceptionistsData || []).find(r => r.id === staffId);
            if (currentRecepData) {
                const sumC = (window.allReceptionistsData || []).reduce((sum, r) => sum + r.C_j, 0);
                if (sumC > 0) {
                    centerBonus = P_tong * (currentRecepData.C_j / sumC);
                }
                const sumC_cs2 = (window.allReceptionistsData || []).filter(r => r.hasCs2Shift).reduce((sum, r) => sum + r.C_j_cs2, 0);
                if (sumC_cs2 > 0 && currentRecepData.hasCs2Shift) {
                    cs2Bonus = P_cs2 * (currentRecepData.C_j_cs2 / sumC_cs2);
                }
            }
            centerBonus = Math.round(centerBonus);
            cs2Bonus = Math.round(cs2Bonus);
        }
        totalBonus += centerBonus + cs2Bonus;
    }
    
    // Penalties (VDX, VKP, Late)
    // Penalties (VDX, VKP, Late)
    const penaltyVDX = Math.round(Number(roleSettings.adjust_vdx || 0));
    const penaltyVKP = Math.round(Number(roleSettings.adjust_vkp || 0));
    const penaltyLate = Math.round(Number(roleSettings.adjust_late || 0));
    const penalties = {
        vdx: penaltyVDX,
        vkp: penaltyVKP,
        late: penaltyLate
    };
    
    const attendanceAdjustments = - penaltyVDX - penaltyVKP - penaltyLate;
    
    const roundedBaseSalary = Math.round(baseSalary);
    const roundedTotalBonus = Math.round(totalBonus);
    const roundedAttendanceAdjustments = Math.round(attendanceAdjustments);
    const roundedAdvance = Math.round(advance);
    const roundedNetPay = roundedBaseSalary + roundedTotalBonus + roundedAttendanceAdjustments - roundedAdvance;
    
    // Stats
    let workedShifts = 0;
    let vpShifts = 0;
    let vdxShifts = 0;
    let vkpShifts = 0;
    let lateCount = 0;
    let totalLateMinutes = 0;
    
    const unfilteredChips = window.unfilteredAllMonthChips || [];
    const notesMap = typeof _cachedStaffNotes !== 'undefined' ? _cachedStaffNotes : {};
    unfilteredChips.forEach(chip => {
        if (chip.class === 'chip-future' || chip.isCenterOff) return;
        
        const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
        if (role === 'tiep-tan' && !isTT) return;
        if (role === 'giao-vien' && isTT) return;
        
        if (chip.class === 'chip-gray' || chip.isVDX || chip.class === 'chip-red') {
            const type = classifyAbsentChip(chip, notesMap);
            if (type === 'VP') vpShifts++;
            else if (type === 'VDX') vdxShifts++;
            else vkpShifts++;
        } else {
            workedShifts++;
        }
        
        const match = chip.text.match(/\(T(\d+)p\)/);
        if (match) {
            lateCount++;
            totalLateMinutes += parseInt(match[1], 10);
        }
    });
    
    const stats = {
        workedShifts: workedShifts,
        vpShifts: vpShifts,
        vdxShifts: vdxShifts,
        vkpShifts: vkpShifts,
        lateCount: lateCount,
        totalLateMinutes: totalLateMinutes
    };
    
    const staffSelect = document.getElementById('staff-select');
    const staffName = staffSelect ? staffSelect.options[staffSelect.selectedIndex]?.text?.split('(')[0]?.trim() : (window.currentUserContext?.name || '');
    
    const details = {
        role: role,
        staffName: staffName,
        employeeId: (window.currentUserContext?.username || '').toUpperCase(),
        baseSalary: roundedBaseSalary,
        advance: roundedAdvance,
        netPay: roundedNetPay,
        totalBonus: roundedTotalBonus,
        attendanceAdjustments: roundedAttendanceAdjustments,
        stats: stats
    };
    
    if (role === 'tiep-tan') {
        const phiTuVan = evalItems.find(item => item.id === 1)?.amount || 0;
        const chamBaiPhatSinh = evalItems.find(item => item.id === 2)?.amount || 0;
        const chamBaiNote = evalItems.find(item => item.id === 2)?.note || '';
        const troCapChucVu = evalItems.find(item => item.id === 3)?.amount || 0;
        const troCapNote = evalItems.find(item => item.id === 3)?.note || '';
        const luongHieuSuat = evalItems.find(item => item.id === 5)?.amount || 0;
        const luongHieuSuatNote = evalItems.find(item => item.id === 5)?.note || '';
        const doanhThuCs3 = evalItems.find(item => item.id === 6)?.amount || 0;
        const criteriaI = evalItems.find(item => item.id === 0);
        const criteriaV = evalItems.find(item => item.id === 4);
        const phatSinh = (criteriaI?.amount || 0) + (criteriaV?.amount || 0);

        details.filteredMinutes = filteredMinutes;
        details.normalMinutes = normalMinutes;
        details.fixedMinutes = fixedMinutes;
        details.phiTuVan = Math.round(phiTuVan);
        details.chamBaiPhatSinh = Math.round(chamBaiPhatSinh);
        details.chamBaiNote = chamBaiNote;
        details.troCapChucVu = Math.round(troCapChucVu);
        details.troCapNote = troCapNote;
        details.luongHieuSuat = Math.round(luongHieuSuat);
        details.luongHieuSuatNote = luongHieuSuatNote;
        details.doanhThuTong = Math.round(centerBonus);
        details.doanhThuCs2 = Math.round(cs2Bonus);
        details.doanhThuCs3 = Math.round(doanhThuCs3);
        details.phatSinh = Math.round(phatSinh);
        details.criteriaI = { amount: Math.round(criteriaI?.amount || 0), note: criteriaI?.note || '' };
        details.criteriaV = { amount: Math.round(criteriaV?.amount || 0), note: criteriaV?.note || '' };
    } else {
        const troCapChucVu = evalItems.find(item => item.id === 3)?.amount || 0;
        const troCapNote = evalItems.find(item => item.id === 3)?.note || '';
        
        details.totalBaseMins = totalBaseMins;
        details.totalBaseSalary = Math.round(totalBaseSalary);
        details.totalTinHocMins = totalTinHocMins;
        details.totalTinHocSalary = Math.round(totalTinHocSalary);
        details.totalExtraMins = totalExtraMins;
        details.totalExtraSalary = Math.round(totalExtraSalary);
        details.totalPreschoolMins = totalPreschoolMins;
        details.totalPreschoolSalary = Math.round(totalPreschoolSalary);
        details.totalAffiliateMins = totalAffiliateMins;
        details.totalAffiliateSalary = Math.round(totalAffiliateSalary);
        details.totalTutoringMins = totalTutoringMins;
        details.totalTutoringSalary = Math.round(totalTutoringSalary);
        details.troCapChucVu = Math.round(troCapChucVu);
        details.troCapNote = troCapNote;
        details.evalItems = evalItems.map(item => ({
            ...item,
            amount: Math.round(item.amount)
        }));
    }
    
    const breakdown = role === 'giao-vien' ? Object.keys(subjectBreakdown).map(subj => {
        return {
            name: subj,
            hours: Number((subjectBreakdown[subj].minutes / 60).toFixed(2)),
            rate: subjectBreakdown[subj].rate,
            amount: Math.round(subjectBreakdown[subj].amount)
        };
    }) : [];
    if (role === 'giao-vien' && isActiveRole) {
        window.currentSubjectBreakdown = breakdown;
    }
    
    const message = document.getElementById('pdf-message')?.value || '';
    
    return {
        role: role,
        netPay: roundedNetPay,
        advance: roundedAdvance,
        baseSalary: roundedBaseSalary,
        totalBonus: roundedTotalBonus,
        penalties: penalties,
        stats: stats,
        breakdown: breakdown,
        message: message,
        receivedAt: null,
        confirmedBy: null,
        details: details
    };
}

async function saveCalculationDraftToDb(staffId, monthStr) {
    if (!staffId || !monthStr) return;
    
    const user = window.currentUserContext;
    let hasReceptionist = false;
    let hasTeaching = false;
    if (user) {
        const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
        hasReceptionist = staffRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
        hasTeaching = staffRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
    }
    
    let payloadGV = null;
    let payloadTT = null;
    
    if (hasTeaching) {
        payloadGV = getCurrentCalculationPayload('giao-vien');
    }
    if (hasReceptionist) {
        payloadTT = getCurrentCalculationPayload('tiep-tan');
    }
    
    try {
        const docId = `${monthStr}_${staffId}`;
        const docSnap = await firebase.firestore().collection('salary_settings_monthly').doc(docId).get();
        let status = 'draft';
        let publishedAt = null;
        let receivedAt = null;
        let confirmedBy = null;
        let existingPublished = {};
        
        if (docSnap.exists) {
            const data = docSnap.data();
            if (data && data.published) {
                existingPublished = data.published;
                const currentStatus = existingPublished.status;
                if (currentStatus === 'published' || currentStatus === 'received') {
                    status = currentStatus;
                }
                publishedAt = existingPublished.publishedAt || null;
                receivedAt = existingPublished.receivedAt || null;
                confirmedBy = existingPublished.confirmedBy || null;
            }
        }
        
        // Build updatedPublished payload
        const updatedPublished = {
            ...existingPublished,
            status: status
        };
        
        if (status === 'published' && publishedAt) {
            updatedPublished.publishedAt = publishedAt;
        } else if (status === 'published') {
            updatedPublished.publishedAt = new Date().toISOString();
        }
        if (receivedAt) updatedPublished.receivedAt = receivedAt;
        if (confirmedBy) updatedPublished.confirmedBy = confirmedBy;
        
        if (hasTeaching && hasReceptionist) {
            // Dual role
            updatedPublished.role = 'dual';
            
            const hasRecepWork = payloadTT && (payloadTT.details.filteredMinutes > 0 || payloadTT.netPay > 0);
            const hasTeachingWork = payloadGV && (payloadGV.details.totalBaseMins > 0 || payloadGV.details.totalTinHocMins > 0 || payloadGV.details.totalExtraMins > 0 || payloadGV.details.totalPreschoolMins > 0 || payloadGV.details.totalAffiliateMins > 0 || payloadGV.details.totalTutoringMins > 0 || payloadGV.netPay > 0);

            updatedPublished.details_gv = hasTeachingWork ? { ...payloadGV.details, netPay: payloadGV.netPay } : null;
            updatedPublished.details_tt = hasRecepWork ? { ...payloadTT.details, netPay: payloadTT.netPay } : null;
            
            // If both are empty, default to active filter role
            if (!updatedPublished.details_gv && !updatedPublished.details_tt) {
                const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
                const activeFilter = (filterVal === 'tiep-tan') || (filterVal === 'all' && hasReceptionist && !hasTeaching) ? 'tiep-tan' : 'giao-vien';
                if (activeFilter === 'tiep-tan') {
                    updatedPublished.details_tt = payloadTT ? { ...payloadTT.details, netPay: payloadTT.netPay } : null;
                } else {
                    updatedPublished.details_gv = payloadGV ? { ...payloadGV.details, netPay: payloadGV.netPay } : null;
                }
            }

            // Combined summary fields
            updatedPublished.netPay = (updatedPublished.details_gv ? payloadGV.netPay : 0) + (updatedPublished.details_tt ? payloadTT.netPay : 0);
            updatedPublished.baseSalary = (updatedPublished.details_gv ? payloadGV.baseSalary : 0) + (updatedPublished.details_tt ? payloadTT.baseSalary : 0);
            updatedPublished.totalBonus = (updatedPublished.details_gv ? payloadGV.totalBonus : 0) + (updatedPublished.details_tt ? payloadTT.totalBonus : 0);
            updatedPublished.advance = (updatedPublished.details_gv ? payloadGV.advance : 0) + (updatedPublished.details_tt ? payloadTT.advance : 0);

            updatedPublished.penalties = {
                vdx: (hasTeachingWork ? (payloadGV?.penalties?.vdx || 0) : 0) + (hasRecepWork ? (payloadTT?.penalties?.vdx || 0) : 0),
                vkp: (hasTeachingWork ? (payloadGV?.penalties?.vkp || 0) : 0) + (hasRecepWork ? (payloadTT?.penalties?.vkp || 0) : 0),
                late: (hasTeachingWork ? (payloadGV?.penalties?.late || 0) : 0) + (hasRecepWork ? (payloadTT?.penalties?.late || 0) : 0)
            };
            updatedPublished.stats = {
                workedShifts: (hasTeachingWork ? (payloadGV?.stats?.workedShifts || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.workedShifts || 0) : 0),
                vpShifts: (hasTeachingWork ? (payloadGV?.stats?.vpShifts || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.vpShifts || 0) : 0),
                vdxShifts: (hasTeachingWork ? (payloadGV?.stats?.vdxShifts || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.vdxShifts || 0) : 0),
                vkpShifts: (hasTeachingWork ? (payloadGV?.stats?.vkpShifts || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.vkpShifts || 0) : 0),
                lateCount: (hasTeachingWork ? (payloadGV?.stats?.lateCount || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.lateCount || 0) : 0),
                totalLateMinutes: (hasTeachingWork ? (payloadGV?.stats?.totalLateMinutes || 0) : 0) + (hasRecepWork ? (payloadTT?.stats?.totalLateMinutes || 0) : 0)
            };
            updatedPublished.breakdown = payloadGV?.breakdown || [];
            updatedPublished.details = updatedPublished.details_gv || updatedPublished.details_tt || null;
        } else if (hasReceptionist) {
            // Receptionist only
            updatedPublished.role = 'tiep-tan';
            updatedPublished.netPay = payloadTT.netPay;
            updatedPublished.baseSalary = payloadTT.baseSalary;
            updatedPublished.totalBonus = payloadTT.totalBonus;
            updatedPublished.advance = payloadTT.advance;
            updatedPublished.penalties = payloadTT.penalties;
            updatedPublished.stats = payloadTT.stats;
            updatedPublished.breakdown = [];
            updatedPublished.details_tt = { ...payloadTT.details, netPay: payloadTT.netPay };
            updatedPublished.details = { ...payloadTT.details, netPay: payloadTT.netPay };
            if (updatedPublished.details_gv) delete updatedPublished.details_gv;
        } else {
            // Teacher only
            updatedPublished.role = 'giao-vien';
            updatedPublished.netPay = payloadGV.netPay;
            updatedPublished.baseSalary = payloadGV.baseSalary;
            updatedPublished.totalBonus = payloadGV.totalBonus;
            updatedPublished.advance = payloadGV.advance;
            updatedPublished.penalties = payloadGV.penalties;
            updatedPublished.stats = payloadGV.stats;
            updatedPublished.breakdown = payloadGV.breakdown;
            updatedPublished.details_gv = { ...payloadGV.details, netPay: payloadGV.netPay };
            updatedPublished.details = { ...payloadGV.details, netPay: payloadGV.netPay };
            if (updatedPublished.details_tt) delete updatedPublished.details_tt;
        }
        
        const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
        const activeFilter = (filterVal === 'tiep-tan') || (filterVal === 'all' && hasReceptionist && !hasTeaching) ? 'tiep-tan' : 'giao-vien';
        const activePayload = activeFilter === 'tiep-tan' ? payloadTT : payloadGV;
        if (activePayload && activePayload.message) {
            updatedPublished.message = activePayload.message;
        }
        
        await firebase.firestore().collection('salary_settings_monthly').doc(docId).set({
            published: updatedPublished
        }, { merge: true });
        
        DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
    } catch (e) {
        console.error('Error saving salary draft:', e);
    }
}

async function openBulkPublishModal() {
    const modal = document.getElementById('bulk-publish-modal');
    if (!modal) return;
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    try {
        UIService.showLoading();
        
        // Invalidate cache first
        DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
        const allSettings = await DBService.getAllMonthlySalarySettings(monthStr);
        window.bulkPublishAllSettings = allSettings;
        
        const teachersList = [];
        const recepsList = [];
        
        const staffList = window._allStaffList || [];
        staffList.forEach(u => {
            const uRoles = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role || ''];
            const isTeacher = uRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
            const isRecep = uRoles.some(r => ['receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(r));
            
            const docData = allSettings[u.id] || {};
            const pub = docData.published;
            
            let status = 'uncalculated';
            let teacherNetPay = 0;
            let recepNetPay = 0;
            
            if (pub && pub.status) {
                status = pub.status;
                if (pub.role === 'dual') {
                    teacherNetPay = pub.details_gv?.netPay || 0;
                    recepNetPay = pub.details_tt?.netPay || 0;
                } else if (pub.role === 'tiep-tan') {
                    recepNetPay = pub.netPay || 0;
                } else {
                    teacherNetPay = pub.netPay || 0;
                }
            }
            
            const isDual = isTeacher && isRecep;
            const showInTeacherList = isTeacher && (!isDual || !pub || pub.details_gv !== null);
            const showInRecepList = isRecep && (!isDual || !pub || pub.details_tt !== null);
            
            if (showInTeacherList) {
                teachersList.push({
                    id: u.id,
                    name: u.name || u.username,
                    msnv: u.msnvStr || '—',
                    status: status,
                    netPay: teacherNetPay
                });
            }
            if (showInRecepList) {
                recepsList.push({
                    id: u.id,
                    name: u.name || u.username,
                    msnv: u.msnvStr || '—',
                    status: status,
                    netPay: recepNetPay
                });
            }
        });
        
        // Render lists
        const teachersContainer = document.getElementById('bulk-list-teachers');
        if (teachersContainer) {
            teachersContainer.innerHTML = '';
            if (teachersList.length === 0) {
                teachersContainer.innerHTML = '<div style="text-align: center; color: #9CA3AF; padding: 2rem; font-size: 0.9rem;">Không có giáo viên/trợ giảng</div>';
            } else {
                teachersList.forEach(item => {
                    teachersContainer.appendChild(createBulkStaffRow(item, 'teachers'));
                });
            }
        }
        
        const recepsContainer = document.getElementById('bulk-list-receps');
        if (recepsContainer) {
            recepsContainer.innerHTML = '';
            if (recepsList.length === 0) {
                recepsContainer.innerHTML = '<div style="text-align: center; color: #9CA3AF; padding: 2rem; font-size: 0.9rem;">Không có tiếp tân</div>';
            } else {
                recepsList.forEach(item => {
                    recepsContainer.appendChild(createBulkStaffRow(item, 'receps'));
                });
            }
        }
        
        // Clear message input
        const messageInput = document.getElementById('bulk-message-input');
        if (messageInput) messageInput.value = '';
        
        // Clear search input and show all rows
        const searchInput = document.getElementById('bulk-search-input');
        if (searchInput) {
            searchInput.value = '';
            filterBulkPublishList('');
        }
        
        // Clear select all checkboxes
        const selAllTeachers = document.getElementById('bulk-select-all-teachers');
        if (selAllTeachers) selAllTeachers.checked = false;
        
        const selAllReceps = document.getElementById('bulk-select-all-receps');
        if (selAllReceps) selAllReceps.checked = false;
        
        modal.style.display = 'flex';
        updateBulkSelectedCount();
        
        if (window.lucide) window.lucide.createIcons();
    } catch (e) {
        console.error('Error loading bulk publish modal:', e);
        UIService.toast('Lỗi khi tải dữ liệu: ' + e.message, 'error');
    } finally {
        UIService.hideLoading();
    }
}

function closeBulkPublishModal() {
    const modal = document.getElementById('bulk-publish-modal');
    if (modal) modal.style.display = 'none';
}

function filterBulkPublishList(query) {
    const cleanQuery = query.trim().toLowerCase();
    const rows = document.querySelectorAll('.bulk-staff-row');
    rows.forEach(row => {
        const name = row.dataset.name || '';
        if (name.includes(cleanQuery)) {
            row.style.display = 'flex';
        } else {
            row.style.display = 'none';
        }
    });
}
window.filterBulkPublishList = filterBulkPublishList;

function createBulkStaffRow(item, group) {
    const row = document.createElement('div');
    row.className = 'bulk-staff-row';
    row.dataset.name = (item.name || '').toLowerCase();
    row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 0.65rem 0.75rem; border: 1px solid #E5E7EB; border-radius: 8px; background: #fff; transition: background 0.2s;';
    
    let isChecked = false;
    let isDisabled = false;
    let statusText = 'Chưa tính';
    let badgeBg = '#F3F4F6';
    let badgeColor = '#4B5563';
    let badgeBorder = '#D1D5DB';
    let netPayStr = '—';
    let payColor = '#9CA3AF';
    
    if (item.status === 'draft') {
        isChecked = true;
        statusText = 'Chưa gửi';
        badgeBg = '#FEF3C7';
        badgeColor = '#D97706';
        badgeBorder = '#FDE68A';
        netPayStr = formatNumberWithCommas(item.netPay) + ' đ';
        payColor = '#D97706';
    } else if (item.status === 'published') {
        statusText = 'Đã gửi';
        badgeBg = '#DBEAFE';
        badgeColor = '#1E40AF';
        badgeBorder = '#3B82F6';
        netPayStr = formatNumberWithCommas(item.netPay) + ' đ';
        payColor = '#1E40AF';
    } else if (item.status === 'received') {
        statusText = 'Đã nhận';
        badgeBg = '#D1FAE5';
        badgeColor = '#065F46';
        badgeBorder = '#10B981';
        netPayStr = formatNumberWithCommas(item.netPay) + ' đ';
        payColor = '#065F46';
    } else {
        isDisabled = true;
    }
    
    row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
            <input type="checkbox" class="bulk-staff-checkbox bulk-group-${group}" 
                   data-id="${item.id}" 
                   data-group="${group}"
                   ${isChecked ? 'checked' : ''} 
                   ${isDisabled ? 'disabled' : ''} 
                   onchange="onBulkCheckboxChange('${item.id}', this.checked)"
                   style="width: 18px; height: 18px; cursor: pointer; accent-color: ${group === 'teachers' ? '#3B82F6' : '#10B981'};" />
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 600; color: #374151; font-size: 0.9rem;">${item.name}</span>
                <span style="font-size: 0.75rem; color: #6B7280;">MSNV: ${item.msnv}</span>
            </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-size: 0.7rem; padding: 2px 8px; border-radius: 9999px; font-weight: 700; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder};">
                ${statusText}
            </span>
            <span style="font-weight: 700; font-size: 0.9rem; color: ${payColor}; min-width: 90px; text-align: right;">
                ${netPayStr}
            </span>
        </div>
    `;
    return row;
}

function onBulkCheckboxChange(staffId, isChecked) {
    const checkboxes = document.querySelectorAll(`.bulk-staff-checkbox[data-id="${staffId}"]`);
    checkboxes.forEach(cb => {
        cb.checked = isChecked;
    });
    updateBulkSelectedCount();
}

function toggleSelectAllGroup(group) {
    const headerCheckbox = document.getElementById(`bulk-select-all-${group}`);
    if (!headerCheckbox) return;
    
    const isChecked = headerCheckbox.checked;
    const checkboxes = document.querySelectorAll(`.bulk-staff-checkbox.bulk-group-${group}:not(:disabled)`);
    checkboxes.forEach(cb => {
        cb.checked = isChecked;
        // Also sync if dual-role
        const staffId = cb.dataset.id;
        const otherCheckboxes = document.querySelectorAll(`.bulk-staff-checkbox[data-id="${staffId}"]`);
        otherCheckboxes.forEach(ocb => {
            ocb.checked = isChecked;
        });
    });
    updateBulkSelectedCount();
}

function updateBulkSelectedCount() {
    const checkedBoxes = document.querySelectorAll('.bulk-staff-checkbox:checked');
    const selectedIds = new Set();
    checkedBoxes.forEach(cb => {
        selectedIds.add(cb.dataset.id);
    });
    
    const countDisplay = document.getElementById('bulk-selected-count');
    if (countDisplay) {
        countDisplay.innerText = `Đã chọn: ${selectedIds.size} nhân viên`;
    }
}

async function submitBulkPublish() {
    const checkedBoxes = document.querySelectorAll('.bulk-staff-checkbox:checked');
    const selectedIds = new Set();
    checkedBoxes.forEach(cb => {
        selectedIds.add(cb.dataset.id);
    });
    
    if (selectedIds.size === 0) {
        UIService.toast('Vui lòng chọn ít nhất 1 nhân viên để gửi!', 'warning');
        return;
    }
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    const commonMessage = document.getElementById('bulk-message-input')?.value || '';
    
    try {
        UIService.showLoading();
        
        const db = firebase.firestore();
        const batch = db.batch();
        
        const allSettings = window.bulkPublishAllSettings || {};
        
        selectedIds.forEach(staffId => {
            const docId = `${monthStr}_${staffId}`;
            const docRef = db.collection('salary_settings_monthly').doc(docId);
            
            const docData = allSettings[staffId] || {};
            const currentPublished = docData.published || {};
            
            // Rebuild published payload
            const updatedPublished = {
                ...currentPublished,
                status: 'published',
                publishedAt: new Date().toISOString()
            };
            
            // If commonMessage is not empty, override
            if (commonMessage.trim()) {
                updatedPublished.message = commonMessage.trim();
            }
            
            batch.set(docRef, {
                published: updatedPublished
            }, { merge: true });
        });
        
        await batch.commit();
        
        // Invalidate cache
        DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
        
        UIService.toast(`Đã gửi bảng lương cho ${selectedIds.size} nhân viên thành công!`, 'success');
        closeBulkPublishModal();
        
        // Refresh dashboard or view if they are open
        const dashView = document.getElementById('salary-dashboard-view');
        if (dashView && dashView.style.display === 'block') {
            await loadSalaryDashboard();
        } else {
            await loadSalarySettings();
        }
    } catch (e) {
        console.error('Error in bulk publishing:', e);
        UIService.toast('Gửi bảng lương thất bại: ' + e.message, 'error');
    } finally {
        UIService.hideLoading();
    }
}

// Bind new functions to window
window.saveCalculationDraftToDb = saveCalculationDraftToDb;
window.openBulkPublishModal = openBulkPublishModal;
window.closeBulkPublishModal = closeBulkPublishModal;
window.createBulkStaffRow = createBulkStaffRow;
window.onBulkCheckboxChange = onBulkCheckboxChange;
window.toggleSelectAllGroup = toggleSelectAllGroup;
window.updateBulkSelectedCount = updateBulkSelectedCount;
window.submitBulkPublish = submitBulkPublish;



// ================= MOBILE CALENDAR SCROLL HELPERS =================
window.scrollToCalendarDay = function(dayNum) {
    if (!dayNum) return;
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(dayNum).padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;
    const cell = document.getElementById(`calendar-cell-${dateKey}`);
    if (cell) {
        // Clear previous highlights
        document.querySelectorAll('.calendar-cell').forEach(c => {
            c.style.boxShadow = 'none';
            c.style.transform = 'none';
        });
        
        // Highlight cell
        cell.style.boxShadow = '0 0 0 3px var(--primary-color)';
        cell.style.transform = 'scale(1.02)';
        cell.style.transition = 'all 0.3s';
        
        // Scroll to cell
        cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
};

window.scrollToCalendarWeek = function(weekIdx) {
    if (weekIdx === '') return;
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    
    const idx = parseInt(weekIdx, 10);
    const targetCellIdx = idx * 7;
    const cell = grid.children[targetCellIdx];
    if (cell) {
        // Clear previous highlights
        document.querySelectorAll('.calendar-cell').forEach(c => {
            c.style.boxShadow = 'none';
        });
        
        // Highlight row cells
        for (let i = 0; i < 7; i++) {
            const rowCell = grid.children[targetCellIdx + i];
            if (rowCell && !rowCell.classList.contains('disabled')) {
                rowCell.style.boxShadow = 'inset 0 0 0 2px rgba(5, 150, 105, 0.4)';
            }
        }
        
        // Scroll to row
        cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
};
