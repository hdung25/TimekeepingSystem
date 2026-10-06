'use strict';
// Web push (FCM) for the timekeeping PWA.
//  - pushStaffNotification: every new admin_notifications doc (make-up decision,
//    payslip sent, announcement…) is pushed to that staff member's devices.
//  - shiftCheckInReminders: every 2 minutes in working hours, remind staff who have
//    push enabled about the first shift of each chain that has not been checked in.
//  - autoCheckoutOpenSessions: every 5 minutes, close sessions whose scheduled work chain
//    ended (same rule as the app's auto check-out) even when nobody opens the app.
// Push functions only read schedules/attendance and write push_tokens cleanup + push_reminders
// markers. autoCheckoutOpenSessions is the ONLY writer of attendance here: it sets checkOut on
// an open self check-in exactly like the app does (autoClosedReason 'scheduled_end').
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const TeacherShiftState = require('./shared/teacher-shift-state.js');
const R = require('./reminders.js');
const AC = require('./auto-checkout.js');

initializeApp();
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 3, memory: '256MiB' });
const db = getFirestore();

const STALE_TOKEN_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);
const ACTION_TITLES = {
    makeup_approved: 'Chấm bù đã được duyệt', makeup_rejected: 'Chấm bù bị từ chối', makeup_covered: 'Ca đã có công',
    payslip_published: 'Đã có bảng lương', overtime_approved: 'Tăng ca được duyệt', overtime_rejected: 'Tăng ca không được duyệt',
    bonus10_approved: '+10 phút được duyệt', revoke_makeup_approval: 'Chấm bù đã bị huỷ duyệt',
    add_session: 'Quản lý đã thêm ca làm', edit_session: 'Quản lý đã sửa giờ làm', delete_session: 'Quản lý đã xoá ca',
    select_role: 'Quản lý đã chọn vai trò ca', announcement: 'Thông báo'
};
const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

async function tokensFor(staffId) {
    const snapshot = await db.collection('push_tokens').where('staffId', '==', String(staffId)).get();
    return snapshot.docs.filter(doc => doc.data().enabled !== false && doc.data().token).map(doc => ({ ref: doc.ref, token: doc.data().token }));
}

// Enabled tokens for several staff in one pass ('in' accepts at most 30 values per query).
async function tokensForMany(staffIds) {
    const ids = [...new Set(staffIds.map(String))];
    const byStaff = new Map();
    for (let i = 0; i < ids.length; i += 30) {
        const snapshot = await db.collection('push_tokens').where('staffId', 'in', ids.slice(i, i + 30)).get();
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.enabled === false || !data.token) return;
            const key = String(data.staffId);
            if (!byStaff.has(key)) byStaff.set(key, []);
            byStaff.get(key).push({ ref: doc.ref, token: data.token });
        });
    }
    return byStaff;
}

async function pushToStaff(staffId, { title, body, link, tag }, knownTokens) {
    const tokens = knownTokens || await tokensFor(staffId);
    if (!tokens.length) return { sent: 0, devices: 0 };
    const response = await getMessaging().sendEachForMulticast({
        tokens: tokens.map(item => item.token),
        // Data-only: the app's service worker renders it (same look + tap target on every browser).
        data: { title: String(title).slice(0, 120), body: String(body).slice(0, 400), link: String(link || ''), tag: String(tag || '') },
        webpush: { headers: { Urgency: 'high', TTL: '86400' } }
    });
    const stale = [];
    response.responses.forEach((result, index) => {
        if (!result.success && STALE_TOKEN_CODES.has(result.error?.code)) stale.push(tokens[index].ref.delete());
    });
    await Promise.all(stale);
    return { sent: response.successCount, devices: tokens.length, removed: stale.length };
}

exports.pushStaffNotification = onDocumentCreated('admin_notifications/{notificationId}', async event => {
    const data = event.data?.data();
    if (!data?.staffId || data.read === true) return;
    const link = /^[a-z0-9-]+\.html$/i.test(String(data.link || '')) ? data.link : 'nhan-vien.html';
    const result = await pushToStaff(data.staffId, {
        title: data.title || ACTION_TITLES[data.action] || 'Thông báo mới',
        body: plain(data.details) || 'Bạn có thông báo mới trong ứng dụng chấm công.',
        link, tag: `staff_notif_${event.params.notificationId}`
    });
    logger.info('pushStaffNotification', { staffId: data.staffId, action: data.action, ...result });
});

async function resolveDaySchedule(branch, dateKey) {
    const docId = `${branch}__${dateKey}`;
    const own = await db.collection('schedules').doc(docId).get();
    if (own.exists && Object.keys(own.data() || {}).length) return own.data();
    let manifest = await db.collection('settings').doc(`schedule_manifest_${branch}`).get();
    if (!manifest.exists && branch === 'cs1') manifest = await db.collection('settings').doc('schedule_manifest').get();
    if (!manifest.exists) return {};
    const [y, m, d] = dateKey.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const available = (manifest.data()[String(weekday)] || []).filter(id => id < docId).sort();
    if (!available.length) return {};
    const neighbor = await db.collection('schedules').doc(available[available.length - 1]).get();
    if (!neighbor.exists) return {};
    // Same projection as getSchedule(): daily closures, substitutes and absences do not carry over.
    const projected = {};
    Object.entries(neighbor.data() || {}).forEach(([key, rows]) => {
        if (!Array.isArray(rows)) return;
        projected[key] = rows.map(row => {
            const next = { ...TeacherShiftState.projectInheritedRoster(row, dateKey), registeredTeachers: [] };
            delete next.isClosed;
            next.gvThayTeList = []; next.gvThayTheList = []; next.gvThayTeId = ''; next.gvThayTheId = '';
            next.teacherAbsences = [];
            delete next.substituteAbsences;
            return next;
        });
    });
    return projected;
}

// Chạy mỗi 2 phút để mốc "trước 8 phút" không bị trễ thành 3-4 phút như nhịp 5 phút.
// Chi phí: trước đây mỗi lượt đọc CẢ bộ push_tokens (≈30 tài liệu × 450 lượt/ngày ≈ 13k lượt đọc,
// tăng theo số người bật thông báo). Nay chỉ đọc token của những người thật sự sắp vào ca.
exports.shiftCheckInReminders = onSchedule({ schedule: '*/2 6-21 * * *', timeZone: 'Asia/Ho_Chi_Minh', retryCount: 0 }, async () => {
    const { dateKey, nowMinutes } = R.vietnamClock();
    const branches = ['cs1', 'cs2', 'cs3'];
    const { mondayKey } = R.mondayOf(dateKey);
    const [settingsDoc, daySchedules, weeks] = await Promise.all([
        db.collection('settings').doc('system').get(),
        Promise.all(branches.map(branch => resolveDaySchedule(branch, dateKey).then(day => [branch, day]))),
        Promise.all(branches.flatMap(branch => [
            db.collection('receptionist_schedules').doc(`${branch}__${mondayKey}`).get().then(doc => ({ branch, type: 'receptionist', week: doc.exists ? doc.data() : null })),
            db.collection('office_schedules').doc(`${branch}__${mondayKey}`).get().then(doc => ({ branch, type: 'office', week: doc.exists ? doc.data() : null }))
        ]))
    ]);
    const settings = settingsDoc.exists ? settingsDoc.data() : {};
    const operational = weeks.map(item => ({
        ...item,
        config: item.type === 'office'
            ? (settings[`officeShifts_${item.branch}`] || settings.officeShifts)
            : (settings[`receptionistShifts_${item.branch}`] || settings.receptionistShifts)
    }));
    const byStaff = R.collectShifts({ dateKey, schedules: Object.fromEntries(daySchedules), operational,
        closures: settings.centerClosures || {}, shiftState: TeacherShiftState });
    const candidates = R.dueReminders({ dateKey, nowMinutes, byStaff });
    if (!candidates.length) return;
    const tokensByStaff = await tokensForMany(candidates.map(reminder => reminder.staffId));
    const due = candidates.filter(reminder => tokensByStaff.has(String(reminder.staffId)));
    let sent = 0;
    for (const reminder of due) {
        const marker = db.collection('push_reminders').doc(`${reminder.tag}_${reminder.staffId}`.replace(/[^A-Za-z0-9_:-]/g, '_'));
        const attendance = await db.collection('attendance_logs').doc(`${dateKey}_${reminder.staffId}`).get();
        if (R.alreadyCheckedIn(attendance.exists ? attendance.data().sessions : [], dateKey, reminder.shift.start)) continue;
        try {
            await marker.create({ staffId: reminder.staffId, tag: reminder.tag, dateKey, createdAt: FieldValue.serverTimestamp() });
        } catch (error) {
            continue; // already reminded (ALREADY_EXISTS)
        }
        const result = await pushToStaff(reminder.staffId, reminder, tokensByStaff.get(String(reminder.staffId)));
        sent += result.sent || 0;
    }
    logger.info('shiftCheckInReminders', { dateKey, nowMinutes, candidates: due.length, sent });
});


// ================= TỰ RA CA TRÊN MÁY CHỦ =================
// App chỉ tự ra ca khi nhân viên mở máy. Hàm này chạy 5 phút/lần, tìm các phiên còn mở và
// ra ca đúng mốc tan của mạch làm việc theo lịch (auto-checkout.js là bản sao luật của app).
async function loadDayContext(dateKey, cache) {
    if (cache.has(dateKey)) return cache.get(dateKey);
    const promise = (async () => {
        const branches = ['cs1', 'cs2', 'cs3'];
        const { mondayKey } = AC.mondayOf(dateKey);
        const [settingsDoc, daySchedules, weeks] = await Promise.all([
            db.collection('settings').doc('system').get(),
            Promise.all(branches.map(branch => resolveDaySchedule(branch, dateKey).then(day => [branch, day]))),
            Promise.all(branches.flatMap(branch => [
                db.collection('receptionist_schedules').doc(`${branch}__${mondayKey}`).get().then(doc => ({ branch, type: 'receptionist', week: doc.exists ? doc.data() : null })),
                db.collection('office_schedules').doc(`${branch}__${mondayKey}`).get().then(doc => ({ branch, type: 'office', week: doc.exists ? doc.data() : null }))
            ]))
        ]);
        const settings = settingsDoc.exists ? settingsDoc.data() : {};
        const operational = weeks.map(item => ({
            ...item,
            config: item.type === 'office'
                ? (settings[`officeShifts_${item.branch}`] || settings.officeShifts)
                : (settings[`receptionistShifts_${item.branch}`] || settings.receptionistShifts)
        }));
        return { schedules: Object.fromEntries(daySchedules), operational, closures: settings.centerClosures || {} };
    })();
    cache.set(dateKey, promise);
    return promise;
}

exports.autoCheckoutOpenSessions = onSchedule({ schedule: '*/5 * * * *', timeZone: 'Asia/Ho_Chi_Minh', retryCount: 0 }, async () => {
    const now = new Date();
    const today = AC.vietnamDateKey(now);
    const yesterday = AC.previousDateKey(today);
    // Vào ca luôn ghi checkOut = null ở cấp tài liệu; ra ca ghi lại giờ. Chỉ đọc tài liệu đang mở.
    // Hai truy vấn chỉ có điều kiện "==" → Firestore tự ghép index một trường, không cần index riêng.
    const snapshots = await Promise.all([today, yesterday].map(dateKey => db.collection('attendance_logs')
        .where('date', '==', dateKey).where('checkOut', '==', null).get()));
    const openDocs = { docs: snapshots.flatMap(snapshot => snapshot.docs) };
    openDocs.size = openDocs.docs.length;
    if (!openDocs.size) return;
    const dayCache = new Map();
    const results = [];
    for (const doc of openDocs.docs) {
        const data = doc.data();
        const staffId = String(data.userId || '');
        const dateKey = String(data.date || '');
        if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || doc.id !== `${dateKey}_${staffId}`) continue;
        const open = AC.newestOpenSession(data);
        if (!open) continue;
        try {
            const context = await loadDayContext(dateKey, dayCache);
            const keys = ['cs1', 'cs2', 'cs3'].map(branch => `${branch}__${dateKey}`);
            const [cancelledDoc, registrationSnap] = await Promise.all([
                db.collection('cancelled_shifts').doc(`${dateKey.slice(0, 7)}_${staffId}`).get(),
                db.collection('schedule_registrations').where('userId', '==', staffId).get()
            ]);
            const registrations = registrationSnap.docs.map(item => item.data()).filter(item => keys.includes(String(item.scheduleKey || '')));
            const { schedules, uncertain } = AC.applyRegistrations(context.schedules, registrations, staffId);
            const blocks = AC.buildWorkBlocks({
                staffId, dateKey, schedules, operational: context.operational, closures: context.closures,
                cancelled: cancelledDoc.exists ? cancelledDoc.data().shifts || [] : [], shiftState: TeacherShiftState
            });
            const decision = AC.decide({ session: open.session, blocks, now, uncertain });
            if (!decision.close) {
                if (decision.reason !== 'not-yet') results.push({ staffId, dateKey, skipped: decision.reason });
                continue;
            }
            const closed = await db.runTransaction(async transaction => {
                const fresh = await transaction.get(doc.ref);
                if (!fresh.exists) return false;
                const latest = fresh.data();
                const current = AC.newestOpenSession(latest);
                // Ai đó vừa ra ca / vào ca mới / quản lý sửa: không đụng vào.
                if (!current || current.index !== open.index || current.session.isAdminEdited ||
                    String(current.session.id || '') !== String(open.session.id || '') ||
                    (current.session.checkIn || current.session.start) !== (open.session.checkIn || open.session.start)) return false;
                const next = AC.closedAttendance(latest, current.index, decision.end, dateKey);
                transaction.update(doc.ref, { ...next, lastUpdated: FieldValue.serverTimestamp() });
                return true;
            });
            results.push({ staffId, dateKey, closedAt: decision.end.toISOString(), written: closed });
        } catch (error) {
            logger.error('autoCheckoutOpenSessions', { staffId, dateKey, message: error.message });
        }
    }
    if (results.length) logger.info('autoCheckoutOpenSessions', { open: openDocs.size, results });
});
