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
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const roles = [
    {id:'fixture-huy',username:'fixturehuy',name:'Quang Huy ',roles:['teaching_assistant','receptionist']},
    {id:'fixture-nhan',username:'fixturenhan',name:'Nguyễn Phan Thanh Nhàn ',roles:['teaching_assistant']},
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
            await db.collection('schedules').doc(`cs1__${dateKey}`).set({evening1:[{shiftId:'fixture-class',start:'18:00',end:'19:30',lop:'Fixture class',lopId:'fixture-subject',phong:'P1',gvId:'fixture-nhan',gv:'Nguyễn Phan Thanh Nhàn ',gvList:[{id:'fixture-nhan',name:'Nguyễn Phan Thanh Nhàn '}],registeredTeachers:[]}]});
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
                // Never allow fixture code to touch a production Firebase API.
                if(/googleapis\.com$/.test(url.hostname)) {req.abort();return;}
                req.continue();
            });
            await page.goto(origin+'/index.html',{waitUntil:'domcontentloaded'});
            await page.type('#username',user.username);
            await page.type('#password',password);
            await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#login-form button[type="submit"]')]);
            const pages=user.roles.includes('admin')
                ? ['admin.html',`bao-cao.html?staffId=fixture-nhan&date=${payrollDate}`,'lich-lam.html','lich-tiep-tan.html','lich-van-phong.html','nhan-su.html','he-thong.html']
                : ['nhan-vien.html','cham-cong.html','bao-cao.html','lich-lam.html'];
            for(const route of pages) {
                const started=Date.now();
                await page.goto(origin+'/'+route,{waitUntil:'domcontentloaded',timeout:60000});
                await page.waitForFunction(()=>window.__TDT_CORE_BOOTSTRAP_READY__===true,{timeout:30000});
                if(route.startsWith('bao-cao')) await page.waitForFunction(()=>window.__TDT_REPORT_BOOTSTRAP_READY__===true,{timeout:30000});
                if(route.startsWith('bao-cao') && user.roles.includes('admin')) {
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
