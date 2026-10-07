// Nguyệt 12/09/2026 (báo 08/10): bấm vào ca 06:57:56, ra 06:58:02 (bấm nhầm) rồi vào lại 06:58:32 → 11:30.
// Ca sáng phải lấy phiên thật (không "V272p"), phiên 6 giây không sinh chip lẻ.
process.env.TZ = 'Asia/Ho_Chi_Minh';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'evaluation-service.js'), 'utf8');
const context = {
    console, Date, Math, Set, Map, Intl, window: { centerClosures: {}, getIconHtml: () => '' },
    getLocalDateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    isScheduledMainTeacher: () => false, isScheduledSubstitute: () => false, hasScheduledSubstitute: () => false
};
vm.createContext(context);
vm.runInContext(source, context);
const dateKey = '2026-09-12';
const sessions = [
    { id: 'tap', checkIn: '2026-09-11T23:57:56.427Z', start: '2026-09-11T23:57:56.427Z', checkOut: '2026-09-11T23:58:02.170Z', status: 'closed', source: 'self' },
    { id: 'real', checkIn: '2026-09-11T23:58:32.157Z', start: '2026-09-11T23:58:32.157Z', checkOut: '2026-09-12T04:30:00.000Z', status: 'closed', source: 'self' }
];
const shifts = [{ shift: 'morning', label: 'SÁNG', start: '07:00', end: '11:30', branch: 'cs1' }];
const user = { roles: ['receptionist'], salary_config: {} };
const chips = context.window.calculateDailyChips({}, sessions, 'nv_nguyet', dateKey, user, shifts);
const texts = chips.map(chip => chip.text);
assert.equal(chips.length, 1, JSON.stringify(texts));
assert.equal(chips[0].sessionId, 'real');
assert.doesNotMatch(chips[0].text, /\(V\d+p\)/, chips[0].text);
assert.ok(chips[0].paidMinutes >= 265, String(chips[0].paidMinutes));
// Thứ tự ngược (phiên thật trước) vẫn đúng.
const reversed = context.window.calculateDailyChips({}, sessions.slice().reverse(), 'nv_nguyet', dateKey, user, shifts);
assert.equal(reversed.length, 1); assert.equal(reversed[0].sessionId, 'real');
console.log('reception-double-tap.test.js: all assertions passed');
