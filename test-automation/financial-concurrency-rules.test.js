'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {initializeTestEnvironment} = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
const source = fs.readFileSync(path.join(__dirname,'../js/db-service.js'),'utf8');
const rules = fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');

(async () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
    const env = await initializeTestEnvironment({projectId:'demo-timekeeping',firestore:{rules}});
    try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
            for (const [uid, userId, role] of [['clock-user','clock-staff','staff'],['clock-admin','admin','admin']]) {
                await context.firestore().collection('user_roles').doc(uid).set({userId,role,roles:[role]});
                await context.firestore().collection('users').doc(userId).set({id:userId,name:userId,role});
            }
        });
        const staffDb = env.authenticatedContext('clock-user').firestore();
        const adminDb = env.authenticatedContext('clock-admin').firestore();
        const service = db => new Function('db','window','firebase','localStorage','console',source+'\nreturn DBService;')(
            db,{}, {firestore:firebase.firestore},{getItem:()=> 'Admin'},{log(){},error(){},warn(){}});
        const staff = service(staffDb), otherTab = service(staffDb), admin = service(adminDb);
        const args = ['clock-staff','clock-staff','2026-09-05','concurrent-session','00:15'];
        const outcome = await Promise.allSettled([staff.createOvertimeRequest(...args),otherTab.createOvertimeRequest(...args)]);
        assert.equal(outcome.filter(item=>item.status==='fulfilled').length,1);
        assert.equal((await adminDb.collection('overtime_requests').get()).size,1);
        await admin.saveAdminOvertimeConfig('clock-staff','clock-staff','2026-09-05','concurrent-session',25);
        await assert.rejects(staff.createOvertimeRequest(...args));
        assert.equal((await admin.getOvertimeRequestsForStaff('clock-staff','2026-09'))[0].minutes,25);
        await admin.saveAdminOvertimeConfig('clock-staff','clock-staff','2026-09-05','concurrent-session',0);
        await staff.createOvertimeRequest(...args); // Rejected requests retain an auditable prior decision.
        const pending = (await adminDb.collection('overtime_requests').get()).docs[0].data();
        assert.equal(pending.status,'pending'); assert.equal(pending.previousDecision.status,'rejected');
        await assert.rejects(staffDb.collection('overtime_requests').doc('random-sibling').set(pending), {code:'permission-denied'});
        const race = await Promise.allSettled([
            staff.createOvertimeRequest('clock-staff','clock-staff','2026-09-05','admin-race','00:15'),
            admin.saveAdminOvertimeConfig('clock-staff','clock-staff','2026-09-05','admin-race',30)
        ]);
        assert.equal(race[1].status,'fulfilled');
        const final = (await adminDb.collection('overtime_requests').doc('ot_2026-09-05~clock-staff~admin-race').get()).data();
        assert.equal(final.status,'approved'); assert.equal(final.minutes,30);
        await adminDb.collection('overtime_requests').doc('legacy-admin-race').set({...final});
        await admin.rejectOvertimeRequest('legacy-admin-race','Admin');
        const rejected = (await adminDb.collection('overtime_requests').doc('ot_2026-09-05~clock-staff~admin-race').get()).data();
        assert.equal(rejected.status,'rejected','a stale legacy button must still update the canonical decision');
        assert.equal(rejected.minutes,30,'reject preserves the request amount for audit');
        await admin.approveOvertimeRequest('legacy-admin-race','Admin');
        assert.equal((await adminDb.collection('overtime_requests').doc('ot_2026-09-05~clock-staff~admin-race').get()).data().status,'approved');
        console.log('PASS real concurrent staff requests, Admin race, re-request audit, canonical-ID Rules');

        const now = new Date(), day = new Date(now.getTime()+7*3600000).toISOString().slice(0,10);
        const open = {id:'clock-session',anchorDateKey:day,status:'open',source:'self',start:now.toISOString(),checkIn:now.toISOString(),checkOut:null};
        const payload = {userId:'clock-staff',name:'clock-staff',date:day,sessions:[open],checkIn:open.checkIn,checkOut:null,lastUpdated:firebase.firestore.FieldValue.serverTimestamp()};
        const ref = staffDb.collection('attendance_logs').doc(`${day}_clock-staff`);
        for (const date of ['2020-01-01','2030-01-01']) {
            const bad = {...open,anchorDateKey:date,start:date+'T01:00:00.000Z',checkIn:date+'T01:00:00.000Z'};
            await assert.rejects(staffDb.collection('attendance_logs').doc(`${date}_clock-staff`).set({...payload,date,sessions:[bad],checkIn:bad.start}),{code:'permission-denied'});
        }
        await ref.set(payload); // Cached v2 compatibility, no new browser prompt.
        for (const end of ['2030-01-01T01:00:00.000Z','2020-01-01T01:00:00.000Z']) {
            await assert.rejects(ref.update({sessions:[{...open,status:'closed',checkOut:end}],checkOut:end,lastUpdated:firebase.firestore.FieldValue.serverTimestamp()}),{code:'permission-denied'});
        }
        await assert.rejects(ref.update({checkOut:'2030-01-01T01:00:00.000Z',lastUpdated:firebase.firestore.FieldValue.serverTimestamp()}),{code:'permission-denied'});
        const end = new Date().toISOString();
        await ref.update({sessions:[{...open,status:'closed',checkOut:end}],checkOut:end,lastUpdated:firebase.firestore.FieldValue.serverTimestamp()});
        await assert.rejects(ref.update({sessions:[{...open,status:'closed',checkOut:new Date().toISOString()}],lastUpdated:firebase.firestore.FieldValue.serverTimestamp()}),{code:'permission-denied'});
        // Exercise the largest supported day so expression limits cannot hide
        // behind the easy one-session fixture. Seed only the emulator as Admin.
        const previousSessions = Array.from({length:23}, (_, index) => ({
            ...open, id:`previous-${index}`, status:'closed',
            start:new Date(now.getTime()-60000*(25-index)).toISOString(),
            checkIn:new Date(now.getTime()-60000*(25-index)).toISOString(),
            checkOut:new Date(now.getTime()-60000*(24-index)).toISOString()
        }));
        const adminRef = adminDb.collection('attendance_logs').doc(`${day}_clock-staff`);
        await adminRef.set({...payload,sessions:previousSessions,checkIn:previousSessions[22].checkIn,checkOut:previousSessions[22].checkOut});
        const sessions24 = [...previousSessions,open];
        await ref.update({sessions:sessions24,checkIn:open.checkIn,checkOut:null,lastUpdated:firebase.firestore.FieldValue.serverTimestamp()});
        const close24 = new Date().toISOString();
        sessions24[23] = {...open,status:'closed',checkOut:close24};
        await ref.update({sessions:sessions24,checkOut:close24,lastUpdated:firebase.firestore.FieldValue.serverTimestamp()});
        sessions24[23] = {...sessions24[23],studentCount:10,studentCountStatus:'pending',studentCountUpdatedBy:'clock-staff',studentCountUpdatedAt:new Date().toISOString()};
        await ref.update({sessions:sessions24,lastUpdated:firebase.firestore.FieldValue.serverTimestamp()});
        const stale = {...open,status:'closed',checkOut:end,autoClosedReason:'stale_session'};
        await adminRef.set({...payload,sessions:[stale],checkOut:end});
        const later = new Date().toISOString();
        await ref.update({sessions:[{...stale,checkOut:later}],checkOut:later,lastUpdated:firebase.firestore.FieldValue.serverTimestamp()});
        console.log('PASS 24-session append/checkout/student-count and automatic stale-session extension');
        // Admin authority is evaluated before employee constraints, even for own records.
        await adminDb.collection('attendance_logs').doc('2020-01-01_admin').set({userId:'admin',name:'admin',date:'2020-01-01',sessions:[{checkIn:'2020-01-01T01:00:00.000Z',checkOut:'2020-01-01T03:00:00.000Z',bonus10:true,roleRate:100000}]});
        console.log('PASS forged past/future/checkOut/header-only writes denied; normal clocks and Admin historical corrections allowed');
    } finally { await env.cleanup(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
