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
assert.match(teacherPage, /\.teacher-shift-body\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)/,
    'Desktop body must constrain the workspace so the Admin attendance section scrolls instead of being clipped');
assert.match(teacherPage, /\.teacher-shift-workspace\s*\{[\s\S]*?overflow:\s*hidden/,
    'Desktop workspace must hand vertical overflow to its two columns');
assert.match(teacherPage, /\.teacher-shift-header\s*\{[\s\S]*?flex:\s*0 0 auto/,
    'Teacher manager header must never shrink and clip its title/context at the viewport cap');
assert.match(teacherPage, /\.teacher-shift-footer\s*\{[\s\S]*?flex:\s*0 0 auto/,
    'Teacher manager footer must remain stable while the body absorbs constrained height');
assert.match(teacherPage, /@media \(max-width:\s*720px\)[\s\S]*?\.teacher-shift-body\s*\{[\s\S]*?overflow-y:\s*auto/,
    'Teacher manager content must scroll independently on mobile');
assert.match(teacherPage, /@media \(max-width:\s*720px\)[\s\S]*?\.teacher-shift-body\s*\{[\s\S]*?display:\s*block[\s\S]*?overflow-y:\s*auto/,
    'Mobile must return to one natural scrolling column');
assert.match(teacherPage, /@media \(max-width:\s*720px\)[\s\S]*?\.attendance-time-grid,\s*\.attendance-extra-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    'Admin attendance time and policy grids must stack without nested fixed-height panes on mobile');
assert.match(teacherPage, /@media \(max-width:\s*720px\)[\s\S]*?\.attendance-person-tab,[\s\S]*?\.attendance-state-segment button,[\s\S]*?\.attendance-extra-card button,[\s\S]*?\.btn-attendance-save\s*\{[\s\S]*?min-height:\s*44px/,
    'Admin attendance tabs, state actions, fields and save action must keep a 44px mobile touch target');
assert.match(teacherPage, /\.attendance-extra-card \.attendance-bonus-toggle\s*\{[\s\S]*?display:\s*flex[\s\S]*?align-items:\s*center/,
    'The +10 checkbox must use an explicit horizontal flex layout');
assert.match(teacherPage, /\.attendance-person-tab:disabled,[\s\S]*?\.attendance-state-segment button:disabled,[\s\S]*?cursor:\s*not-allowed/,
    'Locked attendance controls need a clear disabled state');
assert.match(teacherPage, /@media \(max-width:\s*720px\)[\s\S]*?\.attendance-bonus-actions\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    'Pending +10 decision actions must stack naturally on phones');
assert.match(teacherPage, /@media \(max-width:\s*720px\)[\s\S]*?\.attendance-bonus-actions button,[\s\S]*?\.btn-attendance-save\s*\{[\s\S]*?min-height:\s*44px/,
    'Pending +10 decisions must keep phone-safe touch targets');

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

// Phone turned sideways (~844×390): must use the slide-in menu and compact schedule editors,
// not the desktop sidebar that used to cover a third of the width and all of the height.
const LANDSCAPE = '@media (orientation: landscape) and (max-height: 540px) and (pointer: coarse)';
const landscapeBlock = (source, label) => {
    const start = source.indexOf(LANDSCAPE);
    assert.ok(start >= 0, `${label} must have the phone-landscape block`);
    return source.slice(start);
};
const styleSheet = read('css/style.css');
const mainScript = read('js/main.js');
const globalLandscape = landscapeBlock(styleSheet, 'css/style.css');
assert.match(globalLandscape, /\.mobile-header\s*\{[\s\S]*?display:\s*flex\s*!important/,
    'landscape phones must show the ☰ header');
assert.match(globalLandscape, /\.sidebar\s*\{[\s\S]*?position:\s*fixed[\s\S]*?left:\s*-300px/,
    'landscape phones must hide the sidebar off-canvas');
assert.match(globalLandscape, /\.sidebar\.open\s*\{\s*left:\s*0/, 'the ☰ button must still open the menu');
assert.ok(mainScript.includes("const DRAWER_NAV_QUERY = '(max-width: 768px), (orientation: landscape) and (max-height: 540px) and (pointer: coarse)'"),
    'main.js must close the drawer on the same devices the CSS turns it into a drawer');
assert.match(mainScript, /if \(_isDrawerNav\(\)\) _closeMobileSidebar\(\)/);
assert.match(styleSheet, /^\.stats-grid\s*\{[\s\S]*?display:\s*grid/m, 'stat cards must be styled outside the phone-only block');

const teacherLandscape = landscapeBlock(teacherPage, 'lich-lam.html');
assert.match(teacherLandscape, /\.main-content > header\s*\{\s*display:\s*contents\s*!important/,
    'inline display:flex on the header must not undo the one-row landscape toolbar');
assert.match(teacherLandscape, /#admin-actions\s*\{[\s\S]*?display:\s*flex\s*!important[\s\S]*?flex-wrap:\s*nowrap\s*!important/,
    'save / copy / absence buttons must stay on one row sideways');
assert.match(teacherLandscape, /\.day-tabs\s*\{[\s\S]*?order:\s*4/);
assert.match(teacherLandscape, /\.teacher-shift-dialog\s*\{[\s\S]*?height:\s*100dvh[\s\S]*?border-radius:\s*0/,
    'teacher manager must use the full short screen');
for (const [name, page] of [['receptionist', receptionistPage], ['office', officePage]]) {
    const block = landscapeBlock(page, name);
    assert.match(block, /\.work-schedule-page \.page-header\s*\{\s*display:\s*contents\s*!important/, `${name}: compact header row`);
    assert.match(block, /#save-area:not\(\.schedule-actions-hidden\)\s*\{\s*display:\s*flex\s*!important/, `${name}: action buttons stay in a row`);
    assert.match(block, /\.staff-checkbox-list\s*\{\s*max-height:\s*none/, `${name}: assignment dialog scrolls as one body`);
    assert.match(page, /\.shift-time-inputs\s*\{\s*flex-direction:\s*column/, `${name}: 16px time inputs must not be clipped on phones`);
}

console.log('responsive-schedule-ui.test.js: all assertions passed');
