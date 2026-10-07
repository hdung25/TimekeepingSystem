'use strict';
// Read-only: Nguyệt ngày 12 — chip tiếp tân trùng.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const get = async p => { const r = await fetch(`${root}/${p}`, { headers: H }); if (r.status === 404) return null; if (!r.ok) throw Error(p + r.status); return r.json(); };
const dec = d => d ? { id: d.name.split('/').pop(), updateTime: d.updateTime, ...decodeFields(d.fields) } : null;
(async () => {
    const r = await fetch(`${root}/staff_directory?pageSize=300`, { headers: H }); const users = (await r.json()).documents.map(dec)
        .filter(u => /nguy[eệ]t/i.test(u.name || '') || /nguyet/i.test(u.username || ''));
    console.log(users.map(u => ({ id: u.id, name: u.name, username: u.username, roles: u.roles })));
    for (const u of users) for (const date of ['2026-09-12', '2026-10-12']) {
        const a = dec(await get(`attendance_logs/${date}_${u.id}`));
        if (a) console.log(date, u.name, JSON.stringify(a.sessions, null, 0));
    }
    for (const monday of ['2026-09-08', '2026-10-12']) for (const b of ['cs1', 'cs2', 'cs3']) {
        const d = dec(await get(`receptionist_schedules/${b}_${monday}`));
        if (!d) continue;
        const hits = JSON.stringify(d).match(new RegExp(users.map(u => u.id).join('|'), 'g'));
        if (hits) console.log('recep', b, monday, JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k, v]) => /sat|sun|fri|thu|wed|tue|mon/.test(k) && JSON.stringify(v).match(users[0].id)))).slice(0, 2500));
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
