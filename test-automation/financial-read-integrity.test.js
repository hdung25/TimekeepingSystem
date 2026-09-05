'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/db-service.js'), 'utf8');
const report = fs.readFileSync(path.join(__dirname, '../js/report.js'), 'utf8');

function fixture() {
    const rows = Array.from({length: 601}, (_, index) => ({
        id: String(index).padStart(5, '0'), staffId: 'staff',
        dateKey: index < 600 ? '2026-08-01' : '2026-09-01',
        sessionId: `session-${index}`, status: 'approved', duration: '00:15', minutes: 15
    }));
    let reads = 0, failAt = 0;
    const query = (cursor = '', limit = 200) => ({
        where() { return this; }, orderBy() { return this; },
        limit(value) { return query(cursor, value); },
        startAfter(doc) { return query(doc.id, limit); },
        async get(options) {
            assert.equal(options.source, 'server');
            if (++reads === failAt) throw new Error('fixture: unavailable');
            return {docs: rows.filter(row => row.id > cursor).slice(0, limit)
                .map(row => ({id: row.id, data: () => ({...row})}))};
        }
    });
    const db = {collection: () => query()};
    const firebase = {firestore: {FieldPath: {documentId: () => '__name__'}}};
    const service = new Function('db', 'window', 'firebase', source + '\nreturn DBService;')(db, {}, firebase);
    return {service, rows, reads: () => reads, failAt: value => {failAt = value;}};
}

(async () => {
    // Required attendance/late-note inputs must bypass any old empty cache and
    // propagate a network error. Cosmetic callers retain their legacy fallback.
    const unavailable = async options => {
        assert.equal(options.source, 'server');
        throw new Error('fixture: required input unavailable');
    };
    const failingQuery = {where() {return this;}, get: unavailable, doc() {return this;}};
    const required = new Function('db', 'window', 'console', source + '\nreturn DBService;')(
        {collection: () => failingQuery}, {}, {error() {}, warn() {}, log() {}});
    required._cache['monthly_attendance_2026-09_staff'] = Promise.resolve([]);
    required._cache['shift_observations_2026-09_staff'] = Promise.resolve([]);
    required._cache.daily_notes_staff = Promise.resolve({});
    await assert.rejects(required.getMonthlyAttendance('2026-09', 'staff', false, {strict: true}), /required input unavailable/);
    await assert.rejects(required.getShiftObservationsForMonth('2026-09', 'staff', {strict: true}), /required input unavailable/);
    await assert.rejects(required.getDailyNotes('staff', {strict: true}), /required input unavailable/);
    for (const method of ['getOvertimeRequestsForStaff', 'getBonus10RequestsForStaff']) {
        const test = fixture();
        const original = JSON.stringify(test.rows);
        test.failAt(2); // Some results already arrived: never expose a partial list.
        await assert.rejects(test.service[method]('staff', '2026-09'), /unavailable/);
        const result = await test.service[method]('staff', '2026-09');
        assert.equal(result.length, 1);
        assert.equal(result[0].sessionId, 'session-600');
        assert.equal(test.reads(), 6, 'retry must refetch every page after failure');
        await test.service[method]('staff', '2026-09');
        assert.equal(test.reads(), 6, 'successful identical reads can share the cache');
        assert.equal(JSON.stringify(test.rows), original);
        const all = await test.service[method]('staff');
        assert.equal(all.length, 601, 'all-history caller also receives all pages');
    }
    const guard = report.slice(report.indexOf('function requireCompletePayrollReport()'), report.indexOf('function renderPersonalTimesheet()'));
    let staff = 'staff', currentDate = new Date(2026, 8, 1), warnings = 0;
    const window = {payrollReadyScope: 'staff__2026-09', currentReportScope: 'staff__2026-09'};
    const ready = new Function('window', 'currentDate', 'getTargetStaffId', 'UIService', guard + '\nreturn requireCompletePayrollReport;')(
        window, currentDate, () => staff, {toast: () => warnings++});
    assert.equal(ready(), true);
    window.payrollReadyScope = null;
    assert.equal(ready(), false, 'loading/failure blocks publication');
    window.payrollReadyScope = 'staff__2026-09'; staff = 'other';
    assert.equal(ready(), false, 'a loaded prior staff is not the selected staff');
    assert.equal(warnings, 2);
    for (const name of ['saveSalarySettings', 'saveSalarySettingsFromModal', 'saveRecepExtras', 'publishSalary', 'saveCalculationDraftToDb']) {
        const body = report.slice(report.indexOf(`async function ${name}(`));
        assert.ok(body.slice(0, 650).includes('requireCompletePayrollReport()'), `${name} must guard financial writes`);
    }
    console.log('financial-read-integrity.test.js: pagination, partial failure, retry, scope/write guards passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
