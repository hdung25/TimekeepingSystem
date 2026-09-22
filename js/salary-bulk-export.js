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

    // entries: [{ name: string, text?: string, bytes?: Uint8Array }] → Blob
    function buildZip(entries, mimeType) {
        const enc = new TextEncoder();
        const stamp = dosDateTime(new Date());
        const parts = [];
        const central = [];
        let offset = 0;

        entries.forEach(entry => {
            const nameBytes = enc.encode(entry.name);
            const dataBytes = entry.bytes instanceof Uint8Array ? entry.bytes : enc.encode(entry.text || '');
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

        return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: mimeType || 'application/zip' });
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
        const statusText = status === 'received' ? 'Nhân viên đã xác nhận nhận lương' : status === 'published' ? 'Đã gửi cho nhân viên' : 'BẢN TÍNH ĐÃ LƯU — CHƯA GỬI';

        return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bảng lương tháng ${Number(m)}/${y} - ${esc(staffName)}</title>
<style>
  /* Nền lệch nhẹ sang xanh cho ăn với màu emerald của trung tâm, không dùng xám trung tính.
     Font dùng stack hệ thống — iPhone ra SF, Windows ra Segoe UI — để file mở offline được,
     không phụ thuộc font tải từ mạng. */
  :root{--ink:#111827;--mut:#5B6660;--line:#E4EAE7;--p:#047857;--paper:#F5F8F6}
  *{box-sizing:border-box}
  body{margin:0;padding:16px;background:var(--paper);color:var(--ink);
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Roboto,sans-serif;
       -webkit-text-size-adjust:100%}
  .sheet{max-width:900px;margin:0 auto;background:#fff;border-radius:16px;padding:20px;
         box-shadow:0 6px 24px rgba(6,60,40,.07)}
  .hd{border-bottom:2px solid var(--line);padding-bottom:14px;margin-bottom:16px}
  .hd .co{font-size:.72rem;font-weight:800;color:var(--p);text-transform:uppercase;letter-spacing:.09em;line-height:1.5}
  .hd h1{margin:8px 0 12px;font-size:1.35rem;font-weight:800;letter-spacing:-.01em;text-wrap:balance}
  /* Bảng nhãn/giá trị 2 cột — trên điện thoại nhãn tự co, giá trị không bị đẩy tràn */
  .meta{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:.85rem;color:var(--mut);align-items:baseline}
  .meta dt{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
  .meta dd{margin:0;font-weight:700;color:var(--ink);min-width:0;overflow-wrap:anywhere}
  .tagline{margin-top:12px}
  .tag{display:inline-block;padding:4px 11px;border-radius:999px;font-size:.7rem;font-weight:800;
       white-space:nowrap;background:#DBEAFE;color:#1E40AF;border:1px solid #93C5FD}
  .tag.ok{background:#D1FAE5;color:#065F46;border-color:#6EE7B7}
  .msg{margin-top:16px;padding:12px 14px;border-radius:12px;background:#FFFBEB;border:1px solid #FDE68A;
       color:#92400E;font-size:.88rem;line-height:1.55}
  .ft{margin-top:16px;padding-top:12px;border-top:1px dashed var(--line);font-size:.75rem;color:#9CA3AF;line-height:1.65}
  table{width:100%}
  @media (max-width:620px){
    body{padding:0}
    .sheet{border-radius:0;padding:14px 12px 20px;box-shadow:none;max-width:none}
    .hd h1{font-size:1.16rem;margin:6px 0 11px}
    /* Giữ 2 cột nhãn/giá trị (nhãn ngắn nên vẫn vừa) — xếp dọc thì khối này cao gấp đôi
       và đẩy bảng lương xuống quá xa, người xem phải cuộn mới thấy số tiền. */
    .meta{grid-template-columns:auto 1fr;gap:5px 12px;font-size:.83rem}
    .meta dt{font-size:.64rem}
  }
  @media print{
    body{background:#fff;padding:0}
    .sheet{box-shadow:none;border-radius:0;max-width:none;padding:0}
    .ft{color:#6B7280}
  }
  @page{size:A4;margin:12mm}
</style>
</head>
<body>
<div class="sheet">
  <div class="hd">
    <div class="co">${esc(companyName || 'Trung Tâm Ngoại Ngữ & Toán Tư Duy Trẻ')}</div>
    <h1>Bảng lương tháng ${Number(m)}/${y}</h1>
    <dl class="meta">
      <dt>Họ tên</dt><dd>${esc(staffName)}</dd>
      <dt>Tài khoản</dt><dd>${esc(account || '—')}</dd>
      <dt>MSNV</dt><dd>${esc(msnv || '—')}</dd>
      <dt>Vai trò</dt><dd>${esc(roleLabel)}</dd>
    </dl>
    <div class="tagline"><span class="tag ${status === 'received' ? 'ok' : ''}">${esc(statusText)}</span></div>
  </div>
  ${card}
  ${message ? `<div class="msg"><b>Nhắn gửi:</b> ${esc(message)}</div>` : ''}
  <div class="ft">
    File xuất từ Hệ Thống Chấm Công — nội dung lấy nguyên bản bảng lương đã lưu${status === 'draft' ? ' (chưa gửi cho nhân viên)' : ' và gửi cho nhân viên'} tháng ${Number(m)}/${y}.<br>
    Muốn lưu thành PDF: mở file này rồi bấm Ctrl+P (điện thoại: Chia sẻ → In) → chọn "Save as PDF".
  </div>
</div>
</body>
</html>`;
    }

    window.buildSavedPayslipHtml = buildPayslipHtml;

    // ---------- Danh sách người + từng bên vai trò (dùng chung cho ZIP và Excel) ----------
    // Yêu cầu 22/09/2026: danh sách lương Giáo viên/Trợ giảng và Tiếp tân tách riêng, đánh số
    // thứ tự từ trên xuống theo MSNV để chi trả lần lượt. MSNV = phần số ở cuối tên tài khoản
    // (vd "dung39" → 39), đúng cách trang Tính Lương đang sắp xếp. Chỉ có 2 chức vụ: người
    // làm văn phòng được tính vào bên Tiếp tân (lương của họ nằm ở details_tt).
    const ROLE_SIDES = {
        'giao-vien': { key: 'giao-vien', folder: 'Giao Vien', roleLabel: 'Giao Vien', roleShow: 'Giáo viên / Trợ giảng', sheet: 'Giáo viên - Trợ giảng' },
        'tiep-tan': { key: 'tiep-tan', folder: 'Tiep Tan', roleLabel: 'Tiep Tan', roleShow: 'Tiếp tân', sheet: 'Tiếp tân' }
    };

    function msnvOf(u) {
        const match = String((u && u.username) || '').match(/\d+$/);
        return match ? match[0] : '';
    }

    // Cùng thứ tự với bảng ở trang Tính Lương (report.js populateStaffSelect)
    function compareStaff(a, b) {
        const na = a.msnv ? parseInt(a.msnv, 10) : null;
        const nb = b.msnv ? parseInt(b.msnv, 10) : null;
        if (na !== null && nb !== null && na !== nb) return na - nb;
        if (na !== null && nb === null) return -1;
        if (na === null && nb !== null) return 1;
        return String(a.account || a.staffName).localeCompare(String(b.account || b.staffName), 'vi');
    }

    function statusText(st) {
        if (st === 'received') return 'Đã nhận';
        if (st === 'published') return 'Đã gửi - chờ chi';
        if (st === 'draft') return 'Chưa gửi (bản nháp)';
        return 'Chưa tính';
    }

    function statusAllowedFor(statusMode) {
        return (st) => {
            if (!st) return false;
            if (statusMode === 'received') return st === 'received';
            if (statusMode === 'sent') return st === 'published' || st === 'received';
            return st === 'draft' || st === 'published' || st === 'received'; // any = đã tính
        };
    }

    function statusModeText(statusMode) {
        if (statusMode === 'received') return 'chỉ người Đã nhận';
        if (statusMode === 'any') return 'mọi người đã tính lương (gồm cả bản nháp)';
        return 'Đã gửi + Đã nhận';
    }

    // Số tiền của một bên. "Phụ cấp / thưởng / phạt" = phần chênh còn lại, để 4 cột luôn khớp:
    // Lương cơ bản + Phụ cấp/thưởng/phạt − Tạm ứng = Thực lĩnh (đúng số nhân viên đã nhận).
    function sideMoney(details, fallbackNet) {
        const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };
        let net = num(details && details.netPay);
        if (net === null) net = num(fallbackNet) || 0;
        const base = num(details && details.baseSalary) || 0;
        const advance = num(details && details.advance) || 0;
        return { base, advance, other: net - base + advance, net };
    }

    function collectPayroll(allSettings, userMap, scope, statusMode) {
        const allowed = statusAllowedFor(statusMode);
        const people = [];
        const skipped = [];   // {name, why}

        Object.keys(allSettings || {}).forEach(staffId => {
            const pub = (allSettings[staffId] || {}).published;
            const u = userMap[staffId];
            const staffName = (u && (u.name || u.username)) || (pub && pub.details && pub.details.staffName) || staffId;
            const account = (u && u.username) || '';

            if (!pub) { return; } // chưa từng tính lương → không phải lỗi, bỏ im lặng
            if (!u) { skipped.push({ name: staffName, why: 'không tìm thấy nhân viên trong Nhân Sự' }); return; }

            // Hai bên vai trò tách riêng: người làm cả 2 có mặt ở cả 2 danh sách, không trộn số liệu
            const lifecycle = DBService.getPayslipLifecycleState(pub);
            const gvDetails = pub.details_gv || (pub.role !== 'tiep-tan' && pub.role !== 'dual' ? pub.details : null);
            const ttDetails = pub.details_tt || (pub.role === 'tiep-tan' ? pub.details : null);
            const all = [];
            if (gvDetails) all.push(Object.assign({}, ROLE_SIDES['giao-vien'], { details: gvDetails, status: lifecycle.has_gv ? lifecycle.status_gv : null }));
            if (ttDetails) all.push(Object.assign({}, ROLE_SIDES['tiep-tan'], { details: ttDetails, status: lifecycle.has_tt ? lifecycle.status_tt : null }));
            const single = all.length === 1;
            all.forEach(side => { side.money = sideMoney(side.details, single ? pub.netPay : null); });

            const inScope = all.filter(side => scope === 'all' || scope === side.key);
            if (inScope.length === 0) {
                if (scope === 'all') skipped.push({ name: staffName, why: 'chưa tính lương bên nào' });
                return;
            }
            const sides = [];
            inScope.forEach(side => {
                if (allowed(side.status)) sides.push(side);
                else skipped.push({ name: `${staffName} (${side.roleShow})`, why: side.status === 'draft' ? 'đã tính nhưng CHƯA GỬI' : 'chưa tính lương' });
            });
            if (sides.length === 0) return;

            people.push({ staffId, u, pub, staffName, account, msnv: msnvOf(u), allSides: all, sides });
        });

        people.sort(compareStaff);

        // STT riêng cho từng danh sách, từ 1 trở đi theo thứ tự MSNV
        const lists = { 'giao-vien': [], 'tiep-tan': [] };
        people.forEach(person => {
            person.sides.forEach(side => {
                const list = lists[side.key];
                side.stt = list.length + 1;
                list.push({ person, side });
            });
        });
        return { people, lists, skipped };
    }

    async function loadMonthPayroll(monthStr) {
        DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
        const [allSettings, users, sysSettings] = await Promise.all([
            DBService.getAllMonthlySalarySettings(monthStr, { strict: true }),
            DBService.getUsers(),
            DBService.getSystemSettings().catch(() => null)
        ]);
        const userMap = {};
        (users || []).forEach(u => { if (u && u.id) userMap[u.id] = u; });
        return { allSettings, userMap, companyName: (sysSettings && sysSettings.companyName) || '' };
    }

    function currentMonthInfo() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        return { year, month, monthStr: `${year}-${String(month + 1).padStart(2, '0')}` };
    }

    function triggerDownload(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    function fmtMoney(n) {
        const v = Math.round(Number(n) || 0);
        return (v < 0 ? '-' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
    }

    // ---------- File Excel (.xlsx) viết tay, không thư viện ngoài ----------
    // .xlsx thực chất là một file ZIP chứa vài file XML → dùng lại buildZip ở trên.
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    function xmlEsc(s) {
        return String(s == null ? '' : s)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function colName(i) {
        let s = '';
        i += 1;
        while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
        return s;
    }

    // Kiểu ô (chỉ số trong cellXfs của styles.xml bên dưới)
    const ST = { title: 1, sub: 2, head: 3, text: 4, center: 5, money: 6, totalLabel: 7, totalMoney: 8, note: 9, net: 10, totalCenter: 11 };

    const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0;[Red]\\-#,##0"/></numFmts>'
        + '<fonts count="5">'
        + '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
        + '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
        + '<font><b/><sz val="15"/><color rgb="FF047857"/><name val="Calibri"/><family val="2"/></font>'
        + '<font><i/><sz val="10"/><color rgb="FF5B6660"/><name val="Calibri"/><family val="2"/></font>'
        + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
        + '</fonts>'
        + '<fills count="4">'
        + '<fill><patternFill patternType="none"/></fill>'
        + '<fill><patternFill patternType="gray125"/></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FF047857"/><bgColor indexed="64"/></patternFill></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/><bgColor indexed="64"/></patternFill></fill>'
        + '</fills>'
        + '<borders count="2">'
        + '<border><left/><right/><top/><bottom/><diagonal/></border>'
        + '<border><left style="thin"><color rgb="FFC9D3CE"/></left><right style="thin"><color rgb="FFC9D3CE"/></right>'
        + '<top style="thin"><color rgb="FFC9D3CE"/></top><bottom style="thin"><color rgb="FFC9D3CE"/></bottom><diagonal/></border>'
        + '</borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="12">'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        + '<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
        + '<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
        + '<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        + '</cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '</styleSheet>';

    // cell: { v, s, f } — v là số → ô số; chuỗi → ô chữ; f = công thức (v là giá trị tính sẵn)
    function cellXml(ref, cell) {
        if (cell == null) return '';
        const s = cell.s != null ? ` s="${cell.s}"` : '';
        if (cell.f) return `<c r="${ref}"${s}><f>${xmlEsc(cell.f)}</f><v>${Number(cell.v) || 0}</v></c>`;
        if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return `<c r="${ref}"${s}><v>${cell.v}</v></c>`;
        if (cell.v == null || cell.v === '') return `<c r="${ref}"${s}/>`;
        return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`;
    }

    // sheet: { name, widths:[], rows:[{ cells:[cell], ht? }], merges:[ 'A1:K1' ], headerRow }
    function sheetXml(sheet) {
        const lastCol = colName(sheet.widths.length - 1);
        const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
        const rows = sheet.rows.map((row, ri) => {
            const r = ri + 1;
            const ht = row.ht ? ` ht="${row.ht}" customHeight="1"` : '';
            const cells = (row.cells || []).map((c, ci) => cellXml(colName(ci) + r, c)).join('');
            return `<row r="${r}"${ht}>${cells}</row>`;
        }).join('');
        const h = sheet.headerRow;
        const pane = h ? `<pane ySplit="${h}" topLeftCell="A${h + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${h + 1}" sqref="A${h + 1}"/>` : '';
        const merges = sheet.merges && sheet.merges.length
            ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
            + `<dimension ref="A1:${lastCol}${Math.max(1, sheet.rows.length)}"/>`
            + `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>`
            + '<sheetFormatPr defaultRowHeight="18"/>'
            + `<cols>${cols}</cols>`
            + `<sheetData>${rows}</sheetData>`
            + merges
            + '<printOptions horizontalCentered="1"/>'
            + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
            + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
            + '</worksheet>';
    }

    function buildXlsx(sheets) {
        const ctSheets = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
        const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            + '<Default Extension="xml" ContentType="application/xml"/>'
            + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + ctSheets
            + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + '</Types>';
        const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            + '</Relationships>';
        const printTitles = sheets.map((sh, i) => sh.headerRow
            ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${sh.name.replace(/'/g, "''")}'!$${sh.headerRow}:$${sh.headerRow}</definedName>` : '').join('');
        const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + '<bookViews><workbookView activeTab="0"/></bookViews><sheets>'
            + sheets.map((sh, i) => `<sheet name="${xmlEsc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
            + '</sheets>'
            + (printTitles ? `<definedNames>${printTitles}</definedNames>` : '')
            + '</workbook>';
        const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
            + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
            + '</Relationships>';

        const entries = [
            { name: '[Content_Types].xml', text: contentTypes },
            { name: '_rels/.rels', text: rootRels },
            { name: 'xl/workbook.xml', text: workbook },
            { name: 'xl/_rels/workbook.xml.rels', text: wbRels },
            { name: 'xl/styles.xml', text: STYLES_XML }
        ].concat(sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(sh) })));
        return buildZip(entries, XLSX_MIME);
    }

    // MSNV là số (không có số 0 đứng đầu) → ghi thành ô số cho Excel khỏi báo "số dạng chữ"
    function msnvCell(msnv) {
        return { v: /^[1-9]\d*$/.test(msnv) ? Number(msnv) : (msnv || '—'), s: ST.center };
    }

    function stampText(d) {
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function roleSheet(roleKey, list, ctx) {
        const role = ROLE_SIDES[roleKey];
        const other = ROLE_SIDES[roleKey === 'giao-vien' ? 'tiep-tan' : 'giao-vien'];
        const head = ['STT', 'MSNV', 'Họ và tên', 'Tài khoản', 'Lương cơ bản', 'Phụ cấp / Thưởng / Phạt', 'Tạm ứng', 'Thực lĩnh', 'Trạng thái', 'Ghi chú', 'Ký nhận'];
        const widths = [6, 9, 28, 16, 15, 17, 13, 16, 19, 38, 14];
        const lastCol = colName(head.length - 1);
        const rows = [
            { cells: [{ v: `DANH SÁCH LƯƠNG ${role.roleShow.toUpperCase()} - THÁNG ${ctx.month + 1}/${ctx.year}`, s: ST.title }], ht: 26 },
            { cells: [{ v: `${ctx.companyName ? ctx.companyName + ' · ' : ''}Xuất lúc ${ctx.stamp} · Lọc: ${ctx.statusLabel}`, s: ST.sub }] },
            { cells: [{ v: `Số thứ tự xếp theo MSNV từ nhỏ đến lớn. Người kiêm 2 chức vụ có tên ở cả 2 danh sách; mỗi danh sách chỉ ghi phần lương ${role.roleShow}. Thực lĩnh = Lương cơ bản + Phụ cấp/Thưởng/Phạt − Tạm ứng.`, s: ST.sub }] },
            { cells: head.map(h => ({ v: h, s: ST.head })), ht: 32 }
        ];
        const headerRow = rows.length;
        const firstData = headerRow + 1;

        list.forEach(({ person, side }) => {
            const m = side.money;
            let note = '';
            const otherSide = person.allSides.find(s => s.key === other.key);
            if (otherSide) {
                const listed = person.sides.find(s => s.key === other.key);
                note = listed
                    ? `Kiêm ${other.roleShow} (STT ${listed.stt} bên sheet "${other.sheet}", ${fmtMoney(listed.money.net)}). Tổng 2 bên: ${fmtMoney(m.net + listed.money.net)}`
                    : `Kiêm ${other.roleShow} — phần đó ${otherSide.status === 'draft' ? 'chưa gửi' : 'không nằm trong bộ lọc'}, chưa tính vào đây`;
            }
            rows.push({
                cells: [
                    { v: side.stt, s: ST.center },
                    msnvCell(person.msnv),
                    { v: person.staffName, s: ST.text },
                    { v: person.account, s: ST.text },
                    { v: m.base, s: ST.money },
                    { v: m.other, s: ST.money },
                    { v: m.advance, s: ST.money },
                    { v: m.net, s: ST.net },
                    { v: statusText(side.status), s: ST.center },
                    { v: note, s: ST.note },
                    { v: '', s: ST.text }
                ]
            });
        });

        const lastData = rows.length;
        const sum = (col, key) => ({
            f: list.length ? `SUM(${col}${firstData}:${col}${lastData})` : '',
            v: list.reduce((t, it) => t + it.side.money[key], 0),
            s: ST.totalMoney
        });
        rows.push({
            cells: [
                { v: `TỔNG CỘNG (${list.length} người)`, s: ST.totalLabel },
                { v: '', s: ST.totalLabel }, { v: '', s: ST.totalLabel }, { v: '', s: ST.totalLabel },
                sum('E', 'base'), sum('F', 'other'), sum('G', 'advance'), sum('H', 'net'),
                { v: '', s: ST.totalCenter }, { v: '', s: ST.totalCenter }, { v: '', s: ST.totalCenter }
            ],
            ht: 22
        });
        const totalRow = rows.length;
        return {
            name: role.sheet, widths, rows, headerRow,
            merges: [`A1:${lastCol}1`, `A2:${lastCol}2`, `A3:${lastCol}3`, `A${totalRow}:D${totalRow}`]
        };
    }

    // Tổng chi theo người: mỗi người 1 dòng, cộng cả 2 bên — tiện chuyển khoản 1 lần/người
    function summarySheet(people, ctx) {
        const head = ['STT', 'MSNV', 'Họ và tên', 'Tài khoản', 'Chức vụ', 'Lương Giáo viên / Trợ giảng', 'Lương Tiếp tân', 'Tổng thực lĩnh', 'Trạng thái', 'Ký nhận'];
        const widths = [6, 9, 28, 16, 30, 18, 16, 17, 34, 14];
        const lastCol = colName(head.length - 1);
        const rows = [
            { cells: [{ v: `TỔNG CHI LƯƠNG THEO NGƯỜI - THÁNG ${ctx.month + 1}/${ctx.year}`, s: ST.title }], ht: 26 },
            { cells: [{ v: `${ctx.companyName ? ctx.companyName + ' · ' : ''}Xuất lúc ${ctx.stamp} · Lọc: ${ctx.statusLabel}`, s: ST.sub }] },
            { cells: [{ v: 'Mỗi người 1 dòng; người kiêm 2 chức vụ được cộng cả 2 bên. Chi tiết từng bên xem 2 sheet "Giáo viên - Trợ giảng" và "Tiếp tân".', s: ST.sub }] },
            { cells: head.map(h => ({ v: h, s: ST.head })), ht: 32 }
        ];
        const headerRow = rows.length;
        const firstData = headerRow + 1;
        let tGv = 0, tTt = 0;
        people.forEach((person, i) => {
            const gv = person.sides.find(s => s.key === 'giao-vien');
            const tt = person.sides.find(s => s.key === 'tiep-tan');
            const gvNet = gv ? gv.money.net : 0;
            const ttNet = tt ? tt.money.net : 0;
            tGv += gvNet; tTt += ttNet;
            const roleText = gv && tt ? 'Giáo viên / Trợ giảng + Tiếp tân' : (gv ? ROLE_SIDES['giao-vien'].roleShow : ROLE_SIDES['tiep-tan'].roleShow);
            const st = gv && tt
                ? (gv.status === tt.status ? statusText(gv.status) : `GV/TG: ${statusText(gv.status)} · TT: ${statusText(tt.status)}`)
                : statusText((gv || tt).status);
            rows.push({
                cells: [
                    { v: i + 1, s: ST.center },
                    msnvCell(person.msnv),
                    { v: person.staffName, s: ST.text },
                    { v: person.account, s: ST.text },
                    { v: roleText, s: ST.text },
                    gv ? { v: gvNet, s: ST.money } : { v: '', s: ST.center },
                    tt ? { v: ttNet, s: ST.money } : { v: '', s: ST.center },
                    { v: gvNet + ttNet, s: ST.net },
                    { v: st, s: ST.note },
                    { v: '', s: ST.text }
                ]
            });
        });
        const lastData = rows.length;
        const f = col => people.length ? `SUM(${col}${firstData}:${col}${lastData})` : '';
        rows.push({
            cells: [
                { v: `TỔNG CỘNG (${people.length} người)`, s: ST.totalLabel },
                { v: '', s: ST.totalLabel }, { v: '', s: ST.totalLabel }, { v: '', s: ST.totalLabel }, { v: '', s: ST.totalLabel },
                { f: f('F'), v: tGv, s: ST.totalMoney }, { f: f('G'), v: tTt, s: ST.totalMoney }, { f: f('H'), v: tGv + tTt, s: ST.totalMoney },
                { v: '', s: ST.totalCenter }, { v: '', s: ST.totalCenter }
            ],
            ht: 22
        });
        const totalRow = rows.length;
        return {
            name: 'Tổng chi theo người', widths, rows, headerRow,
            merges: [`A1:${lastCol}1`, `A2:${lastCol}2`, `A3:${lastCol}3`, `A${totalRow}:E${totalRow}`]
        };
    }

    function buildPayrollListXlsx(collected, ctx, scope) {
        const sheets = [];
        if (scope !== 'tiep-tan') sheets.push(roleSheet('giao-vien', collected.lists['giao-vien'], ctx));
        if (scope !== 'giao-vien') sheets.push(roleSheet('tiep-tan', collected.lists['tiep-tan'], ctx));
        if (scope === 'all') sheets.push(summarySheet(collected.people, ctx));
        return buildXlsx(sheets);
    }

    function listFileName(ctx) {
        return safeFilePart(`Danh sach luong thang ${ctx.month + 1}-${ctx.year}`) + '.xlsx';
    }

    function skippedText(skipped) {
        if (!skipped.length) return '';
        const show = skipped.slice(0, 12).map(s => `• ${s.name} — ${s.why}`).join('\n');
        let msg = `\n\nBỏ qua ${skipped.length} mục:\n${show}`;
        if (skipped.length > 12) msg += `\n… và ${skipped.length - 12} mục nữa (xem Console).`;
        console.warn('[Xuất bảng lương] Bỏ qua:', skipped);
        return msg;
    }

    // Test tự động gọi được mà không cần Firestore
    window.SalaryBulkExport = { collectPayroll, buildPayrollListXlsx, buildXlsx, buildZip, msnvOf, sideMoney };

    // ---------- Nút "Tải danh sách lương" (Excel) ----------
    window.exportPayrollList = async function exportPayrollList() {
        const btn = document.getElementById('btn-export-payroll-list');
        const label = document.getElementById('btn-export-payroll-list-label');
        const setLabel = (t) => { if (label) label.innerText = t; };
        const scope = document.getElementById('export-scope')?.value || 'all';
        const statusMode = document.getElementById('export-status')?.value || 'sent';
        const { year, month, monthStr } = currentMonthInfo();

        try {
            if (btn) btn.disabled = true;
            setLabel('Đang lấy dữ liệu...');
            UIService.showLoading('Đang lập danh sách lương...');
            const data = await loadMonthPayroll(monthStr);
            const collected = collectPayroll(data.allSettings, data.userMap, scope, statusMode);
            const gvCount = collected.lists['giao-vien'].length;
            const ttCount = collected.lists['tiep-tan'].length;

            if (gvCount + ttCount === 0) {
                UIService.hideLoading();
                await UIService.notice(
                    `Không có ai khớp điều kiện đang chọn (tháng ${month + 1}/${year}).\n` +
                    `Hãy đổi bộ lọc "Xuất" / trạng thái, hoặc tính & gửi lương trước đã.`,
                    'Chưa có gì để xuất', 'warning'
                );
                return;
            }

            const ctx = { year, month, companyName: data.companyName, stamp: stampText(new Date()), statusLabel: statusModeText(statusMode) };
            const fileName = listFileName(ctx);
            triggerDownload(buildPayrollListXlsx(collected, ctx, scope), fileName);
            UIService.hideLoading();

            const dual = collected.people.filter(p => p.sides.length > 1).length;
            const parts = [];
            if (scope !== 'tiep-tan') parts.push(`Giáo viên / Trợ giảng: ${gvCount} người`);
            if (scope !== 'giao-vien') parts.push(`Tiếp tân: ${ttCount} người`);
            let msg = `Đã tải "${fileName}".\n${parts.join(' · ')}`
                + (scope === 'all' ? `\nSheet "Tổng chi theo người": ${collected.people.length} người${dual ? ` (${dual} người kiêm 2 chức vụ đã cộng 2 bên)` : ''}.` : '')
                + '\nSố thứ tự xếp theo MSNV từ nhỏ đến lớn.';
            msg += skippedText(collected.skipped);
            await UIService.notice(msg, 'Tải danh sách lương xong', 'success');
        } catch (e) {
            console.error('[Danh sách lương] Lỗi:', e);
            UIService.hideLoading();
            UIService.toast('Tải danh sách lương thất bại: ' + (e.message || e), 'error');
        } finally {
            if (btn) btn.disabled = false;
            setLabel('Tải danh sách lương (Excel)');
        }
    };

    // ---------- Nút "Xuất file bảng lương" (ZIP từng người) ----------
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
        const { year, month, monthStr } = currentMonthInfo();

        try {
            if (btn) { btn.disabled = true; }
            setLabel('Đang lấy dữ liệu...');
            UIService.showLoading('Đang chuẩn bị file bảng lương...');

            const data = await loadMonthPayroll(monthStr);
            const collected = collectPayroll(data.allSettings, data.userMap, scope, statusMode);
            const companyName = data.companyName;

            const entries = [];
            const usedNames = new Set();
            const peopleDone = new Set();
            const sttWidth = Math.max(2, String(Math.max(collected.lists['giao-vien'].length, collected.lists['tiep-tan'].length)).length);

            collected.people.forEach(person => {
                const { staffName, account, msnv, pub } = person;
                // Đã có thư mục riêng cho từng bên nên tên file không cần đuôi vai trò nữa;
                // chỉ giữ lại khi người này có cả 2 bên (để lỡ ai copy 2 file ra cùng một chỗ
                // thì vẫn phân biệt được, không ghi đè nhau).
                const withRole = person.sides.length > 1;
                person.sides.forEach(side => {
                    // details.role quyết định mẫu form (tiếp tân / giáo viên) — bảo đảm đúng vai trò
                    const details = Object.assign({}, side.details);
                    if (!details.role) details.role = side.key;
                    if (!details.staffName) details.staffName = staffName;
                    if (!details.employeeId) details.employeeId = String(account || '').toUpperCase();

                    // Số thứ tự đứng đầu tên file = STT trong danh sách lương (xếp theo MSNV)
                    const stt = String(side.stt).padStart(sttWidth, '0');
                    let name = side.folder + '/' + stt + ' - ' + buildFileName(monthStr, staffName, account, side.roleLabel, withRole);
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
                    peopleDone.add(person.staffId);
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

            // Khai báo thư mục thành entry riêng (tên kết thúc bằng "/", nội dung rỗng).
            // Trình giải nén nào cũng tự tạo thư mục từ đường dẫn, nhưng khai rõ thì thư mục
            // vẫn hiện đúng ngay cả khi một bên không có file nào.
            const folders = [...new Set(entries.map(e => e.name.split('/')[0]))].sort();
            const ctx = { year, month, companyName, stamp: stampText(new Date()), statusLabel: statusModeText(statusMode) };
            const listBlob = buildPayrollListXlsx(collected, ctx, scope);
            const listBytes = new Uint8Array(await listBlob.arrayBuffer());
            const zipEntries = [{ name: listFileName(ctx), bytes: listBytes }]
                .concat(folders.map(f => ({ name: f + '/', text: '' })))
                .concat(entries);

            const blob = buildZip(zipEntries);
            const zipName = safeFilePart(`Bang luong thang ${month + 1}-${year}`) + '.zip';
            triggerDownload(blob, zipName);

            UIService.hideLoading();

            // Báo cáo đầy đủ — KHÔNG im lặng bỏ sót ai. UIService.notice tự escape HTML nên
            // ở đây truyền CHỮ THUẦN, chỉ dùng \n để xuống dòng.
            const perFolder = folders.map(f => `${f}: ${entries.filter(e => e.name.startsWith(f + '/')).length} file`).join(' · ');
            let msg = `Đã xuất ${entries.length} file của ${peopleDone.size} nhân viên vào "${zipName}".\n`
                    + `Chia thư mục — ${perFolder}.\n`
                    + `Kèm file danh sách "${listFileName(ctx)}"; số đầu tên file = STT trong danh sách.`;
            msg += skippedText(collected.skipped);
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
