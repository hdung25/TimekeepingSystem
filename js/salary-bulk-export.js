// ================= XUẤT FILE BẢNG LƯƠNG HÀNG LOẠT =================
// Yêu cầu GĐ 07/08/2026: từ "Dashboard Nhận Lương & Thống Kê" xuất ra bảng lương của TỪNG người,
// đúng cái mẫu mà nhân viên nhìn thấy khi được gửi lương, đúng vai trò của họ.
//
// NGUỒN DỮ LIỆU — đây là điểm quan trọng nhất:
// Không tính lại lương. Lúc bấm "Gửi Bảng Lương", hệ thống đã lưu BẢN CHỤP đầy đủ vào
// salary_settings_monthly/{YYYY-MM}_{staffId}.published.details_gv (bên giáo viên) và
// .details_tt (bên tiếp tân). Trang nhân viên (main.js → renderDetailedSalaryTable) vẽ bảng
// lương từ đúng bản chụp đó. Nên ở đây ta gọi LẠI CHÍNH hàm renderDetailedSalaryTable —
// một nguồn duy nhất, sau này sửa mẫu 1 lần là cả 2 nơi giống nhau, và file xuất ra luôn
// khớp 100% với những gì nhân viên đã nhận (kể cả khi lịch/công bị sửa sau khi gửi).
//
// ĐÓNG GÓI: gộp mọi file vào MỘT file .zip để tải một lần (trình duyệt chặn tải hàng loạt
// nhiều file liên tiếp). ZIP viết thuần Vanilla JS, method STORE (không nén) — không thêm
// thư viện ngoài nào, đúng luật "không thêm npm/framework" của dự án.

(function () {
    'use strict';

    // ---------- ZIP (store-only) ----------
    let _crcTable = null;
    function crcTable() {
        if (_crcTable) return _crcTable;
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        _crcTable = t;
        return t;
    }

    function crc32(bytes) {
        const t = crcTable();
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    // Giờ trong ZIP theo định dạng MS-DOS
    function dosDateTime(d) {
        const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
        const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
        return { time: time & 0xFFFF, date: date & 0xFFFF };
    }

    // entries: [{ name: string, text: string }] → Blob (application/zip)
    function buildZip(entries) {
        const enc = new TextEncoder();
        const stamp = dosDateTime(new Date());
        const parts = [];
        const central = [];
        let offset = 0;

        entries.forEach(entry => {
            const nameBytes = enc.encode(entry.name);
            const dataBytes = enc.encode(entry.text);
            const crc = crc32(dataBytes);

            // Local file header (30 bytes + name)
            const lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true);   // signature
            lh.setUint16(4, 20, true);           // version needed
            lh.setUint16(6, 0x0800, true);       // flag: tên file là UTF-8
            lh.setUint16(8, 0, true);            // method 0 = STORE
            lh.setUint16(10, stamp.time, true);
            lh.setUint16(12, stamp.date, true);
            lh.setUint32(14, crc, true);
            lh.setUint32(18, dataBytes.length, true);
            lh.setUint32(22, dataBytes.length, true);
            lh.setUint16(26, nameBytes.length, true);
            lh.setUint16(28, 0, true);           // extra length
            parts.push(new Uint8Array(lh.buffer), nameBytes, dataBytes);

            // Central directory entry (46 bytes + name)
            const cd = new DataView(new ArrayBuffer(46));
            cd.setUint32(0, 0x02014b50, true);
            cd.setUint16(4, 20, true);           // version made by
            cd.setUint16(6, 20, true);           // version needed
            cd.setUint16(8, 0x0800, true);
            cd.setUint16(10, 0, true);
            cd.setUint16(12, stamp.time, true);
            cd.setUint16(14, stamp.date, true);
            cd.setUint32(16, crc, true);
            cd.setUint32(20, dataBytes.length, true);
            cd.setUint32(24, dataBytes.length, true);
            cd.setUint16(28, nameBytes.length, true);
            cd.setUint16(30, 0, true);           // extra
            cd.setUint16(32, 0, true);           // comment
            cd.setUint16(34, 0, true);           // disk number
            cd.setUint16(36, 0, true);           // internal attrs
            cd.setUint32(38, 0, true);           // external attrs
            cd.setUint32(42, offset, true);      // offset of local header
            central.push(new Uint8Array(cd.buffer), nameBytes);

            offset += 30 + nameBytes.length + dataBytes.length;
        });

        const centralSize = central.reduce((sum, a) => sum + a.length, 0);
        const eocd = new DataView(new ArrayBuffer(22));
        eocd.setUint32(0, 0x06054b50, true);
        eocd.setUint16(4, 0, true);
        eocd.setUint16(6, 0, true);
        eocd.setUint16(8, entries.length, true);
        eocd.setUint16(10, entries.length, true);
        eocd.setUint32(12, centralSize, true);
        eocd.setUint32(16, offset, true);
        eocd.setUint16(20, 0, true);

        return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
    }

    // ---------- Tên file ----------
    // Công thức GĐ yêu cầu: "bảng lương tháng ... + tên + tên tài khoản"
    // → "Bang luong thang 8-2026 - Nguyen Thi Hong Van - hongvan - Tiep Tan.html"
    function stripTones(str) {
        if (typeof removeVietnameseTones === 'function') return removeVietnameseTones(String(str || ''));
        return String(str || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D');
    }

    function safeFilePart(str) {
        return stripTones(str)
            .replace(/[\\/:*?"<>|]/g, ' ')   // ký tự Windows không cho phép
            .replace(/[\u0000-\u001F\u007F]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function buildFileName(monthStr, staffName, account, roleLabel, withRole) {
        const [y, m] = String(monthStr).split('-');
        const base = `Bang luong thang ${Number(m)}-${y}`
            + ` - ${safeFilePart(staffName) || 'Khong ro ten'}`
            + ` - ${safeFilePart(account) || 'khong-ro-tai-khoan'}`
            + (withRole ? ` - ${safeFilePart(roleLabel)}` : '');
        // Windows: tên file tối đa 255 ký tự
        return base.slice(0, 200) + '.html';
    }

    // ---------- Nội dung 1 file bảng lương ----------
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function buildPayslipHtml(opts) {
        const { monthStr, staffName, account, msnv, roleLabel, status, details, message, companyName } = opts;
        const [y, m] = String(monthStr).split('-');
        // Chính hàm mà trang nhân viên dùng → mẫu và số liệu y hệt bản đã gửi
        const card = window.renderDetailedSalaryTable(details, status);
        const statusText = status === 'received' ? 'Nhân viên đã xác nhận nhận lương' : 'Đã gửi cho nhân viên';

        return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bảng lương tháng ${Number(m)}/${y} - ${esc(staffName)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:18px;background:#F3F4F6;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#111827}
  .sheet{max-width:900px;margin:0 auto;background:#fff;border-radius:16px;padding:20px;box-shadow:0 6px 24px rgba(0,0,0,.06)}
  .hd{border-bottom:2px solid #E5E7EB;padding-bottom:14px;margin-bottom:16px}
  .hd .co{font-size:.82rem;font-weight:700;color:#047857;text-transform:uppercase;letter-spacing:.04em}
  .hd h1{margin:6px 0 10px;font-size:1.3rem;font-weight:800;color:#111827}
  .meta{display:flex;flex-wrap:wrap;gap:8px 22px;font-size:.85rem;color:#374151}
  .meta b{color:#111827}
  .tag{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.72rem;font-weight:700;background:#DBEAFE;color:#1E40AF;border:1px solid #93C5FD}
  .tag.ok{background:#D1FAE5;color:#065F46;border-color:#6EE7B7}
  .msg{margin-top:16px;padding:12px 14px;border-radius:12px;background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;font-size:.88rem;line-height:1.55}
  .ft{margin-top:16px;padding-top:12px;border-top:1px dashed #E5E7EB;font-size:.75rem;color:#9CA3AF;line-height:1.6}
  table{width:100%}
  @media print{
    body{background:#fff;padding:0}
    .sheet{box-shadow:none;border-radius:0;max-width:none;padding:0}
    .noprint{display:none}
  }
  @page{size:A4;margin:12mm}
</style>
</head>
<body>
<div class="sheet">
  <div class="hd">
    <div class="co">${esc(companyName || 'Trung Tâm Ngoại Ngữ & Toán Tư Duy Trẻ')}</div>
    <h1>Bảng lương tháng ${Number(m)}/${y}</h1>
    <div class="meta">
      <span>Họ tên: <b>${esc(staffName)}</b></span>
      <span>Tài khoản: <b>${esc(account || '—')}</b></span>
      <span>MSNV: <b>${esc(msnv || '—')}</b></span>
      <span>Vai trò: <b>${esc(roleLabel)}</b></span>
      <span class="tag ${status === 'received' ? 'ok' : ''}">${esc(statusText)}</span>
    </div>
  </div>
  ${card}
  ${message ? `<div class="msg"><b>Nhắn gửi:</b> ${esc(message)}</div>` : ''}
  <div class="ft">
    File xuất từ Hệ Thống Chấm Công — nội dung lấy nguyên bản bảng lương đã gửi cho nhân viên tháng ${Number(m)}/${y}.<br>
    Muốn lưu thành PDF: mở file này rồi bấm Ctrl+P → chọn "Save as PDF".
  </div>
</div>
</body>
</html>`;
    }

    // ---------- Hàm chính ----------
    window.exportAllPayslips = async function exportAllPayslips() {
        const btn = document.getElementById('btn-export-all-payslips');
        const label = document.getElementById('btn-export-all-payslips-label');
        const setLabel = (t) => { if (label) label.innerText = t; };

        if (typeof window.renderDetailedSalaryTable !== 'function') {
            UIService.toast('Chưa tải xong thành phần vẽ bảng lương, thử lại sau vài giây.', 'error');
            return;
        }

        const scope = document.getElementById('export-scope')?.value || 'all';
        const statusMode = document.getElementById('export-status')?.value || 'sent';

        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

        try {
            if (btn) { btn.disabled = true; }
            setLabel('Đang lấy dữ liệu...');
            UIService.showLoading('Đang chuẩn bị file bảng lương...');

            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            const [allSettings, users, sysSettings] = await Promise.all([
                DBService.getAllMonthlySalarySettings(monthStr),
                DBService.getUsers(),
                DBService.getSystemSettings().catch(() => null)
            ]);
            const companyName = (sysSettings && sysSettings.companyName) || '';

            const userMap = {};
            (users || []).forEach(u => { if (u && u.id) userMap[u.id] = u; });

            const statusAllowed = (st) => {
                if (!st) return false;
                if (statusMode === 'received') return st === 'received';
                if (statusMode === 'sent') return st === 'published' || st === 'received';
                return st === 'draft' || st === 'published' || st === 'received'; // any = đã tính
            };

            const entries = [];
            const usedNames = new Set();
            const skipped = [];   // {name, why}
            const peopleDone = new Set();

            Object.keys(allSettings || {}).forEach(staffId => {
                const pub = (allSettings[staffId] || {}).published;
                const u = userMap[staffId];
                const staffName = (u && (u.name || u.username)) || (pub && pub.details && pub.details.staffName) || staffId;
                const account = (u && u.username) || '';
                const msnv = (u && u.msnvStr) || '';

                if (!pub) { return; } // chưa từng tính lương → không phải lỗi, bỏ im lặng
                if (!u) { skipped.push({ name: staffName, why: 'không tìm thấy nhân viên trong Nhân Sự' }); return; }

                // Hai bên vai trò tách riêng: người làm cả 2 ra 2 file, không trộn số liệu
                const sides = [];
                const gvStatus = pub.status_gv || (pub.role !== 'tiep-tan' ? pub.status : null);
                const ttStatus = pub.status_tt || (pub.role === 'tiep-tan' ? pub.status : null);
                const gvDetails = pub.details_gv || (pub.role !== 'tiep-tan' && pub.role !== 'dual' ? pub.details : null);
                const ttDetails = pub.details_tt || (pub.role === 'tiep-tan' ? pub.details : null);

                if (scope !== 'tiep-tan' && gvDetails) sides.push({ key: 'giao-vien', roleLabel: 'Giao Vien', roleShow: 'Giáo Viên / Trợ Giảng', details: gvDetails, status: gvStatus });
                if (scope !== 'giao-vien' && ttDetails) sides.push({ key: 'tiep-tan', roleLabel: 'Tiep Tan', roleShow: 'Tiếp Tân', details: ttDetails, status: ttStatus });

                if (sides.length === 0) {
                    if (scope === 'all') skipped.push({ name: staffName, why: 'chưa tính lương bên nào' });
                    return;
                }

                const withRole = sides.length > 1;
                sides.forEach(side => {
                    if (!statusAllowed(side.status)) {
                        skipped.push({ name: `${staffName} (${side.roleShow})`, why: side.status === 'draft' ? 'đã tính nhưng CHƯA GỬI' : 'chưa tính lương' });
                        return;
                    }
                    // details.role quyết định mẫu form (tiếp tân / giáo viên) — bảo đảm đúng vai trò
                    const details = Object.assign({}, side.details);
                    if (!details.role) details.role = side.key;
                    if (!details.staffName) details.staffName = staffName;
                    if (!details.employeeId) details.employeeId = String(account || '').toUpperCase();

                    let name = buildFileName(monthStr, staffName, account, side.roleLabel, withRole);
                    if (usedNames.has(name)) {
                        let n = 2;
                        const stem = name.replace(/\.html$/, '');
                        while (usedNames.has(`${stem} (${n}).html`)) n++;
                        name = `${stem} (${n}).html`;
                    }
                    usedNames.add(name);

                    entries.push({
                        name,
                        text: buildPayslipHtml({
                            monthStr, staffName, account, msnv,
                            roleLabel: side.roleShow,
                            status: side.status,
                            details,
                            message: pub.message || '',
                            companyName
                        })
                    });
                    peopleDone.add(staffId);
                });
            });

            if (entries.length === 0) {
                UIService.hideLoading();
                await UIService.notice(
                    `Không có bảng lương nào khớp điều kiện đang chọn (tháng ${month + 1}/${year}).\n` +
                    `Hãy đổi bộ lọc "Xuất" / trạng thái, hoặc tính & gửi lương trước đã.`,
                    'Chưa có gì để xuất', 'warning'
                );
                return;
            }

            setLabel(`Đang gói ${entries.length} file...`);
            entries.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
            const blob = buildZip(entries);

            const zipName = safeFilePart(`Bang luong thang ${month + 1}-${year}`) + '.zip';
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = zipName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);

            UIService.hideLoading();

            // Báo cáo đầy đủ — KHÔNG im lặng bỏ sót ai. UIService.notice tự escape HTML nên
            // ở đây truyền CHỮ THUẦN, chỉ dùng \n để xuống dòng.
            let msg = `Đã xuất ${entries.length} file của ${peopleDone.size} nhân viên vào "${zipName}".`;
            if (skipped.length) {
                const show = skipped.slice(0, 12).map(s => `• ${s.name} — ${s.why}`).join('\n');
                msg += `\n\nBỏ qua ${skipped.length} mục:\n${show}`;
                if (skipped.length > 12) msg += `\n… và ${skipped.length - 12} mục nữa (xem Console).`;
                console.warn('[Xuất bảng lương] Bỏ qua:', skipped);
            }
            await UIService.notice(msg, 'Xuất file xong', 'success');
        } catch (e) {
            console.error('[Xuất bảng lương] Lỗi:', e);
            UIService.hideLoading();
            UIService.toast('Xuất file thất bại: ' + (e.message || e), 'error');
        } finally {
            if (btn) btn.disabled = false;
            setLabel('Xuất file bảng lương');
        }
    };
})();
