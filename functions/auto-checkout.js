'use strict';
// Tự RA CA trên máy chủ (yêu cầu Giám đốc 03/10/2026): trước đây việc tự ra ca chỉ chạy
// trong app của nhân viên, nên ai quên bấm Ra ca và không mở app thì phiên cứ mở mãi.
// Logic dưới đây là BẢN SAO của js/main.js (runGlobalAutoCheckout + findTeachingBlocks +
// findReceptionistShiftBlocks + resolveWorkChainEnd): cùng mạch làm việc liền (chỉ nối ca
// SÁT NHAU), cùng mốc tan ca, cùng cách ghi phiên — chỉ khác là không cần mở máy.
// Không gọi Firebase ở đây để kiểm thử được bằng node.

const SECTIONS = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
const OPERATIONAL_SHIFTS = ['morning', 'afternoon', 'evening'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULT_OPERATIONAL = {
    morning: { start: '07:00', end: '11:30' },
    afternoon: { start: '14:00', end: '18:00' },
    evening: { start: '17:30', end: '21:30' }
};
const DAY_MS = 24 * 60 * 60 * 1000;
// Như AUTO_CHECKOUT_GAP_MS trong main.js: 0 = chỉ ca sát nhau mới chung một lần vào ca.
const AUTO_CHECKOUT_GAP_MS = 0;
// Chờ thêm vài phút sau mốc tan ca để app đang mở tự ra ca trước (tránh hai bên cùng ghi).
const SERVER_GRACE_MS = 3 * 60 * 1000;

// "HH:MM" của ngày dateKey theo giờ Việt Nam (UTC+7, không đổi giờ mùa hè).
function vietnamDate(dateKey, hm) {
    const [y, m, d] = String(dateKey).split('-').map(Number);
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
    if (!match || ![y, m, d].every(Number.isFinite)) return null;
    return new Date(Date.UTC(y, m - 1, d, Number(match[1]) - 7, Number(match[2])));
}

function mondayOf(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const weekday = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
    return { mondayKey: date.toISOString().slice(0, 10), dayKey: DAY_KEYS[weekday === 0 ? 6 : weekday - 1] };
}

function previousDateKey(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) - DAY_MS).toISOString().slice(0, 10);
}

// isAutoCheckoutShiftClosed() trong main.js.
function shiftClosed(closures, dateKey, shiftKey) {
    const keys = Array.isArray(closures?.[dateKey]) ? closures[dateKey] : [];
    if (keys.includes('all') || keys.includes(shiftKey)) return true;
    return ['morning', 'afternoon', 'evening'].some(parent => shiftKey.startsWith(parent) && keys.includes(parent));
}

function toBlock(dateKey, start, end, kind) {
    const startDate = vietnamDate(dateKey, start);
    let endDate = vietnamDate(dateKey, end);
    if (!startDate || !endDate) return null;
    if (endDate <= startDate) endDate = new Date(endDate.getTime() + DAY_MS);
    return { start: startDate, end: endDate, kind };
}

// Ghép các đăng ký "Nhận lớp" (collection schedule_registrations) vào đúng hàng lịch.
// Đăng ký không khớp được hàng nào → uncertain: không dám tự ra ca cho người đó.
function applyRegistrations(schedules, registrations, staffId) {
    let uncertain = false;
    const merged = {};
    Object.entries(schedules || {}).forEach(([branch, day]) => { merged[branch] = { ...(day || {}) }; });
    (registrations || []).forEach(registration => {
        if (String(registration?.userId || '') !== String(staffId)) return;
        const branch = String(registration.scheduleKey || '').split('__')[0];
        const rows = merged[branch]?.[registration.section];
        const index = Array.isArray(rows) && registration.shiftId
            ? rows.findIndex(row => String(row?.shiftId || '') === String(registration.shiftId))
            : -1;
        if (index < 0) {
            if (registration.status === 'active') uncertain = true;
            return;
        }
        const nextRows = rows.slice();
        const teachers = (nextRows[index].registeredTeachers || []).filter(item => String(item?.id) !== String(staffId));
        if (registration.status === 'active') teachers.push({ id: String(staffId), name: registration.userName || '' });
        nextRows[index] = { ...nextRows[index], registeredTeachers: teachers };
        merged[branch][registration.section] = nextRows;
    });
    return { schedules: merged, uncertain };
}

// findTeachingBlocks() + findReceptionistShiftBlocks() của main.js cho MỘT nhân viên.
function buildWorkBlocks({ staffId, dateKey, schedules, operational, closures, cancelled, shiftState }) {
    const id = String(staffId);
    const cancelledKeys = new Set(Array.isArray(cancelled) ? cancelled : []);
    const blocks = [];
    Object.entries(schedules || {}).forEach(([branch, day]) => {
        const compositeKey = `${branch}__${dateKey}`;
        SECTIONS.forEach(section => {
            (Array.isArray(day?.[section]) ? day[section] : []).forEach((row, classIndex) => {
                if (!row || row.isClosed === true || shiftClosed(closures, dateKey, section)) return;
                const isMain = shiftState.getMainTeachers(row).some(item => String(item.id) === id);
                const isSubstitute = shiftState.getSubstituteTeachers(row).some(item => String(item.id) === id);
                const isReportedAbsent = isMain && shiftState.isMainTeacherAbsent(row, id);
                const isSelfRegistered = (row.registeredTeachers || []).some(item => String(item?.id) === id);
                if (!(isSubstitute || (!isReportedAbsent && (isMain || isSelfRegistered)))) return;
                if (cancelledKeys.has(`${compositeKey}_${section}_${classIndex}`) ||
                    (row.shiftId && cancelledKeys.has(`shift:${row.shiftId}`))) return;
                const block = toBlock(dateKey, row.start, row.end, 'day');
                if (block) blocks.push(block);
            });
        });
    });
    const { mondayKey, dayKey } = mondayOf(dateKey);
    (operational || []).forEach(({ branch, type, week, config }) => {
        if (!week) return;
        OPERATIONAL_SHIFTS.forEach(shiftKey => {
            if (shiftClosed(closures, dateKey, shiftKey)) return;
            const roster = week?.[shiftKey]?.[dayKey];
            const entry = Array.isArray(roster) ? roster.find(item => String(item?.id) === id) : null;
            if (!entry) return;
            const cancelKey = `${type === 'office' ? 'office_' : ''}${branch}_${mondayKey}_${shiftKey}_${dayKey}`;
            if (cancelledKeys.has(cancelKey)) return;
            const start = entry.customStart || week._shiftConfig?.[shiftKey]?.start || config?.[shiftKey]?.start || DEFAULT_OPERATIONAL[shiftKey].start;
            const end = entry.customEnd || week._shiftConfig?.[shiftKey]?.end || config?.[shiftKey]?.end || DEFAULT_OPERATIONAL[shiftKey].end;
            const block = toBlock(dateKey, start, end, type === 'office' ? 'van-phong' : 'tiep-tan');
            if (block) blocks.push(block);
        });
    });
    return blocks;
}

// resolveWorkChainEnd() của main.js.
function resolveWorkChainEnd(blocks, checkInTime) {
    const list = (blocks || []).filter(b => b && b.start && b.end && b.end > b.start);
    if (!list.length) return null;
    const checkInMs = checkInTime instanceof Date ? checkInTime.getTime() : NaN;
    if (!Number.isFinite(checkInMs)) return null;
    const matched = list.filter(b => checkInMs >= b.start.getTime() - 60 * 60 * 1000 && checkInMs < b.end.getTime());
    if (!matched.length) return null;
    let end = new Date(Math.max(...matched.map(b => b.end.getTime())));
    let extended = true;
    while (extended) {
        extended = false;
        list.forEach(b => {
            if (b.end <= end) return;
            if (b.start - end > AUTO_CHECKOUT_GAP_MS) return;
            end = b.end;
            extended = true;
        });
    }
    return end.getTime() > checkInMs ? end : null;
}

// Phiên MỞ mới nhất của một tài liệu chấm công (giống runGlobalAutoCheckout).
function newestOpenSession(attendance) {
    const sessions = Array.isArray(attendance?.sessions) ? attendance.sessions : [];
    return sessions
        .map((session, index) => ({ session, index, at: new Date(session?.checkIn || session?.start || '').getTime() }))
        .filter(item => item.session && !item.session.checkOut && !item.session.isAbsent && Number.isFinite(item.at))
        .sort((a, b) => b.at - a.at)[0] || null;
}

// Quyết định cho một phiên đang mở. Trả { close: true, end } khi đã quá mốc tan ca.
function decide({ session, blocks, now, uncertain }) {
    if (!session || session.checkOut || session.isAbsent) return { close: false, reason: 'not-open' };
    // Quản lý cố ý để mở một phiên đã chỉnh tay — giữ nguyên như app.
    if (session.isAdminEdited) return { close: false, reason: 'admin-edited' };
    if (uncertain) return { close: false, reason: 'unmapped-registration' };
    const checkIn = new Date(session.checkIn || session.start || '');
    const end = resolveWorkChainEnd(blocks, checkIn);
    if (!end) return { close: false, reason: 'no-schedule' };
    if (now.getTime() < end.getTime() + SERVER_GRACE_MS) return { close: false, reason: 'not-yet', end };
    return { close: true, end };
}

// Bản ghi sau khi ra ca — đúng các trường checkOutPersonal() của app ghi.
function closedAttendance(attendance, index, end, anchorDateKey) {
    const sessions = attendance.sessions.map(item => ({ ...item }));
    sessions[index] = {
        ...sessions[index],
        checkOut: end.toISOString(),
        status: 'closed',
        anchorDateKey: sessions[index].anchorDateKey || anchorDateKey,
        autoClosedReason: 'scheduled_end'
    };
    return { sessions, checkOut: end.toISOString() };
}

function vietnamDateKey(date = new Date()) {
    return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

module.exports = {
    SERVER_GRACE_MS, vietnamDate, vietnamDateKey, previousDateKey, mondayOf, applyRegistrations,
    buildWorkBlocks, resolveWorkChainEnd, newestOpenSession, decide, closedAttendance
};
