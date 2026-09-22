'use strict';
// Danh sách lương xuất Excel: tách Giáo viên/Trợ giảng và Tiếp tân, STT theo MSNV,
// người kiêm 2 chức vụ có ở cả 2 danh sách với đúng phần lương của từng bên.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'salary-bulk-export.js'), 'utf8');
const lifecycle = pub => ({
    has_gv: !!pub.details_gv, has_tt: !!pub.details_tt,
    status_gv: pub.status_gv || pub.status || 'draft', status_tt: pub.status_tt || pub.status || 'draft'
});
const context = { window: {}, console, Blob, TextEncoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Date, Math, Number, String, Object, Set };
context.DBService = { getPayslipLifecycleState: lifecycle };
vm.createContext(context);
vm.runInContext(source, context);
const api = context.window.SalaryBulkExport;
assert.ok(api, 'SalaryBulkExport API must be exposed');

assert.equal(api.msnvOf({ username: 'dung39' }), '39');
assert.equal(api.msnvOf({ username: 'admin' }), '');

const gv = (base, bonus, advance) => ({ baseSalary: base, advance, netPay: base + bonus - advance });
const users = {
    a: { id: 'a', name: 'Lan', username: 'lan12' },
    b: { id: 'b', name: 'Minh', username: 'minh3' },
    c: { id: 'c', name: 'Hoa', username: 'hoa7' },
    d: { id: 'd', name: 'Nháp', username: 'nhap1' }
};
const settings = {
    a: { published: { details_gv: gv(5000000, 300000, 0), status_gv: 'published' } },
    b: { published: { details_gv: gv(2000000, 0, 500000), details_tt: gv(4000000, 100000, 0), status_gv: 'received', status_tt: 'published' } },
    c: { published: { role: 'tiep-tan', details_tt: gv(6000000, -200000, 1000000), status_tt: 'received' } },
    d: { published: { details_gv: gv(1000000, 0, 0), status_gv: 'draft' } }
};

const collected = api.collectPayroll(settings, users, 'all', 'sent');
assert.deepEqual(Array.from(collected.lists['giao-vien'], x => x.person.account), ['minh3', 'lan12']);
assert.deepEqual(Array.from(collected.lists['tiep-tan'], x => x.person.account), ['minh3', 'hoa7']);
assert.deepEqual(Array.from(collected.lists['giao-vien'], x => x.side.stt), [1, 2]);
assert.equal(collected.lists['tiep-tan'][1].side.money.net, 4800000);
assert.equal(collected.lists['tiep-tan'][1].side.money.other, -200000);
assert.equal(collected.lists['giao-vien'][0].side.money.net, 1500000);
assert.ok(collected.skipped.some(s => /Nháp/.test(s.name) && /CHƯA GỬI/.test(s.why)), 'draft must be reported, not silently dropped');

const onlyTT = api.collectPayroll(settings, users, 'tiep-tan', 'any');
assert.equal(onlyTT.lists['giao-vien'].length, 0);
assert.equal(onlyTT.lists['tiep-tan'].length, 2);

(async () => {
    const ctx = { year: 2026, month: 7, companyName: 'TT', stamp: '22/09/2026 10:00', statusLabel: 'Đã gửi + Đã nhận' };
    const blob = api.buildPayrollListXlsx(collected, ctx, 'all');
    const bytes = Buffer.from(await blob.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0), 0x04034b50, 'xlsx must be a zip');
    const text = bytes.toString('utf8');
    assert.match(text, /Giáo viên - Trợ giảng/);
    assert.match(text, /Tổng chi theo người/);
    assert.match(text, /Kiêm Tiếp tân/);
    assert.match(text, /SUM\(H5:H6\)/);
    if (process.env.XLSX_OUT) fs.writeFileSync(process.env.XLSX_OUT, bytes);
    console.log('payroll-list-export tests passed');
})().catch(e => { console.error(e); process.exit(1); });
