'use strict';
// One explicitly requested source correction. Defaults to a read-only preview.
// Backup + audit + attendance update commit atomically; no payslip is published.
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const PROJECT='timekeeping-69f3f', STAFF='nv_1781780302340', DATE='2026-08-13', SESSION='1786618060233';
const REPAIR='uyen-vy-scheduled-overtime-20260909-v1';
const NAME=`projects/${PROJECT}/databases/(default)/documents`, ROOT=`https://firestore.googleapis.com/v1/${NAME}`;
const decode=v=>!v?null:'nullValue'in v?null:'stringValue'in v?v.stringValue:'booleanValue'in v?v.booleanValue:'integerValue'in v?Number(v.integerValue):'doubleValue'in v?v.doubleValue:'timestampValue'in v?v.timestampValue:'arrayValue'in v?(v.arrayValue.values||[]).map(decode):'mapValue'in v?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)])):v;
const encode=v=>v===null?{nullValue:null}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:typeof v==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?(Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}):{stringValue:String(v)};
const data=doc=>doc?Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,decode(v)])):null;
const fields=v=>encode(v).mapValue.fields;

async function main(){
    const apply=process.argv.includes('--apply');
    const token=execFileSync('powershell.exe',['-NoProfile','-File','C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1','auth','print-access-token'],{encoding:'utf8',windowsHide:true}).trim();
    const request=async(url,body)=>{
        const r=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
        if(r.status===404)return null;
        if(!r.ok)throw Error('Firestore '+r.status+': '+(await r.text()).slice(0,600));
        return r.json();
    };
    let transaction;
    if(apply)transaction=(await request(ROOT+':beginTransaction',{})).transaction;
    const get=path=>request(ROOT+'/'+path+(transaction?'?transaction='+encodeURIComponent(transaction):''));
    const attendancePath=`attendance_logs/${DATE}_${STAFF}`,monthlyPath=`salary_settings_monthly/2026-08_${STAFF}`;
    const overtimePath='overtime_requests/ot_'+[DATE,STAFF,SESSION].map(encodeURIComponent).join('~');
    try {
        const paths=[attendancePath,monthlyPath,`users/${STAFF}`,`schedules/cs1__${DATE}`,overtimePath,`migration_backups/${REPAIR}`];
        const docs=await Promise.all(paths.map(get));
        const [attendance,monthly,user,schedule,overtime,backup]=docs;
        assert.equal(data(user)?.name,'Nguyễn Huỳnh Uyên Vy');
        assert.equal(backup,null,'Repair already applied; do not duplicate');
        const original=data(attendance), monthlyData=data(monthly);
        assert.equal(attendance?.updateTime,'2026-09-09T14:26:04.305773Z','Attendance changed since reviewed snapshot; inspect again');
        const before=original.sessions.find(s=>String(s.id)===SESSION);
        assert.equal(before.checkIn,'2026-08-13T10:47:00.000Z');
        assert.equal(before.checkOut,'2026-08-13T12:30:00.000Z');
        assert.equal(before.adminPayrollOverride.mode,'actual');
        assert.equal(before.adminPayrollOverride.revision,1);
        const assigned=(data(schedule).evening1||[]).filter(r=>r.gvId===STAFF||(r.gvList||[]).some(g=>g.id===STAFF));
        assert.equal(assigned.length,1);assert.equal(assigned[0].start,'18:00');assert.equal(assigned[0].end,'19:30');
        assert.equal(assigned[0].lopId,'NfQuLGSvOGHA5gTvQ0T1');
        assert.equal(data(overtime)?.minutes,15);assert.equal(data(overtime)?.status,'approved');
        const now=new Date().toISOString(), actor='maintenance-cli:hahuyd25@gmail.com';
        const reason='Theo yêu cầu chủ hệ thống: ca Uyên Vy 13/08 tính theo lịch 18:00–19:30, giữ 15 phút tăng ca đã duyệt và giờ chấm công gốc.';
        const after=structuredClone(before);
        after.adminPayrollOverride={version:1,mode:'schedule',revision:2,allocations:[],adminEarly10:{enabled:false},reason,editedBy:{userId:actor},editedAt:now};
        after.isAdminEdited=true;after.adminCorrectionAt=now;after.adminCorrectionBy=actor;
        after.editHistory=[...(before.editHistory||[]),{at:now,action:'clear_admin_payroll_override',source:'owner_requested_incident_repair',editor:{userId:actor},reason,before:{checkIn:before.checkIn,checkOut:before.checkOut,role:before.role,adminPayrollOverride:before.adminPayrollOverride},after:{checkIn:after.checkIn,checkOut:after.checkOut,role:after.role,adminPayrollOverride:after.adminPayrollOverride}}];
        const sessions=structuredClone(attendance.fields.sessions);
        const index=original.sessions.findIndex(s=>String(s.id)===SESSION);
        // Preserve Firestore types and every unrelated source field verbatim.
        const target=sessions.arrayValue.values[index].mapValue.fields;
        for(const key of ['adminPayrollOverride','isAdminEdited','adminCorrectionAt','adminCorrectionBy','editHistory'])target[key]=encode(after[key]);
        const update={sessions,lastUpdated:{timestampValue:now},lastAdminPayrollOverride:encode({actorUserId:actor,sessionId:SESSION,auditId:REPAIR,at:now,source:'owner_requested_incident_repair'})};
        const payload={repairId:REPAIR,createdAt:now,documents:docs.slice(0,5),afterSession:after};
        const writes=[
            {update:{name:`${NAME}/migration_backups/${REPAIR}`,fields:fields({repairId:REPAIR,createdAt:now,payload:JSON.stringify(payload)})},currentDocument:{exists:false}},
            {update:{name:attendance.name,fields:update},updateMask:{fieldPaths:Object.keys(update)},currentDocument:{updateTime:attendance.updateTime}},
            {update:{name:`${NAME}/admin_payroll_override_audits/${REPAIR}`,fields:fields({actorUserId:actor,staffId:STAFF,dateKey:DATE,sessionId:SESSION,action:'save_payroll_override',mode:'schedule',revision:2,reason,createdAt:now,backupPath:`migration_backups/${REPAIR}`})},currentDocument:{exists:false}}
        ];
        const published=monthlyData?.published;
        const revisionRequired=!!published&&['published','received'].some(s=>[published.status,published.status_gv,published.status_tt].includes(s));
        if(monthly)writes.push({update:{name:monthly.name,fields:fields({attendanceRevisionState:{active:revisionRequired,source:'admin_payroll_override',sessionId:SESSION,auditId:REPAIR,sourceRevision:2,updatedBy:actor,updatedAt:now}})},updateMask:{fieldPaths:['attendanceRevisionState']},currentDocument:{updateTime:monthly.updateTime}});
        console.log(JSON.stringify({mode:apply?'apply':'preview',repairId:REPAIR,staffId:STAFF,date:DATE,checkIn:before.checkIn,schedule:'18:00–19:30',approvedOvertimeMinutes:15,resultMinutes:105,revisionRequired,publishedUnchanged:true,writes:writes.map(w=>w.update.name)},null,2));
        if(!apply)return;
        fs.writeFileSync(`scratch/${REPAIR}-backup.json`,JSON.stringify(payload,null,2),{flag:'wx'});
        const committed=await request(ROOT+':commit',{writes,transaction});transaction=null;
        const [verifiedAttendance,verifiedMonthly,verifiedOvertime,verifiedSchedule]=await Promise.all([attendancePath,monthlyPath,overtimePath,`schedules/cs1__${DATE}`].map(get));
        const verified=data(verifiedAttendance);
        assert.deepEqual(verified.sessions[index],after);
        assert.deepEqual(data(verifiedMonthly)?.published,published);
        assert.deepEqual(verifiedOvertime,overtime);assert.deepEqual(verifiedSchedule,schedule);
        for(const [key,value]of Object.entries(original))if(!Object.keys(update).includes(key))assert.deepEqual(verified[key],value,key);
        fs.writeFileSync(`scratch/${REPAIR}-result.json`,JSON.stringify({committed,verifiedAttendance,verifiedMonthly,verifiedOvertime},null,2));
        console.log('VERIFIED: schedule mode, original timestamps, existing overtime, schedule and published salary preserved.');
    } finally {if(transaction)await request(ROOT+':rollback',{transaction});}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
