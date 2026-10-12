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
window.db={collection:()=>query};
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
 await page.type('#pa-search','Ánh');await page.waitForFunction(()=>!!document.querySelector('.pa-ci.kn-active'));await page.keyboard.press('Enter');
 assert.match(await page.evaluate(()=>fixture.opened),/staffId=t&date=2026-10-01&roleView=giao-vien/,'calendar edit button opens the exact teacher/day');
 await page.evaluate(()=>{fixture.opened=null;});await page.$eval('#pa-search',input=>{input.value='';input.dispatchEvent(new Event('input'));});
 await page.screenshot({path:path.join(__dirname,'artifacts/partner-calendar-desktop.png'),fullPage:true});
 await page.click('#pa-view-list');
 assert.equal(await page.$$eval('#pa-body tr',rows=>rows.length),1,'list view keeps the table');
 assert.equal(await page.$eval('#pa-body tr td:nth-child(6)',cell=>cell.textContent),'1');
 assert.equal(await page.$eval('#pa-stats div:last-child strong',cell=>cell.textContent),'1');
 await page.type('#pa-search','Ánh');await page.waitForFunction(()=>!!document.querySelector('#pa-body .kn-active'));await page.keyboard.press('Enter');
 assert.match(await page.evaluate(()=>fixture.opened),/staffId=t&date=2026-10-01&roleView=giao-vien/);
 await page.evaluate(()=>{fixture.minutes=30;});
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
