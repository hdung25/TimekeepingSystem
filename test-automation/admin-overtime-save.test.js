'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../js/db-service.js'),'utf8');
const normalize=new Function(source.slice(source.indexOf('function _normalizeOvertimeRequest'),source.indexOf('async function _runAttendanceFirestoreOperation'))+'\nreturn _normalizeOvertimeRequest;')();
for(const [duration,minutes] of [[12,undefined],[15,undefined],[7,17],[60,60]]) {
    const old={status:'approved',duration,minutes};
    const copy=JSON.stringify(old);
    const fixed=normalize(old);
    assert.equal(fixed.minutes,duration);
    assert.equal(JSON.stringify(old),copy,'normalization must not mutate persisted/source records');
}
assert.equal(normalize({status:'approved',duration:'00:15',minutes:15}).minutes,15);
assert.equal(normalize({status:'pending',duration:7,minutes:17}).minutes,17);
const documents=new Map([
    ['pending',{staffId:'staff',dateKey:'2026-09-04',sessionId:'legacy',minutes:15,duration:'00:15',status:'pending'}],
    ['other-date',{staffId:'staff',dateKey:'2026-09-03',sessionId:'legacy',minutes:60,duration:'01:00',status:'approved'}]
]);
const snapshot=id=>({id,exists:documents.has(id),data:()=>documents.get(id)});
const reference=id=>({id,get:async()=>snapshot(id),update:async d=>documents.set(id,{...documents.get(id),...d}),set:async d=>documents.set(id,d),delete:async()=>documents.delete(id)});
const query=(filters=[])=>({
    where:(k,op,v)=>query([...filters,[k,v]]),
    get:async()=>{
        const docs=[...documents].filter(([,d])=>filters.every(([k,v])=>d[k]===v)).map(([id])=>snapshot(id));
        return {docs,empty:docs.length===0};
    },
    doc:reference,add:async d=>{documents.set('new',d);return{id:'new'};}
});
const db={collection:()=>query(),runTransaction:async fn=>fn({get:async r=>snapshot(r.id),set:(r,d,o)=>documents.set(r.id,o?.merge?{...documents.get(r.id),...d}:d)})};
const service=new Function('db','window','firebase','localStorage','console',source+'\nreturn DBService;')(
    db,{}, {firestore:{FieldValue:{serverTimestamp:()=> 'server-now'}}},{getItem:()=> 'Admin'},{log(){},warn(){},error(){}});
(async()=>{
    await service.saveAdminOvertimeConfig('staff','Staff','2026-09-04','legacy',30);
    assert.equal(documents.get('pending').minutes,30,'admin edit must update the minutes actually consumed by payroll');
    assert.equal(documents.get('pending').duration,'00:30');
    assert.equal(documents.get('other-date').minutes,60,'same legacy session ID on another date must remain untouched');
    await Promise.all([service.saveAdminOvertimeConfig('staff','Staff','2026-09-05','new-session',20),service.saveAdminOvertimeConfig('staff','Staff','2026-09-05','new-session',20)]);
    assert.equal([...documents.values()].filter(d=>d.dateKey==='2026-09-05').length,1,'repeated saves must address one record');
    await service.saveAdminOvertimeConfig('staff','Staff','2026-09-04','legacy',0);
    assert.equal(documents.get('pending').status,'rejected');
    assert.equal(documents.get('pending').minutes,0);
    await assert.rejects(service.saveAdminOvertimeConfig('staff','Staff','2026-09-04','legacy',Infinity));
    console.log('admin-overtime-save.test.js: all assertions passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
