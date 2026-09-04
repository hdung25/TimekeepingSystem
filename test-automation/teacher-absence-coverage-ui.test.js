const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const schedule = read('js/schedule.js');
const html = read('lich-lam.html');
const worker = read('service-worker.js');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} must exist`);
    const opening = source.indexOf('{', start);
    let depth = 0;
    for (let index = opening; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`${name} is not a complete function`);
}

const coverageHelpers = new Function(`${
    extractFunction(schedule, 'clearTeacherReplacementMappings')
}\n${extractFunction(schedule, 'assignTeacherReplacement')}\nreturn {
    clearTeacherReplacementMappings,
    assignTeacherReplacement
};`)();

const state = {
    mainIds: ['main-a', 'main-b'],
    statuses: {
        'main-a': { type: 'VDX' },
        'main-b': { type: 'VP' }
    },
    teacherById: new Map([
        ['main-a', { id: 'main-a', name: 'GV A' }],
        ['main-b', { id: 'main-b', name: 'GV B' }],
        ['sub-both', { id: 'sub-both', name: 'GV thay cả hai' }],
        ['sub-new', { id: 'sub-new', name: 'GV thay mới' }]
    ]),
    substituteIds: ['sub-both', 'sub-only-a'],
    substituteById: new Map([
        ['sub-both', {
            id: 'sub-both',
            name: 'GV thay cả hai',
            replacesTeacherIds: ['main-a', 'main-b']
        }],
        ['sub-only-a', {
            id: 'sub-only-a',
            name: 'GV thay A',
            replacesTeacherIds: ['main-a']
        }]
    ]),
    replacementTargetId: 'main-a'
};

assert.equal(coverageHelpers.clearTeacherReplacementMappings(state, 'main-a'), true);
assert.deepEqual(state.substituteIds, ['sub-both'],
    'gỡ người thay của GV A phải giữ GV vẫn đang thay cho GV B');
assert.deepEqual(state.substituteById.get('sub-both').replacesTeacherIds, ['main-b']);
assert.equal(state.substituteById.has('sub-only-a'), false,
    'người chỉ thay cho GV A phải được gỡ khỏi ca khi đánh dấu chưa có người thay');
assert.equal(state.replacementTargetId, '');

assert.equal(coverageHelpers.assignTeacherReplacement(state, 'sub-new', 'main-a'), true);
assert.deepEqual(state.substituteIds, ['sub-both', 'sub-new']);
assert.deepEqual(state.substituteById.get('sub-new').replacesTeacherIds, ['main-a']);
assert.equal(coverageHelpers.assignTeacherReplacement(state, 'main-a', 'main-a'), false,
    'không được tự gán GV đang nghỉ làm người dạy thay');
assert.equal(coverageHelpers.assignTeacherReplacement(state, 'sub-new', 'main-missing'), false,
    'không được tạo mapping cho một GV chính không thuộc ca');

assert.match(schedule, /data-action="mark-pending"[\s\S]*Chưa có GV thay/,
    'mỗi GV nghỉ phải có thao tác đánh dấu chưa có người thay');
assert.match(schedule, /data-action="pick-replacement"[\s\S]*(?:Chọn GV thay|Đổi \/ thêm GV thay)/,
    'mỗi GV nghỉ phải có thao tác chọn người thay rõ ràng');
assert.match(schedule, /data-action="assign-replacement"/,
    'bảng chọn phải gắn người thay vào đúng GV đang nghỉ');
assert.match(schedule, /hasTeachingEmploymentRole\(roles\)/,
    'danh sách điều phối chỉ được nạp nhân sự thuộc nhóm vai trò giảng dạy');

const saveStart = schedule.indexOf('window.saveTeacherShiftCommand = async function');
const saveEnd = schedule.indexOf('\n};\n\n// Compatibility aliases', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'saveTeacherShiftCommand must remain isolated');
const saveCommand = schedule.slice(saveStart, saveEnd);
assert.match(saveCommand, /DBService\.updateScheduleRowAtomic\(/,
    'lưu điều phối phải dùng transaction của đúng dòng lịch');
assert.match(saveCommand, /attendanceAbsenceGuard/,
    'không được đánh dấu nghỉ nếu đã có dữ liệu công');
assert.match(saveCommand, /TeacherShiftState\.applyStaffingCommand/,
    'ghi trạng thái nghỉ/thay phải qua canonical state helper để lưu lịch sử');

assert.match(html, /\.coverage-decision-actions\s*\{/,
    'nút quyết định tình trạng người thay phải có style riêng');
assert.match(html, /\.replacement-target-panel\s*\{/,
    'bảng chọn GV thay phải hiển thị như một bước riêng');
assert.match(html, /\.replacement-candidate,\s*\n\s*\.replacement-map-options button/,
    'các nút chọn GV thay phải đạt kích thước chạm tối thiểu trên điện thoại');
assert.match(worker, /schedule\.js\?v=20260904-transfer-source-coverage-v1/);
assert.match(worker, /teacher-shift-state\.js\?v=20260904-transfer-source-coverage-v1/);
assert.match(worker, /ui-service\.js\?v=20260904-transfer-source-coverage-v1/,
    'PWA mới phải cache UI service cùng version với trang lịch để dùng được khi offline');

console.log('teacher absence coverage UI regression tests passed');
