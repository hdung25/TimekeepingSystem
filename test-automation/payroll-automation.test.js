const assert = require('node:assert/strict');
const path = require('node:path');
const PayrollAutomation = require(path.join(__dirname, '..', 'js', 'payroll-automation.js'));

const legacyProfile = PayrollAutomation.normalizeProfile();
assert.equal(legacyProfile.automationMode, PayrollAutomation.MODE_LEGACY);
assert.equal(legacyProfile.allowAutomaticDraft, false);
assert.equal(legacyProfile.historicalMinutesBeforeApp, 0);

assert.equal(PayrollAutomation.minutesFromParts(12, 75), 779);
assert.deepEqual(PayrollAutomation.partsFromMinutes(779), { hours: 12, minutes: 59 });

const shadowProfile = PayrollAutomation.normalizeProfile({
    automationMode: 'shadow',
    historicalMinutesBeforeApp: 720,
    historicalEvidenceNote: 'Sổ công trước khi dùng app'
});
assert.equal(PayrollAutomation.needsPersistence(shadowProfile, false), true);

const accumulation = PayrollAutomation.buildAccumulationSummary(shadowProfile, 180);
assert.equal(accumulation.totalEligibleMinutes, 900);
assert.deepEqual(accumulation.total, { hours: 15, minutes: 0 });

assert.throws(
    () => PayrollAutomation.createShadowRun({ profile: legacyProfile }),
    /chưa bật chế độ đối soát/
);

const shadowRun = PayrollAutomation.createShadowRun({
    staffId: 'teacher-1',
    month: '2026-08',
    profile: shadowProfile,
    approvedMinutesAfterApp: 180,
    legacy: { netPay: 100000 },
    proposed: { netPay: 100000 },
    difference: { netPay: 0 }
});
assert.equal(shadowRun.status, 'shadow');
assert.equal(shadowRun.requiresAdminApproval, true);
assert.equal(shadowRun.accumulation.totalEligibleMinutes, 900);

console.log('payroll-automation.test.js: all assertions passed');
