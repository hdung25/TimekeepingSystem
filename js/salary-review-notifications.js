// Dashboard reminder reads saved review profiles only. Never calculate payroll,
// scan attendance, fetch salary history, or approve a change from the dashboard.
(function (root) {
    'use strict';
    let loading = null;
    let lastAttemptedMonth = '';

    function summarize(profiles, settings, today, policy) {
        const duePeople = new Set(), setupPeople = new Set();
        let dueGroups = 0;
        (Array.isArray(profiles) ? profiles : []).forEach(profile => {
            const staffId = String(profile.staffId || profile.id || '');
            if (!staffId || profile.personOverrides?.enabled === false) return;
            const groups = Array.isArray(profile.groups) ? profile.groups : [];
            if (!groups.length) setupPeople.add(staffId);
            groups.forEach(group => {
                const effectiveFrom = group.scheduledChange?.effectiveFrom;
                if (policy.validDate(effectiveFrom) && effectiveFrom > today) return;
                const result = policy.evaluate(group, { complete: false, averageHours: null },
                    settings, today, profile.personOverrides || {});
                if (result.visibleThisMonth) { duePeople.add(staffId); dueGroups++; }
                if (result.state === 'setup') setupPeople.add(staffId);
            });
        });
        return { people: duePeople.size, groups: dueGroups, setup: setupPeople.size,
            empty: !Array.isArray(profiles) || profiles.length === 0 };
    }

    function show(container, title, detail, action, checkedDate = '') {
        // All text is generated locally from numeric counts, never raw profile HTML.
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">' +
            '<div style="flex:1;min-width:200px;"><p style="font-size:.73rem;font-weight:700;letter-spacing:.08em;color:var(--primary-color);margin:0 0 .35rem;">XÉT TĂNG LƯƠNG</p>' +
            '<h2 style="font-size:1.08rem;margin:0 0 .4rem;">' + title + '</h2>' +
            '<p style="font-size:.87rem;line-height:1.5;color:var(--text-muted);margin:0;">' + detail + '</p>' +
            (checkedDate ? '<small style="display:block;color:var(--text-muted);margin-top:.35rem;">Đối chiếu ngày ' + checkedDate.split('-').reverse().join('/') + '</small>' : '') + '</div>' +
            '<a class="btn btn-primary" style="white-space:nowrap;" href="xet-tang-luong.html">' + action + '</a></div>';
        container.hidden = false;
    }

    async function load(today) {
        const container = root.document.getElementById('salary-review-reminder');
        if (!container) return;
        container.hidden = true;
        let actor;
        try {
            if (typeof root.waitAuth === 'function' && !await root.waitAuth()) return;
            const service = typeof DBService !== 'undefined' ? DBService : root.DBService;
            actor = await service.getAuthenticatedAuthorizationContext();
            if (!actor?.roles?.includes('admin')) return;
            const queue = await root.SalaryReviewService.queue();
            if (root.auth?.currentUser?.uid !== actor.uid) return;
            const summary = summarize(queue.profiles, queue.config, today, root.SalaryReviewPolicy);
            const setupText = summary.setup ? ' ' + summary.setup + ' hồ sơ còn cần xác nhận mốc.' : '';
            if (summary.people) {
                show(container, summary.people + ' nhân viên cần xét trong tháng',
                    summary.groups + ' nhóm môn đến hạn hoặc quá hạn. Admin xem và quyết định mức tăng.' + setupText, 'Mở danh sách xét', today);
            } else if (summary.empty || summary.setup) {
                show(container, summary.setup ? summary.setup + ' hồ sơ cần xác nhận mốc' : 'Thiết lập mốc xét cho từng nhân viên',
                    'Xác nhận mốc và nhóm môn một lần để hệ thống nhắc đúng kỳ. Giá lương hiện có được giữ nguyên.', 'Chuẩn bị hồ sơ', today);
            } else {
                show(container, 'Chưa có hồ sơ đến hạn trong tháng',
                    'Theo các mốc đã lưu. Bạn vẫn có thể mở từng hồ sơ để xét riêng.', 'Xem hồ sơ', today);
            }
        } catch (error) {
            console.warn('[SalaryReviewReminder] Could not read review queue:', error?.code || 'READ_FAILED');
            if (actor?.roles?.includes('admin') && root.auth?.currentUser?.uid === actor.uid) {
                show(container, 'Chưa tải được danh sách xét lương',
                    'Mở hồ sơ để tải lại và kiểm tra các kỳ đến hạn.', 'Mở hồ sơ');
            }
        }
    }

    function init() {
        // At most one attempt per UTC+7 calendar month in this dashboard tab.
        // Failed reads also count as attempts; opening the review page is recovery.
        const today = root.SalaryReviewPolicy.dateKey();
        if (!root.SalaryReviewPolicy.validDate(today)) return Promise.resolve();
        if (loading) return loading;
        if (lastAttemptedMonth === today.slice(0, 7)) return Promise.resolve();
        lastAttemptedMonth = today.slice(0, 7);
        loading = load(today).finally(() => { loading = null; });
        return loading;
    }

    function resume() {
        if (root.document.visibilityState !== 'visible') return Promise.resolve();
        const month = root.SalaryReviewPolicy.dateKey().slice(0, 7);
        if (month === lastAttemptedMonth) return loading || Promise.resolve();
        // A September read may still be in flight when the app resumes in
        // October. Wait for it, then share exactly one October refresh.
        if (loading) return loading.then(resume);
        return init();
    }
    root.SalaryReviewNotifications = Object.freeze({ init, summarize });
    root.document.addEventListener('DOMContentLoaded', init, { once: true });
    root.document.addEventListener('visibilitychange', resume);
    root.addEventListener('pageshow', resume);
})(window);
