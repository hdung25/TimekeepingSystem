'use strict';
// Read-only: LIÊN KẾT group subjects and where they appear in schedules / attendance for a month.
// Usage: node scripts/inspect-linked-subjects-20261106.cjs 2026-10
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const policy = require('../js/partner-attendance-policy.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const dec = d => d ? { id: d.name.split('/').pop(), ...decodeFields(d.fields || {}) } : null;
const month = process.argv[2] || '2026-10';
const out = process.argv[3] || path.join(process.env.TEMP || '.', 'linked-' + month + '.json');
async function list(col) {
    const docs = []; let pageToken = '';
    do {
        const r = await fetch(`${root}/${col}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`, { headers: H });
        if (!r.ok) throw new Error(col + ' ' + r.status);
        const j = await r.json(); (j.documents || []).forEach(d => docs.push(dec(d))); pageToken = j.nextPageToken || '';
    } while (pageToken);
    return docs;
}
async function query(col, field, from, to) {
    const body = { structuredQuery: { from: [{ collectionId: col }], where: { compositeFilter: { op: 'AND', filters: [
        { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: from } } },
        { fieldFilter: { field: { fieldPath: field }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: to } } }] } } } };
    const r = await fetch(`${root}:runQuery`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(col + ' ' + r.status);
    return (await r.json()).filter(x => x.document).map(x => dec(x.document));
}
(async () => {
    const subjects = await list('subjects');
    const groups = subjects.filter(s => s.isGroup === true);
    const group = groups.find(g => policy.normalize(g.name) === policy.normalize('LIÊN KẾT'));
    console.log('groups:', groups.map(g => g.name + '(' + g.id + ')').join(', '));
    const leaves = policy.leaves(subjects, group.id);
    console.log('LIÊN KẾT leaves:', leaves.map(s => s.name + ' [' + s.id + ']').join(' | '));
    const dupNames = leaves.filter(l => subjects.filter(s => s.isGroup !== true && policy.normalize(s.name) === policy.normalize(l.name)).length > 1);
    if (dupNames.length) console.log('DUPLICATE NAMES (name-only rows cannot resolve):', dupNames.map(s => s.name).join(', '));
    const ids = new Set(leaves.map(s => String(s.id)));
    const needles = new Set(leaves.flatMap(s => [policy.normalize(s.id), policy.normalize(s.name)]));
    // schedules doc ids are branch__date; fetch each directly (docs may be missing → inherited in the app).
    const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    const schedRows = [], missing = [];
    for (let d = 1; d <= days; d++) for (const b of ['cs1', 'cs2', 'cs3']) {
        const id = b + '__' + month + '-' + String(d).padStart(2, '0');
        const r = await fetch(`${root}/schedules/${id}`, { headers: H });
        if (r.status === 404) { missing.push(id); continue; }
        const doc = dec(await r.json());
        policy.sections.forEach(sec => (doc[sec] || []).forEach((row, i) => {
            const resolved = policy.resolveIds(row, subjects);
            const hit = resolved.some(x => ids.has(x)) || policy.mentionsAny({ lop: row.lop, lopId: row.lopId, subjectIds: row.subjectIds }, needles);
            if (hit) schedRows.push({ id, sec, i, start: row.start, end: row.end, lop: row.lop, lopId: row.lopId, subjectIds: row.subjectIds, resolved,
                gv: (row.gvList || []).map(u => u.name || u.id), closed: row.isClosed || row.closed || false });
        }));
    }
    console.log('schedule docs missing (app inherits from earlier weeks):', missing.length);
    console.log('linked schedule rows:', schedRows.length);
    schedRows.slice(0, 40).forEach(r => console.log(JSON.stringify(r)));
    const logs = await query('attendance_logs', 'date', month + '-01', month + '-31');
    const sessionHits = [];
    logs.forEach(l => (l.sessions || []).forEach(s => { if (policy.mentionsAny(s, needles)) sessionHits.push({ date: l.date, userId: l.userId, name: l.name, role: s.role, roleName: s.roleName, lopId: s.lopId }); }));
    console.log('attendance logs in month:', logs.length, '· sessions naming a linked subject:', sessionHits.length);
    sessionHits.slice(0, 20).forEach(x => console.log(JSON.stringify(x)));
    fs.writeFileSync(out, JSON.stringify({ leaves, schedRows, sessionHits, missing }, null, 1));
    console.log('saved', out);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
