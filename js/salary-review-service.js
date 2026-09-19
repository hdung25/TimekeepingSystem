/* Explicit Admin commands only. Reading a review never changes payroll or attendance. */
(function (root) {
    'use strict';
    const P = () => root.SalaryReviewPolicy;
    const D = () => typeof DBService !== 'undefined' ? DBService : root.DBService;
    const database = () => typeof db !== 'undefined' ? db : root.db;
    const A = () => root.SalaryReviewApplication;
    const SETTINGS = 'salary_review_settings', PROFILES = 'salary_review_profiles';
    const defaults = {schemaVersion:1,revision:0,cycleMonths:3,minimumHours:null,extraMonths:1};
    const stable = value => JSON.stringify(canonical(value));
    function canonical(v) {
        if(v && typeof v.toMillis==='function')return {timestamp:v.toMillis()};
        return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
    }
    function text(value,max=2000){return String(value??'').trim().slice(0,max);}
    function nullable(value,min,max,label){if(value===''||value==null)return null;const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw Error(label+' không hợp lệ.');return n;}
    function integer(value,min,max,label){const n=nullable(value,min,max,label);if(n!==null&&!Number.isInteger(n))throw Error(label+' phải là số nguyên.');return n;}
    async function admin() {
        const auth = await D().getAuthenticatedAuthorizationContext(true);
        if(!auth.roles.includes('admin'))throw Error('Chỉ quản trị viên chính được quản lý xét tăng lương.');
        return auth;
    }
    const document = (collection,id) => database().collection(collection).doc(id);
    async function read(ref){const snap=await ref.get({source:'server'});return snap.exists?snap.data():null;}
    async function all(collection) {
        const field=root.firebase.firestore.FieldPath.documentId();let cursor=null,items=[];
        for(;;){let q=database().collection(collection).orderBy(field).limit(150);if(cursor)q=q.startAfter(cursor);
            const page=await q.get({source:'server'});items.push(...page.docs.map(d=>({...d.data(),id:d.id})));
            if(page.size<150)return items;cursor=page.docs.at(-1);
        }
    }
    async function limited(items,fn,width=4){const results=new Array(items.length);let index=0;
        await Promise.all(Array.from({length:Math.min(width,items.length)},async()=>{for(;;){const i=index++;if(i>=items.length)return;results[i]=await fn(items[i],i);}}));return results;}
    function settings(raw={}) {return {...defaults,...raw};}
    function checkRevision(actual,expected){if(Number(actual?.revision||0)!==Number(expected||0))throw Error('Hồ sơ vừa được sửa ở phiên khác. Tải lại trước khi lưu.');}
    function normalizeOverrides(raw={}) {
        return {cycleMonths:integer(raw.cycleMonths,1,36,'Chu kỳ'),minimumHours:nullable(raw.minimumHours,0,744,'Ngưỡng giờ'),extraMonths:integer(raw.extraMonths,1,12,'Số tháng hẹn lại')};
    }
    function normalizeGroup(raw,catalog,today) {
        const ids=[...new Set((raw.subjectIds||[]).map(String))];
        if(!raw.id||!raw.name||ids.length===0||ids.length>100)throw Error('Chọn ít nhất một môn cho nhóm xét.');
        const map=new Map(catalog.filter(s=>s.isGroup!==true).map(s=>[s.id,s]));
        if(ids.some(id=>!map.has(id)))throw Error('Danh mục môn đã đổi. Tải lại trước khi lưu.');
        const currentRate=integer(raw.currentRate,0,10000000,'Mức hiện tại');
        const baselineDate=text(raw.baselineDate,10), nextReviewDate=text(raw.nextReviewDate,10);
        if(baselineDate&&!P().validDate(baselineDate))throw Error('Mốc xét không hợp lệ.');
        // Future dates are accepted only when the transaction verifies an
        // unchanged approved scheduled application, never as a new baseline.
        if(nextReviewDate&&!P().validDate(nextReviewDate))throw Error('Ngày hẹn lại không hợp lệ.');
        if(raw.confirmed&&(currentRate===null||!baselineDate))throw Error('Nhập mức hiện tại và mốc xét trước khi bật nhắc.');
        const hoursOverride=nullable(raw.hoursOverride,0,744,'Giờ xác nhận');
        const hoursMonth=text(raw.hoursMonth,7);
        if(hoursOverride!==null&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(hoursMonth)||!text(raw.hoursNote)))throw Error('Giờ nhập tay cần kỳ xác nhận và ghi chú nguồn.');
        if(hoursOverride!==null&&hoursMonth>P().previousMonths(today,1)[0])throw Error('Chỉ xác nhận giờ của tháng đã kết thúc.');
        return {id:text(raw.id,150),name:text(raw.name,180),subjectIds:ids,currentRate,
            baselineDate,baselineKind:raw.baselineKind==='increase'?'increase':'initial',lastIncreaseDate:raw.baselineKind==='increase'?baselineDate:'',
            confirmed:raw.confirmed===true,enabled:raw.enabled!==false,...normalizeOverrides(raw),nextReviewDate,
            hoursOverride,hoursMonth,hoursNote:text(raw.hoursNote),note:text(raw.note),
            performance:['pass','review','unknown'].includes(raw.performance)?raw.performance:'unknown',
            attendance:['pass','review','unknown'].includes(raw.attendance)?raw.attendance:'unknown'};
    }
    async function loadIndex() {
        await admin();
        const [users,subjects,profiles,config] = await Promise.all([all('users'),all('subjects'),all(PROFILES),read(document(SETTINGS,'default'))]);
        // Do not expose compatibility credential fields to the UI state.
        users.forEach(u=>{delete u.password;delete u.authUid;});
        return {users,subjects,profiles,config:settings(config||{})};
    }
    async function loadEvidence(staffId,today=P().dateKey()) {
        await admin();
        const months=[today.slice(0,7),...P().previousMonths(today,6)];
        const [user,legacySettings,monthly,profile,history] = await Promise.all([
            read(document('users',staffId)),read(document('salary_settings',staffId)),
            limited(months,async month=>({id:month+'_'+staffId,...(await read(document('salary_settings_monthly',month+'_'+staffId))||{})})),
            read(document(PROFILES,staffId)),document(PROFILES,staffId).collection('history').orderBy('createdAt','desc').limit(15).get({source:'server'})
        ]);
        if(!user)throw Error('Không tìm thấy nhân viên.');
        delete user.password;delete user.authUid;
        return {user:{...user,id:staffId},legacySettings:legacySettings||{},monthly,profile:profile||{revision:0,groups:[],personOverrides:{}},
            history:history.docs.map(d=>({...d.data(),id:d.id})),loadedAt:new Date().toISOString()};
    }
    async function calculateBenchmark(users,today=P().dateKey()) {
        await admin();const month=P().previousMonths(today,1)[0];
        const result=await D().getAllMonthlySalarySettings(month,{strict:true});
        const monthly=Object.entries(result).map(([staffId,data])=>({...data,id:month+'_'+staffId}));
        return P().benchmark(users,monthly,today,{lifecycle:D().getPayslipLifecycleState});
    }
    async function saveSettings(raw,expectedRevision) {
        const actor=await admin();const values=normalizeOverrides(raw);
        if(values.cycleMonths===null||values.extraMonths===null||values.minimumHours===null)throw Error('Nhập đủ cấu hình chung; ngưỡng 0 nghĩa là không cảnh báo ít giờ.');
        const ref=document(SETTINGS,'default'), audit=ref.collection('history').doc();
        await database().runTransaction(async tx=>{
            const snap=await tx.get(ref),before=snap.exists?snap.data():{};checkRevision(before,expectedRevision);
            const after={schemaVersion:1,...values,revision:Number(before.revision||0)+1,updatedAt:new Date().toISOString(),updatedBy:actor.uid,lastHistoryId:audit.id};
            tx.set(ref,after);tx.set(audit,{kind:'settings',before,after,revision:after.revision,createdAt:after.updatedAt,recordedAt:serverTimestamp(),actorUid:actor.uid,actorUserId:actor.userId});
        });
    }
    async function saveProfile(staffId,raw,expectedRevision,catalog) {
        const actor=await admin(),today=P().dateKey();
        const groups=(raw.groups||[]).map(g=>normalizeGroup(g,catalog,today));
        if(groups.length>40||new Set(groups.map(g=>g.id)).size!==groups.length)throw Error('Danh sách nhóm xét bị trùng hoặc quá dài.');
        const occupied=new Set();for(const g of groups.filter(g=>g.enabled))for(const id of g.subjectIds){if(occupied.has(id))throw Error('Một môn không được nằm trong hai nhóm xét đang bật.');occupied.add(id);}
        const ref=document(PROFILES,staffId),userRef=document('users',staffId),audit=ref.collection('history').doc();
        await database().runTransaction(async tx=>{
            const subjectIds=[...new Set(groups.flatMap(g=>g.subjectIds))];
            const [snap,userSnap,...subjectSnapshots]=await Promise.all([tx.get(ref),tx.get(userRef),...subjectIds.map(id=>tx.get(document('subjects',id)))]);
            if(!userSnap.exists)throw Error('Nhân viên không còn tồn tại.');
            if(subjectSnapshots.some(s=>!s.exists||s.data().isGroup===true))throw Error('Danh mục môn đã thay đổi. Tải lại trước khi lưu.');
            const before=snap.exists?snap.data():{};checkRevision(before,expectedRevision);
            // Preserve approved future applications when editing review metadata.
            const merged=groups.map(g=>{
                const previous=(before.groups||[]).find(old=>old.id===g.id);
                if(previous?.scheduledChange && previous.scheduledChange.effectiveFrom>today){
                    if(stable(g)!==stable(normalizeGroup(previous,catalog,today)))throw Error('Nhóm đã có mức mới chờ hiệu lực. Hủy quyết định đó trước khi sửa nhóm.');
                    return previous; // Keep the cancellation audit's exact group snapshot.
                }
                if(g.baselineDate>today&&!(previous?.scheduledChange?.effectiveFrom>today&&g.baselineDate===previous.baselineDate))throw Error('Mốc xác nhận ban đầu không được nằm trong tương lai.');
                return {...g,...(previous?.scheduledChange?{scheduledChange:previous.scheduledChange}:{}),...(previous?.lastDecisionId?{lastDecisionId:previous.lastDecisionId}:{})};
            });
            if((before.groups||[]).some(g=>g.scheduledChange?.effectiveFrom>today&&!merged.some(n=>n.id===g.id)))throw Error('Không thể xóa nhóm có quyết định đang chờ hiệu lực.');
            const after={schemaVersion:1,staffId,staffName:userSnap.data().name||staffId,revision:Number(before.revision||0)+1,
                personOverrides:normalizeOverrides(raw.personOverrides),groups:merged,updatedAt:new Date().toISOString(),updatedBy:actor.uid,lastHistoryId:audit.id};
            tx.set(ref,after);tx.set(audit,{kind:'profile',before,after,revision:after.revision,createdAt:after.updatedAt,recordedAt:serverTimestamp(),actorUid:actor.uid,actorUserId:actor.userId});
        });
    }
    async function decide(staffId,groupId,command,expectedRevision) {
        const actor=await admin();
        if(!['deferred','not_increased'].includes(command.kind))throw Error('Quyết định không hợp lệ.');
        if(!text(command.reason)||!P().validDate(command.nextReviewDate)||command.nextReviewDate<=P().dateKey())throw Error('Nhập lý do và ngày hẹn lại trong tương lai.');
        const ref=document(PROFILES,staffId),audit=ref.collection('history').doc();
        await database().runTransaction(async tx=>{
            const snap=await tx.get(ref);const before=snap.exists?snap.data():{};checkRevision(before,expectedRevision);
            const groups=(before.groups||[]).map(g=>({...g})),group=groups.find(g=>g.id===groupId);
            if(!group)throw Error('Không tìm thấy nhóm xét.');
            if(group.scheduledChange?.effectiveFrom>P().dateKey())throw Error('Nhóm đã có mức mới chờ hiệu lực. Hủy quyết định trước khi xét tiếp.');
            group.nextReviewDate=command.nextReviewDate;group.lastDecisionId=audit.id;
            const createdAt=new Date().toISOString();
            const revision=Number(before.revision||0)+1;
            tx.update(ref,{groups,revision,updatedAt:createdAt,updatedBy:actor.uid,lastHistoryId:audit.id});
            tx.set(audit,{kind:command.kind,groupId,groupName:group.name,reason:text(command.reason),nextReviewDate:command.nextReviewDate,
                beforeGroup:(before.groups||[]).find(g=>g.id===groupId),afterGroup:group,actorUid:actor.uid,actorUserId:actor.userId,createdAt,revision,recordedAt:serverTimestamp()});
        });
    }

    function serverTimestamp(){return root.firebase.firestore.FieldValue.serverTimestamp();}
    function sourceChanged(){throw Error('Nguồn giá hoặc hồ sơ vừa thay đổi. Tải lại và xem trước mức mới trước khi duyệt.');}
    function userSource(user) {
        if(!user)return null;
        return {salary_config:user.salary_config||{},role:user.role||'',roles:user.roles||[],
            active:user.active??null,isActive:user.isActive??null,status:user.status||''};
    }
    function catalogSource(catalog) {
        return catalog.map(s=>({id:s.id,name:s.name||'',parentId:s.parentId??null,isGroup:s.isGroup===true}))
            .sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    }
    function confirmedGroup(profile,groupId,today) {
        const group=(profile?.groups||[]).find(g=>g.id===groupId);
        if(!group||!group.confirmed||group.enabled===false)throw Error('Xác nhận mốc và bật nhóm xét trước khi duyệt mức mới.');
        if(group.scheduledChange?.effectiveFrom>today)throw Error('Nhóm đã có mức mới chờ hiệu lực. Hủy quyết định đó trước khi xét tiếp.');
        return group;
    }
    const preparedApplications=new Map();

    async function prepareApplication(staffId,groupId,command,expectedRevision) {
        const actor=await admin(),today=P().dateKey();
        const reason=text(command?.reason),targetMonth=text(command?.targetMonth,7);
        if(!reason)throw Error('Nhập lý do duyệt mức mới.');
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)||targetMonth<=today.slice(0,7))throw Error('Chỉ áp dụng từ đầu một tháng sau tháng hiện tại.');
        if(!Array.isArray(command.selectedSubjectIds)||!command.selectedSubjectIds.length||command.selectedSubjectIds.length>100)throw Error('Chọn các môn được áp mức mới.');
        const newRate=integer(command.newRate,1,10000000,'Mức mới');
        if(newRate===null)throw Error('Nhập mức mới.');
        const profileRef=document(PROFILES,staffId),settingsRef=document(SETTINGS,'default');
        const userRef=document('users',staffId),defaultsRef=document('salary_settings',staffId);
        const targetRef=document('salary_settings_monthly',targetMonth+'_'+staffId);
        const months=Array.from({length:6},(_,i)=>A().shiftMonth(targetMonth,-i-1));
        const historyRefs=months.map(month=>document('salary_settings_monthly',month+'_'+staffId));
        const [profile,config,user,legacy,targetDoc,historyRows,catalog]=await Promise.all([
            read(profileRef),read(settingsRef),read(userRef),read(defaultsRef),read(targetRef),
            limited(historyRefs,read),all('subjects')
        ]);
        if(!user||!P().isTeacher({...user,id:staffId}))throw Error('Nhân viên không còn là giáo viên / trợ giảng đang hoạt động.');
        checkRevision(profile,expectedRevision);
        const group=confirmedGroup(profile,groupId,today);
        const history=Object.fromEntries(months.map((month,i)=>[month,historyRows[i]]));
        const selectedSubjectIds=[...new Set(command.selectedSubjectIds.map(String))];
        const preview=A().buildPreview({staffId,user:{id:staffId,salary_config:user.salary_config||{}},defaults:legacy,targetDoc,
            history,catalog,group,selectedSubjectIds,newRate,targetMonth,currentMonth:today.slice(0,7),getPayslipLifecycleState:D().getPayslipLifecycleState});
        const operationRef=profileRef.collection('history').doc();
        const context={operationId:operationRef.id,actorUid:actor.uid,staffId,groupId,reason,newRate,targetMonth,selectedSubjectIds,
            profileRef,settingsRef,userRef,defaultsRef,targetRef,operationRef,historyRefs,months,catalog,
            baseline:{profile,config,user:userSource(user),legacy,targetDoc,history},preview};
        preparedApplications.set(operationRef.id,context);
        if(preparedApplications.size>64)preparedApplications.delete(preparedApplications.keys().next().value);
        // Mutable UI fields are never accepted as the command to commit. The
        // in-memory context is private and all prices are rebuilt in transaction.
        return {operationId:operationRef.id,staffId,groupId,newRate,targetMonth,reason,preview};
    }

    async function applyApplication(prepared) {
        const actor=await admin(),context=preparedApplications.get(prepared?.operationId);
        if(!context||context.actorUid!==actor.uid)throw Error('Bản xem trước không còn hiệu lực. Hãy xem trước lại.');
        const liveCatalog=await all('subjects');
        if(stable(catalogSource(liveCatalog))!==stable(catalogSource(context.catalog)))sourceChanged();
        const catalogRefs=context.catalog.map(s=>document('subjects',s.id));
        const result=await database().runTransaction(async tx=>{
            const completed=await tx.get(context.operationRef);
            if(completed.exists){
                const prior=completed.data();
                if(prior.kind==='approved'&&prior.operationId===context.operationId&&prior.actorUid===actor.uid){
                    const current=await tx.get(context.profileRef);
                    const group=(current.exists?current.data().groups||[]:[]).find(g=>g.id===context.groupId);
                    if(group?.scheduledChange?.operationId!==context.operationId)throw Error('Quyết định này đã được hủy hoặc thay thế. Hãy tải lại hồ sơ.');
                    return {applied:true,alreadyApplied:true,operationId:context.operationId,targetMonth:context.targetMonth};
                }
                sourceChanged();
            }
            const refs=[context.profileRef,context.settingsRef,context.userRef,context.defaultsRef,context.targetRef,
                ...context.historyRefs,...catalogRefs];
            const rows=await Promise.all(refs.map(ref=>tx.get(ref)));
            const data=rows.map(s=>s.exists?s.data():null);
            const [profile,config,user,legacy,targetDoc]=data;
            const history=Object.fromEntries(context.months.map((month,i)=>[month,data[5+i]]));
            const catalog=rows.slice(5+context.months.length).map((s,i)=>s.exists?{...s.data(),id:context.catalog[i].id}:null);
            if(stable(profile)!==stable(context.baseline.profile)||stable(config)!==stable(context.baseline.config)||
                stable(userSource(user))!==stable(context.baseline.user)||stable(legacy)!==stable(context.baseline.legacy)||
                stable(targetDoc)!==stable(context.baseline.targetDoc)||stable(history)!==stable(context.baseline.history)||
                catalog.some(s=>!s)||stable(catalogSource(catalog))!==stable(catalogSource(context.catalog)))sourceChanged();
            if(!P().isTeacher({...user,id:context.staffId}))throw Error('Nhân viên không còn là giáo viên / trợ giảng đang hoạt động.');
            const today=P().dateKey(),group=confirmedGroup(profile,context.groupId,today);
            const preview=A().buildPreview({staffId:context.staffId,user:{id:context.staffId,salary_config:user.salary_config||{}},defaults:legacy,targetDoc,
                history,catalog,group,selectedSubjectIds:context.selectedSubjectIds,newRate:context.newRate,targetMonth:context.targetMonth,
                currentMonth:today.slice(0,7),getPayslipLifecycleState:D().getPayslipLifecycleState});
            const previousGroup={...group};delete previousGroup.scheduledChange;
            const afterGroup={...previousGroup,subjectIds:context.selectedSubjectIds.slice(),currentRate:context.newRate,baselineDate:preview.effectiveFrom,baselineKind:'increase',lastIncreaseDate:preview.effectiveFrom,
                nextReviewDate:'',lastDecisionId:context.operationId,scheduledChange:{operationId:context.operationId,targetMonth:context.targetMonth,
                    effectiveFrom:preview.effectiveFrom,newRate:context.newRate,subjectIds:context.selectedSubjectIds,previousGroup}};
            const groups=profile.groups.map(g=>g.id===context.groupId?afterGroup:g);
            const revision=Number(profile.revision||0)+1,createdAt=new Date().toISOString();
            const effectiveRoleKey=preview.effectiveRoleKey;
            const beforeRoleExists=!!targetDoc&&Object.prototype.hasOwnProperty.call(targetDoc,effectiveRoleKey);
            const beforeRole=beforeRoleExists?targetDoc[effectiveRoleKey]:null;
            const afterRole=preview.patch[effectiveRoleKey];
            const sourceRates={salaryConfig:user.salary_config||{},defaults:legacy,
                history:Object.fromEntries(preview.sourceMonths.map(month=>[month,
                    history[month]?.giao_vien||history[month]?.['giao-vien']||null]))};
            tx.set(context.targetRef,preview.patch,{merge:true});
            tx.update(context.profileRef,{groups,revision,updatedAt:createdAt,updatedBy:actor.uid,lastHistoryId:context.operationId});
            tx.set(context.operationRef,{kind:'approved',operationId:context.operationId,groupId:context.groupId,groupName:group.name,
                reason:context.reason,targetMonth:context.targetMonth,effectiveFrom:preview.effectiveFrom,newRate:context.newRate,
                reviewDate:today,reviewSettings:settings(config||{}),personOverrides:profile.personOverrides||{},
                selectedSubjectIds:context.selectedSubjectIds,beforeGroup:group,afterGroup,effectiveRoleKey,beforeRoleExists,beforeRole,afterRole,
                changes:preview.changes,sourceMonths:preview.sourceMonths,sourceRates,revision,createdAt,recordedAt:serverTimestamp(),actorUid:actor.uid,actorUserId:actor.userId});
            return {applied:true,alreadyApplied:false,operationId:context.operationId,targetMonth:context.targetMonth};
        });
        D()._invalidate?.(`all_monthly_salary_settings_${context.targetMonth}`);
        return result;
    }

    async function cancelApplication(staffId,groupId,reason,expectedRevision) {
        const actor=await admin();reason=text(reason);
        if(!reason)throw Error('Nhập lý do hủy mức mới.');
        const profileRef=document(PROFILES,staffId),cancelRef=profileRef.collection('history').doc();
        let cancelledMonth='';
        const result=await database().runTransaction(async tx=>{
            const snap=await tx.get(profileRef),profile=snap.exists?snap.data():null;
            checkRevision(profile,expectedRevision);
            const group=(profile?.groups||[]).find(g=>g.id===groupId),scheduled=group?.scheduledChange;
            if(!scheduled||scheduled.effectiveFrom<=P().dateKey())throw Error('Chỉ hủy được mức mới trước ngày hiệu lực. Mức đã áp dụng cần hiệu chỉnh qua bảng lương.');
            const originalRef=profileRef.collection('history').doc(scheduled.operationId);
            const targetRef=document('salary_settings_monthly',scheduled.targetMonth+'_'+staffId);
            const [originalSnap,targetSnap]=await Promise.all([tx.get(originalRef),tx.get(targetRef)]);
            const original=originalSnap.exists?originalSnap.data():null,targetDoc=targetSnap.exists?targetSnap.data():null;
            if(!original||original.kind!=='approved'||original.groupId!==groupId||original.targetMonth!==scheduled.targetMonth||!targetDoc)sourceChanged();
            const key=original.effectiveRoleKey;
            if(!['giao_vien','giao-vien'].includes(key)||stable(targetDoc[key])!==stable(original.afterRole))
                throw Error('Đơn giá tháng đích đã được sửa sau khi duyệt. Không tự hủy để tránh mất mức admin vừa nhập.');
            const state=D().getPayslipLifecycleState(targetDoc.published||{});
            const role=String(targetDoc.published?.role||'');
            const ambiguousLegacy=targetDoc.published&&!state.has_tt&&!['tiep-tan','tiep_tan','receptionist'].includes(role)&&
                ['details','netPay','baseSalary','status'].some(k=>Object.prototype.hasOwnProperty.call(targetDoc.published,k));
            if(state.has_gv||state.locked_gv||ambiguousLegacy||targetDoc.revisionDrafts?.gv||['giao-vien','giao_vien','teacher'].includes(role))
                throw Error('Tháng đích đã có bản tính giáo viên. Cần đối chiếu bảng lương trước khi hủy mức mới.');
            if(stable(group)!==stable(original.afterGroup))throw Error('Nhóm xét đã thay đổi sau quyết định. Tải lại và đối chiếu trước khi hủy.');
            const restored={...original.beforeGroup};
            const restoredIds=new Set(restored.subjectIds||[]);
            if((profile.groups||[]).some(g=>g.id!==groupId&&g.enabled!==false&&(g.subjectIds||[]).some(id=>restoredIds.has(id))))
                throw Error('Môn của nhóm cũ đã được đưa vào nhóm xét khác. Bỏ phần trùng ở nhóm đó trước khi hủy quyết định này.');
            const revision=Number(profile.revision||0)+1,createdAt=new Date().toISOString();
            tx.update(targetRef,{[key]:original.beforeRoleExists?original.beforeRole:root.firebase.firestore.FieldValue.delete()});
            tx.update(profileRef,{groups:profile.groups.map(g=>g.id===groupId?restored:g),revision,updatedAt:createdAt,updatedBy:actor.uid,lastHistoryId:cancelRef.id});
            tx.set(cancelRef,{kind:'cancelled',operationId:scheduled.operationId,groupId,groupName:group.name,reason,targetMonth:scheduled.targetMonth,
                beforeGroup:group,afterGroup:restored,revision,createdAt,recordedAt:serverTimestamp(),actorUid:actor.uid,actorUserId:actor.userId});
            cancelledMonth=scheduled.targetMonth;
            return {cancelled:true,operationId:scheduled.operationId};
        });
        if(cancelledMonth)D()._invalidate?.(`all_monthly_salary_settings_${cancelledMonth}`);
        return result;
    }
    async function queue() {
        await admin();const [profiles,config]=await Promise.all([all(PROFILES),read(document(SETTINGS,'default'))]);
        return {profiles,config:settings(config||{})};
    }
    root.SalaryReviewService={defaults,stable,admin,read,all,document,loadIndex,loadEvidence,calculateBenchmark,saveSettings,saveProfile,decide,queue,normalizeGroup,
        prepareApplication,applyApplication,cancelApplication};
})(window);
