'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const state = require('../js/teacher-shift-state');
const A = {id:'a',name:'A'}, B = {id:'b',name:'B'}, C = {id:'c',name:'C'};
const command = {teacherId:'a',teacherName:'A',transferId:'transfer-1',mode:'temporary',effectiveFrom:'2026-09-05',effectiveTo:'2026-09-05'};
const actor = {id:'admin',name:'Admin'};
const ids = row => state.getMainTeachers(row).map(t => t.id).sort();
const project = row => state.projectInheritedRoster(row, '2026-09-12');
const target = state.applyTeacherTransferCommand({gvList:[C]}, {...command,direction:'in'}, actor);
const source = state.applyTeacherTransferCommand({gvList:[A]}, {...command,direction:'out',replacementTeacher:B}, actor);
assert.deepEqual(ids(state.projectInheritedRoster(target,'2026-09-05')), ['a','c']);
assert.deepEqual(ids(project(target)), ['c']);
assert.deepEqual(ids(project(source)), ['a']);
assert.deepEqual(ids(project(project(source))), ['a'], 'repeated inheritance is idempotent');
const unchanged = JSON.stringify(target);
project(target);
assert.equal(JSON.stringify(target), unchanged, 'historical document is never mutated');
const legacy = structuredClone(target);
legacy.assignmentTransferHistory.forEach(event => {delete event.rosterBefore; delete event.rosterAfter;});
assert.deepEqual(ids(project(legacy)), ['c'], 'old deployed transfer events also expire');
const permanent = state.applyTeacherTransferCommand({gvList:[C]}, {...command,mode:'permanent',direction:'in'}, actor);
assert.deepEqual(ids(project(permanent)), ['a','c']);
const laterEdit = {...source, gvList:[B,C]};
assert.deepEqual(ids(project(laterEdit)), ['a','c'], 'unrelated later main is retained');
const nested = state.applyTeacherTransferCommand(source, {...command,teacherId:'b',teacherName:'B',transferId:'t2',direction:'out',replacementTeacher:C}, actor);
assert.deepEqual(ids(project(nested)), ['a'], 'nested temporary transfers unwind newest first');

(async () => {
    const docs = new Map([
        ['schedules/cs1__2026-09-05',{morning1:[target]}],
        ['settings/schedule_manifest_cs1',{'6':['cs1__2026-09-05']}]
    ]);
    const db = {collection: collection => ({doc: id => ({get: async () => ({exists: docs.has(`${collection}/${id}`), data: () => structuredClone(docs.get(`${collection}/${id}`))})})})};
    const sourceText = fs.readFileSync(path.join(__dirname,'../js/db-service.js'),'utf8');
    const service = new Function('db','window','TeacherShiftState',sourceText+'\nreturn DBService;')(db,{TeacherShiftState:state},state);
    service._attachScheduleRegistrations = async (_, data) => data;
    const first = await service.getSchedule('cs1__2026-09-12', {source:'server'});
    const second = await service.getSchedule('cs1__2026-09-12', {source:'server'});
    assert.deepEqual(ids(first.morning1[0]), ['c']);
    assert.equal(first.morning1[0].shiftId, second.morning1[0].shiftId, 'expired transfer must not destabilize +10 chip target');
    for (const file of fs.readdirSync(path.join(__dirname,'..')).filter(f=>f.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(__dirname,'..',file),'utf8');
        if (html.includes('js/db-service.js')) assert.ok(html.indexOf('js/teacher-shift-state.js') < html.indexOf('js/db-service.js') && html.includes('js/teacher-shift-state.js'), `${file} shares the same roster projection`);
    }
    console.log('teacher-transfer-expiry.test.js: temporary/permanent/legacy/nested/inherited roster tests passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
