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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Đang tải dữ liệu...</td></tr>';

    // FETCH FROM CLOUD
    const users = await DBService.getUsers();
    // For salary settings, we might keep storing in user object or separate.
    // In migration tool, we migrated salary_config INTO the user object.
    // So we should read from user.salary_config

    let html = '';

    users.forEach(user => {
        // Admin users are now shown so they can configure their own salary roles

        // Get salary info from user object or default
        const settings = user.salary_config || { rate: 0, attendance: 0 };

        html += `
            <tr>
                <td>
                    <div style="font-weight: 600; color: var(--text-color);">${user.name || user.username}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">
                        ${user.role === 'admin' ? 'Quản trị viên' : user.role === 'senior_assistant' ? 'Trợ Lý Cấp Cao' : user.role === 'assistant' ? 'Trợ Lý' : user.role === 'receptionist' ? 'Tiếp Tân' : user.role === 'receptionist_assistant' ? 'Trợ Lí Tiếp Tân' : 'Trợ Giảng'}
                    </div>
                </td>
                <td><span style="font-family: monospace; background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${user.username}</span></td>
                <td>${user.password}</td>
                <td style="text-align: right;">
                    <button class="action-btn" onclick="configureSalary('${user.id}')" title="Cấu hình Lương & Role" style="color: #F59E0B; margin-right: 4px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
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
        html = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Chưa có nhân viên nào.</td></tr>';
    }

    tbody.innerHTML = html;
}

function openModal() {
    isEditing = false;
    document.getElementById('staff-form').reset();
    document.getElementById('staff-id').value = '';
    document.getElementById('staff-role').value = 'staff'; // Default
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
    document.getElementById('staff-role').value = user.role || 'staff';
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

    const role = document.getElementById('staff-role').value;
    const scheduleColor = document.getElementById('staff-color').value;

    // Legacy salary fields removed
    const salary_config = {};

    let userPayload = {
        username,
        password,
        name,
        salary_config,
        role,
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

    const isReceptionistType = ['receptionist', 'receptionist_assistant'].includes(user.role);
    const rolesSection = document.getElementById('roles-config-section');
    const recSection = document.getElementById('receptionist-config-section');

    if (isReceptionistType) {
        if (rolesSection) rolesSection.style.display = 'none';
        if (recSection) recSection.style.display = 'block';
        
        document.getElementById('receptionist-normal-rate').value = settings.receptionist_normal_rate || '';
        document.getElementById('receptionist-fixed-rate').value = settings.receptionist_fixed_rate || '';
    } else {
        if (rolesSection) rolesSection.style.display = 'block';
        if (recSection) recSection.style.display = 'none';
        
        // Fallback: If no roles but has legacy "rate", create a default Service Role
        if (currentSalaryRoles.length === 0 && settings.rate) {
            currentSalaryRoles.push({
                id: 'default',
                name: 'Mặc định (Cũ)',
                rate: settings.rate,
                isDefault: true
            });
        }
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
    const nameInput = document.getElementById('new-role-name');
    const rateInput = document.getElementById('new-role-rate');

    const name = nameInput.value.trim();
    const rate = Number(rateInput.value);

    if (!name || !rate) {
        alert("Vui lòng nhập tên vai trò và mức lương!");
        return;
    }

    currentSalaryRoles.push({
        id: 'role_' + Date.now(),
        name: name,
        rate: rate,
        isDefault: currentSalaryRoles.length === 0 // First role is default
    });

    // Reset inputs
    nameInput.value = '';
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
        
        const isReceptionistType = ['receptionist', 'receptionist_assistant'].includes(user.role);
        if (isReceptionistType) {
            const normalRate = document.getElementById('receptionist-normal-rate').value;
            const fixedRate = document.getElementById('receptionist-fixed-rate').value;
            user.salary_config.receptionist_normal_rate = normalRate ? Number(normalRate) : 0;
            user.salary_config.receptionist_fixed_rate = fixedRate ? Number(fixedRate) : 0;
        } else {
            user.salary_config.roles = currentSalaryRoles;
        }

        await DBService.saveUser(user);

        UIService.toast("Đã lưu cấu hình lương!", "success");
        closeSalaryModal();
        renderStaffTable(); // Refresh table UI
    } catch (e) {
        alert("Lỗi lưu: " + e.message);
    }
}
