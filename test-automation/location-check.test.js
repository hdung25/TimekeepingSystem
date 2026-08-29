const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const dbSource = fs.readFileSync(path.join(root, 'js', 'db-service.js'), 'utf8').replace(/\r\n/g, '\n');
const timekeepingSource = fs.readFileSync(path.join(root, 'js', 'timekeeping.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'js', 'ui-service.js'), 'utf8');

const start = dbSource.indexOf('const LOCATION_CACHE_TTL_MS');
const end = dbSource.indexOf('\nconst DBService =', start);
assert.ok(start >= 0 && end > start, 'không tìm thấy khối xử lý vị trí chấm công');
const locationSource = dbSource.slice(start, end);

function makePosition(latitude, longitude, accuracy = 20) {
    return { coords: { latitude, longitude, accuracy } };
}

function loadHooks(responses) {
    const calls = [];
    const navigator = {
        geolocation: {
            getCurrentPosition(success, failure, options) {
                calls.push(options);
                const next = responses.shift();
                queueMicrotask(() => {
                    if (next?.error) failure({
                        code: next.error,
                        PERMISSION_DENIED: 1,
                        POSITION_UNAVAILABLE: 2,
                        TIMEOUT: 3
                    });
                    else success(next);
                });
            }
        }
    };
    const context = { console, navigator, window: {}, Number, Math, Date, Promise, queueMicrotask };
    vm.createContext(context);
    vm.runInContext(`${locationSource}\n;globalThis.hooks = { getConfiguredGPSCampuses, assertAttendanceLocationAllowed, ATTENDANCE_LOCATION_PUBLIC_MESSAGE };`, context);
    return { hooks: context.hooks, calls };
}

const settings = { gpsCS1Lat: 10, gpsCS1Lng: 106, gpsCS1Radius: 200 };

(async () => {
    {
        const { hooks } = loadHooks([]);
        const configured = hooks.getConfiguredGPSCampuses({
            gpsCS1Lat: '10', gpsCS1Lng: '106', gpsCS1Radius: '200',
            gpsCS2Lat: 'not-a-number', gpsCS2Lng: 106,
            gpsCS3Lat: 91, gpsCS3Lng: 106
        });
        assert.equal(configured.length, 1, 'chỉ tọa độ hữu hạn và trong miền hợp lệ được dùng');
        assert.deepEqual(JSON.parse(JSON.stringify(configured[0])), { lat: 10, lng: 106, radius: 200, name: 'CS1' });
    }

    {
        const { hooks, calls } = loadHooks([
            makePosition(11, 107, 100),
            makePosition(10.0001, 106.0001, 15)
        ]);
        assert.equal(await hooks.assertAttendanceLocationAllowed(settings), true);
        assert.equal(calls.length, 2, 'vị trí cache nằm ngoài vùng phải lấy lại một điểm mới');
        assert.equal(calls[0].maximumAge, 120000);
        assert.equal(calls[1].maximumAge, 0, 'lần xác minh lại không được dùng cache của thiết bị');
    }

    {
        const { hooks, calls } = loadHooks([makePosition(10.0001, 106.0001, 15)]);
        assert.equal(await hooks.assertAttendanceLocationAllowed(settings), true);
        assert.equal(calls.length, 1, 'điểm hợp lệ không gọi định vị dư thừa');
    }

    {
        const { hooks, calls } = loadHooks([
            { error: 3 },
            { error: 2 },
            makePosition(10.0001, 106.0001, 15)
        ]);
        assert.equal(await hooks.assertAttendanceLocationAllowed(settings), true);
        assert.equal(calls.length, 3,
            'timeout + approximate unavailable phải chạy đúng một chu kỳ fresh cuối');
        assert.equal(calls[2].maximumAge, 0, 'chu kỳ phục hồi cuối không được dùng cache');
    }

    {
        const { hooks, calls } = loadHooks([{ error: 1 }]);
        await assert.rejects(
            hooks.assertAttendanceLocationAllowed(settings),
            error => error.name === 'AttendanceLocationError' &&
                error.code === 'PERMISSION_DENIED' &&
                error.message === hooks.ATTENDANCE_LOCATION_PUBLIC_MESSAGE
        );
        assert.equal(calls.length, 1, 'bị từ chối quyền không được lặp popup xin quyền');
    }

    {
        const { hooks, calls } = loadHooks([
            makePosition(11, 107, 10),
            makePosition(11, 107, 10)
        ]);
        await assert.rejects(
            hooks.assertAttendanceLocationAllowed(settings),
            error => error.name === 'AttendanceLocationError' &&
                error.code === 'OUTSIDE_ALLOWED_RADIUS' &&
                error.message === hooks.ATTENDANCE_LOCATION_PUBLIC_MESSAGE
        );
        assert.equal(calls.length, 2);
    }

    assert.doesNotMatch(
        timekeepingSource,
        /prepareAttendanceLocationPermission\s*\(/,
        'trang không được tự xin vị trí khi vừa mở; phải chờ thao tác VÀO CA'
    );
    assert.match(mainSource, /await DBService\.checkInPersonal\(currentUserId, userFullName\)/);
    assert.doesNotMatch(mainSource, /withTimeout\(DBService\.checkInPersonal/,
        'không race một mutation không thể hủy với timeout giao diện');
    assert.match(mainSource, /__attendanceCheckInPending/);
    assert.match(mainSource, /await DBService\.checkOutPersonal\(currentUserId\)/);
    assert.doesNotMatch(mainSource, /withTimeout\(DBService\.checkOutPersonal/,
        'ra ca cũng phải chờ đúng kết quả transaction, không báo timeout giả');
    assert.match(mainSource, /__attendanceCheckOutPending/,
        'ra ca phải chống hai lần chạm tạo transaction đồng thời');
    assert.match(uiSource, /dataset\.toastKey/);
    assert.match(uiSource, /find\(item => item\.dataset\.toastKey === toastKey\)/,
        'cảnh báo giống nhau đang hiện phải được gộp');
    assert.match(dbSource, /await recordAttendanceLocationFailure\([\s\S]*?locationError\?\.code/,
        'lỗi cổng vị trí phải ghi mã chẩn đoán trước khi trả lỗi cho nhân viên');

    console.log('location-check.test.js: all assertions passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
