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
// Calendar helpers: Monday-first grid, tones and flags (late written by the receptionist is labelled).
const grid=policy.monthGrid('2026-10');
assert.equal(grid.length,5);assert.ok(grid.every(w=>w.length===7));
assert.equal(grid[0].findIndex(Boolean),3,'1 Oct 2026 is a Thursday');
assert.equal(grid.flat().filter(Boolean).length,31);assert.equal(grid.at(-1)[6]?.date,undefined,'31 Oct is a Saturday, trailing Sunday is padding');
assert.deepEqual(policy.monthGrid('2026-13'),[]);
assert.equal(policy.formatMinutes(175),'2h 55p');assert.equal(policy.formatMinutes(180),'3h 0p');assert.equal(policy.formatMinutes(-5),'0h 0p');
assert.equal(policy.toneOf({tone:'chip-green',worked:true}),'ok');assert.equal(policy.toneOf({tone:'chip-orange',worked:true}),'warn');
assert.equal(policy.toneOf({tone:'chip-future',worked:false}),'future');assert.equal(policy.toneOf({tone:'chip-gray chip-absence-vp'}),'vp');
assert.equal(policy.toneOf({tone:'chip-red chip-absence-vdx'}),'vdx');assert.equal(policy.toneOf({tone:'chip-gray'}),'off');
const lateRow=policy.rowsForChips([{...base,text:'18:00–21:00 CS1 (T5p) (Toán 5)',class:'chip-orange',manualLateMinutes:5,paidMinutes:175}],{},staff,date,subjects,['a'])[0];
assert.equal(lateRow.manualLateMinutes,5);assert.equal(policy.toneOf(lateRow),'warn');
assert.deepEqual(policy.flagsOf(lateRow).map(f=>f.text),['Trễ 5p · tiếp tân ghi']);
assert.deepEqual(policy.flagsOf({status:'08:00 (T3p) (V10p) ★+10p',manualLateMinutes:0}).map(f=>f.text),['Trễ 3p','Về sớm 10p','Sớm +10p']);
assert.deepEqual(policy.flagsOf({status:'★+10p (hủy)'}),[]);
const needles=new Set(["a",policy.normalize("VẼ VIDA")]);
assert.equal(policy.mentionsAny({"2026-10-01":[{role:"a",checkIn:new Date()}]},needles),true,"admin-added class in the group is evaluated");
assert.equal(policy.mentionsAny({d:[{lopId:"outside+a"}]},needles),true);
assert.equal(policy.mentionsAny({d:[{adminPayrollOverride:{allocations:[{roleName:" vẽ vida "}]}}]},needles),true);
assert.equal(policy.mentionsAny({d:[{role:"outside",note:"vẽ vida lớp khác",id:"abc"}]},needles),false,"free text and other ids do not match");
// Partner-only corrections never touch the payroll snapshot and clear back to it exactly.
const adjRow=policy.rowsForChips([{...base,text:'08:00–09:00 (T5p)',class:'chip-orange',classCompositeKey:'cs1__'+date,classSectionKey:'morning1',classIndex:3,paidMinutes:55}],{},staff,date,subjects,['a'])[0];
assert.equal(adjRow.rowKey,'cs1__2026-09-01|morning1|3|08:00|09:00|a');
assert.match(policy.adjustmentId(adjRow),/^teacher__2026-09-01__cs1__2026-09-01_morning1_3_08_00_09_00_a$/);
assert.equal(policy.adjustmentId({...adjRow,rowKey:'x'.repeat(600)}).length,400);
const payrollSnapshot=JSON.stringify({minutes:adjRow.minutes,status:adjRow.status,worked:adjRow.worked});
policy.applyAdjustment(adjRow,{active:true,status:'vdx',minutes:0,checkIn:'',checkOut:'',note:'Báo nghỉ'});
assert.equal(adjRow.minutes,0);assert.equal(adjRow.worked,false);assert.equal(adjRow.status,'Vắng đột xuất · Báo nghỉ');
assert.equal(policy.toneOf(adjRow),'vdx');assert.deepEqual(policy.flagsOf(adjRow).map(f=>f.text),['Chỉnh riêng liên kết']);
assert.equal(JSON.stringify({minutes:adjRow.base.minutes,status:adjRow.base.status,worked:adjRow.base.worked}),payrollSnapshot,'payroll snapshot kept');
policy.applyAdjustment(adjRow,{active:true,status:'du',minutes:60,checkIn:'07:55',checkOut:'09:00',note:''});
assert.equal(adjRow.minutes,60);assert.equal(policy.toneOf(adjRow),'ok');
policy.applyAdjustment(adjRow,{active:false,status:'du',minutes:60});
assert.equal(JSON.stringify({minutes:adjRow.minutes,status:adjRow.status,worked:adjRow.worked}),payrollSnapshot,'inactive correction restores payroll values');
assert.equal(adjRow.adjustment,null);
policy.applyAdjustment(adjRow,{active:true,status:'unknown',minutes:999});
assert.equal(adjRow.minutes,55,'unknown status is ignored');
const ambiguousRow={...adjRow,base:undefined,adjustment:undefined,ambiguous:true,minutes:0};
policy.applyAdjustment(ambiguousRow,{active:true,status:'du',minutes:2000});
assert.equal(ambiguousRow.minutes,1440);assert.equal(ambiguousRow.ambiguous,false,'an explicit correction resolves a mixed class for export');
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
    // v262: per-school totals
    const schools = policy.bySubject([
        {subjectName:'VẼ VIDA',staffName:'A',minutes:60,dates:['2026-10-01','2026-10-02']},
        {subjectName:'VẼ VIDA',staffName:'B',minutes:30,dates:['2026-10-02']},
        {subjectName:'TTD VIDA',staffName:'A',minutes:45,dates:['2026-10-03']}]);
    assert.deepEqual(schools.map(s=>[s.subjectName,s.minutes,s.days,s.staff.length]),[['VẼ VIDA',90,2,2],['TTD VIDA',45,1,1]]);
    console.log('partner attendance policy, evaluator integration and workbook tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

// v263: owner's paper form — one "BẢNG CHẤM CÔNG THÁNG" calendar per school (samples from 09/2026).
{
    assert.deepEqual(policy.splitSchoolName('VẼ TUỔI TIÊN'), {unit: 'TUỔI TIÊN', subject: 'VẼ'});
    assert.deepEqual(policy.splitSchoolName('VẼ Hoa nắng'), {unit: 'HOA NẮNG', subject: 'VẼ'});
    assert.deepEqual(policy.splitSchoolName('TTD VIDA'), {unit: 'VIDA', subject: 'TTD'});
    assert.deepEqual(policy.splitSchoolName('LK HOA TRẠNG NGUYÊN'), {unit: 'HOA TRẠNG NGUYÊN', subject: ''});
    assert.deepEqual(policy.splitSchoolName('Ánh Cầu Vồng'), {unit: 'ÁNH CẦU VỒNG', subject: ''});
    assert.equal(policy.formatDuration(30), '30 phút');
    assert.equal(policy.formatDuration(120), '2 giờ');
    assert.equal(policy.formatDuration(80), '1 giờ 20 phút');
    const closures = {'2026-09-01': ['all'], '2026-09-02': ['all']};
    const row = (date, minutes, start = '08:00', end = '09:00', staffId = 't1') => ({date, minutes, start, end, staffId, subjectName: 'X'});
    const cellOf = (cal, day) => cal.weeks.flat().find(c => c && c.day === day);
    // Tuổi Tiên: Wednesdays 30 phút; 02/09 (Wed) is the holiday, 01/09 (Tue, no class that weekday) stays blank.
    const tt = policy.schoolCalendar(['09', '16', '23', '30'].map(d => row('2026-09-' + d, 30)), '2026-09', closures);
    assert.equal(cellOf(tt, 2).holiday, true); assert.equal(cellOf(tt, 1).holiday, false);
    assert.equal(cellOf(tt, 9).minutes, 30); assert.equal(tt.totalMinutes, 120); assert.equal(tt.sessions, 4);
    assert.equal(tt.weeks.length, 5); assert.equal(tt.weeks[0][0], null, '01/09/2026 is a Tuesday');
    // Hoa Nắng: Tue + Fri 1 giờ; 01/09 holiday, 02/09 (Wed) blank.
    const hn = policy.schoolCalendar(['04', '08', '11', '15', '18', '22', '25', '29'].map(d => row('2026-09-' + d, 60)), '2026-09', closures);
    assert.equal(cellOf(hn, 1).holiday, true); assert.equal(cellOf(hn, 2).holiday, false); assert.equal(hn.sessions, 8);
    // Substitute + original on the same class slot count once; a second slot that day adds up.
    const sub = policy.schoolCalendar([row('2026-10-26', 60, '08:00', '09:00', 'a'), row('2026-10-26', 60, '08:00', '09:00', 'b'), row('2026-10-26', 0, '08:00', '09:00', 'c'),
        row('2026-10-26', 30, '10:00', '10:30')], '2026-10', {});
    assert.equal(cellOf(sub, 26).minutes, 90); assert.equal(sub.sessions, 2);
    // An absent teacher on a non-holiday day is blank, not "nghỉ lễ".
    const absent = policy.schoolCalendar([row('2026-10-05', 0)], '2026-10', {});
    assert.equal(cellOf(absent, 5).holiday, false); assert.equal(cellOf(absent, 5).minutes, 0);
    const sheet = policy.schoolSheet('VẼ TUỔI TIÊN', ['09', '16', '23', '30'].map(d => row('2026-09-' + d, 30)), '2026-09', closures, 'TUỔI TIÊN');
    const text = JSON.stringify(sheet.rows);
    assert.ok(text.includes('BẢNG CHẤM CÔNG THÁNG 09/2026') && text.includes('TUỔI TIÊN') && text.includes('"VẼ"'));
    assert.ok(text.includes('30 phút') && text.includes('nghỉ lễ') && text.includes('Tổng: 2 giờ (4 buổi)'));
    assert.ok(text.includes('NGƯỜI LẬP BIỂU') && text.includes('Nguyễn Thị Diễm Nguyệt') && text.includes('Trương Thị Thủy Tiên'));
    assert.ok(sheet.merges.includes('A4:A8') && sheet.merges.includes('B4:B8'), 'STT/Đơn vị/Môn span the 5 week rows');
    assert.ok(sheet.rows.every(r => r.cells.length === 10), 'every row fills A–J so merged borders print');
    assert.deepEqual(policy.sheetNames(['VIDA', 'VIDA', 'A/B', 'x'.repeat(40)]), ['VIDA', 'VIDA 2', 'A B', 'x'.repeat(28)]);
    // Workbook opens as a valid zip with the rich red notes.
    const xlsx = require('../js/partner-attendance-xlsx.js');
    const blob = xlsx.build([sheet]);
    blob.arrayBuffer().then(buf => {
        const bytes = Buffer.from(buf);
        assert.equal(bytes.readUInt32LE(0), 0x04034b50);
        const s = bytes.toString('utf8');
        assert.ok(s.includes('<color rgb="FFFF0000"/><rFont val="Times New Roman"/>') && s.includes('nghỉ lễ'));
        fs.mkdirSync(path.join(__dirname, 'artifacts'), {recursive: true});
        fs.writeFileSync(path.join(__dirname, 'artifacts/partner-school-form.xlsx'), bytes);
        console.log('partner school form: calendar, holiday, dedupe, workbook passed');
    }).catch(error => { console.error(error); process.exitCode = 1; });
}
