const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8');

function extractMarkedBlock(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker);
    assert.notEqual(start, -1, `missing marker ${startMarker}`);
    assert.notEqual(end, -1, `missing marker ${endMarker}`);
    return source.slice(start + startMarker.length, end);
}

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName || '').toUpperCase();
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.attributes = {};
        this.listeners = {};
        this.className = '';
        this._textContent = '';
        this.innerHTMLWrites = 0;
    }

    set textContent(value) { this._textContent = String(value ?? ''); }
    get textContent() {
        return this._textContent + this.children.map(child => child.textContent || '').join('');
    }
    set innerHTML(value) {
        this.innerHTMLWrites += 1;
        this._innerHTML = String(value ?? '');
    }
    get innerHTML() { return this._innerHTML || ''; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; this._textContent = ''; }
    addEventListener(type, listener) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(listener);
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
}

assert.match(source, /let _reportRenderEpoch = 0;/);
assert.match(source, /const renderEpoch = \+\+_reportRenderEpoch;/);
assert.match(source, /window\.currentSubjectBreakdown = \[\];/);
assert.match(source, /window\.currentSubjectBreakdownScope = reportScope;/);
assert.match(source, /selectStaffFromDropdown\(targetUser\);/);
assert.match(source, /window\.currentSubjectBreakdownScope === window\.currentReportScope/);
assert.match(source, /if \(!isCurrentRender\(\)\) return;/);

// The guard itself is executable and must reject both a superseded epoch and a
// staff switch without invoking the stale callback.
const guardBlock = extractMarkedBlock(
    '// REPORT_RENDER_COMMIT_GUARD_START',
    '// REPORT_RENDER_COMMIT_GUARD_END'
);
const guardSandbox = {};
vm.runInNewContext(`${guardBlock}\nthis.createGuard = createReportRenderCommitGuard;`, guardSandbox);
let activeEpoch = 4;
let activeStaff = 'staff-a';
let committedOwner = null;
const guard = guardSandbox.createGuard(4, 'staff-a', () => activeEpoch, () => activeStaff);
assert.equal(guard.commit(() => { committedOwner = 'staff-a'; }), true);
assert.equal(committedOwner, 'staff-a');
activeEpoch = 5;
assert.equal(guard.commit(() => { committedOwner = 'stale-epoch'; }), false);
assert.equal(committedOwner, 'staff-a');
const staffGuard = guardSandbox.createGuard(5, 'staff-a', () => activeEpoch, () => activeStaff);
activeStaff = 'staff-b';
assert.equal(staffGuard.commit(() => { committedOwner = 'stale-staff'; }), false);
assert.equal(committedOwner, 'staff-a');

// Regression: each long-running data source is guarded immediately after its
// await, and shared values are staged locally before a guarded commit.
assert.match(source, /let currentUserContext = null;[\s\S]*?await DBService\.refs\.users\(\)\.doc\(staffId\)\.get\(\);\s*if \(!isCurrentRender\(\)\) return;/);
assert.match(source, /let staffNotesForRender =[\s\S]*?await DBService\.getDailyNotes\(staffId\)[\s\S]*?if \(!isCurrentRender\(\)\) return;/);
assert.match(source, /let savedFixedShiftsMonth = \[\];[\s\S]*?await DBService\.getFixedShifts\(monthStr, staffId\)[\s\S]*?if \(!isCurrentRender\(\)\) return;/);
assert.match(source, /const attendanceRecords = await DBService\.getMonthlyAttendance\([^;]+;\s*if \(!isCurrentRender\(\)\) return;/);
assert.match(source, /const scheduleResults = await Promise\.all\(schedulePromises\);\s*if \(!isCurrentRender\(\)\) return;/);
assert.match(source, /const recepResults = await Promise\.all\(recepPromises\);\s*if \(!isCurrentRender\(\)\) return;/);
assert.match(source, /if \(!commitCurrentRender\(\(\) => \{\s*_cachedStaffNotes = staffNotesForRender \|\| \{\};/);

// Stored values must be inserted as text nodes, never reparsed as markup or
// executable inline handlers. Exercise hostile Firestore payloads against the
// exact renderer helpers used by report.js.
const colorBlock = extractMarkedBlock(
    '// REPORT_COLOR_SANITIZER_START',
    '// REPORT_COLOR_SANITIZER_END'
);
const staffBlock = extractMarkedBlock(
    '// REPORT_STAFF_DROPDOWN_RENDER_START',
    '// REPORT_STAFF_DROPDOWN_RENDER_END'
);
const staffList = new FakeElement('div');
let selectedStaffId = null;
const staffSandbox = {
    document: {
        getElementById(id) { return id === 'staff-dropdown-list' ? staffList : null; },
        createElement(tagName) { return new FakeElement(tagName); }
    },
    selectStaffFromDropdownById(id) { selectedStaffId = id; }
};
vm.runInNewContext(
    `${colorBlock}\n${staffBlock}\nthis.renderStaff = renderStaffDropdownItems;`,
    staffSandbox
);
const hostileMarkup = '<img src=x onerror="globalThis.pwned=1">';
const hostileId = "staff');globalThis.pwned=2;//";
staffSandbox.renderStaff([{
    id: hostileId,
    name: hostileMarkup,
    username: 'evil-user',
    role: 'staff',
    scheduleColor: 'red;background:url(javascript:alert(1))'
}]);
assert.equal(staffList.innerHTMLWrites, 0);
assert.equal(staffList.children.length, 1);
assert.equal(staffList.children[0].children[1].children[0].textContent, hostileMarkup);
assert.equal(staffList.children[0].children[0].style.background, '#E5E7EB');
staffList.children[0].listeners.click[0]();
assert.equal(selectedStaffId, hostileId);
assert.equal(staffSandbox.pwned, undefined);

const subjectBlock = extractMarkedBlock(
    '// REPORT_SUBJECT_OPTION_RENDER_START',
    '// REPORT_SUBJECT_OPTION_RENDER_END'
);
let selectedSubject = null;
const subjectSandbox = {
    document: { createElement(tagName) { return new FakeElement(tagName); } },
    window: {
        toggleSubjectSelection(id, name, rate) { selectedSubject = { id, name, rate }; }
    }
};
vm.runInNewContext(`${subjectBlock}\nthis.createSubject = createSubjectDropdownItem;`, subjectSandbox);
const subjectItem = subjectSandbox.createSubject({
    id: hostileId,
    name: hostileMarkup,
    path: hostileMarkup,
    rate: 125000
}, true);
assert.equal(subjectItem.innerHTMLWrites, 0);
assert.equal(subjectItem.children[1].textContent, hostileMarkup);
assert.equal(subjectItem.children[0].dataset.subjectId, hostileId);
subjectItem.listeners.click[0]();
assert.deepEqual(selectedSubject, { id: hostileId, name: hostileMarkup, rate: 125000 });
assert.equal(subjectSandbox.pwned, undefined);

assert.doesNotMatch(staffBlock, /innerHTML\s*=|onclick\s*=/);
assert.doesNotMatch(subjectBlock, /innerHTML\s*=|onclick\s*=/);
assert.doesNotMatch(source, /badge\.innerHTML\s*=/);

console.log('report-state-isolation.test.js: all assertions passed');
