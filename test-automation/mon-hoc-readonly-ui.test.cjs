'use strict';
// v261: senior assistant / reception open Môn học read-only to reach "Bảng công nhóm · Xuất Excel".
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const fixture = role => `
window.waitAuth=async()=>{};
localStorage.setItem('currentUser','u');localStorage.setItem('currentRole',${JSON.stringify(role)});
window.fixture={writes:0};
window.DBService={_invalidate:()=>{},
 getSubjects:async()=>[{id:'g',name:'LIÊN KẾT',isGroup:true},{id:'a',name:'VẼ VIDA',parentId:'g'},{id:'o',name:'Tiếng Anh'}],
 saveSubject:async()=>{window.fixture.writes++;},saveSubjectsBatch:async()=>{window.fixture.writes++;},deleteSubject:async()=>{window.fixture.writes++;}};
window.UIService={toast(){},showLoading(){},hideLoading(){},confirm:async()=>true};
`;
async function open(browser, port, role) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
        const url = req.url();
        if (url.includes('/js/firebase-config.js')) return req.respond({contentType: 'text/javascript', body: fixture(role)});
        if (/\/js\/(db-service|main|ui-service|auth-guard)\.js/.test(url) || url.endsWith('/service-worker.js')) return req.respond({contentType: 'text/javascript', body: ''});
        if (url.startsWith('http://127.0.0.1:')) return req.continue();
        return req.abort();
    });
    await page.goto('http://127.0.0.1:' + port + '/mon-hoc.html', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => !!document.querySelector('.mh-partner-link a'));
    return {page, errors};
}
(async () => {
    const server = http.createServer((req, res) => {
        const file = path.join(root, new URL(req.url, 'http://local').pathname);
        if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, {'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await puppeteer.launch({executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox']});
    try {
        const port = server.address().port;
        for (const role of ['["receptionist"]', '["senior_assistant"]']) {
            const {page, errors} = await open(browser, port, role);
            const visible = sel => page.$$eval(sel, nodes => nodes.filter(n => n.offsetParent !== null).length);
            assert.equal(await page.$eval('.mh-partner-link a', a => a.getAttribute('href')), 'bang-cong-lien-ket.html?groupId=g', role + ' reaches the partner report');
            assert.equal(await visible('.mh-row-actions button, .mh-actions button, .mh-check'), 0, role + ' sees no edit controls');
            assert.deepEqual(await page.$$eval('.mh-item-report', a => a.map(x => x.getAttribute('href'))), ['bang-cong-lien-ket.html?groupId=g&subjectId=a'], 'each linked school links to its own report; other subjects do not');
            await page.click('.mh-item');
            assert.equal(await page.evaluate(() => document.getElementById('mh-selbar').classList.contains('open')), false, 'no bulk selection');
            await page.evaluate(() => { MonHoc.openSheet('subject'); MonHoc.edit('a'); MonHoc.remove('a'); MonHoc.bulkRemove(); });
            assert.equal(await page.evaluate(() => document.getElementById('mh-sheet').classList.contains('open')), false, 'editor never opens');
            assert.equal(await page.evaluate(() => fixture.writes), 0, role + ' writes nothing');
            if (role.includes('receptionist')) await page.screenshot({path: path.join(__dirname, 'artifacts/mon-hoc-readonly.png'), fullPage: true});
            assert.deepEqual(errors, []);
        }
        const {page} = await open(browser, port, '["admin"]');
        assert.ok(await page.$$eval('.mh-row-actions button', b => b.filter(n => n.offsetParent !== null).length) > 0, 'admin keeps edit controls');
        console.log('mon-hoc-readonly-ui: reception + senior view only, admin unchanged passed');
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
