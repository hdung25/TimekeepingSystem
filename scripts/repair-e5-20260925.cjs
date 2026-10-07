'use strict';
// 08/10/2026 chủ trung tâm: ca E5 cs1 25/09 18:00–19:30 — GV chính Phương = Vắng có phép,
// GV thay Thùy (đã nhận ca) = Vắng đột xuất (substituteAbsences). Dry run mặc định; --apply để ghi.
// Chỉ ghi lại trường evening1, giữ nguyên byte các hàng khác, có điều kiện updateTime.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { decodeFields, encode } = require('./repair-evening-attendance-20260831.js');
const TeacherShiftState = require('../js/teacher-shift-state.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const DOC = 'schedules/cs1__2026-09-25', SHIFT = 'shift_inherited_w3zv63_lfsxi1';
const PHUONG = 'nv_1781782131803', THUY = 'nv_1776091755369';
const apply = process.argv.includes('--apply');
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
async function get(p) { const r = await fetch(`${root}/${p}`, { headers }); if (r.status === 404) return null; if (!r.ok) throw Error(p + ' ' + r.status); return r.json(); }

(async () => {
    const doc = await get(DOC);
    const raw = doc.fields.evening1.arrayValue.values;
    const index = raw.findIndex(v => v.mapValue.fields.shiftId?.stringValue === SHIFT);
    if (index < 0) throw Error('Không thấy ca E5');
    const row = decodeFields(raw[index].mapValue.fields);
    if (row.lop !== 'E5' || row.start !== '18:00' || row.gvId !== PHUONG) throw Error('Ca không khớp');
    if (JSON.stringify(raw[index]).includes('timestampValue')) throw Error('Hàng có timestamp, dừng để không đổi kiểu');
    // Thùy không có phiên công nào phủ ca.
    const att = await get(`attendance_logs/2026-09-25_${THUY}`);
    const sessions = att ? (decodeFields(att.fields).sessions || []) : [];
    const overlap = sessions.filter(s => !s.isAbsent && s.checkIn && new Date(s.checkIn) < new Date('2026-09-25T19:30:00+07:00') &&
        new Date(s.checkOut || s.checkIn) > new Date('2026-09-25T18:00:00+07:00'));
    if (overlap.length) throw Error('Thùy có phiên công trùng ca: ' + JSON.stringify(overlap));
    const phuong = row.teacherAbsences.find(a => a.teacherId === PHUONG);
    const next = TeacherShiftState.applyStaffingCommand(row, {
        shiftId: SHIFT,
        mains: [{ id: PHUONG, name: 'Nguyễn Thị Bình Phương' }],
        statuses: { [PHUONG]: { type: 'VP', reason: phuong.reason || '', reportedAt: phuong.reportedAt } },
        substitutes: [],
        substituteAbsences: [{ id: THUY, name: 'Lê Thị Phương Thuỳ', type: 'VDX', reason: 'Chủ trung tâm xác nhận 08/10: vắng đột xuất',
            replacedTeacherIds: [PHUONG] }]
    }, { id: 'nv_1772980876639', name: 'Kiều Diễm' }, new Date().toISOString());
    const summary = { phuong: next.teacherAbsences.map(a => `${a.teacherId}:${a.type}:${a.status}`), subs: next.gvThayTeList,
        dropouts: next.substituteAbsences.map(a => `${a.teacherId}:${a.type}`), history: next.teacherAbsenceHistory.slice(-2).map(h => h.event) };
    console.log(JSON.stringify(summary));
    const backupDir = path.resolve(__dirname, '../../.attendance-repairs');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'e5-20260925-original.json'), JSON.stringify(doc, null, 1));
    if (!apply) return console.log('DRY RUN — chưa ghi');
    const values = raw.slice(); values[index] = encode(next);
    const url = `${root}/${DOC}?updateMask.fieldPaths=evening1&currentDocument.updateTime=${encodeURIComponent(doc.updateTime)}`;
    const r = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fields: { evening1: { arrayValue: { values } } } }) });
    if (!r.ok) throw Error('Ghi lỗi ' + r.status + ' ' + await r.text());
    const after = decodeFields((await get(DOC)).fields).evening1.find(x => x.shiftId === SHIFT);
    console.log('ĐÃ GHI', JSON.stringify({ phuong: after.teacherAbsences.map(a => a.type), thuy: after.substituteAbsences.map(a => a.type), subs: after.gvThayTeList }));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
