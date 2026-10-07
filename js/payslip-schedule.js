// payslip-schedule.js — giao diện "Hẹn giờ gửi" trong hộp Gửi bảng lương (bao-cao.html).
// Logic gửi nằm ở payslip-schedule-core.js (dùng chung với Cloud Function).
(function () {
    'use strict';
    const Core = window.PayslipScheduleCore;
    const pad = value => String(value).padStart(2, '0');
    const esc = value => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const formatTime = iso => {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '—';
        return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    const toInputValue = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    let currentMonth = '';
    let schedules = [];
    let running = false;

    function isPrimaryAdmin() {
        try {
            const raw = localStorage.getItem('currentRole') || '';
            const parsed = JSON.parse(raw);
            return (Array.isArray(parsed) ? parsed : [parsed]).includes('admin');
        } catch (_) {
            return String(localStorage.getItem('currentRole') || '') === 'admin';
        }
    }

    // Mặc định: 8:00 sáng ngày 10 của tháng kế tiếp tháng lương (lương tháng 9 → 10/10).
    function defaultRunAt(monthStr) {
        const [year, month] = String(monthStr).split('-').map(Number);
        const candidate = new Date(year, month, 10, 8, 0, 0, 0);
        if (candidate.getTime() > Date.now() + 5 * 60 * 1000) return candidate;
        const next = new Date(Date.now() + 60 * 60 * 1000);
        next.setMinutes(0, 0, 0);
        return next;
    }

    function ensurePanel() {
        let panel = document.getElementById('bulk-schedule-panel');
        if (panel) return panel;
        const footer = document.querySelector('#bulk-publish-modal .bulk-modal-footer');
        if (!footer) return null;
        panel = document.createElement('div');
        panel.id = 'bulk-schedule-panel';
        panel.style.cssText = 'padding:0.75rem 1.25rem;background:#F5F3FF;border-top:1px solid #DDD6FE;display:flex;flex-direction:column;gap:0.5rem;flex-shrink:0;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
                <strong style="font-size:0.85rem;color:#5B21B6;">Hẹn giờ gửi</strong>
                <input type="datetime-local" id="bulk-schedule-at" style="padding:0.45rem 0.6rem;border:1.5px solid #C4B5FD;border-radius:8px;font:inherit;font-size:0.88rem;background:#fff;">
                <button type="button" id="btn-bulk-schedule" style="padding:0.5rem 0.9rem;background:#6D28D9;color:#fff;border:none;border-radius:10px;font-weight:700;font-size:0.85rem;cursor:pointer;">Hẹn gửi các bạn đang tick</button>
                <span style="font-size:0.72rem;color:#6B7280;flex:1 1 260px;">Đến giờ hệ thống tự gửi bản tính đang lưu lúc đó (tính lại trước giờ hẹn vẫn được), kèm lời nhắn ở trên. Không cần mở máy.</span>
            </div>
            <div id="bulk-schedule-list" style="display:flex;flex-direction:column;gap:0.35rem;"></div>`;
        footer.parentNode.insertBefore(panel, footer);
        panel.querySelector('#btn-bulk-schedule').addEventListener('click', createSchedule);
        panel.querySelector('#bulk-schedule-list').addEventListener('click', event => {
            const button = event.target.closest('[data-cancel-schedule]');
            if (button) cancelSchedule(button.dataset.cancelSchedule);
        });
        return panel;
    }

    function selectedTargets() {
        const byId = new Map();
        document.querySelectorAll('#bulk-publish-modal .bulk-staff-checkbox:checked').forEach(box => {
            const staffId = box.dataset.id;
            const row = box.closest('.bulk-staff-row');
            const name = row?.querySelector('.bulk-staff-name')?.textContent?.trim() || '';
            const item = byId.get(staffId) || { staffId, name, gv: false, tt: false };
            if (box.dataset.group === 'receps') item.tt = true; else item.gv = true;
            byId.set(staffId, item);
        });
        return Core.normalizeTargets(Array.from(byId.values()));
    }

    function renderList() {
        const list = document.getElementById('bulk-schedule-list');
        if (!list) return;
        const pending = schedules.filter(item => item.status === 'scheduled' || item.status === 'running');
        const recent = schedules.filter(item => item.status === 'done' || item.status === 'failed').slice(0, 2);
        const rows = [...pending, ...recent].map(item => {
            const targets = Array.isArray(item.targets) ? item.targets : [];
            const gv = targets.filter(target => target.gv).length;
            const tt = targets.filter(target => target.tt).length;
            const who = `${gv} giáo viên · ${tt} tiếp tân`;
            if (item.status === 'scheduled' || item.status === 'running') {
                return `<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;font-size:0.8rem;background:#fff;border:1px solid #DDD6FE;border-radius:8px;padding:0.4rem 0.6rem;">
                    <span>⏰ <b>${esc(formatTime(item.runAt))}</b> · ${esc(who)}${item.status === 'running' ? ' · <b style="color:#B45309">đang gửi…</b>' : ''}</span>
                    <span style="color:#6B7280;flex:1;">Tạo bởi ${esc(item.createdByName || '')} lúc ${esc(formatTime(item.createdAt))}</span>
                    ${item.status === 'scheduled' ? `<button type="button" data-cancel-schedule="${esc(item.id)}" style="padding:0.3rem 0.7rem;border:1px solid #FCA5A5;color:#B91C1C;background:#FEF2F2;border-radius:8px;font-weight:700;cursor:pointer;">Hủy hẹn</button>` : ''}
                </div>`;
            }
            const result = item.result || {};
            const extra = [
                result.locked ? `${result.locked} phần đã nhận giữ nguyên` : '',
                result.skipped ? `${result.skipped} phần chưa tính nên bỏ qua${(result.skippedStaff || []).length ? ` (${esc(result.skippedStaff.slice(0, 8).join(', '))})` : ''}` : '',
                result.failed ? `<b style="color:#B91C1C">${result.failed} người lỗi: ${esc((result.failures || []).map(f => `${f.name || f.staffId} – ${f.error}`).slice(0, 5).join('; '))}</b>` : ''
            ].filter(Boolean).join(' · ');
            return `<div style="font-size:0.76rem;color:#4B5563;">✓ Lệnh hẹn ${esc(formatTime(item.runAt))} đã chạy lúc ${esc(formatTime(item.finishedAt))}: gửi ${result.published || 0} phần lương${extra ? ' · ' + extra : ''}.</div>`;
        });
        list.innerHTML = rows.join('') || '<div style="font-size:0.76rem;color:#9CA3AF;">Chưa có lệnh hẹn nào cho tháng này.</div>';
        markRows(pending);
    }

    function markRows(pending) {
        document.querySelectorAll('#bulk-publish-modal .bulk-schedule-badge').forEach(node => node.remove());
        pending.forEach(item => (item.targets || []).forEach(target => {
            [['teachers', target.gv], ['receps', target.tt]].forEach(([group, on]) => {
                if (!on) return;
                const box = Array.from(document.querySelectorAll(`#bulk-publish-modal .bulk-staff-checkbox.bulk-group-${group}`))
                    .find(node => node.dataset.id === target.staffId);
                const meta = box?.closest('.bulk-staff-row')?.querySelector('.bulk-staff-meta');
                if (!meta) return;
                const badge = document.createElement('span');
                badge.className = 'bulk-schedule-badge';
                badge.style.cssText = 'margin-left:6px;color:#6D28D9;font-weight:700;';
                badge.textContent = `⏰ hẹn gửi ${formatTime(item.runAt)}`;
                meta.appendChild(badge);
            });
        }));
    }

    async function loadSchedules(monthStr) {
        const snapshot = await db.collection(Core.COLLECTION).where('month', '==', monthStr).get();
        schedules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (Number(a.runAtMs) || 0) - (Number(b.runAtMs) || 0));
        schedules = [
            ...schedules.filter(item => item.status === 'scheduled' || item.status === 'running'),
            ...schedules.filter(item => item.status === 'done' || item.status === 'failed')
                .sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')))
        ];
    }

    async function renderPanel(monthStr) {
        if (!Core || !isPrimaryAdmin()) return;
        const panel = ensurePanel();
        if (!panel) return;
        if (currentMonth !== monthStr) {
            currentMonth = monthStr;
            panel.querySelector('#bulk-schedule-at').value = toInputValue(defaultRunAt(monthStr));
        }
        try {
            await runDueNow();
            await loadSchedules(monthStr);
            if (currentMonth === monthStr) renderList();
        } catch (error) {
            console.warn('[payslip-schedule] load failed', error);
            const list = document.getElementById('bulk-schedule-list');
            if (list) list.innerHTML = `<div style="font-size:0.76rem;color:#B91C1C;">Chưa tải được lệnh hẹn: ${esc(error.message)}</div>`;
        }
    }

    async function createSchedule() {
        if (!isPrimaryAdmin()) {
            UIService.toast('Chỉ Admin được hẹn giờ gửi bảng lương.', 'warning');
            return;
        }
        const monthStr = window.bulkPublishMonth || currentMonth;
        const targets = selectedTargets();
        if (!targets.length) {
            UIService.toast('Tick ít nhất 1 người ở khu "Cần gửi" để hẹn giờ gửi.', 'warning');
            return;
        }
        const input = document.getElementById('bulk-schedule-at');
        const runAt = new Date(input?.value || '');
        if (Number.isNaN(runAt.getTime()) || runAt.getTime() < Date.now() + 60 * 1000) {
            UIService.toast('Chọn giờ gửi ở tương lai (ít nhất 1 phút nữa).', 'warning');
            return;
        }
        if (runAt.getTime() > Date.now() + 120 * 24 * 60 * 60 * 1000) {
            UIService.toast('Chỉ hẹn trong vòng 120 ngày.', 'warning');
            return;
        }
        const gv = targets.filter(item => item.gv).length;
        const tt = targets.filter(item => item.tt).length;
        const message = String(document.getElementById('bulk-message-input')?.value || '').trim().slice(0, 500);
        const agreed = await UIService.confirm(
            `Hẹn gửi bảng lương tháng <b>${esc(monthStr.split('-').reverse().join('/'))}</b> lúc <b>${esc(formatTime(runAt.toISOString()))}</b> ` +
            `cho <b>${gv} giáo viên</b> và <b>${tt} tiếp tân</b>?<br><br>` +
            '• Nhân viên CHƯA thấy gì cho tới giờ hẹn.<br>' +
            '• Đến giờ hệ thống gửi bản tính đang lưu lúc đó — sửa/tính lại trước giờ hẹn vẫn được.<br>' +
            '• Có thể bấm <b>Hủy hẹn</b> trước giờ gửi.'
        );
        if (!agreed) return;
        try {
            await db.collection(Core.COLLECTION).add({
                month: monthStr,
                runAt: runAt.toISOString(),
                runAtMs: runAt.getTime(),
                status: 'scheduled',
                targets,
                message,
                createdById: localStorage.getItem('currentUserId') || '',
                createdByName: localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || '',
                createdByUid: firebase.auth().currentUser?.uid || '',
                createdAt: new Date().toISOString()
            });
            UIService.toast(`Đã hẹn gửi ${gv + tt} phần lương lúc ${formatTime(runAt.toISOString())}.`, 'success');
            await loadSchedules(monthStr);
            renderList();
        } catch (error) {
            UIService.toast('Không hẹn được: ' + error.message, 'error');
        }
    }

    async function cancelSchedule(id) {
        const item = schedules.find(entry => entry.id === id);
        if (!item) return;
        const agreed = await UIService.confirm(`Hủy lệnh hẹn gửi lúc <b>${esc(formatTime(item.runAt))}</b>? Bảng lương vẫn là bản nháp, chưa gửi cho ai.`);
        if (!agreed) return;
        try {
            const ref = db.collection(Core.COLLECTION).doc(id);
            await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);
                if (!snapshot.exists || snapshot.data().status !== 'scheduled') {
                    throw new Error('Lệnh này đã chạy hoặc đã được hủy.');
                }
                transaction.update(ref, {
                    status: 'cancelled',
                    cancelledAt: new Date().toISOString(),
                    cancelledByName: localStorage.getItem('userFullName') || ''
                });
            });
            UIService.toast('Đã hủy lệnh hẹn gửi.', 'success');
        } catch (error) {
            UIService.toast(error.message || 'Không hủy được lệnh hẹn.', 'error');
        }
        await loadSchedules(currentMonth);
        renderList();
    }

    // Dự phòng khi Cloud Function chưa chạy: máy Admin mở trang Lương sau giờ hẹn sẽ tự gửi.
    async function runDueNow() {
        if (running || !Core || !isPrimaryAdmin() || typeof _preparePayslipComponentPublish !== 'function') return [];
        running = true;
        try {
            const reports = await Core.runDueSchedules(db, {
                lifecycle: { preparePayslipComponentPublish: _preparePayslipComponentPublish },
                now: new Date(),
                serverTimestamp: () => firebase.firestore.FieldValue.serverTimestamp(),
                runner: 'admin-browser'
            });
            if (reports.length) {
                reports.forEach(report => DBService._invalidate?.(`all_monthly_salary_settings_${report.month}`));
                const sent = reports.reduce((sum, report) => sum + report.published, 0);
                UIService.toast(`Đã chạy lệnh hẹn gửi bảng lương: gửi ${sent} phần lương.`, 'success');
            }
            return reports;
        } catch (error) {
            console.warn('[payslip-schedule] run due failed', error);
            return [];
        } finally {
            running = false;
        }
    }

    function startBackgroundCheck() {
        if (!isPrimaryAdmin() || typeof firebase === 'undefined' || !firebase.auth) return;
        const unsubscribe = firebase.auth().onAuthStateChanged(user => {
            if (!user) return;
            unsubscribe();
            setTimeout(runDueNow, 6000);
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startBackgroundCheck);
    else startBackgroundCheck();

    window.PayslipSchedule = { renderPanel, runDueNow };
})();
