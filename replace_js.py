import re

file_path = 'c:\\Users\\Admin\\OneDrive\\Documents\\TimekeepingSystem\\js\\report.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Helper to inject role population logic right before updating the mode title in both functions
role_populate_logic = """

    // --- POPULATE ROLE DROPDOWN ---
    const editRoleEl = document.getElementById('edit-role');
    if (editRoleEl) {
        editRoleEl.innerHTML = '<option value="">-- Chưa chọn (Tính theo mặc định) --</option>';
        if (window.currentUserContext && window.currentUserContext.salary_config && window.currentUserContext.salary_config.roles) {
            window.currentUserContext.salary_config.roles.forEach(role => {
                const opt = document.createElement('option');
                opt.value = role.id;
                opt.textContent = `${role.name} (${role.rate.toLocaleString('vi-VN')}₫/h)`;
                // Pre-select if we have existing sessionData with a role
                if (typeof sessionData !== 'undefined' && sessionData && sessionData.role === role.id) {
                    opt.selected = true;
                }
                editRoleEl.appendChild(opt);
            });
        }
    }
    // ------------------------------

    // Update Mode Title"""

# 1. Replace in openManualModal
pattern_manual = r'(// Update Mode Title\s*document\.querySelector\(\'#edit-time-modal h2\'\)\.innerText = "Thêm Ca Làm Việc Mới";)'
content = re.sub(pattern_manual, role_populate_logic.lstrip('\n') + r'\n    document.querySelector(\'#edit-time-modal h2\').innerText = "Thêm Ca Làm Việc Mới";', content, count=1)

# 2. Replace in openEditModal
pattern_edit = r'(// Update Mode Title\s*document\.querySelector\(\'#edit-time-modal h2\'\)\.innerText = "Chỉnh Sửa Giờ Làm";)'
content = re.sub(pattern_edit, role_populate_logic.lstrip('\n') + r'\n    document.querySelector(\'#edit-time-modal h2\').innerText = "Chỉnh Sửa Giờ Làm";', content, count=1)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Replacement logic for role dropdown done.")
