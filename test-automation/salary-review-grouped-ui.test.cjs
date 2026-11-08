'use strict';
// Local browser fixture only: no Firebase, authentication, or production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
(async () => {
    const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    try {
        const page = await browser.newPage();
        await page.setBypassCSP(true);
        await page.setRequestInterception(true);
        page.on('request', request => request.abort());
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 1366, height: 900 });
        await page.setContent(read('xet-tang-luong.html').replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
        await page.addStyleTag({ content: (read('css/style.css') + read('css/salary-review.css')).replace(/@import[^;]+;/g, '') });
        await page.evaluate(() => { window.DBService = {}; window.SalaryReviewService = {}; });
        for (const file of ['staff-code-order.js', 'salary-review-policy.js', 'salary-review-application.js', 'salary-review-overview-policy.js', 'salary-review-board-policy.js', 'salary-review-board.js']) {
            await page.addScriptTag({ content: read('js/' + file) });
        }
        await page.evaluate(() => {
            const state = window.SalaryReviewBoard.state;
            state.index = { config: { cycleMonths: 3 }, profiles: [] };
            state.tab = 'all';
            state.rows = [0, 1, 2, 3].map(i => ({ staffId: i < 3 ? 'a' : 'b', key: i < 3 ? 'a|g' + i : 'b|g3',
                name: i < 3 ? 'Trần Gia Bảo' : 'Trần Thị Trang Anh', code: i < 3 ? 'BAO01' : 'ANH03', msnv: i < 3 ? '01' : '03',
                group: { id: 'g' + i, name: i === 0 ? 'Tiếng Anh' : 'Nhảy', subjectIds: ['s' + i] },
                subjects: [{ id: 's' + i, name: i === 0 ? 'Mover 1' : 'Nhảy', rate: 22000 + i * 1000 }],
                currentRate: i === 2 ? 22000 : 22000 + i * 1000, nextRate: 26000, confirmed: true, baselineDate: '2026-07-01',
                evaluation: { dueDate: '2026-10-01', visibleThisMonth: true, overdue: true }, category: 'due',
                stats: { observed: 2, averageHours: 25.9 }, attendance: 88 }));
            window.SalaryReviewBoard.render();
        });
        assert.equal(await page.$$eval('.srb-teacher', els => els.length), 2);
        assert.equal(await page.$$eval('.srb-teacher[open]', els => els.length), 0);
        await page.click('[data-teacher="a"] > summary .srb-who');
        await page.waitForSelector('[data-teacher="a"][open]');
        await page.click('[data-select-teacher="a"]');
        assert.equal(await page.evaluate(() => window.SalaryReviewBoard.state.selected.size), 3);
        await page.click('[data-action="teacher-setup"][data-staff="a"]');
        assert.equal(await page.$eval('#srb-dialog', el => el.open), true);
        assert.equal(await page.$eval('#srb-setup-title', el => el.textContent), 'Thiết lập chung cho Trần Gia Bảo');
        assert.deepEqual(await page.evaluate(() => window.SalaryReviewBoard.state.setup.keys), ['a|g0', 'a|g1', 'a|g2']);
        assert.equal(await page.$('#srb-setup-form [name="currentRate"]'), null, 'common setup must not overwrite different current prices');
        assert.equal(await page.$eval('#srb-setup-form [name="baselineDate"]', el => el.value), '2026-07-01', 'shared baseline is prefilled, not blank');
        await page.evaluate(() => {
            const state = window.SalaryReviewBoard.state;
            window.__fixtureRows = state.rows;
            window.__savedProfiles = [];
            window.__profile = { staffId: 'a', revision: 1, personOverrides: {}, groups: state.rows.filter(row => row.staffId === 'a').map(row => ({
                ...row.group, currentRate: row.currentRate, baselineDate: row.baselineDate, confirmed: true, enabled: true
            })) };
            window.SalaryReviewService.document = (collection, id) => ({ collection, id });
            window.SalaryReviewService.read = async () => structuredClone(window.__profile);
            window.SalaryReviewService.saveProfile = async (id, draft, revision) => {
                window.__savedProfiles.push({ id, draft: structuredClone(draft), revision });
                window.__profile = { ...structuredClone(draft), revision: revision + 1 };
            };
            state.index.users = [];
            state.index.subjects = [];
            const cycle = document.querySelector('#srb-setup-form [name="cycleMonths"]');
            cycle.value = '6'; cycle.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.click('#srb-setup-form [type="submit"]');
        await page.waitForFunction(() => !window.SalaryReviewBoard.state.busy && !document.getElementById('srb-dialog').open);
        assert.deepEqual(await page.evaluate(() => window.__savedProfiles.map(save => ({ id: save.id,
            groups: save.draft.groups.map(group => ({ price: group.currentRate, cycle: group.cycleMonths, baseline: group.baselineDate })) }))),
            [{ id: 'a', groups: [{ price: 22000, cycle: 6, baseline: '2026-07-01' }, { price: 23000, cycle: 6, baseline: '2026-07-01' }, { price: 22000, cycle: 6, baseline: '2026-07-01' }] }],
            'one teacher save updates the common cycle and preserves each group price and baseline');
        await page.evaluate(() => { window.SalaryReviewBoard.state.rows = window.__fixtureRows; window.SalaryReviewBoard.render(); });
        await page.click('[data-action="teacher-increase"][data-staff="a"]');
        assert.equal(await page.$$eval('[data-bulk-rate]', els => els.length), 2, 'three groups with two prices need only two rate inputs');
        await page.$eval('[data-bulk-rate="a|g0"]', el => { el.value = '28000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.deepEqual(await page.evaluate(() => window.SalaryReviewBoard.state.bulk.items.map(i => [i.key, i.rate])),
            [['a|g0', '28000'], ['a|g1', 26000], ['a|g2', '28000']]);
        // Owner 08/11: "tăng lương 1 số lớp thôi" — untick a price bucket, or one subject after "Tách từng môn".
        await page.evaluate(() => {
            window.__prepared = []; window.__applied = 0; window.__decided = []; window.confirm = () => true;
            window.SalaryReviewService.decide = async (staffId, groupId, command) => { window.__decided.push({ staffId, groupId, kind: command.kind, next: command.nextReviewDate, reason: command.reason }); };
            window.SalaryReviewService.prepareApplication = async (staffId, groupId, options) => {
                window.__prepared.push({ staffId, groupId, rate: options.newRate, subjects: options.selectedSubjectIds });
                return { preview: { changes: [], clearedDrafts: [], followers: [] } };
            };
            window.SalaryReviewService.applyApplication = async () => { window.__applied++; };
        });
        await page.$eval('[data-action="bulk-skip"][data-bucket="a|23000"]', el => el.click());
        assert.equal(await page.$('[data-bulk-rate="a|g1"]'), null, 'Giữ nguyên hides the rate input');
        assert.equal(await page.$eval('[data-action="bulk-skip"][data-bucket="a|23000"]', el => el.textContent), 'Tăng lại');
        assert.match(await page.$eval('[data-action="bulk-apply"]', el => el.textContent), /Duyệt 2 mức/);
        // Owner: 'Nhảy không tăng' — the subject name next to the price is a Giữ nguyên toggle, no split needed.
        await page.$eval('[data-action="bulk-keep"][data-keep="a|g2|s2"]', el => el.click());
        assert.match(await page.$eval('[data-action="bulk-apply"]', el => el.textContent), /Duyệt 1 mức/);
        fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
        await (await page.$('#srb-bulk')).screenshot({ path: path.join(root, 'scratch/salary-review-partial-bulk.png') });
        await page.setViewport({ width: 390, height: 844 });
        await (await page.$('#srb-bulk')).screenshot({ path: path.join(root, 'scratch/salary-review-partial-bulk-phone.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'bulk panel fits a phone');
        await page.setViewport({ width: 1366, height: 900 });
        await page.$eval('[data-action="bulk-keep"][data-keep="a|g0|s0"]', el => el.click());
        assert.equal(await page.$eval('[data-action="bulk-apply"]', el => el.disabled), true, 'nothing ticked → cannot approve');
        await page.$eval('[data-action="bulk-keep"][data-keep="a|g0|s0"]', el => el.click());
        // A kept bucket with an unchanged price must not block the others (the 100.000đ → 100000 error).
        await page.$eval('[data-action="bulk-apply"]', el => el.click());
        await page.waitForFunction(() => !window.SalaryReviewBoard.state.busy && !window.SalaryReviewBoard.state.bulk);
        assert.deepEqual(await page.evaluate(() => window.__prepared), [{ staffId: 'a', groupId: 'g0', rate: 28000, subjects: ['s0'] }],
            'only the ticked class is approved; unticked ones keep their price');
        assert.equal(await page.evaluate(() => window.__applied), 1);
        const keptA = await page.evaluate(() => window.__decided);
        assert.deepEqual(keptA.map(d => [d.staffId, d.groupId, d.kind]), [['a', 'g1', 'not_increased'], ['a', 'g2', 'not_increased']],
            'owner: a raise for some classes counts as reviewed — kept classes get the next review, not Quá hạn');
        assert.ok(keptA.every(d => d.next > new Date().toISOString().slice(0, 10) && /Giữ nguyên giá/.test(d.reason)));
        // One price group with two subjects: raise only one of them → group split, kept part not approved.
        await page.evaluate(() => {
            window.__prepared = []; window.__savedProfiles = []; window.__decided = [];
            const base = { staffId: 'c', name: 'Lê Văn C', code: 'C05', msnv: '05', confirmed: true, baselineDate: '2026-07-01', nextRate: 34000,
                currentRate: 30000, evaluation: { dueDate: '2026-10-01', visibleThisMonth: true, overdue: true }, category: 'due', stats: { observed: 3, averageHours: 20 }, attendance: 90 };
            window.__profile = { staffId: 'c', revision: 1, personOverrides: {}, groups: [{ id: 'g5', name: 'Tiếng Anh', subjectIds: ['s5', 's6'], currentRate: 30000,
                baselineDate: '2026-07-01', confirmed: true, enabled: true, cycleMonths: 6 }] };
            window.SalaryReviewBoard.state.rows = [{ ...base, key: 'c|g5', group: structuredClone(window.__profile.groups[0]),
                subjects: [{ id: 's5', name: 'Flyer 1', rate: 30000 }, { id: 's6', name: 'Flyer 2', rate: 30000 }] }];
            window.SalaryReviewBoard.render();
        });
        await page.$eval('[data-action="teacher-increase"][data-staff="c"]', el => el.click());
        await page.$eval('[data-action="bulk-split"][data-bucket="c|30000"]', el => el.click());
        await page.$eval('[data-action="bulk-keep"][data-keep="c|g5|s6"]', el => el.click());
        await page.$eval('[data-action="bulk-apply"]', el => el.click());
        await page.waitForFunction(() => !window.SalaryReviewBoard.state.busy && !window.SalaryReviewBoard.state.bulk);
        const split = await page.evaluate(() => ({ prepared: window.__prepared,
            groups: window.__profile.groups.map(g => ({ id: g.id.startsWith('g5:tach-') ? 'new' : g.id, subjects: g.subjectIds, rate: g.currentRate, cycle: g.cycleMonths })) }));
        assert.deepEqual(split.prepared, [{ staffId: 'c', groupId: 'g5', rate: 34000, subjects: ['s5'] }], 'only Flyer 1 is approved');
        assert.deepEqual(split.groups, [{ id: 'g5', subjects: ['s5'], rate: 30000, cycle: 6 }, { id: 'new', subjects: ['s6'], rate: 30000, cycle: 6 }],
            'Flyer 2 keeps its price in its own review group with the same cycle');
        assert.deepEqual(await page.evaluate(() => window.__decided.map(d => [d.staffId, d.groupId.startsWith('g5:tach-'), d.kind])), [['c', true, 'not_increased']],
            'the kept Flyer 2 part is recorded as reviewed');
        await page.evaluate(() => { window.SalaryReviewBoard.state.rows = window.__fixtureRows; window.SalaryReviewBoard.render(); });
        await page.click('[data-key="a|g0"][data-action="toggle"]');
        assert.equal(await page.$eval('.srb-panel', el => el.textContent.includes('Mover 1')), true);
        assert.ok(await page.$('.srb-panel [data-action="keep"]'), 'single row offers Giữ nguyên mức này');
        assert.equal(await page.$eval('.srb-panel', el => el.textContent.includes('Nhảy:')), false, 'approval preview stays scoped to the chosen group');
        await page.click('[data-tab="due"]');
        assert.equal(await page.$$eval('.srb-teacher', els => els.length), 2);
        await page.$eval('#srb-search', el => { el.value = 'Mover'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.equal(await page.$$eval('.srb-teacher', els => els.length), 1);
        assert.equal(await page.$$eval('.srb-group-row', els => els.length), 1);
        await page.$eval('#srb-search', el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
        fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
        await page.screenshot({ path: path.join(root, 'scratch/salary-review-grouped-desktop.png'), fullPage: true });
        await page.setViewport({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'grouped board fits a phone');
        await page.screenshot({ path: path.join(root, 'scratch/salary-review-grouped-mobile.png'), fullPage: true });
        assert.deepEqual(errors, []);
        console.log('salary-review-grouped-ui.test.cjs: teacher grouping, selection, group approval preview, filters and phone layout passed');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
