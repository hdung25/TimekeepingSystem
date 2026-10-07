'use strict';
// Read-only: 25/09 E5 (Thùy VĐX) + 22/09 Vy combined class rows.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
async function request(url) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) });
    if (r.status === 404) return null;
    if (!r.ok) throw Error('Firestore read failed: ' + r.status);
    return r.json();
}
const dec = d => d ? { id: d.name.split('/').pop(), updateTime: d.updateTime, ...decodeFields(d.fields) } : null;
(async () => {
    const out = {};
    for (const [key, filter] of [['cs1__2026-09-25', r => /E5/i.test(r.lop || '')], ['cs2__2026-09-22', r => /18:00/.test(r.start || r.gioBatDau || JSON.stringify(r).slice(0, 400))]]) {
        const doc = dec(await request(root + '/schedules/' + key));
        out[key] = { updateTime: doc && doc.updateTime, rows: Object.entries(doc || {}).filter(([, v]) => Array.isArray(v)).flatMap(([section, rows]) => rows.filter(filter).map(row => ({ section, row }))) };
    }
    console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
