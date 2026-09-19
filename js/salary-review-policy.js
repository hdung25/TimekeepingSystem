// Salary review evidence and reminders only. This module never writes a price,
// attendance record or payslip. All dates use the centre's UTC+7 calendar.
(function (root) {
    'use strict';

    const LADDER = Object.freeze([30, 32, 34, 36, 38, 40, 42, 48, 50, 52, 54, 56].map(n => n * 1000));
    const TEACHER_ROLES = new Set(['teacher', 'giao-vien', 'giao_vien', 'teaching_assistant', 'assistant', 'staff', 'tro-giang', 'tro_giang']);
    const SINGLE_TEACHER_ROLES = new Set(['teacher', 'giao-vien', 'giao_vien']);
    const MINUTE_FIELDS = ['totalBaseMins', 'totalTinHocMins', 'totalPreschoolMins', 'totalAffiliateMins', 'totalTutoringMins'];
    const STAT_FIELDS = ['workedShifts', 'vpShifts', 'vdxShifts', 'vkpShifts', 'lateCount', 'totalLateMinutes'];
    const own = (value, field) => Object.prototype.hasOwnProperty.call(value || {}, field);
    const text = value => String(value == null ? '' : value).trim();
    const list = value => Array.isArray(value) ? value : [];
    const key = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
    const rateName = value => text(value).replace(/\s+/g, ' ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')').toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
    const numeric = value => value !== null && value !== undefined && text(value) !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) ? Number(value) : null;
    const nonnegative = value => { const n = numeric(value); return n !== null && n >= 0 ? n : null; };
    const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value)) && Number(text(value).slice(0, 4)) >= 1000;

    function validDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1000) return false;
        const d = new Date(value + 'T00:00:00Z');
        return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
    }

    function dateKey(value) {
        if (value === undefined) value = new Date();
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return validDate(value) ? value : '';
        if (value == null || value === '') return '';
        if (value && typeof value.toDate === 'function') value = value.toDate();
        const millis = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
        if (!Number.isFinite(millis)) return '';
        const shifted = new Date(millis + 7 * 60 * 60 * 1000);
        return Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : '';
    }

    function addMonths(date, count) {
        if (!validDate(date) || !Number.isInteger(count) || Math.abs(count) > 1200) return '';
        const [year, month, day] = date.split('-').map(Number);
        const target = new Date(Date.UTC(year, month - 1 + count, 1));
        if (target.getUTCFullYear() < 1000 || target.getUTCFullYear() > 9999) return '';
        const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        target.setUTCDate(Math.min(day, last));
        return target.toISOString().slice(0, 10);
    }

    function previousMonths(today, count = 3) {
        if (!validDate(today) || !Number.isInteger(count) || count < 0 || count > 120) return [];
        return Array.from({ length: count }, (_, i) => addMonths(today.slice(0, 7) + '-01', -i - 1).slice(0, 7));
    }

    function isTeacher(user) {
        if (!user || user.active === false || user.isActive === false || ['inactive', 'deleted', 'resigned', 'terminated'].includes(text(user.status).toLowerCase())) return false;
        const roles = list(user.roles).length ? user.roles : [user.role];
        return roles.some(role => TEACHER_ROLES.has(text(role).toLowerCase()));
    }

    // Compatibility fallback follows DBService's component lifecycle contract.
    // Browser callers should inject { lifecycle: DBService.getPayslipLifecycleState }.
    function lifecycleState(published, options = {}) {
        if (typeof options.lifecycle === 'function') return options.lifecycle(published);
        const p = published || {};
        const valid = value => ['draft', 'published', 'received'].includes(text(value).toLowerCase());
        const gvExplicit = valid(p.status_gv), ttExplicit = valid(p.status_tt);
        const details = p.details_gv != null || (SINGLE_TEACHER_ROLES.has(text(p.role).toLowerCase()) && p.details != null);
        const aggregate = valid(p.status) ? text(p.status).toLowerCase() : 'draft';
        const status = gvExplicit ? text(p.status_gv).toLowerCase() : details && !ttExplicit ? aggregate : 'draft';
        return { has_gv: details || (gvExplicit && status !== 'draft'), status_gv: status };
    }

    function teacherDetails(monthly, options = {}) {
        const p = monthly && monthly.published;
        if (!p) return null;
        const state = lifecycleState(p, options);
        if (!state.has_gv || !['published', 'received'].includes(state.status_gv)) return null;
        if (p.details_gv && typeof p.details_gv === 'object') return p.details_gv;
        return SINGLE_TEACHER_ROLES.has(text(p.role).toLowerCase()) && p.details && typeof p.details === 'object' ? p.details : null;
    }

    function teachingMinutes(monthly, options = {}) {
        const details = teacherDetails(monthly, options);
        if (!details || !MINUTE_FIELDS.some(field => own(details, field))) return null;
        let total = 0;
        for (const field of MINUTE_FIELDS) {
            if (!own(details, field)) continue;
            const amount = nonnegative(details[field]);
            if (amount === null) return null;
            total += amount;
        }
        return Number.isFinite(total) ? total : null;
    }

    function documentIdentity(doc) {
        const match = /^(\d{4}-\d{2})_(.+)$/.exec(text(doc && doc.id));
        const month = text(doc && (doc.month || doc.monthStr)) || (match ? match[1] : '');
        const staffId = text(doc && doc.staffId) || (match ? match[2] : '');
        return { month: validMonth(month) ? month : '', staffId };
    }

    function monthlyIndex(monthly) {
        const index = new Map();
        list(monthly).forEach(doc => {
            const id = documentIdentity(doc);
            if (!id.month || !id.staffId) return;
            const k = id.month + '_' + id.staffId;
            index.set(k, index.has(k) ? null : doc); // Duplicate input is ambiguous, never double count.
        });
        return index;
    }

    function statistics(staffId, months, monthly, options = {}) {
        const index = options.monthlyIndex instanceof Map ? options.monthlyIndex : monthlyIndex(monthly);
        const requested = [...new Set(list(months).filter(validMonth))];
        const rows = requested.map(month => {
            const id = month + '_' + text(staffId), doc = index.get(id);
            const details = teacherDetails(doc, options), minutes = teachingMinutes(doc, options);
            const status = !index.has(id) ? 'missing' : doc === null ? 'duplicate' : !details ? 'unpublished_or_missing_teacher_snapshot' : minutes === null ? 'invalid_hours' : 'observed';
            return { month, minutes, hours: minutes === null ? null : minutes / 60, status, stats: details && details.stats || {} };
        });
        const observed = rows.filter(row => row.minutes !== null);
        const totals = Object.fromEntries(STAT_FIELDS.map(field => [field, 0]));
        const missingStats = new Set();
        observed.forEach(row => STAT_FIELDS.forEach(field => {
            const n = nonnegative(row.stats[field]);
            if (n === null) missingStats.add(field); else totals[field] += n;
        }));
        return {
            rows, months: requested, observed: observed.length, complete: requested.length > 0 && observed.length === requested.length,
            missingMonths: rows.filter(row => row.minutes === null).map(row => row.month),
            averageHours: observed.length ? observed.reduce((sum, row) => sum + row.minutes, 0) / 60 / observed.length : null,
            scope: 'all_teaching_payroll_hours', missingStats: [...missingStats], ...totals
        };
    }

    // Never replace absent payslips by zero or combine different historical month
    // counts into an apparently comparable employee average.
    function benchmark(users, monthly, today = dateKey(), options = {}) {
        const month = previousMonths(today, 1)[0] || '';
        const teachers = [...new Map(list(users).filter(user => isTeacher(user) && text(user.id)).map(user => [text(user.id), user])).values()];
        const index = monthlyIndex(monthly);
        const samples = teachers.map(user => ({ staffId: text(user.id), stats: statistics(user.id, month ? [month] : [], monthly, { ...options, monthlyIndex: index }) }));
        const observed = samples.filter(sample => sample.stats.complete);
        const meanHours = observed.length ? observed.reduce((sum, sample) => sum + sample.stats.averageHours, 0) / observed.length : null;
        return {
            month, months: month ? [month] : [], meanHours, hours: meanHours === null ? null : Math.round(meanHours * 10) / 10,
            suggestedHours: meanHours === null ? null : Math.round(meanHours), people: observed.length, totalPeople: teachers.length,
            personMonths: observed.length, zeroHours: observed.filter(sample => sample.stats.averageHours === 0).length,
            missingPeople: teachers.length - observed.length, complete: teachers.length > 0 && observed.length === teachers.length,
            scope: 'all_teaching_payroll_hours', status: observed.length ? 'suggestion_requires_admin_save' : 'insufficient_data'
        };
    }

    function catalogGroups(subjects) {
        const catalog = list(subjects).filter(subject => subject && text(subject.id));
        const byId = new Map(catalog.map(subject => [text(subject.id), subject]));
        const groups = new Map();
        catalog.filter(subject => subject.isGroup !== true).forEach(subject => {
            const ancestors = [], seen = new Set([text(subject.id)]);
            let parent = byId.get(text(subject.parentId));
            while (parent && !seen.has(text(parent.id))) {
                seen.add(text(parent.id)); ancestors.push(parent); parent = byId.get(text(parent.parentId));
            }
            const path = [...ancestors].reverse().map(item => text(item.name)).concat(text(subject.name)).join(' / ');
            const normalized = key(path);
            if (normalized.includes('lienket') || normalized.includes('tainha') || key(subject.name).includes('kem11')) return;
            const closest = ancestors.find(item => item.isGroup === true);
            let id = closest ? text(closest.id) : 'subject:' + text(subject.id);
            let name = closest ? ancestors.slice(ancestors.indexOf(closest)).reverse().map(item => text(item.name)).join(' / ') : text(subject.name);
            const match = /^toan(?:lop)?(\d{1,2})$/.exec(key(subject.name));
            if (match && Number(match[1]) >= 1 && Number(match[1]) <= 12) {
                const level = Number(match[1]) <= 5 ? 1 : Number(match[1]) <= 9 ? 2 : 3;
                id = (closest ? text(closest.id) : 'math') + ':level' + level;
                name = 'Toán ' + (level === 1 ? 'tiểu học · lớp 1–5' : level === 2 ? 'cấp 2 · lớp 6–9' : 'cấp 3 · lớp 10–12');
            }
            if (!groups.has(id)) groups.set(id, { id, name, folderId: closest ? text(closest.id) : '', subjects: [], subjectIds: [] });
            groups.get(id).subjects.push({ ...subject });
            groups.get(id).subjectIds.push(text(subject.id));
        });
        return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    }

    function classRateRows(config, source, month, rank) {
        return Object.entries(config && config.class_rates || {}).map(([name, raw]) => {
            const detail = raw && typeof raw === 'object' ? raw : null;
            return { name, subjectId: text(detail && (detail.subjectId || detail.id)), rate: nonnegative(detail ? detail.rate : raw), source, month, rank };
        });
    }

    function ratesForMonth(doc, options = {}) {
        if (!doc) return [];
        const month = documentIdentity(doc).month;
        // Presence of the canonical component wins even when its map is empty.
        const canonical = doc.giao_vien && typeof doc.giao_vien === 'object';
        const cfg = canonical ? doc.giao_vien : doc['giao-vien'];
        const rows = classRateRows(cfg, canonical ? 'monthly_config' : 'monthly_legacy_config', month, 0);
        const p = doc.published || {}, details = teacherDetails(doc, options);
        if (details) {
            const breakdown = Array.isArray(details.breakdown) ? details.breakdown : SINGLE_TEACHER_ROLES.has(text(p.role).toLowerCase()) ? list(p.breakdown) : [];
            breakdown.forEach(row => rows.push({ name: text(row.name), subjectId: text(row.subjectId || row.id), rate: nonnegative(row.rate), source: 'published_snapshot', month, rank: 1 }));
        }
        return rows;
    }

    function inferGroups(user, subjects, monthly, options = {}) {
        const groups = catalogGroups(subjects);
        const today = dateKey(options.today === undefined ? undefined : options.today);
        const byId = new Map(list(subjects).filter(s => s && s.isGroup !== true).map(s => [text(s.id), s]));
        const names = new Map();
        byId.forEach(subject => { const k = key(subject.name); names.set(k, (names.get(k) || []).concat(text(subject.id))); });
        const matchRow = row => {
            if (row.subjectId && byId.has(row.subjectId)) return { id: row.subjectId };
            if (byId.has(row.name)) return { id: row.name };
            const alias = options.aliases && own(options.aliases, row.name) && text(options.aliases[row.name]);
            if (alias && byId.has(alias)) return { id: alias };
            const matches = names.get(key(row.name)) || [];
            return matches.length === 1 ? { id: matches[0] } : { ids: matches, ambiguous: matches.length > 1 };
        };
        const allRows = [], specialRows = [], ambiguousIds = new Set();
        const history = list(monthly).filter(doc => {
            const id = documentIdentity(doc);
            return id.staffId === text(user && user.id) && id.month && (!today || id.month <= today.slice(0, 7));
        }).sort((a, b) => documentIdentity(b).month.localeCompare(documentIdentity(a).month));
        history.forEach(doc => allRows.push(...ratesForMonth(doc, options)));
        const rawLegacy = options.legacySettings || {};
        const legacy = rawLegacy.giao_vien || rawLegacy['giao-vien'] || rawLegacy;
        allRows.push(...classRateRows(legacy, 'legacy_salary_settings', '', 2));
        const config = user && user.salary_config || {};
        list(config.roles).forEach(role => allRows.push({ name: text(role.name), subjectId: text(role.id), rate: nonnegative(role.rate), source: 'personnel_subject_config', month: '', rank: 3 }));
        allRows.push(...classRateRows(config, 'personnel_class_config', '', 4));
        const mapped = new Map();
        allRows.forEach(row => {
            const crowded = /\(\s*\+\s*\d+\s*(?:hs|học\s*sinh)\s*\)/i.test(row.name);
            const combined = row.name.includes('+');
            if (crowded || combined) {
                const components = row.name.replace(/\(\s*\+\s*\d+\s*(?:hs|học\s*sinh)\s*\)/gi, '').split('+');
                const ids = components.map(name => matchRow({ name: text(name) }).id).filter(Boolean);
                specialRows.push({ ...row, subjectIds: ids, reason: crowded ? 'crowded_class' : 'combined_class' });
                return;
            }
            const match = matchRow(row);
            if (match.ambiguous) match.ids.forEach(id => ambiguousIds.add(id));
            if (!match.id) return;
            const rows = mapped.get(match.id) || [];
            rows.push({ ...row, subjectId: match.id }); mapped.set(match.id, rows);
        });
        // Group-policy rates are eligible only when the exact resolver identifies
        // their source. Its legacy "first configured role" fallback is not proof.
        const resolver = options.rateResolver || root.SubjectRatePolicy;
        if (resolver && typeof resolver.resolve === 'function') byId.forEach((subject, id) => {
            const resolved = resolver.resolve(config, list(subjects), id, today, 0);
            if (resolved && resolved.source === 'group' && nonnegative(resolved.rate) !== null) {
                const rows = mapped.get(id) || [];
                rows.push({ subjectId: id, name: text(subject.name), rate: nonnegative(resolved.rate), source: 'personnel_group_config', month: '', rank: 5, groupId: text(resolved.groupId) });
                mapped.set(id, rows);
            }
        });
        return groups.map(group => {
            const evidence = group.subjects.map(subject => {
                const id = text(subject.id);
                const observations = (mapped.get(id) || []).slice().sort((a, b) => b.month.localeCompare(a.month) || a.rank - b.rank);
                // An explicitly blank/invalid latest value needs review. Do not
                // silently resurrect an older price beneath it.
                const selected = observations[0];
                const contemporaneous = selected ? observations.filter(row => row.month === selected.month) : [];
                const contradictions = selected ? contemporaneous.filter(row => row.rate !== selected.rate) : [];
                return {
                    subjectId: id, name: text(subject.name), rate: selected ? selected.rate : null,
                    month: selected ? selected.month : '', source: selected ? selected.source : '',
                    observations, contradictions, ambiguous: !selected && ambiguousIds.has(id),
                    status: selected ? selected.rate === null ? 'invalid_rate' : contradictions.length ? 'conflict' : 'observed' : ambiguousIds.has(id) ? 'ambiguous_name' : 'missing'
                };
            });
            const known = evidence.filter(row => row.rate !== null);
            // Every subject votes once. A mixed folder is always reported, even
            // if one value is the plurality; no minority price gets replaced.
            const counts = new Map();
            known.forEach(row => counts.set(row.rate, (counts.get(row.rate) || 0) + 1));
            const ranked = [...counts].sort((a, b) => b[1] - a[1]);
            const suggestedRate = ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
            const newest = known.map(row => row.month).filter(Boolean).sort().pop() || '';
            const byMonth = new Map();
            evidence.forEach(row => row.observations.forEach(item => {
                if (item.month) byMonth.set(item.month, (byMonth.get(item.month) || []).concat(item));
            }));
            let observedSince = '';
            if (suggestedRate !== null && newest) {
                let month = newest;
                // Bound the walk by observed history length; missing months stop it.
                for (let i = 0; i < history.length; i += 1) {
                    const rows = byMonth.get(month) || [];
                    if (!rows.length || rows.some(row => row.rate === null || row.rate !== suggestedRate)) break;
                    observedSince = month;
                    month = addMonths(month + '-01', -1).slice(0, 7);
                }
            }
            const contradictions = evidence.flatMap(row => row.contradictions.map(conflict => ({ subjectId: row.subjectId, name: row.name, selectedRate: row.rate, ...conflict })));
            return {
                ...group, evidence, suggestedRate, rate: suggestedRate, observedSince,
                hasEvidence: known.length > 0, knownCount: known.length, missingCount: evidence.length - known.length,
                exceptions: evidence.filter(row => row.rate !== null && (suggestedRate === null || row.rate !== suggestedRate)),
                contradictions, specialEvidence: specialRows.filter(row => row.subjectIds.some(id => group.subjectIds.includes(id))),
                mixedRates: ranked.length > 1, confidence: contradictions.length || ranked.length > 1 ? 'needs_review' : known.length ? 'suggestion' : 'missing',
                suggestedNext: suggestedRate === null ? null : LADDER.find(rate => rate > suggestedRate) || null
            };
        });
    }

    function inherited(field, group, person, settings, fallback, validator) {
        for (const [source, values] of [['group', group], ['person', person], ['settings', settings]]) {
            const raw = values && values[field];
            if (raw === undefined || raw === null || raw === '') continue;
            const value = numeric(raw);
            if (value !== null && validator(value)) return { value, source };
            return { value: null, source, invalid: true };
        }
        return { value: fallback, source: 'default' };
    }

    // currentRate is a confirmed reference only; the result has no mutation or
    // automatic-approval flag. Low workload remains advice, never a postponement.
    function evaluate(group = {}, stats = {}, settings = {}, today = dateKey(), personOverrides = {}) {
        const baseline = validDate(group.baselineDate) ? group.baselineDate : validDate(group.lastIncreaseDate) ? group.lastIncreaseDate : '';
        const currentRate = nonnegative(group.currentRate);
        const cycle = inherited('cycleMonths', group, personOverrides, settings, currentRate === 42000 ? 6 : 3, n => Number.isInteger(n) && n >= 1 && n <= 60);
        // A general default of three months must not erase the 42k special step;
        // an explicit person/group override intentionally can.
        if (currentRate === 42000 && cycle.source === 'settings' && !cycle.invalid) cycle.value = 6;
        const threshold = inherited('minimumHours', group, personOverrides, settings, null, n => n >= 0 && n <= 744);
        const extra = inherited('extraMonths', group, personOverrides, settings, 1, n => Number.isInteger(n) && n >= 1 && n <= 24);
        const manualHours = inherited('hoursOverride', group, personOverrides, {}, null, n => n >= 0 && n <= 744);
        const latestCompletedMonth = previousMonths(today, 1)[0] || '';
        const manualHoursMonth = text((manualHours.source === 'person' ? personOverrides : group).hoursMonth);
        const hasManualHours = manualHours.source !== 'default';
        // A manual three-month average belongs to its recorded ending month.
        // Keeping its evidence is useful; reusing it for later cycles is not.
        const manualHoursStale = hasManualHours && (!latestCompletedMonth || manualHoursMonth !== latestCompletedMonth);
        const systemHours = stats && stats.complete ? nonnegative(stats.averageHours) : null;
        const useManualHours = hasManualHours && !manualHoursStale;
        const hours = useManualHours ? manualHours.value : systemHours;
        const missing = hours === null || threshold.value === null;
        const low = !missing && hours < threshold.value;
        const result = {
            state: 'setup', label: 'Cần xác nhận mốc', dueDate: '', baseDueDate: '', baselineDate: baseline,
            hours, threshold: threshold.value, months: cycle.value, extra: extra.value, low, missing,
            visibleThisMonth: false, suggestedDeferUntil: '', hoursSource: useManualHours ? 'admin_confirmed' : 'published_teacher_snapshots',
            manualHoursStale, manualHoursMonth, latestCompletedMonth,
            ruleSources: { cycleMonths: cycle.source, minimumHours: threshold.source, extraMonths: extra.source },
            missingMonths: list(stats && stats.missingMonths), invalid: !!(cycle.invalid || threshold.invalid || extra.invalid || manualHours.invalid)
        };
        if (group.enabled === false || personOverrides.enabled === false) return { ...result, state: 'disabled', label: 'Tạm ngưng xét' };
        if (!validDate(today) || !group.confirmed || !baseline || currentRate === null || cycle.invalid) return result;
        const baseDueDate = addMonths(baseline, cycle.value);
        const next = validDate(group.nextReviewDate) ? group.nextReviewDate : '';
        const dueDate = next && next > baseDueDate ? next : baseDueDate;
        const inMonth = dueDate.slice(0, 7) === today.slice(0, 7);
        const overdue = dueDate < today, due = dueDate <= today;
        const deferred = dueDate !== baseDueDate;
        const state = due ? 'due' : inMonth ? 'this_month' : deferred ? 'deferred' : 'upcoming';
        return {
            ...result, state, label: due ? overdue ? 'Quá hạn xét' : 'Đến hạn xét' : inMonth ? 'Đến hạn trong tháng' : deferred ? 'Đã hẹn lại' : 'Chưa đến hạn',
            dueDate, baseDueDate, deferred, overdue, visibleThisMonth: due || inMonth,
            suggestedDeferUntil: low ? addMonths(dueDate > today ? dueDate : today, extra.value) : '',
            cycleKey: [text(group.id), baseline, baseDueDate].join('|')
        };
    }

    const api = Object.freeze({ LADDER, key, rateName, dateKey, localDate: dateKey, validDate, addMonths, previousMonths, isTeacher, teacherDetails, teachingMinutes, statistics, benchmark, catalogGroups, ratesForMonth, inferGroups, evaluate });
    root.SalaryReviewPolicy = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
