// Ngày nghỉ lễ / nghỉ trung tâm — thao tác HÀNG LOẠT cho người xếp lịch (27/09/2026).
//
// Nguồn sự thật đã có từ trước và mọi trang đang đọc: settings/system.centerClosures
//   { 'YYYY-MM-DD': ['all' | 'morning' | 'afternoon' | 'evening' | 'morning1' | ...] }
// Lịch dạy, lịch tiếp tân/văn phòng, Bảng Công, tự ra ca và nhắc vào ca đều coi ca thuộc phạm vi
// này là "trung tâm nghỉ": ai không chấm công hiện "(Nghỉ)" — KHÔNG tính vắng (kể cả báo nghỉ
// VP/VĐX cũ); ai vẫn đi làm vẫn tính công bình thường. Trước đây chỉ tắt được từng ca của từng
// ngày trong trang xếp lịch và không sửa được ngày đã qua.
// Tên ngày nghỉ (không bắt buộc) lưu ở settings/system.centerHolidayNames['YYYY-MM-DD'].
// Firestore Rules: người xếp lịch (admin, trợ lý cấp cao, trợ lý) đã được cập nhật settings.
(function (global) {
    'use strict';

    const SCOPES = {
        all: { keys: ['all'], label: 'Cả ngày', short: 'Cả ngày' },
        morning: { keys: ['morning'], label: 'Buổi sáng', short: 'Sáng' },
        afternoon: { keys: ['afternoon'], label: 'Buổi chiều', short: 'Chiều' },
        evening: { keys: ['evening'], label: 'Buổi tối', short: 'Tối' }
    };
    const SECTION_LABELS = {
        morning1: 'Sáng ca 1', morning2: 'Sáng ca 2',
        afternoon1: 'Chiều ca 1', afternoon2: 'Chiều ca 2',
        evening1: 'Tối ca 1', evening2: 'Tối ca 2'
    };
    const MAX_RANGE_DAYS = 62;
    const NAME_MAX = 40;
    const LIST_LOOKBACK_DAYS = 60;
    const DAY_MS = 24 * 60 * 60 * 1000;
    // ui-service.js / db-service.js khai báo `const UIService` / `const DBService` ở phạm vi toàn cục
    // của script (KHÔNG gắn vào window) → phải đọc qua định danh, không qua window.UIService.
    const uiService = () => (typeof UIService !== 'undefined' ? UIService : global.UIService) || null;
    const dbService = () => (typeof DBService !== 'undefined' ? DBService : global.DBService) || null;
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    function parseDateKey(value) {
        const text = String(value || '').trim();
        if (!DATE_RE.test(text)) return null;
        const [y, m, d] = text.split('-').map(Number);
        const date = new Date(Date.UTC(y, m - 1, d));
        return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
    }
    function toDateKey(date) { return date.toISOString().slice(0, 10); }
    // Ngày "hôm nay" theo giờ Việt Nam (máy admin có thể đặt múi giờ khác).
    function todayKey(now = new Date()) {
        if (typeof global.getLocalDateKeyFromDate === 'function') return global.getLocalDateKeyFromDate(now);
        return toDateKey(new Date(now.getTime() + 7 * 60 * 60 * 1000));
    }
    function formatDate(dateKey, withYear = true) {
        const date = parseDateKey(dateKey);
        if (!date) return String(dateKey || '');
        const [y, m, d] = dateKey.split('-');
        return `${WEEKDAYS[date.getUTCDay()]} ${d}/${m}${withYear ? '/' + y : ''}`;
    }
    function formatShort(dateKey, withYear = true) {
        const [y, m, d] = String(dateKey || '').split('-');
        return withYear ? `${d}/${m}/${y}` : `${d}/${m}`;
    }
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function expandDateRange(from, to) {
        const start = parseDateKey(from);
        const end = parseDateKey(to || from);
        if (!start || !end) throw new Error('Vui lòng chọn ngày hợp lệ.');
        if (end < start) throw new Error('"Đến ngày" phải bằng hoặc sau "Từ ngày".');
        const days = Math.round((end - start) / DAY_MS) + 1;
        if (days > MAX_RANGE_DAYS) throw new Error(`Mỗi lần chỉ đặt tối đa ${MAX_RANGE_DAYS} ngày.`);
        return Array.from({ length: days }, (_, index) => toDateKey(new Date(start.getTime() + index * DAY_MS)));
    }
    function normalizeName(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    }
    // Ngày lễ chính thức cố định (dùng cho nhãn và gợi ý). Năm 2026 Quốc khánh nghỉ 01–02/09.
    function officialHolidayName(dateKey) {
        const date = parseDateKey(dateKey);
        if (!date) return '';
        const m = date.getUTCMonth() + 1;
        const d = date.getUTCDate();
        if (m === 1 && d === 1) return 'Tết Dương lịch';
        if (m === 4 && d === 30) return 'Giải phóng miền Nam';
        if (m === 5 && d === 1) return 'Quốc tế Lao động';
        if (m === 9 && d === 2) return 'Quốc khánh';
        if (dateKey === '2026-09-01') return 'Quốc khánh';
        return '';
    }
    function describeKeys(keys) {
        const list = Array.isArray(keys) ? keys : [];
        if (list.includes('all')) return SCOPES.all.label;
        const parts = [];
        ['morning', 'afternoon', 'evening'].forEach(period => {
            if (list.includes(period)) parts.push(SCOPES[period].label);
            else [1, 2].forEach(n => { if (list.includes(period + n)) parts.push(SECTION_LABELS[period + n]); });
        });
        return parts.join(', ');
    }
    // Tên hiển thị của ngày nghỉ: tên người xếp lịch đặt (chỉ khi ngày đó còn đang nghỉ) →
    // tên ngày lễ chính thức → "Trung tâm nghỉ" nếu nghỉ cả ngày.
    function holidayLabel(dateKey, settings) {
        const names = settings?.centerHolidayNames || {};
        const keys = settings?.centerClosures?.[dateKey];
        const closed = Array.isArray(keys) && keys.length > 0;
        const custom = closed ? normalizeName(names[dateKey]) : '';
        return custom || officialHolidayName(dateKey) || (closed && keys.includes('all') ? 'Trung tâm nghỉ' : '');
    }

    // Các trường cần ghi (đường dẫn 'centerClosures.YYYY-MM-DD'). Chỉ THÊM phạm vi nghỉ, không
    // bỏ ca đã tắt riêng trước đó. Hàm thuần để test được.
    function planApply(settings, dates, scope, name) {
        const cfg = SCOPES[scope];
        if (!cfg) throw new Error('Phạm vi nghỉ không hợp lệ.');
        if (!Array.isArray(dates) || dates.length === 0) throw new Error('Vui lòng chọn ngày nghỉ.');
        dates.forEach(date => { if (!parseDateKey(date)) throw new Error('Ngày không hợp lệ.'); });
        const closures = settings?.centerClosures || {};
        const cleanName = normalizeName(name);
        const updates = {};
        const nextClosures = { ...closures };
        const nextNames = { ...(settings?.centerHolidayNames || {}) };
        const changed = [];
        dates.forEach(date => {
            const current = Array.isArray(closures[date]) ? closures[date] : [];
            const next = [...new Set([...current, ...cfg.keys])];
            if (next.length !== current.length) changed.push(date);
            updates[`centerClosures.${date}`] = next;
            nextClosures[date] = next;
            if (cleanName) {
                updates[`centerHolidayNames.${date}`] = cleanName;
                nextNames[date] = cleanName;
            }
        });
        return { updates, changed, closures: nextClosures, names: nextNames, name: cleanName };
    }
    // Mở lại (bỏ nghỉ) cả ngày: xoá mọi phạm vi nghỉ + tên của ngày đó.
    function planRemove(settings, date, deleteValue) {
        if (!parseDateKey(date)) throw new Error('Ngày không hợp lệ.');
        const closures = { ...(settings?.centerClosures || {}) };
        const names = { ...(settings?.centerHolidayNames || {}) };
        const previous = Array.isArray(closures[date]) ? closures[date].slice() : [];
        delete closures[date];
        delete names[date];
        return {
            updates: { [`centerClosures.${date}`]: deleteValue, [`centerHolidayNames.${date}`]: deleteValue },
            previous,
            closures,
            names
        };
    }
    function listEntries(settings, options = {}) {
        const closures = settings?.centerClosures || {};
        const from = options.from || '';
        return Object.keys(closures)
            .filter(date => parseDateKey(date) && Array.isArray(closures[date]) && closures[date].length > 0 && (!from || date >= from))
            .sort()
            .map(date => ({
                date,
                keys: closures[date].slice(),
                scopeLabel: describeKeys(closures[date]) || closures[date].join(', '),
                name: holidayLabel(date, settings)
            }));
    }
    // Gợi ý nhanh: ngày lễ chính thức trong khoảng 60 ngày trước → 200 ngày tới.
    function presetHolidays(now = new Date()) {
        const base = parseDateKey(todayKey(now));
        if (!base) return [];
        const year = base.getUTCFullYear();
        const items = [];
        [year - 1, year, year + 1].forEach(y => {
            items.push({ from: `${y}-01-01`, to: `${y}-01-01`, name: 'Tết Dương lịch' });
            items.push({ from: `${y}-04-30`, to: `${y}-05-01`, name: 'Lễ 30/4 – 1/5' });
            items.push(y === 2026
                ? { from: '2026-09-01', to: '2026-09-02', name: 'Quốc khánh' }
                : { from: `${y}-09-02`, to: `${y}-09-02`, name: 'Quốc khánh' });
        });
        const min = toDateKey(new Date(base.getTime() - LIST_LOOKBACK_DAYS * DAY_MS));
        const max = toDateKey(new Date(base.getTime() + 200 * DAY_MS));
        return items.filter(item => item.to >= min && item.from <= max).sort((a, b) => a.from.localeCompare(b.from));
    }

    // ---------------- Ghi Firestore (transaction trên settings/system) ----------------
    function systemRef() {
        if (!global.db || typeof global.db.collection !== 'function') throw new Error('Chưa kết nối được hệ thống. Vui lòng tải lại trang.');
        return global.db.collection('settings').doc('system');
    }
    function auditFields() {
        const fieldValue = global.firebase?.firestore?.FieldValue;
        let actorName = '';
        let actorId = '';
        try {
            actorName = global.localStorage?.getItem('userFullName') || global.localStorage?.getItem('currentUser') || '';
            actorId = global.localStorage?.getItem('currentUserId') || '';
        } catch (_) { /* bộ nhớ bị chặn: vẫn ghi được, chỉ thiếu tên người sửa */ }
        return {
            centerClosuresUpdatedAt: fieldValue ? fieldValue.serverTimestamp() : new Date().toISOString(),
            centerClosuresUpdatedBy: { id: actorId, name: actorName }
        };
    }
    function afterWrite(closures, names) {
        global.centerClosures = closures;
        global.centerHolidayNames = names;
        try { dbService()?._invalidate?.('system_settings'); } catch (_) { /* không sao */ }
        if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
            global.dispatchEvent(new global.CustomEvent('tdt:center-closures-changed', { detail: { closures, names } }));
        }
    }
    // Trang Xếp Lịch: vẽ lại 7 ngày + bảng lớp để thấy ngay trạng thái nghỉ mới.
    if (typeof global.addEventListener === 'function') {
        global.addEventListener('tdt:center-closures-changed', () => {
            if (typeof document === 'undefined') return;
            if (typeof global.renderDayTabs === 'function' && document.getElementById('day-tabs')) global.renderDayTabs();
            if (typeof global.renderTable === 'function' && document.getElementById('schedule-table')) global.renderTable();
        });
    }
    async function applyRange({ from, to, scope, name }) {
        const dates = expandDateRange(from, to);
        const ref = systemRef();
        const result = await global.db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw new Error('Không tìm thấy cấu hình hệ thống.');
            const plan = planApply(snapshot.data() || {}, dates, scope, name);
            transaction.update(ref, { ...plan.updates, ...auditFields() });
            return { ...plan, dates };
        });
        afterWrite(result.closures, result.names);
        return result;
    }
    async function reopenDate(date) {
        const ref = systemRef();
        const deleteValue = global.firebase?.firestore?.FieldValue?.delete?.();
        if (!deleteValue) throw new Error('Chưa tải xong thư viện hệ thống. Vui lòng tải lại trang.');
        const result = await global.db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) throw new Error('Không tìm thấy cấu hình hệ thống.');
            const plan = planRemove(snapshot.data() || {}, date, deleteValue);
            transaction.update(ref, { ...plan.updates, ...auditFields() });
            return plan;
        });
        afterWrite(result.closures, result.names);
        return result;
    }

    // ---------------- Giao diện (bảng chọn dạng sheet trên điện thoại) ----------------
    const ICONS = {
        flag: '<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>',
        close: '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        info: '<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };
    let openState = null;

    function toast(message, type) {
        const ui = uiService();
        if (ui?.toast) ui.toast(escapeHtml(message), type);
        else if (typeof global.alert === 'function') global.alert(message);
    }
    async function confirmAction(message) {
        const ui = uiService();
        if (ui?.confirm) return ui.confirm(escapeHtml(message).replace(/\n/g, '<br>'));
        return typeof global.confirm === 'function' ? global.confirm(message) : false;
    }
    function rangeSummary(from, to, scope) {
        let dates;
        try { dates = expandDateRange(from, to); } catch (error) { return { ok: false, text: from ? error.message : 'Chọn ngày bắt đầu và kết thúc.' }; }
        const scopeLabel = SCOPES[scope]?.label || '';
        const span = dates.length === 1
            ? formatDate(dates[0])
            : `${formatDate(dates[0], dates[0].slice(0, 4) !== dates[dates.length - 1].slice(0, 4))} → ${formatDate(dates[dates.length - 1])}`;
        const past = dates.filter(date => date < todayKey()).length;
        return {
            ok: true,
            dates,
            text: `${dates.length} ngày · ${span} · ${scopeLabel}`,
            past
        };
    }

    function renderList(state) {
        const listEl = state.root.querySelector('[data-ch-list]');
        if (!listEl) return;
        const from = toDateKey(new Date(parseDateKey(todayKey()).getTime() - LIST_LOOKBACK_DAYS * DAY_MS));
        const entries = listEntries(state.settings, { from });
        if (entries.length === 0) {
            listEl.innerHTML = '<li class="ch-empty">Chưa có ngày nghỉ nào trong 60 ngày qua và sắp tới.</li>';
            return;
        }
        const today = todayKey();
        listEl.innerHTML = entries.map(entry => `
            <li class="ch-item${entry.date < today ? ' is-past' : ''}">
                <div class="ch-item-date"><strong>${escapeHtml(formatDate(entry.date))}</strong>${entry.date < today ? '<span class="ch-tag">Đã qua</span>' : ''}</div>
                <div class="ch-item-meta">${escapeHtml(entry.scopeLabel)}${entry.name ? ' · ' + escapeHtml(entry.name) : ''}</div>
                <button type="button" class="ch-reopen" data-ch-reopen="${escapeHtml(entry.date)}">Mở lại</button>
            </li>`).join('');
    }
    function updateSummary(state) {
        const form = state.root.querySelector('form');
        const summaryEl = state.root.querySelector('[data-ch-summary]');
        const submit = state.root.querySelector('[data-ch-submit]');
        const summary = rangeSummary(form.elements.from.value, form.elements.to.value || form.elements.from.value, form.elements.scope.value);
        summaryEl.classList.toggle('is-error', !summary.ok && !!form.elements.from.value);
        summaryEl.innerHTML = summary.ok
            ? `<strong>${escapeHtml(summary.text)}</strong>${summary.past ? `<span class="ch-summary-note">Có ${summary.past} ngày đã qua: Bảng Công các ngày này sẽ hiện "(Nghỉ)" thay cho vắng. Bảng lương đã gửi không tự thay đổi.</span>` : ''}`
            : escapeHtml(summary.text);
        submit.disabled = !summary.ok || state.busy;
    }
    async function loadSettings(state) {
        const listEl = state.root.querySelector('[data-ch-list]');
        if (listEl) listEl.innerHTML = '<li class="ch-empty">Đang tải…</li>';
        try {
            const snapshot = await systemRef().get({ source: 'server' });
            state.settings = snapshot.exists ? (snapshot.data() || {}) : {};
            renderList(state);
        } catch (error) {
            console.error('[CenterHolidays] load failed:', error);
            if (listEl) listEl.innerHTML = '<li class="ch-empty ch-empty--error">Chưa tải được danh sách. Kiểm tra mạng rồi mở lại.</li>';
        }
    }
    function setBusy(state, busy) {
        state.busy = busy;
        state.root.querySelectorAll('button, input').forEach(el => {
            if (el.matches('[data-ch-close]')) return;
            el.disabled = busy;
        });
        if (!busy) updateSummary(state);
    }
    function closeManager() {
        if (!openState) return;
        const { root, keyHandler, returnFocus } = openState;
        document.removeEventListener('keydown', keyHandler);
        root.remove();
        document.documentElement.classList.remove('ch-open');
        openState = null;
        if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
    }

    function openManager() {
        if (openState) return;
        const root = document.createElement('div');
        root.className = 'ch-backdrop';
        const presets = presetHolidays();
        const today = todayKey();
        root.innerHTML = `
            <section class="ch-sheet" role="dialog" aria-modal="true" aria-labelledby="ch-title">
                <header class="ch-head">
                    <span class="ch-head-icon">${ICONS.flag}</span>
                    <div class="ch-head-text">
                        <h2 id="ch-title">Ngày nghỉ lễ</h2>
                        <p>Áp dụng cho cả 3 cơ sở và toàn bộ nhân viên</p>
                    </div>
                    <button type="button" class="ch-close" data-ch-close aria-label="Đóng">${ICONS.close}</button>
                </header>
                <div class="ch-body">
                    <p class="ch-info">${ICONS.info}<span>Ngày nghỉ: ai không chấm công sẽ hiện <strong>(Nghỉ)</strong>, không tính vắng (kể cả đã báo nghỉ trước). Ai vẫn đi làm vẫn được tính công như thường.</span></p>
                    ${presets.length ? `<div class="ch-presets"><span class="ch-label">Chọn nhanh</span><div class="ch-preset-row">${presets.map(p => `
                        <button type="button" class="ch-preset" data-from="${p.from}" data-to="${p.to}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}<small>${escapeHtml(p.from === p.to ? formatShort(p.from) : `${formatShort(p.from, false)} – ${formatShort(p.to)}`)}</small></button>`).join('')}</div></div>` : ''}
                    <form class="ch-form" novalidate>
                        <div class="ch-grid2">
                            <label class="ch-field"><span>Từ ngày</span><input type="date" name="from" value="${today}" required></label>
                            <label class="ch-field"><span>Đến ngày</span><input type="date" name="to" value="${today}" required></label>
                        </div>
                        <fieldset class="ch-field ch-scope">
                            <legend>Phạm vi nghỉ</legend>
                            <div class="ch-seg" role="radiogroup">
                                ${Object.entries(SCOPES).map(([key, cfg]) => `<label><input type="radio" name="scope" value="${key}"${key === 'all' ? ' checked' : ''}><span>${cfg.short}</span></label>`).join('')}
                            </div>
                        </fieldset>
                        <label class="ch-field"><span>Tên ngày nghỉ <em>(không bắt buộc)</em></span><input type="text" name="name" maxlength="${NAME_MAX}" placeholder="VD: Quốc khánh" autocomplete="off"></label>
                        <p class="ch-summary" data-ch-summary aria-live="polite"></p>
                        <button type="submit" class="btn btn-primary ch-submit" data-ch-submit>Áp dụng cho toàn trung tâm</button>
                    </form>
                    <h3 class="ch-list-title">Ngày nghỉ đã đặt</h3>
                    <ul class="ch-list" data-ch-list></ul>
                </div>
            </section>`;
        const state = { root, settings: {}, busy: false, returnFocus: document.activeElement };
        state.keyHandler = event => { if (event.key === 'Escape' && !state.busy) closeManager(); };
        openState = state;
        document.body.appendChild(root);
        document.documentElement.classList.add('ch-open');
        document.addEventListener('keydown', state.keyHandler);

        const form = root.querySelector('form');
        root.addEventListener('click', event => {
            if (event.target === root && !state.busy) { closeManager(); return; }
            if (event.target.closest('[data-ch-close]')) { if (!state.busy) closeManager(); return; }
            const preset = event.target.closest('.ch-preset');
            if (preset) {
                form.elements.from.value = preset.dataset.from;
                form.elements.to.value = preset.dataset.to;
                form.elements.name.value = preset.dataset.name || '';
                form.elements.scope.value = 'all';
                updateSummary(state);
                return;
            }
            const reopen = event.target.closest('[data-ch-reopen]');
            if (reopen) handleReopen(state, reopen.dataset.chReopen);
        });
        form.addEventListener('input', () => {
            // Chọn "Từ ngày" sau "Đến ngày" → kéo "Đến ngày" theo cho khỏi báo lỗi.
            if (form.elements.from.value && form.elements.to.value && form.elements.to.value < form.elements.from.value) {
                form.elements.to.value = form.elements.from.value;
            }
            updateSummary(state);
        });
        form.addEventListener('submit', event => { event.preventDefault(); handleApply(state); });
        updateSummary(state);
        loadSettings(state);
        const firstInput = form.elements.from;
        if (firstInput && typeof firstInput.focus === 'function') setTimeout(() => firstInput.focus({ preventScroll: true }), 50);
    }

    async function handleApply(state) {
        if (state.busy) return;
        const form = state.root.querySelector('form');
        const from = form.elements.from.value;
        const to = form.elements.to.value || from;
        const scope = form.elements.scope.value;
        const name = normalizeName(form.elements.name.value);
        const summary = rangeSummary(from, to, scope);
        if (!summary.ok) { toast(summary.text, 'warning'); return; }
        const lines = [
            `Cho nghỉ ${summary.text}${name ? ` (${name})` : ''} tại cả 3 cơ sở?`,
            'Toàn bộ nhân viên không chấm công các ngày này sẽ hiện "(Nghỉ)", không tính vắng. Ai vẫn đi làm vẫn được tính công.'
        ];
        if (summary.past) lines.push(`Có ${summary.past} ngày đã qua: Bảng Công sẽ tính lại hiển thị; bảng lương đã gửi không tự thay đổi.`);
        if (!(await confirmAction(lines.join('\n')))) return;
        setBusy(state, true);
        try {
            const result = await applyRange({ from, to, scope, name });
            state.settings = { ...state.settings, centerClosures: result.closures, centerHolidayNames: result.names };
            renderList(state);
            toast(`Đã đặt nghỉ ${result.dates.length} ngày cho toàn trung tâm.`, 'success');
        } catch (error) {
            console.error('[CenterHolidays] apply failed:', error);
            toast(permissionMessage(error) || error.message || 'Không lưu được ngày nghỉ.', 'error');
        } finally {
            if (openState === state) setBusy(state, false);
        }
    }
    async function handleReopen(state, date) {
        if (state.busy || !date) return;
        const entry = listEntries(state.settings).find(item => item.date === date);
        const label = `${formatDate(date)}${entry?.name ? ` (${entry.name})` : ''}`;
        if (!(await confirmAction(`Mở lại ${label} cho cả 3 cơ sở?\nBỏ trạng thái nghỉ (${entry?.scopeLabel || 'cả ngày'}): ai được xếp lịch mà không chấm công sẽ lại hiện vắng như ngày thường.`))) return;
        setBusy(state, true);
        try {
            const result = await reopenDate(date);
            state.settings = { ...state.settings, centerClosures: result.closures, centerHolidayNames: result.names };
            renderList(state);
            toast(`Đã mở lại ${formatDate(date)}.`, 'success');
        } catch (error) {
            console.error('[CenterHolidays] reopen failed:', error);
            toast(permissionMessage(error) || error.message || 'Không mở lại được ngày này.', 'error');
        } finally {
            if (openState === state) setBusy(state, false);
        }
    }
    function permissionMessage(error) {
        const code = String(error?.code || '');
        if (code.includes('permission-denied')) return 'Tài khoản này không có quyền đặt ngày nghỉ cho trung tâm.';
        if (code.includes('unavailable') || code.includes('deadline-exceeded')) return 'Mạng đang chập chờn, chưa lưu được. Vui lòng thử lại.';
        return '';
    }

    global.CenterHolidays = {
        SCOPES,
        MAX_RANGE_DAYS,
        expandDateRange,
        normalizeName,
        officialHolidayName,
        describeKeys,
        holidayLabel,
        planApply,
        planRemove,
        listEntries,
        presetHolidays,
        applyRange,
        reopenDate,
        openManager,
        closeManager
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = global.CenterHolidays;
})(typeof window !== 'undefined' ? window : globalThis);
