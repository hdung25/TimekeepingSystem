'use strict';

const fs = require('fs');
const path = require('path');
const {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds
} = require('@firebase/rules-unit-testing');
const {
    collection,
    deleteDoc,
    deleteField,
    doc,
    getDoc,
    getDocs,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    Timestamp,
    updateDoc,
    where
} = require('firebase/firestore');

const PROJECT_ID = 'demo-timekeeping';
const RULES_PATH = path.resolve(__dirname, '..', 'firestore.rules');
const tests = [];

function test(name, fn) {
    tests.push({ name, fn });
}

async function seed(testEnv) {
    await testEnv.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        const roles = {
            'uid-admin': { userId: 'staff-admin', username: 'admin', role: 'admin', roles: ['admin'] },
            'uid-senior': { userId: 'staff-senior', username: 'senior', role: 'senior_assistant', roles: ['senior_assistant'] },
            'uid-assistant': { userId: 'staff-assistant', username: 'assistant', role: 'assistant', roles: ['assistant'] },
            'uid-reception': { userId: 'staff-reception', username: 'reception', role: 'receptionist_assistant', roles: ['receptionist_assistant'] },
            'uid-staff': { userId: 'staff-1', username: 'staff1', role: 'staff', roles: ['staff'] },
            'uid-other': { userId: 'staff-2', username: 'staff2', role: 'staff', roles: ['staff'] }
        };
        for (const [uid, data] of Object.entries(roles)) {
            await setDoc(doc(db, 'user_roles', uid), data);
        }
        await setDoc(doc(db, 'users', 'staff-1'), {
            id: 'staff-1', name: 'Staff One', username: 'staff1', role: 'staff',
            salary_config: { attendance_rate: 500000 }
        });
        await setDoc(doc(db, 'users', 'staff-2'), {
            id: 'staff-2', name: 'Staff Two', username: 'staff2', role: 'staff', roles: ['staff'],
            authUid: 'uid-other',
            salary_config: { attendance_rate: 900000 }
        });
        await setDoc(doc(db, 'staff_directory', 'staff-1'), {
            id: 'staff-1', name: 'Staff One', username: 'staff1', role: 'staff'
        });
        await setDoc(doc(db, 'staff_directory', 'staff-2'), {
            id: 'staff-2', name: 'Staff Two', username: 'staff2', role: 'staff', roles: ['staff']
        });
        await setDoc(doc(db, 'attendance_logs', '2026-08-31_staff-2'), {
            userId: 'staff-2', name: 'Staff Two', date: '2026-08-31', sessions: []
        });
        await setDoc(doc(db, 'attendance_logs', '2026-08-29_staff-1'), {
            userId: 'staff-1', name: 'Staff One', date: '2026-08-29',
            checkIn: '2026-08-29T01:00:00.000Z', checkOut: null
        });
        await setDoc(doc(db, 'attendance_logs', '2026-08-26_staff-1'), {
            userId: 'staff-2', name: 'Staff Two', date: '2026-08-26', sessions: []
        });
        const busyDaySessions = Array.from({ length: 6 }, (_, index) => ({
            id: `busy-${index + 1}`, anchorDateKey: '2026-08-28',
            status: index === 5 ? 'open' : 'closed', source: 'self',
            start: `2026-08-28T${String(index * 2).padStart(2, '0')}:00:00.000Z`,
            checkIn: `2026-08-28T${String(index * 2).padStart(2, '0')}:00:00.000Z`,
            checkOut: index === 5 ? null : `2026-08-28T${String(index * 2 + 1).padStart(2, '0')}:00:00.000Z`
        }));
        await setDoc(doc(db, 'attendance_logs', '2026-08-28_staff-1'), {
            userId: 'staff-1', name: 'Staff One', date: '2026-08-28',
            sessions: busyDaySessions, checkIn: busyDaySessions[5].checkIn, checkOut: null
        });
        await setDoc(doc(db, 'schedules', 'cs1__2026-08-31'), { morning1: [{ lop: 'A1' }] });
        await setDoc(doc(db, 'schedule_registrations', 'registration-staff-2'), {
            userId: 'staff-2', userName: 'Staff Two', scheduleKey: 'cs1__2026-08-31',
            section: 'morning1', shiftId: 'shift-existing', status: 'active'
        });
        await setDoc(doc(db, 'receptionist_schedules', 'cs1__2026-08-31'), { morning: {} });
        await setDoc(doc(db, 'office_schedules', 'cs1__2026-08-31'), { morning: {} });
        await setDoc(doc(db, 'shift_observations', 'observation-staff-1'), {
            dateKey: '2026-08-31', teacherId: 'staff-1', status: 'active'
        });
        await setDoc(doc(db, 'shift_observations', 'observation-staff-2'), {
            dateKey: '2026-08-31', teacherId: 'staff-2', status: 'active'
        });
        await setDoc(doc(db, 'settings', 'system'), {
            gpsCS1Radius: 150,
            receptionistShifts_cs1: { morning: { start: '07:00', end: '11:30' } },
            officeShifts_cs1: { morning: { start: '08:00', end: '12:00' } }
        });
        await setDoc(doc(db, 'salary_settings', 'staff-1'), { baseRate: 100000 });
        await setDoc(doc(db, 'salary_settings', 'staff-2'), { baseRate: 200000 });
        await setDoc(doc(db, 'salary_settings_monthly', '2026-08_staff-1'), {
            gv: { advance: 0 },
            published: {
                status: 'published', status_gv: 'published', role: 'giao-vien',
                netPay: 3500000, details_gv: { netPay: 3500000 }, publishedAt: '2026-08-31T08:00:00.000Z'
            }
        });
        await setDoc(doc(db, 'salary_settings_monthly', '2026-07_staff-1'), {
            published: {
                status: 'published', role: 'giao-vien', netPay: 3200000,
                details: { netPay: 3200000 }, publishedAt: '2026-07-31T08:00:00.000Z'
            }
        });
        await setDoc(doc(db, 'admin_notifications', 'notification-staff-1'), {
            staffId: 'staff-1', details: 'Original', read: false
        });
        await setDoc(doc(db, 'admin_notifications', 'notification-staff-2'), {
            staffId: 'staff-2', details: 'Other', read: false
        });
        await setDoc(doc(db, 'daily_notes', 'staff-2'), { '2026-08-31': 'Private note' });
    });
}

let env;
let adminDb;
let seniorDb;
let assistantDb;
let receptionDb;
let staffDb;
let otherDb;
let guestDb;

test('first registration reads only canonical missing own IDs; existing ownership and list isolation remain enforced', async () => {
    await assertSucceeds(getDoc(doc(staffDb,'schedule_registrations','reg_abc_123_staff-1')));
    await assertFails(getDoc(doc(guestDb,'schedule_registrations','reg_abc_123_staff-1')));
    await assertFails(getDoc(doc(staffDb,'schedule_registrations','reg_abc_123_staff-2')));
    await assertFails(getDoc(doc(staffDb,'schedule_registrations','anything_staff-1')));
    await assertFails(getDoc(doc(staffDb,'schedule_registrations','reg_abc_123_staff-1_extra')));
    await env.withSecurityRulesDisabled(async c => {
        await setDoc(doc(c.firestore(),'schedule_registrations','reg_abc_123_staff-1'),{userId:'staff-2'});
    });
    await assertFails(getDoc(doc(staffDb,'schedule_registrations','reg_abc_123_staff-1')));
    await assertFails(getDocs(collection(staffDb,'schedule_registrations')));
    await assertSucceeds(getDocs(query(collection(staffDb,'schedule_registrations'),where('userId','==','staff-1'))));
});

test('unauthenticated users cannot read the staff directory', async () => {
    await assertFails(getDoc(doc(guestDb, 'staff_directory', 'staff-1')));
});

test('staff can read sanitized directory but not colleagues private payroll profiles', async () => {
    await assertSucceeds(getDocs(collection(staffDb, 'staff_directory')));
    await assertSucceeds(getDoc(doc(staffDb, 'users', 'staff-1')));
    await assertFails(getDoc(doc(staffDb, 'users', 'staff-2')));
    await assertFails(getDocs(collection(staffDb, 'users')));
    await assertSucceeds(getDocs(collection(adminDb, 'users')));
    await assertSucceeds(getDoc(doc(staffDb, 'user_roles', 'uid-staff')));
    await assertFails(getDoc(doc(staffDb, 'user_roles', 'uid-other')));
});

test('staff cannot self-escalate user_roles; manager can provision a mapping', async () => {
    await assertFails(updateDoc(doc(staffDb, 'user_roles', 'uid-staff'), {
        role: 'admin', roles: ['admin']
    }));
    await assertSucceeds(setDoc(doc(adminDb, 'user_roles', 'uid-new-user'), {
        userId: 'staff-new', username: 'new', role: 'staff', roles: ['staff']
    }));
});

test('senior assistant cannot mint or rewrite security mappings; primary admin can', async () => {
    await assertFails(updateDoc(doc(seniorDb, 'user_roles', 'uid-senior'), {
        role: 'admin', roles: ['admin']
    }));
    await assertFails(updateDoc(doc(seniorDb, 'user_roles', 'uid-other'), {
        userId: 'staff-senior', role: 'admin', roles: ['admin']
    }));
    await assertFails(setDoc(doc(seniorDb, 'user_roles', 'uid-senior-created'), {
        userId: 'staff-senior-created', username: 'senior-created',
        role: 'admin', roles: ['admin']
    }));
    await assertFails(deleteDoc(doc(seniorDb, 'user_roles', 'uid-other')));

    await assertSucceeds(setDoc(doc(adminDb, 'user_roles', 'uid-primary-created'), {
        userId: 'staff-primary-created', username: 'primary-created',
        role: 'staff', roles: ['staff']
    }));
    await assertSucceeds(updateDoc(doc(adminDb, 'user_roles', 'uid-primary-created'), {
        role: 'assistant', roles: ['assistant']
    }));
    await assertSucceeds(deleteDoc(doc(adminDb, 'user_roles', 'uid-primary-created')));
});

test('senior may edit existing non-security profile fields but cannot mutate identity or lifecycle', async () => {
    await assertFails(updateDoc(doc(staffDb, 'users', 'staff-1'), { role: 'admin' }));
    await assertFails(updateDoc(doc(staffDb, 'users', 'staff-2'), { name: 'Tampered' }));
    await assertSucceeds(updateDoc(doc(seniorDb, 'users', 'staff-2'), { name: 'Staff Two Updated' }));
    await assertFails(updateDoc(doc(seniorDb, 'users', 'staff-2'), { username: 'staff2-renamed' }));
    await assertFails(updateDoc(doc(seniorDb, 'users', 'staff-2'), { role: 'admin' }));
    await assertFails(updateDoc(doc(seniorDb, 'users', 'staff-2'), { roles: ['admin'] }));
    await assertFails(updateDoc(doc(seniorDb, 'users', 'staff-2'), { authUid: 'uid-senior' }));
    await assertFails(updateDoc(doc(seniorDb, 'users', 'staff-2'), { password: 'should-never-live-here' }));
    await assertFails(updateDoc(doc(seniorDb, 'users', 'staff-2'), {
        salary_config: { attendance_rate: 1 }
    }));
    await assertFails(updateDoc(doc(seniorDb, 'users', 'staff-2'), { teachingMode: 'old' }));
    await assertFails(setDoc(doc(seniorDb, 'users', 'staff-senior-created'), {
        id: 'staff-senior-created', name: 'Senior Created', username: 'senior-created', role: 'staff'
    }));

    await assertFails(updateDoc(doc(staffDb, 'staff_directory', 'staff-1'), { role: 'admin' }));
    await assertSucceeds(updateDoc(doc(seniorDb, 'staff_directory', 'staff-2'), {
        name: 'Staff Two Directory Updated'
    }));
    await assertFails(updateDoc(doc(seniorDb, 'staff_directory', 'staff-2'), { username: 'staff2-renamed' }));
    await assertFails(updateDoc(doc(seniorDb, 'staff_directory', 'staff-2'), { roles: ['admin'] }));
    await assertFails(setDoc(doc(seniorDb, 'staff_directory', 'staff-senior-created'), {
        id: 'staff-senior-created', name: 'Senior Created', username: 'senior-created', role: 'staff'
    }));

    await assertSucceeds(setDoc(doc(adminDb, 'users', 'staff-primary-created'), {
        id: 'staff-primary-created', name: 'Primary Created', username: 'primary-created',
        role: 'staff', roles: ['staff'], authUid: 'uid-primary-created'
    }));
    await assertSucceeds(updateDoc(doc(adminDb, 'users', 'staff-primary-created'), {
        role: 'assistant', roles: ['assistant'],
        salary_config: { attendance_rate: 125000 }, teachingMode: 'old'
    }));
    await assertFails(deleteDoc(doc(seniorDb, 'users', 'staff-primary-created')));
    await assertSucceeds(deleteDoc(doc(adminDb, 'users', 'staff-primary-created')));

    await assertSucceeds(setDoc(doc(adminDb, 'staff_directory', 'staff-new'), {
        id: 'staff-new', name: 'New Staff', username: 'newstaff', role: 'staff', roles: ['staff']
    }));
    await assertFails(deleteDoc(doc(seniorDb, 'staff_directory', 'staff-new')));
    await assertSucceeds(deleteDoc(doc(adminDb, 'staff_directory', 'staff-new')));
    await assertFails(setDoc(doc(adminDb, 'staff_directory', 'staff-leaky'), {
        id: 'staff-leaky', name: 'Leaky', username: 'leaky', role: 'staff',
        salary_config: { attendance_rate: 999999 }
    }));
});

test('credential documents are unreadable to staff but support safe own rotation', async () => {
    await assertFails(getDoc(doc(staffDb, 'user_credentials', 'staff-1')));
    await assertFails(setDoc(doc(staffDb, 'user_credentials', 'staff-2'), {
        staffId: 'staff-2', password: 'new-password', updatedAt: serverTimestamp()
    }));
    await assertSucceeds(setDoc(doc(staffDb, 'user_credentials', 'staff-1'), {
        staffId: 'staff-1', password: 'new-password', updatedAt: serverTimestamp()
    }));
    await assertFails(getDoc(doc(seniorDb, 'user_credentials', 'staff-1')));
    await assertFails(updateDoc(doc(seniorDb, 'user_credentials', 'staff-1'), {
        password: 'senior-forbidden', updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(doc(adminDb, 'user_credentials', 'staff-1'), {
        username: 'legacy-compatible-metadata'
    }));
    await assertSucceeds(setDoc(doc(staffDb, 'user_credentials', 'staff-1'), {
        staffId: 'staff-1', password: 'rotated-password', updatedAt: serverTimestamp()
    }, { merge: true }));
    await assertSucceeds(getDoc(doc(adminDb, 'user_credentials', 'staff-1')));
});

test('owner can read a canonical missing attendance document before first check-in', async () => {
    const clockDay = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const clockBase = Date.now();
    const clockISO = offset => new Date(clockBase + offset).toISOString();

    const todayRef = doc(staffDb, 'attendance_logs', clockDay + '_staff-1');
    const previousRef = doc(staffDb, 'attendance_logs', '2026-08-31_staff-1');
    const missingOwnSnapshot = await assertSucceeds(getDoc(todayRef));
    if (missingOwnSnapshot.exists()) {
        throw new Error('The attendance fixture must remain absent before first check-in');
    }

    await assertFails(getDoc(doc(staffDb, 'attendance_logs', clockDay + '_staff-2')));
    await assertFails(getDoc(doc(staffDb, 'attendance_logs', 'not-a-date_staff-1')));
    await assertFails(getDoc(doc(staffDb, 'attendance_logs', '2026-08-26_staff-1')));

    const openSession = {
        id: 'first-session', anchorDateKey: clockDay, status: 'open', source: 'self',
        start: clockISO(-240000), checkIn: null, checkOut: null
    };
    openSession.checkIn = openSession.start;
    await assertSucceeds(runTransaction(staffDb, async transaction => {
        const todaySnapshot = await transaction.get(todayRef);
        const previousSnapshot = await transaction.get(previousRef);
        if (todaySnapshot.exists() || previousSnapshot.exists()) {
            throw new Error('Both deterministic documents must be absent in this regression');
        }
        transaction.set(todayRef, {
            userId: 'staff-1', name: 'Staff One', date: clockDay,
            sessions: [openSession], checkIn: openSession.checkIn, checkOut: null,
            lastUpdated: serverTimestamp()
        });
        transaction.set(doc(staffDb, 'attendance_checkin_proofs', clockDay + '~staff-1~first-session'), {
            staffId: 'staff-1', dateKey: clockDay, sessionId: 'first-session',
            authUid: 'uid-staff', recordedAt: serverTimestamp(), schemaVersion: 1
        });
    }));

    await assertSucceeds(getDocs(query(
        collection(staffDb, 'attendance_logs'), where('userId', '==', 'staff-1')
    )));
    await assertFails(getDocs(collection(staffDb, 'attendance_logs')));
});

test('owner can create/update own attendance but cannot mutate another employee', async () => {
    const clockDay = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const clockBase = Date.now();
    const clockISO = offset => new Date(clockBase + offset).toISOString();
    await deleteDoc(doc(adminDb, 'attendance_logs', clockDay + '_staff-1'));

    const ownRef = doc(staffDb, 'attendance_logs', clockDay + '_staff-1');
    const openSession = {
        id: 'session-1', anchorDateKey: clockDay, status: 'open', source: 'self',
        start: clockISO(-240000), checkIn: null, checkOut: null
    };
    openSession.checkIn = openSession.start;
    await assertSucceeds(runTransaction(staffDb, async transaction => {
        transaction.set(ownRef, {
            userId: 'staff-1', name: 'Staff One', date: clockDay,
            sessions: [openSession], checkIn: openSession.checkIn, checkOut: null,
            lastUpdated: serverTimestamp()
        });
        transaction.set(doc(staffDb, 'attendance_checkin_proofs', clockDay + '~staff-1~session-1'), {
            staffId: 'staff-1', dateKey: clockDay, sessionId: 'session-1',
            authUid: 'uid-staff', recordedAt: serverTimestamp(), schemaVersion: 1
        });
    }));
    await assertFails(setDoc(doc(staffDb, 'attendance_logs', 'arbitrary-duplicate-id'), {
        userId: 'staff-1', name: 'Staff One', date: clockDay, sessions: []
    }));
    await assertFails(setDoc(doc(staffDb, 'attendance_logs', '2026-08-30_staff-1'), {
        userId: 'staff-1', name: 'Another Person', date: '2026-08-30', sessions: []
    }));
    const closedSession = { ...openSession, status: 'closed', checkOut: clockISO(-180000) };
    await assertSucceeds(updateDoc(ownRef, {
        sessions: [closedSession],
        checkOut: clockISO(-180000), lastUpdated: serverTimestamp()
    }));
    const secondSession = {
        id: 'session-2', anchorDateKey: clockDay, status: 'open', source: 'self',
        start: clockISO(-120000), checkIn: null, checkOut: null
    };
    secondSession.checkIn = secondSession.start;
    await assertSucceeds(runTransaction(staffDb, async transaction => {
        transaction.update(ownRef, {
            sessions: [closedSession, secondSession], checkIn: secondSession.checkIn,
            checkOut: null, lastUpdated: serverTimestamp()
        });
        transaction.set(doc(staffDb, 'attendance_checkin_proofs', clockDay + '~staff-1~session-2'), {
            staffId: 'staff-1', dateKey: clockDay, sessionId: 'session-2',
            authUid: 'uid-staff', recordedAt: serverTimestamp(), schemaVersion: 1
        });
    }));
    await assertFails(updateDoc(ownRef, {
        sessions: [closedSession, { ...secondSession, bonus10: true }],
        lastUpdated: serverTimestamp()
    }));
    await assertFails(updateDoc(ownRef, {
        sessions: [closedSession, { ...secondSession, checkIn: '2026-08-31T00:00:00.000Z' }],
        lastUpdated: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(ownRef, {
        sessions: [closedSession, {
            ...secondSession, status: 'closed', checkOut: clockISO(-60000)
        }],
        checkOut: clockISO(-60000), lastUpdated: serverTimestamp()
    }));
    const closedSecondSession = {
        ...secondSession, status: 'closed', checkOut: clockISO(-60000)
    };
    const pendingStudentCount = {
        ...closedSecondSession,
        studentCount: 12,
        studentCountStatus: 'pending',
        studentCountUpdatedAt: clockISO(-30000),
        studentCountUpdatedBy: 'staff-1'
    };
    await assertSucceeds(updateDoc(ownRef, {
        sessions: [closedSession, pendingStudentCount],
        lastUpdated: serverTimestamp()
    }));
    await assertFails(updateDoc(ownRef, {
        sessions: [closedSession, {
            ...pendingStudentCount,
            studentCountStatus: 'approved'
        }],
        lastUpdated: serverTimestamp()
    }));
    await assertFails(updateDoc(ownRef, {
        sessions: [closedSession, {
            ...pendingStudentCount,
            studentCount: 999,
            bonus10: true
        }],
        lastUpdated: serverTimestamp()
    }));
    await assertFails(updateDoc(ownRef, {
        sessions: [closedSession, {
            ...pendingStudentCount,
            studentCountUpdatedBy: 'staff-2'
        }],
        lastUpdated: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(ownRef, {
        sessions: [closedSession, closedSecondSession],
        lastUpdated: serverTimestamp()
    }));
    await assertFails(updateDoc(ownRef, { name: 'Another Person' }));
    await assertFails(updateDoc(doc(staffDb, 'attendance_logs', clockDay + '_staff-2'), {
        sessions: [{ id: 'forged' }]
    }));
    await assertFails(deleteDoc(ownRef));
});

test('cached v2 check-in remains writable during proof rollout but cannot mint a +10 receipt', async () => {
    const clockDay = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const clockBase = Date.now();
    const clockISO = offset => new Date(clockBase + offset).toISOString();
    await deleteDoc(doc(adminDb, 'attendance_logs', clockDay + '_staff-1'));

    const compatibilityRef = doc(staffDb, 'attendance_logs', clockDay + '_staff-1');
    const cachedSession = {
        id: 'cached-v2-session', anchorDateKey: clockDay, status: 'open', source: 'self',
        start: clockISO(-240000), checkIn: null, checkOut: null
    };
    cachedSession.checkIn = cachedSession.start;
    await assertSucceeds(setDoc(compatibilityRef, {
        userId: 'staff-1', name: 'Staff One', date: clockDay,
        sessions: [cachedSession], checkIn: cachedSession.checkIn, checkOut: null,
        lastUpdated: serverTimestamp()
    }));
    await env.withSecurityRulesDisabled(async context => {
        const missingProof = await getDoc(doc(
            context.firestore(), 'attendance_checkin_proofs',
            clockDay + '~staff-1~cached-v2-session'
        ));
        if (missingProof.exists()) throw new Error('Cached v2 compatibility must not fabricate a server receipt');
    });
});

test('legacy cached client cannot bypass immutable server-time check-in proof', async () => {
    const legacyRef = doc(staffDb, 'attendance_logs', '2026-08-27_staff-1');
    const firstLegacySession = {
        id: 1788170400000,
        start: '2026-08-27T01:00:00.000Z',
        checkIn: '2026-08-27T01:00:00.000Z',
        checkOut: null
    };

    // Pre-v2 tabs/PWAs used Date.now() and had no immutable proof. They must
    // reload instead of creating forgeable attendance evidence.
    await assertFails(setDoc(legacyRef, {
        userId: 'staff-1', name: 'Staff One', date: '2026-08-27',
        sessions: [firstLegacySession], checkIn: firstLegacySession.checkIn,
        checkOut: null, lastUpdated: serverTimestamp()
    }));

    const unsafeRef = doc(staffDb, 'attendance_logs', '2026-08-26_staff-1');
    await assertFails(setDoc(unsafeRef, {
        userId: 'staff-1', name: 'Staff One', date: '2026-08-26',
        sessions: [{
            id: 1788084000000,
            start: '2026-08-26T01:00:00.000Z',
            checkIn: '2026-08-26T01:00:00.000Z',
            checkOut: null,
            roleRate: 999999,
            bonus10: true
        }],
        checkIn: '2026-08-26T01:00:00.000Z', checkOut: null,
        lastUpdated: serverTimestamp()
    }));
    await assertFails(setDoc(unsafeRef, {
        userId: 'staff-1', name: 'Staff One', date: '2026-08-26',
        sessions: [{
            id: 'numeric-id-required-for-legacy',
            start: '2026-08-26T01:00:00.000Z',
            checkIn: '2026-08-26T01:00:00.000Z',
            checkOut: null
        }],
        checkIn: '2026-08-26T01:00:00.000Z', checkOut: null,
        lastUpdated: serverTimestamp()
    }));
});

test('attendance cross-read/write is available only to operational auditors/managers', async () => {
    await assertFails(getDoc(doc(staffDb, 'attendance_logs', '2026-08-31_staff-2')));
    await assertFails(getDocs(collection(staffDb, 'attendance_logs')));
    await assertSucceeds(getDocs(collection(assistantDb, 'attendance_logs')));
    await assertSucceeds(getDoc(doc(receptionDb, 'attendance_logs', '2026-08-31_staff-2')));
    await assertSucceeds(updateDoc(doc(adminDb, 'attendance_logs', '2026-08-31_staff-2'), {
        lastUpdated: serverTimestamp()
    }));
});

test('senior attendance maintenance cannot forge or remove primary-Admin payroll overrides', async () => {
    const override = {
        version: 1,
        mode: 'manual',
        revision: 1,
        reason: 'Primary Admin allocation',
        allocations: [{
            id: 'teaching-1', kind: 'teaching',
            fromISO: '2026-08-30T00:30:00.000Z',
            toISO: '2026-08-30T02:00:00.000Z',
            subjectIds: ['subject-e1'], rateMode: 'manual', manualRate: 120000
        }]
    };
    const protectedSession = {
        id: 'protected-session', checkIn: '2026-08-30T00:30:00.000Z',
        checkOut: '2026-08-30T02:00:00.000Z', role: 'subject-e1',
        adminPayrollOverride: override
    };
    const ordinarySession = {
        id: 'ordinary-session', checkIn: '2026-08-30T03:00:00.000Z',
        checkOut: '2026-08-30T04:00:00.000Z', role: 'tiep-tan'
    };
    const marker = {
        authUid: 'uid-admin', actorUserId: 'staff-admin',
        sessionId: 'protected-session', auditId: 'payroll-secure-seed',
        at: '2026-08-30T05:00:00.000Z'
    };
    const suffixes = [
        'inject', 'change', 'remove', 'delete-protected', 'marker', 'delete-log',
        'marker-null', 'marker-remove', 'reorder', 'reorder-edit', 'add-null',
        'replace-protected', 'duplicates', 'edit-ordinary', 'edit-protected',
        'add-clean', 'delete-clean', 'identity-user', 'identity-date', 'primary'
    ];
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        for (const suffix of suffixes) {
            await setDoc(doc(db, 'attendance_logs', `2026-08-30_${suffix}`), {
                userId: suffix,
                name: suffix,
                date: '2026-08-30',
                sessions: [protectedSession, ordinarySession],
                lastAdminPayrollOverride: marker
            });
        }
    });
    const seniorRef = suffix => doc(seniorDb, 'attendance_logs', `2026-08-30_${suffix}`);
    const adminRef = suffix => doc(adminDb, 'attendance_logs', `2026-08-30_${suffix}`);

    await assertFails(updateDoc(seniorRef('inject'), {
        sessions: [protectedSession, { ...ordinarySession, adminPayrollOverride: override }]
    }));
    await assertFails(updateDoc(seniorRef('change'), {
        sessions: [{
            ...protectedSession,
            adminPayrollOverride: { ...override, revision: 2, mode: 'actual' }
        }, ordinarySession]
    }));
    await assertFails(updateDoc(seniorRef('remove'), {
        sessions: [{
            id: protectedSession.id,
            checkIn: protectedSession.checkIn,
            checkOut: protectedSession.checkOut,
            role: protectedSession.role
        }, ordinarySession]
    }));
    await assertFails(updateDoc(seniorRef('delete-protected'), {
        sessions: [ordinarySession]
    }));
    await assertFails(updateDoc(seniorRef('marker'), {
        lastAdminPayrollOverride: { ...marker, actorUserId: 'staff-senior' }
    }));
    await assertFails(updateDoc(seniorRef('marker-null'), {
        lastAdminPayrollOverride: null
    }));
    await assertFails(updateDoc(seniorRef('marker-remove'), {
        lastAdminPayrollOverride: deleteField()
    }));
    await assertFails(updateDoc(seniorRef('reorder'), {
        sessions: [ordinarySession, protectedSession]
    }));
    await assertFails(updateDoc(seniorRef('reorder-edit'), {
        sessions: [{ ...ordinarySession, role: 'van-phong' }, protectedSession]
    }));
    await assertFails(updateDoc(seniorRef('add-null'), {
        sessions: [protectedSession, ordinarySession, {
            id: 'explicit-null', checkIn: '2026-08-30T05:00:00.000Z',
            checkOut: '2026-08-30T06:00:00.000Z', role: 'van-phong',
            adminPayrollOverride: null
        }]
    }));
    await assertFails(updateDoc(seniorRef('replace-protected'), {
        sessions: [ordinarySession, {
            id: 'clean-replacement', checkIn: '2026-08-30T05:00:00.000Z',
            checkOut: '2026-08-30T06:00:00.000Z', role: 'van-phong'
        }]
    }));
    await assertFails(updateDoc(seniorRef('identity-user'), {
        userId: 'reassigned-by-senior'
    }));
    await assertFails(updateDoc(seniorRef('identity-date'), {
        date: '2026-08-29'
    }));
    await assertFails(deleteDoc(seniorRef('delete-log')));
    await assertFails(setDoc(doc(seniorDb, 'attendance_logs', '2026-08-27_staff-forged'), {
        userId: 'staff-forged', name: 'Forged', date: '2026-08-27',
        sessions: [{ ...protectedSession, id: 'forged-override' }]
    }));
    await assertFails(setDoc(doc(seniorDb, 'attendance_logs', '2026-08-27_staff-null-override'), {
        userId: 'staff-null-override', name: 'Null override', date: '2026-08-27',
        sessions: [{
            id: 'explicit-null', checkIn: '2026-08-27T01:00:00.000Z',
            checkOut: '2026-08-27T02:00:00.000Z', adminPayrollOverride: null
        }]
    }));
    await assertSucceeds(setDoc(doc(seniorDb, 'attendance_logs', '2026-08-27_staff-clean'), {
        userId: 'staff-clean', name: 'Clean', date: '2026-08-27',
        sessions: [{
            id: 'clean-create', checkIn: '2026-08-27T01:00:00.000Z',
            checkOut: '2026-08-27T02:00:00.000Z', role: 'van-phong'
        }]
    }));

    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'attendance_logs', '2026-08-30_duplicates'), {
            userId: 'duplicates', name: 'duplicates', date: '2026-08-30',
            sessions: [protectedSession, protectedSession, ordinarySession],
            lastAdminPayrollOverride: marker
        });
    });
    await assertFails(updateDoc(seniorRef('duplicates'), {
        sessions: [protectedSession, ordinarySession, ordinarySession]
    }));

    await assertSucceeds(updateDoc(seniorRef('edit-ordinary'), {
        sessions: [protectedSession, { ...ordinarySession, role: 'van-phong' }]
    }));
    await assertFails(updateDoc(seniorRef('edit-protected'), {
        sessions: [{ ...protectedSession, roleName: 'E1 - corrected label' }, ordinarySession]
    }));
    await assertSucceeds(updateDoc(seniorRef('add-clean'), {
        sessions: [protectedSession, ordinarySession, {
            id: 'clean-added', checkIn: '2026-08-30T05:00:00.000Z',
            checkOut: '2026-08-30T06:00:00.000Z', role: 'van-phong'
        }]
    }));
    await assertSucceeds(updateDoc(seniorRef('delete-clean'), {
        sessions: [protectedSession]
    }));
    await assertSucceeds(updateDoc(adminRef('primary'), {
        sessions: [{
            ...protectedSession,
            adminPayrollOverride: { ...override, revision: 2, reason: 'Primary correction' }
        }, ordinarySession],
        lastAdminPayrollOverride: { ...marker, auditId: 'payroll-primary-next' }
    }));
});

test('schedule attendance correction audits are primary-admin-only and append-only', async () => {
    const auditRef = doc(adminDb, 'schedule_attendance_admin_audits', 'audit-primary-admin');
    const auditPayload = {
        authUid: 'uid-admin',
        actorUserId: 'staff-admin',
        staffId: 'staff-2',
        dateKey: '2026-08-31',
        sessionId: 'session-1',
        action: 'save_correction',
        source: 'schedule_attendance_popup',
        createdAt: serverTimestamp()
    };

    await assertSucceeds(setDoc(auditRef, auditPayload));
    await assertSucceeds(getDoc(auditRef));

    for (const [actorDb, authUid, actorUserId, auditId] of [
        [seniorDb, 'uid-senior', 'staff-senior', 'audit-senior'],
        [assistantDb, 'uid-assistant', 'staff-assistant', 'audit-assistant'],
        [staffDb, 'uid-staff', 'staff-1', 'audit-staff']
    ]) {
        await assertFails(setDoc(
            doc(actorDb, 'schedule_attendance_admin_audits', auditId),
            { ...auditPayload, authUid, actorUserId, createdAt: serverTimestamp() }
        ));
        await assertFails(getDoc(doc(
            actorDb, 'schedule_attendance_admin_audits', 'audit-primary-admin'
        )));
    }

    await assertFails(setDoc(doc(adminDb, 'schedule_attendance_admin_audits', 'audit-forged-actor'), {
        ...auditPayload,
        authUid: 'uid-senior',
        actorUserId: 'staff-senior',
        createdAt: serverTimestamp()
    }));
    await assertFails(setDoc(doc(adminDb, 'schedule_attendance_admin_audits', 'audit-extra-field'), {
        ...auditPayload,
        details: 'must remain on the attendance session',
        createdAt: serverTimestamp()
    }));
    await assertFails(updateDoc(auditRef, { action: 'save_correction' }));
    await assertFails(deleteDoc(auditRef));
});

test('payroll override audits are primary-admin-only and append-only', async () => {
    const auditRef = doc(adminDb, 'admin_payroll_override_audits', 'payroll-audit-primary');
    const payload = {
        authUid: 'uid-admin',
        actorUserId: 'staff-admin',
        staffId: 'staff-2',
        dateKey: '2026-08-31',
        sessionId: 'session-1',
        action: 'save_payroll_override',
        mode: 'manual',
        revision: 1,
        reason: 'Chia ca thực tế theo hai công việc',
        createdAt: serverTimestamp()
    };

    await assertSucceeds(setDoc(auditRef, payload));
    await assertSucceeds(getDoc(auditRef));
    for (const [actorDb, authUid, actorUserId, id] of [
        [seniorDb, 'uid-senior', 'staff-senior', 'payroll-audit-senior'],
        [assistantDb, 'uid-assistant', 'staff-assistant', 'payroll-audit-assistant'],
        [staffDb, 'uid-staff', 'staff-1', 'payroll-audit-staff']
    ]) {
        await assertFails(setDoc(
            doc(actorDb, 'admin_payroll_override_audits', id),
            { ...payload, authUid, actorUserId, createdAt: serverTimestamp() }
        ));
        await assertFails(getDoc(doc(actorDb, 'admin_payroll_override_audits', auditRef.id)));
    }
    await assertFails(setDoc(doc(adminDb, 'admin_payroll_override_audits', 'payroll-audit-forged'), {
        ...payload,
        actorUserId: 'staff-senior',
        createdAt: serverTimestamp()
    }));
    await assertFails(setDoc(doc(adminDb, 'admin_payroll_override_audits', 'payroll-audit-extra'), {
        ...payload,
        unexpected: true,
        createdAt: serverTimestamp()
    }));
    await assertFails(updateDoc(auditRef, { reason: 'rewrite' }));
    await assertFails(deleteDoc(auditRef));
});

test('schedule attendance correction transaction is primary-admin-only and atomic', async () => {
    const attendanceId = '2026-08-31_staff-2';
    const adminAttendanceRef = doc(adminDb, 'attendance_logs', attendanceId);
    const adminTargetShiftKey = 'teaching__2026-08-31__shift__admin-transaction';
    const adminBonusRef = doc(
        adminDb,
        'bonus10_requests',
        `b10~2026-08-31~staff-2~${adminTargetShiftKey}`
    );
    const adminAuditRef = doc(
        adminDb,
        'schedule_attendance_admin_audits',
        'tx-admin-schedule-correction'
    );

    await assertSucceeds(runTransaction(adminDb, async transaction => {
        const attendanceSnapshot = await transaction.get(adminAttendanceRef);
        if (!attendanceSnapshot.exists()) {
            throw new Error('Seeded attendance document is required for the transaction test.');
        }

        transaction.set(adminAttendanceRef, {
            lastScheduleAdminEdit: {
                actorUserId: 'staff-admin',
                sessionId: 'session-admin-transaction'
            },
            lastUpdated: serverTimestamp()
        }, { merge: true });
        transaction.set(adminBonusRef, {
            staffId: 'staff-2',
            dateKey: '2026-08-31',
            sessionId: 'session-admin-transaction',
            status: 'approved',
            awardScope: 'teaching_shift',
            targetShiftKey: adminTargetShiftKey
        });
        transaction.set(adminAuditRef, {
            authUid: 'uid-admin',
            actorUserId: 'staff-admin',
            staffId: 'staff-2',
            dateKey: '2026-08-31',
            sessionId: 'session-admin-transaction',
            action: 'save_correction',
            source: 'schedule_attendance_popup',
            createdAt: serverTimestamp()
        });
    }));

    const committedAttendance = await getDoc(adminAttendanceRef);
    if (committedAttendance.data()?.lastScheduleAdminEdit?.sessionId
        !== 'session-admin-transaction') {
        throw new Error('Admin attendance mutation did not commit.');
    }
    if (!(await getDoc(adminBonusRef)).exists()) {
        throw new Error('Admin bonus mutation did not commit.');
    }
    if (!(await getDoc(adminAuditRef)).exists()) {
        throw new Error('Admin audit mutation did not commit.');
    }

    const seniorAttendanceRef = doc(seniorDb, 'attendance_logs', attendanceId);
    const seniorTargetShiftKey = 'teaching__2026-08-31__shift__senior-transaction';
    const seniorBonusRef = doc(
        seniorDb,
        'bonus10_requests',
        `b10~2026-08-31~staff-2~${seniorTargetShiftKey}`
    );
    const seniorAuditRef = doc(
        seniorDb,
        'schedule_attendance_admin_audits',
        'b10~2026-08-31~staff-2~session-senior-transaction'
    );

    await assertFails(runTransaction(seniorDb, async transaction => {
        const attendanceSnapshot = await transaction.get(seniorAttendanceRef);
        if (!attendanceSnapshot.exists()) {
            throw new Error('Seeded attendance document is required for the transaction test.');
        }

        transaction.set(seniorAttendanceRef, {
            seniorAtomicProbe: 'must-not-commit',
            lastUpdated: serverTimestamp()
        }, { merge: true });
        transaction.set(seniorBonusRef, {
            staffId: 'staff-2',
            dateKey: '2026-08-31',
            sessionId: 'session-senior-transaction',
            status: 'approved',
            awardScope: 'teaching_shift',
            targetShiftKey: seniorTargetShiftKey
        });
        transaction.set(seniorAuditRef, {
            authUid: 'uid-senior',
            actorUserId: 'staff-senior',
            staffId: 'staff-2',
            dateKey: '2026-08-31',
            sessionId: 'session-senior-transaction',
            action: 'save_correction',
            source: 'schedule_attendance_popup',
            createdAt: serverTimestamp()
        });
    }));

    const rolledBackAttendance = await getDoc(doc(adminDb, 'attendance_logs', attendanceId));
    if (rolledBackAttendance.data()?.seniorAtomicProbe !== undefined) {
        throw new Error('Denied senior transaction partially changed attendance.');
    }
    if ((await getDoc(doc(
        adminDb,
        'bonus10_requests',
        'tx-senior-schedule-correction'
    ))).exists()) {
        throw new Error('Denied senior transaction partially created a bonus request.');
    }
    if ((await getDoc(doc(
        adminDb,
        'schedule_attendance_admin_audits',
        'tx-senior-schedule-correction'
    ))).exists()) {
        throw new Error('Denied senior transaction partially created an audit record.');
    }
});

test('legacy single-session attendance can still be safely checked out once', async () => {
    await assertSucceeds(updateDoc(doc(staffDb, 'attendance_logs', '2026-08-29_staff-1'), {
        sessions: [{
            id: 'legacy', start: '2026-08-29T01:00:00.000Z',
            checkIn: '2026-08-29T01:00:00.000Z', checkOut: '2026-08-29T03:00:00.000Z',
            status: 'closed', anchorDateKey: '2026-08-29'
        }],
        checkOut: '2026-08-29T03:00:00.000Z', lastUpdated: serverTimestamp()
    }));
});

test('owner checkout remains compatible with the production maximum of six sessions', async () => {
    const snapshot = await getDoc(doc(staffDb, 'attendance_logs', '2026-08-28_staff-1'));
    const sessions = snapshot.data().sessions;
    sessions[5] = {
        ...sessions[5], status: 'closed', checkOut: '2026-08-28T11:00:00.000Z'
    };
    await assertSucceeds(updateDoc(doc(staffDb, 'attendance_logs', '2026-08-28_staff-1'), {
        sessions, checkOut: '2026-08-28T11:00:00.000Z', lastUpdated: serverTimestamp()
    }));
    sessions[5] = {
        ...sessions[5],
        studentCount: 18,
        studentCountStatus: 'pending',
        studentCountUpdatedAt: '2026-08-28T11:05:00.000Z',
        studentCountUpdatedBy: 'staff-1'
    };
    await assertSucceeds(updateDoc(doc(staffDb, 'attendance_logs', '2026-08-28_staff-1'), {
        sessions, lastUpdated: serverTimestamp()
    }));
});

test('shift observation queries are owner-scoped for staff and date-wide for operators', async () => {
    await assertFails(getDocs(query(
        collection(staffDb, 'shift_observations'),
        where('dateKey', '==', '2026-08-31')
    )));
    await assertSucceeds(getDocs(query(
        collection(staffDb, 'shift_observations'),
        where('dateKey', '==', '2026-08-31'),
        where('teacherId', '==', 'staff-1')
    )));
    await assertSucceeds(getDocs(query(
        collection(receptionDb, 'shift_observations'),
        where('dateKey', '==', '2026-08-31')
    )));
});

test('teaching schedules are manager-written; roster types keep separate editor scopes', async () => {
    await assertFails(updateDoc(doc(staffDb, 'schedules', 'cs1__2026-08-31'), { morning1: [] }));
    await assertFails(updateDoc(doc(receptionDb, 'schedules', 'cs1__2026-08-31'), { morning1: [] }));
    await assertSucceeds(updateDoc(doc(assistantDb, 'schedules', 'cs1__2026-08-31'), { morning1: [] }));
    await assertSucceeds(updateDoc(doc(receptionDb, 'receptionist_schedules', 'cs1__2026-08-31'), { morning: { mon: [] } }));
    await assertFails(updateDoc(doc(receptionDb, 'office_schedules', 'cs1__2026-08-31'), { morning: { mon: [] } }));
    await assertSucceeds(updateDoc(doc(assistantDb, 'office_schedules', 'cs1__2026-08-31'), { morning: { mon: [] } }));
});

test('self-registration uses an owner-only immutable shift record with cancellation tombstones', async () => {
    const ownRef = doc(staffDb, 'schedule_registrations', 'registration-staff-1');
    await assertFails(getDocs(collection(staffDb, 'schedule_registrations')));
    await assertSucceeds(getDocs(query(
        collection(staffDb, 'schedule_registrations'),
        where('scheduleKey', '==', 'cs1__2026-08-31'),
        where('userId', '==', 'staff-1')
    )));
    await assertFails(getDoc(doc(staffDb, 'schedule_registrations', 'registration-staff-2')));
    await assertSucceeds(getDocs(query(
        collection(assistantDb, 'schedule_registrations'),
        where('scheduleKey', '==', 'cs1__2026-08-31')
    )));
    const ownRegistration = {
        userId: 'staff-1', authUid: 'uid-staff', userName: 'Staff One',
        scheduleKey: 'cs1__2026-08-31', scheduleDocId: 'cs1__2026-08-31',
        branch: 'cs1', dateKey: '2026-08-31', section: 'morning1', rowIndex: 0,
        shiftId: 'shift-a1', rowSignature: '08:00|09:30|A1|P01',
        schemaVersion: 1, status: 'active',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
    await assertSucceeds(setDoc(ownRef, ownRegistration));
    await assertFails(setDoc(doc(staffDb, 'schedule_registrations', 'registration-for-other'), {
        ...ownRegistration, userId: 'staff-2', userName: 'Staff Two'
    }));
    await assertSucceeds(setDoc(doc(staffDb, 'schedule_registrations', 'registration-pre-cancelled'), {
        ...ownRegistration, status: 'cancelled'
    }));
    await assertFails(setDoc(doc(staffDb, 'schedule_registrations', 'registration-forged-name'), {
        ...ownRegistration, userName: 'Administrator'
    }));
    await assertSucceeds(updateDoc(ownRef, {
        status: 'cancelled', updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(ownRef, { scheduleKey: 'cs2__2026-08-31' }));
    await assertFails(updateDoc(ownRef, { rowIndex: 9 }));
    await assertFails(updateDoc(ownRef, { authUid: 'uid-other' }));
    await assertFails(updateDoc(ownRef, { userId: 'staff-2' }));
    await assertFails(updateDoc(ownRef, { userName: 'Administrator', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(staffDb, 'schedule_registrations', 'registration-staff-2'), {
        status: 'cancelled', updatedAt: serverTimestamp()
    }));
    await assertFails(deleteDoc(ownRef));
    await assertSucceeds(deleteDoc(doc(assistantDb, 'schedule_registrations', 'registration-staff-2')));
});

test('settings block ordinary staff and constrain receptionist assistants to reception shift keys', async () => {
    const staffSettings = doc(staffDb, 'settings', 'system');
    const receptionSettings = doc(receptionDb, 'settings', 'system');
    await assertFails(updateDoc(staffSettings, { gpsCS1Radius: 999999 }));
    await assertSucceeds(updateDoc(receptionSettings, {
        receptionistShifts_cs1: { morning: { start: '07:15', end: '11:45' } }
    }));
    await assertFails(updateDoc(receptionSettings, { gpsCS1Radius: 999999 }));
    await assertFails(updateDoc(receptionSettings, {
        officeShifts_cs1: { morning: { start: '00:00', end: '23:59' } }
    }));
    await assertSucceeds(updateDoc(doc(assistantDb, 'settings', 'system'), { gpsCS1Radius: 175 }));
    await assertFails(deleteDoc(doc(assistantDb, 'settings', 'system')));
});

test('daily notes are private to owner and schedule managers', async () => {
    await assertFails(getDoc(doc(staffDb, 'daily_notes', 'staff-2')));
    await assertSucceeds(getDoc(doc(otherDb, 'daily_notes', 'staff-2')));
    await assertSucceeds(updateDoc(doc(assistantDb, 'daily_notes', 'staff-2'), {
        '2026-09-01': 'Scheduler note'
    }));
});

test('salary data is private and staff cannot write rates or create a payslip', async () => {
    await assertSucceeds(getDoc(doc(staffDb, 'salary_settings', 'staff-1')));
    await assertFails(getDoc(doc(staffDb, 'salary_settings', 'staff-2')));
    await assertFails(updateDoc(doc(staffDb, 'salary_settings', 'staff-1'), { baseRate: 99999999 }));
    await assertFails(setDoc(doc(staffDb, 'salary_settings_monthly', '2026-09_staff-1'), {
        published: { status: 'received', netPay: 99999999 }
    }));
    await assertSucceeds(getDocs(collection(adminDb, 'salary_settings_monthly')));
});

test('only the primary Admin can mutate salary policy, payroll profiles, or published payroll', async () => {
    await assertSucceeds(getDoc(doc(seniorDb, 'salary_settings', 'staff-1')));
    await assertFails(updateDoc(doc(seniorDb, 'salary_settings', 'staff-1'), { baseRate: 123456 }));
    await assertFails(setDoc(doc(seniorDb, 'staff_payroll_profiles', 'staff-1'), {
        roles: ['teacher'], updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(seniorDb, 'salary_settings_monthly', '2026-08_staff-1'), {
        'published.netPay': 1
    }));
    await assertSucceeds(updateDoc(doc(adminDb, 'salary_settings', 'staff-1'), { baseRate: 110000 }));
    await assertSucceeds(setDoc(doc(adminDb, 'staff_payroll_profiles', 'staff-1'), {
        roles: ['teacher'], updatedAt: serverTimestamp()
    }));
});

test('staff can acknowledge a published payslip without changing its money', async () => {
    const ref = doc(staffDb, 'salary_settings_monthly', '2026-08_staff-1');
    await assertSucceeds(updateDoc(ref, {
        published: {
            status: 'received', status_gv: 'received', role: 'giao-vien',
            netPay: 3500000, details_gv: { netPay: 3500000 },
            publishedAt: '2026-08-31T08:00:00.000Z',
            receivedAt: '2026-08-31T10:00:00.000Z',
            receivedAt_gv: '2026-08-31T10:00:00.000Z',
            confirmedBy: 'employee', confirmedBy_gv: 'employee'
        }
    }));
    await assertFails(updateDoc(ref, { 'published.netPay': 99999999 }));
    await assertFails(updateDoc(ref, { 'published.status_gv': 'draft' }));
    await assertFails(updateDoc(ref, { 'published.receivedAt_gv': '2099-01-01T00:00:00.000Z' }));
});

test('legacy aggregate payslip can still move published to received', async () => {
    const ref = doc(staffDb, 'salary_settings_monthly', '2026-07_staff-1');
    await assertSucceeds(updateDoc(ref, {
        published: {
            status: 'received', status_gv: 'received', role: 'giao-vien', netPay: 3200000,
            details: { netPay: 3200000 }, publishedAt: '2026-07-31T08:00:00.000Z',
            receivedAt: '2026-08-01T08:00:00.000Z',
            receivedAt_gv: '2026-08-01T08:00:00.000Z',
            confirmedBy: 'employee', confirmedBy_gv: 'employee'
        }
    }));
});

test('eligible staff can self-submit one authenticated, shift-scoped approved +10 award', async () => {
    const pending = { staffId: 'staff-1', dateKey: '2026-08-31', sessionId: 'session-1', status: 'pending' };
    await assertSucceeds(setDoc(doc(staffDb, 'overtime_requests', 'ot_2026-08-31~staff-1~session-1'), {
        ...pending, duration: '00:15', minutes: 15, createdAt: serverTimestamp(), approvedAt: null, approvedBy: null
    }));
    await assertFails(setDoc(doc(staffDb, 'overtime_requests', 'ot-approved'), { ...pending, status: 'approved' }));

    const assignmentEntry = { id: 'staff-1', name: 'Staff One' };
    const scheduleRows = [{
        lop: 'A1', lopId: 'subject-a1+subject-bth', start: '08:00', end: '09:30',
        // A materialized day may retain the deterministic ID generated while
        // its prior weekly template was inherited. It is still a direct row.
        shiftId: 'shift_inherited_a0w3gy_111wk2k', gvId: 'someone-else', gvList: [assignmentEntry]
    }];
    await assertSucceeds(setDoc(doc(adminDb, 'schedules', 'cs1__2026-08-31'), {
        morning1: scheduleRows
    }));
    await assertSucceeds(setDoc(doc(adminDb, 'subjects', 'subject-a1'), {
        name: 'A1', allowEarly10: true
    }));
    await assertSucceeds(setDoc(doc(adminDb, 'subjects', 'subject-bth'), {
        name: 'BTH', allowEarly10: false
    }));
    await assertSucceeds(setDoc(doc(adminDb, 'attendance_logs', '2026-08-31_staff-1'), {
        userId: 'staff-1', name: 'Staff One', date: '2026-08-31',
        sessions: [{
            id: 'session-early', anchorDateKey: '2026-08-31', status: 'closed', source: 'self',
            start: '2026-08-31T00:38:37.307Z', checkIn: '2026-08-31T00:38:37.307Z',
            checkOut: '2026-08-31T02:30:00.000Z'
        }]
    }));
    const proofRef = doc(adminDb, 'attendance_checkin_proofs', '2026-08-31~staff-1~session-early');
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(
            doc(context.firestore(), 'attendance_checkin_proofs', '2026-08-31~staff-1~session-early'), {
            staffId: 'staff-1', dateKey: '2026-08-31', sessionId: 'session-early',
            authUid: 'uid-staff', recordedAt: Timestamp.fromDate(new Date('2026-08-31T00:38:37.307Z')),
            schemaVersion: 1
            }
        );
    });

    const targetShiftKey = 'teaching__2026-08-31__shift__shift_inherited_a0w3gy_111wk2k';
    const approved = {
        staffId: 'staff-1', staffName: 'Staff One', dateKey: '2026-08-31',
        sessionId: 'session-early', status: 'approved', awardScope: 'teaching_shift',
        targetShiftKey, subjectId: 'subject-a1', scheduleDocId: 'cs1__2026-08-31',
        scheduleSourceDocId: 'cs1__2026-08-31', scheduleIsInherited: false,
        scheduleSection: 'morning1', scheduleIndex: 0, scheduleShiftId: 'shift_inherited_a0w3gy_111wk2k',
        scheduleRegistrationId: '', scheduleAssignmentList: 'gvList',
        scheduleAssignmentEntry: assignmentEntry, classStart: '08:00', classEnd: '09:30',
        attendanceSessionIndex: 0, earlyMinutes: 21,
        checkInAt: '2026-08-31T00:38:37.307Z', scheduledStart: '08:00',
        requestSource: 'staff_auto_approved', authUid: 'uid-staff', schemaVersion: 2,
        policyVersion: 'early10-shift-v2', createdAt: serverTimestamp(),
        approvedBy: 'staff-1', approvedByName: 'staff1', approvedAt: serverTimestamp()
    };
    const approvedRef = doc(
        staffDb, 'bonus10_requests', `b10~2026-08-31~staff-1~${targetShiftKey}`
    );
    // The atomic browser transaction gets its canonical, not-yet-created
    // document before set(). That owner-scoped read must be permitted.
    await assertSucceeds(getDoc(approvedRef));
    // `teachingMode` is deliberately absent in the seeded profile: this is the
    // documented unclassified special case and must remain eligible.
    await assertSucceeds(setDoc(approvedRef, approved));
    await assertSucceeds(deleteDoc(doc(adminDb, 'bonus10_requests', approvedRef.id)));

    await assertFails(setDoc(
        doc(staffDb, 'bonus10_requests', `b10~2026-08-31~staff-2~${targetShiftKey}`),
        { ...approved, staffId: 'staff-2', staffName: 'Staff Two' }
    ));
    await assertFails(setDoc(doc(staffDb, 'bonus10_requests', 'bonus-own-random'), approved));
    await assertFails(setDoc(
        approvedRef,
        { ...approved, status: 'pending' }
    ));
    await assertFails(setDoc(
        approvedRef,
        { ...approved, earlyMinutes: 11 }
    ));
    const forgedTarget = 'teaching__2026-08-31__shift__shift-forged';
    await assertFails(setDoc(
        doc(staffDb, 'bonus10_requests', `b10~2026-08-31~staff-1~${forgedTarget}`),
        { ...approved, targetShiftKey: forgedTarget }
    ));
    await assertFails(setDoc(
        approvedRef,
        { ...approved, authUid: 'uid-other' }
    ));
    await assertFails(setDoc(
        approvedRef,
        { ...approved, subjectId: 'subject-bth' }
    ));
    await assertFails(setDoc(
        approvedRef,
        {
            ...approved,
            scheduleAssignmentEntry: { id: 'staff-1', name: 'Forged Name' }
        }
    ));
    await assertSucceeds(deleteDoc(proofRef));
    await assertFails(setDoc(approvedRef, approved));
    await assertFails(setDoc(
        doc(staffDb, 'attendance_checkin_proofs', '2026-08-31~staff-1~session-early'), {
            staffId: 'staff-1', dateKey: '2026-08-31', sessionId: 'session-early',
            authUid: 'uid-staff',
            recordedAt: Timestamp.fromDate(new Date('2026-08-31T00:40:00.000Z')),
            schemaVersion: 1
        }
    ));

    await assertSucceeds(updateDoc(doc(adminDb, 'users', 'staff-1'), { teachingMode: 'new' }));
    await assertFails(setDoc(
        approvedRef,
        approved
    ));
    await assertSucceeds(updateDoc(doc(adminDb, 'users', 'staff-1'), { teachingMode: 'old' }));

    await assertFails(setDoc(
        doc(adminDb, 'bonus10_requests', 'admin-random-new'),
        { ...approved, staffId: 'staff-2', staffName: 'Staff Two' }
    ));
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'bonus10_requests', 'legacy-random-request'), {
            ...pending,
            status: 'pending'
        });
    });
    await assertSucceeds(updateDoc(
        doc(adminDb, 'bonus10_requests', 'legacy-random-request'),
        { status: 'approved' }
    ));
    await assertSucceeds(setDoc(doc(staffDb, 'makeup_requests', 'makeup-own'), {
        ...pending, session: { checkIn: '2026-08-31T01:00:00.000Z', checkOut: '2026-08-31T02:00:00.000Z' }
    }));
    await assertFails(updateDoc(doc(staffDb, 'overtime_requests', 'ot_2026-08-31~staff-1~session-1'), { status: 'approved' }));
    await assertSucceeds(updateDoc(doc(adminDb, 'overtime_requests', 'ot_2026-08-31~staff-1~session-1'), { status: 'approved' }));
});

test('eligible staff can self-submit +10 for an inherited FFS01 row only with an explicit subject alias', async () => {
    const dateKey = '2026-09-05';
    const sourceDocId = 'cs1__2026-08-29';
    const targetDocId = `cs1__${dateKey}`;
    const sessionId = 'inherited-ffs-session';
    const assignmentEntry = { id: 'staff-1', name: 'Staff One' };
    await assertSucceeds(setDoc(doc(adminDb, 'schedules', sourceDocId), {
        evening1: [{
            lop: 'FFS01', lopId: '', start: '18:00', end: '19:30',
            shiftId: 'template-ffs-row', gvId: 'someone-else', gvList: [assignmentEntry]
        }]
    }));
    await assertSucceeds(setDoc(doc(adminDb, 'subjects', 'subject-ffs1'), {
        name: 'FFS1', allowEarly10: true, early10ScheduleAliases: ['FFS01']
    }));
    await assertSucceeds(setDoc(doc(adminDb, 'attendance_logs', `${dateKey}_staff-1`), {
        userId: 'staff-1', name: 'Staff One', date: dateKey,
        sessions: [{
            id: sessionId, anchorDateKey: dateKey, status: 'closed', source: 'self',
            start: '2026-09-05T10:50:00.000Z', checkIn: '2026-09-05T10:50:00.000Z',
            checkOut: '2026-09-05T12:30:00.000Z'
        }]
    }));
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(
            context.firestore(), 'attendance_checkin_proofs', `${dateKey}~staff-1~${sessionId}`
        ), {
            staffId: 'staff-1', dateKey, sessionId, authUid: 'uid-staff',
            recordedAt: Timestamp.fromDate(new Date('2026-09-05T10:50:00.000Z')),
            schemaVersion: 1
        });
    });

    const targetShiftKey = `teaching__${dateKey}__inherited__${sourceDocId}__evening1__0__18:00-19:30`;
    const approved = {
        staffId: 'staff-1', staffName: 'Staff One', dateKey, sessionId,
        status: 'approved', awardScope: 'teaching_shift', targetShiftKey,
        subjectId: 'subject-ffs1', scheduleDocId: targetDocId,
        scheduleSourceDocId: sourceDocId, scheduleIsInherited: true,
        scheduleSection: 'evening1', scheduleIndex: 0, scheduleShiftId: '',
        scheduleRegistrationId: '', scheduleAssignmentList: 'gvList',
        scheduleAssignmentEntry: assignmentEntry, classStart: '18:00', classEnd: '19:30',
        attendanceSessionIndex: 0, earlyMinutes: 10,
        checkInAt: '2026-09-05T10:50:00.000Z', scheduledStart: '18:00',
        requestSource: 'staff_auto_approved', authUid: 'uid-staff', schemaVersion: 2,
        policyVersion: 'early10-shift-v2', createdAt: serverTimestamp(),
        approvedBy: 'staff-1', approvedByName: 'staff1', approvedAt: serverTimestamp()
    };
    const ref = doc(staffDb, 'bonus10_requests', `b10~${dateKey}~staff-1~${targetShiftKey}`);
    await assertSucceeds(setDoc(ref, approved));
    await assertFails(setDoc(doc(
        staffDb, 'bonus10_requests', `b10~${dateKey}~staff-1~forged-inherited`
    ), {
        ...approved, targetShiftKey: 'forged-inherited'
    }));
    await assertFails(setDoc(ref, {
        ...approved, scheduleIsInherited: false, scheduleSourceDocId: targetDocId
    }));
    await assertFails(setDoc(ref, {
        ...approved, subjectId: 'subject-bth'
    }));
});

test('notification recipient can read/acknowledge but cannot alter content', async () => {
    const ownRef = doc(staffDb, 'admin_notifications', 'notification-staff-1');
    await assertSucceeds(getDoc(ownRef));
    await assertFails(getDoc(doc(staffDb, 'admin_notifications', 'notification-staff-2')));
    await assertSucceeds(getDocs(query(
        collection(staffDb, 'admin_notifications'), where('staffId', '==', 'staff-1')
    )));
    await assertSucceeds(updateDoc(ownRef, { read: true, readAt: serverTimestamp() }));
    await assertFails(updateDoc(ownRef, { details: 'Changed by recipient' }));
});

test('meeting attendance is deterministic and owner-only for staff', async () => {
    await assertSucceeds(setDoc(doc(staffDb, 'meeting_attendance', 'meeting-1_staff-1'), {
        meetingId: 'meeting-1', userId: 'staff-1', userName: 'Staff One', rsvp: 'yes'
    }));
    await assertFails(setDoc(doc(staffDb, 'meeting_attendance', 'meeting-1_staff-2'), {
        meetingId: 'meeting-1', userId: 'staff-2', userName: 'Staff Two', status: 'Có'
    }));
    await assertFails(getDoc(doc(staffDb, 'meeting_attendance', 'meeting-1_staff-2')));
});

async function main() {
    env = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8') }
    });
    await env.clearFirestore();
    await seed(env);

    adminDb = env.authenticatedContext('uid-admin').firestore();
    seniorDb = env.authenticatedContext('uid-senior').firestore();
    assistantDb = env.authenticatedContext('uid-assistant').firestore();
    receptionDb = env.authenticatedContext('uid-reception').firestore();
    staffDb = env.authenticatedContext('uid-staff').firestore();
    otherDb = env.authenticatedContext('uid-other').firestore();
    guestDb = env.unauthenticatedContext().firestore();

    let passed = 0;
    for (const item of tests) {
        try {
            await item.fn();
            passed += 1;
            console.log(`PASS ${item.name}`);
        } catch (error) {
            console.error(`FAIL ${item.name}`);
            throw error;
        }
    }
    console.log(`Firestore Rules: ${passed}/${tests.length} scenarios passed.`);
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (env) await env.cleanup();
    });
