'use strict';
// Owner report 2026-10-03:
//  1) Chip "Đã vào ca" (xanh dương) vẫn hiện sau khi lớp 17:00–18:00 đã hết giờ (chưa bấm Ra ca).
//  2) Quang Huy trực tiếp tân 13:30–18:00 rồi dạy FFL 18:00 — một lần vào ca phủ cả hai, nhưng
//     lịch báo "Chưa xác minh chấm công" cho lớp 18:00.
//  3) Ô phòng có sẵn chữ P, chỉ gõ số.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ScheduleAttendanceAdmin = require('../js/schedule-attendance-admin.js');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8').replace(/\r\n/g, '\n');
const slice = (source, from, to) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + 1);
    assert.ok(start >= 0 && end > start, `missing ${from}`);
    return source.slice(start, end);
};
const schedule = read('schedule.js');
const main = read('main.js');
const context = vm.createContext({ Date, Number, String, Map, Array, Math, Object, console, ScheduleAttendanceAdmin, window: { ScheduleAttendanceAdmin } });
vm.runInContext([
    'let scheduleWorkChainsByUser = new Map();',
    slice(main, 'const AUTO_CHECKOUT_GAP_MS', '\n// Trả về các khúc ca vận hành'),
    slice(schedule, 'function scheduleShiftDateTime', '\nfunction scheduleEscapeHTML'),
    slice(schedule, 'function formatScheduleClock', '\n// Render compact multi-teacher cell'),
    slice(schedule, 'function splitScheduleRoom', '\nfunction renderRoomCell'),
    'this.setChains = c => { scheduleWorkChainsByUser = c; };'
].join('\n'), context);

const DATE = '2026-10-03';
const at = (h, m = 0) => new Date(2026, 9, 3, h, m);
const iso = (h, m = 0) => at(h, m).toISOString();

(async () => {
    // --- Quang Huy: tiếp tân 13:30–18:00 (vào ca 13:34, chưa ra) rồi lớp FFL 18:00–19:30 ---
    const huySession = { id: 's-huy', checkIn: iso(13, 34), start: iso(13, 34), checkOut: null };
    const evidence = new Map([
        ['huy', [huySession]],
        ['van', [{ id: 's-van', checkIn: iso(16, 55), start: iso(16, 55), checkOut: null }]],
        ['gap', [{ id: 's-gap', checkIn: iso(15, 25), start: iso(15, 25), checkOut: null }]]
    ]);
    const before = context.resolveAttendanceEvidenceForShift(evidence, 'huy', DATE, '18:00', '19:30');
    assert.equal(before.status, 'none', 'nguyên nhân lỗi: phiên vào từ 13:34 không được nhận cho lớp 18:00');

    // Blocks giống findReceptionistShiftBlocks / findTeachingBlocks.
    const blocksFor = {
        huy: { operational: [{ start: at(13, 30), end: at(18), kind: 'tiep-tan' }], classes: [{ start: at(18), end: at(19, 30) }] },
        van: { operational: [], classes: [{ start: at(17), end: at(18) }] },
        gap: { operational: [], classes: [{ start: at(15, 30), end: at(17) }, { start: at(18), end: at(19, 30) }] }
    };
    context.findReceptionistShiftBlocks = async userId => blocksFor[userId].operational;
    context.findTeachingBlocks = async userId => blocksFor[userId].classes;
    vm.runInContext(slice(schedule, 'async function loadScheduleOpenWorkChains', '\n// Lớp nằm trong mạch làm việc'), context);
    const chains = await context.loadScheduleOpenWorkChains(evidence, DATE, {}, {});
    context.setChains(chains);
    assert.equal(chains.get('huy').end.getTime(), at(19, 30).getTime(), 'mạch tiếp tân → dạy kéo tới 19:30');
    assert.equal(chains.get('huy').hasOperational, true);

    const huy = context.resolveScheduleChainedSession('huy', DATE, '18:00', '19:30');
    assert.equal(huy?.status, 'matched');
    assert.equal(huy.session, huySession);
    let label = context.describeOpenScheduleSession(huy, 'huy', DATE, { start: '18:00', end: '19:30' }, at(18, 36));
    assert.equal(label.label, 'Đã vào ca (nối ca tiếp tân)');
    assert.equal(label.chipClass, 'is-attendance-open');
    label = context.describeOpenScheduleSession(huy, 'huy', DATE, { start: '18:00', end: '19:30' }, at(19, 45));
    assert.equal(label.label, 'Chưa bấm ra ca');
    assert.match(label.hint, /19:30/);

    // Lớp cách quãng (15 phút trở lên) KHÔNG được nối: ca 15:30–17:00 rồi 18:00 phải vào ca lại.
    assert.equal(context.resolveScheduleChainedSession('gap', DATE, '18:00', '19:30'), null);
    // Lớp đã kết thúc trước giờ vào ca thì không nhận.
    assert.equal(context.resolveScheduleChainedSession('huy', DATE, '11:00', '12:30'), null);

    // --- Phạm Thị Bích Vân: vào 16:55 cho lớp Nhảy 17:00–18:00, chưa bấm Ra ca, giờ là 18:36 ---
    const vanMatch = context.resolveAttendanceEvidenceForShift(evidence, 'van', DATE, '17:00', '18:00');
    assert.equal(vanMatch.status, 'matched');
    label = context.describeOpenScheduleSession(vanMatch, 'van', DATE, { start: '17:00', end: '18:00' }, at(17, 30));
    assert.equal(label.label, 'Đã vào ca');
    label = context.describeOpenScheduleSession(vanMatch, 'van', DATE, { start: '17:00', end: '18:00' }, at(18, 36));
    assert.equal(label.label, 'Chưa bấm ra ca', 'hết giờ lớp thì không còn hiện như đang trong ca');
    assert.equal(label.chipClass, 'is-attendance-overdue');
    assert.match(label.hint, /18:00/);

    // Huy xong lớp tiếp tân? Lớp 13:30 tiếp tân không nằm ở lịch lớp; nhưng nếu dạy 18:00–19:30
    // rồi còn ca kế liền sau thì lớp trước hiện "Xong lớp · đang làm ca kế".
    const chainLong = new Map([['huy', { session: huySession, checkIn: at(13, 34), end: at(21), hasOperational: true }]]);
    label = context.describeOpenScheduleSession(huy, 'huy', DATE, { start: '18:00', end: '19:30' }, at(19, 45), chainLong);
    assert.equal(label.label, 'Xong lớp · đang làm ca kế');

    // --- Ô phòng ---
    const norm = context.normalizeScheduleRoomInput;
    assert.equal(norm('11'), 'P11');
    assert.equal(norm('01'), 'P01');
    assert.equal(norm('P101'), 'P101');
    assert.equal(norm('p 12'), 'P12');
    assert.equal(norm('Phòng 3'), 'P3');
    assert.equal(norm('2a'), 'P2A');
    assert.equal(norm('  '), '');
    assert.equal(norm('Online'), 'Online');
    assert.deepEqual({ ...context.splitScheduleRoom('p01') }, { numbered: true, number: '01' });
    assert.deepEqual({ ...context.splitScheduleRoom('P 11') }, { numbered: true, number: '11' });
    assert.deepEqual({ ...context.splitScheduleRoom('Online') }, { numbered: false, number: 'Online' });

    console.log('schedule-work-chain.test.js: all assertions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
