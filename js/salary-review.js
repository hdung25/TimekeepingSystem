/* Admin review workspace. Inference is read-only; every persisted change is explicit. */
(function () {
    'use strict';
    const P = window.SalaryReviewPolicy, S = window.SalaryReviewService;
    const $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = value => value == null || value === '' ? 'Chưa rõ' : Number(value).toLocaleString('vi-VN') + ' đ';
    const number = value => value == null ? 'Chưa đủ dữ liệu' : Number(value).toLocaleString('vi-VN',{maximumFractionDigits:1});
    const clone = value => JSON.parse(JSON.stringify(value));
    const state = {index:null,staffId:'',groupId:'',evidence:null,draft:null,inferred:[],stats:null,dirty:false,busy:false,loading:false,month:'',epoch:0,benchmark:null,cache:new Map()};
    const sourceLabels = {monthly_config:'Giá tháng',monthly_legacy_config:'Giá tháng (cũ)',published_snapshot:'Phiếu đã gửi',legacy_salary_settings:'Cấu hình lương cũ',personnel_subject_config:'Giá môn trong nhân sự',personnel_class_config:'Giá lớp trong nhân sự',personnel_group_config:'Giá nhóm trong nhân sự'};
    const decisionLabels = {profile:'Lưu hồ sơ',approved:'Duyệt mức mới',applied:'Duyệt mức mới',application:'Duyệt mức mới',cancelled:'Hủy mức chờ hiệu lực',cancel_application:'Hủy mức chờ hiệu lực',deferred:'Hẹn xét lại',not_increased:'Chưa tăng',settings:'Đổi quy định'};
    const today = () => P.dateKey();
    const currentGroup = () => state.draft?.groups.find(g => g.id === state.groupId);
    function message(text,isError=false) { $('sr-message').textContent=text; $('sr-message').classList.toggle('error',isError); }
    function field(name,label,value,type='text',help='',attributes='') {
        return `<div class="sr-field"><label for="sr-${esc(name)}">${esc(label)}</label><input id="sr-${esc(name)}" name="${esc(name)}" type="${type}" value="${esc(value)}" ${attributes}>${help?`<small>${esc(help)}</small>`:''}</div>`;
    }
    function select(name,label,value,options,help='') {
        return `<div class="sr-field"><label for="sr-${esc(name)}">${esc(label)}</label><select id="sr-${esc(name)}" name="${esc(name)}">${options.map(([v,l])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(l)}</option>`).join('')}</select>${help?`<small>${esc(help)}</small>`:''}</div>`;
    }
    const area = (name,label,value,help='') => `<div class="sr-field sr-wide"><label for="sr-${esc(name)}">${esc(label)}</label><textarea id="sr-${esc(name)}" name="${esc(name)}" maxlength="2000">${esc(value)}</textarea>${help?`<small>${esc(help)}</small>`:''}</div>`;
    function markDirty() { state.dirty=true; const el=$('sr-save-note');if(el)el.textContent='Có thay đổi chưa lưu'; }
    function confirmDiscard() { return !state.dirty || window.confirm('Hồ sơ có thay đổi chưa lưu. Bỏ thay đổi để tiếp tục?'); }
    async function write(action) {
        if(state.busy)return;
        state.busy=true;window.__payrollWritePending=true;
        document.querySelector('.sr-page').inert=true;
        $('sr-dialog-content').inert=true;
        document.querySelectorAll('.sr-page button,.sr-dialog button').forEach(el=>el.disabled=true);
        try { await action(); }
        catch(error) { message(error.message||'Không thể lưu. Dữ liệu đang hiển thị chưa được xác nhận.',true); const el=$('sr-dialog-error');if(el)el.textContent=error.message; }
        finally { state.busy=false;window.__payrollWritePending=false;document.querySelector('.sr-page').inert=false;$('sr-dialog-content').inert=false;document.querySelectorAll('.sr-page button,.sr-dialog button').forEach(el=>el.disabled=false); }
    }
    function statusFor(group,profile,stats={}) { return P.evaluate(group,stats,state.index.config,today(),profile.personOverrides||{}); }
    function profileFor(id) { return state.index.profiles.find(p=>p.staffId===id||p.id===id)||{groups:[],personOverrides:{}}; }
    function directory() {
        const query=P.key($('sr-search').value),filter=$('sr-filter').value;
        const users=state.index.users.filter(P.isTeacher).map(user=>{
            const profile=profileFor(user.id),evaluations=(profile.groups||[]).map(g=>statusFor(g,profile));
            const due=evaluations.filter(e=>e.visibleThisMonth).length,setup=!evaluations.length||evaluations.some(e=>e.state==='setup');
            return {user,due,setup};
        }).filter(({user,due,setup})=>(!query||P.key(user.name+' '+user.username).includes(query))&&(filter!=='due'||due)&&(filter!=='setup'||setup))
            .sort((a,b)=>b.due-a.due||String(a.user.name||'').localeCompare(b.user.name||'','vi'));
        $('sr-count').textContent=users.length+' nhân viên · '+today().slice(0,7);
        $('sr-list').innerHTML=users.length?users.map(({user,due,setup})=>`<button type="button" class="sr-person" data-person="${esc(user.id)}" aria-current="${user.id===state.staffId}"><span class="sr-avatar">${esc((user.name||user.username||'?').split(/\s+/).slice(-2).map(w=>w[0]).join(''))}</span><span><strong>${esc(user.name||user.username||user.id)}</strong><small>${due?due+' nhóm cần xét':setup?'Cần xác nhận mốc':'Đã có mốc nhắc xét'}</small></span></button>`).join(''):'<p class="sr-hint">Không có nhân viên trong bộ lọc này.</p>';
    }
    function renderSettings() {
        const c=state.index.config,b=state.benchmark;
        $('sr-settings-summary').textContent=`· ${c.cycleMonths} tháng / lần · ${c.minimumHours==null?'Chưa xác nhận ngưỡng giờ':number(c.minimumHours)+' giờ/tháng'}`;
        $('sr-settings-form').innerHTML=`<p class="sr-help">Quy định chung → điều chỉnh từng người → điều chỉnh từng nhóm môn. Ô riêng để trống sẽ dùng quy định cấp trên. Chỉ nhắc xét, không tự tăng lương.</p><div class="sr-form-grid three">
            ${field('global-cycle','Chu kỳ thông thường (tháng)',c.cycleMonths,'number','Mức 42.000 đ mặc định xét sau 6 tháng.','min="1" max="36" required')}
            ${field('global-hours','Ngưỡng tham khảo (giờ/tháng)',c.minimumHours??b?.suggestedHours??'','number','0 = không cảnh báo ít giờ. Ít giờ vẫn được đưa vào danh sách xét.','min="0" max="744" step="0.1" required')}
            ${field('global-extra','Gợi ý hẹn lại (tháng)',c.extraMonths,'number','Admin quyết định có hẹn lại hay không.','min="1" max="12" required')}
            </div><p id="sr-benchmark" class="sr-hint">${b?benchmarkText(b):'Có thể tính gợi ý từ phiếu giáo viên đã gửi / đã nhận của tháng gần nhất. Không coi người thiếu phiếu là 0 giờ.'}</p>
            <div class="sr-actions"><button type="button" class="sr-btn" id="sr-calculate">Tính lại gợi ý giờ</button><button class="sr-btn sr-btn-primary" type="submit">Lưu quy định chung</button></div>`;
    }
    function benchmarkText(b) {
        return b.people?`Gợi ý ${number(b.suggestedHours)} giờ/tháng: trung bình ${number(b.meanHours)} giờ của ${b.people}/${b.totalPeople} giáo viên, trợ giảng có phiếu hợp lệ trong ${b.month}. ${b.missingPeople} người thiếu dữ liệu không được tính là 0. Đây là gợi ý; cần bấm Lưu để áp dụng.`:'Chưa có đủ phiếu hợp lệ để tính gợi ý. Admin có thể nhập ngưỡng tạm và chỉnh sau.';
    }
    async function benchmark() {
        const button=$('sr-calculate');button.disabled=true;
        try {state.benchmark=await S.calculateBenchmark(state.index.users);const input=$('sr-global-hours');if(!input.value&&state.benchmark.suggestedHours!==null)input.value=state.benchmark.suggestedHours;$('sr-benchmark').textContent=benchmarkText(state.benchmark);}
        catch(error){$('sr-benchmark').textContent='Chưa tính được gợi ý: '+error.message;}
        finally{button.disabled=false;}
    }
    function suggestedGroup(inferred,custom=false) {
        return {id:custom?inferred.id+':'+Date.now().toString(36):inferred.id,name:inferred.name,
            subjectIds:inferred.evidence.filter(e=>inferred.suggestedRate===null||e.rate===null||e.rate===inferred.suggestedRate).map(e=>e.subjectId),
            currentRate:inferred.suggestedRate,baselineDate:'',baselineKind:'initial',confirmed:false,enabled:true,
            cycleMonths:null,minimumHours:null,extraMonths:null,nextReviewDate:'',hoursOverride:null,hoursMonth:'',hoursNote:'',performance:'unknown',attendance:'unknown',note:''};
    }
    async function loadPerson(id,force=false) {
        if(state.busy)return;
        if(!force&&!confirmDiscard())return;
        const epoch=++state.epoch;state.staffId=id;state.dirty=false;
        $('sr-detail').innerHTML='<div class="sr-skeleton" role="status">Đang đối chiếu giá và hồ sơ của nhân viên…</div>';directory();
        try {
            let evidence=state.cache.get(id);
            if(force||!evidence||Date.now()-evidence.cachedAt>120000){evidence=await S.loadEvidence(id);evidence.cachedAt=Date.now();state.cache.set(id,evidence);}
            if(epoch!==state.epoch)return;
            state.evidence=evidence;state.draft=clone(evidence.profile);
            state.inferred=P.inferGroups(evidence.user,state.index.subjects,evidence.monthly,{today:today(),legacySettings:evidence.legacySettings,lifecycle:DBService.getPayslipLifecycleState,rateResolver:window.SubjectRatePolicy});
            state.stats=P.statistics(id,P.previousMonths(today(),3),evidence.monthly,{lifecycle:DBService.getPayslipLifecycleState});
            if(!state.draft.revision&&!state.draft.groups.length)state.draft.groups=state.inferred.filter(g=>g.hasEvidence).map(g=>suggestedGroup(g));
            if(!state.draft.groups.some(g=>g.id===state.groupId))state.groupId=state.draft.groups[0]?.id||'';
            const index=state.index.profiles.findIndex(p=>(p.staffId||p.id)===id),profile={...evidence.profile,staffId:id};
            if(index<0)state.index.profiles.push(profile);else state.index.profiles[index]=profile;
            directory();renderPerson();
            const url=new URL(location.href);url.searchParams.set('staffId',id);history.replaceState(null,'',url);
        } catch(error) {if(epoch!==state.epoch)return;state.evidence=null;state.draft=null;$('sr-detail').innerHTML=`<div class="sr-empty"><h2>Chưa tải được hồ sơ</h2><p>${esc(error.message)}</p><button class="sr-btn" data-action="retry">Thử lại</button></div>`;message(error.message,true);}
    }
    function evidenceFor(g) {return state.inferred.find(i=>i.id===g.id)||state.inferred.find(i=>i.subjectIds.some(id=>g.subjectIds.includes(id)));}
    function collect() {
        if(!state.draft)return;
        const form=$('sr-profile-form');if(!form)return;
        const values=new FormData(form),nullable=name=>values.get(name)===''||values.get(name)===null?null:Number(values.get(name));
        state.draft.personOverrides={cycleMonths:nullable('person-cycle'),minimumHours:nullable('person-hours'),extraMonths:nullable('person-extra')};
        const g=currentGroup();if(!g)return;
        if(g.scheduledChange?.effectiveFrom>today())return;
        ['name','baselineDate','baselineKind','nextReviewDate','hoursMonth','hoursNote','performance','attendance','note'].forEach(k=>{if(values.has(k))g[k]=values.get(k);});
        ['currentRate','cycleMonths','minimumHours','extraMonths','hoursOverride'].forEach(k=>{if(values.has(k))g[k]=nullable(k);});
        g.enabled=values.has('enabled');g.confirmed=values.has('confirmed');
        // Locked future applications keep their original selection; disabled controls are not serialized.
        if(!(g.scheduledChange?.effectiveFrom>today())) {
            const lockedSelections=[...form.querySelectorAll('input[name="subjectIds"]:disabled:checked')].map(input=>input.value);
            g.subjectIds=[...new Set([...values.getAll('subjectIds'),...lockedSelections])];
        }
    }
    function renderPerson() {
        const e=state.evidence,g=currentGroup(),overrides=state.draft.personOverrides||{};
        const link=`bao-cao.html?staffId=${encodeURIComponent(state.staffId)}&date=${P.previousMonths(today(),1)[0]}-01&roleView=giao-vien`;
        $('sr-detail').innerHTML=`<header class="sr-person-head"><div><p class="sr-eyebrow">HỒ SƠ CÁ NHÂN</p><h2>${esc(e.user.name||e.user.username||state.staffId)}</h2><p class="sr-help">Giá đã nhập được đối chiếu theo môn. Lưu mốc xét chỉ tạo hồ sơ nhắc.</p></div><a class="sr-btn" href="${link}" target="_blank" rel="noopener">Mở bảng công / lương ↗</a></header>
            <form id="sr-profile-form"><details class="sr-section"><summary>Điều chỉnh riêng cho nhân viên</summary><p class="sr-help">Để trống để dùng quy định chung; nhóm môn vẫn có thể đặt riêng.</p><div class="sr-form-grid three">
                ${field('person-cycle','Chu kỳ (tháng)',overrides.cycleMonths??'','number','','min="1" max="36"')}
                ${field('person-hours','Ngưỡng giờ/tháng',overrides.minimumHours??'','number','','min="0" max="744" step="0.1"')}
                ${field('person-extra','Hẹn lại sau (tháng)',overrides.extraMonths??'','number','','min="1" max="12"')}</div></details>
            <div class="sr-group-tabs" role="tablist" aria-label="Nhóm môn">${state.draft.groups.map(group=>`<button type="button" role="tab" class="sr-group-tab" aria-selected="${group.id===state.groupId}" data-group="${esc(group.id)}">${esc(group.name)}</button>`).join('')}</div>
            <section class="sr-section"><div class="sr-toolbar"><label for="sr-add-group" class="sr-help">Thêm nhóm / tách ngoại lệ</label><select id="sr-add-group" style="flex:1;min-width:160px" aria-label="Nhóm môn để thêm"><option value="">Chọn folder môn…</option>${state.inferred.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select><button type="button" class="sr-btn" data-action="add">Thêm</button></div></section>
            ${g?groupPanel(g):'<div class="sr-empty"><h3>Chưa có nhóm môn</h3><p>Thêm folder môn để xác nhận mức lương và mốc xét riêng.</p></div>'}
            <div class="sr-savebar"><small id="sr-save-note">${state.dirty?'Có thay đổi chưa lưu':'Lưu mốc xét không thay đổi giá tính lương.'}</small><button type="submit" class="sr-btn sr-btn-primary">Lưu hồ sơ & mốc xét</button></div></form>
            <section class="sr-section"><h3>Lịch sử xử lý</h3>${historyPanel(e.history)}</section>`;
        if(g?.scheduledChange?.effectiveFrom>today())document.querySelectorAll('[data-sr-group-fields] input,[data-sr-group-fields] select,[data-sr-group-fields] textarea').forEach(el=>el.disabled=true);
    }
    function groupPanel(g) {
        const inferred=evidenceFor(g),evaluation=statusFor(g,state.draft,state.stats),future=g.scheduledChange?.effectiveFrom>today();
        const evidence=[...(inferred?.evidence||[])];
        for(const id of g.subjectIds)if(!evidence.some(row=>row.subjectId===id)) {
            const recorded=state.inferred.flatMap(i=>i.evidence).find(row=>row.subjectId===id);
            evidence.push(recorded||{subjectId:id,name:state.index.subjects.find(s=>s.id===id)?.name||('Môn đã đổi / xóa: '+id),rate:null});
        }
        const occupied=new Set(state.draft.groups.filter(other=>other.id!==g.id&&other.enabled).flatMap(other=>other.subjectIds));
        const conflictDetails=row=>row.contradictions?.length?`<details><summary>Mâu thuẫn nguồn</summary>${row.contradictions.map(item=>`<div>${esc(sourceLabels[item.source]||'Nguồn khác')} ${esc(item.month||'')}: ${money(item.rate)}</div>`).join('')}</details>`:'';
        return `<section class="sr-section" data-sr-group-fields><div class="sr-toolbar"><h3 style="margin:0">${esc(g.name)}</h3><span class="sr-badge ${evaluation.state==='setup'||evaluation.visibleThisMonth?'attention':''}">${future?'Mức mới chờ hiệu lực':esc(evaluation.label)}</span>${evaluation.dueDate?`<span class="sr-help">Hạn xét: ${esc(evaluation.dueDate)}</span>`:''}</div>
            ${future?`<p class="sr-hint">Đã duyệt ${money(g.currentRate)}/giờ từ ${esc(g.scheduledChange.effectiveFrom)}. Mức trước: ${money(g.scheduledChange.previousGroup?.currentRate)}. Cần đổi mức hoặc phạm vi: hủy quyết định đang chờ trước.</p>`:''}
            <p class="sr-help">Chọn đúng môn thuộc mức này. Có thể tách môn khác giá thành nhóm riêng. Giá lớp ghép / đông học sinh được giữ nguyên.</p>
            ${inferred?.mixedRates||inferred?.contradictions.length?'<p class="sr-hint sr-error">Folder có giá khác nhau hoặc nguồn mâu thuẫn. Kiểm tra từng môn trước khi xác nhận; hệ thống không gộp những giá này.</p>':''}
            <div class="sr-evidence"><table class="sr-table"><thead><tr><th>Phạm vi môn</th><th class="num">Giá ghi nhận / giờ</th><th>Nguồn gần nhất</th></tr></thead><tbody>${evidence.map(row=>`<tr><td><label class="sr-check"><input type="checkbox" name="subjectIds" value="${esc(row.subjectId)}" ${g.subjectIds.includes(row.subjectId)?'checked':''} ${future||occupied.has(row.subjectId)?'disabled':''}><span>${esc(row.name)}${occupied.has(row.subjectId)?'<small> · Đã thuộc nhóm khác</small>':''}</span></label></td><td class="num">${money(row.rate)}</td><td>${esc(sourceLabels[row.source]||'Chưa xác định')} ${esc(row.month||'')}${row.ambiguous?' · Tên môn trùng':''}${conflictDetails(row)}</td></tr>`).join('')}</tbody></table></div>
            ${inferred?.observedSince?`<p class="sr-help">Thấy mức này liên tục từ ${esc(inferred.observedSince)} trong dữ liệu hiện có. Đây không phải bằng chứng ngày tăng gần nhất.</p>`:''}
            ${inferred?.specialEvidence.length?`<details class="sr-hint"><summary>${inferred.specialEvidence.length} giá lớp ghép / đông học sinh được giữ riêng</summary>${inferred.specialEvidence.map(row=>`<div>${esc(row.name)}: ${money(row.rate)} (${esc(row.month||'cấu hình')})</div>`).join('')}</details>`:''}
            <div class="sr-form-grid">
                ${field('name','Tên nhóm xét',g.name,'text','Có thể thêm “ngoại lệ” để dễ nhận biết.','required maxlength="180"')}
                ${field('currentRate',future?'Mức đã duyệt (đ/giờ)':'Mức hiện tại xác nhận (đ/giờ)',g.currentRate??'','number','Ví dụ 32.000 đ: nhập 32000. Đây là mốc theo dõi.','min="0" max="10000000" step="1" '+(future?'readonly':''))}
                ${select('baselineKind','Loại mốc',g.baselineKind||'initial',[['initial','Mốc bắt đầu xét do Admin xác nhận'],['increase','Ngày tăng lương gần nhất']])}
                ${field('baselineDate','Ngày mốc xét',g.baselineDate||'','date','Nếu không biết ngày tăng cũ, chọn mốc bắt đầu xét. Không tự suy từ tháng có giá.',future?'readonly':'max="'+today()+'"')}
                ${field('cycleMonths','Chu kỳ riêng (tháng)',g.cycleMonths??'','number',`Để trống: hiện dùng ${evaluation.months} tháng.`,'min="1" max="36"')}
                ${field('minimumHours','Ngưỡng giờ riêng / tháng',g.minimumHours??'','number',`Để trống: ${evaluation.threshold==null?'chưa có ngưỡng chung':number(evaluation.threshold)+' giờ'}.`,'min="0" max="744" step="0.1"')}
                ${field('extraMonths','Gợi ý hẹn lại (tháng)',g.extraMonths??'','number','Để trống để kế thừa.','min="1" max="12"')}
                ${field('nextReviewDate','Ngày hẹn xét lại (nếu có)',g.nextReviewDate||'','date','Chỉ dùng nếu muộn hơn hạn tính từ mốc.')}
                <label class="sr-check"><input name="confirmed" type="checkbox" ${g.confirmed?'checked':''}>Tôi đã kiểm tra giá, phạm vi và mốc xét</label><label class="sr-check"><input name="enabled" type="checkbox" ${g.enabled!==false?'checked':''}>Bật nhắc xét cho nhóm này</label>
            </div></section>
            <section class="sr-section" data-sr-group-fields><h3>Căn cứ đánh giá</h3><p class="sr-help">Giờ dưới đây là tổng giờ dạy của nhân viên trong 3 tháng đã kết thúc, không phải riêng folder. Chuyên cần và hiệu suất do Admin xác nhận.</p>
            <div class="sr-evidence"><table class="sr-table"><thead><tr><th>Tháng</th><th class="num">Giờ từ phiếu đã gửi / nhận</th></tr></thead><tbody>${state.stats.rows.map(row=>`<tr><td>${row.month}</td><td class="num">${row.hours===null?'Thiếu phiếu / giờ hợp lệ':number(row.hours)}</td></tr>`).join('')}</tbody></table></div>
            <p class="sr-hint">${state.stats.complete?'Bình quân: '+number(state.stats.averageHours)+' giờ/tháng.':'Chưa đủ 3 tháng để kết luận giờ bình quân. Không dùng tháng thiếu làm 0 giờ.'} ${evaluation.low?'Ít giờ hơn ngưỡng tham khảo; có thể hẹn lại nhưng không tự hoãn.':''} ${evaluation.suggestedDeferUntil?'Gợi ý ngày xét lại: '+evaluation.suggestedDeferUntil+'.':''}</p>
            ${evaluation.manualHoursStale?'<p class="sr-hint sr-error">Giờ Admin xác nhận thuộc kỳ cũ. Hệ thống không dùng số này cho kỳ hiện tại; hãy xác nhận lại khi cần.</p>':''}
            <div class="sr-form-grid">${select('performance','Đánh giá hiệu suất',g.performance||'unknown',[['unknown','Chưa đánh giá'],['pass','Đạt'],['review','Cần xem xét']])}${select('attendance','Đánh giá chuyên cần',g.attendance||'unknown',[['unknown','Chưa đánh giá'],['pass','Đạt'],['review','Cần xem xét']])}
            ${field('hoursOverride','Bình quân giờ Admin xác nhận',g.hoursOverride??'','number','Để trống để dùng dữ liệu đủ 3 tháng. Đây là giờ/tháng.','min="0" max="744" step="0.1"')}
            ${field('hoursMonth','Kỳ xác nhận giờ (tháng kết thúc)',g.hoursMonth||'','month','Chỉ dùng cho lần xét ngay sau kỳ này.','max="'+P.previousMonths(today(),1)[0]+'"')}
            ${area('hoursNote','Nguồn / cách xác nhận giờ',g.hoursNote||'','Ví dụ: bình quân 3 tháng theo bảng công bổ sung, gồm giờ chưa có trên hệ thống.')}
            ${area('note','Đánh giá, ngoại lệ và thông tin còn thiếu',g.note||'')}</div>
            <div class="sr-actions"><button type="button" class="sr-btn sr-btn-primary" data-action="approve">Xét mức mới…</button><button type="button" class="sr-btn" data-action="deferred">Hẹn xét lại…</button><button type="button" class="sr-btn" data-action="not_increased">Chưa tăng…</button>${future?'<button type="button" class="sr-btn sr-btn-danger" data-action="cancel">Hủy mức chờ hiệu lực…</button>':''}<button type="button" class="sr-btn" data-action="remove">Bỏ nhóm khỏi hồ sơ</button></div><p class="sr-help">Lưu hồ sơ trước khi ra quyết định. Duyệt mức mới chỉ áp dụng từ tháng tương lai được chọn; có thể hủy trước ngày hiệu lực khi bảng lương tháng đó chưa được tính.</p></section>`;
    }
    function historyPanel(rows) {
        const auditDate=value=>{const date=value?.toDate?value.toDate():new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(date):'';};
        const actorName=row=>state.index.users.find(user=>user.id===row.actorUserId)?.name||row.actorUserId||row.actorUid||'Admin';
        return rows.length?`<ol class="sr-history">${rows.map(row=>`<li><strong>${esc(decisionLabels[row.kind]||row.kind)}</strong>${row.groupName?' · '+esc(row.groupName):''}<br><small>${esc(auditDate(row.recordedAt||row.createdAt))} · ${esc(actorName(row))}</small>${row.reason?`<div>${esc(row.reason)}</div>`:''}${row.effectiveFrom?`<div>Hiệu lực: ${esc(row.effectiveFrom)}</div>`:''}${row.nextReviewDate?`<div>Hẹn lại: ${esc(row.nextReviewDate)}</div>`:''}</li>`).join('')}</ol>`:'<p class="sr-help">Chưa có quyết định. Mọi lần lưu và xét duyệt được ghi lại ở đây.</p>';
    }
    async function saveProfile() {
        collect();await S.saveProfile(state.staffId,state.draft,state.evidence.profile.revision,state.index.subjects);
        state.dirty=false;await refreshSelected();message('Đã lưu hồ sơ và mốc nhắc xét. Giá tính lương hiện có được giữ nguyên.');
    }
    async function refreshSelected() {
        // Called while a write is held; loadPerson itself rejects concurrent navigation.
        const id=state.staffId;state.cache.delete(id);const held=state.busy;state.busy=false;
        try {await loadPerson(id,true);} finally {state.busy=held;}
    }
    function openDialog(body) {
        $('sr-dialog-content').innerHTML=body+'<p id="sr-dialog-error" class="sr-error" role="alert"></p>';
        if(!$('sr-dialog').open)$('sr-dialog').showModal();
    }
    function closeDialog() {if(!state.busy)$('sr-dialog').close();}
    function requireSaved() {
        if(state.dirty||!state.evidence.profile.revision)throw Error('Hãy lưu hồ sơ trước khi xét duyệt.');
        const g=currentGroup();if(!g?.confirmed||!g.enabled)throw Error('Cần xác nhận mốc và bật nhóm trước khi xét.');
        return g;
    }
    function decisionDialog(kind) {
        const g=requireSaved();if(g.scheduledChange?.effectiveFrom>today()&&kind!=='cancel')throw Error('Nhóm đã có mức chờ hiệu lực. Hủy quyết định đó trước khi xét tiếp.');
        const evaluation=statusFor(g,state.draft,state.stats),title=kind==='cancel'?'Hủy mức chờ hiệu lực':kind==='deferred'?'Hẹn xét lại':'Ghi nhận chưa tăng lương';
        openDialog(`<h2 id="sr-dialog-title">${title}</h2><p class="sr-help">${esc(state.evidence.user.name)} · ${esc(g.name)}</p><form id="sr-decision-form" data-kind="${kind}"><div class="sr-form-grid">${kind==='cancel'?'<p class="sr-hint sr-wide">Khôi phục đúng giá trước quyết định nếu chưa có người chỉnh tiếp hoặc tính lương tháng đích. Mốc và quyết định trước vẫn có lịch sử.</p>':field('decision-date','Ngày xét tiếp',evaluation.suggestedDeferUntil||P.addMonths(today(),1),'date','','required')}${area('decision-reason','Lý do',g.note||'')}</div><div class="sr-actions"><button class="sr-btn" type="button" data-close>Quay lại</button><button class="sr-btn sr-btn-primary" type="submit">Xác nhận</button></div></form>`);
    }
    function approvalDialog() {
        const g=requireSaved();if(g.scheduledChange?.effectiveFrom>today())throw Error('Đã có mức chờ hiệu lực. Hủy quyết định đó trước khi đổi.');
        const minimum=P.addMonths(today().slice(0,7)+'-01',1).slice(0,7),next=P.LADDER.find(rate=>rate>g.currentRate);
        const selection=g.subjectIds.map(id=>{
            const row=state.inferred.flatMap(i=>i.evidence).find(e=>e.subjectId===id),name=row?.name||state.index.subjects.find(s=>s.id===id)?.name||id;
            const checked=!row?.ambiguous&&!row?.contradictions?.length&&(row?.rate==null||row.rate===g.currentRate);
            return `<label class="sr-check"><input type="checkbox" name="approval-subject" value="${esc(id)}" ${checked?'checked':''}><span>${esc(name)} · ${money(row?.rate)}${checked?'':' · Kiểm tra mức riêng'}</span></label>`;
        }).join('');
        openDialog(`<h2 id="sr-dialog-title">Xét mức mới</h2><p class="sr-help">${esc(state.evidence.user.name)} · ${esc(g.name)}</p><p class="sr-hint">Thang tham khảo: 30–32–34–36–38–40–42–48–50–52–54–56 nghìn đ/giờ. Admin nhập mức thực tế; hệ thống chỉ đổi giá khi bạn xem và duyệt bản đối chiếu.</p><form id="sr-approval-form"><div class="sr-form-grid">${field('new-rate','Mức mới (đ/giờ)',next||'','number','Mức đang theo dõi: '+money(g.currentRate),'min="1" max="10000000" step="1" required')}${field('target-month','Tháng bắt đầu áp dụng',minimum,'month','Áp dụng từ ngày 01; không sửa tháng đã tính lương.','min="'+minimum+'" required')}${area('approval-reason','Nhận xét / lý do duyệt',g.note||'')}</div><h3 style="font-size:1rem">Môn nhận mức mới</h3><div class="sr-hint">${selection}</div><p class="sr-help">Môn bỏ chọn giữ nguyên giá và tách khỏi nhóm xét này khi duyệt. Bạn có thể thêm nhóm ngoại lệ để theo dõi riêng; hủy quyết định sẽ khôi phục phạm vi cũ.</p><div class="sr-actions"><button class="sr-btn" type="button" data-close>Quay lại</button><button type="submit" class="sr-btn sr-btn-primary">Xem giá trước khi duyệt</button></div></form>`);
    }
    function previewDialog(prepared) {
        const p=prepared.preview,g=currentGroup();
        const omitted=g.subjectIds.length-p.changes.length;
        openDialog(`<h2 id="sr-dialog-title">Kiểm tra và duyệt</h2><p class="sr-help">${esc(state.evidence.user.name)} · ${esc(g.name)} · Hiệu lực ${esc(p.effectiveFrom)}</p><div class="sr-evidence"><table class="sr-table"><thead><tr><th>Môn</th><th class="num">Trước</th><th class="num">Sau</th></tr></thead><tbody>${p.changes.map(row=>`<tr><td>${esc(row.name)}</td><td class="num">${money(row.beforeRate)}</td><td class="num">${money(row.afterRate)}</td></tr>`).join('')}</tbody></table></div><p class="sr-hint">${p.preserved.length} giá khác được giữ nguyên, gồm giá kế thừa cần thiết cho các nhóm môn còn lại. Phiếu đã tính / đã gửi và công chấm cũ không thay đổi.${omitted?' '+omitted+' môn bỏ chọn sẽ tách khỏi nhóm xét này, giá vẫn giữ nguyên.':''}</p>${p.warnings?.length?`<p class="sr-hint sr-error">${p.warnings.map(w=>esc(w.message||w)).join('<br>')}</p>`:''}<details><summary>Xem các giá được giữ</summary><div class="sr-evidence"><table class="sr-table"><tbody>${p.preserved.map(row=>`<tr><td>${esc(row.name)}</td><td class="num">${money(row.rate)}</td></tr>`).join('')}</tbody></table></div></details><div class="sr-actions"><button type="button" class="sr-btn" data-close>Quay lại</button><button type="button" class="sr-btn sr-btn-primary" id="sr-apply">Duyệt & áp dụng từ ${esc(p.targetMonth)}</button></div>`);
        $('sr-apply').addEventListener('click',()=>write(async()=>{await S.applyApplication(prepared);state.dirty=false;$('sr-dialog').close();await refreshSelected();message('Đã duyệt mức mới từ '+p.effectiveFrom+'. Lịch sử và các giá ngoài phạm vi đã được giữ lại.');}));
    }
    async function handleAction(action) {
        if(state.busy)return;
        try {
            if(action==='retry')return await loadPerson(state.staffId,true);
            if(action==='add') {
                collect();const inferred=state.inferred.find(g=>g.id===$('sr-add-group').value);if(!inferred)return;
                const group=suggestedGroup(inferred,true),occupied=new Set(state.draft.groups.filter(g=>g.enabled).flatMap(g=>g.subjectIds));
                group.subjectIds=group.subjectIds.filter(id=>!occupied.has(id));state.draft.groups.push(group);state.groupId=group.id;markDirty();renderPerson();return;
            }
            if(action==='remove') {
                collect();const g=currentGroup();if(g.scheduledChange?.effectiveFrom>today())throw Error('Hủy mức chờ hiệu lực trước khi bỏ nhóm.');
                if(!window.confirm('Bỏ nhóm này khỏi hồ sơ nhắc xét? Giá tính lương không bị xóa.'))return;
                state.draft.groups=state.draft.groups.filter(other=>other.id!==g.id);state.groupId=state.draft.groups[0]?.id||'';markDirty();renderPerson();return;
            }
            if(action==='approve')approvalDialog();else decisionDialog(action);
        }catch(error){message(error.message,true);}
    }
    async function initialize() {
        if(state.busy||state.loading||!confirmDiscard())return;
        if(window.SalaryReviewOverview?.hasPendingChanges()) { message('Tổng quan có thay đổi chưa lưu. Hoàn tất thao tác ở đó trước khi tải lại.',true); return; }
        state.loading=true;document.querySelector('.sr-page').inert=true;
        const epoch=++state.epoch;
        try {
            message('Đang tải danh mục và các mốc xét…');
            if(typeof window.waitAuth==='function'&&!await window.waitAuth())throw Error('Chưa khôi phục được phiên đăng nhập. Vui lòng đăng nhập lại.');
            if(epoch!==state.epoch)return;
            const index=await S.loadIndex();if(epoch!==state.epoch)return;
            state.index=index;state.month=today().slice(0,7);state.cache.clear();renderSettings();directory();
            window.dispatchEvent(new CustomEvent('salary-review-index-loaded', {detail:index}));
            message('Hệ thống chỉ nhắc xét. Admin xác nhận mốc, đánh giá và duyệt mức mới cho từng nhóm môn.');
            const requested=state.staffId||new URLSearchParams(location.search).get('staffId');
            if(requested&&index.users.some(u=>u.id===requested&&P.isTeacher(u)))await loadPerson(requested,true);
            if(index.config.minimumHours===null)await benchmark();
        }catch(error){message('Chưa tải được dữ liệu: '+error.message,true);}
        finally{state.loading=false;document.querySelector('.sr-page').inert=state.busy;}
    }
    $('sr-list').addEventListener('click',e=>{const button=e.target.closest('[data-person]');if(button)loadPerson(button.dataset.person);});
    window.addEventListener('salary-review-open-person',e=>loadPerson(e.detail,true));
    window.addEventListener('salary-review-profiles-changed',e=>{
        if(!state.index)return;
        state.cache.delete(e.detail.staffId);
        directory();
    });
    $('sr-search').addEventListener('input',()=>state.index&&directory());$('sr-filter').addEventListener('change',()=>state.index&&directory());
    $('sr-refresh').addEventListener('click',initialize);
    $('sr-settings-form').addEventListener('submit',e=>{e.preventDefault();const values={cycleMonths:Number($('sr-global-cycle').value),minimumHours:Number($('sr-global-hours').value),extraMonths:Number($('sr-global-extra').value)};write(async()=>{await S.saveSettings(values,state.index.config.revision);state.index.config={...state.index.config,...values,revision:Number(state.index.config.revision||0)+1};renderSettings();directory();if(state.draft){collect();renderPerson();}message('Đã lưu quy định chung. Những điều chỉnh riêng vẫn được ưu tiên.');});});
    $('sr-settings-form').addEventListener('click',e=>{if(e.target.closest('#sr-calculate')&&!state.busy)benchmark();});
    $('sr-detail').addEventListener('input',e=>{if(e.target.closest('#sr-profile-form')&&!e.target.closest('#sr-add-group'))markDirty();});
    $('sr-detail').addEventListener('change',e=>{if(e.target.closest('#sr-profile-form')&&!e.target.closest('#sr-add-group'))markDirty();});
    $('sr-detail').addEventListener('submit',e=>{if(e.target.id==='sr-profile-form'){e.preventDefault();write(saveProfile);}});
    $('sr-detail').addEventListener('click',e=>{const tab=e.target.closest('[data-group]'),button=e.target.closest('[data-action]');if(tab&&!state.busy){collect();state.groupId=tab.dataset.group;renderPerson();}if(button)handleAction(button.dataset.action);});
    $('sr-dialog').addEventListener('cancel',e=>{if(state.busy)e.preventDefault();});
    $('sr-dialog').addEventListener('click',e=>{if(e.target.closest('[data-close]'))closeDialog();});
    $('sr-dialog').addEventListener('submit',e=>{
        e.preventDefault();const form=e.target,g=currentGroup();if(!g)return;
        if(form.id==='sr-decision-form')write(async()=>{const reason=$('sr-decision-reason').value;if(form.dataset.kind==='cancel')await S.cancelApplication(state.staffId,g.id,reason,state.evidence.profile.revision);else await S.decide(state.staffId,g.id,{kind:form.dataset.kind,reason,nextReviewDate:$('sr-decision-date').value},state.evidence.profile.revision);$('sr-dialog').close();await refreshSelected();message('Đã lưu quyết định và lịch xét tiếp.');});
        if(form.id==='sr-approval-form')write(async()=>{const prepared=await S.prepareApplication(state.staffId,g.id,{newRate:Number($('sr-new-rate').value),targetMonth:$('sr-target-month').value,selectedSubjectIds:new FormData(form).getAll('approval-subject'),reason:$('sr-approval-reason').value},state.evidence.profile.revision);previewDialog(prepared);});
    });
    window.addEventListener('beforeunload',e=>{if(state.dirty||state.busy){e.preventDefault();e.returnValue='';}});
    const resumeMonth=()=>{
        if(document.visibilityState==='hidden'||!state.index||state.loading||state.month===today().slice(0,7))return;
        if(state.dirty||state.busy){message('Đã sang tháng mới. Lưu phần đang nhập rồi tải lại để cập nhật kỳ xét.');return;}
        initialize();
    };
    document.addEventListener('visibilitychange',resumeMonth);window.addEventListener('pageshow',resumeMonth);
    initialize();
})();
