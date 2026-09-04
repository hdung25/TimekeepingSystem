const assert = require('node:assert/strict');
const repair = require('../scripts/reset-attendance-access-20260904.js');

assert.equal(repair.TARGETS.length, 2, 'the scoped recovery must target exactly the two audited accounts');
assert.equal(repair.parseArguments([]).apply, false);
assert.deepEqual(
    repair.parseArguments([
        '--apply',
        '--confirm-project=timekeeping-69f3f',
        '--expect-targets=2'
    ]),
    { apply: true, confirmProject: 'timekeeping-69f3f', expectedTargets: 2 }
);
assert.throws(
    () => repair.parseArguments(['--apply', '--delete-everything']),
    error => error?.safeCode === 'UNSUPPORTED_ARGUMENT'
);

const target = repair.TARGETS[0];
const write = repair.createNoticeWrite(target, 'Test Staff', '2026-09-04T12:00:00.000Z');
assert.equal(write.currentDocument.exists, false, 'the reset must never overwrite an unrelated notification');
assert.match(write.update.name, new RegExp(`admin_notifications/${repair.RECOVERY_ID}_${target.staffId}$`));
assert.equal(write.update.fields.staffId.stringValue, target.staffId);
assert.equal(write.update.fields.action.stringValue, 'announcement');
assert.equal(write.update.fields.batchId.stringValue, repair.RECOVERY_ID);
assert.equal(write.update.fields.read.booleanValue, false);
assert.equal(write.update.fields.createdAt.timestampValue, '2026-09-04T12:00:00.000Z');
assert.ok(!Object.keys(write.update.fields).some(field => /attendance|payroll|schedule|role/i.test(field)),
    'the reset notice must not mutate attendance, payroll, schedules, or roles');

const expectedDocument = {
    fields: {
        staffId: { stringValue: target.staffId },
        action: { stringValue: 'announcement' },
        batchId: { stringValue: repair.RECOVERY_ID },
        title: { stringValue: repair.NOTICE.title },
        details: { stringValue: repair.NOTICE.details }
    }
};
assert.equal(repair.isExpectedNotice(expectedDocument, target), true);
assert.equal(repair.isExpectedNotice({ fields: {} }, target), false);

const records = repair.TARGETS.map(item => ({ target: item, alreadySent: false }));
assert.doesNotThrow(() => repair.validateApplyArguments({
    confirmProject: 'timekeeping-69f3f', expectedTargets: 2
}, records));
assert.throws(
    () => repair.validateApplyArguments({ confirmProject: 'wrong-project', expectedTargets: 2 }, records),
    error => error?.safeCode === 'PROJECT_CONFIRMATION_REQUIRED'
);

console.log('attendance-access-reset.test.js: all assertions passed');
