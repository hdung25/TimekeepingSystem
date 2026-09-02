// ================= TRANG NHÂN SỰ =================
// Quản lý tài khoản, vai trò, chế độ giáo viên (cũ / mới) và cấu hình lương.
//
// teachingMode: 'old' | 'new' | không có (chưa phân loại).
// Chỉ chế độ 'new' bị loại khỏi thưởng sớm 10 phút. 'old' và trường hợp đặc
// biệt chưa phân loại vẫn được xét đủ môn + giờ vào + yêu cầu — xem js/early10.js.
// Người chưa phân loại vẫn là nhánh đặc biệt đủ điều kiện; giao diện hiển thị
// riêng để Admin biết hồ sơ nào chưa được chốt sang chế độ cũ/mới.
(function () {
    'use strict';

    var ROLE_LABELS = {
        admin: 'Quản trị viên',
        senior_assistant: 'Trợ lý cấp cao',
        assistant: 'Trợ lý',
        teaching_assistant: 'Trợ giảng / GV TA',
        receptionist: 'Tiếp tân',
        receptionist_assistant: 'Trợ lý tiếp tân',
        office_staff: 'Nhân viên văn phòng',
        staff: 'Nhân viên'
    };
    var ROLE_PRIORITY = ['admin', 'senior_assistant', 'assistant', 'teaching_assistant',
        'receptionist', 'receptionist_assistant', 'office_staff', 'staff'];
    // Văn phòng dùng cùng nhóm cấu hình đơn giá ca thường/cố định với tiếp tân.
    var RECEP_ROLES = ['receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff', 'senior_assistant', 'office_staff'];
    var TEACH_ROLES = ['admin', 'assistant', 'teaching_assistant', 'staff'];
    var AVATAR_COLORS = ['#059669', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#14B8A6', '#EF4444', '#6366F1'];

    var state = {
        users: [],
        search: '',
        filter: 'all',
        editing: false,
        mode: '',
        revealed: {},
        salaryRates: [],
        subjects: [],
        groupRates: [],
        subjectRatePolicy: { mode: 'legacy', effectiveFrom: '', groupRates: [] },
        payrollProfile: null,
        payrollProfileExists: false,
        // id nhân viên đang tick — dùng cho thao tác hàng loạt (xếp diện tin tưởng…)
        selected: {}
    };

    // DIỆN TIN TƯỞNG: nhân viên được xếp diện này thì tường trình "khớp lịch" của họ nằm
    // trong nhóm duyệt nhanh hàng loạt. Người chưa xếp diện vẫn phải để Quản trị viên /
    // Trợ lý cấp cao xem và bấm duyệt từng mục.
    function isTrusted(user) { return !!user && user.trustLevel === 'trusted'; }

    // --- Tiện ích ---------------------------------------------------------

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function stripTones(value) {
        return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D');
    }

    function rolesOf(user) {
        if (Array.isArray(user.roles) && user.roles.length > 0) return user.roles;
        return user.role ? [user.role] : ['staff'];
    }

    function modeOf(user) {
        if (typeof Early10 !== 'undefined') return Early10.getTeachingMode(user);
        return user && (user.teachingMode === 'old' || user.teachingMode === 'new') ? user.teachingMode : 'unset';
    }

    function hasRecepRole(user) { return rolesOf(user).some(function (r) { return RECEP_ROLES.indexOf(r) !== -1; }); }
    function hasTeachRole(user) { return rolesOf(user).some(function (r) { return TEACH_ROLES.indexOf(r) !== -1; }); }

    function initials(name) {
        var parts = String(name || '?').trim().split(/\s+/);
        if (parts.length === 1) return parts[0].substr(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function avatarColor(user) {
        var key = String(user.id || user.username || '');
        var sum = 0;
        for (var i = 0; i < key.length; i++) sum += key.charCodeAt(i);
        return AVATAR_COLORS[sum % AVATAR_COLORS.length];
    }

    function formatCurrency(value) {
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value || 0);
    }

    function normalizePayrollProfile(profile) {
        if (typeof PayrollAutomation !== 'undefined' && PayrollAutomation.normalizeProfile) {
            return PayrollAutomation.normalizeProfile(profile);
        }
        var raw = profile || {};
        return {
            automationMode: raw.automationMode === 'shadow' ? 'shadow' : 'legacy',
            historicalMinutesBeforeApp: Math.max(0, Number(raw.historicalMinutesBeforeApp) || 0),
            historicalEvidenceNote: String(raw.historicalEvidenceNote || '').trim(),
            historicalEnteredAt: raw.historicalEnteredAt || null,
            historicalEnteredBy: raw.historicalEnteredBy || null,
            policyVersion: raw.policyVersion || 'legacy-v1',
            allowAutomaticDraft: false
        };
    }

    function renderPayrollProfile() {
        var profile = normalizePayrollProfile(state.payrollProfile);
        var totalMinutes = Number(profile.historicalMinutesBeforeApp || 0);
        var hours = Math.floor(totalMinutes / 60);
        var minutes = totalMinutes % 60;
        var isReadOnly = localStorage.getItem('currentRole') === 'senior_assistant';
        var fields = [
            document.getElementById('ns-payroll-shadow'),
            document.getElementById('ns-legacy-hours'),
            document.getElementById('ns-legacy-minutes'),
            document.getElementById('ns-legacy-note')
        ];

        document.getElementById('ns-payroll-shadow').checked = profile.automationMode === 'shadow';
        document.getElementById('ns-legacy-hours').value = hours || '';
        document.getElementById('ns-legacy-minutes').value = minutes || '';
        document.getElementById('ns-legacy-note').value = profile.historicalEvidenceNote || '';
        fields.forEach(function (field) { if (field) field.disabled = isReadOnly; });

        var saveProfileBtn = document.getElementById('ns-payroll-profile-save');
        if (saveProfileBtn) saveProfileBtn.style.display = isReadOnly ? 'none' : '';
    }

    // sortUsers gắn thêm _msnv/_msnvStr chỉ để hiển thị — không được ghi xuống Firestore.
    function cleanUser(user) {
        var copy = {};
        Object.keys(user || {}).forEach(function (key) {
            // Operational profile actions must never carry the compatibility
            // password back into DBService. The account sheet passes its
            // explicit password payload directly when a primary Admin edits it.
            if (key.charAt(0) !== '_' && key !== 'password') copy[key] = user[key];
        });
        return copy;
    }

    async function loadUsersWithCredentials() {
        var results = await Promise.all([
            DBService.getUsers(),
            DBService.getUserCredentialsMap()
        ]);
        var credentials = results[1] || {};
        return sortUsers((results[0] || []).map(function (user) {
            var credential = credentials[user.id] || {};
            return Object.assign({}, user, { password: credential.password || '' });
        }));
    }

    // --- Lọc & sắp xếp ----------------------------------------------------

    function sortUsers(users) {
        users.forEach(function (u) {
            var match = String(u.username || '').match(/\d+$/);
            u._msnvStr = match ? match[0] : '';
            u._msnv = match ? parseInt(match[0], 10) : null;
        });
        return users.sort(function (a, b) {
            if (a._msnv !== null && b._msnv !== null) return a._msnv - b._msnv;
            if (a._msnv !== null) return -1;
            if (b._msnv !== null) return 1;
            return String(a.username || '').localeCompare(String(b.username || ''));
        });
    }

    function passesFilter(user) {
        var f = state.filter;
        if (f === 'all') return true;
        if (f === 'old' || f === 'new' || f === 'unset') return modeOf(user) === f;
        if (f === 'teaching') return hasTeachRole(user);
        if (f === 'recep') return hasRecepRole(user);
        if (f === 'trusted') return isTrusted(user);
        if (f === 'untrusted') return !isTrusted(user);
        return true;
    }

    function matchesSearch(user) {
        if (!state.search) return true;
        var needle = stripTones(state.search).toLowerCase();
        var hay = stripTones([user.name, user.username, user._msnvStr].join(' ')).toLowerCase();
        return hay.indexOf(needle) !== -1;
    }

    // --- Render -----------------------------------------------------------

    function renderStats() {
        var counts = { total: state.users.length, old: 0, new: 0, unset: 0 };
        state.users.forEach(function (u) { counts[modeOf(u)]++; });
        var set = function (id, value) {
            var el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        set('ns-stat-total', counts.total);
        set('ns-stat-old', counts.old);
        set('ns-stat-new', counts.new);
        set('ns-stat-unset', counts.unset);
    }

    function roleBadges(user) {
        return rolesOf(user).map(function (role) {
            var cls = 'ns-role';
            if (role === 'admin' || role === 'senior_assistant') cls += ' admin';
            else if (RECEP_ROLES.indexOf(role) !== -1) cls += ' recep';
            else cls += ' teach';
            return '<span class="' + cls + '">' + esc(ROLE_LABELS[role] || role) + '</span>';
        }).join('');
    }

    function modeSelector(user) {
        var mode = modeOf(user);
        var button = function (value, label) {
            var active = (value === '' ? mode === 'unset' : mode === value) ? ' active' : '';
            return '<button type="button" data-mode="' + value + '" class="' + active.trim() + '"' +
                ' onclick="NhanSu.quickSetMode(\'' + esc(user.id) + '\', \'' + value + '\')">' + label + '</button>';
        };
        return '<div class="ns-mode">' +
            button('old', 'Chế độ cũ') + button('new', 'Chế độ mới') + button('', 'Chưa rõ') +
            '</div>';
    }

    function secretRow(user) {
        var shown = state.revealed[user.id];
        return '<div class="ns-secret">' +
            '<span>' + esc(user.username) + '</span><span style="color:#D1D5DB;">·</span>' +
            '<span>' + (shown ? esc(user.password) : '••••••') + '</span>' +
            '<button type="button" title="' + (shown ? 'Ẩn mật khẩu' : 'Hiện mật khẩu') + '"' +
                ' onclick="NhanSu.toggleSecret(\'' + esc(user.id) + '\')">' +
                '<i data-lucide="' + (shown ? 'eye-off' : 'eye') + '" style="width:15px;height:15px;"></i>' +
            '</button>' +
        '</div>';
    }

    function renderCard(user) {
        var mode = modeOf(user);
        var hint = mode === 'old'
            ? 'Được hưởng <b>sớm 10 phút</b> ở các môn có bật chính sách.'
            : (mode === 'new'
                ? 'Không áp dụng chính sách sớm 10 phút.'
                : 'Chưa phân loại — vẫn được xét sớm 10 phút nếu đúng môn, vào đủ sớm và tự gửi yêu cầu.');

        var picked = state.selected[String(user.id)] === true;
        var trusted = isTrusted(user);

        return '' +
            '<div class="ns-card' + (picked ? ' selected' : '') + '">' +
                '<div class="ns-card-top">' +
                    '<span class="ns-pick' + (picked ? ' on' : '') + '" role="checkbox" aria-checked="' + picked + '"' +
                        ' title="Chọn để thao tác hàng loạt"' +
                        ' onclick="NhanSu.toggleSelect(\'' + esc(user.id) + '\')">' +
                        '<i data-lucide="check" style="width:13px;height:13px;"></i></span>' +
                    '<span class="ns-avatar" style="background:' + avatarColor(user) + ';">' + esc(initials(user.name || user.username)) + '</span>' +
                    '<span class="ns-card-id">' +
                        '<span class="ns-name">' + esc(user.name || user.username) +
                            (trusted ? '<span class="ns-trust" title="Tường trình khớp lịch của người này được duyệt nhanh hàng loạt">' +
                                '<i data-lucide="shield-check" style="width:12px;height:12px;"></i> Tin tưởng</span>' : '') +
                        '</span>' +
                        '<span class="ns-meta">' + secretRow(user) + '</span>' +
                    '</span>' +
                    '<span class="ns-msnv">' + esc(user._msnvStr || '—') + '</span>' +
                '</div>' +
                '<div class="ns-roles">' + roleBadges(user) + '</div>' +
                modeSelector(user) +
                '<div class="ns-mode-hint">' + hint + '</div>' +
                '<div class="ns-card-actions">' +
                    '<button class="ns-act pay" onclick="NhanSu.openSalarySheet(\'' + esc(user.id) + '\')"><i data-lucide="wallet"></i> Lương</button>' +
                    '<button class="ns-act" onclick="NhanSu.editStaff(\'' + esc(user.id) + '\')"><i data-lucide="pencil"></i> Sửa</button>' +
                    '<button class="ns-act danger" onclick="NhanSu.deleteStaff(\'' + esc(user.id) + '\')"><i data-lucide="trash-2"></i> Xóa</button>' +
                '</div>' +
            '</div>';
    }

    function render() {
        var loading = document.getElementById('ns-loading');
        if (loading) loading.style.display = 'none';
        var list = document.getElementById('ns-list');
        if (!list) return;

        var visible = state.users.filter(function (u) { return passesFilter(u) && matchesSearch(u); });

        var head = document.getElementById('ns-select-head');
        if (head) {
            var allOn = visible.length > 0 && visible.every(function (u) { return state.selected[String(u.id)]; });
            head.innerHTML = visible.length === 0 ? '' :
                '<button class="ns-chip' + (allOn ? ' active' : '') + '" onclick="NhanSu.toggleSelectAll()">' +
                (allOn ? 'Bỏ chọn ' : 'Chọn tất cả ') + visible.length + ' người đang hiện</button>';
        }

        list.innerHTML = visible.length > 0
            ? visible.map(renderCard).join('')
            : '<div class="ns-empty"><h3>Không tìm thấy nhân viên nào</h3>' +
              '<p>Thử đổi từ khóa tìm kiếm hoặc bỏ bộ lọc.</p></div>';

        if (window.lucide) window.lucide.createIcons({ root: list });
        renderStats();
        renderSelectionBar();
    }

    // --- Chọn nhiều & xếp diện tin tưởng ----------------------------------

    function selectedUsers() {
        return state.users.filter(function (u) { return state.selected[String(u.id)] === true; });
    }

    function renderSelectionBar() {
        var bar = document.getElementById('ns-selbar');
        if (!bar) return;
        var picked = selectedUsers();
        var page = document.querySelector('.ns-page');
        if (page) page.classList.toggle('has-selection', picked.length > 0);
        if (picked.length === 0) {
            bar.classList.remove('open');
            bar.innerHTML = '';
            return;
        }
        var allTrusted = picked.every(isTrusted);
        bar.innerHTML = '' +
            '<div class="ns-selbar-box">' +
                '<div class="ns-selbar-count"><strong>' + picked.length + '</strong> người đã chọn</div>' +
                '<div class="ns-selbar-actions">' +
                    (allTrusted ? '' :
                        '<button class="ns-btn ns-btn-primary" onclick="NhanSu.bulkTrust(true)">' +
                        '<i data-lucide="shield-check" style="width:16px;height:16px;"></i> Xếp diện tin tưởng</button>') +
                    '<button class="ns-btn ns-btn-cancel" onclick="NhanSu.bulkTrust(false)">' +
                        '<i data-lucide="shield-off" style="width:16px;height:16px;"></i> Bỏ diện tin tưởng</button>' +
                    '<button class="ns-btn ns-btn-cancel" onclick="NhanSu.clearSelection()">Bỏ chọn</button>' +
                '</div>' +
            '</div>';
        bar.classList.add('open');
        if (window.lucide) window.lucide.createIcons({ root: bar });
    }

    function toggleSelect(userId) {
        var key = String(userId);
        if (state.selected[key]) delete state.selected[key];
        else state.selected[key] = true;
        render();
    }

    function toggleSelectAll() {
        var visible = state.users.filter(function (u) { return passesFilter(u) && matchesSearch(u); });
        if (visible.length === 0) return;
        var allOn = visible.every(function (u) { return state.selected[String(u.id)]; });
        visible.forEach(function (u) {
            if (allOn) delete state.selected[String(u.id)];
            else state.selected[String(u.id)] = true;
        });
        render();
    }

    function clearSelection() {
        state.selected = {};
        render();
    }

    async function bulkTrust(trusted) {
        var picked = selectedUsers();
        if (picked.length === 0) return;
        var changed = picked.filter(function (u) { return isTrusted(u) !== !!trusted; });
        if (changed.length === 0) {
            UIService.toast('Những người đã chọn vốn đã ' + (trusted ? 'thuộc' : 'không thuộc') + ' diện tin tưởng.', 'info');
            return;
        }
        var names = changed.slice(0, 8).map(function (u) { return u.name || u.username; }).join(', ');
        if (changed.length > 8) names += '… (+' + (changed.length - 8) + ' người nữa)';
        if (!await UIService.confirm(
            (trusted ? 'Xếp' : 'Bỏ') + ' diện tin tưởng cho ' + changed.length + ' người?\n\n' + names +
            (trusted
                ? '\n\nTường trình KHỚP LỊCH của họ sẽ nằm trong nhóm duyệt nhanh hàng loạt.'
                : '\n\nTường trình của họ sẽ luôn cần Quản trị viên / Trợ lý cấp cao duyệt từng mục.')
        )) return;

        try {
            UIService.showLoading('Đang lưu...');
            for (var i = 0; i < changed.length; i++) {
                changed[i].trustLevel = trusted ? 'trusted' : '';
                await DBService.saveUser(cleanUser(changed[i]));
            }
            localStorage.removeItem('users_data');
            DBService._invalidate('users_all');
            UIService.hideLoading();
            UIService.toast('Đã cập nhật diện tin tưởng cho ' + changed.length + ' người.', 'success');
            state.selected = {};
            await reload();
        } catch (e) {
            UIService.hideLoading();
            UIService.toast('Lỗi lưu: ' + e.message, 'error');
            await reload();
        }
    }

    async function load() {
        try {
            state.users = await loadUsersWithCredentials();
            render();
        } catch (e) {
            var loading = document.getElementById('ns-loading');
            if (loading) loading.textContent = 'Lỗi tải dữ liệu: ' + e.message;
        }
    }

    async function reload() {
        localStorage.removeItem('users_data');
        DBService._invalidate('users_all');
        state.users = await loadUsersWithCredentials();
        render();
    }

    // --- Chế độ giáo viên -------------------------------------------------

    async function quickSetMode(userId, mode) {
        var user = state.users.find(function (u) { return u.id === userId; });
        if (!user) return;
        var next = mode === '' ? '' : mode;
        if ((user.teachingMode || '') === next) return;

        var previous = user.teachingMode || '';
        user.teachingMode = next;   // cập nhật ngay cho mượt, lỗi thì trả lại
        render();
        try {
            await DBService.saveUser(cleanUser(user));
            localStorage.removeItem('users_data');
            DBService._invalidate('users_all');
            UIService.toast(next === 'old' ? 'Đã đặt "chế độ cũ".'
                : next === 'new' ? 'Đã đặt "chế độ mới".' : 'Đã bỏ phân loại.', 'success');
        } catch (e) {
            user.teachingMode = previous;
            render();
            UIService.toast('Lỗi lưu: ' + e.message, 'error');
        }
    }

    function setMode(mode) {
        state.mode = mode;
        document.querySelectorAll('#ns-mode-seg button').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }

    function toggleSecret(userId) {
        state.revealed[userId] = !state.revealed[userId];
        render();
    }

    // --- Thêm / sửa nhân viên ---------------------------------------------

    function previewColor() {
        var input = document.getElementById('ns-staff-color');
        var preview = document.getElementById('ns-color-prev');
        if (!input || !preview) return;
        var color = input.value;
        preview.style.background = color;
        var r = parseInt(color.substr(1, 2), 16);
        var g = parseInt(color.substr(3, 2), 16);
        var b = parseInt(color.substr(5, 2), 16);
        preview.style.color = (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#000' : '#fff';
    }

    function openStaffSheet(user) {
        state.editing = !!user;
        var form = document.getElementById('ns-staff-form');
        if (form) form.reset();

        document.getElementById('ns-staff-id').value = user ? user.id : '';
        document.getElementById('ns-staff-name').value = user ? (user.name || '') : '';
        document.getElementById('ns-staff-username').value = user ? (user.username || '') : '';
        var passwordInput = document.getElementById('ns-staff-password');
        passwordInput.value = '';
        passwordInput.required = !user;
        passwordInput.placeholder = user ? 'Để trống nếu không đổi' : 'Tối thiểu 6 ký tự';
        document.getElementById('ns-staff-color').value = (user && user.scheduleColor) || '#4CAF50';

        var checkedRoles = user ? rolesOf(user) : ['staff'];
        document.querySelectorAll('#ns-roles input[type="checkbox"]').forEach(function (cb) {
            cb.checked = checkedRoles.indexOf(cb.value) !== -1;
        });

        setMode(user ? (user.teachingMode === 'old' || user.teachingMode === 'new' ? user.teachingMode : '') : '');
        previewColor();

        document.getElementById('ns-staff-title').textContent = user ? 'Sửa nhân viên' : 'Thêm nhân viên';
        document.getElementById('ns-staff-sub').textContent = user
            ? 'Đổi mật khẩu sẽ đồng bộ sang tài khoản đăng nhập'
            : 'Tài khoản sẽ được đồng bộ tự động';
        document.getElementById('ns-staff-sheet').classList.add('open');
    }

    function closeStaffSheet() {
        document.getElementById('ns-staff-sheet').classList.remove('open');
    }

    async function submitStaff(event) {
        event.preventDefault();

        var id = document.getElementById('ns-staff-id').value;
        var name = document.getElementById('ns-staff-name').value.trim();
        var username = document.getElementById('ns-staff-username').value.trim();
        // Passwords are opaque values: spaces may be intentional and must not be trimmed.
        var password = document.getElementById('ns-staff-password').value;

        var checkedRoles = Array.prototype.slice
            .call(document.querySelectorAll('#ns-roles input[type="checkbox"]:checked'))
            .map(function (cb) { return cb.value; });

        if (checkedRoles.length === 0) {
            UIService.toast('Vui lòng chọn ít nhất 1 vai trò!', 'error');
            return;
        }

        var primaryRole = ROLE_PRIORITY.find(function (r) { return checkedRoles.indexOf(r) !== -1; }) || checkedRoles[0];
        var isNew = !state.editing || !id;
        var existing = id ? state.users.find(function (u) { return u.id === id; }) : null;

        if (isNew && password.length < 6) {
            UIService.toast('Mật khẩu mới phải có ít nhất 6 ký tự.', 'error');
            return;
        }
        if (!isNew && password && password.length < 6) {
            UIService.toast('Mật khẩu mới phải có ít nhất 6 ký tự.', 'error');
            return;
        }

        var payload = {
            username: username,
            name: name,
            role: primaryRole,
            roles: checkedRoles,
            teachingMode: state.mode,
            scheduleColor: document.getElementById('ns-staff-color').value,
            // Giữ nguyên cấu hình lương đã có — form này không đụng tới nó.
            salary_config: (existing && existing.salary_config) || {}
        };

        if (password) payload.password = password;
        if (existing && existing.authUid) payload.authUid = existing.authUid;

        if (isNew) {
            payload.id = 'nv_' + Date.now();
            payload.createdAt = new Date().toISOString();
        } else {
            payload.id = id;
        }

        var submitBtn = document.getElementById('ns-staff-submit');
        var oldLabel = submitBtn.innerHTML;
        var completedAuthMutation = null;
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Đang xử lý...';

        try {
            if (typeof AuthHelper === 'undefined') throw new Error('Lỗi hệ thống: AuthHelper chưa được tải.');

            if (isNew) {
                var authUser = await AuthHelper.createUser(username, password);
                payload.authUid = authUser.uid;
                completedAuthMutation = { type: 'create', username: username, password: password };
            } else if (existing) {
                var usernameChanged = String(existing.username || '').toLowerCase() !== username.toLowerCase();
                if (password || usernameChanged) {
                    if (!existing.password) {
                        throw new Error('Không có khóa xác thực cũ để đồng bộ. Vui lòng đặt lại tài khoản bằng công cụ quản trị Firebase.');
                    }
                    var syncedUser = await AuthHelper.syncUser(
                        existing.username,
                        existing.password,
                        password || existing.password,
                        username
                    );
                    if (syncedUser && syncedUser.uid) payload.authUid = syncedUser.uid;
                    completedAuthMutation = {
                        type: 'update',
                        oldUsername: existing.username,
                        oldPassword: existing.password,
                        newUsername: username,
                        newPassword: password || existing.password
                    };
                }
            }

            await DBService.saveUser(payload);
            completedAuthMutation = null;
            localStorage.removeItem('users_data');
            UIService.toast('Đã lưu (tài khoản đã đồng bộ).', 'success');
            closeStaffSheet();
            await reload();
        } catch (err) {
            console.error(err);
            var message = err.message;

            // Firebase Auth and Firestore cannot share one transaction. If the
            // profile write fails after Auth succeeded, compensate immediately.
            if (completedAuthMutation) {
                try {
                    if (completedAuthMutation.type === 'create') {
                        var rollbackDeleted = await AuthHelper.deleteUser(completedAuthMutation.username, completedAuthMutation.password);
                        if (!rollbackDeleted) throw new Error('Không thể xóa tài khoản vừa tạo.');
                    } else {
                        await AuthHelper.syncUser(
                            completedAuthMutation.newUsername,
                            completedAuthMutation.newPassword,
                            completedAuthMutation.oldPassword,
                            completedAuthMutation.oldUsername
                        );
                    }
                } catch (rollbackError) {
                    console.error('Auth compensation failed:', rollbackError);
                    message += ' Tài khoản đăng nhập đã đổi nhưng hồ sơ chưa lưu; cần kiểm tra Firebase Auth.';
                }
            }

            if (err.code === 'auth/email-already-in-use') {
                var users = await DBService.getUsers();
                var clash = users.find(function (u) {
                    return String(u.username || '').toLowerCase() === username.toLowerCase();
                });
                if (clash) {
                    message = 'Tên đăng nhập này đã tồn tại trong danh sách nhân viên!';
                } else {
                    // Tài khoản "mồ côi": còn trong Auth nhưng đã xóa khỏi danh sách.
                    message = 'Tài khoản đăng nhập đã tồn tại nhưng không có hồ sơ. Hãy khôi phục bằng Firebase Console để tránh chiếm nhầm tài khoản.';
                }
            } else if (String(message).indexOf('Mật khẩu hiện tại') !== -1) {
                message = 'Chưa cập nhật được mật khẩu vì sai pass cũ. Hãy thử tạo mới lại user này.';
            }

            UIService.toast('Lỗi: ' + message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = oldLabel;
        }
    }

    function editStaff(userId) {
        var user = state.users.find(function (u) { return u.id === userId; });
        if (user) openStaffSheet(user);
    }

    async function deleteStaff(userId) {
        var user = state.users.find(function (u) { return u.id === userId; });
        if (!user) return;
        if (!await UIService.confirm('Xóa nhân viên "' + (user.name || user.username) +
            '"?\n\nDữ liệu chấm công lịch sử vẫn được giữ, nhưng tài khoản sẽ bị vô hiệu hóa.')) return;

        var deletionRecoverySnapshot = null;
        try {
            UIService.showLoading('Đang xóa...');
            if (user.authUid && !user.username) {
                throw new Error('Hồ sơ thiếu tên đăng nhập; đã dừng xóa để tránh để lại tài khoản đăng nhập mồ côi.');
            }
            if (user.username) {
                if (typeof AuthHelper === 'undefined') {
                    throw new Error('Lỗi hệ thống: AuthHelper chưa được tải; hồ sơ chưa bị xóa.');
                }
                if (!user.password) {
                    throw new Error('Thiếu khóa xác thực; chưa xóa hồ sơ để tránh để lại tài khoản đăng nhập mồ côi.');
                }
            }

            // Firestore is removed transactionally first and kept in an in-memory
            // recovery snapshot. This makes an Auth refusal reversible instead of
            // leaving a visible profile whose login identity has already vanished.
            deletionRecoverySnapshot = await DBService.deleteUser(userId, user.authUid || '');

            if (user.username) {
                var authDeleted = await AuthHelper.deleteUser(user.username, user.password);
                if (!authDeleted) {
                    var authDeleteError = new Error('Không thể vô hiệu hóa tài khoản đăng nhập.');
                    authDeleteError.code = 'staff/auth-delete-failed';
                    throw authDeleteError;
                }
            }
            deletionRecoverySnapshot = null;
            localStorage.removeItem('users_data');
            UIService.hideLoading();
            UIService.toast('Đã xóa nhân viên.', 'success');
            await reload();
        } catch (err) {
            var message = err.message || String(err);
            if (deletionRecoverySnapshot) {
                try {
                    await DBService.restoreDeletedUser(deletionRecoverySnapshot);
                    deletionRecoverySnapshot = null;
                    message += ' Hồ sơ, quyền và khóa xác thực đã được khôi phục; nhân viên chưa bị xóa.';
                } catch (restoreError) {
                    console.error('Firestore deletion compensation failed:', restoreError);
                    localStorage.removeItem('users_data');
                    message += ' Không thể tự khôi phục hồ sơ; cần dừng thao tác và khôi phục từ dữ liệu quản trị ngay.';
                }
            }
            UIService.hideLoading();
            UIService.toast('Lỗi xóa: ' + message, 'error');
        }
    }

    // --- Cấu hình lương ---------------------------------------------------

    function renderGroupRates() {
        var container = document.getElementById('ns-group-rate-list');
        if (!container) return;
        var hidden = localStorage.getItem('currentRole') === 'senior_assistant';
        if (state.groupRates.length === 0) {
            container.innerHTML = '<div style="padding:0.65rem;text-align:center;color:var(--text-muted);font-size:0.82rem;">Chưa có mức nhóm. Môn sẽ tiếp tục dùng cấu hình cũ.</div>';
            return;
        }
        container.innerHTML = state.groupRates.map(function (entry, index) {
            return '<div class="ns-rate-row">' +
                '<span><span class="ns-rate-name">' + esc(entry.path || entry.groupName || entry.groupId) + '</span>' +
                '<span class="ns-rate-val" style="display:block;">' + (hidden ? '*** / giờ' : formatCurrency(entry.rate) + ' / giờ') + '</span></span>' +
                (hidden ? '' : '<button type="button" class="ns-act danger" style="flex:0 0 auto;padding:0.4rem 0.7rem;" onclick="NhanSu.removeGroupRate(' + index + ')">' +
                    '<i data-lucide="trash-2"></i></button>') +
            '</div>';
        }).join('');
        if (window.lucide) window.lucide.createIcons({ root: container });
    }

    function renderGroupPolicyControls() {
        var policy = typeof SubjectRatePolicy !== 'undefined' && SubjectRatePolicy.normalizePolicy
            ? SubjectRatePolicy.normalizePolicy(state.subjectRatePolicy)
            : state.subjectRatePolicy;
        var enabled = document.getElementById('ns-group-policy-enabled');
        var effective = document.getElementById('ns-group-policy-effective');
        var isReadOnly = localStorage.getItem('currentRole') === 'senior_assistant';
        if (enabled) { enabled.checked = policy.mode === 'group'; enabled.disabled = isReadOnly; }
        if (effective) { effective.value = policy.effectiveFrom || ''; effective.disabled = isReadOnly; }
        ['ns-new-group', 'ns-new-group-rate'].forEach(function (id) {
            var field = document.getElementById(id);
            if (field) field.disabled = isReadOnly;
        });
        var addGroupBtn = document.querySelector('[onclick="NhanSu.addGroupRate()"]');
        if (addGroupBtn) addGroupBtn.style.display = isReadOnly ? 'none' : '';
    }

    function fillSalarySubjectSelectors() {
        var api = typeof SubjectRatePolicy !== 'undefined' ? SubjectRatePolicy : null;
        var subjects = state.subjects || [];
        var policyConfig = { roles: state.salaryRates, subjectRatePolicy: state.subjectRatePolicy };
        var groupSelect = document.getElementById('ns-new-group');
        var subjectSelect = document.getElementById('ns-new-subject');
        if (groupSelect && api && api.groupOptions) {
            groupSelect.innerHTML = '<option value="">-- Chọn nhóm môn --</option>' + api.groupOptions(subjects).map(function (group) {
                return '<option value="' + esc(group.id) + '">' + esc(group.path || group.name) + '</option>';
            }).join('');
        }
        if (subjectSelect && api && api.leafOptions) {
            var options = api.leafOptions(policyConfig, subjects, '', 0);
            subjectSelect.innerHTML = '<option value="">-- Chọn môn ngoại lệ --</option>' + options.map(function (subject) {
                return '<option value="' + esc(subject.id) + '" data-name="' + esc(subject.name) + '">' +
                    esc(subject.path || subject.name) + ' · ' + formatCurrency(subject.rate) + '/giờ</option>';
            }).join('');
        }
    }

    function renderRates() {
        var container = document.getElementById('ns-role-list');
        if (!container) return;
        var hidden = localStorage.getItem('currentRole') === 'senior_assistant';

        if (state.salaryRates.length === 0) {
            container.innerHTML = '<div style="padding:0.85rem;text-align:center;color:var(--text-muted);font-size:0.86rem;">Chưa có môn nào. Thêm bên dưới.</div>';
            return;
        }

        container.innerHTML = state.salaryRates.map(function (rate, index) {
            return '<div class="ns-rate-row">' +
                '<span><span class="ns-rate-name">' + esc(rate.name) + '</span>' +
                '<span class="ns-rate-val" style="display:block;">' +
                    (hidden ? '*** / giờ' : formatCurrency(rate.rate) + ' / giờ') + '</span></span>' +
                (hidden ? '' : '<button type="button" class="ns-act danger" style="flex:0 0 auto;padding:0.4rem 0.7rem;"' +
                    ' onclick="NhanSu.removeRate(' + index + ')"><i data-lucide="trash-2"></i></button>') +
            '</div>';
        }).join('');
        if (window.lucide) window.lucide.createIcons({ root: container });
    }

    async function openSalarySheet(userId) {
        var user = state.users.find(function (u) { return u.id === userId; });
        if (!user) return;

        document.getElementById('ns-salary-user-id').value = userId;
        document.getElementById('ns-salary-sub').textContent = user.name || user.username;

        var config = user.salary_config || {};
        state.salaryRates = Array.isArray(config.roles) ? config.roles.slice() : [];
        state.subjects = [];
        state.subjectRatePolicy = typeof SubjectRatePolicy !== 'undefined' && SubjectRatePolicy.normalizePolicy
            ? SubjectRatePolicy.normalizePolicy(config.subjectRatePolicy)
            : { mode: 'legacy', effectiveFrom: '', groupRates: [] };
        state.groupRates = typeof SubjectRatePolicy !== 'undefined' && SubjectRatePolicy.normalizeGroupRates
            ? SubjectRatePolicy.normalizeGroupRates(state.subjectRatePolicy.groupRates, state.subjects)
            : (state.subjectRatePolicy.groupRates || []);

        var isPureRecep = hasRecepRole(user) && !hasTeachRole(user);
        var teachingBlock = document.getElementById('ns-teaching-block');
        var recepBlock = document.getElementById('ns-recep-block');
        var generalBlock = document.getElementById('ns-general-block');

        teachingBlock.style.display = isPureRecep ? 'none' : '';
        generalBlock.style.display = isPureRecep ? 'none' : '';
        recepBlock.style.display = hasRecepRole(user) ? '' : 'none';

        if (!isPureRecep) {
            try {
                var subjects = await DBService.getSubjects();
                state.subjects = subjects;
                state.groupRates = typeof SubjectRatePolicy !== 'undefined' && SubjectRatePolicy.normalizeGroupRates
                    ? SubjectRatePolicy.normalizeGroupRates(state.subjectRatePolicy.groupRates, subjects)
                    : state.subjectRatePolicy.groupRates || [];
                // Nhóm môn chỉ là thư mục — không xếp lương cho thư mục.
                var teachable = subjects.filter(function (s) { return s.isGroup !== true; });
                var groups = {};
                subjects.filter(function (s) { return s.isGroup === true; })
                    .forEach(function (g) { groups[String(g.id)] = g.name; });

                var select = document.getElementById('ns-new-subject');
                select.innerHTML = '<option value="">-- Chọn môn --</option>' + teachable.map(function (s) {
                    var groupName = groups[String(s.parentId || '')];
                    var label = groupName ? groupName + ' › ' + s.name : s.name;
                    return '<option value="' + esc(s.id) + '" data-name="' + esc(s.name) + '">' + esc(label) + '</option>';
                }).join('');
            } catch (e) {
                console.warn('Không tải được danh sách môn học', e);
            }

            document.getElementById('ns-general-att').value = config.attendance_rate || '';

            // Dữ liệu cũ chỉ có "rate" phẳng → dựng thành 1 dòng để không mất cấu hình.
            if (state.salaryRates.length === 0 && config.rate) {
                state.salaryRates.push({ id: 'default', name: 'Mặc định (cũ)', rate: config.rate, isDefault: true });
            }
        }

        fillSalarySubjectSelectors();
        renderGroupPolicyControls();
        renderGroupRates();

        if (hasRecepRole(user)) {
            document.getElementById('ns-recep-normal').value = config.receptionist_normal_rate || '';
            document.getElementById('ns-recep-fixed').value = config.receptionist_fixed_rate || '';
            document.getElementById('ns-recep-att').value = config.attendance_rate || '';
        }

        state.payrollProfile = null;
        state.payrollProfileExists = false;
        try {
            var storedProfile = await DBService.getStaffPayrollProfile(userId);
            state.payrollProfileExists = storedProfile && storedProfile.exists === true;
            state.payrollProfile = normalizePayrollProfile(storedProfile);
        } catch (profileError) {
            console.warn('Không tải được hồ sơ đối soát lương', profileError);
            state.payrollProfile = normalizePayrollProfile();
        }
        renderPayrollProfile();

        renderRates();

        // Trợ lý cấp cao chỉ được xem, không sửa lương.
        var saveBtn = document.getElementById('ns-salary-save');
        if (saveBtn) saveBtn.style.display = localStorage.getItem('currentRole') === 'senior_assistant' ? 'none' : '';

        document.getElementById('ns-salary-sheet').classList.add('open');
        if (window.lucide) window.lucide.createIcons();
    }

    function closeSalarySheet() {
        document.getElementById('ns-salary-sheet').classList.remove('open');
    }

    function addGroupRate() {
        var select = document.getElementById('ns-new-group');
        var rateInput = document.getElementById('ns-new-group-rate');
        var rate = Number(rateInput && rateInput.value);
        if (!select || !select.value || !rate || rate <= 0) {
            UIService.toast('Hãy chọn nhóm môn và nhập mức lương nhóm.', 'error');
            return;
        }
        if (state.groupRates.some(function (entry) { return String(entry.groupId) === String(select.value); })) {
            UIService.toast('Nhóm môn này đã có mức lương.', 'warning');
            return;
        }
        var group = (typeof SubjectRatePolicy !== 'undefined' && SubjectRatePolicy.groupOptions)
            ? SubjectRatePolicy.groupOptions(state.subjects).find(function (item) { return item.id === select.value; })
            : null;
        state.groupRates.push({
            groupId: select.value,
            groupName: group ? group.name : select.options[select.selectedIndex].text,
            path: group ? group.path : select.options[select.selectedIndex].text,
            rate: Math.round(rate)
        });
        select.value = '';
        rateInput.value = '';
        renderGroupRates();
    }

    async function removeGroupRate(index) {
        var entry = state.groupRates[index];
        if (!entry) return;
        if (!await UIService.confirm('Xóa mức lương nhóm "' + (entry.path || entry.groupName) + '"? Môn ngoại lệ vẫn giữ nguyên.')) return;
        state.groupRates.splice(index, 1);
        renderGroupRates();
    }

    function addRate() {
        var select = document.getElementById('ns-new-subject');
        var rateInput = document.getElementById('ns-new-rate');
        var rate = Number(rateInput.value);

        if (!select.value || !rate) {
            UIService.toast('Vui lòng chọn môn học và nhập mức lương!', 'error');
            return;
        }
        if (state.salaryRates.some(function (r) { return r.id === select.value; })) {
            UIService.toast('Môn học này đã được thêm rồi!', 'warning');
            return;
        }

        var option = select.options[select.selectedIndex];
        state.salaryRates.push({
            id: select.value,
            name: option.dataset.name || option.text,
            rate: rate,
            isDefault: state.salaryRates.length === 0
        });
        select.value = '';
        rateInput.value = '';
        renderRates();
    }

    async function removeRate(index) {
        if (!await UIService.confirm('Xóa mức lương của môn "' + (state.salaryRates[index] || {}).name + '"?')) return;
        state.salaryRates.splice(index, 1);
        renderRates();
    }

    async function saveSalary() {
        var userId = document.getElementById('ns-salary-user-id').value;
        try {
            var user = state.users.find(function (u) { return u.id === userId; });
            if (!user) throw new Error('Không tìm thấy nhân viên.');

            if (!user.salary_config) user.salary_config = {};
            var isPureRecep = hasRecepRole(user) && !hasTeachRole(user);

            if (hasRecepRole(user)) {
                user.salary_config.receptionist_normal_rate = Number(document.getElementById('ns-recep-normal').value) || 0;
                user.salary_config.receptionist_fixed_rate = Number(document.getElementById('ns-recep-fixed').value) || 0;
                user.salary_config.attendance_rate = Number(document.getElementById('ns-recep-att').value) || 0;
            }
            if (!isPureRecep) {
                user.salary_config.roles = state.salaryRates;
                var groupEnabled = !!(document.getElementById('ns-group-policy-enabled') && document.getElementById('ns-group-policy-enabled').checked);
                var groupEffectiveFrom = document.getElementById('ns-group-policy-effective')
                    ? document.getElementById('ns-group-policy-effective').value
                    : '';
                if (groupEnabled && state.groupRates.length === 0) {
                    UIService.toast('Hãy nhập ít nhất một mức nhóm trước khi bật chính sách nhóm môn.', 'warning');
                    return;
                }
                if (groupEnabled && !/^\d{4}-\d{2}-\d{2}$/.test(groupEffectiveFrom)) {
                    UIService.toast('Hãy chọn ngày bắt đầu áp dụng giá nhóm môn.', 'warning');
                    return;
                }
                user.salary_config.subjectRatePolicy = {
                    schemaVersion: 1,
                    mode: groupEnabled ? 'group' : 'legacy',
                    effectiveFrom: groupEffectiveFrom || '',
                    groupRates: state.groupRates.map(function (entry) {
                        return {
                            groupId: String(entry.groupId),
                            groupName: entry.groupName || '',
                            path: entry.path || '',
                            rate: Math.round(Number(entry.rate) || 0)
                        };
                    }).filter(function (entry) { return entry.groupId && entry.rate > 0; })
                };
                if (!hasRecepRole(user)) {
                    user.salary_config.attendance_rate = Number(document.getElementById('ns-general-att').value) || 0;
                }
            }

            UIService.showLoading('Đang lưu...');
            await DBService.saveUser(cleanUser(user));
            localStorage.removeItem('users_data');
            UIService.hideLoading();
            UIService.toast('Đã lưu cấu hình lương!', 'success');
            closeSalarySheet();
            await reload();
        } catch (e) {
            UIService.hideLoading();
            UIService.toast('Lỗi lưu: ' + e.message, 'error');
        }
    }

    // --- Bộ lọc -----------------------------------------------------------

    async function savePayrollProfile() {
        var userId = document.getElementById('ns-salary-user-id').value;
        var user = state.users.find(function (item) { return item.id === userId; });
        if (!user) {
            UIService.toast('Không tìm thấy nhân viên để lưu hồ sơ đối soát.', 'error');
            return;
        }

        var hours = Number(document.getElementById('ns-legacy-hours').value) || 0;
        var minutes = Number(document.getElementById('ns-legacy-minutes').value) || 0;
        var historicalMinutes = typeof PayrollAutomation !== 'undefined' && PayrollAutomation.minutesFromParts
            ? PayrollAutomation.minutesFromParts(hours, minutes)
            : Math.max(0, Math.floor(hours)) * 60 + Math.min(59, Math.max(0, Math.floor(minutes)));
        var evidenceNote = String(document.getElementById('ns-legacy-note').value || '').trim();
        var oldProfile = normalizePayrollProfile(state.payrollProfile);
        var isHistoricalChange = historicalMinutes !== oldProfile.historicalMinutesBeforeApp ||
            evidenceNote !== oldProfile.historicalEvidenceNote;

        if (historicalMinutes > 0 && !evidenceNote) {
            UIService.toast('Hãy ghi nguồn hoặc ghi chú cho giờ trước khi dùng web app.', 'warning');
            return;
        }

        var profile = normalizePayrollProfile({
            automationMode: document.getElementById('ns-payroll-shadow').checked ? 'shadow' : 'legacy',
            historicalMinutesBeforeApp: historicalMinutes,
            historicalEvidenceNote: evidenceNote,
            historicalEnteredAt: isHistoricalChange ? new Date().toISOString() : oldProfile.historicalEnteredAt,
            historicalEnteredBy: isHistoricalChange ? (localStorage.getItem('currentUserName') || 'Admin') : oldProfile.historicalEnteredBy,
            policyVersion: oldProfile.policyVersion || 'legacy-v1',
            // This release deliberately forbids automatic draft creation.
            allowAutomaticDraft: false
        });

        var shouldPersist = typeof PayrollAutomation !== 'undefined' && PayrollAutomation.needsPersistence
            ? PayrollAutomation.needsPersistence(profile, state.payrollProfileExists)
            : state.payrollProfileExists || profile.automationMode === 'shadow' || historicalMinutes > 0 || !!evidenceNote;
        if (!shouldPersist) {
            UIService.toast('Chưa có giờ lịch sử hoặc đối soát nào cần lưu.', 'info');
            return;
        }

        var proceed = await UIService.confirm(
            'Lưu hồ sơ tích lũy cho ' + (user.name || user.username) + '?\n\n' +
            'Thao tác này không thay đổi công, đơn giá, bảng lương đã tính hoặc bảng lương đã gửi.'
        );
        if (!proceed) return;

        try {
            UIService.showLoading('Đang lưu hồ sơ đối soát...');
            await DBService.saveStaffPayrollProfile(userId, profile);
            state.payrollProfile = profile;
            state.payrollProfileExists = true;
            UIService.hideLoading();
            UIService.toast('Đã lưu hồ sơ đối soát. Cách tính lương hiện tại không thay đổi.', 'success');
        } catch (error) {
            UIService.hideLoading();
            UIService.toast('Không thể lưu hồ sơ đối soát: ' + error.message, 'error');
        }
    }

    function setSearch(value) {
        state.search = String(value || '').trim();
        render();
    }

    function setFilter(value) {
        state.filter = value;
        document.querySelectorAll('#ns-filters .ns-chip').forEach(function (chip) {
            chip.classList.toggle('active', chip.dataset.filter === value);
        });
        render();
    }

    window.NhanSu = {
        openStaffSheet: function (user) { openStaffSheet(user || null); },
        closeStaffSheet: closeStaffSheet,
        submitStaff: submitStaff,
        editStaff: editStaff,
        deleteStaff: deleteStaff,
        setMode: setMode,
        quickSetMode: quickSetMode,
        toggleSecret: toggleSecret,
        previewColor: previewColor,
        openSalarySheet: openSalarySheet,
        closeSalarySheet: closeSalarySheet,
        addGroupRate: addGroupRate,
        removeGroupRate: removeGroupRate,
        addRate: addRate,
        removeRate: removeRate,
        saveSalary: saveSalary,
        savePayrollProfile: savePayrollProfile,
        setSearch: setSearch,
        setFilter: setFilter,
        toggleSelect: toggleSelect,
        toggleSelectAll: toggleSelectAll,
        clearSelection: clearSelection,
        bulkTrust: bulkTrust,
        reload: reload,
        _state: state
    };

    // Keep the public names used by the earlier table-based page.  The current
    // card UI is the canonical implementation, but these aliases prevent old
    // bookmarks, browser snippets, and embedded calls from losing behaviour.
    window.filterStaffTable = function (value) { return window.NhanSu.setSearch(value); };
    window.openModal = function () { return window.NhanSu.openStaffSheet(); };
    window.closeModal = function () { return window.NhanSu.closeStaffSheet(); };
    window.editStaff = function (id) { return window.NhanSu.editStaff(id); };
    window.handleStaffSubmit = function (event) { return window.NhanSu.submitStaff(event); };
    window.deleteStaff = function (id) { return window.NhanSu.deleteStaff(id); };
    window.configureSalary = function (id) { return window.NhanSu.openSalarySheet(id); };
    window.openSalaryModal = function (id) { return window.NhanSu.openSalarySheet(id); };
    window.closeSalaryModal = function () { return window.NhanSu.closeSalarySheet(); };
    window.addNewRole = function () { return window.NhanSu.addRate(); };
    window.addNewGroupRate = function () { return window.NhanSu.addGroupRate(); };
    window.removeRole = function (index) { return window.NhanSu.removeRate(index); };
    window.saveSalaryConfig = function () { return window.NhanSu.saveSalary(); };
    window._updateColorPreview = function () { return window.NhanSu.previewColor(); };

    document.addEventListener('DOMContentLoaded', async function () {
        if (window.waitAuth) await window.waitAuth();
        load();

        ['ns-staff-sheet', 'ns-salary-sheet'].forEach(function (id) {
            var sheet = document.getElementById(id);
            if (sheet) {
                sheet.addEventListener('click', function (e) {
                    if (e.target === sheet) sheet.classList.remove('open');
                });
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeStaffSheet(); closeSalarySheet(); }
        });
    });
})();
