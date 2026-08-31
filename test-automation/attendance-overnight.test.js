const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const db = read('js/db-service.js');
const timekeeping = read('js/timekeeping.js');

const checkIn = db.slice(db.indexOf('checkInPersonal: async'), db.indexOf('checkOutPersonal: async'));
assert.match(checkIn, /previousDateKey/);
assert.match(checkIn, /previousData\.checkIn[\s\S]*?previousOpenSession/,
    'check-in must block both array and legacy open sessions from the previous day');

const checkOut = db.slice(db.indexOf('checkOutPersonal: async'), db.indexOf('// 7.1 Manual Add'));
assert.match(checkOut, /\[dateKey, previousDateKey\]/,
    'check-out must search both possible anchor documents');
assert.match(checkOut, /anchorDateKey = selected\.key/);
assert.match(checkOut, /t\.set\(selected\.ref, data\)/,
    'an overnight session must be closed in its original attendance document');

const globalRender = timekeeping.slice(timekeeping.indexOf('async function renderGlobalCheckIn'), timekeeping.indexOf('// 2. Render History'));
assert.match(globalRender, /Promise\.all\(\[[\s\S]*?getPersonalAttendance\(dateKey[\s\S]*?getPersonalAttendance\(previousDateKey/,
    'the staff screen must expose checkout for a previous-day open session');
assert.match(globalRender, /Ca bắt đầu từ ngày hôm trước/);

console.log('attendance-overnight.test.js: all assertions passed');
