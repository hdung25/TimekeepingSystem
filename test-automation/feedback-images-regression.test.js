// Hồi quy bốn ảnh phản hồi: Admin phải nạp policy trước khi duyệt +10, yêu cầu
// legacy nhiều ca phải cho chọn đích, và trang Môn Học không thể bật nhầm Toán/TV.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
    .replace(/\r\n/g, '\n');

const admin = read('admin.html');
const db = read('js/db-service.js');
const main = read('js/main.js');
const subjects = read('js/mon-hoc.js');
const migration = read('scripts/repair-feedback-images-20260908.js');

const earlyIndex = admin.indexOf('js/early10.js?v=20260908-feedback-repair-v1');
const dbIndex = admin.indexOf('js/db-service.js?v=20260909-senior-consultation-v1');
assert.ok(earlyIndex >= 0 && dbIndex > earlyIndex,
    'Admin phải nạp early10.js trước db-service.js để nút Duyệt hoạt động');

const approveStart = db.indexOf('approveBonus10Request: async');
const approveEnd = db.indexOf('// Reject/cancel exactly one request', approveStart);
const approve = db.slice(approveStart, approveEnd);
assert.match(approve, /selectedTargetShiftKey = ''/);
assert.match(approve, /normalizedSelectedTarget && targetShiftKey !== normalizedSelectedTarget/);
assert.match(approve, /error\.candidates = Array\.from\(candidates\.values\(\)\)/,
    'yêu cầu cũ nhiều ca phải trả danh sách cho Admin chọn');
assert.match(main, /function chooseBonus10ApprovalCandidate\(candidates\)/);
assert.match(main, /approveBonus10Request\([\s\S]*selectedTarget/,
    'ca Admin chọn phải được gửi lại vào giao dịch duyệt');

assert.match(subjects, /function incompatiblePlacement\(subject, group\)/);
assert.match(subjects, /Toán\/Tiếng Việt không áp dụng chính sách sớm 10 phút/);
assert.match(subjects, /requestedEarly10Value\(s, !!next\)/,
    'thao tác hàng loạt cũng phải đi qua chốt Toán/TV');
assert.match(subjects, /subjectFamily: family/,
    'chuyển nhóm phải lưu phân loại tường minh');
assert.match(migration, /const backupName = `\$\{DOCUMENT_ROOT\}\/migration_backups\/\$\{REPAIR_ID\}`/,
    'Firestore commit phải dùng resource name cho tài liệu backup, không dùng REST URL');
assert.doesNotMatch(migration, /const backupName = `\$\{ROOT\}\/migration_backups/,
    'backup dùng URL đầy đủ sẽ làm toàn bộ migration nguyên tử bị Firestore từ chối');

console.log('feedback-images-regression.test.js: all assertions passed');
