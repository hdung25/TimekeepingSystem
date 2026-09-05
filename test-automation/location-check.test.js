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

function loadHooks(responses = [], watchResponses = [], options = {}) {
    const calls = [];
    const watchCalls = [];
    const clearedWatchIds = [];
    let nextWatchId = 1;
    const currentResponses = [...responses];
    const watchedResponses = [...watchResponses];
    const navigator = {
        permissions: options.permissionState ? {query:async()=>({state:options.permissionState})} : undefined,
        geolocation: {
            getCurrentPosition(success, failure, options) {
                calls.push(options);
                const next = currentResponses.shift();
                queueMicrotask(() => {
                    if (next?.error) failure({
                        code: next.error,
                        PERMISSION_DENIED: 1,
                        POSITION_UNAVAILABLE: 2,
                        TIMEOUT: 3
                    });
                    else success(next);
                });
            },
            watchPosition(success, failure, watchOptions) {
                watchCalls.push(watchOptions);
                const watchId = nextWatchId++;
                const emitNext = () => {
                    const next = watchedResponses.shift();
                    if (!next) return;
                    queueMicrotask(() => {
                        if (next.error) failure({
                            code: next.error,
                            PERMISSION_DENIED: 1,
                            POSITION_UNAVAILABLE: 2,
                            TIMEOUT: 3
                        });
                        else success(next);
                        emitNext();
                    });
                };
                emitNext();
                return watchId;
            },
            clearWatch(watchId) {
                clearedWatchIds.push(watchId);
            }
        }
    };
    const maxTimerMs = options.maxTimerMs ?? 30;
    const context = {
        console,
        navigator,
        window: {},
        Number,
        Math,
        Date,
        Promise,
        queueMicrotask,
        setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, maxTimerMs)),
        clearTimeout
    };
    vm.createContext(context);
    vm.runInContext(`${locationSource}\n;globalThis.hooks = { getConfiguredGPSCampuses, getBrowserLocationFromWatch, assertAttendanceLocationAllowed, ATTENDANCE_LOCATION_PUBLIC_MESSAGE };`, context);
    return { hooks: context.hooks, calls, watchCalls, clearedWatchIds };
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
        const { hooks, calls, watchCalls, clearedWatchIds } = loadHooks([
            makePosition(11, 107, 100)
        ], [
            makePosition(11, 107, 40),
            makePosition(10.0001, 106.0001, 15)
        ]);
        assert.equal(await hooks.assertAttendanceLocationAllowed(settings), true);
        assert.equal(calls.length, 1, 'điểm đầu nằm ngoài vùng chỉ được mở một watcher phục hồi');
        assert.equal(watchCalls.length, 1);
        assert.equal(calls[0].maximumAge, 0, 'mỗi lần Vào ca phải xác minh vị trí mới');
        assert.equal(watchCalls[0].maximumAge, 0, 'watcher xác minh lại không được dùng cache của thiết bị');
        assert.equal(clearedWatchIds.length, 1, 'watcher phải được dọn ngay khi có điểm hợp lệ');
    }

    {
        const { hooks, calls } = loadHooks([makePosition(10.0001, 106.0001, 15)]);
        assert.equal(await hooks.assertAttendanceLocationAllowed(settings), true);
        assert.equal(calls.length, 1, 'điểm hợp lệ không gọi định vị dư thừa');
    }

    {
        const { hooks, calls } = loadHooks([makePosition(10,106),makePosition(10,106)]);
        await hooks.assertAttendanceLocationAllowed(settings);
        await hooks.assertAttendanceLocationAllowed(settings);
        assert.equal(calls.length,2,'không tái sử dụng điểm của lần chấm công trước');
        assert.equal(hooks.getConfiguredGPSCampuses({gpsCS1Lat:null,gpsCS1Lng:' '}).length,0);
        await assert.rejects(hooks.assertAttendanceLocationAllowed({}), e=>e.code==='CONFIG_UNAVAILABLE');
    }

    {
        const { hooks, calls, watchCalls, clearedWatchIds } = loadHooks(
            [{error:1}], [makePosition(10,106)], {permissionState:'granted'});
        await hooks.assertAttendanceLocationAllowed(settings);
        assert.equal(calls.length,1);
        assert.equal(watchCalls.length,1,'chỉ phục hồi một lần khi provider báo từ chối nhưng quyền đang granted');
        assert.equal(clearedWatchIds.length,1);
        const denied = loadHooks([{error:1}],[],{permissionState:'denied'});
        await assert.rejects(denied.hooks.assertAttendanceLocationAllowed(settings), e=>e.code==='PERMISSION_DENIED');
        assert.equal(denied.watchCalls.length,0,'không tự hỏi lại khi quyền đã bị từ chối');
        const stillDenied = loadHooks([{error:1}],[{error:1}],{permissionState:'granted'});
        await assert.rejects(stillDenied.hooks.assertAttendanceLocationAllowed(settings), e=>e.code==='RECOVERY_PERMISSION_DENIED');
        assert.equal(stillDenied.watchCalls.length,1);
    }

    {
        const { hooks, calls, watchCalls, clearedWatchIds } = loadHooks([
            { error: 3 },
            { error: 2 }
        ], [
            { error: 2 },
            makePosition(10.0001, 106.0001, 15)
        ]);
        assert.equal(await hooks.assertAttendanceLocationAllowed(settings), true);
        assert.equal(calls.length, 2,
            'timeout + approximate unavailable không được bắn thêm one-shot liên tiếp');
        assert.equal(watchCalls.length, 1, 'phải chạy đúng một watcher fresh cuối');
        assert.equal(watchCalls[0].maximumAge, 0, 'watcher phục hồi cuối không được dùng cache');
        assert.equal(clearedWatchIds.length, 1);
    }

    {
        const { hooks, calls, watchCalls } = loadHooks([
            { error: 3 },
            { error: 1 }
        ]);
        await assert.rejects(
            hooks.assertAttendanceLocationAllowed(settings),
            error => error.name === 'AttendanceLocationError' && error.code === 'PERMISSION_DENIED'
        );
        assert.equal(calls.length, 2, 'fallback phải bảo toàn mã từ chối quyền');
        assert.equal(watchCalls.length, 0, 'từ chối quyền không được mở watcher phục hồi');
    }

    {
        const { hooks, calls, watchCalls } = loadHooks([{ error: 1 }]);
        await assert.rejects(
            hooks.assertAttendanceLocationAllowed(settings),
            error => error.name === 'AttendanceLocationError' &&
                error.code === 'PERMISSION_DENIED' &&
                error.message === hooks.ATTENDANCE_LOCATION_PUBLIC_MESSAGE
        );
        assert.equal(calls.length, 1, 'bị từ chối quyền không được lặp popup xin quyền');
        assert.equal(watchCalls.length, 0);
    }

    {
        const { hooks, calls, watchCalls, clearedWatchIds } = loadHooks([
            makePosition(11, 107, 10)
        ], [
            makePosition(11, 107, 10)
        ]);
        await assert.rejects(
            hooks.assertAttendanceLocationAllowed({
                ...settings,
                enableIPCheck: true,
                allowedIP: '203.0.113.10',
                ddnsCS1: 'campus.example.test'
            }),
            error => error.name === 'AttendanceLocationError' &&
                error.code === 'OUTSIDE_ALLOWED_RADIUS' &&
                error.message === hooks.ATTENDANCE_LOCATION_PUBLIC_MESSAGE
        );
        assert.equal(calls.length, 1,
            'IP/DDNS dù được cấu hình cũng không được bypass GPS nằm ngoài cơ sở');
        assert.equal(watchCalls.length, 1);
        assert.equal(clearedWatchIds.length, 1, 'watcher ngoài vùng cũng phải được dọn khi hết hạn');
    }

    {
        const { hooks, watchCalls, clearedWatchIds } = loadHooks([], [{ error: 1 }]);
        const campuses = hooks.getConfiguredGPSCampuses(settings);
        await assert.rejects(
            hooks.getBrowserLocationFromWatch(campuses, { timeout: 20 }),
            error => error.locationCode === 'PERMISSION_DENIED'
        );
        assert.equal(watchCalls.length, 1);
        assert.equal(clearedWatchIds.length, 1, 'watcher phải dọn ngay khi quyền bị từ chối');
    }

    {
        const { hooks, watchCalls, clearedWatchIds } = loadHooks([], [], { maxTimerMs: 10 });
        const campuses = hooks.getConfiguredGPSCampuses(settings);
        await assert.rejects(
            hooks.getBrowserLocationFromWatch(campuses, { timeout: 5 }),
            error => error.locationCode === 'TIMEOUT'
        );
        assert.equal(watchCalls.length, 1);
        assert.equal(clearedWatchIds.length, 1, 'watcher phải dọn khi chạm deadline');
    }

    assert.equal(
        loadHooks([]).hooks.ATTENDANCE_LOCATION_PUBLIC_MESSAGE,
        'IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để chấm công.'
    );
    assert.doesNotMatch(
        loadHooks([]).hooks.ATTENDANCE_LOCATION_PUBLIC_MESSAGE,
        /GPS|location|vị trí|định vị/i,
        'thông báo cho nhân viên tuyệt đối không được lộ cơ chế GPS'
    );

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
    assert.match(dbSource, /void recordAttendanceLocationFailure\([\s\S]*?locationError\?\.code/,
        'lỗi cổng vị trí khởi động ghi chẩn đoán nhưng không khóa nút khi mất mạng');
    const checkInSource = dbSource.slice(
        dbSource.indexOf('checkInPersonal: async'),
        dbSource.indexOf('checkOutPersonal: async')
    );
    assert.match(checkInSource, /await assertAttendanceLocationAllowed\(settings\)/,
        'Rule HD: GPS phải luôn là cổng kiểm tra thật của VÀO CA');
    assert.doesNotMatch(
        checkInSource,
        /allowedIP|enableIPCheck|resolveDDNS|dns\.google|getAttendancePublicIP|assertAttendanceNetworkOrLocationAllowed|api4?\.ipify/,
        'Rule HD: IP/Wifi chỉ là thông điệp che cơ chế GPS, không được phép bypass GPS'
    );
    const prepareSource = dbSource.slice(
        dbSource.indexOf('prepareAttendanceLocationPermission: async'),
        dbSource.indexOf('createScheduleIfMissing: async')
    );
    assert.match(prepareSource, /getConfiguredGPSCampuses\(settings\)/);
    assert.match(prepareSource, /assertAttendanceLocationAllowed\(settings\)/);
    assert.doesNotMatch(
        prepareSource,
        /allowedIP|enableIPCheck|resolveDDNS|dns\.google|ipify|AttendanceNetwork/,
        'luồng chuẩn bị quyền cũng phải giữ GPS-only'
    );
    assert.doesNotMatch(
        dbSource,
        /assertAttendanceNetworkOrLocationAllowed|getAttendancePublicIP|resolveDDNS|dns\.google|api4?\.ipify/,
        'không được tái đưa đường xác thực IP thật vào dịch vụ chấm công');

    console.log('location-check.test.js: all assertions passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
