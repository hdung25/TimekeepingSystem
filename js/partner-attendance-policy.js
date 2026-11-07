(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PartnerAttendancePolicy = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const sections = ['morning1','morning2','afternoon1','afternoon2','evening1','evening2'];
    const ids = value => Array.from(new Set((Array.isArray(value) ? value.flat(Infinity) : [value])
        .flatMap(v => String(v || '').split('+')).map(v => v.trim()).filter(Boolean)));
    const normalize = value => String(value || '').normalize('NFC').trim().toLocaleLowerCase('vi');
    function leaves(subjects, groupId) {
        const visited = new Set(), result = [];
        function visit(id) {
            if (visited.has(String(id))) return;
            visited.add(String(id));
            subjects.filter(s => String(s.parentId || '') === String(id)).forEach(s => {
                if (s.isGroup === true) visit(s.id); else result.push(s);
            });
        }
        if (subjects.some(s => String(s.id) === String(groupId) && s.isGroup === true)) visit(groupId);
        return result;
    }
    function resolveIds(item, subjects) {
        const concrete = ids([item.subjectIds, item.subjectId, item.lopId]);
        if (concrete.length) return concrete;
        const name = normalize(item.lop || item.chipFilterName || item.roleName);
        const matches = subjects.filter(s => s.isGroup !== true && normalize(s.name) === name);
        return matches.length === 1 ? [String(matches[0].id)] : [];
    }
    function rowsForChips(chips, schedule, staff, date, subjects, selectedIds) {
        const allowed = new Set(selectedIds.map(String)), rows = [];
        chips.forEach(chip => {
            if (chip.isReceptionist || chip.isOffice || chip.isMeeting) return;
            const sec = chip.classSectionKey;
            const source = sec && chip.classIndex !== null && chip.classIndex !== undefined && (schedule[sec] || []).find((row, index) =>
                (!chip.classCompositeKey || row._compositeKey === chip.classCompositeKey) &&
                Number(row._originalIndex ?? index) === Number(chip.classIndex));
            const session = chip.sessionData || {};
            // An explicit Admin reclassification owns the subject, even when the schedule still has its old label.
            let subjectIds = resolveIds(chip, subjects);
            const knownRoleIds = ids(session.role).filter(id => subjects.some(s => s.isGroup !== true && String(s.id) === id));
            if ((chip.isAdminEdited || chip.usesScheduledSubject === false) && !chip.usesScheduledSubject && !chip.isAdminPayrollOverride) {
                const corrected = resolveIds({subjectIds: session.subjectIds, subjectId: session.subjectId,
                    lopId: session.lopId || knownRoleIds.join('+'),
                    roleName: session.roleName}, subjects);
                if (corrected.length) subjectIds = corrected;
            }
            if (!subjectIds.length && source) subjectIds = resolveIds(source, subjects);
            if (!subjectIds.length) subjectIds = resolveIds({...session, lopId:session.lopId || knownRoleIds.join('+'), roleName: session.roleName || session.role}, subjects);
            const included = subjectIds.filter(id => allowed.has(id));
            if (!included.length) return;
            const ambiguous = included.length !== subjectIds.length;
            const minutes = Number(chip.paidMinutes || 0);
            if (!Number.isFinite(minutes) || minutes < 0) throw new Error('Số phút công không hợp lệ.');
            const label = included.map(id => subjects.find(s => String(s.id) === id)?.name || id).join(' + ');
            const displayRange = String(chip.text || '').match(/(\d{1,2}:\d{2})\s*[–−-]\s*(\d{1,2}:\d{2})/);
            const branches = Array.from(new Set((chip.mergedSegments || []).map(segment=>segment.branch).filter(Boolean)));
            const rowStart = displayRange?.[1] || chip.classStart || chip.schedData?.start || source?.start || '';
            const rowEnd = displayRange?.[2] || chip.classEnd || chip.schedData?.end || source?.end || '';
            rows.push({date, staffId: String(staff.id),
                // Stable identity of this class row for partner-only corrections.
                rowKey: [chip.classCompositeKey || ((chip.branch || source?._branch || session.branch || 'cs') + '__' + date),
                    chip.classSectionKey || '', chip.classIndex ?? '', rowStart, rowEnd, included.slice().sort().join('+')].join('|'), staffName: staff.fullName || staff.name || staff.username || staff.id,
                subjectKey: included.slice().sort().join('+'), subjectName: label,
                start: displayRange?.[1] || chip.classStart || chip.schedData?.start || source?.start || '',
                end: displayRange?.[2] || chip.classEnd || chip.schedData?.end || source?.end || '',
                branch: branches.join(' / ') || chip.branch || source?._branch || session.branch || '', minutes: ambiguous ? 0 : minutes,
                status: chip.text || '', tone: String(chip.class || ''),
                manualLateMinutes: Math.max(0, Math.round(Number(chip.manualLateMinutes) || 0)), checkIn: session.checkIn || session.start || null,
                checkOut: session.checkOut || session.end || null, ambiguous,
                // Paid hours are counted once for a combined class, never once per subject.
                worked: !ambiguous && minutes > 0,
                needsReview: ambiguous || chip.isWarning === true || chip.overtimePending === true || chip.bonus10Status === 'pending'});
        });
        return rows;
    }
    function summarize(rows) {
        const map = new Map();
        rows.forEach(row => {
            const key = JSON.stringify([row.subjectKey,row.staffId]);
            if (!map.has(key)) map.set(key, {subjectName:row.subjectName, staffId:row.staffId, staffName:row.staffName, minutes:0, dates:new Set(), shifts:0});
            const entry = map.get(key);
            entry.minutes += row.minutes; entry.shifts++;
            if (row.worked) entry.dates.add(row.date);
        });
        return Array.from(map.values()).map(entry => ({...entry, days:entry.dates.size, dates:Array.from(entry.dates).sort()}))
            .sort((a,b) => a.subjectName.localeCompare(b.subjectName,'vi') || a.staffName.localeCompare(b.staffName,'vi'));
    }
    // One entry per school (subject) with its own total; teachers keep their own hours/days.
    function bySubject(summary) {
        const map = new Map();
        summary.forEach(item => {
            if (!map.has(item.subjectName)) map.set(item.subjectName, {subjectName: item.subjectName, minutes: 0, dates: new Set(), staff: []});
            const school = map.get(item.subjectName);
            school.minutes += item.minutes; item.dates.forEach(d => school.dates.add(d)); school.staff.push(item);
        });
        return Array.from(map.values()).map(s => ({...s, days: s.dates.size, dates: Array.from(s.dates).sort()}));
    }
    // v263: owner's paper form "BẢNG CHẤM CÔNG THÁNG" — one calendar per school.
    const plain = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toUpperCase().trim();
    // Compared with tones kept so school names like "Ánh Cầu Vồng" / "Mùa Xuân" are not read as a subject.
    const SUBJECT_WORDS = new Set(['VẼ', 'VE', 'TTD', 'NHẢY', 'MÚA', 'TOÁN', 'ROBOT', 'PIANO', 'GUITAR', 'STEM', 'ĐÀN', 'CỜ']);
    // "VẼ TUỔI TIÊN" → Đơn vị "TUỔI TIÊN", Môn "VẼ"; "LK HOA TRẠNG NGUYÊN" → Đơn vị "HOA TRẠNG NGUYÊN".
    function splitSchoolName(name) {
        const words = String(name || '').normalize('NFC').trim().split(/\s+/).filter(Boolean);
        const upper = list => list.join(' ').toLocaleUpperCase('vi');
        if (words.length > 1 && SUBJECT_WORDS.has(words[0].toLocaleUpperCase('vi'))) return {unit: upper(words.slice(1)), subject: upper(words.slice(0, 1))};
        if (words.length > 1 && plain(words[0]) === 'LK') return {unit: upper(words.slice(1)), subject: ''};
        return {unit: upper(words), subject: ''};
    }
    function formatDuration(minutes) {
        const total = Math.max(0, Math.round(Number(minutes) || 0)), h = Math.floor(total / 60), m = total % 60;
        return h && m ? h + ' giờ ' + m + ' phút' : h ? h + ' giờ' : m + ' phút';
    }
    const closedAllDay = value => (Array.isArray(value) ? value : [value]).some(v => String(v) === 'all');
    // rows: one school's rows. A class slot (date + start + end) counts once even when two teachers
    // share it (substitute + original, co-teaching): the partner is billed per class, not per teacher.
    function schoolCalendar(rows, month, closures) {
        const slots = new Map(), weekdays = new Set(), rowDates = new Set();
        const weekday = date => (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;
        rows.forEach(row => {
            rowDates.add(row.date); weekday(row.date) >= 0 && weekdays.add(weekday(row.date));
            const key = row.date + '|' + (row.start || '') + '|' + (row.end || '');
            slots.set(key, Math.max(slots.get(key) || 0, Math.max(0, Number(row.minutes) || 0)));
        });
        const perDate = new Map();
        let totalMinutes = 0, sessions = 0;
        slots.forEach((minutes, key) => {
            const date = key.split('|')[0];
            perDate.set(date, (perDate.get(date) || 0) + minutes);
            totalMinutes += minutes; if (minutes > 0) sessions++;
        });
        const weeks = monthGrid(month).map(week => week.map(cell => {
            if (!cell) return null;
            const minutes = perDate.get(cell.date) || 0, closure = closures && closures[cell.date];
            const holiday = !minutes && !!closure && (rowDates.has(cell.date) || (closedAllDay(closure) && weekdays.has(weekday(cell.date))));
            return {day: cell.day, date: cell.date, minutes, holiday};
        }));
        return {weeks, totalMinutes, sessions, days: Array.from(perDate.values()).filter(m => m > 0).length};
    }
    const FORM = {company: 'CÔNG TY TNHH DỊCH VỤ\nGIÁO DỤC VÀ ĐÀO TẠO\nTƯ DUY TRẺ', preparer: 'Nguyễn Thị Diễm Nguyệt', approver: 'Trương Thị Thủy Tiên',
        approverTitle: 'KT. GIÁM ĐỐC\nPHÓ GIÁM ĐỐC'};
    // Sheet spec for PartnerAttendanceXlsx (styles 12–16 = form styles, rich runs for red day notes).
    function schoolSheet(schoolName, rows, month, closures, sheetName, form) {
        const f = Object.assign({}, FORM, form || {}), cal = schoolCalendar(rows, month, closures), names = splitSchoolName(schoolName);
        const [year, mon] = String(month).split('-');
        const COLS = 10, pad = (cells, style) => { while (cells.length < COLS) cells.push({v: '', s: style}); return cells; };
        const blank = style => ({v: '', s: style});
        const out = [], merges = ['A1:C1', 'D1:J1', 'A2:J2'];
        out.push({ht: 62, cells: pad([{v: f.company, s: 12}, blank(12), blank(12),
            {rich: [{t: 'CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM\n', b: true}, {t: 'Độc lập - Tự Do - Hạnh phúc', b: true, sz: 12}], s: 12}], 12)});
        out.push({ht: 28, cells: pad([{v: 'BẢNG CHẤM CÔNG THÁNG ' + mon + '/' + year, s: 13}], 13)});
        out.push({ht: 22, cells: ['STT', 'Đơn Vị', 'Môn', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'].map(v => ({v, s: 14}))});
        const first = out.length + 1, last = first + cal.weeks.length - 1;
        cal.weeks.forEach((week, i) => {
            const lead = i === 0 ? [{v: 1, s: 15}, {v: names.unit, s: 15}, {v: names.subject, s: 15}] : [blank(15), blank(15), blank(15)];
            out.push({ht: 44, cells: lead.concat(week.map(cell => {
                if (!cell) return blank(15);
                const note = cell.minutes > 0 ? formatDuration(cell.minutes) : cell.holiday ? 'nghỉ lễ' : '';
                return note ? {rich: [{t: String(cell.day) + '\n'}, {t: note, color: 'FFFF0000'}], s: 15} : {v: String(cell.day), s: 15};
            }))});
        });
        if (cal.weeks.length > 1) ['A', 'B', 'C'].forEach(c => merges.push(c + first + ':' + c + last));
        const total = out.length + 1;
        out.push({ht: 24, cells: pad([{v: 'Tổng: ' + formatDuration(cal.totalMinutes) + ' (' + cal.sessions + ' buổi)', s: 16}], 16)});
        merges.push('A' + total + ':J' + total);
        out.push({ht: 36, cells: pad([{v: 'NGƯỜI LẬP BIỂU', s: 14}, blank(14), blank(14), blank(14), blank(14), {v: f.approverTitle, s: 14}], 14)});
        out.push({ht: 24, cells: pad([{v: f.preparer, s: 15}, blank(15), blank(15), blank(15), blank(15), {v: f.approver, s: 15}], 15)});
        merges.push('A' + (total + 1) + ':E' + (total + 1), 'F' + (total + 1) + ':J' + (total + 1), 'A' + (total + 2) + ':E' + (total + 2), 'F' + (total + 2) + ':J' + (total + 2));
        return {name: sheetName, widths: [6, 18, 9, 15, 15, 15, 15, 15, 15, 15], merges, rows: out, calendar: cal};
    }
    // Excel sheet names: ≤31 chars, no []:*?/\ , unique.
    function sheetNames(list) {
        const used = new Set();
        return list.map(name => {
            const base = String(name || 'Trường').replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Trường';
            let candidate = base, n = 2;
            while (used.has(candidate.toLocaleLowerCase('vi'))) candidate = base.slice(0, 26) + ' ' + n++;
            used.add(candidate.toLocaleLowerCase('vi'));
            return candidate;
        });
    }
    // True when any string inside value (one '+'-joined part, compared exactly) is a
    // selected subject id or name. Used to decide which teachers' sessions need evaluating.
    function mentionsAny(value, needles, depth = 0) {
        if (value == null || depth > 6) return false;
        if (typeof value === 'string') return value.split('+').some(part => needles.has(normalize(part)));
        if (Array.isArray(value)) return value.some(item => mentionsAny(item, needles, depth + 1));
        if (typeof value === 'object' && !(value instanceof Date)) return Object.values(value).some(item => mentionsAny(item, needles, depth + 1));
        return false;
    }
    // Partner-only corrections: what the partner sees, never payroll.
    const STATUS = {du: 'Đi đủ', tre: 'Đi trễ', 've-som': 'Về sớm', som: 'Đi sớm', 'tang-ca': 'Tăng ca',
        vp: 'Vắng có phép', vdx: 'Vắng đột xuất', vkp: 'Vắng không phép'};
    const ABSENT = new Set(['vp', 'vdx', 'vkp']);
    const adjustmentId = row => (String(row.staffId) + '__' + row.date + '__' + row.rowKey).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 400);
    // Recomputes the shown values from the payroll snapshot, so clearing restores them exactly.
    function applyAdjustment(row, adjustment) {
        if (!row.base) row.base = {minutes: row.minutes, status: row.status, worked: row.worked, ambiguous: row.ambiguous,
            checkIn: row.checkIn, checkOut: row.checkOut, needsReview: row.needsReview};
        Object.assign(row, row.base, {adjustment: null});
        if (!adjustment || adjustment.active !== true || !STATUS[adjustment.status]) return row;
        const minutes = Math.max(0, Math.min(1440, Math.round(Number(adjustment.minutes) || 0)));
        return Object.assign(row, {adjustment, minutes, worked: minutes > 0, ambiguous: false, needsReview: false,
            status: STATUS[adjustment.status] + (adjustment.note ? ' · ' + adjustment.note : '')});
    }
    // Monday-first weeks for a 'YYYY-MM' month; days outside the month are null.
    function monthGrid(month) {
        const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month));
        if (!match) return [];
        const year = Number(match[1]), mon = Number(match[2]), days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
        const offset = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7;
        const cells = Array.from({length: offset}, () => null);
        for (let day = 1; day <= days; day++) cells.push({day, date: month + '-' + String(day).padStart(2, '0')});
        while (cells.length % 7) cells.push(null);
        return Array.from({length: cells.length / 7}, (_, i) => cells.slice(i * 7, i * 7 + 7));
    }
    const formatMinutes = minutes => {
        const total = Math.max(0, Math.round(Number(minutes) || 0));
        return Math.floor(total / 60) + 'h ' + (total % 60) + 'p';
    };
    // Visual state of one calendar entry; wording and colors stay in the page.
    function toneOf(row) {
        const adjusted = row.adjustment?.status;
        if (adjusted) return adjusted === 'vp' ? 'vp' : ABSENT.has(adjusted) ? 'vdx' : (adjusted === 'tre' || adjusted === 've-som') ? 'warn' : 'ok';
        const css = String(row.tone || '');
        if (/chip-absence-vp/.test(css)) return 'vp';
        if (/chip-absence-vdx|chip-red/.test(css)) return 'vdx';
        if (/chip-future/.test(css)) return 'future';
        if (/chip-orange/.test(css)) return 'warn';
        if (row.worked) return 'ok';
        if (/chip-blue/.test(css) && !row.checkIn) return 'future';
        return 'off';
    }
    function flagsOf(row) {
        if (row.adjustment) return [{kind: 'partner', text: 'Chỉnh riêng liên kết'}];
        const text = String(row.status || ''), flags = [];
        const late = /\(T(\d+)p\)/.exec(text), early = /\(V(\d+)p\)/.exec(text);
        if (late) flags.push({kind: 'late', text: 'Trễ ' + late[1] + 'p' + (row.manualLateMinutes > 0 && row.manualLateMinutes >= Number(late[1]) ? ' · tiếp tân ghi' : '')});
        if (early) flags.push({kind: 'warn', text: 'Về sớm ' + early[1] + 'p'});
        if (/★\+10p(?! \(hủy\))/.test(text)) flags.push({kind: 'ok', text: 'Sớm +10p'});
        if (/★\?/.test(text)) flags.push({kind: 'warn', text: 'Chờ duyệt sớm'});
        return flags;
    }
    return {sections, ids, normalize, leaves, resolveIds, rowsForChips, summarize, bySubject, splitSchoolName, formatDuration, schoolCalendar, schoolSheet, sheetNames, mentionsAny, STATUS, ABSENT, adjustmentId, applyAdjustment, monthGrid, formatMinutes, toneOf, flagsOf};
});
