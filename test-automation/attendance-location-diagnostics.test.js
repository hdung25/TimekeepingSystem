const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const db = fs.readFileSync(path.join(root, 'js', 'db-service.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

const functionStart = db.indexOf('async function recordAttendanceLocationFailure');
const functionEnd = db.indexOf('\nfunction getBrowserLocation', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'phải có hàm ghi chẩn đoán vị trí');
const diagnosticFunction = db.slice(functionStart, functionEnd);
const payloadStart = diagnosticFunction.indexOf('.set({');
const payloadEnd = diagnosticFunction.indexOf('\n        });', payloadStart);
assert.ok(payloadStart >= 0 && payloadEnd > payloadStart, 'không tìm thấy payload chẩn đoán');
const payload = diagnosticFunction.slice(payloadStart, payloadEnd);

for (const forbidden of ['latitude', 'longitude', 'accuracy', 'distance', 'coords', 'userAgent']) {
    assert.doesNotMatch(payload, new RegExp(forbidden, 'i'),
        `payload chẩn đoán không được lưu ${forbidden}`);
}
for (const required of [
    'authUid', 'staffId', 'dateKey', 'code', 'stage', 'permissionState',
    'browserContext', 'platform', 'secureContext', 'online', 'appVersion', 'createdAt'
]) {
    assert.match(payload, new RegExp(`\\b${required}\\b`), `payload phải có ${required}`);
}

assert.match(db, /!\['TIMEOUT', 'POSITION_UNAVAILABLE'\]\.includes\(initialCode\)/,
    'chỉ được chạy chu kỳ phục hồi cho timeout hoặc position unavailable');
assert.match(db, /getBrowserLocationFromWatch\(campuses\)/,
    'timeout/unavailable phải có đúng một watcher fresh cuối');
assert.match(db, /maximumAge:\s*0/,
    'watcher phục hồi không được dùng vị trí cache');
assert.match(db, /geolocation\.clearWatch\(watchId\)/,
    'watcher phải luôn có đường dọn tài nguyên');

assert.match(rules, /match \/attendance_location_events\/\{eventId\}/);
assert.match(rules, /request\.resource\.data\.authUid == request\.auth\.uid/);
assert.match(rules, /request\.resource\.data\.staffId == getUserId\(\)/,
    'nhân viên chỉ được ghi chẩn đoán cho chính hồ sơ của mình');
assert.match(rules, /request\.resource\.data\.keys\(\)\.hasOnly/);
assert.match(rules, /allow read, delete: if isAuthenticated\(\) && isAdmin\(\)/);
assert.match(rules, /allow update: if false/);
assert.doesNotMatch(
    rules.match(/match \/attendance_location_events\/\{eventId\}[\s\S]*?\n    \}/)?.[0] || '',
    /latitude|longitude|accuracy|distance|coords|userAgent/i,
    'rules không được chấp nhận dữ liệu vị trí chi tiết'
);

console.log('attendance-location-diagnostics.test.js: all assertions passed');
