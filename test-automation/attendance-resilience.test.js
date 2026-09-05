'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const dbSource = fs.readFileSync(path.join(root,'js/db-service.js'),'utf8');
const mainSource = fs.readFileSync(path.join(root,'js/main.js'),'utf8');
const quiet = {log(){},warn(){},error(){}};

async function main() {
    let reads=0;
    const db={collection:()=>({doc:()=>({get:async()=>{
        reads++;
        if(reads===1) throw Object.assign(new Error('offline'),{code:'unavailable'});
        return {exists:true,data:()=>({sessions:[{id:'saved',checkIn:'2026-09-05T01:00:00Z'}]})};
    }})})};
    const service = new Function('window','db','console', dbSource+'\nreturn DBService;')({},db,quiet);
    await assert.rejects(service.getPersonalAttendance('2026-09-05','staff'),{code:'unavailable'});
    assert.equal((await service.getPersonalAttendance('2026-09-05','staff')).sessions[0].id,'saved');
    assert.equal(reads,2,'failed read must be evicted rather than cached as no attendance');

    let writes=0;
    const alerts=[];
    const window={};
    const snippet=mainSource.slice(mainSource.indexOf('function getStaffAttendanceErrorMessage'),mainSource.indexOf('// ================= ARCHIVER CONTROLLER'));
    const load=new Function('window','document','localStorage','DBService','console','alert','renderGlobalCheckIn','renderTodayChips',
        snippet+'\nreturn {getStaffAttendanceErrorMessage};');
    const helpers=load(window,{querySelector:()=>null},{getItem:()=> 'staff'},
        {checkInPersonal:async()=>{writes++;},checkOutPersonal:async()=>{writes++;}},quiet,
        m=>alerts.push(m),async()=>{throw new Error('display unavailable');},async()=>{});
    assert.match(helpers.getStaffAttendanceErrorMessage({code:'auth/network-request-failed'}),/Kết nối mạng/);
    await window.globalCheckIn({disabled:false,innerText:''});
    await window.globalCheckOut({disabled:false,innerText:''});
    assert.equal(writes,2);
    assert.equal(alerts.filter(m=>m.startsWith('Đã lưu chấm công')).length,2);
    assert.equal(alerts.some(m=>/Không thể chấm công|Phiên đăng nhập/.test(m)),false);
    assert.equal(window.__attendanceCheckInPending,false);
    assert.equal(window.__attendanceCheckOutPending,false);

    const failedWindow={};
    const failedAlerts=[];
    load(failedWindow,{querySelector:()=>null},{getItem:()=> 'staff'},
        {checkOutPersonal:async()=>{throw Object.assign(new Error('Missing or insufficient permissions'),{code:'permission-denied'});}},quiet,
        m=>failedAlerts.push(m),async()=>{throw new Error('offline refresh');},async()=>{});
    const retryButton={disabled:false,innerText:''};
    await failedWindow.globalCheckOut(retryButton);
    assert.equal(failedAlerts.length,1);
    assert.match(failedAlerts[0],/Phiên đăng nhập/);
    assert.doesNotMatch(failedAlerts[0],/insufficient permissions/);
    assert.equal(retryButton.disabled,false);
    assert.equal(failedWindow.__attendanceCheckOutPending,false);

    for(const busy of [true,false]) {
        let reloads=0;
        const listeners={};
        const notices=[];
        const w={__attendanceCheckInPending:busy,location:{reload(){reloads++;}},addEventListener(){}};
        const document={addEventListener(){},getElementById:()=>null,createElement:()=>({style:{}}),body:{appendChild:n=>notices.push(n)}};
        const update=mainSource.slice(mainSource.indexOf('(function setupAppAutoUpdate'),mainSource.indexOf('// Main Logic'));
        new Function('window','document','navigator','sessionStorage','APP_VERSION',update)(w,document,
            {serviceWorker:{addEventListener:(k,v)=>listeners[k]=v}},
            {getItem:()=>null,setItem:(k,v)=>assert.notEqual(v,'[object Event]')},'fixture-v1');
        listeners.controllerchange({type:'controllerchange'});
        assert.equal(reloads,busy?0:1,'service worker must never reload during attendance mutation');
        if(busy) {
            assert.equal(notices.length,1);
            notices[0].onclick();assert.equal(reloads,0);
            w.__attendanceCheckInPending=false;
            notices[0].onclick();assert.equal(reloads,1);
        }
    }
    console.log('attendance-resilience.test.js: all assertions passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
