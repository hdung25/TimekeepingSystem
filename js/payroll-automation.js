// ================= PAYROLL AUTOMATION SAFETY FOUNDATION =================
// This module is deliberately side-effect free.  It normalizes the data used
// by the future payroll engine but never changes attendance, rates, or a
// published payslip.  The live system remains in legacy mode by default.
(function (global) {
    'use strict';

    var MODE_LEGACY = 'legacy';
    var MODE_SHADOW = 'shadow';
    var PROFILE_SCHEMA_VERSION = 1;

    function toWholeNumber(value) {
        var number = Number(value);
        return isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
    }

    function minutesFromParts(hours, minutes) {
        return (toWholeNumber(hours) * 60) + Math.min(59, toWholeNumber(minutes));
    }

    function partsFromMinutes(totalMinutes) {
        var normalized = toWholeNumber(totalMinutes);
        return {
            hours: Math.floor(normalized / 60),
            minutes: normalized % 60
        };
    }

    function normalizeProfile(input) {
        var source = input || {};
        var mode = source.automationMode === MODE_SHADOW ? MODE_SHADOW : MODE_LEGACY;
        var historicalMinutes = toWholeNumber(source.historicalMinutesBeforeApp);

        return {
            schemaVersion: PROFILE_SCHEMA_VERSION,
            automationMode: mode,
            historicalMinutesBeforeApp: historicalMinutes,
            historicalEvidenceNote: String(source.historicalEvidenceNote || '').trim(),
            historicalEnteredAt: source.historicalEnteredAt || null,
            historicalEnteredBy: source.historicalEnteredBy || null,
            policyVersion: String(source.policyVersion || 'legacy-v1'),
            // A future automatic calculation can only create a draft.  It is
            // never allowed to publish, pay, or rewrite an existing period.
            allowAutomaticDraft: source.allowAutomaticDraft === true,
            updatedAt: source.updatedAt || null
        };
    }

    function needsPersistence(profile, alreadyExists) {
        var normalized = normalizeProfile(profile);
        return !!alreadyExists || normalized.automationMode !== MODE_LEGACY ||
            normalized.historicalMinutesBeforeApp > 0 || !!normalized.historicalEvidenceNote;
    }

    function buildAccumulationSummary(profile, approvedMinutesAfterApp) {
        var normalized = normalizeProfile(profile);
        var beforeApp = normalized.historicalMinutesBeforeApp;
        var afterApp = toWholeNumber(approvedMinutesAfterApp);
        var total = beforeApp + afterApp;

        return {
            beforeAppMinutes: beforeApp,
            approvedAfterAppMinutes: afterApp,
            totalEligibleMinutes: total,
            beforeApp: partsFromMinutes(beforeApp),
            afterApp: partsFromMinutes(afterApp),
            total: partsFromMinutes(total)
        };
    }

    function createShadowRun(input) {
        var source = input || {};
        var profile = normalizeProfile(source.profile);
        if (profile.automationMode !== MODE_SHADOW) {
            throw new Error('Nhân sự chưa bật chế độ đối soát lương tự động.');
        }

        return {
            schemaVersion: 1,
            status: 'shadow',
            staffId: String(source.staffId || ''),
            month: String(source.month || ''),
            policyVersion: profile.policyVersion,
            // The first safe release stores the source snapshot and its
            // comparison.  It intentionally cannot become a payslip itself.
            sourceFingerprint: String(source.sourceFingerprint || ''),
            calculatedAt: source.calculatedAt || new Date().toISOString(),
            legacy: source.legacy || {},
            proposed: source.proposed || {},
            difference: source.difference || {},
            accumulation: buildAccumulationSummary(profile, source.approvedMinutesAfterApp),
            requiresAdminApproval: true
        };
    }

    global.PayrollAutomation = {
        MODE_LEGACY: MODE_LEGACY,
        MODE_SHADOW: MODE_SHADOW,
        PROFILE_SCHEMA_VERSION: PROFILE_SCHEMA_VERSION,
        minutesFromParts: minutesFromParts,
        partsFromMinutes: partsFromMinutes,
        normalizeProfile: normalizeProfile,
        needsPersistence: needsPersistence,
        buildAccumulationSummary: buildAccumulationSummary,
        createShadowRun: createShadowRun
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = global.PayrollAutomation;
})(typeof window !== 'undefined' ? window : globalThis);
