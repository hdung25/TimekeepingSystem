'use strict';
const assert = require('node:assert/strict');
module.exports = async ({ admin, adminDb, staffDb }) => {
    const month = '2026-09', staffId = 'clock-staff';
    const ref = adminDb.collection('salary_settings_monthly').doc(`${month}_${staffId}`);
    const details = (role, netPay) => ({ role, netPay, baseSalary: netPay, advance: 0, totalBonus: 0, staffName: 'Fixture' });
    const original = { role: 'dual', status: 'received', status_gv: 'received', status_tt: 'received',
        details_gv: details('giao-vien', 400000), details_tt: details('tiep-tan', 100000), netPay: 500000,
        publishedAt_gv: '2026-09-01T00:00:00Z', publishedAt_tt: '2026-09-01T00:00:00Z',
        receivedAt_gv: '2026-09-02T00:00:00Z', receivedAt_tt: '2026-09-02T00:00:00Z', confirmedBy_tt: 'employee' };
    await ref.set({ published: original, giao_vien: { class_rates: { E1: 100000 } }, tiep_tan: { advance: 0 } });
    const corrected = { ...original, details_gv: details('giao-vien', 420000), netPay: 520000 };
    const locked = await admin.savePayslipDraft(staffId, month, corrected, 'gv');
    assert.equal(locked.locked, true, 'legacy draft calls still cannot rewrite a delivered snapshot');
    const saved = await admin.savePayslipDraft(staffId, month, corrected, 'gv', { allowRevisionDraft: true });
    assert.equal(saved.revisionDraft, true);
    let data = (await ref.get()).data();
    assert.deepEqual(data.published, original, 'saving a revision never changes the employee view');
    const firstDraft = data.revisionDrafts.gv;
    await admin.savePayslipDraft(staffId, month, corrected, 'gv', { allowRevisionDraft: true });
    await assert.rejects(admin.publishPayslipRevision(staffId, month, 'gv', firstDraft.sourceToken, firstDraft.version, 'stale'));
    data = (await ref.get()).data();
    const draft = data.revisionDrafts.gv;
    const result = await admin.publishPayslipRevision(staffId, month, 'gv', draft.sourceToken, draft.version, 'Correct hours after review');
    data = (await ref.get()).data();
    assert.equal(data.published.details_gv.netPay, 420000);
    assert.equal(data.published.netPay, 520000);
    assert.equal(data.published.status_gv, 'published');
    assert.equal(data.published.status_tt, 'received');
    assert.deepEqual(data.published.details_tt, original.details_tt);
    assert.equal(data.published.receivedAt_tt, original.receivedAt_tt);
    assert.equal(data.published.receivedAt_gv, undefined);
    assert.equal(data.revisionDrafts?.gv, undefined);
    assert.equal(data.tiep_tan.advance, 0);
    const archive = ref.collection('revisions').doc(result.revisionId);
    assert.deepEqual((await archive.get()).data().before, original);
    await assert.rejects(archive.update({ reason: 'replace history' }), { code: 'permission-denied' });
    await assert.rejects(archive.delete(), { code: 'permission-denied' });
    const employeeArchive = staffDb.collection('salary_settings_monthly').doc(`${month}_${staffId}`).collection('revisions').doc(result.revisionId);
    await assert.rejects(employeeArchive.get(), { code: 'permission-denied' });
    await assert.rejects(employeeArchive.set({ forged: true }), { code: 'permission-denied' });
    await assert.rejects(admin.confirmSalaryReceived(staffId, month, 'employee', 'all', draft.sourceToken), { code: 'payslip/view-changed' });
    await assert.rejects(admin.publishPayslipRevision(staffId, month, 'gv', draft.sourceToken, draft.version, 'duplicate'));
    await assert.rejects(admin.saveMonthlySalarySettings(staffId, month, { giao_vien: { advance: 999 } }, { revenues: { total: -1, cs2: 0 } }));
    assert.equal((await ref.get()).data().giao_vien.advance, undefined, 'invalid revenue prevents ALL parts of the save');
    await admin.saveMonthlySalarySettings(staffId, month, { giao_vien: { advance: 20000 } }, { revenues: { total: 1000000, cs2: 250000 } });
    assert.equal((await ref.get()).data().giao_vien.class_rates.E1, 100000, 'merge keeps unrelated historic rates');
    assert.equal((await adminDb.collection('settings').doc('recep_revenue_' + month).get()).data().total, 1000000);
    await assert.rejects(admin.saveMonthlySalarySettings(staffId, month, { giao_vien: { advance: 999 } }, {
        expectedRole: 'giao_vien', expectedSettings: { class_rates: { E1: 100000 } }
    }), /phiên khác/);
    assert.equal((await ref.get()).data().giao_vien.advance, 20000);
    const template = adminDb.collection('schedules').doc('cs1__2026-09-01');
    const inheritedRow = { shiftId: 'inherited-one', start: '07:30', end: '09:00', lop: 'E1', phong: 'P1',
        _isInheritedSchedule: true, _inheritedFromScheduleDocId: 'cs1__2026-09-01' };
    const fallback = { _revision: 1, morning1: [inheritedRow] };
    await template.set({ _revision: 2, morning1: [{ ...inheritedRow, lop: 'E2' }] });
    await assert.rejects(admin.mutateScheduleSectionAtomic('cs1__2026-09-08', 'morning1', rows => rows, fallback), { code: 'schedule/source-conflict' });
    await assert.rejects(admin.updateScheduleRowAtomic('cs1__2026-09-08', 'morning1', { shiftId: inheritedRow.shiftId, index: 0 }, row => row, fallback), { code: 'schedule/source-conflict' });
    assert.equal((await adminDb.collection('schedules').doc('cs1__2026-09-08').get()).exists, false);
    console.log('PASS revision draft/repeated calculation/atomic archive/dual-role preservation/stale receipt/immutable history/atomic revenue');
};
