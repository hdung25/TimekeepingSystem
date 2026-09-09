/* Explicit teacher policy preview. Saving and publishing retain the existing payroll lifecycle. */
(function (global) {
    'use strict';
    const api = global.TeacherAttendancePolicy;
    let editor = null;
    const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const field = id => document.getElementById(`teacher-policy-${id}`);
    const source = () => api.sourceFromChips(global.unfilteredAllMonthChips || [], chip => classifyAbsentChip(chip, _cachedStaffNotes));
    function readInput() {
        const result = { mode: editor.mode };
        document.querySelectorAll('#teacher-policy-editor [data-policy]').forEach(el => { result[el.dataset.policy] = el.type === 'checkbox' ? el.checked : el.value; });
        return result;
    }
    function preview() {
        if (!editor) return;
        editor.preview = null;
        try {
            const input = readInput();
            const stats = source();
            const result = api.calculate(input, stats);
            const adjustment = key => parseFormattedNumber(document.getElementById('modal-adjust-' + key)?.value || '0');
            if (input.mode === 'old' && input.attendance && input.absenceRule !== 'none' && (stats.vp + stats.vdx + stats.vkp + stats.unreported) > 0 && (adjustment('vdx') || adjustment('vkp')))
                throw new Error('Đã có khoản khấu trừ vắng ở đầu bảng. Đối chiếu và sửa khoản đó về 0, hoặc chọn miễn phạt trong bộ tính để tránh trừ hai lần.');
            if (input.mode === 'old' && input.lateEnabled && Number(input.lateRate) > 0 && adjustment('late'))
                throw new Error('Đã có khoản khấu trừ trễ ở đầu bảng. Đối chiếu khoản đó trước khi áp dụng phạt trễ bổ sung.');
            editor.preview = { input, source: stats, result };
            field('preview').textContent = editor.preview.result.rows.map(r => `${EVALUATION_CRITERIA[r.id].label}: ${r.amount.toLocaleString('vi-VN')}đ — ${r.note}`).join('\n');
            field('apply').disabled = !editor.admin;
        } catch (error) {
            field('preview').textContent = error.message;
            field('apply').disabled = true;
        }
    }
    function mount(settings) {
        document.getElementById('teacher-policy-editor')?.remove();
        editor = null;
        if (global.modalActiveRole !== 'giao-vien') return;
        const table = document.getElementById('modal-eval-table-body')?.closest('table');
        if (!table) return;
        const mode = global.currentUserContext?.teachingMode;
        const raw = localStorage.getItem('currentRole') || 'staff';
        let roles; try { roles = JSON.parse(raw); } catch (_) { roles = [raw]; }
        const admin = (Array.isArray(roles) ? roles : [roles]).includes('admin');
        const saved = settings.teacherAttendancePolicy;
        editor = { mode, admin, settings, scope: global.currentReportScope, pending: null, preview: null, dirty: false, initialRows: modalRows() };
        const stats = source();
        const input = saved?.input && saved.input.mode === mode ? saved.input : {};
        const checkbox = (key, label, checked = false) => `<label style="display:block;margin:8px 0"><input type="checkbox" data-policy="${key}" ${(input[key] ?? checked) ? 'checked' : ''}> ${label}</label>`;
        const numeric = (key, label, fallback = '', step = '1') => `<label style="display:block;margin:8px 0">${label} <input id="teacher-policy-${key}" data-policy="${key}" type="number" min="0" step="${step}" value="${esc(input[key] ?? fallback)}" style="width:110px;max-width:100%;padding:5px"></label>`;
        const select = (key, label, options) => `<label style="display:block;margin:8px 0">${label} <select data-policy="${key}" style="max-width:100%;padding:5px">${options.map(([v, t]) => `<option value="${v}" ${String(input[key] ?? '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
        const rateOptions = values => values.map(v => [String(v), `${v.toLocaleString('vi-VN')}đ/giờ`]);
        const panel = document.createElement('section');
        panel.id = 'teacher-policy-editor';
        panel.style.cssText = 'padding:16px;margin:12px 0;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;';
        panel.innerHTML = `<strong>Tính chuyên cần — ${mode === 'old' ? 'chế độ cũ' : mode === 'new' ? 'chế độ mới' : 'chưa phân loại'}</strong>
            <p>${(stats.minutes / 60).toLocaleString('vi-VN', { maximumFractionDigits: 4 })} giờ dạy được tính lương · VP ${stats.vp} · VĐX ${stats.vdx} · VKP ${stats.vkp} · Chưa cập nhật ${stats.unreported} (tính đột xuất) · Trễ ${stats.lateMinutes} phút. Không gồm giờ tiếp tân/văn phòng hoặc lớp đã nghỉ.</p>
            <p>Chỉ thay tiêu chí được chọn khi bấm Áp dụng, sau đó Lưu & Tính. Bảng đã gửi chỉ đổi sau thao tác gửi hiệu chỉnh.</p>
            <fieldset ${admin ? '' : 'disabled'} style="border:0;padding:0;min-width:0">
            ${mode === 'new' ? numeric('rate', 'Đơn giá chuyên cần (đ/giờ)', settings.attendance_rate ?? global.currentUserContext?.salary_config?.attendance_rate ?? '') : mode === 'old' ? `
                ${checkbox('eligible', 'Xác nhận đã làm việc từ 3 tháng trong tháng xét lương')}
                ${checkbox('attendance', 'I. Tính chuyên cần', true)}
                ${checkbox('fixed', 'Giáo viên có ca dạy cố định')}
                <p>Vắng tối đa 1 buổi, trên 50 giờ: 1.000đ/giờ. Vắng dưới 3 buổi, trên 65 giờ: 2.000đ/giờ (lấy mức cao hơn).</p>
                ${select('absenceRule', 'Phạt vắng', [['', 'Chọn cách áp dụng'], ['highest', 'Một mức cao nhất trong tháng'], ['each', 'Cộng theo từng buổi vắng'], ['none', 'Miễn phạt (trung tâm xét ngoại lệ)']])}
                ${select('rewardRule', 'Khi có phạt', [['', 'Chọn cách tính'], ['both', 'Cộng cả thưởng đủ điều kiện và phạt'], ['penaltyOnly', 'Chỉ phạt, không thưởng chuyên cần']])}
                ${checkbox('hoursBonus', 'IX. Thưởng tổng giờ (từ 50 / từ 65 / trên 80 giờ)')}
                ${checkbox('hoursCondition', 'Đã đối chiếu và đạt điều kiện nghỉ của mức thưởng tổng giờ')}
                ${checkbox('meetingEnabled', 'X. Tính thưởng/phạt họp tháng')}
                ${select('meeting', 'Kết quả họp (đối chiếu ghi chú X bên dưới)', [['', 'Chọn kết quả'], ['present', 'Tham gia đầy đủ'], ['permitted', 'Vắng có phép'], ['unpermitted', 'Vắng không phép'], ['none', 'Không có họp áp dụng']])}
                <details><summary>Các tiêu chí cần Admin đánh giá</summary>
                ${checkbox('lateEnabled', 'II. Phạt trễ bổ sung (không trừ lại giờ)')}${select('lateRate', 'Mức phạt', rateOptions([0, 1000, 2000, 3000, 4000, 5000]))}
                ${checkbox('focusEnabled', 'III. Làm việc riêng')}${numeric('focusCount', 'Số lần', 0)}${numeric('focusRate', 'Mức phạt mỗi lần trên mỗi giờ', 1000)}
                ${checkbox('enthusiasmEnabled', 'IV. Nhiệt tình')}${select('enthusiasmRate', 'Mức thưởng', rateOptions([0, 1000, 2000]))}
                ${checkbox('responsibilityEnabled', 'V. Trách nhiệm / tác phong / đồng phục')}${select('responsibilityRate', 'Mức cộng/trừ', rateOptions([0, 1000, 2000, -1000, -2000]))}
                ${checkbox('preparationEnabled', 'VI. Soạn bài')}${select('preparationRate', 'Mức cộng/trừ', rateOptions([0, 1000, 2000, 3000, 4000, -1000, -2000, -3000]))}
                <label>Môn/lớp <input data-policy="subject" value="${esc(input.subject)}"></label>${numeric('subjectHours', 'Giờ dạy môn đó', '', '0.0001')}
                <p>Mức thưởng/phạt theo khoảng cần đối chiếu mức độ thực tế. Dưới 30 giờ và bậc 3 trở lên, hoặc vắng họp không phép 3 tháng: quản lý xét riêng; bộ tính không tự đổi bậc lương/lớp dạy.</p></details>` : '<p>Phân loại chế độ giáo viên tại Nhân sự trước khi sử dụng bộ tính.</p>'}
            <pre id="teacher-policy-preview" style="white-space:pre-wrap;font:inherit;overflow-wrap:anywhere"></pre>
            <button type="button" class="btn btn-primary" id="teacher-policy-apply" style="margin:4px 8px 4px 0;white-space:normal">Áp dụng vào bản tính</button>
            <button type="button" class="btn btn-secondary" id="teacher-policy-restore" style="margin:4px 0;white-space:normal" ${saved?.previousRows ? '' : 'disabled'}>Khôi phục lần trước</button>
            <p id="teacher-policy-status">${saved ? 'Đã có kết quả lưu tháng này. Có thể tính lại hoặc khôi phục lần trước.' : 'Các số tiền đang lưu được giữ nguyên cho đến khi áp dụng.'}</p>
            </fieldset>`;
        table.parentElement.before(panel);
        panel.addEventListener('input', () => { editor.dirty = true; preview(); });
        panel.addEventListener('change', () => { editor.dirty = true; preview(); });
        field('apply').onclick = apply;
        field('restore').onclick = restore;
        preview();
    }
    function modalRows() {
        return [...document.querySelectorAll('.modal-eval-amount')].map(el => ({ id: Number(el.dataset.index), amount: parseFormattedNumber(el.value) || 0, note: document.querySelector(`.modal-eval-note[data-index="${el.dataset.index}"]`)?.value || '', manual: true }));
    }
    function writeRows(rows) {
        rows.forEach(row => {
            const amount = document.querySelector(`.modal-eval-amount[data-index="${row.id}"]`);
            const note = document.querySelector(`.modal-eval-note[data-index="${row.id}"]`);
            if (amount) { amount.value = formatNumberWithCommas(row.amount); amount.dataset.manualEdited = 'true'; }
            if (note) note.value = row.note || '';
        });
        recalculateSalaryModal();
    }
    function apply() {
        if (!editor?.admin || !requirePayrollAdmin() || !requireCompletePayrollReport() || editor.scope !== global.currentReportScope || global.__payrollWritePending) return;
        preview();
        if (!editor.preview) return;
        const { input, source: stats, result } = editor.preview;
        const previousRows = editor.initialRows.filter(row => result.rows.some(r => r.id === row.id));
        editor.pending = { version: api.version, restored: false, input, source: stats, rows: result.rows, previousRows, appliedAt: new Date().toISOString(), appliedBy: localStorage.getItem('currentUserId') || 'admin', scope: editor.scope };
        writeRows(result.rows);
        field('status').textContent = 'Đã áp dụng vào bản tính đang mở. Bấm Lưu & Tính để lưu; gửi hiệu chỉnh là thao tác riêng.';
    }
    function restore() {
        if (!editor?.admin || !requirePayrollAdmin() || editor.scope !== global.currentReportScope || global.__payrollWritePending) return;
        const saved = editor.settings.teacherAttendancePolicy;
        if (!saved?.previousRows) return;
        editor.pending = { version: api.version, restored: true, input: null, source: null, rows: saved.previousRows, previousRows: modalRows().filter(row => saved.previousRows.some(r => r.id === row.id)), appliedAt: new Date().toISOString(), appliedBy: localStorage.getItem('currentUserId') || 'admin', scope: editor.scope };
        writeRows(saved.previousRows);
        field('status').textContent = 'Đã khôi phục số tiền trước lần áp dụng. Bấm Lưu & Tính để lưu bản hiệu chỉnh.';
    }
    function savePatch() {
        if (global.modalActiveRole !== 'giao-vien' || !editor) return {};
        if (editor.dirty && !editor.pending) throw new Error('Bấm Áp dụng chuyên cần trước khi lưu các điều kiện vừa nhập.');
        if (!editor.pending) { assertFresh(editor.settings); return {}; }
        if (editor.scope !== global.currentReportScope) throw new Error('Nhân sự/tháng đã thay đổi. Mở lại bảng tính.');
        const pending = editor.pending;
        if (!pending.restored) { preview(); if (!editor.preview) throw new Error(field('preview').textContent); }
        if (!pending.restored && (JSON.stringify(pending.input) !== JSON.stringify(readInput()) || JSON.stringify(pending.source) !== JSON.stringify(source())))
            throw new Error('Điều kiện hoặc giờ công đã đổi. Bấm Áp dụng lại chuyên cần trước khi lưu.');
        const rows = modalRows().filter(row => pending.rows.some(r => r.id === row.id));
        const snapshot = { ...pending, rows };
        return { teacherAttendancePolicy: snapshot, teacherAttendanceHistory: [...(editor.settings.teacherAttendanceHistory || []), snapshot] };
    }
    function assertFresh(settings) {
        const policy = settings?.teacherAttendancePolicy;
        if (policy && !policy.restored && policy.source && Object.entries(source()).some(([key, value]) => Number(policy.source[key]) !== value))
            throw new Error('Giờ công hoặc số ca vắng đã đổi từ lần tính chuyên cần. Mở bảng tính và Áp dụng lại trước khi lưu.');
    }
    global.TeacherAttendanceEditor = { mount, savePatch, assertFresh };
})(window);
