'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const policy=require('../js/partner-attendance-policy');
const subjects=[{id:'linked',name:'LIÊN KẾT',isGroup:true},{id:'nested',parentId:'linked',isGroup:true},
    {id:'a',name:'VẼ VIDA',parentId:'linked'},{id:'b',name:'TTD VIDA',parentId:'nested'},
    {id:'outside',name:'Tiếng Anh',parentId:'other'}];
assert.deepEqual(policy.leaves(subjects,'linked').map(s=>s.id).sort(),['a','b']);
assert.deepEqual(policy.leaves(subjects,'missing'),[]);
assert.equal(policy.leaves([{id:'linked',isGroup:true,parentId:'nested'},{id:'nested',isGroup:true,parentId:'linked'},...subjects.slice(2)],'linked').length,2);
const staff={id:'teacher',fullName:'Cô Ánh'},date='2026-09-01';
const base={subjectIds:['a'],classStart:'08:00',classEnd:'09:00',paidMinutes:60,text:'Đi đủ'};
const rows=policy.rowsForChips([base,{...base,subjectIds:['outside'],paidMinutes:999},
    {...base,isReceptionist:true},{...base,paidMinutes:0,text:'VP'},
    {...base,subjectIds:['a','b'],paidMinutes:90},
    {...base,subjectIds:['a','outside'],paidMinutes:90}],{},staff,date,subjects,['a','b']);
assert.equal(rows.length,4);
assert.equal(rows.reduce((sum,r)=>sum+r.minutes,0),150,'combined subjects count once and outside subjects never contribute');
assert.equal(rows.at(-1).ambiguous,true);
assert.equal(policy.summarize(rows)[0].days,1,'multiple classes on one date count as one working day');
assert.equal(policy.rowsForChips([{...base,isAdminEdited:true,sessionData:{subjectId:'outside'}}],{},staff,date,subjects,['a','b']).length,0);
assert.equal(policy.rowsForChips([{...base,subjectIds:undefined,chipFilterName:'vẽ vida'}],{},staff,date,subjects,['a'])[0].minutes,60);
assert.equal(policy.rowsForChips([{...base,subjectIds:undefined,lopId:'outside',chipFilterName:'VẼ VIDA'}],{},staff,date,subjects,['a']).length,0,'concrete IDs win over labels');
assert.equal(policy.rowsForChips([{...base,text:'08:00–10:00 VẼ VIDA',mergedSegments:[{branch:'cs1'},{branch:'cs2'}]}],{},staff,date,subjects,['a'])[0].end,'10:00','merged same-subject classes show the full evaluated time range');
const absentSource={morning1:[{lopId:'b',start:'09:00',end:'10:00',_compositeKey:'cs1__'+date,_originalIndex:2}]};
assert.equal(policy.rowsForChips([{paidMinutes:0,text:'VĐX',classSectionKey:'morning1',classCompositeKey:'cs1__'+date,classIndex:2}],absentSource,staff,date,subjects,['a','b'])[0].subjectKey,'b');
assert.throws(()=>policy.rowsForChips([{...base,paidMinutes:-1}],{},staff,date,subjects,['a']));
// Reuse the evaluator's established helper harness, with the real evaluator source.
const harness=fs.readFileSync(path.join(__dirname,'evaluation-service.test.js'),'utf8').split("const staffId = 'teacher-hang';")[0];
const testContext={require,__dirname,console};vm.createContext(testContext);
vm.runInContext(harness+'\nglobalThis.testEvaluate=context.window.calculateDailyChips;',testContext);
const evaluate=testContext.testEvaluate;
const schedule={morning1:[{start:'08:00',end:'09:00',lop:'VẼ VIDA',lopId:'a',gvId:'teacher',_branch:'cs1',_compositeKey:'cs1__'+date,_originalIndex:0},
    {start:'09:00',end:'10:00',lop:'Tiếng Anh',lopId:'outside',gvId:'teacher',_branch:'cs1',_compositeKey:'cs1__'+date,_originalIndex:1}]};
const sessions=[{id:'physical',start:new Date(date+'T08:00:00'),checkIn:new Date(date+'T08:00:00'),checkOut:new Date(date+'T10:00:00')}];
const user={id:'teacher',roles:['teaching_assistant'],salary_config:{roles:[{id:'a',name:'VẼ VIDA',rate:100000},{id:'outside',name:'Tiếng Anh',rate:100000}]}};
const normal=evaluate(schedule,sessions,'teacher',date,user);
const separated=evaluate(schedule,sessions,'teacher',date,user,[],{},[],{},[],{separateSubjectChips:true});
const linkedRows=policy.rowsForChips(separated,schedule,staff,date,subjects,['a','b']);
assert.equal(linkedRows.reduce((s,r)=>s+r.minutes,0),60,'one continuous check-in across different subjects exports only linked time');
assert.equal(separated.reduce((s,c)=>s+c.paidMinutes,0),normal.reduce((s,c)=>s+c.paidMinutes,0),'separating subjects does not increase total work');
assert.equal(evaluate(schedule,sessions,'teacher',date,user).length,normal.length,'default payroll merge is unchanged');
const writerContext={window:{},Blob,TextEncoder,Uint32Array,Uint8Array,DataView,ArrayBuffer,Date};
vm.createContext(writerContext);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/partner-attendance-xlsx.js'),'utf8'),writerContext);
(async()=>{
    const blob=writerContext.window.PartnerAttendanceXlsx.build([{name:'Công LIÊN KẾT',widths:[30,18],headerRow:1,rows:[{cells:[{v:'Giáo viên',s:3},{v:'Giờ công',s:3}]},{cells:[{v:'=DANGEROUS() & Cô Ánh',s:4},{v:1.5,s:6}]}]}]);
    const bytes=Buffer.from(await blob.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0),0x04034b50);
    const xml=bytes.toString('utf8');
    assert.ok(xml.includes('inlineStr') && xml.includes('=DANGEROUS() &amp; Cô Ánh'));
    assert.ok(!xml.includes('<f>'),'text cannot become spreadsheet formulas');
    assert.ok(xml.includes('<v>1.5</v>'));
    fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'artifacts/partner-attendance-sample.xlsx'),bytes);
    console.log('partner attendance policy, evaluator integration and workbook tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
