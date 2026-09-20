/* Pure helpers for the batch review workspace. Never mutates source documents. */
(function (root) {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    function buildGroups(profile, inferred, today) {
        const groups = clone(profile.groups || []);
        const occupied = new Set(groups.flatMap(g => g.subjectIds || []));
        inferred.forEach(folder => {
            const buckets = new Map();
            folder.evidence.forEach(row => {
                if (occupied.has(row.subjectId) || row.rate === null || row.ambiguous || row.contradictions?.length) return;
                if (!buckets.has(row.rate)) buckets.set(row.rate, []);
                buckets.get(row.rate).push(row.subjectId);
                occupied.add(row.subjectId);
            });
            for (const [rate, subjectIds] of buckets) groups.push({
                id: (folder.id + ':overview:' + rate).slice(0, 150), name: folder.name + ' · ' + rate.toLocaleString('vi-VN') + ' đ',
                subjectIds, currentRate: rate, baselineDate: today, baselineKind: 'initial', confirmed: false,
                enabled: true, cycleMonths: null, minimumHours: null, extraMonths: null, nextReviewDate: '',
                hoursOverride: null, hoursMonth: '', hoursNote: '', performance: 'unknown', attendance: 'unknown', note: ''
            });
        });
        return groups;
    }
    function reminderDraft(profile, groups, edits, today, policy) {
        const copy = clone(profile);
        copy.groups = groups.map(group => {
            const edit = edits[group.id];
            if (!edit || group.enabled === false || group.scheduledChange?.effectiveFrom > today) return clone(group);
            const cycle = Number(edit.cycle);
            if (!Number.isInteger(cycle) || cycle < 1 || cycle > 36) throw Error('Chu kỳ nhắc phải từ 1 đến 36 tháng.');
            if (!policy.validDate(edit.nextDate)) throw Error('Chọn ngày nhắc tiếp theo.');
            const baseline = group.baselineDate || today;
            const earliest = policy.addMonths(baseline, cycle);
            if (edit.nextDate < earliest) throw Error('Ngày nhắc của ' + group.name + ' phải từ ' + earliest + ' (theo mốc và chu kỳ).');
            if (group.currentRate === null || !group.subjectIds.length) throw Error('Cần xác nhận giá và môn trước khi đặt nhắc.');
            return { ...clone(group), baselineDate: baseline, cycleMonths: cycle, nextReviewDate: edit.nextDate, confirmed: true };
        });
        return copy;
    }
    function attendance(stats) {
        const known = field => Number.isFinite(stats?.[field]) && stats[field] >= 0;
        const fields = ['workedShifts', 'vpShifts', 'vdxShifts', 'vkpShifts'];
        const total = fields.every(known) ? fields.reduce((sum, key) => sum + stats[key], 0) : null;
        return {
            percent: total > 0 ? 100 * stats.workedShifts / total : null,
            offHours: known('vpMinutes') ? stats.vpMinutes / 60 : null,
            absentHours: known('vdxMinutes') && known('vkpMinutes') ? (stats.vdxMinutes + stats.vkpMinutes) / 60 : null,
            offShifts: known('vpShifts') ? stats.vpShifts : null,
            absentShifts: known('vdxShifts') && known('vkpShifts') ? stats.vdxShifts + stats.vkpShifts : null,
            lateCount: known('lateCount') ? stats.lateCount : null
        };
    }
    // A later group of the same person is re-prepared after our first commit.
    // Only prices already approved in this batch may differ from the preview.
    function samePreview(expected, current, applied = []) {
        const changes = rows => rows.map(({ subjectId, name, beforeRate, afterRate }) => ({ subjectId, name, beforeRate, afterRate })).sort((a,b) => a.name.localeCompare(b.name));
        if (JSON.stringify(changes(expected.changes)) !== JSON.stringify(changes(current.changes)) || expected.targetMonth !== current.targetMonth) return false;
        const changed = new Map(applied.flatMap(p => p.changes).map(row => [row.name, row.afterRate]));
        const preserved = expected.preserved.map(row => ({ name: row.name, rate: changed.has(row.name) ? changed.get(row.name) : row.rate }));
        const normalize = rows => rows.map(({ name, rate }) => ({ name, rate })).sort((a,b) => a.name.localeCompare(b.name));
        return JSON.stringify(normalize(preserved)) === JSON.stringify(normalize(current.preserved));
    }
    const api = { buildGroups, reminderDraft, attendance, samePreview };
    root.SalaryReviewOverviewPolicy = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
