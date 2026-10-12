'use strict';
// Soft-cancel one receptionist late order (same fields the Quan Sát Ca "hủy lệnh" button writes), at the owner's request.
const { execFileSync } = require('node:child_process');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const id = 'wGPoC4XT6TbBcpSgdibr';
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
(async () => {
    const url = `${root}/shift_observations/${id}`;
    const cur = await (await fetch(url, { headers: H })).json();
    const f = cur.fields;
    if (f.teacherId.stringValue !== 'nv_1776091622276' || f.dateKey.stringValue !== '2026-10-05' || f.lateMinutes.integerValue !== '5' || f.status.stringValue !== 'active')
        throw new Error('Observation is not the expected active order: ' + JSON.stringify(cur.fields));
    const now = new Date().toISOString();
    const mask = ['status', 'cancelledByName', 'cancelReason', 'cancelledAt', 'updatedAt'].map(k => 'updateMask.fieldPaths=' + k).join('&');
    const r = await fetch(`${url}?${mask}&currentDocument.updateTime=${encodeURIComponent(cur.updateTime)}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: {
        status: { stringValue: 'cancelled' }, cancelledByName: { stringValue: 'Admin' },
        cancelReason: { stringValue: 'Admin hủy theo yêu cầu chủ trung tâm: GV chấm công 17:57, vào đúng ca.' },
        cancelledAt: { timestampValue: now }, updatedAt: { timestampValue: now } } }) });
    console.log(r.status, (await r.json()).fields?.status);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
