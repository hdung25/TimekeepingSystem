'use strict';
// Read-only: for each own schedule day from --from on, compare its classes with the
// previous same-weekday schedule (the one it would inherit from) and print the differences.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const SECTIONS = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
const from = process.argv[2] || '2026-10-19';
const norm = v => String(v || '').trim().toLowerCase();
const rows = data => SECTIONS.flatMap(s => (data[s] || []).map(r => `${s}|${norm(r.start)}-${norm(r.end)}|${norm(r.lop)}|${norm(r.phong)}|${norm(r.gvChinh)}`));
const get = async id => { const s = await fetch(`${root}/schedules/${id}`, { headers: H }); return s.ok ? decodeFields((await s.json()).fields || {}) : null; };
(async () => {
    for (const b of ['cs1', 'cs2']) {
        const man = decodeFields((await (await fetch(`${root}/settings/schedule_manifest_${b}`, { headers: H })).json()).fields);
        for (const list of Object.values(man)) {
            const ids = [...list].sort();
            for (let i = 1; i < ids.length; i += 1) {
                if (ids[i].split('__')[1] < from) continue;
                const [prev, cur] = [await get(ids[i - 1]), await get(ids[i])];
                if (!prev || !cur) { console.log(ids[i], 'missing doc'); continue; }
                const a = rows(prev), c = rows(cur);
                const gone = a.filter(x => !c.includes(x)), added = c.filter(x => !a.includes(x));
                console.log(`${ids[i]} vs ${ids[i - 1]}: ${gone.length ? 'DIFF' : (added.length ? 'DIFF' : 'same')}`);
                gone.forEach(x => console.log('   - ' + x)); added.forEach(x => console.log('   + ' + x));
            }
        }
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
