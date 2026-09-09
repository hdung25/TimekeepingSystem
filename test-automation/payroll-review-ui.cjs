'use strict';
const assert = require('node:assert/strict');
module.exports = async ({ env, admin, employee, origin, month, record, shot, click, report, login, authHost, password }) => {
    const id = 'audit-teacher';
    const read = async () => {
        let value;
        await env.withSecurityRulesDisabled(async c => { value = (await c.firestore().collection('salary_settings_monthly').doc(`${month}_${id}`).get()).data(); });
        return value;
    };
    await env.withSecurityRulesDisabled(async c => {
        const ref = c.firestore().collection('salary_settings_monthly').doc(`${month}_${id}`);
        const data = (await ref.get()).data();
        await ref.update({ published: { ...data.published, status: 'received', status_gv: 'received', receivedAt_gv: '2026-09-04T00:00:00Z' } });
    });
    await report(admin, id);
    await admin.waitForSelector('#payroll-review-panel');
    const before = (await read()).published;
    await admin.evaluate(() => {
        document.getElementById('salary-advance').value = '100,000';
        const save = DBService.saveMonthlySalarySettings.bind(DBService);
        DBService.saveMonthlySalarySettings = async (...args) => {
            window.__reviewSavePaused = true;
            await new Promise(resolve => { window.__reviewReleaseSave = resolve; });
            DBService.saveMonthlySalarySettings = save;
            return save(...args);
        };
        window.__reviewSavePromise = saveSalarySettings();
    });
    await admin.waitForFunction(() => window.__reviewSavePaused);
    const scopeWhileSaving = await admin.evaluate(() => {
        changeReportMonth(1);
        selectStaffFromDropdownById('audit-dual');
        return { staff: getTargetStaffId(), month: currentDate.getMonth(), busy: payrollWritePending, updateBlocked: window.__payrollWritePending };
    });
    assert.deepEqual(scopeWhileSaving, { staff: id, month: 8, busy: true, updateBlocked: true });
    await admin.evaluate(async () => { window.__reviewReleaseSave(); await window.__reviewSavePromise; });
    assert.equal(await admin.evaluate(() => window.__payrollWritePending), false);
    let stored = await read();
    assert.deepEqual(stored.published, before, 'calculation preserves the received employee snapshot');
    assert.ok(stored.revisionDrafts.gv, 'Admin can calculate again after publication');
    await admin.waitForSelector('[data-review-revise="gv"]', { visible: true });
    await click(admin, '#review-shifts summary');
    await admin.waitForSelector('[data-review-day]');
    assert.ok(await admin.$$eval('[data-review-day]', rows => rows.length > 0));
    const link = await admin.$eval('#review-links a', a => a.href);
    assert.ok(link.includes('staffId=audit-teacher') && link.includes('date=2026-09-01'));
    await record('payroll-write-scope-and-review', { scopeWhileSaving, before: before.netPay, draft: stored.revisionDrafts.gv.payload.details_gv.netPay, screenshot: await shot(admin, 'review-panel') });
    const oldToken = await admin.evaluate(() => DBService.getPayslipReceiptToken(window.currentMonthlySalarySettingsAll.published));
    admin.removeAllListeners('dialog');
    admin.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? 'UI test: correct advance after reconciliation' : undefined));
    await click(admin, '[data-review-revise="gv"]');
    await admin.waitForFunction(() => !payrollWritePending && !!window.currentMonthlySalarySettingsAll?.lastRevisionId && !window.currentMonthlySalarySettingsAll?.revisionDrafts?.gv);
    stored = await read();
    assert.equal(stored.published.status_gv, 'published');
    assert.notEqual(stored.published.netPay, before.netPay);
    const stale = await employee.evaluate(async (m, token) => {
        try { await DBService.confirmSalaryReceived('audit-teacher', m, 'employee', 'gv', token); return 'unexpected'; }
        catch (e) { return e.code; }
    }, month, oldToken);
    assert.equal(stale, 'payslip/view-changed');
    const popupPromise = new Promise(resolve => admin.once('popup', resolve));
    await click(admin, '[data-review-print="gv"]');
    const popup = await popupPromise;
    await popup.waitForSelector('.sheet');
    const printText = await popup.evaluate(() => document.body.innerText);
    assert.match(printText, /Đã gửi cho nhân viên/);
    assert.ok(printText.includes(Number(stored.published.netPay).toLocaleString('en-US')) || printText.includes(Number(stored.published.netPay).toLocaleString('vi-VN')));
    await popup.close();
    await record('payroll-revision-print-receipt', { stored, stale, printText });
    await admin.evaluate(() => switchAdminTab('dashboard'));
    await admin.waitForFunction(m => window.currentMonthAllSettingsMonth === m, {}, month);
    await admin.evaluate(async previous => {
        window.currentMonthAllSettings['audit-teacher'].published = previous;
        await adminConfirmPaid('audit-teacher');
    }, before);
    assert.equal((await read()).published.status_gv, 'published', 'Admin cannot confirm payment for an unseen revised amount');
    await click(admin, 'button[onclick="changeReportMonth(-1)"]');
    await admin.waitForFunction(() => window.currentMonthAllSettingsMonth === '2026-08');
    assert.equal(await admin.evaluate(() => window.currentMonthAllSettings['audit-teacher'].published.netPay), 200000);
    await click(admin, 'button[onclick="changeReportMonth(1)"]');
    await admin.waitForFunction(m => window.currentMonthAllSettingsMonth === m, {}, month);
    await click(admin, '#tab-personal-report');
    await admin.waitForFunction(() => window.payrollReadyScope === window.currentReportScope && !!window.payrollReadyScope);
    await admin.evaluate(() => openClassRateModal());
    await admin.waitForSelector('#salary-modal-review-link');
    assert.match(await admin.$eval('#salary-modal-review-link', el => el.href), /staffId=audit-teacher/);
    await admin.evaluate(() => closeClassRateModal());
    await admin.evaluate(() => {
        document.getElementById('salary-advance').value = '321';
        window.dispatchEvent(new StorageEvent('storage', { key: 'scheduleDataVersion', storageArea: localStorage, newValue: 'fixture change' }));
    });
    assert.equal(await admin.evaluate(() => requireCompletePayrollReport()), false);
    assert.equal(await admin.$eval('#salary-advance', el => el.value), '321', 'external schedule update preserves unsaved inputs');
    await record('dashboard-month-stale-admin-receipt-and-external-change', 'August and September scoped correctly; unseen revision rejected; unsaved input preserved');
    // Open an old payroll date, not the current week; all links are read-only.
    await admin.goto(`${origin}/lich-lam.html?date=2026-08-24&branch=cs2&staffId=${id}`, { waitUntil: 'domcontentloaded' });
    await admin.waitForFunction(() => typeof selectedDayIndex !== 'undefined' && selectedDayIndex === 0 && currentBranch === 'cs2');
    assert.equal(await admin.evaluate(() => getLocalDateKey(currentWeekStart)), '2026-08-24');
    for (const page of ['lich-tiep-tan.html', 'lich-van-phong.html']) {
        await admin.goto(`${origin}/${page}?date=2026-08-24&branch=cs3&staffId=${id}`, { waitUntil: 'domcontentloaded' });
        await admin.waitForFunction(() => typeof currentWeekStart !== 'undefined' && currentBranch === 'cs3');
        assert.equal(await admin.evaluate(() => `${currentWeekStart.getFullYear()}-${String(currentWeekStart.getMonth()+1).padStart(2,'0')}-${String(currentWeekStart.getDate()).padStart(2,'0')}`), '2026-08-24');
    }
    const senior = { id: 'audit-senior-review', username: 'auditseniorreview', name: 'Audit Senior', roles: ['senior_assistant'] };
    const result = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fixture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: senior.username+'@tuduytre.com', password, returnSecureToken: true }) });
    assert.equal(result.ok, true);
    const uid = (await result.json()).localId;
    await env.withSecurityRulesDisabled(async c => {
        for (const collection of ['users', 'staff_directory']) await c.firestore().collection(collection).doc(senior.id).set({ ...senior, role: 'senior_assistant' });
        await c.firestore().collection('user_roles').doc(uid).set({ userId: senior.id, role: 'senior_assistant', roles: senior.roles, username: senior.username });
    });
    const manager = await login(senior);
    await report(manager, id);
    await manager.waitForSelector('#payroll-review-panel');
    assert.equal(await manager.$eval('#review-payroll-snapshots', el => el.children.length), 0);
    const permission = await manager.evaluate(async m => {
        await saveSalarySettings();
        try { await DBService.saveMonthlySalarySettings('audit-teacher', m, { giao_vien: { advance: 123 } }); return 'unexpected'; }
        catch (e) { return e.code; }
    }, month);
    assert.equal(permission, 'permission-denied');
    await report(manager, 'audit-dual');
    await manager.select('#salary-role-filter', 'tiep-tan');
    await manager.waitForFunction(() => window.payrollReadyScope && window.payrollReadyScope === window.currentReportScope && window.currentLoadedRoleKey === 'tiep_tan');
    assert.equal(await manager.$eval('#pdf-phi-tu-van', el => el.readOnly), true);
    assert.equal(await manager.$eval('#pdf-tieptan-inputs button', el => el.hidden && el.disabled && getComputedStyle(el).display === 'none'), true);
    assert.match(await manager.$eval('#recep-extras-permission-note', el => el.textContent), /Chỉ Admin/);
    await record('senior-review-and-schedule-deep-links', { permission, screenshot: await shot(manager, 'senior-review') });
};
