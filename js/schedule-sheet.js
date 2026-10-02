// "Bảng lịch gửi GV" trên trang Xếp lịch (yêu cầu 02/10/2026): sau khi xếp lịch xong, người xếp
// lịch bấm một nút là có ngay tờ lịch như bản giấy (SS · Lớp · Phòng · GV · Ghi chú, chia Ca 1 / Ca 2)
// để gửi lên nhóm giáo viên: sao chép ảnh, tải ảnh PNG, chia sẻ thẳng (điện thoại) hoặc sao chép chữ.
//
// Ảnh được dựng ở khổ dọc hẹp (520px × 2) để giáo viên mở trên điện thoại đọc được ngay, không
// phải phóng to. Chỉ ĐỌC lịch qua DBService.getSchedule + readScheduleClosureSettings và dùng lại
// các hàm của schedule.js (getGVList, isRowMainTeacherAbsent, getMappedReplacementIds,
// isCenterClosed) nên GV nghỉ / dạy thay / lớp tắt / trung tâm nghỉ hiển thị khớp bảng lịch.
(function (global) {
    'use strict';

    const BRANCH_LABEL = { cs1: 'Cơ sở 1', cs2: 'Cơ sở 2', cs3: 'Cơ sở 3' };
    const BUOI = [
        { key: 'morning', label: 'Sáng' },
        { key: 'afternoon', label: 'Chiều' },
        { key: 'evening', label: 'Tối' },
        { key: 'all', label: 'Cả ngày' }
    ];
    const DAY_NAMES = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    const HTML2CANVAS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    const SHEET_WIDTH = 520;
    const PREF_KEY = 'tdt_schedule_sheet_prefs';

    const $ = id => document.getElementById(id);
    const esc = value => String(value == null ? '' : value)
        .replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    function parseDateKey(dateKey) {
        const [y, m, d] = String(dateKey || '').split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    }

    function dayName(dateKey) {
        return DAY_NAMES[parseDateKey(dateKey).getDay()];
    }

    function shortDate(dateKey) {
        return `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}/${dateKey.slice(0, 4)}`;
    }

    function sectionNumber(section) {
        return String(section.key).replace(/\D/g, '') || '1';
    }

    // "Nguyễn Thị Kiều My" → "Kiều My", "Võ Thị Giàu" → "Giàu" (giống cách ghi trên tờ giấy).
    // Tên 1–2 chữ giữ nguyên; tên lót "Thị"/"Văn" không đứng trước tên gọi.
    function shortName(name) {
        const words = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (words.length <= 2) return words.join(' ');
        const middle = words[words.length - 2].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        return middle === 'thi' || middle === 'van' ? words[words.length - 1] : words.slice(-2).join(' ');
    }

    function rowTeachers(row) {
        const mains = (getGVList(row, 'gv') || []).filter(t => t && String(t.name || '').trim());
        const subs = (getGVList(row, 'gvThayTe') || []).filter(t => t && String(t.name || '').trim());
        const absentMains = mains.filter(t => t.id && isRowMainTeacherAbsent(row, t.id));
        const presentMains = mains.filter(t => !absentMains.includes(t));
        const usedSubIds = new Set();
        const replacements = absentMains.map(main => {
            const ids = typeof getMappedReplacementIds === 'function' ? getMappedReplacementIds(row, main.id) : [];
            const mapped = subs.filter(s => ids.includes(s.id));
            mapped.forEach(s => usedSubIds.add(s.id || s.name));
            return { main, subs: mapped };
        });
        // GV thay chưa gắn với ai cụ thể: gán cho GV nghỉ chưa có người thay (nếu chỉ có một), còn lại là "dạy thay".
        const loose = subs.filter(s => !usedSubIds.has(s.id || s.name));
        const uncovered = replacements.filter(r => !r.subs.length);
        if (loose.length && uncovered.length === 1) {
            uncovered[0].subs = loose.splice(0, loose.length);
        }
        return { presentMains, replacements, extraSubs: loose };
    }

    function rowIsEmpty(row) {
        return !String(row?.lop || '').trim() && !String(row?.phong || '').trim() &&
            !String(row?.note || '').trim() && !(getGVList(row, 'gv') || []).length &&
            !(getGVList(row, 'gvThayTe') || []).length;
    }

    // Dữ liệu thuần của tờ lịch: dùng cho cả ảnh, chữ và kiểm thử.
    function buildSheetModel(dayData, options) {
        const { dateKey, branch, buoi = 'all', closures = {}, showClosed = true } = options;
        const sections = SECTIONS
            .filter(section => buoi === 'all' || section.key.startsWith(buoi))
            .map(section => {
                const centerClosed = isCenterClosed(dateKey, section.key, closures);
                const rows = (Array.isArray(dayData?.[section.key]) ? dayData[section.key] : [])
                    .filter(row => row && !rowIsEmpty(row))
                    .map(row => ({
                        ss: Number(row.soHS) > 0 ? Number(row.soHS) : '',
                        lop: String(row.lop || '').trim(),
                        phong: String(row.phong || '').trim(),
                        note: String(row.note || '').trim(),
                        start: String(row.start || '').trim() || section.defaultStart,
                        end: String(row.end || '').trim() || section.defaultEnd,
                        time: '',
                        closed: row.isClosed === true,
                        teachers: rowTeachers(row)
                    }))
                    .filter(row => showClosed || !row.closed);
                const open = rows.filter(r => !r.closed);
                // Giờ của ca trên tờ = giờ mà nhiều lớp đang học nhất (thường là giờ chuẩn của ca).
                // Lớp nằm trong ca nhưng học giờ khác (VD Sáng Ca 1 mà 08:00–09:30) được đánh dấu riêng.
                const { start, end } = sectionMainTime(open.length ? open : rows, section);
                rows.forEach(row => {
                    row.offTime = row.start !== start || row.end !== end;
                    row.time = row.offTime ? `${row.start}–${row.end}` : '';
                });
                return {
                    key: section.key,
                    title: `Ca ${sectionNumber(section)}`,
                    buoiLabel: (BUOI.find(b => section.key.startsWith(b.key)) || {}).label || '',
                    start,
                    end,
                    offTimeCount: centerClosed ? 0 : open.filter(r => r.offTime).length,
                    centerClosed,
                    rows: centerClosed ? [] : rows,
                    classCount: centerClosed ? 0 : open.length,
                    studentCount: centerClosed ? 0 : open.reduce((n, r) => n + (Number(r.ss) || 0), 0)
                };
            })
            .filter(section => section.centerClosed || section.rows.length);
        return { dateKey, branch, buoi, sections };
    }

    function sectionMainTime(rows, section) {
        const counts = new Map();
        rows.forEach(r => {
            const key = `${r.start}|${r.end}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        const fallback = `${section.defaultStart}|${section.defaultEnd}`;
        let best = fallback;
        let bestCount = counts.get(fallback) || 0;
        counts.forEach((count, key) => {
            if (count > bestCount) { best = key; bestCount = count; }
        });
        const [start, end] = best.split('|');
        return { start, end };
    }

    function defaultTitle(dateKey, buoi) {
        const b = BUOI.find(item => item.key === buoi);
        const part = b && buoi !== 'all' ? `${b.label} ` : '';
        return `Lịch học ${part}${dayName(dateKey)}`.replace(/\s+/g, ' ').trim();
    }

    // Tên hiển thị: tên gọn, trừ khi hai GV khác nhau trên cùng tờ ra trùng tên gọn.
    function nameResolver(model, useShort) {
        if (!useShort) return t => String(t.name || '').trim();
        const owners = new Map();
        model.sections.forEach(s => s.rows.forEach(r => {
            const t = r.teachers;
            [...t.presentMains, ...t.extraSubs, ...t.replacements.flatMap(x => [x.main, ...x.subs])].forEach(person => {
                const key = shortName(person.name).toLocaleLowerCase('vi');
                const who = person.id || String(person.name).trim();
                if (!owners.has(key)) owners.set(key, new Set());
                owners.get(key).add(who);
            });
        }));
        return t => {
            const s = shortName(t.name);
            return owners.get(s.toLocaleLowerCase('vi'))?.size > 1 ? String(t.name).trim() : s;
        };
    }

    function teacherCellHtml(teachers, closed, nameOf) {
        const parts = [];
        teachers.presentMains.forEach(t => parts.push(`<div class="ss-t">${esc(nameOf(t))}</div>`));
        teachers.replacements.forEach(({ main, subs }) => {
            if (subs.length) {
                parts.push(`<div class="ss-t ss-sub">${esc(subs.map(nameOf).join(', '))}</div>` +
                    `<div class="ss-was">thay <s>${esc(nameOf(main))}</s></div>`);
            } else {
                parts.push(`<div class="ss-t"><s class="ss-off">${esc(nameOf(main))}</s></div>` +
                    (closed ? '' : '<div class="ss-need">Chưa có GV thay</div>'));
            }
        });
        teachers.extraSubs.forEach(t => parts.push(`<div class="ss-t ss-sub">${esc(nameOf(t))}</div><div class="ss-was">dạy thay</div>`));
        return parts.join('') || '<span class="ss-dash">—</span>';
    }

    function renderSheetHtml(model, opts = {}) {
        const nameOf = nameResolver(model, opts.shortNames !== false);
        const title = String(opts.title || defaultTitle(model.dateKey, model.buoi)).trim();
        const totalClasses = model.sections.reduce((n, s) => n + s.classCount, 0);
        const totalStudents = model.sections.reduce((n, s) => n + s.studentCount, 0);
        const body = model.sections.map(section => {
            const showBuoi = model.buoi === 'all';
            const head = `<tr class="ss-sec"><td colspan="5"><div class="ss-sec-in">
                <span class="ss-sec-name">${showBuoi ? esc(section.buoiLabel) + ' · ' : ''}${esc(section.title)}</span>
                <span class="ss-sec-time">${esc(section.start)} – ${esc(section.end)}</span>
                ${section.centerClosed ? '' : `<span class="ss-sec-meta">${section.classCount} lớp${section.studentCount ? ` · ${section.studentCount} HS` : ''}</span>`}
                ${section.offTimeCount ? `<span class="ss-sec-warn">Lưu ý: ${section.offTimeCount} lớp học giờ khác — xem giờ ô cam dưới tên lớp</span>` : ''}
                </div></td></tr>`;
            if (section.centerClosed) {
                return head + '<tr><td colspan="5" class="ss-closed-all">Trung tâm nghỉ ca này</td></tr>';
            }
            return head + section.rows.map((row, index) => {
                const notes = [];
                if (row.closed) notes.push('<span class="ss-pill ss-pill-off">Đã tắt</span>');
                if (row.note) notes.push(`<span>${esc(row.note)}</span>`);
                const timeTag = row.time ? `<div class="ss-time">${esc(row.time)}</div>` : '';
                return `<tr class="${row.closed ? 'ss-row-closed' : ''}${row.offTime && !row.closed ? ' ss-row-off' : ''}${index % 2 ? ' ss-alt' : ''}">
                    <td class="ss-c-ss">${esc(row.ss)}</td>
                    <td class="ss-c-lop">${esc(row.lop) || '<span class="ss-dash">—</span>'}${timeTag}</td>
                    <td class="ss-c-room">${esc(row.phong) || '<span class="ss-dash">—</span>'}</td>
                    <td class="ss-c-gv">${teacherCellHtml(row.teachers, row.closed, nameOf)}</td>
                    <td class="ss-c-note">${notes.join(' ')}</td>
                </tr>`;
            }).join('');
        }).join('');
        const empty = model.sections.length ? '' :
            '<tr><td colspan="5" class="ss-closed-all">Chưa có lớp nào trong buổi này</td></tr>';
        const footer = String(opts.footer || '').trim();
        return `<div class="ss-sheet">
            <div class="ss-top">
                <div class="ss-brand">Ngoại ngữ &amp; Toán Tư Duy Trẻ · ${esc(BRANCH_LABEL[model.branch] || model.branch)}</div>
                <div class="ss-title">${esc(title)}</div>
                <div class="ss-date">${esc(dayName(model.dateKey))}, ngày ${esc(shortDate(model.dateKey))}${totalClasses ? ` · ${totalClasses} lớp${totalStudents ? ` · ${totalStudents} HS` : ''}` : ''}</div>
            </div>
            <table class="ss-table">
                <colgroup><col style="width:38px"><col><col style="width:62px"><col style="width:132px"><col style="width:112px"></colgroup>
                <thead><tr><th>SS</th><th>Lớp</th><th>Phòng</th><th>GV</th><th>Ghi chú</th></tr></thead>
                <tbody>${body}${empty}</tbody>
            </table>
            ${footer ? `<div class="ss-footer">${esc(footer).replace(/\n/g, '<br>')}</div>` : ''}
        </div>`;
    }

    // Bản chữ để dán vào Zalo/Messenger khi không tiện gửi ảnh.
    function sheetText(model, opts = {}) {
        const nameOf = nameResolver(model, opts.shortNames !== false);
        const title = String(opts.title || defaultTitle(model.dateKey, model.buoi)).trim();
        const lines = [`${title.toLocaleUpperCase('vi')} — ${shortDate(model.dateKey)} — ${BRANCH_LABEL[model.branch] || model.branch}`];
        model.sections.forEach(section => {
            const prefix = model.buoi === 'all' ? `${section.buoiLabel} · ` : '';
            lines.push('', `▸ ${prefix}${section.title} (${section.start}–${section.end})`);
            if (section.centerClosed) { lines.push('  Trung tâm nghỉ ca này'); return; }
            if (section.offTimeCount) lines.push(`  ⚠ ${section.offTimeCount} lớp học giờ khác (ghi trong ngoặc)`);
            section.rows.forEach(row => {
                const t = row.teachers;
                const who = [
                    ...t.presentMains.map(nameOf),
                    ...t.replacements.map(({ main, subs }) => subs.length
                        ? `${subs.map(nameOf).join(', ')} (thay ${nameOf(main)})`
                        : `${nameOf(main)} nghỉ${row.closed ? '' : ' – chưa có GV thay'}`),
                    ...t.extraSubs.map(s => `${nameOf(s)} (dạy thay)`)
                ].join(', ') || '—';
                const bits = [`${row.lop || '—'}${row.time ? ` (⏰ ${row.time})` : ''}`, row.phong || '—', who];
                if (row.ss) bits.push(`${row.ss} HS`);
                if (row.note) bits.push(row.note);
                lines.push(`${row.closed ? '✕ [ĐÃ TẮT] ' : '• '}${bits.join(' · ')}`);
            });
        });
        const footer = String(opts.footer || '').trim();
        if (footer) lines.push('', footer);
        return lines.join('\n');
    }

    const SHEET_CSS = `
    .ss-sheet{width:${SHEET_WIDTH}px;flex:0 0 auto;box-sizing:border-box;background:#fff;color:#111827;font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;border-radius:14px;overflow:hidden;border:1px solid #D1D5DB}
    .ss-sheet *{box-sizing:border-box}
    .ss-top{background:#064E3B;color:#fff;padding:14px 16px 12px;text-align:center}
    .ss-brand{font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.85;font-weight:600}
    .ss-title{font-size:21px;font-weight:800;margin-top:4px;line-height:1.25}
    .ss-date{font-size:13px;margin-top:4px;opacity:.95}
    .ss-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
    .ss-table th{background:#ECFDF5;color:#065F46;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:8px 6px;border-bottom:2px solid #A7F3D0;text-align:left}
    .ss-table th:first-child,.ss-c-ss{text-align:center}
    .ss-table td{padding:7px 6px;border-bottom:1px solid #E5E7EB;vertical-align:top;line-height:1.3;overflow-wrap:anywhere}
    .ss-alt td{background:#F9FAFB}
    .ss-sec td{background:#D1FAE5;padding:7px 10px;border-bottom:1px solid #A7F3D0}
    .ss-sec-in{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
    .ss-sec-name{font-weight:800;font-size:15px;color:#064E3B}
    .ss-sec-time{font-weight:700;font-size:13px;color:#047857}
    .ss-sec-meta{margin-left:auto;font-size:12px;color:#065F46}
    .ss-c-ss{font-weight:700;color:#4B5563}
    .ss-c-lop{font-weight:700;color:#111827}
    .ss-c-room{font-weight:700;color:#1D4ED8}
    .ss-t{font-weight:600}
    .ss-sub{color:#B45309}
    .ss-was{font-size:11.5px;color:#6B7280}
    .ss-off{color:#9CA3AF}
    .ss-need{font-size:11.5px;font-weight:700;color:#B91C1C}
    .ss-c-note{font-size:12.5px;color:#374151}
    .ss-time{display:table;margin-top:4px;padding:2px 6px;border-radius:6px;background:#FFEDD5;border:1px solid #FDBA74;color:#9A3412;font-size:12.5px;font-weight:800;white-space:nowrap;line-height:1.4}
    .ss-row-off td:first-child{border-left:4px solid #F97316;padding-left:2px}
    .ss-sec-warn{flex-basis:100%;font-size:12px;font-weight:700;color:#9A3412}
    .ss-pill{border-radius:6px;padding:1px 6px;font-size:12px;font-weight:700;white-space:nowrap}
    .ss-pill-off{background:#FEE2E2;color:#B91C1C}
    .ss-row-closed td{background:#F3F4F6;color:#9CA3AF}
    .ss-row-closed .ss-c-lop,.ss-row-closed .ss-c-room,.ss-row-closed .ss-t{text-decoration:line-through;color:#9CA3AF}
    .ss-dash{color:#D1D5DB}
    .ss-closed-all{text-align:center;color:#991B1B;background:#FEF2F2;font-weight:700;font-style:italic}
    .ss-footer{padding:10px 14px 12px;font-size:13px;color:#1F2937;border-top:2px solid #A7F3D0;background:#F0FDF4;line-height:1.45}
    `;

    const MODAL_CSS = `
    #ssheet-overlay{position:fixed;inset:0;z-index:1200;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;padding:16px}
    #ssheet-overlay[hidden]{display:none}
    .ssm{background:#F3F4F6;border-radius:16px;width:min(980px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.3)}
    .ssm-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px;background:#fff;border-bottom:1px solid #E5E7EB}
    .ssm-head h3{margin:0;font-size:1.05rem;color:#064E3B}
    .ssm-x{border:0;background:#F3F4F6;border-radius:10px;min-width:40px;min-height:40px;font-size:1.1rem;cursor:pointer;color:#374151}
    .ssm-body{display:flex;gap:16px;padding:16px;overflow:auto;flex:1;min-height:0}
    .ssm-form{flex:0 0 260px;display:flex;flex-direction:column;gap:10px}
    .ssm-form *{box-sizing:border-box}
    .ssm-row{display:grid;grid-template-columns:1fr;gap:10px}
    .ssm-form label{min-width:0;display:flex;flex-direction:column;gap:4px;font-size:.8rem;font-weight:700;color:#374151}
    .ssm-form input[type=text],.ssm-form input[type=date],.ssm-form select,.ssm-form textarea{font:inherit;font-size:.92rem;font-weight:500;border:1.5px solid #D1D5DB;border-radius:10px;padding:8px 10px;background:#fff;min-height:42px;color:#111827;width:100%}
    .ssm-form textarea{min-height:64px;resize:vertical}
    .ssm-seg{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;background:#E5E7EB;border-radius:10px;padding:3px}
    .ssm-seg button{border:0;background:transparent;border-radius:8px;min-height:36px;white-space:nowrap;padding:0 2px;font:inherit;font-size:.8rem;font-weight:700;color:#4B5563;cursor:pointer}
    .ssm-seg button.on{background:#fff;color:#065F46;box-shadow:0 1px 3px rgba(0,0,0,.12)}
    .ssm-check{flex-direction:row!important;align-items:center;gap:8px!important;font-weight:600!important}
    .ssm-check input{width:18px;height:18px}
    .ssm-preview{flex:1;min-width:0;display:flex;justify-content:center;align-items:flex-start}
    .ssm-status{font-size:.8rem;color:#6B7280;min-height:1.2em}
    .ssm-actions{display:flex;gap:8px;flex-wrap:wrap;padding:12px 16px;background:#fff;border-top:1px solid #E5E7EB}
    .ssm-actions button{flex:1 1 140px;min-height:46px;border-radius:12px;font:inherit;font-size:.92rem;font-weight:700;cursor:pointer;border:1.5px solid #D1D5DB;background:#fff;color:#1F2937;display:inline-flex;align-items:center;justify-content:center;gap:6px}
    .ssm-actions button.primary{background:#059669;border-color:#059669;color:#fff}
    .ssm-actions button:disabled{opacity:.55;cursor:wait}
    @media (max-width:760px){
      #ssheet-overlay{padding:0;align-items:stretch}
      .ssm{border-radius:0;max-height:none;height:100%;width:100%}
      .ssm-body{flex-direction:column;padding:12px;gap:12px}
      .ssm-form{flex:0 0 auto;gap:8px}
      .ssm-row{grid-template-columns:1.25fr 1fr;gap:8px}
      .ssm-form textarea{min-height:42px}
      .ssm-actions{padding:10px 12px calc(10px + env(safe-area-inset-bottom))}
      .ssm-actions button{flex:1 1 45%}
    }
    `;

    const state = {
        dateKey: '', branch: 'cs1', buoi: 'evening', title: '', titleEdited: false, footer: '',
        shortNames: true, showClosed: true, model: null, loadSeq: 0, canvasPromise: null
    };

    function loadPrefs() {
        try {
            const prefs = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
            if (typeof prefs.shortNames === 'boolean') state.shortNames = prefs.shortNames;
            if (typeof prefs.showClosed === 'boolean') state.showClosed = prefs.showClosed;
        } catch (_) { /* tuỳ chọn hiển thị không bắt buộc */ }
    }

    function savePrefs() {
        try { localStorage.setItem(PREF_KEY, JSON.stringify({ shortNames: state.shortNames, showClosed: state.showClosed })); } catch (_) { /* bỏ qua */ }
    }

    function toast(message, type) {
        if (global.UIService?.toast) global.UIService.toast(message, type || 'success');
        else { const s = $('ssm-status'); if (s) s.textContent = message; }
    }

    function setStatus(text) {
        const el = $('ssm-status');
        if (el) el.textContent = text || '';
    }

    function injectStyle() {
        if ($('ssheet-style')) return;
        const style = document.createElement('style');
        style.id = 'ssheet-style';
        style.textContent = SHEET_CSS + MODAL_CSS;
        document.head.appendChild(style);
    }

    function selectedScheduleDateKey() {
        const d = new Date(currentWeekStart);
        d.setDate(d.getDate() + (Number(selectedDayIndex) || 0));
        return getLocalDateKey(d);
    }

    // Buổi mặc định: theo bộ lọc ca đang chọn; nếu xem hôm nay thì buổi sắp tới; còn lại là buổi tối.
    function defaultBuoi(dateKey) {
        const filter = typeof currentShiftFilter === 'string' ? currentShiftFilter : 'all';
        const m = /^(morning|afternoon|evening)/.exec(filter);
        if (m) return m[1];
        if (dateKey === getLocalDateKey(new Date())) {
            const h = new Date().getHours();
            return h < 11 ? 'morning' : (h < 17 ? 'afternoon' : 'evening');
        }
        return 'evening';
    }

    function ensureModal() {
        if ($('ssheet-overlay')) return;
        injectStyle();
        const overlay = document.createElement('div');
        overlay.id = 'ssheet-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `
        <div class="ssm" role="dialog" aria-modal="true" aria-labelledby="ssm-h">
            <div class="ssm-head"><h3 id="ssm-h">Bảng lịch gửi giáo viên</h3>
                <button type="button" class="ssm-x" data-ss-close aria-label="Đóng">✕</button></div>
            <div class="ssm-body">
                <div class="ssm-form">
                    <div class="ssm-row">
                        <label>Ngày<input type="date" id="ssm-date"></label>
                        <label>Cơ sở<select id="ssm-branch"><option value="cs1">Cơ sở 1</option><option value="cs2">Cơ sở 2</option><option value="cs3">Cơ sở 3</option></select></label>
                    </div>
                    <div><div style="font-size:.8rem;font-weight:700;color:#374151;margin-bottom:4px">Buổi</div>
                        <div class="ssm-seg" id="ssm-buoi">${BUOI.map(b => `<button type="button" data-buoi="${b.key}">${b.label}</button>`).join('')}</div></div>
                    <label>Tiêu đề<input type="text" id="ssm-title" maxlength="80" placeholder="VD: Tiếng Anh Tối thứ 5"></label>
                    <label>Ghi chú cuối tờ<textarea id="ssm-footer" maxlength="400" placeholder="VD: Hoàng Anh test 1/10 (UP1)"></textarea></label>
                    <label class="ssm-check"><input type="checkbox" id="ssm-short"> Tên GV gọn (Kiều My thay vì họ tên đầy đủ)</label>
                    <label class="ssm-check"><input type="checkbox" id="ssm-closed"> Hiện lớp đã tắt (gạch ngang)</label>
                    <div class="ssm-status" id="ssm-status" aria-live="polite"></div>
                </div>
                <div class="ssm-preview" id="ssm-preview"></div>
            </div>
            <div class="ssm-actions">
                <button type="button" id="ssm-share" class="primary" hidden>Chia sẻ ảnh</button>
                <button type="button" id="ssm-copy" class="primary">Sao chép ảnh</button>
                <button type="button" id="ssm-download">Tải ảnh PNG</button>
                <button type="button" id="ssm-text">Sao chép chữ</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-ss-close]')) close();
            const b = event.target.closest('[data-buoi]');
            if (b) { state.buoi = b.dataset.buoi; refresh(false); }
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !overlay.hidden) close();
        });
        $('ssm-date').addEventListener('change', e => { if (e.target.value) { state.dateKey = e.target.value; refresh(true); } });
        $('ssm-branch').addEventListener('change', e => { state.branch = e.target.value; refresh(true); });
        $('ssm-title').addEventListener('input', e => { state.title = e.target.value; state.titleEdited = !!e.target.value.trim(); redraw(); });
        $('ssm-footer').addEventListener('input', e => { state.footer = e.target.value; redraw(); });
        $('ssm-short').addEventListener('change', e => { state.shortNames = e.target.checked; savePrefs(); redraw(); });
        $('ssm-closed').addEventListener('change', e => { state.showClosed = e.target.checked; savePrefs(); refresh(false); });
        $('ssm-copy').addEventListener('click', copyImage);
        $('ssm-download').addEventListener('click', downloadImage);
        $('ssm-share').addEventListener('click', shareImage);
        $('ssm-text').addEventListener('click', copyText);
        global.addEventListener('resize', fitPreview);
        $('ssm-share').hidden = !(navigator.canShare && typeof File === 'function' &&
            navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] }));
    }

    function syncForm() {
        $('ssm-date').value = state.dateKey;
        $('ssm-branch').value = state.branch;
        document.querySelectorAll('#ssm-buoi [data-buoi]').forEach(b => b.classList.toggle('on', b.dataset.buoi === state.buoi));
        if (!state.titleEdited) {
            state.title = defaultTitle(state.dateKey, state.buoi);
            $('ssm-title').value = state.title;
        }
        $('ssm-short').checked = state.shortNames;
        $('ssm-closed').checked = state.showClosed;
    }

    let dayCache = { key: '', data: null, closures: {} };

    async function refresh(reload) {
        syncForm();
        const seq = ++state.loadSeq;
        const key = `${state.branch}__${state.dateKey}`;
        try {
            if (reload || dayCache.key !== key) {
                setStatus('Đang tải lịch…');
                const [data, settings] = await Promise.all([
                    DBService.getSchedule(key, { source: 'server' }),
                    typeof readScheduleClosureSettings === 'function' ? readScheduleClosureSettings() : Promise.resolve({})
                ]);
                if (seq !== state.loadSeq) return;
                dayCache = { key, data: data || {}, closures: settings?.centerClosures || global.centerClosures || {} };
            }
            state.model = buildSheetModel(dayCache.data, {
                dateKey: state.dateKey, branch: state.branch, buoi: state.buoi,
                closures: dayCache.closures, showClosed: state.showClosed
            });
            setStatus('');
            redraw();
        } catch (error) {
            if (seq !== state.loadSeq) return;
            console.error('[ScheduleSheet] load', error);
            setStatus('Chưa tải được lịch. Kiểm tra mạng rồi chọn lại ngày.');
        }
    }

    function sheetOptions() {
        return { title: state.title, footer: state.footer, shortNames: state.shortNames };
    }

    // Xem trước = đúng tờ ảnh 520px, thu nhỏ cho vừa khung (điện thoại) thay vì bóp cột.
    function fitPreview() {
        const box = $('ssm-preview');
        const sheet = box?.firstElementChild;
        if (!sheet) return;
        const scale = Math.min(1, (box.clientWidth || SHEET_WIDTH) / SHEET_WIDTH);
        sheet.style.zoom = scale < 1 ? String(scale) : '';
    }

    function redraw() {
        if (!state.model) return;
        $('ssm-preview').innerHTML = renderSheetHtml(state.model, sheetOptions());
        fitPreview();
        state.canvasPromise = null;
    }

    function loadHtml2Canvas() {
        if (global.html2canvas) return Promise.resolve(global.html2canvas);
        if (loadHtml2Canvas.promise) return loadHtml2Canvas.promise;
        loadHtml2Canvas.promise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = HTML2CANVAS_SRC;
            s.crossOrigin = 'anonymous';
            s.onload = () => global.html2canvas ? resolve(global.html2canvas) : reject(new Error('html2canvas missing'));
            s.onerror = () => { loadHtml2Canvas.promise = null; reject(new Error('Không tải được công cụ tạo ảnh (kiểm tra mạng).')); };
            document.head.appendChild(s);
        });
        return loadHtml2Canvas.promise;
    }

    // Dựng ảnh từ một bản sao cố định 520px (không phụ thuộc màn hình người xếp lịch) ở tỉ lệ 2×.
    function renderBlob() {
        if (state.canvasPromise) return state.canvasPromise;
        const html = renderSheetHtml(state.model, sheetOptions());
        state.canvasPromise = (async () => {
            const h2c = await loadHtml2Canvas();
            const host = document.createElement('div');
            host.style.cssText = `position:fixed;left:-10000px;top:0;width:${SHEET_WIDTH}px;background:#fff;padding:0;`;
            host.innerHTML = html;
            const sheet = host.firstElementChild;
            sheet.style.borderRadius = '0';
            sheet.style.border = '0';
            document.body.appendChild(host);
            try {
                if (document.fonts?.ready) await document.fonts.ready;
                const canvas = await h2c(sheet, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, width: SHEET_WIDTH, windowWidth: SHEET_WIDTH });
                return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Không tạo được ảnh.')), 'image/png'));
            } finally {
                host.remove();
            }
        })();
        state.canvasPromise.catch(() => { state.canvasPromise = null; });
        return state.canvasPromise;
    }

    function fileName() {
        const b = BUOI.find(x => x.key === state.buoi);
        const slug = String(b?.label || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, '-');
        return `lich-${state.branch}-${state.dateKey}-${slug}.png`;
    }

    async function withBusy(button, task) {
        const buttons = document.querySelectorAll('.ssm-actions button');
        buttons.forEach(b => { b.disabled = true; });
        const label = button.textContent;
        button.textContent = 'Đang tạo ảnh…';
        try { await task(); } catch (error) {
            if (error?.name === 'AbortError') return;
            console.error('[ScheduleSheet]', error);
            toast(error?.message || 'Không thực hiện được.', 'error');
        } finally {
            button.textContent = label;
            buttons.forEach(b => { b.disabled = false; });
        }
    }

    function downloadBlob(blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName();
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    function copyImage() {
        const button = $('ssm-copy');
        return withBusy(button, async () => {
            if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function') {
                downloadBlob(await renderBlob());
                toast('Trình duyệt này chưa cho sao chép ảnh — đã tải ảnh về máy để gửi.', 'warning');
                return;
            }
            // Safari chỉ cho ghi clipboard nếu gọi ngay trong lần bấm: truyền Promise vào ClipboardItem.
            try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderBlob() })]);
                toast('Đã sao chép ảnh lịch — dán (Ctrl+V) vào nhóm Zalo.');
            } catch (error) {
                console.warn('[ScheduleSheet] clipboard', error);
                downloadBlob(await renderBlob());
                toast('Không sao chép được ảnh — đã tải ảnh về máy để gửi.', 'warning');
            }
        });
    }

    function downloadImage() {
        return withBusy($('ssm-download'), async () => {
            downloadBlob(await renderBlob());
            toast('Đã tải ảnh lịch về máy.');
        });
    }

    function shareImage() {
        return withBusy($('ssm-share'), async () => {
            const blob = await renderBlob();
            const file = new File([blob], fileName(), { type: 'image/png' });
            await navigator.share({ files: [file], title: state.title });
        });
    }

    async function copyText() {
        const text = sheetText(state.model, sheetOptions());
        try {
            await navigator.clipboard.writeText(text);
            toast('Đã sao chép lịch dạng chữ.');
        } catch (_) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            toast(ok ? 'Đã sao chép lịch dạng chữ.' : 'Không sao chép được.', ok ? 'success' : 'error');
        }
    }

    function open() {
        ensureModal();
        loadPrefs();
        state.dateKey = selectedScheduleDateKey();
        state.branch = typeof currentBranch === 'string' ? currentBranch : 'cs1';
        state.buoi = defaultBuoi(state.dateKey);
        state.titleEdited = false;
        state.model = null;
        $('ssm-preview').innerHTML = '';
        $('ssheet-overlay').hidden = false;
        document.body.style.overflow = 'hidden';
        refresh(true);
        loadHtml2Canvas().catch(() => {});
    }

    function close() {
        const overlay = $('ssheet-overlay');
        if (overlay) overlay.hidden = true;
        document.body.style.overflow = '';
    }

    function mountButton() {
        const actions = $('admin-actions');
        if (!actions || $('btn-schedule-sheet')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-schedule-sheet';
        btn.type = 'button';
        btn.className = 'btn';
        btn.title = 'Tạo tờ lịch (ảnh) của một buổi để gửi lên nhóm giáo viên';
        btn.style.cssText = 'display:flex;align-items:center;gap:0.4rem;background:#ECFDF5;border:1.5px solid #6EE7B7;color:#065F46;font-weight:700;';
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg><span class="btn-label">Bảng lịch gửi GV</span>`;
        btn.addEventListener('click', open);
        actions.insertBefore(btn, actions.firstChild);
    }

    function boot() {
        if (typeof DBService === 'undefined' || typeof getLocalDateKey !== 'function' || typeof renderTable !== 'function') {
            return setTimeout(boot, 300);
        }
        mountButton();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

    global.ScheduleSheet = { buildSheetModel, renderSheetHtml, sheetText, shortName, defaultTitle, open, close };
})(window);
