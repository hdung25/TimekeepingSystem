'use strict';
// Công cụ "Ngày nghỉ lễ" (27/09/2026): đặt nghỉ HÀNG LOẠT cho toàn trung tâm, kể cả ngày đã qua
// (Quốc khánh 01–02/09/2026). Dữ liệu vẫn là settings/system.centerClosures như cũ; tên ngày nghỉ
// ở centerHolidayNames. Kiểm tra phần tính toán thuần, transaction (giả lập), nhãn hiển thị và
// cách gắn vào trang Xếp Lịch / Cài đặt hệ thống.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const CH = require('../js/center-holidays.js');

(async () => {
    // ---------- Khoảng ngày ----------
    assert.deepEqual(CH.expandDateRange('2026-09-01', '2026-09-02'), ['2026-09-01', '2026-09-02']);
    assert.deepEqual(CH.expandDateRange('2026-08-31', '2026-09-01'), ['2026-08-31', '2026-09-01'], 'qua tháng');
    assert.deepEqual(CH.expandDateRange('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01'], 'qua năm');
    assert.deepEqual(CH.expandDateRange('2026-09-02'), ['2026-09-02'], 'một ngày');
    assert.equal(CH.expandDateRange('2026-01-01', '2026-03-03').length, 62);
    assert.throws(() => CH.expandDateRange('2026-09-02', '2026-09-01'), /phải bằng hoặc sau/);
    assert.throws(() => CH.expandDateRange('2026-02-30', '2026-03-01'), /hợp lệ/, 'ngày không tồn tại');
    assert.throws(() => CH.expandDateRange('', ''), /hợp lệ/);
    assert.throws(() => CH.expandDateRange('2026-01-01', '2026-03-04'), /tối đa 62 ngày/);

    // ---------- Kế hoạch ghi: chỉ THÊM phạm vi nghỉ, giữ ca đã tắt riêng ----------
    const settings = {
        centerClosures: { '2026-09-01': ['morning1'], '2026-10-05': ['evening'] },
        centerHolidayNames: { '2026-10-05': 'Cũ' }
    };
    const plan = CH.planApply(settings, ['2026-09-01', '2026-09-02'], 'all', '  Quốc   khánh ');
    assert.deepEqual(plan.updates, {
        'centerClosures.2026-09-01': ['morning1', 'all'],
        'centerHolidayNames.2026-09-01': 'Quốc khánh',
        'centerClosures.2026-09-02': ['all'],
        'centerHolidayNames.2026-09-02': 'Quốc khánh'
    });
    assert.deepEqual(plan.changed, ['2026-09-01', '2026-09-02']);
    assert.deepEqual(plan.closures['2026-10-05'], ['evening'], 'ngày khác giữ nguyên');
    assert.equal(plan.names['2026-10-05'], 'Cũ');
    assert.deepEqual(settings.centerClosures['2026-09-01'], ['morning1'], 'không sửa object gốc');
    const again = CH.planApply({ centerClosures: plan.closures }, ['2026-09-01'], 'all', '');
    assert.deepEqual(again.changed, [], 'áp dụng lại không tạo khóa trùng');
    assert.equal('centerHolidayNames.2026-09-01' in again.updates, false, 'không nhập tên thì giữ tên cũ');
    assert.deepEqual(CH.planApply({}, ['2026-09-03'], 'evening', '').updates, { 'centerClosures.2026-09-03': ['evening'] });
    assert.throws(() => CH.planApply({}, ['2026-09-03'], 'night', ''), /Phạm vi/);
    assert.throws(() => CH.planApply({}, [], 'all', ''), /chọn ngày/);
    assert.equal(CH.planApply({}, ['2026-09-03'], 'all', 'x'.repeat(80)).name.length, 40, 'tên tối đa 40 ký tự');

    const DELETE = { sentinel: 'delete' };
    const removal = CH.planRemove({ centerClosures: plan.closures, centerHolidayNames: plan.names }, '2026-09-01', DELETE);
    assert.deepEqual(removal.updates, { 'centerClosures.2026-09-01': DELETE, 'centerHolidayNames.2026-09-01': DELETE });
    assert.equal('2026-09-01' in removal.closures, false);
    assert.equal('2026-09-01' in removal.names, false);
    assert.deepEqual(removal.previous, ['morning1', 'all']);
    assert.throws(() => CH.planRemove({}, '01/09/2026', DELETE), /hợp lệ/);

    // ---------- Danh sách + nhãn ----------
    const listing = CH.listEntries({
        centerClosures: { '2026-09-02': ['all'], '2026-09-01': ['all'], '2026-08-01': ['morning'], '2026-09-03': [], bad: ['all'] },
        centerHolidayNames: { '2026-09-01': 'Quốc khánh' }
    }, { from: '2026-08-15' });
    assert.deepEqual(listing.map(item => item.date), ['2026-09-01', '2026-09-02'], 'sắp xếp, bỏ ngày rỗng/sai, lọc từ ngày');
    assert.equal(listing[0].scopeLabel, 'Cả ngày');
    assert.equal(listing[0].name, 'Quốc khánh');
    assert.equal(listing[1].name, 'Quốc khánh', 'ngày lễ chính thức có tên sẵn');
    assert.equal(CH.describeKeys(['morning', 'evening2']), 'Buổi sáng, Tối ca 2');
    assert.equal(CH.holidayLabel('2026-09-05', { centerHolidayNames: { '2026-09-05': 'Đã mở lại' } }), '', 'tên cũ của ngày đã mở lại không hiện');
    assert.equal(CH.holidayLabel('2026-09-05', { centerClosures: { '2026-09-05': ['all'] } }), 'Trung tâm nghỉ');
    assert.equal(CH.holidayLabel('2026-09-05', { centerClosures: { '2026-09-05': ['evening'] } }), '', 'nghỉ một buổi không gắn nhãn cả ngày');
    assert.equal(CH.officialHolidayName('2026-09-01'), 'Quốc khánh');
    assert.equal(CH.officialHolidayName('2027-09-01'), '', 'ngày nghỉ kèm Quốc khánh thay đổi theo năm');

    const presets = CH.presetHolidays(new Date('2026-09-27T05:00:00Z'));
    assert.deepEqual(presets.map(p => `${p.from}..${p.to} ${p.name}`), [
        '2026-09-01..2026-09-02 Quốc khánh',
        '2027-01-01..2027-01-01 Tết Dương lịch'
    ], 'gợi ý: Quốc khánh vừa qua + ngày lễ sắp tới');

    // ---------- Transaction (giả lập Firestore) ----------
    const stored = { centerClosures: { '2026-09-01': ['morning1'] } };
    const writes = [];
    const events = [];
    const invalidated = [];
    const ref = { path: 'settings/system' };
    globalThis.db = {
        collection: name => ({ doc: id => { assert.equal(`${name}/${id}`, 'settings/system'); return ref; } }),
        runTransaction: async fn => fn({
            get: async target => { assert.equal(target, ref); return { exists: true, data: () => JSON.parse(JSON.stringify(stored)) }; },
            update: (target, data) => { assert.equal(target, ref); writes.push(data); }
        })
    };
    globalThis.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS', delete: () => DELETE } } };
    globalThis.localStorage = { getItem: key => ({ userFullName: 'Quản Trị Viên', currentUserId: 'fixture-admin' }[key] || null) };
    globalThis.DBService = { _invalidate: key => invalidated.push(key) };
    globalThis.dispatchEvent = event => events.push(event.type);
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
    const applied = await CH.applyRange({ from: '2026-09-01', to: '2026-09-02', scope: 'all', name: 'Quốc khánh' });
    assert.equal(writes.length, 1, 'một transaction cho cả khoảng ngày');
    assert.deepEqual(writes[0]['centerClosures.2026-09-01'], ['morning1', 'all']);
    assert.deepEqual(writes[0]['centerClosures.2026-09-02'], ['all']);
    assert.equal(writes[0]['centerHolidayNames.2026-09-02'], 'Quốc khánh');
    assert.equal(writes[0].centerClosuresUpdatedAt, 'SERVER_TS');
    assert.deepEqual(writes[0].centerClosuresUpdatedBy, { id: 'fixture-admin', name: 'Quản Trị Viên' });
    assert.deepEqual(applied.dates, ['2026-09-01', '2026-09-02']);
    assert.deepEqual(globalThis.centerClosures['2026-09-02'], ['all'], 'trang hiện tại thấy ngay trạng thái mới');
    assert.equal(globalThis.centerHolidayNames['2026-09-01'], 'Quốc khánh');
    assert.deepEqual(invalidated, ['system_settings'], 'bỏ cache cấu hình (DBService là const toàn cục, không nằm trên window)');
    assert.deepEqual(events, ['tdt:center-closures-changed']);

    await CH.reopenDate('2026-09-01');
    assert.deepEqual(writes[1], {
        'centerClosures.2026-09-01': DELETE,
        'centerHolidayNames.2026-09-01': DELETE,
        centerClosuresUpdatedAt: 'SERVER_TS',
        centerClosuresUpdatedBy: { id: 'fixture-admin', name: 'Quản Trị Viên' }
    });
    await assert.rejects(CH.applyRange({ from: '2026-09-02', to: '2026-09-01', scope: 'all' }), /phải bằng hoặc sau/);
    assert.equal(writes.length, 2, 'khoảng ngày sai thì không ghi gì');

    // ---------- Gắn vào trang ----------
    const source = read('js/center-holidays.js');
    assert.match(source, /typeof UIService !== 'undefined' \? UIService/, 'UIService là const toàn cục, không đọc qua window (lỗi: hộp xác nhận không hiện)');
    assert.match(source, /escapeHtml\(message\)/, 'nội dung hộp thoại/toast được escape (tên ngày nghỉ do người dùng nhập)');
    const lichLam = read('lich-lam.html');
    assert.match(lichLam, /<div id="admin-actions" style="display: none; gap:0\.5rem; flex-wrap:wrap;">\s*<button id="btn-center-holidays"[^>]*onclick="CenterHolidays\.openManager\(\)"/,
        'nút Ngày nghỉ lễ nằm trong nhóm nút chỉ người xếp lịch thấy');
    assert.match(lichLam, /<script src="js\/schedule\.js\?v=[^"]+"><\/script>\s*<script src="js\/center-holidays\.js\?v=[^"]+"><\/script>/);
    const heThong = read('he-thong.html');
    assert.match(heThong, /onclick="CenterHolidays\.openManager\(\)"/);
    assert.match(heThong, /<script src="js\/center-holidays\.js\?v=[^"]+"><\/script>/);
    assert.match(heThong, /addEventListener\('tdt:center-closures-changed', \(\) => \{ loadSettings\(\); \}\)/);

    // Nhãn ngày lễ: 01/09/2026 là Quốc khánh; tên tuỳ chọn chỉ khi ngày đang nghỉ; được escape.
    const report = read('js/report.js');
    const holidayFn = report.slice(report.indexOf('function getHolidayName'), report.indexOf('// ================= CORE REPORT RENDERING'));
    const getHolidayName = new Function('window', holidayFn + '\nreturn getHolidayName;');
    assert.equal(getHolidayName({})('2026-09-01'), 'Quốc Khánh');
    assert.equal(getHolidayName({})('2026-09-02'), 'Quốc Khánh');
    assert.equal(getHolidayName({ centerClosures: { '2026-09-10': ['all'] }, centerHolidayNames: { '2026-09-10': 'Bão' } })('2026-09-10'), 'Bão');
    assert.equal(getHolidayName({ centerClosures: {}, centerHolidayNames: { '2026-09-10': 'Bão' } })('2026-09-10'), null);
    assert.equal(getHolidayName({ centerClosures: { '2026-09-11': ['all'] } })('2026-09-11'), 'Trung tâm nghỉ');
    assert.match(report, /\$\{escapeReportHtml\(holidayName\)\}/);
    assert.match(report, /window\.centerHolidayNames = settings\?\.centerHolidayNames \|\| \{\};/);
    const schedule = read('js/schedule.js');
    assert.match(schedule, /\$\{scheduleEscapeHTML\(holiday\)\}/, 'Xếp Lịch: tên ngày nghỉ được escape');
    assert.match(schedule, /window\.centerHolidayNames = settings\.centerHolidayNames \|\| \{\};/);

    // Chấm Công: tắt theo buổi (công cụ ghi 'morning') phải tắt cả ca 1 và ca 2 của buổi đó.
    const timekeeping = read('js/timekeeping.js');
    const closedFn = timekeeping.slice(timekeeping.indexOf('function isCenterClosed'), timekeeping.indexOf('// 1. Global Check-in Rendering'));
    const isClosed = new Function(closedFn + '\nreturn isCenterClosed;')();
    assert.equal(isClosed('2026-09-01', 'morning2', { '2026-09-01': ['morning'] }), true);
    assert.equal(isClosed('2026-09-01', 'afternoon1', { '2026-09-01': ['morning'] }), false);
    assert.equal(isClosed('2026-09-01', 'evening1', { '2026-09-01': ['all'] }), true);
    assert.equal(isClosed('2026-09-01', 'evening1', { '2026-09-01': 'all' }), false, 'dữ liệu hỏng không làm vỡ trang');

    console.log('center-holidays.test.js: all assertions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
