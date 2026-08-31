'use strict';

const assert = require('node:assert/strict');
const {
    PUBLIC_FIELDS,
    buildDirectoryPlan,
    validateApplyGuards,
    verifyDirectory
} = require('../scripts/migrate-staff-directory.js');
const { PROJECT_ID } = require('../scripts/migrate-user-credentials.js');

const ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const updated = '2026-08-31T00:00:00.000Z';
const value = stringValue => ({ stringValue });
const document = (collection, id, fields) => ({
    name: `${ROOT}/${collection}/${id}`,
    updateTime: updated,
    fields
});

const privateProfile = document('users', 'staff-1', {
    id: value('staff-1'),
    name: value('Staff One'),
    username: value('staff1'),
    role: value('staff'),
    salary_config: { mapValue: { fields: { attendance_rate: { integerValue: '900000' } } } },
    password: value('must-not-leak'),
    authUid: value('private-firebase-uid')
});

const createPlan = buildDirectoryPlan({ profiles: [privateProfile], directory: [] });
assert.equal(createPlan.summary.documentsToCreate, 1);
assert.equal(createPlan.summary.writesPlanned, 1);
const createdFields = createPlan.writes[0].update.fields;
assert.deepEqual(Object.keys(createdFields).sort(), ['id', 'name', 'role', 'username']);
assert.equal(JSON.stringify(createdFields).includes('must-not-leak'), false);
assert.equal(JSON.stringify(createdFields).includes('900000'), false);
assert.ok(Object.keys(createdFields).every(field => PUBLIC_FIELDS.includes(field)));
assert.deepEqual(createPlan.writes[0].currentDocument, { exists: false });
assert.match(createPlan.writes[0].update.name, /^projects\//, 'Firestore document names must be resource names, not REST URLs');
assert.equal(createPlan.writes[0].update.name.startsWith('https://'), false);

const unsafeDirectory = document('staff_directory', 'staff-1', {
    id: value('staff-1'), name: value('Staff One'), username: value('staff1'), role: value('staff'),
    salary_config: { mapValue: { fields: { attendance_rate: { integerValue: '900000' } } } }
});
const replacementPlan = buildDirectoryPlan({ profiles: [privateProfile], directory: [unsafeDirectory] });
assert.equal(replacementPlan.summary.documentsToReplace, 1);
assert.equal(replacementPlan.summary.documentsWithDisallowedFields, 1);
assert.equal(Object.hasOwn(replacementPlan.writes[0], 'updateMask'), false, 'replacement must purge unlisted fields');
assert.deepEqual(replacementPlan.writes[0].currentDocument, { updateTime: updated });

const sanitizedDirectory = document('staff_directory', 'staff-1', createdFields);
const noOp = buildDirectoryPlan({ profiles: [privateProfile], directory: [sanitizedDirectory] });
assert.equal(noOp.summary.writesPlanned, 0);
assert.equal(noOp.summary.documentsAlreadySanitized, 1);
assert.equal(verifyDirectory([privateProfile], [sanitizedDirectory]).verified, true);

const orphan = document('staff_directory', 'removed-staff', { id: value('removed-staff') });
const orphanPlan = buildDirectoryPlan({ profiles: [privateProfile], directory: [sanitizedDirectory, orphan] });
assert.equal(orphanPlan.summary.orphanDocumentsToDelete, 1);
assert.equal(orphanPlan.writes[0].delete, orphan.name);

assert.throws(
    () => validateApplyGuards({ confirmProject: '', expectedProfiles: 1, expectedWrites: 1 }, createPlan.summary),
    /PROJECT_CONFIRMATION_REQUIRED/
);
assert.throws(
    () => validateApplyGuards({ confirmProject: PROJECT_ID, expectedProfiles: 2, expectedWrites: 1 }, createPlan.summary),
    /PROFILE_COUNT_CHANGED/
);
assert.doesNotThrow(() => validateApplyGuards({
    confirmProject: PROJECT_ID, expectedProfiles: 1, expectedWrites: 1
}, createPlan.summary));

console.log('staff-directory-migration.test.js: all assertions passed');
