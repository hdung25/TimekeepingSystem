'use strict';
// 28/09/2026: máy một tiếp tân mở Chấm Công lúc mạng không vào được máy chủ → service
// worker trả bản cham-cong.html CŨ (trước 26/09) đã lưu, còn script cũ mà trang đó trỏ tới
// thì đã bị dọn khỏi kho → trang đứng, không có nút Vào ca. Kiểm tra: cài bản mới luôn làm
// mới HTML đã lưu, lưu sẵn script của trang nhân viên, và khi dọn kho không xoá script mà
// trang đã lưu đang dùng.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const ORIGIN = 'https://app.test';

function makeResponse(body, ok = true) {
    return { ok, body, clone() { return makeResponse(body, ok); }, text: async () => body };
}

function loadWorker(serverFiles, { offline = false } = {}) {
    const handlers = {};
    const store = new Map();
    const fetched = [];
    const abs = value => new URL(typeof value === 'string' ? value : value.url, ORIGIN).href;
    const network = async request => {
        const url = abs(request);
        fetched.push({ url, cache: request.cache || '' });
        if (offline) throw new Error('offline');
        const pathName = new URL(url).pathname + new URL(url).search;
        if (!(pathName in serverFiles)) return makeResponse('404', false);
        return makeResponse(serverFiles[pathName]);
    };
    const cache = {
        match: async request => store.get(abs(request)),
        put: async (request, response) => { store.set(abs(request), response); },
        add: async request => {
            const response = await network(typeof request === 'string' ? { url: abs(request) } : request);
            if (!response.ok) throw new Error('bad status');
            store.set(abs(request), response);
        },
        keys: async () => [...store.keys()].map(url => ({ url })),
        delete: async request => store.delete(abs(request))
    };
    class Request {
        constructor(url, init = {}) { this.url = abs(url); this.cache = init.cache || ''; }
    }
    const context = {
        URL, Set, Map, Array, Promise, console, Request,
        self: {
            addEventListener: (name, handler) => { handlers[name] = handler; },
            location: { origin: ORIGIN },
            clients: { claim: async () => {}, matchAll: async () => [] }
        },
        caches: {
            open: async () => cache, keys: async () => ['tdt-chamcong-assets'], delete: async () => true,
            match: async request => store.get(abs(request))
        },
        fetch: request => network(request)
    };
    vm.createContext(context);
    vm.runInContext(workerSource, context);
    const run = async name => {
        const waits = [];
        handlers[name]({ waitUntil: promise => waits.push(promise) });
        await Promise.all(waits);
    };
    return { run, store, fetched };
}

const staticAssets = [...workerSource.match(/const STATIC_ASSETS = Array\.from\(new Set\(\[([\s\S]*?)\]\)\);/)[1]
    .matchAll(/'([^']+)'/g)].map(match => match[1]);

(async () => {
    // Máy đã có bản cũ: HTML cũ trỏ main.js?v=OLD (đã lưu), không có main.js?v=NEW.
    const newChamCong = '<script src="js/main.js?v=NEW"></script><script src=\'js/timekeeping.js?v=NEW\'></script>' +
        '<script src="https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js"></script>';
    const serverFiles = {};
    staticAssets.forEach(asset => { serverFiles[asset] = 'server ' + asset; });
    serverFiles['/cham-cong.html'] = newChamCong;
    serverFiles['/js/main.js?v=NEW'] = 'main new';
    serverFiles['/js/timekeeping.js?v=NEW'] = 'tk new';

    const sw = loadWorker(serverFiles);
    sw.store.set(`${ORIGIN}/cham-cong.html`, makeResponse('<script src="js/main.js?v=OLD"></script>'));
    sw.store.set(`${ORIGIN}/js/main.js?v=OLD`, makeResponse('main old'));
    sw.store.set(`${ORIGIN}/js/report.js?v=OLD`, makeResponse('report old'));
    await sw.run('install');

    assert.equal(sw.store.get(`${ORIGIN}/cham-cong.html`).body, newChamCong,
        'cài bản mới phải làm mới HTML đã lưu (trước đây giữ nguyên bản cũ vì "đã có trong kho")');
    assert.ok(sw.fetched.some(item => item.url === `${ORIGIN}/cham-cong.html` && item.cache === 'no-cache'),
        'HTML được xác thực lại với máy chủ, không lấy bản HTTP cache cũ');
    assert.equal(sw.store.get(`${ORIGIN}/js/main.js?v=NEW`)?.body, 'main new',
        'script của trang nhân viên được lưu sẵn để mở được khi mạng chập chờn');
    assert.equal(sw.store.get(`${ORIGIN}/js/timekeeping.js?v=NEW`)?.body, 'tk new');
    assert.ok(!sw.fetched.some(item => item.url.includes('gstatic')), 'không lưu tài nguyên bên thứ ba');

    await sw.run('activate');
    assert.ok(sw.store.has(`${ORIGIN}/js/main.js?v=NEW`), 'script trang đã lưu đang dùng không bị dọn');
    assert.ok(!sw.store.has(`${ORIGIN}/js/main.js?v=OLD`), 'bản cũ không còn trang nào dùng thì dọn');
    assert.ok(!sw.store.has(`${ORIGIN}/js/report.js?v=OLD`));

    // Cài đặt lúc mất mạng: không hỏng, giữ nguyên bản đang có.
    const offline = loadWorker(serverFiles, { offline: true });
    offline.store.set(`${ORIGIN}/cham-cong.html`, makeResponse('old shell'));
    await offline.run('install');
    assert.equal(offline.store.get(`${ORIGIN}/cham-cong.html`).body, 'old shell');

    // Mọi script/CSS mà các trang HTML thật đang dùng đều nằm trong kho sau khi cài + kích hoạt.
    const realFiles = {};
    staticAssets.forEach(asset => { realFiles[asset] = 'x'; });
    for (const page of ['index.html', 'nhan-vien.html', 'cham-cong.html', 'bao-cao.html', 'cham-bu.html']) {
        const html = fs.readFileSync(path.join(root, page), 'utf8');
        realFiles['/' + page] = html;
        for (const match of html.matchAll(/(?:src|href)=["']\/?((?:js|css)\/[\w.-]+\.(?:js|css)\?v=[\w.-]+)["']/g)) {
            realFiles['/' + match[1]] = 'asset';
        }
    }
    const real = loadWorker(realFiles);
    await real.run('install');
    await real.run('activate');
    for (const asset of Object.keys(realFiles).filter(key => key.includes('?v='))) {
        assert.ok(real.store.has(ORIGIN + asset), `${asset} phải có trong kho để trang mở được khi mạng chập chờn`);
    }

    console.log('service-worker-shell.test.js: all assertions passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
