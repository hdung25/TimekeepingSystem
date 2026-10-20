'use strict';
// Read-only: "T4 tuần trước chị đã chỉnh, tuần này không lưu" — list each October
// schedule day with create/update time and the evening rows, plus the manifests,
// to see whether this week's day was already its own schedule (lịch riêng) before
// last week's edits, which blocks inheritance.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const SECTIONS = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : '');
(async () => {
    const branches = (arg('--branches') || 'cs1,cs2,cs3').split(',');
    const weekday = arg('--weekday');
    for (const b of branches) {
        const m = await fetch(`${root}/settings/schedule_manifest_${b}`, { headers: H });
        if (m.ok) {
            const man = decodeFields((await m.json()).fields);
            console.log(`manifest ${b}:`, JSON.stringify(Object.fromEntries(Object.entries(man)
                .map(([k, v]) => [k, (v || []).filter(id => id >= `${b}__2026-09-20`)]))));
        }
        for (let day = new Date(2026, 8, 20); day <= new Date(2026, 10, 15); day.setDate(day.getDate() + 1)) {
            if (weekday && String(day.getDay()) !== weekday) continue;
            const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
            const id = `${b}__${key}`;
            const s = await fetch(`${root}/schedules/${id}`, { headers: H });
            if (s.status === 404) { console.log(`${id} ${WD[day.getDay()]} — none (inherits)`); continue; }
            if (!s.ok) throw Error(id + s.status);
            const doc = await s.json();
            const data = decodeFields(doc.fields || {});
            const extra = Object.keys(data).filter(k => !SECTIONS.includes(k));
            console.log(`${id} ${WD[day.getDay()]} created ${doc.createTime} updated ${doc.updateTime} extra=${extra.join(',')}`);
            const sec = arg('--section') || 'evening1';
            (data[sec] || []).forEach((r, i) => console.log(`   ${sec}#${i} ${r.start}-${r.end} ${r.lop} ${r.phong} ${r.gvChinh || ''} ${r.isClosed ? '[TẮT]' : ''} id=${r.shiftId || ''} inh=${r._inheritedFromScheduleDocId || ''}`));
            if (process.argv.includes('--meta')) console.log('   meta', JSON.stringify(Object.fromEntries(extra.map(k => [k, data[k]]))));
        }
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
