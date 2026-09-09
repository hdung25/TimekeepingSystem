'use strict';
const assert = require('node:assert/strict');
module.exports = async ({env, admin, month, record, click, report, snapshot}) => {
    const id = 'audit-dual';
    const read = async () => {
        let data;
        await env.withSecurityRulesDisabled(async c => { data = (await c.firestore().collection('salary_settings_monthly').doc(`${month}_${id}`).get()).data(); });
        return data;
    };
    const original = await read();
    const write = data => env.withSecurityRulesDisabled(c => c.firestore().collection('salary_settings_monthly').doc(`${month}_${id}`).set(data));
    const fill = async (selector, value) => {
        await admin.focus(selector);
        await admin.keyboard.down('Control'); await admin.keyboard.press('A'); await admin.keyboard.up('Control');
        await admin.keyboard.type(String(value));
    };
    const selectTT = async () => {
        await admin.select('#salary-role-filter', 'tiep-tan');
        await admin.waitForFunction(() => window.payrollReadyScope && window.payrollReadyScope === window.currentReportScope && window.currentLoadedRoleKey === 'tiep_tan');
    };
    const save = async selector => {
        await click(admin, selector);
        await admin.waitForFunction(() => !window.__payrollWritePending);
    };
    const fee = data => data.tiep_tan.evaluation.find(e => Number(e.id) === 1).amount;
    // Old records may use string criterion IDs. The editor must update, not duplicate them.
    const legacy = structuredClone(original);
    legacy.tiep_tan.evaluation.forEach(e => { e.id = String(e.id); });
    await write(legacy);
    await report(admin, id); await selectTT();
    await fill('#pdf-phi-tu-van', 81675);
    await fill('#pdf-doanh-thu-cs3', 25000);
    assert.equal(await admin.evaluate(() => Number(window.currentMonthlySalarySettingsAll.tiep_tan.evaluation.find(e => Number(e.id) === 1).amount)), 100000, 'typing must not mutate saved settings');
    await save('#pdf-tieptan-inputs button');
    let stored = await read();
    assert.equal(fee(stored), 81675);
    assert.equal(stored.tiep_tan.evaluation.filter(e => Number(e.id) === 1).length, 1);
    assert.equal(stored.published.details_tt.netPay, 176675);
    assert.equal(stored.published.netPay, 566675);
    await report(admin, id); await selectTT();
    assert.equal(await admin.$eval('#pdf-phi-tu-van', e => e.value), '81,675');
    const savedView = await snapshot(admin);
    assert.equal(savedView.tt.netPay, 176675);
    assert.equal(Number(savedView.header.replace(/[^0-9]/g, '')), 176675);
    await fill('#pdf-phi-tu-van', 91675);
    await fill('#header-actual-revenue-total', 123456);
    await fill('#header-actual-revenue-cs2', 65432);
    await save('button[onclick="saveSalarySettings()"]');
    stored = await read();
    assert.equal(fee(stored), 91675, 'main Save & Calculate accepts edited extras');
    assert.equal(stored.published.details_tt.netPay, 186675);
    let revenue;
    await env.withSecurityRulesDisabled(async c => { revenue = (await c.firestore().collection('settings').doc(`recep_revenue_${month}`).get()).data(); });
    assert.deepEqual(revenue, {total:123456, cs2:65432}, 'saving payroll preserves visible monthly revenues');
    // A second admin changed the settings after the first admin loaded the form.
    await fill('#pdf-phi-tu-van', 1);
    const concurrent = structuredClone(stored); concurrent.tiep_tan.advance = 40000;
    await write(concurrent);
    await save('#pdf-tieptan-inputs button');
    assert.deepEqual(await read(), concurrent, 'stale extras must not overwrite a newer calculation');
    // Saving zero reverses the extra and preserves other settings.
    await report(admin, id); await selectTT();
    await fill('#pdf-phi-tu-van', 0); await fill('#pdf-doanh-thu-cs3', 0);
    await save('#pdf-tieptan-inputs button');
    stored = await read();
    assert.equal(fee(stored), 0);
    assert.equal(stored.published.details_tt.netPay, 60000);
    // An already received TT component must get its own revision even from the GV view.
    stored.published.status = 'received'; stored.published.status_tt = 'received'; stored.published.status_gv = 'received';
    await write(stored);
    await report(admin, id);
    await admin.select('#salary-role-filter', 'giao-vien');
    await admin.waitForFunction(() => window.payrollReadyScope && window.payrollReadyScope === window.currentReportScope && window.currentLoadedRoleKey === 'giao_vien');
    // The all-role view has the same active GV component; invoke the extra editor directly.
    await admin.$eval('#pdf-phi-tu-van', e => { e.value = '81,675'; });
    await admin.evaluate(() => saveRecepExtras());
    const revised = await read();
    assert.deepEqual(revised.published, stored.published, 'received snapshot remains unchanged until revision is sent');
    assert.ok(revised.revisionDrafts.tt);
    assert.equal(revised.revisionDrafts.gv, undefined);
    assert.equal(revised.revisionDrafts.tt.payload.details_tt.netPay, 141675);
    await admin.evaluate(async m => {
        const draft = window.currentMonthlySalarySettingsAll.revisionDrafts.tt;
        await DBService.publishPayslipRevision('audit-dual', m, 'tt', draft.sourceToken, draft.version, 'Test: restore consultation fee');
    }, month);
    const sent = await read();
    assert.equal(sent.published.details_tt.netPay, 141675);
    assert.equal(sent.published.netPay, 531675);
    assert.equal(sent.published.status_tt, 'published');
    assert.equal(sent.published.status_gv, 'received');
    assert.deepEqual(sent.published.details_gv, stored.published.details_gv);
    const employeeTable = await admin.evaluate(details => {
        const element = document.createElement('div');
        element.innerHTML = renderDetailedSalaryTable(details, 'published');
        return element.textContent;
    }, sent.published.details_tt);
    assert.match(employeeTable, /81,675/);
    assert.match(employeeTable, /141,675/);

    await record('consultation-save-reload-totals-conflict-zero-revision', {fee:81675, savedNet:176675, sentNet:sent.published.netPay});
    // First monthly save must compare against an absent role, not inherited defaults.
    const firstMonth = structuredClone(original); delete firstMonth.tiep_tan;
    await write(firstMonth);
    await env.withSecurityRulesDisabled(c => c.firestore().collection('salary_settings').doc(id).set(original.tiep_tan));
    await report(admin, id); await selectTT();
    await fill('#pdf-phi-tu-van', 81675);
    await save('button[onclick="saveSalarySettings()"]');
    const firstSaved = await read();
    assert.equal(fee(firstSaved), 81675);
    assert.equal(firstSaved.published.details_tt.netPay, 151675);
    assert.deepEqual(firstSaved.tiep_tan.class_rates, undefined, 'general rates remain inherited rather than rewritten');
    await env.withSecurityRulesDisabled(c => c.firestore().collection('salary_settings').doc(id).delete());
    // Restore this isolated fixture for the existing receipt and export scenarios.
    await write(original);
    await env.withSecurityRulesDisabled(c => c.firestore().collection('settings').doc(`recep_revenue_${month}`).set({total:0,cs2:0}));
    await report(admin, id); await selectTT();
};
