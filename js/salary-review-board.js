/* One-page salary review board: who is due, current rate, hours, one-step decisions.
   Every write goes through SalaryReviewService (transactions + audit history). */
(function () {
    'use strict';
    const P = window.SalaryReviewPolicy, O = window.SalaryReviewOverviewPolicy;
    const B = window.SalaryReviewBoardPolicy, S = window.SalaryReviewService;
    const $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = value => value == null || value === '' ? 'Chưa rõ' : Number(value).toLocaleString('vi-VN') + 'đ';
    const hours = value => value == null ? '—' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' giờ';
    const vnDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value.split('-').reverse().join('/') : '';
    const vnMonth = value => /^\d{4}-\d{2}$/.test(String(value || '')) ? 'Tháng ' + Number(value.slice(5)) + '/' + value.slice(0, 4) : '';
    const today = () => P.dateKey();
    const TABS = [['due', 'Đến hạn'], ['soon', 'Sắp đến hạn'], ['setup', 'Chưa có mốc'], ['pending', 'Chờ hiệu lực'], ['all', 'Tất cả']];
    const state = { index: null, monthlyByStaff: {}, legacyByStaff: {}, rows: [], tab: 'due', query: '', selected: new Set(),
        open: '', drafts: {}, bulk: null, busy: false, loading: false, epoch: 0, results: {} };

    function message(text, isError = false) {
        const el = $('srb-message');
        el.textContent = text || '';
        el.classList.toggle('error', !!isError);
    }
    function targetMonths() {
        const first = P.addMonths(today().slice(0, 7) + '-01', 1);
        return [0, 1, 2].map(i => P.addMonths(first, i).slice(0, 7));
    }
    function rowByKey(key) { return state.rows.find(row => row.key === key); }
    function draftFor(row) {
        if (!state.drafts[row.key]) state.drafts[row.key] = { rate: row.nextRate ?? '', month: targetMonths()[0], note: '',
            baseline: row.baselineDate || today(), mode: '', reason: '', nextDate: P.addMonths(today(), row.evaluation?.months || 3) };
        return state.drafts[row.key];
    }

    // ---------- data ----------
    async function loadSources(index) {
        const epoch = ++state.epoch;
        state.loading = true; state.index = index; render();
        message('Đang tải giá và giờ dạy của tất cả giáo viên…');
        try {
            const now = today(), months = [now.slice(0, 7), ...P.previousMonths(now, 6)];
            const [maps, legacy] = await Promise.all([
                Promise.all(months.map(month => DBService.getAllMonthlySalarySettings(month, { strict: true }))),
                S.all('salary_settings')
            ]);
            if (epoch !== state.epoch) return;
            const byStaff = {};
            months.forEach((month, i) => Object.entries(maps[i] || {}).forEach(([staffId, data]) => {
                (byStaff[staffId] = byStaff[staffId] || []).push({ ...data, id: month + '_' + staffId });
            }));
            state.monthlyByStaff = byStaff;
            state.legacyByStaff = Object.fromEntries(legacy.map(doc => [doc.id, doc]));
            rebuild();
            message('');
        } catch (error) {
            if (epoch === state.epoch) message('Chưa tải được giá và giờ dạy: ' + error.message + ' Bấm Tải lại để thử lại.', true);
        } finally {
            if (epoch === state.epoch) { state.loading = false; render(); }
        }
    }
    function rebuild() {
        if (!state.index) return;
        state.rows = B.buildRows({ users: state.index.users, subjects: state.index.subjects, profiles: state.index.profiles,
            config: state.index.config, monthlyByStaff: state.monthlyByStaff, legacyByStaff: state.legacyByStaff, today: today(),
            policy: P, overview: O, lifecycle: DBService.getPayslipLifecycleState, rateResolver: window.SubjectRatePolicy });
        const keys = new Set(state.rows.map(row => row.key));
        [...state.selected].forEach(key => { if (!keys.has(key)) state.selected.delete(key); });
        if (state.open && !keys.has(state.open)) state.open = '';
    }
    async function freshProfile(staffId) {
        const data = await S.read(S.document('salary_review_profiles', staffId));
        const profile = data ? { ...data, staffId } : { revision: 0, groups: [], personOverrides: {}, staffId };
        const list = state.index.profiles, index = list.findIndex(p => (p.staffId || p.id) === staffId);
        if (index < 0) list.push(profile); else list[index] = profile;
        window.dispatchEvent(new CustomEvent('salary-review-profiles-changed', { detail: { staffId, profile } }));
        return profile;
    }
    // A review group must be saved and confirmed before any decision. The board
    // does it for the Admin, using the baseline shown on the row.
    async function ensureConfirmed(row, baselineDate) {
        const profile = await freshProfile(row.staffId);
        const saved = (profile.groups || []).find(g => g.id === row.group.id);
        if (saved?.scheduledChange?.effectiveFrom > today()) throw Error('Nhóm này đã có mức mới chờ hiệu lực. Mở Chi tiết nếu cần hủy.');
        const wantedBaseline = baselineDate || (saved?.confirmed ? saved.baselineDate : row.baselineDate);
        if (saved?.confirmed && saved.enabled !== false && wantedBaseline === saved.baselineDate) return profile;
        if (!P.validDate(wantedBaseline) || wantedBaseline > today()) throw Error('Mốc tính hạn xét phải là ngày hợp lệ, không sau hôm nay.');
        const draft = B.confirmDraft(profile, [{ group: saved || row.group, baselineDate: wantedBaseline }]);
        await S.saveProfile(row.staffId, draft, profile.revision || 0, state.index.subjects);
        return freshProfile(row.staffId);
    }

    // ---------- writes ----------
    async function withWrite(action) {
        if (state.busy) return;
        state.busy = true; window.__payrollWritePending = true; $('srb').inert = true; render();
        try { await action(); }
        catch (error) { message(error.message || 'Chưa lưu được. Dữ liệu chưa thay đổi.', true); }
        finally { state.busy = false; window.__payrollWritePending = false; $('srb').inert = false; rebuild(); render(); }
    }
    function checkRate(value, row) {
        const rate = Number(value);
        if (!Number.isSafeInteger(rate) || rate <= 0 || rate > 10000000) throw Error('Nhập mức mới là số tiền đ/giờ, ví dụ 34000.');
        if (row.currentRate != null && rate <= row.currentRate) throw Error(`Mức mới phải cao hơn mức hiện tại ${money(row.currentRate)}.`);
        return rate;
    }
    async function approve(row, draft) {
        const rate = checkRate(draft.rate, row);
        const profile = await ensureConfirmed(row, row.confirmed ? '' : draft.baseline);
        const group = profile.groups.find(g => g.id === row.group.id);
        const prepared = await S.prepareApplication(row.staffId, group.id, { newRate: rate, targetMonth: draft.month,
            selectedSubjectIds: group.subjectIds.slice(), reason: draft.note.trim() || 'Tăng theo kỳ xét' }, profile.revision);
        const problems = B.previewProblems(prepared.preview.changes, new Map(row.subjects.map(s => [s.id, s.rate])), rate);
        if (problems.length) throw Error('Chưa duyệt. ' + problems.join('; ') + '. Mở Chi tiết để kiểm tra từng môn.');
        await S.applyApplication(prepared);
        await freshProfile(row.staffId);
        return { rate, month: draft.month };
    }
    async function defer(row, reason, nextDate) {
        const profile = await ensureConfirmed(row, row.confirmed ? '' : draftFor(row).baseline);
        await S.decide(row.staffId, row.group.id, { kind: 'deferred', reason, nextReviewDate: nextDate }, profile.revision);
        await freshProfile(row.staffId);
    }
    async function notIncreased(row, reason, nextDate) {
        if (!reason.trim()) throw Error('Nhập lý do chưa tăng.');
        if (!P.validDate(nextDate) || nextDate <= today()) throw Error('Chọn ngày xét lại sau hôm nay.');
        const profile = await ensureConfirmed(row, row.confirmed ? '' : draftFor(row).baseline);
        await S.decide(row.staffId, row.group.id, { kind: 'not_increased', reason: reason.trim(), nextReviewDate: nextDate }, profile.revision);
        await freshProfile(row.staffId);
    }
    async function startTracking(rows) {
        const byStaff = new Map();
        rows.forEach(row => byStaff.set(row.staffId, (byStaff.get(row.staffId) || []).concat(row)));
        let done = 0; const failed = [];
        for (const [staffId, items] of byStaff) {
            try {
                const profile = await freshProfile(staffId);
                const entries = items.map(row => ({ group: (profile.groups || []).find(g => g.id === row.group.id) || row.group,
                    baselineDate: state.drafts[row.key]?.baseline || row.baselineDate }));
                if (entries.some(e => !P.validDate(e.baselineDate) || e.baselineDate > today())) throw Error('Mốc không hợp lệ.');
                await S.saveProfile(staffId, B.confirmDraft(profile, entries), profile.revision || 0, state.index.subjects);
                await freshProfile(staffId); done += items.length;
            } catch (error) { failed.push(items[0].name + ': ' + error.message); }
        }
        return { done, failed };
    }

    // ---------- rendering ----------
    function baselineText(row) {
        if (!row.group) return '';
        if (row.confirmed) return (row.group.baselineKind === 'increase' ? 'tăng từ ' : 'mốc ') + vnDate(row.baselineDate);
        if (!row.estimate?.known) return 'chưa rõ mốc';
        return (row.estimate.capped ? 'từ trước ' : 'từ ') + vnDate(row.baselineDate) + ' (ước tính)';
    }
    function statusBadge(row) {
        if (row.category === 'nodata') return '<span class="srb-badge muted">Chưa có giá môn</span>';
        if (row.pending) return `<span class="srb-badge ok">Chờ hiệu lực</span><small>Cần hủy: mở Chi tiết</small>`;
        if (row.disabled) return '<span class="srb-badge muted">Tạm ngưng</span>';
        const ev = row.evaluation;
        if (!ev?.dueDate) return '<span class="srb-badge muted">Chưa rõ</span>';
        const cls = ev.overdue ? 'danger' : ev.visibleThisMonth ? 'warn' : row.category === 'soon' ? 'soon' : 'muted';
        const label = ev.overdue ? 'Quá hạn' : ev.visibleThisMonth ? 'Đến hạn' : ev.deferred ? 'Đã hẹn lại' : 'Chưa đến hạn';
        return `<span class="srb-badge ${cls}">${label}</span><small>${vnDate(ev.dueDate)}</small>`;
    }
    function hoursCell(row) {
        const s = row.stats;
        if (!s || !s.observed) return '<span class="srb-muted">Chưa có phiếu</span>';
        const low = row.evaluation?.low ? ' <span class="srb-low" title="Ít hơn ngưỡng giờ tham khảo">ít giờ</span>' : '';
        return `${hours(s.averageHours)}${low}${s.complete ? '' : `<small>${s.observed}/3 tháng có phiếu</small>`}`;
    }
    function rowHtml(row) {
        const selectable = row.group && !row.pending && !row.disabled;
        const open = state.open === row.key;
        const result = state.results[row.key];
        const action = row.disabled
            ? `<button type="button" class="srb-btn" data-action="setup" data-key="${esc(row.key)}">Thiết lập</button>`
            : !row.group || row.pending
            ? `<button type="button" class="srb-btn" data-action="detail" data-key="${esc(row.key)}">Chi tiết</button>`
            : `<button type="button" class="srb-btn ${open ? '' : 'srb-primary'}" data-action="toggle" data-key="${esc(row.key)}" aria-expanded="${open}">${open ? 'Đóng' : 'Xét tăng'}</button>`;
        return `<article class="srb-row${open ? ' open' : ''}${state.selected.has(row.key) ? ' selected' : ''}" data-key="${esc(row.key)}">
            <div class="srb-line">
                <span>${selectable ? `<input type="checkbox" data-select="${esc(row.key)}" aria-label="Chọn ${esc(row.name)}" ${state.selected.has(row.key) ? 'checked' : ''}>` : ''}</span>
                <div class="srb-who"><strong>${esc(row.name)}</strong> <span class="srb-code">${esc(row.code)}</span>
                    <small>${row.group ? esc(row.group.name.replace(/ · [\d.]+ đ$/, '')) + ' · ' + esc(row.subjects.map(s => s.name).join(', ')) : 'Chưa có giá môn để xét'}</small></div>
                <div class="srb-rate">${!row.group ? '' : setupCell(row, row.pending
                    ? `<strong>${money(row.group.scheduledChange.previousGroup?.currentRate)}</strong><small>lên ${money(row.group.scheduledChange.newRate)} từ ${vnDate(row.group.scheduledChange.effectiveFrom)}</small>`
                    : `<strong>${money(row.currentRate)}</strong><small>${esc(baselineText(row))}</small>`)}</div>
                <div class="srb-due">${row.group ? setupCell(row, statusBadge(row)) : statusBadge(row)}</div>
                <div class="srb-hours">${hoursCell(row)}</div>
                <div class="srb-att">${row.attendance == null ? '—' : Math.round(row.attendance) + '%'}</div>
                <div class="srb-act">${action}</div>
            </div>
            ${result ? `<p class="srb-result ${result.error ? 'error' : ''}">${esc(result.text)}</p>` : ''}
            ${open ? panelHtml(row) : ''}
        </article>`;
    }
    function ladderChips(row, draft) {
        const steps = P.LADDER.filter(rate => row.currentRate == null || rate > row.currentRate).slice(0, 5);
        if (row.nextRate != null && !steps.includes(row.nextRate)) steps.unshift(row.nextRate);
        return steps.map(rate => `<button type="button" class="srb-chip" data-action="pick" data-key="${esc(row.key)}" data-rate="${rate}" aria-pressed="${Number(draft.rate) === rate}">${(rate / 1000).toLocaleString('vi-VN')}k</button>`).join('');
    }
    function panelHtml(row) {
        const draft = draftFor(row), key = esc(row.key);
        const rate = Number(draft.rate);
        const valid = Number.isSafeInteger(rate) && rate > 0;
        const next = valid ? P.evaluate({ ...row.group, currentRate: rate, baselineDate: draft.month + '-01', confirmed: true, nextReviewDate: '' },
            {}, state.index.config, today(), {}).baseDueDate : '';
        const changes = row.subjects.map(s => `<span>${esc(s.name)}: ${money(s.rate)} → <b>${valid ? money(rate) : '…'}</b></span>`).join('');
        const notForm = draft.mode === 'not' ? `<div class="srb-subform">
                <label>Lý do chưa tăng (bắt buộc)<input data-f="reason" data-key="${key}" value="${esc(draft.reason)}" maxlength="2000" placeholder="Ví dụ: chưa đủ giờ dạy, cần theo dõi thêm"></label>
                <label>Xét lại vào<input type="date" data-f="nextDate" data-key="${key}" value="${esc(draft.nextDate)}" min="${P.addMonths(today(), 0)}"></label>
                <div class="srb-actions"><button type="button" class="srb-btn srb-primary" data-action="not-save" data-key="${key}">Lưu: chưa tăng</button><button type="button" class="srb-btn" data-action="not-cancel" data-key="${key}">Thôi</button></div>
            </div>` : '';
        return `<div class="srb-panel">
            ${row.confirmed ? '' : `<label class="srb-baseline">Tính hạn xét từ<input type="date" data-f="baseline" data-key="${key}" value="${esc(draft.baseline)}" max="${today()}"><small>${row.estimate?.known ? 'Ước tính từ giá đã nhập. Sửa nếu biết ngày tăng lương thật.' : 'Chưa thấy lịch sử giá; mặc định hôm nay.'}</small></label>`}
            <div class="srb-fields">
                <div><span class="srb-label">Mức mới (đ/giờ)</span><div class="srb-chips">${ladderChips(row, draft)}<input type="number" inputmode="numeric" data-f="rate" data-key="${key}" value="${esc(draft.rate)}" min="1" step="500" aria-label="Mức mới đ/giờ"></div></div>
                <label>Áp dụng từ<select data-f="month" data-key="${key}">${targetMonths().map(m => `<option value="${m}" ${m === draft.month ? 'selected' : ''}>${vnMonth(m)}</option>`).join('')}</select></label>
                <label class="srb-grow">Ghi chú (không bắt buộc)<input data-f="note" data-key="${key}" value="${esc(draft.note)}" maxlength="2000" placeholder="Ví dụ: dạy đều, phụ huynh khen"></label>
            </div>
            <p class="srb-changes">${changes}${next ? `<span class="srb-muted">Lần xét tiếp khoảng ${vnDate(next)}</span>` : ''}</p>
            <div class="srb-actions">
                <button type="button" class="srb-btn srb-primary" data-action="approve" data-key="${key}">Duyệt tăng lên ${valid ? money(rate) : '…'}</button>
                <button type="button" class="srb-btn" data-action="defer" data-key="${key}">Hẹn lại 1 tháng</button>
                <button type="button" class="srb-btn" data-action="not" data-key="${key}">Chưa tăng…</button>
                ${row.confirmed ? '' : `<button type="button" class="srb-btn" data-action="track" data-key="${key}">Chỉ lưu mốc, chưa xét</button>`}
                <button type="button" class="srb-btn srb-ghost" data-action="detail" data-key="${key}">Chi tiết</button>
            </div>
            ${notForm}
        </div>`;
    }
    function bulkHtml() {
        const rows = [...state.selected].map(rowByKey).filter(Boolean);
        if (state.bulk) {
            const items = state.bulk.items.map(item => ({ item, row: rowByKey(item.key) })).filter(x => x.row);
            return `<div class="srb-bulkpanel"><h2>Tăng lương ${items.length} dòng đã chọn</h2>
                <div class="srb-bulktable">${items.map(({ item, row }) => `<div class="srb-bulkrow"><span><strong>${esc(row.name)}</strong> <span class="srb-code">${esc(row.code)}</span><small>${esc(row.subjects.map(s => s.name).join(', '))}</small></span><span>${money(row.currentRate)} →</span><input type="number" data-bulk-rate="${esc(row.key)}" value="${esc(item.rate)}" min="1" step="500" aria-label="Mức mới của ${esc(row.name)}"></div>`).join('')}</div>
                <div class="srb-fields"><label>Áp dụng từ<select id="srb-bulk-month">${targetMonths().map(m => `<option value="${m}" ${m === state.bulk.month ? 'selected' : ''}>${vnMonth(m)}</option>`).join('')}</select></label>
                <label class="srb-grow">Ghi chú chung (không bắt buộc)<input id="srb-bulk-note" value="${esc(state.bulk.note)}" maxlength="2000"></label></div>
                <div class="srb-actions"><button type="button" class="srb-btn srb-primary" data-action="bulk-apply">Duyệt ${items.length} mức</button><button type="button" class="srb-btn" data-action="bulk-cancel">Thôi</button></div></div>`;
        }
        if (!rows.length) return '';
        const unconfirmed = rows.filter(row => !row.confirmed).length;
        return `<div class="srb-bulkbar"><span>Đã chọn ${rows.length}</span>
            <button type="button" class="srb-btn srb-primary" data-action="bulk-increase">Tăng 1 bậc…</button>
            <button type="button" class="srb-btn" data-action="bulk-defer">Hẹn lại 1 tháng</button>
            <button type="button" class="srb-btn" data-action="bulk-setup">Thiết lập mốc, chu kỳ…</button>
            ${unconfirmed ? `<button type="button" class="srb-btn" data-action="bulk-track">Lưu mốc ước tính (${unconfirmed})</button>` : ''}
            <button type="button" class="srb-btn srb-ghost" data-action="bulk-clear">Bỏ chọn</button></div>`;
    }
    function visibleRows() {
        const q = P.key(state.query);
        return state.rows.filter(row => B.matchesTab(row, state.tab) &&
            (!q || P.key(row.name + ' ' + row.code + ' ' + (row.group?.name || '') + ' ' + row.subjects.map(s => s.name).join(' ')).includes(q)));
    }
    function render() {
        if (!$('srb')) return;
        const counts = B.summary(state.rows);
        $('srb-summary').innerHTML = [['due', 'Đến hạn tháng này', counts.due], ['soon', 'Sắp đến hạn (2 tháng)', counts.soon],
            ['setup', 'Chưa có mốc', counts.setup], ['pending', 'Đã duyệt, chờ hiệu lực', counts.pending]]
            .map(([tab, label, n]) => `<button type="button" class="srb-card ${tab === 'due' && n ? 'warn' : ''}" data-tab="${tab}" aria-pressed="${state.tab === tab}"><span>${label}</span><strong>${state.loading ? '…' : n}</strong></button>`).join('');
        $('srb-tabs').innerHTML = TABS.map(([tab, label]) => `<button type="button" class="srb-tab" data-tab="${tab}" aria-pressed="${state.tab === tab}">${label}${tab === 'all' ? '' : ` (${counts[tab] ?? 0})`}</button>`).join('');
        const rows = visibleRows();
        if (state.loading) $('srb-list').innerHTML = '<p class="srb-empty">Đang tải giá và giờ dạy của tất cả giáo viên…</p>';
        else if (!state.index) $('srb-list').innerHTML = '<p class="srb-empty">Đang xác thực…</p>';
        else $('srb-list').innerHTML = rows.length
            ? `<div class="srb-head"><span></span><span>Giáo viên · nhóm môn</span><span>Lương hiện tại</span><span>Hạn xét</span><span>Giờ dạy TB 3 tháng</span><span>Chuyên cần</span><span></span></div>${rows.map(rowHtml).join('')}`
            : `<p class="srb-empty">${state.tab === 'due' ? 'Không có ai đến hạn xét trong tháng này.' : 'Không có dòng nào trong mục này.'}</p>`;
        $('srb-bulk').innerHTML = bulkHtml();
        const allBox = $('srb-select-all');
        const selectable = rows.filter(row => row.group && !row.pending && !row.disabled);
        allBox.checked = selectable.length > 0 && selectable.every(row => state.selected.has(row.key));
        allBox.disabled = !selectable.length;
    }

    // ---------- setup popup: baseline, cycle, review date, reminders ----------
    const PENCIL = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    function setupCell(row, inner) {
        return `<button type="button" class="srb-cellbtn" data-action="setup" data-key="${esc(row.key)}" title="Chỉnh mốc, chu kỳ, hạn xét">${inner}<span class="srb-pencil">${PENCIL}</span></button>`;
    }
    const profileOf = staffId => (state.index?.profiles || []).find(p => (p.staffId || p.id) === staffId) || { personOverrides: {} };
    const optionalNumber = value => String(value ?? '').trim() === '' ? null : Number(value);
    function setupDefaults(row) {
        const g = row.group;
        return { currentRate: g.currentRate ?? '', baselineDate: row.baselineDate || today(),
            baselineKind: row.confirmed ? (g.baselineKind === 'increase' ? 'increase' : 'initial') : 'initial',
            cycleMonths: g.cycleMonths ?? '', nextReviewDate: g.nextReviewDate || '', minimumHours: g.minimumHours ?? '',
            enabled: g.enabled !== false, note: g.note || '' };
    }
    function readSetupForm(bulk) {
        const form = $('srb-setup-form'), data = new FormData(form), value = name => String(data.get(name) ?? '').trim();
        if (bulk) return { baselineDate: value('baselineDate'), baselineKind: value('baselineKind') || 'initial',
            cycleMonths: value('cycleMonths'), nextReviewDate: value('nextReviewDate'), enabled: value('enabled') };
        return { currentRate: value('currentRate'), baselineDate: value('baselineDate'), baselineKind: value('baselineKind') || 'initial',
            cycleMonths: value('cycleMonths'), nextReviewDate: value('nextReviewDate'), minimumHours: value('minimumHours'),
            enabled: data.has('enabled'), note: String(data.get('note') ?? '') };
    }
    // Same limits as SalaryReviewService.normalizeGroup; checked here to keep the popup open on mistakes.
    function setupPatch(values, bulk) {
        const patch = {};
        const has = name => !bulk || String(values[name] ?? '') !== '';
        if (has('baselineDate')) {
            if (!P.validDate(values.baselineDate) || values.baselineDate > today()) throw Error('Mốc tính hạn xét phải là ngày hợp lệ, không sau hôm nay.');
            patch.baselineDate = values.baselineDate;
            patch.baselineKind = values.baselineKind === 'increase' ? 'increase' : 'initial';
            patch.lastIncreaseDate = patch.baselineKind === 'increase' ? values.baselineDate : '';
        }
        if (has('cycleMonths')) {
            const cycle = optionalNumber(values.cycleMonths);
            if (cycle !== null && (!Number.isInteger(cycle) || cycle < 1 || cycle > 36)) throw Error('Chu kỳ xét là số tháng nguyên từ 1 đến 36.');
            patch.cycleMonths = cycle;
        }
        if (has('nextReviewDate')) {
            if (values.nextReviewDate && !P.validDate(values.nextReviewDate)) throw Error('Ngày hẹn xét không hợp lệ.');
            patch.nextReviewDate = values.nextReviewDate || '';
        }
        if (bulk) {
            if (values.enabled === 'on') patch.enabled = true;
            if (values.enabled === 'off') patch.enabled = false;
            if (!Object.keys(patch).length) throw Error('Nhập ít nhất một ô cần đổi.');
            return patch;
        }
        const rate = optionalNumber(values.currentRate);
        if (rate === null || !Number.isSafeInteger(rate) || rate <= 0 || rate > 10000000) throw Error('Mức đang hưởng là số tiền đ/giờ, ví dụ 32000.');
        const minimum = optionalNumber(values.minimumHours);
        if (minimum !== null && (!Number.isFinite(minimum) || minimum < 0 || minimum > 744)) throw Error('Ngưỡng giờ từ 0 đến 744 giờ/tháng.');
        return { ...patch, currentRate: rate, minimumHours: minimum, enabled: values.enabled, note: String(values.note || '').slice(0, 2000) };
    }
    function setupPreviewHtml(rows, values, bulk) {
        let patch;
        try { patch = setupPatch(values, bulk); } catch (error) { return `<span class="srb-setup-warn">${esc(error.message)}</span>`; }
        if (bulk) return `Áp dụng cho <b>${rows.length}</b> dòng. Ô để trống được giữ nguyên.` +
            (patch.enabled === false ? ' Các dòng sẽ tạm ngưng nhắc.' : '');
        const row = rows[0];
        if (patch.enabled === false) return 'Tạm ngưng nhắc: dòng này không hiện trong Đến hạn cho đến khi bật lại.';
        const ev = P.evaluate({ ...row.group, ...patch, confirmed: true }, row.stats, state.index.config, today(), profileOf(row.staffId).personOverrides || {});
        if (!ev.dueDate) return '<span class="srb-setup-warn">Chưa đủ dữ liệu để tính hạn xét.</span>';
        const source = ev.ruleSources?.cycleMonths === 'group' ? 'riêng' : ev.ruleSources?.cycleMonths === 'person' ? 'riêng của người này' : 'theo quy định chung';
        const ignored = patch.nextReviewDate && patch.nextReviewDate < ev.baseDueDate
            ? `<br><span class="srb-setup-warn">Ngày hẹn sớm hơn hạn theo chu kỳ (${vnDate(ev.baseDueDate)}) nên không có tác dụng.</span>` : '';
        return `Hạn xét mới: <b>${vnDate(ev.dueDate)}</b> · ${esc(ev.label)} · chu kỳ ${ev.months} tháng (${source}).${ignored}`;
    }
    function setupFormHtml(rows, bulk) {
        const row = rows[0];
        const head = bulk
            ? `<h2 id="srb-setup-title">Thiết lập ${rows.length} dòng đã chọn</h2><p>${esc([...new Set(rows.map(r => r.name))].slice(0, 6).join(', '))}${rows.length > 6 ? '…' : ''}</p>`
            : `<h2 id="srb-setup-title">${esc(row.name)} <span class="srb-code">${esc(row.code)}</span></h2><p>${esc(row.group.name.replace(/ · [\d.]+ đ$/, ''))} · ${esc(row.subjects.map(s => s.name).join(', '))}</p>`;
        const v = bulk ? { baselineDate: '', baselineKind: 'initial', cycleMonths: '', nextReviewDate: '' } : setupDefaults(row);
        const fallbackCycle = bulk ? state.index.config.cycleMonths
            : P.evaluate({ ...row.group, cycleMonths: null, confirmed: true, baselineDate: v.baselineDate }, {}, state.index.config, today(), profileOf(row.staffId).personOverrides || {}).months;
        const kind = (value, label) => `<label class="srb-seg-item"><input type="radio" name="baselineKind" value="${value}" ${v.baselineKind === value ? 'checked' : ''}><span>${label}</span></label>`;
        return `<form id="srb-setup-form" class="srb-setup" novalidate data-bulk="${bulk ? '1' : ''}">
            <header class="srb-setup-head"><div><p class="srb-eyebrow">THIẾT LẬP XÉT LƯƠNG</p>${head}</div><button type="button" class="srb-x" data-setup="close" aria-label="Đóng">×</button></header>
            <div class="srb-setup-body">
                ${bulk ? '' : `<label>Mức đang hưởng (đ/giờ)<input type="number" name="currentRate" value="${esc(v.currentRate)}" min="1" step="500" inputmode="numeric"><small>Mức theo dõi để xét. Không đổi giá tính lương; giá mới chỉ đổi khi duyệt tăng.</small></label>`}
                <fieldset class="srb-span"><legend>Mốc tính hạn xét</legend>
                    <div class="srb-seg">${kind('increase', 'Ngày tăng lương gần nhất')}${kind('initial', 'Mốc bắt đầu theo dõi')}</div>
                    <input type="date" name="baselineDate" value="${esc(v.baselineDate)}" max="${today()}" aria-label="Ngày mốc">
                    <small>${bulk ? 'Để trống để giữ mốc hiện tại của từng dòng.' : !row.confirmed && row.estimate?.known ? 'Đang là mốc ước tính từ giá đã nhập. Sửa nếu biết ngày thật.' : 'Hạn xét = mốc + chu kỳ.'}</small>
                </fieldset>
                <label>Chu kỳ xét (tháng)<input type="number" name="cycleMonths" value="${esc(v.cycleMonths)}" min="1" max="36" step="1" placeholder="Theo quy định chung (${fallbackCycle} tháng)"><small>${bulk ? 'Để trống để giữ nguyên.' : 'Để trống = theo quy định chung.'}</small></label>
                <label>Hẹn xét vào ngày<span class="srb-inline"><input type="date" name="nextReviewDate" value="${esc(v.nextReviewDate)}">${bulk ? '' : '<button type="button" class="srb-btn srb-ghost" data-setup="clear-next">Xóa</button>'}</span><small>Không bắt buộc. Dùng khi muốn xét muộn hơn hạn theo chu kỳ.</small></label>
                ${bulk ? `<label>Nhắc xét<select name="enabled"><option value="">Giữ nguyên</option><option value="on">Bật nhắc</option><option value="off">Tạm ngưng</option></select></label>`
                    : `<label>Ngưỡng giờ/tháng riêng<input type="number" name="minimumHours" value="${esc(v.minimumHours)}" min="0" max="744" step="0.5" placeholder="Theo quy định chung"><small>Chỉ để cảnh báo “ít giờ”, không tự hoãn.</small></label>
                       <label class="srb-switch srb-span"><input type="checkbox" name="enabled" ${v.enabled ? 'checked' : ''}><span>Nhắc xét cho nhóm môn này</span></label>
                       <label class="srb-span">Ghi chú<textarea name="note" rows="2" maxlength="2000" placeholder="Ví dụ: thỏa thuận xét 4 tháng/lần">${esc(v.note)}</textarea></label>`}
            </div>
            <div id="srb-setup-preview" class="srb-setup-preview" aria-live="polite"></div>
            <p id="srb-setup-error" class="srb-setup-error" role="alert"></p>
            <footer class="srb-setup-foot"><button type="button" class="srb-btn" data-setup="close">Hủy</button><button type="submit" class="srb-btn srb-primary">Lưu thiết lập</button></footer>
        </form>`;
    }
    function openSetup(keys, bulk = false) {
        const rows = keys.map(rowByKey).filter(row => row && row.group);
        if (!rows.length) return;
        const pending = rows.filter(row => row.pending);
        if (!bulk && pending.length) {
            const change = rows[0].group.scheduledChange;
            $('srb-dialog-content').innerHTML = `<div class="srb-setup"><header class="srb-setup-head"><div><p class="srb-eyebrow">THIẾT LẬP XÉT LƯƠNG</p><h2 id="srb-setup-title">${esc(rows[0].name)}</h2></div><button type="button" class="srb-x" data-setup="close" aria-label="Đóng">×</button></header>
                <div class="srb-setup-preview">Đã duyệt lên <b>${money(change.newRate)}</b> từ ${vnDate(change.effectiveFrom)}. Mốc và chu kỳ được giữ nguyên đến khi mức mới có hiệu lực. Muốn đổi thì hủy mức chờ hiệu lực trong Chi tiết trước.</div>
                <footer class="srb-setup-foot"><button type="button" class="srb-btn" data-setup="close">Đóng</button><button type="button" class="srb-btn srb-primary" data-setup="detail" data-staff="${esc(rows[0].staffId)}">Mở Chi tiết</button></footer></div>`;
        } else {
            const usable = rows.filter(row => !row.pending);
            state.setup = { keys: usable.map(row => row.key), bulk };
            $('srb-dialog-content').innerHTML = setupFormHtml(usable, bulk);
            $('srb-setup-preview').innerHTML = setupPreviewHtml(usable, readSetupForm(bulk), bulk);
        }
        if (!$('srb-dialog').open) $('srb-dialog').showModal();
    }
    function closeSetup() { if (state.busy) return; state.setup = null; if ($('srb-dialog').open) $('srb-dialog').close(); }
    // One profile write per teacher; other groups of that teacher are kept as saved.
    async function saveSetupEntries(entries) {
        const byStaff = new Map();
        entries.forEach(entry => byStaff.set(entry.row.staffId, (byStaff.get(entry.row.staffId) || []).concat(entry)));
        let done = 0; const failed = [];
        for (const [staffId, items] of byStaff) {
            try {
                const profile = await freshProfile(staffId);
                const draft = JSON.parse(JSON.stringify(profile.groups ? profile : { groups: [], personOverrides: {} }));
                draft.groups = draft.groups || []; draft.personOverrides = draft.personOverrides || {};
                items.forEach(({ row, patch }) => {
                    const index = draft.groups.findIndex(g => g.id === row.group.id);
                    const base = index >= 0 ? draft.groups[index] : JSON.parse(JSON.stringify(row.group));
                    if (base.scheduledChange?.effectiveFrom > today()) throw Error('có mức chờ hiệu lực, hủy trong Chi tiết trước');
                    const next = { ...base, ...patch, confirmed: true };
                    if (!next.baselineDate || (!row.confirmed && !patch.baselineDate)) next.baselineDate = base.confirmed ? base.baselineDate : row.baselineDate;
                    if (index >= 0) draft.groups[index] = next; else draft.groups.push(next);
                });
                await S.saveProfile(staffId, draft, profile.revision || 0, state.index.subjects);
                await freshProfile(staffId); done += items.length;
                items.forEach(({ row }) => { state.results[row.key] = { text: 'Đã lưu thiết lập.' }; });
            } catch (error) {
                failed.push(items[0].row.name + ': ' + error.message);
                items.forEach(({ row }) => { state.results[row.key] = { text: 'Chưa lưu thiết lập: ' + error.message, error: true }; });
            }
        }
        return { done, failed };
    }
    function submitSetup() {
        if (state.busy || !state.setup) return;
        const { keys, bulk } = state.setup, rows = keys.map(rowByKey).filter(Boolean);
        let patch;
        try { patch = setupPatch(readSetupForm(bulk), bulk); }
        catch (error) { $('srb-setup-error').textContent = error.message; return; }
        $('srb-setup-error').textContent = '';
        const button = $('srb-setup-form').querySelector('[type="submit"]');
        button.disabled = true; button.textContent = 'Đang lưu…';
        withWrite(async () => {
            const { done, failed } = await saveSetupEntries(rows.map(row => ({ row, patch })));
            if (failed.length && !done) {
                button.disabled = false; button.textContent = 'Lưu thiết lập';
                $('srb-setup-error').textContent = failed.join(' ');
                throw Error('Chưa lưu thiết lập. ' + failed.join(' '));
            }
            state.setup = null; $('srb-dialog').close();
            if (bulk) rows.forEach(row => state.selected.delete(row.key));
            message(`Đã lưu thiết lập cho ${done}/${rows.length} dòng.` + (failed.length ? ' Chưa lưu: ' + failed.join(' ') : ' Giá tính lương giữ nguyên.'), failed.length > 0);
        });
    }
    $('srb-dialog').addEventListener('input', () => {
        if (!state.setup) return;
        $('srb-setup-error').textContent = '';
        const rows = state.setup.keys.map(rowByKey).filter(Boolean);
        $('srb-setup-preview').innerHTML = setupPreviewHtml(rows, readSetupForm(state.setup.bulk), state.setup.bulk);
    });
    $('srb-dialog').addEventListener('submit', event => { event.preventDefault(); submitSetup(); });
    $('srb-dialog').addEventListener('click', event => {
        const button = event.target.closest('[data-setup]');
        if (event.target === $('srb-dialog')) { closeSetup(); return; }
        if (!button) return;
        if (button.dataset.setup === 'close') closeSetup();
        if (button.dataset.setup === 'clear-next') { $('srb-setup-form').elements.nextReviewDate.value = ''; $('srb-dialog').dispatchEvent(new Event('input')); }
        if (button.dataset.setup === 'detail') { closeSetup(); showDetail(button.dataset.staff); }
    });
    $('srb-dialog').addEventListener('cancel', event => { if (state.busy) event.preventDefault(); else state.setup = null; });

    // ---------- events ----------
    function runRow(key, action) {
        const row = rowByKey(key); if (!row) return;
        const draft = draftFor(row);
        if (action === 'toggle') { state.open = state.open === key ? '' : key; render(); return; }
        if (action === 'detail') { showDetail(row.staffId); return; }
        if (action === 'pick') return;
        if (action === 'not') { draft.mode = 'not'; render(); return; }
        if (action === 'not-cancel') { draft.mode = ''; render(); return; }
        withWrite(async () => {
            delete state.results[key];
            if (action === 'approve') {
                const done = await approve(row, draft);
                state.results[key] = { text: `Đã duyệt ${money(done.rate)}/giờ từ ${vnMonth(done.month).toLowerCase()}.` };
                state.open = ''; delete state.drafts[key];
                message(`Đã duyệt tăng lương cho ${row.name}. Giá các tháng đã tính lương giữ nguyên.`);
            } else if (action === 'defer') {
                const next = P.addMonths(today(), 1);
                await defer(row, draft.note.trim() || 'Hẹn xét lại sau 1 tháng', next);
                state.results[key] = { text: 'Đã hẹn xét lại ngày ' + vnDate(next) + '.' };
                state.open = ''; delete state.drafts[key];
                message(`Đã hẹn lại ${row.name}.`);
            } else if (action === 'not-save') {
                await notIncreased(row, draft.reason, draft.nextDate);
                state.results[key] = { text: 'Đã ghi chưa tăng, xét lại ngày ' + vnDate(draft.nextDate) + '.' };
                state.open = ''; delete state.drafts[key];
                message(`Đã lưu quyết định cho ${row.name}.`);
            } else if (action === 'track') {
                const { failed } = await startTracking([row]);
                if (failed.length) throw Error(failed.join(' '));
                state.results[key] = { text: 'Đã lưu mốc ' + vnDate(draft.baseline) + '.' };
                message(`Đã lưu mốc xét cho ${row.name}.`);
            }
        });
    }
    async function bulkApply() {
        const items = state.bulk.items.slice(), month = state.bulk.month, note = state.bulk.note.trim();
        let done = 0; const failed = [];
        for (const item of items) {
            const row = rowByKey(item.key);
            if (!row) continue;
            try {
                await approve(row, { rate: item.rate, month, note, baseline: row.baselineDate });
                state.results[item.key] = { text: `Đã duyệt ${money(Number(item.rate))}/giờ từ ${vnMonth(month).toLowerCase()}.` };
                state.selected.delete(item.key); done++;
            } catch (error) {
                state.results[item.key] = { text: 'Chưa duyệt: ' + error.message, error: true };
                failed.push(row.name);
            }
            rebuild();
        }
        state.bulk = null;
        message(`Đã duyệt ${done}/${items.length} mức.` + (failed.length ? ' Chưa duyệt: ' + failed.join(', ') + ' (xem lý do dưới từng dòng).' : ''), failed.length > 0);
    }
    function bulkAction(action) {
        const rows = [...state.selected].map(rowByKey).filter(row => row && row.group && !row.pending && !row.disabled);
        if (action === 'bulk-clear') { state.selected.clear(); render(); return; }
        if (action === 'bulk-cancel') { state.bulk = null; render(); return; }
        if (action === 'bulk-increase') {
            if (!rows.length) return;
            state.bulk = { items: rows.map(row => ({ key: row.key, rate: row.nextRate ?? '' })), month: targetMonths()[0], note: '' };
            render(); return;
        }
        if (action === 'bulk-apply') {
            try {
                state.bulk.items.forEach(item => { const row = rowByKey(item.key); if (row) checkRate(item.rate, row); });
            } catch (error) { message(error.message, true); return; }
            withWrite(bulkApply); return;
        }
        if (action === 'bulk-defer') {
            if (!rows.length || !window.confirm(`Hẹn xét lại ${rows.length} dòng sau 1 tháng?`)) return;
            withWrite(async () => {
                const next = P.addMonths(today(), 1); let done = 0;
                for (const row of rows) {
                    try { await defer(row, 'Hẹn xét lại sau 1 tháng', next); state.results[row.key] = { text: 'Đã hẹn xét lại ngày ' + vnDate(next) + '.' }; state.selected.delete(row.key); done++; }
                    catch (error) { state.results[row.key] = { text: 'Chưa hẹn lại: ' + error.message, error: true }; }
                    rebuild();
                }
                message(`Đã hẹn lại ${done}/${rows.length} dòng.`, done < rows.length);
            });
            return;
        }
        if (action === 'bulk-track') {
            const pending = rows.filter(row => !row.confirmed);
            withWrite(async () => {
                const { done, failed } = await startTracking(pending);
                pending.forEach(row => { if (!failed.some(f => f.startsWith(row.name + ':'))) { state.selected.delete(row.key); state.results[row.key] = { text: 'Đã lưu mốc ' + vnDate(state.drafts[row.key]?.baseline || row.baselineDate) + '.' }; } });
                message(`Đã lưu mốc cho ${done}/${pending.length} dòng.` + (failed.length ? ' ' + failed.join(' ') : ''), failed.length > 0);
            });
        }
    }
    function showDetail(staffId) {
        $('srb').hidden = true; $('sr-individual').hidden = false; $('srb-back-bar').hidden = false;
        if (staffId) window.dispatchEvent(new CustomEvent('salary-review-open-person', { detail: staffId }));
        window.scrollTo({ top: 0 });
    }
    function showBoard() {
        if (/chưa lưu/.test($('sr-save-note')?.textContent || '') && !window.confirm('Hồ sơ chi tiết có thay đổi chưa lưu. Bỏ thay đổi và quay lại danh sách?')) return;
        $('srb').hidden = false; $('sr-individual').hidden = true; $('srb-back-bar').hidden = true;
        const url = new URL(location.href); url.searchParams.delete('staffId'); history.replaceState(null, '', url);
        rebuild(); render();
    }

    $('srb').addEventListener('click', event => {
        const tab = event.target.closest('[data-tab]');
        if (tab) { state.tab = tab.dataset.tab; render(); return; }
        const button = event.target.closest('[data-action]');
        if (!button || state.busy) return;
        const action = button.dataset.action, key = button.dataset.key;
        if (action === 'pick') { const row = rowByKey(key); if (row) { draftFor(row).rate = Number(button.dataset.rate); render(); } return; }
        if (action === 'setup') { openSetup([key]); return; }
        if (action === 'bulk-setup') { openSetup([...state.selected], true); return; }
        if (action.startsWith('bulk-')) bulkAction(action); else runRow(key, action);
    });
    $('srb').addEventListener('input', event => {
        const el = event.target;
        if (el.id === 'srb-search') { state.query = el.value; render(); el.focus(); return; }
        if (el.dataset.bulkRate && state.bulk) { const item = state.bulk.items.find(i => i.key === el.dataset.bulkRate); if (item) item.rate = el.value; return; }
        if (el.id === 'srb-bulk-note' && state.bulk) { state.bulk.note = el.value; return; }
        if (el.dataset.f && el.dataset.key) {
            const row = rowByKey(el.dataset.key); if (!row) return;
            draftFor(row)[el.dataset.f] = el.value;
            if (el.dataset.f === 'rate') {
                const panel = el.closest('.srb-panel'), rate = Number(el.value), valid = Number.isSafeInteger(rate) && rate > 0;
                panel.querySelectorAll('.srb-chip').forEach(chip => chip.setAttribute('aria-pressed', String(Number(chip.dataset.rate) === rate)));
                panel.querySelector('[data-action="approve"]').textContent = 'Duyệt tăng lên ' + (valid ? money(rate) : '…');
                panel.querySelectorAll('.srb-changes b').forEach(b => { b.textContent = valid ? money(rate) : '…'; });
            }
        }
    });
    $('srb').addEventListener('change', event => {
        const el = event.target;
        if (el.id === 'srb-select-all') {
            visibleRows().filter(row => row.group && !row.pending && !row.disabled).forEach(row => el.checked ? state.selected.add(row.key) : state.selected.delete(row.key));
            render(); return;
        }
        if (el.dataset.select) { el.checked ? state.selected.add(el.dataset.select) : state.selected.delete(el.dataset.select); render(); return; }
        if (el.id === 'srb-bulk-month' && state.bulk) { state.bulk.month = el.value; return; }
        if (el.dataset.f === 'month' && el.dataset.key) { const row = rowByKey(el.dataset.key); if (row) { draftFor(row).month = el.value; render(); } }
    });
    $('srb-back').addEventListener('click', showBoard);
    $('srb-settings-toggle').addEventListener('click', () => {
        const settings = $('sr-settings'); settings.hidden = !settings.hidden; settings.open = !settings.hidden;
    });
    window.addEventListener('salary-review-index-loaded', event => {
        // ?q= comes from "Chỉnh lịch xét tăng lương" in Tính Lương: open on that teacher.
        const query = new URLSearchParams(location.search).get('q');
        if (query) { state.query = query; state.tab = 'all'; $('srb-search').value = query; }
        loadSources(event.detail);
        if (new URLSearchParams(location.search).has('staffId')) { $('srb').hidden = true; $('sr-individual').hidden = false; $('srb-back-bar').hidden = false; }
    });
    window.addEventListener('beforeunload', event => { if (state.busy) { event.preventDefault(); event.returnValue = ''; } });
    // salary-review.js asks this before reloading the shared index.
    window.SalaryReviewOverview = { hasPendingChanges: () => state.busy };
    window.SalaryReviewBoard = { state, rebuild, render };
    render();
})();
