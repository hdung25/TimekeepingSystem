'use strict';
// Read-only: bản lương tháng 9 lưu theo luật chuyên cần cũ (v2) mà có VP ≥ 2.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
(async () => {
    const r = await fetch(`${root}:runQuery`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'salary_settings_monthly' }], where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'GREATER_THAN_OR_EQUAL', value: { referenceValue: 'projects/timekeeping-69f3f/databases/(default)/documents/salary_settings_monthly/2026-09_' } } }, limit: 200 } }) });
    const rows = (await r.json()).filter(x => x.document && x.document.name.includes('/2026-09_')).map(x => ({ id: x.document.name.split('/').pop(), ...decodeFields(x.document.fields) }));
    rows.forEach(d => {
        const ev = ((d.giao_vien || d['giao-vien'] || {}).evaluation || [])[0];
        if (!ev || !String(ev.automatic || '').startsWith('teacher-attendance-excel')) return;
        console.log(d.id, ev.automatic, 'amount', ev.amount, '|', ev.note, '| status_gv', d.published?.status_gv);
    });
})().catch(e => { console.error(e.message); process.exitCode = 1; });
