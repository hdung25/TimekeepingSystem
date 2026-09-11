// Mốc TỰ RA CA của ngày làm việc: nối các khúc việc liền nhau (ca trực + lớp dạy) để
// nhân viên chỉ bấm vào ca một lần, nhưng KHÔNG được nối sang ca tối cách mấy tiếng —
// buổi tối họ vẫn bấm vào ca như bình thường.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// main.js chạy trong trình duyệt (đụng document ngay khi nạp) nên chỉ trích đúng phần
// thuần logic ra chạy thử. Nếu đổi tên hàm thì test đỏ ngay — đúng ý đồ.
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const gapConst = source.match(/const AUTO_CHECKOUT_GAP_MS[^\n]*\n/);
const fnStart = source.indexOf('function resolveWorkChainEnd');
const fnEnd = source.indexOf('\n}\n', fnStart);
assert.ok(gapConst && fnStart !== -1 && fnEnd !== -1,
    'không tìm thấy AUTO_CHECKOUT_GAP_MS / resolveWorkChainEnd trong js/main.js');

const context = { console, Date, Math, Number };
vm.createContext(context);
vm.runInContext(gapConst[0] + source.slice(fnStart, fnEnd + 3), context);

const DAY = '2026-08-05';
const at = hm => new Date(DAY + 'T' + hm + ':00');
const block = (a, b, kind) => ({ start: at(a), end: at(b), kind: kind || 'day' });
const hhmm = d => (d ? d.toTimeString().slice(0, 5) : null);

{
    // Vừa trực tiếp tân 07:00–11:00 vừa có lớp 07:30–09:00: vào ca 1 lần lúc 07:00,
    // ra ca lúc 11:00 (trước đây bị ra lúc 09:00 nên phải bấm vào ca lần 2).
    const blocks = [block('07:00', '11:00', 'tiep-tan'), block('07:30', '09:00')];
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('07:00'))), '11:00');
}

{
    // Có thêm ca tối 18:00–21:00: vào ca buổi sáng KHÔNG được kéo tới 21:00.
    const blocks = [
        block('07:00', '11:00', 'tiep-tan'),
        block('07:30', '09:00'),
        block('18:00', '21:00')
    ];
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('07:00'))), '11:00',
        'ca tối cách nhiều tiếng không được nối vào mạch sáng');
    // Tối họ bấm vào ca như bình thường → mạch tối tan lúc 21:00.
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('17:55'))), '21:00');
}

{
    // Hai lớp cách nhau 15p (ra chơi) vẫn là một mạch → không bắt bấm vào ca lần 2.
    const blocks = [block('07:30', '09:00'), block('09:15', '10:45')];
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('07:25'))), '10:45');
}

{
    // Nghỉ trưa dài (12:00 → 14:30) thì cắt mạch, chiều bấm vào ca lại.
    const blocks = [block('09:00', '12:00'), block('14:30', '16:00')];
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('09:00'))), '12:00');
}

{
    // Ba ca trực liền nhau cả ngày vẫn nối thành một mạch.
    const blocks = [
        block('07:00', '11:30', 'tiep-tan'),
        block('11:30', '17:30', 'tiep-tan'),
        block('17:30', '21:00', 'tiep-tan')
    ];
    assert.equal(hhmm(context.resolveWorkChainEnd(blocks, at('07:00'))), '21:00');
}

{
    // Không có khúc nào khớp giờ vào ca → không tự ra ca (để admin xử lý).
    assert.equal(context.resolveWorkChainEnd([block('18:00', '21:00')], at('07:00')), null);
    assert.equal(context.resolveWorkChainEnd([], at('07:00')), null);
}

{
    // Không được ghép một ca đã kết thúc dù check-in cách giờ bắt đầu dưới 60p.
    // Lỗi cũ trả 09:45 cho check-in 10:00 rồi retry checkout vô hạn.
    assert.equal(context.resolveWorkChainEnd([block('09:15', '09:45')], at('10:00')), null);
}

assert.match(source.slice(source.indexOf('async function globalCheckAutoCheckout'), source.indexOf('// Khoảng nghỉ TỐI ĐA')),
    /getPersonalAttendance\(todayDateKey[\s\S]*getPersonalAttendance\(previousDateKey/,
    'global auto-checkout must search both today and previous-day attendance anchors');

const autoStart = source.indexOf('let globalAutoCheckoutInFlight');
const autoEnd = source.indexOf('// Khoảng nghỉ TỐI ĐA');
const actionSource = source.slice(source.indexOf('function getStaffAttendanceErrorMessage'), source.indexOf('// ================= ARCHIVER CONTROLLER'));
const timekeepingSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'timekeeping.js'), 'utf8').replace(/\r\n/g, '\n');
assert.ok(autoStart !== -1 && autoStart < autoEnd, 'không tìm thấy globalAutoCheckoutInFlight trong js/main.js');
const quiet = { log() {}, warn() {}, error() {} };
const vnDateKey = date => new Date(date.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const withTimeout = (promise, label) => Promise.race([
    promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), 2000))
]);

(async () => {
    // Điện thoại đóng băng interval lúc tan ca; mở lại app thì phải ra ca đúng mốc tan ca,
    // chỉ một transaction dù nhiều nơi cùng gọi, và vẽ lại giao diện không kẹt chờ nhau.
    const now = Date.now();
    const checkIn = new Date(now - 5 * 3600e3).toISOString();
    const shiftEnd = new Date(now - 3600e3);
    const checkOuts = [];
    const invalidated = [];
    let session = { id: 's1', checkIn, start: checkIn, checkOut: null };
    let renders = 0;
    let api;
    const service = {
        _invalidateAttendance: dateKey => invalidated.push(dateKey),
        getPersonalAttendance: async dateKey => dateKey === vnDateKey(new Date()) ? { sessions: [{ ...session }] } : null,
        getCancelledShifts: async () => [],
        getSystemSettings: async () => ({}),
        checkOutPersonal: async (userId, at) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            checkOuts.push(at.toISOString());
            session = { ...session, checkOut: at.toISOString() };
        }
    };
    api = new Function('localStorage', 'DBService', 'getLocalDateKeyFromDate', 'findReceptionistShiftBlocks',
        'findTeachingBlocks', 'resolveWorkChainEnd', 'UIService', 'renderGlobalCheckIn', 'renderTodayChips', 'console',
        source.slice(autoStart, autoEnd) + '\nreturn { globalCheckAutoCheckout };')(
        { getItem: () => 'staff-1' }, service, vnDateKey,
        async () => [{ start: new Date(now - 5.2 * 3600e3), end: shiftEnd, kind: 'tiep-tan' }],
        async () => [], context.resolveWorkChainEnd, undefined,
        async () => { renders++; await api.globalCheckAutoCheckout({ refreshUi: false }); },
        () => {}, quiet);
    const results = await withTimeout(Promise.all([
        api.globalCheckAutoCheckout({ fresh: true }),
        api.globalCheckAutoCheckout(),
        api.globalCheckAutoCheckout({ fresh: true, refreshUi: false })
    ]), 'tự ra ca không được kẹt chờ lượt vẽ lại do chính nó gọi');
    assert.deepEqual(checkOuts, [shiftEnd.toISOString()], 'ra ca đúng một lần, đúng mốc tan ca theo lịch');
    assert.deepEqual(results, [true, true, true]);
    assert.equal(renders, 1, 'chỉ lượt vừa ra ca mới vẽ lại khung chấm công');
    assert.ok(invalidated.includes(vnDateKey(new Date())), 'mở lại app phải đọc chấm công mới, không dùng cache cũ');
    invalidated.length = 0;
    assert.equal(await api.globalCheckAutoCheckout(), false, 'ca đã đóng thì không ghi thêm');
    assert.equal(invalidated.length, 0, 'interval 60s không được bỏ cache (tránh đọc Firestore mỗi phút)');

    // Bấm VÀO CA / RA CA khi ca trước đã quá giờ tan: khép ca theo lịch trước.
    const order = [];
    const loadActions = autoClosed => {
        const window = {};
        const alerts = [];
        new Function('window', 'document', 'localStorage', 'DBService', 'console', 'alert', 'renderGlobalCheckIn',
            'renderTodayChips', 'globalCheckAutoCheckout', actionSource + '\nreturn {};')(
            window, { querySelector: () => null }, { getItem: () => 'staff-1' },
            { checkInPersonal: async () => order.push('checkIn'), checkOutPersonal: async () => order.push('checkOut') },
            quiet, message => alerts.push(message), async () => order.push('render'), async () => {},
            async options => { order.push(`auto:${options.fresh}:${options.refreshUi}`); return autoClosed; });
        return { window, alerts };
    };
    const overdue = loadActions(true);
    await overdue.window.globalCheckIn({ disabled: false, innerText: '' });
    assert.deepEqual(order, ['auto:true:false', 'checkIn', 'render'],
        'VÀO CA phải khép ca quá giờ trước, nếu không checkInPersonal chặn "còn ca chưa kết thúc"');
    order.length = 0;
    await overdue.window.globalCheckOut({ disabled: false, innerText: '' });
    assert.deepEqual(order, ['auto:true:false', 'render'],
        'RA CA sau giờ tan ca phải ghi mốc tan ca theo lịch, không ghi giờ bấm muộn');
    assert.deepEqual(overdue.alerts, []);
    const notDue = loadActions(false);
    order.length = 0;
    await notDue.window.globalCheckOut({ disabled: false, innerText: '' });
    assert.deepEqual(order, ['auto:true:false', 'checkOut', 'render'], 'chưa tới giờ tan ca thì ra ca như cũ');

    const renderSource = timekeepingSource.slice(
        timekeepingSource.indexOf('async function renderGlobalCheckIn'), timekeepingSource.indexOf('// 2. Render History'));
    const overdueCheckIndex = renderSource.indexOf('globalCheckAutoCheckout({ refreshUi: false })');
    assert.ok(overdueCheckIndex > 0 && overdueCheckIndex < renderSource.indexOf('>ĐANG TRONG CA<'),
        'khung chấm công phải khép ca quá giờ trước khi hiện ĐANG TRONG CA / RA CA');
    assert.match(source, /const runFreshAutoCheckout = \(\) => globalCheckAutoCheckout\(\{ fresh: true \}\)/);
    assert.match(source, /visibilityState === 'visible'\) runFreshAutoCheckout\(\)/,
        'mở lại app (hết đóng băng interval) phải kiểm tra tự ra ca ngay');

    console.log('auto-checkout.test.js: all assertions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
