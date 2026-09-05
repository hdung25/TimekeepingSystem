'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/db-service.js'), 'utf8');

async function main() {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/,
        'Integration test must never connect to production');
    const env = await initializeTestEnvironment({
        projectId: 'demo-timekeeping',
        firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') }
    });
    try {
        await env.clearFirestore();
        for (const [suffix, name, roles] of [
            ['huy', 'Quang Huy ', ['teaching_assistant', 'receptionist']],
            ['nhan', 'Nguyễn Phan Thanh Nhàn ', ['teaching_assistant']]
        ]) {
            const userId = `fixture-${suffix}`;
            const uid = `uid-${suffix}`;
            await env.withSecurityRulesDisabled(async c => {
                const db = c.firestore();
                await db.collection('user_roles').doc(uid).set({userId,username:suffix,role:roles[0],roles});
                await db.collection('users').doc(userId).set({id:userId,name,username:suffix,authUid:uid,roles});
                await db.collection('settings').doc('system').set({gpsCS1Lat:10,gpsCS1Lng:106,gpsCS1Radius:200});
            });
            const db = env.authenticatedContext(uid).firestore();
            let fixes = 0;
            const auth = { currentUser: {uid, getIdToken:async()=> 'emulator-only'} };
            const storage = new Map([['currentUserId',userId],['userFullName',name.trim()]]);
            const context = {
                db, firebase: { firestore: firebase.firestore, auth:()=>auth },
                window: {auth,isSecureContext:true,navigator:{}},
                navigator: { geolocation:{getCurrentPosition(ok) {fixes++;ok({coords:{latitude:10,longitude:106,accuracy:10}});}},onLine:true },
                localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
                location:{origin:'http://localhost'},
                console, setTimeout,clearTimeout,Date
            };
            // Evaluate in the SDK's realm: VM-created plain objects otherwise
            // fail the SDK's prototype check before Rules are even exercised.
            const load = new Function(...Object.keys(context), source+'\nreturn {service:DBService,dateKey:getLocalDateKeyFromDate(new Date())};');
            const { service, dateKey } = load(...Object.values(context));
            await service.checkInPersonal(userId, name.trim());
            const ref = db.collection('attendance_logs').doc(`${dateKey}_${userId}`);
            const recorded = (await ref.get()).data();
            assert.equal(recorded.name,name,'write must use canonical profile name, not trimmed display text');
            assert.equal(recorded.sessions.length,1);
            assert.equal(recorded.sessions[0].checkOut,null);
            assert.equal(fixes,1);
            const receipt = await db.collection('attendance_checkin_proofs')
                .doc(`${dateKey}~${userId}~${recorded.sessions[0].id}`).get();
            assert.equal(receipt.exists,true);
            await service.checkOutPersonal(userId);
            assert.equal((await ref.get()).data().sessions[0].status,'closed');
            await service.checkInPersonal(userId,'stale display name');
            assert.equal((await ref.get()).data().sessions.length,2);
            console.log(`PASS real DBService check-in/out/re-entry with trailing-name profile (${suffix})`);
            const scheduleKey = `cs1__${dateKey}`;
            const row = {shiftId:'fixture-shift',start:'18:00',end:'19:30',lop:'Fixture',phong:'P1',registeredTeachers:[]};
            // Schedule read projection is not under test here. The real
            // registration transaction and Security Rules remain unmocked.
            service.getSchedule = async () => ({evening1:[row]});
            assert.equal(await service.registerClass(scheduleKey,'evening1',{index:0},{id:userId,name:name.trim()}),'active');
            row.registeredTeachers = [{id:userId,name:name.trim()}];
            assert.equal(await service.registerClass(scheduleKey,'evening1',{index:0},{id:userId,name:name.trim()}),'cancelled');
            console.log(`PASS real DBService register/cancel with trailing-name profile (${suffix})`);
        }

        await env.withSecurityRulesDisabled(async c => {
            const db = c.firestore();
            await db.collection('user_roles').doc('uid-admin').set({userId:'fixture-admin',role:'admin',roles:['admin']});
            await db.collection('overtime_requests').doc('fixture-ot').set({staffId:'fixture-huy',dateKey:'2026-09-04',sessionId:'legacy',minutes:15,duration:15,status:'approved'});
        });
        const loadOvertime = uid => new Function('window','db','firebase','localStorage',source+'\nreturn DBService;')(
            {},env.authenticatedContext(uid).firestore(),{firestore:firebase.firestore},{getItem:()=> 'Fixture Admin'});
        const admin = loadOvertime('uid-admin');
        await admin.saveAdminOvertimeConfig('fixture-huy','Fixture','2026-09-04','legacy',30);
        let result = await admin.getOvertimeRequestsForStaff('fixture-huy','2026-09');
        assert.equal(result[0].minutes,30);
        await admin.saveAdminOvertimeConfig('fixture-huy','Fixture','2026-09-04','new',20);
        result = await admin.getOvertimeRequestsForStaff('fixture-huy','2026-09');
        assert.equal(result.length,2);
        await assert.rejects(loadOvertime('uid-huy').saveAdminOvertimeConfig('fixture-huy','Fixture','2026-09-04','legacy',99),{code:'permission-denied'});
        await admin.saveAdminOvertimeConfig('fixture-huy','Fixture','2026-09-04','legacy',0);
        result = await admin.getOvertimeRequestsForStaff('fixture-huy','2026-09');
        assert.equal(result.find(r=>r.sessionId==='legacy').status,'rejected');
        assert.equal(result.find(r=>r.sessionId==='legacy').minutes,0);
        console.log('PASS real Admin overtime update/create/revoke; staff cannot self-approve');
    } finally { await env.cleanup(); }
}
main().catch(e=>{ console.error(e);process.exitCode=1; });
