'use strict';
// Owner report 29/09/2026 (Tính lương → Thêm/Sửa ca): after typing "kèm" to filter and clicking
// a subject, saving said "Không tìm thấy môn khớp chính xác “kèm”". Leftover filter text must be
// ignored once a subject is selected; an exact typed name is still committed when none is.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const report = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8').replace(/\r\n/g, '\n');
const start = report.indexOf('function commitExactTypedSubjectSelection()');
const end = report.indexOf('\nasync function submitBonus10Request', start);
assert.ok(start > 0 && end > start);

function run(selected, typed) {
    const input = { value: typed };
    const context = {
        editSelectedSubjectIds: selected.slice(),
        allAvailableSubjects: [
            { id: 'k1', name: 'Kèm 1:1 ( báo bài)', path: 'Kèm › Kèm 1:1 ( báo bài)' },
            { id: 'k2', name: 'Kèm nhóm', path: 'Kèm › Kèm nhóm' },
            { id: 'e7', name: 'E7', path: 'E7' }
        ],
        normalizeSubjectLookupName: value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' '),
        renderSelectedSubjectBadges() {},
        document: { getElementById: id => (id === 'subject-search-input' ? input : null) },
        window: { filterSubjectDropdown(query) { context.filtered = query; } }
    };
    vm.createContext(context);
    vm.runInContext(report.slice(start, end) + '\nthis.result = commitExactTypedSubjectSelection();', context);
    return { result: context.result, selected: context.editSelectedSubjectIds, input, filtered: context.filtered };
}

{
    const out = run(['k1'], 'kèm');
    assert.equal(out.result.ok, true, 'a picked subject + leftover filter text saves normally');
    assert.deepEqual([...out.selected], ['k1'], 'the picked subject is kept');
    assert.equal(out.input.value, '', 'filter text is cleared');
    assert.equal(out.filtered, '', 'dropdown filter is reset');
}
{
    const out = run(['k1', 'e7'], 'E7');
    assert.equal(out.result.ok, true);
    assert.deepEqual([...out.selected], ['k1', 'e7'], 'multi-selection is never replaced by the search text');
}
{
    const out = run([], 'E7');
    assert.equal(out.result.ok, true, 'an exact typed subject is still committed when nothing was picked');
    assert.deepEqual([...out.selected], ['e7']);
}
{
    const out = run([], 'kèm');
    assert.equal(out.result.ok, false, 'nothing picked and a partial word still asks to choose from the list');
    assert.match(out.result.message, /Không tìm thấy môn khớp chính xác/);
}
console.log('subject-search-commit.test.js: all assertions passed');
