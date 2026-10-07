/* Xét tăng lương TIẾP TÂN (chủ trung tâm 07–08/10/2026).
   Tiếp tân không chia nhóm môn: mỗi người MỘT dòng. Admin ghi sẵn ngày lên lương (và mức dự
   kiến, ghi chú). Đến ngày đó dòng hiện "Đến hạn" với 2 lựa chọn: Duyệt tăng, hoặc Chờ thêm
   1 tháng (tháng sau hỏi lại). Duyệt ghi đơn giá "Tiếp Tân (Ca Bình Thường)" (ca cố định tăng
   cùng số tiền) vào tháng áp dụng, như duyệt tăng của giáo viên: phiếu tiếp tân nháp tính
   theo giá cũ bị bỏ để tính lại, phiếu đã gửi thì phải thu hồi trước.
   Phần thuần (không Firestore) dùng cho test; phần service chạy trong transaction. */
(function (root) {
    'use strict';
    const COLLECTION = 'reception_salary_reviews';
    const NORMAL = 'Tiếp Tân (Ca Bình Thường)';
    const FIXED = 'Tiếp Tân (Ca Cố Định)';
    const PAST_MONTHS = 1, FUTURE_MONTHS = 3, HISTORY_LIMIT = 40, SOON_MONTHS = 2;
    const RECEPTION_ROLES = new Set(['receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff', 'tiep-tan', 'tiep_tan']);
    const text = (value, max = 2000) => String(value == null ? '' : value).trim().slice(0, max);
    const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
    const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));
    const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));

    function fail(message) { throw new Error(message); }

    function shiftMonth(month, offset) {
        const [year, number] = month.split('-').map(Number);
        const total = year * 12 + number - 1 + offset;
        return `${Math.floor(total / 12)}-${String(total % 12 + 1).padStart(2, '0')}`;
    }
    function addMonths(date, count) {
        const [year, month, day] = date.split('-').map(Number);
        const target = new Date(Date.UTC(year, month - 1 + count, 1));
        const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        target.setUTCDate(Math.min(day, last));
        return target.toISOString().slice(0, 10);
    }
    function followingMonths(targetMonth, currentMonth) {
        const months = [];
        for (let month = shiftMonth(targetMonth, 1); month <= shiftMonth(currentMonth, FUTURE_MONTHS); month = shiftMonth(month, 1)) months.push(month);
        return months;
    }

    function isReceptionist(user) {
        if (!user || user.active === false || user.isActive === false ||
            ['inactive', 'deleted', 'resigned', 'terminated'].includes(text(user.status).toLowerCase())) return false;
        const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role];
        return roles.some(role => RECEPTION_ROLES.has(text(role).toLowerCase()));
    }

    const roleKeyOf = doc => own(doc, 'tiep_tan') ? 'tiep_tan' : own(doc, 'tiep-tan') ? 'tiep-tan' : 'tiep_tan';
    const ratesOf = doc => {
        const role = doc && (doc.tiep_tan || doc['tiep-tan']);
        return record(role) && record(role.class_rates) ? role.class_rates : {};
    };
    const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

    // Giá đang hưởng: tháng gần nhất có lưu giá > 0, rồi tới cấu hình nhân sự (giống report.js).
    function currentRates(monthlyDocs, user, legacy) {
        const docs = (monthlyDocs || []).filter(Boolean).slice()
            .sort((a, b) => String(b.id || b.month || '').localeCompare(String(a.id || a.month || '')));
        let normal = null, fixed = null, month = '';
        for (const doc of docs) {
            const rates = ratesOf(doc);
            if (normal == null && positive(rates[NORMAL])) { normal = positive(rates[NORMAL]); month = String(doc.id || doc.month || '').slice(0, 7); }
            if (fixed == null && positive(rates[FIXED])) fixed = positive(rates[FIXED]);
            if (normal != null && fixed != null) break;
        }
        const config = record(user?.salary_config) ? user.salary_config : {};
        const legacyRates = record(legacy?.class_rates) ? legacy.class_rates : {};
        if (normal == null) normal = positive(legacyRates[NORMAL]) || positive(config.receptionist_normal_rate) || positive(legacy?.receptionist_normal_rate);
        if (fixed == null) fixed = positive(legacyRates[FIXED]) || positive(config.receptionist_fixed_rate) || positive(legacy?.receptionist_fixed_rate);
        return { normal, fixed, month };
    }

    function category(plan, today) {
        if (!plan || plan.enabled === false) return plan && plan.enabled === false ? 'disabled' : 'setup';
        if (!validDate(plan.dueDate)) return 'setup';
        if (plan.dueDate <= today) return 'due';
        return plan.dueDate < addMonths(today.slice(0, 7) + '-01', SOON_MONTHS + 1) ? 'soon' : 'later';
    }

    function buildRows({ users, plans, monthlyByStaff, legacyByStaff, today }) {
        const planOf = id => (plans || []).find(plan => String(plan.staffId || plan.id) === id) || null;
        return (users || []).filter(isReceptionist).map(user => {
            const staffId = text(user.id);
            const plan = planOf(staffId);
            const rates = currentRates((monthlyByStaff || {})[staffId], user, (legacyByStaff || {})[staffId]);
            const msnv = (text(user.username).match(/\d+$/) || [''])[0];
            return {
                staffId, key: 'tt|' + staffId, name: text(user.name || user.username || staffId), code: text(user.username).toUpperCase(), msnv,
                plan, revision: Number(plan?.revision || 0), currentRate: rates.normal, fixedRate: rates.fixed, rateMonth: rates.month,
                category: category(plan, today)
            };
        }).sort((a, b) => {
            const na = a.msnv ? parseInt(a.msnv, 10) : Infinity, nb = b.msnv ? parseInt(b.msnv, 10) : Infinity;
            return (na === nb ? 0 : na < nb ? -1 : 1) || a.name.localeCompare(b.name, 'vi');
        });
    }

    function matchesTab(row, tab) {
        if (tab === 'all') return true;
        if (tab === 'setup') return row.category === 'setup';
        return row.category === tab;
    }

    function defaultTargetMonth(plan, today) {
        const current = today.slice(0, 7);
        const wanted = validDate(plan?.dueDate) ? plan.dueDate.slice(0, 7) : shiftMonth(current, 1);
        if (wanted < shiftMonth(current, -PAST_MONTHS)) return current;
        if (wanted > shiftMonth(current, FUTURE_MONTHS)) return shiftMonth(current, FUTURE_MONTHS);
        return wanted;
    }

    // Phiếu tiếp tân của tháng: null = chưa tính; bản sao đã bỏ phần tiếp tân nháp; lỗi nếu đã gửi.
    function clearReceptionDraft(doc, month, lifecycle) {
        const label = `Tháng ${Number(month.slice(5))}/${month.slice(0, 4)}`;
        if (doc?.revisionDrafts && doc.revisionDrafts.tt != null) fail(label + ' đang có bản hiệu chỉnh tiếp tân. Xử lý ở Tính lương trước.');
        const published = doc?.published;
        if (!record(published) || !Object.keys(published).length) return null;
        const state = lifecycle(published);
        const role = text(published.role).toLowerCase();
        const receptionRole = ['tiep-tan', 'tiep_tan', 'receptionist'].includes(role);
        if (!state.has_tt && !(receptionRole && published.details != null) && published.details_tt == null) return null;
        if (state.locked_tt) fail(label + ' đã gửi phiếu lương tiếp tân. Thu hồi phiếu đó ở Gửi bảng lương rồi duyệt lại.');
        if (!state.explicit_tt && !receptionRole && role !== 'dual') fail(label + ' có bản lương kiểu cũ chưa rõ trạng thái. Mở Tính lương tháng đó để lưu lại trước.');
        const cleared = { ...published, details_tt: null };
        cleared.details = receptionRole ? null : (published.details_gv ?? null);
        return cleared;
    }

    // Toàn bộ thay đổi của một lần duyệt. Không ghi gì; service ghi trong transaction.
    function buildApproval(input) {
        const { targetMonth, currentMonth, history, targetDoc, laterDocs, defaults, user, lifecycle } = input;
        const newRate = Number(input.newRate);
        if (!Number.isSafeInteger(newRate) || newRate <= 0 || newRate > 10000000) fail('Nhập mức mới là số tiền đ/giờ, ví dụ 25000.');
        if (!validMonth(targetMonth) || targetMonth < shiftMonth(currentMonth, -PAST_MONTHS) || targetMonth > shiftMonth(currentMonth, FUTURE_MONTHS)) {
            fail(`Chỉ áp dụng từ tháng trước (${shiftMonth(currentMonth, -PAST_MONTHS)}) đến ${FUTURE_MONTHS} tháng tới.`);
        }
        if (typeof lifecycle !== 'function') fail('Chưa tải được trạng thái bảng lương. Hãy tải lại.');
        const key = roleKeyOf(targetDoc || {});
        const role = record(targetDoc?.[key]) ? copy(targetDoc[key]) : copy(record(defaults) ? defaults : {});
        const rates = record(role.class_rates) ? { ...role.class_rates } : {};
        const before = currentRates([...(history || []), { ...(targetDoc || {}), id: targetMonth }], user, defaults);
        const oldNormal = positive(rates[NORMAL]) || before.normal;
        const oldFixed = positive(rates[FIXED]) || before.fixed;
        if (oldNormal != null && newRate <= oldNormal) fail(`Mức mới phải cao hơn mức hiện tại ${oldNormal.toLocaleString('vi-VN')}đ.`);
        const delta = oldNormal != null ? newRate - oldNormal : 0;
        const newFixed = oldFixed != null && delta > 0 ? oldFixed + delta : null;
        rates[NORMAL] = newRate;
        if (newFixed != null) rates[FIXED] = newFixed;
        const patches = [];
        const clearedMonths = [];
        const targetPatch = { [key]: { ...role, class_rates: rates } };
        const clearedTarget = clearReceptionDraft(targetDoc, targetMonth, lifecycle);
        if (clearedTarget) { targetPatch.published = clearedTarget; clearedMonths.push(targetMonth); }
        patches.push({ month: targetMonth, data: targetPatch });
        const lifted = [];
        followingMonths(targetMonth, currentMonth).forEach(month => {
            const doc = laterDocs?.[month];
            if (!doc) return;
            const laterKey = roleKeyOf(doc);
            const laterRates = ratesOf(doc);
            const lift = {};
            if (positive(laterRates[NORMAL]) && laterRates[NORMAL] < newRate) lift[NORMAL] = newRate;
            if (newFixed != null && positive(laterRates[FIXED]) && laterRates[FIXED] < newFixed) lift[FIXED] = newFixed;
            // Tháng có giá riêng đã ≥ mức mới thì lương tháng đó không đổi: không đụng phiếu.
            const affected = !positive(laterRates[NORMAL]) || Object.keys(lift).length > 0;
            const cleared = affected ? clearReceptionDraft(doc, month, lifecycle) : null;
            if (!Object.keys(lift).length && !cleared) return;
            const data = {};
            if (Object.keys(lift).length) { data[laterKey] = { class_rates: lift }; lifted.push(month); }
            if (cleared) { data.published = cleared; clearedMonths.push(month); }
            patches.push({ month, data });
        });
        return { targetMonth, newRate, oldNormal, oldFixed, newFixed, patches, clearedMonths, lifted };
    }

    function pushHistory(plan, entry) {
        return [...(Array.isArray(plan?.history) ? plan.history : []), entry].slice(-HISTORY_LIMIT);
    }

    // ---------------- service (browser, firebase compat) ----------------
    const database = () => typeof db !== 'undefined' ? db : root.db;
    const dbService = () => typeof DBService !== 'undefined' ? DBService : root.DBService;
    const docRef = (collection, id) => database().collection(collection).doc(id);
    const todayKey = () => root.SalaryReviewPolicy ? root.SalaryReviewPolicy.dateKey() : new Date().toISOString().slice(0, 10);

    async function admin() {
        const auth = await dbService().getAuthenticatedAuthorizationContext(true);
        if (!auth.roles.includes('admin')) fail('Chỉ quản trị viên chính được xét tăng lương.');
        return auth;
    }
    async function loadPlans() {
        const snapshot = await database().collection(COLLECTION).get({ source: 'server' });
        return snapshot.docs.map(doc => ({ ...doc.data(), staffId: doc.id }));
    }
    function envelope(before, actor, staffId, staffName, fields, entry) {
        if (Number(before?.revision || 0) !== Number(fields.expectedRevision || 0)) fail('Hồ sơ vừa được sửa ở phiên khác. Bấm Tải lại rồi làm lại.');
        const at = new Date().toISOString();
        const next = {
            schemaVersion: 1, staffId, staffName: text(staffName, 300),
            enabled: before?.enabled !== false, plannedRate: before?.plannedRate ?? null, dueDate: before?.dueDate || '',
            note: before?.note || '', lastIncreaseDate: before?.lastIncreaseDate || '', currentRate: before?.currentRate ?? null,
            ...fields.changes,
            revision: Number(before?.revision || 0) + 1, updatedAt: at, updatedBy: actor.uid
        };
        next.history = pushHistory(before, { ...entry, at, byUid: actor.uid, byUserId: actor.userId || '' });
        return next;
    }
    async function savePlan(staffId, raw, expectedRevision) {
        const actor = await admin();
        const dueDate = text(raw.dueDate, 10);
        if (dueDate && !validDate(dueDate)) fail('Ngày lên lương không hợp lệ.');
        const plannedRate = raw.plannedRate === '' || raw.plannedRate == null ? null : Number(raw.plannedRate);
        if (plannedRate !== null && (!Number.isSafeInteger(plannedRate) || plannedRate <= 0 || plannedRate > 10000000)) fail('Mức dự kiến là số tiền đ/giờ, ví dụ 25000.');
        const changes = { dueDate, plannedRate, note: text(raw.note), enabled: raw.enabled !== false };
        const ref = docRef(COLLECTION, staffId), userRef = docRef('users', staffId);
        await database().runTransaction(async tx => {
            const [snap, userSnap] = await Promise.all([tx.get(ref), tx.get(userRef)]);
            if (!userSnap.exists) fail('Nhân viên không còn tồn tại.');
            const before = snap.exists ? snap.data() : null;
            tx.set(ref, envelope(before, actor, staffId, userSnap.data().name || staffId, { expectedRevision, changes },
                { kind: 'plan', dueDate, plannedRate, note: changes.note, enabled: changes.enabled }));
        });
    }
    async function snooze(staffId, expectedRevision) {
        const actor = await admin();
        const ref = docRef(COLLECTION, staffId), userRef = docRef('users', staffId);
        const dueDate = addMonths(todayKey(), 1);
        await database().runTransaction(async tx => {
            const [snap, userSnap] = await Promise.all([tx.get(ref), tx.get(userRef)]);
            if (!userSnap.exists) fail('Nhân viên không còn tồn tại.');
            const before = snap.exists ? snap.data() : null;
            tx.set(ref, envelope(before, actor, staffId, userSnap.data().name || staffId, { expectedRevision, changes: { dueDate } },
                { kind: 'snooze', fromDueDate: before?.dueDate || '', dueDate }));
        });
        return dueDate;
    }
    async function approve(staffId, command, expectedRevision) {
        const actor = await admin();
        const currentMonth = todayKey().slice(0, 7);
        const targetMonth = text(command.targetMonth, 7);
        if (!validMonth(targetMonth)) fail('Chọn tháng áp dụng.');
        const historyMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(targetMonth, -i - 1));
        const laterMonths = followingMonths(targetMonth, currentMonth);
        const ref = docRef(COLLECTION, staffId), userRef = docRef('users', staffId), legacyRef = docRef('salary_settings', staffId);
        const monthRef = month => docRef('salary_settings_monthly', month + '_' + staffId);
        let result = null;
        await database().runTransaction(async tx => {
            const refs = [ref, userRef, legacyRef, monthRef(targetMonth), ...historyMonths.map(monthRef), ...laterMonths.map(monthRef)];
            const snaps = await Promise.all(refs.map(item => tx.get(item)));
            const data = snaps.map(snap => snap.exists ? snap.data() : null);
            const [before, user, legacy, targetDoc] = data;
            if (!user || !isReceptionist(user)) fail('Nhân viên không còn là tiếp tân đang làm.');
            const history = historyMonths.map((month, i) => data[4 + i] ? { ...data[4 + i], id: month } : null).filter(Boolean);
            const laterDocs = Object.fromEntries(laterMonths.map((month, i) => [month, data[4 + historyMonths.length + i]]));
            const plan = buildApproval({ newRate: command.newRate, targetMonth, currentMonth, history, targetDoc, laterDocs,
                defaults: legacy, user, lifecycle: dbService().getPayslipLifecycleState });
            plan.patches.forEach(patch => tx.set(monthRef(patch.month), patch.data, { merge: true }));
            tx.set(ref, envelope(before, actor, staffId, user.name || staffId, { expectedRevision, changes: {
                currentRate: plan.newRate, plannedRate: null, dueDate: '', lastIncreaseDate: targetMonth + '-01'
            } }, { kind: 'approved', targetMonth, beforeRate: plan.oldNormal, afterRate: plan.newRate, beforeFixed: plan.oldFixed,
                afterFixed: plan.newFixed, clearedMonths: plan.clearedMonths, liftedMonths: plan.lifted, note: text(command.note) }));
            result = plan;
        });
        [targetMonth, ...laterMonths].forEach(month => dbService()._invalidate?.(`all_monthly_salary_settings_${month}`));
        return result;
    }

    const api = { COLLECTION, NORMAL, FIXED, PAST_MONTHS, FUTURE_MONTHS, isReceptionist, currentRates, category, buildRows, matchesTab,
        defaultTargetMonth, buildApproval, clearReceptionDraft, addMonths, shiftMonth, loadPlans, savePlan, snooze, approve };
    root.ReceptionSalaryReview = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
