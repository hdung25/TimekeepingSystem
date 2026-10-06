'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const uid = 'nv_1772981307954';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
async function request(url, body) {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    if (response.status === 404) return null;
    if (!response.ok) throw Error('Firestore audit failed: ' + response.status);
    return response.json();
}
async function query(collection, field, value) {
    const rows = await request(root + ':runQuery', { structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } } } });
    return rows.filter(row => row.document).map(row => row.document);
}
function decoded(doc) { return doc ? { id: doc.name.split('/').pop(), updateTime: doc.updateTime, ...decodeFields(doc.fields) } : null; }
(async () => {
    const dates = ['2026-08-03', '2026-08-04', '2026-08-29', '2026-09-03', '2026-09-04', '2026-09-29', '2026-10-03', '2026-10-04'];
    const [userDoc, attendance, makeup, notes, collectionIds, proofs, oldAttendance, backups] = await Promise.all([
        request(root + '/users/' + uid), query('attendance_logs', 'userId', uid), query('makeup_requests', 'staffId', uid),
        request(root + '/daily_notes/' + uid), request(root + ':listCollectionIds', { pageSize: 100 }),
        query('attendance_checkin_proofs', 'staffId', uid), query('attendance', 'userId', uid),
        request(root + '/migration_backups?pageSize=100&mask.fieldPaths=repairId')
    ]);
    const user = decoded(userDoc);
    const records = [];
    for (const date of dates) {
        const day = new Date(date + 'T12:00:00+07:00');
        const dayOfWeek = day.getUTCDay();
        day.setUTCDate(day.getUTCDate() - ((dayOfWeek + 6) % 7));
        const monday = day.toISOString().slice(0, 10);
        const docs = await Promise.all(['cs1', 'cs2', 'cs3'].map(async branch => ({ branch,
            teaching: await request(root + '/schedules/' + branch + '__' + date),
            reception: await request(root + '/receptionist_schedules/' + branch + '__' + monday) })));
        records.push({ date, monday, attendance: attendance.find(doc => doc.name.endsWith('/' + date + '_' + uid)) || null, schedules: docs });
    }
    const output = { uid, user: { id: uid, name: user.name, username: user.username, roles: user.roles, role: user.role, teachingMode: user.teachingMode, salary_config: user.salary_config },
        records, allAttendance: attendance, makeup, notes, proofs, oldAttendance, backups: backups?.documents, collections: collectionIds.collectionIds };
    const file = path.resolve(__dirname, '../../.attendance-repairs/quang-huy-20261006-audit.json');
    fs.writeFileSync(file, JSON.stringify(output, null, 2));
    console.log(JSON.stringify({ user: output.user, dates: records.map(item => ({ date: item.date,
        attendance: decoded(item.attendance), reception: item.schedules.map(s => ({ branch: s.branch, keys: Object.keys(decoded(s.reception) || {}) })),
        teaching: item.schedules.flatMap(s => Object.entries(decoded(s.teaching) || {}).filter(([, rows]) => Array.isArray(rows)).flatMap(([section, rows]) => rows.filter(row => row.gvId === uid || (row.gvList || []).some(p => p.id === uid) || (row.gvThayTeList || []).some(p => p.id === uid)).map(row => ({ branch: s.branch, section, row })))) })),
        nearbyAttendance: attendance.map(decoded).filter(doc => doc.date >= '2026-09-01').map(doc => ({ date: doc.date, sessions: doc.sessions?.length, updateTime: doc.updateTime })),
        makeup: makeup.map(decoded).filter(doc => dates.includes(doc.dateKey)),
        proofs: proofs.map(decoded).filter(doc => dates.includes(doc.dateKey)), oldAttendance: oldAttendance.map(decoded),
        backups: (backups?.documents || []).map(doc => doc.name.split('/').pop()), auditFile: file }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
