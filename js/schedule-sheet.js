// "Bảng lịch gửi GV" trên trang Xếp lịch (yêu cầu 02/10/2026): sau khi xếp lịch xong, người xếp
// lịch bấm một nút là có ngay tờ lịch như bản giấy (SS · Lớp · Phòng · GV · Ghi chú, chia Ca 1 / Ca 2)
// để gửi lên nhóm giáo viên: sao chép ảnh, tải ảnh PNG, chia sẻ thẳng (điện thoại) hoặc sao chép chữ.
//
// Ảnh dựng như tờ giấy A4 dọc (600px × 2, kẻ khung, cột đúng tỉ lệ, dòng trống cuối mỗi ca), giáo viên mở
// trên điện thoại vẫn đọc được. Có thêm file Excel cùng mẫu để in. Chỉ ĐỌC lịch qua DBService.getSchedule + readScheduleClosureSettings và dùng lại
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
    // Khổ ảnh theo tờ A4 dọc của bản giấy; cột SS · Lớp · Phòng · GV · Ghi chú giữ đúng tỉ lệ đo trên tờ giấy.
    const SHEET_WIDTH = 600;
    const COL_RATIO = [7.5, 21, 13.5, 22.5, 35.5];
    const MAX_BLANK_ROWS = 5;
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

    // Số HS kế hoạch có thể là số hoặc chuỗi ("9", " 9 ") tuỳ lúc lưu.
    function plannedCount(row) {
        const n = Number(String(row?.soHS ?? '').trim());
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    }

    // Sĩ số GV báo khi chấm công cho đúng ca này (cùng cách đối chiếu phiên công như bảng lịch).
    function reportedCountLookup(evidence, compositeKey, dateKey) {
        if (!(evidence instanceof Map) || !evidence.size || typeof resolveAttendanceEvidenceForShift !== 'function') return null;
        return (row, sectionKey, index) => {
            const section = SECTIONS.find(s => s.key === sectionKey) || {};
            const start = String(row.start || '').trim() || section.defaultStart;
            const end = String(row.end || '').trim() || section.defaultEnd;
            const shiftId = typeof stableScheduleShiftLocatorId === 'function'
                ? stableScheduleShiftLocatorId(compositeKey, sectionKey, row, index) : String(row.shiftId || '');
            const people = [...(getGVList(row, 'gv') || []), ...(getGVList(row, 'gvThayTe') || [])];
            for (const person of people) {
                if (!person?.id) continue;
                const res = resolveAttendanceEvidenceForShift(evidence, person.id, dateKey, start, end, shiftId, compositeKey, sectionKey);
                const session = res?.status === 'matched' ? res.session : null;
                const n = Number(session?.studentCount);
                if (Number.isInteger(n) && n > 0 && String(session.studentCountStatus || '').toLowerCase() !== 'rejected') return n;
            }
            return 0;
        };
    }

    // Dữ liệu thuần của tờ lịch: dùng cho cả ảnh, chữ và kiểm thử.
    function buildSheetModel(dayData, options) {
        const { dateKey, branch, buoi = 'all', closures = {}, showClosed = true, reportedCount = null } = options;
        const sections = SECTIONS
            .filter(section => buoi === 'all' || section.key.startsWith(buoi))
            .map(section => {
                const centerClosed = isCenterClosed(dateKey, section.key, closures);
                const rows = (Array.isArray(dayData?.[section.key]) ? dayData[section.key] : [])
                    .map((row, index) => ({ row, index }))
                    .filter(({ row }) => row && !rowIsEmpty(row))
                    .map(({ row, index }) => ({
                        // Sĩ số: số HS kế hoạch trên lịch; lịch chưa ghi thì lấy sĩ số GV đã báo khi chấm công
                        // (giống chip "· 9 HS" trên bảng lịch) — trước đây ô SS bị trống dù bảng lịch có số.
                        ss: plannedCount(row) || (typeof reportedCount === 'function' ? Number(reportedCount(row, section.key, index)) || 0 : 0) || '',
                        lop: String(row.lop || '').trim(),
                        phong: typeof global.normalizeScheduleRoomInput === 'function'
                            ? global.normalizeScheduleRoomInput(row.phong) : String(row.phong || '').trim(),
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
        return `Lịch dạy ${part}${dayName(dateKey)}`.replace(/\s+/g, ' ').trim();
    }

    // Ô nhập của form (tiêu đề, ghi chú cuối tờ) đi thẳng vào ảnh và file Excel: bỏ ký tự điều khiển
    // / ký tự XML không hợp lệ, gộp khoảng trắng, giới hạn độ dài — để không ô nào làm hỏng file.
    const TITLE_MAX = 80;
    const FOOTER_MAX = 400;
    function cleanText(value, max, multiline) {
        let text = String(value == null ? '' : value)
            .replace(/\r\n?/g, '\n')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g, '')
            .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1');
        text = multiline
            ? text.split('\n').map(line => line.replace(/[\t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n')
            : text.replace(/\s+/g, ' ');
        text = text.trim();
        return text.length > max ? Array.from(text).slice(0, max).join('').trim() : text;
    }

    function sheetTitle(model, opts) {
        return cleanText(opts.title, TITLE_MAX, false) || defaultTitle(model.dateKey, model.buoi);
    }

    function sheetFooter(opts) {
        return cleanText(opts.footer, FOOTER_MAX, true);
    }

    function isValidDateKey(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
        const [y, m, d] = value.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return y >= 2020 && y <= 2100 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
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

    function blankRowCount(opts) {
        const n = Number(opts.blankRows);
        return Number.isInteger(n) ? Math.min(MAX_BLANK_ROWS, Math.max(0, n)) : 3;
    }

    function renderSheetHtml(model, opts = {}) {
        const nameOf = nameResolver(model, opts.shortNames !== false);
        const title = sheetTitle(model, opts);
        const totalClasses = model.sections.reduce((n, s) => n + s.classCount, 0);
        const totalStudents = model.sections.reduce((n, s) => n + s.studentCount, 0);
        const blanks = blankRowCount(opts);
        // Dòng trống cuối mỗi ca: tiếp tân ghi tay lớp phát sinh sau khi in/gửi (như tờ giấy).
        const blankRows = '<tr class="ss-blank"><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(blanks);
        const body = model.sections.map(section => {
            const showBuoi = model.buoi === 'all';
            const head = `<tr class="ss-sec"><td colspan="5"><div class="ss-sec-in">
                <span class="ss-sec-name">${showBuoi ? esc(section.buoiLabel) + ' · ' : ''}${esc(section.title)}</span>
                <span class="ss-sec-time">(${esc(section.start)} – ${esc(section.end)})</span>
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
            }).join('') + blankRows;
        }).join('');
        const empty = model.sections.length ? '' :
            '<tr><td colspan="5" class="ss-closed-all">Chưa có lớp nào trong buổi này</td></tr>';
        const footer = sheetFooter(opts);
        // Độ rộng cột tính ra px nguyên (khung 600 − lề 36 − viền): html2canvas vẽ đường kẻ lệch với cột theo %.
        const inner = SHEET_WIDTH - 38;
        const px = COL_RATIO.map(r => Math.round(inner * r / 100));
        px[px.length - 1] += inner - px.reduce((a, b) => a + b, 0);
        const cols = px.map(w => `<col style="width:${w}px">`).join('');
        return `<div class="ss-sheet">
            <table class="ss-table">
                <colgroup>${cols}</colgroup>
                <thead>
                    <tr class="ss-head-title"><th colspan="5">
                        <div class="ss-title">${esc(title.toLocaleUpperCase('vi'))}</div>
                        <div class="ss-date">${esc(dayName(model.dateKey))}, ngày ${esc(shortDate(model.dateKey))} · ${esc(BRANCH_LABEL[model.branch] || model.branch)}${totalClasses ? ` · ${totalClasses} lớp${totalStudents ? ` · ${totalStudents} HS` : ''}` : ''}</div>
                    </th></tr>
                    <tr class="ss-head-cols"><th>SS</th><th>Lớp</th><th>Phòng</th><th>GV</th><th>Ghi chú</th></tr>
                </thead>
                <tbody>${body}${empty}</tbody>
            </table>
            ${footer ? `<div class="ss-footer">${esc(footer).replace(/\n/g, '<br>')}</div>` : ''}
            <div class="ss-brand">Ngoại ngữ &amp; Toán Tư Duy Trẻ</div>
        </div>`;
    }

    // Bản chữ để dán vào Zalo/Messenger khi không tiện gửi ảnh.
    function sheetText(model, opts = {}) {
        const nameOf = nameResolver(model, opts.shortNames !== false);
        const title = sheetTitle(model, opts);
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
        const footer = sheetFooter(opts);
        if (footer) lines.push('', footer);
        return lines.join('\n');
    }

    // ---------- File Excel (.xlsx) theo mẫu tờ giấy ----------
    // Viết tay (ZIP không nén + vài file XML) như salary-bulk-export.js, không thêm thư viện.
    // Trang in: A4 dọc, vừa 1 trang, cột cùng tỉ lệ tờ giấy, kẻ khung đen mọi ô, dòng trống cuối mỗi ca.
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const XLSX_WIDTHS = COL_RATIO.map(r => Math.round(r * 0.92 * 10) / 10); // ≈ 92 ký tự = bề ngang A4 dọc
    const XS = { title: 1, date: 2, head: 3, sec: 4, center: 5, text: 6, note: 7, closed: 8, footer: 9, closedCenter: 10, warn: 11 };
    const XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="7">'
        + '<font><sz val="12"/><name val="Times New Roman"/><family val="1"/></font>'
        + '<font><b/><sz val="16"/><name val="Times New Roman"/><family val="1"/></font>'
        + '<font><i/><sz val="11"/><name val="Times New Roman"/><family val="1"/></font>'
        + '<font><b/><sz val="13"/><name val="Times New Roman"/><family val="1"/></font>'
        + '<font><strike/><sz val="12"/><color rgb="FF9CA3AF"/><name val="Times New Roman"/><family val="1"/></font>'
        + '<font><sz val="11"/><name val="Times New Roman"/><family val="1"/></font>'
        + '<font><b/><sz val="11"/><color rgb="FF9A3412"/><name val="Times New Roman"/><family val="1"/></font>'
        + '</fonts>'
        + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill></fills>'
        + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
        + '<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right>'
        + '<top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="12">'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        + '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        + '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
        + '<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
        + '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
        + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        + '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
        + '</cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '</styleSheet>';

    function xmlEsc(value) {
        return String(value == null ? '' : value)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
            .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function xCell(ref, cell) {
        const s = cell.s != null ? ` s="${cell.s}"` : '';
        if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return `<c r="${ref}"${s}><v>${cell.v}</v></c>`;
        if (cell.v == null || cell.v === '') return `<c r="${ref}"${s}/>`;
        return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`;
    }

    function teacherLines(teachers, closed, nameOf) {
        return [
            ...teachers.presentMains.map(nameOf),
            ...teachers.replacements.map(({ main, subs }) => subs.length
                ? `${subs.map(nameOf).join(', ')} (thay ${nameOf(main)})`
                : `${nameOf(main)} nghỉ${closed ? '' : ' – chưa có GV thay'}`),
            ...teachers.extraSubs.map(s => `${nameOf(s)} (dạy thay)`)
        ];
    }

    // Số dòng một ô chiếm khi xuống dòng tự động (ước lượng theo số ký tự vừa cột).
    function wrapLines(text, perLine) {
        return String(text || '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
    }

    // Các dòng của trang tính (thuần dữ liệu để kiểm thử): { cells:[{v,s}×5], ht, merge? }
    function sheetRows(model, opts = {}) {
        const nameOf = nameResolver(model, opts.shortNames !== false);
        const title = sheetTitle(model, opts).toLocaleUpperCase('vi');
        const totalClasses = model.sections.reduce((n, s) => n + s.classCount, 0);
        const totalStudents = model.sections.reduce((n, s) => n + s.studentCount, 0);
        const merged = (v, s, ht) => ({ cells: [{ v, s }, { s }, { s }, { s }, { s }], ht, merge: true });
        const rows = [
            merged(title, XS.title, title.length > 46 ? 50 : 30),
            merged(`${dayName(model.dateKey)}, ngày ${shortDate(model.dateKey)} · ${BRANCH_LABEL[model.branch] || model.branch}` +
                (totalClasses ? ` · ${totalClasses} lớp${totalStudents ? ` · ${totalStudents} HS` : ''}` : ''), XS.date, 20),
            { cells: ['SS', 'Lớp', 'Phòng', 'GV', 'Ghi chú'].map(v => ({ v, s: XS.head })), ht: 24 }
        ];
        const blanks = blankRowCount(opts);
        model.sections.forEach(section => {
            const prefix = model.buoi === 'all' ? `${section.buoiLabel} · ` : '';
            const meta = section.centerClosed ? '' : ` · ${section.classCount} lớp${section.studentCount ? ` · ${section.studentCount} HS` : ''}`;
            rows.push(merged(`${prefix}${section.title} (${section.start} – ${section.end})${meta}`, XS.sec, 24));
            if (section.centerClosed) {
                rows.push(merged('Trung tâm nghỉ ca này', XS.closedCenter, 24));
                return;
            }
            if (section.offTimeCount) {
                rows.push(merged(`Lưu ý: ${section.offTimeCount} lớp học giờ khác — giờ ghi ở cột Ghi chú`, XS.warn, 20));
            }
            section.rows.forEach(row => {
                const gv = teacherLines(row.teachers, row.closed, nameOf);
                const notes = [row.closed ? 'Đã tắt' : '', row.time ? `Giờ ${row.time}` : '', row.note].filter(Boolean);
                const lines = Math.max(1, wrapLines(row.lop, 17), wrapLines(gv.join('\n'), 19), wrapLines(notes.join('; '), 32));
                const textStyle = row.closed ? XS.closed : XS.text;
                rows.push({
                    cells: [
                        { v: row.ss === '' ? '' : Number(row.ss), s: row.closed ? XS.closedCenter : XS.center },
                        { v: row.lop, s: textStyle },
                        { v: row.phong, s: row.closed ? XS.closedCenter : XS.center },
                        { v: gv.join('\n'), s: textStyle },
                        { v: notes.join('; '), s: row.time && !row.closed ? XS.warn : XS.note }
                    ],
                    ht: Math.max(24, 17 * lines)
                });
            });
            for (let i = 0; i < blanks; i++) rows.push({ cells: [XS.center, XS.text, XS.center, XS.text, XS.note].map(s => ({ s })), ht: 24 });
        });
        if (!model.sections.length) rows.push(merged('Chưa có lớp nào trong buổi này', XS.closedCenter, 24));
        const footer = sheetFooter(opts);
        if (footer) {
            rows.push({ cells: [], ht: 8 });
            rows.push({ cells: [{ v: footer, s: XS.footer }, { s: XS.footer }, { s: XS.footer }, { s: XS.footer }, { s: XS.footer }],
                ht: Math.min(400, Math.max(20, 16 * wrapLines(footer, 88))), merge: true });
        }
        return rows;
    }

    function worksheetXml(rows) {
        const letters = ['A', 'B', 'C', 'D', 'E'];
        const merges = [];
        const data = rows.map((row, i) => {
            const r = i + 1;
            if (row.merge) merges.push(`A${r}:E${r}`);
            const cells = row.cells.map((cell, c) => xCell(letters[c] + r, cell)).join('');
            return `<row r="${r}" ht="${row.ht}" customHeight="1">${cells}</row>`;
        }).join('');
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
            + `<dimension ref="A1:E${Math.max(1, rows.length)}"/>`
            + '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>'
            + '<sheetFormatPr defaultRowHeight="18"/>'
            + `<cols>${XLSX_WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
            + `<sheetData>${data}</sheetData>`
            + (merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '')
            + '<printOptions horizontalCentered="1"/>'
            + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
            + '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/>'
            + '</worksheet>';
    }

    let crcTable = null;
    function crc32(bytes) {
        if (!crcTable) {
            crcTable = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                crcTable[n] = c >>> 0;
            }
        }
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    // ZIP không nén (STORE) → Uint8Array.
    function zipBytes(entries) {
        const enc = new TextEncoder();
        const now = new Date();
        const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
        const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
        const parts = [];
        const central = [];
        let offset = 0;
        entries.forEach(entry => {
            const name = enc.encode(entry.name);
            const data = enc.encode(entry.text);
            const crc = crc32(data);
            const lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
            lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
            lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
            parts.push(new Uint8Array(lh.buffer), name, data);
            const cd = new DataView(new ArrayBuffer(46));
            cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
            cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true);
            cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true);
            cd.setUint32(42, offset, true);
            central.push(new Uint8Array(cd.buffer), name);
            offset += 30 + name.length + data.length;
        });
        const centralSize = central.reduce((n, a) => n + a.length, 0);
        const eocd = new DataView(new ArrayBuffer(22));
        eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true);
        eocd.setUint32(12, centralSize, true); eocd.setUint32(16, offset, true);
        const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
        const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
        let pos = 0;
        all.forEach(a => { out.set(a, pos); pos += a.length; });
        return out;
    }

    function buildSheetXlsx(model, opts = {}) {
        const sheetName = xmlEsc(`${dayName(model.dateKey)} ${shortDate(model.dateKey).slice(0, 5)}`.replace(/[:\\/?*[\]]/g, '-').slice(0, 31));
        return zipBytes([
            { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                + '<Default Extension="xml" ContentType="application/xml"/>'
                + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                + '</Types>' },
            { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                + '</Relationships>' },
            { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                + `<bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
            { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
                + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                + '</Relationships>' },
            { name: 'xl/styles.xml', text: XLSX_STYLES },
            { name: 'xl/worksheets/sheet1.xml', text: worksheetXml(sheetRows(model, opts)) }
        ]);
    }

    const SHEET_CSS = `
    .ss-sheet{width:${SHEET_WIDTH}px;flex:0 0 auto;box-sizing:border-box;background:#fff;color:#111827;font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;padding:18px 18px 12px;border:1px solid #D1D5DB;border-radius:6px}
    .ss-sheet *{box-sizing:border-box}
    .ss-brand{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#9CA3AF;font-weight:600;text-align:right;margin-top:8px}
    .ss-title{font-size:20px;font-weight:800;line-height:1.25;color:#111827;letter-spacing:.02em}
    .ss-date{font-size:12.5px;margin-top:3px;font-weight:500;color:#374151;text-transform:none;letter-spacing:0}
    .ss-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px;border:2px solid #111827}
    .ss-table th,.ss-table td{border:1px solid #374151}
    .ss-head-title th{padding:10px 8px 8px;text-align:center;background:#fff}
    .ss-head-cols th{background:#F3F4F6;color:#111827;font-size:14px;font-weight:700;padding:7px 6px;text-align:left;border-bottom:2px solid #111827}
    .ss-head-cols th:first-child,.ss-head-cols th:nth-child(3),.ss-c-ss,.ss-c-room{text-align:center}
    .ss-table td{padding:6px 6px;vertical-align:middle;line-height:1.3;overflow-wrap:anywhere;height:32px}
    .ss-blank td{height:32px}
    .ss-sec td{background:#F9FAFB;padding:6px 10px;text-align:center;border-top:2px solid #111827}
    .ss-sec-in{display:flex;align-items:baseline;justify-content:center;gap:8px;flex-wrap:wrap}
    .ss-sec-name{font-weight:800;font-size:16px;color:#111827}
    .ss-sec-time{font-weight:700;font-size:13px;color:#374151}
    .ss-sec-meta{font-size:12px;color:#6B7280}
    .ss-c-ss{font-weight:700;color:#111827}
    .ss-c-lop{font-weight:700;color:#111827}
    .ss-c-room{font-weight:700;color:#111827}
    .ss-t{font-weight:600}
    .ss-sub{color:#B45309}
    .ss-was{font-size:11.5px;color:#6B7280}
    .ss-off{color:#9CA3AF}
    .ss-need{font-size:11.5px;font-weight:700;color:#B91C1C}
    .ss-c-note{font-size:12.5px;color:#374151}
    .ss-time{display:table;margin-top:4px;padding:2px 6px;border-radius:6px;background:#FFEDD5;border:1px solid #FDBA74;color:#9A3412;font-size:12.5px;font-weight:800;white-space:nowrap;line-height:1.4}
    .ss-row-off td:first-child{border-left:4px solid #F97316}
    .ss-sec-warn{flex-basis:100%;font-size:12px;font-weight:700;color:#9A3412}
    .ss-pill{border-radius:6px;padding:1px 6px;font-size:12px;font-weight:700;white-space:nowrap}
    .ss-pill-off{background:#FEE2E2;color:#B91C1C}
    .ss-row-closed td{background:#F3F4F6;color:#9CA3AF}
    .ss-row-closed .ss-c-lop,.ss-row-closed .ss-c-room,.ss-row-closed .ss-t{text-decoration:line-through;color:#9CA3AF}
    .ss-dash{color:#D1D5DB}
    .ss-closed-all{text-align:center;color:#991B1B;background:#FEF2F2;font-weight:700;font-style:italic}
    .ss-footer{padding:10px 4px 0;font-size:13.5px;color:#1F2937;line-height:1.45}
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
        shortNames: true, showClosed: true, blankRows: 3, model: null, loadSeq: 0, canvasPromise: null
    };

    function loadPrefs() {
        try {
            const prefs = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
            if (typeof prefs.shortNames === 'boolean') state.shortNames = prefs.shortNames;
            if (typeof prefs.showClosed === 'boolean') state.showClosed = prefs.showClosed;
            if (Number.isInteger(prefs.blankRows)) state.blankRows = Math.min(MAX_BLANK_ROWS, Math.max(0, prefs.blankRows));
        } catch (_) { /* tuỳ chọn hiển thị không bắt buộc */ }
    }

    function savePrefs() {
        try { localStorage.setItem(PREF_KEY, JSON.stringify({ shortNames: state.shortNames, showClosed: state.showClosed, blankRows: state.blankRows })); } catch (_) { /* bỏ qua */ }
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
                    <label>Dòng trống mỗi ca (ghi tay lớp thêm)<select id="ssm-blank">${Array.from({ length: MAX_BLANK_ROWS + 1 }, (_, n) => `<option value="${n}">${n ? n + ' dòng' : 'Không thêm'}</option>`).join('')}</select></label>
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
                <button type="button" id="ssm-excel">Xuất Excel</button>
                <button type="button" id="ssm-text">Sao chép chữ</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-ss-close]')) close();
            const b = event.target.closest('[data-buoi]');
            if (b && BUOI.some(x => x.key === b.dataset.buoi) && b.dataset.buoi !== state.buoi) {
                state.buoi = b.dataset.buoi;
                state.titleEdited = false; // "Lịch dạy Tối…" không còn đúng khi chuyển sang buổi khác
                refresh(false);
            }
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !overlay.hidden) close();
        });
        // Ngày xoá trắng / gõ dở / sai (VD 31/02) thì giữ ngày cũ, không tải lịch rỗng.
        $('ssm-date').addEventListener('change', e => {
            const value = e.target.value;
            if (!isValidDateKey(value)) {
                if (value) toast('Ngày không hợp lệ — giữ ngày đang chọn.', 'warning');
                e.target.value = state.dateKey;
                return;
            }
            if (value === state.dateKey) return;
            state.dateKey = value;
            state.titleEdited = false; // tiêu đề tự đổi theo thứ của ngày mới (tránh "Thứ 7" trên lịch Thứ 5)
            refresh(true);
        });
        $('ssm-date').addEventListener('blur', e => { if (!isValidDateKey(e.target.value)) e.target.value = state.dateKey; });
        $('ssm-branch').addEventListener('change', e => {
            if (!BRANCH_LABEL[e.target.value]) { e.target.value = state.branch; return; }
            state.branch = e.target.value;
            refresh(true);
        });
        $('ssm-title').addEventListener('input', e => { state.title = e.target.value; state.titleEdited = !!cleanText(e.target.value, TITLE_MAX, false); redraw(); });
        // Rời ô tiêu đề: hiện đúng chữ sẽ in (đã gọn khoảng trắng); để trống thì về tiêu đề mặc định.
        $('ssm-title').addEventListener('blur', e => {
            const clean = cleanText(e.target.value, TITLE_MAX, false);
            state.titleEdited = !!clean;
            state.title = clean || defaultTitle(state.dateKey, state.buoi);
            e.target.value = state.title;
            redraw();
        });
        $('ssm-footer').addEventListener('input', e => { state.footer = e.target.value; redraw(); });
        $('ssm-short').addEventListener('change', e => { state.shortNames = e.target.checked; savePrefs(); redraw(); });
        $('ssm-closed').addEventListener('change', e => { state.showClosed = e.target.checked; savePrefs(); refresh(false); });
        $('ssm-blank').addEventListener('change', e => {
            const n = Number(e.target.value);
            state.blankRows = Number.isInteger(n) ? Math.min(MAX_BLANK_ROWS, Math.max(0, n)) : 3;
            savePrefs();
            redraw();
        });
        $('ssm-excel').addEventListener('click', downloadExcel);
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
        $('ssm-blank').value = String(state.blankRows);
    }

    let dayCache = { key: '', data: null, closures: {}, evidence: null };

    // Phiên công trong ngày (chỉ hôm nay/ngày đã qua) để lấy sĩ số GV đã báo; lỗi đọc thì bỏ qua.
    async function loadDayEvidence(dateKey) {
        if (dateKey > getLocalDateKey(new Date()) || typeof DBService.getDayAttendance !== 'function') return null;
        try { return await DBService.getDayAttendance(dateKey); } catch (error) {
            console.warn('[ScheduleSheet] attendance', error);
            return null;
        }
    }

    async function refresh(reload) {
        syncForm();
        const seq = ++state.loadSeq;
        const key = `${state.branch}__${state.dateKey}`;
        try {
            if (reload || dayCache.key !== key) {
                setStatus('Đang tải lịch…');
                state.model = null;
                state.canvasPromise = null;
                setActionsReady(false);
                const [data, settings, evidence] = await Promise.all([
                    DBService.getSchedule(key, { source: 'server' }),
                    typeof readScheduleClosureSettings === 'function' ? readScheduleClosureSettings() : Promise.resolve({}),
                    loadDayEvidence(state.dateKey)
                ]);
                if (seq !== state.loadSeq) return;
                dayCache = { key, data: data || {}, closures: settings?.centerClosures || global.centerClosures || {}, evidence };
            }
            state.model = buildSheetModel(dayCache.data, {
                dateKey: state.dateKey, branch: state.branch, buoi: state.buoi,
                closures: dayCache.closures, showClosed: state.showClosed,
                reportedCount: reportedCountLookup(dayCache.evidence, key, state.dateKey)
            });
            setStatus('');
            redraw();
        } catch (error) {
            if (seq !== state.loadSeq) return;
            console.error('[ScheduleSheet] load', error);
            state.model = null;
            dayCache = { key: '', data: null, closures: {}, evidence: null };
            $('ssm-preview').innerHTML = '';
            setStatus('Chưa tải được lịch. Kiểm tra mạng rồi chọn lại ngày.');
        } finally {
            if (seq === state.loadSeq) setActionsReady(!!state.model);
        }
    }

    function sheetOptions() {
        return {
            title: state.titleEdited ? cleanText(state.title, TITLE_MAX, false) : '',
            footer: sheetFooter({ footer: state.footer }),
            shortNames: state.shortNames,
            blankRows: state.blankRows
        };
    }

    // Nút xuất chỉ bấm được khi tờ lịch của đúng ngày/cơ sở đang chọn đã tải xong.
    function setActionsReady(ready) {
        document.querySelectorAll('.ssm-actions button').forEach(b => { b.disabled = !ready; });
    }

    function ensureReady() {
        if (state.model && state.model.dateKey === state.dateKey && state.model.branch === state.branch) return true;
        toast('Lịch chưa tải xong — chờ một chút rồi bấm lại.', 'warning');
        return false;
    }

    // Xem trước = đúng tờ ảnh 600px, thu nhỏ cho vừa khung (điện thoại) thay vì bóp cột.
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

    // Dựng ảnh từ một bản sao cố định 600px (không phụ thuộc màn hình người xếp lịch) ở tỉ lệ 2×.
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

    function fileName(ext = 'png') {
        const b = BUOI.find(x => x.key === state.buoi);
        const slug = String(b?.label || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, '-');
        return `lich-${state.branch}-${state.dateKey}-${slug}.${ext}`;
    }

    async function withBusy(button, task) {
        if (!ensureReady()) return;
        const buttons = document.querySelectorAll('.ssm-actions button');
        buttons.forEach(b => { b.disabled = true; });
        const label = button.textContent;
        button.textContent = button.id === 'ssm-excel' ? 'Đang tạo file…' : 'Đang tạo ảnh…';
        try { await task(); } catch (error) {
            if (error?.name === 'AbortError') return;
            console.error('[ScheduleSheet]', error);
            toast(error?.message || 'Không thực hiện được.', 'error');
        } finally {
            button.textContent = label;
            setActionsReady(!!state.model);
        }
    }

    function downloadBlob(blob, name = fileName()) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
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

    function downloadExcel() {
        return withBusy($('ssm-excel'), async () => {
            let bytes;
            try { bytes = buildSheetXlsx(state.model, sheetOptions()); } catch (error) {
                console.error('[ScheduleSheet] excel', error);
                throw new Error('Không tạo được file Excel.');
            }
            downloadBlob(new Blob([bytes], { type: XLSX_MIME }), fileName('xlsx'));
            toast('Đã tải file Excel lịch (A4 dọc, in vừa 1 trang).');
        });
    }

    function shareImage() {
        return withBusy($('ssm-share'), async () => {
            const blob = await renderBlob();
            const file = new File([blob], fileName(), { type: 'image/png' });
            await navigator.share({ files: [file], title: sheetTitle(state.model, sheetOptions()) });
        });
    }

    async function copyText() {
        if (!ensureReady()) return;
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
        if (!isValidDateKey(state.dateKey)) state.dateKey = getLocalDateKey(new Date());
        const branch = typeof currentBranch === 'string' ? currentBranch : '';
        state.branch = BRANCH_LABEL[branch] ? branch : 'cs1';
        state.buoi = defaultBuoi(state.dateKey);
        state.titleEdited = false;
        state.model = null;
        state.footer = $('ssm-footer').value;
        $('ssm-preview').innerHTML = '';
        setActionsReady(false);
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
        // Tiếp tân chỉ xem lịch: nút này là chỗ chép ảnh / xuất Excel của họ.
        const roleRaw = localStorage.getItem('currentRole');
        const roles = typeof parseRoles === 'function' ? parseRoles(roleRaw) : (roleRaw ? [roleRaw] : []);
        if (!roles.some(r => ['admin', 'assistant', 'senior_assistant'].includes(r))) {
            btn.querySelector('.btn-label').textContent = 'Bảng lịch · Chép ảnh / Excel';
            btn.title = 'Xem tờ lịch của một buổi, chép ảnh hoặc xuất Excel (chỉ xem, không sửa lịch)';
        }
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

    global.ScheduleSheet = { buildSheetModel, renderSheetHtml, sheetText, sheetRows, buildSheetXlsx, cleanText, isValidDateKey, shortName, defaultTitle, open, close };
})(window);
