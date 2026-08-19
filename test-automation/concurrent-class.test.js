// MỘT NGƯỜI DẠY 2 LỚP CÙNG KHUNG GIỜ = MỘT CA CÔNG.
// Nhân viên chỉ bấm vào ca một lần, nên hai lớp chồng giờ (VD Toán 6 + Toán 7 cùng
// 07:30–09:00) phải được coi là ĐÃ CHẤM CÔNG cả hai, gộp thành MỘT yêu cầu chấm bù,
// và không bao giờ được duyệt thành hai ca (lương đôi).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const readInline = (file) => {
    const html = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    const m = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(m, `không đọc được script trong ${file}`);
    return m[1];
};
const cutFrom = (src, start, file) => {
    const a = src.indexOf(start);
    assert.notEqual(a, -1, `không tìm thấy ${start} trong ${file}`);
    const b = src.indexOf('\n}', a);
    assert.notEqual(b, -1, `không đọc hết ${start} trong ${file}`);
    return src.slice(a, b + 2);
};

// ================= 1) Ghép công cho lớp dạy song song =================
{
    const evalSrc = fs.readFileSync(path.join(root, 'js', 'evaluation-service.js'), 'utf8');
    const context = { console, window: {}, Date, Math, Array, Number, String, Boolean, JSON };
    vm.createContext(context);
    // safeDate + getLocalDateKey là phụ thuộc của matchScheduledShiftCoverage
    vm.runInContext(`
        function safeDate(v){ if(!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
        function hasValidSessionChronology(session){
            if(!session) return false;
            const checkIn = safeDate(session.checkIn || session.start);
            const checkOut = safeDate(session.checkOut);
            return !!checkIn && (!checkOut || checkOut >= checkIn);
        }
        function getLocalDateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    `, context);
    const fn = evalSrc.slice(
        evalSrc.indexOf('function matchScheduledShiftCoverage(shifts, attendanceSessions, dateStr) {'),
        evalSrc.indexOf('window.matchScheduledShiftCoverage = matchScheduledShiftCoverage;'));
    assert.ok(fn.length > 200, 'không cắt được matchScheduledShiftCoverage');
    vm.runInContext(fn, context);
    const match = context.matchScheduledShiftCoverage;

    {
        // Ca thật của Đậu Thị Thuý Na 04/08/2026: Toán 6 và Toán 7 cùng 07:30–09:00.
        // Một lần vào ca phải che CẢ HAI — trước đây lớp thứ hai bị báo "chưa chấm công"
        // nên nhân viên đi tạo chấm bù, duyệt vào là tính lương hai lần.
        const coverage = match(
            [{ start: '07:30', end: '09:00' }, { start: '07:30', end: '09:00' }],
            [{ id: 'one', checkIn: '2026-08-04T07:30:00+07:00', checkOut: '2026-08-04T09:00:00+07:00' }],
            '2026-08-04');
        assert.deepEqual(Array.from(coverage), [true, true],
            'hai lớp cùng khung giờ phải cùng được tính là đã chấm công');
    }

    {
        // Chồng một phần (08:00–09:30 lấn vào ca 07:30–09:00) vẫn là một lần có mặt.
        const coverage = match(
            [{ start: '07:30', end: '09:00' }, { start: '08:00', end: '09:30' }],
            [{ id: 'one', checkIn: '2026-08-04T07:30:00+07:00', checkOut: '2026-08-04T09:30:00+07:00' }],
            '2026-08-04');
        assert.deepEqual(Array.from(coverage), [true, true]);
    }

    {
        // KHÔNG được nới lỏng quy tắc cũ: phiên 15:30–21:00 đã ghép ca 15:30–17:00
        // vẫn không được nhảy qua khoảng nghỉ để che hai ca tối.
        const coverage = match(
            [{ start: '15:30', end: '17:00' }, { start: '18:00', end: '19:30' }, { start: '19:30', end: '21:00' }],
            [{ id: 'long', checkIn: '2026-08-04T15:30:00+07:00', checkOut: '2026-08-04T21:00:00+07:00' }],
            '2026-08-04');
        assert.deepEqual(Array.from(coverage), [true, false, false],
            'ca sau khoảng nghỉ vẫn phải cần lần vào ca riêng');
    }

    {
        // Lớp song song rồi nối tiếp: 07:30–09:00 ×2 rồi 09:00–10:30 liền mạch.
        const coverage = match(
            [{ start: '07:30', end: '09:00' }, { start: '07:30', end: '09:00' }, { start: '09:00', end: '10:30' }],
            [{ id: 'one', checkIn: '2026-08-04T07:30:00+07:00', checkOut: '2026-08-04T10:30:00+07:00' }],
            '2026-08-04');
        assert.deepEqual(Array.from(coverage), [true, true, true],
            'lớp song song không được làm mất mốc nối sang ca liền kề');
    }
}

// ================= 2) Trang Chấm Công Bù gộp lớp cùng giờ =================
{
    const src = readInline('cham-bu.html');
    const context = { console, Date, Math, Array, Number, String, Set, JSON };
    vm.createContext(context);
    vm.runInContext('const OVERLAP_MIN=10*60*1000;\n' +
        cutFrom(src, 'function mergeConcurrentTeaching(shifts){', 'cham-bu.html') +
        cutFrom(src, 'function attendanceOverlaps(sessions,aStart,aEnd){', 'cham-bu.html') +
        cutFrom(src, 'function anyPendingOverlaps(reqs,aStart,aEnd){', 'cham-bu.html'), context);

    const gv = (start, end, label, extra) => Object.assign(
        { kind: 'gv', branch: 'cs1', start, end, label, noSubject: false, excuse: '' }, extra || {});

    {
        const out = context.mergeConcurrentTeaching([
            gv('07:30', '09:00', 'Toán 6'),
            gv('07:30', '09:00', 'Toán 7'),
            gv('09:15', '10:45', 'Kèm 1:1')
        ]);
        assert.equal(out.length, 2, 'hai lớp cùng giờ phải gộp thành một ca, ca 09:15 giữ riêng');
        assert.equal(out[0].label, 'Toán 6 + Toán 7');
        assert.deepEqual(Array.from(out[0].classNames), ['Toán 6', 'Toán 7']);
        assert.equal(out[0].start, '07:30');
        assert.equal(out[0].end, '09:00');
        assert.equal(out[1].label, 'Kèm 1:1', 'ca cách 15 phút KHÔNG được gộp');
    }

    {
        // Chồng một phần → khung giờ gộp là toàn bộ thời gian có mặt.
        const out = context.mergeConcurrentTeaching([
            gv('07:30', '09:00', 'Toán 6'),
            gv('08:00', '09:30', 'Toán 7')
        ]);
        assert.equal(out.length, 1);
        assert.equal(out[0].start + '-' + out[0].end, '07:30-09:30');
    }

    {
        // Ca tiếp tân KHÔNG gộp cứng vào ca dạy — ngày làm chéo tính theo từng đoạn.
        const out = context.mergeConcurrentTeaching([
            gv('07:30', '09:00', 'Toán 6'),
            { kind: 'tt', branch: 'cs1', start: '07:30', end: '11:30', label: 'Tiếp Tân (SÁNG)', excuse: '' }
        ]);
        assert.equal(out.length, 2, 'ca tiếp tân phải giữ riêng');
    }

    {
        // Khác cơ sở / khác tình trạng vắng thì không gộp.
        assert.equal(context.mergeConcurrentTeaching([
            gv('07:30', '09:00', 'Toán 6'),
            gv('07:30', '09:00', 'Toán 7', { branch: 'cs2' })
        ]).length, 2);
        assert.equal(context.mergeConcurrentTeaching([
            gv('07:30', '09:00', 'Toán 6'),
            gv('07:30', '09:00', 'Toán 7', { excuse: 'Vắng phép (đã báo trước)' })
        ]).length, 2);
    }

    {
        // Một lớp chưa điền tên vẫn tính được lương nhờ lớp còn lại → không chặn.
        const out = context.mergeConcurrentTeaching([
            gv('07:30', '09:00', 'Toán 6'),
            gv('07:30', '09:00', 'CHƯA CHỌN LỚP', { noSubject: true })
        ]);
        assert.equal(out.length, 1);
        assert.equal(out[0].label, 'Toán 6');
        assert.equal(out[0].noSubject, false);
        // Cả hai đều trống thì vẫn phải cảnh báo thiếu môn/lớp.
        const bare = context.mergeConcurrentTeaching([
            gv('07:30', '09:00', 'CHƯA CHỌN LỚP', { noSubject: true }),
            gv('07:30', '09:00', 'CHƯA CHỌN LỚP', { noSubject: true })
        ]);
        assert.equal(bare[0].noSubject, true);
    }

    {
        // Lưới an toàn: Bảng Công đã có phiên chồng giờ → không mở chấm bù nữa.
        const at = (hm) => new Date('2026-08-04T' + hm + ':00').getTime();
        const sessions = [{ checkIn: '2026-08-04T07:30:00', checkOut: '2026-08-04T09:00:00' }];
        assert.equal(context.attendanceOverlaps(sessions, at('07:30'), at('09:00')), true);
        assert.equal(context.attendanceOverlaps(sessions, at('09:15'), at('10:45')), false,
            'ca cách giờ không bị chặn oan');
        assert.equal(context.attendanceOverlaps(
            [{ checkIn: '2026-08-04T07:30:00', checkOut: '2026-08-04T09:00:00', isAbsent: true }],
            at('07:30'), at('09:00')), false, 'phiên VẮNG không phải là đã có công');

        const pend = [{ status: 'pending', session: { checkIn: '2026-08-04T07:30:00', checkOut: '2026-08-04T09:00:00' } }];
        assert.equal(context.anyPendingOverlaps(pend, at('07:30'), at('09:00')), true);
        assert.equal(context.anyPendingOverlaps(
            [{ status: 'rejected', session: pend[0].session }], at('07:30'), at('09:00')), false);
    }
}

// ================= 3) Trang Tường Trình: duyệt nhóm phải cho chọn tháng =================
{
    const src = readInline('tuong-trinh.html');
    const asked = [];
    let answer = null;
    const context = {
        console, Date, Math, Array, Number, String, Set, JSON,
        prompt: (msg, def) => { asked.push({ msg, def }); return answer; },
        alert: () => { }
    };
    vm.createContext(context);
    const grab = (re, what) => {
        const m = src.match(re);
        assert.ok(m, `không tìm thấy ${what}`);
        return m[0];
    };
    vm.runInContext(
        grab(/const toMin=[^\n]*\n/, 'toMin') +
        grab(/const stripTones=[\s\S]*?;\n/, 'stripTones') +
    grab(/const CF_THING=[\s\S]*?const CENTER_FAULT_RE=[^\n]*\n/, 'CENTER_FAULT_RE') +
        grab(/const nextMonthOf=\([\s\S]*?\n\};\n/, 'nextMonthOf') +
        grab(/const guessCenterFault=[^\n]*\n/, 'guessCenterFault') +
        cutFrom(src, 'function mergeSpans(rows){', 'tuong-trinh.html') +
        cutFrom(src, 'function payoutFor(r){', 'tuong-trinh.html') +
        cutFrom(src, 'function payoutSummary(list){', 'tuong-trinh.html') +
        cutFrom(src, 'function askPayoutMonth(r){', 'tuong-trinh.html') +
        cutFrom(src, 'function askPayoutMonthBulk(list){', 'tuong-trinh.html') +
        cutFrom(src, 'function overlappingPairsIn(reqs){', 'tuong-trinh.html'), context);

    const list = [
        { id: 'a', dateKey: '2026-08-04', reason: 'em quên chấm công', staffName: 'NV' },
        { id: 'b', dateKey: '2026-08-05', reason: 'trung tâm mất mạng', staffName: 'NV' }
    ];

    {
        // Hộp thoại duyệt nhóm phải NÊU RÕ 4 lựa chọn, không im lặng tự đoán như trước.
        answer = '3';
        const map = context.askPayoutMonthBulk(list);
        const msg = asked[asked.length - 1].msg;
        assert.match(msg, /1 = TẤT CẢ trả TRONG THÁNG DẠY/);
        assert.match(msg, /2 = TẤT CẢ trả THÁNG SAU/);
        assert.match(msg, /3 = Theo gợi ý tự đoán/);
        assert.match(msg, /4 = Hỏi từng ca/);
        assert.equal(map(list[0]).payoutMonth, '2026-09', 'gợi ý: quên chấm công → tháng sau');
        assert.equal(map(list[1]).payoutMonth, '2026-08', 'gợi ý: lỗi trung tâm → trong tháng');
    }

    {
        answer = '1';
        const map = context.askPayoutMonthBulk(list);
        assert.equal(map(list[0]).payoutMonth, '2026-08');
        assert.equal(map(list[1]).payoutMonth, '2026-08');
    }

    {
        answer = '2';
        const map = context.askPayoutMonthBulk(list);
        assert.equal(map(list[0]).payoutMonth, '2026-09');
        assert.equal(map(list[1]).payoutMonth, '2026-09');
    }

    {
        // Hỏi từng ca: dùng lại đúng hộp thoại của duyệt đơn lẻ.
        answer = '4';
        const map = context.askPayoutMonthBulk(list);
        answer = '1';
        assert.equal(map(list[0]).payoutMonth, '2026-08');
        answer = null; // người duyệt bấm Huỷ ở một ca → bỏ qua ca đó, không duyệt bừa
        assert.equal(map(list[1]), null);
    }

    {
        answer = null;
        assert.equal(context.askPayoutMonthBulk(list), null, 'huỷ thì không duyệt gì cả');
        answer = '9';
        assert.equal(context.askPayoutMonthBulk(list), null, 'nhập bậy thì không duyệt gì cả');
    }

    {
        // Nhận ra hai yêu cầu trong cùng nhóm chồng khung giờ nhau.
        const pair = context.overlappingPairsIn([
            { dateKey: '2026-08-04', session: { checkIn: '2026-08-04T07:30:00', checkOut: '2026-08-04T09:00:00' } },
            { dateKey: '2026-08-04', session: { checkIn: '2026-08-04T07:30:00', checkOut: '2026-08-04T09:00:00' } }
        ]);
        assert.equal(pair.length, 1, 'hai đơn cùng khung giờ phải bị bắt');
        assert.equal(context.overlappingPairsIn([
            { dateKey: '2026-08-04', session: { checkIn: '2026-08-04T07:30:00', checkOut: '2026-08-04T09:00:00' } },
            { dateKey: '2026-08-04', session: { checkIn: '2026-08-04T09:15:00', checkOut: '2026-08-04T10:45:00' } }
        ]).length, 0, 'hai ca cách giờ là bình thường');
    }

    {
        // Ca gộp "Toán 6 + Toán 7" không khớp đúng một dòng lịch nào, nhưng phải nằm
        // trọn trong khối liền mạch ghép từ lịch → vẫn được coi là khớp lịch.
        const spans = context.mergeSpans([
            { branch: 'cs1', start: '07:30', end: '09:00' },
            { branch: 'cs1', start: '08:00', end: '09:30' },
            { branch: 'cs1', start: '18:00', end: '19:30' },
            { branch: 'cs1', start: '19:30', end: '21:00' }
        ]);
        assert.deepEqual(Array.from(spans, s => s.start + '-' + s.end), ['07:30-09:30', '18:00-21:00']);
        const gapped = context.mergeSpans([
            { branch: 'cs1', start: '07:30', end: '09:00' },
            { branch: 'cs1', start: '09:15', end: '10:45' }
        ]);
        assert.equal(gapped.length, 2, 'có khoảng nghỉ thì không ghép thành một khối');
        const twoBranches = context.mergeSpans([
            { branch: 'cs1', start: '07:30', end: '09:00' },
            { branch: 'cs2', start: '07:30', end: '09:00' }
        ]);
        assert.equal(twoBranches.length, 2, 'khác cơ sở thì không ghép');
    }
}

console.log('concurrent-class.test.js: all assertions passed');
