'use strict';
// Read-only (09/11/2026): tìm ca Admin chỉnh tay đã lưu 1 phân bổ Dạy học gồm ≥2 môn
// (lớp liền nhau bị gộp thành "E2 + E8"). Không ghi gì vào Firestore.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const dec = d => d ? { id: d.name.split('/').pop(), ...decodeFields(d.fields) } : null;
const FROM = process.argv[2] || '2026-09-01';
(async () => {
    const r = await fetch(`${root}:runQuery`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'attendance_logs' }],
            where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: FROM } } } } }) });
    if (!r.ok) throw Error(r.status + await r.text());
    const logs = (await r.json()).filter(x => x.document).map(x => dec(x.document));
    const u = await fetch(`${root}/users?pageSize=300`, { headers: H });
    const users = new Map(((await u.json()).documents || []).map(dec).map(x => [x.id, x]));
    let overrides = 0;
    const hits = [];
    for (const log of logs) {
        for (const s of (log.sessions || [])) {
            const o = s.adminPayrollOverride;
            if (!o || !Array.isArray(o.allocations)) continue;
            overrides++;
            const teaching = o.allocations.filter(a => a.kind === 'teaching');
            const combined = teaching.filter(a => (a.subjectIds || []).length >= 2 || /\+/.test(String(a.roleName || '')));
            if (!combined.length) continue;
            hits.push({ date: log.date, staff: users.get(log.userId)?.name || log.userId, userId: log.userId, docId: log.id, sessionId: s.id,
                mode: o.mode, rev: o.revision, allocs: o.allocations.map(a => `${a.kind}:${a.roleName}[${(a.subjectIds || []).join('+')}] ${String(a.fromISO).slice(11, 16)}-${String(a.toISO).slice(11, 16)} ${a.rateMode}${a.rateMode === 'manual' ? '=' + a.manualRate : ''}`),
                checkIn: s.checkIn, checkOut: s.checkOut, reason: o.reason || '' });
        }
    }
    hits.sort((a, b) => a.date.localeCompare(b.date) || a.staff.localeCompare(b.staff));
    console.log(`logs from ${FROM}: ${logs.length}, sessions with admin override: ${overrides}, combined teaching allocations: ${hits.length}`);
    hits.forEach(h => console.log(JSON.stringify(h)));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
