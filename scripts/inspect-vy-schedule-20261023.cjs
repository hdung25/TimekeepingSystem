'use strict';
// Read-only: các dòng lịch có Uyên Vy ngày 23/10/2026 (mọi chi nhánh).
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const dec = d => d ? { id: d.name.split('/').pop(), ...decodeFields(d.fields) } : null;
const STAFF = 'nv_1781780302340';
const walk = (node, path, out) => {
    if (Array.isArray(node)) node.forEach((x, i) => walk(x, path + '[' + i + ']', out));
    else if (node && typeof node === 'object') {
        if (JSON.stringify(node.gvList || node.gvId || node.staffId || node.gvThayTheId || '').includes(STAFF) && (node.start || node.end))
            out.push({ path, start: node.start, end: node.end, lop: node.lop, gvId: node.gvId, thay: node.gvThayTheId, absent: (node.teacherAbsences || []).length, closed: node.isClosed || node.closed || '' });
        for (const [k, v] of Object.entries(node)) walk(v, path + '.' + k, out);
    }
};
(async () => {
    for (const id of ['cs1__2026-10-23', 'cs2__2026-10-23', 'cs3__2026-10-23', '2026-10-23']) {
        const r = await fetch(`${root}/schedules/${id}`, { headers: H });
        if (!r.ok) { console.log(id, r.status); continue; }
        const out = []; walk(dec(await r.json()), id, out);
        out.forEach(x => console.log(JSON.stringify(x)));
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
