// Hẹn giờ gửi bảng lương (yêu cầu 07/10/2026). Kiểm tra logic chạy lệnh dùng chung cho Cloud
// Function và trình duyệt trên một CSDL giả lập có transaction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../js/payslip-schedule-core.js');
const Lifecycle = require('../functions/shared/payslip-lifecycle.js');

function fakeDb(seed) {
    const store = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]));
    let auto = 0;
    const ref = (collection, id) => ({
        id, path: `${collection}/${id}`,
        async get() { return snap(this.path, id); },
        async update(patch) { store.set(this.path, { ...store.get(this.path), ...patch }); }
    });
    const snap = (key, id) => ({ id, exists: store.has(key), data: () => JSON.parse(JSON.stringify(store.get(key))), ref: ref(key.split('/')[0], id) });
    return {
        store,
        collection(name) {
            return {
                doc: id => ref(name, id),
                async add(value) { const id = `auto${++auto}`; store.set(`${name}/${id}`, value); return ref(name, id); },
                where(field, op, values) {
                    return { async get() {
                        const docs = [...store.keys()].filter(key => key.startsWith(name + '/'))
                            .map(key => snap(key, key.slice(name.length + 1)))
                            .filter(doc => op === 'in' ? values.includes(doc.data()[field]) : doc.data()[field] === values);
                        return { docs };
                    } };
                }
            };
        },
        async runTransaction(fn) {
            const writes = [];
            const result = await fn({ get: async r => snap(r.path, r.id), update: (r, patch) => writes.push([r.path, patch]) });
            writes.forEach(([key, patch]) => store.set(key, { ...store.get(key), ...patch }));
            return result;
        }
    };
}

const draft = netPay => ({ status: 'draft', role: 'giao-vien', status_gv: 'draft', details_gv: { netPay }, netPay });
const runAt = new Date('2026-10-10T01:00:00.000Z');
(async () => {
    const db = fakeDb({
        'payslip_publish_schedules/s1': { month: '2026-09', runAt: runAt.toISOString(), runAtMs: runAt.getTime(), status: 'scheduled', message: 'Chúc tháng mới vui',
            targets: [{ staffId: 'nv_a', name: 'A', gv: true }, { staffId: 'nv_b', name: 'B', gv: true }, { staffId: 'nv_c', name: 'C', gv: true }, { staffId: 'nv_d', name: 'D', tt: true }] },
        'payslip_publish_schedules/s2': { month: '2026-09', runAtMs: runAt.getTime(), status: 'cancelled', targets: [{ staffId: 'nv_a', gv: true }] },
        'salary_settings_monthly/2026-09_nv_a': { published: draft(5000000) },
        'salary_settings_monthly/2026-09_nv_b': { published: { ...draft(4000000), status: 'received', status_gv: 'received', publishedAt_gv: '2026-10-01T00:00:00.000Z' } },
        'salary_settings_monthly/2026-09_nv_d': { consultationFeePending: true, published: { role: 'tiep-tan', status_tt: 'draft', details_tt: { netPay: 1 } } }
    });
    const options = { lifecycle: Lifecycle, serverTimestamp: () => 'SERVER_TS', runner: 'test' };

    // Trước giờ hẹn: không gửi gì.
    assert.deepEqual(await Core.runDueSchedules(db, { ...options, now: new Date(runAt.getTime() - 60000) }), []);
    assert.equal(db.store.get('salary_settings_monthly/2026-09_nv_a').published.status_gv, 'draft');

    const [report] = await Core.runDueSchedules(db, { ...options, now: new Date(runAt.getTime() + 1000) });
    assert.equal(report.published, 1);
    assert.equal(report.locked, 1, 'phần đã nhận lương giữ nguyên');
    assert.equal(report.skipped, 1, 'chưa tính lương thì bỏ qua');
    assert.equal(report.failed, 1, 'phí tư vấn chưa tính lại thì báo lỗi');
    const a = db.store.get('salary_settings_monthly/2026-09_nv_a').published;
    assert.equal(a.status_gv, 'published');
    assert.equal(a.message, 'Chúc tháng mới vui');
    assert.equal(db.store.get('salary_settings_monthly/2026-09_nv_b').published.status_gv, 'received');
    assert.equal(db.store.get('salary_settings_monthly/2026-09_nv_d').published.status_tt, 'draft');
    const schedule = db.store.get('payslip_publish_schedules/s1');
    assert.equal(schedule.status, 'done');
    assert.equal(schedule.runner, 'test');
    assert.equal(db.store.get('payslip_publish_schedules/s2').status, 'cancelled', 'lệnh đã hủy không chạy');
    const notes = [...db.store.entries()].filter(([key]) => key.startsWith('admin_notifications/')).map(([, value]) => value);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].staffId, 'nv_a');
    assert.equal(notes[0].action, 'payslip_published');
    assert.match(notes[0].details, /tháng 9\/2026/);

    // Chạy lại không gửi trùng.
    assert.deepEqual(await Core.runDueSchedules(db, { ...options, now: new Date(runAt.getTime() + 600000) }), []);

    // Lượt chạy bị ngắt (running quá 20 phút) được nhận lại; trong 20 phút thì không.
    db.store.set('payslip_publish_schedules/s3', { month: '2026-09', runAtMs: 0, status: 'running', startedAt: new Date(runAt.getTime()).toISOString(), targets: [{ staffId: 'nv_a', gv: true }] });
    assert.deepEqual(await Core.runDueSchedules(db, { ...options, now: new Date(runAt.getTime() + 5 * 60000) }), []);
    const [again] = await Core.runDueSchedules(db, { ...options, now: new Date(runAt.getTime() + 25 * 60000) });
    assert.equal(again.published, 1);
    assert.equal(db.store.get('salary_settings_monthly/2026-09_nv_a').published.publishedAt_gv, a.publishedAt_gv, 'giữ ngày gửi cũ');

    assert.deepEqual(Core.normalizeTargets([{ staffId: 'x y', gv: true }, { staffId: 'nv_1', gv: true }, { id: 'nv_1', tt: true }, { staffId: 'nv_2' }]),
        [{ staffId: 'nv_1', name: '', gv: true, tt: true }]);

    // Bản sao cho Cloud Functions giống hệt bản web.
    const norm = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(norm('functions/shared/payslip-schedule-core.js'), norm('js/payslip-schedule-core.js'));
    const block = text => text.slice(text.indexOf('// PAYSLIP LIFECYCLE HELPERS START'), text.indexOf('// PAYSLIP LIFECYCLE HELPERS END'));
    assert.equal(block(norm('functions/shared/payslip-lifecycle.js')), block(norm('js/db-service.js')), 'khối lifecycle phải giống db-service.js');
    console.log('payslip-schedule.test.js: all assertions passed');
})().catch(error => { console.error(error); process.exit(1); });
