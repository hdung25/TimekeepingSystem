'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'..');
const fixture=`
window.waitAuth=async()=>{};
localStorage.setItem('currentUser','admin');localStorage.setItem('currentRole','admin');
window.fixture={fail:false,minutes:60,reads:0,opened:null};
window.open=(url)=>{window.fixture.opened=url;return null;};
const realClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download)return realClick.call(this);};
URL.createObjectURL=blob=>{window.exportedBlob=blob;return 'blob:fixture';};
window.getLocalDateKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
window.isScheduledMainTeacher=(row,id)=>row.gvId===id||(row.gvList||[]).some(u=>u.id===id);
window.isScheduledSubstitute=(row,id)=>(row.gvThayTeList||[]).some(u=>u.id===id);
window.hasScheduledSubstitute=row=>(row.gvThayTeList||[]).length>0;
window.DBService={
_invalidate:()=>{},getSubjects:async()=>[{id:'g',name:'LIÊN KẾT',isGroup:true},{id:'a',name:'VẼ VIDA',parentId:'g'},{id:'o',name:'Tiếng Anh'}],
getUsers:async()=>[{id:'t',fullName:'Cô Ánh',roles:['teaching_assistant'],salary_config:{roles:[{id:'a',name:'VẼ VIDA',rate:100000},{id:'o',name:'Tiếng Anh',rate:100000}]}}],
getSystemSettings:async()=>({centerClosures:{}}),getSchedule:async key=>{
window.fixture.reads++;if(window.fixture.fail)throw new Error('mất kết nối thử nghiệm');
if(key!=='cs1__2026-10-01')return {};
return {morning1:[{start:'08:00',end:'09:00',lop:'VẼ VIDA',lopId:'a',gvList:[{id:'t'}]},
{start:'09:00',end:'10:00',lop:'Tiếng Anh',lopId:'o',gvList:[{id:'t'}]}]};},
getCancelledShifts:async(m,id)=>{(window.fixture.evaluated||=[]).push(id);return [];},getShiftObservationsForMonth:async()=>[],getOvertimeRequestsForStaff:async()=>[],getBonus10RequestsForStaff:async()=>[],getMonthlySalarySettings:async()=>({})};
const query={where(){return this;},async get(){return {docs:[{data:()=>({date:'2026-10-01',userId:'x',sessions:[{id:'sx',start:new Date('2026-10-01T09:00:00'),checkIn:new Date('2026-10-01T09:00:00'),checkOut:new Date('2026-10-01T10:00:00'),role:'o'}]})},{data:()=>({date:'2026-10-01',userId:'t',sessions:[{id:'s',start:new Date('2026-10-01T08:00:00'),checkIn:new Date('2026-10-01T08:00:00'),checkOut:new Date('2026-10-01T'+(window.fixture.minutes===60?'10:00:00':'08:30:00'))}]})}]};}};
window.fixture.adjust={};window.fixture.writes=[];
window.firebase={firestore:{FieldValue:{serverTimestamp:()=>({__ts:true})}}};
const adjustQuery={where(){return this;},async get(){return {docs:Object.entries(window.fixture.adjust).map(([id,data])=>({id,data:()=>data}))};}};
window.db={collection:name=>name==='partner_attendance_adjustments'?Object.assign({},adjustQuery,{doc:id=>({id})}):Object.assign({},query,{doc:id=>({id})}),
runTransaction:async fn=>fn({get:async ref=>({exists:!!window.fixture.adjust[ref.id],data:()=>window.fixture.adjust[ref.id]}),
set:(ref,data)=>{window.fixture.writes.push(ref.id);window.fixture.adjust[ref.id]=data;}})};

`;
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://local').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 const errors=[];
 try{
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.setRequestInterception(true);
 page.on('request',req=>{const url=req.url();if(url.includes('/js/firebase-config.js'))return req.respond({contentType:'text/javascript',body:fixture});
 if(url.includes('/js/db-service.js')||url.includes('/js/main.js')||url.includes('/js/ui-service.js')||url.includes('/js/auth-guard.js')||url.endsWith('/service-worker.js'))return req.respond({contentType:'text/javascript',body:''});
 if(url.startsWith('http://127.0.0.1:'))return req.continue();return req.abort();});
 await page.setViewport({width:1366,height:900});
 await page.goto('http://127.0.0.1:'+server.address().port+'/bang-cong-lien-ket.html?groupId=g',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('pa-month').value.length>0);
 await page.select('#pa-group','g');
 await page.evaluate(()=>{const input=document.getElementById('pa-month');input.value='2026-10';input.dispatchEvent(new Event('change'));});
 await page.waitForFunction(()=>document.getElementById('pa-export').disabled===false);
 assert.equal(await page.$$eval('.pa-ci',items=>items.length),1,'calendar is the default view and excludes outside classes');
 assert.equal(await page.$eval('.pa-day[data-date="2026-10-01"] .pa-day-total',node=>node.textContent),'Tổng: 1h 0p');
 assert.deepEqual(await page.evaluate(()=>Array.from(new Set(fixture.evaluated))),['t'],'staff with no group class are not evaluated');
 assert.equal(await page.$$eval('.pa-day:not(.pa-day-pad)',days=>days.length),31,'calendar shows every day of the month');
 assert.equal(await page.$eval('.pa-cal-head',node=>node.children.length),7);
 await page.click('.pa-ci .pa-edit-payroll');
 assert.match(await page.evaluate(()=>fixture.opened),/staffId=t&date=2026-10-01&roleView=giao-vien/,'Sửa công lương opens the exact payroll teacher/day');
 await page.evaluate(()=>{fixture.opened=null;});
 // Partner-only correction: keyboard search picks "Chỉnh cho liên kết" and opens the dialog.
 await page.type('#pa-search','Ánh');await page.waitForFunction(()=>!!document.querySelector('.pa-ci.kn-active'));await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.getElementById('pa-adjust').open);
 assert.match(await page.$eval('#pa-adj-payroll',n=>n.textContent),/1h 0p/);
 assert.equal(await page.$eval('#pa-adj-h',n=>n.value),'1');
 await page.select('#pa-adj-status','vkp');
 assert.equal(await page.$eval('#pa-adj-h',n=>n.disabled&&n.value==='0'),true,'absences zero the partner hours');
 await page.type('#pa-adj-note','Đối tác báo nghỉ');
 await page.screenshot({path:path.join(__dirname,'artifacts/partner-adjust-dialog.png')});
 await page.click('#pa-adj-save');await page.waitForFunction(()=>!document.getElementById('pa-adjust').open);
 const saved=await page.evaluate(()=>Object.values(fixture.adjust)[0]);
 assert.equal(saved.status,'vkp');assert.equal(saved.minutes,0);assert.equal(saved.active,true);assert.equal(saved.month,'2026-10');
 assert.deepEqual(Object.keys(saved).sort(),['active','checkIn','checkOut','createdAt','date','minutes','month','note','rowKey','staffId','status','updatedAt','updatedByName','updatedByStaffId'],'only rule-allowed fields are written');
 assert.equal(await page.evaluate(()=>fixture.writes.every(id=>!!fixture.adjust[id])),true,'writes go only to the partner collection');
 assert.equal(await page.$eval('.pa-ci .pa-flag-partner',n=>n.textContent),'Chỉnh riêng liên kết');
 assert.match(await page.$eval('.pa-ci .pa-ci-payroll',n=>n.textContent),/Công lương: 1h 0p \(không đổi\)/);
 assert.equal(await page.$('.pa-day[data-date="2026-10-01"] .pa-day-total'),null,'partner total follows the correction');
 assert.equal(await page.$eval('#pa-stats div:nth-child(2) strong',n=>n.textContent),'0');
 // Reload keeps it (read back from the partner collection), then revert to payroll values.
 await page.click('#pa-reload');await page.waitForFunction(()=>!document.getElementById('pa-export').disabled);
 assert.ok(await page.$('.pa-ci .pa-flag-partner'),'correction survives reload');
 await page.click('.pa-ci .pa-adjust');await page.waitForFunction(()=>document.getElementById('pa-adjust').open);
 assert.equal(await page.$eval('#pa-adj-clear',b=>b.hidden),false);
 await page.click('#pa-adj-clear');await page.waitForFunction(()=>!document.getElementById('pa-adjust').open);
 assert.equal(await page.evaluate(()=>Object.values(fixture.adjust)[0].active),false,'clearing is a soft flag, nothing deleted');
 assert.equal(await page.$eval('.pa-day[data-date="2026-10-01"] .pa-day-total',n=>n.textContent),'Tổng: 1h 0p','clearing restores payroll hours exactly');
 // Correct hours (not absence) and keep it for the export below.
 await page.click('.pa-ci .pa-adjust');await page.waitForFunction(()=>document.getElementById('pa-adjust').open);
 await page.select('#pa-adj-status','du');
 await page.$eval('#pa-adj-in',n=>{n.value='07:50';n.dispatchEvent(new Event('change'));});
 await page.$eval('#pa-adj-out',n=>{n.value='09:20';n.dispatchEvent(new Event('change'));});
 assert.deepEqual(await page.$eval('#pa-adj-h',n=>[n.value,document.getElementById('pa-adj-m').value]),['1','30'],'hours follow the edited clock range');
 await page.click('#pa-adj-save');await page.waitForFunction(()=>!document.getElementById('pa-adjust').open);
 assert.equal(await page.$eval('.pa-day[data-date="2026-10-01"] .pa-day-total',n=>n.textContent),'Tổng: 1h 30p');await page.$eval('#pa-search',input=>{input.value='';input.dispatchEvent(new Event('input'));});
 await page.screenshot({path:path.join(__dirname,'artifacts/partner-calendar-desktop.png'),fullPage:true});
 await page.click('#pa-view-list');
 assert.equal(await page.$$eval('#pa-body tr',rows=>rows.length),1,'list view keeps the table');
 assert.equal(await page.$eval('#pa-body tr td:nth-child(6)',cell=>cell.textContent),'1,5');
 assert.equal(await page.$eval('#pa-body tr td:nth-child(5)',cell=>cell.textContent),'07:50 / 09:20');
 assert.equal(await page.$eval('#pa-stats div:last-child strong',cell=>cell.textContent),'1');
 await page.type('#pa-search','Ánh');await page.waitForFunction(()=>!!document.querySelector('#pa-body .kn-active'));await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.getElementById('pa-adjust').open);await page.click('#pa-adj-cancel');
 await page.evaluate(()=>{fixture.minutes=30;});
 await page.click('#pa-export');await page.waitForFunction(()=>!!window.exportedBlob);
 assert.equal(await page.$eval('#pa-body tr td:nth-child(6)',cell=>cell.textContent),'1,5','a partner correction wins over later payroll edits');
 const partnerBytes=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await exportedBlob.arrayBuffer()))));
 assert.ok(partnerBytes.toString('utf8').includes('<v>1.5</v>')&&partnerBytes.toString('utf8').includes('07:50')&&partnerBytes.toString('utf8').includes('Đi đủ'),'Excel uses the partner correction');
 // "Dùng lại công lương": the row inherits payroll again, including the payroll edit made meanwhile.
 await page.click('#pa-body .pa-adjust');await page.waitForFunction(()=>document.getElementById('pa-adjust').open);
 await page.click('#pa-adj-clear');await page.waitForFunction(()=>!document.getElementById('pa-adjust').open);
 await page.evaluate(()=>{window.exportedBlob=null;});
 await page.click('#pa-export');await page.waitForFunction(()=>!!window.exportedBlob);
 assert.equal(await page.$eval('#pa-body tr td:nth-child(6)',cell=>cell.textContent),'0,5','export re-reads edits before downloading');
 const bytes=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await exportedBlob.arrayBuffer()))));
 assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.ok(bytes.toString('utf8').includes('<v>0.5</v>'));
 assert.ok(!bytes.toString('utf8').includes('100000'),'workbook has no rates or salaries');
 assert.ok(!bytes.toString('utf8').includes('Tiếng Anh'),'workbook has no outside subject');
 fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});fs.writeFileSync(path.join(__dirname,'artifacts/partner-attendance-ui.xlsx'),bytes);
 await page.screenshot({path:path.join(__dirname,'artifacts/partner-desktop.png'),fullPage:true});
 await page.setViewport({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile page must not overflow');
 await page.screenshot({path:path.join(__dirname,'artifacts/partner-mobile.png'),fullPage:true});
 await page.type('#pa-search','không có giáo viên');assert.equal(await page.$$eval('#pa-body tr',rows=>rows.length),0);assert.equal(await page.$eval('#pa-export',button=>button.disabled),true);
 await page.$eval('#pa-search',input=>{input.value='';input.dispatchEvent(new Event('input'));});
 await page.evaluate(()=>{fixture.fail=true;});await page.click('#pa-reload');
 await page.waitForFunction(()=>document.getElementById('pa-message').textContent.includes('Không thể tải đầy đủ'));
 assert.equal(await page.$eval('#pa-export',button=>button.disabled),true,'partial failure cannot export');
 assert.equal(await page.$$eval('#pa-body tr',rows=>rows.length),0,'partial failure cannot show stale totals');
 await page.evaluate(()=>{fixture.fail=false;});await page.click('#pa-reload');await page.waitForFunction(()=>!document.getElementById('pa-export').disabled);
 assert.deepEqual(errors,[]);console.log('partner UI: desktop/mobile, subject isolation, refresh-before-export, edit navigation, search and fail-closed retry passed');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
