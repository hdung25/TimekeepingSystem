'use strict';
// "Kế thừa lịch" (29/09/2026): preview/plan logic and the Firestore guards behind it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'js/schedule-inheritance.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'js/db-service.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function loadModule(today) {
    const context = { console, Date, Math, JSON, Set, Map, Array, Object, Number, String, localStorage: { getItem: () => null, setItem() {} } };
    context.window = context;
    context.globalThis = context;
    context.getLocalDateKeyFromDate = () => today;
    vm.createContext(context);
    vm.runInContext(moduleSource, context);
    return context.ScheduleInheritance;
}

// Viewed week Monday 2026-10-05 (source). Today 2026-09-29.
const SOURCE = '2026-10-05';
function snapshotWith(days, manifest) {
    const full = {};
    for (let i = 7; i < 7 * 14; i += 1) {
        const d = new Date(2026, 9, 5 + i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        full[key] = { docId: `cs2__${key}`, exists: false, stop: false, rows: 0, ...(days[key] || {}) };
    }
    return { manifest, days: full };
}
const weekdayOf = key => { const [y, m, d] = key.split('-').map(Number); return String(new Date(y, m - 1, d).getDay()); };
function manifestFor(keys) {
    const manifest = {};
    keys.forEach(key => { (manifest[weekdayOf(key)] ||= []).push(`cs2__${key}`); });
    Object.values(manifest).forEach(list => list.sort());
    return manifest;
}

(async () => {
    const SI = loadModule('2026-09-29');
    // Source week has its own schedule Mon..Sat; one later own day on Mon 2026-10-26; an old stop on 2026-11-09 (Mon).
    const sourceDays = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
    const manifest = manifestFor([...sourceDays, '2026-10-26', '2026-11-09']);
    const snapshot = snapshotWith({
        '2026-10-26': { exists: true, rows: 3 },
        '2026-11-09': { exists: true, stop: true }
    }, manifest);
    const state = { branch: 'cs2', sourceMonday: SOURCE, snapshot };

    {
        const plan = SI.buildPlan(state, 'forever', 0);
        assert.deepEqual(clone(plan.removeStops), ['2026-11-09'], 'forever removes the old stop');
        assert.deepEqual(clone(plan.addStops), []);
        const week1 = plan.weeks[0];
        assert.equal(week1.monday, '2026-10-12');
        assert.equal(week1.counts.follows, 6, 'Mon–Sat follow the viewed week');
        assert.equal(week1.counts.empty, 1, 'Sunday has no schedule anywhere');
        const week3 = plan.weeks[2]; // 2026-10-26
        assert.equal(week3.counts.own, 1, 'the customised Monday is kept');
        const week5 = plan.weeks[4]; // 2026-11-09: Monday now inherits from 2026-10-26 (other own day)
        assert.equal(week5.counts.other, 1);
        assert.equal(week5.counts.stop, 0);
    }
    {
        // Until end of week 2 (2026-10-19): stop week = 2026-10-26.
        const plan = SI.buildPlan(state, 'until', 2);
        assert.equal(plan.stopMonday, '2026-10-26');
        assert.deepEqual(clone(plan.removeStops), [], 'stops after the new stop week are left alone');
        assert.deepEqual(clone(plan.addStops), ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'],
            'Monday 26/10 already has its own schedule; Sunday has nothing to stop');
        assert.equal(plan.weeks[1].counts.follows, 6, 'week 2 still follows');
        assert.equal(plan.weeks[3].counts.follows, 0, 'after the stop week nothing follows the viewed week');
        assert.equal(plan.weeks[3].counts.other, 1, 'Monday continues from its own 26/10 schedule');
    }
    {
        // Until end of week 6 removes the older stop inside the kept range.
        const plan = SI.buildPlan(state, 'until', 6);
        assert.deepEqual(clone(plan.removeStops), ['2026-11-09']);
        assert.equal(plan.stopMonday, '2026-11-23');
        assert.ok(plan.addStops.includes('2026-11-24'));
        assert.ok(plan.addStops.includes('2026-11-23'), 'Monday follows the own 26/10 day, so it is stopped too');
        assert.equal(plan.weeks[4].counts.stop, 0, 'the removed 09/11 stop no longer blanks week 5');
    }
    {
        // Past/today days are never written.
        const late = loadModule('2026-10-20');
        const plan = late.buildPlan(state, 'until', 1); // stop week 2026-10-19 .. 25
        assert.deepEqual(clone(plan.skippedPast), ['2026-10-19', '2026-10-20']);
        assert.ok(plan.addStops.every(key => key > '2026-10-20'));
    }

    // ---------- DB guards ----------
    const store = new Map();
    const deleted = [];
    const snap = (ref) => { const value = store.get(ref.path); return { exists: value != null, data: () => clone(value), id: ref.id }; };
    const ref = (collection, id) => ({ path: `${collection}/${id}`, id, get: async () => snap({ path: `${collection}/${id}`, id }) });
    const db = {
        collection: name => ({ doc: id => ref(name, id) }),
        runTransaction: async fn => {
            const writes = [];
            await fn({
                get: async r => snap(r),
                set: (r, value) => writes.push(() => store.set(r.path, clone(value))),
                update: (r, value) => writes.push(() => store.set(r.path, { ...store.get(r.path), ...clone(value) })),
                delete: r => writes.push(() => { store.delete(r.path); deleted.push(r.path); })
            });
            writes.forEach(write => write());
        }
    };
    const context = {
        console, Date, Math, JSON, Set, Map, Promise, Intl, db,
        window: { db }, navigator: {}, setTimeout, clearTimeout, AbortController, fetch: async () => ({ ok: false }),
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } },
        localStorage: { getItem: key => (key === 'currentUserId' ? 'mgr-1' : null), setItem() {} }
    };
    vm.createContext(context);
    vm.runInContext(dbSource, context);
    vm.runInContext('getLocalDateKeyFromDate = () => "2026-09-29";', context);
    const DBService = vm.runInContext('DBService', context);

    assert.equal(DBService.isScheduleInheritanceStop({ morning1: [], _inheritanceStop: { createdAt: 'x' } }), true);
    assert.equal(DBService.isScheduleInheritanceStop({ morning1: [{ lop: 'E5' }], _inheritanceStop: { createdAt: 'x' } }), false,
        'a stop day that got classes is a normal schedule');
    assert.equal(DBService.isScheduleInheritanceStop({ morning1: [] }), false, 'an empty day without the marker is not a stop');

    await assert.rejects(() => DBService.createScheduleInheritanceStop('cs2__2026-09-29'), /tương lai/, 'never stops today');
    assert.equal(await DBService.createScheduleInheritanceStop('cs2__2026-10-27', { sourceWeek: SOURCE }), true);
    const created = store.get('schedules/cs2__2026-10-27');
    assert.deepEqual(created.morning1, []);
    assert.equal(created._inheritanceStop.createdBy, 'mgr-1');
    assert.ok(store.get('settings/schedule_manifest_cs2')['2'].includes('cs2__2026-10-27'), 'stop joins the manifest');

    store.set('schedules/cs2__2026-10-28', { morning1: [{ lop: 'E5' }] });
    assert.equal(await DBService.createScheduleInheritanceStop('cs2__2026-10-28'), false, 'own schedule is never overwritten');
    assert.deepEqual(store.get('schedules/cs2__2026-10-28').morning1, [{ lop: 'E5' }]);

    // Copy week may overwrite a stop day, but not a real schedule.
    assert.equal(await DBService.createScheduleIfMissing('cs2__2026-10-27', { morning1: [{ lop: 'Copied' }] }), false);
    assert.equal(await DBService.createScheduleIfMissing('cs2__2026-10-27', { morning1: [{ lop: 'Copied' }] }, { replaceInheritanceStop: true }), true);
    assert.equal(store.get('schedules/cs2__2026-10-27').morning1[0].lop, 'Copied');
    assert.equal(await DBService.createScheduleIfMissing('cs2__2026-10-28', { morning1: [] }, { replaceInheritanceStop: true }), false);

    // Removing: only a still-empty stop, and the manifest entry goes with it.
    await DBService.createScheduleInheritanceStop('cs2__2026-11-03');
    store.set('schedules/cs2__2026-11-04', { morning1: [{ lop: 'Added later' }], _inheritanceStop: { createdAt: 'x' } });
    assert.equal(await DBService.removeScheduleInheritanceStop('cs2__2026-11-03'), true);
    assert.ok(!store.has('schedules/cs2__2026-11-03'));
    assert.ok(!store.get('settings/schedule_manifest_cs2')['2'].includes('cs2__2026-11-03'));
    assert.equal(await DBService.removeScheduleInheritanceStop('cs2__2026-11-04'), false, 'a stop that got classes is kept');
    assert.ok(store.has('schedules/cs2__2026-11-04'));
    store.set('schedules/cs2__2026-09-28', { morning1: [], _inheritanceStop: { createdAt: 'x' } });
    assert.equal(await DBService.removeScheduleInheritanceStop('cs2__2026-09-28'), false, 'past days are never touched');

    // A day inheriting from a stop gets an empty projection without the marker.
    store.set('settings/schedule_manifest_cs2', { '1': ['cs2__2026-10-05', 'cs2__2026-10-26'] });
    store.set('schedules/cs2__2026-10-05', { morning1: [{ lop: 'E5', start: '07:30', end: '09:00' }] });
    store.set('schedules/cs2__2026-10-26', { morning1: [], morning2: [], _inheritanceStop: { createdAt: 'x' } });
    DBService._getScheduleRegistrations = async () => [];
    const before = await DBService.getSchedule('cs2__2026-10-19', { source: 'server' });
    assert.equal(before.morning1.length, 1, 'week before the stop inherits the classes');
    const after = await DBService.getSchedule('cs2__2026-11-02', { source: 'server' });
    assert.deepEqual(clone(after.morning1), [], 'weeks after the stop are empty');
    assert.equal(after._inheritanceStop, undefined, 'the stop marker is not projected onto later days');

    console.log('schedule-inheritance.test.js: all assertions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
