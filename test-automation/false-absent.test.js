// KHÔNG ĐƯỢC ĐÁNH VẮNG NGƯỜI ĐANG ĐI LÀM.
// Ca có GV thay thế KHÔNG đồng nghĩa GV chính nghỉ: kiểu hay gặp là ĐỔI LỚP — lớp của
// thầy A do người khác dạy vì cùng khung giờ đó thầy A được mượn sang dạy lớp khác.
// Ca thật (04/08/2026): thầy Quân làm 10h32p mà vẫn bị ghi "Vắng đột xuất".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'schedule.js'), 'utf8')
    .replace(/\r\n/g, '\n');

function cut(startMarker, endMarker) {
    const a = source.indexOf(startMarker);
    assert.notEqual(a, -1, `không tìm thấy ${startMarker} trong js/schedule.js`);
    const b = source.indexOf(endMarker, a);
    assert.notEqual(b, -1, `không đọc hết được ${startMarker}`);
    return source.slice(a, b + endMarker.length);
}

const src = [
    cut('function _hmToMinutes(', '\n}'),
    cut('function _windowsOverlap(', '\n}'),
    cut('function isTeacherCoveringElsewhere(', '\n}'),
    cut('async function teacherWorkedDuring(', '\n}')
].join('\n');

const attendanceStore = {};
const context = {
    console, Date, Math, Number, isNaN,
    // getGVList lấy danh sách GV của một ô lịch (định nghĩa nơi khác trong schedule.js)
    getGVList: (row, kind) => (row[kind === 'gv' ? 'gvList' : 'gvThayTeList'] || []),
    DBService: {
        getPersonalAttendance: async (dateKey, userId) => attendanceStore[dateKey + '_' + userId] || null
    }
};
vm.createContext(context);
vm.runInContext(src, context);

const QUAN = 'gv-quan', NHAN = 'gv-nhan';
const DAY = '2026-08-04';

// Lịch thật của thầy Quân ngày 04/08
const dayData = {
    morning1: [{ start: '07:30', end: '09:00', lop: 'E3', gvList: [{ id: QUAN }], gvThayTeList: [] }],
    evening1: [{ start: '18:00', end: '19:30', lop: 'Mover 4', gvList: [{ id: QUAN }], gvThayTeList: [] }],
    evening2: [
        // Lớp E4 của Quân được người khác dạy...
        { start: '19:30', end: '21:00', lop: 'E4', gvList: [{ id: QUAN }], gvThayTeList: [{ id: 'gv-my' }] },
        // ...vì đúng giờ đó Quân được mượn sang dạy thay lớp B1
        { start: '19:30', end: '21:00', lop: 'B1', gvList: [{ id: NHAN }], gvThayTeList: [{ id: QUAN }] }
    ]
};

{
    // ĐỔI LỚP: Quân dạy thay lớp khác cùng khung giờ → KHÔNG phải vắng.
    assert.equal(context.isTeacherCoveringElsewhere(dayData, QUAN, '19:30', '21:00'), true,
        'phải nhận ra Quân đang dạy thay lớp khác đúng khung giờ đó');
    // Cô Nhàn nghỉ thật lớp B1, không dạy thay ở đâu → vẫn là vắng.
    assert.equal(context.isTeacherCoveringElsewhere(dayData, NHAN, '19:30', '21:00'), false);
    // Khung giờ không chồng nhau thì không tính.
    assert.equal(context.isTeacherCoveringElsewhere(dayData, QUAN, '07:30', '09:00'), false);
}

async function run() {
    // CÓ CHẤM CÔNG phủ lên khung giờ → không phải vắng (dù lớp có người dạy thay).
    attendanceStore[`${DAY}_${QUAN}`] = {
        sessions: [
            { checkIn: `${DAY}T07:20:00`, checkOut: `${DAY}T09:00:00` },
            { checkIn: `${DAY}T14:52:00`, checkOut: `${DAY}T21:02:00` }
        ]
    };
    assert.equal(await context.teacherWorkedDuring(QUAN, DAY, '19:30', '21:00'), true,
        'ca 19:30-21:00 nằm trọn trong phiên 14:52-21:02 → có đi làm');
    assert.equal(await context.teacherWorkedDuring(QUAN, DAY, '11:00', '12:00'), false,
        'khung giờ không có chấm công nào phủ lên');

    // Không có chấm công → đúng là vắng.
    attendanceStore[`${DAY}_${NHAN}`] = { sessions: [] };
    assert.equal(await context.teacherWorkedDuring(NHAN, DAY, '19:30', '21:00'), false);

    // Bấm nhầm (vào ≈ ra) không được coi là đi làm.
    attendanceStore[`${DAY}_nham`] = {
        sessions: [{ checkIn: `${DAY}T17:54:00`, checkOut: `${DAY}T17:54:00` }]
    };
    assert.equal(await context.teacherWorkedDuring('nham', DAY, '18:00', '19:30'), false,
        'ca bấm nhầm 1 giây không chứng minh được là đi làm');

    // Ca đã đánh dấu VẮNG thì không tính là đi làm.
    attendanceStore[`${DAY}_vang`] = {
        sessions: [{ checkIn: `${DAY}T19:00:00`, checkOut: `${DAY}T21:00:00`, isAbsent: true }]
    };
    assert.equal(await context.teacherWorkedDuring('vang', DAY, '19:30', '21:00'), false);

    console.log('false-absent.test.js: all assertions passed');
}

run();
