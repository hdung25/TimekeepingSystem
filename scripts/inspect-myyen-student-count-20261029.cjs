'use strict';
// Read-only: Mỹ Yến 29/10/2026 — "chọn 10hs lúc lưu được, có lúc bấm 3,4 lần vẫn không lưu".
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const dec = d => d ? { id: d.name.split('/').pop(), ...decodeFields(d.fields) } : null;
const STAFF = process.argv[2] || 'nv_1777820162937';
(async () => {
    const r = await fetch(`${root}:runQuery`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'attendance_logs' }], where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: STAFF } } } } }) });
    if (!r.ok) throw Error(r.status + await r.text());
    const logs = (await r.json()).filter(x => x.document).map(x => ({ ...dec(x.document), _updateTime: x.document.updateTime }))
        .filter(l => String(l.date || l.id).startsWith('2026-10') || String(l.date || l.id).startsWith('2026-09'))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const l of logs) {
        console.log(l.date, 'docUpdate', l._updateTime, 'lastUpdated', JSON.stringify(l.lastUpdated));
        (l.sessions || []).forEach(s => console.log('   ', s.id, s.checkIn, '->', s.checkOut, s.status, s.source || '',
            'anchor=' + (s.anchorDateKey || ''), 'hs=' + (s.studentCount ?? ''), s.studentCountStatus || '', s.studentCountUpdatedAt || '', s.studentCountUpdatedBy || '',
            Object.keys(s).filter(k => !['id', 'checkIn', 'checkOut', 'status', 'source', 'anchorDateKey', 'start', 'studentCount', 'studentCountStatus', 'studentCountUpdatedAt', 'studentCountUpdatedBy'].includes(k)).join(',')));
    }
    const p = await fetch(`${root}/payslips_published/2026-10_${STAFF}`, { headers: H });
    console.log('PAYSLIP 2026-10', p.status, p.ok ? JSON.stringify(Object.fromEntries(Object.entries(dec(await p.json())).filter(([k]) => /status/i.test(k)))) : '');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
