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
            rows.push({date, staffId: String(staff.id), staffName: staff.fullName || staff.name || staff.username || staff.id,
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
    // True when any string inside value (one '+'-joined part, compared exactly) is a
    // selected subject id or name. Used to decide which teachers' sessions need evaluating.
    function mentionsAny(value, needles, depth = 0) {
        if (value == null || depth > 6) return false;
        if (typeof value === 'string') return value.split('+').some(part => needles.has(normalize(part)));
        if (Array.isArray(value)) return value.some(item => mentionsAny(item, needles, depth + 1));
        if (typeof value === 'object' && !(value instanceof Date)) return Object.values(value).some(item => mentionsAny(item, needles, depth + 1));
        return false;
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
        const text = String(row.status || ''), flags = [];
        const late = /\(T(\d+)p\)/.exec(text), early = /\(V(\d+)p\)/.exec(text);
        if (late) flags.push({kind: 'late', text: 'Trễ ' + late[1] + 'p' + (row.manualLateMinutes > 0 && row.manualLateMinutes >= Number(late[1]) ? ' · tiếp tân ghi' : '')});
        if (early) flags.push({kind: 'warn', text: 'Về sớm ' + early[1] + 'p'});
        if (/★\+10p(?! \(hủy\))/.test(text)) flags.push({kind: 'ok', text: 'Sớm +10p'});
        if (/★\?/.test(text)) flags.push({kind: 'warn', text: 'Chờ duyệt sớm'});
        return flags;
    }
    return {sections, ids, normalize, leaves, resolveIds, rowsForChips, summarize, mentionsAny, monthGrid, formatMinutes, toneOf, flagsOf};
});
