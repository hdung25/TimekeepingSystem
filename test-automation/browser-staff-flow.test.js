'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const root = path.resolve(__dirname,'..');
const password = 'LocalFixtureOnly-20260905';
const dateKey = new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const payrollDate = new Date(Date.now()+7*3600000-86400000).toISOString().slice(0,10);
const futureScheduleDate = new Date(Date.now()+7*3600000+86400000).toISOString().slice(0,10);
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const roles = [
    {id:'fixture-huy',username:'fixturehuy',name:'Quang Huy ',roles:['teaching_assistant','receptionist']},
    {id:'fixture-nhan',username:'fixturenhan',name:'Nguyễn Phan Thanh Nhàn ',roles:['teaching_assistant']},
    {id:'fixture-senior',username:'fixturesenior',name:'Fixture Senior',roles:['senior_assistant']},
    {id:'fixture-assistant',username:'fixtureassistant',name:'Fixture Assistant',roles:['assistant']},
    {id:'fixture-office',username:'fixtureoffice',name:'Fixture Office',roles:['office_staff']},
    {id:'fixture-reception',username:'fixturereception',name:'Fixture Reception',roles:['receptionist_assistant']},
    {id:'fixture-staff',username:'fixturestaff',name:'Fixture Staff',roles:['staff']},
    {id:'fixture-admin',username:'fixtureadmin',name:'Fixture Admin',roles:['admin']}
];
async function main() {
    for(const host of [emulatorHost,authHost]) assert.match(host||'',/^127\.0\.0\.1:\d+$/,'Local emulators required');
    const env=await initializeTestEnvironment({projectId:'demo-timekeeping',firestore:{rules:fs.readFileSync(path.join(root,'firestore.rules'),'utf8')}});
    let browser,server;
    try {
        await env.clearFirestore();
        await fetch(`http://${authHost}/emulator/v1/projects/demo-timekeeping/accounts`,{method:'DELETE'});
        for(const user of roles) {
            if(user.roles.includes('admin')) await env.withSecurityRulesDisabled(async c=>{
                await c.firestore().collection('attendance_logs').doc(`${payrollDate}_fixture-nhan`).set({
                    userId:'fixture-nhan',name:'Nguyễn Phan Thanh Nhàn ',date:payrollDate,
                    sessions:[{id:'fixture-payroll',source:'admin',type:'admin_add',role:'fixture-subject',roleName:'Fixture class',roleRate:100000,
                        start:payrollDate+'T18:00:00+07:00',checkIn:payrollDate+'T18:00:00+07:00',checkOut:payrollDate+'T19:30:00+07:00'}]
                });
            });
            const response=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fixture`,{
                method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.username+'@tuduytre.com',password,returnSecureToken:true})
            });
            assert.equal(response.ok,true);
            user.authUid=(await response.json()).localId;
        }
        await env.withSecurityRulesDisabled(async c=>{
            const db=c.firestore();
            for(const u of roles) {
                await db.collection('users').doc(u.id).set({...u,role:u.roles[0],salary_config:{attendance_rate:100000,roles:[{id:'fixture-subject',name:'Fixture class',rate:100000}]}});
                await db.collection('user_roles').doc(u.authUid).set({userId:u.id,username:u.username,role:u.roles[0],roles:u.roles});
                const {authUid,...publicUser}=u;
                await db.collection('staff_directory').doc(u.id).set({...publicUser,role:u.roles[0]});
            }
            await db.collection('settings').doc('system').set({gpsCS1Lat:10,gpsCS1Lng:106,gpsCS1Radius:200});
            await db.collection('subjects').doc('fixture-subject').set({name:'Fixture class',rate:100000});
            await db.collection('schedules').doc(`cs1__${payrollDate}`).set({morning1:[{
                shiftId:'fixture-closure',start:'07:30',end:'09:00',lop:'Fixture class',lopId:'fixture-subject',
                phong:'P1',gvId:'fixture-staff',gv:'Fixture Staff',gvList:[{id:'fixture-staff',name:'Fixture Staff'}],
                note:'Preserve this note',registeredTeachers:[]
            }]});
            await db.collection('schedules').doc(`cs1__${dateKey}`).set({evening1:[{shiftId:'fixture-class',start:'18:00',end:'19:30',lop:'Fixture class',lopId:'fixture-subject',phong:'P1',gvId:'fixture-nhan',gv:'Nguyễn Phan Thanh Nhàn ',gvList:[{id:'fixture-nhan',name:'Nguyễn Phan Thanh Nhàn '}],registeredTeachers:[]}]});
            await db.collection('schedules').doc(`cs1__${futureScheduleDate}`).set({
                morning1:[{
                    shiftId:'fixture-roster-refresh',start:'07:30',end:'09:00',lop:'Fixture class',lopId:'fixture-subject',phong:'P1',
                    gvId:'fixture-nhan',gv:'Nguyễn Phan Thanh Nhàn ',gvList:[{id:'fixture-nhan',name:'Nguyễn Phan Thanh Nhàn '}],
                    note:'Roster target note',registeredTeachers:[]
                }],
                evening2:[{
                    shiftId:'fixture-roster-neighbor',start:'19:30',end:'21:00',lop:'Fixture class',lopId:'fixture-subject',phong:'P2',
                    gvId:'fixture-staff',gv:'Fixture Staff',gvList:[{id:'fixture-staff',name:'Fixture Staff'}],
                    note:'Neighbor must survive',registeredTeachers:[]
                }]
            });
        });
        server=http.createServer((req,res)=>{
            const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
            const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
            if(!file.startsWith(root+path.sep)||! /\.(html|js|css|png|jpg|jpeg|svg|ico|json|woff2?|ttf)$/i.test(file)||/node_modules|\/\./.test(pathname)) {res.writeHead(403);res.end();return;}
            try {
                let body=fs.readFileSync(file);
                if(pathname==='/js/firebase-config.js') {
                    body=body.toString().replace(/projectId: "[^"]+"/,'projectId: "demo-timekeeping"')
                        .replace('window.auth = firebase.auth();',`window.auth = firebase.auth();\nwindow.auth.useEmulator('http://${authHost}', {disableWarnings:true});\nwindow.db.useEmulator('127.0.0.1', ${emulatorHost.split(':')[1]});`);
                }
                if(pathname==='/service-worker.js') body='self.addEventListener("install",()=>self.skipWaiting());';
                const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
                res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);
            } catch (_) {res.writeHead(404);res.end();}
        });
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const origin=`http://127.0.0.1:${server.address().port}`;
        browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
        for(const user of roles) {
            const context=await browser.createBrowserContext();
            await context.overridePermissions(origin,['geolocation']);
            const page=await context.newPage();
            await page.setViewport({width:user.roles.includes('admin')?1280:390,height:844,isMobile:!user.roles.includes('admin')});
            await page.emulateTimezone('Asia/Ho_Chi_Minh');
            await page.setGeolocation({latitude:10,longitude:106,accuracy:10});
            const errors=[];
            page.on('pageerror',e=>errors.push(e.message));
            await page.setRequestInterception(true);
            page.on('request',req=>{
                const url=new URL(req.url());
                // Use the pinned SDK installed by this test project. External
                // optional CDNs must not stall or invalidate a local flow test.
                const sdk = /^\/firebasejs\/12\.18\.0\/(firebase-[a-z-]+-compat\.js)$/.exec(url.pathname);
                if (url.hostname === 'www.gstatic.com' && sdk) {
                    req.respond({status:200,contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'node_modules/firebase',sdk[1]))});return;
                }
                // Never allow fixture code to touch a production Firebase API.
                if(/googleapis\.com$/.test(url.hostname)) {req.abort();return;}
                if(!['localhost','127.0.0.1'].includes(url.hostname)) {
                    req.respond({status:200,contentType:req.resourceType()==='stylesheet'?'text/css':'text/javascript',body:''});return;
                }
                req.continue();
            });
            await page.goto(origin+'/index.html',{waitUntil:'domcontentloaded'});
            await page.type('#username',user.username);
            await page.type('#password',password);
            await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#login-form button[type="submit"]')]);
            const pages=user.roles.includes('admin')
                ? ['admin.html',`bao-cao.html?staffId=fixture-nhan&date=${payrollDate}`,`bao-cao.html?staffId=fixture-huy&date=${payrollDate}`,'lich-lam.html','lich-tiep-tan.html','lich-van-phong.html','nhan-su.html','he-thong.html']
                : user.roles.includes('senior_assistant')
                    ? ['admin.html','cham-cong.html',`bao-cao.html?staffId=${user.id}`,'lich-lam.html']
                    : ['nhan-vien.html','cham-cong.html','bao-cao.html','lich-lam.html'];
            for(const route of pages) {
                const started=Date.now();
                await page.goto(origin+'/'+route,{waitUntil:'domcontentloaded',timeout:60000});
                await page.waitForFunction(()=>window.__TDT_CORE_BOOTSTRAP_READY__===true,{timeout:30000});
                if(route.startsWith('bao-cao')) await page.waitForFunction(()=>window.__TDT_REPORT_BOOTSTRAP_READY__===true,{timeout:30000});
                if(route.includes('staffId=fixture-nhan') && user.roles.includes('admin')) {
                    const edit='[data-edit-session-id="fixture-payroll"]';
                    await page.waitForSelector(edit,{timeout:30000});
                    await page.click(edit);
                    await page.waitForSelector('#apo-reason',{visible:true});
                    await page.type('#apo-reason','Fixture: Admin xác nhận ca và +10 phút');
                    await page.click('#apo-admin-early10');
                    await page.click('[onclick="saveEditedTime()"]');
                    await page.waitForFunction(()=>document.getElementById('edit-time-modal').style.display==='none',{timeout:30000});
                    let saved;
                    await env.withSecurityRulesDisabled(async c=>{saved=(await c.firestore().collection('attendance_logs').doc(`${payrollDate}_fixture-nhan`).get()).data();});
                    assert.equal(saved.sessions[0].adminPayrollOverride.adminEarly10.enabled,true,'primary Admin must save +10 without a matching schedule');
                    await page.waitForFunction(()=> (window.allMonthChips||[]).some(c=>c.sessionId==='fixture-payroll'&&c.paidMinutes===100),{timeout:30000});
                    console.log('PASS Admin actual Sửa công button -> +10 decision without schedule -> transaction -> 100-minute chip');
                    await page.evaluate(async () => {
                        window.__realOTReader = DBService.getOvertimeRequestsForStaff;
                        window.__realPublisher = DBService.publishSalary;
                        window.__publishInvocations = 0;
                        DBService.getOvertimeRequestsForStaff = async () => {throw new Error('Fixture: payroll input unavailable');};
                        DBService.publishSalary = async () => {window.__publishInvocations++;};
                        await renderMonthReport(currentDate, true);
                        await publishSalary();
                    });
                    const failed = await page.evaluate(() => ({ready:window.payrollReadyScope,calls:window.__publishInvocations,text:document.getElementById('calendar-grid').innerText}));
                    assert.equal(failed.ready,null);assert.equal(failed.calls,0);assert.match(failed.text,/Chưa thể tải/);
                    await page.evaluate(async () => {
                        DBService.getOvertimeRequestsForStaff = window.__realOTReader;
                        DBService.publishSalary = window.__realPublisher;
                        await renderMonthReport(currentDate, true);
                    });
                    await page.waitForFunction(()=>window.payrollReadyScope===window.currentReportScope,{timeout:30000});
                    console.log('PASS failed financial read blocks actual publish handler; retry restores complete report');
                }
                if(route.startsWith('bao-cao')) await page.waitForFunction(()=>window.payrollReadyScope===window.currentReportScope && !!window.payrollReadyScope,{timeout:30000});
                if(route.includes('staffId=fixture-huy') && user.roles.includes('admin')) {
                    await page.evaluate(async () => {
                        window.__realMonthlyReader = DBService.getMonthlyAttendance;
                        window.__realPublisher = DBService.publishSalary;
                        window.__publishInvocations = 0;
                        DBService.getMonthlyAttendance = async (...args) => {
                            if(args[1] === 'fixture-reception') throw new Error('Fixture: collective bonus attendance unavailable');
                            return window.__realMonthlyReader(...args);
                        };
                        DBService.publishSalary = async () => {window.__publishInvocations++;};
                        await renderMonthReport(currentDate, true);
                        await publishSalary();
                    });
                    assert.deepEqual(await page.evaluate(() => [window.payrollReadyScope, window.__publishInvocations]), [null, 0]);
                    await page.evaluate(async () => {
                        DBService.getMonthlyAttendance = window.__realMonthlyReader;
                        DBService.publishSalary = window.__realPublisher;
                        await renderMonthReport(currentDate, true);
                    });
                    await page.waitForFunction(()=>window.payrollReadyScope===window.currentReportScope && !!window.payrollReadyScope,{timeout:30000});
                    console.log('PASS collective receptionist attendance failure blocks dual-role payroll publication; retry recovers');
                }
                if(route==='cham-cong.html') {
                    await page.waitForFunction(()=>window.__TDT_TIMEKEEPING_BOOTSTRAP_READY__===true,{timeout:30000});
                    await page.waitForSelector('#global-checkin-container button[onclick="globalCheckIn(this)"]');
                    await page.click('#global-checkin-container button[onclick="globalCheckIn(this)"]');
                    await page.waitForSelector('#global-checkin-container button[onclick="globalCheckOut(this)"]',{timeout:30000});
                    await page.click('#global-checkin-container button[onclick="globalCheckOut(this)"]');
                    await page.waitForSelector('#global-checkin-container button[onclick="globalCheckIn(this)"]',{timeout:30000});
                    let saved;
                    await env.withSecurityRulesDisabled(async c=>{saved=(await c.firestore().collection('attendance_logs').doc(`${dateKey}_${user.id}`).get()).data();});
                    assert.equal(saved.sessions.length,1);assert.equal(saved.sessions[0].status,'closed');assert.equal(saved.name,user.name);
                }
                if(route==='lich-lam.html' && user.roles.includes('admin')) {
                    await page.evaluate(date=>goToDatePickerDate(date),payrollDate);
                    const toggle='input[data-row-locator*="fixture-closure"]';
                    await page.waitForSelector(toggle,{timeout:30000});
                    assert.equal(await page.$eval(toggle,el=>!!el.closest('tr').querySelector('button[title="Xóa lớp"]')),false);
                    for(const closed of [true,false]) {
                        await page.waitForFunction(s => { const el = document.querySelector(s); return el && !el.closest('tbody').inert; }, {}, toggle);
                        await page.click(toggle);
                        await page.waitForSelector('[data-closure-reason]',{visible:true});
                        await page.type('[data-closure-reason]',closed?'Fixture: lớp nghỉ báo trễ':'Fixture: khôi phục lớp');
                        await page.click('[data-save]');
                        await page.waitForFunction(()=>window.__classClosurePending===false,{timeout:30000});
                        await page.waitForSelector(toggle);
                        let row;
                        await env.withSecurityRulesDisabled(async c=>{row=(await c.firestore().collection('schedules').doc(`cs1__${payrollDate}`).get()).data().morning1[0];});
                        assert.equal(row.isClosed,closed);
                        assert.equal(row.note,'Preserve this note');
                        assert.equal(row.gvId,'fixture-staff');
                        assert.equal(row.classClosureHistory.length,closed?1:2);
                    }
                    console.log('PASS past class closure/reopen through actual manager UI preserves notes/assignment/audit; delete stays locked');

                    // Reproduce the production report: personnel is added after the
                    // schedule page already cached its directory. Opening the shift
                    // picker must re-read the server, distinguish duplicate names by
                    // username, and preserve the adjacent shift when replacing the
                    // sole main teacher.
                    await page.evaluate(date=>goToDatePickerDate(date),futureScheduleDate);
                    const rosterCell='tr[data-row-locator*="fixture-roster-refresh"] [data-field="gv"] .gv-multi-btn';
                    await page.waitForSelector(rosterCell,{timeout:30000});
                    await page.waitForFunction(()=>Array.isArray(window._teacherList) && !window._teacherList.some(item=>item.id==='fixture-thanh-thuy'),{timeout:30000});
                    let neighborBefore;
                    await env.withSecurityRulesDisabled(async c=>{
                        neighborBefore=(await c.firestore().collection('schedules').doc(`cs1__${futureScheduleDate}`).get()).data().evening2[0];
                    });
                    await env.withSecurityRulesDisabled(async c=>{
                        const freshTeacher={
                            id:'fixture-thanh-thuy',username:'fixturethanhthuy',name:'Thanh Thủy',
                            role:'teaching_assistant',roles:['teaching_assistant']
                        };
                        await c.firestore().collection('users').doc(freshTeacher.id).set(freshTeacher);
                        await c.firestore().collection('staff_directory').doc(freshTeacher.id).set(freshTeacher);
                    });
                    await page.click(rosterCell);
                    await page.waitForSelector('#gv-picker-overlay',{visible:true,timeout:30000});
                    const freshSelector='input[data-action="toggle-main"][data-teacher-id="fixture-thanh-thuy"]';
                    await page.waitForFunction(selector=>{
                        const input=document.querySelector(selector);
                        return input && !input.closest('.teacher-roster-item').hidden;
                    },{timeout:30000},freshSelector);
                    assert.match(await page.$eval(freshSelector,input=>input.closest('.teacher-roster-item').innerText),/@fixturethanhthuy/,
                        'duplicate names must be distinguishable by username');

                    const search='input[data-action="roster-search"][data-kind="main"]';
                    await page.type(search,'Thanh Thuy');
                    assert.equal(await page.$eval(freshSelector,input=>input.closest('.teacher-roster-item').hidden),false,
                        'teacher search must work without Vietnamese tone marks');
                    await page.$eval(search,input=>{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));});

                    const oldMain='input[data-action="toggle-main"][data-teacher-id="fixture-nhan"]';
                    // The roster may replace its own DOM while a live directory
                    // refresh settles. Query and click in one browser task so a
                    // stale Puppeteer handle cannot make this flow flaky.
                    await page.$eval(oldMain,input=>input.click());
                    assert.equal(await page.$eval(oldMain,input=>input.checked),true,
                        'the last main teacher cannot be removed before a replacement is selected');
                    await page.$eval(freshSelector,input=>input.click());
                    await page.$eval(oldMain,input=>input.click());
                    assert.equal(await page.$eval(oldMain,input=>input.checked),false);
                    await page.click('[data-action="save-manager"]');
                    await page.waitForFunction(()=>!document.getElementById('gv-picker-overlay'),{timeout:30000});
                    let rosterSaved;
                    await env.withSecurityRulesDisabled(async c=>{
                        rosterSaved=(await c.firestore().collection('schedules').doc(`cs1__${futureScheduleDate}`).get()).data();
                    });
                    assert.deepEqual(rosterSaved.morning1[0].gvList.map(item=>item.id),['fixture-thanh-thuy']);
                    assert.equal(rosterSaved.morning1[0].note,'Roster target note');
                    assert.deepEqual(rosterSaved.evening2[0],neighborBefore,
                        'replacing a teacher must not rewrite another shift');
                    console.log('PASS newly added teacher refresh -> accent-insensitive search -> safe sole-main replacement -> adjacent shift preserved');
                }
                if(route==='lich-lam.html' && user.roles.includes('senior_assistant')) {
                    await page.evaluate(date=>goToDatePickerDate(date),futureScheduleDate);
                    const rosterCell='tr[data-row-locator*="fixture-roster-refresh"] [data-field="gv"] .gv-multi-btn';
                    await page.waitForSelector(rosterCell,{timeout:30000});
                    await page.click(rosterCell);
                    await page.waitForSelector('#gv-picker-overlay',{visible:true,timeout:30000});
                    const mobileDialog = await page.$eval('.teacher-shift-dialog',dialog=>{
                        const rect=dialog.getBoundingClientRect();
                        return {left:rect.left,right:rect.right,viewport:innerWidth,hasRefresh:!!dialog.querySelector('[data-action="refresh-roster"]')};
                    });
                    assert.equal(mobileDialog.hasRefresh,true);
                    assert.ok(mobileDialog.left>=-1 && mobileDialog.right<=mobileDialog.viewport+1,
                        'mobile senior scheduler dialog must remain inside the viewport');
                    await page.click('[data-action="close-manager"]');
                    await page.waitForFunction(()=>!document.getElementById('gv-picker-overlay'));
                    console.log('PASS senior scheduler can open refreshed teaching roster on mobile without horizontal overflow');
                }
                if(route==='nhan-su.html') {
                    await page.waitForSelector('#ns-refresh');
                    await page.click('#ns-refresh');
                    await page.waitForFunction(()=>window.NhanSu && !NhanSu._state.reloading,{timeout:30000});
                    assert.equal(await page.$$eval('#ns-list .ns-card',rows=>rows.length),
                        roles.length + (user.roles.includes('admin') ? 1 : 0));
                    console.log('PASS personnel explicit refresh preserves full staff list');
                }
                const view=await page.evaluate(()=>({title:document.title,text:document.body.innerText.slice(0,600),width:document.documentElement.scrollWidth,viewport:innerWidth}));
                assert.ok(view.text.length>30);
                assert.equal(page.url().includes('index.html'),false,route+' must not bounce to login');
                console.log(JSON.stringify({user:user.username,page:route,readyMs:Date.now()-started,width:view.width,viewport:view.viewport,errors:[...errors]}));
                if(route.startsWith('bao-cao')||route==='cham-cong.html') await page.screenshot({path:path.join(os.tmpdir(),`tdt-${user.username}-${route.split('.')[0]}.png`)});
            }
            assert.deepEqual(errors,[],'uncaught browser errors');
            await context.close();
        }
        console.log('PASS isolated browser login, check-in/out and core-page smoke tests');
    } finally {
        if(browser) await browser.close();
        if(server) await new Promise(r=>server.close(r));
        await env.cleanup();
    }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
