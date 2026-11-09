'use strict';
// Read-only (09/11/2026): owner hỏi bảng lương Mỹ Sang — ca đánh "10 hs" tính lớp nào,
// dòng "(+10 HS)" 4h35' gồm những ca nào. Không ghi gì vào Firestore.
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token };
const dec = d => d ? { id: d.name.split('/').pop(), ...decodeFields(d.fields) } : null;
const MONTH = process.argv[2] || '2026-10';
const vn = iso => iso ? new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(11, 16) : '';
(async () => {
    const u = await fetch(`${root}/users?pageSize=300`, { headers: H });
    const users = ((await u.json()).documents || []).map(dec);
    const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const matches = users.filter(x => fold(x.name).includes('my sang'));
    console.log('users:', matches.map(x => `${x.id} ${x.name} ${x.username || ''}`).join(' | '));
    for (const user of matches) {
        const r = await fetch(`${root}:runQuery`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'attendance_logs' }],
                where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: user.id } } } } }) });
        const logs = (await r.json()).filter(x => x.document).map(x => dec(x.document)).filter(l => String(l.date).startsWith(MONTH)).sort((a, b) => a.date.localeCompare(b.date));
        for (const log of logs) for (const s of log.sessions || []) {
            console.log([log.date, s.id, vn(s.checkIn) + '-' + vn(s.checkOut), s.role, s.roleName || '', 'hs=' + (s.studentCount ?? ''), s.studentCountStatus || '',
                'b10=' + (s.bonus10Status || s.isEarly10 || ''), s.adminPayrollOverride ? 'OVERRIDE ' + JSON.stringify((s.adminPayrollOverride.allocations || []).map(a => a.roleName + ' ' + vn(a.fromISO) + '-' + vn(a.toISO))) : ''].join(' | '));
        }
        const m = dec(await (await fetch(`${root}/salary_settings_monthly/${MONTH}_${user.id}`, { headers: H })).json());
        const p = m?.published || {};
        const details = p.details_gv || p.details || {};
        console.log('payslip status', p.status, p.status_gv, 'penalty', m?.studentCountBonusPenalty);
        (details.breakdown || p.breakdown || []).forEach(b => console.log('  breakdown', JSON.stringify(b)));
        console.log('  class_rates', JSON.stringify((m?.giao_vien || m?.['giao-vien'] || {}).class_rates || {}));
        const keys = Object.keys(details).filter(k => /10|early|bonus|Mins/i.test(k));
        console.log('  details keys', JSON.stringify(Object.fromEntries(keys.map(k => [k, details[k]]))));
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
