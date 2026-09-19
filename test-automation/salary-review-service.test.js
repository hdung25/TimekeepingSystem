'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Policy = require('../js/salary-review-policy.js');
const Application = require('../js/salary-review-application.js');
const source = fs.readFileSync(path.join(__dirname, '../js/salary-review-service.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(__dirname, '../js/db-service.js'), 'utf8');
const lifecycle = {};
vm.createContext(lifecycle);
vm.runInContext(dbSource.slice(dbSource.indexOf('// PAYSLIP LIFECYCLE HELPERS START'),dbSource.indexOf('// PAYSLIP LIFECYCLE HELPERS END')), lifecycle);
const copy = value => value == null ? value : structuredClone(value);
const DELETE = {__delete: true};
const serverStamp = {__server: true};

// Transaction test double stages all writes and checks every read version before
// committing. It retries after a concurrent write, as Firestore does, so CAS
// checks must reject the changed source on the retried transaction.
function harness() {
    const store = new Map(), versions = new Map(); let counter = 0, commitCount = 0, retries = 0;
    let actor = {uid: 'admin-auth',userId:'admin-staff',roles:['admin']}, today = '2026-09-19', inject = null;
    const write = (key, value) => {store.set(key, copy(value));versions.set(key,(versions.get(key)||0)+1);};
    const snapshot = key => ({id:key.split('/').at(-1),exists:store.has(key),data:()=>copy(store.get(key))});
    function ref(key) {return {path:key,id:key.split('/').at(-1),get:async options=>{assert.equal(options.source,'server');return snapshot(key);},collection:name=>collection(key+'/'+name)};}
    function collection(key) {
        let cursor='',cap=150;
        const query={doc:id=>ref(key+'/'+(id||'operation-'+(++counter))),orderBy(){return this;},limit(n){cap=n;return this;},startAfter(doc){cursor=doc.id;return this;},
            async get(options){assert.equal(options.source,'server');const paths=[...store.keys()].filter(p=>p.startsWith(key+'/')&&!p.slice(key.length+1).includes('/')&&p.split('/').at(-1)>cursor).sort().slice(0,cap);
                return {docs:paths.map(snapshot),size:paths.length};}};
        return query;
    }
    function merge(before, patch) {
        const result={...(before||{})};
        for(const [key,value] of Object.entries(patch)) {
            if(value?.__delete){delete result[key];continue;}
            if(value?.__server){result[key]='SERVER_TIMESTAMP';continue;}
            result[key]=value&&typeof value==='object'&&!Array.isArray(value)?merge(result[key],value):copy(value);
        }
        return result;
    }
    const db={collection,async runTransaction(callback){
        for(let attempt=0;attempt<3;attempt++){
            const reads=new Map(),writes=[];let writing=false;
            const tx={async get(document){assert.equal(writing,false,'all source reads must occur before writes');reads.set(document.path,versions.get(document.path)||0);return snapshot(document.path);},
                set(document,data,options){writing=true;writes.push({key:document.path,data:copy(data),kind:options?.merge?'merge':'set'});},
                update(document,data){writing=true;writes.push({key:document.path,data:copy(data),kind:'update'});}};
            const result=await callback(tx);
            if(inject){const action=inject;inject=null;action();}
            if([...reads].some(([key,version])=>(versions.get(key)||0)!==version)){retries++;continue;}
            const staged=new Map(store);
            for(const operation of writes){
                if(operation.kind==='update'){
                    assert.ok(staged.has(operation.key));const next={...staged.get(operation.key)};
                    for(const [key,value] of Object.entries(operation.data)) {if(value?.__delete)delete next[key];else next[key]=copy(value);}
                    staged.set(operation.key,next);
                }else staged.set(operation.key,merge(operation.kind==='merge'?staged.get(operation.key):{},operation.data));
            }
            for(const operation of writes)write(operation.key,staged.get(operation.key));
            if(writes.length)commitCount++;
            return result;
        }
        throw Error('transaction retry budget exceeded');
    }};
    const DBService={getAuthenticatedAuthorizationContext:async()=>copy(actor),getPayslipLifecycleState:lifecycle._getPayslipLifecycleState,_invalidate(){}};
    const window={SalaryReviewPolicy:{...Policy,dateKey:()=>today},SalaryReviewApplication:Application,
        firebase:{firestore:{FieldValue:{serverTimestamp:()=>serverStamp,delete:()=>DELETE},FieldPath:{documentId:()=> '__name__'}}}};
    // Model real HTML globals: DBService and db are lexical, not window fields.
    new Function('window','DBService','db',source)(window,DBService,db);
    write('users/teacher',{role:'staff',name:'Fixture Teacher',salary_config:{class_rates:{'Tin Học':60000}}});
    write('subjects/m1',{name:'Toán 1',parentId:'math'});
    write('subjects/m2',{name:'Toán 2',parentId:'math'});
    write('subjects/english',{name:'E1',parentId:'school'});
    write('salary_review_settings/default',{schemaVersion:1,revision:1,cycleMonths:3,minimumHours:43,extraMonths:1});
    write('salary_review_profiles/teacher',{schemaVersion:1,revision:1,staffId:'teacher',staffName:'Fixture Teacher',personOverrides:{},groups:[
        {id:'primary',name:'Toán tiểu học',subjectIds:['m1','m2'],currentRate:30000,baselineDate:'2026-06-01',baselineKind:'initial',confirmed:true,enabled:true},
        {id:'english',name:'Tiếng Anh',subjectIds:['english'],currentRate:50000,baselineDate:'2026-07-01',baselineKind:'initial',confirmed:true,enabled:true}
    ]});
    write('salary_settings_monthly/2026-09_teacher',{giao_vien:{class_rates:{'Toán 1':30000,'Toán 2':32000,E1:50000,'Toán 1 (+12 HS)':60000}},
        published:{role:'giao-vien',status:'received',details:{netPay:1234567}}});
    return {service:window.SalaryReviewService,store,write,read:key=>copy(store.get(key)),
        actor:value=>actor=value,today:value=>today=value,inject:fn=>inject=fn,commits:()=>commitCount,retries:()=>retries,
        audit:()=>[...store].filter(([key])=>key.startsWith('salary_review_profiles/teacher/history/'))};
}
const command={newRate:36000,targetMonth:'2026-10',selectedSubjectIds:['m1'],reason:'Đạt đánh giá kỳ này'};
const prepare = h => h.service.prepareApplication('teacher','primary',copy(command),1);
const profileKey='salary_review_profiles/teacher',targetKey='salary_settings_monthly/2026-10_teacher';

(async()=>{
    {
        const h=harness(),group={...h.read(profileKey).groups[0],currentRate:0,confirmed:true};
        const catalog=[{id:'m1',name:'Toán 1'},{id:'m2',name:'Toán 2'}];
        assert.equal(h.service.normalizeGroup(group,catalog,'2026-09-19').currentRate,0,'an explicitly confirmed zero is distinct from a missing reference');
        assert.throws(()=>h.service.normalizeGroup({...group,currentRate:null},catalog,'2026-09-19'),/Nhập mức hiện tại/);
        assert.equal(h.commits(),0);
    }
    {
        const h=harness(),oldMonth=h.read('salary_settings_monthly/2026-09_teacher');
        const prepared=await prepare(h);assert.equal(h.commits(),0,'preparing never writes data');
        prepared.preview.patch.giao_vien.class_rates.E1=1; // UI tampering must not affect commit.
        const first=await h.service.applyApplication(prepared);
        assert.equal(first.applied,true);assert.equal(first.alreadyApplied,false);
        assert.equal(h.read(targetKey).giao_vien.class_rates['Toán 1'],36000);
        assert.equal(h.read(targetKey).giao_vien.class_rates.E1,50000);
        assert.equal(h.read(targetKey).giao_vien.class_rates['Toán 2'],32000);
        assert.deepEqual(h.read('salary_settings_monthly/2026-09_teacher'),oldMonth);
        const profile=h.read(profileKey),group=profile.groups[0];
        assert.equal(profile.revision,2);assert.equal(profile.lastHistoryId,prepared.operationId);
        assert.equal(group.currentRate,36000);assert.equal(group.baselineDate,'2026-10-01');
        assert.deepEqual(group.subjectIds,['m1'],'the new reference only describes explicitly increased subjects');
        assert.equal(group.scheduledChange.previousGroup.currentRate,30000);
        assert.deepEqual(group.scheduledChange.previousGroup.subjectIds,['m1','m2']);
        assert.equal(h.audit()[0][1].recordedAt,'SERVER_TIMESTAMP');
        assert.equal(h.audit()[0][1].revision,2);
        const second=await h.service.applyApplication(prepared);
        assert.equal(second.alreadyApplied,true);assert.equal(h.audit().length,1);assert.equal(h.commits(),1);
        await assert.rejects(h.service.decide('teacher','primary',{kind:'deferred',reason:'later',nextReviewDate:'2026-12-01'},2),/chờ hiệu lực/);
        await assert.rejects(h.service.prepareApplication('teacher','primary',command,2),/chờ hiệu lực/);
        // Independent TT edit is preserved by the narrow correction path.
        h.write(targetKey,{...h.read(targetKey),tiep_tan:{advance:777,class_rates:{'Tiếp Tân':28000}}});
        await h.service.cancelApplication('teacher','primary','Nhập nhầm nhóm',2);
        assert.equal(h.read(targetKey).giao_vien,undefined,'remove only the role that the application created');
        assert.equal(h.read(targetKey).tiep_tan.advance,777);
        assert.equal(h.read(profileKey).groups[0].currentRate,30000);
        assert.deepEqual(h.read(profileKey).groups[0].subjectIds,['m1','m2'],'cancellation restores the complete previous review scope');
        assert.equal(h.read(profileKey).revision,3);assert.equal(h.audit().length,2);
        await assert.rejects(h.service.cancelApplication('teacher','primary','duplicate',2),/phiên khác/);
        await assert.rejects(h.service.applyApplication(prepared),/hủy hoặc thay thế/);
    }
    {
        const h=harness(),role={advance:55000,class_rates:{'Toán 1':31000,'Toán 2':0,E1:54000},evaluation:[{id:2,amount:18000}]};
        const target={'giao-vien':role,tiep_tan:{advance:111},published:{role:'tiep-tan',status:'received',details:{netPay:111}}};
        h.write(targetKey,target);
        const prepared=await prepare(h);await h.service.applyApplication(prepared);
        assert.equal(h.read(targetKey)['giao-vien'].advance,55000);
        assert.equal(h.read(targetKey)['giao-vien'].class_rates['Toán 2'],0);
        assert.deepEqual(h.read(targetKey).published,target.published);
        await h.service.cancelApplication('teacher','primary','Đối chiếu lại',2);
        assert.deepEqual(h.read(targetKey),target,'cancel restores only exact old role with all unrelated values unchanged');
    }
    {
        const h=harness(),prepared=await prepare(h);await h.service.applyApplication(prepared);
        const originalGroup=h.read(profileKey).groups[0],draft=h.read(profileKey);
        draft.groups[1].note='Sửa ghi chú nhóm khác';
        const catalog=[...h.store].filter(([key])=>key.startsWith('subjects/')).map(([key,data])=>({...data,id:key.split('/').at(-1)}));
        await h.service.saveProfile('teacher',draft,2,catalog);
        assert.deepEqual(h.read(profileKey).groups[0],originalGroup,'saving another group must not normalize or change a frozen pending group');
        await h.service.cancelApplication('teacher','primary','Đổi kế hoạch',3);
        assert.equal(h.read(profileKey).groups[1].note,'Sửa ghi chú nhóm khác');
        assert.equal(h.read(profileKey).groups[0].currentRate,30000);
    }
    {
        const h=harness(),prepared=await prepare(h);await h.service.applyApplication(prepared);
        const profile=h.read(profileKey);profile.groups.push({id:'exception',name:'Ngoại lệ',subjectIds:['m2'],enabled:true});
        h.write(profileKey,profile);
        const before=copy([...h.store]);
        await assert.rejects(h.service.cancelApplication('teacher','primary','hủy',2),/nhóm xét khác/);
        assert.deepEqual([...h.store],before,'restore cannot introduce overlapping groups after exception subjects were reassigned');
    }
    // Every source affects the reviewed result or protects a whole-role write.
    for(const mutate of [
        h=>h.write(profileKey,{...h.read(profileKey),revision:2}),
        h=>h.write('salary_review_settings/default',{schemaVersion:1,revision:2,cycleMonths:4}),
        h=>h.write('users/teacher',{...h.read('users/teacher'),salary_config:{class_rates:{E1:3}}}),
        h=>h.write('salary_settings/teacher',{advance:50000}),
        h=>h.write(targetKey,{giao_vien:{advance:1}}),
        h=>h.write('salary_settings_monthly/2026-09_teacher',{giao_vien:{class_rates:{'Toán 1':48000}}}),
        h=>h.write('subjects/m1',{name:'Môn đã đổi',parentId:'math'}),
        h=>h.write('subjects/duplicate',{name:'Toán 1',parentId:'math'})
    ]){
        const h=harness(),prepared=await prepare(h);mutate(h);const before=copy([...h.store]);
        await assert.rejects(h.service.applyApplication(prepared),/vừa thay đổi/);
        assert.deepEqual([...h.store],before,'CAS failure cannot leave partial financial or review writes');
        assert.equal(h.audit().length,0);
    }
    {
        const h=harness(),prepared=await prepare(h);
        h.inject(()=>h.write(targetKey,{giao_vien:{class_rates:{'Toán 1':90000}}}));
        await assert.rejects(h.service.applyApplication(prepared),/vừa thay đổi/);
        assert.equal(h.retries(),1);assert.equal(h.audit().length,0);
        assert.equal(h.read(profileKey).revision,1);
        assert.equal(h.read(targetKey).giao_vien.class_rates['Toán 1'],90000);
    }
    {
        const h=harness(),one=await prepare(h),two=await prepare(h);
        await h.service.applyApplication(one);
        await assert.rejects(h.service.applyApplication(two),/vừa thay đổi/);
        assert.equal(h.audit().length,1);
    }
    for(const mutate of [
        h=>h.write(targetKey,{...h.read(targetKey),giao_vien:{...h.read(targetKey).giao_vien,advance:999}}),
        h=>h.write(targetKey,{...h.read(targetKey),published:{role:'giao-vien',status:'draft',details:{netPay:99}}}),
        h=>h.today('2026-10-01')
    ]){
        const h=harness(),prepared=await prepare(h);await h.service.applyApplication(prepared);mutate(h);const before=copy([...h.store]);
        await assert.rejects(h.service.cancelApplication('teacher','primary','hủy',2));
        assert.deepEqual([...h.store],before,'unsafe cancellation is atomic and preserves latest payroll');
    }
    {
        const h=harness();h.actor({uid:'senior',roles:['senior_assistant']});
        await assert.rejects(prepare(h),/quản trị viên chính/);
        assert.equal(h.commits(),0);
    }
    {
        const h=harness(),prepared=await prepare(h);h.today('2026-10-01');
        await assert.rejects(h.service.applyApplication(prepared),/tháng sau tháng hiện tại/);
        assert.equal(h.commits(),0,'reviewed proposal must not become retroactive while left open overnight');
    }
    console.log('salary-review-service.test.js: atomic apply/cancel, source CAS, retry, idempotency, legacy preservation and permissions passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
