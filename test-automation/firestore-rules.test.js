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
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
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
            id: 'staff-2', name: 'Staff Two', username: 'staff2', role: 'staff',
            salary_config: { attendance_rate: 900000 }
        });
        await setDoc(doc(db, 'staff_directory', 'staff-1'), {
            id: 'staff-1', name: 'Staff One', username: 'staff1', role: 'staff'
        });
        await setDoc(doc(db, 'staff_directory', 'staff-2'), {
            id: 'staff-2', name: 'Staff Two', username: 'staff2', role: 'staff'
        });
        await setDoc(doc(db, 'attendance_logs', '2026-08-31_staff-2'), {
            userId: 'staff-2', name: 'Staff Two', date: '2026-08-31', sessions: []
        });
        await setDoc(doc(db, 'attendance_logs', '2026-08-29_staff-1'), {
            userId: 'staff-1', name: 'Staff One', date: '2026-08-29',
            checkIn: '2026-08-29T01:00:00.000Z', checkOut: null
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

test('profile writes are management-only', async () => {
    await assertFails(updateDoc(doc(staffDb, 'users', 'staff-1'), { role: 'admin' }));
    await assertFails(updateDoc(doc(staffDb, 'users', 'staff-2'), { name: 'Tampered' }));
    await assertSucceeds(updateDoc(doc(seniorDb, 'users', 'staff-2'), { name: 'Staff Two Updated' }));
    await assertFails(updateDoc(doc(staffDb, 'staff_directory', 'staff-1'), { role: 'admin' }));
    await assertSucceeds(setDoc(doc(adminDb, 'staff_directory', 'staff-new'), {
        id: 'staff-new', name: 'New Staff', username: 'newstaff', role: 'staff', roles: ['staff']
    }));
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
    await assertSucceeds(updateDoc(doc(adminDb, 'user_credentials', 'staff-1'), {
        username: 'legacy-compatible-metadata'
    }));
    await assertSucceeds(setDoc(doc(staffDb, 'user_credentials', 'staff-1'), {
        staffId: 'staff-1', password: 'rotated-password', updatedAt: serverTimestamp()
    }, { merge: true }));
    await assertSucceeds(getDoc(doc(adminDb, 'user_credentials', 'staff-1')));
});

test('owner can create/update own attendance but cannot mutate another employee', async () => {
    const ownRef = doc(staffDb, 'attendance_logs', '2026-08-31_staff-1');
    const openSession = {
        id: 'session-1', anchorDateKey: '2026-08-31', status: 'open', source: 'self',
        start: '2026-08-31T01:00:00.000Z', checkIn: '2026-08-31T01:00:00.000Z', checkOut: null
    };
    await assertSucceeds(setDoc(ownRef, {
        userId: 'staff-1', name: 'Staff One', date: '2026-08-31',
        sessions: [openSession], checkIn: openSession.checkIn, checkOut: null,
        lastUpdated: serverTimestamp()
    }));
    await assertFails(setDoc(doc(staffDb, 'attendance_logs', 'arbitrary-duplicate-id'), {
        userId: 'staff-1', name: 'Staff One', date: '2026-08-31', sessions: []
    }));
    await assertFails(setDoc(doc(staffDb, 'attendance_logs', '2026-08-30_staff-1'), {
        userId: 'staff-1', name: 'Another Person', date: '2026-08-30', sessions: []
    }));
    const closedSession = { ...openSession, status: 'closed', checkOut: '2026-08-31T03:00:00.000Z' };
    await assertSucceeds(updateDoc(ownRef, {
        sessions: [closedSession],
        checkOut: '2026-08-31T03:00:00.000Z', lastUpdated: serverTimestamp()
    }));
    const secondSession = {
        id: 'session-2', anchorDateKey: '2026-08-31', status: 'open', source: 'self',
        start: '2026-08-31T05:00:00.000Z', checkIn: '2026-08-31T05:00:00.000Z', checkOut: null
    };
    await assertSucceeds(updateDoc(ownRef, {
        sessions: [closedSession, secondSession], checkIn: secondSession.checkIn,
        checkOut: null, lastUpdated: serverTimestamp()
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
            ...secondSession, status: 'closed', checkOut: '2026-08-31T07:00:00.000Z'
        }],
        checkOut: '2026-08-31T07:00:00.000Z', lastUpdated: serverTimestamp()
    }));
    const closedSecondSession = {
        ...secondSession, status: 'closed', checkOut: '2026-08-31T07:00:00.000Z'
    };
    const pendingStudentCount = {
        ...closedSecondSession,
        studentCount: 12,
        studentCountStatus: 'pending',
        studentCountUpdatedAt: '2026-08-31T07:05:00.000Z',
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
    await assertFails(updateDoc(doc(staffDb, 'attendance_logs', '2026-08-31_staff-2'), {
        sessions: [{ id: 'forged' }]
    }));
    await assertFails(deleteDoc(ownRef));
});

test('legacy cached client can check in safely but cannot inject privileged session fields', async () => {
    const legacyRef = doc(staffDb, 'attendance_logs', '2026-08-27_staff-1');
    const firstLegacySession = {
        id: 1788170400000,
        start: '2026-08-27T01:00:00.000Z',
        checkIn: '2026-08-27T01:00:00.000Z',
        checkOut: null
    };

    // Pre-v2 tabs/PWAs used Date.now() and exactly these four fields.
    await assertSucceeds(setDoc(legacyRef, {
        userId: 'staff-1', name: 'Staff One', date: '2026-08-27',
        sessions: [firstLegacySession], checkIn: firstLegacySession.checkIn,
        checkOut: null, lastUpdated: serverTimestamp()
    }));

    const closedFirstLegacySession = {
        ...firstLegacySession,
        checkOut: '2026-08-27T03:00:00.000Z'
    };
    await assertSucceeds(updateDoc(legacyRef, {
        sessions: [closedFirstLegacySession],
        checkOut: closedFirstLegacySession.checkOut,
        lastUpdated: serverTimestamp()
    }));

    const secondLegacySession = {
        id: 1788184800000,
        start: '2026-08-27T05:00:00.000Z',
        checkIn: '2026-08-27T05:00:00.000Z',
        checkOut: null
    };
    await assertSucceeds(updateDoc(legacyRef, {
        sessions: [closedFirstLegacySession, secondLegacySession],
        checkIn: secondLegacySession.checkIn,
        checkOut: null,
        lastUpdated: serverTimestamp()
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

test('OT, bonus and makeup requests are own/pending-only until manager review', async () => {
    const pending = { staffId: 'staff-1', dateKey: '2026-08-31', sessionId: 'session-1', status: 'pending' };
    await assertSucceeds(setDoc(doc(staffDb, 'overtime_requests', 'ot-own'), pending));
    await assertFails(setDoc(doc(staffDb, 'overtime_requests', 'ot-approved'), { ...pending, status: 'approved' }));
    await assertFails(setDoc(doc(staffDb, 'bonus10_requests', 'bonus-cross'), { ...pending, staffId: 'staff-2' }));
    await assertSucceeds(setDoc(doc(staffDb, 'bonus10_requests', 'bonus-own'), pending));
    await assertSucceeds(setDoc(doc(staffDb, 'makeup_requests', 'makeup-own'), {
        ...pending, session: { checkIn: '2026-08-31T01:00:00.000Z', checkOut: '2026-08-31T02:00:00.000Z' }
    }));
    await assertFails(updateDoc(doc(staffDb, 'overtime_requests', 'ot-own'), { status: 'approved' }));
    await assertSucceeds(updateDoc(doc(adminDb, 'overtime_requests', 'ot-own'), { status: 'approved' }));
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
