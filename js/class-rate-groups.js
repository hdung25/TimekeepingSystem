/* Lương/Giờ helpers for the salary popup (Tính Lương):
   - a combined class "Toán 1 + Toán 7" is paid like its highest component;
   - "Giá theo khối" fills one rate per subject block and shows last month's
     rates and the salary-review schedule.
   Nothing here writes: "Lưu & Tính" stays the only save. */
(function (global) {
    'use strict';
    const STUDENT_COUNT = /\(\s*\+\s*\d+\s*(?:hs|học\s*sinh)\s*\)/i;
    const norm = name => (typeof global.normalizeChipFilterName === 'function'
        ? global.normalizeChipFilterName(name) : String(name || '').trim());
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = value => value == null || value === '' ? '—' : Number(value).toLocaleString('vi-VN') + 'đ';
    const vnDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value.split('-').reverse().join('/') : '';

    const isCombined = name => typeof name === 'string' && name.includes('+') && !STUDENT_COUNT.test(name);
    const isSpecialRow = name => !name || STUDENT_COUNT.test(name) || /^Tiếp Tân/i.test(name);
    const baseOfStudentRow = name => STUDENT_COUNT.test(String(name || '')) ? String(name).replace(STUDENT_COUNT, '').trim() : '';
    const componentsOf = name => String(name).split('+').map(part => norm(part.trim())).filter(Boolean);

    // Highest component rate; `rateOf` returns a number (0 = unknown).
    function combinedRate(name, rateOf) {
        let rate = 0, from = '';
        componentsOf(name).forEach(component => {
            const value = Number(rateOf(component)) || 0;
            if (value > rate) { rate = value; from = component; }
        });
        return { rate, from };
    }

    // Monthly map used by every payroll path. A combined class without a rate
    // saved for THIS month follows its highest component (an inherited or
    // missing value would otherwise keep last month's price).
    function deriveCombinedRates(classRates, names, explicitRates, fallbackRate) {
        const rates = { ...(classRates || {}) }, derived = {};
        const rateOf = component => Number(rates[component]) > 0 ? Number(rates[component]) : (Number(fallbackRate?.(component)) || 0);
        [...new Set(names)].filter(isCombined).forEach(name => {
            if (Number(explicitRates?.[name]) > 0) return;
            const { rate, from } = combinedRate(name, rateOf);
            if (rate > 0) { rates[name] = rate; derived[name] = from; }
        });
        return { rates, derived };
    }

    // ---------- live link inside the popup table ----------
    let context = { explicit: {}, fallback: () => 0 };
    const body = () => document.getElementById('class-rate-table-body');
    const inputs = () => Array.from(body()?.querySelectorAll('.class-rate-input') || []);
    function rowRate(name) {
        const input = inputs().find(item => item.dataset.name === name && !item.disabled);
        if (input) return parseFormattedNumber(input.value) || 0;
        return Number(context.fallback(name)) || 0;
    }
    function badgeFor(input) {
        const cell = input.closest('tr')?.children[1];
        if (!cell) return null;
        let badge = cell.querySelector('.crg-badge');
        if (!badge) { badge = document.createElement('span'); badge.className = 'crg-badge'; cell.appendChild(badge); }
        return badge;
    }
    function paintBadge(input, from) {
        const badge = badgeFor(input);
        if (!badge) return;
        if (input.dataset.combinedAuto === 'true') {
            badge.innerHTML = from ? `= ${esc(from)} (môn cao nhất)` : 'theo môn cao nhất';
            badge.className = 'crg-badge auto';
        } else {
            badge.innerHTML = 'chỉnh tay · <button type="button" class="crg-reset" data-crg-reset="1">theo môn cao nhất</button>';
            badge.className = 'crg-badge manual';
        }
    }
    // Updates auto combined / crowded-class inputs only (no recalculation; the caller recalculates).
    function syncCombined() {
        // "E4 (+10 HS)" keeps its gap to "E4": 48k/52k with E4 typed as 50k gives 54k.
        inputs().filter(input => input.dataset.studentFollow === 'true' && !input.disabled).forEach(input => {
            const base = rowRate(baseOfStudentRow(input.dataset.name));
            const rate = Number(input.dataset.studentOwn) + base - Number(input.dataset.studentBase);
            if (base >= 1000 && rate > 0) input.value = formatNumberWithCommas(rate); // ignore half-typed "5", "50"…
        });
        inputs().filter(input => isCombined(input.dataset.name) && !input.disabled).forEach(input => {
            const { rate, from } = combinedRate(input.dataset.name, rowRate);
            if (input.dataset.combinedAuto === 'true' && rate > 0) input.value = formatNumberWithCommas(rate);
            paintBadge(input, from);
        });
    }
    function attach(options = {}) {
        context = { explicit: options.explicitRates || {}, fallback: options.fallbackRate || (() => 0) };
        const table = body();
        if (!table) return;
        inputs().filter(input => isCombined(input.dataset.name) && !input.disabled).forEach(input => {
            const { rate } = combinedRate(input.dataset.name, rowRate);
            const saved = Number(context.explicit[input.dataset.name]) || 0;
            input.dataset.combinedAuto = rate > 0 && (!saved || saved === rate) ? 'true' : 'false';
        });
        inputs().filter(input => baseOfStudentRow(input.dataset.name) && !input.disabled).forEach(input => {
            const base = inputs().find(item => item.dataset.name === baseOfStudentRow(input.dataset.name) && !item.disabled);
            const own = parseFormattedNumber(input.value), baseRate = base ? parseFormattedNumber(base.value) : 0;
            input.dataset.studentFollow = own > 0 && baseRate > 0 ? 'true' : 'false';
            input.dataset.studentOwn = own; input.dataset.studentBase = baseRate;
        });
        if (!table.dataset.crgBound) {
            table.dataset.crgBound = '1';
            // Capture phase: mark a typed combined rate as manual before the
            // row's own oninput recalculates (and would re-sync it).
            table.addEventListener('input', event => {
                const input = event.target.closest?.('.class-rate-input');
                if (input && isCombined(input.dataset.name)) input.dataset.combinedAuto = 'false';
                if (input && baseOfStudentRow(input.dataset.name)) input.dataset.studentFollow = 'false';
            }, true);
            table.addEventListener('click', event => {
                if (!event.target.closest('[data-crg-reset]')) return;
                const input = event.target.closest('tr')?.querySelector('.class-rate-input');
                if (!input) return;
                input.dataset.combinedAuto = 'true';
                recalculateSalaryModal();
            });
        }
        syncCombined();
    }

    // ---------- "Giá theo khối" popup ----------
    function blocksFor(rows, catalog) {
        const P = global.SalaryReviewPolicy;
        const groups = P ? P.catalogGroups(catalog || []) : [];
        const subjectByName = new Map();
        (catalog || []).filter(s => s && s.isGroup !== true).forEach(s => {
            const key = norm(s.name);
            if (!subjectByName.has(key)) subjectByName.set(key, s);
        });
        const blocks = new Map();
        rows.forEach(row => {
            const subject = subjectByName.get(row.name);
            const group = subject && groups.find(g => g.subjectIds.includes(String(subject.id)));
            const id = group ? group.id : 'other', name = group ? group.name : 'Lớp khác (liên kết, tại nhà, chưa xếp nhóm)';
            if (!blocks.has(id)) blocks.set(id, { id, name, subjectIds: group ? group.subjectIds : [], rows: [] });
            blocks.get(id).rows.push(row);
        });
        return [...blocks.values()].sort((a, b) => (a.id === 'other') - (b.id === 'other') || a.name.localeCompare(b.name, 'vi'));
    }
    const unique = values => [...new Set(values.filter(v => Number(v) > 0).map(Number))];
    const ratesText = values => { const list = unique(values); return list.length ? list.map(money).join(' / ') : '—'; };
    function reviewText(block, review) {
        if (!review) return '<span class="crg-muted">Không xem được lịch xét (chỉ Admin chính).</span>';
        const P = global.SalaryReviewPolicy, today = P.dateKey();
        const groups = (review.profile?.groups || []).filter(g => g.enabled !== false && (g.subjectIds || []).some(id => block.subjectIds.includes(id)));
        if (!groups.length) return '<span class="crg-muted">Chưa có lịch xét tăng lương</span>';
        return groups.map(g => {
            if (g.scheduledChange?.effectiveFrom > today) return `<b class="crg-ok">Đã duyệt lên ${money(g.scheduledChange.newRate)} từ ${vnDate(g.scheduledChange.effectiveFrom)}</b>`;
            if (!g.confirmed) return '<span class="crg-muted">Chưa xác nhận mốc xét</span>';
            const ev = P.evaluate(g, {}, review.config, today, review.profile.personOverrides || {});
            const cls = ev.overdue ? 'crg-danger' : ev.visibleThisMonth ? 'crg-warn' : '';
            return `<span class="${cls}">Xét tăng: ${vnDate(ev.dueDate)} · ${esc(ev.label)}</span>`;
        }).join('<br>');
    }
    async function loadReview(staffId) {
        try {
            const database = global.db;
            const [profile, config] = await Promise.all([
                database.collection('salary_review_profiles').doc(staffId).get(),
                database.collection('salary_review_settings').doc('default').get()
            ]);
            return { profile: profile.exists ? profile.data() : null,
                config: { cycleMonths: 3, minimumHours: null, extraMonths: 1, ...(config.exists ? config.data() : {}) } };
        } catch (_) { return null; }
    }
    function ensureDialog() {
        let dialog = document.getElementById('crg-dialog');
        if (dialog) return dialog;
        const style = document.createElement('style');
        style.textContent = `.crg-badge{display:block;font-size:.7rem;font-weight:600;margin-top:2px}.crg-badge.auto{color:#047857}.crg-badge.manual{color:#9a3412}
.crg-reset{border:0;background:none;color:#4f46e5;text-decoration:underline;cursor:pointer;font:inherit;padding:0}
#crg-dialog{position:fixed;inset:0;margin:auto;height:fit-content;border:0;padding:0;border-radius:16px;width:min(760px,calc(100vw - 20px));max-height:calc(100vh - 30px);box-shadow:0 24px 60px rgba(15,23,42,.28);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1e293b}
#crg-dialog::backdrop{background:rgba(15,23,42,.45)}
.crg-wrap{display:flex;flex-direction:column;max-height:calc(100vh - 30px)}
.crg-head{display:flex;justify-content:space-between;gap:1rem;padding:1rem 1.2rem .8rem;border-bottom:1px solid #e5ede7}.crg-head h2{margin:.1rem 0;font-size:1.1rem}.crg-head p{margin:0;font-size:.8rem;color:#64748b}
.crg-x{border:0;background:#f1f5f9;width:34px;height:34px;border-radius:50%;font-size:1.3rem;cursor:pointer;color:#475569;flex-shrink:0}
.crg-body{overflow:auto;padding:.8rem 1.2rem;display:flex;flex-direction:column;gap:.7rem}
.crg-card{border:1px solid #e2e8f0;border-radius:12px;padding:.75rem .9rem;display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:.5rem 1rem;align-items:start}
.crg-card h3{margin:0;font-size:.92rem}.crg-classes{font-size:.75rem;color:#64748b;margin:.15rem 0 .45rem}
.crg-facts{display:grid;grid-template-columns:auto 1fr;gap:.15rem .6rem;font-size:.8rem}.crg-facts span:nth-child(odd){color:#64748b}
.crg-input label{display:flex;flex-direction:column;gap:.3rem;font-size:.78rem;font-weight:700;color:#334155}
.crg-input input{border:1px solid #cbd8d1;border-radius:8px;padding:.5rem .6rem;font:inherit;font-size:.95rem;font-weight:700;text-align:right;width:100%;box-sizing:border-box}
.crg-input input:focus{outline:2px solid #6ee7b7;border-color:#059669}
.crg-link{border:0;background:none;color:#4f46e5;cursor:pointer;font-size:.74rem;padding:.3rem 0 0;text-align:left}
.crg-muted{color:#94a3b8}.crg-ok{color:#047857}.crg-warn{color:#b45309;font-weight:700}.crg-danger{color:#b91c1c;font-weight:700}
.crg-combined{font-size:.78rem;color:#475569;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:.6rem .8rem}
.crg-foot{display:flex;justify-content:space-between;gap:.5rem;align-items:center;flex-wrap:wrap;padding:.8rem 1.2rem 1rem;border-top:1px solid #e5ede7}
.crg-foot a{font-size:.8rem;color:#4f46e5}.crg-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:.55rem .9rem;font-weight:700;cursor:pointer;font:inherit;font-size:.85rem}
.crg-primary{background:#047857;border-color:#047857;color:#fff}
@media(max-width:600px){.crg-card{grid-template-columns:1fr}}`;
        document.head.appendChild(style);
        dialog = document.createElement('dialog');
        dialog.id = 'crg-dialog';
        dialog.setAttribute('aria-labelledby', 'crg-title');
        document.body.appendChild(dialog);
        dialog.addEventListener('click', event => {
            if (event.target === dialog || event.target.closest('[data-crg-close]')) dialog.close();
            const prev = event.target.closest('[data-crg-prev]');
            if (prev) { const input = dialog.querySelector(`input[data-crg-block="${prev.dataset.crgPrev}"]`); if (input) input.value = formatNumberWithCommas(Number(prev.dataset.rate)); }
            if (event.target.closest('[data-crg-apply]')) applyBlocks(dialog);
        });
        dialog.addEventListener('input', event => {
            const input = event.target.closest('input[data-crg-block]');
            if (!input) return;
            const digits = input.value.replace(/[^0-9]/g, '');
            input.value = digits ? formatNumberWithCommas(Number(digits)) : '';
        });
        return dialog;
    }
    let lastBlocks = [];
    function applyBlocks(dialog) {
        let changed = 0;
        lastBlocks.forEach(block => {
            const raw = dialog.querySelector(`input[data-crg-block="${CSS.escape(block.id)}"]`)?.value || '';
            const rate = parseFormattedNumber(raw);
            if (!raw.trim() || !(rate > 0)) return;
            block.rows.forEach(row => {
                if (row.input.disabled) return;
                if (parseFormattedNumber(row.input.value) !== rate) changed++;
                row.input.value = formatNumberWithCommas(rate);
                const tr = row.input.closest('tr');
                if (tr) { tr.classList.remove('class-rate-row-flash'); void tr.offsetWidth; tr.classList.add('class-rate-row-flash'); }
            });
        });
        recalculateSalaryModal();
        dialog.close();
        if (typeof UIService !== 'undefined') UIService.toast(changed ? `Đã điền ${changed} dòng. Bấm "Lưu và Tính" để lưu.` : 'Không có dòng nào thay đổi.', changed ? 'success' : 'info');
    }
    async function open(options) {
        const { staffId, monthStr, staffName, staffCode } = options || {};
        const dialog = ensureDialog();
        const rows = inputs().filter(input => !isSpecialRow(input.dataset.name) && !isCombined(input.dataset.name))
            .map(input => ({ name: input.dataset.name, input, minutes: Number(input.dataset.totalMinutes) || 0 }));
        const combined = inputs().filter(input => isCombined(input.dataset.name));
        dialog.innerHTML = '<div class="crg-wrap"><div class="crg-body"><p>Đang tải giá tháng trước và lịch xét…</p></div></div>';
        if (!dialog.open) dialog.showModal();
        const [year, month] = String(monthStr).split('-').map(Number);
        const prevDate = new Date(year, month - 2, 1);
        const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        const [prevDoc, review] = await Promise.all([
            DBService.getMonthlySalarySettings(staffId, prevMonth).catch(() => null),
            loadReview(staffId)
        ]);
        const prevRates = (prevDoc?.giao_vien || prevDoc?.['giao-vien'] || {}).class_rates || {};
        lastBlocks = blocksFor(rows, global.currentSubjectCatalog || []);
        const hours = minutes => (minutes / 60).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + 'h';
        const prevMonthLabel = 'T' + (prevDate.getMonth() + 1);
        dialog.innerHTML = `<div class="crg-wrap">
            <header class="crg-head"><div><p style="font-size:.66rem;font-weight:800;letter-spacing:.1em;color:#047857">GIÁ THEO KHỐI · THÁNG ${month}/${year}</p>
                <h2 id="crg-title">${esc(staffName || '')} ${staffCode ? `<span style="font-size:.72rem;color:#065f46;background:#ecfdf5;border-radius:999px;padding:.05rem .45rem">${esc(staffCode)}</span>` : ''}</h2>
                <p>Nhập một giá cho cả khối; ô để trống thì giữ nguyên. Lớp ghép tự theo môn cao nhất.</p></div>
                <button type="button" class="crg-x" data-crg-close aria-label="Đóng">×</button></header>
            <div class="crg-body">
                ${lastBlocks.length ? lastBlocks.map(block => {
                    const current = unique(block.rows.map(row => parseFormattedNumber(row.input.value)));
                    const previous = unique(block.rows.map(row => prevRates[row.name]));
                    const blockId = esc(block.id);
                    return `<div class="crg-card"><div><h3>${esc(block.name)}</h3>
                        <div class="crg-classes">${block.rows.map(row => `${esc(row.name)} (${hours(row.minutes)})`).join(' · ')}</div>
                        <div class="crg-facts"><span>${prevMonthLabel}:</span><span>${ratesText(block.rows.map(row => prevRates[row.name]))}</span>
                        <span>Đang nhập:</span><span>${ratesText(block.rows.map(row => parseFormattedNumber(row.input.value)))}${current.length > 1 ? ' <b class="crg-warn">· nhiều mức</b>' : ''}</span>
                        <span>Xét tăng:</span><span>${reviewText(block, review)}</span></div></div>
                        <div class="crg-input"><label>Giá tháng này (đ/giờ)<input data-crg-block="${blockId}" inputmode="numeric" value="${current.length === 1 ? formatNumberWithCommas(current[0]) : ''}" placeholder="${current.length > 1 ? 'Nhiều mức — để trống giữ nguyên' : 'Ví dụ 50,000'}"></label>
                        ${previous.length === 1 ? `<button type="button" class="crg-link" data-crg-prev="${blockId}" data-rate="${previous[0]}">← Dùng giá ${prevMonthLabel}: ${money(previous[0])}</button>` : ''}</div></div>`;
                }).join('') : '<p class="crg-muted">Không có lớp dạy nào để nhập giá theo khối.</p>'}
                ${combined.length ? `<div class="crg-combined"><b>Lớp ghép</b> (tự lấy giá môn cao nhất sau khi áp dụng): ${combined.map(input => {
                    const { rate, from } = combinedRate(input.dataset.name, rowRate);
                    return `${esc(input.dataset.name)} = ${money(rate)}${from ? ` (theo ${esc(from)})` : ''}${input.dataset.combinedAuto === 'false' ? ' · <b class="crg-warn">đang chỉnh tay</b>' : ''}`;
                }).join(' · ')}</div>` : ''}
            </div>
            <footer class="crg-foot"><a href="xet-tang-luong.html?q=${encodeURIComponent(staffCode || staffName || '')}" target="_blank" rel="noopener">Chỉnh lịch xét tăng lương ↗</a>
                <span><button type="button" class="crg-btn" data-crg-close>Đóng</button> <button type="button" class="crg-btn crg-primary" data-crg-apply>Áp dụng vào bảng</button></span></footer></div>`;
    }

    global.ClassRateGroups = { isCombined, componentsOf, combinedRate, deriveCombinedRates, blocksFor, attach, syncCombined, open };
    if (typeof module !== 'undefined' && module.exports) module.exports = global.ClassRateGroups;
})(typeof window !== 'undefined' ? window : globalThis);
