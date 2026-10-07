'use strict';
// 08/10/2026 chủ trung tâm: Bùi Như Quỳnh tháng 9 — bản nháp lưu lúc 23:41 07/10 theo luật chuyên cần cũ
// (VP 3 ca, 59,1667 giờ → 0đ). Luật mới: vắng phép vượt số ca được miễn → −1.000đ/giờ = −59.167đ.
// Cập nhật đúng như "Lưu & Tính": dòng I + tổng thưởng + thực lĩnh. Dry run mặc định; --apply để ghi.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { decodeFields, encode } = require('./repair-evening-attendance-20260831.js');
const Policy = require('../js/teacher-attendance-policy.js');
const root = 'https://firestore.googleapis.com/v1/projects/timekeeping-69f3f/databases/(default)/documents';
const DOC = 'salary_settings_monthly/2026-09_nv_1781782207801';
const apply = process.argv.includes('--apply');
const token = execFileSync('powershell.exe', ['-NoProfile', '-File', 'C:/Users/Admin/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.ps1', 'auth', 'print-access-token'], { encoding: 'utf8', windowsHide: true }).trim();
const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

(async () => {
    const raw = await (await fetch(`${root}/${DOC}`, { headers })).json();
    if (JSON.stringify(raw.fields.published).includes('timestampValue') || JSON.stringify(raw.fields.giao_vien).includes('timestampValue')) throw Error('Có timestamp, dừng');
    const doc = decodeFields(raw.fields);
    const pub = doc.published, gvd = pub.details_gv;
    const row0 = doc.giao_vien.evaluation.find(e => e.id === 0);
    if (pub.status_gv !== 'draft') throw Error('Không còn là bản nháp');
    if (!Policy.needsAttendanceRecalc(row0)) throw Error('Dòng I không còn ở trạng thái cũ');
    const amount = Policy.automaticAttendance('old', { minutes: gvd.totalBaseMins, vp: 3, vdx: 0, vkp: 0, unreported: 0 }).amount;
    if (amount !== -59167) throw Error('Số tiền mới bất thường ' + amount);
    const delta = amount - row0.amount;
    const check = d => d.baseSalary + (d.troCapChucVu || 0) + d.totalBonus - (d.advance || 0) === d.netPay;
    if (!check(gvd) || gvd.personalIncomeTaxEnabled) throw Error('Công thức tổng không khớp, dừng');

    const evaluation = doc.giao_vien.evaluation.map(e => e.id === 0 ? { ...e, amount, automatic: Policy.version } : e);
    const fix = d => ({ ...d, totalBonus: d.totalBonus + delta, netPay: d.netPay + delta,
        ...(d.incomeBeforeAdvance != null ? { incomeBeforeAdvance: d.incomeBeforeAdvance + delta } : {}),
        ...(Array.isArray(d.evalItems) ? { evalItems: d.evalItems.map(i => i.id === 0 ? { ...i, amount } : i) } : {}) });
    const nextGv = fix(gvd);
    if (!check(nextGv)) throw Error('Sau sửa không khớp');
    const nextPub = { ...pub, details_gv: nextGv, totalBonus: pub.totalBonus + delta, netPay: pub.netPay + delta };
    if (pub.details && pub.details.netPay === gvd.netPay) nextPub.details = fix(pub.details);
    console.log(JSON.stringify({ amount, netBefore: gvd.netPay, netAfter: nextGv.netPay, totalBonusAfter: nextGv.totalBonus, details: !!nextPub.details && nextPub.details.netPay }));
    const dir = path.resolve(__dirname, '../../.attendance-repairs'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'quynh64-202609-original.json'), JSON.stringify(raw, null, 1));
    if (!apply) return console.log('DRY RUN');
    const url = `${root}/${DOC}?updateMask.fieldPaths=published&updateMask.fieldPaths=giao_vien.evaluation&currentDocument.updateTime=${encodeURIComponent(raw.updateTime)}`;
    const r = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fields: { published: encode(nextPub), giao_vien: { mapValue: { fields: { evaluation: encode(evaluation) } } } } }) });
    if (!r.ok) throw Error('Ghi lỗi ' + r.status + ' ' + await r.text());
    const after = decodeFields((await (await fetch(`${root}/${DOC}`, { headers })).json()).fields);
    console.log('ĐÃ GHI', JSON.stringify({ I: after.giao_vien.evaluation[0].amount, net: after.published.details_gv.netPay, pubNet: after.published.netPay,
        keptKeys: Object.keys(after.giao_vien).length === Object.keys(doc.giao_vien).length }));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
