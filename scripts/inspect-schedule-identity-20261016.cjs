'use strict';
// Read-only: scan October 2026 schedules for row identities that make the
// schedule editor report "Ca đã được người khác thay đổi" on every action.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const SECTIONS = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
const sig = r => [r.start, r.end, r.lop, r.phong].map(v => String(v || '').trim()).join('|');
(async () => {
    const out = { dupShiftIds: [], missingShiftIds: [], dupSigNoId: [], docs: 0, rows: 0 };
    for (const b of ['cs1', 'cs2', 'cs3']) {
        for (let d = 1; d <= 31; d += 1) {
            const id = `${b}__2026-10-${String(d).padStart(2, '0')}`;
            const s = await fetch(`${root}/schedules/${id}`, { headers: H });
            if (s.status === 404) continue;
            if (!s.ok) throw Error(id + s.status);
            const doc = await s.json();
            const data = decodeFields(doc.fields);
            out.docs += 1;
            const seen = new Map();
            for (const sec of SECTIONS) {
                (data[sec] || []).forEach((r, i) => {
                    out.rows += 1;
                    const sid = String(r.shiftId || '');
                    if (!sid) out.missingShiftIds.push(`${id} ${sec}#${i} ${sig(r)}`);
                    else {
                        if (seen.has(sid)) out.dupShiftIds.push(`${id} ${sid} ${seen.get(sid)} & ${sec}#${i} ${sig(r)}`);
                        seen.set(sid, `${sec}#${i}`);
                    }
                });
                const sigs = (data[sec] || []).filter(r => !r.shiftId).map(sig);
                sigs.forEach((v, i) => { if (sigs.indexOf(v) !== i) out.dupSigNoId.push(`${id} ${sec} ${v}`); });
            }
            if (process.argv.includes('--dump') && id === process.argv[process.argv.indexOf('--dump') + 1]) {
                console.log(doc.updateTime, JSON.stringify(data, null, 1));
            }
        }
    }
    console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
