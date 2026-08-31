// GHI CHÚ NGÀY KHÔNG ĐƯỢC LỘN SANG NGƯỜI KHÁC.
// Mỗi lần lưu chỉ được cập nhật đúng một ngày. Không dùng read-modify-write cả tài liệu,
// vì hai tab hoặc một lần đọc lỗi có thể làm mất các ngày ghi chú còn lại.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8')
    .replace(/\r\n/g, '\n');

const fnStart = source.indexOf('async function saveCalendarNote() {');
assert.notEqual(fnStart, -1, 'không tìm thấy saveCalendarNote trong js/report.js');
const fnEnd = source.indexOf('\n}\n', fnStart);
assert.notEqual(fnEnd, -1, 'không đọc được hết thân hàm saveCalendarNote');
const fnSrc = source.slice(fnStart, fnEnd + 3);
assert.doesNotMatch(fnSrc, /getDailyNotes|saveDailyNotes/);
assert.match(fnSrc, /updateDailyNote\(staffId, noteDateKey, note\)/);

const dbSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'db-service.js'), 'utf8')
    .replace(/\r\n/g, '\n');
const updateStart = dbSource.indexOf('async updateDailyNote(');
const updateEnd = dbSource.indexOf('// ================= SALARY SETTINGS', updateStart);
const updateSource = dbSource.slice(updateStart, updateEnd);
assert.match(updateSource, /db\.runTransaction/);
assert.match(updateSource, /\{ \[dateKey\]: normalizedNote \}/,
    'the transaction must merge only the selected date field');
assert.match(updateSource, /FieldValue\.delete\(\)/,
    'clearing a note must delete only the selected date field');

function makeContext(store, opts) {
    const options = opts || {};
    const writes = [];
    const context = {
        console,
        alert: function (msg) { context.__alerts.push(msg); },
        __alerts: [],
        __writes: writes,
        currentNoteDateKey: options.dateKey,
        // Bộ nhớ đang giữ ghi chú của NGƯỜI KHÁC — đúng tình huống vừa đổi người.
        _cachedStaffNotes: options.cachedNotes || {},
        _cachedNotesOwnerId: options.cachedOwner || null,
        _cachedStaffId: options.cachedOwner || null,
        currentDate: new Date(2026, 6, 1),
        getTargetStaffId: function () { return options.targetStaffId; },
        closeNoteModal: function () {},
        renderMonthReport: function () {},
        document: {
            getElementById: function (id) {
                if (id === 'note-content') return { value: options.typedNote };
                return { value: '', innerText: '', style: {} };
            }
        },
        DBService: {
            updateDailyNote: async function (staffId, dateKey, note) {
                if (options.writeFails) throw new Error('mất mạng');
                const normalized = String(note || '').trim();
                writes.push({ staffId, dateKey, note: normalized });
                store[staffId] = store[staffId] || {};
                if (normalized) store[staffId][dateKey] = normalized;
                else delete store[staffId][dateKey];
                return normalized;
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(fnSrc + '\nglobalThis.__run = saveCalendarNote;', context);
    return context;
}

const DIEM = 'nv_diem', NGUYET = 'nv_nguyet';

{
    // Admin vừa xem Diễm (ghi chú còn trong bộ nhớ) rồi đổi sang Nguyệt và ghi chú 04/08.
    const store = {
        [DIEM]: { '2026-07-27': 'Trưa xin về cho ck đi khám' },
        [NGUYET]: { '2026-07-15': 'Nghỉ phép năm' }
    };
    const ctx = makeContext(store, {
        dateKey: '2026-08-04',
        typedNote: 'Không đi xuất',
        cachedNotes: store[DIEM],
        cachedOwner: DIEM,
        targetStaffId: NGUYET
    });
    return ctx.__run().then(function () {
        assert.equal(ctx.__writes.length, 1, 'phải ghi đúng một lần');
        const w = ctx.__writes[0];
        assert.equal(w.staffId, NGUYET, 'ghi vào đúng người đang chọn');
        assert.deepEqual(w, {
            staffId: NGUYET,
            dateKey: '2026-08-04',
            note: 'Không đi xuất'
        }, 'chỉ ghi đúng trường ngày vừa nhập');
        assert.deepEqual(store[NGUYET], {
            '2026-07-15': 'Nghỉ phép năm',
            '2026-08-04': 'Không đi xuất'
        }, 'giữ nguyên ghi chú cũ của Nguyệt và chỉ thêm ngày vừa nhập');
        assert.deepEqual(store[DIEM], { '2026-07-27': 'Trưa xin về cho ck đi khám' },
            'ghi chú của Diễm không bị đụng tới');
        return runRest();
    });
}

async function runRest() {
    {
        // Ghi Firestore lỗi → không cập nhật cache và phải báo cho người dùng.
        const store = { [NGUYET]: { '2026-07-15': 'Nghỉ phép năm' } };
        const ctx = makeContext(store, {
            dateKey: '2026-08-04', typedNote: 'Không đi xuất',
            cachedNotes: {}, cachedOwner: null, targetStaffId: NGUYET, writeFails: true
        });
        await ctx.__run();
        assert.equal(ctx.__writes.length, 0, 'lỗi mạng thì không được ghi đè');
        assert.deepEqual(store[NGUYET], { '2026-07-15': 'Nghỉ phép năm' }, 'ghi chú cũ còn nguyên');
        assert.ok(ctx.__alerts.length > 0, 'phải báo cho người dùng biết là chưa lưu');
    }

    {
        // Xoá nội dung ghi chú của một ngày thì chỉ ngày đó biến mất.
        const store = { [NGUYET]: { '2026-07-15': 'Nghỉ phép năm', '2026-08-04': 'cũ' } };
        const ctx = makeContext(store, {
            dateKey: '2026-08-04', typedNote: '   ',
            cachedNotes: {}, cachedOwner: null, targetStaffId: NGUYET
        });
        await ctx.__run();
        assert.deepEqual(store[NGUYET], { '2026-07-15': 'Nghỉ phép năm' });
    }

    {
        // Không xác định được nhân viên → không ghi.
        const store = {};
        const ctx = makeContext(store, {
            dateKey: '2026-08-04', typedNote: 'abc',
            cachedNotes: {}, cachedOwner: null, targetStaffId: ''
        });
        await ctx.__run();
        assert.equal(ctx.__writes.length, 0);
    }

    console.log('daily-notes.test.js: all assertions passed');
}
