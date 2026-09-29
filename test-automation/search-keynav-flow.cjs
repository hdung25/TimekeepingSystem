'use strict';
// GĐ 29/09/2026: "ở mọi thanh tìm kiếm, bấm ↑ ↓ là chọn được người". Trình duyệt thật, cấu trúc DOM
// dựng theo đúng từng trang (id/class trùng SPECS trong js/search-keynav.js). Mỗi ca: gõ tên →
// kết quả đầu sáng sẵn → ↓ đổi người → Enter chọn đúng người → (dropdown) Esc đóng.
// Chạy: node search-keynav-flow.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'search-keynav.js'), 'utf8');
const NAMES = [['a', 'An Nhiên'], ['b', 'Bình Minh'], ['c', 'Bích Ngọc'], ['d', 'Đạt Trần']];
const norm = "s=>s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/đ/g,'d').toLowerCase()";

// Mỗi ca dựng HTML + hàm lọc theo ô nhập. list(html) trả về các mục dạng `<X data-k=id ...>`.
const items = (open, close, extra = () => '') => NAMES.map(([k, n]) => `${open.replaceAll('#K', k)}${n}${extra(k)}${close}`).join('');
const CASES = [
    { name: 'dropdown nhân viên (tháng lương)', input: '<input id="staff-search-input" oninput="flt(this.value)">',
        body: `<div id="staff-dropdown-list" style="display:none">${items('<div class="staff-dropdown-item" data-k="#K" onclick="P(\'#K\');closeStaffDropdown()">', '</div>')}</div>`,
        itemSel: '#staff-dropdown-list > div', dropdown: true,
        setup: `window.openStaffDropdown=()=>{document.getElementById('staff-dropdown-list').style.display='block'};window.closeStaffDropdown=()=>{document.getElementById('staff-dropdown-list').style.display='none'};` },
    { name: 'dropdown vai trò', input: '<input id="role-search-input" oninput="flt(this.value)">',
        body: `<div id="role-dropdown-list" style="display:none">${items('<div class="role-dropdown-item" data-k="#K" onclick="P(\'#K\');document.getElementById(\'role-dropdown-list\').style.display=\'none\'">', '</div>')}</div>`,
        itemSel: '#role-dropdown-list > div', dropdown: true,
        setup: `window.openRoleDropdown=()=>{document.getElementById('role-dropdown-list').style.display='block'};` },
    { name: 'dropdown môn học (chọn nhiều, giữ mở)', input: '<input id="subject-search-input" oninput="flt(this.value)">',
        body: `<div id="subject-dropdown-list" style="display:none">${items('<div class="subject-dropdown-item" data-k="#K" onclick="P(\'#K\')">', '</div>')}</div>`,
        itemSel: '#subject-dropdown-list > div', dropdown: true, keepsOpen: true,
        setup: `window.openSubjectDropdown=()=>{document.getElementById('subject-dropdown-list').style.display='block'};` },
    { name: 'bảng dashboard lương', input: '<input id="dash-search" oninput="flt(this.value)">',
        body: `<table><tbody id="dash-table-body">${items('<tr data-k="#K"><td>', '</td><td>', k => `<button data-salary-dashboard-action="view" onclick="P('${k}')">Xem</button>`)}</td></tr></tbody></table>`,
        itemSel: '#dash-table-body tr' },
    { name: 'gửi bảng lương hàng loạt', input: '<input id="bulk-search-input" oninput="flt(this.value)">',
        body: `<div id="bulk-publish-modal">${items('<div class="bulk-staff-row" data-k="#K"><input type="checkbox" onchange="P(\'#K\')">', '</div>')}</div>`,
        itemSel: '.bulk-staff-row' },
    { name: 'so sánh nhân viên (admin)', input: '<input id="compare-search" oninput="flt(this.value)">',
        body: `<div id="staff-compare-checkboxes">${items('<label class="compare-staff-label" data-k="#K"><input type="checkbox" onchange="P(\'#K\')">', '</label>')}</div>`,
        itemSel: '.compare-staff-label' },
    { name: 'người dự họp', input: '<input id="attendee-search-input" oninput="flt(this.value)">',
        body: `<div id="custom-attendees-list">${items('<label class="custom-attendee-item" data-k="#K"><input type="checkbox" onchange="P(\'#K\')">', '</label>')}</div>`,
        itemSel: '.custom-attendee-item' },
    { name: 'chọn tiếp tân / nhân viên văn phòng', input: '<input type="search" id="modal-staff-search" oninput="flt(this.value)">',
        body: `<div id="staff-checkbox-list">${items('<label class="staff-checkbox-item" data-k="#K"><input type="checkbox" onchange="P(\'#K\')">', '</label>')}</div>`,
        itemSel: '.staff-checkbox-item' },
    { name: 'chọn GV chính (xếp lịch)', input: '<input type="search" data-action="roster-search" data-kind="main" oninput="flt(this.value)">',
        body: `<div data-roster-list="main">${items('<label class="teacher-roster-item" data-k="#K"><input type="checkbox" onchange="P(\'#K\')">', '</label>')}</div>` +
            `<div data-roster-list="substitute"><label class="teacher-roster-item" data-k="s1"><input type="checkbox" onchange="P('s1')">Sub</label></div>`,
        itemSel: '[data-roster-list="main"] .teacher-roster-item', hideByAttr: true },
    { name: 'môn học', input: '<input id="mh-search-input" oninput="flt(this.value)">',
        body: `<div id="mh-tree">${items('<div class="mh-item" data-k="#K" onclick="P(\'#K\')">', '</div>')}</div>`, itemSel: '.mh-item' },
    { name: 'nhân sự', input: '<input id="ns-search-input" oninput="flt(this.value)">',
        body: `<div id="ns-list">${items('<div class="ns-card" data-k="#K"><span class="ns-pick" onclick="P(\'#K\')">✓</span>', '</div>')}</div>`, itemSel: '.ns-card' },
    { name: 'tường trình', input: '<input id="f-q" oninput="flt(this.value)">',
        body: `<div id="rows">${items('<div class="row" data-k="#K" onclick="P(\'#K\')">', '</div>')}</div>`, itemSel: '#rows .row' },
    { name: 'xét tăng lương (tổng quan)', input: '<input type="search" id="sro-search" oninput="flt(this.value)">',
        body: `<div id="sro-list">${items('<article class="sro-person" data-k="#K"><input type="checkbox" data-select="#K" onchange="P(\'#K\')">', '</article>')}</div>`, itemSel: '.sro-person' },
    { name: 'xét tăng lương (danh sách)', input: '<input type="search" id="sr-search" oninput="flt(this.value)">',
        body: `<div id="sr-list">${items('<button type="button" class="sr-person" data-k="#K" onclick="P(\'#K\')">', '</button>')}</div>`, itemSel: '.sr-person' },
    { name: 'nhật ký ca (chỉ xem)', input: '<input type="search" id="log-search" oninput="flt(this.value)">',
        body: `<div id="admin-log-list">${items('<div class="log-row" data-k="#K" onclick="P(\'#K\')">', '</div>')}</div>`, itemSel: '.log-row', noPick: true },
    { name: 'lọc bảng họp', input: '<input id="filter-fullname" oninput="flt(this.value)">',
        body: `<table><tbody id="meetings-tbody">${items('<tr data-k="#K" onclick="P(\'#K\')"><td>', '</td></tr>')}</tbody></table>`, itemSel: '#meetings-tbody tr', noPick: true }
];

(async () => {
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
    assert.ok(executablePath, 'Chrome or Edge is required');
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    try {
        for (const c of CASES) {
            const page = await browser.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setRequestInterception(true);
            page.on('request', request => {
                if (request.isNavigationRequest()) request.respond({ contentType: 'text/html', body: `<!doctype html><body>${c.input}${c.body}</body>` });
                else request.abort();
            });
            await page.goto('http://keynav.invalid/');
            await page.evaluate(({ setup, norm, hideByAttr, itemSel }) => {
                window.log = [];
                window.P = k => window.log.push(k);
                const normalize = eval(norm);
                window.flt = q => {
                    const key = normalize(q);
                    document.querySelectorAll(itemSel).forEach(el => {
                        const show = !key || normalize(el.textContent).includes(key);
                        if (hideByAttr) el.hidden = !show; else el.style.display = show ? '' : 'none';
                    });
                    const list = document.querySelector('#staff-dropdown-list,#role-dropdown-list,#subject-dropdown-list');
                    if (list) list.style.display = 'block';
                };
                // eslint-disable-next-line no-eval
                eval(setup || '');
            }, { setup: c.setup, norm, hideByAttr: !!c.hideByAttr, itemSel: c.itemSel });
            await page.addScriptTag({ content: source });
            const input = await page.$('input');
            await input.focus();

            const active = () => page.evaluate(() => Array.from(document.querySelectorAll('.kn-active')).map(el => el.dataset.k || el.closest('[data-k]')?.dataset.k));
            // 1) Gõ "b" (không dấu): còn Bình Minh, Bích Ngọc → Bình sáng sẵn.
            await page.keyboard.type('b');
            await new Promise(r => setTimeout(r, 400));
            assert.deepEqual(await active(), ['b'], `${c.name}: kết quả đầu sáng sẵn sau khi gõ`);
            // 2) ↓ → Bích Ngọc; ↓ nữa quay vòng về Bình; ↑ quay lại Bích.
            await page.keyboard.press('ArrowDown');
            assert.deepEqual(await active(), ['c'], `${c.name}: ↓ sang người kế tiếp`);
            await page.keyboard.press('ArrowDown');
            assert.deepEqual(await active(), ['b'], `${c.name}: ↓ quay vòng`);
            await page.keyboard.press('ArrowUp');
            assert.deepEqual(await active(), ['c'], `${c.name}: ↑ về người trước (quay vòng)`);
            // 3) Enter chọn đúng người đang sáng.
            await page.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 250));
            const log = await page.evaluate(() => window.log);
            if (c.noPick) assert.deepEqual(log, [], `${c.name}: ô chỉ xem — Enter không kích hoạt gì`);
            else assert.deepEqual(log, ['c'], `${c.name}: Enter chọn đúng người đang sáng`);
            // 4) Dropdown: Esc đóng; ↓ mở lại và sáng người đầu.
            if (c.dropdown) {
                await page.evaluate(() => { const l = document.querySelector('#staff-dropdown-list,#role-dropdown-list,#subject-dropdown-list'); l.style.display = 'block'; });
                await page.keyboard.press('Escape');
                assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#staff-dropdown-list,#role-dropdown-list,#subject-dropdown-list')).display), 'none', `${c.name}: Esc đóng danh sách`);
                await page.evaluate(() => { document.querySelector('input').value = ''; });
                await page.keyboard.press('ArrowDown');
                assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#staff-dropdown-list,#role-dropdown-list,#subject-dropdown-list')).display), 'block', `${c.name}: ↓ mở danh sách`);
                assert.equal((await active()).length, 1, `${c.name}: ↓ khi mở sáng một người`);
                if (c.keepsOpen) assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#subject-dropdown-list')).display), 'block');
            }
            // 5) Xoá hết chữ → bỏ vệt sáng; Enter khi không có ai sáng không bị nuốt.
            await input.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await new Promise(r => setTimeout(r, 400));
            if (!c.dropdown) {
                assert.deepEqual(await active(), [], `${c.name}: ô trống thì không sáng ai`);
                const prevented = await page.evaluate(() => new Promise(resolve => {
                    const input = document.querySelector('input');
                    input.addEventListener('keydown', event => setTimeout(() => resolve(event.defaultPrevented), 0), { once: false });
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
                }));
                assert.equal(prevented, false, `${c.name}: Enter khi chưa chọn ai để trang xử lý như cũ`);
            }
            assert.deepEqual(errors, [], `${c.name}: không lỗi trang`);
            console.log(`PASS ${c.name}`);
            await page.close();
        }

        // Ô lọc <select> (Phân Tích Cá Nhân)
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (request.isNavigationRequest()) request.respond({ contentType: 'text/html', body: '<!doctype html><body><input oninput="filterAnalyticsSelect(this.value)"><select id="analytics-staff-select" onchange="window.changed=(window.changed||[]).concat(this.value)"><option value="">-- Chọn --</option><option value="a">An Nhiên</option><option value="b">Bình Minh</option><option value="c">Bích Ngọc</option></select></body>' });
            else request.abort();
        });
        await page.goto('http://keynav.invalid/');
        await page.evaluate(() => { window.filterAnalyticsSelect = q => Array.from(document.querySelector('select').options).forEach(o => { if (!o.value) return; const hide = !o.textContent.toLowerCase().includes(q.toLowerCase()); o.hidden = hide; o.style.display = hide ? 'none' : ''; }); });
        await page.addScriptTag({ content: source });
        await (await page.$('input')).focus();
        await page.keyboard.type('b');
        await new Promise(r => setTimeout(r, 400));
        assert.equal(await page.$eval('select', s => s.value), 'b', 'select: gõ xong tự chọn kết quả đầu');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.$eval('select', s => s.value), 'c');
        assert.equal(await page.evaluate(() => window.changed), undefined, 'select: chưa nạp biểu đồ khi mới di chuyển');
        await page.keyboard.press('Enter');
        assert.deepEqual(await page.evaluate(() => window.changed), ['c'], 'select: Enter mới nạp đúng người');
        console.log('PASS ô lọc danh sách chọn (Phân Tích Cá Nhân)');
        await page.close();

        // Gõ tiếng Việt bằng bộ gõ: Enter/mũi tên khi đang soạn chữ không được coi là chọn.
        const ime = await browser.newPage();
        await ime.setRequestInterception(true);
        ime.on('request', request => {
            if (request.isNavigationRequest()) request.respond({ contentType: 'text/html', body: '<!doctype html><body><input id="f-q"><div id="rows"><div class="row" onclick="window.picked=1">An</div></div></body>' });
            else request.abort();
        });
        await ime.goto('http://keynav.invalid/');
        await ime.addScriptTag({ content: source });
        const composing = await ime.evaluate(() => {
            const input = document.getElementById('f-q');
            document.querySelector('.row').classList.add('kn-active');
            const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
            input.dispatchEvent(event);
            return { prevented: event.defaultPrevented, picked: window.picked || 0 };
        });
        assert.deepEqual(composing, { prevented: false, picked: 0 }, 'đang gõ bộ gõ tiếng Việt: Enter thuộc về bộ gõ');
        console.log('PASS bộ gõ tiếng Việt không bị chặn');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
