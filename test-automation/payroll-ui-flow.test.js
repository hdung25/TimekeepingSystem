'use strict';
// Payroll UI regression with September 2026 fixtures; run with the fixture clock.
// Refuses nonlocal emulator hosts and blocks production Firebase requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
const deps = path.join(root, 'test-automation/node_modules');
const puppeteer = require(path.join(deps, 'puppeteer-core'));
const { initializeTestEnvironment } = require(path.join(deps, '@firebase/rules-unit-testing'));
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const month = '2026-09';
const password = 'LocalAuditOnly-20260905';
const evidence = { build: 'payroll-sync-v153', environment: 'demo-timekeeping local emulators only', results: {}, errors: [] };
const users = [
  { id: 'audit-admin', username: 'auditadmin', name: 'Audit Admin', roles: ['admin'] },
  { id: 'audit-teacher', username: 'auditteacher', name: 'Audit Teacher', roles: ['teaching_assistant'] },
  { id: 'audit-dual', username: 'auditdual', name: 'Audit Dual', roles: ['teaching_assistant', 'receptionist'] }
];
let env, browser, server, origin;
async function readDoc(id) {
  let data;
  await env.withSecurityRulesDisabled(async c => { data = (await c.firestore().collection('salary_settings_monthly').doc(`${month}_${id}`).get()).data(); });
  return data;
}
async function snapshot(page) {
  return page.evaluate(() => ({
    header: document.getElementById('final-salary-display')?.innerText,
    popup: document.getElementById('modal-final-salary-display')?.innerText,
    popupTable: document.getElementById('class-rate-table-body')?.innerText,
    roleFilter: document.getElementById('salary-role-filter')?.value,
    displayFilter: document.getElementById('display-role-filter')?.value,
    options: [...(document.getElementById('display-role-filter')?.options || [])].map(o => ({ value:o.value, text:o.text })),
    chips: (window.currentMonthChips || []).map(c => ({name:c.chipFilterName,minutes:c.paidMinutes,isTeaching:c.isTeaching,isReceptionist:c.isReceptionist,role:c.sessionData?.role,text:c.text})),
    unfiltered: (window.unfilteredAllMonthChips || []).map(c => ({name:c.chipFilterName,minutes:c.paidMinutes,text:c.text,class:c.class,absenceType:c.absenceType,isAbsent:c.isAbsent,isCenterOff:c.isCenterOff})),
    gv: typeof getCurrentCalculationPayload === 'function' ? getCurrentCalculationPayload('giao-vien') : null,
    tt: typeof getCurrentCalculationPayload === 'function' ? getCurrentCalculationPayload('tiep-tan') : null
  }));
}
async function record(key, value) {
  evidence.results[key] = value;
  fs.writeFileSync(path.join(root, 'scratch', 'payroll-ui-audit-v153.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ key, summary: typeof value==='string' ? value.slice(0,700) : {header:value?.header,popup:value?.popup,netPay:value?.published?.netPay,gv:value?.gv?.netPay,tt:value?.tt?.netPay} }));
}
async function shot(page, label) {
  const file = path.join(root, 'scratch', `payroll-audit-${label}.png`);
  await page.screenshot({ path:file, fullPage:false });
  return file;
}
async function login(user) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({width:user.id==='audit-admin'?1440:430,height:1000,isMobile:user.id!=='audit-admin'});
  await page.emulateTimezone('Asia/Ho_Chi_Minh');
  page.on('pageerror', e => evidence.errors.push({user:user.id,error:e.message}));
  page.on('dialog', d => d.accept());
  await page.setRequestInterception(true);
  page.on('request', req => /googleapis\.com$/.test(new URL(req.url()).hostname) ? req.abort() : req.continue());
  await page.goto(origin+'/index.html', {waitUntil:'domcontentloaded'});
  await page.type('#username', user.username);
  await page.type('#password', password);
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#login-form button[type="submit"]')]);
  return page;
}
async function report(page, id) {
  await page.goto(`${origin}/bao-cao.html?staffId=${id}&date=${month}-04`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.__TDT_REPORT_BOOTSTRAP_READY__ && !!window.payrollReadyScope && window.payrollReadyScope===window.currentReportScope, {timeout:45000});
}
async function click(page, selector) {
  await page.waitForSelector(selector,{visible:true,timeout:30000});
  await page.$eval(selector,e=>e.scrollIntoView({block:'center',behavior:'instant'}));
  await new Promise(r=>setTimeout(r,300));
  await page.waitForFunction(s=>{const e=document.querySelector(s);const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !e.disabled && (hit===e||e.contains(hit));},{timeout:10000},selector);
  // Native keyboard activation avoids moving targets while the calendar scrolls.
  await page.focus(selector);
  const key=await page.$eval(selector,e=>e.type==='checkbox'?'Space':'Enter');
  await page.keyboard.press(key);
}
async function waitPublished(id, status) {
  for(let i=0;i<100;i++) {const d=await readDoc(id); if(d?.published?.status===status) return d; await new Promise(r=>setTimeout(r,100));}
  throw new Error(`Timed out waiting ${id} status ${status}`);
}
async function main() {
  for(const host of [authHost,firestoreHost]) assert.match(host||'',/^127\.0\.0\.1:\d+$/);
  env=await initializeTestEnvironment({projectId:'demo-timekeeping',firestore:{rules:fs.readFileSync(path.join(root,'firestore.rules'),'utf8')}});
  await env.clearFirestore();
  await fetch(`http://${authHost}/emulator/v1/projects/demo-timekeeping/accounts`,{method:'DELETE'});
  for(const user of users) {
    const r=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fixture`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.username+'@tuduytre.com',password,returnSecureToken:true})});
    assert.equal(r.ok,true); user.authUid=(await r.json()).localId;
  }
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    for(const user of users) {
      const {authUid,...profile}=user;
      const salary_config={attendance_rate:5000,receptionist_normal_rate:50000,receptionist_fixed_rate:50000,roles:[{id:'audit-math',name:'Toán 5',rate:100000},{id:'audit-literature',name:'Ngữ Văn 7',rate:100000}],class_rates:{'Toán 5':100000,'Ngữ Văn 7':100000}};
      await db.collection('users').doc(user.id).set({...profile,role:user.roles[0],salary_config});
      await db.collection('staff_directory').doc(user.id).set({...profile,role:user.roles[0]});
      await db.collection('user_roles').doc(authUid).set({userId:user.id,username:user.username,role:user.roles[0],roles:user.roles});
    }
    await db.collection('settings').doc('system').set({gpsCS1Lat:10,gpsCS1Lng:106,gpsCS1Radius:200});
    for(const [id,name] of [['audit-math','Toán 5'],['audit-literature','Ngữ Văn 7']]) await db.collection('subjects').doc(id).set({name,rate:100000});
    // Explicit empty schedules prevent recurring fallback from inventing classes.
    for(let day=1;day<=30;day++) for(const center of ['cs1','cs2','cs3']) await db.collection('schedules').doc(`${center}__${month}-${String(day).padStart(2,'0')}`).set({morning1:[],afternoon1:[],evening1:[],evening2:[]});
    for(const user of users.slice(1)) {
      for(const [day,subject,name] of [['03','audit-math','Toán 5'],['04','audit-literature','Ngữ Văn 7']]) {
        const date=`${month}-${day}`;
        const sessions=[{id:`${user.id}-${day}`,source:'admin',type:'admin_add',role:subject,roleName:name,roleRate:100000,start:date+'T08:00:00+07:00',checkIn:date+'T08:00:00+07:00',checkOut:date+'T10:00:00+07:00'}];
        if(user.id==='audit-dual' && day==='04') sessions.push({id:'audit-dual-tt',source:'admin',type:'admin_add',role:'tiep-tan',roleName:'Tiếp Tân',roleRate:50000,start:date+'T14:00:00+07:00',checkIn:date+'T14:00:00+07:00',checkOut:date+'T16:00:00+07:00'});
        await db.collection('attendance_logs').doc(`${date}_${user.id}`).set({userId:user.id,name:user.name,date,sessions});
      }
      await db.collection('salary_settings_monthly').doc(`${month}_${user.id}`).set({
        giao_vien:{advance:user.id==='audit-dual'?20000:0,evaluation:user.id==='audit-dual'?[{id:0,amount:10000,note:'fixture bonus'}]:[],class_rates:{'Toán 5':100000,'Ngữ Văn 7':100000}},
        tiep_tan:{advance:30000,evaluation:[{id:0,amount:0,note:''},{id:1,amount:100000,note:'fixture consultation'}],class_rates:{'Tiếp Tân (Ca Bình Thường)':50000,'Tiếp Tân (Ca Cố Định)':50000}}
      });
    }
  });
  server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)||! /\.(html|js|css|png|jpg|jpeg|svg|ico|json|woff2?|ttf)$/i.test(file)||/node_modules|\/\./.test(pathname)) {res.writeHead(403);res.end();return;}
    try {
      let body=fs.readFileSync(file);
      if(pathname==='/js/firebase-config.js') body=body.toString().replace(/projectId: "[^"]+"/,'projectId: "demo-timekeeping"').replace('window.auth = firebase.auth();',`window.auth = firebase.auth();\nwindow.auth.useEmulator('http://${authHost}', {disableWarnings:true});\nwindow.db.useEmulator('127.0.0.1', ${firestoreHost.split(':')[1]});`);
      if(pathname==='/service-worker.js') body='self.addEventListener("install",()=>self.skipWaiting());';
      const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);
    } catch (_) {res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); origin=`http://127.0.0.1:${server.address().port}`;
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
  const admin=await login(users[0]);
  await report(admin,'audit-teacher');
  await record('teacher-full-month',await snapshot(admin));
  const filterOptions=await admin.$eval('#display-role-filter',e=>[...e.options].map(o=>o.value));
  const classFilter=filterOptions.find(s=>s.includes('Toán'));
  assert.ok(classFilter,'fixture class must be available in actual display filter');
  await admin.select('#display-role-filter',classFilter);
  await admin.waitForFunction(()=>!!window.payrollReadyScope && window.payrollReadyScope===window.currentReportScope && (window.currentMonthChips||[]).length===1,{timeout:30000});
  await click(admin,'#btn-class-rates-setup');
  await admin.waitForSelector('#class-rate-modal',{visible:true});
  await record('teacher-filtered-with-popup',{...await snapshot(admin),screenshot:await shot(admin,'filtered-popup')});
  await click(admin,'button[onclick="closeClassRateModal()"]');
  await click(admin,'button[onclick="saveSalarySettings()"]');
  await record('teacher-saved-filtered',await waitPublished('audit-teacher','draft'));
  await click(admin,'#btn-publish-salary');
  await admin.waitForSelector('#bulk-publish-modal',{visible:true});
  await record('bulk-teacher-before-send',await admin.$eval('#bulk-list-teachers',e=>({text:e.innerText,inputs:[...e.querySelectorAll('input')].map(x=>x.outerHTML)})));
  if(!await admin.$eval('.bulk-staff-checkbox[data-id="audit-teacher"]',e=>e.checked)) await click(admin,'.bulk-staff-checkbox[data-id="audit-teacher"]');
  await click(admin,'button[onclick="submitBulkPublish(\'teachers\')"]');
  await click(admin,'#modal-confirm-btn');
  await record('teacher-published',await waitPublished('audit-teacher','published'));
  const employee=await login(users[1]);
  await employee.goto(origin+'/nhan-vien.html',{waitUntil:'domcontentloaded'});
  await employee.waitForSelector('#btn-confirm-receipt',{visible:true,timeout:30000});
  await employee.$eval('#personal-salary-content',e=>e.scrollIntoView({block:'center'}));
  await record('teacher-employee-published',{text:await employee.$eval('#personal-salary-content',e=>e.innerText),screenshot:await shot(employee,'employee-filtered-payslip')});
  await report(admin,'audit-dual');
  await record('dual-full-month',await snapshot(admin));
  await admin.select('#salary-role-filter','giao-vien');
  await admin.waitForFunction(()=>!!window.payrollReadyScope && window.payrollReadyScope===window.currentReportScope && !(window.currentMonthChips||[]).some(c=>c.isReceptionist),{timeout:30000});
  await click(admin,'#btn-class-rates-setup');
  await admin.waitForSelector('#class-rate-modal',{visible:true});
  await record('dual-teacher-filter-with-popup',{...await snapshot(admin),screenshot:await shot(admin,'dual-teacher-popup')});
  await click(admin,'#btn-modal-role-tt');
  await admin.waitForFunction(()=>window.modalActiveRole==='tiep-tan' && document.getElementById('modal-final-salary-display').innerText.includes('170.000'),{timeout:30000});
  await click(admin,'button[onclick="saveSalarySettingsFromModal()"]');
  await admin.waitForFunction(()=>!!window.payrollReadyScope && window.payrollReadyScope===window.currentReportScope && document.getElementById('salary-role-filter').value==='tiep-tan',{timeout:30000});
  const popupSaved=await waitPublished('audit-dual','draft');
  assert.equal(popupSaved.published.details_tt.netPay,170000);
  assert.equal(popupSaved.published.details_gv.netPay,390000);
  await record('dual-receptionist-popup-save',popupSaved);
  // Independent race fixture: employee sees GV while TT is still a draft.
  const gv={role:'giao-vien',netPay:400000,baseSalary:400000,totalBonus:0,advance:0,totalBaseMins:240,totalBaseSalary:400000};
  const tt={role:'tiep-tan',netPay:100000,baseSalary:100000,totalBonus:0,advance:0,filteredMinutes:120,normalMinutes:120,normalSalary:100000};
  await env.withSecurityRulesDisabled(c=>c.firestore().collection('salary_settings_monthly').doc(`${month}_audit-dual`).set({published:{role:'dual',status:'published',status_gv:'published',status_tt:'draft',details_gv:gv,details_tt:tt,netPay:500000,baseSalary:500000,totalBonus:0,advance:0}},{merge:true}));
  const dualEmployee=await login(users[2]);
  await dualEmployee.goto(origin+'/nhan-vien.html',{waitUntil:'domcontentloaded'});
  await dualEmployee.waitForSelector('#btn-confirm-receipt',{visible:true,timeout:30000});
  await record('dual-receipt-before-other-component-published',await dualEmployee.$eval('#personal-salary-content',e=>e.innerText));
  const oldReceiptToken=await dualEmployee.evaluate(async m=>DBService.getPayslipReceiptToken((await DBService.getMonthlySalarySettings('audit-dual',m,{strict:true})).published),month);
  await click(admin,'#btn-publish-salary');
  await admin.waitForSelector('#bulk-publish-modal',{visible:true});
  await record('bulk-recep-before-send',await admin.$eval('#bulk-list-receps',e=>({text:e.innerText,inputs:[...e.querySelectorAll('input')].map(x=>x.outerHTML)})));
  if(!await admin.$eval('.bulk-staff-checkbox[data-id="audit-dual"][data-group="receps"]',e=>e.checked)) await click(admin,'.bulk-staff-checkbox[data-id="audit-dual"][data-group="receps"]');
  await click(admin,'button[onclick="submitBulkPublish(\'receps\')"]');
  await click(admin,'#modal-confirm-btn');
  await admin.waitForFunction(()=>window.bulkPublishAllSettings?.['audit-dual']?.published?.status_tt==='published',{timeout:30000});
  const staleReceiptCode=await dualEmployee.evaluate(async (m,token)=>{
    try {await DBService.confirmSalaryReceived('audit-dual',m,'employee','all',token);return 'unexpected-success';}
    catch(e){return e.code;}
  },month,oldReceiptToken);
  assert.equal(staleReceiptCode,'payslip/view-changed','unseen newly published component must not be confirmed');
  await dualEmployee.waitForFunction(()=>document.getElementById('personal-salary-content')?.innerText.includes('TIẾP TÂN'),{timeout:30000});
  await record('stale-receipt-guard',staleReceiptCode);
  await record('dual-receipt-still-showing-old-view',await dualEmployee.$eval('#personal-salary-content',e=>e.innerText));
  await click(admin,'button[onclick="closeBulkPublishModal()"]');
  await click(admin,'#tab-salary-dashboard');
  await admin.waitForSelector('#dash-table-body tr',{visible:true});
  await record('dashboard-before-receipt',await admin.$eval('#dash-table-body',e=>e.innerText));
  await click(dualEmployee,'#btn-confirm-receipt');
  await record('dual-receipt-written',await waitPublished('audit-dual','received'));
  await click(admin,'#tab-personal-report');
  await click(admin,'#tab-salary-dashboard');
  await admin.waitForSelector('#dash-table-body tr',{visible:true});
  await record('dashboard-after-employee-receipt',{text:await admin.$eval('#dash-table-body',e=>e.innerText),screenshot:await shot(admin,'stale-dashboard')});
  await admin.reload({waitUntil:'domcontentloaded'});
  await admin.waitForFunction(()=>window.__TDT_REPORT_BOOTSTRAP_READY__,{timeout:30000});
  await click(admin,'#tab-salary-dashboard');
  await admin.waitForSelector('#dash-table-body tr',{visible:true});
  await record('dashboard-after-page-reload',await admin.$eval('#dash-table-body',e=>e.innerText));
  await employee.evaluate(async()=>{
    const proto=Object.getPrototypeOf(db.collection('salary_settings_monthly').doc('fixture'));
    const original=proto.get;
    proto.get=function(...args) {if(this.path.startsWith('salary_settings_monthly/')) return Promise.reject(new Error('Fixture: salary transport unavailable'));return original.apply(this,args);};
    try { await loadStaffPersonalSalary(); } finally {proto.get=original;}
  });
  await employee.$eval('#personal-salary-status-container',e=>e.scrollIntoView({block:'center'}));
  await record('employee-read-failure',{text:await employee.$eval('#personal-salary-status-container',e=>e.innerText),retryButton:!!await employee.$('#btn-retry-personal-salary'),screenshot:await shot(employee,'read-failure')});
  await require('./payroll-ui-extensions.cjs')({env,admin,employee,dualEmployee,origin,month,record,shot,click,report,snapshot});
  const results=evidence.results;
  assert.equal(results['teacher-filtered-with-popup'].gv.netPay,420000);
  assert.equal(results['teacher-saved-filtered'].published.netPay,420000);
  assert.equal(results['teacher-published'].published.netPay,420000);
  assert.equal(results['monthly-rate-after-save'].stored.published.netPay,820000);
  assert.equal(results['employee-read-failure'].retryButton,true);
  assert.match(results['dashboard-after-employee-receipt'].text,/Đã nhận/);
  assert.equal(results['canonical-report-attendance-stats'].gv.stats.workedShifts,3);
  assert.equal(results['canonical-report-attendance-stats'].gv.stats.vpShifts,1);
  assert.equal(results['canonical-report-attendance-stats'].gv.stats.vdxShifts,1);
  assert.equal(results['canonical-report-attendance-stats'].gv.stats.vkpShifts,1);
  assert.equal(results['canonical-report-attendance-stats'].gv.stats.totalLateMinutes,7);
  assert.equal(results['employee-attendance-chart'].chartLogCount,2);
  assert.equal(results['employee-attendance-chart'].futureOnly.absent,0);
  assert.ok(results['legacy-dual-bulk-export'].entries.some(e=>e.name.startsWith('Tiep Tan/')&&e.name.endsWith('.html')));
  assert.match(results['previous-month-history-popup'].text,/200,000/);
  assert.doesNotMatch(results['previous-month-history-popup'].text,/400[,.]000/);
  assert.deepEqual(evidence.errors,[]);
  console.log('PASS payroll UI save/filter/monthly-rate/history/export/receipt/live-sync/absence/late/error-retry regression scenarios');
}
main().catch(async e=>{evidence.fatal=e.stack;console.error(e);process.exitCode=1;
  if(browser) for(const [i,p] of (await browser.pages()).entries()) {
    await p.screenshot({path:path.join(root, 'scratch',`payroll-audit-fatal-${i}.png`)}).catch(()=>{});
    evidence.errors.push({url:p.url(),text:await p.evaluate(()=>document.body.innerText.slice(-2500)).catch(()=>''),buttons:await p.evaluate(()=>[...document.querySelectorAll('button')].filter(e=>/modal-confirm|bulk-publish/.test(e.id)).map(e=>({id:e.id,disabled:e.disabled,rect:e.getBoundingClientRect().toJSON()}))).catch(()=>[])});
  }
}).finally(async()=>{
  fs.writeFileSync(path.join(root, 'scratch','payroll-ui-audit-v153.json'),JSON.stringify(evidence,null,2));
  if(browser) await browser.close(); if(server) await new Promise(r=>server.close(r)); if(env) await env.cleanup();
});
