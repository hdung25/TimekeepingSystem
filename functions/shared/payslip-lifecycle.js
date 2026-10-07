'use strict';
// BẢN SAO NGUYÊN VĂN khối PAYSLIP LIFECYCLE HELPERS của js/db-service.js cho Cloud Functions
// (hẹn giờ gửi bảng lương). Test payslip-schedule.test.js bắt buộc hai khối giống hệt nhau.
// PAYSLIP LIFECYCLE HELPERS START
const _PAYSLIP_STATUS_RANK = Object.freeze({ draft: 0, published: 1, received: 2 });

function _normalizePayslipStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(_PAYSLIP_STATUS_RANK, normalized)
        ? normalized
        : 'draft';
}

function _hasExplicitPayslipStatus(published, component) {
    const field = component === 'tt' ? 'status_tt' : 'status_gv';
    const raw = String(published?.[field] || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(_PAYSLIP_STATUS_RANK, raw);
}

function _hasPayslipComponentDetails(published, component) {
    if (!published || typeof published !== 'object') return false;
    const detailField = component === 'tt' ? 'details_tt' : 'details_gv';
    if (published[detailField] !== undefined && published[detailField] !== null) return true;

    const role = String(published.role || '').trim().toLowerCase();
    const isSingleComponentRole = component === 'tt'
        ? ['tiep-tan', 'tiep_tan', 'receptionist'].includes(role)
        : ['giao-vien', 'giao_vien', 'teacher'].includes(role);
    return isSingleComponentRole && published.details !== undefined && published.details !== null;
}

function _derivePayslipOverallStatus(componentStates, fallbackStatus = 'draft') {
    const relevant = [];
    if (componentStates.has_gv) relevant.push(componentStates.status_gv);
    if (componentStates.has_tt) relevant.push(componentStates.status_tt);
    if (relevant.length === 0) return _normalizePayslipStatus(fallbackStatus);
    if (relevant.every(status => status === 'received')) return 'received';
    if (relevant.some(status => status === 'published' || status === 'received')) return 'published';
    return 'draft';
}

function _getPayslipLifecycleState(published = {}) {
    const globalStatus = _normalizePayslipStatus(published.status);
    const explicitGV = _hasExplicitPayslipStatus(published, 'gv');
    const explicitTT = _hasExplicitPayslipStatus(published, 'tt');
    const hasAnyExplicitComponentStatus = explicitGV || explicitTT;
    const hasGVDetails = _hasPayslipComponentDetails(published, 'gv');
    const hasTTDetails = _hasPayslipComponentDetails(published, 'tt');
    let statusGV = explicitGV ? _normalizePayslipStatus(published.status_gv) : 'draft';
    let statusTT = explicitTT ? _normalizePayslipStatus(published.status_tt) : 'draft';

    // Legacy individual publications had only the aggregate status. Once either
    // component status exists, a missing sibling means that sibling is still a
    // draft (the partial bulk-publish contract).
    if (!explicitGV && hasGVDetails && globalStatus !== 'draft' && !hasAnyExplicitComponentStatus) {
        statusGV = globalStatus;
    }
    if (!explicitTT && hasTTDetails && globalStatus !== 'draft' && !hasAnyExplicitComponentStatus) {
        statusTT = globalStatus;
    }

    const hasGV = hasGVDetails || (explicitGV && statusGV !== 'draft');
    const hasTT = hasTTDetails || (explicitTT && statusTT !== 'draft');
    const state = {
        status_gv: statusGV,
        status_tt: statusTT,
        has_gv: hasGV,
        has_tt: hasTT,
        explicit_gv: explicitGV,
        explicit_tt: explicitTT
    };
    state.overallStatus = _derivePayslipOverallStatus(state, globalStatus);
    state.locked_gv = statusGV === 'published' || statusGV === 'received';
    state.locked_tt = statusTT === 'published' || statusTT === 'received';
    return state;
}

function _getPayslipPaymentBreakdown(published = {}) {
    const lifecycle = _getPayslipLifecycleState(published);
    const aggregateValue = Number(published?.netPay);
    const componentSpecs = [];

    if (lifecycle.has_gv) {
        componentSpecs.push({ key: 'gv', status: lifecycle.status_gv, details: published.details_gv });
    }
    if (lifecycle.has_tt) {
        componentSpecs.push({ key: 'tt', status: lifecycle.status_tt, details: published.details_tt });
    }

    // Legacy single-role documents stored their amount in `details` only.
    if (componentSpecs.length === 1 && !componentSpecs[0].details && published.details) {
        componentSpecs[0].details = published.details;
    }

    let knownTotal = 0;
    let paid = 0;
    let unpaid = 0;
    componentSpecs.forEach(component => {
        const value = Number(component.details?.netPay);
        if (!Number.isFinite(value)) return;
        knownTotal += value;
        if (component.status === 'received') paid += value;
        else unpaid += value;
    });

    const hasCompleteAmounts = componentSpecs.length > 0 && componentSpecs.every(component =>
        component.details?.netPay !== undefined && Number.isFinite(Number(component.details.netPay)));
    const total = hasCompleteAmounts ? knownTotal : (Number.isFinite(aggregateValue) ? aggregateValue : knownTotal);
    const unallocated = total - knownTotal;
    if (Math.abs(unallocated) > 0.0001) {
        // Malformed/legacy partial documents may not have component amounts.
        // Keep the dashboard conservative: money is unpaid unless every known
        // component is already received.
        const everyComponentReceived = componentSpecs.length > 0
            && componentSpecs.every(component => component.status === 'received');
        if (everyComponentReceived || lifecycle.overallStatus === 'received') paid += unallocated;
        else unpaid += unallocated;
    }

    return { total, paid, unpaid, lifecycle };
}

function _getPayslipAccountingBreakdown(published = {}) {
    const base = _getPayslipPaymentBreakdown(published);
    const lifecycle = base.lifecycle;
    const components = [];
    if (lifecycle.has_gv) components.push({ status: lifecycle.status_gv, details: published.details_gv });
    if (lifecycle.has_tt) components.push({ status: lifecycle.status_tt, details: published.details_tt });
    if (components.length === 1 && !components[0].details && published.details) components[0].details = published.details;
    const bucket = { received: 0, sent: 0, draft: 0 };
    const add = (status, value) => {
        if (status === 'received') bucket.received += value;
        else if (status === 'published') bucket.sent += value;
        else bucket.draft += value;
    };
    let known = 0;
    components.forEach(component => {
        const value = Number(component.details?.netPay);
        if (!Number.isFinite(value)) return;
        known += value;
        add(component.status, value);
    });
    const unallocated = base.total - known;
    if (Math.abs(unallocated) > 0.0001) add(lifecycle.overallStatus, unallocated);
    return { total: base.total, received: bucket.received, sent: bucket.sent, draft: bucket.draft, lifecycle };
}

function _payslipStampValue(value) {
    if (typeof value !== 'string' || !value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

// Pick the newest component timestamp among the components currently holding one
// of `statuses`. The aggregate publish/receipt metadata is a projection of these
// component stamps, so a dashboard never shows the first send date of a payslip
// that was revised, recalled and resent, or completed by a second component.
function _latestPayslipComponentStamp(published, state, field, statuses) {
    let latestValue = null;
    let latestRank = null;
    let latestComponent = null;
    ['gv', 'tt'].forEach(component => {
        if (!state[`has_${component}`]) return;
        if (!statuses.includes(state[`status_${component}`])) return;
        const rank = _payslipStampValue(published[`${field}_${component}`]);
        if (rank === null) return;
        if (latestRank === null || rank > latestRank) {
            latestValue = published[`${field}_${component}`];
            latestRank = rank;
            latestComponent = component;
        }
    });
    return { value: latestValue, component: latestComponent };
}

function _syncPayslipAggregateStatus(published, nowIso) {
    const state = _getPayslipLifecycleState(published);
    published.status = state.overallStatus;
    if (state.overallStatus === 'published' || state.overallStatus === 'received') {
        // Component stamps are the source of truth once they exist; the old
        // sticky aggregate value survives only for legacy aggregate-only records.
        const latestSent = _latestPayslipComponentStamp(published, state, 'publishedAt', ['published', 'received']);
        published.publishedAt = latestSent.value || published.publishedAt || nowIso;
    }
    if (state.overallStatus === 'received') {
        const latestReceipt = _latestPayslipComponentStamp(published, state, 'receivedAt', ['received']);
        published.receivedAt = latestReceipt.value || published.receivedAt || nowIso;
        const latestConfirmer = latestReceipt.component
            ? published[`confirmedBy_${latestReceipt.component}`]
            : null;
        if (latestConfirmer) published.confirmedBy = latestConfirmer;
    } else {
        // Component-level receipt metadata remains intact. Aggregate receipt
        // metadata is meaningful only after every relevant component is received.
        delete published.receivedAt;
        delete published.confirmedBy;
    }
    return state;
}

// Flattened per-component send/receipt view for the salary dashboard and the
// employee payslip screen, so every surface reads one legacy-compatible contract
// instead of re-deriving state from raw aggregate fields.
function _getPayslipStatusTimeline(published = {}) {
    const state = _getPayslipLifecycleState(published);
    const aggregateReceived = state.overallStatus === 'received';
    const components = ['gv', 'tt']
        .filter(component => state[`has_${component}`])
        .map(component => {
            const status = state[`status_${component}`];
            const explicit = state[`explicit_${component}`];
            const sentAt = published[`publishedAt_${component}`]
                || (!explicit && status !== 'draft' ? published.publishedAt : null)
                || null;
            const receivedAt = published[`receivedAt_${component}`]
                || (status === 'received' && aggregateReceived ? published.receivedAt : null)
                || null;
            const confirmedBy = published[`confirmedBy_${component}`]
                || (status === 'received' && aggregateReceived ? published.confirmedBy : null)
                || null;
            return {
                key: component,
                label: component === 'gv' ? 'GV' : 'TT',
                status,
                sentAt: status === 'draft' ? null : sentAt,
                receivedAt: status === 'received' ? receivedAt : null,
                confirmedBy: status === 'received' ? confirmedBy : null
            };
        });

    const latestOf = (items, field) => items.reduce((latest, item) => {
        const rank = _payslipStampValue(item[field]);
        if (rank === null) return latest;
        return latest.rank === null || rank > latest.rank ? { rank, item } : latest;
    }, { rank: null, item: null }).item;

    const sentComponents = components.filter(item => item.status === 'published' || item.status === 'received');
    const receivedComponents = components.filter(item => item.status === 'received');
    const latestSent = latestOf(sentComponents, 'sentAt');
    const latestReceipt = latestOf(receivedComponents, 'receivedAt');
    const confirmers = Array.from(new Set(receivedComponents.map(item => item.confirmedBy).filter(Boolean)));

    return {
        lifecycle: state,
        overallStatus: state.overallStatus,
        components,
        sentComponents,
        receivedComponents,
        draftComponents: components.filter(item => item.status === 'draft'),
        awaitingReceiptComponents: components.filter(item => item.status === 'published'),
        sentAt: (latestSent && latestSent.sentAt) || (sentComponents.length ? published.publishedAt || null : null),
        receivedAt: (latestReceipt && latestReceipt.receivedAt) || (aggregateReceived ? published.receivedAt || null : null),
        confirmedBy: (latestReceipt && latestReceipt.confirmedBy) || (aggregateReceived ? published.confirmedBy || null : null),
        mixedConfirmers: confirmers.length > 1
    };
}

function _preparePayslipComponentPublish(published = {}, targets = {}, nowIso = new Date().toISOString()) {
    const next = { ...published };
    const before = _getPayslipLifecycleState(next);
    const publishedComponents = [];
    const lockedComponents = [];
    const skippedComponents = [];

    if (before.has_gv) next.status_gv = before.status_gv;
    if (before.has_tt) next.status_tt = before.status_tt;

    [['gv', !!targets.gv], ['tt', !!targets.tt]].forEach(([component, requested]) => {
        if (!requested) return;
        if (!_hasPayslipComponentDetails(next, component)) {
            skippedComponents.push(component);
            return;
        }

        const statusField = component === 'tt' ? 'status_tt' : 'status_gv';
        const publishedAtField = component === 'tt' ? 'publishedAt_tt' : 'publishedAt_gv';
        const currentStatus = component === 'tt' ? before.status_tt : before.status_gv;
        if (currentStatus === 'received') {
            next[statusField] = 'received';
            lockedComponents.push(component);
        } else {
            next[statusField] = 'published';
            // Only a legacy aggregate-only record may adopt the aggregate send
            // time. A component published now must carry its own stamp, or the
            // second component of a dual payslip (and every recall + resend)
            // would inherit the first component's date.
            const legacyAggregateStamp = !before[`explicit_${component}`] && currentStatus === 'published'
                ? next.publishedAt
                : null;
            next[publishedAtField] = next[publishedAtField] || legacyAggregateStamp || nowIso;
            publishedComponents.push(component);
        }
    });

    // A draft sibling is allowed to change while another component is locked,
    // so the aggregate fields deliberately keep the last published snapshot
    // during draft editing. Once that sibling is actually published, rebuild
    // the legacy/dashboard totals from the two component snapshots in the same
    // transaction; otherwise a dual-role payslip can show an old total forever.
    if (publishedComponents.length > 0) {
        _recalculatePayslipScalarTotals(next);
    }

    const state = _syncPayslipAggregateStatus(next, nowIso);
    return { published: next, state, publishedComponents, lockedComponents, skippedComponents };
}

function _recalculatePayslipScalarTotals(published) {
    const details = [published.details_gv, published.details_tt]
        .filter(item => item && typeof item === 'object');
    if (details.length === 0) return published;

    ['netPay', 'baseSalary', 'totalBonus', 'advance'].forEach(field => {
        if (details.every(item => Number.isFinite(Number(item[field])))) {
            published[field] = details.reduce((sum, item) => sum + Number(item[field]), 0);
        }
    });
    return published;
}

function _preparePayslipPublishUpdate(currentPublished = {}, payload = {}, nowIso = new Date().toISOString()) {
    const targets = {
        gv: payload.details_gv !== undefined && payload.details_gv !== null,
        tt: payload.details_tt !== undefined && payload.details_tt !== null
    };
    const role = String(payload.role || '').trim().toLowerCase();
    if (!targets.gv && ['giao-vien', 'giao_vien', 'teacher'].includes(role) && payload.details) targets.gv = true;
    if (!targets.tt && ['tiep-tan', 'tiep_tan', 'receptionist'].includes(role) && payload.details) targets.tt = true;

    const before = _getPayslipLifecycleState(currentPublished);
    const safePayload = { ...payload };
    [
        'status', 'status_gv', 'status_tt',
        'publishedAt', 'publishedAt_gv', 'publishedAt_tt',
        'receivedAt', 'receivedAt_gv', 'receivedAt_tt',
        'confirmedBy', 'confirmedBy_gv', 'confirmedBy_tt'
    ].forEach(field => delete safePayload[field]);

    const requested = [targets.gv ? 'gv' : null, targets.tt ? 'tt' : null].filter(Boolean);
    const allRequestedAlreadyReceived = requested.length > 0 && requested.every(component =>
        component === 'tt' ? before.status_tt === 'received' : before.status_gv === 'received'
    );

    // A received component is an immutable snapshot. A repeated publish remains
    // idempotent and cannot alter its monetary/detail payload.
    const next = allRequestedAlreadyReceived
        ? { ...currentPublished }
        : { ...currentPublished, ...safePayload };
    if (before.status_gv === 'received' && currentPublished.details_gv !== undefined) {
        next.details_gv = currentPublished.details_gv;
    }
    if (before.status_tt === 'received' && currentPublished.details_tt !== undefined) {
        next.details_tt = currentPublished.details_tt;
    }
    if (allRequestedAlreadyReceived && currentPublished.details !== undefined) {
        next.details = currentPublished.details;
    }

    const transition = _preparePayslipComponentPublish(next, targets, nowIso);
    _recalculatePayslipScalarTotals(transition.published);
    transition.state = _getPayslipLifecycleState(transition.published);
    return { ...transition, targets };
}

function _preparePayslipConfirmation(currentPublished = {}, confirmedBy = 'employee', nowIso = new Date().toISOString(), component = 'all') {
    const next = { ...currentPublished };
    const before = _getPayslipLifecycleState(next);
    if (before.has_gv) next.status_gv = before.status_gv;
    if (before.has_tt) next.status_tt = before.status_tt;

    const requestedGV = component === 'all' || component === 'gv';
    const requestedTT = component === 'all' || component === 'tt';
    const receivedComponents = [];

    if (requestedGV && before.has_gv && before.status_gv === 'published') {
        next.status_gv = 'received';
        next.receivedAt_gv = next.receivedAt_gv || nowIso;
        next.confirmedBy_gv = next.confirmedBy_gv || confirmedBy;
        receivedComponents.push('gv');
    }
    if (requestedTT && before.has_tt && before.status_tt === 'published') {
        next.status_tt = 'received';
        next.receivedAt_tt = next.receivedAt_tt || nowIso;
        next.confirmedBy_tt = next.confirmedBy_tt || confirmedBy;
        receivedComponents.push('tt');
    }

    const state = _syncPayslipAggregateStatus(next, nowIso);
    if (state.overallStatus === 'received') {
        next.confirmedBy = next.confirmedBy || confirmedBy;
    }
    return { published: next, state, receivedComponents, changed: receivedComponents.length > 0 };
}

function _getPayslipReceiptRequestState(published = {}, component = 'all') {
    const lifecycle = _getPayslipLifecycleState(published);
    const requestedComponents = [];
    if ((component === 'all' || component === 'gv') && lifecycle.has_gv) requestedComponents.push('gv');
    if ((component === 'all' || component === 'tt') && lifecycle.has_tt) requestedComponents.push('tt');
    const requestedStatuses = requestedComponents.map(item => (
        item === 'tt' ? lifecycle.status_tt : lifecycle.status_gv
    ));
    return {
        lifecycle,
        requestedComponents,
        requestedStatuses,
        allReceived: requestedStatuses.length > 0
            && requestedStatuses.every(status => status === 'received')
    };
}

function _getPayslipDraftLockState(published = {}, component = 'gv') {
    const normalizedComponent = component === 'tt' ? 'tt' : 'gv';
    const lifecycle = _getPayslipLifecycleState(published);
    const status = normalizedComponent === 'tt' ? lifecycle.status_tt : lifecycle.status_gv;
    return {
        component: normalizedComponent,
        status,
        locked: status === 'published' || status === 'received',
        requiresRevision: status === 'published' || status === 'received',
        lifecycle
    };
}

function _preparePayslipDraftUpdate(currentPublished = {}, calculatedPublished = {}, component = 'gv', nowIso = new Date().toISOString()) {
    const lockState = _getPayslipDraftLockState(currentPublished, component);
    if (lockState.locked) {
        return {
            published: { ...currentPublished },
            saved: false,
            locked: true,
            requiresRevision: true,
            component: lockState.component,
            componentStatus: lockState.status,
            lifecycle: lockState.lifecycle
        };
    }

    const before = lockState.lifecycle;
    const next = { ...calculatedPublished };
    const copyOrDelete = (field) => {
        if (currentPublished[field] === undefined) delete next[field];
        else next[field] = currentPublished[field];
    };

    ['gv', 'tt'].forEach(item => {
        const isLocked = item === 'gv' ? before.locked_gv : before.locked_tt;
        const statusField = item === 'gv' ? 'status_gv' : 'status_tt';
        const detailField = item === 'gv' ? 'details_gv' : 'details_tt';
        const publishedAtField = item === 'gv' ? 'publishedAt_gv' : 'publishedAt_tt';
        const receivedAtField = item === 'gv' ? 'receivedAt_gv' : 'receivedAt_tt';
        const confirmedByField = item === 'gv' ? 'confirmedBy_gv' : 'confirmedBy_tt';

        if (isLocked) {
            [statusField, detailField, publishedAtField, receivedAtField, confirmedByField]
                .forEach(copyOrDelete);
            return;
        }

        if (_hasPayslipComponentDetails(next, item)) next[statusField] = 'draft';
        else delete next[statusField];
        delete next[publishedAtField];
        delete next[receivedAtField];
        delete next[confirmedByField];
    });

    const hasLockedSnapshot = before.locked_gv || before.locked_tt;
    if (hasLockedSnapshot) {
        // Aggregate fields are the snapshot shown in legacy dashboards/PDFs.
        // Updating an unlocked sibling draft must not mutate a published amount.
        [
            'netPay', 'baseSalary', 'totalBonus', 'advance', 'penalties',
            'stats', 'breakdown', 'details', 'message', 'publishedAt'
        ].forEach(copyOrDelete);
    } else {
        delete next.publishedAt;
        delete next.receivedAt;
        delete next.confirmedBy;
    }

    const lifecycle = _syncPayslipAggregateStatus(next, nowIso);
    return {
        published: next,
        saved: true,
        locked: false,
        requiresRevision: false,
        component: lockState.component,
        componentStatus: lockState.status,
        preservedPublishedSnapshot: hasLockedSnapshot,
        lifecycle
    };
}
function _preparePayslipRevision(current, calculated, component, nowIso) {
    const state = _getPayslipLifecycleState(current);
    if (!state[`locked_${component}`]) throw new Error('Phần lương chưa gửi; hãy lưu và gửi bản tính thông thường.');
    const details = calculated?.[`details_${component}`] || calculated?.details;
    if (!details || !Number.isFinite(Number(details.netPay))) throw new Error('Bản hiệu chỉnh chưa có số tiền hợp lệ.');
    const next = { ...current };
    for (const key of ['gv', 'tt']) {
        if (state[`has_${key}`]) {
            next[`status_${key}`] = state[`status_${key}`];
            if (!next[`details_${key}`] && current.role !== 'dual') next[`details_${key}`] = current.details;
        }
    }
    next[`details_${component}`] = details;
    next[`status_${component}`] = 'published';
    next[`publishedAt_${component}`] = nowIso;
    delete next[`receivedAt_${component}`];
    delete next[`confirmedBy_${component}`];
    next.role = next.details_gv && next.details_tt ? 'dual' : (component === 'tt' ? 'tiep-tan' : 'giao-vien');
    next.details = next.details_gv || next.details_tt;
    next.message = calculated.message || current.message || '';
    next.revision = Number(current.revision || 0) + 1;
    next.revisedAt = nowIso;
    _recalculatePayslipScalarTotals(next);
    _syncPayslipAggregateStatus(next, nowIso);
    return next;
}

// Admin recall of a sent-but-unconfirmed component. The calculated details stay
// as the draft to recalculate; only the publish metadata is withdrawn. A received
// (confirmed/paid) component is immutable and must use the revision workflow.
function _preparePayslipRecall(published = {}, targets = {}, nowIso = new Date().toISOString()) {
    const next = { ...published };
    const before = _getPayslipLifecycleState(next);
    const recalledComponents = [];
    const lockedComponents = [];
    const skippedComponents = [];

    // Materialize legacy aggregate-only statuses first, otherwise the untouched
    // sibling component would silently fall back to draft.
    if (before.has_gv) next.status_gv = before.status_gv;
    if (before.has_tt) next.status_tt = before.status_tt;

    ['gv', 'tt'].forEach(component => {
        if (!targets[component]) return;
        const status = before[`status_${component}`];
        if (!before[`has_${component}`] || status === 'draft') {
            skippedComponents.push(component);
            return;
        }
        if (status === 'received') {
            lockedComponents.push(component);
            return;
        }
        next[`status_${component}`] = 'draft';
        delete next[`publishedAt_${component}`];
        delete next[`receivedAt_${component}`];
        delete next[`confirmedBy_${component}`];
        next[`recalledAt_${component}`] = nowIso;
        recalledComponents.push(component);
    });

    const state = _syncPayslipAggregateStatus(next, nowIso);
    if (recalledComponents.length > 0 && state.overallStatus === 'draft') {
        delete next.publishedAt;
    }
    return { published: next, state, recalledComponents, lockedComponents, skippedComponents };
}

// Bind a receipt to precisely the published components and amounts the viewer saw.
// Receipt status/timestamps are excluded so a repeated confirmation stays idempotent.
function _getPayslipReceiptToken(published = {}) {
    const state = _getPayslipLifecycleState(published);
    const canonical = value => {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
        return value;
    };
    return JSON.stringify(['gv', 'tt'].filter(key => state[`has_${key}`] && ['published', 'received'].includes(state[`status_${key}`])).map(key => [
        key,
        published[`publishedAt_${key}`] || published.publishedAt || null,
        canonical(published[`details_${key}`] || published.details || { netPay: published.netPay, baseSalary: published.baseSalary, totalBonus: published.totalBonus, advance: published.advance, penalties: published.penalties })
    ]));
}
// PAYSLIP LIFECYCLE HELPERS END

module.exports = {
    preparePayslipComponentPublish: _preparePayslipComponentPublish,
    getPayslipLifecycleState: _getPayslipLifecycleState
};
