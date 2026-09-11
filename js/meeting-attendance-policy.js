/* Shared monthly meeting truth for the meeting grid and teacher payroll. */
(function (global) {
    'use strict';

    const VERSION = 'meeting-payroll-20260911-v1';
    const PRESENT = new Set(['Có', 'Trễ']);
    const PERMITTED = new Set(['Vắng phép']);
    const UNPERMITTED = new Set(['Vắng không phép', 'Vắng đột xuất']);
    const NEUTRAL = new Set(['Không họp', 'Chưa điểm danh', 'Chưa ghi nhận', 'Chưa diễn ra', 'Không xác định']);

    function meetingTime(meeting, field, fallback) {
        const parts = String(meeting?.date || '').split('-').map(Number);
        if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return null;
        const time = String(meeting?.[field] || fallback).split(':').map(Number);
        if (time.length < 2 || time.some(value => !Number.isFinite(value))) return null;
        return new Date(parts[0], parts[1] - 1, parts[2], time[0], time[1], 0);
    }

    function isInvited(meeting, userId, department) {
        return meeting?.department === department &&
            (!Array.isArray(meeting.attendees) || meeting.attendees.length === 0 ||
                meeting.attendees.includes(userId));
    }

    function isValidAttendance(log, meeting) {
        if (!log?.status || log.status === 'Chưa điểm danh') return false;
        if (log.adminOverride === true || !log.checkInTime) return true;
        const openedAt = meetingTime(meeting, 'checkInStart', '00:00');
        const recordedAt = new Date(log.checkInTime);
        return !!openedAt && Number.isFinite(recordedAt.getTime()) && recordedAt >= openedAt;
    }

    function strongestStatus(statuses) {
        if (statuses.includes('Có')) return 'Có';
        if (statuses.includes('Trễ')) return 'Trễ';
        if (statuses.some(status => UNPERMITTED.has(status))) return 'Vắng không phép';
        if (statuses.some(status => PERMITTED.has(status))) return 'Vắng phép';
        return null;
    }

    function resolveDepartmentStatus({ meetings, attendanceByMeeting, userId, department, savedStatus, now = new Date() }) {
        if (!Array.isArray(meetings)) return 'Không xác định';
        const invited = meetings.filter(meeting => isInvited(meeting, userId, department));
        if (invited.length === 0) return 'Không họp';

        const recorded = [];
        let endedWithoutAttendance = false;
        invited.forEach(meeting => {
            const logs = attendanceByMeeting?.[meeting.id];
            if (!Array.isArray(logs)) return;
            const log = logs.find(item => item.userId === userId);
            if (isValidAttendance(log, meeting)) recorded.push(log.status);
            else {
                const endedAt = meetingTime(meeting, 'endTime', '23:59');
                if (endedAt && now > endedAt) endedWithoutAttendance = true;
            }
        });

        const actual = strongestStatus(recorded);
        if (actual) return actual;
        if (savedStatus && !NEUTRAL.has(savedStatus)) return savedStatus;
        return endedWithoutAttendance ? 'Vắng không phép' : 'Chưa điểm danh';
    }

    // Reward and penalty are each capped once per month. Thus one attended
    // department (+1k) and one permitted absence (-1k) cancel each other,
    // while three permitted absences still deduct only 1k.
    function calculateMonthly(statuses) {
        const values = Array.isArray(statuses) ? statuses : Object.values(statuses || {});
        const attended = values.some(status => PRESENT.has(status));
        const unpermitted = values.some(status => UNPERMITTED.has(status));
        const permitted = values.some(status => PERMITTED.has(status));
        const pending = values.some(status => status === 'Chưa điểm danh' || status === 'Không xác định');
        const reward = attended ? 1000 : 0;
        const penalty = unpermitted ? 2000 : permitted ? 1000 : 0;
        const amount = reward - penalty;
        return {
            version: VERSION,
            amount,
            complete: !pending,
            attended,
            absence: unpermitted ? 'unpermitted' : permitted ? 'permitted' : 'none',
            note: `Họp định kỳ tự động: có mặt ${attended ? '+1.000đ' : '0đ'}; ` +
                `${unpermitted ? 'vắng không phép -2.000đ' : permitted ? 'vắng có phép -1.000đ' : 'không có mức trừ'}; ` +
                `thành tiền ${amount.toLocaleString('vi-VN')}đ.`
        };
    }

    global.MeetingAttendancePolicy = {
        VERSION,
        isInvited,
        isValidAttendance,
        resolveDepartmentStatus,
        calculateMonthly
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = global.MeetingAttendancePolicy;
})(typeof window !== 'undefined' ? window : globalThis);
