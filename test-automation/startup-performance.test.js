'use strict';
// Tốc độ mở app (phản hồi 12/09/2026): script có phiên bản phải lấy từ bộ nhớ đệm ngay,
// không chờ mạng; mỗi tệp chỉ một mã ?v= để bộ đệm không giữ nội dung cũ; thư viện icon
// phải ghim phiên bản; tự ra ca đọc lịch 3 cơ sở song song.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const workerSource = read('service-worker.js');
const rootHtml = fs.readdirSync(root).filter(file => file.endsWith('.html'));
const withTimeout = (promise, label, ms = 1000) => Promise.race([
    promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))
]);

// ---------- Service worker fetch strategy ----------
function loadWorker() {
    const handlers = {};
    const store = new Map();
    const network = { calls: [], next: null };
    const cache = {
        match: async request => store.get(request.url),
        put: async (request, response) => { store.set(request.url, response); },
        addAll: async () => {}
    };
    const context = {
        URL, Set, Array, Promise, console,
        self: {
            addEventListener: (name, handler) => { handlers[name] = handler; },
            location: { origin: 'https://app.test' },
            clients: { claim: async () => {}, matchAll: async () => [] }
        },
        caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async request => store.get(request.url) },
        fetch: request => { network.calls.push(request.url); return network.next(request); }
    };
    vm.createContext(context);
    vm.runInContext(workerSource, context);
    const dispatch = (url, accept = '*/*') => {
        const event = {
            request: { url, method: 'GET', headers: { get: () => accept } },
            responded: null, extended: [],
            respondWith(promise) { this.responded = Promise.resolve(promise); },
            waitUntil(promise) { this.extended.push(promise); }
        };
        handlers.fetch(event);
        return event;
    };
    return { dispatch, store, network };
}
const response = body => ({ ok: true, body, clone() { return response(body + ':copy'); } });

(async () => {
    const asset = 'https://app.test/js/db-service.js?v=20260912-release';
    {
        const sw = loadWorker();
        sw.store.set(asset, response('cached'));
        sw.network.next = () => new Promise(() => {}); // mạng rất chậm / treo
        const event = sw.dispatch(asset);
        const served = await withTimeout(event.responded, 'script có ?v= không được chờ mạng khi đã có bản lưu');
        assert.equal(served.body, 'cached');
        assert.deepEqual(sw.network.calls, [asset], 'vẫn cập nhật bản lưu ở nền');
        assert.equal(event.extended.length, 1, 'cập nhật nền phải giữ service worker sống tới khi xong');
    }
    {
        const sw = loadWorker();
        sw.store.set(asset, response('cached'));
        sw.network.next = async () => response('fresh');
        const event = sw.dispatch(asset);
        assert.equal((await event.responded).body, 'cached');
        await Promise.all(event.extended);
        assert.equal(sw.store.get(asset).body, 'fresh:copy', 'lần mở sau nhận bản mới đã tải ở nền');
    }
    {
        const sw = loadWorker();
        sw.network.next = async () => response('network');
        const event = sw.dispatch(asset);
        assert.equal((await event.responded).body, 'network', 'chưa có bản lưu thì lấy từ mạng');
        await Promise.all(event.extended);
        assert.equal(sw.store.get(asset).body, 'network:copy');
    }
    for (const url of ['https://app.test/cham-cong.html', 'https://app.test/', 'https://app.test/js/archiver.js']) {
        const sw = loadWorker();
        sw.store.set(url, response('old'));
        sw.network.next = async () => response('deployed');
        const event = sw.dispatch(url, 'text/html');
        assert.equal((await event.responded).body, 'deployed', `${url} phải ưu tiên mạng để bản deploy mới hiện ngay`);
        const offline = loadWorker();
        offline.store.set(url, response('old'));
        offline.network.next = async () => { throw new Error('offline'); };
        assert.equal((await offline.dispatch(url, 'text/html').responded).body, 'old', `${url} mất mạng thì dùng bản lưu`);
    }
    {
        const sw = loadWorker();
        sw.network.next = async () => response('x');
        const event = sw.dispatch('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
        assert.equal(event.responded, null, 'không can thiệp tài nguyên bên thứ ba');
    }

    // ---------- One version key per asset ----------
    // Bộ đệm theo ?v= chỉ an toàn khi mọi trang dùng cùng một mã cho cùng một tệp.
    const refs = new Map();
    const addRef = (file, version, where) => {
        if (!refs.has(file)) refs.set(file, new Map());
        const versions = refs.get(file);
        if (!versions.has(version)) versions.set(version, []);
        versions.get(version).push(where);
    };
    for (const file of rootHtml) {
        for (const match of read(file).matchAll(/(?:src|href)=["']\/?((?:js|css)\/[\w.-]+\.(?:js|css))\?v=([\w.-]+)["']/g)) {
            addRef(match[1], match[2], file);
        }
    }
    const staticAssets = workerSource.match(/const STATIC_ASSETS = Array\.from\(new Set\(\[([\s\S]*?)\]\)\);/)[1];
    for (const match of staticAssets.matchAll(/'\/((?:js|css)\/[\w.-]+\.(?:js|css))\?v=([\w.-]+)'/g)) {
        addRef(match[1], match[2], 'service-worker.js');
    }
    // cham-cong.html giữ khóa cũ có chủ đích (xem chú thích trong service-worker.js);
    // ui-service.js không đổi kể từ trước mã này nên nội dung vẫn trùng.
    const allowedLegacy = { 'js/ui-service.js': ['20260829-location-diagnostics-v3'] };
    for (const [file, versions] of refs) {
        const current = [...versions.keys()].filter(version => !(allowedLegacy[file] || []).includes(version));
        assert.equal(current.length, 1,
            `${file} đang có nhiều mã ?v= (${[...versions].map(([v, w]) => `${v}: ${w.join(', ')}`).join(' | ')})`);
    }

    // ---------- Icon library pinned ----------
    for (const file of rootHtml) {
        const html = read(file);
        assert.doesNotMatch(html, /lucide@latest/, `${file} không được tải lucide@latest (redirect + tải lại mỗi bản mới)`);
        if (html.includes('unpkg.com/lucide')) {
            assert.match(html, /https:\/\/unpkg\.com\/lucide@1\.45\.0\/dist\/umd\/lucide\.min\.js/, `${file} phải ghim lucide`);
        }
    }

    // ---------- Auto check-out reads all branches in parallel ----------
    const main = read('js/main.js');
    const blocksStart = main.indexOf('async function findReceptionistShiftBlocks');
    const teachingStart = main.indexOf('async function findTeachingBlocks');
    const blocksEnd = main.indexOf('\n}\n', teachingStart) + 3;
    assert.ok(blocksStart !== -1 && teachingStart > blocksStart && blocksEnd > teachingStart);
    const gate = expected => {
        let started = 0; let open;
        const opened = new Promise(resolve => { open = resolve; });
        return value => { if (++started === expected) open(); return opened.then(() => value); };
    };
    const receptionistGate = gate(3);
    const officeGate = gate(3);
    const teachingGate = gate(3);
    const monday = '2026-09-07';
    const weeks = {
        [`cs1__${monday}`]: { morning: { sat: [{ id: 'staff-1', customStart: '07:00', customEnd: '11:30' }] } },
        [`cs2__${monday}`]: { afternoon: { sat: [{ id: 'staff-1', customStart: '13:00', customEnd: '17:00' }] } }
    };
    const officeWeeks = { [`cs2__${monday}`]: { evening: { sat: [{ id: 'staff-1', customStart: '17:30', customEnd: '21:00' }] } } };
    const schedules = {
        'cs1__2026-09-12': { morning1: [{ gvId: 'staff-1', start: '07:30', end: '09:00' }, { gvId: 'staff-1', shiftId: 'cancel-me', start: '09:15', end: '10:45' }] },
        'cs2__2026-09-12': { evening1: [{ gvId: 'other', subId: 'staff-1', start: '18:00', end: '19:30' }] },
        'cs3__2026-09-12': { evening2: [{ gvId: 'other', start: '19:30', end: '21:00' }] }
    };
    const blocks = new Function('DBService', 'getVietnamDateFromHM', 'isAutoCheckoutShiftClosed', 'isScheduledSubstitute',
        'isScheduledMainTeacher', 'isMainTeacherAbsentFromClass', 'console',
        main.slice(blocksStart, blocksEnd) + '\nreturn { findReceptionistShiftBlocks, findTeachingBlocks };')(
        {
            getReceptionistSchedule: key => receptionistGate(weeks[key] || null),
            getOfficeSchedule: key => officeGate(officeWeeks[key] || null),
            getReceptionistShiftConfig: async () => ({}),
            getOfficeShiftConfig: async () => ({}),
            getSchedule: key => teachingGate(schedules[key] || null)
        },
        (dateKey, hm) => new Date(`${dateKey}T${hm}:00+07:00`),
        () => false,
        (cls, id) => cls.subId === id,
        (cls, id) => cls.gvId === id,
        () => false,
        { log() {}, warn(error) { throw error; }, error() {} });
    const iso = list => list.map(item => `${item.kind}:${item.start.toISOString()}-${item.end.toISOString()}`);
    const receptionist = await withTimeout(
        blocks.findReceptionistShiftBlocks('staff-1', '2026-09-12', [`cs2_${monday}_afternoon_sat`], {}),
        'lịch tiếp tân/văn phòng 3 cơ sở phải đọc song song');
    assert.deepEqual(iso(receptionist), [
        'tiep-tan:2026-09-12T00:00:00.000Z-2026-09-12T04:30:00.000Z',
        'van-phong:2026-09-12T10:30:00.000Z-2026-09-12T14:00:00.000Z'
    ], 'giữ nguyên thứ tự cơ sở và bỏ ca đã hủy như trước');
    const teaching = await withTimeout(
        blocks.findTeachingBlocks('staff-1', '2026-09-12', ['shift:cancel-me'], {}),
        'lịch lớp 3 cơ sở phải đọc song song');
    assert.deepEqual(iso(teaching), [
        'day:2026-09-12T00:30:00.000Z-2026-09-12T02:00:00.000Z',
        'day:2026-09-12T11:00:00.000Z-2026-09-12T12:30:00.000Z'
    ]);

    console.log('startup-performance.test.js: all assertions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
