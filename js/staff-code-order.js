/* Thứ tự mã nhân viên dùng chung (chủ trung tâm 08/11/2026):
   "Chạy hết số mới đến chữ, chữ thì theo abc, nếu trùng chữ thì mới xét số"
   → 1, 2 … 70, rồi N1 … N5, rồi V1 … V5, không có mã xuống cuối.
   Cách đọc mã giống trang Nhân sự (personnel.js parseStaffCode):
   dung39 → 39, anhv3 → V3, huyenn1 → N1, huyenN10 → N10. Tên Việt hay tận cùng
   bằng "n" (van75) nên chữ n viết thường chỉ là mã khi đi với đúng 1 chữ số. */
(function (root) {
    'use strict';

    function parse(username) {
        var match = String(username == null ? '' : username).trim().match(/^(.*?)(\d+)$/);
        if (!match || /^admin$/i.test(match[1])) return null;
        var before = match[1], digits = match[2];
        var last = before.slice(-1), prev = before.slice(-2, -1);
        var isLetterCode = (/[A-Z]/.test(last) && !/[A-Z]/.test(prev)) || /v/i.test(last) ||
            (last === 'n' && digits.length === 1);
        var number = parseInt(digits, 10);
        if (!isLetterCode) return { letter: '', number: number, text: digits };
        return { letter: last.toUpperCase(), number: number, text: last.toUpperCase() + digits };
    }

    // "V3", "N1", "39" — chuỗi rỗng khi không có mã.
    function codeText(username) {
        var code = parse(username);
        return code ? code.text : '';
    }

    // So sánh 2 tên đăng nhập; trả 0 khi cùng mã để nơi gọi tự xếp tiếp theo tên.
    function compareUsernames(a, b) {
        var codeA = parse(a), codeB = parse(b);
        if (codeA && !codeB) return -1;
        if (!codeA && codeB) return 1;
        if (codeA && codeB) {
            if (codeA.letter !== codeB.letter) return codeA.letter < codeB.letter ? -1 : 1;
            if (codeA.number !== codeB.number) return codeA.number - codeB.number;
        }
        return 0;
    }

    // So sánh 2 mã đã đọc sẵn ("39", "N1", "V3"; rỗng = không mã) — cho bảng chỉ còn giữ mã.
    function compareCodes(a, b) {
        var toCode = function (value) {
            var match = String(value == null ? '' : value).trim().toUpperCase().match(/^([A-Z]?)(\d+)$/);
            return match ? { letter: match[1], number: parseInt(match[2], 10) } : null;
        };
        var codeA = toCode(a), codeB = toCode(b);
        if (codeA && !codeB) return -1;
        if (!codeA && codeB) return 1;
        if (codeA && codeB) {
            if (codeA.letter !== codeB.letter) return codeA.letter < codeB.letter ? -1 : 1;
            if (codeA.number !== codeB.number) return codeA.number - codeB.number;
        }
        return 0;
    }

    var api = { parse: parse, codeText: codeText, compareUsernames: compareUsernames, compareCodes: compareCodes };
    root.StaffCodeOrder = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
