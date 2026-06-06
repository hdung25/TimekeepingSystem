// Personnel Management Logic

document.addEventListener('DOMContentLoaded', () => {
    renderStaffTable();

    // Live color preview
    const colorInput = document.getElementById('staff-color');
    if (colorInput) {
        colorInput.addEventListener('input', (e) => _updateColorPreview(e.target.value));
    }
});

// Search/Filter staff table rows
window.filterStaffTable = function (query) {
    const normalizedQuery = query.toLowerCase().trim();
    const rows = document.querySelectorAll('#staff-table-body tr');
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(normalizedQuery) ? '' : 'none';
    });
};

function _updateColorPreview(color) {
    const preview = document.getElementById('staff-color-preview');
    if (preview) {
        preview.style.background = color;
        // Auto text color (white for dark bg, black for light bg)
        const r = parseInt(color.substr(1, 2), 16), g = parseInt(color.substr(3, 2), 16), b = parseInt(color.substr(5, 2), 16);
        preview.style.color = (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#000' : '#fff';
    }
}

let isEditing = false;

async function renderStaffTable() {
    const tbody = document.getElementById('staff-table-body');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Đang tải dữ liệu...</td></tr>';

    // FETCH FROM CLOUD
    const users = await DBService.getUsers();

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

    const ROLE_LABELS = {
        'admin': 'Quản Trị Viên',
        'senior_assistant': 'Trợ Lý Cấp Cao',
        'assistant': 'Trợ Lý',
        'teaching_assistant': 'Trợ Giảng / GV TA',
        'receptionist': 'Tiếp Tân',
        'receptionist_assistant': 'Trợ Lí Tiếp Tân',
        'staff': 'Nhân Viên'
    };

    let html = '';

    users.forEach((user, index) => {
        // Mapped code / MS NV format (display extracted number, or if none, index + 1)
        const msnvDisplay = user.msnvStr || (index + 1);

        // Lấy TẤT CẢ vai trò từ user.roles[] (đa vai trò)
        const userRolesArr = Array.isArray(user.roles) && user.roles.length > 0
            ? user.roles
            : (user.role ? [user.role] : ['staff']);
        const roleLabelsStr = userRolesArr
            .map(r => ROLE_LABELS[r] || r)
            .join(' · ');

        html += `
            <tr>
                <td><span style="font-weight: 600; font-family: monospace; color: var(--text-muted);">${msnvDisplay}</span></td>
                <td>
                    <div style="font-weight: 600; color: var(--text-color);">${user.name || user.username}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${roleLabelsStr}</div>
                </td>
                <td><span style="font-family: monospace; background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${user.username}</span></td>
                <td>${user.password}</td>
                <td style="text-align: right;">
                    <button class="action-btn" onclick="configureSalary('${user.id}')" title="Cấu hình Lương & Role" style="color: #059669; margin-right: 4px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                            <line x1="8" y1="21" x2="16" y2="21"></line>
                            <line x1="12" y1="17" x2="12" y2="21"></line>
                        </svg>
                    </button>
                    <button class="action-btn" onclick="editStaff('${user.id}')" title="Sửa thông tin cơ bản">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn delete" onclick="deleteStaff('${user.id}')" title="Xóa">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    });

    if (html === '') {
        html = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Chưa có nhân viên nào.</td></tr>';
    }

    tbody.innerHTML = html;
}

function openModal() {
    isEditing = false;
    document.getElementById('staff-form').reset();
    document.getElementById('staff-id').value = '';
    document.querySelectorAll('#staff-roles-checkboxes input[type="checkbox"]').forEach(cb => {
        cb.checked = (cb.value === 'staff');
    });
    document.getElementById('staff-color').value = '#4CAF50';
    _updateColorPreview('#4CAF50');
    document.getElementById('modal-title').innerText = 'Thêm Nhân Viên';

    document.getElementById('staff-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('staff-modal').style.display = 'none';
}

async function editStaff(userId) {
    isEditing = true;

    // Fetch fresh data or pass user object? Fetch is safer.
    const users = await DBService.getUsers();
    const user = users.find(u => u.id === userId);

    if (!user) return;

    // Load User Data
    document.getElementById('staff-id').value = user.id;
    document.getElementById('staff-name').value = user.name || '';
    document.getElementById('staff-username').value = user.username;
    document.getElementById('staff-password').value = user.password;
    
    // Set checkboxes theo roles array
    const userRoles = Array.isArray(user.roles) && user.roles.length > 0
        ? user.roles
        : (user.role ? [user.role] : ['staff']);
    document.querySelectorAll('#staff-roles-checkboxes input[type="checkbox"]').forEach(cb => {
        cb.checked = userRoles.includes(cb.value);
    });

    document.getElementById('staff-color').value = user.scheduleColor || '#4CAF50';
    _updateColorPreview(user.scheduleColor || '#4CAF50');

    // settings removed

    document.getElementById('modal-title').innerText = 'Chỉnh Sửa Nhân Viên';
    document.getElementById('staff-modal').style.display = 'flex';
}

async function handleStaffSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('staff-id').value;
    const name = document.getElementById('staff-name').value;
    const username = document.getElementById('staff-username').value.trim();
    const password = document.getElementById('staff-password').value.trim();

    const checkedRoles = Array.from(
        document.querySelectorAll('#staff-roles-checkboxes input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    if (checkedRoles.length === 0) {
        if (typeof UIService !== 'undefined') UIService.toast('Vui lòng chọn ít nhất 1 vai trò!', 'error');
        else alert('Vui lòng chọn ít nhất 1 vai trò!');
        return;
    }

    // role = role ưu tiên cao nhất (backward compat cho các logic cũ còn dùng .role)
    const ROLE_PRIORITY = ['admin','senior_assistant','assistant','teaching_assistant','receptionist','receptionist_assistant','staff'];
    const primaryRole = ROLE_PRIORITY.find(r => checkedRoles.includes(r)) || checkedRoles[0];

    const scheduleColor = document.getElementById('staff-color').value;

    // Legacy salary fields removed
    const salary_config = {};

    let userPayload = {
        username,
        password,
        name,
        salary_config,
        role: primaryRole,
        roles: checkedRoles,
        scheduleColor
    };

    const isNew = !isEditing || !id;

    if (isNew) {
        // Create
        userPayload.id = 'nv_' + Date.now();
        userPayload.createdAt = new Date().toISOString();
    } else {
        // Update
        userPayload.id = id;
    }

    // AUTH SYNC LOGIC
    const btn = document.querySelector('#staff-modal .btn-primary');
    const oldText = btn.innerText;
    btn.innerText = "Đang xử lý Auth...";
    btn.disabled = true;

    try {
        if (typeof AuthHelper === 'undefined') {
            throw new Error("Lỗi hệ thống: AuthHelper chưa được tải.");
        }

        if (isNew) {
            // 1. Create in Firebase Auth
            await AuthHelper.createUser(username, password);
        } else {
            // 2. Update/Sync in Firebase Auth
            // We need the OLD password to login and change to NEW password.
            // Fetch current DB data to get old password
            const users = await DBService.getUsers();
            const oldUser = users.find(u => u.id === id);

            if (oldUser) {
                // Try to sync/update password
                await AuthHelper.syncUser(username, oldUser.password, password);
            }
        }

        // 3. Save to Firestore
        await DBService.saveUser(userPayload);

        // 4. Invalidate users cache so salary page picks up new employees
        localStorage.removeItem('users_data');

        UIService.toast("Lưu thành công (Đã đồng bộ Tài khoản)!", "success");
        closeModal();
        renderStaffTable();
    } catch (err) {
        console.error(err);
        let msg = err.message;

        // HANDLE ZOMBIE ACCOUNT (Deleted from DB but exists in Auth)
        if (err.code === 'auth/email-already-in-use') {
            // Check if user REALLY exists in Firestore
            const users = await DBService.getUsers();
            const existingUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());

            if (existingUser) {
                msg = "Tên đăng nhập này đã tồn tại trong danh sách nhân viên!";
            } else {
                // Not in DB -> It's a "Zombie" Account (Orphaned).
                // We must "Reclaim" it by verifying we can log in with valid credentials.
                // Strategy: Try to Sync (Login) with current password (or default).
                const btn = document.querySelector('#staff-modal .btn-primary');
                btn.innerText = "Đang khôi phục tài khoản cũ...";

                try {
                    // Try to Login (Reclaim)
                    await AuthHelper.syncUser(username, password, password);

                    // If success, user is reclaimed. Proceed to save to Firestore.
                    await DBService.saveUser(userPayload);
                    localStorage.removeItem('users_data'); // Invalidate cache

                    UIService.toast("Đã khôi phục tài khoản cũ thành công!", "success");
                    closeModal();
                    renderStaffTable();
                    return; // Done
                } catch (reclaimErr) {
                    console.error("Reclaim failed:", reclaimErr);
                    msg = "Tên đăng nhập này đã tồn tại (Zombie) và mật khẩu không khớp. Vui lòng chọn tên khác.";
                }
            }
        } else if (msg.includes("Mật khẩu hiện tại")) {
            msg = "Chưa thể cập nhật mật khẩu vì sai pass cũ. Hãy thử tạo mới lại user này.";
        }

        UIService.toast("Lỗi: " + msg, "error");
    } finally {
        const btn = document.querySelector('#staff-modal .btn-primary');
        if (btn) {
            btn.innerText = oldText;
            btn.disabled = false;
        }
    }
}

async function deleteStaff(id) {
    if (!await UIService.confirm('Bạn có chắc muốn xóa nhân viên này? Dữ liệu lịch sử vẫn còn, nhưng tài khoản sẽ bị vô hiệu hóa.')) return;

    try {
        // Attempt to delete from Auth as well (Cleaner)
        // We need to fetch the user first to get their username and current password
        const users = await DBService.getUsers();
        const user = users.find(u => u.id === id);

        if (user && user.username && user.password) {
            // Best effort delete from Auth
            try {
                if (typeof AuthHelper !== 'undefined') {
                    await AuthHelper.deleteUser(user.username, user.password);
                }
            } catch (authDelErr) {
                console.warn("Could not auto-delete auth user (expected if password changed)", authDelErr);
            }
        }

        await DBService.deleteUser(id);
        localStorage.removeItem('users_data'); // Invalidate cache
        UIService.toast("Đã xóa nhân viên", "success");
        renderStaffTable();
    } catch (err) {
        UIService.toast("Lỗi xóa: " + err.message, "error");
    }
}

function formatCurrency(val) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);
}

// Close modal when clicking outside
// Close modal when clicking outside
window.onclick = function (event) {
    const modal = document.getElementById('staff-modal');
    const salaryModal = document.getElementById('salary-modal');
    if (event.target == modal) closeModal();
    if (event.target == salaryModal) closeSalaryModal();
}

// ================= SALARY CONFIGURATION (MULTI-ROLE) =================

let currentSalaryRoles = []; // Temporary storage while editing

async function configureSalary(userId) {
    const users = await DBService.getUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return;

    document.getElementById('salary-user-id').value = userId;
    document.getElementById('salary-modal-subtitle').innerText = `Cấu hình cho nhân viên: ${user.name || user.username}`;

    // Load existing roles or init empty
    const settings = user.salary_config || {};
    currentSalaryRoles = settings.roles || [];

    const userRolesArr = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : (user.role ? [user.role] : []);
    const hasReceptionistRole = userRolesArr.some(r => ['receptionist', 'receptionist_assistant'].includes(r));
    const hasTeachingRole = userRolesArr.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
    // Pure receptionist: chỉ có role tiếp tân, KHÔNG có role dạy học
    const isPureReceptionist = hasReceptionistRole && !hasTeachingRole;

    const rolesSection = document.getElementById('roles-config-section');
    const recSection = document.getElementById('receptionist-config-section');

    // Hiển thị phần dạy học nếu có role dạy hoặc là đa vai trò
    if (!isPureReceptionist) {
        if (rolesSection) rolesSection.style.display = 'block';
        // Load subjects into the select dropdown
        try {
            const subjects = await DBService.getSubjects();
            const sel = document.getElementById('new-subject-select');
            if (sel) {
                sel.innerHTML = '<option value="">-- Chọn Môn --</option>' +
                    subjects.map(s => `<option value="${s.id}" data-name="${s.name.replace(/"/g,'&quot;')}">${s.name}</option>`).join('');
            }
        } catch(e) { console.warn('Could not load subjects for salary modal', e); }

        // Populate general attendance rate
        const generalAttRate = document.getElementById('general-attendance-rate');
        if (generalAttRate) generalAttRate.value = settings.attendance_rate || '';

        // Fallback: If no roles but has legacy "rate", create a default Service Role
        if (currentSalaryRoles.length === 0 && settings.rate) {
            currentSalaryRoles.push({
                id: 'default',
                name: 'Mặc định (Cũ)',
                rate: settings.rate,
                isDefault: true
            });
        }
    } else {
        if (rolesSection) rolesSection.style.display = 'none';
    }

    // Hiển thị phần tiếp tân nếu có role tiếp tân (kể cả đa vai trò)
    if (hasReceptionistRole) {
        if (recSection) recSection.style.display = 'block';
        document.getElementById('receptionist-normal-rate').value = settings.receptionist_normal_rate || '';
        document.getElementById('receptionist-fixed-rate').value = settings.receptionist_fixed_rate || '';
        document.getElementById('attendance-rate').value = settings.attendance_rate || '';
    } else {
        if (recSection) recSection.style.display = 'none';
    }

    renderSalaryRoles();
    document.getElementById('salary-modal').style.display = 'flex';

    // Hide add/save for senior_assistant (view-only mode)
    const currentRole = localStorage.getItem('currentRole');
    if (currentRole === 'senior_assistant') {
        const addRoleForm = document.getElementById('new-role-name')?.closest('div[style*="background"]');
        if (addRoleForm) addRoleForm.style.display = 'none';
        // Hide save button, keep close button
        const saveBtn = document.querySelector('#salary-modal .btn-primary');
        if (saveBtn) saveBtn.style.display = 'none';
    }
}

function closeSalaryModal() {
    document.getElementById('salary-modal').style.display = 'none';
}

function renderSalaryRoles() {
    const container = document.getElementById('role-list');
    if (currentSalaryRoles.length === 0) {
        container.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Chưa có vai trò nào. Hãy thêm mới!</div>';
        return;
    }

    const currentRole = localStorage.getItem('currentRole');
    const isSalaryHidden = (currentRole === 'senior_assistant');

    let html = '';
    currentSalaryRoles.forEach((role, index) => {
        const rateDisplay = isSalaryHidden ? '*** / giờ' : formatCurrency(role.rate) + ' / giờ';
        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid #eee; background: white;">
                <div>
                    <div style="font-weight: 600;">${role.name}</div>
                    <div style="font-size: 0.85rem; color: ${isSalaryHidden ? 'var(--text-muted)' : 'var(--primary-color)'};">${rateDisplay}</div>
                </div>
                ${isSalaryHidden ? '' : `<button onclick="removeRole(${index})" style="color: #EF4444; background: none; border: none; cursor: pointer; padding: 4px;">
                    🗑️ Xóa
                </button>`}
            </div>
        `;
    });
    container.innerHTML = html;
}

function addNewRole() {
    const subjectSelect = document.getElementById('new-subject-select');
    const rateInput = document.getElementById('new-role-rate');

    const rate = Number(rateInput.value);
    if (!subjectSelect || !subjectSelect.value || !rate) {
        alert("Vui lòng chọn môn học và nhập mức lương!");
        return;
    }

    const selectedOption = subjectSelect.options[subjectSelect.selectedIndex];
    const subjectId = subjectSelect.value;
    const subjectName = selectedOption.dataset.name || selectedOption.text;

    if (currentSalaryRoles.find(r => r.id === subjectId)) {
        alert("Môn học này đã được thêm rồi!");
        return;
    }

    currentSalaryRoles.push({
        id: subjectId,
        name: subjectName,
        rate: rate,
        isDefault: currentSalaryRoles.length === 0
    });

    subjectSelect.value = '';
    rateInput.value = '';

    renderSalaryRoles();
}

function removeRole(index) {
    if (confirm("Chắc chắn xóa vai trò này?")) {
        currentSalaryRoles.splice(index, 1);
        renderSalaryRoles();
    }
}

async function saveSalaryConfig() {
    const userId = document.getElementById('salary-user-id').value;

    try {
        const users = await DBService.getUsers();
        const user = users.find(u => u.id === userId);
        if (!user) throw new Error("User Not Found");

        // Merge changes
        if (!user.salary_config) user.salary_config = {};
        
        const _saveRoles = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : (user.role ? [user.role] : []);
        const _hasReceptionistRole = _saveRoles.some(r => ['receptionist', 'receptionist_assistant'].includes(r));
        const _hasTeachingRole = _saveRoles.some(r => ['admin', 'senior_assistant', 'assistant', 'teaching_assistant', 'staff'].includes(r));
        const _isPureReceptionist = _hasReceptionistRole && !_hasTeachingRole;

        // Lưu cấu hình tiếp tân nếu có role tiếp tân
        if (_hasReceptionistRole) {
            const normalRate = document.getElementById('receptionist-normal-rate').value;
            const fixedRate = document.getElementById('receptionist-fixed-rate').value;
            const attRate = document.getElementById('attendance-rate').value;
            user.salary_config.receptionist_normal_rate = normalRate ? Number(normalRate) : 0;
            user.salary_config.receptionist_fixed_rate = fixedRate ? Number(fixedRate) : 0;
            user.salary_config.attendance_rate = attRate ? Number(attRate) : 0;
        }

        // Lưu cấu hình dạy học nếu có role dạy học
        if (!_isPureReceptionist) {
            user.salary_config.roles = currentSalaryRoles;
            if (!_hasReceptionistRole) {
                // Chỉ lấy attendance rate từ general nếu không phải tiếp tân
                const generalAttRate = document.getElementById('general-attendance-rate').value;
                user.salary_config.attendance_rate = generalAttRate ? Number(generalAttRate) : 0;
            }
        }

        await DBService.saveUser(user);

        UIService.toast("Đã lưu cấu hình lương!", "success");
        closeSalaryModal();
        renderStaffTable(); // Refresh table UI
    } catch (e) {
        alert("Lỗi lưu: " + e.message);
    }
}
