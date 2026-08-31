const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const teacherPage = read('lich-lam.html');
const receptionistPage = read('lich-tiep-tan.html');
const officePage = read('lich-van-phong.html');

assert.match(teacherPage, /\.teacher-shift-dialog\s*\{[\s\S]*?width:\s*min\(1120px,\s*96vw\)[\s\S]*?max-height:\s*min\(94dvh,\s*900px\)/,
    'Teacher manager must remain bounded on desktop');
assert.match(teacherPage, /@media \(max-width:\s*720px\)[\s\S]*?\.teacher-shift-dialog\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-height:\s*96dvh[\s\S]*?border-radius:\s*22px 22px 0 0/,
    'Teacher manager must become a bounded mobile bottom sheet');
assert.match(teacherPage, /@media \(max-width:\s*720px\)[\s\S]*?\.teacher-status-segment button,[\s\S]*?\.roster-tabs button\s*\{\s*min-height:\s*44px/,
    'Teacher manager mobile controls must keep a 44px touch target');
assert.doesNotMatch(teacherPage, /\n\s*header\s*\{\s*flex-direction:\s*column/,
    'Generic mobile header rules must not override the teacher-manager header');
assert.match(teacherPage, /\.main-content > header\s*\{\s*flex-direction:\s*column/,
    'Mobile page-header stacking must remain scoped to the page content');
assert.match(teacherPage, /\.teacher-shift-body\s*\{[\s\S]*?min-height:\s*0[\s\S]*?overflow:\s*hidden/,
    'Teacher manager must not force the dialog beyond the viewport');
assert.match(teacherPage, /\.teacher-shift-header\s*\{[\s\S]*?flex:\s*0 0 auto/,
    'Teacher manager header must never shrink and clip its title/context at the viewport cap');
assert.match(teacherPage, /\.teacher-shift-footer\s*\{[\s\S]*?flex:\s*0 0 auto/,
    'Teacher manager footer must remain stable while the body absorbs constrained height');
assert.match(teacherPage, /@media \(max-width:\s*720px\)[\s\S]*?\.teacher-shift-body\s*\{\s*overflow-y:\s*auto/,
    'Teacher manager content must scroll independently on mobile');

for (const [name, page] of [
    ['lich-tiep-tan.html', receptionistPage],
    ['lich-van-phong.html', officePage]
]) {
    assert.match(page, /\.cell-modal-content\s*\{[\s\S]*?width:\s*min\(680px,\s*100%\)[\s\S]*?max-height:\s*min\(88dvh,\s*820px\)/,
        `${name} must keep its desktop modal within the viewport`);
    assert.match(page, /\.cell-modal-body\s*\{[\s\S]*?min-height:\s*0[\s\S]*?overflow-y:\s*auto/,
        `${name} must scroll only the modal body`);
    assert.match(page, /@media \(max-width:\s*768px\)[\s\S]*?\.cell-modal-content\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-height:\s*94dvh[\s\S]*?border-radius:\s*22px 22px 0 0/,
        `${name} must use a mobile bottom sheet`);
    assert.match(page, /@media \(max-width:\s*768px\)[\s\S]*?\.cell-modal-close,[\s\S]*?\.cell-modal-footer \.btn-primary\s*\{[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/,
        `${name} mobile modal controls must keep a 44px touch target`);
    assert.match(page, /\.schedule-wrapper\s*\{[\s\S]*?overflow-x:\s*auto[\s\S]*?-webkit-overflow-scrolling:\s*touch/,
        `${name} wide roster table must scroll inside its own container`);
}

console.log('responsive-schedule-ui.test.js: all assertions passed');
