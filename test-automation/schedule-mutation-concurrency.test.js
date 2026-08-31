const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const schedule = read('js/schedule.js');
const db = read('js/db-service.js');
const renderStart = schedule.indexOf('async function renderTable');
const renderEnd = schedule.indexOf('// Helper: get array', renderStart);
const renderBody = schedule.slice(renderStart, renderEnd);
assert.match(renderBody, /const renderGeneration = \+\+scheduleRenderGeneration/);
assert.match(renderBody, /isScheduleRenderCurrent\(renderGeneration, compositeKey\)/,
    'Stale day/branch/week responses must never replace the active schedule table');

const sliceFunction = (startMarker, endMarker) => {
    const start = schedule.indexOf(startMarker);
    const end = schedule.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `Missing function boundary: ${startMarker}`);
    return schedule.slice(start, end);
};

for (const [start, end] of [
    ['window.toggleClassClosure', 'let currentWeekStart'],
    ['window.addNewRow', 'window.updateRow'],
    ['window.updateRow', 'window.deleteRow'],
    ['window.deleteRow', 'window.saveScheduleManual'],
    ['window.updateSubjectRow', 'let teacherShiftManagerState']
]) {
    const body = sliceFunction(start, end);
    assert.doesNotMatch(body, /DBService\.saveSchedule\(/,
        `${start} must not rewrite a cached whole-day schedule`);
    assert.match(body, /updateScheduleRowAtomic|mutateScheduleSectionAtomic/);
}

const updateAtomic = db.slice(db.indexOf('updateScheduleRowAtomic:'), db.indexOf('mutateScheduleSectionAtomic:'));
assert.match(updateAtomic, /db\.runTransaction/);
assert.match(updateAtomic, /_revision:\s*currentRevision \+ 1/);
assert.match(updateAtomic, /_withoutSeparateScheduleRegistrations/);

const mutateStart = db.indexOf('mutateScheduleSectionAtomic:');
const mutateAtomic = db.slice(mutateStart, db.indexOf('checkInPersonal: async', mutateStart));
assert.match(mutateAtomic, /db\.runTransaction/);
assert.match(mutateAtomic, /const nextRows = applyRows\(rows\)/);
assert.match(mutateAtomic, /_revision:\s*currentRevision \+ 1/);

const copyStart = db.indexOf('createScheduleIfMissing:');
const copyCreate = db.slice(copyStart, db.indexOf('updateScheduleManifest:', copyStart));
assert.match(copyCreate, /db\.runTransaction/);
assert.match(copyCreate, /if \(snapshot\.exists\) return/,
    'Week copy must preserve target days that already contain a schedule');
assert.match(schedule, /createScheduleIfMissing\(tgtComposite, cleanData\)/);

const popup = sliceFunction('window.showGVPopup', '// ================= COPY SCHEDULE');
assert.match(popup, /document\.createTextNode\(String\(g\?\.name/);
assert.doesNotMatch(popup, /innerHTML\s*=\s*gvList\.map/,
    'Teacher names must not be interpolated into popup HTML');

const picker = sliceFunction('window.openGVPicker', 'window.saveTeacherShiftCommand');
assert.match(schedule, /let teacherPickerGeneration = 0/);
assert.match(picker, /const pickerGeneration = teacherPickerGeneration/);
assert.match(picker, /await DBService\.getSchedule\(compositeKey\);[\s\S]*?pickerGeneration !== teacherPickerGeneration/,
    'A stale picker request must stop immediately after its async schedule read');
assert.match(picker, /pickerGeneration !== teacherPickerGeneration[\s\S]*?document\.body\.appendChild\(overlay\)/,
    'Only the latest picker request may commit modal state and DOM');
assert.match(schedule.slice(schedule.indexOf('function closeTeacherShiftManager'), schedule.indexOf('function teacherShiftStatusMeta')),
    /teacherPickerGeneration \+= 1/,
    'Closing the manager must invalidate an in-flight picker request');

const compatibilityTail = schedule.slice(schedule.lastIndexOf('// Rolling-deploy compatibility'));
assert.match(compatibilityTail, /setTeacherShiftAbsence[\s\S]*openGVPicker\(compositeKey, section, index, 'gv'\)/,
    'Cached quick-absence actions must route to the canonical staffing manager');

console.log('schedule-mutation-concurrency.test.js: all assertions passed');
