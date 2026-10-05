/* Live teacher attendance calculation; persisted only by the normal salary save. */
(function (global) {
    'use strict';
    const api = global.TeacherAttendancePolicy;
    const editors = { main: null, modal: null };
    const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const source = () => api.sourceFromChips(global.unfilteredAllMonthChips || [], chip => classifyAbsentChip(chip, _cachedStaffNotes));
    const mode = () => global.currentUserContext?.teachingMode;
    const currentEditor = context => editors[context]?.scope === global.currentReportScope ? editors[context] : null;
    // New-mode criteria filled by "Bảng cơ cấu lương 1": I, II, III, VI, X.
    const NEW_IDS = [0, 1, 2, 5, 9];
    const AUTO_NOTE = 'Tự động CCL1:';
    const REPORT_OPTIONS = [['full', 'Đầy đủ ngay sau buổi dạy — 2.000đ/giờ'], ['late', 'Chậm nhưng bổ sung trong 5 ngày — 1.000đ/giờ'],
        ['none', 'Chưa đạt — 0đ'], ['missing', 'Hoàn toàn không nhận xét cả tháng — cắt toàn bộ thưởng']];
    function savedNewInput(settings = {}) {
        const saved = settings.newModePolicy || {};
        return { trial: saved.trial === true, focus: saved.focus === 'fail' ? 'fail' : 'pass',
            report: REPORT_OPTIONS.some(([key]) => key === saved.report) ? saved.report : 'full' };
    }
    function meetingFor(context) {
        const summary = context === 'modal' ? (global.modalMeetingPayrollSummary ?? global.currentMeetingPayrollSummary) : global.currentMeetingPayrollSummary;
        if (!summary || summary.complete !== true) return null;
        const state = api.meetingStateFromStatuses(summary.statuses);
        const history = global.currentMeetingHistory;
        const known = !!history && history.scope === global.currentReportScope;
        return { state, streakCut: known && api.meetingStreakCut(state, history.states), historyKnown: known && history.complete === true };
    }
    function newModeResult(settings = {}, context = '') {
        if (mode() !== 'new') return null;
        const editor = currentEditor(context);
        const input = editor?.settings === settings && editor.newInput ? editor.newInput : savedNewInput(settings);
        try { return { input, meeting: meetingFor(context), ...api.newModeRows(source(), { ...input, meeting: meetingFor(context) }) }; }
        catch (_) { return null; }
    }
    function getRow(settings = {}, context = '', strict = false) {
        if (!['old','new'].includes(mode())) return null;
        if (mode() === 'new') {
            const result = newModeResult(settings, context);
            if (!result && strict) throw new Error('Chưa tính được thưởng chế độ mới. Tải lại bảng công.');
            return result ? result.rows.find(row => row.id === 0) : null;
        }
        try { return api.automaticAttendance('old', source(), null); }
        catch (error) { if (strict) throw error; return null; }
    }
    // Automatic rows besides criterion I (new mode: II, III, VI, X).
    function getPolicyRows(settings = {}, context = '') {
        const result = newModeResult(settings, context);
        return result ? result.rows.filter(row => row.id !== 0) : [];
    }
    function getHoursBonusRow(settings = {}) {
        if (mode() !== 'old') return null;
        const saved = (settings.evaluation || []).find(item => Number(item.id) === 8);
        if (saved?.manual === true) return null;
        return api.automaticHoursBonus(mode(), source(), settings);
    }
    function writeRow(prefix, row, writeNote) {
        const input = document.querySelector('.' + prefix + 'eval-amount[data-index="' + row.id + '"]');
        if (input) { input.readOnly = true; input.value = formatNumberWithCommas(row.amount); input.dataset.manualEdited = 'false'; input.style.background = '#F3F4F6'; }
        const note = document.querySelector('.' + prefix + 'eval-note[data-index="' + row.id + '"]');
        if (writeNote && note && (!note.value || note.value.startsWith(AUTO_NOTE) || note.value.startsWith('Vắng phép:') || note.value.startsWith('Trễ:'))) note.value = row.note;
    }
    function sync(context) {
        const editor = currentEditor(context);
        if (!editor) return;
        const prefix = context === 'modal' ? 'modal-' : '';
        if (mode() === 'new') return syncNew(context, editor, prefix);
        const row = getRow(editor.settings, context);
        const input = document.querySelector('.' + prefix + 'eval-amount[data-index="0"]');
        if (input) {
            input.readOnly = !!row;
            if (row) { input.value = formatNumberWithCommas(row.amount); input.dataset.manualEdited = 'false'; }
        }
        const hoursRow = getHoursBonusRow(editor.settings);
        const savedHours = (editor.settings.evaluation || []).find(item => Number(item.id) === 8);
        const hoursInput = document.querySelector('.' + prefix + 'eval-amount[data-index="8"]');
        if (hoursInput) {
            hoursInput.readOnly = !!hoursRow;
            if (hoursRow) {
                hoursInput.value = formatNumberWithCommas(hoursRow.amount);
                hoursInput.dataset.manualEdited = 'false';
            } else if (mode() === 'old' && savedHours?.manual !== true && savedHours) {
                // An explicitly disabled automatic policy must not leave a stale IX amount.
                hoursInput.value = '0';
                hoursInput.dataset.manualEdited = 'false';
            }
        }
        const hoursNote = document.querySelector('.' + prefix + 'eval-note[data-index="8"]');
        if (hoursNote && hoursRow && (!hoursNote.value || hoursNote.value.startsWith('Thưởng tổng giờ tự động:'))) {
            hoursNote.value = hoursRow.note;
        }
        const panel = document.getElementById(context === 'modal' ? 'teacher-policy-editor' : 'teacher-policy-main');
        if (!panel) return;
        const stats = source();
        const display = panel.querySelector('[data-attendance-result]');
        display.textContent = row ? row.note + ' Thành tiền: ' + formatNumberWithCommas(row.amount) + 'đ.' : 'Phân loại chế độ giáo viên tại Nhân sự.';
        panel.querySelector('[data-attendance-hours]').textContent = (stats.minutes / 60).toLocaleString('vi-VN', {maximumFractionDigits:4}) + ' giờ dạy; VP ' + stats.vp + ', VĐX ' + stats.vdx + ', VKP ' + stats.vkp + ', chưa cập nhật ' + stats.unreported + '.';
        const hoursDisplay = panel.querySelector('[data-hours-bonus-result]');
        if (hoursDisplay) {
            hoursDisplay.textContent = hoursRow
                ? hoursRow.note + ' Thành tiền: ' + formatNumberWithCommas(hoursRow.amount) + 'đ.'
                : savedHours?.manual === true
                    ? 'Tiêu chí IX đang giữ số tiền Admin nhập thủ công.'
                    : 'Tiêu chí IX không áp dụng theo cấu hình tháng này.';
        }
    }
    function syncNew(context, editor, prefix) {
        const result = newModeResult(editor.settings, context);
        const panel = document.getElementById(context === 'modal' ? 'teacher-policy-editor' : 'teacher-policy-main');
        if (result) result.rows.forEach(row => writeRow(prefix, row, true));
        if (!panel) return;
        const stats = source();
        panel.querySelector('[data-attendance-hours]').textContent = (stats.minutes / 60).toLocaleString('vi-VN', {maximumFractionDigits:2}) +
            ' giờ dạy · VP ' + stats.vp + ', VĐX ' + stats.vdx + ', VKP ' + stats.vkp + ', chưa cập nhật ' + stats.unreported +
            ' · đi trễ ' + (stats.lateCount || 0) + ' lần, ' + (stats.lateMinutes || 0) + ' phút.';
        const out = panel.querySelector('[data-new-result]');
        if (!result) { out.innerHTML = '<p style="color:#b91c1c;margin:0">Chưa tính được. Tải lại bảng công.</p>'; return; }
        const labels = { 0: 'I. Chuyên cần', 1: 'II. Đúng giờ', 2: 'III. Tập trung', 5: 'VI. Nhận xét lớp', 9: 'X. Họp định kỳ' };
        const total = result.rows.reduce((sum, row) => sum + row.amount, 0);
        const meetingNote = !result.meeting ? '<div style="color:#9a3412">X. Họp: chưa đủ dữ liệu điểm danh tháng này, nhập tay nếu cần.</div>'
            : !result.meeting.historyKnown ? '<div style="color:#9a3412">Chưa kiểm tra được chuỗi vắng họp 3 tháng (thiếu dữ liệu tháng trước).</div>' : '';
        out.innerHTML = (result.cut.length ? `<div style="padding:6px 8px;margin-bottom:6px;border-radius:6px;background:#fef2f2;color:#b91c1c;font-weight:600">Cắt toàn bộ thưởng: ${esc(result.cut.join('; '))}</div>` : '') +
            '<table style="width:100%;border-collapse:collapse;font-size:.8rem">' + result.rows.map(row =>
                `<tr><td style="padding:3px 0;font-weight:600;width:130px">${labels[row.id]}</td><td style="padding:3px 6px;color:#475569">${esc(row.note.replace(AUTO_NOTE + ' ', ''))}</td><td style="padding:3px 0;text-align:right;font-weight:700;white-space:nowrap">${formatNumberWithCommas(row.amount)}đ</td></tr>`).join('') +
            `<tr><td colspan="2" style="padding:4px 0;border-top:1px solid #cbd5e1;font-weight:700">Tổng thưởng tự động</td><td style="padding:4px 0;border-top:1px solid #cbd5e1;text-align:right;font-weight:800;color:#047857">${formatNumberWithCommas(total)}đ</td></tr></table>` + meetingNote;
    }
    function newPanelHtml(context, input, admin) {
        const id = name => 'teacher-policy-' + (context === 'modal' ? '' : 'main-') + name;
        const dis = admin ? '' : 'disabled';
        return '<strong>Thưởng chế độ mới — Bảng cơ cấu lương 1 (tự động)</strong><p data-attendance-hours style="margin:.3rem 0;font-size:.82rem;color:#475569"></p>' +
            '<div style="display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:flex-end;margin:.4rem 0 .6rem;font-size:.8rem">' +
            `<label style="display:flex;flex-direction:column;gap:3px;font-weight:600">III. Tập trung làm việc<select id="${id('focus')}" data-new-input="focus" ${dis} style="padding:5px;border-radius:6px"><option value="pass" ${input.focus === 'pass' ? 'selected' : ''}>Không làm việc riêng — 2.000đ/giờ</option><option value="fail" ${input.focus === 'fail' ? 'selected' : ''}>Bị phát hiện làm việc riêng — 0đ</option></select></label>` +
            `<label style="display:flex;flex-direction:column;gap:3px;font-weight:600">VI. Nhận xét lớp<select id="${id('report')}" data-new-input="report" ${dis} style="padding:5px;border-radius:6px">${REPORT_OPTIONS.map(([key, label]) => `<option value="${key}" ${input.report === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>` +
            `<label style="display:flex;align-items:center;gap:6px;font-weight:600;padding-bottom:5px"><input type="checkbox" id="${id('trial')}" data-new-input="trial" ${input.trial ? 'checked' : ''} ${dis}> Đang thử việc (không thưởng)</label></div>` +
            '<div data-new-result></div>' +
            '<small style="display:block;margin-top:.4rem;color:#64748b">I: không nghỉ 4.000 · nghỉ báo trước ≥24h 2.000 · báo trễ <24h 1.000 · không phép 0. II: không trễ 2.000 · trễ ít (≤1/9 giờ làm và <5,5% số ca 90 phút) 1.000. X: họp đủ 3.000 · vắng có phép 1.000 · không phép 0; vắng họp 3 tháng liên tiếp cắt toàn bộ thưởng. Mọi mức nhân tổng giờ dạy. Lưu cùng bảng lương khi bấm Lưu & Tính.</small>';
    }
    function mountFor(context, settings = {}) {
        const id = context === 'modal' ? 'teacher-policy-editor' : 'teacher-policy-main';
        document.getElementById(id)?.remove(); editors[context] = null;
        const role = context === 'modal' ? global.modalActiveRole : global.currentLoadedRoleKey;
        if (!['giao-vien','giao_vien'].includes(role) || !['old','new'].includes(mode())) return;
        const target = context === 'modal' ? document.getElementById('modal-eval-table-body')?.closest('table')?.parentElement : document.getElementById('evaluation-table-body')?.closest('table');
        if (!target) return;
        const raw = localStorage.getItem('currentRole') || 'staff';
        let roles; try { roles=JSON.parse(raw); } catch (_) { roles=[raw]; }
        const admin = (Array.isArray(roles)?roles:[roles]).includes('admin');
        const newInput = savedNewInput(settings);
        editors[context] = { settings, newInput: { ...newInput }, dirty:false, scope:global.currentReportScope };
        const panel = document.createElement('section'); panel.id=id;
        panel.style.cssText='padding:12px 16px;margin:12px 0;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc';
        panel.innerHTML = mode() === 'new' ? newPanelHtml(context, newInput, admin)
            : '<strong>Chuyên cần chế độ cũ — tự động</strong><p data-attendance-hours></p><p data-attendance-result></p>' +
            '<p data-hours-bonus-result style="margin:.5rem 0 0;padding:.5rem;background:#ecfdf5;border-radius:6px"></p>' +
            '<small>Tự cập nhật theo công và lịch của tháng. Mốc IX: từ 50 giờ 1.000đ/giờ, từ 65 giờ 2.000đ/giờ, trên 80 giờ 3.000đ/giờ. Lưu cùng bảng lương khi bấm Lưu & Tính. Bảng đã gửi được giữ nguyên đến khi gửi hiệu chỉnh.</small>';
        target.before(panel);
        panel.addEventListener('change', event => {
            const field = event.target.dataset.newInput, editor = currentEditor(context);
            if (!field || !admin || !editor || global.__payrollWritePending) return;
            editor.newInput[field] = field === 'trial' ? event.target.checked : event.target.value;
            editor.dirty = true; sync(context);
            if (context === 'modal') recalculateSalaryModal(); else calculateSalary();
        });
        sync(context);
    }
    function savePatch(settings = {}, evaluation = [], context = 'main') {
        const role = context==='modal'?global.modalActiveRole:global.currentLoadedRoleKey;
        if(!['giao-vien','giao_vien'].includes(role))return {};
        if (mode() === 'new') return saveNew(settings, evaluation, context);
        const row=getRow(settings,context,true); if(!row)return {};
        const existing=evaluation.find(item=>Number(item.id)===0);
        // Keep the Admin's note. The formula and inputs live in a separate audit snapshot.
        if(existing)Object.assign(existing,{amount:row.amount,manual:false,automatic:api.version});
        else evaluation.push({...row});
        const stats=source();
        const input={mode:'old',formula:'BẢNG LƯƠNG TG!AR4'};
        const previous=settings.teacherAttendancePolicy;
        const same=previous?.automatic===true && previous.version===api.version &&
            Object.keys(input).every(key=>previous.input?.[key]===input[key]) &&
            Object.entries(stats).every(([key,value])=>Number(previous.source?.[key])===value) && previous.rows?.[0]?.amount===row.amount;
        if(same)return {};
        const snapshot={version:api.version,automatic:true,input,source:stats,rows:[row],
            previousRows:(settings.evaluation||[]).filter(item=>Number(item.id)===0),
            appliedAt:new Date().toISOString(),appliedBy:localStorage.getItem('currentUserId')||'admin',scope:global.currentReportScope};
        return {teacherAttendancePolicy:snapshot,teacherAttendanceHistory:[...(settings.teacherAttendanceHistory||[]),snapshot]};
    }
    // New mode: every automatic row is authoritative; an Admin note is kept
    // unless it is empty or an earlier automatic note.
    function saveNew(settings, evaluation, context) {
        const result = newModeResult(settings, context);
        if (!result) throw new Error('Chưa tính được thưởng chế độ mới. Tải lại bảng công trước khi lưu.');
        result.rows.forEach(row => {
            const existing = evaluation.find(item => Number(item.id) === row.id);
            const keepNote = existing?.note && !existing.note.startsWith(AUTO_NOTE) && !existing.note.startsWith('Vắng phép:') && !existing.note.startsWith('Trễ:');
            const next = { amount: row.amount, manual: false, automatic: row.automatic, rate: undefined, note: keepNote ? existing.note : row.note };
            delete next.rate;
            if (existing) { Object.assign(existing, next); delete existing.rate; }
            else evaluation.push({ id: row.id, ...next });
        });
        const stats = source();
        const input = { mode: 'new', policy: api.NEW_MODE_VERSION, ...result.input, meeting: result.meeting?.state || null, meetingStreakCut: !!result.meeting?.streakCut };
        const patch = { newModePolicy: { ...result.input } };
        const previous = settings.teacherAttendancePolicy;
        const same = previous?.automatic === true && previous.version === api.NEW_MODE_VERSION &&
            Object.keys(input).every(key => previous.input?.[key] === input[key]) &&
            Object.entries(stats).every(([key, value]) => Number(previous.source?.[key]) === value) &&
            result.rows.every(row => previous.rows?.find(item => item.id === row.id)?.amount === row.amount);
        if (same) return patch;
        const snapshot = { version: api.NEW_MODE_VERSION, automatic: true, input, source: stats, rows: result.rows,
            previousRows: (settings.evaluation || []).filter(item => NEW_IDS.includes(Number(item.id))),
            appliedAt: new Date().toISOString(), appliedBy: localStorage.getItem('currentUserId') || 'admin', scope: global.currentReportScope };
        return { ...patch, teacherAttendancePolicy: snapshot, teacherAttendanceHistory: [...(settings.teacherAttendanceHistory || []), snapshot] };
    }
    global.TeacherAttendanceEditor={mount:settings=>mountFor('modal',settings),mountMain:settings=>mountFor('main',settings),
        sync,getRow,getPolicyRows,getHoursBonusRow,savePatch,NEW_IDS,isNewMode:()=>mode()==='new',
        assertFresh:settings=>getRow(settings,'main',true)};
})(window);
