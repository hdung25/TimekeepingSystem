'use strict';
// 09/11/2026: 1 lần chấm nối 2 lớp (E2 → NV6) báo 14hs — chỉ lớp có Số HS kế hoạch lớn nhất
// nhận "(+14 HS)". Kiểm tra trên evaluator thật: chip chuỗi phải mang soHS của từng lớp.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const harness = fs.readFileSync(path.join(__dirname, 'evaluation-service.test.js'), 'utf8').split("const staffId = 'teacher-hang';")[0];
const ctx = { require, __dirname, console }; vm.createContext(ctx);
vm.runInContext(harness + '\nglobalThis.testEvaluate=context.window.calculateDailyChips;', ctx);
const date = '2026-10-26';
const schedule = { evening1: [
    { start: '18:00', end: '19:30', lop: 'E2', lopId: 'e2', soHS: 13, gvId: 'linh', _branch: 'cs1', _compositeKey: 'cs1__' + date, _originalIndex: 0 },
    { start: '19:30', end: '21:00', lop: 'Nv6', lopId: 'nv6', soHS: 1, gvId: 'linh', _branch: 'cs1', _compositeKey: 'cs1__' + date, _originalIndex: 1 }
] };
const sessions = [{ id: 's1', start: new Date(date + 'T17:47:00'), checkIn: new Date(date + 'T17:47:00'), checkOut: new Date(date + 'T21:00:00'),
    studentCount: 14, studentCountStatus: 'approved' }];
const user = { id: 'linh', roles: ['teaching_assistant'], salary_config: { roles: [{ id: 'e2', name: 'E2', rate: 42000 }, { id: 'nv6', name: 'Nv6', rate: 44000 }] } };
const chips = ctx.testEvaluate(schedule, sessions, 'linh', date, user).filter(c => c.paidMinutes > 0);
assert.equal(chips.length, 1, 'one chained chip');
const segs = JSON.parse(JSON.stringify(chips[0].mergedSegments));
assert.deepEqual(segs.map(s => [s.lop, s.soHS]), [['E2', 13], ['Nv6', 1]]);
assert.equal(chips[0].studentCount, 14);

const report = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8');
const a = report.indexOf('// PAYROLL HOUR ALLOCATION HELPERS START'), b = report.indexOf('// PAYROLL HOUR ALLOCATION HELPERS END');
const r = { window: {} }; vm.createContext(r); vm.runInContext(report.slice(a, b), r);
assert.deepEqual([...r.studentCountSegmentIndexes(segs)], [0]);
// Every per-segment payroll loop must route through the segment-aware chip.
const raw = report.match(/getTeachingPayAllocations\(chip, segName, segMins/g) || [];
assert.equal(raw.length, 0, 'no chained loop may pass the whole-session student count to every class');
assert.equal((report.match(/chipForStudentCountSegment\(chip, chip\.mergedSegments, sIdx\)/g) || []).length, 4);
console.log('chain-student-count.test.cjs: all assertions passed');
