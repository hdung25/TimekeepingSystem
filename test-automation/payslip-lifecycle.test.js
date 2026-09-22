// Regression coverage for component-level payslip lifecycle and legacy records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dbServiceSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-service.js'), 'utf8');
const startMarker = '// PAYSLIP LIFECYCLE HELPERS START';
const endMarker = '// PAYSLIP LIFECYCLE HELPERS END';
const start = dbServiceSource.indexOf(startMarker);
const end = dbServiceSource.indexOf(endMarker, start + startMarker.length);

assert.notEqual(start, -1, 'payslip lifecycle start marker must exist');
assert.notEqual(end, -1, 'payslip lifecycle end marker must exist');

const context = {};
vm.createContext(context);
vm.runInContext(dbServiceSource.slice(start, end + endMarker.length), context);

const {
    _getPayslipLifecycleState,
    _getPayslipPaymentBreakdown,
    _getPayslipAccountingBreakdown,
    _preparePayslipComponentPublish,
    _preparePayslipPublishUpdate,
    _preparePayslipConfirmation,
    _getPayslipReceiptRequestState,
    _getPayslipDraftLockState,
    _preparePayslipDraftUpdate
} = context;

{
    const split = _getPayslipPaymentBreakdown({
        status: 'published',
        status_gv: 'received',
        status_tt: 'published',
        details_gv: { netPay: 100 },
        details_tt: { netPay: 50 },
        netPay: 150
    });
    assert.equal(split.total, 150);
    assert.equal(split.paid, 100, 'received teacher component belongs in paid KPI');
    assert.equal(split.unpaid, 50, 'published receptionist component belongs in unpaid KPI');
    const changedDraft = _getPayslipPaymentBreakdown({
        role: 'dual', status: 'published', status_gv: 'received', status_tt: 'draft',
        details_gv: { netPay: 100 }, details_tt: { netPay: 60 }, netPay: 140
    });
    assert.equal(changedDraft.total, 160, 'dashboard totals use complete component amounts, not the preserved legacy aggregate');
    assert.equal(changedDraft.paid, 100);
    assert.equal(changedDraft.unpaid, 60);

    const legacy = _getPayslipPaymentBreakdown({
        role: 'giao-vien', status: 'received', details: { netPay: 80 }, netPay: 80
    });
    assert.deepEqual(
        { total: legacy.total, paid: legacy.paid, unpaid: legacy.unpaid },
        { total: 80, paid: 80, unpaid: 0 }
    );

    // Accounting view: a draft component is not yet money owed, so it must not be
    // reported as "đã gửi · chờ chi".
    const accounting = _getPayslipAccountingBreakdown({
        role: 'dual', status: 'published', status_gv: 'published', status_tt: 'draft',
        details_gv: { netPay: 100 }, details_tt: { netPay: 60 }, netPay: 160
    });
    assert.deepEqual({ total: accounting.total, received: accounting.received, sent: accounting.sent, draft: accounting.draft },
        { total: 160, received: 0, sent: 100, draft: 60 });
    const accountingSplit = _getPayslipAccountingBreakdown({
        status: 'published', status_gv: 'received', status_tt: 'published',
        details_gv: { netPay: 100 }, details_tt: { netPay: 50 }, netPay: 150
    });
    assert.equal(accountingSplit.received + accountingSplit.sent + accountingSplit.draft, accountingSplit.total,
        'the three buckets always add up to the payroll total');
    assert.equal(accountingSplit.received, 100);
    assert.equal(accountingSplit.sent, 50);
    const legacyDraft = _getPayslipAccountingBreakdown({ role: 'giao-vien', status: 'draft', details: { netPay: -20 }, netPay: -20 });
    assert.deepEqual({ total: legacyDraft.total, draft: legacyDraft.draft }, { total: -20, draft: -20 },
        'negative net pay (advance above salary) is kept, not hidden');
}

{
    // Legacy personal publications only had aggregate status. Both component
    // details must inherit it so confirmation does not leave a hidden draft.
    const state = _getPayslipLifecycleState({
        role: 'dual',
        status: 'published',
        details_gv: { netPay: 100 },
        details_tt: { netPay: 50 }
    });
    assert.equal(state.status_gv, 'published');
    assert.equal(state.status_tt, 'published');
    assert.equal(state.overallStatus, 'published');
}

{
    // Once either component status is explicit, a missing sibling is a draft,
    // not a legacy inference from aggregate status.
    const state = _getPayslipLifecycleState({
        role: 'dual',
        status: 'published',
        status_gv: 'published',
        details_gv: { netPay: 100 },
        details_tt: { netPay: 50 }
    });
    assert.equal(state.status_gv, 'published');
    assert.equal(state.status_tt, 'draft');
    assert.equal(state.overallStatus, 'published');
}

{
    const transition = _preparePayslipPublishUpdate({}, {
        role: 'dual',
        details_gv: { netPay: 100, baseSalary: 100, totalBonus: 0, advance: 0 },
        details_tt: { netPay: 50, baseSalary: 50, totalBonus: 0, advance: 0 },
        netPay: 150,
        baseSalary: 150,
        totalBonus: 0,
        advance: 0
    }, '2026-08-31T00:00:00.000Z');
    assert.equal(transition.published.status_gv, 'published');
    assert.equal(transition.published.status_tt, 'published');
    assert.equal(transition.published.status, 'published');
    assert.deepEqual(Array.from(transition.publishedComponents), ['gv', 'tt']);
}

{
    // Publishing the draft sibling may not lower or rewrite a received component.
    const current = {
        role: 'dual',
        status: 'published',
        status_gv: 'received',
        status_tt: 'draft',
        details_gv: { netPay: 100, baseSalary: 100, totalBonus: 0, advance: 0 },
        details_tt: { netPay: 40, baseSalary: 40, totalBonus: 0, advance: 0 },
        netPay: 140
    };
    const transition = _preparePayslipPublishUpdate(current, {
        role: 'dual',
        details_gv: { netPay: 999, baseSalary: 999, totalBonus: 0, advance: 0 },
        details_tt: { netPay: 50, baseSalary: 50, totalBonus: 0, advance: 0 },
        netPay: 1049
    }, '2026-08-31T00:00:00.000Z');
    assert.equal(transition.published.status_gv, 'received');
    assert.equal(transition.published.status_tt, 'published');
    assert.equal(transition.published.status, 'published');
    assert.equal(transition.published.details_gv.netPay, 100);
    assert.equal(transition.published.details_tt.netPay, 50);
}

{
    // Repeated publish of a received payslip is idempotent: no transition and
    // no amount/detail mutation.
    const current = {
        role: 'giao-vien',
        status: 'received',
        status_gv: 'received',
        details_gv: { netPay: 100 },
        details: { netPay: 100 },
        netPay: 100
    };
    const transition = _preparePayslipPublishUpdate(current, {
        role: 'giao-vien',
        details_gv: { netPay: 999 },
        details: { netPay: 999 },
        netPay: 999
    }, '2026-08-31T00:00:00.000Z');
    assert.equal(transition.published.status, 'received');
    assert.equal(transition.published.status_gv, 'received');
    assert.equal(transition.published.netPay, 100);
    assert.equal(transition.published.details_gv.netPay, 100);
    assert.deepEqual(Array.from(transition.lockedComponents), ['gv']);
}

{
    // Confirmation materializes legacy component statuses and confirms both.
    const transition = _preparePayslipConfirmation({
        role: 'dual',
        status: 'published',
        details_gv: { netPay: 100 },
        details_tt: { netPay: 50 }
    }, 'admin', '2026-08-31T00:00:00.000Z');
    assert.equal(transition.published.status_gv, 'received');
    assert.equal(transition.published.status_tt, 'received');
    assert.equal(transition.published.status, 'received');
    assert.deepEqual(Array.from(transition.receivedComponents), ['gv', 'tt']);
}

{
    // An aggregate "published" state may mean one component was received while
    // its sibling is still a draft. That is not an idempotent full receipt.
    const partial = {
        role: 'dual',
        status: 'published',
        status_gv: 'received',
        status_tt: 'draft',
        details_gv: { netPay: 100 },
        details_tt: { netPay: 50 }
    };
    const transition = _preparePayslipConfirmation(
        partial,
        'admin',
        '2026-08-31T00:00:00.000Z'
    );
    assert.equal(transition.changed, false);
    assert.equal(_getPayslipReceiptRequestState(partial, 'all').allReceived, false);
    assert.equal(_getPayslipReceiptRequestState(partial, 'gv').allReceived, true);

    // Missing components are not requested: a single-role received payslip is
    // still a valid idempotent confirmation.
    const single = {
        role: 'giao-vien',
        status: 'received',
        status_gv: 'received',
        details_gv: { netPay: 100 }
    };
    assert.equal(_getPayslipReceiptRequestState(single, 'all').allReceived, true);
}

{
    const transition = _preparePayslipConfirmation({
        role: 'dual',
        status: 'published',
        status_gv: 'received',
        status_tt: 'published',
        details_gv: { netPay: 100 },
        details_tt: { netPay: 50 }
    }, 'employee', '2026-08-31T00:00:00.000Z');
    assert.equal(transition.published.status_gv, 'received');
    assert.equal(transition.published.status_tt, 'received');
    assert.equal(transition.published.status, 'received');
    assert.deepEqual(Array.from(transition.receivedComponents), ['tt']);
}

{
    const published = {
        role: 'giao-vien',
        status: 'published',
        status_gv: 'published',
        details_gv: { netPay: 100 },
        details: { netPay: 100 },
        netPay: 100
    };
    assert.equal(_getPayslipDraftLockState(published, 'gv').locked, true);
    const locked = _preparePayslipDraftUpdate(published, {
        ...published,
        details_gv: { netPay: 999 },
        details: { netPay: 999 },
        netPay: 999
    }, 'gv');
    assert.equal(locked.saved, false);
    assert.equal(locked.requiresRevision, true);
    assert.equal(locked.published.netPay, 100);
    assert.equal(locked.published.details_gv.netPay, 100);
}

{
    // A draft sibling can be recalculated, while the aggregate published
    // snapshot and received component remain untouched.
    const current = {
        role: 'dual',
        status: 'published',
        status_gv: 'received',
        status_tt: 'draft',
        details_gv: { netPay: 100 },
        details_tt: { netPay: 40 },
        details: { netPay: 100 },
        netPay: 140,
        message: 'snapshot'
    };
    const transition = _preparePayslipDraftUpdate(current, {
        role: 'dual',
        details_gv: { netPay: 999 },
        details_tt: { netPay: 50 },
        details: { netPay: 999 },
        netPay: 1049,
        message: 'draft edit'
    }, 'tt', '2026-08-31T00:00:00.000Z');
    assert.equal(transition.saved, true);
    assert.equal(transition.preservedPublishedSnapshot, true);
    assert.equal(transition.published.status_gv, 'received');
    assert.equal(transition.published.status_tt, 'draft');
    assert.equal(transition.published.status, 'published');
    assert.equal(transition.published.details_gv.netPay, 100);
    assert.equal(transition.published.details_tt.netPay, 50);
    assert.equal(transition.published.netPay, 140);
    assert.equal(transition.published.message, 'snapshot');
}

{
    // The aggregate remains a published snapshot while its sibling is a draft,
    // but must be rebuilt from component snapshots at the exact publish
    // transition. Otherwise dual-role dashboards/PDFs keep the old total.
    const current = {
        role: 'dual',
        status: 'published',
        status_gv: 'received',
        status_tt: 'draft',
        details_gv: {
            netPay: 100,
            baseSalary: 90,
            totalBonus: 15,
            advance: 5
        },
        details_tt: {
            netPay: 40,
            baseSalary: 35,
            totalBonus: 10,
            advance: 5
        },
        netPay: 140,
        baseSalary: 125,
        totalBonus: 25,
        advance: 10
    };
    const draft = _preparePayslipDraftUpdate(current, {
        role: 'dual',
        details_gv: {
            netPay: 999,
            baseSalary: 999,
            totalBonus: 999,
            advance: 999
        },
        details_tt: {
            netPay: 50,
            baseSalary: 42,
            totalBonus: 12,
            advance: 4
        },
        netPay: 1049,
        baseSalary: 1041,
        totalBonus: 1011,
        advance: 1003
    }, 'tt', '2026-08-31T00:00:00.000Z');

    assert.equal(draft.published.netPay, 140, 'editing a draft must preserve the published aggregate');
    assert.equal(draft.published.details_gv.netPay, 100, 'received component remains immutable');
    assert.equal(draft.published.details_tt.netPay, 50, 'draft sibling receives its new calculation');

    const published = _preparePayslipComponentPublish(
        draft.published,
        { tt: true },
        '2026-08-31T01:00:00.000Z'
    );
    assert.equal(published.published.status_gv, 'received');
    assert.equal(published.published.status_tt, 'published');
    assert.equal(published.published.netPay, 150);
    assert.equal(published.published.baseSalary, 132);
    assert.equal(published.published.totalBonus, 27);
    assert.equal(published.published.advance, 9);
    assert.deepEqual(Array.from(published.publishedComponents), ['tt']);
}

{
    // Dashboard role classification must not use chips belonging to whichever
    // employee happens to be open in the report view.
    const reportSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8');
    const dashboardStart = reportSource.indexOf('function renderSalaryDashboardTable');
    const dashboardEnd = reportSource.indexOf('async function adminConfirmPaid', dashboardStart);
    assert.notEqual(dashboardStart, -1, 'dashboard renderer must exist');
    assert.notEqual(dashboardEnd, -1, 'dashboard renderer end must exist');
    const dashboardSource = reportSource.slice(dashboardStart, dashboardEnd);
    assert.doesNotMatch(dashboardSource, /const isRecep\s*=.*unfilteredAllMonthChips/);
    assert.match(dashboardSource, /const isRecep\s*=\s*hasReceptionistEmploymentRole\(uRoles\)/);
    assert.match(dashboardSource, /getPayslipAccountingBreakdown\(pub\)/);
    assert.match(dashboardSource, /totalDraft \+= money\.draft/,
        'draft payslips are reported separately from money already sent');
    assert.match(dashboardSource, /outsideList/,
        'payslips of people no longer in the staff list still count in the month total');
    assert.match(dashboardSource, /\^#\[0-9a-f\]\{6\}\$/i,
        'schedule colors must be allow-listed before entering inline styles');
    assert.doesNotMatch(dashboardSource, /onclick="(?:adminConfirmPaid|viewPersonalReportFromDash)/,
        'Firestore identifiers must not be interpolated into inline handlers');
    assert.match(dashboardSource, /escapeReportHtml\(displayName\)/);
    assert.match(dashboardSource, /data-salary-dashboard-action[\s\S]*?addEventListener\('click'/);
}

{
    // The XSS-safe event-listener rendering must retain the receptionist group
    // protocol; bulk selectors and publish routing use the literal `receps`.
    const reportSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8');
    const rowStart = reportSource.indexOf('function createBulkStaffRow');
    const rowEnd = reportSource.indexOf('function onBulkCheckboxChange', rowStart);
    const rowSource = reportSource.slice(rowStart, rowEnd);
    assert.match(rowSource, /const safeGroup\s*=\s*group === 'receps' \? 'receps' : 'teachers'/);
    assert.doesNotMatch(rowSource, /onclick="openStaffPayslipTab/);
    assert.doesNotMatch(rowSource, /onchange="onBulkCheckboxChange/);
}

{
    // The persistence entry points must re-read lifecycle state transactionally;
    // pure merging alone cannot protect against a stale browser tab.
    const saveStart = dbServiceSource.indexOf('async savePayslipDraft(');
    const bulkStart = dbServiceSource.indexOf('async publishPayslipComponents(');
    const publishStart = dbServiceSource.indexOf('async publishSalary(', bulkStart);
    const confirmStart = dbServiceSource.indexOf('async confirmSalaryReceived(', publishStart);
    const afterConfirm = dbServiceSource.indexOf('async getAllMonthlySalarySettings(', confirmStart);
    assert.match(dbServiceSource.slice(saveStart, bulkStart), /db\.runTransaction/);
    assert.match(dbServiceSource.slice(bulkStart, publishStart), /db\.runTransaction/);
    assert.match(dbServiceSource.slice(publishStart, confirmStart), /db\.runTransaction/);
    assert.match(dbServiceSource.slice(confirmStart, afterConfirm), /db\.runTransaction/);
}

{
    // Recall: only a sent-but-unconfirmed component returns to draft. A received
    // (confirmed/paid) component stays locked and the input is never mutated.
    const { _preparePayslipRecall } = context;
    const dual = {
        role: 'dual', status: 'published', status_gv: 'published', status_tt: 'received',
        publishedAt: 'T0', publishedAt_gv: 'T1', publishedAt_tt: 'T1', receivedAt_tt: 'T2', confirmedBy_tt: 'employee',
        details_gv: { netPay: 100 }, details_tt: { netPay: 50 }, netPay: 150
    };
    const both = _preparePayslipRecall(dual, { gv: true, tt: true }, 'T9');
    assert.equal(both.recalledComponents.join(','), 'gv');
    assert.equal(both.lockedComponents.join(','), 'tt');
    assert.equal(both.published.status_gv, 'draft');
    assert.equal(both.published.publishedAt_gv, undefined);
    assert.equal(both.published.recalledAt_gv, 'T9');
    assert.equal(both.published.details_gv.netPay, 100, 'calculated details stay as the draft');
    assert.equal(both.published.status_tt, 'received');
    assert.equal(both.published.receivedAt_tt, 'T2');
    assert.equal(dual.status_gv, 'published', 'input must not be mutated');

    // Legacy single-role document with only the aggregate status.
    const legacy = { role: 'giao-vien', status: 'published', publishedAt: 'T1', details: { netPay: 80 }, netPay: 80 };
    const recalled = _preparePayslipRecall(legacy, { gv: true }, 'T9');
    assert.equal(recalled.recalledComponents.join(','), 'gv');
    assert.equal(recalled.published.status, 'draft');
    assert.equal(recalled.published.publishedAt, undefined);
    assert.equal(_getPayslipLifecycleState(recalled.published).status_gv, 'draft');
    assert.equal(_getPayslipDraftLockState(recalled.published, 'gv').locked, false, 'recalled draft must be editable again');
    const republished = _preparePayslipComponentPublish(recalled.published, { gv: true }, 'T10');
    assert.equal(republished.publishedComponents.join(','), 'gv');
    assert.equal(republished.published.status, 'published');

    const receivedOnly = _preparePayslipRecall({ role: 'tiep-tan', status: 'received', details: { netPay: 70 } }, { tt: true }, 'T9');
    assert.equal(receivedOnly.recalledComponents.length, 0);
    assert.equal(receivedOnly.lockedComponents.join(','), 'tt');
    assert.equal(receivedOnly.published.status, 'received');

    const draftOnly = _preparePayslipRecall({ status: 'draft', status_gv: 'draft', details_gv: { netPay: 1 } }, { gv: true }, 'T9');
    assert.equal(draftOnly.skippedComponents.join(','), 'gv');
    assert.equal(draftOnly.recalledComponents.length, 0);

    const recallStart = dbServiceSource.indexOf('async recallPayslipComponents(');
    const recallEnd = dbServiceSource.indexOf('async updateDailyNote(', recallStart);
    assert.ok(recallStart > 0 && recallEnd > recallStart, 'recall writer must exist');
    const recallSource = dbServiceSource.slice(recallStart, recallEnd);
    assert.match(recallSource, /db\.runTransaction/);
    assert.match(recallSource, /_preparePayslipRecall/);
    assert.match(recallSource, /collection\('revisions'\)/, 'every recalled snapshot is archived');
}

{
    // Send/receipt stamps: the aggregate fields are a projection of the
    // component stamps, never a sticky record of the very first publish.
    const { _preparePayslipRecall, _preparePayslipRevision, _getPayslipStatusTimeline } = context;
    const T = {
        sep09: '2026-09-09T14:00:00.000Z',
        sep12: '2026-09-12T01:00:00.000Z',
        sep15: '2026-09-15T09:00:00.000Z',
        sep16: '2026-09-16T10:00:00.000Z'
    };

    // A dual payslip whose halves are sent days apart keeps two honest stamps.
    let dual = _preparePayslipPublishUpdate({}, { role: 'dual', details_gv: { netPay: 100 } }, T.sep09).published;
    dual = _preparePayslipPublishUpdate(
        dual, { role: 'dual', details_gv: { netPay: 100 }, details_tt: { netPay: 50 } }, T.sep12
    ).published;
    assert.equal(dual.publishedAt_gv, T.sep09, 'the first component keeps its own send time');
    assert.equal(dual.publishedAt_tt, T.sep12, 'the second component must not inherit the first send time');
    assert.equal(dual.publishedAt, T.sep12, 'the aggregate shows the latest send');

    // Recall + resend of one half re-stamps that half only.
    const recalled = _preparePayslipRecall(dual, { gv: true }, T.sep15).published;
    const resent = _preparePayslipPublishUpdate(
        recalled, { role: 'dual', details_gv: { netPay: 130 }, details_tt: { netPay: 50 } }, T.sep16
    ).published;
    assert.equal(resent.publishedAt_gv, T.sep16, 'a resent component is stamped when it is actually resent');
    assert.equal(resent.publishedAt_tt, T.sep12, 'the untouched component keeps its stamp');
    assert.equal(resent.publishedAt, T.sep16);

    // A revision after a receipt re-opens the component and re-stamps the aggregate.
    let single = _preparePayslipPublishUpdate(
        {}, { role: 'giao-vien', details: { netPay: 100 }, details_gv: { netPay: 100 } }, T.sep09
    ).published;
    single = _preparePayslipConfirmation(single, 'employee', T.sep12, 'all').published;
    assert.equal(single.receivedAt, T.sep12);
    single = _preparePayslipRevision(single, { details_gv: { netPay: 120 } }, 'gv', T.sep15);
    assert.equal(single.status, 'published');
    assert.equal(single.publishedAt, T.sep15, 'a revision is a new send, not the original one');
    assert.equal(single.receivedAt, undefined, 'a revision clears the aggregate receipt');

    // Two halves confirmed by different people on different days.
    let mixed = _preparePayslipPublishUpdate(
        {}, { role: 'dual', details_gv: { netPay: 100 }, details_tt: { netPay: 50 } }, T.sep09
    ).published;
    mixed = _preparePayslipConfirmation(mixed, 'employee', T.sep12, 'gv').published;
    const partial = _getPayslipStatusTimeline(mixed);
    assert.equal(partial.overallStatus, 'published');
    assert.equal(partial.receivedComponents.map(item => item.key).join(','), 'gv');
    assert.equal(partial.awaitingReceiptComponents.map(item => item.key).join(','), 'tt');
    assert.equal(partial.receivedComponents[0].receivedAt, T.sep12);

    mixed = _preparePayslipConfirmation(mixed, 'admin', T.sep15, 'tt').published;
    assert.equal(mixed.status, 'received');
    assert.equal(mixed.receivedAt, T.sep15, 'the aggregate receipt is the last component receipt');
    assert.equal(mixed.confirmedBy, 'admin');
    const done = _getPayslipStatusTimeline(mixed);
    assert.equal(done.mixedConfirmers, true, 'the dashboard must be able to name both confirmers');
    assert.equal(done.receivedAt, T.sep15);
    assert.equal(done.sentAt, T.sep09);

    // One half received, the other still a draft: nothing is awaiting a receipt,
    // so the employee screen must not offer the confirm button.
    let halfDraft = _preparePayslipPublishUpdate({}, { role: 'dual', details_gv: { netPay: 100 } }, T.sep09).published;
    halfDraft.details_tt = { netPay: 40 };
    halfDraft.status_tt = 'draft';
    halfDraft = _preparePayslipConfirmation(halfDraft, 'employee', T.sep12, 'all').published;
    const stalled = _getPayslipStatusTimeline(halfDraft);
    assert.equal(stalled.overallStatus, 'published');
    assert.equal(stalled.awaitingReceiptComponents.length, 0);
    assert.equal(stalled.receivedComponents.length, 1);
    assert.equal(
        _getPayslipReceiptRequestState(halfDraft, 'all').allReceived, false,
        'confirming again would throw payslip/not-published, so the button must be hidden'
    );

    // Legacy aggregate-only records keep working and still adopt their stamp.
    const legacyTimeline = _getPayslipStatusTimeline({
        role: 'giao-vien', status: 'received', publishedAt: T.sep09, receivedAt: T.sep12,
        confirmedBy: 'employee', details: { netPay: 80 }, netPay: 80
    });
    assert.equal(legacyTimeline.sentAt, T.sep09);
    assert.equal(legacyTimeline.receivedAt, T.sep12);
    assert.equal(legacyTimeline.confirmedBy, 'employee');
    assert.equal(legacyTimeline.mixedConfirmers, false);

    const legacyRepublish = _preparePayslipComponentPublish(
        { role: 'giao-vien', status: 'published', publishedAt: T.sep09, details: { netPay: 80 }, netPay: 80 },
        { gv: true }, T.sep16
    ).published;
    assert.equal(legacyRepublish.publishedAt_gv, T.sep09, 'a legacy aggregate-only send keeps its recorded date');
}

{
    // The admin dashboard and the employee payslip screen must read the shared
    // timeline instead of re-deriving state from raw aggregate fields.
    const reportSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
    assert.match(dbServiceSource, /getPayslipStatusTimeline\(published = \{\}\)/, 'the timeline adapter must be public');
    assert.match(reportSource, /DBService\.getPayslipStatusTimeline\(pub\)/);
    assert.ok(
        !/new Date\(pub\.receivedAt\)/.test(reportSource) && !/new Date\(pub\.publishedAt\)/.test(reportSource),
        'the dashboard must not read aggregate stamps directly'
    );
    assert.match(mainSource, /DBService\.getPayslipStatusTimeline\(published\)/);
    assert.ok(
        !/published\.status === 'received'/.test(mainSource),
        'the employee screen must not branch on the raw aggregate status'
    );
    assert.match(mainSource, /awaitingReceipt \? 'inline-flex' : 'none'/);
}

console.log('payslip-lifecycle.test.js: all assertions passed');
