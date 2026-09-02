const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const oversight = read('js/shift-oversight.js');
const page = read('quan-sat-ca.html');
const worker = read('service-worker.js');

assert.match(oversight, /const OVERSIGHT_BRANCHES = \['cs1', 'cs2', 'cs3'\]/,
    'Oversight access must inspect receptionist schedules at every branch');
assert.match(oversight, /Promise\.all\(OVERSIGHT_BRANCHES\.map\(branch =>[\s\S]*?getReceptionistSchedule/,
    'All branch rosters must load before deciding access');
assert.match(oversight, /state\.currentUserAssignments = OVERSIGHT_BRANCHES\.flatMap/,
    'Access must be granted from an assignment at any branch');
assert.match(oversight, /state\.canOperate = true;[\s\S]*?Đã mở tự động/,
    'An assigned receptionist must receive automatic operation access');
assert.doesNotMatch(oversight, /addEventListener\('click', activateCurrentShift\)/,
    'Manual shift activation must not be required');
assert.match(oversight, /await ensureObservationAccess\(\);[\s\S]*?await DBService\.createShiftObservation/,
    'The technical presence document must be created automatically before saving');
assert.match(oversight, /ensureObservationAccess[\s\S]*?DBService\.activateReceptionistShift\([\s\S]*?state\.branch/,
    'Automatic presence must target the branch currently being observed');
assert.match(page, /shift-oversight\.js\?v=20260902-policy-payroll-absence-v1/,
    'The operation page must bypass stale browser caches');
assert.match(worker, /tdt-chamcong-v144-policy-payroll-absence-20260902/,
    'The service worker cache must be bumped for the new access policy');

console.log('✓ Cross-branch receptionist oversight access tests passed');
