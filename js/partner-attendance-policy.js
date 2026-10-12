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
                status: chip.text || '', checkIn: session.checkIn || session.start || null,
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
    return {sections, ids, leaves, resolveIds, rowsForChips, summarize};
});
