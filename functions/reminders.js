'use strict';
// Pure check-in reminder logic (no Firebase calls) so it can be unit-tested.
// Mirrors the web app: a class/shift that continues a chain in the same branch
// (consecutive or overlapping) shares the first check-in, so only the first
// shift of each chain is reminded.

const SECTIONS = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
const OPERATIONAL_SHIFTS = ['morning', 'afternoon', 'evening'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULT_OPERATIONAL = {
    morning: { start: '07:00', end: '11:30' },
    afternoon: { start: '14:00', end: '18:00' },
    evening: { start: '17:30', end: '21:30' }
};
const SHIFT_LABEL = { morning: 'Ca Sáng', afternoon: 'Ca Chiều', evening: 'Ca Tối' };

const minutes = value => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
};

function collectIds(row, listFields, singleFields) {
    const ids = new Set();
    listFields.forEach(field => (Array.isArray(row?.[field]) ? row[field] : []).forEach(item => { if (item?.id) ids.add(String(item.id)); }));
    singleFields.forEach(field => { if (row?.[field]) ids.add(String(row[field])); });
    return ids;
}

// Same fields as isAssignedToClass() in js/db-service.js.
function assignedStaffIds(row) {
    const ids = new Set([
        ...collectIds(row, ['gvList'], ['gvId']),
        ...collectIds(row, ['gvThayTeList', 'gvThayTheList'], ['gvThayTeId', 'gvThayTheId'])
    ]);
    (Array.isArray(row?.registeredTeachers) ? row.registeredTeachers : []).forEach(item => { if (item?.id) ids.add(String(item.id)); });
    return ids;
}

function sectionClosed(closures, dateKey, section) {
    const keys = Array.isArray(closures?.[dateKey]) ? closures[dateKey] : [];
    const parent = section.replace(/[12]$/, '');
    return keys.some(key => key === 'all' || key === parent || key === section);
}

function mondayOf(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const weekday = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
    return { mondayKey: date.toISOString().slice(0, 10), dayKey: DAY_KEYS[weekday === 0 ? 6 : weekday - 1] };
}

// shiftState: TeacherShiftState (for isMainTeacherAbsent). Returns every shift per staff.
function collectShifts({ dateKey, schedules, operational, closures, shiftState }) {
    const byStaff = new Map();
    const add = (staffId, shift) => {
        if (!byStaff.has(staffId)) byStaff.set(staffId, []);
        byStaff.get(staffId).push(shift);
    };
    Object.entries(schedules || {}).forEach(([branch, day]) => SECTIONS.forEach(section => {
        if (sectionClosed(closures, dateKey, section)) return;
        (Array.isArray(day?.[section]) ? day[section] : []).forEach(row => {
            if (!row || row.isClosed === true || !Number.isFinite(minutes(row.start)) || !Number.isFinite(minutes(row.end))) return;
            assignedStaffIds(row).forEach(staffId => {
                if (shiftState?.isMainTeacherAbsent?.(row, staffId)) return;
                add(staffId, { kind: 'gv', branch, start: row.start, end: row.end, label: row.lop || 'Ca dạy' });
            });
        });
    }));
    const { dayKey } = mondayOf(dateKey);
    (operational || []).forEach(({ branch, type, week, config }) => {
        if (!week) return;
        OPERATIONAL_SHIFTS.forEach(shiftKey => {
            (Array.isArray(week?.[shiftKey]?.[dayKey]) ? week[shiftKey][dayKey] : []).forEach(entry => {
                if (!entry?.id) return;
                const start = entry.customStart || week._shiftConfig?.[shiftKey]?.start || config?.[shiftKey]?.start || DEFAULT_OPERATIONAL[shiftKey].start;
                const end = entry.customEnd || week._shiftConfig?.[shiftKey]?.end || config?.[shiftKey]?.end || DEFAULT_OPERATIONAL[shiftKey].end;
                add(String(entry.id), { kind: type, branch, shiftKey, start, end,
                    label: `${type === 'office' ? 'Văn Phòng' : 'Tiếp Tân'} · ${SHIFT_LABEL[shiftKey]}` });
            });
        });
    });
    return byStaff;
}

function chainLeaders(shifts) {
    const sorted = (shifts || []).slice().sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(a.end) - minutes(b.end));
    const endByBranch = new Map();
    const leaders = [];
    sorted.forEach(shift => {
        const chainEnd = endByBranch.get(shift.branch);
        if (chainEnd !== undefined && minutes(shift.start) <= chainEnd) {
            endByBranch.set(shift.branch, Math.max(chainEnd, minutes(shift.end)));
            return;
        }
        leaders.push(shift);
        endByBranch.set(shift.branch, minutes(shift.end));
    });
    return leaders;
}

// Tag matches the in-app reminder so a device that shows both keeps one entry.
function reminderTag(dateKey, shift) {
    return shift.kind === 'gv'
        ? `teaching_checkin_${dateKey}_${shift.branch}_${shift.start}`
        : `shift_checkin_${shift.kind === 'office' ? 'office' : 'receptionist'}_${dateKey}_${shift.branch}_${shift.shiftKey}`;
}

// nowMinutes: minutes since local midnight (Asia/Ho_Chi_Minh).
// Nhắc trước giờ vào ca 8 phút (quy định 23/09/2026); vẫn nhắc tới 10 phút sau giờ vào
// nếu người đó chưa chấm công.
function dueReminders({ dateKey, nowMinutes, byStaff, staffFilter, leadMinutes = 8, lateMinutes = 10 }) {
    const due = [];
    byStaff.forEach((shifts, staffId) => {
        if (staffFilter && !staffFilter.has(staffId)) return;
        chainLeaders(shifts).forEach(shift => {
            const diff = minutes(shift.start) - nowMinutes;
            if (diff > leadMinutes || diff < -lateMinutes) return;
            const tag = reminderTag(dateKey, shift);
            due.push({
                staffId, tag, shift,
                title: shift.kind === 'gv' ? `Nhắc vào ca dạy lúc ${shift.start}` : `Nhắc ca làm việc: ${SHIFT_LABEL[shift.shiftKey] || ''}`.trim(),
                body: `${shift.label} · ${String(shift.branch).toUpperCase()} (${shift.start}–${shift.end}). Vui lòng Chấm Công để Vào ca!`,
                link: 'cham-cong.html'
            });
        });
    });
    return due;
}

// A session that is open, or still running at the shift start, means already checked in.
function alreadyCheckedIn(sessions, dateKey, start) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const [h, min] = String(start).split(':').map(Number);
    const startMs = Date.UTC(y, m - 1, d, h - 7, min); // Asia/Ho_Chi_Minh = UTC+7, no DST
    return (Array.isArray(sessions) ? sessions : []).some(session => session && !session.isAbsent && session.checkIn &&
        (!session.checkOut || new Date(session.checkOut).getTime() > startMs));
}

function vietnamClock(date = new Date()) {
    const local = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    return { dateKey: local.toISOString().slice(0, 10), nowMinutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

module.exports = { SECTIONS, collectShifts, chainLeaders, dueReminders, alreadyCheckedIn, vietnamClock, mondayOf, reminderTag, assignedStaffIds };
