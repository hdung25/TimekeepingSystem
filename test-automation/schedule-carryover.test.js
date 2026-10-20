'use strict';
// 20/10/2026: T4 21/10 (CS1) đã là lịch riêng từ 03/10 nên các sắp xếp lại ở T4 07/10, 14/10
// không sang. Kiểm tra: phát hiện khác biệt, lấy lịch tuần trước giữ việc riêng của ngày đích,
// chỉ ngày tương lai, chặn ghi khi lịch vừa đổi.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/schedule-carryover.js'), 'utf8');
const shiftStateSource = fs.readFileSync(path.join(root, 'js/teacher-shift-state.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function fakeDb(docs) {
    const writes = [];
    const reads = [];
    const ref = (collection, id) => ({
        path: `${collection}/${id}`,
        get: async () => { reads.push(`${collection}/${id}`); const data = docs[`${collection}/${id}`]; return { exists: !!data, data: () => clone(data) }; }
    });
    return {
        writes, reads,
        collection: collection => ({ doc: id => ref(collection, id) }),
        runTransaction: async fn => fn({
            get: async r => r.get(),
            set: (r, data) => { writes.push([r.path, data]); docs[r.path] = data; }
        })
    };
}

function load(today, docs) {
    const store = {};
    const context = {
        console, Date, Math, JSON, Set, Map, Array, Object, Number, String, Promise, Error, RegExp,
        localStorage: { getItem: key => store[key] ?? null, setItem: (key, value) => { store[key] = String(value); } },
        firebase: { firestore: { FieldValue: { serverTimestamp: () => '__ts__' } } },
        crypto: { randomUUID: (() => { let n = 0; return () => `new-${++n}`; })() }
    };
    context.window = context;
    context.globalThis = context;
    context.getLocalDateKeyFromDate = () => today;
    context.db = fakeDb(docs);
    vm.createContext(context);
    vm.runInContext(shiftStateSource, context);
    vm.runInContext(source, context);
    return context;
}

const row = (lop, phong, extra = {}) => ({ start: '18:00', end: '19:30', lop, phong, gvList: [{ id: `t_${lop}`, name: `GV ${lop}` }], gvId: `t_${lop}`, gv: `GV ${lop}`, shiftId: `s_${lop}_${phong}`, soHS: 0, note: '', ...extra });

// Lịch T4 14/10 (đã sắp theo phòng) và T4 21/10 (lịch riêng tạo 03/10, thứ tự/phòng cũ).
const oct14 = { evening1: [row('E4', 'P01'), row('TV4', 'P02'), row('E3', 'P03'), row('TV1', 'P08'), row('', 'P12', { gvList: [], gvId: '', gv: '' })], _revision: 223 };
const oct21 = {
    evening1: [
        row('E3', 'P03', { shiftId: 'keep_e3', isClosed: true, classClosureHistory: [{ reason: 'nghỉ' }] }),
        row('TV4', 'P02', { shiftId: 'keep_tv4', gvThayTeList: [{ id: 'sub1', name: 'Thay 1' }], teacherAbsences: [{ teacherId: 't_TV4', type: 'VP' }], note: 'mang loa' }),
        row('TV1', 'P04', { shiftId: 'keep_tv1' }),
        row('E4', 'P12', { shiftId: 'keep_e4' }),
        row('test', 'P01', { shiftId: 'keep_test', start: '15:05', end: '15:12' })
    ],
    evening2: [row('Toán 3', 'P01')],
    _revision: 20, _updatedBy: 'nv_x'
};

(async () => {
    {
        const ctx = load('2026-10-20', {});
        const { diffDays, mergeDay, matchRows } = ctx.ScheduleCarryover._test;
        assert.deepEqual(Array.from(matchRows(oct14.evening1, oct21.evening1)), [3, 1, 0, 2, -1], 'classes are paired by name, blank class stays unmatched');
        const diff = diffDays(oct14, oct21);
        const texts = diff.sections.flatMap(section => section.changes.map(change => `${section.key}:${change.kind}:${change.text}`));
        assert.ok(texts.includes('evening1:change:E4: phòng P12 → P01'), texts.join('\n'));
        assert.ok(texts.includes('evening1:change:TV1: phòng P04 → P08'));
        assert.ok(texts.some(text => text.startsWith('evening1:add:Thêm Lớp chưa đặt tên (P12)')));
        assert.ok(texts.some(text => text.startsWith('evening1:remove:Bỏ test')));
        assert.ok(texts.includes('evening1:order:Sắp lại thứ tự lớp giống tuần trước'));
        assert.ok(texts.some(text => text.startsWith('evening2:remove:Bỏ Toán 3')));
        assert.equal(diff.count, 5);
        assert.deepEqual(clone(diff.warnings), [], 'no per-day data is lost here');
        assert.equal(diffDays(oct14, clone(oct14)).count, 0, 'identical days have no difference');

        const merged = mergeDay(oct14, oct21, '2026-10-21', () => 'fresh');
        assert.deepEqual(merged.evening1.map(r => `${r.lop}|${r.phong}`), ['E4|P01', 'TV4|P02', 'E3|P03', 'TV1|P08', '|P12'], 'layout and order follow 14/10');
        assert.deepEqual(merged.evening1.map(r => r.shiftId), ['keep_e4', 'keep_tv4', 'keep_e3', 'keep_tv1', 'fresh'], 'matched classes keep their 21/10 class IDs');
        const e3 = merged.evening1[2];
        assert.equal(e3.isClosed, true, 'a class switched off on 21/10 stays off');
        assert.equal(e3.classClosureHistory.length, 1);
        const tv4 = merged.evening1[1];
        assert.equal(tv4.gvThayTeList[0].id, 'sub1', 'substitute of 21/10 is kept');
        assert.equal(tv4.teacherAbsences[0].type, 'VP', 'absence of 21/10 is kept');
        assert.equal(tv4.note, 'mang loa', 'note of 21/10 is kept');
        assert.equal(merged.evening1[0].isClosed, undefined, 'closure never comes from the source week');
        assert.deepEqual(clone(merged.evening2), [], 'classes not on 14/10 are removed');

        // Đổi GV chính → bỏ GV thay / vắng riêng của ngày đó và báo trước.
        const changedTeacher = clone(oct14);
        changedTeacher.evening1[1] = row('TV4', 'P02', { gvList: [{ id: 't_new', name: 'GV mới' }], gvId: 't_new', gv: 'GV mới' });
        const warnDiff = diffDays(changedTeacher, oct21);
        assert.ok(warnDiff.warnings.some(text => text.includes('TV4') && text.includes('đổi GV chính')), warnDiff.warnings.join('\n'));
        const warnMerged = mergeDay(changedTeacher, oct21, '2026-10-21', () => 'fresh');
        assert.deepEqual(clone(warnMerged.evening1[1].gvThayTeList), []);
        assert.deepEqual(clone(warnMerged.evening1[1].teacherAbsences), []);
        // Lớp bị bỏ nhưng đang tắt/GV thay → cảnh báo.
        const dropped = diffDays({ evening1: [row('E4', 'P01')] }, oct21);
        assert.ok(dropped.warnings.some(text => text.includes('E3') && text.includes('đang tắt lớp')), dropped.warnings.join('\n'));
    }

    // findPairs: ngày đích (21/10) và ngày nguồn (14/10) cùng thấy nhắc; ngày đã qua không bị sửa.
    const docs = () => ({
        'settings/schedule_manifest_cs1': { 3: ['cs1__2026-10-07', 'cs1__2026-10-14', 'cs1__2026-10-21'] },
        'schedules/cs1__2026-10-07': clone(oct21),
        'schedules/cs1__2026-10-14': clone(oct14),
        'schedules/cs1__2026-10-21': clone(oct21)
    });
    {
        const ctx = load('2026-10-20', docs());
        const { findPairs } = ctx.ScheduleCarryover._test;
        const onTarget = await findPairs('cs1', '2026-10-21');
        assert.equal(onTarget.length, 1);
        assert.equal(onTarget[0].role, 'target');
        assert.equal(onTarget[0].sourceId, 'cs1__2026-10-14');
        const onSource = await findPairs('cs1', '2026-10-14');
        assert.equal(onSource.length, 1, 'editing 14/10 warns that 21/10 will not follow');
        assert.equal(onSource[0].role, 'source');
        assert.equal(onSource[0].targetId, 'cs1__2026-10-21');
        const onPast = await findPairs('cs1', '2026-10-07');
        assert.equal(onPast.length, 0, '14/10 is already past: no offer to rewrite it');
    }
    {
        // Hôm nay là 21/10 → không còn đề nghị ghi đè lịch của hôm nay.
        const ctx = load('2026-10-21', docs());
        assert.equal((await ctx.ScheduleCarryover._test.findPairs('cs1', '2026-10-21')).length, 0);
    }
    {
        // Áp dụng: ghi đúng một tài liệu, tăng _revision, giữ trường ngoài lịch.
        const store = docs();
        const ctx = load('2026-10-20', store);
        const { findPairs, applyPair } = ctx.ScheduleCarryover._test;
        const [pair] = await findPairs('cs1', '2026-10-21');
        await applyPair(pair);
        assert.equal(ctx.db.writes.length, 1);
        const [writtenPath, written] = ctx.db.writes[0];
        assert.equal(writtenPath, 'schedules/cs1__2026-10-21');
        assert.equal(written._revision, 21);
        assert.equal(written._updatedAt, '__ts__');
        assert.equal(written._carryoverFrom.sourceDocId, 'cs1__2026-10-14');
        assert.deepEqual(written.evening1.map(r => r.phong), ['P01', 'P02', 'P03', 'P08', 'P12']);
        assert.deepEqual(clone(written.evening2), []);
        assert.equal((await findPairs('cs1', '2026-10-21')).length, 0, 'after taking 14/10 there is nothing left to warn about');
    }
    {
        // Ai đó sửa 21/10 trong lúc hộp thoại đang mở → không ghi đè.
        const store = docs();
        const ctx = load('2026-10-20', store);
        const { findPairs, applyPair } = ctx.ScheduleCarryover._test;
        const [pair] = await findPairs('cs1', '2026-10-21');
        store['schedules/cs1__2026-10-21'].evening1[0].phong = 'P99';
        await assert.rejects(applyPair(pair), error => error.code === 'schedule/carryover-conflict');
        assert.equal(ctx.db.writes.length, 0);
    }
    {
        // Ngày điểm dừng kế thừa không bị coi là lịch riêng khác tuần trước.
        const store = docs();
        store['schedules/cs1__2026-10-21'] = { evening1: [], _inheritanceStop: { createdAt: 'x' } };
        const ctx = load('2026-10-20', store);
        ctx.DBService = { isScheduleInheritanceStop: data => !!data._inheritanceStop };
        assert.equal((await ctx.ScheduleCarryover._test.findPairs('cs1', '2026-10-21')).length, 0);
        assert.equal((await ctx.ScheduleCarryover._test.findPairs('cs1', '2026-10-14')).length, 0);
    }
    console.log('schedule-carryover tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
