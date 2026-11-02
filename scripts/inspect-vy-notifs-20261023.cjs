'use strict';
// Read-only: admin_notifications for Uyên Vy ngày 23/10 + schedule docs của ngày đó có tên cô.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const dec = d => d ? { id: d.name.split('/').pop(), ...decodeFields(d.fields) } : null;
const STAFF = 'nv_1781780302340';
(async () => {
    const r = await fetch(`${root}:runQuery`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'admin_notifications' }], where: { fieldFilter: { field: { fieldPath: 'staffId' }, op: 'EQUAL', value: { stringValue: STAFF } } } } }) });
    const rows = (await r.json()).filter(x => x.document).map(x => ({ ...dec(x.document), _t: x.document.createTime }))
        .filter(n => n.dateKey === '2026-10-23').sort((a, b) => a._t.localeCompare(b._t));
    rows.forEach(n => console.log(n._t, n.action, n.adminName || '', '|', n.details));
    const s = await fetch(`${root}:runQuery`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'schedules' }] } }) });
    const docs = (await s.json()).filter(x => x.document && x.document.name.includes('2026-10-23'));
    for (const d of docs) {
        const txt = JSON.stringify(dec(d.document));
        if (txt.includes(STAFF) || /Uyên Vy/i.test(txt)) {
            const m = txt.match(new RegExp('.{0,300}' + STAFF + '.{0,300}', 'g')) || [];
            console.log('\nSCHEDULE', d.document.name.split('/').pop(), d.document.updateTime);
            m.forEach(x => console.log('  ...', x));
        }
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
