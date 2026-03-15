import re

with open('c:\\Users\\Admin\\OneDrive\\Documents\\TimekeepingSystem\\bao-cao.html', 'r', encoding='utf-8') as f:
    content = f.read()

pattern = r'(<input type="hidden" id="edit-class-is-receptionist">\s*<div style="margin-bottom: 1rem;">\s*<label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Giờ Vào \(Check-in\)</label>)'

replacement = """<input type="hidden" id="edit-class-is-receptionist">
        <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Vai trò / Tính lương</label>
            <select id="edit-role" class="table-input" style="width: 100%; height: 40px; border: 1px solid var(--border-color); border-radius: 4px; padding: 0 0.5rem;">
                <option value="">-- Chưa chọn --</option>
            </select>
            <small style="color: var(--text-muted); font-size: 0.75rem;">(Chỉ hiển thị các vai trò của nhân sự này)</small>
        </div>
        <div style="margin-bottom: 1rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Giờ Vào (Check-in)</label>"""

new_content = re.sub(pattern, replacement, content)

with open('c:\\Users\\Admin\\OneDrive\\Documents\\TimekeepingSystem\\bao-cao.html', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Replacement done.")
