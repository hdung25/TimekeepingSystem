'use strict';
// Read-only: cô Vy 23/10/2026 — thêm ca 16h–18h báo trùng ca 16:15–18:00 dù trung tâm chưa tạo ca đó.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const dec = d => d ? { id: d.name.split('/').pop(), ...decodeFields(d.fields) } : null;
const DATE = '2026-10-23';
(async () => {
    const r = await fetch(`${root}:runQuery`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'attendance_logs' }], where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'EQUAL', value: { stringValue: DATE } } } } }) });
    if (!r.ok) throw Error(r.status + await r.text());
    const logs = (await r.json()).filter(x => x.document).map(x => ({ ...dec(x.document), _updateTime: x.document.updateTime }));
    const u = await fetch(`${root}/users?pageSize=300`, { headers: H });
    const users = ((await u.json()).documents || []).map(dec);
    const vys = users.filter(x => /vy/i.test(String(x.name || '')));
    console.log('USERS named Vy:', vys.map(x => `${x.id} ${x.name} ${x.staffCode || ''}`).join(' | '));
    for (const l of logs.filter(l => vys.some(v => v.id === l.userId))) {
        console.log('\n', l.id, l.userId, 'docUpdate', l._updateTime);
        (l.sessions || []).forEach(s => console.log('   ', JSON.stringify(s)));
    }
    // Any log on another date whose sessions are anchored to / fall on 23/10.
    for (const v of vys) {
        const q = await fetch(`${root}:runQuery`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'attendance_logs' }], where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: v.id } } } } }) });
        const all = (await q.json()).filter(x => x.document).map(x => dec(x.document));
        for (const l of all) for (const s of (l.sessions || [])) {
            if (l.date !== DATE && (String(s.checkIn || s.start || '').startsWith(DATE) || s.anchorDateKey === DATE))
                console.log('CROSS-DOC', v.name, l.id, JSON.stringify(s));
        }
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
