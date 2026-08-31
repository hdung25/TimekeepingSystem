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

    const legacy = _getPayslipPaymentBreakdown({
        role: 'giao-vien', status: 'received', details: { netPay: 80 }, netPay: 80
    });
    assert.deepEqual(
        { total: legacy.total, paid: legacy.paid, unpaid: legacy.unpaid },
        { total: 80, paid: 80, unpaid: 0 }
    );
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
    assert.match(dashboardSource, /getPayslipPaymentBreakdown\(pub\)/);
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

console.log('payslip-lifecycle.test.js: all assertions passed');
