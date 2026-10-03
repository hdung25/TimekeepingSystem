'use strict';
// Server auto check-out must make exactly the same decision as the app (js/main.js).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AC = require('../auto-checkout.js');
const TeacherShiftState = require('../shared/teacher-shift-state.js');

const dateKey = '2026-10-03'; // Saturday
const vn = (h, m = 0) => AC.vietnamDate(dateKey, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
const row = (shiftId, start, end, gv, extra = {}) => ({ shiftId, start, end, lop: 'X', gvList: [{ id: gv, name: gv }], gvId: gv, ...extra });
const schedules = {
    cs1: {
        afternoon2: [row('nhay', '17:00', '18:00', 'van')],
        evening1: [row('ffl', '18:00', '19:30', 'huy'), row('closed', '18:00', '19:30', 'off', { isClosed: true }),
            row('vp', '18:00', '19:30', 'absent', { teacherAbsences: [{ teacherId: 'absent', type: 'VP' }] })],
        evening2: [row('late', '19:45', '21:00', 'gap')],
        afternoon1: [row('gap1', '14:00', '15:30', 'gap'), row('reg', '15:30', '17:00', 'someone')]
    }
};
const operational = [{ branch: 'cs1', type: 'receptionist', config: null,
    week: { afternoon: { sat: [{ id: 'huy', customStart: '13:30' }, { id: 'cancel' }] } } }];
const blocksFor = (staffId, extra = {}) => AC.buildWorkBlocks({ staffId, dateKey, schedules, operational, closures: {},
    cancelled: [], shiftState: TeacherShiftState, ...extra });
const session = (h, m, extra = {}) => ({ id: 's1', checkIn: vn(h, m).toISOString(), start: vn(h, m).toISOString(), checkOut: null, ...extra });

// Quang Huy: tiếp tân 13:30–18:00 + lớp 18:00–19:30 → một mạch tới 19:30.
let decision = AC.decide({ session: session(13, 34), blocks: blocksFor('huy'), now: vn(18, 36) });
assert.equal(decision.close, false);
assert.equal(decision.end.toISOString(), vn(19, 30).toISOString());
decision = AC.decide({ session: session(13, 34), blocks: blocksFor('huy'), now: vn(19, 34) });
assert.equal(decision.close, true, 'quá 19:30 + 3 phút chờ app → máy chủ tự ra ca');
assert.equal(decision.end.toISOString(), vn(19, 30).toISOString(), 'giờ ra = đúng giờ tan theo lịch, không tính dư');

// Phạm Thị Bích Vân: vào 16:55 lớp 17:00–18:00, quên Ra ca → đóng lúc 18:00.
decision = AC.decide({ session: session(16, 55), blocks: blocksFor('van'), now: vn(18, 36) });
assert.equal(decision.close, true);
assert.equal(decision.end.toISOString(), vn(18).toISOString());
decision = AC.decide({ session: session(16, 55), blocks: blocksFor('van'), now: vn(18, 2) });
assert.equal(decision.close, false, 'chờ vài phút cho app tự ra ca trước');

// Ca cách quãng (15:30 hết, 19:45 mới vào) không nối: đóng lúc 15:30.
decision = AC.decide({ session: session(13, 58), blocks: blocksFor('gap'), now: vn(16) });
assert.equal(decision.end.toISOString(), vn(15, 30).toISOString());

// Không có lịch / lớp tắt / GV báo vắng → không tự ra ca (giữ nguyên như app).
assert.equal(AC.decide({ session: session(18, 0), blocks: blocksFor('nobody'), now: vn(23) }).reason, 'no-schedule');
assert.equal(AC.decide({ session: session(18, 0), blocks: blocksFor('off'), now: vn(23) }).reason, 'no-schedule');
assert.equal(AC.decide({ session: session(18, 0), blocks: blocksFor('absent'), now: vn(23) }).reason, 'no-schedule');
// Quản lý chỉnh tay để mở → không đụng.
assert.equal(AC.decide({ session: session(16, 55, { isAdminEdited: true }), blocks: blocksFor('van'), now: vn(23) }).reason, 'admin-edited');
// Ca tiếp tân đã bị huỷ.
assert.equal(blocksFor('cancel', { cancelled: ['cs1_2026-09-28_afternoon_sat'] }).length, 0);
assert.equal(blocksFor('cancel').length, 1);
// Trung tâm nghỉ buổi tối → lớp tối không tính.
assert.equal(blocksFor('huy', { closures: { [dateKey]: ['evening'] } }).length, 1);

// "Nhận lớp" lưu riêng ở schedule_registrations phải được tính vào mạch.
const reg = AC.applyRegistrations(schedules, [{ userId: 'van', scheduleKey: `cs1__${dateKey}`, section: 'afternoon1', shiftId: 'reg', status: 'active' }], 'van');
assert.equal(reg.uncertain, false);
decision = AC.decide({ session: session(15, 28), blocks: blocksFor('van', { schedules: reg.schedules }), now: vn(18, 10) });
assert.equal(decision.end.toISOString(), vn(18).toISOString(), 'nhận lớp 15:30–17:00 nối lớp 17:00–18:00');
const unmapped = AC.applyRegistrations(schedules, [{ userId: 'van', scheduleKey: `cs1__${dateKey}`, section: 'afternoon1', shiftId: 'gone', status: 'active' }], 'van');
assert.equal(AC.decide({ session: session(16, 55), blocks: blocksFor('van'), now: vn(23), uncertain: unmapped.uncertain }).reason,
    'unmapped-registration', 'không chắc lịch → không dám tự ra ca');

// Ghi đúng các trường như app.
const closed = AC.closedAttendance({ sessions: [{ id: 'a', checkIn: 'x', checkOut: 'y' }, session(16, 55)] }, 1, vn(18), dateKey);
assert.deepEqual(closed.sessions[0], { id: 'a', checkIn: 'x', checkOut: 'y' });
assert.equal(closed.sessions[1].checkOut, vn(18).toISOString());
assert.equal(closed.sessions[1].status, 'closed');
assert.equal(closed.sessions[1].autoClosedReason, 'scheduled_end');
assert.equal(closed.sessions[1].anchorDateKey, dateKey);
assert.equal(closed.checkOut, vn(18).toISOString());
assert.equal(AC.newestOpenSession({ sessions: [session(7, 0), { ...session(9, 0), id: 's2' }, { ...session(10, 0), checkOut: 'z' }] }).session.id, 's2');
assert.equal(AC.vietnamDateKey(new Date('2026-10-03T17:30:00Z')), '2026-10-04');
assert.equal(AC.previousDateKey('2026-10-01'), '2026-09-30');

// resolveWorkChainEnd is a verbatim copy of the app's rule (same results on random cases).
const main = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const start = main.indexOf('const AUTO_CHECKOUT_GAP_MS');
const end = main.indexOf('\n// Trả về các khúc ca vận hành', start);
const ctx = vm.createContext({ Date, Math });
vm.runInContext(main.slice(start, end) + '\nthis.appResolve = resolveWorkChainEnd;', ctx);
const at = minutes => new Date(vn(0).getTime() + minutes * 60000);
let seed = 7;
let nonNull = 0;
const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
for (let i = 0; i < 2000; i++) {
    const blocks = Array.from({ length: 1 + rand(5) }, () => {
        const s = 7 * 60 + rand(14) * 15;
        return { start: at(s), end: at(s + 30 + rand(8) * 15) };
    });
    const checkIn = at(6 * 60 + rand(15 * 60));
    const app = ctx.appResolve(blocks, checkIn);
    const server = AC.resolveWorkChainEnd(blocks, checkIn);
    assert.equal(server ? server.getTime() : null, app ? app.getTime() : null);
    if (app) nonNull++;
}
assert.ok(nonNull > 300, 'random cases must exercise real chains');

console.log('functions auto-checkout.test.js: all assertions passed');
