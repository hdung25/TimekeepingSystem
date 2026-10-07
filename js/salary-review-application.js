// Explicit rate application from the start of a month (next months, or up to
// PAST_MONTHS back for an approved back-dated raise). Pure preview only.
(function (global) {
    'use strict';

    const LOOKBACK_MONTHS = 6;
    const PAST_MONTHS = 1;
    const FUTURE_MONTHS = 3;
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
    const text = value => String(value == null ? '' : value).trim();

    function fail(code, message) {
        const error = new Error(message);
        error.code = 'salary-review/' + code;
        throw error;
    }

    // Same payroll key contract as evaluation-service.normalizeChipFilterName.
    // Deliberately does not remove punctuation/accents or resolve old aliases.
    function payrollName(value) {
        if (!value) return 'Dạy học';
        return String(value).trim().replace(/\s+/g, ' ')
            .replace(/\(\s*/g, '(').replace(/\s*\)/g, ')')
            .toLowerCase().replace(/(^|\s)\S/g, letter => letter.toUpperCase()).trim();
    }

    // "E4 (+10 HS)" is the crowded-class rate of "E4" (report.js row naming).
    function studentCountOf(name, base) {
        const prefix = String(base).toLowerCase();
        return String(name).toLowerCase().startsWith(prefix) &&
            /^\s*\(\s*\+\s*\d+\s*(?:hs|học\s*sinh)\s*\)$/i.test(String(name).slice(prefix.length));
    }

    // Same rule as ClassRateGroups.isCombined: "+" but not a "(+N HS)" row.
    function combinedName(name) {
        return String(name).includes('+') && !/\(\s*\+\s*\d+\s*(?:hs|học\s*sinh)\s*\)/i.test(String(name));
    }

    function validMonth(value) {
        return typeof value === 'string' && /^(?:19|[2-9]\d)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
    }

    function shiftMonth(month, offset) {
        if (!validMonth(month) || !Number.isInteger(offset)) fail('invalid-month', 'Tháng áp dụng không hợp lệ.');
        const [year, number] = month.split('-').map(Number);
        const total = year * 12 + number - 1 + offset;
        return `${Math.floor(total / 12)}-${String(total % 12 + 1).padStart(2, '0')}`;
    }

    function copy(value) {
        if (Array.isArray(value)) return value.map(copy);
        if (!record(value)) return value;
        // Keep Firestore Timestamp and Date instances intact in salary fields.
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
    }

    function canonical(value) {
        if (Array.isArray(value)) return value.map(canonical);
        if (value instanceof Date) return { date: value.toISOString() };
        if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
        return value;
    }

    function fingerprint(value) { return JSON.stringify(canonical(value)); }

    function roleFrom(document, location, warnings) {
        const source = document || {};
        if (own(source, 'giao_vien') && own(source, 'giao-vien')) {
            // Legacy reports prefer the canonical key. Retain the legacy key
            // untouched and disclose divergence rather than hiding real history.
            if (fingerprint(source.giao_vien) !== fingerprint(source['giao-vien'])) {
                warnings.push({ code: 'legacy-role-divergence', source: location,
                    message: 'Có cấu hình giáo viên cũ khác bản đang dùng. Bản cũ được giữ nguyên; đối chiếu này dùng cùng nguồn giá với trang Tính lương.' });
            }
        }
        const key = own(source, 'giao_vien') ? 'giao_vien' : own(source, 'giao-vien') ? 'giao-vien' : 'giao_vien';
        if (own(source, key) && !record(source[key])) fail('invalid-source', 'Cấu hình giáo viên không hợp lệ. Hãy đối chiếu bảng lương.');
        return { key, exists: own(source, key), data: source[key] || {} };
    }

    function ratesFrom(settings) {
        if (!own(settings, 'class_rates') || settings.class_rates == null) return null;
        if (!record(settings.class_rates)) fail('invalid-source', 'Danh sách đơn giá không hợp lệ. Hãy đối chiếu bảng lương.');
        return settings.class_rates;
    }

    // Months whose saved rates/payslips a change from targetMonth reaches:
    // target+1 .. currentMonth+FUTURE_MONTHS (the selectable horizon).
    function followingMonths(targetMonth, currentMonth) {
        const months = [];
        for (let month = shiftMonth(targetMonth, 1); month <= shiftMonth(currentMonth, FUTURE_MONTHS); month = shiftMonth(month, 1)) months.push(month);
        return months;
    }

    // Returns null when the teacher payroll of this month is not calculated;
    // returns a cleared copy of `published` when only a teacher DRAFT exists
    // (it was computed from the old rate and must be recalculated, never sent).
    // Sent/received payslips, revision drafts and ambiguous legacy are refused.
    function assertUncalculatedTarget(document, getState, month, allowDraft) {
        const label = month ? `Tháng ${Number(month.slice(5))}/${month.slice(0, 4)}` : 'Tháng áp dụng';
        if (document.revisionDrafts && document.revisionDrafts.gv != null) {
            fail('calculated-target', label + ' đã có bản hiệu chỉnh giáo viên. Xử lý bản hiệu chỉnh ở Tính lương trước.');
        }
        const published = document.published;
        if (published == null) return null;
        if (!record(published)) fail('invalid-source', 'Bản lương đã lưu không hợp lệ. Hãy đối chiếu trước khi áp giá.');
        if (!Object.keys(published).length) return null;
        if (typeof getState !== 'function') fail('missing-lifecycle', 'Chưa tải được trạng thái bảng lương. Hãy tải lại.');
        const state = getState(published);
        if (!state || typeof state.has_gv !== 'boolean') fail('missing-lifecycle', 'Chưa xác định được trạng thái bảng lương.');
        const role = text(published.role).toLowerCase();
        const teachingRole = ['giao-vien', 'giao_vien', 'teacher'].includes(role);
        const operationalRole = ['tiep-tan', 'tiep_tan', 'receptionist'].includes(role);
        const ambiguousLegacy = !operationalRole && !state.has_tt &&
            ['details', 'netPay', 'baseSalary', 'status'].some(key => own(published, key));
        const calculated = state.has_gv || state.locked_gv || teachingRole || ambiguousLegacy || published.details_gv != null;
        if (!calculated) return null;
        if (!allowDraft) fail('calculated-target', 'Tháng áp dụng đã có bản tính hoặc phiếu lương giáo viên. Chọn kỳ chưa tính lương.');
        if (state.locked_gv) fail('calculated-target', label + ' đã gửi phiếu lương giáo viên. Thu hồi phiếu đó ở Tính lương rồi duyệt lại.');
        if (!state.explicit_gv && !teachingRole && role !== 'dual') {
            fail('calculated-target', label + ' có bản lương kiểu cũ chưa rõ trạng thái. Mở Tính lương tháng đó để lưu lại trước.');
        }
        const cleared = { ...published, details_gv: null };
        cleared.details = teachingRole ? null : (published.details_tt ?? null);
        return cleared;
    }

    function buildPreview(input) {
        const options = input || {};
        const { staffId, targetMonth, currentMonth } = options;
        if (!text(staffId)) fail('invalid-staff', 'Chưa chọn nhân viên áp dụng.');
        if (!validMonth(targetMonth) || !validMonth(currentMonth) || targetMonth < shiftMonth(currentMonth, -PAST_MONTHS) ||
            targetMonth > shiftMonth(currentMonth, FUTURE_MONTHS)) {
            fail('invalid-month', `Mức mới chỉ áp dụng từ tháng trước (${shiftMonth(currentMonth, -PAST_MONTHS)}) đến ${FUTURE_MONTHS} tháng tới.`);
        }
        const backdated = targetMonth <= currentMonth;
        // Undefined means not loaded. Null means a confirmed missing document.
        for (const field of ['targetDoc', 'defaults']) {
            if (!own(options, field) || (options[field] !== null && !record(options[field]))) {
                fail('incomplete-source', 'Chưa tải đủ cấu hình lương. Hãy tải lại trước khi áp mức mới.');
            }
        }
        if (!record(options.user) || !record(options.history) || !Array.isArray(options.catalog)) {
            fail('incomplete-source', 'Chưa tải đủ nhân sự, môn học và lịch sử giá.');
        }
        if (options.user.id != null && String(options.user.id) !== String(staffId)) {
            fail('invalid-staff', 'Hồ sơ nguồn không thuộc nhân viên đang xét.');
        }
        const newRate = Number(options.newRate);
        if (!Number.isSafeInteger(newRate) || newRate <= 0) fail('invalid-rate', 'Mức mới phải là số tiền nguyên lớn hơn 0 đ/giờ.');
        const targetDoc = options.targetDoc || {};
        const clearedTarget = assertUncalculatedTarget(targetDoc, options.getPayslipLifecycleState, targetMonth, backdated);
        const warnings = [];
        const target = roleFrom(targetDoc, targetMonth, warnings);
        const role = target.exists ? target.data : options.defaults || {};
        const config = record(options.user.salary_config) ? options.user.salary_config : {};
        const roleRates = ratesFrom(role);
        const configuredRates = ratesFrom(config);
        const mergedRates = copy(roleRates !== null ? roleRates : configuredRates || {});
        const origins = Object.fromEntries(Object.keys(mergedRates).map(name => [name,
            roleRates !== null ? (target.exists ? 'target_month' : 'salary_defaults') : 'staff_config']));
        const sourceMonths = [];
        let inheritedMonth = '';
        for (let back = 1; back <= LOOKBACK_MONTHS; back++) {
            const month = shiftMonth(targetMonth, -back);
            if (!own(options.history, month) || (options.history[month] !== null && !record(options.history[month]))) {
                fail('incomplete-history', `Chưa tải đủ lịch sử giá tháng ${month}. Hãy tải lại.`);
            }
            sourceMonths.push(month);
            const prior = roleFrom(options.history[month], month, warnings);
            const rates = ratesFrom(prior.data) || {};
            const positiveNames = Object.keys(rates).filter(name => Number.isFinite(Number(rates[name])) && Number(rates[name]) > 0);
            if (!positiveNames.length) continue;
            inheritedMonth = month;
            positiveNames.forEach(name => {
                // A saved target zero is an intentional value and must remain
                // byte-for-byte intact even though legacy renderers may inherit it.
                if (target.exists && roleRates && own(roleRates, name)) return;
                if (roleRates && Number(roleRates[name]) > 0) return;
                mergedRates[name] = Number(rates[name]);
                origins[name] = 'inherited:' + month;
            });
            break; // Same six-month, nearest-role source contract as report.js.
        }

        const ids = Array.isArray(options.selectedSubjectIds) ? [...new Set(options.selectedSubjectIds.map(String))] : [];
        const members = new Set((options.group && Array.isArray(options.group.subjectIds) ? options.group.subjectIds : []).map(String));
        if (!ids.length || !members.size) fail('empty-selection', 'Chọn ít nhất một môn trong nhóm để áp dụng.');
        const byId = new Map();
        const byName = new Map();
        options.catalog.forEach(subject => {
            if (!subject || subject.isGroup === true) return;
            const id = text(subject.id);
            const name = payrollName(subject.name);
            if (byId.has(id)) fail('ambiguous-subject', 'Danh mục có ID môn trùng. Cần đối chiếu trước khi áp giá.');
            byId.set(id, subject);
            if (!byName.has(name)) byName.set(name, []);
            byName.get(name).push(id);
        });
        const changes = [];
        ids.forEach(id => {
            const subject = byId.get(id);
            if (!members.has(id) || !subject || !text(subject.name)) fail('invalid-subject', 'Môn đã chọn không còn thuộc phạm vi nhóm được xét.');
            const name = payrollName(subject.name);
            if (byName.get(name).length !== 1 || ['__proto__', 'prototype', 'constructor'].includes(name.toLowerCase())) {
                fail('ambiguous-subject', 'Tên môn trùng với môn khác trong bảng lương. Hãy giữ riêng và đối chiếu trước khi áp giá.');
            }
            if (/[+]/.test(name) || /\(\s*\d+\s*hs\s*\)/i.test(name)) {
                fail('combined-subject', 'Môn ghép hoặc lớp đông cần giữ giá riêng, không áp như môn đơn.');
            }
            const before = own(mergedRates, name) ? mergedRates[name] : null;
            changes.push({ subjectId: id, name, beforeRate: before, afterRate: newRate, beforeSource: origins[name] || 'no_monthly_rate' });
            mergedRates[name] = newRate;
        });
        // Lớp đông "Môn (+N HS)" follows its base subject: the gap to the old
        // base rate is kept (48k/52k raised to 50k gives 50k/54k).
        const followers = [];
        changes.forEach(change => {
            const delta = newRate - Number(change.beforeRate);
            if (!(Number(change.beforeRate) > 0) || !delta) return;
            Object.keys(mergedRates).filter(name => studentCountOf(name, change.name)).forEach(name => {
                const beforeRate = Number(mergedRates[name]);
                if (!(beforeRate > 0) || !(beforeRate + delta > 0)) return;
                followers.push({ name, base: change.name, beforeRate, afterRate: beforeRate + delta, beforeSource: origins[name] || 'unchanged' });
                mergedRates[name] = beforeRate + delta;
            });
        });
        // Lớp ghép "E3+E4" is paid like its highest component. A saved combined
        // rate that matched the old highest component follows the raise
        // (38k/38k raised to 40k gives 40k); a different hand-set rate stays.
        const changedBefore = new Map(changes.map(change => [change.name, Number(change.beforeRate)]));
        Object.keys(mergedRates).filter(combinedName).forEach(name => {
            const parts = name.split('+').map(part => payrollName(part.trim())).filter(Boolean);
            if (parts.length < 2 || !parts.some(part => changedBefore.has(part))) return;
            const rateAt = (part, before) => Number(before && changedBefore.has(part) ? changedBefore.get(part) : mergedRates[part]) || 0;
            const oldMax = Math.max(...parts.map(part => rateAt(part, true)));
            const newMax = Math.max(...parts.map(part => rateAt(part, false)));
            const beforeRate = Number(mergedRates[name]);
            if (!(oldMax > 0) || newMax <= oldMax || beforeRate !== oldMax) return;
            const base = parts.find(part => rateAt(part, false) === newMax);
            followers.push({ name, base, beforeRate, afterRate: newMax, beforeSource: origins[name] || 'unchanged', combined: true });
            mergedRates[name] = newMax;
        });
        const selectedNames = new Set([...changes, ...followers].map(change => change.name));
        const preserved = Object.keys(mergedRates).filter(name => !selectedNames.has(name))
            .map(name => ({ name, rate: mergedRates[name], source: origins[name] || 'unchanged' }));
        const patch = { [target.key]: { ...copy(role), class_rates: mergedRates } };
        const clearedDrafts = [];
        if (clearedTarget) { patch.published = clearedTarget; clearedDrafts.push({ month: targetMonth, before: copy(targetDoc.published) }); }

        // Later months keep their own saved rates, so a saved lower rate for a
        // changed subject would override the raise; lift it (never lower, never
        // touch a saved 0). Months without one inherit the new rate already.
        const laterDocs = record(options.laterDocs) ? options.laterDocs : null;
        const carried = [];
        followingMonths(targetMonth, currentMonth).forEach(month => {
            if (!laterDocs || !own(laterDocs, month) || (laterDocs[month] !== null && !record(laterDocs[month]))) {
                fail('incomplete-history', `Chưa tải đủ đơn giá tháng ${month}. Hãy tải lại.`);
            }
            const doc = laterDocs[month];
            if (!doc) return;
            const later = roleFrom(doc, month, warnings);
            const rates = ratesFrom(later.data) || {};
            const lifted = [...changes, ...followers].filter(change => own(rates, change.name) && Number(rates[change.name]) > 0 && Number(rates[change.name]) < change.afterRate)
                .map(change => ({ name: change.name, beforeRate: Number(rates[change.name]), afterRate: change.afterRate }));
            const cleared = assertUncalculatedTarget(doc, options.getPayslipLifecycleState, month, true);
            if (!lifted.length && !cleared) return;
            const monthPatch = {};
            if (lifted.length) monthPatch[later.key] = { class_rates: Object.fromEntries(lifted.map(item => [item.name, item.afterRate])) };
            if (cleared) { monthPatch.published = cleared; clearedDrafts.push({ month, before: copy(doc.published) }); }
            carried.push({ month, lifted, patch: monthPatch });
        });
        return {
            staffId: String(staffId), targetMonth, effectiveFrom: targetMonth + '-01',
            effectiveRoleKey: target.key, mergedRates, changes, followers, preserved, sourceMonths, inheritedMonth, patch, warnings,
            backdated, carried, clearedDrafts,
            // Canonical comparison token, not a cryptographic hash. Service must
            // reread these sources inside its transaction, never trust the UI.
            sourceFingerprint: fingerprint({ staffId, targetMonth, salaryConfig: config, defaults: options.defaults,
                targetDoc: options.targetDoc, history: Object.fromEntries(sourceMonths.map(month => [month, options.history[month]])),
                catalog: options.catalog, group: options.group, selectedSubjectIds: ids, newRate, laterDocs })
        };
    }

    global.SalaryReviewApplication = { LOOKBACK_MONTHS, PAST_MONTHS, FUTURE_MONTHS, payrollName, shiftMonth, followingMonths, fingerprint, buildPreview };
    if (typeof module !== 'undefined' && module.exports) module.exports = global.SalaryReviewApplication;
})(typeof window !== 'undefined' ? window : globalThis);
