'use strict';
const assert=require('node:assert/strict');
module.exports=async function({env,admin,employee,dualEmployee,origin,month,record,shot,click,report,snapshot}) {
  // Monthly class-rate override must survive the main-page Save & Calculate button.
  await env.withSecurityRulesDisabled(c=>c.firestore().collection('salary_settings_monthly').doc(`${month}_audit-teacher`).set({giao_vien:{class_rates:{'Toán 5':200000,'Ngữ Văn 7':200000},advance:0,evaluation:[]}}));
  await report(admin,'audit-teacher');
  await record('monthly-rate-before-save',await snapshot(admin));
  await click(admin,'button[onclick="saveSalarySettings()"]');
  await admin.waitForFunction(async m=>(await db.collection('salary_settings_monthly').doc(m+'_audit-teacher').get()).data()?.published?.status==='draft',{timeout:30000},month);
  let monthlySaved;
  await env.withSecurityRulesDisabled(async c=>{monthlySaved=(await c.firestore().collection('salary_settings_monthly').doc(`${month}_audit-teacher`).get()).data();});
  await record('monthly-rate-after-save',{stored:monthlySaved,view:await snapshot(admin),screenshot:await shot(admin,'monthly-rate-after-save')});
  await click(admin,'#btn-class-rates-setup');
  await admin.waitForSelector('#class-rate-modal',{visible:true});
  await click(admin,'.modal-eval-amount[data-index="0"]');
  await admin.keyboard.down('Control');await admin.keyboard.press('KeyA');await admin.keyboard.up('Control');
  await admin.keyboard.type('0');await admin.keyboard.press('Tab');
  await click(admin,'button[onclick="saveSalarySettingsFromModal()"]');
  await admin.waitForFunction(async m=>(await db.collection('salary_settings_monthly').doc(m+'_audit-teacher').get()).data()?.published?.netPay===800000,{timeout:30000},month);
  await record('admin-manual-zero-bonus',await snapshot(admin));
  // Historical snapshot 200k, later current configuration 200k/hour.
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    for(let day=1;day<=31;day++) for(const center of ['cs1','cs2','cs3']) await db.collection('schedules').doc(`${center}__2026-08-${String(day).padStart(2,'0')}`).set({morning1:[],afternoon1:[],evening1:[]});
    const date='2026-08-28';
    await db.collection('attendance_logs').doc(`${date}_audit-teacher`).set({userId:'audit-teacher',date,name:'Audit Teacher',sessions:[{id:'audit-august',type:'admin_add',source:'admin',role:'audit-math',roleName:'Toán 5',roleRate:100000,start:date+'T08:00:00+07:00',checkIn:date+'T08:00:00+07:00',checkOut:date+'T10:00:00+07:00'}]});
    const details={role:'giao-vien',staffName:'Audit Teacher',employeeId:'AUDITTEACHER',baseSalary:200000,netPay:200000,advance:0,totalBonus:0,totalBaseMins:120,totalBaseSalary:200000};
    await db.collection('salary_settings_monthly').doc('2026-08_audit-teacher').set({giao_vien:{class_rates:{'Toán 5':200000},advance:0,evaluation:[]},published:{role:'giao-vien',status:'received',status_gv:'received',details_gv:details,details,netPay:200000,baseSalary:200000,totalBonus:0,advance:0}});
  });
  await report(admin,'audit-teacher');
  await click(admin,'#btn-class-rates-setup');
  await click(admin,'#btn-salary-tab-history');
  await admin.waitForFunction(()=>document.getElementById('modal-history-content')?.innerText.includes('Đã Lưu'),{timeout:30000});
  await record('previous-month-history-popup',{text:await admin.$eval('#modal-history-content',e=>e.innerText),screenshot:await shot(admin,'previous-month-history')});
  await employee.reload({waitUntil:'domcontentloaded'});
  await employee.waitForFunction(()=>window.__TDT_CORE_BOOTSTRAP_READY__,{timeout:30000});
  await click(employee,'button[onclick="changePersonalSalaryMonth(-1)"]');
  await employee.waitForFunction(()=>document.getElementById('personal-salary-month-title')?.innerText.includes('8, 2026') && document.getElementById('personal-salary-content').style.display==='block',{timeout:30000});
  await record('previous-month-employee-published',await employee.$eval('#personal-salary-content',e=>e.innerText));
  await click(admin,'button[onclick="closeClassRateModal()"]');
  // Legacy dual-role records are supported by the receipt adapters and employee UI.
  const gv={role:'giao-vien',staffName:'Audit Dual',netPay:400000,baseSalary:400000,totalBonus:0,advance:0,totalBaseMins:240,totalBaseSalary:400000};
  const tt={role:'tiep-tan',staffName:'Audit Dual',netPay:100000,baseSalary:100000,totalBonus:0,advance:0,filteredMinutes:120,normalMinutes:120,normalSalary:100000};
  await env.withSecurityRulesDisabled(c=>c.firestore().collection('salary_settings_monthly').doc(`${month}_audit-dual`).update({published:{role:'dual',status:'published',details_gv:gv,details_tt:tt,netPay:500000,baseSalary:500000,totalBonus:0,advance:0}}));
  await dualEmployee.reload({waitUntil:'domcontentloaded'});
  await dualEmployee.waitForSelector('#btn-confirm-receipt',{visible:true,timeout:30000});
  await record('legacy-dual-employee-view',await dualEmployee.$eval('#personal-salary-content',e=>e.innerText));
  await click(admin,'#tab-salary-dashboard');
  await admin.waitForSelector('#dash-table-body tr',{visible:true});
  // Observe the blob made by the actual export button without replacing its calculation.
  await admin.evaluate(()=>{const old=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/zip') window.__auditZip=blob;return old.call(this,blob);};});
  await click(admin,'#btn-export-all-payslips');
  await admin.waitForFunction(()=>!!window.__auditZip,{timeout:30000});
  await admin.waitForSelector('#modal-notice-btn',{visible:true});
  const bytes=Buffer.from(await admin.evaluate(async()=>Array.from(new Uint8Array(await window.__auditZip.arrayBuffer()))));
  const entries=[];
  for(let offset=0;offset+30<bytes.length && bytes.readUInt32LE(offset)===0x04034b50;) {
    const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString('utf8');
    const start=offset+30+nameLength+extraLength;
    const html=bytes.subarray(start,start+size).toString('utf8');
    const text=html ? await admin.evaluate(h=>new DOMParser().parseFromString(h,'text/html').body.textContent,html) : '';
    entries.push({name,text}); offset=start+size;
  }
  await record('legacy-dual-bulk-export',{entries,notice:await admin.$eval('.custom-modal-box',e=>e.innerText),screenshot:await shot(admin,'bulk-export')});
  await click(admin,'#modal-notice-btn');
  // Independent stats fixture: explicit VP, VDX, VKP, a late session and a future class.
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    function row(id,start,end,type) {
      const r={shiftId:id,lop:'Toán 5',lopId:'audit-math',start,end,gvId:'audit-teacher',gv:'Audit Teacher',gvList:[{id:'audit-teacher',name:'Audit Teacher'}]};
      if(type) r.teacherAbsences=[{teacherId:'audit-teacher',type,reason:'Fixture absence'}];
      return r;
    }
    await db.collection('schedules').doc(`cs1__${month}-03`).update({afternoon1:[row('audit-vp','12:00','13:00','VP')],afternoon2:[row('audit-vdx','14:00','15:00','VDX')]});
    await db.collection('schedules').doc(`cs1__${month}-04`).update({afternoon1:[row('audit-vkp','12:00','13:00')],evening1:[row('audit-late','18:00','19:00')]});
    await db.collection('schedules').doc(`cs1__${month}-05`).update({evening2:[row('audit-future','23:30','23:59')]});
    const logRef=db.collection('attendance_logs').doc(`${month}-04_audit-teacher`);
    const log=(await logRef.get()).data();
    await logRef.update({sessions:[...log.sessions,{id:'audit-late-session',role:'audit-math',roleName:'Toán 5',roleRate:100000,start:`${month}-04T18:07:00+07:00`,checkIn:`${month}-04T18:07:00+07:00`,checkOut:`${month}-04T19:00:00+07:00`} ]});
  });
  await report(admin,'audit-teacher');
  await click(admin,'#btn-class-rates-setup');
  await admin.waitForSelector('#class-rate-modal',{visible:true});
  await record('canonical-report-attendance-stats',{...await snapshot(admin),stats:await admin.evaluate(()=>Object.fromEntries(['worked-shifts','vp-shifts','vdx-shifts','vkp-shifts','late-shifts'].map(k=>[k,document.getElementById('modal-stat-'+k)?.innerText]))),screenshot:await shot(admin,'attendance-stats')});
  await employee.reload({waitUntil:'domcontentloaded'});
  await employee.waitForFunction(()=>window.__TDT_CORE_BOOTSTRAP_READY__ && typeof ChartService!=='undefined',{timeout:30000});
  await employee.waitForFunction(()=>!!ChartService._cache['schedules_2026-09_all'],{timeout:30000});
  const chartEvidence=await employee.evaluate(async m=>{
    const data=await ChartService.loadMonthData(m,'audit-teacher');
    const own=await DBService.getMonthlyAttendance(m,'audit-teacher',true,{strict:true});
    let chartQueryError=null;
    try {await db.collection('attendance_logs').where('date','>=',m+'-01').where('date','<=',m+'-30').get();} catch(e){chartQueryError=e.code;}
    const monthly=await DBService.getMonthlySchedule(m);
    const future={};if(monthly[m+'-05']) future[m+'-05']=monthly[m+'-05'];
    return {chartLogCount:data.allLogs.length,ownLogCount:own.length,chartQueryError,chartScheduleKeys:Object.keys(data.schedules),canonicalScheduleKeys:Object.keys(monthly),futureInput:future,punctuality:ChartService.getStaffPunctuality(data.allLogs,data.schedules,'audit-teacher'),futureOnly:ChartService.getStaffPunctuality([],future,'audit-teacher'),renderedChart:typeof Chart!=='undefined'?Chart.getChart('staff-chart-punctuality')?.data:null};
  },month);
  await employee.$eval('#staff-chart-punctuality',e=>e.scrollIntoView({block:'center',behavior:'instant'}));
  await record('employee-attendance-chart',{...chartEvidence,screenshot:await shot(employee,'employee-attendance-chart')});
  assert.ok(chartEvidence.ownLogCount>0,'fixture must have actual own attendance logs');
};
