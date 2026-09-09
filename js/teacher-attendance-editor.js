/* Live teacher attendance calculation; persisted only by the normal salary save. */
(function (global) {
    'use strict';
    const api = global.TeacherAttendancePolicy;
    const editors = { main: null, modal: null };
    const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const source = () => api.sourceFromChips(global.unfilteredAllMonthChips || [], chip => classifyAbsentChip(chip, _cachedStaffNotes));
    const mode = () => global.currentUserContext?.teachingMode;
    const savedRate = settings => settings.attendance_rate ?? settings.teacherAttendancePolicy?.input?.rate ?? global.currentUserContext?.salary_config?.attendance_rate ?? '';
    const currentEditor = context => editors[context]?.scope === global.currentReportScope ? editors[context] : null;
    function getRow(settings = {}, context = '', strict = false) {
        if (!['old','new'].includes(mode())) return null;
        const editor = currentEditor(context);
        const rate = editor?.settings === settings ? editor.rate : savedRate(settings);
        if (mode() === 'new' && (rate === '' || rate == null)) {
            if (strict && editor?.dirty) throw new Error('Nhập đơn giá chuyên cần; nhập 0 nếu không áp dụng.');
            return null;
        }
        try { return api.automaticAttendance(mode(), source(), rate); }
        catch (error) { if (strict) throw error; return null; }
    }
    function sync(context) {
        const editor = currentEditor(context);
        if (!editor) return;
        const prefix = context === 'modal' ? 'modal-' : '';
        const row = getRow(editor.settings, context);
        const input = document.querySelector('.' + prefix + 'eval-amount[data-index="0"]');
        if (input) {
            input.readOnly = !!row;
            if (row) { input.value = formatNumberWithCommas(row.amount); input.dataset.manualEdited = 'false'; }
        }
        const panel = document.getElementById(context === 'modal' ? 'teacher-policy-editor' : 'teacher-policy-main');
        if (!panel) return;
        const stats = source();
        const display = panel.querySelector('[data-attendance-result]');
        display.textContent = row ? row.note + ' Thành tiền: ' + formatNumberWithCommas(row.amount) + 'đ.'
            : mode() === 'new' ? 'Nhập đơn giá để tự tính chuyên cần theo tổng giờ dạy.' : 'Phân loại chế độ giáo viên tại Nhân sự.';
        panel.querySelector('[data-attendance-hours]').textContent = (stats.minutes / 60).toLocaleString('vi-VN', {maximumFractionDigits:4}) + ' giờ dạy; VP ' + stats.vp + ', VĐX ' + stats.vdx + ', VKP ' + stats.vkp + ', chưa cập nhật ' + stats.unreported + '.';
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
        const rate = savedRate(settings);
        editors[context] = { settings, rate, dirty:false, scope:global.currentReportScope };
        const panel = document.createElement('section'); panel.id=id;
        panel.style.cssText='padding:12px 16px;margin:12px 0;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc';
        panel.innerHTML='<strong>Chuyên cần '+(mode()==='old'?'chế độ cũ — tự động':'chế độ mới')+'</strong><p data-attendance-hours></p>' +
            (mode()==='new'?'<label>Đơn giá chuyên cần (đ/giờ) <input id="'+(context==='modal'?'teacher-policy-rate':'teacher-policy-main-rate')+'" type="number" min="0" step="1" value="'+esc(rate)+'" '+(admin?'':'disabled')+' style="width:130px;padding:5px"></label>':'') +
            '<p data-attendance-result></p><small>Tự cập nhật theo công và lịch của tháng. Lưu cùng bảng lương khi bấm Lưu & Tính. Bảng đã gửi được giữ nguyên đến khi gửi hiệu chỉnh.</small>';
        target.before(panel);
        panel.querySelector('input')?.addEventListener('input', event => {
            const editor=currentEditor(context); if(!admin || !editor || global.__payrollWritePending)return;
            editor.rate=event.target.value; editor.dirty=true; sync(context);
            if(context==='modal')recalculateSalaryModal(); else calculateSalary();
        });
        sync(context);
    }
    function savePatch(settings = {}, evaluation = [], context = 'main') {
        const role = context==='modal'?global.modalActiveRole:global.currentLoadedRoleKey;
        if(!['giao-vien','giao_vien'].includes(role))return {};
        const row=getRow(settings,context,true); if(!row)return {};
        const existing=evaluation.find(item=>Number(item.id)===0);
        // Keep the Admin's note. The formula and inputs live in a separate audit snapshot.
        if(existing)Object.assign(existing,{amount:row.amount,manual:false,automatic:api.version});
        else evaluation.push({...row});
        const stats=source(), editor=currentEditor(context);
        const rate=mode()==='new'?(editor?.settings===settings?editor.rate:savedRate(settings)):null;
        const input={mode:mode(),...(mode()==='new'?{rate:Number(rate)}:{formula:'BẢNG LƯƠNG TG!AR4'})};
        const previous=settings.teacherAttendancePolicy;
        const same=previous?.automatic===true && previous.version===api.version &&
            Object.keys(input).every(key=>previous.input?.[key]===input[key]) &&
            Object.entries(stats).every(([key,value])=>Number(previous.source?.[key])===value) && previous.rows?.[0]?.amount===row.amount;
        const patch=mode()==='new'?{attendance_rate:Number(rate)}:{};
        if(same)return patch;
        const snapshot={version:api.version,automatic:true,input,source:stats,rows:[row],
            previousRows:(settings.evaluation||[]).filter(item=>Number(item.id)===0),
            appliedAt:new Date().toISOString(),appliedBy:localStorage.getItem('currentUserId')||'admin',scope:global.currentReportScope};
        return {...patch,teacherAttendancePolicy:snapshot,teacherAttendanceHistory:[...(settings.teacherAttendanceHistory||[]),snapshot]};
    }
    global.TeacherAttendanceEditor={mount:settings=>mountFor('modal',settings),mountMain:settings=>mountFor('main',settings),
        sync,getRow,savePatch,assertFresh:settings=>getRow(settings,'main',true)};
})(window);
