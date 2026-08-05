// ============ DỌN GHI CHÚ NGÀY BỊ LỘN NGƯỜI ============
// Lỗi cũ (đã vá 2026-08-05): trang Bảng Công lưu ghi chú bằng cách GHI ĐÈ cả tập ghi chú
// của một nhân viên, lấy từ một biến dùng chung cho mọi người. Admin đổi người trên ô
// chọn mà trang không tải lại → toàn bộ ghi chú người A bị chép sang người B.
//
// Vá code chỉ chặn hỏng THÊM, không hoàn lại dữ liệu đã hỏng. File này quét ra những
// ghi chú giống hệt nhau đang nằm ở NHIỀU người và để admin tự quyết xóa khỏi ai —
// máy KHÔNG tự đoán ai là chủ thật, vì đoán sai là mất ghi chú thật của người ta.
(function () {
    'use strict';

    var scanned = null; // { dupes: [...], fullCopies: [...] }

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function box() { return document.getElementById('note-repair-result'); }

    function say(html) {
        var el = box();
        if (el) { el.style.display = 'block'; el.innerHTML = html; }
    }

    function norm(text) { return String(text == null ? '' : text).trim(); }

    async function scan() {
        say('<div style="color:var(--text-muted);">Đang đọc ghi chú của tất cả nhân viên...</div>');
        var users, notesByStaff = {};
        try {
            users = await DBService.getUsers();
        } catch (e) {
            say('<div style="color:#B91C1C;">Không đọc được danh sách nhân viên: ' + esc(e.message) + '</div>');
            return;
        }

        var nameOf = {};
        users.forEach(function (u) { nameOf[String(u.id)] = u.name || u.username || u.id; });

        var snap;
        try {
            snap = await window.db.collection('daily_notes').get();
        } catch (e) {
            say('<div style="color:#B91C1C;">Không đọc được ghi chú: ' + esc(e.message) + '</div>');
            return;
        }
        snap.forEach(function (doc) { notesByStaff[doc.id] = doc.data() || {}; });

        // 1) Gom theo (ngày + nội dung): nội dung y hệt mà nằm ở 2 người trở lên là dấu
        //    hiệu bị chép nhầm — người ta không ghi trùng từng chữ cho hai người.
        var byKey = {};
        Object.keys(notesByStaff).forEach(function (staffId) {
            var notes = notesByStaff[staffId];
            Object.keys(notes).forEach(function (dateKey) {
                var text = norm(notes[dateKey]);
                if (!text) return;
                var k = dateKey + '||' + text;
                (byKey[k] = byKey[k] || []).push(staffId);
            });
        });
        var dupes = Object.keys(byKey)
            .filter(function (k) { return byKey[k].length > 1; })
            .map(function (k) {
                var parts = k.split('||');
                return { dateKey: parts[0], text: parts.slice(1).join('||'), staffIds: byKey[k] };
            })
            .sort(function (a, b) { return a.dateKey < b.dateKey ? 1 : -1; });

        // 2) Dấu hiệu NẶNG: hai người có TOÀN BỘ tập ghi chú giống hệt nhau → gần như
        //    chắc chắn một người đã bị ghi đè mất sạch ghi chú thật.
        var sig = {};
        Object.keys(notesByStaff).forEach(function (staffId) {
            var notes = notesByStaff[staffId];
            var keys = Object.keys(notes).filter(function (d) { return norm(notes[d]); }).sort();
            if (keys.length === 0) return;
            var s = keys.map(function (d) { return d + '=' + norm(notes[d]); }).join('|');
            (sig[s] = sig[s] || []).push(staffId);
        });
        var fullCopies = Object.keys(sig)
            .filter(function (s) { return sig[s].length > 1; })
            .map(function (s) { return { staffIds: sig[s], count: s.split('|').length }; });

        scanned = { dupes: dupes, fullCopies: fullCopies, nameOf: nameOf };
        render();
    }

    function render() {
        if (!scanned) return;
        var nameOf = scanned.nameOf;
        var html = '';

        if (scanned.fullCopies.length > 0) {
            html += '<div style="background:#FEE2E2;border:1px solid #FCA5A5;color:#991B1B;' +
                'padding:0.9rem 1rem;border-radius:10px;margin-bottom:1rem;font-size:0.88rem;line-height:1.6;">' +
                '<b>Nghiêm trọng:</b> có ' + scanned.fullCopies.length +
                ' nhóm người đang mang TOÀN BỘ tập ghi chú giống hệt nhau — nhiều khả năng một người ' +
                'đã bị ghi đè mất sạch ghi chú thật (không khôi phục lại được, chỉ xóa phần chép nhầm đi).<ul style="margin:0.5rem 0 0 1.1rem;">';
            scanned.fullCopies.forEach(function (g) {
                html += '<li>' + esc(g.staffIds.map(function (id) { return nameOf[id] || id; }).join('  ↔  ')) +
                    ' (' + g.count + ' ghi chú)</li>';
            });
            html += '</ul></div>';
        }

        if (scanned.dupes.length === 0) {
            html += '<div style="background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;' +
                'padding:0.9rem 1rem;border-radius:10px;">Không tìm thấy ghi chú nào bị trùng giữa các nhân viên.</div>';
            say(html);
            return;
        }

        html += '<div style="color:var(--text-muted);font-size:0.86rem;margin-bottom:0.9rem;line-height:1.6;">' +
            'Tìm thấy <b>' + scanned.dupes.length + '</b> ghi chú đang nằm ở nhiều người cùng lúc. ' +
            'Máy <b>không tự đoán</b> ai là chủ thật — chị xem rồi bấm <b>Xóa khỏi người này</b> ở ' +
            'những người KHÔNG phải chủ của ghi chú đó. Người còn lại giữ nguyên.</div>';

        scanned.dupes.forEach(function (d, i) {
            html += '<div style="border:1px solid var(--border-color);border-radius:10px;padding:0.85rem 1rem;margin-bottom:0.7rem;background:#fff;">' +
                '<div style="font-size:0.76rem;font-weight:700;color:#6B7280;letter-spacing:.5px;">NGÀY ' + esc(d.dateKey) + '</div>' +
                '<div style="font-weight:600;margin:0.3rem 0 0.7rem;">“' + esc(d.text) + '”</div>' +
                '<div style="display:flex;flex-wrap:wrap;gap:0.5rem;">';
            d.staffIds.forEach(function (sid) {
                html += '<span style="display:inline-flex;align-items:center;gap:0.5rem;border:1px solid var(--border-color);' +
                    'border-radius:999px;padding:0.3rem 0.35rem 0.3rem 0.8rem;font-size:0.85rem;">' +
                    esc(nameOf[sid] || sid) +
                    '<button class="btn" style="background:#FEE2E2;color:#B91C1C;border:none;border-radius:999px;' +
                    'padding:0.3rem 0.7rem;font-size:0.78rem;font-weight:700;cursor:pointer;" ' +
                    'onclick="NoteRepair.removeOne(' + i + ',\'' + esc(sid) + '\')">Xóa khỏi người này</button></span>';
            });
            html += '</div></div>';
        });

        say(html);
    }

    async function removeOne(index, staffId) {
        if (!scanned || !scanned.dupes[index]) return;
        var d = scanned.dupes[index];
        var who = scanned.nameOf[staffId] || staffId;
        if (!confirm('Xóa ghi chú ngày ' + d.dateKey + ' của "' + who + '"?\n\n“' + d.text + '”\n\n' +
            'Chỉ xóa ở người này, những người khác giữ nguyên. Không hoàn tác được.')) return;

        try {
            // Đọc lại rồi chỉ bỏ đúng một ngày — không ghi đè cả tập.
            var notes = { ...(await DBService.getDailyNotes(staffId) || {}) };
            if (norm(notes[d.dateKey]) !== d.text) {
                alert('Ghi chú của người này đã thay đổi so với lúc quét. Vui lòng quét lại.');
                return;
            }
            delete notes[d.dateKey];
            await DBService.saveDailyNotes(staffId, notes);
        } catch (e) {
            alert('Lỗi khi xóa: ' + (e.message || e));
            return;
        }

        d.staffIds = d.staffIds.filter(function (id) { return id !== staffId; });
        if (d.staffIds.length < 2) scanned.dupes.splice(index, 1);
        // index của các mục sau đã đổi → vẽ lại toàn bộ cho khớp
        scanned.fullCopies = [];
        render();
    }

    window.NoteRepair = { scan: scan, removeOne: removeOne };
})();
