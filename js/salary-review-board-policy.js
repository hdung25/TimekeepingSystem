/* Pure helpers for the one-page salary review board. Never writes or mutates input. */
(function (root) {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    const text = value => String(value == null ? '' : value).trim();
    const STEP_OFF_LADDER = 2000;
    const SOON_MONTHS = 2;

    // Next rate on the shared 30–56k ladder. Rates outside the ladder (below 30k
    // or from 56k up) get +2.000đ; the Admin can always type another amount.
    function nextRate(current, ladder) {
        const rate = Number(current);
        if (!Number.isFinite(rate) || rate <= 0) return null;
        const first = ladder[0], last = ladder[ladder.length - 1];
        if (rate < first || rate >= last) return rate + STEP_OFF_LADDER;
        return ladder.find(step => step > rate) || rate + STEP_OFF_LADDER;
    }

    // Earliest month, walking back without a gap, in which every observed rate of
    // the group's subjects equals the group rate. Only an estimate: a price seen
    // in a month does not prove the day it was raised.
    function estimateBaseline(subjectIds, rate, evidenceRows, today, policy) {
        const ids = new Set((subjectIds || []).map(String));
        const byMonth = new Map();
        (evidenceRows || []).filter(row => ids.has(String(row.subjectId))).forEach(row => {
            (row.observations || []).forEach(item => {
                if (!/^\d{4}-\d{2}$/.test(text(item.month)) || item.month > today.slice(0, 7)) return;
                if (!byMonth.has(item.month)) byMonth.set(item.month, []);
                byMonth.get(item.month).push(item.rate);
            });
        });
        const months = [...byMonth.keys()].sort();
        if (!months.length || rate == null) return { date: today, estimated: true, known: false, capped: false };
        let month = months[months.length - 1], since = '';
        while (byMonth.has(month) && byMonth.get(month).every(value => value === rate)) {
            since = month;
            month = policy.addMonths(month + '-01', -1).slice(0, 7);
        }
        if (!since) return { date: today, estimated: true, known: false, capped: false };
        return { date: since + '-01', estimated: true, known: true, capped: since === months[0] };
    }

    function attendancePercent(stats) {
        const fields = ['workedShifts', 'vpShifts', 'vdxShifts', 'vkpShifts'];
        if (!stats || (stats.missingStats || []).some(field => fields.includes(field)) || !stats.observed) return null;
        const total = fields.reduce((sum, field) => sum + (Number(stats[field]) || 0), 0);
        return total > 0 ? 100 * (Number(stats.workedShifts) || 0) / total : null;
    }

    function category(row, today, policy) {
        if (row.pending) return 'pending';
        if (row.disabled) return 'disabled';
        const ev = row.evaluation;
        if (!ev || !ev.dueDate) return 'setup';
        if (ev.visibleThisMonth) return 'due';
        const soonLimit = policy.addMonths(today.slice(0, 7) + '-01', SOON_MONTHS + 1);
        return ev.dueDate < soonLimit ? 'soon' : 'later';
    }

    // One row per teacher × group of subjects sharing a price. Saved groups keep
    // their stored baseline; new price buckets get an estimated baseline.
    function buildRows(input) {
        const { users, subjects, profiles, config, monthlyByStaff, legacyByStaff, today, policy, overview, lifecycle, rateResolver } = input;
        const rows = [];
        const profileOf = id => (profiles || []).find(p => (p.staffId || p.id) === id) || { revision: 0, groups: [], personOverrides: {} };
        (users || []).filter(policy.isTeacher).forEach(user => {
            const staffId = text(user.id), profile = profileOf(staffId);
            const monthly = (monthlyByStaff && monthlyByStaff[staffId]) || [];
            const inferred = policy.inferGroups(user, subjects, monthly, {
                today, legacySettings: (legacyByStaff && legacyByStaff[staffId]) || {}, lifecycle, rateResolver
            });
            const evidence = inferred.flatMap(folder => folder.evidence);
            const stats = policy.statistics(staffId, policy.previousMonths(today, 3), monthly, { lifecycle });
            const groups = overview.buildGroups(profile, inferred, today);
            const base = {
                staffId, name: text(user.name || user.username || staffId), code: text(user.username).toUpperCase(), msnv: staffNumber(user.username),
                stats, attendance: attendancePercent(stats), profileRevision: Number(profile.revision || 0)
            };
            if (!groups.length) {
                rows.push({ ...base, key: staffId + '|none', group: null, category: 'nodata', subjects: [] });
                return;
            }
            groups.forEach(group => {
                const saved = (profile.groups || []).find(g => g.id === group.id) || null;
                const pending = !!(group.scheduledChange && group.scheduledChange.effectiveFrom > today);
                const confirmed = !!(saved && saved.confirmed);
                const estimate = confirmed ? null : estimateBaseline(group.subjectIds, group.currentRate, evidence, today, policy);
                const baselineDate = confirmed ? group.baselineDate : estimate.date;
                const effective = { ...group, confirmed: true, baselineDate };
                const evaluation = group.currentRate == null ? null
                    : policy.evaluate(effective, stats, config, today, profile.personOverrides || {});
                const subjectRows = group.subjectIds.map(id => {
                    const row = evidence.find(item => item.subjectId === id);
                    const subject = (subjects || []).find(item => item.id === id);
                    return { id, name: text(row?.name || subject?.name || id), rate: row ? row.rate : null };
                });
                const row = {
                    ...base, key: staffId + '|' + group.id, group: clone(group), saved: !!saved, confirmed,
                    disabled: group.enabled === false, pending, baselineDate, estimate, evaluation, subjects: subjectRows,
                    currentRate: group.currentRate, nextRate: nextRate(group.currentRate, policy.LADDER)
                };
                row.category = category(row, today, policy);
                rows.push(row);
            });
        });
        return rows.sort(compareRows);
    }

    // MSNV = số cuối của tên đăng nhập (QUYNH64 → 64), giống trang Nhân sự.
    function staffNumber(username) {
        const match = text(username).match(/\d+$/);
        return match ? match[0] : '';
    }
    // Owner 06/10: bảng xếp theo MSNV tăng dần; mã không có số xuống cuối.
    function compareRows(a, b) {
        const na = a.msnv ? parseInt(a.msnv, 10) : Infinity, nb = b.msnv ? parseInt(b.msnv, 10) : Infinity;
        return (na === nb ? 0 : na < nb ? -1 : 1) ||
            text(a.code).localeCompare(text(b.code), 'vi', { numeric: true }) ||
            a.name.localeCompare(b.name, 'vi') || text(a.group?.name).localeCompare(text(b.group?.name), 'vi');
    }

    function summary(rows) {
        const count = filter => new Set(rows.filter(filter).map(row => row.staffId)).size;
        return {
            due: count(r => r.category === 'due'), soon: count(r => r.category === 'soon'),
            setup: count(r => r.group && !r.confirmed && !r.pending && !r.disabled),
            pending: count(r => r.category === 'pending'), all: count(() => true)
        };
    }

    function groupByTeacher(rows) {
        const teachers = new Map();
        rows.forEach(row => {
            if (!teachers.has(row.staffId)) teachers.set(row.staffId, []);
            teachers.get(row.staffId).push(row);
        });
        return [...teachers.values()];
    }

    // One edit per teacher/current price. The underlying review groups remain
    // independent so different dates and audit histories are never merged.
    function rateBuckets(rows) {
        const buckets = new Map();
        rows.forEach(row => {
            const id = JSON.stringify([row.staffId, row.currentRate]);
            if (!buckets.has(id)) buckets.set(id, []);
            buckets.get(id).push(row);
        });
        return [...buckets.values()];
    }

    function matchesTab(row, tab) {
        if (tab === 'all') return true;
        if (tab === 'setup') return !!row.group && !row.confirmed && !row.pending && !row.disabled;
        return row.category === tab;
    }

    // Profile draft that confirms the given groups. Other saved groups are kept
    // exactly; the service re-validates and merges in its transaction.
    function confirmDraft(profile, entries) {
        const draft = clone(profile && profile.groups ? profile : { groups: [], personOverrides: {} });
        draft.groups = draft.groups || [];
        draft.personOverrides = draft.personOverrides || {};
        entries.forEach(({ group, baselineDate }) => {
            const index = draft.groups.findIndex(g => g.id === group.id);
            const current = index >= 0 ? draft.groups[index] : clone(group);
            const next = { ...current, confirmed: true, enabled: true, baselineDate: baselineDate || current.baselineDate,
                baselineKind: current.baselineKind === 'increase' && (!baselineDate || baselineDate === current.baselineDate) ? 'increase' : 'initial' };
            if (index >= 0) draft.groups[index] = next;
            else draft.groups.push(next);
        });
        return draft;
    }

    // Before an approval, the server preview must show the same "before" prices
    // the Admin saw. A missing monthly price (null) is allowed: nothing to replace.
    function previewProblems(changes, shownRates, newRate) {
        const problems = [];
        (changes || []).forEach(change => {
            const shown = shownRates.has(change.subjectId) ? shownRates.get(change.subjectId) : null;
            if (change.beforeRate != null && shown != null && change.beforeRate !== shown) {
                problems.push(`${change.name}: giá tháng áp dụng đang là ${change.beforeRate.toLocaleString('vi-VN')}đ, khác ${shown.toLocaleString('vi-VN')}đ đang hiện`);
            } else if (change.beforeRate != null && newRate <= change.beforeRate) {
                problems.push(`${change.name}: mức mới phải cao hơn ${change.beforeRate.toLocaleString('vi-VN')}đ`);
            }
        });
        return problems;
    }

    const api = { STEP_OFF_LADDER, SOON_MONTHS, nextRate, estimateBaseline, attendancePercent, buildRows, summary, groupByTeacher, rateBuckets, matchesTab, confirmDraft, previewProblems };
    root.SalaryReviewBoardPolicy = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
