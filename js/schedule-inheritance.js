// Kế thừa lịch dạy cho các tuần sau (yêu cầu GĐ 28/09/2026).
//
// Cách lịch vốn hoạt động (db-service getSchedule): một ngày CHƯA có lịch riêng tự dùng lịch
// của cùng thứ ở ngày gần nhất trước đó. Nút này cho người xếp lịch chọn rõ ràng:
//   • "Đến khi tôi tự thay đổi": các tuần sau cứ dùng lịch tuần đang xem → gỡ các điểm dừng.
//   • "Đến hết tuần …": các tuần tới hết tuần đã chọn dùng lịch này, tuần ngay sau đó đặt ĐIỂM
//     DỪNG (ngày lịch trống có dấu _inheritanceStop) nên từ đó trở đi lịch để trống.
// Không bao giờ ghi đè ngày đã có lịch riêng, không đụng ngày đã qua / hôm nay.
(function (global) {
    'use strict';

    const WEEKS_AHEAD = 12;
    const GUIDE_SEEN_KEY = 'tdt_schedule_inheritance_guide_v1';
    const WEEKDAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const SECTION_KEYS = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
    // UIService / DBService là const toàn cục của script cổ điển, KHÔNG nằm trên window.
    const dbService = () => (typeof DBService !== 'undefined' ? DBService : global.DBService) || null;
    const uiService = () => (typeof UIService !== 'undefined' ? UIService : global.UIService) || null;
    let openState = null;

    const pad = value => String(value).padStart(2, '0');
    const dateKeyOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    function parseKey(dateKey) {
        const [y, m, d] = String(dateKey || '').split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    const addDays = (dateKey, days) => {
        const date = parseKey(dateKey);
        date.setDate(date.getDate() + days);
        return dateKeyOf(date);
    };
    const todayKey = () => (typeof global.getLocalDateKeyFromDate === 'function'
        ? global.getLocalDateKeyFromDate(new Date()) : dateKeyOf(new Date()));
    const shortDate = dateKey => { const [, m, d] = String(dateKey).split('-'); return `${d}/${m}`; };
    const weekLabel = mondayKey => `${shortDate(mondayKey)} – ${shortDate(addDays(mondayKey, 6))}`;
    const escapeHtml = value => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function currentBranchKey() {
        return typeof currentBranch !== 'undefined' ? currentBranch : 'cs1';
    }
    function viewedMondayKey() {
        return typeof currentWeekStart !== 'undefined' ? dateKeyOf(currentWeekStart) : dateKeyOf(new Date());
    }
    function isScheduleManager() {
        let roles = [];
        try {
            const raw = localStorage.getItem('currentRole');
            roles = typeof global.parseRoles === 'function' ? global.parseRoles(raw) : JSON.parse(raw || '[]');
        } catch (_) {
            roles = [localStorage.getItem('currentRole')];
        }
        return (Array.isArray(roles) ? roles : [roles]).some(role => ['admin', 'assistant', 'senior_assistant'].includes(role));
    }

    // ---------- Mô phỏng: ngày sẽ hiện lịch nào ----------
    // Trả về 'own' (lịch riêng) | 'stop' (điểm dừng) | 'follows' (theo tuần đang xem hoặc cũ hơn)
    // | 'other' (theo một lịch riêng khác sau tuần đang xem) | 'empty' (trống).
    function resolveDay(dateKey, sim) {
        const day = sim.days[dateKey];
        if (day && day.stop) return { kind: 'stop' };
        if (day && day.exists) return { kind: 'own' };
        const weekday = String(parseKey(dateKey).getDay());
        const docId = `${sim.branch}__${dateKey}`;
        const candidates = new Set((sim.manifest[weekday] || []).filter(id => id < docId && !sim.removed.has(id)));
        Object.entries(sim.days).forEach(([key, info]) => {
            if (info.exists && key < dateKey && String(parseKey(key).getDay()) === weekday) candidates.add(info.docId);
        });
        const source = [...candidates].sort().pop();
        if (!source) return { kind: 'empty' };
        const sourceDate = source.split('__').pop();
        const sourceDay = sim.days[sourceDate];
        if (sourceDay && sourceDay.stop) return { kind: 'empty', stoppedAt: sourceDate };
        // Manifest trỏ tới ngày không còn tài liệu → getSchedule trả lịch trống.
        if (sourceDay && !sourceDay.exists) return { kind: 'empty' };
        if (sourceDate < addDays(sim.sourceMonday, 7)) return { kind: 'follows' };
        return { kind: 'other', from: sourceDate };
    }

    function cloneSim(snapshot, branch, sourceMonday) {
        const days = {};
        Object.entries(snapshot.days).forEach(([key, info]) => { days[key] = { ...info }; });
        return { branch, sourceMonday, manifest: snapshot.manifest || {}, days, removed: new Set() };
    }

    // Kế hoạch cho một lựa chọn: điểm dừng cần gỡ + ngày cần đặt điểm dừng.
    function buildPlan(state, mode, lastWeek) {
        const today = todayKey();
        const sim = cloneSim(state.snapshot, state.branch, state.sourceMonday);
        const firstFuture = addDays(state.sourceMonday, 7);
        const stopMonday = mode === 'until' ? addDays(state.sourceMonday, 7 * (lastWeek + 1)) : '';
        const removeStops = [];
        Object.entries(sim.days).forEach(([key, info]) => {
            if (!info.stop || key <= today || key < firstFuture) return;
            if (mode === 'forever' || key < stopMonday) {
                removeStops.push(key);
                info.exists = false; info.stop = false;
                sim.removed.add(info.docId);
            }
        });
        const addStops = [];
        const skippedPast = [];
        if (mode === 'until') {
            for (let offset = 0; offset < 7; offset += 1) {
                const key = addDays(stopMonday, offset);
                const info = sim.days[key];
                if (info && info.exists) continue; // lịch riêng hoặc đã là điểm dừng
                const resolved = resolveDay(key, sim);
                if (resolved.kind !== 'follows' && resolved.kind !== 'other') continue;
                if (key <= today) { skippedPast.push(key); continue; }
                addStops.push(key);
                sim.days[key] = { docId: `${state.branch}__${key}`, exists: true, stop: true, rows: 0 };
            }
        }
        const weeks = [];
        for (let week = 1; week <= WEEKS_AHEAD; week += 1) {
            const monday = addDays(state.sourceMonday, 7 * week);
            const counts = { follows: 0, own: 0, other: 0, empty: 0, stop: 0 };
            for (let offset = 0; offset < 7; offset += 1) counts[resolveDay(addDays(monday, offset), sim).kind] += 1;
            weeks.push({ week, monday, counts });
        }
        return { mode, lastWeek, stopMonday, removeStops, addStops, skippedPast, weeks };
    }

    function weekSummary(counts) {
        const parts = [];
        if (counts.follows) parts.push(`<b>${counts.follows}</b> ngày theo lịch tuần này`);
        if (counts.own) parts.push(`${counts.own} ngày lịch riêng (giữ nguyên)`);
        if (counts.other) parts.push(`${counts.other} ngày theo lịch riêng khác`);
        if (counts.stop) parts.push(`${counts.stop} ngày điểm dừng (trống)`);
        if (counts.empty) parts.push(`${counts.empty} ngày trống`);
        return parts.join(' · ') || 'Không có lịch';
    }
    function weekTone(counts) {
        if (counts.follows > 0 && !counts.own && !counts.other && !counts.stop) return 'is-follow';
        if (counts.follows > 0) return 'is-mixed';
        return 'is-empty';
    }

    // ---------- Giao diện ----------
    function injectStyles() {
        if (document.getElementById('si-styles')) return;
        const style = document.createElement('style');
        style.id = 'si-styles';
        style.textContent = `
            .si-guide { margin: 0 0 14px; padding: 12px 14px; border-radius: 14px; background: #F8FAFC; border: 1px solid #E2E8F0; font-size: 0.86rem; line-height: 1.5; color: #334155; }
            .si-guide h3 { margin: 0 0 6px; font-size: 0.92rem; font-weight: 800; color: #0F172A; }
            .si-guide ol, .si-guide ul { margin: 0 0 8px; padding-left: 1.15rem; }
            .si-guide li { margin: 2px 0; }
            .si-guide p { margin: 6px 0 0; }
            .si-guide-toggle { flex: 0 0 auto; min-height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid #CBD5E1; background: #fff; color: #0F766E; font: inherit; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
            .si-options { display: grid; gap: 8px; margin-bottom: 12px; }
            .si-option { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border-radius: 14px; border: 1.5px solid #E2E8F0; background: #fff; cursor: pointer; }
            .si-option:has(input:checked) { border-color: #059669; background: #F0FDF4; }
            .si-option input { margin-top: 3px; width: 18px; height: 18px; accent-color: #059669; flex: 0 0 auto; }
            .si-option b { display: block; font-size: 0.92rem; color: #0F172A; }
            .si-option small { display: block; margin-top: 2px; font-size: 0.8rem; color: #475569; line-height: 1.45; }
            .si-option select { margin-top: 8px; width: 100%; min-height: 42px; border-radius: 10px; border: 1px solid #CBD5E1; padding: 0 10px; font: inherit; font-size: 0.88rem; background: #fff; }
            .si-weeks { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; max-height: 280px; overflow-y: auto; }
            .si-week { display: grid; grid-template-columns: 112px 1fr; gap: 8px; align-items: center; padding: 8px 10px; border-radius: 10px; font-size: 0.8rem; background: #F8FAFC; border: 1px solid #E2E8F0; color: #334155; }
            .si-week strong { font-size: 0.82rem; color: #0F172A; }
            .si-week.is-follow { background: #F0FDF4; border-color: #BBF7D0; }
            .si-week.is-mixed { background: #FFFBEB; border-color: #FDE68A; }
            .si-week.is-empty { background: #F1F5F9; color: #64748B; }
            .si-week.is-stop-week { box-shadow: inset 3px 0 0 #DC2626; }
            .si-loading { padding: 14px; text-align: center; color: #64748B; font-size: 0.86rem; }
            .schedule-inheritance-hint { display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap; margin: 0 0 10px; padding: 10px 12px; border-radius: 12px; font-size: 0.84rem; line-height: 1.45; background: #EFF6FF; border: 1px solid #BFDBFE; color: #1E3A8A; }
            .schedule-inheritance-hint.is-stop { background: #FEF2F2; border-color: #FECACA; color: #991B1B; }
            .schedule-inheritance-hint span { flex: 1 1 260px; min-width: 0; }
            .schedule-inheritance-hint button { flex: 0 0 auto; min-height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid currentColor; background: #fff; color: inherit; font: inherit; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
            @media (max-width: 480px) { .si-week { grid-template-columns: 1fr; gap: 2px; } }
        `;
        document.head.appendChild(style);
    }

    const ICON_LAYERS = '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>';
    const ICON_CLOSE = '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

    function guideHtml(sourceMonday) {
        return `
            <div class="si-guide" data-si-guide>
                <h3>Lịch kế thừa hoạt động thế nào?</h3>
                <ol>
                    <li>Ngày nào <b>chưa có lịch riêng</b> sẽ tự dùng lịch của <b>cùng thứ</b> ở tuần gần nhất trước đó
                        (VD: Thứ 2 tuần sau dùng lịch Thứ 2 tuần ${escapeHtml(weekLabel(sourceMonday))}).</li>
                    <li>Chỉ lớp, giờ, phòng, GV chính được kế thừa. <b>Lớp đã tắt, GV thay thế, vắng</b> chỉ có hiệu lực đúng ngày đó, không kế thừa.</li>
                    <li>Sửa bất kỳ ô nào ở một ngày đang kế thừa → ngày đó thành <b>lịch riêng</b>, và các tuần sau sẽ kế thừa theo ngày vừa sửa.</li>
                </ol>
                <h3>Chọn cách áp dụng</h3>
                <ul>
                    <li><b>Đến khi tôi tự thay đổi</b>: các tuần sau cứ dùng lịch tuần này mãi, cho tới ngày bạn sửa lịch.
                        Nếu trước đây đã đặt "dừng ở tuần …" thì điểm dừng đó được gỡ.</li>
                    <li><b>Đến hết tuần …</b>: dùng khi khoá học / lịch này chỉ chạy tới một tuần (hết khoá, nghỉ hè…).
                        Các tuần tới hết tuần đã chọn dùng lịch này; <b>từ tuần kế tiếp lịch để trống</b> để bạn xếp lịch mới.</li>
                </ul>
                <p>Ngày đã có lịch riêng luôn được <b>giữ nguyên</b>, ngày đã qua và hôm nay không bị thay đổi.
                    Chỉ áp dụng cho cơ sở đang xem. Xem trước danh sách tuần bên dưới trước khi bấm Áp dụng.</p>
            </div>`;
    }

    function closeManager() {
        if (!openState) return;
        const { root, keyHandler, returnFocus } = openState;
        document.removeEventListener('keydown', keyHandler);
        root.remove();
        document.documentElement.classList.remove('ch-open');
        openState = null;
        try { returnFocus && returnFocus.focus && returnFocus.focus(); } catch (_) { /* nút có thể đã mất */ }
    }

    function selectedChoice(state) {
        const form = state.root.querySelector('form');
        const mode = form.elements.mode.value === 'until' ? 'until' : 'forever';
        const lastWeek = Number(form.elements.lastWeek.value);
        return { mode, lastWeek: Number.isInteger(lastWeek) ? lastWeek : 0 };
    }

    function renderPreview(state) {
        const box = state.root.querySelector('[data-si-preview]');
        const submit = state.root.querySelector('[data-si-submit]');
        if (!state.snapshot) return;
        const { mode, lastWeek } = selectedChoice(state);
        const plan = buildPlan(state, mode, lastWeek);
        state.plan = plan;
        const headline = mode === 'forever'
            ? `Các tuần sau tiếp tục dùng lịch tuần <strong>${escapeHtml(weekLabel(state.sourceMonday))}</strong> cho đến khi bạn tự sửa.`
            : (lastWeek === 0
                ? `Chỉ tuần đang xem dùng lịch này; <strong>từ tuần ${escapeHtml(weekLabel(plan.stopMonday))} lịch để trống</strong>.`
                : `Dùng lịch này tới hết tuần <strong>${escapeHtml(weekLabel(addDays(state.sourceMonday, 7 * lastWeek)))}</strong>; từ tuần ${escapeHtml(weekLabel(plan.stopMonday))} lịch để trống.`);
        const changes = [];
        if (plan.removeStops.length) changes.push(`gỡ ${plan.removeStops.length} ngày điểm dừng cũ`);
        if (plan.addStops.length) changes.push(`đặt điểm dừng cho ${plan.addStops.length} ngày`);
        const note = plan.skippedPast.length
            ? `<span class="ch-summary-note">${plan.skippedPast.length} ngày của tuần dừng đã qua/hôm nay nên không đổi.</span>` : '';
        box.innerHTML = `
            <p class="ch-summary">${headline}<br>${changes.length ? 'Sẽ ' + escapeHtml(changes.join(', ')) + '.' : 'Không cần ghi gì thêm — lịch đã đúng như lựa chọn.'}${note}</p>
            <ul class="si-weeks">${plan.weeks.map(item => `
                <li class="si-week ${weekTone(item.counts)}${plan.stopMonday === item.monday ? ' is-stop-week' : ''}">
                    <strong>Tuần ${escapeHtml(weekLabel(item.monday))}</strong>
                    <span>${weekSummary(item.counts)}</span>
                </li>`).join('')}</ul>`;
        submit.disabled = state.busy;
        submit.textContent = changes.length ? 'Áp dụng' : 'Đóng';
    }

    async function loadSnapshot(state) {
        const service = dbService();
        const keys = [];
        for (let offset = 7; offset < 7 * (WEEKS_AHEAD + 2); offset += 1) keys.push(addDays(state.sourceMonday, offset));
        try {
            state.snapshot = await service.getScheduleInheritanceSnapshot(state.branch, keys);
            if (openState !== state) return;
            renderPreview(state);
        } catch (error) {
            console.error('[ScheduleInheritance] preview', error);
            if (openState !== state) return;
            state.root.querySelector('[data-si-preview]').innerHTML =
                `<p class="ch-summary is-error">Chưa tải được lịch các tuần sau: ${escapeHtml(error?.message || error)}. Đóng và thử lại.</p>`;
        }
    }

    async function applyPlan(state) {
        const plan = state.plan;
        if (!plan) return;
        if (!plan.removeStops.length && !plan.addStops.length) { closeManager(); return; }
        const ui = uiService();
        const question = plan.mode === 'forever'
            ? `Các tuần sau sẽ tiếp tục dùng lịch tuần ${weekLabel(state.sourceMonday)} (${state.branch.toUpperCase()}) cho đến khi bạn tự sửa. Áp dụng?`
            : `Lịch ${state.branch.toUpperCase()} dùng tới hết tuần ${weekLabel(addDays(plan.stopMonday, -7))}, từ tuần ${weekLabel(plan.stopMonday)} để trống. Ngày đã có lịch riêng giữ nguyên. Áp dụng?`;
        const confirmed = ui && typeof ui.confirm === 'function' ? await ui.confirm(question) : global.confirm(question);
        if (!confirmed || openState !== state) return;
        const service = dbService();
        const mutationKey = 'inherit-weeks';
        const canTrack = typeof global.beginScheduleMutation === 'function';
        if (canTrack && !global.beginScheduleMutation(mutationKey)) return;
        state.busy = true;
        const submit = state.root.querySelector('[data-si-submit]');
        submit.disabled = true;
        submit.textContent = 'Đang áp dụng…';
        let removed = 0, added = 0, failure = null;
        try {
            if (plan.mode === 'forever') {
                // Gỡ cả điểm dừng nằm xa hơn khoảng xem trước (tra theo manifest).
                const today = todayKey();
                const limit = addDays(state.sourceMonday, 7);
                const extra = Object.values(state.snapshot.manifest || {}).flat()
                    .filter(id => typeof id === 'string' && id.startsWith(`${state.branch}__`))
                    .map(id => id.split('__').pop())
                    .filter(key => key >= limit && key > today && !(key in state.snapshot.days));
                plan.removeStops.push(...new Set(extra));
            }
            for (const key of plan.removeStops) {
                if (await service.removeScheduleInheritanceStop(`${state.branch}__${key}`)) removed += 1;
            }
            for (const key of plan.addStops) {
                const compositeKey = `${state.branch}__${key}`;
                // Đọc lại ngay trước khi ghi: chỉ đặt điểm dừng khi ngày đó vẫn đang hiện lớp kế thừa.
                const live = await service.getSchedule(compositeKey, { source: 'server' });
                const inherited = SECTION_KEYS.some(section => (live?.[section] || []).some(row => row && row._isInheritedSchedule === true));
                if (!inherited) continue;
                if (await service.createScheduleInheritanceStop(compositeKey, {
                    sourceWeek: state.sourceMonday, lastInheritedWeek: addDays(plan.stopMonday, -7)
                })) added += 1;
            }
        } catch (error) {
            failure = error;
            console.error('[ScheduleInheritance] apply', error);
        } finally {
            service._invalidate(`schedule_${state.branch}__`);
            state.busy = false;
            closeManager();
            if (canTrack) await global.finishScheduleMutation(mutationKey);
        }
        const done = `Đã gỡ ${removed} điểm dừng, đặt ${added} điểm dừng.`;
        if (failure) {
            ui?.toast?.(escapeHtml(`${done} Dừng giữa chừng: ${failure.message || failure}. Có thể mở lại và áp dụng tiếp — các bước đã xong không bị lặp.`), 'error');
        } else {
            ui?.toast?.(escapeHtml(plan.mode === 'forever'
                ? `Các tuần sau sẽ tiếp tục dùng lịch này cho đến khi bạn sửa. ${done}`
                : `Lịch dùng tới hết tuần ${weekLabel(addDays(plan.stopMonday, -7))}, sau đó để trống. ${done}`), 'success');
        }
    }

    function openManager() {
        if (openState) return;
        const service = dbService();
        if (!service || typeof service.getScheduleInheritanceSnapshot !== 'function') {
            global.alert('Chưa tải xong ứng dụng. Vui lòng tải lại trang.');
            return;
        }
        injectStyles();
        const branch = currentBranchKey();
        const sourceMonday = viewedMondayKey();
        const today = todayKey();
        const weekOptions = [];
        for (let week = 0; week <= WEEKS_AHEAD; week += 1) {
            const stopMonday = addDays(sourceMonday, 7 * (week + 1));
            if (addDays(stopMonday, 6) <= today) continue; // tuần dừng đã qua hết
            const lastMonday = addDays(sourceMonday, 7 * week);
            weekOptions.push(`<option value="${week}"${week === 4 ? ' selected' : ''}>${week === 0
                ? `Chỉ tuần đang xem (${escapeHtml(weekLabel(lastMonday))})`
                : `Hết tuần ${escapeHtml(weekLabel(lastMonday))} (${week} tuần sau)`}</option>`);
        }
        let guideSeen = false;
        try { guideSeen = localStorage.getItem(GUIDE_SEEN_KEY) === '1'; } catch (_) { guideSeen = false; }
        const root = document.createElement('div');
        root.className = 'ch-backdrop';
        root.innerHTML = `
            <section class="ch-sheet" role="dialog" aria-modal="true" aria-labelledby="si-title">
                <header class="ch-head">
                    <span class="ch-head-icon" style="background:#ECFDF5;color:#047857">${ICON_LAYERS}</span>
                    <div class="ch-head-text">
                        <h2 id="si-title">Kế thừa lịch cho các tuần sau</h2>
                        <p>Nguồn: tuần ${escapeHtml(weekLabel(sourceMonday))} · ${escapeHtml(branch.toUpperCase())}</p>
                    </div>
                    <button type="button" class="si-guide-toggle" data-si-guide-toggle aria-expanded="${guideSeen ? 'false' : 'true'}">Hướng dẫn</button>
                    <button type="button" class="ch-close" data-si-close aria-label="Đóng">${ICON_CLOSE}</button>
                </header>
                <div class="ch-body">
                    <div data-si-guide-slot>${guideSeen ? '' : guideHtml(sourceMonday)}</div>
                    <form class="ch-form" novalidate>
                        <div class="si-options" role="radiogroup" aria-label="Cách kế thừa">
                            <label class="si-option"><input type="radio" name="mode" value="forever" checked>
                                <span><b>Đến khi tôi tự thay đổi</b><small>Các tuần sau cứ dùng lịch tuần này, cho tới khi bạn sửa lịch.</small></span></label>
                            <label class="si-option"><input type="radio" name="mode" value="until">
                                <span><b>Đến hết một tuần nhất định</b><small>Sau tuần đã chọn, lịch để trống (hết khoá, nghỉ hè…).</small>
                                <select name="lastWeek" aria-label="Dùng lịch này đến hết tuần">${weekOptions.join('')}</select></span></label>
                        </div>
                        <div data-si-preview><p class="si-loading">Đang xem trước ${WEEKS_AHEAD} tuần tới…</p></div>
                        <button type="submit" class="btn btn-primary ch-submit" data-si-submit disabled>Áp dụng</button>
                    </form>
                </div>
            </section>`;
        const state = { root, branch, sourceMonday, snapshot: null, plan: null, busy: false, returnFocus: document.activeElement };
        state.keyHandler = event => { if (event.key === 'Escape' && !state.busy) closeManager(); };
        openState = state;
        document.body.appendChild(root);
        document.documentElement.classList.add('ch-open');
        document.addEventListener('keydown', state.keyHandler);
        if (!guideSeen) { try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch (_) { /* không bắt buộc */ } }

        const form = root.querySelector('form');
        root.addEventListener('click', event => {
            if (state.busy) return;
            if (event.target === root || event.target.closest('[data-si-close]')) { closeManager(); return; }
            const toggle = event.target.closest('[data-si-guide-toggle]');
            if (toggle) {
                const slot = root.querySelector('[data-si-guide-slot]');
                const open = !slot.innerHTML.trim();
                slot.innerHTML = open ? guideHtml(sourceMonday) : '';
                toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            }
        });
        form.addEventListener('change', event => {
            if (event.target.name === 'lastWeek') form.elements.mode.value = 'until';
            renderPreview(state);
        });
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (!state.busy) applyPlan(state);
        });
        root.querySelector('[data-si-close]').focus();
        loadSnapshot(state);
    }

    // Dải nhắc phía trên bảng lịch (chỉ người xếp lịch thấy).
    function renderHint(dayData, dateKey) {
        const table = document.getElementById('schedule-table');
        if (!table || !table.parentNode) return;
        let hint = document.getElementById('schedule-inheritance-hint');
        const service = dbService();
        let message = '', tone = '';
        if (isScheduleManager() && dayData && typeof dayData === 'object') {
            if (service && typeof service.isScheduleInheritanceStop === 'function' && service.isScheduleInheritanceStop(dayData)) {
                tone = 'is-stop';
                message = 'Ngày này là <b>điểm dừng kế thừa</b>: lịch để trống từ đây (do "Kế thừa lịch… đến hết tuần"). Thêm lớp như bình thường nếu cần.';
            } else {
                const inheritedRow = SECTION_KEYS.map(section => dayData[section] || []).flat()
                    .find(row => row && row._isInheritedSchedule === true && row._inheritedFromScheduleDocId);
                if (inheritedRow) {
                    const sourceDate = String(inheritedRow._inheritedFromScheduleDocId).split('__').pop();
                    const label = /^\d{4}-\d{2}-\d{2}$/.test(sourceDate)
                        ? `${WEEKDAY_NAMES[parseKey(sourceDate).getDay()]} ${shortDate(sourceDate)}/${sourceDate.slice(0, 4)}` : sourceDate;
                    message = `Ngày này chưa có lịch riêng — đang <b>kế thừa lịch ${escapeHtml(label)}</b>. Sửa bất kỳ ô nào sẽ lưu thành lịch riêng của ngày này.`;
                }
            }
        }
        if (!message) { if (hint) hint.remove(); return; }
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'schedule-inheritance-hint';
            table.parentNode.insertBefore(hint, table);
        }
        hint.className = `schedule-inheritance-hint ${tone}`.trim();
        hint.innerHTML = `<span>${message}</span><button type="button">Kế thừa lịch…</button>`;
        hint.querySelector('button').onclick = () => openManager();
        injectStyles();
    }

    global.ScheduleInheritance = { openManager, closeManager, buildPlan, resolveDay, renderHint, _test: { addDays, weekLabel } };
    global.openScheduleInheritanceModal = openManager;
    global.renderScheduleInheritanceHint = renderHint;
})(typeof window !== 'undefined' ? window : globalThis);
