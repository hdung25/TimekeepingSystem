'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'db-service.js'), 'utf8');
const oversight = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'shift-oversight.js'), 'utf8');
const dateFunction = service.match(/async getShiftObservationsForDate\(dateKey, staffId = ''\) \{[\s\S]*?async getShiftObservationsForMonth/);
assert.ok(dateFunction, 'date observation loader must expose an explicit optional staff scope');
assert.match(dateFunction[0], /where\('dateKey', '==', dateKey\)/);
assert.match(dateFunction[0], /if \(staffId\) query = query\.where\('teacherId', '==', staffId\)/);
assert.match(service, /DBService\.getShiftObservationsForDate\(dateKey, staffId\)/,
    'staff daily evaluation must issue an owner-constrained Firestore query');
assert.match(oversight, /DBService\.getShiftObservationsForDate\(state\.dateKey\)/,
    'privileged oversight keeps the date-wide query and relies on role rules');

console.log('shift-observation-query-scope.test.js: all assertions passed');
