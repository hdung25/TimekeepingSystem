'use strict';
// Read-only: Bùi Như Quỳnh tháng 9 — dòng chuyên cần đã lưu.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const get = async p => { const r = await fetch(`${root}/${p}`, { headers: H }); if (r.status === 404) return null; if (!r.ok) throw Error(p + r.status); return r.json(); };
const dec = d => d ? { id: d.name.split('/').pop(), updateTime: d.updateTime, ...decodeFields(d.fields) } : null;
(async () => {
    const r = await fetch(`${root}/users?pageSize=300`, { headers: H }); const users = (await r.json()).documents.map(dec).filter(u => /quỳnh|quynh/i.test(u.name + u.username));
    users.forEach(u => console.log(u.id, u.name, u.username, u.roles, 'mode=', u.teachingMode));
    for (const u of users) {
        const m = dec(await get(`salary_settings_monthly/2026-09_${u.id}`));
        if (!m) continue;
        const gv = m.giao_vien || m['giao-vien'] || {};
        console.log('==', u.name, 'updated', m.updateTime, 'status_gv', m.published?.status_gv);
        console.log(' eval:', JSON.stringify((gv.evaluation || []).slice(0, 2)));
        console.log(' published eval:', JSON.stringify((m.published?.details_gv?.evaluation || []).slice(0, 2)).slice(0, 600));
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
