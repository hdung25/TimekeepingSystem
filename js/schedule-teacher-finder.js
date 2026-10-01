// Thanh "Tìm giáo viên" trên trang Xếp lịch (yêu cầu chị Hà 01/10/2026):
// gõ tên GV → thấy ngay TUẦN ĐANG XEM của GV đó: thứ mấy dạy ca nào / cơ sở nào, thứ mấy nghỉ.
// Không phải nhớ lịch: bấm vào một ngày để nhảy tới đúng ngày (và đúng cơ sở) trong bảng lịch.
//
// Chỉ ĐỌC dữ liệu lịch qua DBService.getSchedule (đã có sẵn, kể cả lịch kế thừa theo thứ) và dùng
// lại các hàm của schedule.js (getGVList, isRowMainTeacherAbsent, isCenterClosed) nên cách hiểu
// "nghỉ" trùng khớp với bảng lịch; không ghi gì lên Firestore.
(function (global) {
    'use strict';

    const BRANCHES = ['cs1', 'cs2', 'cs3'];
    const BRANCH_LABEL = { cs1: 'CS1', cs2: 'CS2', cs3: 'CS3' };
    const MAX_SUGGESTIONS = 8;
    const CACHE_MS = 60 * 1000;

    const $ = id => document.getElementById(id);
    const esc = value => (typeof scheduleEscapeHTML === 'function'
        ? scheduleEscapeHTML(value)
        : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));

    function fold(value) {
        return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim();
    }

    const view = {
        weekKey: '',
        loadedAt: 0,
        loading: null,
        // days[i] = { dateKey, closedAll, rows: [{ branch, section, row }] }
        days: [],
        teachers: new Map(), // key -> { key, id, name }
        picked: null,
        suggestions: [],
        activeIndex: 0
    };

    function weekDates() {
        const start = new Date(currentWeekStart || Date.now());
        return Array.from({ length: 7 }, (_, index) => {
            const d = new Date(start);
            d.setDate(d.getDate() + index);
            return { date: d, key: getLocalDateKey(d) };
        });
    }

    function teacherKey(entry) {
        const id = String(entry?.id || '').trim();
        return id ? `id:${id}` : `name:${fold(entry?.name)}`;
    }

    async function loadWeek(force) {
        const dates = weekDates();
        const weekKey = dates[0].key;
        if (!force && view.weekKey === weekKey && Date.now() - view.loadedAt < CACHE_MS && view.days.length) return;
        if (view.loading && view.loading.weekKey === weekKey && !force) return view.loading.promise;

        const promise = (async () => {
            const jobs = [];
            dates.forEach(({ key }, dayIndex) => BRANCHES.forEach(branch => {
                jobs.push(DBService.getSchedule(`${branch}__${key}`)
                    .then(data => ({ dayIndex, branch, data: data || {} }))
                    .catch(() => ({ dayIndex, branch, data: {}, failed: true })));
            }));
            const results = await Promise.all(jobs);
            const days = dates.map(({ key }) => ({ dateKey: key, rows: [] }));
            const teachers = new Map();
            let failed = 0;
            results.forEach(({ dayIndex, branch, data, failed: bad }) => {
                if (bad) failed += 1;
                SECTIONS.forEach(section => {
                    (Array.isArray(data[section.key]) ? data[section.key] : []).forEach(row => {
                        if (!row) return;
                        days[dayIndex].rows.push({ branch, section, row });
                        ['gv', 'gvThayTe'].forEach(field => getGVList(row, field).forEach(t => {
                            if (!t || !String(t.name || '').trim()) return;
                            const key = teacherKey(t);
                            if (!teachers.has(key)) teachers.set(key, { key, id: String(t.id || '').trim(), name: String(t.name).trim() });
                        }));
                    });
                });
            });
            // Cả GV chưa có ca nào trong tuần (nghỉ cả tuần) vẫn tìm được nếu có trong danh bạ.
            (Array.isArray(global._teacherList) ? global._teacherList : []).forEach(u => {
                const name = String(u?.name || u?.username || '').trim();
                if (!name) return;
                const key = teacherKey({ id: u.id, name });
                if (!teachers.has(key)) teachers.set(key, { key, id: String(u.id || '').trim(), name });
            });
            view.weekKey = dates[0].key;
            view.loadedAt = Date.now();
            view.days = days;
            view.teachers = teachers;
            view.failed = failed;
        })();
        view.loading = { weekKey, promise };
        try { await promise; } finally { if (view.loading && view.loading.promise === promise) view.loading = null; }
    }

    function matchesTeacher(teacher, entry) {
        const id = String(entry?.id || '').trim();
        if (teacher.id && id) return teacher.id === id;
        return fold(entry?.name) === fold(teacher.name);
    }

    // Với mỗi ngày: các ca GV dạy (chính / dạy thay), ca GV nghỉ (đã báo nghỉ), hoặc trung tâm nghỉ.
    function summarize(teacher) {
        return view.days.map((day, index) => {
            const shifts = [];
            const absent = [];
            let closedShifts = 0;
            day.rows.forEach(({ branch, section, row }) => {
                const isMain = getGVList(row, 'gv').find(t => matchesTeacher(teacher, t));
                const isSub = getGVList(row, 'gvThayTe').find(t => matchesTeacher(teacher, t));
                if (!isMain && !isSub) return;
                const closed = row.isClosed === true || isCenterClosed(day.dateKey, section.key, global.centerClosures);
                const item = {
                    branch, section, row, closed,
                    label: String(row.lop || '').trim() || 'Chưa có môn',
                    time: String(row.start || section.defaultStart || '')
                };
                if (closed) { closedShifts += 1; return; }
                if (isMain && isRowMainTeacherAbsent(row, isMain.id)) absent.push(item);
                else shifts.push({ ...item, role: isMain ? 'main' : 'sub' });
            });
            const byTime = (a, b) => a.time.localeCompare(b.time);
            shifts.sort(byTime); absent.sort(byTime);
            return { index, dateKey: day.dateKey, shifts, absent, closedShifts };
        });
    }

    function renderSuggestions(query) {
        const box = $('tf-suggest');
        if (!box) return;
        const q = fold(query);
        if (!q) { box.hidden = true; view.suggestions = []; return; }
        view.suggestions = Array.from(view.teachers.values())
            .filter(t => fold(t.name).includes(q))
            .sort((a, b) => {
                const as = fold(a.name).startsWith(q) ? 0 : 1, bs = fold(b.name).startsWith(q) ? 0 : 1;
                return as - bs || a.name.localeCompare(b.name, 'vi');
            })
            .slice(0, MAX_SUGGESTIONS);
        view.activeIndex = 0;
        if (!view.suggestions.length) {
            box.innerHTML = '<div class="tf-empty">Không thấy giáo viên nào tên này trong tuần đang xem.</div>';
            box.hidden = false;
            return;
        }
        box.innerHTML = view.suggestions.map((t, i) =>
            `<button type="button" class="tf-sugg${i === 0 ? ' tf-on' : ''}" data-tf-pick="${i}">${esc(t.name)}</button>`).join('');
        box.hidden = false;
    }

    function setActive(index) {
        const items = Array.from(document.querySelectorAll('#tf-suggest .tf-sugg'));
        if (!items.length) return;
        view.activeIndex = (index + items.length) % items.length;
        items.forEach((el, i) => el.classList.toggle('tf-on', i === view.activeIndex));
        items[view.activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function shiftLine(item, kind) {
        const where = `<span class="tf-br">${BRANCH_LABEL[item.branch] || item.branch}</span>`;
        const subTag = item.role === 'sub' ? '<span class="tf-tag tf-tag-sub">dạy thay</span>' : '';
        return `<button type="button" class="tf-shift tf-${kind}" data-tf-go="${item.branch}" data-tf-day="${item.dayIndex}">
            <b>${esc(item.time)}</b> ${esc(item.label)} ${where}${subTag}${kind === 'off' ? '<span class="tf-tag tf-tag-off">nghỉ</span>' : ''}</button>`;
    }

    function renderResult() {
        const box = $('tf-result');
        if (!box) return;
        const teacher = view.picked;
        if (!teacher) { box.hidden = true; box.innerHTML = ''; return; }
        const days = summarize(teacher);
        const todayKey = getLocalDateKey(new Date());
        const teachDays = days.filter(d => d.shifts.length).map(d => DAYS[d.index]);
        const offDays = days.filter(d => d.absent.length).map(d => DAYS[d.index]);
        const totalShifts = days.reduce((n, d) => n + d.shifts.length, 0);
        const totalOff = days.reduce((n, d) => n + d.absent.length, 0);

        const head = `<div class="tf-head"><strong>${esc(teacher.name)}</strong>
            <button type="button" class="tf-x" data-tf-clear aria-label="Bỏ chọn giáo viên">✕</button></div>
            <div class="tf-sum">${totalShifts
                ? `Tuần này dạy <b>${totalShifts}</b> ca: <b>${esc(teachDays.join(', '))}</b>.`
                : 'Tuần này <b>không có ca dạy</b>.'}
                ${totalOff ? ` <span class="tf-offsum">Nghỉ <b>${totalOff}</b> ca: ${esc(offDays.join(', '))}.</span>` : ''}</div>`;

        const cells = days.map(day => {
            const tab = DAYS[day.index];
            const date = view.days[day.index].dateKey.slice(8, 10) + '/' + view.days[day.index].dateKey.slice(5, 7);
            const lines = [
                ...day.absent.map(i => shiftLine({ ...i, dayIndex: day.index }, 'off')),
                ...day.shifts.map(i => shiftLine({ ...i, dayIndex: day.index }, 'on'))
            ];
            let body = lines.join('');
            if (!body) body = day.closedShifts
                ? '<span class="tf-none">Trung tâm nghỉ</span>'
                : '<span class="tf-none">Không có ca</span>';
            const cls = day.absent.length ? ' tf-day-off' : (day.shifts.length ? ' tf-day-on' : '');
            return `<div class="tf-day${cls}${day.dateKey === todayKey ? ' tf-today' : ''}">
                <div class="tf-dayname">${tab} <small>${date}</small></div>${body}</div>`;
        }).join('');
        const warn = view.failed ? '<div class="tf-warn">Có cơ sở chưa tải được lịch — kết quả có thể thiếu.</div>' : '';
        box.innerHTML = head + `<div class="tf-grid">${cells}</div>` + warn;
        box.hidden = false;
    }

    function pick(teacher) {
        view.picked = teacher;
        const input = $('tf-input');
        if (input) input.value = teacher ? teacher.name : '';
        const box = $('tf-suggest');
        if (box) box.hidden = true;
        renderResult();
    }

    function goTo(branch, dayIndex) {
        if (branch && branch !== currentBranch && typeof global.switchBranch === 'function') global.switchBranch(branch);
        selectedDayIndex = dayIndex;
        renderDayTabs();
        renderTable();
        document.querySelector('.schedule-table-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function injectStyle() {
        if ($('tf-style')) return;
        const style = document.createElement('style');
        style.id = 'tf-style';
        style.textContent = `
        #teacher-finder{max-width:1100px;margin:0 auto 12px;padding:0 4px}
        #teacher-finder .tf-bar{position:relative;display:flex;align-items:center;gap:8px;background:#fff;border:1.5px solid #C7D2FE;border-radius:12px;padding:0 12px}
        #teacher-finder .tf-bar:focus-within{border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.15)}
        #teacher-finder input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:.95rem;min-height:44px;color:#1F2937}
        #tf-suggest{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:30;background:#fff;border:1px solid #D1D5DB;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.14);max-height:280px;overflow:auto;padding:4px}
        .tf-sugg{display:block;width:100%;text-align:left;border:0;background:transparent;padding:10px 12px;border-radius:8px;font:inherit;font-size:.92rem;cursor:pointer;color:#1F2937}
        .tf-sugg:hover,.tf-sugg.tf-on{background:#E0E7FF}
        .tf-empty{padding:10px 12px;color:#6B7280;font-size:.85rem}
        #tf-result{margin-top:8px;background:#fff;border:1.5px solid #E5E7EB;border-radius:12px;padding:10px 12px}
        .tf-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:1rem;color:#312E81}
        .tf-x{border:0;background:#F3F4F6;border-radius:8px;min-width:32px;min-height:32px;cursor:pointer;color:#4B5563}
        .tf-sum{margin:4px 0 8px;font-size:.88rem;color:#374151;line-height:1.45}
        .tf-offsum{color:#B91C1C}
        .tf-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
        .tf-day{border:1px solid #E5E7EB;border-radius:10px;padding:6px;background:#F9FAFB;min-width:0}
        .tf-day-on{background:#ECFDF5;border-color:#A7F3D0}
        .tf-day-off{background:#FEF2F2;border-color:#FECACA}
        .tf-today{box-shadow:inset 0 0 0 2px #4F46E5}
        .tf-dayname{font-weight:700;font-size:.8rem;color:#111827;margin-bottom:4px}
        .tf-dayname small{font-weight:500;color:#6B7280}
        .tf-shift{display:block;width:100%;text-align:left;border:0;background:rgba(255,255,255,.75);border-radius:7px;padding:5px 6px;margin-bottom:4px;font:inherit;font-size:.74rem;line-height:1.3;cursor:pointer;color:#065F46;overflow-wrap:anywhere}
        .tf-shift.tf-off{color:#B91C1C}
        .tf-shift:hover{background:#fff;outline:1px solid #4F46E5}
        .tf-br{display:inline-block;padding:0 5px;border-radius:5px;background:#E0E7FF;color:#3730A3;font-size:.68rem;font-weight:700}
        .tf-tag{display:inline-block;margin-left:4px;padding:0 5px;border-radius:5px;font-size:.66rem;font-weight:700}
        .tf-tag-sub{background:#FEF3C7;color:#92400E}
        .tf-tag-off{background:#FEE2E2;color:#B91C1C}
        .tf-none{font-size:.74rem;color:#9CA3AF}
        .tf-warn{margin-top:6px;font-size:.78rem;color:#B45309}
        @media (max-width:760px){.tf-grid{grid-template-columns:1fr}.tf-day{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:flex-start}.tf-dayname{flex:0 0 74px;margin:0}.tf-day>.tf-shift,.tf-day>.tf-none{flex:1 1 140px;margin:0}}
        `;
        document.head.appendChild(style);
    }

    function mount() {
        if ($('teacher-finder')) return;
        const anchor = $('day-tabs');
        if (!anchor || !anchor.parentNode) return;
        injectStyle();
        const wrap = document.createElement('div');
        wrap.id = 'teacher-finder';
        wrap.innerHTML = `
            <div class="tf-bar">
                <span aria-hidden="true">⌕</span>
                <input id="tf-input" type="search" autocomplete="off" placeholder="Tìm giáo viên — xem thứ mấy dạy, thứ mấy nghỉ…" aria-label="Tìm giáo viên trong tuần đang xem">
                <div id="tf-suggest" hidden></div>
            </div>
            <div id="tf-result" hidden></div>`;
        anchor.parentNode.insertBefore(wrap, anchor);

        const input = $('tf-input');
        input.addEventListener('focus', async () => {
            await loadWeek(false);
            if (!view.picked || input.value !== view.picked.name) renderSuggestions(input.value);
        });
        input.addEventListener('input', async () => {
            if (view.picked && input.value !== view.picked.name) { view.picked = null; renderResult(); }
            await loadWeek(false);
            renderSuggestions(input.value);
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(view.activeIndex + 1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(view.activeIndex - 1); }
            else if (event.key === 'Enter') {
                const teacher = view.suggestions[view.activeIndex];
                if (teacher) { event.preventDefault(); pick(teacher); }
            } else if (event.key === 'Escape') { $('tf-suggest').hidden = true; }
        });
        wrap.addEventListener('click', event => {
            const sug = event.target.closest('[data-tf-pick]');
            if (sug) { pick(view.suggestions[Number(sug.dataset.tfPick)]); return; }
            if (event.target.closest('[data-tf-clear]')) { input.value = ''; pick(null); input.focus(); return; }
            const go = event.target.closest('[data-tf-go]');
            if (go) goTo(go.dataset.tfGo, Number(go.dataset.tfDay));
        });
        document.addEventListener('click', event => {
            if (!event.target.closest('#teacher-finder')) $('tf-suggest').hidden = true;
        });
    }

    // Đổi tuần → kết quả cũ không còn đúng: tải lại tuần mới và vẽ lại nếu đang xem một GV.
    function watchWeekChange() {
        let last = '';
        setInterval(async () => {
            if (!currentWeekStart || !view.picked) { last = ''; return; }
            const key = getLocalDateKey(new Date(currentWeekStart));
            if (key === last) return;
            const first = last === '';
            last = key;
            if (first && view.weekKey === key) return;
            await loadWeek(true);
            renderResult();
        }, 700);
    }

    function boot() {
        if (typeof DBService === 'undefined' || typeof getLocalDateKey !== 'function' || typeof renderTable !== 'function') {
            return setTimeout(boot, 300);
        }
        mount();
        watchWeekChange();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

    global.ScheduleTeacherFinder = { fold, summarize, loadWeek, pick };
})(window);
