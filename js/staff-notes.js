// Sổ ghi chú cá nhân (yêu cầu Giám đốc 03/10/2026).
// - Mọi nhân viên: ghi chú tuỳ thích ở Trang chủ (nhan-vien.html) — tiêu đề, nội dung, danh sách
//   việc có ô tích, ghim, màu, ngày nhắc, chèn giờ, sao chép. Tự lưu (không cần bấm Lưu).
// - Quản lý (Admin + Trợ lý cấp cao, admin.html): xem ghi chú của MỌI nhân viên (chỉ xem), và có sổ riêng.
// Dữ liệu: collection staff_notes, mỗi ghi chú một document { staffId, staffName, title, body,
// items:[{text,done}], color, pinned, remindOn, createdAt, updatedAt } — luật ở firestore.rules.
(function (global) {
    'use strict';

    const COLORS = ['none', 'yellow', 'green', 'blue', 'pink', 'purple'];
    const COLOR_LABEL = { none: 'Không màu', yellow: 'Vàng', green: 'Xanh lá', blue: 'Xanh dương', pink: 'Hồng', purple: 'Tím' };
    const LIMITS = { title: 200, body: 20000, items: 100, itemText: 300 };
    const SAVE_DELAY_MS = 700;

    const state = {
        tab: 'mine',          // 'mine' | 'team'
        notes: [],            // ghi chú của tôi
        team: [],             // ghi chú mọi nhân viên (admin)
        loaded: false,
        teamLoaded: false,
        selectedId: null,
        filter: 'all',
        search: '',
        staffFilter: '',
        pending: new Map(),   // id -> timer
        chains: new Map(),    // id -> Promise (lưu lần lượt)
        status: '',
        open: false
    };

    const $ = id => document.getElementById(id);
    const esc = value => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const ui = () => (typeof UIService !== 'undefined' ? UIService : global.UIService);
    const toast = (message, type = 'info') => { try { ui()?.toast?.(esc(message), type); } catch (_) { /* bỏ qua */ } };
    const db = () => global.db;
    const myId = () => String(localStorage.getItem('currentUserId') || '').trim();
    const myName = () => String(localStorage.getItem('userFullName') || '').trim().slice(0, 120);
    const roles = () => {
        const raw = localStorage.getItem('currentRole') || '';
        try { return typeof parseRoles === 'function' ? parseRoles(raw) : [raw]; } catch (_) { return [raw]; }
    };
    // Ai được xem ghi chú của mọi nhân viên — khớp isAdmin() trong firestore.rules.
    const isNotesManager = () => roles().some(r => ['admin', 'senior_assistant'].includes(r));
    const pad = n => String(n).padStart(2, '0');
    const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const icon = (path, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    const ICONS = {
        note: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
        plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
        close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        back: '<path d="m15 18-6-6 6-6"/>',
        pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
        check: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
        clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
        bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
        copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
        search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
    };

    // ---------- Dữ liệu ----------
    function toDate(value) {
        if (!value) return null;
        if (typeof value.toDate === 'function') return value.toDate();
        if (value instanceof Date) return value;
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    function normalizeNote(id, data = {}) {
        const items = (Array.isArray(data.items) ? data.items : []).slice(0, LIMITS.items).map(item => ({
            text: String(item?.text || '').slice(0, LIMITS.itemText),
            done: item?.done === true
        }));
        return {
            id,
            staffId: String(data.staffId || ''),
            staffName: String(data.staffName || ''),
            title: String(data.title || '').slice(0, LIMITS.title),
            body: String(data.body || '').slice(0, LIMITS.body),
            items,
            color: COLORS.includes(data.color) ? data.color : 'none',
            pinned: data.pinned === true,
            remindOn: /^\d{4}-\d{2}-\d{2}$/.test(String(data.remindOn || '')) ? data.remindOn : null,
            createdAt: toDate(data.createdAt),
            updatedAt: toDate(data.updatedAt) || new Date(),
            isNew: false
        };
    }

    function isEmptyNote(note) {
        return !note.title.trim() && !note.body.trim() && !note.items.some(item => item.text.trim());
    }

    function sortNotes(list) {
        return list.slice().sort((a, b) => (Number(b.pinned) - Number(a.pinned)) ||
            ((b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0)));
    }

    async function loadMine(force = false) {
        if (state.loaded && !force) return;
        const staffId = myId();
        if (!staffId || !db()) throw new Error('Chưa đăng nhập.');
        const snapshot = await db().collection('staff_notes').where('staffId', '==', staffId).get();
        const drafts = state.notes.filter(note => note.isNew);
        state.notes = [...drafts, ...snapshot.docs.map(doc => normalizeNote(doc.id, doc.data()))];
        state.loaded = true;
    }

    async function loadTeam(force = false) {
        if (!isNotesManager() || (state.teamLoaded && !force)) return;
        const snapshot = await db().collection('staff_notes').orderBy('updatedAt', 'desc').limit(500).get();
        state.team = snapshot.docs.map(doc => normalizeNote(doc.id, doc.data()));
        state.teamLoaded = true;
    }

    function payloadOf(note) {
        return {
            staffId: note.staffId,
            staffName: note.staffName || myName(),
            title: note.title.slice(0, LIMITS.title),
            body: note.body.slice(0, LIMITS.body),
            items: note.items.slice(0, LIMITS.items).map(item => ({ text: item.text.slice(0, LIMITS.itemText), done: !!item.done })),
            color: COLORS.includes(note.color) ? note.color : 'none',
            pinned: !!note.pinned,
            remindOn: note.remindOn || null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
    }

    function setStatus(text, tone = '') {
        state.status = text;
        const el = $('sn-save-status');
        if (el) { el.textContent = text; el.dataset.tone = tone; }
    }

    // Lưu lần lượt từng ghi chú: lần gõ sau chờ lần trước xong để không ghi đè lộn thứ tự.
    function persist(note) {
        const previous = state.chains.get(note.id) || Promise.resolve();
        const run = previous.catch(() => {}).then(async () => {
            if (!state.notes.includes(note)) return; // đã xoá
            if (note.isNew && isEmptyNote(note)) return; // nháp trống: chưa tạo
            const ref = db().collection('staff_notes').doc(note.id);
            const payload = payloadOf(note);
            if (note.isNew) {
                await ref.set({ ...payload, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
                note.isNew = false;
            } else {
                await ref.update(payload);
            }
        });
        state.chains.set(note.id, run);
        return run;
    }

    function scheduleSave(note) {
        note.updatedAt = new Date();
        clearTimeout(state.pending.get(note.id));
        setStatus('Đang lưu…', 'busy');
        state.pending.set(note.id, setTimeout(() => flushNote(note), SAVE_DELAY_MS));
    }

    async function flushNote(note) {
        clearTimeout(state.pending.get(note.id));
        state.pending.delete(note.id);
        try {
            await persist(note);
            if (!state.pending.size) setStatus('Đã lưu', 'ok');
            const updated = $('sn-updated');
            if (updated && note.id === state.selectedId && !note.isNew) updated.textContent = `Cập nhật ${formatTime(note.updatedAt)}`;
        } catch (error) {
            console.warn('[StaffNotes] Lưu lỗi:', error);
            setStatus('Chưa lưu được — kiểm tra mạng, sẽ thử lại khi bạn sửa tiếp', 'bad');
            toast('Chưa lưu được ghi chú. Kiểm tra mạng rồi thử lại.', 'error');
        }
    }

    function flushAll() {
        const ids = Array.from(state.pending.keys());
        return Promise.all(ids.map(id => {
            const note = state.notes.find(item => item.id === id);
            return note ? flushNote(note) : null;
        }));
    }

    // ---------- Giao diện ----------
    function remindBadge(note) {
        if (!note.remindOn) return '';
        const today = todayKey();
        const [y, m, d] = note.remindOn.split('-');
        const tone = note.remindOn < today ? 'late' : (note.remindOn === today ? 'today' : 'later');
        const label = tone === 'today' ? 'Hôm nay' : (tone === 'late' ? `Quá hạn ${d}/${m}` : `${d}/${m}${y !== today.slice(0, 4) ? '/' + y : ''}`);
        return `<span class="sn-badge is-${tone}">${icon(ICONS.bell, 12)}${esc(label)}</span>`;
    }

    function preview(note) {
        const text = note.body.trim() || note.items.map(item => `${item.done ? '☑' : '☐'} ${item.text}`).join('  ');
        return text.replace(/\s+/g, ' ').slice(0, 140);
    }

    function itemsProgress(note) {
        const real = note.items.filter(item => item.text.trim());
        if (!real.length) return '';
        const done = real.filter(item => item.done).length;
        return `<span class="sn-badge${done === real.length ? ' is-done' : ''}">${icon(ICONS.check, 12)}${done}/${real.length}</span>`;
    }

    function formatTime(date) {
        if (!date) return '';
        return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
    }

    function visibleNotes() {
        const source = state.tab === 'team' ? state.team : state.notes;
        const query = state.search.trim().toLowerCase();
        const today = todayKey();
        return sortNotes(source).filter(note => {
            if (state.tab === 'team' && state.staffFilter && note.staffId !== state.staffFilter) return false;
            if (state.filter === 'pinned' && !note.pinned) return false;
            if (state.filter === 'todo' && !note.items.some(item => item.text.trim() && !item.done)) return false;
            if (state.filter === 'remind' && !(note.remindOn && note.remindOn <= today)) return false;
            if (!query) return true;
            return [note.title, note.body, note.staffName, ...note.items.map(item => item.text)]
                .some(text => String(text || '').toLowerCase().includes(query));
        });
    }

    function noteCard(note, compact = false) {
        const title = note.title.trim() || (isEmptyNote(note) ? 'Ghi chú mới' : 'Không tiêu đề');
        const owner = state.tab === 'team' && !compact ? `<span class="sn-owner">${icon(ICONS.users, 12)}${esc(note.staffName || note.staffId)}</span>` : '';
        return `<button type="button" class="sn-card sn-color-${note.color}${note.id === state.selectedId && !compact ? ' is-active' : ''}" data-note-id="${esc(note.id)}">
            <span class="sn-card-head">${note.pinned ? `<span class="sn-pin" title="Đã ghim">${icon(ICONS.pin, 13)}</span>` : ''}<span class="sn-card-title">${esc(title)}</span></span>
            ${preview(note) ? `<span class="sn-card-text">${esc(preview(note))}</span>` : ''}
            <span class="sn-card-meta">${owner}${remindBadge(note)}${itemsProgress(note)}<span class="sn-time">${esc(formatTime(note.updatedAt))}</span></span>
        </button>`;
    }

    function renderList() {
        const list = $('sn-list');
        if (!list) return;
        const notes = visibleNotes();
        if (state.tab === 'mine' && !state.loaded) { list.innerHTML = '<p class="sn-empty">Đang tải…</p>'; return; }
        if (state.tab === 'team' && !state.teamLoaded) { list.innerHTML = '<p class="sn-empty">Đang tải ghi chú nhân viên…</p>'; return; }
        list.innerHTML = notes.length ? notes.map(note => noteCard(note)).join('')
            : `<p class="sn-empty">${state.search || state.filter !== 'all' || state.staffFilter ? 'Không có ghi chú phù hợp.' : (state.tab === 'team' ? 'Nhân viên chưa có ghi chú nào.' : 'Chưa có ghi chú. Bấm “Ghi chú mới” để bắt đầu.')}</p>`;
    }

    function renderStaffFilter() {
        const select = $('sn-staff-filter');
        if (!select) return;
        select.hidden = state.tab !== 'team';
        if (state.tab !== 'team') return;
        const people = new Map();
        state.team.forEach(note => { if (!people.has(note.staffId)) people.set(note.staffId, note.staffName || note.staffId); });
        const options = Array.from(people.entries()).sort((a, b) => a[1].localeCompare(b[1], 'vi'));
        select.innerHTML = `<option value="">Tất cả nhân viên (${people.size})</option>` +
            options.map(([id, name]) => `<option value="${esc(id)}"${id === state.staffFilter ? ' selected' : ''}>${esc(name)}</option>`).join('');
    }

    function currentNote() {
        const source = state.tab === 'team' ? state.team : state.notes;
        return source.find(note => note.id === state.selectedId) || null;
    }

    function renderEditor() {
        const pane = $('sn-editor');
        if (!pane) return;
        const note = currentNote();
        const dialog = $('sn-dialog');
        dialog?.classList.toggle('is-editing', !!note);
        if (!note) {
            pane.innerHTML = `<div class="sn-placeholder">${icon(ICONS.note, 40)}<p>${state.tab === 'team' ? 'Chọn một ghi chú để xem.' : 'Chọn một ghi chú bên trái hoặc tạo ghi chú mới.'}</p></div>`;
            return;
        }
        const readOnly = state.tab === 'team' || note.staffId !== myId();
        const dis = readOnly ? 'disabled' : '';
        const colorDots = COLORS.map(color => `<button type="button" class="sn-dot sn-color-${color}${note.color === color ? ' is-on' : ''}" data-color="${color}" title="${COLOR_LABEL[color]}" aria-label="Màu ${COLOR_LABEL[color]}" ${dis}></button>`).join('');
        pane.innerHTML = `
            <div class="sn-editor-top">
                <button type="button" class="sn-icon-btn sn-back" data-act="back" aria-label="Quay lại danh sách">${icon(ICONS.back)}</button>
                ${readOnly ? `<span class="sn-readonly">${icon(ICONS.users, 14)} Ghi chú của ${esc(note.staffName || note.staffId)} · chỉ xem</span>` : `<span class="sn-save-status" id="sn-save-status" data-tone="">${esc(state.status)}</span>`}
            </div>
            <div class="sn-paper sn-color-${note.color}">
                <input class="sn-title" id="sn-title" maxlength="${LIMITS.title}" placeholder="Tiêu đề" value="${esc(note.title)}" ${dis}>
                ${readOnly ? '' : `<div class="sn-tools" role="toolbar" aria-label="Công cụ ghi chú">
                    <button type="button" class="sn-tool${note.pinned ? ' is-on' : ''}" data-act="pin" title="Ghim lên đầu">${icon(ICONS.pin, 16)}<span>${note.pinned ? 'Bỏ ghim' : 'Ghim'}</span></button>
                    <button type="button" class="sn-tool" data-act="add-item" title="Thêm việc cần làm có ô tích">${icon(ICONS.check, 16)}<span>Việc cần làm</span></button>
                    <button type="button" class="sn-tool" data-act="stamp" title="Chèn ngày giờ hiện tại vào nội dung">${icon(ICONS.clock, 16)}<span>Chèn giờ</span></button>
                    <label class="sn-tool sn-remind${note.remindOn ? ' is-on' : ''}" title="Ngày nhắc — hiện nổi bật ở Trang chủ đúng ngày">${icon(ICONS.bell, 16)}<span>Nhắc</span><input type="date" id="sn-remind" value="${esc(note.remindOn || '')}"></label>
                    ${note.remindOn ? `<button type="button" class="sn-tool sn-tool-mini" data-act="clear-remind" title="Bỏ ngày nhắc" aria-label="Bỏ ngày nhắc">${icon(ICONS.x, 14)}</button>` : ''}
                    <span class="sn-colors" aria-label="Màu ghi chú">${colorDots}</span>
                </div>`}
                <textarea class="sn-body" id="sn-body" maxlength="${LIMITS.body}" placeholder="${readOnly ? '' : 'Viết ghi chú…'}" ${dis}>${esc(note.body)}</textarea>
                <div class="sn-items" id="sn-items">${renderItems(note, readOnly)}</div>
                ${readOnly ? '' : `<button type="button" class="sn-add-item" data-act="add-item">${icon(ICONS.plus, 15)} Thêm việc</button>`}
            </div>
            <div class="sn-editor-foot">
                <span class="sn-time" id="sn-updated">${note.isNew ? 'Chưa lưu' : `Cập nhật ${esc(formatTime(note.updatedAt))}`}</span>
                <span class="sn-foot-actions">
                    <button type="button" class="sn-tool" data-act="copy" title="Sao chép nội dung">${icon(ICONS.copy, 16)}<span>Sao chép</span></button>
                    ${readOnly ? '' : `<button type="button" class="sn-tool is-danger" data-act="delete" title="Xoá ghi chú">${icon(ICONS.trash, 16)}<span>Xoá</span></button>`}
                </span>
            </div>`;
        autoGrow($('sn-body'));
    }

    function renderItems(note, readOnly) {
        return note.items.map((item, index) => `
            <div class="sn-item${item.done ? ' is-done' : ''}" data-index="${index}">
                <input type="checkbox" class="sn-item-check" ${item.done ? 'checked' : ''} ${readOnly ? 'disabled' : ''} aria-label="Đánh dấu xong">
                <input type="text" class="sn-item-text" maxlength="${LIMITS.itemText}" value="${esc(item.text)}" placeholder="Việc cần làm" ${readOnly ? 'disabled' : ''}>
                ${readOnly ? '' : `<button type="button" class="sn-icon-btn sn-item-del" data-act="del-item" aria-label="Xoá dòng">${icon(ICONS.x, 14)}</button>`}
            </div>`).join('');
    }

    function autoGrow(textarea) {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.max(140, textarea.scrollHeight + 2)}px`;
    }

    function refreshListOnly() {
        renderList();
        renderHomeCard();
    }

    function renderTabs() {
        document.querySelectorAll('#sn-dialog [data-tab]').forEach(btn => {
            btn.classList.toggle('is-on', btn.dataset.tab === state.tab);
            btn.setAttribute('aria-selected', String(btn.dataset.tab === state.tab));
        });
        const create = $('sn-new');
        if (create) create.hidden = state.tab === 'team';
        document.querySelectorAll('#sn-dialog [data-filter]').forEach(btn => btn.classList.toggle('is-on', btn.dataset.filter === state.filter));
    }

    function renderAll() {
        renderTabs();
        renderStaffFilter();
        renderList();
        renderEditor();
        renderHomeCard();
    }

    // ---------- Hộp thoại ----------
    function ensureDialog() {
        if ($('sn-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'sn-overlay';
        overlay.className = 'sn-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="sn-dialog" id="sn-dialog" role="dialog" aria-modal="true" aria-labelledby="sn-heading">
                <header class="sn-head">
                    <h2 id="sn-heading">${icon(ICONS.note, 20)} Sổ ghi chú</h2>
                    <div class="sn-tabs" role="tablist" ${isNotesManager() ? '' : 'hidden'}>
                        <button type="button" role="tab" data-tab="mine" class="is-on">Của tôi</button>
                        <button type="button" role="tab" data-tab="team">${icon(ICONS.users, 14)} Nhân viên</button>
                    </div>
                    <button type="button" class="sn-icon-btn" data-act="close" aria-label="Đóng">${icon(ICONS.close, 20)}</button>
                </header>
                <div class="sn-main">
                    <aside class="sn-side">
                        <div class="sn-side-top">
                            <label class="sn-search">${icon(ICONS.search, 16)}<input type="search" id="sn-search" placeholder="Tìm ghi chú…" autocomplete="off"></label>
                            <button type="button" class="btn btn-primary sn-new" id="sn-new" data-act="new">${icon(ICONS.plus, 16)} Ghi chú mới</button>
                        </div>
                        <select id="sn-staff-filter" class="sn-staff-filter" hidden aria-label="Lọc theo nhân viên"></select>
                        <div class="sn-filters" role="group" aria-label="Lọc">
                            <button type="button" data-filter="all" class="is-on">Tất cả</button>
                            <button type="button" data-filter="pinned">Đã ghim</button>
                            <button type="button" data-filter="todo">Còn việc</button>
                            <button type="button" data-filter="remind">Cần nhắc</button>
                        </div>
                        <div class="sn-list" id="sn-list"></div>
                    </aside>
                    <section class="sn-editor" id="sn-editor" aria-live="polite"></section>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        bindDialog(overlay);
    }

    function bindDialog(overlay) {
        overlay.addEventListener('click', event => {
            if (event.target === overlay) return close();
            const card = event.target.closest('[data-note-id]');
            if (card && overlay.contains(card)) { select(card.dataset.noteId); return; }
            const tab = event.target.closest('[data-tab]');
            if (tab) { switchTab(tab.dataset.tab); return; }
            const filter = event.target.closest('[data-filter]');
            if (filter) { state.filter = filter.dataset.filter; renderTabs(); renderList(); return; }
            const colorBtn = event.target.closest('[data-color]');
            if (colorBtn) { editCurrent(note => { note.color = colorBtn.dataset.color; }, true); return; }
            const act = event.target.closest('[data-act]')?.dataset.act;
            if (act) handleAction(act, event);
        });
        overlay.addEventListener('input', event => {
            const target = event.target;
            if (target.id === 'sn-search') { state.search = target.value; renderList(); return; }
            if (target.id === 'sn-title') { editCurrent(note => { note.title = target.value.slice(0, LIMITS.title); }); return; }
            if (target.id === 'sn-body') { autoGrow(target); editCurrent(note => { note.body = target.value.slice(0, LIMITS.body); }); return; }
            if (target.classList.contains('sn-item-text')) {
                const index = Number(target.closest('.sn-item')?.dataset.index);
                editCurrent(note => { if (note.items[index]) note.items[index].text = target.value.slice(0, LIMITS.itemText); });
            }
        });
        overlay.addEventListener('change', event => {
            const target = event.target;
            if (target.id === 'sn-staff-filter') { state.staffFilter = target.value; renderList(); return; }
            if (target.id === 'sn-remind') {
                const value = /^\d{4}-\d{2}-\d{2}$/.test(target.value) ? target.value : null;
                editCurrent(note => { note.remindOn = value; }, true);
                return;
            }
            if (target.classList.contains('sn-item-check')) {
                const row = target.closest('.sn-item');
                const index = Number(row?.dataset.index);
                row?.classList.toggle('is-done', target.checked);
                editCurrent(note => { if (note.items[index]) note.items[index].done = target.checked; });
            }
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            // Enter trong một dòng việc → thêm dòng mới ngay dưới.
            if (event.key === 'Enter' && event.target.classList.contains('sn-item-text')) {
                event.preventDefault();
                const index = Number(event.target.closest('.sn-item')?.dataset.index);
                addItem(index + 1);
            }
        });
    }

    // Sửa ghi chú đang mở. rerender=true: vẽ lại khung soạn (đổi màu, ghim…); gõ chữ thì không
    // vẽ lại để giữ con trỏ.
    function editCurrent(mutate, rerender = false) {
        const note = currentNote();
        if (!note || state.tab === 'team' || note.staffId !== myId()) return;
        mutate(note);
        scheduleSave(note);
        if (rerender) renderEditor();
        refreshListOnly();
    }

    function addItem(at) {
        const note = currentNote();
        if (!note || note.items.length >= LIMITS.items) {
            if (note) toast(`Tối đa ${LIMITS.items} việc trong một ghi chú.`, 'warning');
            return;
        }
        const index = Number.isInteger(at) ? Math.min(at, note.items.length) : note.items.length;
        note.items.splice(index, 0, { text: '', done: false });
        scheduleSave(note);
        renderEditor();
        const inputs = document.querySelectorAll('#sn-items .sn-item-text');
        inputs[index]?.focus();
    }

    async function handleAction(act, event) {
        const note = currentNote();
        switch (act) {
            case 'close': return close();
            case 'new': return createNote();
            case 'back': state.selectedId = null; renderAll(); return;
            case 'pin': return editCurrent(item => { item.pinned = !item.pinned; }, true);
            case 'add-item': return addItem();
            case 'del-item': {
                const index = Number(event?.target?.closest?.('.sn-item')?.dataset.index);
                return editCurrent(item => { if (Number.isInteger(index)) item.items.splice(index, 1); }, true);
            }
            case 'stamp': {
                const area = $('sn-body');
                if (!area || !note) return;
                const d = new Date();
                const stamp = `[${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}] `;
                const start = area.selectionStart ?? area.value.length;
                const end = area.selectionEnd ?? start;
                area.value = area.value.slice(0, start) + stamp + area.value.slice(end);
                area.focus();
                area.selectionStart = area.selectionEnd = start + stamp.length;
                area.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
            case 'clear-remind': return editCurrent(item => { item.remindOn = null; }, true);
            case 'copy': return copyNote(note);
            case 'delete': return deleteNote(note);
            default: return undefined;
        }
    }

    function noteAsText(note) {
        const lines = [];
        if (note.title.trim()) lines.push(note.title.trim());
        if (note.body.trim()) lines.push(note.body.trim());
        note.items.filter(item => item.text.trim()).forEach(item => lines.push(`${item.done ? '☑' : '☐'} ${item.text.trim()}`));
        return lines.join('\n');
    }

    async function copyNote(note) {
        if (!note) return;
        const text = noteAsText(note);
        try {
            await navigator.clipboard.writeText(text);
            toast('Đã sao chép ghi chú', 'success');
        } catch (_) {
            const area = document.createElement('textarea');
            area.value = text;
            document.body.appendChild(area);
            area.select();
            try { document.execCommand('copy'); toast('Đã sao chép ghi chú', 'success'); } catch (__) { toast('Không sao chép được trên máy này', 'error'); }
            area.remove();
        }
    }

    async function deleteNote(note) {
        if (!note) return;
        const confirmFn = ui()?.confirm;
        const ok = confirmFn ? await confirmFn.call(ui(), `Xoá ghi chú “${esc(note.title.trim() || 'Không tiêu đề')}”? Không khôi phục lại được.`) : global.confirm('Xoá ghi chú này?');
        if (!ok) return;
        clearTimeout(state.pending.get(note.id));
        state.pending.delete(note.id);
        try {
            await (state.chains.get(note.id) || Promise.resolve()).catch(() => {});
            if (!note.isNew) await db().collection('staff_notes').doc(note.id).delete();
            state.notes = state.notes.filter(item => item !== note);
            state.selectedId = null;
            setStatus('');
            renderAll();
            toast('Đã xoá ghi chú', 'success');
        } catch (error) {
            console.warn('[StaffNotes] Xoá lỗi:', error);
            toast('Chưa xoá được. Kiểm tra mạng rồi thử lại.', 'error');
        }
    }

    function createNote() {
        if (!myId() || !db()) return toast('Vui lòng đăng nhập lại.', 'error');
        // Đã có nháp trống thì mở lại nó, không sinh thêm.
        let note = state.notes.find(item => item.isNew && isEmptyNote(item));
        if (!note) {
            note = normalizeNote(db().collection('staff_notes').doc().id, { staffId: myId(), staffName: myName() });
            note.isNew = true;
            state.notes.unshift(note);
        }
        state.tab = 'mine';
        state.filter = 'all';
        state.search = '';
        const search = $('sn-search');
        if (search) search.value = '';
        state.selectedId = note.id;
        setStatus('');
        renderAll();
        $('sn-title')?.focus();
    }

    function select(id) {
        state.selectedId = id;
        setStatus('');
        renderAll();
    }

    async function switchTab(tab) {
        if (tab === 'team' && !isNotesManager()) return;
        state.tab = tab;
        state.selectedId = null;
        state.filter = 'all';
        state.staffFilter = '';
        renderAll();
        try {
            if (tab === 'team') await loadTeam(true); else await loadMine();
        } catch (error) {
            console.warn('[StaffNotes] Tải lỗi:', error);
            toast('Không tải được ghi chú. Kiểm tra mạng rồi thử lại.', 'error');
        }
        renderAll();
    }

    async function open(options = {}) {
        ensureDialog();
        state.open = true;
        $('sn-overlay').hidden = false;
        document.body.classList.add('sn-lock');
        if (options.tab) state.tab = options.tab;
        if (options.noteId) state.selectedId = options.noteId;
        renderAll();
        try {
            await (state.tab === 'team' ? loadTeam(true) : loadMine());
        } catch (error) {
            console.warn('[StaffNotes] Tải lỗi:', error);
            toast('Không tải được ghi chú. Kiểm tra mạng rồi thử lại.', 'error');
        }
        renderAll();
        if (options.create) createNote();
    }

    function close() {
        flushAll();
        // Nháp chưa gõ gì thì bỏ.
        state.notes = state.notes.filter(note => !(note.isNew && isEmptyNote(note)));
        state.open = false;
        const overlay = $('sn-overlay');
        if (overlay) overlay.hidden = true;
        document.body.classList.remove('sn-lock');
        renderHomeCard();
    }

    // ---------- Thẻ ở trang chủ ----------
    function renderHomeCard() {
        const card = $('staff-notes-card');
        if (!card) return;
        const body = card.querySelector('.sn-home-list');
        const meta = card.querySelector('.sn-home-meta');
        if (!state.loaded) return;
        const saved = state.notes.filter(note => !isEmptyNote(note));
        const today = todayKey();
        const due = saved.filter(note => note.remindOn && note.remindOn <= today).length;
        if (meta) meta.innerHTML = saved.length
            ? `${saved.length} ghi chú${due ? ` · <strong class="sn-due">${due} cần nhắc</strong>` : ''}`
            : 'Ghi lại việc cần làm, số điện thoại, dặn dò… chỉ mình bạn (và Admin) xem được.';
        if (body) {
            const top = sortNotes(saved).sort((a, b) => {
                const aDue = a.remindOn && a.remindOn <= today ? 1 : 0;
                const bDue = b.remindOn && b.remindOn <= today ? 1 : 0;
                return bDue - aDue;
            }).slice(0, 4);
            body.innerHTML = top.map(note => noteCard(note, true)).join('');
            body.hidden = top.length === 0;
        }
    }

    function mountHome() {
        const card = $('staff-notes-card');
        if (card && !card.dataset.ready) {
            card.dataset.ready = '1';
            card.innerHTML = `
                <div class="sn-home-head">
                    <div>
                        <h2 class="nv-panel-title">${icon(ICONS.note, 20)} Ghi chú của tôi</h2>
                        <p class="sn-home-meta">Đang tải…</p>
                    </div>
                    <div class="sn-home-actions">
                        <button type="button" class="btn btn-ghost" data-sn-open>Mở sổ</button>
                        <button type="button" class="btn btn-primary" data-sn-new>${icon(ICONS.plus, 16)} Ghi chú mới</button>
                    </div>
                </div>
                <div class="sn-home-list" hidden></div>`;
            card.addEventListener('click', event => {
                const cardBtn = event.target.closest('[data-note-id]');
                if (cardBtn) return open({ tab: 'mine', noteId: cardBtn.dataset.noteId });
                if (event.target.closest('[data-sn-new]')) return open({ tab: 'mine', create: true });
                if (event.target.closest('[data-sn-open]')) return open({ tab: 'mine' });
                return undefined;
            });
            card.hidden = false;
            loadMine().then(renderHomeCard).catch(error => {
                console.warn('[StaffNotes] Tải lỗi:', error);
                const meta = card.querySelector('.sn-home-meta');
                if (meta) meta.textContent = 'Chưa tải được ghi chú — bấm Mở sổ để thử lại.';
            });
        }
        document.querySelectorAll('[data-staff-notes-button]').forEach(btn => {
            if (btn.dataset.ready) return;
            btn.dataset.ready = '1';
            btn.hidden = false;
            if (btn.dataset.staffNotesButton === 'team' && !isNotesManager()) {
                const label = btn.querySelector('span');
                if (label) label.textContent = 'Ghi chú của tôi';
            }
            btn.addEventListener('click', () => open({ tab: btn.dataset.staffNotesButton === 'team' && isNotesManager() ? 'team' : 'mine' }));
        });
    }

    function boot() {
        if (!global.db || typeof firebase === 'undefined' || !myId()) {
            boot.tries = (boot.tries || 0) + 1;
            if (boot.tries < 60) setTimeout(boot, 250);
            return;
        }
        // Chỉ cần đăng nhập Firebase xong là đọc được; đợi auth để không bị từ chối quyền.
        const auth = firebase.auth?.();
        if (auth && !auth.currentUser) {
            const stop = auth.onAuthStateChanged(user => { if (user) { stop(); mountHome(); } });
            return;
        }
        mountHome();
    }

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
    global.addEventListener('pagehide', () => flushAll());
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

    global.StaffNotes = { open, close, normalizeNote, isEmptyNote, sortNotes, noteAsText, _state: state };
})(window);
