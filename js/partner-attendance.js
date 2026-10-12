(function () {
    'use strict';
    const policy = window.PartnerAttendancePolicy;
    const state = {subjects:[], users:[], rows:[], ready:false, epoch:0, loadedMonth:'', loadedGroup:'', view:'calendar', byId:new Map(), orphans:0};
    const el = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hours = minutes => (minutes / 60).toLocaleString('vi-VN',{maximumFractionDigits:2});
    const dateLabel = date => date.split('-').reverse().join('/');
    function clock(value) {
        if (!value) return '—';
        const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value.seconds !== undefined ? value.seconds * 1000 : value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Ho_Chi_Minh'});
    }
    function setBusy(busy) {
        ['pa-month','pa-group','pa-reload'].forEach(id => { el(id).disabled = busy; });
        const rows = filtered();
        el('pa-export').disabled = busy || !state.ready || rows.some(r => r.ambiguous) || !rows.length;
        el('pa-results').setAttribute('aria-busy',String(busy));
    }
    async function pool(items, task) {
        let index = 0;
        const results = await Promise.allSettled(Array.from({length:Math.min(10,items.length)},async () => {
            while (index < items.length) { const item = items[index++]; await task(item); }
        }));
        const failed = results.find(r => r.status === 'rejected');
        if (failed) throw failed.reason;
    }
    function filtered() {
        const subject = el('pa-subject').value, query = el('pa-search').value.trim().toLocaleLowerCase('vi');
        return state.rows.filter(row => (!subject || row.subjectKey.split('+').includes(subject)) &&
            (!query || row.staffName.toLocaleLowerCase('vi').includes(query)));
    }
    function editUrl(row) {
        return 'bao-cao.html?' + new URLSearchParams({staffId:row.staffId,date:row.date,roleView:'giao-vien'});
    }
    // Shown clock range: a partner correction wins, otherwise the attendance log.
    function inOut(row) {
        if (row.adjustment) return [row.adjustment.checkIn || '—', row.adjustment.checkOut || '—'];
        return [clock(row.checkIn), clock(row.checkOut)];
    }
    function actionsHtml(row) {
        const who = esc(row.staffName+' ngày '+dateLabel(row.date));
        return '<span class="pa-actions"><button type="button" class="pa-adjust" data-adjust="'+esc(row.id)+'" aria-label="Chỉnh cho liên kết: '+who+'">Chỉnh liên kết</button>'+
            '<button type="button" class="pa-edit pa-edit-payroll" data-url="'+esc(editUrl(row))+'" title="Mở bảng công chính. Sửa ở đó sẽ thay đổi lương giáo viên." aria-label="Sửa công lương: '+who+'">Sửa công lương</button></span>';
    }
    const WEEKDAYS = ['T2','T3','T4','T5','T6','T7','CN'];
    const todayKey = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());
    function entryHtml(row) {
        const tone = policy.toneOf(row), flags = policy.flagsOf(row);
        const [timeIn, timeOut] = inOut(row);
        const detail = row.adjustment ? (policy.ABSENT.has(row.adjustment.status) ? policy.STATUS[row.adjustment.status] : timeIn+'–'+timeOut+' · '+policy.formatMinutes(row.minutes))
            : row.checkIn ? timeIn+'–'+timeOut+' · '+policy.formatMinutes(row.minutes) : 'Chưa có công';
        const payroll = row.adjustment ? '<span class="pa-ci-payroll">Công lương: '+esc(policy.formatMinutes(row.base.minutes))+' (không đổi)</span>' : '';
        return '<div class="pa-ci pa-tone-'+tone+(row.needsReview?' pa-ci-review':'')+'" title="'+esc(row.status)+'">'+
            '<strong class="pa-ci-name">'+esc(row.staffName)+'</strong>'+
            '<span class="pa-ci-time">'+esc(row.start)+'–'+esc(row.end)+' · '+esc(row.branch.toUpperCase())+'</span>'+
            '<span class="pa-ci-subject">'+esc(row.subjectName)+'</span>'+
            '<span class="pa-ci-work">'+esc(detail)+'</span>'+payroll+(row.adjustment?.note?'<span class="pa-ci-note">'+esc(row.adjustment.note)+'</span>':'')+
            (row.ambiguous?'<span class="pa-flag pa-flag-warn">Lớp ghép ngoài nhóm</span>':'')+
            (flags.length?'<span class="pa-flags">'+flags.map(f=>'<span class="pa-flag pa-flag-'+f.kind+'">'+esc(f.text)+'</span>').join('')+'</span>':'')+
            actionsHtml(row)+'</div>';
    }
    function renderCalendar(rows) {
        const host = el('pa-cal'), month = state.ready && state.loadedMonth ? state.loadedMonth : el('pa-month').value;
        el('pa-calendar-sec').hidden = state.view !== 'calendar';
        el('pa-month-label').textContent = /^\d{4}-\d{2}$/.test(month) ? 'Tháng '+month.slice(5)+'/'+month.slice(0,4) : '';
        if (state.view !== 'calendar') { host.innerHTML = ''; return; }
        const byDate = new Map();
        rows.forEach(row => { if (!byDate.has(row.date)) byDate.set(row.date, []); byDate.get(row.date).push(row); });
        const today = todayKey();
        const head = '<div class="pa-cal-head" aria-hidden="true">'+WEEKDAYS.map((d,i)=>'<span'+(i===6?' class="pa-sun"':'')+'>'+d+'</span>').join('')+'</div>';
        const weeks = policy.monthGrid(month).map(week => '<div class="pa-cal-week">'+week.map((cell,i) => {
            if (!cell) return '<div class="pa-day pa-day-pad" aria-hidden="true"></div>';
            const items = (byDate.get(cell.date) || []).slice().sort((a,b)=>String(a.start).localeCompare(String(b.start))||a.staffName.localeCompare(b.staffName,'vi')||a.subjectName.localeCompare(b.subjectName,'vi'));
            const minutes = items.reduce((sum,r)=>sum+r.minutes,0), teachers = new Set(items.filter(r=>r.worked).map(r=>r.staffId)).size;
            return '<div class="pa-day'+(i===5?' pa-sat':'')+(i===6?' pa-sun-cell':'')+(cell.date===today?' pa-today':'')+(items.length?' pa-has':'')+'" data-date="'+cell.date+'" data-weekday="'+WEEKDAYS[i]+'">'+
                '<div class="pa-day-top"><span class="pa-day-num"><b>'+cell.day+'</b><small>'+WEEKDAYS[i]+' · '+dateLabel(cell.date)+'</small></span></div>'+
                '<div class="pa-day-items">'+items.map(entryHtml).join('')+'</div>'+
                (minutes>0?'<div class="pa-day-total">Tổng: '+policy.formatMinutes(minutes)+(teachers>1?' · '+teachers+' GV':'')+'</div>':'')+'</div>';
        }).join('')+'</div>').join('');
        host.innerHTML = head+'<div class="pa-cal-body">'+weeks+'</div>'+(rows.length?'':'<p class="pa-empty pa-cal-empty">Không có công phù hợp với bộ lọc trong tháng này.</p>');
    }
    function setView(view) {
        state.view = view === 'list' ? 'list' : 'calendar';
        try { localStorage.setItem('paView', state.view); } catch (_) {}
        ['calendar','list'].forEach(name => el('pa-view-'+name).setAttribute('aria-pressed',String(state.view===name)));
        render();
    }
    function shiftMonth(delta) {
        const value = el('pa-month').value;
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || el('pa-month').disabled) return;
        const date = new Date(Date.UTC(Number(value.slice(0,4)), Number(value.slice(5))-1+delta, 1));
        el('pa-month').value = date.getUTCFullYear()+'-'+String(date.getUTCMonth()+1).padStart(2,'0');
        load();
    }
    function render() {
        const rows = filtered(), summary = policy.summarize(rows);
        el('pa-stats').innerHTML = '<div><strong>'+new Set(rows.map(r => r.staffId)).size+'</strong><span>Giáo viên</span></div>'+
            '<div><strong>'+hours(rows.reduce((sum,r) => sum+r.minutes,0))+'</strong><span>Giờ công</span></div>'+
            '<div><strong>'+new Set(rows.filter(r => r.worked).map(r => r.staffId+'|'+r.date)).size+'</strong><span>Ngày công giáo viên</span></div>';
        const review = rows.filter(r => r.needsReview).length;
        el('pa-review').textContent = (review ? review+' ca cần kiểm tra (chưa cập nhật, đang chờ duyệt hoặc lớp ghép khác nhóm). Bấm Chỉnh liên kết hoặc Sửa công lương để đối chiếu trước khi gửi. ' : '')+
            (state.orphans ? state.orphans+' chỉnh sửa liên kết không còn khớp ca nào trong lịch (lịch đã đổi), không được tính.' : '');
        el('pa-summary').innerHTML = summary.length ? summary.map(item => '<article class="pa-summary-card"><h3>'+esc(item.subjectName)+'</h3><p>'+esc(item.staffName)+'</p><div><strong>'+hours(item.minutes)+' giờ</strong><span>'+item.days+' ngày làm · '+item.shifts+' ca lịch/công</span></div></article>').join('') : '<p class="pa-empty">Không có công phù hợp với bộ lọc trong tháng này.</p>';
        el('pa-body').innerHTML = state.view !== 'list' ? '' : rows.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.subjectName.localeCompare(b.subjectName,'vi')||a.staffName.localeCompare(b.staffName,'vi')).map(row =>
            '<tr'+(row.needsReview?' class="pa-needs-review"':'')+'><td data-label="Ngày">'+dateLabel(row.date)+'</td><td data-label="Môn">'+esc(row.subjectName)+'</td><td data-label="Giáo viên">'+esc(row.staffName)+'</td>'+ 
            '<td data-label="Ca / Cơ sở">'+esc(row.start)+'–'+esc(row.end)+'<small>'+esc(row.branch.toUpperCase())+'</small></td>'+ 
            '<td data-label="Vào / Ra">'+inOut(row).join(' / ')+'</td><td data-label="Giờ công"><strong>'+hours(row.minutes)+'</strong></td>'+ 
            '<td data-label="Trạng thái">'+esc(row.status)+(row.adjustment?'<small>Chỉnh riêng liên kết · công lương '+esc(policy.formatMinutes(row.base.minutes))+' không đổi</small>':'')+(row.ambiguous?'<small>Lớp ghép có môn ngoài nhóm: cần đối chiếu</small>':'')+'</td><td>'+actionsHtml(row)+'</td></tr>').join('');
        el('pa-detail').hidden = state.view !== 'list' || !rows.length;
        renderCalendar(rows);
        el('pa-export').disabled = !state.ready || !rows.length || rows.some(r => r.ambiguous);
    }
    async function load() {
        const epoch = ++state.epoch;
        state.ready = false; state.rows = []; render(); setBusy(true);
        el('pa-message').textContent = 'Đang đối chiếu lịch và công mới nhất…';
        try {
            const month = el('pa-month').value, groupId = el('pa-group').value;
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Vui lòng chọn tháng hợp lệ.');
            const [subjects, users, settings] = await Promise.all([
                DBService.getSubjects(true,{strict:true}),DBService.getUsers({forceRefresh:true}),
                DBService.getSystemSettings({source:'server'})]);
            const selected = policy.leaves(subjects,groupId);
            if (!subjects.some(s => String(s.id) === groupId && s.isGroup === true)) throw new Error('Nhóm môn không còn tồn tại. Vui lòng quay lại Môn học chọn nhóm.');
            state.subjects = subjects; state.users = users;
            window.centerClosures = settings.centerClosures || {};
            const [year,monthNumber] = month.split('-').map(Number), days = new Date(year,monthNumber,0).getDate();
            const dates = Array.from({length:days},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));
            const scheduleMap = {}, readCache = new Map();
            const work = dates.flatMap(date => ['cs1','cs2','cs3'].map(branch=>({date,branch,key:branch+'__'+date})));
            await pool(work,async item => {
                const data = await DBService.getSchedule(item.key,{source:'server',readCache});
                scheduleMap[item.date] ||= {};
                policy.sections.forEach(sec => {
                    scheduleMap[item.date][sec] ||= [];
                    (data?.[sec] || []).forEach((row,index) => scheduleMap[item.date][sec].push({...row,_branch:item.branch,_compositeKey:item.key,_originalIndex:index}));
                });
            });
            // Admin reads the month once, including manual classes and substitute teachers.
            const attendance = await window.db.collection('attendance_logs').where('date','>=',month+'-01').where('date','<=',month+'-31').get({source:'server'});
            const logsByUser = new Map();
            attendance.docs.forEach(doc => {
                const record = doc.data();
                if (!record.userId) throw new Error('Có bản công thiếu mã nhân sự, cần kiểm tra trước khi xuất.');
                if (!logsByUser.has(String(record.userId))) logsByUser.set(String(record.userId),{});
                const sessions = Array.isArray(record.sessions) ? record.sessions : record.checkIn ? [{id:'legacy',start:record.checkIn,checkIn:record.checkIn,checkOut:record.checkOut||null}] : [];
                const byDate = logsByUser.get(String(record.userId));
                byDate[record.date] = (byDate[record.date] || []).concat(sessions);
            });
            // Only teachers who can own a chip of this group are evaluated: anyone rostered on a
            // group class, or whose own sessions mention a group subject (admin-added class,
            // reclassified work). Everyone else would cost 5 reads each and never produce a row.
            const selectedIds = new Set(selected.map(s => String(s.id)));
            const needles = new Set(selected.flatMap(s => [policy.normalize(s.id), policy.normalize(s.name)]).filter(Boolean));
            const staffIds = new Set();
            logsByUser.forEach((byDate, userId) => {
                if (policy.mentionsAny(byDate, needles)) staffIds.add(userId);
            });
            Object.values(scheduleMap).forEach(day => policy.sections.forEach(sec => (day[sec]||[]).forEach(row => {
                if (!policy.resolveIds(row, subjects).some(id => selectedIds.has(id))) return;
                ['gvList','gvThayTeList','gvThayTheList','registeredTeachers'].forEach(field => (row[field]||[]).forEach(u => {if(u?.id)staffIds.add(String(u.id));}));
                ['gvId','gvThayTheId','gvThayTeId'].forEach(field=>{if(row[field])staffIds.add(String(row[field]));});
            })));
            const allRows = [];
            await pool(Array.from(staffIds),async staffId => {
                const staff = users.find(u=>String(u.id)===staffId) || {id:staffId,fullName:'Nhân sự '+staffId};
                DBService._invalidate('overtime_requests_staff_'+staffId+'_'+month);
                DBService._invalidate('bonus10_requests_staff_'+staffId+'_'+month);
                const [cancelled, observations, overtime, bonus, salarySettings] = await Promise.all([
                    DBService.getCancelledShifts(month,staffId,{strict:true}),
                    DBService.getShiftObservationsForMonth(month,staffId,{strict:true}),
                    DBService.getOvertimeRequestsForStaff(staffId,month),
                    DBService.getBonus10RequestsForStaff(staffId,month),
                    DBService.getMonthlySalarySettings(staffId,month,{strict:true})]);
                const bonusMap={}, overtimeMap={}, observationMap={};
                bonus.forEach(req => {(bonusMap[String(req.sessionId)] ||= []).push(req);});
                overtime.forEach(req => { overtimeMap[req.dateKey] ||= {}; const old=overtimeMap[req.dateKey][req.sessionId];
                    if(!old || req.status==='approved' || (req.status==='pending' && old.status==='rejected'))overtimeMap[req.dateKey][req.sessionId]=req; });
                observations.forEach(req => {(observationMap[req.dateKey] ||= []).push(req);});
                const penalty = salarySettings?.bonus10PenaltyState;
                const flags = {separateSubjectChips:true,early10PenaltyActive:typeof penalty?.active === 'boolean' ? penalty.active : bonus.some(req=>req.status==='rejected'),
                    subjectEarly10Map:Early10.buildSubjectEarly10Map(subjects),subjectEarly10NameMap:Early10.buildSubjectEarly10NameMap(subjects)};
                dates.forEach(date => {
                    const schedule=scheduleMap[date]||{}, sessions=logsByUser.get(staffId)?.[date]||[];
                    const chips=calculateDailyChips(schedule,sessions,staffId,date,staff,[],overtimeMap[date]||{},cancelled,bonusMap,observationMap[date]||[],flags);
                    allRows.push(...policy.rowsForChips(chips,schedule,staff,date,subjects,selected.map(s=>String(s.id))));
                });
            });
            // Partner-only corrections are read last and applied on top; payroll data is untouched.
            const adjustments = await window.db.collection('partner_attendance_adjustments').where('month','==',month).get({source:'server'});
            if(epoch !== state.epoch)return;
            const adjById = new Map(adjustments.docs.map(doc => [doc.id, doc.data()]));
            state.byId = new Map();
            allRows.forEach(row => { row.id = policy.adjustmentId(row); state.byId.set(row.id,row); policy.applyAdjustment(row, adjById.get(row.id)); });
            state.orphans = Array.from(adjById).filter(([id,adj]) => adj.active === true && !state.byId.has(id) && staffIds.has(String(adj.staffId))).length;
            state.rows=allRows; state.ready=true; state.loadedMonth=month; state.loadedGroup=groupId;
            el('pa-subject').innerHTML='<option value="">Tất cả môn trong nhóm</option>'+selected.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('');
            el('pa-message').textContent='Đã đối chiếu lúc '+new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})+' · '+selected.length+' môn. Giờ công lấy theo công lương; ca nào bấm Chỉnh liên kết thì chỉ bảng này và file Excel đổi, lương giáo viên không đổi.';
            render();
        } catch(error) {
            state.ready=false;state.rows=[];render();
            el('pa-message').textContent='Không thể tải đầy đủ bảng công: '+error.message+'. Hãy thử Tải lại. File Excel chỉ xuất khi dữ liệu tải đầy đủ.';
        } finally { if(epoch===state.epoch)setBusy(false); }
    }
    let editorOpened = false;
    function openEditor(url) {
        editorOpened = true;
        window.open(url,'_blank','noopener');
    }
    const toMinutes = value => /^\d{2}:\d{2}$/.test(value) ? Number(value.slice(0,2))*60+Number(value.slice(3)) : null;
    let editing = null;
    function syncDialog(autoMinutes) {
        const absent = policy.ABSENT.has(el('pa-adj-status').value);
        ['pa-adj-in','pa-adj-out','pa-adj-h','pa-adj-m'].forEach(id => { el(id).disabled = absent; });
        if (absent) { el('pa-adj-h').value = 0; el('pa-adj-m').value = 0; el('pa-adj-in').value = ''; el('pa-adj-out').value = ''; return; }
        if (autoMinutes) {
            const a = toMinutes(el('pa-adj-in').value), b = toMinutes(el('pa-adj-out').value);
            if (a !== null && b !== null && b > a) { el('pa-adj-h').value = Math.floor((b-a)/60); el('pa-adj-m').value = (b-a)%60; }
        }
    }
    function openAdjust(id) {
        const row = state.byId.get(id);
        if (!row || !state.ready) return;
        editing = row;
        const adj = row.adjustment, base = row.base || row;
        const [timeIn, timeOut] = adj ? [adj.checkIn, adj.checkOut] : [clock(row.checkIn), clock(row.checkOut)];
        el('pa-adj-who').textContent = row.staffName+' · '+dateLabel(row.date)+' · '+row.start+'–'+row.end+' · '+row.subjectName;
        el('pa-adj-payroll').textContent = 'Công lương (giữ nguyên): '+policy.formatMinutes(base.minutes)+' · '+base.status;
        const late = /\(T\d+p\)/.test(base.status), early = /\(V\d+p\)/.test(base.status);
        el('pa-adj-status').value = adj?.status || (late ? 'tre' : early ? 've-som' : 'du');
        el('pa-adj-in').value = /^\d{2}:\d{2}$/.test(timeIn) ? timeIn : '';
        el('pa-adj-out').value = /^\d{2}:\d{2}$/.test(timeOut) ? timeOut : '';
        el('pa-adj-h').value = Math.floor(row.minutes/60); el('pa-adj-m').value = row.minutes%60;
        el('pa-adj-note').value = adj?.note || '';
        el('pa-adj-clear').hidden = !adj;
        el('pa-adj-error').textContent = '';
        el('pa-adj-payroll-link').href = editUrl(row);
        syncDialog(false);
        el('pa-adjust').showModal();
    }
    async function saveAdjust(active) {
        const row = editing; if (!row) return;
        const status = el('pa-adj-status').value, absent = policy.ABSENT.has(status);
        const minutes = absent ? 0 : Math.round(Number(el('pa-adj-h').value||0)*60 + Number(el('pa-adj-m').value||0));
        if (active && (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440)) { el('pa-adj-error').textContent = 'Giờ công phải từ 0 đến 24 giờ.'; return; }
        const checkIn = absent ? '' : el('pa-adj-in').value, checkOut = absent ? '' : el('pa-adj-out').value;
        if (active && checkIn && checkOut && toMinutes(checkOut) <= toMinutes(checkIn)) { el('pa-adj-error').textContent = 'Giờ ra phải sau giờ vào.'; return; }
        const buttons = ['pa-adj-save','pa-adj-clear','pa-adj-cancel'].map(el); buttons.forEach(b => { b.disabled = true; });
        el('pa-adj-error').textContent = 'Đang lưu…';
        try {
            const ref = window.db.collection('partner_attendance_adjustments').doc(row.id);
            const stamp = firebase.firestore.FieldValue.serverTimestamp();
            const prev = row.adjustment || {};
            const data = {staffId:String(row.staffId), date:row.date, month:row.date.slice(0,7), rowKey:row.rowKey, active,
                status: active ? status : (prev.status || 'du'), checkIn: active ? checkIn : (prev.checkIn || ''), checkOut: active ? checkOut : (prev.checkOut || ''),
                minutes: active ? minutes : Math.round(Number(prev.minutes) || 0), note: active ? el('pa-adj-note').value.trim().slice(0,500) : (prev.note || ''),
                updatedByName: String(localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin').slice(0,160),
                updatedByStaffId: String(localStorage.getItem('currentUserId') || '').slice(0,80), updatedAt: stamp};
            await window.db.runTransaction(async tx => {
                const snap = await tx.get(ref);
                if (snap.exists) tx.set(ref, {...data, createdAt: snap.data().createdAt});
                else if (active) tx.set(ref, {...data, createdAt: stamp});
            });
            policy.applyAdjustment(row, active ? data : null);
            el('pa-adjust').close(); render();
            el('pa-message').textContent = (active ? 'Đã lưu chỉnh sửa cho liên kết: ' : 'Đã dùng lại công lương: ')+row.staffName+' · '+dateLabel(row.date)+'. Lương giáo viên không thay đổi.';
        } catch (error) {
            el('pa-adj-error').textContent = 'Chưa lưu được: '+(error.code === 'permission-denied' ? 'tài khoản không có quyền admin chính.' : error.message);
        } finally { buttons.forEach(b => { b.disabled = false; }); }
    }
    async function exportExcel() {
        // Re-read before downloading so edits made in the standard editor are reflected.
        const subject=el('pa-subject').value, search=el('pa-search').value;
        await load(); el('pa-subject').value=subject;el('pa-search').value=search;render();
        if(!state.ready)return;
        const rows=filtered(); if(!rows.length || rows.some(r=>r.ambiguous))return;
        const group=state.subjects.find(s=>String(s.id)===state.loadedGroup);
        const summary=policy.summarize(rows), title='BẢNG CÔNG '+group.name+' · '+state.loadedMonth;
        const sheets=[
            {name:'Tổng hợp theo môn',widths:[7,30,30,15,18,60],headerRow:4,merges:['A1:F1','A2:F2'],rows:[
                {cells:[{v:title,s:1}],ht:26},{cells:[{v:'Số giờ và ngày làm gửi đối tác. Không gồm thông tin lương.',s:2}]},{cells:[]},
                {cells:['STT','Môn học','Giáo viên','Ngày làm','Giờ công','Các ngày làm'].map(v=>({v,s:3}))},
                ...summary.map((item,i)=>({cells:[i+1,item.subjectName,item.staffName,item.days,item.minutes/60,item.dates.map(dateLabel).join(', ')].map((v,index)=>({v,s:index===4?6:9})),ht:28})),
                {cells:[{v:'Tổng giờ',s:7},{v:'',s:7},{v:'',s:7},{v:'',s:7},{v:rows.reduce((sum,r)=>sum+r.minutes,0)/60,s:8}]}]},
            {name:'Chi tiết ngày công',widths:[7,15,30,30,12,12,12,14,14,15,60],headerRow:4,merges:['A1:K1','A2:K2'],rows:[
                {cells:[{v:title,s:1}],ht:26},{cells:[{v:'Giờ công lấy từ dữ liệu đã đối chiếu; ca vắng / chưa cập nhật có 0 giờ.',s:2}]},{cells:[]},
                {cells:['STT','Ngày','Môn học','Giáo viên','Cơ sở','Ca từ','Ca đến','Giờ vào','Giờ ra','Giờ công','Trạng thái công'].map(v=>({v,s:3}))},
                ...rows.slice().sort((a,b)=>a.subjectName.localeCompare(b.subjectName,'vi')||a.date.localeCompare(b.date)||a.staffName.localeCompare(b.staffName,'vi')).map((row,i)=>({cells:[i+1,dateLabel(row.date),row.subjectName,row.staffName,row.branch.toUpperCase(),row.start,row.end,...inOut(row),row.minutes/60,row.status].map((v,index)=>({v,s:index===9?6:9})),ht:28}))]}
        ];
        const blob=PartnerAttendanceXlsx.build(sheets), url=URL.createObjectURL(blob), link=document.createElement('a');
        link.href=url;link.download=('Bang cong '+group.name+' '+state.loadedMonth).replace(/[\\/:*?"<>|]/g,'_')+'.xlsx';
        document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
    }
    document.addEventListener('DOMContentLoaded',async () => {
        if(window.waitAuth)await window.waitAuth();
        let roles;try{roles=JSON.parse(localStorage.getItem('currentRole'));}catch(_){roles=[localStorage.getItem('currentRole')];}
        if(!(Array.isArray(roles)?roles:[roles]).includes('admin')) {el('pa-message').textContent='Chỉ admin được xem bảng công đối tác.';setBusy(true);return;}
        el('pa-month').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit'}).format(new Date());
        try {
            state.subjects=await DBService.getSubjects(true,{strict:true});
            const groups=state.subjects.filter(s=>s.isGroup===true);
            el('pa-group').innerHTML=groups.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('');
            const requested=new URLSearchParams(location.search).get('groupId');
            if(requested && !groups.some(s=>String(s.id)===requested))throw new Error('Nhóm môn được chọn không tồn tại. Vui lòng chọn lại trong Môn học.');
            const target=groups.find(s=>String(s.id)===requested) || groups.find(s=>String(s.name).normalize('NFC').trim().toLocaleUpperCase('vi')==='LIÊN KẾT');
            if(target)el('pa-group').value=target.id;
            if(!groups.length)throw new Error('Chưa có nhóm môn. Hãy tạo nhóm trong Môn học.');
            el('pa-group').addEventListener('change',load);el('pa-month').addEventListener('change',load);
            el('pa-reload').addEventListener('click',load);
            try{if(localStorage.getItem('paView')==='list')state.view='list';}catch(_){}
            ['calendar','list'].forEach(name=>{el('pa-view-'+name).setAttribute('aria-pressed',String(state.view===name));el('pa-view-'+name).addEventListener('click',()=>setView(name));});
            el('pa-prev').addEventListener('click',()=>shiftMonth(-1));el('pa-next').addEventListener('click',()=>shiftMonth(1));
            const onAction=event=>{const adjust=event.target.closest('[data-adjust]');if(adjust)return openAdjust(adjust.dataset.adjust);const button=event.target.closest('[data-url]');if(button)openEditor(button.dataset.url);};
            el('pa-cal').addEventListener('click',onAction);
            el('pa-adj-status').addEventListener('change',()=>syncDialog(true));['pa-adj-in','pa-adj-out'].forEach(id=>el(id).addEventListener('change',()=>syncDialog(true)));
            el('pa-adj-save').addEventListener('click',()=>saveAdjust(true));el('pa-adj-clear').addEventListener('click',()=>saveAdjust(false));
            el('pa-adj-cancel').addEventListener('click',()=>el('pa-adjust').close());
            el('pa-adj-payroll-link').addEventListener('click',event=>{event.preventDefault();el('pa-adjust').close();openEditor(el('pa-adj-payroll-link').href);});el('pa-subject').addEventListener('change',render);el('pa-search').addEventListener('input',render);
            el('pa-export').addEventListener('click',()=>exportExcel().catch(error=>{el('pa-message').textContent='Xuất Excel chưa thành công: '+error.message;}));
            el('pa-body').addEventListener('click',onAction);
            window.addEventListener('focus',()=>{if(editorOpened && !el('pa-reload').disabled){editorOpened=false;load();}});
            await load();
        } catch(error) {el('pa-message').textContent=error.message;setBusy(false);}
    });
})();
