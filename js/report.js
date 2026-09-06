// Report & Salary Logic

window.__TDT_REPORT_BOOTSTRAP_STARTED__ = true;
function signalReportBootstrapReady() {
    if (window.__TDT_REPORT_BOOTSTRAP_READY__) return;
    window.__TDT_REPORT_BOOTSTRAP_READY__ = true;
    if (typeof window.dispatchEvent === 'function' && typeof Event === 'function') {
        window.dispatchEvent(new Event('tdt:report-ready'));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Check if on report page (has calendar grid)
    if (document.getElementById('calendar-grid')) {
        initReport();
    }
});

let currentDate = new Date(); // Global View Date

function escapeReportHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// REPORT_CHIP_TEXT_NORMALIZER_START
// Evaluation labels are plain text except for the two small, trusted Lucide
// icons that mark +10p and overtime.  Report chips escape label text for XSS
// safety, so carrying those SVG strings into the label makes the SVG source
// visible on screen.  Convert only those exact internal icons to text glyphs
// before escaping; every other tag remains untouched and is escaped normally.
function normalizeReportChipDisplayText(value) {
    const raw = String(value ?? '');
    const trustedInternalIcon = /<svg\b(?=[^>]*\bdata-lucide\s*=\s*(["'])(?:clock|star)\1)[^>]*>[\s\S]*?<\/svg>/gi;
    const trustedFallbackIcon = /<span\b(?=[^>]*\bclass\s*=\s*(["'])icon-fallback\1)(?=[^>]*\bdata-name\s*=\s*(["'])(?:clock|star)\2)[^>]*>\s*<\/span>/gi;
    const iconGlyph = (iconMarkup) => {
        const iconName = iconMarkup.match(/\b(?:data-lucide|data-name)\s*=\s*(["'])(clock|star)\1/i)?.[2]?.toLowerCase();
        return iconName === 'clock' ? '⏱' : '★';
    };

    return raw
        .replace(trustedInternalIcon, iconGlyph)
        .replace(trustedFallbackIcon, iconGlyph);
}
// REPORT_CHIP_TEXT_NORMALIZER_END

// REPORT_COLOR_SANITIZER_START
// Only persisted six-digit hex colors may reach inline style properties. This
// keeps profile data from becoming an arbitrary CSS injection surface.
function sanitizeReportColor(value, fallback = '#E5E7EB') {
    const candidate = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}
// REPORT_COLOR_SANITIZER_END

function hasReceptionistEmploymentRole(value) {
    if (window.RolePolicy) return window.RolePolicy.hasReceptionistEmploymentRole(value);
    const roles = Array.isArray(value) ? value : [];
    return roles.some(r => ['receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff', 'tiep-tan', 'tiep_tan', 'senior_assistant', 'office_staff', 'van-phong', 'van_phong'].includes(r));
}

function hasOfficeEmploymentRole(value) {
    if (window.RolePolicy?.hasOfficeEmploymentRole) return window.RolePolicy.hasOfficeEmploymentRole(value);
    const roles = Array.isArray(value) ? value : [];
    return roles.some(r => ['office_staff', 'van-phong', 'van_phong'].includes(r));
}

function hasTeachingEmploymentRole(value) {
    if (window.RolePolicy) return window.RolePolicy.hasTeachingEmploymentRole(value);
    const roles = Array.isArray(value) ? value : [];
    return roles.some(r => ['assistant', 'teaching_assistant', 'staff', 'giao-vien', 'teacher', 'gv', 'tro-giang'].includes(r));
}

function getReportViewerRoles() {
    const roleRaw = localStorage.getItem('currentRole') || 'staff';
    try {
        const parsed = JSON.parse(roleRaw);
        return (Array.isArray(parsed) ? parsed : [parsed]).map(String);
    } catch (_) {
        return [String(roleRaw)];
    }
}

// Salary-chip overrides are intentionally reserved for the primary Admin.
// Senior assistants keep their existing attendance-review capabilities, but
// cannot create an authoritative payroll allocation.
function isPrimaryPayrollAdminViewer() {
    return getReportViewerRoles().includes('admin');
}

async function initReport() {
    try {
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

    // Use the same bounded, memoized auth restoration as the application shell.
    // A separate short timeout could start Firestore reads before the mobile
    // browser restored its Firebase token, producing an empty static report.
    const authUser = typeof window.waitAuth === 'function'
        ? await window.waitAuth()
        : (window.auth?.currentUser || null);
    if (!authUser) return;

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
            if (select && select.value !== paramStaffId) {
                const targetUser = (window._allStaffList || []).find(function (user) {
                    return user && user.id === paramStaffId;
                });
                if (targetUser) {
                    // Selecting through the normal path is essential: merely
                    // changing the hidden select left the screen rendered for
                    // the prior person while the URL showed another person.
                    selectStaffFromDropdown(targetUser);
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

    // roleView=tiep-tan|giao-vien: dùng khi mở bảng lương của một người từ modal "Gửi Bảng Lương
    // Hàng Loạt" ở tab mới — mở đúng bên vai trò sếp đang xử lý, không phải đổi filter bằng tay.
    {
        const rv = urlParams.get('roleView');
        if (rv === 'tiep-tan' || rv === 'giao-vien') {
            const rf = document.getElementById('salary-role-filter');
            if (rf) {
                rf.value = rv;
                window._forcedRoleView = rv;
                if (typeof togglePdfTieptanInputs === 'function') togglePdfTieptanInputs();
            }
        }
    }

    // 2. Set to 1st of current month
    currentDate.setDate(1);

    // 3. Render
    if (!isAdminLike) {
        await renderMonthReport(currentDate);
    }
    signalReportBootstrapReady();

    // Cross-tab update: refresh report if another tab changes class registration
    window.addEventListener('storage', (event) => {
        if (event.key === 'schedule_registration_updated' && event.storageArea === localStorage) {
            if (typeof renderMonthReport === 'function') {
                renderMonthReport(currentDate, true);
            }
        }
    });
    } catch (error) {
        console.error('Report initialization failed:', error);
        renderReportLoadFailure(error);
        signalReportBootstrapReady();
    }
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

// REPORT_STAFF_DROPDOWN_RENDER_START
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
        'office_staff': 'Nhân Viên Văn Phòng',
        'staff': 'Nhân Viên'
    };

    list.replaceChildren();

    if (users.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:1rem;text-align:center;color:#9CA3AF;font-size:0.9rem;';
        empty.textContent = 'Không tìm thấy nhân viên';
        list.appendChild(empty);
        return;
    }

    users.forEach(u => {
        const primaryRole = (u.roles && u.roles[0]) || u.role || '';
        const roleLabel = ROLE_LABELS[primaryRole] || primaryRole || '';
        const displayName = String(u.name || u.username || 'Không tên');
        const staffId = String(u.id || '');

        const item = document.createElement('div');
        item.className = 'staff-dropdown-item';
        item.dataset.id = staffId;
        item.style.cssText = 'display:flex;align-items:center;gap:0.75rem;padding:0.65rem 1rem;cursor:pointer;transition:background 0.15s;';
        item.addEventListener('mouseenter', () => { item.style.background = '#F0FDF4'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('click', () => selectStaffFromDropdownById(staffId));

        const avatar = document.createElement('div');
        avatar.style.cssText = 'width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;color:white;flex-shrink:0;';
        avatar.style.background = sanitizeReportColor(u.scheduleColor);
        avatar.textContent = displayName.charAt(0).toUpperCase() || '?';

        const copy = document.createElement('div');
        const name = document.createElement('div');
        name.style.cssText = 'font-weight:600;font-size:0.9rem;color:#1F2937;';
        name.textContent = displayName;

        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:0.75rem;color:#6B7280;';
        meta.textContent = `${roleLabel}${u.username ? ` · ${u.username}` : ''}`;

        copy.append(name, meta);
        item.append(avatar, copy);
        list.appendChild(item);
    });
}
// REPORT_STAFF_DROPDOWN_RENDER_END

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
            return hasReceptionistEmploymentRole(roles);
        });
    } else if (filterVal === 'giao-vien') {
        filteredUsers = window._allStaffList.filter(u => {
            const roles = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role || ''];
            return hasTeachingEmploymentRole(roles);
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
        loadSalarySettings().catch(error => console.error('Salary filter reload failed:', error));
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

function getCurrentPayslipComponentStatus(component = 'gv') {
    const published = window.currentMonthlySalarySettingsAll?.published;
    if (!published) return 'draft';
    if (typeof DBService !== 'undefined' && typeof DBService.getPayslipLifecycleState === 'function') {
        const lifecycle = DBService.getPayslipLifecycleState(published);
        return component === 'tt' ? lifecycle.status_tt : lifecycle.status_gv;
    }
    return published.status || 'draft';
}

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
        const pubStatus = getCurrentPayslipComponentStatus('gv');
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
                        status: normalizeStudentCountApprovalStatus(chip.studentCountStatus)
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
    const pubStatus = getCurrentPayslipComponentStatus('gv');
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
    
    document.getElementById('scr-class-name').textContent = `Lớp: ${chipText}`;
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
// Every render owns a unique epoch.  Async work from an older staff/month is
// ignored instead of painting over the latest report.
let _reportRenderEpoch = 0;
// Chủ sở hữu của _cachedStaffNotes. Không bao giờ ghi ghi chú xuống Firestore khi biến
// này không khớp người đang chọn — xem saveCalendarNote.
let _cachedNotesOwnerId = null;

// REPORT_RENDER_COMMIT_GUARD_START
function createReportRenderCommitGuard(renderEpoch, staffId, readEpoch, readStaffId) {
    const isCurrent = () => readEpoch() === renderEpoch && readStaffId() === staffId;
    return {
        isCurrent,
        commit(callback) {
            if (!isCurrent()) return false;
            callback();
            return true;
        }
    };
}
// REPORT_RENDER_COMMIT_GUARD_END

function renderReportLoadFailure(error) {
    window.payrollReadyScope = null;
    const salary = document.getElementById('final-salary-display');
    if (salary) salary.innerText = 'Chưa tải đủ dữ liệu';
    console.error('Report load failed:', error);
    const grid = document.getElementById('calendar-grid');
    if (grid) {
        grid.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:2rem;color:#92400E;">
                <p style="margin:0 0 0.9rem;font-weight:600;">Chưa thể tải bảng công. Vui lòng kiểm tra kết nối rồi thử lại.</p>
                <button type="button" class="btn btn-primary" onclick="renderMonthReport(currentDate, true)">Tải lại</button>
            </div>
        `;
    }
    const totalHoursEl = document.getElementById('total-hours-display');
    if (totalHoursEl) totalHoursEl.innerText = 'Tổng giờ làm: Chưa tải được';
}

function requireCompletePayrollReport() {
    const month = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    const scope = `${getTargetStaffId() || 'none'}__${month}`;
    if (window.payrollReadyScope === scope && window.currentReportScope === scope) return true;
    UIService.toast('Bảng công/lương chưa tải đủ dữ liệu. Chị bấm Tải lại rồi lưu hoặc gửi bảng lương nhé.', 'warning');
    return false;
}

function renderPersonalTimesheet() {
    renderMonthReport(currentDate);
}

async function renderMonthReport(date, forceServer = false) {
    const requestedRenderEpoch = _reportRenderEpoch + 1;
    try {
        return await _renderMonthReport(date, forceServer);
    } catch (error) {
        // A stale request must not overwrite the result of a newer staff/month.
        if (_reportRenderEpoch === requestedRenderEpoch) renderReportLoadFailure(error);
        return null;
    }
}

async function _renderMonthReport(date, forceServer = false) {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    const renderEpoch = ++_reportRenderEpoch;

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
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const reportScope = `${staffId || 'none'}__${monthStr}`;
    const renderGuard = createReportRenderCommitGuard(
        renderEpoch,
        staffId,
        () => _reportRenderEpoch,
        getTargetStaffId
    );
    const isCurrentRender = renderGuard.isCurrent;
    const commitCurrentRender = renderGuard.commit;

    // Clear every derived value before waiting on Firestore.  This prevents a
    // previous employee's subject breakdown from surviving under a new empty
    // calendar or a direct report URL.
    window.currentReportScope = reportScope;
    window.payrollReadyScope = null;
    window.currentSubjectBreakdown = [];
    window.currentSubjectBreakdownScope = reportScope;
    window.currentMonthChips = [];
    window.allMonthChips = [];
    window.unfilteredAllMonthChips = [];
    window.lastTotalMinutes = 0;
    window.currentUserContext = null;
    window.currentMonthlySalarySettingsAll = {};
    window.currentSubjectCatalog = [];
    window.savedFixedShiftsMonth = [];
    window.allReceptionistsData = [];
    const payrollSystemSettings = await DBService._getRequiredFinancialDocument('settings', 'system') || {};
    if (!commitCurrentRender(() => { window.centerClosures = payrollSystemSettings.centerClosures || {}; })) return;
    const staleBreakdownSection = document.getElementById('subject-breakdown-section');
    const staleBreakdownBody = document.getElementById('subject-breakdown-body');
    if (staleBreakdownSection) staleBreakdownSection.style.display = 'none';
    if (staleBreakdownBody) staleBreakdownBody.innerHTML = '';

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
    let currentUserContext = null;
    try {
        const userDoc = await DBService.refs.users().doc(staffId).get({ source: 'server' });
        if (!isCurrentRender()) return;
        if (userDoc.exists) currentUserContext = userDoc.data();
    } catch (e) { throw e; }
    if (!currentUserContext) throw new Error('Không tìm thấy hồ sơ nhân sự để tính lương.');
    if (!commitCurrentRender(() => { window.currentUserContext = currentUserContext; })) return;

    // Load monthly settings for all users to ensure penalty flag and publish status are present
    let currentMonthlySalarySettingsAll = {};
    try {
        currentMonthlySalarySettingsAll = await DBService.getMonthlySalarySettings(staffId, monthStr, { strict: true }) || {};
        if (!isCurrentRender()) return;
    } catch (e) {
        console.error("Error fetching monthly salary settings in render:", e);
        if (!isCurrentRender()) return;
        throw e;
    }
    if (!commitCurrentRender(() => {
        window.currentMonthlySalarySettingsAll = currentMonthlySalarySettingsAll;
    })) return;

    // Subject catalog is read once per report render for the additive group-rate
    // resolver.  Failure is non-fatal: all payroll paths then keep chip snapshots.
    let currentSubjectCatalog = [];
    try {
        // Luôn hỏi server khi mở/tải lại báo cáo để thay đổi "Sớm 10p" từ
        // trang Môn Học có hiệu lực ngay trên PWA đang mở lâu ngày.
        const subjectCatalog = await DBService.getSubjects(true, { strict: true });
        if (!isCurrentRender()) return;
        currentSubjectCatalog = Array.isArray(subjectCatalog) ? subjectCatalog : [];
    } catch (e) {
        console.warn('Subject catalog unavailable; payroll is not ready:', e);
        if (!isCurrentRender()) return;
        throw e;
    }
    if (!commitCurrentRender(() => { window.currentSubjectCatalog = currentSubjectCatalog; })) return;

    // Re-sync tieptan inputs box visibility now that currentUserContext is resolved
    if (!commitCurrentRender(() => {
        if (typeof togglePdfTieptanInputs === 'function') togglePdfTieptanInputs();
    })) return;

    // --- NEW: Toggle btn-approve-all-bonus10 ---
    const viewerRole = localStorage.getItem('currentRole') || 'staff';
    const viewerRoles = typeof parseRoles === 'function' ? parseRoles(viewerRole) : [viewerRole];
    const isAdminViewer = viewerRoles.some(r => r === 'admin' || r === 'senior_assistant');
    const staffRoles = currentUserContext
        ? (Array.isArray(currentUserContext.roles) && currentUserContext.roles.length > 0
            ? currentUserContext.roles
            : [currentUserContext.role || ''])
        : [];
    const isTeachingAssistant = typeof hasTeachingEmploymentRole === 'function'
        ? hasTeachingEmploymentRole(currentUserContext || staffRoles)
        : staffRoles.includes('teaching_assistant');

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
    // _cachedNotesOwnerId ghi RÕ ghi chú đang giữ là của AI. Thiếu nó thì lúc admin đổi
    // người trên ô chọn (không tải lại trang), ghi chú của người trước vẫn nằm trong bộ
    // nhớ và có thể bị ghi đè sang người sau — đúng vụ "ghi chú lộn qua người khác".
    let staffNotesForRender = (!forceServer && _cachedStaffId === staffId && _cachedNotesOwnerId === staffId)
        ? { ..._cachedStaffNotes }
        : null;
    let staffNotesLoaded = staffNotesForRender !== null;
    if (!staffNotesLoaded) {
        try {
            staffNotesForRender = { ...(await DBService.getDailyNotes(staffId, { strict: true }) || {}) };
            if (!isCurrentRender()) return;
            staffNotesLoaded = true;
        } catch (e) {
            console.error("Error loading notes from Firestore:", e);
            if (!isCurrentRender()) return;
            throw e;
        }
    }
    if (!commitCurrentRender(() => {
        _cachedStaffNotes = staffNotesForRender || {};
        _cachedNotesOwnerId = staffNotesLoaded ? staffId : null;
        _cachedStaffId = staffNotesLoaded ? staffId : null;
    })) return;

    if (!staffId) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: red;">Vui lòng đăng nhập hoặc chọn nhân viên.</div>';
        return;
    }

    // 1. Fetch DATA (Attendance + Schedule)

    // Fetch Fixed Shifts for the month
    let savedFixedShiftsMonth = [];
    try {
        savedFixedShiftsMonth = await DBService.getFixedShifts(monthStr, staffId, { strict: true }) || [];
        if (!isCurrentRender()) return;
    } catch (e) {
        console.error("Could not fetch fixed shifts:", e);
        if (!isCurrentRender()) return;
        throw e;
    }
    if (!commitCurrentRender(() => {
        window.savedFixedShiftsMonth = savedFixedShiftsMonth;
        // If we are currently IN selection mode, prepopulate the Set on first load
        if (window.isFixedShiftMode && window.selectedFixedShifts.size === 0 && savedFixedShiftsMonth.length > 0) {
            savedFixedShiftsMonth.forEach(id => window.selectedFixedShifts.add(id));
        }
    })) return;

    // Fetch Cancelled Shifts (Admin specifically excluded)
    let cancelledShifts = [];
    try {
        cancelledShifts = await DBService.getCancelledShifts(monthStr, staffId, { strict: true });
    } catch (e) {
        console.error("Could not fetch cancelled shifts:", e);
        throw e;
    }
    if (!isCurrentRender()) return;

    // A. Attendance Logs (Actual Check-in/out)
    // DBService.getMonthlyAttendance returns array of docs with { sessions: [...] }
    const attendanceRecords = await DBService.getMonthlyAttendance(monthStr, staffId, true, { strict: true });
    if (!isCurrentRender()) return;

    // Receptionist notes/late commands are stored separately from attendance.
    // Keeping them separate preserves the original clock timestamps for audit.
    const shiftObservations = await DBService.getShiftObservationsForMonth(monthStr, staffId, { strict: true });
    if (!isCurrentRender()) return;
    const shiftObservationsMap = {};
    shiftObservations.forEach(item => {
        if (!item.dateKey) return;
        if (!shiftObservationsMap[item.dateKey]) shiftObservationsMap[item.dateKey] = [];
        shiftObservationsMap[item.dateKey].push(item);
    });

    // Normalize Attendance into a Map: "YYYY-MM-DD" -> [sessions]
    const attendanceMap = {};
    attendanceRecords.forEach(record => {
        // record.date is "YYYY-MM-DD"
        if (record.date) {
            attendanceMap[record.date] = record.sessions || [];
        }
    });
    // Keep the untouched Firestore sessions for the edit popup. Evaluation
    // clones may carry calculated rates/links; using those clones as an
    // optimistic-lock token would reject a legitimate Admin edit.
    if (!commitCurrentRender(() => { window.currentAttendanceMap = attendanceMap; })) return;

    // D. Overtime Requests for this staff+month
    if (forceServer) {
        DBService._invalidate(`overtime_requests_staff_${staffId}_${monthStr}`);
        DBService._invalidate(`bonus10_requests_staff_${staffId}_${monthStr}`);
    }
    let overtimeRequestsList = [];
    try {
        overtimeRequestsList = await DBService.getOvertimeRequestsForStaff(staffId, monthStr);
    } catch (e) { throw e; }
    if (!isCurrentRender()) return;

    // Fetch bonus10 requests cho tháng này
    let bonus10RequestsList = [];
    try {
        bonus10RequestsList = await DBService.getBonus10RequestsForStaff(staffId, monthStr);
    } catch (e) { throw e; }
    if (!isCurrentRender()) return;

    // One physical session may cover several teaching shifts. Keep every award
    // in the session bucket; the evaluator resolves the exact targetShiftKey.
    const bonus10Map = {};
    bonus10RequestsList.forEach(req => {
        const key = String(req.sessionId);
        if (!key) return;
        if (!Array.isArray(bonus10Map[key])) bonus10Map[key] = [];
        bonus10Map[key].push(req);
    });

    // Explicit monthly state wins over retained rejected audit documents. Old
    // months without a state marker keep the legacy rejected-request fallback.
    const bonus10PenaltyState = currentMonthlySalarySettingsAll?.bonus10PenaltyState;
    const hasExplicitBonus10Penalty = bonus10PenaltyState &&
        typeof bonus10PenaltyState.active === 'boolean';
    const early10PenaltyActive = hasExplicitBonus10Penalty
        ? bonus10PenaltyState.active
        : bonus10RequestsList.some(req => req.status === 'rejected');
    const early10RejectedCount = bonus10RequestsList.filter(req => req.status === 'rejected').length;
    const monthFlags = {
        early10PenaltyActive,
        // Read-only migration bridge for already-approved legacy requests.
        // The evaluator still requires a unique schedule row and a real >=10m
        // early check-in; an orphan attendance flag is never sufficient.
        subjectEarly10Map: typeof Early10 !== 'undefined' && Early10.buildSubjectEarly10Map
            ? Early10.buildSubjectEarly10Map(currentSubjectCatalog)
            : {},
        // Exact normalized name/alias lookup is only used for legacy schedule
        // rows that genuinely have no lopId (for example FFS01 → FFS1).
        subjectEarly10NameMap: typeof Early10 !== 'undefined' && Early10.buildSubjectEarly10NameMap
            ? Early10.buildSubjectEarly10NameMap(currentSubjectCatalog)
            : {}
    };
    if (!commitCurrentRender(() => {
        window.currentMonthEarly10Penalty = early10PenaltyActive;
        window.currentMonthEarly10RejectedCount = early10RejectedCount;
        renderEarly10PenaltyBanner(
            staffId,
            early10PenaltyActive,
            early10RejectedCount,
            bonus10PenaltyState || null
        );
    })) return;

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
    const scheduleReadCache = new Map();
    for (let d = 1; d <= daysInMonth; d++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        BRANCHES.forEach(branch => {
            const compositeKey = `${branch}__${dateKey}`;
            schedulePromises.push(
                DBService.getSchedule(compositeKey, { source: 'server', readCache: scheduleReadCache }).then(data => ({ date: dateKey, data: data || {}, branch, compositeKey }))
            );
        });
    }
    const scheduleResults = await Promise.all(schedulePromises);
    if (!isCurrentRender()) return;
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
    const isReceptionistStaff = currentUserContext && hasReceptionistEmploymentRole(staffRoles);

    if (isReceptionistStaff) {
        try {
            // 1. Get shift config PER BRANCH
            const shiftConfigMap = {}; // branch -> receptionist config
            const officeShiftConfigMap = {}; // branch -> office config
            for (const branch of BRANCHES) {
                shiftConfigMap[branch] = resolvePayrollShiftConfig(payrollSystemSettings, 'receptionist', branch);
                if (!isCurrentRender()) return;
                officeShiftConfigMap[branch] = resolvePayrollShiftConfig(payrollSystemSettings, 'office', branch);
                if (!isCurrentRender()) return;
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
                        DBService.getReceptionistSchedule(compositeKey, { source: 'server' }).then(data => ({
                            branch,
                            mondayKey,
                            scheduleType: 'receptionist',
                            documentKey: compositeKey,
                            data: data || {}
                        }))
                    );
                    recepPromises.push(
                        DBService.getOfficeSchedule(compositeKey, { source: 'server' }).then(data => ({
                            branch,
                            mondayKey,
                            scheduleType: 'office',
                            documentKey: compositeKey,
                            data: data || {}
                        }))
                    );
                });
            });

            const recepResults = await Promise.all(recepPromises);
            if (!isCurrentRender()) return;

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
                        const branchConfig = result.scheduleType === 'office'
                            ? (officeShiftConfigMap[result.branch] || {})
                            : (shiftConfigMap[result.branch] || {});
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
                            scheduleType: result.scheduleType,
                            documentKey: result.documentKey,
                            dayKey,
                            cancelCompositeKey: result.scheduleType === 'office'
                                ? `office_${result.branch}_${mondayKey}`
                                : `${result.branch}_${mondayKey}`,
                            isFixedShift: staffEntry.isFixedShift ? true : false
                        });
                    });
                });
            }

            console.log('[Report] Receptionist shifts loaded:', Object.keys(receptionistShiftsMap).length, 'days with shifts');
        } catch (e) {
            console.error('[Report] Error loading receptionist schedules:', e);
            throw e;
        }
        if (!isCurrentRender()) return;
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

                const toMergedSegment = (shift) => ({
                    id: [shift.scheduleType || 'receptionist', shift.documentKey || '', shift.shift || '', shift.dayKey || '', shift.start || '', shift.end || ''].join('|'),
                    start: shift.start,
                    end: shift.end,
                    schedMinutes: timeStrToMin2(shift.end) - timeStrToMin2(shift.start),
                    isFixedShift: shift.isFixedShift || false,
                    branch: shift.branch || '',
                    scheduleType: shift.scheduleType || 'receptionist',
                    documentKey: shift.documentKey || '',
                    shiftKey: shift.shift || '',
                    dayKey: shift.dayKey || ''
                });

                // Khởi tạo segment đầu tiên
                let currentShift = { ...dailyShifts[0] };
                // Lưu segments để tính lương đúng từng đoạn CĐ/thường
                let currentSegments = [toMergedSegment(dailyShifts[0])];

                for (let i = 1; i < dailyShifts.length; i++) {
                    let nextShift = dailyShifts[i];
                    
                    const currentEndMin = timeStrToMin2(currentShift.end);
                    const nextStartMin = timeStrToMin2(nextShift.start);

                    // Chỉ merge khi 2 ca cùng loại (cùng CĐ hoặc cùng thường).
                    // Ca CĐ kề ca thường → giữ riêng để stats/lương/hiển thị không lẫn lộn.
                    const sameFixedType = (currentShift.isFixedShift || false) === (nextShift.isFixedShift || false);
                    const sameScheduleType = (currentShift.scheduleType || 'receptionist') === (nextShift.scheduleType || 'receptionist');
                    const sameBranch = String(currentShift.branch || '') === String(nextShift.branch || '');

                    // Merge only a continuous/overlapping chain at one branch.
                    // A gap is a real break and cross-campus shifts are distinct.
                    if (sameFixedType && sameScheduleType && sameBranch && nextStartMin <= currentEndMin) {
                        if (nextShift.end > currentShift.end) {
                            currentShift.end = nextShift.end;
                        }
                        currentShift.label = `${currentShift.label} + ${nextShift.label}`;
                        currentSegments.push(toMergedSegment(nextShift));
                    } else {
                        // Gắn segments vào shift nếu có nhiều hơn 1
                        if (currentSegments.length > 1) currentShift.mergedSegments = currentSegments;
                        mergedShifts.push(currentShift);
                        currentShift = { ...nextShift };
                        currentSegments = [toMergedSegment(nextShift)];
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
                // KHÔNG đụng vào ca admin đã sửa tay: trước đây khối này thấy cờ
                // autoClosedReason (hoặc giờ ra 23:59) là ghi đè giờ ra của admin về giờ tan ca
                // /23:59 ngay trong bộ nhớ mỗi lần tải trang -> admin lưu xong vẫn thấy giá trị cũ.
                if (s.isAdminEdited) return;
                if (s.id && (!s.checkOut || s.autoClosedReason === 'stale_session' || (s.checkOut && s.checkOut.includes('T23:59:00')))) {
                    // Tìm giờ kết thúc lịch cho session này
                    let correctEndISO = null;
                    const checkIn = s.checkIn ? new Date(s.checkIn) : null;
                    if (checkIn) {
                        // 1. Kiểm tra ca dạy (Teaching classes)
                        const staffClasses = [];
                        sections.forEach(sec => {
                            (sched[sec] || []).forEach(cls => {
                                const isAssigned = isScheduledMainTeacher(cls, staffId) ||
                                    isScheduledSubstitute(cls, staffId) ||
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

                        // 2. Kiểm tra ca Tiếp Tân (Receptionist shifts).
                        // NGÀY 2 CHỨC NĂNG: trước đây chỉ chạy khi KHÔNG khớp ca dạy, nên người
                        // trực 07:00–11:00 mà có lớp 07:30–09:00 bị khép ca lúc 09:00 → mất công
                        // ca trực buổi còn lại. Nay luôn kiểm tra và lấy mốc MUỘN NHẤT.
                        if (receptionistShiftsMap[dateKey]) {
                            let matchedRecepShift = null;
                            let minRecepDiff = Infinity;
                            receptionistShiftsMap[dateKey].forEach(rs => {
                                const shiftStart = getVietnamDateFromHM(dateKey, rs.start);
                                const shiftEnd = getVietnamDateFromHM(dateKey, rs.end);
                                if (!shiftStart || !shiftEnd) return;

                                const diffMs = Math.abs(checkIn - shiftStart);
                                // Khớp khi check-in gần giờ vào ca (±90p) HOẶC nằm TRONG khung ca.
                                // Ca tiếp tân ở đây đã được GỘP (VD 14:00–21:10), nên người vào trễ giữa
                                // ca (VD 17:17 = lệch 197p so với 14:00) trước đây không khớp ca nào và bị
                                // đóng nhầm về 23:59; giờ vẫn đóng đúng theo giờ tan ca (21:10).
                                const insideShift = checkIn >= shiftStart && checkIn < shiftEnd;
                                if (diffMs < 90 * 60 * 1000 || insideShift) {
                                    if (diffMs < minRecepDiff) {
                                        minRecepDiff = diffMs;
                                        matchedRecepShift = rs;
                                    }
                                }
                            });

                            if (matchedRecepShift) {
                                const finalEndDate = getVietnamDateFromHM(dateKey, matchedRecepShift.end);
                                if (finalEndDate) {
                                    // Lấy mốc muộn hơn giữa "hết chuỗi lớp dạy" và "hết ca trực"
                                    if (!correctEndISO || finalEndDate.toISOString() > correctEndISO) {
                                        correctEndISO = finalEndDate.toISOString();
                                    }
                                }

                                // Nếu ca tiếp tân kết thúc đúng lúc một ca dạy đã được
                                // xếp bắt đầu, phiên mở phải theo tiếp chuỗi công việc.
                                // Trước đây phiên 13:33 bị tự đóng ở 18:00 nên ca dạy
                                // 18:00–21:00 không còn phiên để ghép vào chip.
                                let chainStart = matchedRecepShift.end;
                                let chainEnd = null;
                                let extended = true;
                                while (extended) {
                                    extended = false;
                                    for (const cls of staffClasses) {
                                        if (cls.start === chainStart) {
                                            chainEnd = cls.end;
                                            chainStart = cls.end;
                                            extended = true;
                                            break;
                                        }
                                    }
                                }
                                if (chainEnd) {
                                    const finalChainDate = getVietnamDateFromHM(dateKey, chainEnd);
                                    if (finalChainDate && (!correctEndISO || finalChainDate.toISOString() > correctEndISO)) {
                                        correctEndISO = finalChainDate.toISOString();
                                    }
                                }
                            }
                        }
                    }
                    const fallbackISO = getVietnamDateFromHM(dateKey, "23:59")?.toISOString() || new Date(`${dateKey}T23:59:00Z`).toISOString();
                    const closeISO = correctEndISO || fallbackISO;
                    
                    if (s.checkOut !== closeISO) {
                        // Bảng công là màn hình đọc/duyệt, không phải writer.
                        // main.js owns automatic checkout; opening a salary
                        // report must never rewrite historical attendance.
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

        // NGÀY 2 CHỨC NĂNG: gom CẢ ca trực lẫn lớp dạy thành các khúc việc, rồi ra ca ở cuối
        // MẠCH LÀM VIỆC LIỀN chứa giờ vào ca (main.js: resolveWorkChainEnd). Khoảng nghỉ dài
        // — ví dụ ca tối 18:00 — cắt mạch, buổi tối nhân viên vẫn bấm vào ca như bình thường.
        const workBlocks = [];

        // Ca trực
        (receptionistShiftsMap[todayKey] || []).forEach(rs => {
            const shiftStart = getVietnamDateFromHM(todayKey, rs.start);
            const shiftEnd = getVietnamDateFromHM(todayKey, rs.end);
            if (shiftStart && shiftEnd) workBlocks.push({ start: shiftStart, end: shiftEnd, kind: 'tiep-tan' });
        });

        // Lớp dạy được xếp
        const todaySchedule = scheduleMap[todayKey] || {};
        ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'].forEach(sec => {
            (todaySchedule[sec] || []).forEach(cls => {
                const isRegistered = isScheduledMainTeacher(cls, staffId) ||
                    isScheduledSubstitute(cls, staffId) ||
                    (cls.registeredTeachers || []).some(t => t.id === staffId);
                if (!isRegistered || !cls.start || !cls.end) return;
                const clsStart = getVietnamDateFromHM(todayKey, cls.start);
                const clsEnd = getVietnamDateFromHM(todayKey, cls.end);
                if (clsStart && clsEnd) workBlocks.push({ start: clsStart, end: clsEnd, kind: 'day' });
            });
        });

        const latestEnd = typeof resolveWorkChainEnd === 'function'
            ? resolveWorkChainEnd(workBlocks, checkInTime)
            : null;
        if (!latestEnd) return;
        if (isCurrentRender() && nowForAutoClose >= latestEnd) {
            // Deliberately read-only. The attendance flow owns checkout.
        }
    });

    if (!isCurrentRender()) return;

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

        const chips = calculateDailyChips(
            dailySchedule,
            dailyAttendance,
            staffId,
            dateStr,
            currentUserContext,
            dailyReceptionistShifts,
            overtimeDateMap[dateStr] || {},
            cancelledShifts,
            bonus10Map,
            shiftObservationsMap[dateStr] || [],
            monthFlags
        );
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
            div.className = `schedule-chip report-schedule-chip ${chip.class}`;
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';

            let badgeHtml = '';
            if (chip.studentCount && chip.studentCount > 0) {
                const isPenaltyActive = !!window.currentMonthlySalarySettingsAll?.studentCountBonusPenalty || !!window.hasAnyRejectedStudentCountSessionInMonth;
                const badge = getStudentCountBadgePresentation(chip.studentCountStatus, isPenaltyActive);
                badgeHtml = `<span class="student-count-badge ${badge.className}">${chip.studentCount}hs (${badge.label})</span>`;
            }

            let editedHtml = '';
            if (chip.isAdminEdited && !chip.isAdminCreated) {
                editedHtml = ` <span title="Admin đã chỉnh sửa" style="cursor:help; margin-left:4px; display:inline-flex; align-items:center; vertical-align:middle;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>`;
            }

            const observationNotes = Array.isArray(chip.shiftObservationNotes)
                ? chip.shiftObservationNotes.filter(Boolean)
                : [];
            let observationNoteHtml = '';
            if (observationNotes.length > 0) {
                const fullReason = observationNotes.join(' / ');
                const shortReason = fullReason.length > 110 ? `${fullReason.slice(0, 107)}...` : fullReason;
                observationNoteHtml = `<small style="display:block;margin-top:4px;font-size:0.72rem;font-weight:600;line-height:1.35;color:#9A3412;white-space:normal">Lý do: ${escapeReportHtml(shortReason)}</small>`;
            }

            const chipDisplayText = absenceChipDisplayText(chip, _cachedStaffNotes);
            const safeChipDisplayText = escapeReportHtml(normalizeReportChipDisplayText(chipDisplayText));

            div.innerHTML = `<span class="report-chip-main" style="min-width:0">${safeChipDisplayText}${editedHtml}${badgeHtml}${observationNoteHtml}</span>`;

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
            const isTargetTA = typeof hasTeachingEmploymentRole === 'function'
                ? hasTeachingEmploymentRole(_targetCtx || _targetRoles)
                : _targetRoles.includes('teaching_assistant');
            const allowedRoles = ['teaching_assistant', 'admin', 'senior_assistant'];
            const canSeeBonus10 = roles2.some(r => allowedRoles.includes(r)) && !chip.isReceptionist && isTargetTA;
            const isAdminRole2 = roles2.some(r => ['admin', 'senior_assistant'].includes(r));
            const isStaffViewer2 = roles2.includes('teaching_assistant') && !isAdminRole2;
            const subjectCatalogForEarly10 = Array.isArray(window.currentSubjectCatalog)
                ? window.currentSubjectCatalog
                : [];
            const subjectMapForEarly10 = typeof Early10 !== 'undefined' && Early10.buildSubjectEarly10Map
                ? Early10.buildSubjectEarly10Map(subjectCatalogForEarly10)
                : {};
            const early10Eligibility = typeof Early10 !== 'undefined' && Early10.evaluatePolicyEligibility
                ? Early10.evaluatePolicyEligibility({
                    subjectIds: Early10.getChipSubjectIds
                        ? Early10.getChipSubjectIds(chip, subjectCatalogForEarly10)
                        : [],
                    subjectMap: subjectMapForEarly10,
                    user: _targetCtx
                })
                : { ok: false, code: 'module', teachingMode: 'unset' };
            const chipMayRequestEarly10 = early10Eligibility.ok === true;

            if (canSeeBonus10 && chip.sessionId &&
                chip.class !== 'chip-blue' &&
                chip.class !== 'chip-gray' &&
                chip.class !== 'chip-future' &&
                (chip.class !== 'chip-waiting' || chip.schedData?.shiftId || chip.schedData?.lopId)) {

                const b10Btn = document.createElement('button');
                b10Btn.className = 'report-chip-action report-chip-early10-action';
                b10Btn.style.cssText = 'font-size:0.68rem;padding:3px 7px;border-radius:999px;border:1px solid transparent;cursor:pointer;margin-left:4px;vertical-align:middle;display:inline-flex;align-items:center;justify-content:center;gap:3px;line-height:1.15;white-space:nowrap;min-height:26px;';

                const b10Status = chip.bonus10Status;
                if (b10Status === 'admin_override') {
                    b10Btn.innerHTML = window.getIconHtml('shield-check', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p Admin';
                    b10Btn.style.background = '#DCFCE7';
                    b10Btn.style.color = '#166534';
                    b10Btn.disabled = true;
                    b10Btn.title = 'Đã cộng +10 phút theo quyết định của Admin trong chip nguồn';
                } else if (b10Status === 'approved') {
                    b10Btn.innerHTML = window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + '+10p';
                    b10Btn.style.background = '#D1FAE5';
                    b10Btn.style.color = '#059669';
                    if (chip.bonus10CompatibilitySource === 'legacy-session-bonus10') {
                        b10Btn.disabled = true;
                        b10Btn.title = 'Khôi phục từ cờ +10 phút đã lưu trong chấm công cũ; không phải yêu cầu có thể hủy riêng.';
                    } else if (isAdminRole2) {
                        b10Btn.style.cursor = 'pointer';
                        b10Btn.title = 'Đã duyệt - Bấm để hủy duyệt thưởng 10p';
                        b10Btn.onclick = async (e) => {
                            e.stopPropagation();
                            const agreed = await UIService.confirm(
                                'Hủy thưởng 10p cho ca này?\n\n' +
                                'Lưu ý: hủy 1 ca sẽ khóa phụ cấp CẢ THÁNG — mất toàn bộ 10p và mất luôn ' +
                                'đơn giá lớp đông (+N HS) của nhân viên này trong tháng. Có thể gỡ phạt sau.'
                            );
                            if (!agreed) return;
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
                } else if (b10Status === 'rejected') {
                    // Rejected request remains visible as audit even after an
                    // explicit monthly clear. Do not describe retained evidence
                    // as an active payroll lock when the marker is false.
                    const monthPenaltyActive = window.currentMonthEarly10Penalty === true;
                    b10Btn.innerHTML = window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) +
                        (monthPenaltyActive ? ' Đã hủy' : ' Từ chối · đã gỡ khóa');
                    b10Btn.style.background = '#FEE2E2';
                    b10Btn.style.color = '#DC2626';
                    b10Btn.disabled = !isAdminRole2 || !monthPenaltyActive;
                    b10Btn.title = monthPenaltyActive
                        ? 'Ca này bị từ chối +10p và đang khóa phụ cấp tháng'
                        : 'Dấu vết từ chối được giữ để đối chiếu; tháng đã gỡ khóa phụ cấp';
                    if (isAdminRole2 && monthPenaltyActive) {
                        b10Btn.style.cursor = 'pointer';
                        b10Btn.title += ' (bấm để gỡ phạt tháng này)';
                        b10Btn.onclick = (e) => {
                            e.stopPropagation();
                            clearEarly10Penalty(staffId);
                        };
                    }
                } else if (!chipMayRequestEarly10) {
                    const mode = early10Eligibility.teachingMode || 'unset';
                    const isSubjectBlocked = early10Eligibility.code === 'subject';
                    const isNewModeBlocked = early10Eligibility.code === 'mode' && mode === 'new';
                    const label = isSubjectBlocked
                        ? 'Không áp dụng'
                        : (isNewModeBlocked ? 'Chế độ mới' : 'Không thể kiểm tra');
                    b10Btn.innerHTML = window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + ` ${label}`;
                    b10Btn.style.background = isSubjectBlocked ? '#F3F4F6' : '#FFF7ED';
                    b10Btn.style.color = isSubjectBlocked ? '#6B7280' : '#C2410C';
                    b10Btn.style.borderColor = isSubjectBlocked ? '#E5E7EB' : '#FED7AA';
                    b10Btn.title = isSubjectBlocked
                        ? 'Môn này chưa bật chính sách Sớm 10p'
                        : (isNewModeBlocked
                            ? 'Nhân viên chế độ mới không áp dụng Sớm 10p'
                            : 'Chưa tải được quy tắc Sớm 10p; hãy tải lại trang');
                    b10Btn.onclick = async (e) => {
                        e.stopPropagation();
                        const message = early10Eligibility.message ||
                            'Chưa tải được quy tắc sớm 10 phút. Hãy tải lại trang.';
                        await UIService.notice(message, 'Chưa đủ điều kiện Sớm 10p', 'warning');
                    };
                } else {
                    // Chưa có → nhân viên chủ động gửi. DB transaction + rules
                    // kiểm tra lại dữ liệu live rồi tự duyệt nếu đủ điều kiện.
                    b10Btn.innerHTML = window.getIconHtml('star', {width: '12', height: '12', style: 'display:inline-block; vertical-align:middle;'}) + ' Sớm';
                    b10Btn.style.background = '#F3F4F6';
                    b10Btn.style.color = '#6B7280';
                    b10Btn.title = 'Gửi yêu cầu +10 phút; hệ thống tự duyệt nếu ca đủ điều kiện';
                    b10Btn.onclick = (e) => {
                        e.stopPropagation();
                        submitBonus10Request(chip.sessionId, dateStr, staffId, chip);
                    };
                }

                div.appendChild(b10Btn);
            }

            const chipTooltip = (chip.isVDX && classifyAbsentChip(chip, _cachedStaffNotes) === 'VP')
                ? String(chip.tooltip || '').replace('Vắng đột xuất', 'Vắng phép (trợ lý đã đánh dấu)')
                : chip.tooltip;
            div.title = `${chipTooltip} (${chip.paidMinutes}m)`;

            // Look for existing saved fixed shift or selected one
            const isFixed = chip.isFixedShift || (window.savedFixedShiftsMonth && window.savedFixedShiftsMonth.includes(chip.sessionId));
            chip.isFixedShift = isFixed;
            if (isFixed && !window.isFixedShiftMode) {
                div.innerHTML = `<span>${safeChipDisplayText} <b>(CĐ)</b>${badgeHtml}</span>`;
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
                    if (chip.isCancelled && canConfirmAbsent && !window.isStudentCountSelectMode &&
                        !window.isBonusSelectMode && !window.isFixedShiftMode) {
                        const shiftLabel = chip.text || 'ca này';
                        const agreed = await UIService.confirm(
                            `Khôi phục ${shiftLabel} ngày ${dateStr}?\n\n` +
                            'Ca sẽ xuất hiện lại trong Bảng Công và được tính theo dữ liệu chấm công thực tế.'
                        );
                        if (!agreed) return;
                        try {
                            if (typeof UIService !== 'undefined') UIService.showLoading('Đang khôi phục ca...');
                            // Teaching schedules deliberately use a double underscore
                            // (`cs1__YYYY-MM-DD`). Reception/office rosters use the
                            // single-underscore document key, so never normalize the
                            // teaching key or the cancellation tombstone will not match.
                            const cancelComposite = `${chip.isOffice ? 'office_' : ''}${String(chip.classCompositeKey || '')}`;
                            const cancelKey = `${cancelComposite}_${chip.classSectionKey}_${chip.classIndex}`;
                            await DBService.restoreCancelledShift(dateStr.substring(0, 7), staffId, cancelKey);
                            _cachedStaffId = null;
                            await renderMonthReport(currentDate, true);
                            if (typeof UIService !== 'undefined') UIService.toast('Đã khôi phục ca làm.', 'success');
                        } catch (error) {
                            if (typeof UIService !== 'undefined') UIService.toast(error.message || 'Không thể khôi phục ca.', 'error');
                        } finally {
                            if (typeof UIService !== 'undefined') UIService.hideLoading();
                        }
                        return;
                    }
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
                            const pubStatus = getCurrentPayslipComponentStatus('gv');
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
                                    currentItem.status = 'pending';
                                }
                            } else {
                                window.selectedStudentCountChips[key] = {
                                    dateStr: chip.dateStr,
                                    sessionId: chip.sessionId,
                                    studentCount: thresholdValue,
                                    status: 'pending'
                                };
                            }
                            renderMonthReport(currentDate);
                        }
                    } else if (window.isBonusSelectMode) {
                        if (chip.sessionId) {
                            try {
                                const btn = e.currentTarget;
                                btn.style.opacity = '0.5';
                                await submitBonus10Request(chip.sessionId, dateStr, staffId, chip);
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
                                    chip.isOffice ? 'office' : chip.isReceptionist
                                );
                            } else {
                                openRoleSelectModal(dateStr, chip.sessionData);
                            }
                        } else if (isAdminRole) {
                            // Creating new session from Registration, pass shift metadata so admin can delete this shift
                            const manualPrefill = chip.schedData
                                ? {
                                    ...chip.schedData,
                                    subjectIds: chip.subjectIds || chip.schedData.subjectIds || [],
                                    lopId: chip.lopId || chip.schedData.lopId || null,
                                    lop: chip.schedData.lop || chip.lop || ''
                                }
                                : chip.schedData;
                            openManualModal(
                                dateStr,
                                manualPrefill,
                                chip.classCompositeKey,
                                chip.classSectionKey,
                                chip.classIndex,
                                chip.isOffice ? 'office' : (chip.isReceptionist ? true : false)
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
                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'report-chip-action';
                editBtn.dataset.editSessionId = String(chip.sessionId);
                editBtn.textContent = '✎ Sửa công';
                editBtn.title = 'Sửa giờ, loại công, đơn giá và +10 phút bằng quyền Admin';
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
                        chip.isOffice ? 'office' : chip.isReceptionist
                    );
                };
                div.appendChild(editBtn);
            }

            // Tăng ca là chức năng khác hoàn toàn với "Sớm 10p". Dùng nút có
            // chữ rõ ràng thay cho một icon đồng hồ đơn độc để tránh bấm nhầm.
            if (role !== 'admin' && chip.sessionId && chip.sessionData && chip.sessionData.checkOut && !chip.overtimePending && !chip.overtimeMinutes) {
                const otBtn = document.createElement('button');
                otBtn.type = 'button';
                otBtn.className = 'report-chip-action report-chip-overtime-action';
                otBtn.innerHTML = window.getIconHtml('clock', {width: '12', height: '12'}) + '<span>Tăng ca</span>';
                otBtn.title = 'Gửi yêu cầu tăng ca (không phải Sớm 10p)';
                otBtn.setAttribute('aria-label', 'Yêu cầu tăng ca');
                otBtn.style.cssText = 'cursor:pointer;font-size:0.66rem;margin-left:4px;padding:3px 7px;border-radius:999px;border:1px solid #BFDBFE;background:#EFF6FF;color:#1D4ED8;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;min-height:26px;';
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

    // Rendering payroll must be read-only. A role may only be persisted from
    // an explicit administrator action in the edit modal; never infer then
    // silently write it back while the calendar is being viewed.

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
        const isReceptionistStaff = currentUserContext && hasReceptionistEmploymentRole(staffRoles);
        const isTeachingStaff = currentUserContext && hasTeachingEmploymentRole(staffRoles);
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
        await loadSalarySettings(isCurrentRender);
    }
    if (!commitCurrentRender(() => { window.payrollReadyScope = reportScope; })) return;

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
        hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
        hasTeaching = hasTeachingEmploymentRole(staffRoles);
    }
    const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
    const isRecep = window.currentLoadedRoleKey
        ? window.currentLoadedRoleKey === 'tiep_tan'
        : (filterVal === 'tiep-tan') || (filterVal === 'all' && hasReceptionist && !hasTeaching);
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
                    value="${formatNumberWithCommas(amount)}" data-index="${criteriaIndex}" oninput="this.dataset.manualEdited='true'; calculateSalary()"
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

// PAYROLL HOUR ALLOCATION HELPERS START
// Mỗi phút làm việc chỉ được thuộc ĐÚNG MỘT nhóm đơn giá.
// Lớp đông (+N HS) là ĐƠN GIÁ THAY THẾ cho ca đó, KHÔNG phải giờ cộng thêm.
// Trước đây ca lớp đông bị cộng vào cả dòng môn học gốc lẫn dòng "(+N HS)",
// làm tổng giờ bị nhân đôi (VD 11h27 thực tế -> hiện 21h25).
// Hình phạt theo THÁNG: admin từ chối/hủy 1 ca (khai sai sĩ số HOẶC sớm 10p)
// thì cả tháng mất phụ cấp lớp đông và mất toàn bộ 10p. Logic dùng chung với
// js/early10.js để trang báo cáo, bảng lương và PDF không lệch nhau.
function isStudentCountPenaltyActive(monthlySettings, chips) {
    if (typeof Early10 !== 'undefined' && Early10.isMonthlyBonusPenaltyActive) {
        return Early10.isMonthlyBonusPenaltyActive(monthlySettings, chips);
    }
    return !!monthlySettings?.studentCountBonusPenalty ||
        (chips || []).some(chip => chip?.studentCountStatus === 'rejected' || chip?.bonus10Status === 'rejected');
}

function normalizeStudentCountApprovalStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();
    return normalized === 'approved' || normalized === 'rejected' ? normalized : 'pending';
}

function getStudentCountBadgePresentation(status, penaltyActive = false) {
    const normalized = normalizeStudentCountApprovalStatus(status);
    if (normalized === 'approved') {
        return penaltyActive
            ? { status: normalized, label: 'Đã duyệt - Bị phạt', className: 'penalty-applied' }
            : { status: normalized, label: 'Đã duyệt', className: 'approved' };
    }
    if (normalized === 'rejected') {
        return penaltyActive
            ? { status: normalized, label: 'Từ chối - Hủy phụ cấp tháng', className: 'rejected' }
            : { status: normalized, label: 'Từ chối', className: 'rejected' };
    }
    return {
        status: 'pending',
        label: penaltyActive ? 'Chờ duyệt - Không tính phụ cấp' : 'Chờ duyệt',
        className: 'pending'
    };
}

// Trả về danh sách phân bổ [{ name, minutes, rate, isStudentCount }] cho 1 ca dạy.
// Luôn trả về đúng 1 phần tử: hoặc dòng môn gốc, hoặc dòng lớp đông — không bao giờ cả hai.
function getTeachingPayAllocations(chip, subjectName, minutes, normalRate, classRates, penaltyActive) {
    const numericMinutes = Number(minutes);
    const totalMinutes = Number.isFinite(numericMinutes) ? Math.max(0, numericMinutes) : 0;
    const baseRate = Number(normalRate) || 0;
    const normalizedSubjectName = String(subjectName || '').trim() || 'Chưa phân lớp';
    // A per-chip rate entered by the primary Admin is the final payroll decision.
    // Student-count and monthly class-rate policies must not silently replace it.
    const adminManualRate = typeof getAuthoritativeAdminPayrollRate === 'function'
        ? getAuthoritativeAdminPayrollRate(chip)
        : null;
    if (adminManualRate !== null) {
        return [{
            name: normalizedSubjectName,
            minutes: totalMinutes,
            rate: adminManualRate,
            isStudentCount: false,
            isAdminPayrollOverride: true
        }];
    }
    const studentCount = Number(chip?.studentCount) || 0;
    const usesStudentCountRate = studentCount > 0 &&
        normalizeStudentCountApprovalStatus(chip?.studentCountStatus) === 'approved' &&
        !penaltyActive;

    if (!usesStudentCountRate) {
        return [{
            name: normalizedSubjectName,
            minutes: totalMinutes,
            rate: baseRate,
            isStudentCount: false
        }];
    }

    const studentCountName = `${normalizedSubjectName} (+${studentCount} HS)`;
    const configuredStudentCountRate = Number(classRates?.[studentCountName]);
    // Chưa cấu hình đơn giá lớp đông thì vẫn phải trả lương gốc, không được thành 0đ.
    const studentCountRate = configuredStudentCountRate > 0
        ? configuredStudentCountRate
        : baseRate;

    return [{
        name: studentCountName,
        minutes: totalMinutes,
        rate: studentCountRate,
        isStudentCount: true
    }];
}
// PAYROLL HOUR ALLOCATION HELPERS END

function calculateSalary() {
    // 1. Get Settings
    const roleFilter = document.getElementById('salary-role-filter')?.value || 'all';

    // 2. Filter Chips & Calculate Minutes
    const hoursDisplay = document.getElementById('role-hours-display');
    if (hoursDisplay) hoursDisplay.innerText = "Đang xử lý...";

    let filteredMinutes = 0;
    let filteredSalary = 0; // Accumulate salary based on role rates
    // Class/day display filters must never change the monthly payroll source.
    const allChips = (window.unfilteredAllMonthChips || window.currentMonthChips || []).filter(c => c.paidMinutes > 0);

    // Breakdown: teaching vs receptionist (for Item 7 — Tách giờ Trợ giảng)
    let teachingMinutes = 0;
    let receptionistMinutes = 0;
    allChips.forEach(chip => {
        const mins = chip.paidMinutes || 0;
        // FIX (v20260710-v6): phân loại theo isReceptionist (đáng tin), KHÔNG theo sessionData.role.
        // Lý do: khi 1 tiếp tân đi dạy thêm (VD chip lớp FFS/Pre sau ca trực), chip lớp đó có
        // recep=undefined nhưng role vẫn = 'tiep-tan' (kế thừa từ người) → nếu xét theo role sẽ
        // đếm nhầm giờ dạy thành giờ tiếp tân, làm phồng "TT" (VD Quang Huy 74h5 -> 78h35).
        const isTT = chip.isReceptionist === true;
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
    const allChipsForStats = window.unfilteredAllMonthChips || window.allMonthChips || allChips;
    allChipsForStats.forEach(chip => {
        if (chip.class === 'chip-future' || chip.isCenterOff) return; // Bỏ ca tương lai và ca nghỉ trung tâm
        const isTiepTan = chip.isReceptionist || (chip.sessionData &&
            ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
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
                    let remainingMinutes = chip.paidMinutes || 0;
                    const totalSched = chip.mergedSegments.reduce((sum, s) => sum + (s.schedMinutes || 0), 0);
                    let fixedMins = 0;
                    chip.mergedSegments.forEach((s, sIdx) => {
                        let segMins = 0;
                        if (totalSched <= 0) {
                            segMins = sIdx === chip.mergedSegments.length - 1 ? remainingMinutes : Math.round((chip.paidMinutes || 0) / chip.mergedSegments.length);
                        } else {
                            segMins = Math.round(((s.schedMinutes || 0) / totalSched) * (chip.paidMinutes || 0));
                            if (sIdx === chip.mergedSegments.length - 1) {
                                segMins = remainingMinutes;
                            } else {
                                remainingMinutes -= segMins;
                            }
                        }
                        if (s.isFixedShift) {
                            fixedMins += segMins;
                        }
                    });
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
            // Do not leave the previous staff/month's detail table on screen.
            window.currentSubjectBreakdown = [];
            window.currentSubjectBreakdownScope = window.currentReportScope || null;
        } else {
            const subjectBreakdown = {};
            allChips.forEach(chip => {
                const minutes = chip.paidMinutes || 0;
                filteredMinutes += minutes;

                // Priority: Class / Ca rate from monthly settings or salary_config.class_rates
                let rate = 0;
                let hasClassRate = false;
                
                const isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
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
                
                const adminManualRate = getAuthoritativeAdminPayrollRate(chip);
                if (adminManualRate !== null) {
                    rate = adminManualRate;
                    hasClassRate = true;
                } else if (chip.chipFilterName && classRates[chip.chipFilterName] !== undefined && Number(classRates[chip.chipFilterName]) > 0) {
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
                        const adminSegmentRate = getAuthoritativeAdminPayrollRate(chip);
                        if (adminSegmentRate !== null) {
                            segRate = adminSegmentRate;
                        } else if (segName && classRates[segName] !== undefined && Number(classRates[segName]) > 0) {
                            segRate = Number(classRates[segName]);
                        } else {
                            const snapshotRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                            segRate = getResolvedTeachingRate(chip, segName, snapshotRate);
                        }
                        const penaltyActive = isStudentCountPenaltyActive(monthlyAll, window.unfilteredAllMonthChips || allChips);
                        getTeachingPayAllocations(chip, segName, segMins, segRate, classRates, penaltyActive).forEach(alloc => {
                            const amount = (alloc.minutes / 60) * alloc.rate;
                            filteredSalary += amount;

                            if (!subjectBreakdown[alloc.name]) {
                                subjectBreakdown[alloc.name] = { minutes: 0, rate: alloc.rate, amount: 0 };
                            }
                            subjectBreakdown[alloc.name].minutes += alloc.minutes;
                            subjectBreakdown[alloc.name].amount += amount;
                        });
                    });
                } else {
                    if (hasClassRate) {
                        if (isTiepTan) {
                            filteredSalary += (minutes / 60) * rate;
                        } else {
                            const segName = chip.chipFilterName || "Chưa phân lớp";
                            const penaltyActive = isStudentCountPenaltyActive(monthlyAll, window.unfilteredAllMonthChips || allChips);
                            getTeachingPayAllocations(chip, segName, minutes, rate, classRates, penaltyActive).forEach(alloc => {
                                const amount = (alloc.minutes / 60) * alloc.rate;
                                filteredSalary += amount;

                                if (!subjectBreakdown[alloc.name]) {
                                    subjectBreakdown[alloc.name] = { minutes: 0, rate: alloc.rate, amount: 0 };
                                }
                                subjectBreakdown[alloc.name].minutes += alloc.minutes;
                                subjectBreakdown[alloc.name].amount += amount;
                            });
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
                        const snapshotRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                        let defaultRate = getResolvedTeachingRate(chip, chip.chipFilterName || "Chưa phân lớp", snapshotRate);
                        if (isTiepTan) {
                            filteredSalary += (minutes / 60) * defaultRate;
                        } else {
                            const segName = chip.chipFilterName || "Chưa phân lớp";
                            const penaltyActive = isStudentCountPenaltyActive(monthlyAll, window.unfilteredAllMonthChips || allChips);
                            getTeachingPayAllocations(chip, segName, minutes, defaultRate, classRates, penaltyActive).forEach(alloc => {
                                const amount = (alloc.minutes / 60) * alloc.rate;
                                filteredSalary += amount;

                                if (!subjectBreakdown[alloc.name]) {
                                    subjectBreakdown[alloc.name] = { minutes: 0, rate: alloc.rate, amount: 0 };
                                }
                                subjectBreakdown[alloc.name].minutes += alloc.minutes;
                                subjectBreakdown[alloc.name].amount += amount;
                            });
                        }
                    }
                }
            });
            window.currentSubjectBreakdown = Object.keys(subjectBreakdown).map(subj => {
                return {
                    name: subj,
                    minutes: subjectBreakdown[subj].minutes,
                    hours: Number((subjectBreakdown[subj].minutes / 60).toFixed(2)),
                    rate: subjectBreakdown[subj].rate,
                    amount: Math.round(subjectBreakdown[subj].amount)
                };
            });
            window.currentSubjectBreakdownScope = window.currentReportScope || null;
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
                const isReceptionID = ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chipRole);
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

                const isReceptionID = ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chipRole);
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
                
                const isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
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
                
                const adminManualRate = getAuthoritativeAdminPayrollRate(chip);
                if (adminManualRate !== null) {
                    rate = adminManualRate;
                    hasClassRate = true;
                } else if (chip.chipFilterName && classRates[chip.chipFilterName] !== undefined && Number(classRates[chip.chipFilterName]) > 0) {
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
                        const adminSegmentRate = getAuthoritativeAdminPayrollRate(chip);
                        if (adminSegmentRate !== null) {
                            segRate = adminSegmentRate;
                        } else if (segName && classRates[segName] !== undefined && Number(classRates[segName]) > 0) {
                            segRate = Number(classRates[segName]);
                        } else {
                            const snapshotRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                            segRate = getResolvedTeachingRate(chip, segName, snapshotRate);
                        }
                        const penaltyActive = isStudentCountPenaltyActive(monthlyAll, window.unfilteredAllMonthChips || allChips);
                        getTeachingPayAllocations(chip, segName, segMins, segRate, classRates, penaltyActive).forEach(alloc => {
                            filteredSalary += (alloc.minutes / 60) * alloc.rate;
                        });
                    });
                } else {
                    if (hasClassRate) {
                        if (isTiepTan) {
                            filteredSalary += (minutes / 60) * rate;
                        } else {
                            const segName = chip.chipFilterName || "Chưa phân lớp";
                            const penaltyActive = isStudentCountPenaltyActive(monthlyAll, window.unfilteredAllMonthChips || allChips);
                            getTeachingPayAllocations(chip, segName, minutes, rate, classRates, penaltyActive).forEach(alloc => {
                                filteredSalary += (alloc.minutes / 60) * alloc.rate;
                            });
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
                        const snapshotRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                        let defaultRate = getResolvedTeachingRate(chip, chip.chipFilterName || "Chưa phân lớp", snapshotRate);
                        if (isTiepTan) {
                            filteredSalary += (minutes / 60) * defaultRate;
                        } else {
                            const segName = chip.chipFilterName || "Chưa phân lớp";
                            const penaltyActive = isStudentCountPenaltyActive(monthlyAll, window.unfilteredAllMonthChips || allChips);
                            getTeachingPayAllocations(chip, segName, minutes, defaultRate, classRates, penaltyActive).forEach(alloc => {
                                filteredSalary += (alloc.minutes / 60) * alloc.rate;
                            });
                        }
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
    const activeAttendanceSettings = window.currentLoadedSalarySettings || {};
    const savedAttendance = (activeAttendanceSettings.evaluation || []).find(e => Number(e.id) === 0);
    const automaticAttendance = savedAttendance?.manual !== true && (!savedAttendance || savedAttendance.amount === undefined || String(savedAttendance.note || '').startsWith('Thưởng chuyên cần:'));
    if (attRate > 0 && evalAmounts.length > 0 && automaticAttendance && evalAmounts[0].dataset.manualEdited !== 'true' && document.activeElement !== evalAmounts[0]) {
        const attInp = evalAmounts[0];
        const activeAttendanceMinutes = window.currentLoadedRoleKey === 'tiep_tan' ? receptionistMinutes : teachingMinutes;
        const calculatedBonus = Math.round((activeAttendanceMinutes / 60) * attRate);

        // Update input value
        attInp.value = calculatedBonus;

        // Also update note if empty or contains previous auto-calculation
        const attNote = evalNotes[0];
        const autoNotePrefix = "Thưởng chuyên cần:";
        if (attNote && (!attNote.value || attNote.value.startsWith(autoNotePrefix))) {
            attNote.value = `${autoNotePrefix} ${attRate.toLocaleString()}đ/h x ${(activeAttendanceMinutes / 60).toFixed(1)}h`;
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
        isRecep = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
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
            hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
            hasTeaching = hasTeachingEmploymentRole(staffRoles);
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
        const checkIsReceptionist = c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role));
        
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

    // The header and the saved/sent document use the same per-role calculation.
    // In particular, do not mix receptionist fees into a teaching-only preview.
    const employmentRoles = window.currentUserContext?.roles || [window.currentUserContext?.role || ''];
    const payrollParts = [];
    if (roleFilter !== 'tiep-tan' && (hasTeachingEmploymentRole(employmentRoles) || teachingMinutes > 0)) {
        payrollParts.push(getCurrentCalculationPayload('giao-vien'));
    }
    if (roleFilter !== 'giao-vien' && (hasReceptionistEmploymentRole(employmentRoles) || receptionistMinutes > 0)) {
        payrollParts.push(getCurrentCalculationPayload('tiep-tan'));
    }
    const canonicalBonus = payrollParts.reduce((sum, p) => sum + p.totalBonus, 0);
    updateBonusDisplay(canonicalBonus);
    window.currentMonthSalary = payrollParts.reduce((sum, p) => sum + p.baseSalary, 0);
    const totalSalary = payrollParts.reduce((sum, p) => sum + p.netPay, 0);

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
        const breakdown = window.currentSubjectBreakdownScope === window.currentReportScope
            ? (window.currentSubjectBreakdown || [])
            : [];
        if (breakdown.length > 0) {
            breakdownSection.style.display = 'block';
            let grandMins = 0;
            let grandAmount = 0;
            breakdown.forEach(item => {
                // Dùng số phút gốc (nếu có) để tổng cộng khớp đúng tổng giờ làm thực tế —
                // item.hours đã bị làm tròn 2 chữ số nên cộng dồn sẽ lệch vài phút.
                const totalMinutes = Number.isFinite(item.minutes) ? item.minutes : item.hours * 60;
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
                    <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 600; color: var(--secondary-color);">${s.roleName || (['van-phong', 'van_phong', 'office_staff'].includes(s.role) ? 'Văn Phòng' : (s.role === 'tiep-tan' ? 'Tiếp Tân' : 'Dạy học'))}</td>
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
    if (!requireCompletePayrollReport()) return;
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
        hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
        hasTeaching = hasTeachingEmploymentRole(staffRoles);
    }
    const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
    const activeFilter = window.currentLoadedRoleKey === 'tiep_tan' ? 'tiep-tan' : 'giao-vien';
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
            amount: amountInp ? (parseFormattedNumber(amountInp.value) || 0) : 0,
            manual: amountInp?.dataset.manualEdited === 'true' || (window.currentLoadedSalarySettings?.evaluation || []).some(e => Number(e.id) === criteriaIndex && e.manual === true)
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
        window.currentMonthlySalarySettingsAll[roleKey] = { ...loadedSettings, ...settingsObj };
        window.currentLoadedSalarySettings = window.currentMonthlySalarySettingsAll[roleKey];
        
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

        // Auto-save calculated payroll as a draft. Published/received snapshots
        // are immutable and require a separate revision workflow.
        const draftResult = await saveCalculationDraftToDb(staffId, monthStr);
        showDraftSaveOutcome(draftResult, 'Đã lưu bảng lương thành công!');
    } catch (e) {
        console.error('Error saving salary settings:', e);
        UIService.toast('Lỗi khi lưu bảng lương: ' + e.message, 'error');
    }
}

async function loadSalarySettings(isCurrent = null) {
    const requestedEpoch = _reportRenderEpoch;
    const requestedStaff = getTargetStaffId();
    const canCommit = typeof isCurrent === 'function' ? isCurrent :
        () => requestedEpoch === _reportRenderEpoch && requestedStaff === getTargetStaffId();
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
        hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
        hasTeaching = hasTeachingEmploymentRole(staffRoles);
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
                const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
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
        const monthlySettings = await DBService.getMonthlySalarySettings(staffId, monthStr, { strict: true }) || {};
        if (!canCommit()) return;
        window.currentMonthlySalarySettingsAll = monthlySettings;
        
        let gvSettings = monthlySettings['giao_vien'] || monthlySettings['giao-vien'];
        let ttSettings = monthlySettings['tiep_tan'] || monthlySettings['tiep-tan'];
        
        // If teaching role is needed but not in monthly settings, fallback to general settings
        if (hasTeaching && !gvSettings) {
            gvSettings = await DBService.getSalarySettings(staffId, { strict: true }) || {};
            if (!canCommit()) return;
            window.currentMonthlySalarySettingsAll['giao_vien'] = gvSettings;
        }
        
        // If receptionist role is needed but not in monthly settings, fallback to general settings
        if (hasReceptionist && !ttSettings) {
            ttSettings = await DBService.getSalarySettings(staffId, { strict: true }) || {};
            if (!canCommit()) return;
            if (!ttSettings.evaluation) {
                ttSettings.evaluation = [];
            }
            window.currentMonthlySalarySettingsAll['tiep_tan'] = ttSettings;
        }
        
        settings = roleKey === 'tiep_tan' ? ttSettings : gvSettings;
        if (!settings) settings = {};
    } catch (e) {
        console.error('Error loading salary settings:', e);
        if (canCommit()) renderReportLoadFailure(e);
        throw e;
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
        const revDoc = await window.db.collection('settings').doc(`recep_revenue_${monthStr}`).get({ source: 'server' });
        if (!canCommit()) return;
        const revenues = revDoc.exists ? revDoc.data() : { total: 0, cs2: 0 };
        
        const headerTotal = document.getElementById('header-actual-revenue-total');
        const headerCs2 = document.getElementById('header-actual-revenue-cs2');
        
        if (headerTotal) headerTotal.value = formatNumberWithCommas(revenues.total || 0);
        if (headerCs2) headerCs2.value = formatNumberWithCommas(revenues.cs2 || 0);
    } catch (e) {
        console.error('Error loading global monthly revenues:', e);
        if (canCommit()) renderReportLoadFailure(e);
        throw e;
    }

    if (hasReceptionist) {
        try {
            // Collective bonuses are financial input, not a background cosmetic
            // enhancement. A stale month must never replace the current points.
            await loadAndComputeAllReceptionists(monthStr, canCommit);
            if (!canCommit()) return;
        } catch (e) {
            console.error('Error loading receptionist cống hiến points:', e);
            if (canCommit()) renderReportLoadFailure(e);
            throw e;
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
        const lifecycle = publishedObj && typeof DBService.getPayslipLifecycleState === 'function'
            ? DBService.getPayslipLifecycleState(publishedObj)
            : null;
        const componentStatus = lifecycle
            ? (activeFilter === 'tiep-tan' ? lifecycle.status_tt : lifecycle.status_gv)
            : (publishedObj?.status || 'draft');
        if (publishedObj) {
            publishBadge.style.display = 'inline-block';
            if (componentStatus === 'received') {
                publishBadge.innerText = 'Đã Nhận Lương';
                publishBadge.style.backgroundColor = '#D1FAE5';
                publishBadge.style.color = '#065F46';
                publishBadge.style.border = '1px solid #10B981';
                publishBtn.innerHTML = `${window.getIconHtml('send', {width: '14', height: '14'})} Gửi Lại Bảng Lương`;
            } else if (componentStatus === 'published') {
                publishBadge.innerText = 'Đã Gửi Bảng Lương';
                publishBadge.style.backgroundColor = '#DBEAFE';
                publishBadge.style.color = '#1E40AF';
                publishBadge.style.border = '1px solid #3B82F6';
                publishBtn.innerHTML = `${window.getIconHtml('send', {width: '14', height: '14'})} Gửi Lại Bảng Lương`;
            } else {
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

async function openNoteModal(dateKey) {
    currentNoteDateKey = dateKey;
    currentEvalIndex = null;

    const staffId = getTargetStaffId();
    document.getElementById('note-modal-title').innerText = `Ghi Chú Ngày ${dateKey}`;
    // Chỉ dùng bộ nhớ khi nó ĐÚNG là ghi chú của người đang chọn; nếu không thì đọc lại,
    // để ô ghi chú không bao giờ hiện nội dung của người khác.
    let text = '';
    if (_cachedNotesOwnerId && staffId && String(_cachedNotesOwnerId) === String(staffId)) {
        text = _cachedStaffNotes[dateKey] || '';
    } else if (staffId) {
        try {
            const fresh = await DBService.getDailyNotes(staffId, { strict: true }) || {};
            _cachedStaffNotes = fresh;
            _cachedNotesOwnerId = staffId;
            text = fresh[dateKey] || '';
        } catch (e) {
            console.error('Error loading notes for modal:', e);
        }
    }
    document.getElementById('note-content').value = text;
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
    const noteDateKey = currentNoteDateKey;

    if (!staffId) {
        alert('Chưa xác định được nhân viên nên chưa lưu được ghi chú. Vui lòng chọn lại nhân viên.');
        return;
    }

    try {
        const savedNote = await DBService.updateDailyNote(staffId, noteDateKey, note);
        if (String(getTargetStaffId() || '') === String(staffId)) {
            if (String(_cachedNotesOwnerId || '') === String(staffId)) {
                if (savedNote) _cachedStaffNotes[noteDateKey] = savedNote;
                else delete _cachedStaffNotes[noteDateKey];
            } else {
                // Do not invent an incomplete cache when this modal was opened
                // during a staff switch; the next render will reload the owner.
                _cachedStaffId = null;
                _cachedNotesOwnerId = null;
            }
        }
    } catch (e) {
        console.error('Error saving note to Firestore:', e);
        alert('Lỗi lưu ghi chú: ' + (e.message || e));
        return;
    }

    if (currentNoteDateKey === noteDateKey) closeNoteModal();
    if (String(getTargetStaffId() || '') === String(staffId)) renderMonthReport(currentDate);
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
            ...(flatpickr.l10ns && flatpickr.l10ns.vn ? { locale: flatpickr.l10ns.vn } : {}),
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
        shiftTypeContainer.style.display = (val === 'tiep-tan' || val === 'van-phong') ? 'block' : 'none';
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
// Subjects suggested from the linked schedule.  Saving the same selection is
// an automatic schedule match; changing it is an explicit admin override.
let editSuggestedSubjectIds = [];
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
    const cb = Array.from(document.querySelectorAll('#subject-dropdown-list input[data-subject-id]'))
        .find(input => input.dataset.subjectId === String(subId));
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
    container.replaceChildren();
    
    if (editSelectedSubjectIds.length === 0) {
        const empty = document.createElement('span');
        empty.style.cssText = 'color:#9CA3AF;font-size:0.85rem;font-style:italic;';
        empty.textContent = 'Chưa chọn môn học nào';
        container.appendChild(empty);
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
        const label = document.createElement('span');
        label.textContent = String(sub.name || 'Môn học');

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Bỏ môn ${String(sub.name || 'Môn học')}`);
        remove.style.cssText = 'cursor:pointer;font-weight:bold;color:#9CA3AF;margin-left:4px;border:0;background:transparent;padding:0;';
        remove.textContent = '✕';
        remove.addEventListener('click', event => {
            event.stopPropagation();
            window.toggleSubjectSelection(sub.id, sub.name, sub.rate);
        });

        badge.append(label, remove);
        container.appendChild(badge);
    });
}

// REPORT_SUBJECT_OPTION_RENDER_START
function createSubjectDropdownItem(sub, isChecked) {
    const item = document.createElement('div');
    item.className = 'subject-dropdown-item';
    item.dataset.name = String(sub.name || '');
    item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0.75rem 1rem;
        cursor: pointer;
        border-bottom: 1px solid #F3F4F6;
        transition: background 0.2s;
    `;
    item.addEventListener('mouseenter', () => { item.style.background = '#F3F4F6'; });
    item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
    item.addEventListener('click', () => window.toggleSubjectSelection(sub.id, sub.name, sub.rate));

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!isChecked;
    checkbox.dataset.subjectId = String(sub.id || '');
    checkbox.tabIndex = -1;
    checkbox.setAttribute('aria-hidden', 'true');
    checkbox.style.cssText = 'width:18px;height:18px;accent-color:#10B981;pointer-events:none;';

    const name = document.createElement('span');
    name.style.cssText = 'font-size:0.95rem;color:#374151;';
    name.textContent = String(sub.path || sub.name || 'Môn học');

    const rate = document.createElement('span');
    rate.style.cssText = 'margin-left:auto;font-size:0.8rem;color:#9CA3AF;font-weight:500;';
    rate.textContent = `${Number(sub.rate || 0).toLocaleString('vi-VN')}đ/h`;

    item.append(checkbox, name, rate);
    return item;
}
// REPORT_SUBJECT_OPTION_RENDER_END

function ensureSubjectRatePolicyLoaded() {
    if (window.SubjectRatePolicy) return Promise.resolve(window.SubjectRatePolicy);
    if (window._subjectRatePolicyPromise) return window._subjectRatePolicyPromise;
    window._subjectRatePolicyPromise = new Promise(function (resolve) {
        const script = document.createElement('script');
        script.src = 'js/subject-rate-policy.js?v=20260809-subject-rate-v1';
        script.onload = function () { resolve(window.SubjectRatePolicy || null); };
        script.onerror = function () { console.warn('Subject rate policy unavailable; keeping legacy rates.'); resolve(null); };
        document.head.appendChild(script);
    });
    return window._subjectRatePolicyPromise;
}

function getRatePolicyDateKey() {
    const input = document.getElementById('edit-date-key');
    if (input && /^\d{4}-\d{2}-\d{2}$/.test(input.value)) return input.value;
    return new Date().toISOString().slice(0, 10);
}

function getChipRatePolicyDateKey(chip) {
    const session = chip?.sessionData || {};
    const dateKey = chip?.dateStr || chip?.dateKey || session.dateKey || session.date;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))
        ? String(dateKey)
        : getRatePolicyDateKey();
}

function normalizeSubjectLookupName(value) {
    const raw = String(value || '').replace(/\s*\(\+\d+\s*HS\)\s*$/i, '').trim().toLowerCase();
    const withoutTones = typeof removeVietnameseTones === 'function' ? removeVietnameseTones(raw) : raw;
    return withoutTones.replace(/[^a-z0-9]+/g, '');
}

function getAuthoritativeAdminPayrollRate(chip) {
    const value = Number(chip?.payrollRate);
    return chip?.isAdminPayrollOverride === true && chip?.payrollRateMode === 'manual' &&
        Number.isFinite(value) && value >= 0
        ? value
        : null;
}
window.getAuthoritativeAdminPayrollRate = getAuthoritativeAdminPayrollRate;

function ensurePayrollRateGroup(groups, name) {
    const key = String(name || '').trim();
    if (!key) return null;
    if (!groups[key]) {
        groups[key] = {
            name: key,
            chips: [],
            totalMinutes: 0,
            policyMinutes: 0,
            manualMinutes: 0,
            manualAmount: 0,
            manualRates: []
        };
    }
    return groups[key];
}

function trackPayrollRateGroupChip(groups, name, chip) {
    const group = ensurePayrollRateGroup(groups, name);
    if (group && chip && !group.chips.includes(chip)) group.chips.push(chip);
    return group;
}

function addPayrollRateGroupMinutes(groups, name, chip, minutes) {
    const group = trackPayrollRateGroupChip(groups, name, chip);
    if (!group) return null;
    const numericMinutes = Number(minutes);
    const safeMinutes = Number.isFinite(numericMinutes) ? Math.max(0, numericMinutes) : 0;
    const manualRate = getAuthoritativeAdminPayrollRate(chip);
    group.totalMinutes += safeMinutes;
    if (manualRate !== null) {
        group.manualMinutes += safeMinutes;
        group.manualAmount += (safeMinutes / 60) * manualRate;
        if (!group.manualRates.includes(manualRate)) group.manualRates.push(manualRate);
    } else {
        group.policyMinutes += safeMinutes;
    }
    return group;
}

function getPayrollRateGroupAmount(group, policyRate, policyDisabled = false) {
    const manualAmount = Number(group?.manualAmount) || 0;
    const policyMinutes = Number(group?.policyMinutes) || 0;
    const rate = Number(policyRate) || 0;
    return manualAmount + (policyDisabled ? 0 : (policyMinutes / 60) * rate);
}

function getResolvedTeachingRate(chip, subjectName, fallbackRate) {
    const adminRate = getAuthoritativeAdminPayrollRate(chip);
    if (adminRate !== null) return adminRate;
    const legacyRate = Number(fallbackRate) || 0;
    const policyApi = window.SubjectRatePolicy;
    const config = window.currentUserContext?.salary_config || {};
    const subjects = Array.isArray(window.currentSubjectCatalog) ? window.currentSubjectCatalog : [];
    const policy = config.subjectRatePolicy;
    const dateKey = getChipRatePolicyDateKey(chip);

    // Resolver is deliberately read-only.  When the policy is disabled, not yet
    // effective, or the catalog cannot identify the subject, the exact legacy
    // snapshot on the attendance chip remains authoritative.
    if (!policyApi || !policyApi.resolve || !policyApi.isActive || !policyApi.isActive(policy, dateKey) || subjects.length === 0) {
        return legacyRate;
    }

    const leafSubjects = subjects.filter(subject => subject && subject.isGroup !== true);
    const subjectIds = new Set(leafSubjects.map(subject => String(subject.id)));
    const sessionRole = chip?.sessionData?.role;
    const shouldPreferScheduledSubject = chip?.usesScheduledSubject === true &&
        chip?.sessionData?.subjectOverride !== true;
    let ids = shouldPreferScheduledSubject
        ? (chip?.subjectIds || []).map(id => String(id)).filter(id => subjectIds.has(id))
        : String(sessionRole || '')
            .split('+')
            .map(id => id.trim())
            .filter(id => id && subjectIds.has(id));

    // Older attendance rows can retain only the subject name.  Apply a name
    // fallback only when it is unambiguous; duplicate names across branches are
    // intentionally left on legacy pricing to avoid a silent misclassification.
    const lookup = normalizeSubjectLookupName(subjectName || chip?.chipFilterName);
    if (ids.length > 1 && lookup) {
        const matchingRoleIds = ids.filter(id => {
            const subject = leafSubjects.find(item => String(item.id) === id);
            return subject && normalizeSubjectLookupName(subject.name) === lookup;
        });
        if (matchingRoleIds.length === 1) ids = matchingRoleIds;
    }
    if (ids.length === 0) {
        const matches = leafSubjects.filter(subject => normalizeSubjectLookupName(subject.name) === lookup);
        if (matches.length === 1) ids = [String(matches[0].id)];
    }

    if (ids.length === 0) return legacyRate;
    const resolvedRates = ids
        .map(id => {
            const result = policyApi.resolve(config, subjects, id, dateKey, legacyRate);
            return Number(result && result.rate);
        })
        .filter(rate => Number.isFinite(rate) && rate > 0);
    return resolvedRates.length > 0
        ? resolvedRates.reduce((sum, rate) => sum + rate, 0) / resolvedRates.length
        : legacyRate;
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
        
        // 2. Add other subjects from database.
        // Nhóm môn (isGroup) chỉ là thư mục sắp xếp — không phải môn dạy được.
        subjects.filter(s => s.isGroup !== true).forEach(s => {
            if (!allAvailableSubjects.some(item => item.id === s.id)) {
                allAvailableSubjects.push({
                    id: s.id,
                    name: s.name,
                    rate: Number(fallbackRate)
                });
            }
        });
        
        const policyApi = await ensureSubjectRatePolicyLoaded();
        const legacySubjects = allAvailableSubjects.slice();
        const policyOptions = policyApi && policyApi.leafOptions
            ? policyApi.leafOptions(user.salary_config || {}, subjects, getRatePolicyDateKey(), fallbackRate)
            : [];
        if (policyOptions.length > 0) {
            allAvailableSubjects = policyOptions.map(function (subject) {
                return { id: subject.id, name: subject.name, path: subject.path, rate: Number(subject.rate) || 0, source: subject.source };
            });
            legacySubjects.forEach(function (role) {
                if (!allAvailableSubjects.some(function (item) { return item.id === role.id; })) allAvailableSubjects.push(role);
            });
        }

        list.replaceChildren();
        allAvailableSubjects.forEach(sub => {
            const isChecked = editSelectedSubjectIds.includes(sub.id);
            list.appendChild(createSubjectDropdownItem(sub, isChecked));
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
        const hasOfficeRole = hasOfficeEmploymentRole(userRolesArr);
        const hasReceptionistRole = userRolesArr.some(role => [
            'receptionist', 'receptionist_assistant', 'receptionist_lead',
            'receptionist_staff', 'senior_assistant', 'tiep-tan', 'tiep_tan'
        ].includes(role));
        const hasTeachingRole = hasTeachingEmploymentRole(userRolesArr);
        const primaryAdminOverride = isPrimaryPayrollAdminViewer();

        let hasSelected = false;

        // 1. Option Tiếp Tân
        if (hasReceptionistRole || primaryAdminOverride) {
            const opt = document.createElement('option');
            opt.value = 'tiep-tan';
            opt.textContent = hasReceptionistRole ? 'Tiếp Tân' : 'Tiếp Tân (ngoại lệ Admin)';
            opt.dataset.adminException = hasReceptionistRole ? 'false' : 'true';
            opt.dataset.rate = user.salary_config?.receptionist_normal_rate || 0;
            if (currentRoleId === 'tiep-tan' || currentRoleId === 'receptionist') {
                opt.selected = true;
                hasSelected = true;
            }
            select.appendChild(opt);
        }

        // 2. Option Văn Phòng — vẫn dùng đơn giá ca vận hành chung nhưng giữ
        // role riêng để bảng công và liên kết lịch không bị ghi thành Tiếp Tân.
        if (hasOfficeRole || primaryAdminOverride) {
            const opt = document.createElement('option');
            opt.value = 'van-phong';
            opt.textContent = hasOfficeRole ? 'Văn Phòng' : 'Văn Phòng (ngoại lệ Admin)';
            opt.dataset.adminException = hasOfficeRole ? 'false' : 'true';
            opt.dataset.rate = user.salary_config?.receptionist_normal_rate || 0;
            if (['van-phong', 'van_phong', 'office_staff'].includes(currentRoleId)) {
                opt.selected = true;
                hasSelected = true;
            }
            select.appendChild(opt);
        }

        // 3. Option Giáo Viên / Trợ Giảng
        if (hasTeachingRole || primaryAdminOverride) {
            const opt = document.createElement('option');
            opt.value = 'giao-vien';
            opt.textContent = hasTeachingRole ? 'Giáo Viên / Trợ Giảng' : 'Giáo Viên / Trợ Giảng (ngoại lệ Admin)';
            opt.dataset.adminException = hasTeachingRole ? 'false' : 'true';
            if (!hasSelected || (currentRoleId && !['tiep-tan', 'receptionist', 'van-phong', 'van_phong', 'office_staff'].includes(currentRoleId))) {
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
        shiftTypeContainer.style.display = (val === 'tiep-tan' || val === 'van-phong') ? 'block' : 'none';
    }
    const subjectsContainer = document.getElementById('edit-subjects-container');
    if (subjectsContainer) {
        subjectsContainer.style.display = (val === 'giao-vien') ? 'block' : 'none';
    }
}

async function openManualModal(dateKey, preFill = null, classCompositeKey = '', classSectionKey = '', classIndex = '', isLinkable = false) {
    const linkType = isLinkable === 'office' ? 'office' : (isLinkable ? 'receptionist' : 'teaching');
    window.currentAdminPayrollEditContext = null;
    if (window.AdminPayrollOverrideUI) window.AdminPayrollOverrideUI.close();
    document.getElementById('edit-time-modal').style.display = 'flex';
    const staleAdminApproval = document.getElementById('admin-approval-section');
    if (staleAdminApproval) staleAdminApproval.style.display = 'none';
    document.getElementById('edit-date-key').value = dateKey;
    document.getElementById('edit-session-id').value = 'NEW'; // Marker for new session
    const statusEl = document.getElementById('edit-session-status');
    if (statusEl) statusEl.value = 'worked';

    // Modal dùng chung cho Sửa và Tạo mới. Xoá nội dung lần mở trước để popup
    // Tạo ca không giữ lại bảng chi tiết của ca tiếp tân/dạy vừa xem.
    const staleBreakdown = document.getElementById('edit-day-breakdown');
    const staleBreakdownList = document.getElementById('edit-day-breakdown-list');
    const staleBreakdownTotal = document.getElementById('edit-day-breakdown-total');
    if (staleBreakdown) staleBreakdown.style.display = 'none';
    if (staleBreakdownList) staleBreakdownList.innerHTML = '';
    if (staleBreakdownTotal) staleBreakdownTotal.innerText = '';
    const staleSplitContainer = document.getElementById('edit-split-subshift-container');
    const staleSplitList = document.getElementById('edit-split-subshift-list');
    if (staleSplitContainer) staleSplitContainer.style.display = 'none';
    if (staleSplitList) staleSplitList.innerHTML = '';

    // Reset class metadata fields just in case
    if (document.getElementById('edit-class-composite-key')) {
        document.getElementById('edit-class-composite-key').value = classCompositeKey || '';
        document.getElementById('edit-class-section-key').value = classSectionKey || '';
        document.getElementById('edit-class-index').value = classIndex !== undefined ? classIndex : '';
        document.getElementById('edit-class-is-receptionist').value = linkType === 'office' ? 'office' : (linkType === 'receptionist' ? 'true' : '');
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
    let matchedRoleIds = [];
    if (isLinkable) {
        matchedRoleId = linkType === 'office' ? 'van-phong' : 'tiep-tan';
    } else {
        try {
            if (preFill) {
                const users = await DBService.getUsers();
                const user = users.find(u => u.id === staffId);
                if (user) {
                    let teachingRoles = (user.salary_config && user.salary_config.roles ? user.salary_config.roles : [])
                        .filter(r => r.id !== 'tiep-tan' && r.id !== 'receptionist');
                    const subjects = await DBService.getSubjects();
                    const policyApi = await ensureSubjectRatePolicyLoaded();
                    if (policyApi && policyApi.leafOptions) {
                        const fallbackRate = teachingRoles.length > 0 ? teachingRoles[0].rate : (user.salary_config?.attendance_rate || 0);
                        policyApi.leafOptions(user.salary_config || {}, subjects, dateKey, fallbackRate).forEach(option => {
                            if (!teachingRoles.some(role => String(role.id) === String(option.id))) {
                                teachingRoles.push({ id: option.id, name: option.path || option.name, rate: option.rate });
                            }
                        });
                    }

                    // Even when no salary role/policy has been configured yet,
                    // the schedule can still contain valid subject ids/names.
                    // Include leaf subjects as matching candidates so creating
                    // a manual session does not unnecessarily ask the admin to
                    // select subjects again.
                    const fallbackRate = teachingRoles.length > 0
                        ? teachingRoles[0].rate
                        : (user.salary_config?.attendance_rate || 0);
                    subjects.filter(subject => subject && subject.isGroup !== true).forEach(subject => {
                        if (!teachingRoles.some(role => String(role.id) === String(subject.id))) {
                            teachingRoles.push({
                                id: subject.id,
                                name: subject.name,
                                rate: Number(subject.rate) || Number(fallbackRate) || 0
                            });
                        }
                    });
                    
                    // A chained class can contain several subject ids/names, for
                    // example "FSS01+FSS02 + Pre-I2".  The old code only tried
                    // to match the whole string as one subject, so the modal
                    // showed the class name but kept the subject selector empty.
                    const subjectCandidates = [];
                    const addCandidate = value => {
                        if (Array.isArray(value)) {
                            value.forEach(addCandidate);
                            return;
                        }
                        if (value === null || value === undefined) return;
                        String(value).split('+').map(part => part.trim()).filter(Boolean).forEach(part => {
                            if (!subjectCandidates.includes(part)) subjectCandidates.push(part);
                        });
                    };
                    addCandidate(preFill.subjectIds);
                    addCandidate(preFill.lopId);
                    addCandidate(preFill.lop);

                    const normalizeCandidate = value => {
                        if (typeof normalizeSubjectLookupName === 'function') {
                            return normalizeSubjectLookupName(value);
                        }
                        return String(value || '').toLowerCase().replace(/\s+/g, '');
                    };
                    const candidateIds = new Set();
                    const addMatchedId = id => {
                        if (id !== null && id !== undefined && String(id).trim()) {
                            candidateIds.add(String(id));
                        }
                    };

                    subjectCandidates.forEach(candidate => {
                        const candidateText = String(candidate).trim();
                        const candidateKey = normalizeCandidate(candidateText);
                        if (!candidateKey) return;

                        // Prefer an exact id match. This handles composite lopId
                        // values such as "subject-fss01+subject-fss02".
                        const byId = teachingRoles.find(role => String(role.id) === candidateText);
                        if (byId) {
                            addMatchedId(byId.id);
                            return;
                        }

                        // Then match the leaf name. Policy options may display a
                        // full path such as "Tiếng anh › FSS01", while the
                        // schedule stores only "FSS01".
                        const byName = teachingRoles.find(role => {
                            const roleName = String(role.name || '');
                            const leafName = roleName.split(/[›>]/).pop().trim();
                            return normalizeCandidate(roleName) === candidateKey ||
                                normalizeCandidate(leafName) === candidateKey;
                        });
                        if (byName) addMatchedId(byName.id);
                    });

                    matchedRoleIds = Array.from(candidateIds);

                    // Fallback to a single configured teaching role if there
                    // is no subject metadata at all.
                    if (matchedRoleIds.length === 0 && teachingRoles.length === 1) {
                        matchedRoleIds = [String(teachingRoles[0].id)];
                    }
                    matchedRoleId = matchedRoleIds[0] || null;
                }
            }
        } catch (err) {
            console.warn("Failed to auto-select role:", err);
        }
    }
    if (isLinkable) {
        editSelectedSubjectIds = [];
    } else {
        editSelectedSubjectIds = matchedRoleIds.length > 0
            ? matchedRoleIds
            : (matchedRoleId ? [matchedRoleId] : []);
    }

    await populateRoleDropdown(staffId, 'edit-role', matchedRoleId);
    await loadAndRenderSubjects(staffId);
    editSuggestedSubjectIds = [...editSelectedSubjectIds];

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
    const manualSubtitle = document.getElementById('edit-modal-subtitle');
    if (manualSubtitle) {
        const kindLabel = linkType === 'office' ? 'Ca văn phòng' : (isLinkable ? 'Ca tiếp tân' : 'Ca dạy');
        const range = preFill && preFill.start && preFill.end
            ? ` Â· ${preFill.start}â€“${preFill.end}`
            : '';
        const subject = !isLinkable && preFill && preFill.lop
            ? ` (${preFill.lop})`
            : '';
        manualSubtitle.innerText = `${kindLabel} Â· ${dateKey}${range}${subject}`;
    }

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
    const linkType = isReceptionist === 'office' ? 'office' : (isReceptionist ? 'receptionist' : 'teaching');
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
    document.getElementById('edit-class-is-receptionist').value = linkType === 'office' ? 'office' : (linkType === 'receptionist' ? 'true' : '');

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

    const isOperationalSession = sessionData && [
        'tiep-tan', 'receptionist', 'van-phong', 'van_phong', 'office_staff'
    ].includes(sessionData.role);
    if (isOperationalSession) {
        editSelectedSubjectIds = [];
    } else {
        editSelectedSubjectIds = (sessionData && sessionData.role) ? sessionData.role.split('+') : [];
    }

    await populateRoleDropdown(staffId, 'edit-role', sessionData ? sessionData.role : null);
    await loadAndRenderSubjects(staffId);

    const rawSession = (window.currentAttendanceMap?.[dateKey] || []).find(session =>
        String(session?.id || '') === String(sessionId)
    ) || sessionData;
    const canAuthorPayrollOverride = isPrimaryPayrollAdminViewer() &&
        !!rawSession && sessionId && sessionId !== 'NEW' && String(sessionId) !== 'null';
    if (canAuthorPayrollOverride && window.AdminPayrollOverrideUI &&
        typeof DBService.getAdminPayrollSessionFingerprint === 'function') {
        window.currentAdminPayrollEditContext = {
            staffId,
            dateKey,
            sessionId: String(sessionId),
            expectedFingerprint: DBService.getAdminPayrollSessionFingerprint(rawSession),
            expectedRevision: Number(rawSession?.adminPayrollOverride?.revision || 0)
        };
        window.AdminPayrollOverrideUI.open({
            isPrimaryAdmin: true,
            staffId,
            dateKey,
            sessionId: String(sessionId),
            session: rawSession,
            chip,
            user: window.currentUserContext || {},
            subjects: Array.isArray(window.currentSubjectCatalog) ? window.currentSubjectCatalog : []
        });
    } else {
        window.currentAdminPayrollEditContext = null;
        if (window.AdminPayrollOverrideUI) window.AdminPayrollOverrideUI.close();
    }

    // A linked class is the normal source of truth. Old admin-edited rows can
    // retain a stale roleName; make the modal show the current scheduled
    // subject unless the admin previously chose an explicit override.
    if (!isOperationalSession && chip?.usesScheduledSubject === true && sessionData?.subjectOverride !== true && chip.scheduledSubjectName) {
        const scheduleNames = String(chip.scheduledSubjectName).split('+').map(name => normalizeSubjectLookupName(name));
        const suggested = allAvailableSubjects
            .filter(subject => scheduleNames.includes(normalizeSubjectLookupName(subject.name)))
            .map(subject => subject.id);
        if (suggested.length > 0) editSelectedSubjectIds = suggested;
    }
    editSuggestedSubjectIds = [...editSelectedSubjectIds];

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

    // --- TIÊU ĐỀ PHỤ: cho biết đang sửa ca nào của ngày nào ---
    const subtitleEl = document.getElementById('edit-modal-subtitle');
    if (subtitleEl) {
        const plainChipText = String(chip.text || '').replace(/<[^>]*>/g, '').trim();
        const kindLabel = linkType === 'office' ? 'Ca văn phòng' : (isReceptionist ? 'Ca tiếp tân' : 'Ca dạy');
        subtitleEl.innerText = `${kindLabel} · ${dateKey}${plainChipText ? ' · ' + plainChipText : ''}`;
    }

    // --- CHI TIẾT CA TRONG NGÀY (ngày vừa trực tiếp tân vừa dạy) ---
    // Quy tắc GĐ: KHÔNG gộp cứng thành 1 chip. Ngày làm được cắt thành từng khúc, mỗi khúc
    // tính đúng đơn giá của nó; ô này cho admin thấy đủ các khúc để đối chiếu khi chỉnh sửa.
    const breakdownBox = document.getElementById('edit-day-breakdown');
    const breakdownList = document.getElementById('edit-day-breakdown-list');
    const breakdownTotal = document.getElementById('edit-day-breakdown-total');
    if (breakdownBox && breakdownList) {
        const segs = Array.isArray(chip.daySegments) ? chip.daySegments : [];
        if (segs.length > 1 && segs.some(s => s.kind === 'day')) {
            const fmt = (mins) => {
                const h = Math.floor(mins / 60), m = mins % 60;
                return h > 0 ? `${h}h${m > 0 ? m + 'p' : ''}` : `${m}p`;
            };
            const recepMin = segs.filter(s => s.kind === 'tiep-tan').reduce((a, s) => a + s.minutes, 0);
            const teachMin = segs.filter(s => s.kind === 'day').reduce((a, s) => a + s.minutes, 0);
            const missingMin = segs.filter(s => s.kind === 'missing').reduce((a, s) => a + (s.scheduledMinutes || 0), 0);

            breakdownList.innerHTML = segs.map((seg, i) => {
                const isTeach = seg.kind === 'day';
                const isMissing = seg.kind === 'missing';
                const accent = isMissing ? '#B91C1C' : (isTeach ? '#B45309' : '#3730A3');
                const bg = isMissing ? '#FEF2F2' : (isTeach ? '#FEF3C7' : '#FFFFFF');
                const border = isMissing ? '#FCA5A5' : (isTeach ? '#FCD34D' : '#C7D2FE');
                const tag = isMissing ? 'CHƯA CHẤM' : (isTeach ? 'DẠY' : (chip.isOffice ? 'VĂN PHÒNG' : 'TIẾP TÂN'));
                const minutesText = isMissing
                    ? `${fmt(seg.scheduledMinutes || 0)} · chưa tính`
                    : fmt(seg.minutes);
                return `<div style="display:flex;align-items:center;gap:10px;background:${bg};border:1px solid ${border};border-radius:9px;padding:0.5rem 0.7rem;">
                    <span style="font-size:0.72rem;font-weight:800;color:${accent};min-width:64px;">${tag}</span>
                    <span style="font-weight:700;font-size:0.9rem;color:#111827;min-width:104px;">${escapeReportHtml(seg.start)}–${escapeReportHtml(seg.end)}</span>
                    <span style="flex:1;min-width:0;font-size:0.85rem;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeReportHtml(seg.label || '')}</span>
                    <span style="font-size:0.82rem;font-weight:700;color:${accent};">${minutesText}</span>
                </div>`;
            }).join('');

            if (breakdownTotal) {
                breakdownTotal.innerText = `${chip.isOffice ? 'Văn phòng' : 'Tiếp tân'} ${fmt(recepMin)} · Dạy ${fmt(teachMin)}${missingMin > 0 ? ` · Chưa chấm ${fmt(missingMin)}` : ''}`;
            }
            breakdownBox.style.display = 'block';
        } else {
            breakdownBox.style.display = 'none';
            breakdownList.innerHTML = '';
            if (breakdownTotal) breakdownTotal.innerText = '';
        }
    }

    // --- TÁCH CA GỘP: chỉ hiện với ca tiếp tân gộp từ nhiều ca con ---
    const splitContainer = document.getElementById('edit-split-subshift-container');
    const splitList = document.getElementById('edit-split-subshift-list');
    if (splitContainer && splitList) {
        // Ưu tiên allSubShifts (full ca con gốc) để sau khi tách vẫn bỏ đánh dấu vắng được.
        const segs = (chip && Array.isArray(chip.allSubShifts)) ? chip.allSubShifts
                   : ((chip && Array.isArray(chip.mergedSegments)) ? chip.mergedSegments : []);
        if (isReceptionist && segs.length > 1) {
            // Ưu tiên đánh dấu TAY của admin; nếu chưa có thì lấy kết quả TỰ ĐỘNG (ca con đang bị coi là vắng).
            const absentSource = (sessionData && Array.isArray(sessionData.absentSubShifts))
                ? sessionData.absentSubShifts
                : (Array.isArray(chip.splitAbsentStarts) ? chip.splitAbsentStarts : []);
            const absentSet = new Set(absentSource);
            splitList.innerHTML = '';
            segs.forEach(seg => {
                const worked = !absentSet.has(seg.start);
                const row = document.createElement('label');
                row.style.cssText = 'display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.9rem;color:#374151;';
                row.innerHTML = `<input type="checkbox" class="edit-subshift-cb" data-start="${seg.start}" ${worked ? 'checked' : ''} style="width:16px;height:16px;accent-color:#10B981;"> Ca ${seg.start}–${seg.end}`;
                splitList.appendChild(row);
            });
            splitContainer.style.display = 'block';
        } else {
            splitContainer.style.display = 'none';
            splitList.innerHTML = '';
        }
    }

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
            const canSeeBonus10 = !isReceptionist && isTargetTA;

            if (canSeeBonus10) {
                b10Container.style.display = 'flex';
                b10Actions.innerHTML = '';
                const b10Status = chip.bonus10Status;
                if (b10Status === 'admin_override') {
                    b10Actions.innerHTML = `
                        <span style="color: #166534; font-weight: 600; font-size: 0.9rem; margin-right: 8px;">★ +10p theo quyết định Admin</span>
                        <span style="display:block;font-size:.78rem;color:#475569;margin-top:4px;">Mở phần “Quyền Admin · nguồn tính chip”, bỏ chọn “Cộng +10 phút theo quyết định Admin” rồi lưu nếu cần hủy.</span>
                    `;
                } else if (b10Status === 'approved') {
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
                } else if (b10Status === 'rejected') {
                    b10Actions.innerHTML = `
                        <span style="color: #DC2626; font-weight: 600; font-size: 0.9rem; margin-right: 8px;">✕ Đã hủy — cả tháng mất 10p &amp; lớp đông</span>
                        <button type="button" class="btn" style="padding: 4px 10px; font-size: 0.8rem; background: #6B7280; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="clearEarly10Penalty('${staffId}')">Gỡ phạt tháng</button>
                    `;
                } else {
                    b10Actions.innerHTML = `
                        <span style="color: #6B7280; font-size: 0.9rem; margin-right: 8px;">Chưa yêu cầu</span>
                        <button type="button" class="btn" style="padding: 4px 10px; font-size: 0.8rem; background: #3B82F6; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="modalSubmitBonus10Request('${sessionId}', '${dateKey}', '${staffId}', '${String(chip.bonus10TargetShiftKey || '').replace(/'/g, "\\'")}')" title="Tự duyệt theo đúng ca dạy và quy tắc Môn Học">Thưởng +10p</button>
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

            if (!isReceptionist && chip.studentCount > 0) {
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
    window.currentAdminPayrollEditContext = null;
    if (window.AdminPayrollOverrideUI) window.AdminPayrollOverrideUI.close();
    document.getElementById('edit-time-modal').style.display = 'none';
}

async function saveEditedTime() {
    if (window.__adminPayrollSavePending) return;
    window.__adminPayrollSavePending = true;
    const button = document.querySelector('[onclick="saveEditedTime()"]');
    const originalText = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Đang lưu...'; }
    try {
        await saveEditedTimeOperation();
    } finally {
        window.__adminPayrollSavePending = false;
        if (button) { button.disabled = false; button.textContent = originalText; }
    }
}

async function saveEditedTimeOperation() {
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
    if (checkOutDate && checkOutDate <= checkInDate) {
        alert("Giờ ra phải sau giờ vào!");
        return;
    }

    const checkInStr = checkInDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const checkOutStr = checkOutDate ? checkOutDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '???';

    const linkedClassStart = document.getElementById('edit-linked-class-start')?.value || null;
    const classSectionKey = document.getElementById('edit-class-section-key')?.value || '';
    const classLinkType = document.getElementById('edit-class-is-receptionist')?.value || '';
    const classIsReceptionist = classLinkType === 'true';
    const classIsOffice = classLinkType === 'office';

    const roleSelect = document.getElementById('edit-role');
    const selectedRoleId = roleSelect?.value || null;
    const selectedRoleName = roleSelect?.options[roleSelect.selectedIndex]?.text || null;
    const selectedRoleRate = roleSelect?.options[roleSelect.selectedIndex]?.dataset?.rate || null;

    if (selectedRoleId === 'giao-vien') {
        const typedSubjectResult = commitExactTypedSubjectSelection();
        if (!typedSubjectResult.ok) {
            alert(typedSubjectResult.message);
            return;
        }
    }

    const statusVal = document.getElementById('edit-session-status')?.value || 'worked';
    const isAbsent = (statusVal === 'absent');

    // Tách ca gộp: các ca con bị BỎ tick = vắng. Luôn ghi (kể cả [] để bỏ đánh dấu cũ).
    const splitCbs = document.querySelectorAll('.edit-subshift-cb');
    let absentSubShifts = null;
    if (splitCbs.length > 0) {
        absentSubShifts = [];
        splitCbs.forEach(cb => { if (!cb.checked) absentSubShifts.push(cb.dataset.start); });
    }

    const newData = {
        checkIn: checkInDate.toISOString(),
        start: checkInDate.toISOString(),
        checkOut: checkOutDate ? checkOutDate.toISOString() : null,
        isAdminEdited: true,
        isAbsent: isAbsent,
        editMeta: {
            source: 'report_manual_edit',
            editor: localStorage.getItem('currentUserName') || null
        },
        ...(linkedClassStart ? { linkedClassStart } : {}),
        ...(classSectionKey && classIsReceptionist ? { linkedReceptionistShift: classSectionKey } : {}),
        ...(classSectionKey && classIsOffice ? { linkedOfficeShift: classSectionKey } : {}),
        ...(absentSubShifts !== null ? { absentSubShifts } : {})
    };
    let selectedSubjectsForSave = [];
    let isFixedForSave = false;

    if (selectedRoleId === 'tiep-tan' || selectedRoleId === 'van-phong') {
        const isOfficeRole = selectedRoleId === 'van-phong';
        newData.role = isOfficeRole ? 'van-phong' : 'tiep-tan';
        newData.roleName = isOfficeRole ? 'Văn Phòng' : 'Tiếp Tân';
        newData.roleAssignmentSource = 'manual';
        newData.subjectOverride = false;
        
        const checkedRadio = document.querySelector('input[name="edit-shift-type"]:checked');
        const isFixed = (checkedRadio && checkedRadio.value === 'fixed');
        isFixedForSave = isFixed;
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
        selectedSubjectsForSave = selectedSubjects;
        
        newData.role = selectedSubjects.map(s => s.id).join('+');
        newData.roleName = selectedSubjects.map(s => s.name).join(' + ');
        newData.roleAssignmentSource = 'manual';
        // Average rate
        const totalRate = selectedSubjects.reduce((sum, s) => sum + s.rate, 0);
        newData.roleRate = totalRate / selectedSubjects.length;
        const sameSubjectSet = (left, right) => {
            const a = [...new Set(left.map(String))].sort();
            const b = [...new Set(right.map(String))].sort();
            return a.length === b.length && a.every((id, index) => id === b[index]);
        };
        newData.subjectOverride = !sameSubjectSet(editSelectedSubjectIds, editSuggestedSubjectIds);
    } else {
        newData.isFixedShift = false;
        newData.role = null;
        newData.roleName = null;
        newData.roleRate = 0;
        newData.roleAssignmentSource = null;
        newData.subjectOverride = false;
    }

    let coreCommitted = false;
    let savedMessage = '';
    try {
        let finalSessionId = null;
        let payrollOverrideResult = null;
        if (sessionIdRaw === 'NEW') {
            try {
                finalSessionId = await DBService.addSession(staffId, dateKey, newData);
            } catch (errAdd) {
                // Ca mới trùng khung giờ ca đã có → hỏi lại, vì thêm là bảng công tính
                // lương hai lần cho cùng một giờ làm (nhân viên chỉ bấm vào ca một lần).
                if (errAdd && errAdd.code === 'SESSION_OVERLAP') {
                    const goOn = await UIService.confirm(
                        'KHÔNG THÊM ĐƯỢC — ' + errAdd.message +
                        '\n\nThường gặp khi giáo viên dạy 2 lớp cùng một khung giờ: chỉ cần MỘT ca, ' +
                        'chọn cả 2 môn trong ô "Môn học" của ca đó.' +
                        '\n\nVẫn thêm ca thứ hai cùng khung giờ?'
                    );
                    if (!goOn) return;
                    finalSessionId = await DBService.addSession(staffId, dateKey, newData, { allowOverlap: true });
                } else {
                    throw errAdd;
                }
            }
            coreCommitted = true;
            // Send notification to staff
            await DBService.createAdminNotification(
                staffId, staffName, 'add_session', dateKey,
                `Admin đã thêm ca làm việc mới: ${checkInStr} - ${checkOutStr}`
            );
            savedMessage = 'Đã tạo ca làm việc mới!';
        } else {
            const parsedSessionId = isNaN(sessionIdRaw) ? sessionIdRaw : Number(sessionIdRaw);
            const overrideContext = window.currentAdminPayrollEditContext;
            const usesAbsoluteAdminEditor = isPrimaryPayrollAdminViewer() &&
                window.AdminPayrollOverrideUI?.isVisible?.() === true &&
                overrideContext && String(overrideContext.sessionId) === String(sessionIdRaw) &&
                String(overrideContext.staffId) === String(staffId) &&
                String(overrideContext.dateKey) === String(dateKey);

            if (usesAbsoluteAdminEditor) {
                if (!checkOutDate) {
                    alert('Phân bổ lương của Admin cần đủ giờ ra. Vui lòng nhập giờ ra trước khi lưu.');
                    return;
                }
                const overrideDraft = window.AdminPayrollOverrideUI.buildDraft({
                    selectedRoleId,
                    selectedRoleRate: Number(newData.roleRate || selectedRoleRate || 0),
                    selectedSubjects: selectedSubjectsForSave,
                    isTeaching: selectedRoleId === 'giao-vien',
                    isFixedShift: isFixedForSave,
                    checkInISO: newData.checkIn,
                    checkOutISO: newData.checkOut
                });
                if (!overrideDraft) throw new Error('Không đọc được phân bổ công trong popup. Hãy đóng và mở lại ca.');
                if (!overrideDraft.reason || overrideDraft.reason.length < 3) {
                    alert('Vui lòng ghi lý do điều chỉnh (ít nhất 3 ký tự).');
                    return;
                }
                if (isAbsent && overrideDraft.override.mode !== 'schedule') {
                    alert('Ca đang đánh dấu Vắng. Hãy chọn “Trở lại tính theo lịch” hoặc đổi trạng thái sang Đi làm trước khi lưu phân bổ lương.');
                    return;
                }
                const overrideSessionPatch = { ...newData };
                if (overrideDraft.override.mode === 'manual') {
                    // Manual allocation rows are the complete payroll role
                    // decision. Preserve the source session's legacy role so
                    // clicking a different generated chip cannot silently
                    // change the future schedule-mode fallback.
                    ['role', 'roleName', 'roleRate', 'isFixedShift', 'roleAssignmentSource', 'subjectOverride']
                        .forEach(key => { delete overrideSessionPatch[key]; });
                }
                const command = {
                    staffId,
                    dateKey,
                    sessionId: String(sessionIdRaw),
                    sessionPatch: overrideSessionPatch,
                    override: overrideDraft.override,
                    reason: overrideDraft.reason,
                    clearLegacyScheduleLinks: overrideDraft.clearLegacyScheduleLinks,
                    allowSessionOverlap: overrideDraft.allowSessionOverlap,
                    expectedFingerprint: overrideContext.expectedFingerprint,
                    expectedRevision: overrideContext.expectedRevision
                };
                try {
                    payrollOverrideResult = await DBService.saveAdminPayrollOverride(command);
                } catch (overrideError) {
                    if (overrideError?.code !== 'SESSION_OVERLAP' || command.allowSessionOverlap === true) throw overrideError;
                    const continueOverlap = await UIService.confirm(
                        `${overrideError.message}\n\nChỉ tiếp tục nếu đây là hai phiên nguồn khác nhau mà Admin cố ý giữ. Phần phân bổ chồng giờ trong cùng override vẫn tự loại trả trùng.`
                    );
                    if (!continueOverlap) return;
                    payrollOverrideResult = await DBService.saveAdminPayrollOverride({
                        ...command,
                        allowSessionOverlap: true
                    });
                }
                finalSessionId = parsedSessionId;
                coreCommitted = true;
                savedMessage = payrollOverrideResult?.revisionRequired
                    ? 'Đã lưu phân bổ công. Bảng lương đã gửi trước đó được đánh dấu cần tính/gửi lại.'
                    : 'Đã lưu phân bổ công của Admin!';
            } else {
                await DBService.updateSession(staffId, dateKey, parsedSessionId, newData);
                coreCommitted = true;
                finalSessionId = parsedSessionId;
                // Legacy/senior-assistant edits retain their existing flow.
                await DBService.createAdminNotification(
                    staffId, staffName, 'edit_session', dateKey,
                    `Admin đã chỉnh sửa giờ làm: ${checkInStr} - ${checkOutStr}`
                );
                savedMessage = 'Cập nhật thành công!';
            }
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
        alert(savedMessage);
        await renderMonthReport(currentDate, true); // true = bypass Firestore cache
    } catch (e) {
        if (coreCommitted) {
            closeEditModal();
            _cachedStaffId = null;
            alert('Đã lưu giờ/công, nhưng chưa hoàn tất phần tăng ca hoặc thông báo: ' + e.message + '. Vui lòng mở lại ca để kiểm tra; không thêm lại ca.');
            await renderMonthReport(currentDate, true);
        } else {
            alert("Chưa lưu thay đổi: " + e.message);
        }
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
        const agreed = await UIService.confirm(
            'Hủy thưởng 10p cho ca này?\n\n' +
            'Lưu ý: hủy 1 ca sẽ khóa phụ cấp CẢ THÁNG — mất toàn bộ 10p và mất luôn ' +
            'đơn giá lớp đông (+N HS) của nhân viên này trong tháng. Có thể gỡ phạt sau.'
        );
        if (!agreed) return;
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

window.modalSubmitBonus10Request = async function(sessionId, dateKey, staffId, targetShiftKey) {
    const chip = (window.allMonthChips || []).find(item =>
        String(item?.dateStr || '') === String(dateKey) &&
        String(item?.sessionId || '') === String(sessionId) &&
        String(item?.bonus10TargetShiftKey || '') === String(targetShiftKey || '') &&
        item?.isTeaching === true
    );
    if (!chip) {
        await UIService.notice(
            'Không xác định được chính xác ca dạy nhận +10 phút. Hãy đóng popup, tải lại bảng công và thao tác trên chip ca dạy.',
            'Thiếu định danh ca dạy',
            'warning'
        );
        return;
    }
    closeEditModal();
    await submitBonus10Request(sessionId, dateKey, staffId, chip);
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
        if (!await UIService.confirm('Chị muốn hủy duyệt tăng ca của ca này? Lịch sử vẫn được giữ lại.')) return;
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang hủy...');
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
        const reviewerId = localStorage.getItem('currentUserId') || adminName;

        if (action === 'approve') {
            const chip = window.allMonthChips.find(c => String(c.sessionId) === String(sessionId));
            const count = chip ? chip.studentCount : 10;
            await DBService.updateSessionStudentCount(staffId, dateKey, sessionId, count, 'approved', reviewerId, 'admin');
            if (typeof UIService !== 'undefined') UIService.toast('Đã duyệt sĩ số!', 'success');
        } else if (action === 'reject') {
            const chip = window.allMonthChips.find(c => String(c.sessionId) === String(sessionId));
            const count = chip ? chip.studentCount : 10;
            await DBService.updateSessionStudentCount(staffId, dateKey, sessionId, count, 'rejected', reviewerId, 'admin');
            if (typeof UIService !== 'undefined') UIService.toast('Đã từ chối sĩ số (phạt cả tháng)!', 'error');
        } else if (action === 'delete') {
            await DBService.updateSessionStudentCount(staffId, dateKey, sessionId, null, null, reviewerId, 'admin');
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
            const cancelCompositeKey = `${isReceptionistStr === 'office' ? 'office_' : ''}${String(classCompositeKey)}`;
            const cancelKey = `${cancelCompositeKey}_${classSectionKey}_${classIndexRaw}`;

            // 1. Ghi log huỷ ca vào DBService (BƯỚC QUAN TRỌNG NHẤT)
            await DBService.cancelShift(monthStr, staffId, cancelKey);

            if (isReceptionistStr === 'true') {
                // Delete from receptionist schedule
                await DBService.unassignReceptionist(classCompositeKey, classSectionKey, classIndexRaw, staffId);
            } else if (isReceptionistStr === 'office') {
                await DBService.unassignOfficeStaff(classCompositeKey, classSectionKey, classIndexRaw, staffId);
            } else {
                // Teaching assignments remain in the historical schedule. The
                // cancelled-shift tombstone above hides only this employee's
                // report chip and can be restored without mutating/toggling the
                // separate self-registration record.
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
    const hasOfficeRole = hasOfficeEmploymentRole(userRolesArr);
    const hasReceptionistRole = userRolesArr.some(role => [
        'receptionist', 'receptionist_assistant', 'receptionist_lead',
        'receptionist_staff', 'senior_assistant', 'tiep-tan', 'tiep_tan'
    ].includes(role));
    const hasTeachingRole = hasTeachingEmploymentRole(userRolesArr);
    let teachingRoles = (user.salary_config && user.salary_config.roles) ? user.salary_config.roles.slice() : [];
    if (hasTeachingRole) {
        try {
            const subjects = await DBService.getSubjects();
            const policyApi = await ensureSubjectRatePolicyLoaded();
            if (policyApi && policyApi.leafOptions) {
                const fallbackRate = teachingRoles.length > 0 ? teachingRoles[0].rate : (user.salary_config?.attendance_rate || 0);
                policyApi.leafOptions(user.salary_config || {}, subjects, dateKey, fallbackRate).forEach(option => {
                    if (!teachingRoles.some(role => String(role.id) === String(option.id))) {
                        teachingRoles.push({ id: option.id, name: option.path || option.name, rate: option.rate });
                    }
                });
            }
        } catch (policyError) {
            console.warn('[RoleSelect] subject rate policy unavailable:', policyError);
        }
    }

    // Kiểm tra có ít nhất 1 option để chọn
    if (!hasReceptionistRole && !hasOfficeRole && teachingRoles.length === 0) {
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

    if (hasOfficeRole) {
        const cfg = user.salary_config || {};
        const officeRate = cfg.receptionist_normal_rate || 0;
        const officeRole = { id: 'van-phong', name: 'Văn Phòng', rate: officeRate, isReceptionist: true, isOffice: true };
        const btn = document.createElement('div');
        btn.style.cssText = 'padding:1rem;border:2px solid #C7D2FE;border-radius:var(--radius-md);cursor:pointer;background:#EEF2FF;transition:0.2s;';
        btn.innerHTML = `<strong>💼 Văn Phòng</strong> <span style="float:right;color:#4338CA">${new Intl.NumberFormat('vi-VN').format(officeRate)}đ/h</span>`;
        btn.onmouseover = () => { btn.style.background = '#E0E7FF'; btn.style.borderColor = '#6366F1'; };
        btn.onmouseout = () => { btn.style.background = '#EEF2FF'; btn.style.borderColor = '#C7D2FE'; };
        btn.onclick = () => selectRoleForSession(officeRole);
        container.appendChild(btn);
    }

    // Thêm các môn học (chỉ hiện nếu có role dạy)
    if (hasTeachingRole) {
        if (teachingRoles.length === 0 && !hasReceptionistRole && !hasOfficeRole) {
            const emptyDiv = document.createElement('div');
            emptyDiv.style.cssText = 'padding:0.75rem;color:var(--text-muted);text-align:center;font-size:0.9rem;';
            emptyDiv.textContent = 'Chưa có môn học nào. Hãy cài đặt lương trong trang Nhân Sự.';
            container.appendChild(emptyDiv);
        } else {
            if ((hasReceptionistRole || hasOfficeRole) && teachingRoles.length > 0) {
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

// Kiểm tra 3 điều kiện sớm 10p cho 1 ca: môn cho phép, nhân viên thuộc chế độ
// cũ hoặc chưa phân loại, và giờ vào thực tế sớm ít nhất 10 phút.
async function evaluateEarly10ForChip(chip, staffId) {
    if (typeof Early10 === 'undefined') {
        return { ok: false, code: 'missing-module', message: 'Chưa tải được quy tắc sớm 10 phút. Hãy tải lại trang.' };
    }
    const [subjects, users] = await Promise.all([
        DBService.getSubjects(true).catch(() => []),
        DBService.getUsers().catch(() => [])
    ]);
    const user = users.find(u => u.id === staffId) || null;
    const session = chip?.sessionData || {};
    const subjectIds = Early10.getChipSubjectIds
        ? Early10.getChipSubjectIds(chip, subjects)
        : [];
    const subjectMap = Early10.buildSubjectEarly10Map(subjects);
    const subjectId = subjectIds.find(id => subjectMap[String(id)] === true) || '';
    const verdict = Early10.evaluateEarly10Request({
        sessionRole: session.role,
        subjectIds,
        subjects,
        user,
        checkIn: session.checkIn,
        classStart: chip?.classStart
    });
    if (!verdict.ok) return verdict;
    return {
        ...verdict,
        awardScope: 'teaching_shift',
        targetShiftKey: String(chip?.bonus10TargetShiftKey || ''),
        subjectId,
        scheduleDocId: String(chip?.classCompositeKey || ''),
        scheduleSourceDocId: String(
            chip?.scheduleIsInherited === true
                ? (chip?.scheduleInheritedFrom || '')
                : (chip?.classCompositeKey || '')
        ),
        scheduleIsInherited: chip?.scheduleIsInherited === true,
        scheduleSection: String(chip?.classSectionKey || ''),
        scheduleIndex: Number(chip?.classIndex),
        scheduleShiftId: chip?.scheduleIsInherited === true
            ? ''
            : String(chip?.scheduleShiftId || ''),
        scheduleRegistrationId: String(chip?.scheduleRegistrationId || ''),
        scheduleAssignmentList: String(chip?.scheduleAssignmentList || ''),
        scheduleAssignmentEntry: chip?.scheduleAssignmentEntry &&
            typeof chip.scheduleAssignmentEntry === 'object'
            ? { ...chip.scheduleAssignmentEntry }
            : {},
        classStart: String(chip?.classStart || ''),
        classEnd: String(chip?.classEnd || ''),
        checkInAt: String(session.checkIn || session.start || '')
    };
}

function commitExactTypedSubjectSelection() {
    const input = document.getElementById('subject-search-input');
    const typed = String(input?.value || '').trim();
    if (!typed) return { ok: true, changed: false };
    const key = normalizeSubjectLookupName(typed);
    const matches = allAvailableSubjects.filter(subject => {
        const full = normalizeSubjectLookupName(subject.path || subject.name);
        const leaf = normalizeSubjectLookupName(String(subject.path || subject.name || '').split(/[›>]/).pop());
        return full === key || leaf === key || normalizeSubjectLookupName(subject.name) === key;
    });
    const unique = Array.from(new Map(matches.map(subject => [String(subject.id), subject])).values());
    if (unique.length !== 1) {
        return {
            ok: false,
            message: unique.length > 1
                ? `Có nhiều môn khớp “${typed}”. Vui lòng bấm chọn đúng môn trong danh sách.`
                : `Không tìm thấy môn khớp chính xác “${typed}”. Vui lòng chọn trong danh sách.`
        };
    }
    const resolvedId = String(unique[0].id);
    const changed = editSelectedSubjectIds.length !== 1 || String(editSelectedSubjectIds[0]) !== resolvedId;
    editSelectedSubjectIds = [resolvedId];
    renderSelectedSubjectBadges();
    input.value = '';
    return { ok: true, changed, subject: unique[0] };
}

async function submitBonus10Request(sessionId, dateKey, staffId, chip) {
    if (isPrimaryPayrollAdminViewer() && chip?.isAdminPayrollOverride === true) {
        await UIService.notice(
            'Đây là chip do Admin quyết định. Hãy mở “Chỉnh Sửa Giờ Làm”, tích “Cộng +10 phút theo quyết định Admin”, ghi lý do rồi lưu. ' +
            'Quyết định này không phụ thuộc lịch hoặc điều kiện tự động.',
            'Cộng +10 phút bằng quyền Admin',
            'info'
        );
        return;
    }
    // Tháng đang bị khóa phụ cấp thì không cho gửi mới — nếu không sẽ lách được hình phạt.
    if (window.currentMonthEarly10Penalty) {
        await UIService.notice(
            'Tháng này đã có ca sớm 10p bị hủy nên toàn bộ phụ cấp 10p trong tháng bị khóa. ' +
            'Liên hệ quản lý nếu bạn cho rằng đây là nhầm lẫn.',
            'Tháng này đang bị khóa phụ cấp', 'error'
        );
        return;
    }

    let verdict = null;
    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang kiểm tra điều kiện...');
        verdict = await evaluateEarly10ForChip(chip, staffId);
    } finally {
        if (typeof UIService !== 'undefined') UIService.hideLoading();
    }

    if (!verdict.ok) {
        // Không hợp lệ thì chặn ngay, không tạo yêu cầu để admin khỏi phải duyệt rác.
        await UIService.notice(verdict.message, 'Không đủ điều kiện sớm 10 phút', 'warning');
        return;
    }

    const confirmed = await UIService.confirm(
        `${verdict.message}\n\nGửi yêu cầu +10 phút cho ca này? Hệ thống sẽ tự duyệt ngay nếu dữ liệu vẫn hợp lệ.`
    );
    if (!confirmed) return;

    const staffName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'N/A';
    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang xử lý...');
        // Transaction re-reads the exact session, schedule row, subject and
        // personnel mode. Rules bind the approved award to the authenticated
        // owner and shift metadata, so no Admin wait is necessary.
        await DBService.createApprovedBonus10Request(staffId, staffName, dateKey, sessionId, verdict);
        if (typeof UIService !== 'undefined') UIService.hideLoading();
        UIService.toast(`Đã tự duyệt +10p cho đúng ca dạy (vào sớm ${verdict.earlyMinutes} phút).`, 'success');
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch (e) {
        if (typeof UIService !== 'undefined') UIService.hideLoading();
        UIService.toast('Lỗi: ' + e.message, 'error');
    }
}

// Dải cảnh báo trên lịch tháng: admin (và cả nhân viên) nhìn ra ngay tháng này
// đang bị khóa phụ cấp, thay vì phải tự thắc mắc sao lương hụt.
function renderEarly10PenaltyBanner(staffId, active, rejectedCount, penaltyState = null) {
    // Đặt NGOÀI khung lịch (khung lịch có min-width 850px và tự cuộn ngang) để
    // dải cảnh báo không bị kéo rộng ra trên điện thoại.
    const grid = document.getElementById('calendar-grid');
    const anchor = (grid && grid.closest('.glass-panel')) || grid;
    let banner = document.getElementById('early10-penalty-banner');

    if (!active) {
        if (banner) banner.remove();
        return;
    }
    if (!anchor || !anchor.parentNode) return;

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'early10-penalty-banner';
        banner.style.cssText = 'margin:0 0 1rem;padding:0.85rem 1rem;border-radius:12px;' +
            'background:#FEF2F2;border:1px solid #FECACA;display:flex;align-items:center;' +
            'gap:0.75rem;flex-wrap:wrap;';
        anchor.parentNode.insertBefore(banner, anchor);
    }

    // localStorage 'currentRole' có thể là chuỗi hoặc JSON array (xem js/auth-guard.js).
    const roles = (() => {
        const raw = localStorage.getItem('currentRole');
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
            return raw ? [raw] : [];
        }
    })();
    const isAdmin = roles.some(r => ['admin', 'senior_assistant'].includes(r));

    const markerDate = penaltyState?.lastDateKey
        ? ` Ca bị từ chối gần nhất: ${escapeReportHtml(penaltyState.lastDateKey)}.`
        : '';
    const auditCount = rejectedCount > 0 ? ` Hệ thống đang giữ ${rejectedCount} dấu vết từ chối để đối chiếu.` : '';
    banner.innerHTML =
        `<span style="flex:0 0 auto;color:#DC2626;display:flex;">${window.getIconHtml('alert-triangle', { width: '20', height: '20' })}</span>` +
        `<span style="flex:1;min-width:180px;font-size:0.88rem;color:#7F1D1D;">` +
            `<b>Tháng này đang bị khóa phụ cấp.</b> Toàn bộ thưởng 10p và đơn giá lớp đông (+N HS) ` +
            `trong tháng không được tính.${markerDate}${auditCount}` +
        `</span>` +
        (isAdmin
            ? `<button onclick="clearEarly10Penalty('${staffId}')" style="flex:0 0 auto;padding:0.5rem 0.9rem;` +
              `border-radius:9px;border:none;cursor:pointer;background:#DC2626;color:#fff;font-weight:700;` +
              `font-size:0.83rem;">Gỡ phạt tháng này</button>`
            : '');
}

// Gỡ hình phạt tháng bằng marker có phiên bản; giữ nguyên request rejected làm
// lịch sử đối chiếu, tránh xóa mất bằng chứng quyết định lương.
async function clearEarly10Penalty(staffId) {
    const monthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    const confirmed = await UIService.confirm(
        `Gỡ phạt sớm 10p cho tháng ${monthStr}?\n\nSau khi gỡ, các ca đã duyệt 10p và đơn giá lớp đông (+N HS) trong tháng sẽ được tính lại bình thường.`
    );
    if (!confirmed) return;

    try {
        if (typeof UIService !== 'undefined') UIService.showLoading('Đang gỡ phạt...');
        const changed = await DBService.clearBonus10PenaltyForMonth(staffId, monthStr);
        if (typeof UIService !== 'undefined') UIService.hideLoading();
        UIService.toast(changed > 0
            ? 'Đã gỡ khóa tháng; các dấu vết từ chối vẫn được giữ để đối chiếu.'
            : 'Đã xác nhận tháng ở trạng thái không khóa phụ cấp.', 'success');
        _cachedStaffId = null;
        renderMonthReport(currentDate);
    } catch (e) {
        if (typeof UIService !== 'undefined') UIService.hideLoading();
        UIService.toast('Lỗi: ' + e.message, 'error');
    }
}
window.clearEarly10Penalty = clearEarly10Penalty;

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

// DEDUPLICATE — chỉ coi là trùng khi cùng ca dạy đích; một session có thể phủ
// nhiều chip và không được làm mất request của targetShiftKey khác.
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
            const key = `${d.staffId}_${d.dateKey}_${d.sessionId}_${d.targetShiftKey || 'legacy-unscoped'}`;
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
    if (window.ShiftAbsenceState?.classifyChipAbsence) {
        return window.ShiftAbsenceState.classifyChipAbsence(chip, notesMap);
    }

    // Rolling-deploy fallback. A daily note has no shift identity, so it may
    // classify a chip only after that chip carries exact absence evidence.
    if (chip.hasCanonicalAbsenceState === true && chip.absenceState === 'ACTIVE' && !chip.absenceEvidence) return 'VKP';
    if (chip.isCancelled || chip.absenceStateSource === 'cancellation') return 'VP';
    if (chip.absenceStateSource === 'teacher-absence') {
        return chip.absenceType === 'VP' ? 'VP' : 'VDX';
    }
    const evidenceCanUseDailyNote = chip.absenceStateSource === 'legacy-substitute' ||
        chip.absenceStateSource === 'attendance-session';
    if (evidenceCanUseDailyNote) {
        const noteText = ((notesMap || {})[chip.dateStr] || '').toLowerCase().trim();
        if (noteText.includes('đột xuất') || noteText.includes('vdx') || noteText.includes('đx')) return 'VDX';
        if (noteText.includes('phép') || /(^|\s)vp($|\s)/.test(noteText)) return 'VP';
    }
    if (chip.absenceState === 'VP' || chip.absenceState === 'VDX') return chip.absenceState;
    if (chip.absenceType === 'VP' || chip.absenceType === 'VDX') return chip.absenceType;
    if (chip.isVDX) return 'VDX';
    return 'VKP';
}

function absenceChipDisplayText(chip, notesMap) {
    if (!chip || !chip.text) return chip ? chip.text : '';
    const type = classifyAbsentChip(chip, notesMap);
    if (!['VP', 'VDX'].includes(type)) return chip.text;
    const prefix = type === 'VP' ? 'VP:' : 'VĐX:';
    if (/^(VP|VĐX):/.test(chip.text)) return chip.text.replace(/^(VP|VĐX):/, prefix);
    return `${prefix} ${chip.text}`;
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
            hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
            hasTeaching = hasTeachingEmploymentRole(staffRoles);
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
        const isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
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
        const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
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
        
    let hasTeaching = hasTeachingEmploymentRole(staffRoles) || teachingShiftCount > 0 || hasTeachingConfig;
    let hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || receptionistShiftCount > 0 || hasReceptionistConfig;
    
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
    const hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
    const hasTeaching = hasTeachingEmploymentRole(staffRoles);
    
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

        // FIX (v20260710-v4): Tiếp Tân chỉ tính chip tiếp tân THỰC (isReceptionist===true).
        // Chip "ma"/trùng có role tiếp tân trong sessionData nhưng isReceptionist!==true
        // (session lọt xuống "Ca Ngoài Lịch/Ca Thêm") bị loại khỏi CẢ 2 view để không cộng dư.
        const isTTStrict = chip.isReceptionist === true;
        const isTTLoose = chip.isReceptionist === true || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
        if (window.modalActiveRole === 'tiep-tan' && !isTTStrict) return;
        if (window.modalActiveRole === 'giao-vien' && isTTLoose) return;

        if (chip.isAbsence || chip.absenceType || chip.isVDX || /(?:^|\s)chip-(?:gray|red)(?:\s|$)/.test(chip.class || '')) {
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
    // Giờ của ca lớp đông thuộc về dòng "(+N HS)", KHÔNG cộng thêm vào dòng môn gốc.
    // Dòng môn gốc vẫn luôn được tạo để admin nhập được đơn giá thường.
    const classRatePenaltyActive = isStudentCountPenaltyActive(
        window.currentMonthlySalarySettingsAll || {},
        window.unfilteredAllMonthChips || []
    );
    const ensureGroup = (groupName) => ensurePayrollRateGroup(groups, groupName);
    (window.unfilteredAllMonthChips || []).forEach(chip => {
        const name = chip.chipFilterName;
        if (!name) return;

        // FIX (v20260710-v4): giống loop thống kê phía trên — Tiếp Tân chỉ tính chip
        // isReceptionist===true; loại chip "ma"/trùng khỏi cả 2 view (chống cộng dư giờ/lương).
        const isTTStrict = chip.isReceptionist === true;
        const isTTLoose = chip.isReceptionist === true || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
        if (window.modalActiveRole === 'tiep-tan' && !isTTStrict) return;
        if (window.modalActiveRole === 'giao-vien' && isTTLoose) return;
        
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
                    addPayrollRateGroupMinutes(groups, groupName, chip, segMins);
                });
            } else {
                const groupName = chip.isFixedShift ? "Tiếp Tân (Ca Cố Định)" : "Tiếp Tân (Ca Bình Thường)";
                const mins = chip.paidMinutes || 0;
                addPayrollRateGroupMinutes(groups, groupName, chip, mins);
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
                        trackPayrollRateGroupChip(groups, segName, chip);

                        // Vẫn hiện dòng "(+N HS)" để cấu hình đơn giá, nhưng giờ chỉ nằm ở 1 dòng.
                        if (chip.studentCount && chip.studentCount > 0) {
                            trackPayrollRateGroupChip(groups, `${segName} (+${chip.studentCount} HS)`, chip);
                        }
                        getTeachingPayAllocations(chip, segName, segMins, 0, classRates, classRatePenaltyActive)
                            .forEach(alloc => {
                                addPayrollRateGroupMinutes(groups, alloc.name, chip, alloc.minutes);
                            });
                    }
                });
            } else {
                trackPayrollRateGroupChip(groups, name, chip);

                if (chip.studentCount && chip.studentCount > 0) {
                    trackPayrollRateGroupChip(groups, `${name} (+${chip.studentCount} HS)`, chip);
                }
                getTeachingPayAllocations(chip, name, chip.paidMinutes || 0, 0, classRates, classRatePenaltyActive)
                    .forEach(alloc => {
                        addPayrollRateGroupMinutes(groups, alloc.name, chip, alloc.minutes);
                    });
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
                const policyMinutes = Number(group.policyMinutes) || 0;
                const manualMinutes = Number(group.manualMinutes) || 0;
                const manualOnly = policyMinutes === 0 && manualMinutes > 0;
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
                            // In group mode, prefill the same read-only resolver
                            // used by the main salary calculation.  This removes
                            // the old need to re-enter the hourly rate in the
                            // monthly modal while leaving legacy fallback intact.
                            const policyChip = group.chips.find(c => c && c.sessionData && !c.isReceptionist && getAuthoritativeAdminPayrollRate(c) === null);
                            const policyRate = policyChip ? getResolvedTeachingRate(policyChip, name, 0) : 0;
                            if (policyRate > 0) {
                                prefillRate = policyRate;
                            } else {
                                const foundRoleInConfig = cfg.roles && cfg.roles.find(r => {
                                    const rName = r.name || r.id || '';
                                    const normalizeFn = window.normalizeChipFilterName || (x => x);
                                    return normalizeFn(rName) === normalizeFn(name) || r.id === name;
                                });
                                if (foundRoleInConfig) {
                                    prefillRate = Number(foundRoleInConfig.rate || 0);
                                } else {
                                    const firstWithRate = group.chips.find(c => getAuthoritativeAdminPayrollRate(c) === null && c.sessionData && Number(c.sessionData.roleRate) > 0);
                                    prefillRate = firstWithRate ? Number(firstWithRate.sessionData.roleRate) : 0;
                                }
                            }
                        }
                    }
                }
                
                const hasRejectedChip = window.unfilteredAllMonthChips?.some(c => c.studentCountStatus === 'rejected');
                const isPenaltyActive = !!window.currentMonthlySalarySettingsAll?.studentCountBonusPenalty || hasRejectedChip;
                const isBonus = isStudentCountBonusRow(name);
                const isRowDisabled = isBonus && isPenaltyActive;
                const displayRate = manualOnly && manualMinutes > 0
                    ? group.manualAmount / (manualMinutes / 60)
                    : prefillRate;
                
                let amount = getPayrollRateGroupAmount(group, prefillRate, isRowDisabled);
                grandTotalSalary += amount;
                
                const h = Math.floor(mins / 60);
                const m = Math.floor(mins % 60);
                const timeStr = `${h}h${m > 0 ? ' ' + m + 'p' : ''}`;
                
                const nameStyle = isBonus ? 'padding-left: 2.25rem; font-weight: 600; color: #166534; font-size: 0.85rem;' : 'font-weight: 500; color: #374151;';
                const manualSuffix = manualMinutes > 0
                    ? ` <span style="font-size:0.72rem;color:#7C3AED;font-weight:600;">(${manualMinutes}p Admin chốt)</span>`
                    : '';
                const displayName = (isBonus ? `↳ ${name}` : name) + manualSuffix;
                
                const inputLocked = isRowDisabled || manualOnly;
                const inputBg = inputLocked ? 'background-color: #E5E7EB; cursor: not-allowed;' : '';
                const inputDisabledAttr = inputLocked ? 'disabled' : '';

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
                            data-minutes="${policyMinutes}"
                            data-total-minutes="${mins}"
                            data-manual-amount="${group.manualAmount || 0}"
                            data-save-rate="${manualOnly ? 'false' : 'true'}"
                            value="${formatNumberWithCommas(displayRate)}"
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
                    if (saved.manual !== true && (saved.amount === undefined || String(saved.note || '').startsWith('Thưởng chuyên cần:'))) {
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
                    if (saved.manual !== true && (saved.amount === undefined || String(saved.note || '').startsWith('Thưởng chuyên cần:'))) {
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
                        oninput="this.dataset.manualEdited='true'; recalculateSalaryModal()">
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

    // === Bảng chẩn đoán (debug) — ẨN mặc định, admin bấm mới bung để lấy dữ liệu gửi ===
    document.getElementById('modal-salary-debug-info')?.remove();
    {
        const wrap = document.createElement('div');
        wrap.id = 'modal-salary-debug-info';
        wrap.style.cssText = 'margin-top:1rem;flex-shrink:0;';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.textContent = '🔧 Chi tiết kỹ thuật (debug) — bấm để xem';
        toggle.style.cssText = 'font-size:0.72rem;color:#9CA3AF;background:transparent;border:1px dashed #D1D5DB;border-radius:6px;padding:4px 8px;cursor:pointer;';

        const pre = document.createElement('pre');
        pre.style.cssText = 'display:none;margin-top:6px;padding:0.75rem;background:#FFFBEB;border:2px dashed #F59E0B;border-radius:8px;font-size:0.7rem;color:#B45309;font-family:monospace;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-all;';

        let built = false;
        toggle.onclick = () => {
            if (pre.style.display === 'none') {
                if (!built) { pre.textContent = buildSalaryDebugText(); built = true; }
                pre.style.display = 'block';
                toggle.textContent = '🔧 Chi tiết kỹ thuật (debug) — bấm để ẩn';
            } else {
                pre.style.display = 'none';
                toggle.textContent = '🔧 Chi tiết kỹ thuật (debug) — bấm để xem';
            }
        };

        wrap.appendChild(toggle);
        wrap.appendChild(pre);
        const modalBody = document.querySelector('#class-rate-modal .modal-content');
        if (modalBody) modalBody.appendChild(wrap);
    }
}

// Sinh nội dung debug đầy đủ: paidMinutes, isReceptionist, role, sessionId, mergedSegments —
// dùng để soi chip trùng (phantom) và cấu trúc ca gộp (merge).
function buildSalaryDebugText() {
    const chips = window.unfilteredAllMonthChips || [];
    let t = `DEBUG (v20260710-v9)\nTổng số chip: ${chips.length}\n`;
    chips.forEach((c, idx) => {
        const role = (c.sessionData && c.sessionData.role) ? c.sessionData.role : '-';
        let segInfo = '';
        if (c.mergedSegments && c.mergedSegments.length) {
            segInfo = ' | SEG: ' + c.mergedSegments.map(s => `${s.start}-${s.end}${s.isFixedShift ? '[CĐ]' : '[TT]'}=${s.schedMinutes}p`).join(', ');
        }
        t += `#${idx} ${c.dateStr} | "${c.text}" | ${c.class} | paid=${c.paidMinutes} | recep=${c.isReceptionist} | role=${role} | fixed=${c.isFixedShift} | sid=${c.sessionId || '-'}${segInfo}\n`;
    });
    return t;
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
        const totalMins = Number(input.dataset.totalMinutes || mins || 0);
        const manualAmount = Number(input.dataset.manualAmount || 0);
        const rate = parseFormattedNumber(input.value);
        const amount = manualAmount + (mins / 60) * rate;
        basePay += amount;
        
        if (name === "Tiếp Tân (Ca Cố Định)") {
            fixedMinutes = totalMins;
        } else if (name === "Tiếp Tân (Ca Bình Thường)") {
            normalMinutes = totalMins;
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
    if (!requireCompletePayrollReport()) return;
    const staffId = getTargetStaffId();
    if (!staffId || staffId === 'all') return;
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    const activeRoleSettings = window.currentMonthlySalarySettingsAll?.[window.modalActiveRole] ||
        window.currentMonthlySalarySettingsAll?.[String(window.modalActiveRole || '').replace('-', '_')] || {};
    const classRates = { ...(activeRoleSettings.class_rates || {}) };
    const classRateInputs = document.querySelectorAll('.class-rate-input');
    classRateInputs.forEach(input => {
        const name = input.dataset.name;
        const rate = parseFormattedNumber(input.value);
        if (name && input.dataset.saveRate !== 'false') {
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
            amount: parseFormattedNumber(amountInp?.value || '0'),
            manual: amountInp?.dataset.manualEdited === 'true' || (activeRoleSettings.evaluation || []).some(e => Number(e.id) === index && e.manual === true)
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
        
        window.currentLoadedRoleKey = roleKey;
        window.currentLoadedSalarySettings = { ...activeRoleSettings, ...settingsObj };
        if (!window.currentMonthlySalarySettingsAll) {
            window.currentMonthlySalarySettingsAll = {};
        }
        window.currentMonthlySalarySettingsAll[roleKey] = window.currentLoadedSalarySettings;
        const backgroundRoleFilter = document.getElementById('salary-role-filter');
        if (backgroundRoleFilter) backgroundRoleFilter.value = window.modalActiveRole;
        
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
        
        closeClassRateModal();
        await renderMonthReport(currentDate, true);
        const draftResult = await saveCalculationDraftToDb(staffId, monthStr);
        showDraftSaveOutcome(draftResult, 'Đã lưu bảng lương và tính thành công!');
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

function buildAttendanceSessionMap(records) {
    return (Array.isArray(records) ? records : []).reduce((map, record) => {
        const recordDate = record?.date || record?.id;
        if (recordDate && Array.isArray(record?.sessions)) map[recordDate] = record.sessions;
        return map;
    }, {});
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

        // History is a saved document, not a recalculation using today's rates.
        const savedMonth = await DBService.getMonthlySalarySettings(staffId, prevMonthStr, { strict: true });
        const savedPayslip = savedMonth?.published;
        if (savedPayslip) {
            const key = window.modalActiveRole === 'tiep-tan' ? 'tt' : 'gv';
            const state = DBService.getPayslipLifecycleState(savedPayslip);
            const details = savedPayslip[`details_${key}`] ||
                ((key === 'tt' ? savedPayslip.role === 'tiep-tan' : savedPayslip.role !== 'tiep-tan' && savedPayslip.role !== 'dual') ? savedPayslip.details : null);
            const title = `Bảng Lương Tháng ${prevMonth + 1}/${prevYear} (Đã Lưu)`;
            let actorRoles;
            try { actorRoles = JSON.parse(localStorage.getItem('currentRole') || '[]'); } catch (_) { actorRoles = [localStorage.getItem('currentRole')]; }
            if (!Array.isArray(actorRoles)) actorRoles = [actorRoles];
            const hiddenMoney = actorRoles.includes('senior_assistant') && !actorRoles.includes('admin');
            if (historyContainer) {
                historyContainer.innerHTML = `<h3>${title}</h3><p>Bản lưu của tháng này; không tính lại theo lịch hoặc đơn giá mới.</p>`;
                if (hiddenMoney) {
                    const summary = document.createElement('p');
                    const stats = details?.stats || {};
                    summary.textContent = `Đi làm: ${stats.workedShifts || 0} ca; VP: ${stats.vpShifts || 0}; VĐX: ${stats.vdxShifts || 0}; VKP: ${stats.vkpShifts || 0}; Trễ: ${stats.lateCount || 0} lần. Thông tin tiền lương chỉ dành cho quản trị viên.`;
                    historyContainer.appendChild(summary);
                } else if (details && typeof window.renderDetailedSalaryTable === 'function') {
                    historyContainer.innerHTML += window.renderDetailedSalaryTable(details, state[`status_${key}`]);
                } else {
                    const message = document.createElement('p');
                    message.textContent = 'Chưa có bản lương chi tiết đã lưu cho vai trò này.';
                    historyContainer.appendChild(message);
                }
                historyContainer.style.display = 'block';
            }
            return;
        }
        
        const prevNotes = await DBService.getDailyNotes(staffId);
        const cancelledShifts = await DBService.getCancelledShifts(prevMonthStr, staffId);
        const savedFixedShifts = await DBService.getFixedShifts(prevMonthStr, staffId);
        const attendanceRecords = await DBService.getMonthlyAttendance(prevMonthStr, staffId);
        const receptionistShifts = await DBService.getMonthlyReceptionistShifts(prevMonthStr, staffId);
        // Reuse the supported staff/month query.  The previous method name did
        // not exist in DBService, which prevented the entire paid-history tab
        // from rendering before any salary data could be shown.
        const overtimeRecords = await DBService.getOvertimeRequestsForStaff(staffId, prevMonthStr);
        const bonus10Records = await DBService.getMonthlyBonus10Requests(prevMonthStr, staffId);
        const prevMonthlySettingsAll = await DBService.getMonthlySalarySettings(staffId, prevMonthStr);
        const scheduleMap = await DBService.getMonthlySchedule(prevMonthStr);
        const observationRecords = await DBService.getShiftObservationsForMonth(prevMonthStr, staffId);
        
        const attendanceMap = buildAttendanceSessionMap(attendanceRecords);
        
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
            if (req.dateKey) {
                if (!bonus10Map[req.dateKey]) bonus10Map[req.dateKey] = {};
                const sessionKey = String(req.sessionId || '');
                if (!sessionKey) return;
                if (!Array.isArray(bonus10Map[req.dateKey][sessionKey])) {
                    bonus10Map[req.dateKey][sessionKey] = [];
                }
                bonus10Map[req.dateKey][sessionKey].push(req);
            }
        });
        const previousPenaltyState = prevMonthlySettingsAll?.bonus10PenaltyState;
        const prevMonthFlags = {
            early10PenaltyActive: previousPenaltyState && typeof previousPenaltyState.active === 'boolean'
                ? previousPenaltyState.active
                : bonus10Records.some(req => req.status === 'rejected'),
            subjectEarly10Map: typeof Early10 !== 'undefined' && Early10.buildSubjectEarly10Map
                ? Early10.buildSubjectEarly10Map(
                    Array.isArray(window.currentSubjectCatalog) ? window.currentSubjectCatalog : []
                )
                : {},
            subjectEarly10NameMap: typeof Early10 !== 'undefined' && Early10.buildSubjectEarly10NameMap
                ? Early10.buildSubjectEarly10NameMap(
                    Array.isArray(window.currentSubjectCatalog) ? window.currentSubjectCatalog : []
                )
                : {}
        };

        const observationMap = {};
        observationRecords.forEach(item => {
            if (!item.dateKey) return;
            if (!observationMap[item.dateKey]) observationMap[item.dateKey] = [];
            observationMap[item.dateKey].push(item);
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
                bonus10Map[dateStr] || {},
                observationMap[dateStr] || [],
                prevMonthFlags
            );
            
            chips.forEach(c => {
                c.dateStr = dateStr;
                prevChips.push(c);
            });
        }
        
        const prevRoleSettings = prevMonthlySettingsAll[window.modalActiveRole] || prevMonthlySettingsAll[window.modalActiveRole.replace('-', '_')] || {};
        
        let workedShifts = 0;
        let vpShifts = 0;
        let vdxShifts = 0;
        let vkpShifts = 0;
        let lateCount = 0;
        let totalLateMinutes = 0;
        
        prevChips.forEach(chip => {
            if (chip.class === 'chip-future' || chip.isCenterOff) return;
            
            const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
            if (window.modalActiveRole === 'tiep-tan' && !isTT) return;
            if (window.modalActiveRole === 'giao-vien' && isTT) return;
            
            if (chip.isAbsence || chip.absenceType || chip.isVDX || /(?:^|\s)chip-(?:gray|red)(?:\s|$)/.test(chip.class || '')) {
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
            
            const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
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
                        addPayrollRateGroupMinutes(groups, groupName, chip, segMins);
                    });
                } else {
                    const groupName = chip.isFixedShift ? "Tiếp Tân (Ca Cố Định)" : "Tiếp Tân (Ca Bình Thường)";
                    const mins = chip.paidMinutes || 0;
                    addPayrollRateGroupMinutes(groups, groupName, chip, mins);
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
                            addPayrollRateGroupMinutes(groups, segName, chip, segMins);
                        }
                    });
                } else {
                    addPayrollRateGroupMinutes(groups, name, chip, chip.paidMinutes || 0);
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
                const policyMinutes = Number(group.policyMinutes) || 0;
                const manualMinutes = Number(group.manualMinutes) || 0;
                
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
                        const firstWithRate = group.chips.find(c => getAuthoritativeAdminPayrollRate(c) === null && c.sessionData && Number(c.sessionData.roleRate) > 0);
                        rate = firstWithRate ? Number(firstWithRate.sessionData.roleRate) : 0;
                        }
                    }
                }
                
                const amt = getPayrollRateGroupAmount(group, rate);
                basePay += amt;
                const displayRate = policyMinutes === 0 && manualMinutes > 0
                    ? group.manualAmount / (manualMinutes / 60)
                    : rate;
                const displayRateText = policyMinutes > 0 && manualMinutes > 0
                    ? `${formatNumberWithCommas(displayRate)} ₫ + Admin`
                    : `${formatNumberWithCommas(displayRate)} ₫`;
                
                const h = Math.floor(mins / 60);
                const m = Math.floor(mins % 60);
                const timeStr = `${h}h${m > 0 ? ' ' + m + 'p' : ''}`;
                
                classRatesRowsHtml += `
                    <tr style="border-bottom: 1px solid #E5E7EB;">
                        <td style="padding: 0.65rem 1rem; font-weight: 500; color: #374151;">${name}</td>
                        <td style="padding: 0.65rem 1rem; text-align: center; color: #4B5563;">${timeStr}</td>
                        <td style="padding: 0.65rem 1rem; text-align: right; font-weight: 600; color: #374151;">${displayRateText}</td>
                        <td style="padding: 0.65rem 1rem; text-align: right; font-weight: 700; color: #111827;">${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amt)}</td>
                    </tr>
                `;
            });
        }
        
        const grandH = Math.floor(prevChips.reduce((acc, c) => {
            const isTT = c.isReceptionist || (c.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role));
            if (window.modalActiveRole === 'tiep-tan' && !isTT) return acc;
            if (window.modalActiveRole === 'giao-vien' && isTT) return acc;
            return acc + (c.paidMinutes || 0);
        }, 0) / 60);
        const grandM = Math.floor(prevChips.reduce((acc, c) => {
            const isTT = c.isReceptionist || (c.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role));
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
                    Bảng Lương Tháng ${prevMonth + 1}/${prevYear} (Tính lại từ công — chưa có bản chốt)
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

function resolvePayrollShiftConfig(settings, type, branch) {
    return settings?.[`${type}Shifts_${branch}`] || settings?.[`${type}Shifts`] || {
        morning: { start: '07:00', end: '11:30' },
        afternoon: { start: '14:00', end: '18:00' },
        evening: { start: '17:30', end: '21:30' }
    };
}

async function loadAndComputeAllReceptionists(monthStr, isCurrent = null) {
    const epoch = _reportRenderEpoch;
    const staff = getTargetStaffId();
    const canCommit = typeof isCurrent === 'function' ? isCurrent :
        () => _reportRenderEpoch === epoch && getTargetStaffId() === staff;
    const allUsers = window._allStaffList || [];
    const receptionists = allUsers.filter(u => {
        const roles = Array.isArray(u.roles) ? u.roles : [u.role || ''];
        return hasReceptionistEmploymentRole(roles);
    });
    
    const allMonthlySettings = await DBService.getAllMonthlySalarySettings(monthStr, { strict: true });
    const systemSettings = await DBService._getRequiredFinancialDocument('settings', 'system') || {};
    
    const BRANCHES = ['cs1', 'cs2', 'cs3'];
    const shiftConfigMap = {};
    const officeShiftConfigMap = {};
    for (const branch of BRANCHES) {
        shiftConfigMap[branch] = resolvePayrollShiftConfig(systemSettings, 'receptionist', branch);
        officeShiftConfigMap[branch] = resolvePayrollShiftConfig(systemSettings, 'office', branch);
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
                DBService.getReceptionistSchedule(compositeKey, { source: 'server' }).then(data => ({
                    branch,
                    mondayKey,
                    scheduleType: 'receptionist',
                    documentKey: compositeKey,
                    data: data || {}
                }))
            );
            recepPromises.push(
                DBService.getOfficeSchedule(compositeKey, { source: 'server' }).then(data => ({
                    branch,
                    mondayKey,
                    scheduleType: 'office',
                    documentKey: compositeKey,
                    data: data || {}
                }))
            );
        });
    });
    const recepResults = await Promise.all(recepPromises);
    
    const staffDataPromises = receptionists.map(async (u) => {
        const rId = u.id;
        const [attendanceRecords, notes, cancelledShifts] = await Promise.all([
            DBService.getMonthlyAttendance(monthStr, rId, true, { strict: true }),
            DBService.getDailyNotes(rId, { strict: true }),
            DBService.getCancelledShifts(monthStr, rId, { strict: true })
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

                    const branchConfig = result.scheduleType === 'office'
                        ? (officeShiftConfigMap[result.branch] || {})
                        : (shiftConfigMap[result.branch] || {});
                    const weekShiftConfig = result.data?._shiftConfig?.[shiftKey];
                    const defaultStart = staffEntry.customStart || weekShiftConfig?.start || branchConfig[shiftKey]?.start || '07:00';
                    const defaultEnd = staffEntry.customEnd || weekShiftConfig?.end || branchConfig[shiftKey]?.end || '11:30';

                    receptionistShiftsMap[dateStr].push({
                        shift: shiftKey,
                        label: SHIFT_LABELS[shiftKey],
                        start: staffEntry.customStart || defaultStart,
                        end: staffEntry.customEnd || defaultEnd,
                        branch: result.branch,
                        scheduleType: result.scheduleType,
                        documentKey: result.documentKey,
                        cancelCompositeKey: result.scheduleType === 'office'
                            ? `office_${result.branch}_${mondayKey}`
                            : `${result.branch}_${mondayKey}`,
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
            const isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
            if (!isTiepTan) return;
            if (chip.class === 'chip-gray') return;
            
            const isCs2 = chip.branch === 'cs2' || chip.sessionData?.branch === 'cs2' || (chip.mergedSegments && chip.mergedSegments.some(s => s.branch === 'cs2' || s.lop?.includes('CS2')));
            if (isCs2) {
                hasCs2Shift = true;
            }

            if (chip.mergedSegments && chip.mergedSegments.length > 0) {
                let remainingMinutes = chip.paidMinutes || 0;
                const totalSched = chip.mergedSegments.reduce((sum, seg) => sum + (seg.schedMinutes || 0), 0);
                chip.mergedSegments.forEach((seg, sIdx) => {
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
    
    if (!canCommit()) return;
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
    if (!requireCompletePayrollReport()) return;
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
        const monthlySettings = await DBService.getMonthlySalarySettings(staffId, monthStr, { strict: true }) || {};
        let settings = monthlySettings[roleKey] || monthlySettings[roleKey.replace('_', '-')] || {};
        if (Object.keys(settings).length === 0) {
            // Check if they are a pure receptionist
            const user = window.currentUserContext;
            let hasReceptionist = false;
            let hasTeaching = false;
            if (user) {
                const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
                hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
                hasTeaching = hasTeachingEmploymentRole(staffRoles);
            }
            const isPureRecep = hasReceptionist && !hasTeaching;
            if (isPureRecep) {
                settings = await DBService.getSalarySettings(staffId, { strict: true }) || {};
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
            hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
            hasTeaching = hasTeachingEmploymentRole(staffRoles);
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
        
        calculateSalary();
        const draftResult = await saveCalculationDraftToDb(staffId, monthStr);
        showDraftSaveOutcome(draftResult, 'Đã lưu thông tin bổ sung thành công!');
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
    if (!requireCompletePayrollReport()) return;
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
        hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
        hasTeaching = hasTeachingEmploymentRole(staffRoles);
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
        const publishResult = await DBService.publishSalary(staffId, monthStr, payload);
        if (publishResult?.lockedComponents?.length) {
            UIService.toast('Phần lương đã xác nhận được giữ nguyên. Muốn đổi số tiền cần tạo bản hiệu chỉnh mới.', 'warning');
        } else if (publishResult?.skippedComponents?.length) {
            UIService.toast('Đã gửi phần có dữ liệu; phần chưa tính được giữ ở trạng thái nháp.', 'warning');
        } else {
            UIService.toast('Gửi bảng lương thành công!', 'success');
        }
        
        // Reload settings to update UI
        await loadSalarySettings();
    } catch (e) {
        console.error('Error publishing salary:', e);
        UIService.toast('Gửi bảng lương thất bại: ' + e.message, 'error');
    } finally {
        UIService.hideLoading();
    }
}

let salaryDashboardGeneration = 0;
let salaryDashboardWatchMonth = '';
let unsubscribeSalaryDashboard = null;

async function loadSalaryDashboard() {
    const generation = ++salaryDashboardGeneration;
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    try {
        UIService.showLoading();
        const allSettings = await DBService.getAllMonthlySalarySettings(monthStr, { strict: true });
        if (generation !== salaryDashboardGeneration) return;
        window.currentMonthAllSettings = allSettings || {};
        renderSalaryDashboardTable();
        if (salaryDashboardWatchMonth !== monthStr || !unsubscribeSalaryDashboard) {
            if (unsubscribeSalaryDashboard) unsubscribeSalaryDashboard();
            salaryDashboardWatchMonth = monthStr;
            unsubscribeSalaryDashboard = DBService.watchMonthlyPayslips(monthStr, settings => {
                if (salaryDashboardWatchMonth !== monthStr) return;
                window.currentMonthAllSettings = settings;
                if (document.getElementById('salary-dashboard-view')?.style.display === 'block') renderSalaryDashboardTable();
            }, error => UIService.toast('Chưa thể đồng bộ trạng thái nhận lương. Vui lòng tải lại.', 'warning'));
        }
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
        const isTeacher = hasTeachingEmploymentRole(uRoles);
        const isOffice = hasOfficeEmploymentRole(uRoles);
        // Dashboard rows must be classified from this employee's own profile.
        // `unfilteredAllMonthChips` belongs to the employee currently open in
        // the report and previously marked every row as receptionist.
        const isRecep = hasReceptionistEmploymentRole(uRoles);
        
        let primaryRole = 'Staff';
        if (isTeacher && isRecep) primaryRole = isOffice ? 'Kiêm nhiệm (GV & Văn Phòng)' : 'Dual (GV & TT)';
        else if (isTeacher) primaryRole = 'Giáo Viên';
        else if (isRecep) primaryRole = isOffice ? 'Nhân Viên Văn Phòng' : 'Tiếp Tân';
        
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
        let canConfirmPaid = false;
        let hasReceivedComponent = false;
        let hasDraftComponent = false;
        
        if (pub) {
            const lifecycle = typeof DBService.getPayslipLifecycleState === 'function'
                ? DBService.getPayslipLifecycleState(pub)
                : null;
            status = lifecycle?.overallStatus || pub.status || 'draft';
            const componentStatuses = lifecycle
                ? [
                    lifecycle.has_gv ? lifecycle.status_gv : null,
                    lifecycle.has_tt ? lifecycle.status_tt : null
                ].filter(Boolean)
                : [status];
            canConfirmPaid = componentStatuses.includes('published');
            hasReceivedComponent = componentStatuses.includes('received');
            hasDraftComponent = componentStatuses.includes('draft');
            baseSalary = pub.baseSalary || 0;
            totalBonus = pub.totalBonus || 0;
            advance = pub.advance || 0;
            netPay = pub.netPay || 0;
            
            const paymentBreakdown = typeof DBService.getPayslipPaymentBreakdown === 'function'
                ? DBService.getPayslipPaymentBreakdown(pub)
                : {
                    total: netPay,
                    paid: status === 'received' ? netPay : 0,
                    unpaid: status === 'received' ? 0 : netPay
                };
            totalPayroll += paymentBreakdown.total;
            totalPaid += paymentBreakdown.paid;
            totalUnpaid += paymentBreakdown.unpaid;
            
            if (status === 'received') {
                const date = new Date(pub.receivedAt);
                const dateStr = isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN');
                const by = pub.confirmedBy === 'admin' ? 'Admin' : 'Nhân viên';
                infoStr = `<div style="font-size:0.8rem;color:#059669;font-weight:600;">Nhận: ${dateStr}</div><div style="font-size:0.7rem;color:#6B7280;">Bởi: ${by}</div>`;
                
                statusBadge = `<span style="background:#D1FAE5;color:#065F46;border:1px solid #10B981;padding:4px 8px;border-radius:9999px;font-size:0.75rem;font-weight:700;">Đã nhận</span>`;
            } else if (canConfirmPaid) {
                const date = new Date(pub.publishedAt);
                const dateStr = isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN');
                infoStr = `<div style="font-size:0.8rem;color:#1E40AF;font-weight:600;">Gửi: ${dateStr}</div>${hasReceivedComponent ? '<div style="font-size:0.7rem;color:#92400E;">Đã nhận một phần</div>' : ''}`;
                
                statusBadge = `<span style="background:#DBEAFE;color:#1E40AF;border:1px solid #3B82F6;padding:4px 8px;border-radius:9999px;font-size:0.75rem;font-weight:700;">${hasReceivedComponent ? 'Đã nhận một phần' : 'Đã gửi'}</span>`;
            } else if (hasReceivedComponent) {
                infoStr = '<div style="font-size:0.8rem;color:#92400E;font-weight:600;">Đã nhận phần đã gửi</div><div style="font-size:0.7rem;color:#6B7280;">Phần còn lại đang tổng hợp</div>';
                statusBadge = '<span style="background:#FEF3C7;color:#92400E;border:1px solid #F59E0B;padding:4px 8px;border-radius:9999px;font-size:0.75rem;font-weight:700;">Chờ phần còn lại</span>';
            } else {
                infoStr = '<div style="font-size:0.8rem;color:#6B7280;">Đang tổng hợp</div>';
                statusBadge = '<span style="background:#F3F4F6;color:#4B5563;border:1px solid #D1D5DB;padding:4px 8px;border-radius:9999px;font-size:0.75rem;font-weight:700;">Chưa gửi</span>';
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
            infoStr: infoStr,
            canConfirmPaid: canConfirmPaid,
            hasReceivedComponent: hasReceivedComponent,
            hasDraftComponent: hasDraftComponent
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
        const colorCandidate = String(u.scheduleColor || '');
        const color = /^#[0-9a-f]{6}$/i.test(colorCandidate) ? colorCandidate : '#64748B';
        const displayName = String(u.name || u.username || 'Không tên');
        const initial = escapeReportHtml(displayName.charAt(0).toUpperCase() || '?');
        const safeName = escapeReportHtml(displayName);
        const safeUsername = escapeReportHtml(u.username || '—');
        const safePrimaryRole = escapeReportHtml(row.primaryRole);
        const safeStaffId = escapeReportHtml(String(u.id || ''));
        
        let actionButtons = '';
        if (row.canConfirmPaid) {
            const confirmLabel = row.hasDraftComponent || row.hasReceivedComponent ? 'Chi phần đã gửi' : 'Đã chi';
            actionButtons = `
                <button type="button" class="btn btn-sm btn-primary" data-salary-dashboard-action="confirm" data-staff-id="${safeStaffId}" style="background:#10B981;color:white;border:none;padding:4px 8px;font-size:0.75rem;font-weight:700;border-radius:4px;cursor:pointer;">
                    ${confirmLabel}
                </button>
                <button type="button" class="btn btn-sm" data-salary-dashboard-action="view" data-staff-id="${safeStaffId}" style="background:#EEF2FF;color:#4338CA;border:1px solid #C7D2FE;padding:4px 8px;font-size:0.75rem;font-weight:700;border-radius:4px;cursor:pointer;margin-left:4px;">
                    Chi tiết
                </button>
            `;
        } else if (row.status === 'received' || row.hasReceivedComponent) {
            actionButtons = `
                <button type="button" class="btn btn-sm" data-salary-dashboard-action="view" data-staff-id="${safeStaffId}" style="background:#EEF2FF;color:#4338CA;border:1px solid #C7D2FE;padding:4px 8px;font-size:0.75rem;font-weight:700;border-radius:4px;cursor:pointer;">
                    Chi tiết
                </button>
            `;
        } else {
            actionButtons = `
                <button type="button" class="btn btn-sm btn-primary" data-salary-dashboard-action="view" data-staff-id="${safeStaffId}" style="background:#3B82F6;color:white;border:none;padding:4px 8px;font-size:0.75rem;font-weight:700;border-radius:4px;cursor:pointer;">
                    Tính & Gửi
                </button>
            `;
        }
        
        return `
            <tr style="border-bottom:1px solid var(--border-color);font-size:0.9rem;">
                <td style="padding:0.75rem 0.75rem;display:flex;align-items:center;gap:0.5rem;">
                    <div style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;color:white;">${initial}</div>
                    <div>
                        <div style="font-weight:600;color:var(--text-color);">${safeName}</div>
                        <div style="font-size:0.7rem;color:#9CA3AF;">MSNV: ${safeUsername}</div>
                    </div>
                </td>
                <td style="padding:0.75rem 0.75rem;color:#4B5563;font-weight:500;">${safePrimaryRole}</td>
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

    tableBody.querySelectorAll('[data-salary-dashboard-action]').forEach(button => {
        button.addEventListener('click', () => {
            const staffId = button.dataset.staffId || '';
            if (button.dataset.salaryDashboardAction === 'confirm') adminConfirmPaid(staffId);
            else viewPersonalReportFromDash(staffId);
        });
    });
}

async function adminConfirmPaid(staffId) {
    if (!confirm("Xác nhận chi tiền mặt cho nhân viên này?")) return;
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    try {
        UIService.showLoading();
        const result = await DBService.confirmSalaryReceived(staffId, monthStr, 'admin');
        if (!result.changed) {
            UIService.toast('Bảng lương này đã được xác nhận trước đó.', 'info');
        } else if (result.status === 'received') {
            UIService.toast('Xác nhận đã chi thành công!', 'success');
        } else if (result.receivedComponents?.length) {
            UIService.toast('Đã xác nhận chi phần bảng lương đã gửi. Phần còn lại vẫn đang tổng hợp.', 'warning');
        }
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
        ++salaryDashboardGeneration;
        if (unsubscribeSalaryDashboard) unsubscribeSalaryDashboard();
        unsubscribeSalaryDashboard = null;
        salaryDashboardWatchMonth = '';
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
        hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
        hasTeaching = hasTeachingEmploymentRole(staffRoles);
    }
    
    const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
    const activeFilter = (window.currentLoadedRoleKey === 'tiep_tan') ? 'tiep-tan' : 'giao-vien';
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
    const chips = (window.unfilteredAllMonthChips || window.currentMonthChips || []).filter(c => c.paidMinutes > 0);
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
    const payloadPenaltyActive = isStudentCountPenaltyActive(
        monthlyAll,
        window.unfilteredAllMonthChips || chips
    );

    // Cộng 1 phân bổ giờ dạy vào đúng MỘT nhóm môn + MỘT nhóm tổng hợp.
    const addTeachingAllocation = allocation => {
        const salary = (allocation.minutes / 60) * allocation.rate;
        if (!subjectBreakdown[allocation.name]) {
            subjectBreakdown[allocation.name] = { minutes: 0, rate: allocation.rate, amount: 0 };
        }
        subjectBreakdown[allocation.name].minutes += allocation.minutes;
        subjectBreakdown[allocation.name].amount += salary;

        const normalizedName = removeVietnameseTones((allocation.name || '').toLowerCase());
        if (normalizedName.includes('tin hoc')) {
            totalTinHocMins += allocation.minutes;
            totalTinHocSalary += salary;
        } else if (normalizedName.includes('mam non')) {
            totalPreschoolMins += allocation.minutes;
            totalPreschoolSalary += salary;
        } else if (normalizedName.includes('lien ket')) {
            totalAffiliateMins += allocation.minutes;
            totalAffiliateSalary += salary;
        } else if (normalizedName.includes('kem 1:1') || normalizedName.includes('kem 1-1') || normalizedName.includes('tai nha')) {
            totalTutoringMins += allocation.minutes;
            totalTutoringSalary += salary;
        } else if (normalizedName.includes('soan') || normalizedName.includes('cham') || normalizedName.includes('su kien') || normalizedName.includes('phat sinh')) {
            totalExtraMins += allocation.minutes;
            totalExtraSalary += salary;
        } else {
            totalBaseMins += allocation.minutes;
            totalBaseSalary += salary;
        }
    };

    chips.forEach(chip => {
        const isReceptionistChip = chip.isReceptionist === true;
        if (!chip.sessionData && !isReceptionistChip) return;
        let include = false;
        
        if (role === 'giao-vien') {
            const roleId = chip.sessionData ? (chip.sessionData.role || '') : '';
            const nameRaw = chip.sessionData ? ((chip.sessionData.roleName || '').toLowerCase()) : '';
            const name = removeVietnameseTones(nameRaw);
            const isReceptionID = ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(roleId);
            if (isReceptionistChip || (!chip.isTeaching && isReceptionID)) {
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
                const isReceptionID = ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(roleId);
                if (!chip.isTeaching && isReceptionID) {
                    include = true;
                }
            }
        }

        if (include) {
            const minutes = chip.paidMinutes || 0;
            let rate = 0;
            let hasClassRate = false;
            
            const isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
            
            let classRates = {};
            const cfg = window.currentUserContext?.salary_config || {};
            if (isTiepTan) {
                const ttMonthly = monthlyAll['tiep_tan'] || monthlyAll['tiep-tan'] || {};
                classRates = ttMonthly.class_rates || cfg.class_rates || {};
            } else {
                const gvMonthly = monthlyAll['giao_vien'] || monthlyAll['giao-vien'] || {};
                classRates = gvMonthly.class_rates || cfg.class_rates || {};
            }
            
                const adminManualRate = getAuthoritativeAdminPayrollRate(chip);
                if (adminManualRate !== null) {
                    rate = adminManualRate;
                    hasClassRate = true;
                } else if (chip.chipFilterName && classRates[chip.chipFilterName] !== undefined && Number(classRates[chip.chipFilterName]) > 0) {
                    rate = Number(classRates[chip.chipFilterName]);
                    hasClassRate = true;
                }

            if (isTiepTan) {
                let fixedRate = classRates["Tiếp Tân (Ca Cố Định)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Cố Định)"]) : Number(cfg.receptionist_fixed_rate || 0);
                let normalRate = classRates["Tiếp Tân (Ca Bình Thường)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Bình Thường)"]) : Number(cfg.receptionist_normal_rate || 0);
                if (adminManualRate !== null) {
                    fixedRate = adminManualRate;
                    normalRate = adminManualRate;
                }
                
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
                        const adminSegmentRate = getAuthoritativeAdminPayrollRate(chip);
                        if (adminSegmentRate !== null) {
                            segRate = adminSegmentRate;
                        } else if (segName && classRates[segName] !== undefined && Number(classRates[segName]) > 0) {
                            segRate = Number(classRates[segName]);
                        } else {
                            const snapshotRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                            segRate = getResolvedTeachingRate(chip, segName, snapshotRate);
                        }
                        getTeachingPayAllocations(chip, segName, segMins, segRate, classRates, payloadPenaltyActive)
                            .forEach(addTeachingAllocation);
                    });
                } else {
                    const segName = chip.chipFilterName || "Chưa phân lớp";
                    if (hasClassRate) {
                        getTeachingPayAllocations(chip, segName, minutes, rate, classRates, payloadPenaltyActive)
                            .forEach(addTeachingAllocation);
                    } else {
                        const snapshotRate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
                        let defaultRate = getResolvedTeachingRate(chip, chip.chipFilterName || "Chưa phân lớp", snapshotRate);
                        getTeachingPayAllocations(chip, segName, minutes, defaultRate, classRates, payloadPenaltyActive)
                            .forEach(addTeachingAllocation);
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
            if (criteriaIndex === 0 && rowData.manual !== true && (rowData.amount === undefined || String(rowData.note || '').startsWith('Thưởng chuyên cần:'))) {
                const roleMinutes = role === 'tiep-tan' ? filteredMinutes : totalBaseMins + totalTinHocMins + totalPreschoolMins + totalAffiliateMins + totalTutoringMins + totalExtraMins;
                amount = getRecepAttBonus(roleMinutes);
                const autoNotePrefix = "Thưởng chuyên cần:";
                if (!note || note.startsWith(autoNotePrefix)) {
                    note = getRecepAttNote(roleMinutes);
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
        
        const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(chip.sessionData.role));
        if (role === 'tiep-tan' && !isTT) return;
        if (role === 'giao-vien' && isTT) return;
        
        if (chip.isAbsence || chip.absenceType || chip.isVDX || /(?:^|\s)chip-(?:gray|red)(?:\s|$)/.test(chip.class || '')) {
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
        const employmentRoles = Array.isArray(window.currentUserContext?.roles) && window.currentUserContext.roles.length > 0
            ? window.currentUserContext.roles
            : [window.currentUserContext?.role || ''];
        const hasOfficeRole = hasOfficeEmploymentRole(employmentRoles);
        const hasStrictReceptionRole = employmentRoles.some(r => [
            'receptionist', 'receptionist_assistant', 'receptionist_lead',
            'receptionist_staff', 'tiep-tan', 'tiep_tan', 'senior_assistant'
        ].includes(r));
        details.operationalLabel = hasOfficeRole
            ? (hasStrictReceptionRole ? 'Tiếp Tân / Văn Phòng' : 'Văn Phòng')
            : 'Tiếp Tân';
    }
    
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
            minutes: subjectBreakdown[subj].minutes,
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

function showDraftSaveOutcome(result, successMessage) {
    if (result?.locked) {
        const componentLabel = result.component === 'tt' ? 'Tiếp Tân' : 'Giáo Viên';
        const statusLabel = result.componentStatus === 'received' ? 'đã xác nhận' : 'đã gửi';
        UIService.toast(
            `Đã lưu cấu hình, nhưng phần lương ${componentLabel} ${statusLabel} nên số tiền không đổi. Cần tạo bản hiệu chỉnh để thay đổi.`,
            'warning'
        );
        return;
    }
    if (result?.preservedPublishedSnapshot) {
        UIService.toast(`${successMessage} Phần lương đã gửi/đã nhận khác được giữ nguyên.`, 'warning');
        return;
    }
    UIService.toast(successMessage, 'success');
}

async function saveCalculationDraftToDb(staffId, monthStr) {
    if (!staffId || !monthStr) return;
    if (!requireCompletePayrollReport() || window.payrollReadyScope !== `${staffId}__${monthStr}`) {
        throw new Error('Chưa thể lưu bản tính: dữ liệu nhân sự/tháng chưa tải đủ.');
    }
    
    const user = window.currentUserContext;
    let hasReceptionist = false;
    let hasTeaching = false;
    if (user) {
        const staffRoles = (user.roles && user.roles.length > 0) ? user.roles : [user.role || ''];
        hasReceptionist = hasReceptionistEmploymentRole(staffRoles) || (window.unfilteredAllMonthChips || []).some(c => c.isReceptionist || (c.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff'].includes(c.sessionData.role)));
        hasTeaching = hasTeachingEmploymentRole(staffRoles);
    }
    const filterVal = document.getElementById('salary-role-filter')?.value || 'all';
    const activeFilter = window.currentLoadedRoleKey === 'tiep_tan' ? 'tiep-tan' : 'giao-vien';
    const activeComponent = activeFilter === 'tiep-tan' ? 'tt' : 'gv';
    
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

        const lockState = DBService.getPayslipDraftLockState(existingPublished, activeComponent);
        if (lockState.locked) {
            return {
                saved: false,
                locked: true,
                status: 'locked',
                component: activeComponent,
                componentStatus: lockState.status,
                requiresRevision: true,
                lifecycle: lockState.lifecycle
            };
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
        
        const activePayload = activeFilter === 'tiep-tan' ? payloadTT : payloadGV;
        if (activePayload && activePayload.message) {
            updatedPublished.message = activePayload.message;
        }
        
        // The transaction re-checks the latest lifecycle so a concurrent
        // publish/confirmation cannot be overwritten by this stale calculation.
        const draftTransition = await DBService.savePayslipDraft(
            staffId,
            monthStr,
            updatedPublished,
            activeComponent
        );
        if (!draftTransition.saved) {
            return {
                saved: false,
                locked: true,
                status: 'locked',
                component: activeComponent,
                componentStatus: draftTransition.componentStatus,
                requiresRevision: true,
                lifecycle: draftTransition.lifecycle
            };
        }
        return {
            saved: true,
            locked: false,
            status: 'draft_saved',
            component: activeComponent,
            preservedPublishedSnapshot: draftTransition.preservedPublishedSnapshot,
            lifecycle: draftTransition.lifecycle
        };
    } catch (e) {
        console.error('Error saving salary draft:', e);
        throw e;
    }
}

async function openBulkPublishModal(opts) {
    const modal = document.getElementById('bulk-publish-modal');
    if (!modal) return;
    const keepMessage = !!(opts && opts.keepMessage);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    try {
        UIService.showLoading();
        
        // Invalidate cache first
        DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
        const allSettings = await DBService.getAllMonthlySalarySettings(monthStr, { strict: true });
        window.bulkPublishAllSettings = allSettings;
        
        const teachersList = [];
        const recepsList = [];
        
        const staffList = window._allStaffList || [];
        staffList.forEach(u => {
            const uRoles = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role || ''];
            const isTeacher = hasTeachingEmploymentRole(uRoles);
            // CHỈ xét chức danh của CHÍNH người này. Bản cũ có thêm vế
            // `(window.unfilteredAllMonthChips||[]).some(...)` — vế đó KHÔNG dùng biến `u`, nó soi
            // chip của người đang mở trên trang; nên chỉ cần đang xem một tiếp tân là TOÀN BỘ giáo
            // viên bị đổ sang cột Tiếp Tân, và nút "Gửi bên Tiếp Tân" sẽ gửi lẫn cả giáo viên.
            const isRecep = hasReceptionistEmploymentRole(uRoles);

            const docData = allSettings[u.id] || {};
            const pub = docData.published;
            const uName = u.name || u.username || '';
            const uAccount = u.username || '';

            let teacherStatus = 'uncalculated';
            let recepStatus = 'uncalculated';
            let teacherNetPay = 0;
            let recepNetPay = 0;
            
            if (pub) {
                const lifecycle = DBService.getPayslipLifecycleState(pub);
                if (lifecycle.has_gv) teacherStatus = lifecycle.status_gv;
                if (lifecycle.has_tt) recepStatus = lifecycle.status_tt;

                teacherNetPay = Number(pub.details_gv?.netPay)
                    || (pub.role !== 'dual' && lifecycle.has_gv ? Number(pub.netPay) || 0 : 0);
                recepNetPay = Number(pub.details_tt?.netPay)
                    || (pub.role !== 'dual' && lifecycle.has_tt ? Number(pub.netPay) || 0 : 0);
            }
            
            const isDual = isTeacher && isRecep;
            const showInTeacherList = isTeacher && (!isDual || !pub || pub.details_gv !== null);
            const showInRecepList = isRecep && (!isDual || !pub || pub.details_tt !== null);
            
            if (showInTeacherList) {
                teachersList.push({
                    id: u.id,
                    name: uName,
                    account: uAccount,
                    msnv: u.msnvStr || '—',
                    status: teacherStatus,
                    netPay: teacherNetPay,
                    sentAt: (pub && (pub.publishedAt_gv || pub.publishedAt)) || null
                });
            }
            if (showInRecepList) {
                recepsList.push({
                    id: u.id,
                    name: uName,
                    account: uAccount,
                    msnv: u.msnvStr || '—',
                    status: recepStatus,
                    netPay: recepNetPay,
                    sentAt: (pub && (pub.publishedAt_tt || pub.publishedAt)) || null
                });
            }
        });

        // Render lists — mỗi cột chia 3 khu để không lẫn việc đang làm dở với việc đã xong
        renderBulkColumn('bulk-list-teachers', teachersList, 'teachers', monthStr, 'Không có giáo viên/trợ giảng');
        renderBulkColumn('bulk-list-receps', recepsList, 'receps', monthStr, 'Không có tiếp tân');

        // Giữ lời nhắn khi vẽ lại sau lượt gửi (sếp còn gửi tiếp bên kia)
        const messageInput = document.getElementById('bulk-message-input');
        if (messageInput && !keepMessage) messageInput.value = '';

        // Giữ ô tìm kiếm khi vẽ lại; mở mới thì xóa
        const searchInput = document.getElementById('bulk-search-input');
        if (searchInput) {
            if (!keepMessage) searchInput.value = '';
            filterBulkPublishList(searchInput.value || '');
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
    const cleanQuery = String(query || '').trim().toLowerCase();
    const visibleBySection = {};
    document.querySelectorAll('.bulk-staff-row').forEach(row => {
        const name = row.dataset.name || '';
        const show = !cleanQuery || name.includes(cleanQuery);
        row.style.display = show ? 'flex' : 'none';
        const sec = row.dataset.section || '';
        visibleBySection[sec] = (visibleBySection[sec] || 0) + (show ? 1 : 0);
    });
    // Ẩn luôn tiêu đề khu nào không còn dòng nào khớp — tránh "Cần gửi (4)" mà bên dưới trống
    document.querySelectorAll('.bulk-section-head').forEach(head => {
        const sec = head.dataset.section || '';
        head.style.display = (visibleBySection[sec] || 0) > 0 ? 'flex' : 'none';
    });
    updateBulkSelectedCount();
}
window.filterBulkPublishList = filterBulkPublishList;

// ===== MODAL GỬI BẢNG LƯƠNG: chia 3 khu theo tình trạng =====
// Đang tính lương dở dang thì việc "cần gửi" phải nằm riêng, việc "đã xong" đẩy xuống dưới —
// không để lẫn vào danh sách chọn nữa (yêu cầu GĐ 07/08/2026).
const BULK_SECTIONS = [
    { key: 'todo', title: 'Cần gửi', hint: 'Đã tính xong, chưa gửi cho nhân viên', color: '#D97706', statuses: ['draft'] },
    { key: 'done', title: 'Đã xử lý tháng này', hint: 'Đã gửi — không nằm trong danh sách chọn nữa', color: '#1E40AF', statuses: ['published', 'received'] },
    { key: 'none', title: 'Chưa tính lương', hint: 'Bấm tên để mở bảng lương và tính', color: '#6B7280', statuses: ['uncalculated'] }
];

function bulkStaffReportUrl(staffId, group) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const dateParam = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const roleView = group === 'receps' ? 'tiep-tan' : 'giao-vien';
    return `bao-cao.html?staffId=${encodeURIComponent(staffId)}&date=${dateParam}&roleView=${roleView}`;
}

// Mở bảng lương của một người ở TAB MỚI (đúng người, đúng tháng, đúng vai trò)
function openStaffPayslipTab(staffId, group) {
    window.open(bulkStaffReportUrl(staffId, group), '_blank', 'noopener');
}
window.openStaffPayslipTab = openStaffPayslipTab;

function renderBulkColumn(containerId, list, group, monthStr, emptyText) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (list.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: #9CA3AF; padding: 2rem; font-size: 0.9rem;">${emptyText}</div>`;
        return;
    }

    // Sắp theo tên để dễ tìm mắt
    const sorted = [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));

    BULK_SECTIONS.forEach(section => {
        const items = sorted.filter(i => section.statuses.includes(i.status));
        if (items.length === 0) return;

        const head = document.createElement('div');
        head.className = 'bulk-section-head';
        head.dataset.section = `${group}-${section.key}`;
        head.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin:0.35rem 0 0.15rem;padding:0.4rem 0.15rem;border-bottom:1px dashed #E5E7EB;`;
        head.innerHTML = `
            <span style="font-size:0.78rem;font-weight:800;color:${section.color};text-transform:uppercase;letter-spacing:0.03em;">
                ${section.title} <span style="font-weight:700;">(${items.length})</span>
            </span>
            <span style="font-size:0.7rem;color:#9CA3AF;text-align:right;">${section.hint}</span>`;
        container.appendChild(head);

        items.forEach(item => container.appendChild(createBulkStaffRow(item, group, section.key)));
    });
}
window.renderBulkColumn = renderBulkColumn;

function createBulkStaffRow(item, group, sectionKey) {
    const row = document.createElement('div');
    row.className = 'bulk-staff-row';
    row.dataset.name = (item.name || '').toLowerCase();
    row.dataset.section = `${group}-${sectionKey}`;
    row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.6rem 0.7rem; border: 1px solid #E5E7EB; border-radius: 10px; background: #fff;';

    const selectable = sectionKey === 'todo';
    const accent = group === 'teachers' ? '#3B82F6' : '#10B981';

    let statusText = 'Chưa tính';
    let badgeBg = '#F3F4F6', badgeColor = '#4B5563', badgeBorder = '#D1D5DB';
    let netPayStr = '—', payColor = '#9CA3AF';

    if (item.status === 'draft') {
        statusText = 'Chưa gửi';
        badgeBg = '#FEF3C7'; badgeColor = '#B45309'; badgeBorder = '#FDE68A';
        netPayStr = formatNumberWithCommas(item.netPay) + ' đ'; payColor = '#B45309';
    } else if (item.status === 'published') {
        statusText = 'Đã gửi';
        badgeBg = '#DBEAFE'; badgeColor = '#1E40AF'; badgeBorder = '#93C5FD';
        netPayStr = formatNumberWithCommas(item.netPay) + ' đ'; payColor = '#1E40AF';
    } else if (item.status === 'received') {
        statusText = 'Đã nhận';
        badgeBg = '#D1FAE5'; badgeColor = '#065F46'; badgeBorder = '#6EE7B7';
        netPayStr = formatNumberWithCommas(item.netPay) + ' đ'; payColor = '#065F46';
    } else {
        row.style.background = '#FAFAFA';
    }

    let sentAtStr = '';
    if (item.sentAt) {
        const d = new Date(item.sentAt);
        if (!isNaN(d.getTime())) {
            sentAtStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
    }

    // The bulk workflow has exactly two protocol values. Preserve `receps`:
    // selectors, counters and publish routing all key off that value.
    const safeGroup = group === 'receps' ? 'receps' : 'teachers';
    const checkboxHtml = selectable
        ? `<input type="checkbox" class="bulk-staff-checkbox bulk-group-${safeGroup}" checked
                   title="Chọn để gửi bảng lương cho người này"
                   style="width: 18px; height: 18px; cursor: pointer; flex-shrink: 0; accent-color: ${accent};" />`
        : `<span style="width:18px;height:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:${badgeColor};">
               <i data-lucide="${item.status === 'uncalculated' ? 'minus' : 'check'}" style="width:14px;height:14px;"></i>
           </span>`;

    row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.7rem; min-width: 0;">
            ${checkboxHtml}
            <button type="button" class="bulk-open-payslip"
                    style="display:flex;flex-direction:column;align-items:flex-start;gap:1px;background:none;border:none;padding:0;margin:0;cursor:pointer;text-align:left;min-width:0;font-family:inherit;">
                <span class="bulk-staff-name" style="font-weight: 600; color: #1D4ED8; font-size: 0.9rem; display:inline-flex;align-items:center;gap:4px;text-decoration:underline;text-decoration-color:#BFDBFE;text-underline-offset:2px;">
                    <i data-lucide="external-link" style="width:12px;height:12px;opacity:0.7;"></i>
                </span>
                <span class="bulk-staff-meta" style="font-size: 0.72rem; color: #6B7280;"></span>
            </button>
        </div>
        <div style="display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0;">
            <span style="font-size: 0.68rem; padding: 2px 8px; border-radius: 9999px; font-weight: 700; white-space: nowrap; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder};">
                ${statusText}
            </span>
            <span style="font-weight: 700; font-size: 0.88rem; color: ${payColor}; min-width: 86px; text-align: right;">
                ${netPayStr}
            </span>
        </div>
    `;
    const staffId = String(item.id || '');
    const staffName = String(item.name || '');
    const checkbox = row.querySelector('.bulk-staff-checkbox');
    if (checkbox) {
        checkbox.dataset.id = staffId;
        checkbox.dataset.group = safeGroup;
        checkbox.addEventListener('change', () => onBulkCheckboxChange(staffId, checkbox.checked));
    }
    const openButton = row.querySelector('.bulk-open-payslip');
    if (openButton) {
        openButton.title = `Mở bảng lương của ${staffName} ở tab mới`;
        openButton.addEventListener('click', () => openStaffPayslipTab(staffId, safeGroup));
    }
    const nameNode = row.querySelector('.bulk-staff-name');
    if (nameNode) nameNode.insertBefore(document.createTextNode(staffName), nameNode.firstChild);
    const metaNode = row.querySelector('.bulk-staff-meta');
    if (metaNode) metaNode.textContent = `MSNV: ${String(item.msnv || '')}${sentAtStr ? ' · gửi ' + sentAtStr : ''}`;
    return row;
}

function onBulkCheckboxChange(staffId, isChecked) {
    // Checkboxes are selected independently per group; no cross-synchronization.
    updateBulkSelectedCount();
}

function toggleSelectAllGroup(group) {
    const headerCheckbox = document.getElementById(`bulk-select-all-${group}`);
    if (!headerCheckbox) return;

    const isChecked = headerCheckbox.checked;
    // Chỉ tick những dòng ĐANG HIỆN (tôn trọng ô tìm kiếm) và còn chọn được
    const checkboxes = document.querySelectorAll(`.bulk-staff-checkbox.bulk-group-${group}:not(:disabled)`);
    checkboxes.forEach(cb => {
        const row = cb.closest('.bulk-staff-row');
        if (row && row.style.display === 'none') return;
        cb.checked = isChecked;
    });
    updateBulkSelectedCount();
}

function updateBulkSelectedCount() {
    const nT = document.querySelectorAll('.bulk-staff-checkbox.bulk-group-teachers:checked').length;
    const nR = document.querySelectorAll('.bulk-staff-checkbox.bulk-group-receps:checked').length;

    const countDisplay = document.getElementById('bulk-selected-count');
    if (countDisplay) {
        countDisplay.innerHTML = (nT + nR) === 0
            ? '<span style="color:#9CA3AF;">Chưa chọn nhân viên nào</span>'
            : `Đang chọn: <b style="color:#1D4ED8;">${nT} giáo viên</b> · <b style="color:#047857;">${nR} tiếp tân</b>`;
    }

    const setBtn = (id, n, label) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = n === 0;
        btn.style.opacity = n === 0 ? '0.45' : '1';
        btn.style.cursor = n === 0 ? 'not-allowed' : 'pointer';
        const span = btn.querySelector('.bulk-btn-label');
        if (span) span.innerText = n === 0 ? label : `${label} (${n})`;
    };
    setBtn('btn-bulk-publish-teachers', nT, 'Gửi bên Giáo Viên');
    setBtn('btn-bulk-publish-receps', nR, 'Gửi bên Tiếp Tân');
    setBtn('btn-submit-bulk-publish', nT + nR, 'Gửi cả hai bên');
}

// scope: 'teachers' | 'receps' | 'all' — gửi riêng từng bên để đang tính dở vẫn gửi được
async function submitBulkPublish(scope) {
    const sc = scope === 'teachers' || scope === 'receps' ? scope : 'all';
    const selector = sc === 'all' ? '.bulk-staff-checkbox:checked' : `.bulk-staff-checkbox.bulk-group-${sc}:checked`;
    const checkedBoxes = document.querySelectorAll(selector);
    if (checkedBoxes.length === 0) {
        const what = sc === 'teachers' ? 'giáo viên' : (sc === 'receps' ? 'tiếp tân' : 'nhân viên');
        UIService.toast(`Vui lòng chọn ít nhất 1 ${what} để gửi!`, 'warning');
        return;
    }

    const scopeLabel = sc === 'teachers' ? 'GIÁO VIÊN & TRỢ GIẢNG' : (sc === 'receps' ? 'TIẾP TÂN' : 'CẢ HAI BÊN');
    const ok = await UIService.confirm(
        `Gửi bảng lương cho <b>${checkedBoxes.length} lượt</b> bên <b>${scopeLabel}</b>? ` +
        `Nhân viên sẽ thấy ngay bảng lương trên máy của họ. Bên còn lại không bị ảnh hưởng.`
    );
    if (!ok) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    const commonMessage = document.getElementById('bulk-message-input')?.value || '';
    
    try {
        UIService.showLoading();
        
        // Group checked checkboxes by staffId
        const publishTargets = {}; // { staffId: { teachers: boolean, receps: boolean } }
        checkedBoxes.forEach(cb => {
            const staffId = cb.dataset.id;
            const group = cb.dataset.group;
            if (!publishTargets[staffId]) {
                publishTargets[staffId] = { teachers: false, receps: false };
            }
            if (group === 'teachers') publishTargets[staffId].teachers = true;
            if (group === 'receps') publishTargets[staffId].receps = true;
        });
        
        const settledResults = await Promise.allSettled(Object.keys(publishTargets).map(staffId => {
            const targets = publishTargets[staffId];

            // GỬI ĐÚNG BÊN ĐƯỢC TICK, không suy từ currentPublished.role.
            // Bản cũ nhìn `role`: người có 2 chức danh nhưng doc lưu role='giao-vien' (lúc tính
            // chưa có giờ tiếp tân) thì tick cột Tiếp Tân lại đi ghi cờ bên giáo viên → gửi sai bên.
            // DBService re-reads each document in a transaction, so a stale bulk
            // modal cannot lower a concurrently confirmed component.
            return DBService.publishPayslipComponents(staffId, monthStr, {
                gv: targets.teachers,
                tt: targets.receps
            }, commonMessage);
        }));
        const publishResults = settledResults
            .filter(item => item.status === 'fulfilled')
            .map(item => item.value);
        const failedResults = settledResults.filter(item => item.status === 'rejected');
        if (failedResults.length) {
            console.error('Bulk publish partial failures:', failedResults.map(item => item.reason));
        }
        if (publishResults.length === 0 && failedResults.length > 0) {
            throw failedResults[0].reason;
        }

        const scopeDone = sc === 'teachers' ? 'bên Giáo Viên' : (sc === 'receps' ? 'bên Tiếp Tân' : 'cả hai bên');
        const sentCount = publishResults.reduce((sum, item) => sum + item.publishedComponents.length, 0);
        const lockedCount = publishResults.reduce((sum, item) => sum + item.lockedComponents.length, 0);
        const skippedCount = publishResults.reduce((sum, item) => sum + item.skippedComponents.length, 0);
        if (lockedCount || skippedCount || failedResults.length) {
            UIService.toast(
                `Đã gửi ${sentCount} phần lương ${scopeDone}; giữ nguyên ${lockedCount} phần đã nhận, bỏ qua ${skippedCount} phần chưa có dữ liệu và ${failedResults.length} hồ sơ lỗi.`,
                'warning'
            );
        } else {
            UIService.toast(`Đã gửi ${sentCount} bảng lương ${scopeDone}!`, 'success');
        }

        // KHÔNG đóng modal: sếp thường tính dở bên này rồi gửi tiếp bên kia.
        // Vẽ lại danh sách để người vừa gửi rơi xuống khu "Đã xử lý".
        await openBulkPublishModal({ keepMessage: true });

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
