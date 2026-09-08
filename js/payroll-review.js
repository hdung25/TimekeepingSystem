// Read-only reconciliation uses the report's complete month, never its display filter.
(() => {
    'use strict';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = value => Number(value || 0).toLocaleString('vi-VN') + ' đ';
    const minutes = value => `${Math.floor(Number(value || 0) / 60)} giờ ${Math.round(Number(value || 0) % 60)} phút`;
    let lastScope = '';
    let refreshPending = false;

    function context() {
        const staffId = getTargetStaffId();
        const month = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        return { staffId, month, scope: `${staffId}__${month}`, user: window.currentUserContext || {}, admin: isPrimaryPayrollAdminViewer() };
    }
    function componentDetails(published, component) {
        return published?.[`details_${component}`] || (published?.role !== 'dual' &&
            ((component === 'tt') === ['tiep-tan', 'tiep_tan', 'receptionist'].includes(published?.role)) ? published?.details : null);
    }
    function scheduleUrl(kind, date, branch, staffId) {
        const page = kind === 'office' ? 'lich-van-phong.html' : kind === 'receptionist' ? 'lich-tiep-tan.html' : 'lich-lam.html';
        return page + '?' + new URLSearchParams({ date, branch, staffId });
    }
    function focusDate(date) {
        const cell = document.getElementById('calendar-cell-' + date);
        if (cell) {
            cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.querySelectorAll('.focused-calendar-day').forEach(el => el.classList.remove('focused-calendar-day'));
            cell.classList.add('focused-calendar-day');
        } else UIService.toast('Ngày này đang bị bộ lọc ẩn. Chọn “Tất cả” để xem và sửa chip.', 'info');
    }
    function renderRows(container) {
        const ctx = context();
        if (window.payrollReadyScope !== ctx.scope) return;
        const chips = window.unfilteredAllMonthChips || [];
        container.innerHTML = `<div style="overflow:auto;max-height:340px"><table style="width:100%;font-size:.85rem"><thead><tr><th>Ngày / ca</th><th>Giờ tính công</th><th>Đối chiếu</th></tr></thead><tbody>${chips.map((chip, index) => {
            const label = document.createElement('span'); label.innerHTML = chip.text || '';
            const kind = chip.isOffice || chip.sessionData?.linkedOfficeShift ? 'office' : chip.isReceptionist ? 'receptionist' : 'teaching';
            const branch = chip.branch || chip.classData?.branch || String(chip.classCompositeKey || '').split('__')[0] || 'cs1';
            return `<tr><td>${esc(chip.dateStr)} · ${esc(label.textContent)}</td><td>${minutes(chip.paidMinutes)}${chip.isCenterOff ? ' · Lớp nghỉ' : ''}</td><td><button type="button" class="btn btn-secondary" data-review-day="${index}">Xem/sửa công</button> <a target="_blank" rel="noopener" href="${esc(scheduleUrl(kind, chip.dateStr, branch, ctx.staffId))}">Lịch gốc ↗</a></td></tr>`;
        }).join('')}</tbody></table></div>`;
        container.querySelectorAll('[data-review-day]').forEach(btn => btn.addEventListener('click', () => focusDate(chips[Number(btn.dataset.reviewDay)].dateStr)));
    }

    function refresh() {
        const roles = getReportViewerRoles();
        if (!roles.some(role => ['admin', 'senior_assistant'].includes(role))) return;
        const ctx = context();
        const controls = document.getElementById('admin-controls');
        if (!controls) return;
        let panel = document.getElementById('payroll-review-panel');
        if (!panel) {
            panel = document.createElement('section'); panel.id = 'payroll-review-panel';
            panel.style.cssText = 'background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:14px;margin:12px 0;display:grid;gap:10px';
            controls.insertAdjacentElement('afterend', panel);
        }
        const ready = !window.payrollSourceChanged && window.payrollReadyScope === ctx.scope;
        const previousDate = panel.querySelector('#review-date')?.value;
        const previousBranch = panel.querySelector('#review-branch')?.value || 'cs1';
        const date = lastScope === ctx.scope && previousDate ? previousDate : `${ctx.month}-01`;
        lastScope = ctx.scope;
        panel.innerHTML = `<strong>Đối chiếu công & lịch · ${esc(ctx.user.name || '')} · ${esc(ctx.month)}</strong>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                <label>Ngày <input id="review-date" type="date" value="${esc(date)}" aria-label="Ngày đối chiếu lịch"></label>
                <label>Cơ sở <select id="review-branch" aria-label="Cơ sở đối chiếu"><option value="cs1">CS1</option><option value="cs2">CS2</option><option value="cs3">CS3</option></select></label>
                <span id="review-links" style="display:flex;flex-wrap:wrap;gap:10px"></span>
                <button id="review-refresh" type="button" class="btn btn-secondary" ${refreshPending ? 'disabled' : ''}>${refreshPending ? 'Đang tải…' : 'Tải lại công/lương'}</button>
            </div><small>Đối chiếu toàn tháng, không bị giới hạn bởi bộ lọc hiển thị. Mở lịch ở tab riêng để giữ bảng lương đang làm.</small>
            <details id="review-shifts"><summary style="cursor:pointer">${ready ? 'Xem từng ca và số phút được tính' : window.payrollSourceChanged ? 'Lịch/công đã thay đổi — cần tải lại trước khi tính/gửi' : 'Đang tải đủ dữ liệu…'}</summary><div id="review-shift-rows"></div></details>
            <div id="review-payroll-snapshots"></div>`;
        panel.querySelector('#review-branch').value = previousBranch;
        const updateLinks = () => {
            const day = panel.querySelector('#review-date').value;
            const branch = panel.querySelector('#review-branch').value;
            panel.querySelector('#review-links').innerHTML = [['teaching', 'Lịch dạy'], ['receptionist', 'Lịch tiếp tân'], ['office', 'Lịch văn phòng']].map(([kind, label]) =>
                `<a target="_blank" rel="noopener" href="${esc(scheduleUrl(kind, day || date, branch, ctx.staffId))}">${label} ↗</a>`).join('');
        };
        updateLinks();
        panel.querySelector('#review-date').addEventListener('change', updateLinks);
        panel.querySelector('#review-branch').addEventListener('change', updateLinks);
        panel.querySelector('#review-shifts').addEventListener('toggle', event => {
            if (event.target.open) renderRows(panel.querySelector('#review-shift-rows'));
        });
        panel.querySelector('#review-refresh').addEventListener('click', async () => {
            if (refreshPending || payrollWritePending) return;
            refreshPending = true; refresh();
            try { await renderMonthReport(new Date(currentDate), true); }
            finally { refreshPending = false; refresh(); }
        });
        if (!ctx.admin || !ready) return;
        const monthly = window.currentMonthlySalarySettingsAll || {};
        const published = monthly.published || {};
        const lifecycle = DBService.getPayslipLifecycleState(published);
        const rows = [];
        for (const component of ['gv', 'tt']) {
            const saved = componentDetails(published, component);
            const draft = monthly.revisionDrafts?.[component];
            if (!saved && !draft) continue;
            const label = component === 'gv' ? 'Giáo viên' : (saved?.operationalLabel || 'Tiếp tân / Văn phòng');
            const state = lifecycle[`status_${component}`];
            rows.push(`<div style="border-top:1px solid #BBF7D0;padding-top:8px"><b>${esc(label)}</b> · ${state === 'received' ? 'Đã xác nhận' : state === 'published' ? 'Đã gửi' : 'Bản tính chưa gửi'}: <b>${money(saved?.netPay)}</b>
                <button type="button" class="btn btn-secondary" data-review-print="${component}">Xem/in bản đã lưu</button>
                ${draft ? `<div>Bản hiệu chỉnh đã tính: <b>${money(componentDetails(draft.payload, component)?.netPay)}</b> · chưa gửi <button type="button" class="btn btn-primary" data-review-revise="${component}">Đối chiếu & gửi hiệu chỉnh</button></div>` : ''}</div>`);
        }
        panel.querySelector('#review-payroll-snapshots').innerHTML = rows.join('') +
            '<details id="review-history"><summary style="cursor:pointer">Lịch sử hiệu chỉnh bảng lương</summary><div id="review-history-content"></div></details>';
        panel.querySelectorAll('[data-review-print]').forEach(btn => btn.addEventListener('click', () => printSaved(btn.dataset.reviewPrint)));
        panel.querySelectorAll('[data-review-revise]').forEach(btn => btn.addEventListener('click', () => revise(btn.dataset.reviewRevise)));
        panel.querySelector('#review-history').addEventListener('toggle', async event => {
            if (!event.target.open) return;
            const output = panel.querySelector('#review-history-content');
            output.textContent = 'Đang tải lịch sử…';
            try {
                const records = await window.db.collection('salary_settings_monthly').doc(`${ctx.month}_${ctx.staffId}`)
                    .collection('revisions').orderBy('createdAt', 'desc').limit(20).get({ source: 'server' });
                if (context().scope !== ctx.scope || !output.isConnected) return;
                output.innerHTML = records.empty ? 'Chưa có lần gửi hiệu chỉnh nào.' : records.docs.map(doc => {
                    const entry = doc.data();
                    return `<p>${esc(entry.createdAt)} · ${entry.component === 'tt' ? 'Tiếp tân / VP' : 'Giáo viên'} · ${money(componentDetails(entry.before, entry.component)?.netPay)} → ${money(componentDetails(entry.after, entry.component)?.netPay)}<br>${esc(entry.reason)}</p>`;
                }).join('');
            } catch (_) { output.textContent = 'Chưa tải được lịch sử. Đóng rồi mở lại để thử lại.'; }
        });
    }

    async function revise(component) {
        if (!requirePayrollAdmin() || payrollWritePending || !requireCompletePayrollReport()) return;
        const ctx = context();
        const monthly = window.currentMonthlySalarySettingsAll || {};
        const draft = monthly.revisionDrafts?.[component];
        if (!draft) return;
        const before = componentDetails(monthly.published, component);
        const after = componentDetails(draft.payload, component);
        const reason = window.prompt(`Hiệu chỉnh ${ctx.user.name} – ${ctx.month}\nBản đang gửi: ${money(before?.netPay)}\nBản mới: ${money(after?.netPay)}\nBản cũ được lưu lịch sử. Nhân viên cần xác nhận lại phần được hiệu chỉnh.\nNhập lý do:`);
        if (!reason?.trim() || context().scope !== ctx.scope) return;
        const finish = beginPayrollWrite();
        if (!finish) return;
        try {
            await DBService.publishPayslipRevision(ctx.staffId, ctx.month, component, draft.sourceToken, draft.version, reason);
            await loadSalarySettings();
            UIService.toast('Đã gửi bản hiệu chỉnh, lưu lịch sử bản cũ và yêu cầu xác nhận lại đúng phần lương.', 'success');
        } catch (error) { UIService.toast(error.message, 'error'); }
        finally { finish(); }
    }

    async function printSaved(component) {
        if (!requirePayrollAdmin() || !requireCompletePayrollReport()) return;
        const ctx = context();
        const popup = window.open('', '_blank');
        if (!popup) { UIService.toast('Trình duyệt đang chặn cửa sổ in. Cho phép cửa sổ bật lên rồi thử lại.', 'warning'); return; }
        popup.opener = null;
        popup.document.body.textContent = 'Đang tải bản lương đã lưu từ máy chủ…';
        try {
            const saved = await DBService.getMonthlySalarySettings(ctx.staffId, ctx.month, { strict: true });
            const published = saved.published;
            const details = componentDetails(published, component);
            if (!details || !window.buildSavedPayslipHtml) throw new Error('Chưa có bản tính đã lưu. Bấm “Lưu & Tính” trước khi xuất; thay đổi chưa lưu không được đưa vào file.');
            if (popup.closed) return;
            const status = DBService.getPayslipLifecycleState(published)[`status_${component}`];
            popup.document.open();
            popup.document.write(window.buildSavedPayslipHtml({ monthStr: ctx.month, staffName: details.staffName || ctx.user.name, account: details.employeeId || ctx.user.username,
                roleLabel: component === 'gv' ? 'Giáo Viên' : (details.operationalLabel || 'Tiếp Tân'), status, details, message: published.message }));
            popup.document.close();
            popup.focus();
            UIService.toast('Đang xem đúng bản đã lưu/gửi. Dùng Ctrl+P hoặc In để lưu PDF; thay đổi chưa lưu không nằm trong file.', 'info');
        } catch (error) {
            if (!popup.closed) popup.document.body.textContent = error.message;
            UIService.toast(error.message, 'error');
        }
    }
    function addModalLink() {
        const ctx = context();
        const content = document.querySelector('#class-rate-modal .modal-content');
        if (!content) return;
        let link = document.getElementById('salary-modal-review-link');
        if (!link) {
            link = document.createElement('a'); link.id = 'salary-modal-review-link';
            link.target = '_blank'; link.rel = 'noopener';
            link.style.cssText = 'display:block;padding:10px 16px;background:#F0FDF4;color:#047857;font-weight:600';
            content.prepend(link);
        }
        link.textContent = `Mở công & lịch của ${ctx.user.name || 'nhân viên'} ở tab riêng ↗`;
        link.href = 'bao-cao.html?' + new URLSearchParams({ staffId: ctx.staffId, date: ctx.month + '-01' }) + '#payroll-review-panel';
    }
    window.PayrollReview = { refresh, printSaved, scheduleUrl, addModalLink };
})();
