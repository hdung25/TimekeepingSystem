'use strict';
// Runs the real scheduled handler (functions/index.js) against the Firestore emulator.
// Run from test-automation: npx firebase emulators:exec --only firestore --project demo-timekeeping
//   --config ../firebase.json "node ../functions/test/auto-checkout-emulator.cjs"
const assert = require('node:assert/strict');
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'emulator only');
process.env.GCLOUD_PROJECT = 'demo-timekeeping';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-timekeeping' });
const fns = require('../index.js');
const { getFirestore } = require('firebase-admin/firestore');
const AC = require('../auto-checkout.js');

const db = getFirestore();
const now = new Date();
const today = AC.vietnamDateKey(now);
const vnNow = new Date(now.getTime() + 7 * 3600000);
const nowMin = vnNow.getUTCHours() * 60 + vnNow.getUTCMinutes();
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const at = m => AC.vietnamDate(today, hm(m));
const { mondayKey, dayKey } = AC.mondayOf(today);

(async () => {
    assert.ok(nowMin > 300 && nowMin < 23 * 60, 'run between 05:00 and 23:00 Vietnam time');
    const base = Math.floor(nowMin / 5) * 5;
    const R0 = base - 240, C0 = base - 60, C1 = base - 10;     // Huy: tiếp tân → lớp, đã hết 10 phút
    const V0 = base - 120, V1 = base - 60;                      // Vân: lớp đã hết 1 tiếng
    const L0 = base - 30, L1 = base + 60;                        // Long: lớp đang diễn ra
    const row = (shiftId, s, e, id) => ({ shiftId, start: hm(s), end: hm(e), lop: 'X', gvList: [{ id, name: id }], gvId: id });
    await db.collection('settings').doc('system').set({ centerClosures: {} });
    await db.collection('schedules').doc(`cs1__${today}`).set({ evening1: [row('c-huy', C0, C1, 'huy'), row('c-van', V0, V1, 'van'), row('c-long', L0, L1, 'long')] });
    await db.collection('receptionist_schedules').doc(`cs1__${mondayKey}`).set({ afternoon: { [dayKey]: [{ id: 'huy', customStart: hm(R0), customEnd: hm(C0) }] } });
    const open = (id, m) => ({ id, anchorDateKey: today, status: 'open', source: 'self', start: at(m).toISOString(), checkIn: at(m).toISOString(), checkOut: null });
    const put = (staff, sessions) => db.collection('attendance_logs').doc(`${today}_${staff}`).set({ userId: staff, name: staff, date: today, sessions, checkIn: sessions[sessions.length - 1].checkIn, checkOut: null });
    await put('huy', [open('s-huy', R0 + 4)]);
    await put('van', [{ ...open('s-old', V0 - 200), checkOut: at(V0 - 150).toISOString(), status: 'closed' }, open('s-van', V0 - 5)]);
    await put('long', [open('s-long', L0 - 3)]);
    await put('nosched', [open('s-x', base - 100)]);

    await fns.autoCheckoutOpenSessions.run({ scheduleTime: now.toISOString() });

    const get = async staff => (await db.collection('attendance_logs').doc(`${today}_${staff}`).get()).data();
    const huy = await get('huy');
    assert.equal(huy.sessions[0].checkOut, at(C1).toISOString(), 'Huy ra ca đúng giờ hết lớp nối từ tiếp tân');
    assert.equal(huy.sessions[0].autoClosedReason, 'scheduled_end');
    assert.equal(huy.checkOut, at(C1).toISOString());
    const van = await get('van');
    assert.equal(van.sessions[0].checkOut, at(V0 - 150).toISOString(), 'phiên cũ giữ nguyên');
    assert.equal(van.sessions[1].checkOut, at(V1).toISOString(), 'Vân ra ca đúng giờ hết lớp');
    assert.equal((await get('long')).sessions[0].checkOut, null, 'lớp đang dạy thì chưa ra ca');
    assert.equal((await get('nosched')).sessions[0].checkOut, null, 'không có lịch thì không tự ra ca');

    // Chạy lại: không ghi gì thêm (idempotent).
    await fns.autoCheckoutOpenSessions.run({ scheduleTime: now.toISOString() });
    assert.equal((await get('huy')).sessions[0].checkOut, at(C1).toISOString());
    console.log('auto-checkout-emulator.cjs: all assertions passed');
    process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
