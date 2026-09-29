'use strict';
// GĐ 29/09/2026: mọi ô tìm kiếm chọn người bằng ↑ ↓ Enter. Bảo đảm: trang nào có ô tìm kiếm
// được khai báo trong SPECS thì phải nạp js/search-keynav.js (đúng một mã ?v=, có trong service
// worker), và mọi ô tìm kiếm trong các trang đều đã được khai báo (thêm ô mới mà quên khai báo → lỗi).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const moduleSource = read('js/search-keynav.js');
const context = { window: {}, document: { addEventListener() {}, getElementById() { return null; } }, console };
context.globalThis = context; vm.createContext(context);
vm.runInContext(moduleSource, context);
const SPECS = context.window.SearchKeyNav.SPECS;
assert.ok(SPECS.length >= 17, 'đủ các kiểu ô tìm kiếm');

const htmlFiles = fs.readdirSync(root).filter(file => file.endsWith('.html'));
const versions = new Set();
const declared = spec => spec.input.split(',').map(part => part.trim());
const idOf = selector => (/^#([\w-]+)$/.exec(selector) || [])[1];

const pagesWithSearch = new Set();
for (const file of htmlFiles) {
    const html = read(file);
    for (const spec of SPECS) {
        for (const selector of declared(spec)) {
            const id = idOf(selector);
            const present = id ? new RegExp(`id=["']${id}["']`).test(html)
                : (selector.includes('roster-search') ? false : selector.includes('filterAnalyticsSelect') && /oninput="filterAnalyticsSelect/.test(html));
            if (present) pagesWithSearch.add(file);
        }
    }
    const tag = /js\/search-keynav\.js\?v=([\w.-]+)/.exec(html);
    if (tag) versions.add(tag[1]);
}
for (const file of pagesWithSearch) {
    assert.match(read(file), /<script src=["']js\/search-keynav\.js\?v=[\w.-]+["']><\/script>/, `${file} có ô tìm kiếm nên phải nạp search-keynav.js`);
}
// Hộp chọn GV (roster-search) sinh ra trong schedule.js → trang xếp lịch phải nạp module.
assert.match(read('lich-lam.html'), /js\/search-keynav\.js/);
assert.equal(versions.size, 1, 'mọi trang dùng cùng một mã ?v= cho search-keynav.js');
const [version] = versions;
assert.ok(read('service-worker.js').includes(`'/js/search-keynav.js?v=${version}'`), 'service worker lưu sẵn đúng phiên bản');

// Không sót ô tìm kiếm nào: mọi <input type="search"> / placeholder "Tìm…" trong HTML phải khớp một SPEC
// (hoặc nằm trong danh sách ngoại lệ: ô nhập không phải tìm người/kết quả).
const known = new Set(SPECS.flatMap(declared).map(idOf).filter(Boolean));
const exceptions = new Set(['dash-search-unused']);
const missing = [];
for (const file of htmlFiles) {
    for (const match of read(file).matchAll(/<input\b[^>]*>/g)) {
        const tag = match[0];
        if (!/type=["']search["']|placeholder=["'][^"']*(Tìm|tìm|Lọc)/.test(tag)) continue;
        const id = (/\bid=["']([\w-]+)["']/.exec(tag) || [])[1];
        if (id && (known.has(id) || exceptions.has(id))) continue;
        if (/oninput=["']filterAnalyticsSelect/.test(tag) || /data-action=["']roster-search["']/.test(tag)) continue;
        // Ô lọc theo cột của bảng họp: khai báo theo id ở SPECS.
        missing.push(`${file}: ${tag.slice(0, 90)}`);
    }
}
assert.deepEqual(missing, [], 'ô tìm kiếm chưa khai báo trong SPECS của js/search-keynav.js');
console.log('search-keynav.test.js: all assertions passed');
