// ================= TRANG MÔN HỌC =================
// Môn học được xếp theo nhóm như thư mục: nhóm cha (VD "Tiếng Anh") chứa các
// môn con (VD "Tiếng Anh giao tiếp", "Tiếng Anh trên trường").
// Mỗi môn có cờ allowEarly10 quyết định môn đó có được áp dụng thưởng sớm 10 phút.
//
// Dữ liệu cũ không có parentId/isGroup vẫn chạy bình thường: coi như môn lẻ,
// chưa xếp nhóm, không cho phép sớm 10p.
(function () {
    'use strict';

    var NO_GROUP = '__none__';

    var state = {
        subjects: [],
        search: '',
        filter: 'all',
        collapsed: {},
        sheetType: 'subject',
        early10: false,
        loaded: false
    };

    // --- Tiện ích ---------------------------------------------------------

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function stripTones(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D');
    }

    function matchesSearch(subject) {
        if (!state.search) return true;
        var needle = stripTones(state.search).toLowerCase();
        var hay = stripTones((subject.name || '') + ' ' + (subject.note || '')).toLowerCase();
        return hay.indexOf(needle) !== -1;
    }

    function isGroup(subject) { return subject.isGroup === true; }
    function allowsEarly10(subject) { return subject.allowEarly10 === true; }

    function byName(a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'vi');
    }

    function getGroups() { return state.subjects.filter(isGroup).sort(byName); }

    function getChildren(groupId) {
        return state.subjects.filter(function (s) {
            return !isGroup(s) && String(s.parentId || '') === String(groupId);
        }).sort(byName);
    }

    function getUngrouped() {
        var groupIds = {};
        getGroups().forEach(function (g) { groupIds[String(g.id)] = true; });
        return state.subjects.filter(function (s) {
            if (isGroup(s)) return false;
            var parent = String(s.parentId || '');
            // Nhóm cha đã bị xóa → trả môn về mục "chưa xếp nhóm" thay vì làm nó biến mất.
            return !parent || !groupIds[parent];
        }).sort(byName);
    }

    function passesFilter(subject) {
        if (state.filter === 'early10') return allowsEarly10(subject);
        if (state.filter === 'no-early10') return !allowsEarly10(subject);
        if (state.filter === 'ungrouped') {
            return getUngrouped().some(function (s) { return s.id === subject.id; });
        }
        return true;
    }

    function visibleChildren(groupId) {
        return getChildren(groupId).filter(function (s) {
            return matchesSearch(s) && passesFilter(s);
        });
    }

    // --- Render -----------------------------------------------------------

    function icon(name, size) {
        return '<i data-lucide="' + name + '" style="width:' + (size || 16) + 'px;height:' + (size || 16) + 'px;"></i>';
    }

    function early10Badge() {
        return '<span class="mh-badge mh-badge-10p">' + icon('star', 11) + ' Sớm 10p</span>';
    }

    function renderItem(subject) {
        var color = subject.color || '#059669';
        return '' +
            '<div class="mh-item">' +
                '<span class="mh-dot" style="background:' + esc(color) + ';"></span>' +
                '<div class="mh-item-main">' +
                    '<div class="mh-item-name">' + esc(subject.name) +
                        (allowsEarly10(subject) ? early10Badge() : '') +
                    '</div>' +
                    (subject.note ? '<div class="mh-item-note">' + esc(subject.note) + '</div>' : '') +
                '</div>' +
                '<div class="mh-row-actions">' +
                    '<button class="mh-icon-btn ' + (allowsEarly10(subject) ? 'on' : '') + '" title="' +
                        (allowsEarly10(subject) ? 'Đang cho phép sớm 10p — bấm để tắt' : 'Bấm để cho phép sớm 10p') +
                        '" onclick="MonHoc.quickToggleEarly10(\'' + esc(subject.id) + '\')">' + icon('star') + '</button>' +
                    '<button class="mh-icon-btn" title="Chuyển nhóm" onclick="MonHoc.openMove(\'' + esc(subject.id) + '\')">' + icon('folder-input') + '</button>' +
                    '<button class="mh-icon-btn" title="Sửa" onclick="MonHoc.edit(\'' + esc(subject.id) + '\')">' + icon('pencil') + '</button>' +
                    '<button class="mh-icon-btn danger" title="Xóa" onclick="MonHoc.remove(\'' + esc(subject.id) + '\')">' + icon('trash-2') + '</button>' +
                '</div>' +
            '</div>';
    }

    function renderGroup(group) {
        var children = visibleChildren(group.id);
        var allChildren = getChildren(group.id);
        // Khi đang tìm kiếm/lọc, nhóm không có môn nào khớp và bản thân nhóm cũng
        // không khớp thì ẩn hẳn cho gọn.
        if (children.length === 0 && !(matchesSearch(group) && state.filter === 'all')) return '';

        var color = group.color || '#3B82F6';
        var collapsed = state.collapsed[group.id] ? ' collapsed' : '';
        var early10Count = allChildren.filter(allowsEarly10).length;
        var sub = allChildren.length + ' môn' + (early10Count > 0 ? ' · ' + early10Count + ' môn có sớm 10p' : '');

        var body = children.length > 0
            ? children.map(renderItem).join('')
            : '<div style="padding:0.9rem 1.6rem;color:var(--text-muted);font-size:0.85rem;">Nhóm này chưa có môn nào.</div>';

        return '' +
            '<div class="mh-group' + collapsed + '" id="group-' + esc(group.id) + '">' +
                '<div class="mh-group-head" onclick="MonHoc.toggleGroup(\'' + esc(group.id) + '\')">' +
                    '<span class="mh-caret">' + icon('chevron-down', 18) + '</span>' +
                    '<span class="mh-folder" style="background:' + esc(color) + '18;color:' + esc(color) + ';">' + icon('folder', 18) + '</span>' +
                    '<span class="mh-group-title">' +
                        '<span class="mh-group-name">' + esc(group.name) + '</span>' +
                        '<span class="mh-group-sub">' + esc(sub) + '</span>' +
                    '</span>' +
                    '<span class="mh-row-actions" onclick="event.stopPropagation()">' +
                        '<button class="mh-icon-btn" title="Bật/tắt sớm 10p cho cả nhóm" onclick="MonHoc.toggleGroupEarly10(\'' + esc(group.id) + '\')">' + icon('star') + '</button>' +
                        '<button class="mh-icon-btn" title="Sửa nhóm" onclick="MonHoc.edit(\'' + esc(group.id) + '\')">' + icon('pencil') + '</button>' +
                        '<button class="mh-icon-btn danger" title="Xóa nhóm" onclick="MonHoc.remove(\'' + esc(group.id) + '\')">' + icon('trash-2') + '</button>' +
                    '</span>' +
                '</div>' +
                '<div class="mh-group-body">' + body + '</div>' +
            '</div>';
    }

    function renderTree() {
        var tree = document.getElementById('mh-tree');
        var loading = document.getElementById('mh-loading');
        if (loading) loading.style.display = 'none';
        if (!tree) return;

        var groups = getGroups();
        var ungrouped = getUngrouped().filter(function (s) {
            return matchesSearch(s) && passesFilter(s);
        });

        var html = groups.map(renderGroup).join('');

        if (ungrouped.length > 0) {
            html += '' +
                '<div class="mh-group" id="group-none">' +
                    '<div class="mh-group-head" onclick="MonHoc.toggleGroup(\'' + NO_GROUP + '\')">' +
                        '<span class="mh-caret">' + icon('chevron-down', 18) + '</span>' +
                        '<span class="mh-folder" style="background:#F3F4F6;color:#6B7280;">' + icon('inbox', 18) + '</span>' +
                        '<span class="mh-group-title">' +
                            '<span class="mh-group-name">Chưa xếp nhóm</span>' +
                            '<span class="mh-group-sub">' + ungrouped.length + ' môn — bấm biểu tượng thư mục để xếp vào nhóm</span>' +
                        '</span>' +
                    '</div>' +
                    '<div class="mh-group-body">' + ungrouped.map(renderItem).join('') + '</div>' +
                '</div>';
            if (state.collapsed[NO_GROUP]) {
                html = html.replace('<div class="mh-group" id="group-none">', '<div class="mh-group collapsed" id="group-none">');
            }
        }

        if (!html) {
            html = '' +
                '<div class="mh-empty">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
                        '<path d="M12 6.25v13m0-13C10.83 5.48 9.25 5 7.5 5S4.17 5.48 3 6.25v13C4.17 18.48 5.75 18 7.5 18s3.33.48 4.5 1.25m0-13C13.17 5.48 14.75 5 16.5 5S19.83 5.48 21 6.25v13C19.83 18.48 18.25 18 16.5 18s-3.33.48-4.5 1.25"></path>' +
                    '</svg>' +
                    '<h3>' + (state.search || state.filter !== 'all' ? 'Không tìm thấy môn nào' : 'Chưa có môn học nào') + '</h3>' +
                    '<p>' + (state.search || state.filter !== 'all'
                        ? 'Thử đổi từ khóa hoặc bỏ bộ lọc.'
                        : 'Bấm "Thêm nhóm" để tạo thư mục, rồi "Thêm môn" để xếp môn vào.') + '</p>' +
                '</div>';
        }

        tree.innerHTML = html;
        if (window.lucide) window.lucide.createIcons({ root: tree });
        renderStats();
    }

    function renderStats() {
        var groups = getGroups().length;
        var subjects = state.subjects.filter(function (s) { return !isGroup(s); }).length;
        var early10 = state.subjects.filter(function (s) { return !isGroup(s) && allowsEarly10(s); }).length;
        var set = function (id, value) {
            var el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        set('stat-groups', groups);
        set('stat-subjects', subjects);
        set('stat-early10', early10);
    }

    // --- Tải dữ liệu ------------------------------------------------------

    async function load() {
        try {
            state.subjects = await DBService.getSubjects();
            state.loaded = true;
            renderTree();
        } catch (e) {
            var loading = document.getElementById('mh-loading');
            if (loading) loading.textContent = 'Lỗi tải dữ liệu: ' + e.message;
        }
    }

    async function reload() {
        DBService._invalidate('subjects_all');
        window._subjectList = null;
        state.subjects = await DBService.getSubjects();
        renderTree();
    }

    // --- Form -------------------------------------------------------------

    function fillParentOptions(selectId, selectedId, excludeId) {
        var select = document.getElementById(selectId);
        if (!select) return;
        var options = ['<option value="' + NO_GROUP + '">— Không thuộc nhóm nào —</option>'];
        getGroups().forEach(function (group) {
            if (excludeId && String(group.id) === String(excludeId)) return;
            options.push('<option value="' + esc(group.id) + '">' + esc(group.name) + '</option>');
        });
        select.innerHTML = options.join('');
        select.value = selectedId || NO_GROUP;
        if (!select.value) select.value = NO_GROUP;
    }

    function setType(type) {
        state.sheetType = type;
        document.querySelectorAll('#mh-type-seg button').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.type === type);
        });
        // Nhóm là thư mục thuần, không lồng nhóm trong nhóm để cây luôn dễ nhìn.
        var parentField = document.getElementById('mh-parent-field');
        if (parentField) parentField.style.display = type === 'group' ? 'none' : '';
        var hint = document.getElementById('mh-early10-hint');
        if (hint) {
            hint.textContent = type === 'group'
                ? 'Bật ở nhóm sẽ hỏi có áp dụng cho tất cả môn con hay không'
                : 'Chỉ môn được bật mới cho giáo viên nhận thưởng vào sớm';
        }
    }

    function setEarly10(value) {
        state.early10 = !!value;
        var toggle = document.getElementById('mh-early10-toggle');
        if (toggle) toggle.classList.toggle('on', state.early10);
    }

    function previewColor() {
        var colorInput = document.getElementById('mh-color');
        if (!colorInput) return;
        var color = colorInput.value;
        var name = (document.getElementById('mh-name').value || '').trim();
        var r = parseInt(color.substr(1, 2), 16);
        var g = parseInt(color.substr(3, 2), 16);
        var b = parseInt(color.substr(5, 2), 16);
        var dark = (r * 0.299 + g * 0.587 + b * 0.114) < 150;
        var pill = document.getElementById('mh-color-pill');
        var swatch = document.getElementById('mh-swatch');
        if (pill) {
            pill.style.background = dark ? color : color + '22';
            pill.style.color = dark ? '#fff' : color;
            pill.textContent = name || 'Xem trước';
        }
        if (swatch) swatch.style.background = color;
    }

    function openSheet(type, subject) {
        var editing = !!subject;
        document.getElementById('mh-edit-id').value = editing ? subject.id : '';
        document.getElementById('mh-name').value = editing ? (subject.name || '') : '';
        document.getElementById('mh-note').value = editing ? (subject.note || '') : '';
        document.getElementById('mh-color').value = (editing && subject.color)
            ? subject.color
            : (type === 'group' ? '#3B82F6' : '#059669');

        setType(type);
        setEarly10(editing ? allowsEarly10(subject) : false);
        fillParentOptions('mh-parent', editing ? (subject.parentId || NO_GROUP) : NO_GROUP, editing ? subject.id : null);

        // Môn MỚI kế thừa cờ 10p của nhóm cha khi admin chọn nhóm — tạo môn con
        // trong nhóm Tiếng Anh là tự có 10p, khỏi phải nhớ bật tay.
        var parentSelect = document.getElementById('mh-parent');
        if (parentSelect) {
            parentSelect.onchange = function () {
                if (editing) return;
                var group = state.subjects.find(function (s) { return s.id === parentSelect.value; });
                if (group) setEarly10(allowsEarly10(group));
            };
        }

        var typeField = document.getElementById('mh-type-field');
        if (typeField) typeField.style.display = editing ? 'none' : '';

        document.getElementById('mh-sheet-title').textContent = editing
            ? (type === 'group' ? 'Sửa nhóm môn' : 'Sửa môn học')
            : (type === 'group' ? 'Thêm nhóm môn' : 'Thêm môn học');
        document.getElementById('mh-sheet-sub').textContent = editing
            ? 'Thay đổi sẽ áp dụng ngay sau khi lưu'
            : (type === 'group' ? 'Nhóm là thư mục để gom các môn cùng loại' : 'Điền thông tin rồi bấm Lưu');

        previewColor();
        document.getElementById('mh-sheet').classList.add('open');
        setTimeout(function () {
            var nameInput = document.getElementById('mh-name');
            if (nameInput && window.innerWidth > 768) nameInput.focus();
        }, 80);
    }

    function closeSheet() {
        document.getElementById('mh-sheet').classList.remove('open');
    }

    async function save() {
        var name = (document.getElementById('mh-name').value || '').trim();
        if (!name) {
            UIService.toast('Vui lòng nhập tên!', 'error');
            return;
        }

        var editId = document.getElementById('mh-edit-id').value;
        var existing = editId ? state.subjects.find(function (s) { return s.id === editId; }) : null;
        var type = existing ? (isGroup(existing) ? 'group' : 'subject') : state.sheetType;

        var parentValue = document.getElementById('mh-parent').value;
        var payload = {
            name: name,
            color: document.getElementById('mh-color').value,
            note: (document.getElementById('mh-note').value || '').trim(),
            isGroup: type === 'group',
            parentId: type === 'group' ? null : (parentValue === NO_GROUP ? null : parentValue),
            allowEarly10: state.early10
        };
        if (editId) payload.id = editId;

        try {
            UIService.showLoading('Đang lưu...');
            await DBService.saveSubject(payload);

            // Bật 10p ở nhóm → hỏi có áp cho toàn bộ môn con không.
            if (type === 'group' && editId) {
                var children = getChildren(editId);
                var mismatched = children.filter(function (c) { return allowsEarly10(c) !== state.early10; });
                if (mismatched.length > 0) {
                    UIService.hideLoading();
                    var apply = await UIService.confirm(
                        (state.early10 ? 'Bật' : 'Tắt') + ' sớm 10p cho cả ' + mismatched.length +
                        ' môn trong nhóm "' + name + '"?'
                    );
                    if (apply) {
                        UIService.showLoading('Đang áp dụng...');
                        await DBService.saveSubjectsBatch(mismatched.map(function (c) {
                            return { id: c.id, allowEarly10: state.early10 };
                        }));
                    }
                }
            }

            UIService.hideLoading();
            UIService.toast(editId ? 'Đã cập nhật!' : 'Đã thêm mới!', 'success');
            closeSheet();
            await reload();
        } catch (e) {
            UIService.hideLoading();
            UIService.toast('Lỗi: ' + e.message, 'error');
        }
    }

    function edit(id) {
        var subject = state.subjects.find(function (s) { return s.id === id; });
        if (!subject) return;
        openSheet(isGroup(subject) ? 'group' : 'subject', subject);
    }

    async function remove(id) {
        var subject = state.subjects.find(function (s) { return s.id === id; });
        if (!subject) return;

        if (isGroup(subject)) {
            var children = getChildren(id);
            var message = children.length > 0
                ? 'Xóa nhóm "' + subject.name + '"?\n\n' + children.length +
                  ' môn bên trong sẽ KHÔNG bị xóa, chỉ chuyển về mục "Chưa xếp nhóm".'
                : 'Xóa nhóm "' + subject.name + '"?';
            if (!await UIService.confirm(message)) return;
            try {
                UIService.showLoading('Đang xóa...');
                if (children.length > 0) {
                    await DBService.saveSubjectsBatch(children.map(function (c) {
                        return { id: c.id, parentId: null };
                    }));
                }
                await DBService.deleteSubject(id);
                UIService.hideLoading();
                UIService.toast('Đã xóa nhóm.', 'success');
                await reload();
            } catch (e) {
                UIService.hideLoading();
                UIService.toast('Lỗi: ' + e.message, 'error');
            }
            return;
        }

        if (!await UIService.confirm('Xóa môn "' + subject.name + '"? Hành động này không thể hoàn tác.')) return;
        try {
            UIService.showLoading('Đang xóa...');
            await DBService.deleteSubject(id);
            UIService.hideLoading();
            UIService.toast('Đã xóa môn học.', 'success');
            await reload();
        } catch (e) {
            UIService.hideLoading();
            UIService.toast('Lỗi: ' + e.message, 'error');
        }
    }

    async function quickToggleEarly10(id) {
        var subject = state.subjects.find(function (s) { return s.id === id; });
        if (!subject) return;
        var next = !allowsEarly10(subject);
        try {
            await DBService.saveSubject({ id: id, allowEarly10: next });
            UIService.toast(next
                ? '"' + subject.name + '" đã được cho phép sớm 10p.'
                : '"' + subject.name + '" đã tắt sớm 10p.', 'success');
            await reload();
        } catch (e) {
            UIService.toast('Lỗi: ' + e.message, 'error');
        }
    }

    async function toggleGroupEarly10(groupId) {
        var group = state.subjects.find(function (s) { return s.id === groupId; });
        if (!group) return;
        var children = getChildren(groupId);
        if (children.length === 0) {
            UIService.toast('Nhóm này chưa có môn nào.', 'info');
            return;
        }
        var next = !children.every(allowsEarly10);
        if (!await UIService.confirm(
            (next ? 'Bật' : 'Tắt') + ' sớm 10p cho tất cả ' + children.length + ' môn trong "' + group.name + '"?'
        )) return;

        try {
            UIService.showLoading('Đang áp dụng...');
            var updates = children.map(function (c) { return { id: c.id, allowEarly10: next }; });
            updates.push({ id: groupId, allowEarly10: next });
            await DBService.saveSubjectsBatch(updates);
            UIService.hideLoading();
            UIService.toast('Đã ' + (next ? 'bật' : 'tắt') + ' sớm 10p cho ' + children.length + ' môn.', 'success');
            await reload();
        } catch (e) {
            UIService.hideLoading();
            UIService.toast('Lỗi: ' + e.message, 'error');
        }
    }

    // --- Chuyển nhóm ------------------------------------------------------

    function openMove(id) {
        var subject = state.subjects.find(function (s) { return s.id === id; });
        if (!subject) return;
        document.getElementById('mh-move-id').value = id;
        document.getElementById('mh-move-sub').textContent = 'Chuyển "' + subject.name + '" sang nhóm khác';
        fillParentOptions('mh-move-parent', subject.parentId || NO_GROUP, id);
        document.getElementById('mh-move-sheet').classList.add('open');
    }

    function closeMove() {
        document.getElementById('mh-move-sheet').classList.remove('open');
    }

    async function confirmMove() {
        var id = document.getElementById('mh-move-id').value;
        var value = document.getElementById('mh-move-parent').value;
        var parentId = value === NO_GROUP ? null : value;
        try {
            UIService.showLoading('Đang chuyển...');
            await DBService.saveSubject({ id: id, parentId: parentId });
            UIService.hideLoading();
            UIService.toast('Đã chuyển nhóm.', 'success');
            closeMove();
            await reload();
        } catch (e) {
            UIService.hideLoading();
            UIService.toast('Lỗi: ' + e.message, 'error');
        }
    }

    // --- Bộ lọc -----------------------------------------------------------

    function setSearch(value) {
        state.search = String(value || '').trim();
        renderTree();
    }

    function setFilter(value) {
        state.filter = value;
        document.querySelectorAll('#mh-filters .mh-chip').forEach(function (chip) {
            chip.classList.toggle('active', chip.dataset.filter === value);
        });
        renderTree();
    }

    function toggleGroup(groupId) {
        state.collapsed[groupId] = !state.collapsed[groupId];
        renderTree();
    }

    window.MonHoc = {
        openSheet: function (type) { openSheet(type, null); },
        closeSheet: closeSheet,
        setType: setType,
        toggleEarly10: function () { setEarly10(!state.early10); },
        previewColor: previewColor,
        save: save,
        edit: edit,
        remove: remove,
        quickToggleEarly10: quickToggleEarly10,
        toggleGroupEarly10: toggleGroupEarly10,
        openMove: openMove,
        closeMove: closeMove,
        confirmMove: confirmMove,
        setSearch: setSearch,
        setFilter: setFilter,
        toggleGroup: toggleGroup,
        _state: state
    };

    document.addEventListener('DOMContentLoaded', async function () {
        if (window.waitAuth) await window.waitAuth();
        load();
        previewColor();

        // Bấm ra ngoài để đóng
        ['mh-sheet', 'mh-move-sheet'].forEach(function (id) {
            var sheet = document.getElementById(id);
            if (sheet) {
                sheet.addEventListener('click', function (e) {
                    if (e.target === sheet) sheet.classList.remove('open');
                });
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeSheet(); closeMove(); }
        });
    });
})();
