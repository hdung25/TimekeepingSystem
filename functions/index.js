'use strict';
// Web push (FCM) for the timekeeping PWA.
//  - pushStaffNotification: every new admin_notifications doc (make-up decision,
//    payslip sent, announcement…) is pushed to that staff member's devices.
//  - shiftCheckInReminders: every 5 minutes in working hours, remind staff who have
//    push enabled about the first shift of each chain that has not been checked in.
// Only reads schedules/attendance and writes push_tokens cleanup + push_reminders
// dedupe markers. Never writes attendance, payroll or schedules.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const TeacherShiftState = require('./shared/teacher-shift-state.js');
const R = require('./reminders.js');

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

async function pushToStaff(staffId, { title, body, link, tag }) {
    const tokens = await tokensFor(staffId);
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
            return next;
        });
    });
    return projected;
}

// Chạy mỗi 2 phút để mốc "trước 8 phút" không bị trễ thành 3-4 phút như nhịp 5 phút.
exports.shiftCheckInReminders = onSchedule({ schedule: '*/2 6-21 * * *', timeZone: 'Asia/Ho_Chi_Minh', retryCount: 0 }, async () => {
    const tokenSnapshot = await db.collection('push_tokens').get();
    const staffWithPush = new Set(tokenSnapshot.docs.filter(doc => doc.data().enabled !== false).map(doc => String(doc.data().staffId)));
    if (!staffWithPush.size) return;
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
    const due = R.dueReminders({ dateKey, nowMinutes, byStaff, staffFilter: staffWithPush });
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
        const result = await pushToStaff(reminder.staffId, reminder);
        sent += result.sent || 0;
    }
    logger.info('shiftCheckInReminders', { dateKey, nowMinutes, candidates: due.length, sent });
});

