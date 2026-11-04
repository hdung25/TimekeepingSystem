'use strict';
// Read-only: Huy's attendance on 28/10 and 30/10 after the owner tried "Ghi phần dạy thay".
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const uid = 'nv_1772981307954';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
async function get(url) {
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) });
    if (response.status === 404) return null;
    if (!response.ok) throw Error('Firestore read failed: ' + response.status);
    return response.json();
}
(async () => {
    for (const date of ['2026-10-28', '2026-10-30']) {
        const doc = await get(`${root}/attendance_logs/${date}_${uid}`);
        const data = doc ? decodeFields(doc.fields) : null;
        console.log(date, doc ? doc.updateTime : 'NO DOC');
        (data?.sessions || []).forEach(s => console.log(' ', JSON.stringify({
            id: s.id, in: s.checkIn, out: s.checkOut, role: s.role, roleName: s.roleName, type: s.type,
            inShift: s.inShiftTeaching || false, host: s.hostSessionId || null, absent: !!s.isAbsent,
            source: s.editMeta?.source || s.source, linkedClassStart: s.linkedClassStart || null
        })));
        const sched = [];
        for (const branch of ['cs1', 'cs2', 'cs3']) {
            const t = await get(`${root}/schedules/${branch}__${date}`);
            const rows = t ? decodeFields(t.fields) : {};
            Object.entries(rows).filter(([, v]) => Array.isArray(v)).forEach(([section, list]) => list
                .filter(r => r && (r.gvId === uid || (r.gvList || []).some(p => p.id === uid) || (r.gvThayTeList || []).some(p => p.id === uid) || r.gvThayTeId === uid || r.gvThayTheId === uid))
                .forEach(r => sched.push({ branch, section, start: r.start, end: r.end, lop: r.lop })));
        }
        console.log('  schedule for Huy:', JSON.stringify(sched));
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
