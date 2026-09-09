'use strict';
const assert = require('node:assert/strict');
module.exports = async ({env,admin,origin,record,click}) => {
    const staff='audit-teacher', date='2026-08-13', sessionId=1786618060233;
    const path=`attendance_logs/${date}_${staff}`;
    const session={id:sessionId,checkIn:date+'T10:47:40.162Z',start:date+'T10:47:40.162Z',checkOut:date+'T12:30:00.000Z',role:'audit-math',roleName:'Toán 5',roleRate:100000};
    const read=async()=>{let data;await env.withSecurityRulesDisabled(async c=>{data=(await c.firestore().doc(path).get()).data();});return data;};
    await env.withSecurityRulesDisabled(async c=>{
        const db=c.firestore();
        for(let d=1;d<=31;d++) for(const branch of ['cs1','cs2','cs3']) await db.collection('schedules').doc(`${branch}__2026-08-${String(d).padStart(2,'0')}`).set({morning1:[],afternoon1:[],evening1:[],evening2:[]});
        await db.doc(`schedules/cs1__${date}`).update({evening1:[{gvId:staff,gvList:[{id:staff,name:'Audit Teacher'}],lop:'Toán 5',lopId:'audit-math',start:'18:00',end:'19:30'}]});
        await db.doc(path).set({userId:staff,date,sessions:[session],notes:'preserve day notes'});
    });
    const reload=async()=>{await admin.goto(`${origin}/bao-cao.html?staffId=${staff}&date=${date}`,{waitUntil:'domcontentloaded'});await admin.waitForFunction(()=>window.__TDT_REPORT_BOOTSTRAP_READY__ && !!window.payrollReadyScope && window.payrollReadyScope===window.currentReportScope,{timeout:45000});};
    const open=async()=>{await admin.evaluate(async ({date,sessionId})=>{const chip=window.allMonthChips.find(c=>String(c.sessionId)===String(sessionId));if(!chip)throw Error('missing incident chip');await openEditModal(date,sessionId,chip);},{date,sessionId});};
    const fill=async(selector,value)=>admin.$eval(selector,(el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
    const save=()=>admin.evaluate(()=>saveEditedTime());
    await reload();await open();
    const defaultMode=await admin.$eval('#apo-mode',e=>e.value);
    // Diagnose the original actual-mode failure with a genuine SDK round trip.
    await admin.select('#apo-mode','actual');await fill('#apo-reason','Fixture hỗ trợ giữ lớp');await save();
    await open();
    const tokens=await admin.evaluate(async ({date,staff})=>{const raw=window.currentAttendanceMap[date][0];const live=(await db.doc(`attendance_logs/${date}_${staff}`).get({source:'server'})).data().sessions[0];return {expected:window.currentAdminPayrollEditContext.expectedFingerprint,raw:DBService.getAdminPayrollSessionFingerprint(raw),live:DBService.getAdminPayrollSessionFingerprint(live)};},{date,staff});
    await record('scheduled-overtime-fingerprint',{defaultMode,...tokens});
    assert.equal(tokens.expected,tokens.live,'opening an unchanged saved override must not report a concurrent edit');
    assert.equal((await read()).sessions[0].checkIn,session.checkIn,'overtime-only edits retain seconds in the clock evidence');
    // Rewrite only map order, as Firestore readers may do on serialization.
    await env.withSecurityRulesDisabled(async c=>{
        const data=await read();
        const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
        await c.firestore().doc(path).update({sessions:data.sessions.map(reorder)});
    });
    await admin.select('#apo-mode','schedule');await fill('#edit-overtime-minutes',15);await save();
    const saved=await read();
    assert.equal(saved.sessions[0].adminPayrollOverride.mode,'schedule');
    assert.equal(saved.notes,'preserve day notes');
    const view=await admin.evaluate(id=>window.allMonthChips.filter(c=>String(c.sessionId)===String(id)).map(c=>({text:c.text,minutes:c.paidMinutes,overtime:c.overtimeMinutes})),sessionId);
    assert.equal(view.reduce((n,c)=>n+c.minutes,0),105,'18:00–19:30 + approved 15 minutes');
    assert.match(view[0].text,/18:00/);
    await open();await fill('#edit-overtime-minutes',0);await save();
    assert.equal(await admin.evaluate(id=>window.allMonthChips.filter(c=>String(c.sessionId)===String(id)).reduce((n,c)=>n+c.paidMinutes,0),sessionId),90,'reversing overtime restores schedule hours');
    assert.equal(defaultMode,'schedule','an ordinary edit must preserve schedule mode');
    await open();
    const concurrent=await read();concurrent.sessions[0].checkOut=date+'T12:45:00.000Z';
    await env.withSecurityRulesDisabled(c=>c.firestore().doc(path).update({sessions:concurrent.sessions}));
    await fill('#edit-overtime-minutes',30);await save();
    assert.deepEqual(await read(),concurrent,'stale popup must not overwrite an actual clock edit');
    await admin.evaluate(()=>closeEditModal());
    await record('scheduled-overtime-result',{view,restoredMinutes:90,defaultMode});
    await env.withSecurityRulesDisabled(async c=>{
        const db=c.firestore();await db.doc(path).delete();
        const overtime=await db.collection('overtime_requests').where('staffId','==',staff).where('dateKey','==',date).get();
        for(const doc of overtime.docs)await doc.ref.delete();
    });
};
