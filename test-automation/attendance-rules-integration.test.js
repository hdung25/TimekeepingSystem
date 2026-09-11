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
            const mismatchedStaffId = suffix === 'huy' ? 'fixture-nhan' : 'fixture-huy';
            const fixesBeforeMismatch = fixes;
            await assert.rejects(
                service.checkInPersonal(mismatchedStaffId, 'stale local identity'),
                { code: 'auth/session-changed' }
            );
            assert.equal(fixes, fixesBeforeMismatch,
                'mismatched local staff identity must be rejected before the location gate or an attendance write');
            await service.checkOutPersonal(userId);
            assert.equal((await ref.get()).data().sessions[0].status,'closed');
            await service.checkInPersonal(userId,'stale display name');
            assert.equal((await ref.get()).data().sessions.length,2);
            const studentCountSessionId = String((await ref.get()).data().sessions[0].id);
            await service.updateSessionStudentCount(
                userId, dateKey, studentCountSessionId, 12, 'approved', uid, 'staff'
            );
            const savedStudentCount = (await ref.get()).data().sessions[0];
            assert.equal(savedStudentCount.studentCount, 12);
            assert.equal(savedStudentCount.studentCountStatus, 'approved',
                'staff student-count reports are accepted immediately');
            assert.equal(savedStudentCount.studentCountUpdatedBy, userId,
                'student-count audit must use the mapped staff ID, not the Auth UID');
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
            await env.withSecurityRulesDisabled(c => c.firestore().collection('schedules').doc(scheduleKey)
                .set({ evening1: [{ ...row, isClosed: true }] }));
            row.registeredTeachers = [];
            await assert.rejects(service.registerClass(scheduleKey,'evening1',{index:0},{id:userId,name}),
                { code: 'schedule/registration-closed' });
            // The next staff fixture shares the day; leave it open for its
            // independent registration test, without changing any real data.
            await env.withSecurityRulesDisabled(c => c.firestore().collection('schedules').doc(scheduleKey)
                .set({ evening1: [{ ...row, isClosed: false }] }));
            // Reproduce the historical +10 missing-proof path with the actual
            // service and Rules, then verify an eligible receipt succeeds.
            const earlyDay = '2026-08-31';
            const earlySession = 'session-early-fixture';
            const earlyIn = `${earlyDay}T10:49:00.000Z`;
            await env.withSecurityRulesDisabled(async c => {
                const adminDb = c.firestore();
                await adminDb.collection('subjects').doc('fixture-english').set({ name: 'E5', allowEarly10: true });
                await adminDb.collection('schedules').doc(`cs1__${earlyDay}`).set({ evening1: [{
                    shiftId: 'shift-early-fixture', start: '18:00', end: '19:30', lop: 'E5', lopId: 'fixture-english', gvId: userId
                }] });
                await adminDb.collection('attendance_logs').doc(`${earlyDay}_${userId}`).set({
                    userId, name, date: earlyDay, sessions: [{ id: earlySession, checkIn: earlyIn,
                        start: earlyIn, checkOut: `${earlyDay}T12:30:00.000Z` }]
                });
            });
            const meta = { scheduleDocId: `cs1__${earlyDay}`, scheduleSection: 'evening1', scheduleIndex: 0,
                scheduleShiftId: 'shift-early-fixture', targetShiftKey: `teaching__${earlyDay}__shift__shift-early-fixture`,
                subjectId: 'fixture-english', classStart: '18:00', classEnd: '19:30', checkInAt: earlyIn, earlyMinutes: 11 };
            context.window.Early10 = require('../js/early10.js');
            await assert.rejects(service.createBonus10Request(userId, name, earlyDay, earlySession, meta), { code: 'bonus10/proof-missing' });
            await env.withSecurityRulesDisabled(c => c.firestore().collection('attendance_checkin_proofs')
                .doc(`${earlyDay}~${userId}~${earlySession}`).set({ staffId: userId, dateKey: earlyDay,
                    sessionId: earlySession, authUid: uid, recordedAt: firebase.firestore.Timestamp.fromDate(new Date(earlyIn)), schemaVersion: 1 }));
            await service.createBonus10Request(userId, name, earlyDay, earlySession, meta);
            await service.createBonus10Request(userId, name, earlyDay, earlySession, meta);
            const earlyRequests = await service.getBonus10RequestsForStaff(userId, '2026-08');
            assert.equal(earlyRequests.length, 1);
            assert.equal(earlyRequests[0].status, 'approved');
            console.log(`PASS missing proof gives a precise error; eligible +10 creates one award (${suffix})`);
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

        // Check-ins before the receipt rollout (2026-09-02) have no server proof.
        // The employee still cannot self-award; an Admin may verify the log time.
        const legacyDay = '2026-08-22';
        const legacySession = '1787381379255';
        const legacyIn = `${legacyDay}T06:49:39.193Z`;
        await env.withSecurityRulesDisabled(async c => {
            const adminDb = c.firestore();
            await adminDb.collection('schedules').doc(`cs1__${legacyDay}`).set({ afternoon1: [{
                start: '14:00', end: '15:30', lop: 'E5', lopId: 'fixture-english', gvId: 'fixture-huy',
                gvList: [{ id: 'fixture-huy', name: 'Quang Huy' }]
            }] });
            await adminDb.collection('attendance_logs').doc(`${legacyDay}_fixture-huy`).set({
                userId: 'fixture-huy', name: 'Quang Huy ', date: legacyDay, sessions: [{ id: Number(legacySession),
                    checkIn: legacyIn, start: legacyIn, checkOut: `${legacyDay}T10:00:00.000Z` }]
            });
        });
        const loadBonusService = uid => new Function('window','db','firebase','localStorage',source+'\nreturn DBService;')(
            { auth: { currentUser: { uid } }, Early10: require('../js/early10.js') },
            env.authenticatedContext(uid).firestore(), { firestore: firebase.firestore }, { getItem: () => null });
        const legacyMeta = { scheduleDocId: `cs1__${legacyDay}`, scheduleSection: 'afternoon1', scheduleIndex: 0,
            targetShiftKey: `teaching__${legacyDay}__cs1__${legacyDay}__afternoon1__14:00-15:30`,
            subjectId: 'fixture-english', classStart: '14:00', classEnd: '15:30', checkInAt: legacyIn, earlyMinutes: 10,
            scheduleAssignmentList: 'gvList', scheduleAssignmentEntry: { id: 'fixture-huy', name: 'Quang Huy' } };
        await assert.rejects(loadBonusService('uid-huy').createBonus10Request(
            'fixture-huy', 'Quang Huy', legacyDay, legacySession, legacyMeta), { code: 'bonus10/proof-missing' });
        await loadBonusService('uid-admin').createBonus10Request(
            'fixture-huy', 'Quang Huy', legacyDay, legacySession, legacyMeta);
        const legacyAwards = (await loadBonusService('uid-admin').getBonus10RequestsForStaff('fixture-huy', '2026-08'))
            .filter(request => request.dateKey === legacyDay);
        assert.equal(legacyAwards.length, 1);
        assert.equal(legacyAwards[0].status, 'approved');
        assert.equal(legacyAwards[0].requestSource, 'manager_verified_legacy_checkin');
        assert.equal(legacyAwards[0].approvedBy, 'fixture-admin');
        console.log('PASS Admin verifies +10 on a pre-receipt legacy check-in; staff self-claim still needs proof');

        const adminAuth = { currentUser: { uid: 'uid-admin' } };
        const studentCountAdmin = new Function('window','db','firebase','localStorage',source+'\nreturn DBService;')(
            { auth: adminAuth }, env.authenticatedContext('uid-admin').firestore(),
            { firestore: firebase.firestore }, { getItem: () => 'Fixture Admin' });
        await studentCountAdmin.updateSessionStudentCount(
            'fixture-huy', '2026-08-31', 'session-early-fixture', 12, 'rejected', 'uid-admin', 'admin'
        );
        const penalty = await env.authenticatedContext('uid-admin').firestore()
            .collection('salary_settings_monthly').doc('2026-08_fixture-huy').get();
        assert.equal(penalty.data().studentCountBonusPenalty, true,
            'primary Admin rejection must atomically apply the month-wide penalty marker');
        assert.equal(penalty.data().studentCountBonusPenaltyBy, 'fixture-admin');
        console.log('PASS Admin student-count rejection atomically applies the employee month penalty');
    } finally { await env.cleanup(); }
}
main().catch(e=>{ console.error(e);process.exitCode=1; });
