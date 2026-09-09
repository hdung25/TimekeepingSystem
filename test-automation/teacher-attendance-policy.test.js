'use strict';
const assert = require('node:assert/strict');
const {calculate, sourceFromChips, automaticAttendance} = require('../js/teacher-attendance-policy.js');
const stats = (hours, vp=0, vdx=0, vkp=0, unreported=0) => ({minutes:hours*60,vp,vdx,vkp,unreported});
// Independent evaluation of the supplied Excel formula, across every absence
// priority and both sides of the 50/64.99/65-hour boundaries.
const formula='IF(AN4>0,-3000*U4,IF(AM4>0,-2000*U4,IF(AND(AL4>0,U4<50),-1000*U4,IF(AL4=0,IF(U4<65,1000*U4,2000*U4),IF(AL4=1,IF(U4<50,0,IF(U4<65,1000*U4,2000*U4)),IF(AL4=2,IF(U4>64.99,2000*U4,0),0))))))';
const excel=new Function('U4','AL4','AM4','AN4','IF','AND','return '+formula.replace(/AL4=/g,'AL4==='));
for(const h of [0,12,29.99,49.99,50,50.01,60,64.99,64.995,65,65.01,80,100])
for(let vp=0;vp<=4;vp++)for(let vdx=0;vdx<=2;vdx++)for(let vkp=0;vkp<=2;vkp++) {
    const expected=Math.round(excel(h,vp,vdx,vkp,(condition,a,b)=>condition?a:b,(...v)=>v.every(Boolean)))||0;
    assert.equal(automaticAttendance('old',stats(h,vp,vdx,vkp)).amount,expected,JSON.stringify({h,vp,vdx,vkp}));
}
assert.equal(automaticAttendance('old',stats(60,1)).amount,60000,'one permitted absence does not cancel eligible reward');
assert.equal(automaticAttendance('old',stats(12,3,0,0,1)).amount,-24000,'unreported absence has unexpected-leave priority');
assert.equal(automaticAttendance('new',stats(12,3,2,1),0).amount,0);
assert.equal(automaticAttendance('new',stats(4),1234).amount,4936);
assert.equal(automaticAttendance('new',{...stats(0),minutes:125},1234).amount,2571);
const old = {mode:'old',eligible:true,fixed:true,attendance:true,absenceRule:'highest',rewardRule:'both'};
const amount = (input, s, id=0) => calculate(input,s).rows.find(r=>r.id===id).amount;
for (const [h,a] of [[49.99,0],[50,0],[50.5,50500],[65,65000],[65.5,131000],[80,160000],[80.5,161000]]) assert.equal(amount(old,stats(h)),a);
assert.equal(amount(old,stats(60,1)),0,'60 hours + one permitted absence cancels reward and penalty');
assert.equal(amount({...old,rewardRule:'penaltyOnly'},stats(60,1)),-60000);
assert.equal(amount(old,stats(66,2)),66000);
assert.equal(amount({...old,absenceRule:'each'},stats(66,2)),0);
assert.equal(amount(old,stats(66,3)),-66000);
assert.equal(amount(old,stats(60,0,1)),-60000);
assert.equal(amount(old,stats(60,0,0,1)),-120000);
assert.equal(amount(old,stats(60,0,0,0,1)),-60000,'unrecorded absence uses unexpected-leave rate');
assert.equal(amount({...old,absenceRule:'none'},stats(60,1)),60000);
assert.throws(()=>calculate({...old,rewardRule:''},stats(60,1)),/Chọn/);
assert.throws(()=>calculate({...old,eligible:false},stats(60)),/3 tháng/);
assert.throws(()=>calculate({...old,fixed:false},stats(60)),/cố định/);
assert.throws(()=>calculate({mode:''},stats(60)),/Phân loại/);
const hoursPolicy={...old,attendance:false,hoursBonus:true,hoursCondition:true};
for(const [h,a] of [[49.99,0],[50,50000],[64,64000],[65,130000],[80,160000],[81,243000]]) assert.equal(amount(hoursPolicy,stats(h),8),a);
const meeting={...old,attendance:false,meetingEnabled:true};
for(const [status,h,a] of [['present',0,30000],['present',60,60000],['permitted',1,-30000],['unpermitted',1,-50000],['unpermitted',60,-120000],['none',60,0]]) assert.equal(amount({...meeting,meeting:status},stats(h),9),a);
assert.equal(amount({mode:'new',rate:0},stats(65)),0);
assert.equal(amount({mode:'new',rate:1234},{...stats(0),minutes:125}),2571,'round only final amount');
assert.throws(()=>calculate({mode:'new',rate:-1},stats(60)),/không âm/);
assert.throws(()=>calculate({mode:'new',rate:''},stats(60)),/không âm/);
const rows=calculate({...old,attendance:false,lateEnabled:true,lateRate:2000,focusEnabled:true,focusRate:1000,focusCount:2,enthusiasmEnabled:true,enthusiasmRate:1000,responsibilityEnabled:true,responsibilityRate:-2000,preparationEnabled:true,preparationRate:3000,subject:'Toán',subjectHours:20},stats(60)).rows;
assert.deepEqual(rows.map(r=>[r.id,r.amount]),[[1,-120000],[2,-120000],[3,60000],[4,-120000],[5,60000]]);
assert.throws(()=>calculate({...old,preparationEnabled:true,subject:'Toán',subjectHours:70,preparationRate:1000},stats(60)),/vượt/);
const chips=[{isTeaching:true,paidMinutes:125,text:'(T5p)'},{isReceptionist:true,paidMinutes:600},{isTeaching:true,class:'chip-future',paidMinutes:120},{isCenterOff:true,class:'chip-gray'},{isCancelled:true,class:'chip-gray'},{isAbsence:true,absenceType:'VP'},{isAbsence:true,absenceType:'VDX'},{isAbsence:true,absenceType:'VKP'},{class:'chip-gray'},{sessionData:{role:'office_staff'},paidMinutes:100}];
const chipsBefore=JSON.stringify(chips);
assert.deepEqual(sourceFromChips(chips,c=>c.absenceType||'VKP'),{minutes:125,vp:1,vdx:1,vkp:1,unreported:1,lateMinutes:5});
assert.equal(JSON.stringify(chips),chipsBefore,'read-only policy');
console.log('teacher-attendance-policy: thresholds, minima, exceptions, fractions, role scope and discretionary criteria passed');
