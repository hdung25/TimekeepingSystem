'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/salary-review-notifications.js'), 'utf8');
const policy = require('../js/salary-review-policy.js');
const today = '2026-09-01';
const group = (id, baseline = '2026-06-20', changes = {}) => ({ id, confirmed: true,
    currentRate: 34000, baselineDate: baseline, ...changes });
const makeHarness = (roles = ['admin'], profiles = [], fail = false) => {
    let currentDate = today;
    const container = { hidden: true, innerHTML: '' };
    const calls = { queues: 0, auth: 0, listeners: {} };
    const window = {
        document: { visibilityState: 'visible', getElementById: () => container, addEventListener(name, callback) { calls.listeners[name] = callback; } },
        addEventListener(name, callback) { calls.listeners[name] = callback; },
        auth: { currentUser: { uid: 'uid-admin' } }, waitAuth: async () => ({ uid: 'uid-admin' }),
        SalaryReviewPolicy: { ...policy, dateKey: () => currentDate },
        SalaryReviewService: { async queue() {
            calls.queues++;
            if (fail) throw Object.assign(new Error('offline'), { code: 'unavailable' });
            return { profiles, config: {} };
        } }
    };
    const service = { async getAuthenticatedAuthorizationContext() {
        calls.auth++;
        return { roles, uid: 'uid-admin' };
    } };
    new Function('window', 'DBService', 'console', source)(window, service, { warn() {} });
    return { window, container, calls, api: window.SalaryReviewNotifications,
        date: value => { currentDate = value; }, event: name => calls.listeners[name]() };
};

(async () => {
    const h = makeHarness();
    const profiles = [
        { staffId: 'one', groups: [group('math'), group('english', '2026-06-30')] },
        { staffId: 'overdue', groups: [group('older', '2026-05-01')] },
        { staffId: 'special42', groups: [group('six-month', '2026-06-01', { currentRate: 42000 })] },
        { staffId: 'scheduled', groups: [group('approved', '2026-05-01', { scheduledChange: { effectiveFrom: '2026-10-01' } })] },
        { staffId: 'setup', groups: [group('draft', '2026-06-01', { confirmed: false })] },
        { staffId: 'empty', groups: [] },
        { staffId: 'person-disabled', personOverrides: { enabled: false }, groups: [group('ignored')] },
        { staffId: 'group-disabled', groups: [group('ignored', '2026-06-01', { enabled: false })] },
        { staffId: 'personal', personOverrides: { cycleMonths: 6 }, groups: [group('later')] }
    ];
    assert.deepEqual(h.api.summarize(profiles, { cycleMonths: 3 }, today, policy),
        { people: 2, groups: 3, setup: 2, empty: false },
        'first-day reminders include late-month and overdue groups, dedupe people, respect personal/42k/future-approval/disabled rules');

    const dashboard = makeHarness(['admin'], profiles);
    await Promise.all([dashboard.api.init(), dashboard.api.init(), dashboard.event('DOMContentLoaded')]);
    assert.equal(dashboard.calls.queues, 1, 'dashboard reads the queue only once, even when initialized twice');
    assert.equal(dashboard.container.hidden, false);
    assert.match(dashboard.container.innerHTML, /2 nhân viên cần xét trong tháng/);
    assert.match(dashboard.container.innerHTML, /3 nhóm môn/);
    assert.match(dashboard.container.innerHTML, /2 hồ sơ còn cần xác nhận mốc/);
    assert.match(dashboard.container.innerHTML, /href="xet-tang-luong.html"/);
    assert.match(dashboard.container.innerHTML, /Đối chiếu ngày 01\/09\/2026/);
    await Promise.all([dashboard.event('visibilitychange'), dashboard.event('pageshow')]);
    assert.equal(dashboard.calls.queues, 1, 'resuming repeatedly in the same month adds no reads');
    dashboard.date('2026-10-01');
    dashboard.window.document.visibilityState = 'hidden';
    await Promise.all([dashboard.event('visibilitychange'), dashboard.event('pageshow')]);
    assert.equal(dashboard.calls.queues, 1, 'a hidden dashboard waits until visible before refreshing');
    dashboard.window.document.visibilityState = 'visible';
    await Promise.all([dashboard.event('visibilitychange'), dashboard.event('pageshow')]);
    assert.equal(dashboard.calls.queues, 2, 'new-month visibility and pageshow share one metadata refresh');
    assert.match(dashboard.container.innerHTML, /Đối chiếu ngày 01\/10\/2026/);
    dashboard.date('2026-10-09');
    await Promise.all([dashboard.event('visibilitychange'), dashboard.event('pageshow'), dashboard.api.init()]);
    assert.equal(dashboard.calls.queues, 2, 'changing the day within a month does not reload metadata');

    // Resume may arrive before the previous month's network read completes.
    // Its result cannot suppress the new month, or start two October reads.
    const pending = makeHarness(['admin'], profiles);
    let release, active = 0, maxActive = 0;
    const gate = new Promise(resolve => { release = resolve; });
    pending.window.SalaryReviewService.queue = async () => {
        pending.calls.queues++; active++; maxActive = Math.max(active, maxActive);
        if (pending.calls.queues === 1) await gate;
        active--;
        return { profiles, config: {} };
    };
    const firstLoad = pending.api.init();
    await Promise.resolve(); await Promise.resolve();
    pending.date('2026-10-01');
    const resumed = [pending.event('visibilitychange'), pending.event('pageshow')];
    release();
    await Promise.all([firstLoad, ...resumed]);
    assert.equal(pending.calls.queues, 2);
    assert.equal(maxActive, 1, 'metadata requests remain single-flight across the month boundary');
    assert.match(pending.container.innerHTML, /Đối chiếu ngày 01\/10\/2026/);

    for (const roles of [['senior_assistant'], ['staff'], ['teaching_assistant'], ['assistant']]) {
        const staff = makeHarness(roles, profiles);
        await staff.api.init();
        assert.equal(staff.calls.queues, 0, 'non-admin roles never read review collections');
        assert.equal(staff.container.hidden, true);
    }
    const missing = makeHarness();
    await missing.api.init();
    assert.match(missing.container.innerHTML, /Thiết lập mốc xét/);
    const failed = makeHarness(['admin'], profiles, true);
    await failed.api.init();
    assert.match(failed.container.innerHTML, /Chưa tải được/);
    assert.doesNotMatch(failed.container.innerHTML, /Chưa có hồ sơ đến hạn/, 'a failed queue cannot claim nothing is due');
    await Promise.all([failed.event('visibilitychange'), failed.event('pageshow')]);
    assert.equal(failed.calls.queues, 1, 'failed reads do not create a same-month retry loop');
    failed.date('2026-10-01');
    await Promise.all([failed.event('visibilitychange'), failed.event('pageshow')]);
    assert.equal(failed.calls.queues, 2, 'a new month allows one fresh attempt after failure');
    await failed.event('pageshow');
    assert.equal(failed.calls.queues, 2);
    const changed = makeHarness(['admin'], profiles);
    changed.window.SalaryReviewService.queue = async () => {
        changed.window.auth.currentUser.uid = 'another-user';
        return { profiles, config: {} };
    };
    await changed.api.init();
    assert.equal(changed.container.hidden, true, 'an auth change must not reveal the previous admin queue');
    assert.doesNotMatch(source, /setInterval|onSnapshot|getUsers|getMonthly|loadEvidence|\.set\(|\.update\(/,
        'dashboard reminder must not poll, scan payroll/users, or write data');

    // The early route guard rejects senior and staff access, while Firestore and
    // the service separately enforce the authoritative admin identity.
    const guard = fs.readFileSync(path.join(root, 'js/auth-guard.js'), 'utf8');
    for (const [roles, allowed] of [[['admin'], true], [['senior_assistant'], false], [['teaching_assistant'], false]]) {
        let alerts = 0;
        const window = { location: { pathname: '/xet-tang-luong.html', href: '' } };
        const storage = { getItem: key => key === 'currentUser' ? 'fixture' : key === 'currentRole' ? JSON.stringify(roles) : null };
        new Function('window', 'localStorage', 'console', 'alert', guard)(window, storage, { warn() {} }, () => { alerts++; });
        assert.equal(alerts === 0, allowed);
        assert.equal(window.location.href === '', allowed);
    }
    const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
    assert.match(main, /link: 'xet-tang-luong\.html'[^\n]+roles: \['admin'\]/);
    console.log('salary-review-notifications.test.js: reminder counts, read limits, failure handling and admin access passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
