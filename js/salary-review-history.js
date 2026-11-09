/* Lịch sử tăng lương của 1 giáo viên (chỉ đọc).
   Nguồn chính là đơn giá Lương/Giờ đã lưu theo từng tháng (salary_settings_monthly):
   tháng nào đơn giá một lớp khác tháng trước = tháng đó bắt đầu áp dụng mức mới.
   Các quyết định trên trang Xét tăng lương (duyệt / chưa tăng / hẹn lại / hủy) được
   ghép vào để biết ngày duyệt và lý do. Module thuần, không ghi dữ liệu. */
(function (root) {
    'use strict';
    const text = value => String(value == null ? '' : value).trim();
    const positive = value => { const n = Number(value); return value !== null && value !== '' && Number.isFinite(n) && n > 0 ? n : null; };
    const monthOfDoc = doc => { const m = /^(\d{4}-\d{2})_/.exec(text(doc && doc.id)); return text(doc && (doc.month || doc.monthStr)) || (m ? m[1] : ''); };

    // Đơn giá giáo viên lưu trong tháng (bỏ phiếu lương đã gửi, bỏ mức 0 = chưa nhập).
    function monthRates(doc, role = 'giao_vien') {
        const legacy = role.replace('_', '-');
        const cfg = doc && (doc[role] && typeof doc[role] === 'object' ? doc[role] : doc[legacy]);
        const out = new Map();
        Object.entries((cfg && cfg.class_rates) || {}).forEach(([name, raw]) => {
            const rate = positive(raw && typeof raw === 'object' ? raw.rate : raw);
            const clean = text(name).replace(/\s+/g, ' ');
            if (clean && rate !== null) out.set(clean, rate);
        });
        return out;
    }

    // Trả về { firstMonth, start: [{name, rate}], changes: [{month, items:[{name, before, after}]}] (mới nhất trước) }.
    // Tháng không lưu một lớp = vẫn dùng giá tháng trước (giống bảng lương), không tính là đổi.
    function rateTimeline(docs, role, currentMonth = '') {
        const months = (docs || []).map(doc => ({ month: monthOfDoc(doc), rates: monthRates(doc, role) }))
            .filter(item => /^\d{4}-\d{2}$/.test(item.month) && item.rates.size)
            .sort((a, b) => a.month.localeCompare(b.month));
        if (!months.length) return { firstMonth: '', start: [], changes: [] };
        const last = new Map(months[0].rates);
        const changes = [];
        let current = null;
        months.slice(1).forEach(({ month, rates }) => {
            if (currentMonth && month > currentMonth && !current) current = new Map(last);
            const items = [];
            rates.forEach((rate, name) => {
                const before = last.has(name) ? last.get(name) : null;
                if (before !== rate) items.push({ name, before, after: rate });
                last.set(name, rate);
            });
            if (items.length) changes.push({ month, upcoming: !!currentMonth && month > currentMonth, items: items.sort((a, b) => a.name.localeCompare(b.name, 'vi')) });
        });
        return {
            firstMonth: months[0].month,
            start: [...months[0].rates].map(([name, rate]) => ({ name, rate })).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
            current: [...(current || last)].map(([name, rate]) => ({ name, rate })).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
            changes: changes.reverse()
        };
    }

    const KIND_LABEL = { approved: 'Duyệt tăng', cancelled: 'Hủy mức đã duyệt', not_increased: 'Chưa tăng', deferred: 'Hẹn xét lại' };
    // Quyết định trên trang Xét tăng lương, mới nhất trước.
    function decisions(historyDocs) {
        return (historyDocs || []).filter(doc => KIND_LABEL[doc && doc.kind]).map(doc => ({
            id: text(doc.id), kind: doc.kind, label: KIND_LABEL[doc.kind], date: text(doc.createdAt).slice(0, 10),
            createdAt: text(doc.createdAt), groupName: text(doc.groupName).replace(/ · [\d.]+ đ$/, ''),
            reason: text(doc.reason), targetMonth: text(doc.targetMonth), effectiveFrom: text(doc.effectiveFrom),
            newRate: positive(doc.newRate), nextReviewDate: text(doc.nextReviewDate), operationId: text(doc.operationId),
            changes: Array.isArray(doc.changes) ? doc.changes.map(c => ({ name: text(c.name), before: positive(c.beforeRate), after: positive(c.afterRate) ?? positive(doc.newRate) })) : []
        })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    // Gắn lần duyệt (ngày duyệt + lý do) vào tháng đổi giá tương ứng; lần duyệt đã bị hủy thì bỏ qua.
    function build(docs, historyDocs, role, currentMonth) {
        const timeline = rateTimeline(docs, role, currentMonth);
        const list = decisions(historyDocs);
        const cancelled = new Set(list.filter(d => d.kind === 'cancelled').map(d => d.operationId).filter(Boolean));
        const approvals = list.filter(d => d.kind === 'approved' && !cancelled.has(d.id) && !cancelled.has(d.operationId));
        const used = new Set();
        timeline.changes.forEach(change => {
            change.approvals = approvals.filter(a => a.targetMonth === change.month &&
                (!a.changes.length || a.changes.some(c => change.items.some(item => item.name.toLowerCase() === c.name.toLowerCase()))));
            change.approvals.forEach(a => used.add(a));
        });
        const others = list.filter(d => !used.has(d));
        return { ...timeline, decisions: list, others };
    }

    const api = Object.freeze({ monthRates, rateTimeline, decisions, build });
    root.SalaryReviewHistory = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
