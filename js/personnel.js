// Personnel Management Logic

document.addEventListener('DOMContentLoaded', () => {
    renderStaffTable();
});

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
        if (user.role === 'admin' && user.username === 'admin') return; // Hide super admin

        // Get salary info from user object or default
        const settings = user.salary_config || { rate: 0, attendance: 0 };

        html += `
            <tr>
                <td>
                    <div style="font-weight: 600; color: var(--text-color);">${user.name || user.username}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${user.role === 'admin' ? 'Quản trị viên' : 'Nhân viên'}</div>
                </td>
                <td><span style="font-family: monospace; background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${user.username}</span></td>
                <td>${user.password}</td>
                <td>${formatCurrency(settings.rate || 0)} / giờ</td>
                <td>${formatCurrency(settings.attendance || 0)}</td>
                <td style="text-align: right;">
                    <button class="action-btn" onclick="editStaff('${user.id}')" title="Sửa">
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
    document.getElementById('modal-title').innerText = 'Thêm Nhân Viên';

    // Default values
    document.getElementById('staff-rate').value = 100000;
    document.getElementById('staff-bonus').value = 500000;

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

    // Load Salary Data
    const settings = user.salary_config || { rate: 100000, attendance: 500000 };

    document.getElementById('staff-rate').value = settings.rate || 0;
    document.getElementById('staff-bonus').value = settings.attendance || 0;

    document.getElementById('modal-title').innerText = 'Chỉnh Sửa Nhân Viên';
    document.getElementById('staff-modal').style.display = 'flex';
}

async function handleStaffSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('staff-id').value;
    const name = document.getElementById('staff-name').value;
    const username = document.getElementById('staff-username').value.trim();
    const password = document.getElementById('staff-password').value.trim();
    const rate = document.getElementById('staff-rate').value;
    const attendance = document.getElementById('staff-bonus').value;

    const salary_config = {
        rate: Number(rate),
        attendance: Number(attendance)
    };

    let userPayload = {
        username,
        password,
        name,
        salary_config,
        role: 'staff' // Default role
    };

    if (isEditing && id) {
        // Update
        userPayload.id = id;
    } else {
        // Create
        userPayload.id = 'nv_' + Date.now();
        userPayload.createdAt = new Date().toISOString();
    }

    try {
        await DBService.saveUser(userPayload);
        UIService.toast("Lưu thành công!", "success");
        closeModal();
        renderStaffTable();
    } catch (err) {
        UIService.toast("Lỗi lưu dữ liệu: " + err.message, "error");
    }
}

async function deleteStaff(id) {
    if (!await UIService.confirm('Bạn có chắc muốn xóa nhân viên này? Dữ liệu lịch sử vẫn còn, nhưng tài khoản sẽ bị vô hiệu hóa.')) return;

    try {
        await DBService.deleteUser(id);
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
window.onclick = function (event) {
    const modal = document.getElementById('staff-modal');
    if (event.target == modal) {
        closeModal();
    }
}
