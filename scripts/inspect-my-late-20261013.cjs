'use strict';
// Read-only: Võ Quang Mỹ 05/10/2026 — why a 17:57 check-in shows T5p.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const dec = d => d ? { id: d.name.split('/').pop(), ...decodeFields(d.fields) } : null;
const query = async (col, field, val) => {
    const r = await fetch(`${root}:runQuery`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: val } } } } }) });
    if (!r.ok) throw Error(col + r.status + await r.text());
    return (await r.json()).filter(x => x.document).map(x => dec(x.document));
};
(async () => {
    const r = await fetch(`${root}/users?pageSize=400`, { headers: H });
    const users = (await r.json()).documents.map(dec).filter(u => /mỹ|my/i.test(String(u.name || u.fullName)) && /quang/i.test(String(u.name || u.fullName)));
    users.forEach(u => console.log('USER', u.id, u.name || u.fullName));
    const u = users[0];
    const logs = (await query('attendance_logs', 'date', '2026-10-05')).filter(l => String(l.userId) === u.id);
    console.log('LOGS', JSON.stringify(logs, null, 1));
    const obs = (await query('shift_observations', 'dateKey', '2026-10-05')).filter(o => String(o.teacherId) === u.id);
    console.log('OBS', JSON.stringify(obs, null, 1));
    for (const b of ['cs1', 'cs2', 'cs3']) {
        const s = await fetch(`${root}/schedules/${b}__2026-10-05`, { headers: H });
        if (!s.ok) continue; const d = dec(await s.json());
        for (const sec of ['evening1', 'evening2', 'afternoon2']) (d[sec] || []).forEach((c, i) => { if (JSON.stringify(c).includes(u.id)) console.log('SCHED', b, sec, i, JSON.stringify(c)); });
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
