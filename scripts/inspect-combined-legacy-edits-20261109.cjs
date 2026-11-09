'use strict';
// Read-only (09/11/2026): ca Admin sửa tay kiểu cũ (isAdminEdited, không có ghi đè tuyệt đối) có role gồm ≥2 môn.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const dec = d => d ? { id: d.name.split('/').pop(), ...decodeFields(d.fields) } : null;
const FROM = process.argv[2] || '2026-10-01';
const WHO = (process.argv[3] || '').toLowerCase();
(async () => {
    const r = await fetch(`${root}:runQuery`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'attendance_logs' }],
            where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: FROM } } } } }) });
    const logs = (await r.json()).filter(x => x.document).map(x => dec(x.document));
    const u = await fetch(`${root}/users?pageSize=300`, { headers: H });
    const users = new Map(((await u.json()).documents || []).map(dec).map(x => [x.id, x]));
    const out = [];
    for (const log of logs) for (const s of (log.sessions || [])) {
        const name = users.get(log.userId)?.name || log.userId;
        const multi = String(s.role || '').includes('+') || /\+/.test(String(s.roleName || ''));
        if (WHO ? name.toLowerCase().includes(WHO) && (s.isAdminEdited || s.adminPayrollOverride) : (s.isAdminEdited && multi && !s.adminPayrollOverride))
            out.push({ date: log.date, staff: name, userId: log.userId, sessionId: s.id, in: String(s.checkIn).slice(11, 16), out: String(s.checkOut).slice(11, 16), role: s.role, roleName: s.roleName,
                roleRate: s.roleRate, subjectOverride: s.subjectOverride, src: s.roleAssignmentSource, linked: s.linkedClassStart, ovr: s.adminPayrollOverride ? s.adminPayrollOverride.mode : '' });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    console.log('count', out.length); out.forEach(x => console.log(JSON.stringify(x)));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
