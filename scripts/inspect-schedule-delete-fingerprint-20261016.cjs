'use strict';
// Read-only: which October 2026 rows can never be deleted because the editor's
// merged (registrations attached) row fingerprint differs from the raw row?
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const dbSrc = fs.readFileSync(path.join(__dirname, '../js/db-service.js'), 'utf8');
const schSrc = fs.readFileSync(path.join(__dirname, '../js/schedule.js'), 'utf8');
const grab = (src, name) => { const s = src.indexOf(`function ${name}(`); let i = src.indexOf('{', s), depth = 0;
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; } return src.slice(s, i + 1); };
const SECTIONS = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
// eslint-disable-next-line no-new-func
const lib = new Function('SCHEDULE_SECTION_KEYS', [grab(dbSrc, '_scheduleRegistrationRowSignature'), grab(dbSrc, '_scheduleRegistrationUpdatedMillis'),
    grab(dbSrc, '_mergeScheduleRegistrations'), grab(schSrc, 'scheduleRowContentFingerprint'),
    'return { merge: _mergeScheduleRegistrations, fp: scheduleRowContentFingerprint };'].join('\n'))(SECTIONS);
const sig = r => [r.start, r.end, r.lop, r.phong].map(v => String(v || '').trim()).join('|');
(async () => {
    const bad = [];
    for (const b of ['cs1', 'cs2', 'cs3']) for (let d = 1; d <= 31; d += 1) {
        const id = `${b}__2026-10-${String(d).padStart(2, '0')}`;
        const s = await fetch(`${root}/schedules/${id}`, { headers: H });
        if (s.status === 404) continue;
        const raw = decodeFields((await s.json()).fields);
        const q = await fetch(`${root}:runQuery`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'schedule_registrations' }],
                where: { fieldFilter: { field: { fieldPath: 'scheduleKey' }, op: 'EQUAL', value: { stringValue: id } } } } }) });
        const regs = (await q.json()).filter(x => x.document).map(x => ({ id: x.document.name.split('/').pop(), ...decodeFields(x.document.fields) }));
        const merged = lib.merge(raw, regs);
        for (const sec of SECTIONS) (raw[sec] || []).forEach((r, i) => {
            if (lib.fp(r) !== lib.fp(merged[sec][i])) bad.push(`${id} ${sec}#${i} ${sig(r)} raw=${JSON.stringify((r.registeredTeachers||[]).map(t=>t.id))} merged=${JSON.stringify(merged[sec][i].registeredTeachers.map(t=>t.id+':'+(t.registrationSource||'legacy')))}`);
        });
    }
    console.log(bad.length, 'rows blocked'); bad.forEach(x => console.log(x));
})().catch(e => { console.error(e); process.exitCode = 1; });
