'use strict';
// Owner report 16/10/2026 (Bảng Tính Lương on a phone): "bấm vào mà đánh tên nào nó cũng
// không ra". Real browser at 390px with the real page markup, CSS and report.js search code.
// Run: node staff-search-mobile-flow.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'bao-cao.html'), 'utf8');
const report = fs.readFileSync(path.join(root, 'js/report.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const grab = name => {
    const start = report.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    let index = report.indexOf('{', start), depth = 0;
    for (; index < report.length; index++) {
        if (report[index] === '{') depth++;
        else if (report[index] === '}' && --depth === 0) break;
    }
    return report.slice(start, index + 1);
};
const pageStyle = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const selector = html.slice(html.indexOf('<div id="staff-selector-row"'), html.indexOf('<!-- Role Filter -->'));
const code = ['renderStaffDropdownItems', 'openStaffDropdown', 'closeStaffDropdownOnOutside', 'closeStaffDropdown',
    'normalizeStaffSearchText', 'staffMatchesSearch', 'filterStaffDropdown', 'selectStaffFromDropdown'].map(grab).join('\n');

(async () => {
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => request.isNavigationRequest()
            ? request.respond({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>${pageStyle}</style><body style="padding:16px"><div class="admin-control-card"><div class="modern-form-group">${selector}</div></div></body>` })
            : request.abort());
        await page.goto('http://staff-search.invalid/');
        await page.addScriptTag({ content: `var payrollWritePending = false, _cachedStaffId = null, currentDate = new Date();
            window.selectStaffFromDropdownById = id => selectStaffFromDropdown(window._allStaffList.find(u => u.id === id));
            function sanitizeReportColor() { return '#059669'; } function renderMonthReport() { window.loaded = (window.loaded || 0) + 1; }
            function updateStaffNavCode(user) { const b = document.getElementById('staff-nav-code'); b.textContent = 'Mã ' + user.username.toUpperCase() + ' · 23/69'; b.style.display = ''; }
            ${code}` });
        await page.evaluate(() => {
            window._allStaffList = [
                { id: 'u1', username: 'nhan20', name: 'Nguyễn Thị Thanh Nhàn', roles: ['receptionist'] },
                { id: 'u2', username: 'dai5', name: 'Nguyễn Đức Đại', roles: ['teacher'] },
                { id: 'u3', username: 'my58', name: 'Nguyễn Hoàng Diễm My', roles: ['teacher'] }
            ];
            const select = document.getElementById('staff-select');
            window._allStaffList.forEach(u => select.add(new Option(u.name, u.id)));
            selectStaffFromDropdown(window._allStaffList[0]);
        });
        const layout = await page.evaluate(() => {
            const box = id => document.getElementById(id).getBoundingClientRect();
            return { search: box('staff-search-input').width, next: box('btn-next-staff').right, viewport: innerWidth,
                navRow: new Set(['btn-prev-staff', 'staff-nav-code', 'btn-next-staff'].map(id => Math.round((box(id).top + box(id).bottom) / 20))).size };
        });
        assert.equal(layout.navRow, 1, 'Trước · mã · Tiếp nằm trên một hàng');
        assert.ok(layout.search > 300, `ô tìm rộng đủ gõ trên điện thoại (${layout.search}px)`);
        assert.ok(layout.next <= layout.viewport, 'nút Tiếp không bị tràn khỏi màn hình');

        const names = () => page.$$eval('.staff-dropdown-item', items => items.map(item => item.children[1].firstChild.textContent));
        await page.tap('#staff-search-input');
        assert.equal(await page.$eval('#staff-search-input', input => input.value), '', 'ô tìm trống khi mở, không nối vào tên cũ');
        assert.equal((await names()).length, 3);
        await page.keyboard.type('duc dai');
        assert.deepEqual(await names(), ['Nguyễn Đức Đại']);
        await page.$eval('#staff-search-input', input => { input.value = ''; });
        await page.keyboard.type('58');
        assert.deepEqual(await names(), ['Nguyễn Hoàng Diễm My']);
        await page.tap('.staff-dropdown-item');
        const picked = await page.evaluate(() => ({ value: document.getElementById('staff-search-input').value,
            selected: document.getElementById('staff-select').value, open: document.getElementById('staff-dropdown-list').style.display }));
        assert.deepEqual(picked, { value: 'Nguyễn Hoàng Diễm My', selected: 'u3', open: 'none' });

        // Open and leave without choosing: the current name comes back.
        await page.tap('#staff-search-input');
        await page.keyboard.type('zzz');
        assert.equal(await page.$eval('.staff-dropdown-list, #staff-dropdown-list', list => list.innerText.trim()), 'Không tìm thấy nhân viên');
        await page.touchscreen.tap(200, 800);
        assert.equal(await page.$eval('#staff-search-input', input => input.value), 'Nguyễn Hoàng Diễm My');
        await page.screenshot({ path: path.join(root, 'scratch', 'staff-search-mobile.png') });
        assert.deepEqual(errors, []);
        console.log('PASS staff search on phone: full-width box, empty on open, accent-free multi-word/code search, restore on dismiss');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
