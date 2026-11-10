const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../js/salary-review-policy');
const O = require('../js/salary-review-overview-policy');
const profile = { revision: 3, groups: [{ id:'old', name:'Môn cũ', subjectIds:['old'], currentRate:30000, baselineDate:'2026-06-01', confirmed:true, enabled:true }], personOverrides:{minimumHours:42} };
const inferred = [{id:'math',name:'Toán',evidence:[
    {subjectId:'old',rate:30000},{subjectId:'a',rate:32000},{subjectId:'b',rate:34000},
    {subjectId:'c',rate:null},{subjectId:'d',rate:32000,contradictions:[{rate:35000}]}]}];
const original = JSON.stringify(profile);
const groups = O.buildGroups(profile,inferred,'2026-09-21');
assert.equal(groups.length,3);
assert.deepEqual(groups.slice(1).map(g=>g.currentRate),[32000,34000]);
assert.equal(groups[1].confirmed,false);
// Tiểu Nhi 10/11: E4, E5 raised 50k → 52k keep id "eng:overview:50000"; E2 left at 50k must not reuse it.
{
    const raised = { groups: [{ id:'eng:overview:50000', subjectIds:['e4','e5'], currentRate:52000, baselineDate:'2026-11-01', confirmed:true, nextReviewDate:'2027-04-05' }] };
    const rows = O.buildGroups(raised,[{id:'eng',name:'Anh',evidence:[{subjectId:'e4',rate:52000},{subjectId:'e5',rate:52000},{subjectId:'e2',rate:50000}]}],'2026-11-10');
    assert.deepEqual(rows.map(g=>g.id),['eng:overview:50000','eng:overview:50000:m2']);
    assert.deepEqual(rows[1].subjectIds,['e2']);
    assert.equal(new Set(rows.map(g=>g.id)).size,rows.length);
    const again = O.buildGroups({ groups: [...raised.groups, { ...rows[1], confirmed:true }] },[{id:'eng',name:'Anh',evidence:[{subjectId:'e2',rate:50000},{subjectId:'e9',rate:50000}]}],'2026-11-10');
    assert.deepEqual(again.map(g=>g.id),['eng:overview:50000','eng:overview:50000:m2','eng:overview:50000:m3'],'saved :m2 keeps E2; a new 50k subject gets its own id');
    assert.deepEqual(again[2].subjectIds,['e9']);
}
const edits = Object.fromEntries(groups.map(g=>[g.id,{cycle:3,nextDate:'2026-12-21'}]));
const draft = O.reminderDraft(profile,groups,edits,'2026-09-21',P);
assert.equal(draft.groups[0].baselineDate,'2026-06-01');
assert.equal(draft.groups[1].baselineDate,'2026-09-21');
assert.equal(draft.groups[1].confirmed,true);
assert.equal(draft.personOverrides.minimumHours,42);
assert.equal(JSON.stringify(profile),original);
assert.throws(()=>O.reminderDraft(profile,groups,{...edits,[groups[1].id]:{cycle:3,nextDate:'2026-10-01'}},'2026-09-21',P),/phải từ/);
assert.throws(()=>O.reminderDraft(profile,groups,{old:{cycle:0,nextDate:'2026-12-21'}},'2026-09-21',P),/Chu kỳ/);
const pending = {...groups[0],scheduledChange:{effectiveFrom:'2026-10-01'}};
assert.deepEqual(O.reminderDraft(profile,[pending],edits,'2026-09-21',P).groups[0],pending);
assert.equal(O.attendance({workedShifts:8,vpShifts:1,vdxShifts:0,vkpShifts:1}).percent,80);
assert.equal(O.attendance({workedShifts:8,vpShifts:1}).percent,null);
assert.equal(O.attendance({vpShifts:0}).offHours,null);
assert.equal(O.attendance({vpMinutes:90,vdxMinutes:60,vkpMinutes:120}).absentHours,3);
const preview={targetMonth:'2026-10',changes:[{subjectId:'b',name:'B',beforeRate:20,afterRate:22,beforeSource:'inherited'}],preserved:[{name:'A',rate:30,source:'inherited'}]};
const later={targetMonth:'2026-10',changes:[{subjectId:'b',name:'B',beforeRate:20,afterRate:22,beforeSource:'target'}],preserved:[{name:'A',rate:32,source:'target'}]};
assert.equal(O.samePreview(preview,later,[{changes:[{name:'A',afterRate:32}]}]),true);
assert.equal(O.samePreview(preview,later),false);
assert.equal(O.samePreview(preview,{...later,changes:[{...later.changes[0],beforeRate:99}]},[{changes:[{name:'A',afterRate:32}]}]),false);
const report=fs.readFileSync(path.join(__dirname,'../js/report.js'),'utf8');
const start=report.indexOf('function scheduledAbsenceMinutes('),end=report.indexOf('\n}',start)+2;
const duration=new Function(report.slice(start,end)+';return scheduledAbsenceMinutes;')();
assert.equal(duration({schedData:{start:'08:00',end:'09:30'}}),90);
assert.equal(duration({schedData:{start:'23:00',end:'01:00'}}),120);
assert.equal(duration({paidMinutes:0}),null);
assert.equal(duration({mergedSegments:[{start:'08:00',end:'09:00'},{start:'09:00',end:'10:00'}]}),120);
console.log('salary-review-overview.test.js: mixed rates, reminders, missing evidence, safe sequential previews and absence durations passed');
