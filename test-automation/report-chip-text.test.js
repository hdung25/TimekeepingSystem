const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const reportPath = path.join(__dirname, '..', 'js', 'report.js');
const source = fs.readFileSync(reportPath, 'utf8');
assert.doesNotMatch(source, /getElementById\('scr-class-name'\)\.innerHTML/,
    'student-count modal must render chip text as text, never executable HTML');
const evaluationSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'evaluation-service.js'), 'utf8');
const timekeepingSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'timekeeping.js'), 'utf8');
const helperMatch = source.match(/\/\/ REPORT_CHIP_TEXT_NORMALIZER_START\r?\n([\s\S]*?)\/\/ REPORT_CHIP_TEXT_NORMALIZER_END/);

assert.ok(helperMatch, 'report chip text normalizer must remain independently testable');

const sandbox = {};
vm.runInNewContext(`${helperMatch[1]}\nthis.normalizeReportChipDisplayText = normalizeReportChipDisplayText;`, sandbox);
const normalize = sandbox.normalizeReportChipDisplayText;

const renderedClock = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" data-lucide="clock" aria-hidden="true" class="lucide lucide-clock"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';
const renderedStar = "<svg width='12' data-lucide='star'><path d='sample'></path></svg>";
const fallbackClock = '<span class="icon-fallback" data-name="clock"></span>';

assert.equal(
    normalize(`S 07:00–11:30 CS1 (Tiếp Tân) ${renderedClock}+02:15 (CĐ)`),
    'S 07:00–11:30 CS1 (Tiếp Tân) ⏱+02:15 (CĐ)',
    'rendered Lucide clock markup must become a compact overtime glyph'
);
assert.equal(
    normalize(`19:30–21:00 (Tin Học) ${renderedStar}+10p`),
    '19:30–21:00 (Tin Học) ★+10p',
    'the same defect must not expose the internal +10p star markup'
);
assert.equal(
    normalize(`07:00–11:30 ${fallbackClock}+01:00`),
    '07:00–11:30 ⏱+01:00',
    'offline icon fallback markup must not leak into a chip either'
);

const legitimateNonInternalMarkup = '<svg data-lucide="calendar"><path>nội dung</path></svg> Môn SVG <b>nâng cao</b>';
assert.equal(
    normalize(legitimateNonInternalMarkup),
    legitimateNonInternalMarkup,
    'normalization must not broadly strip unrelated or legitimate chip text'
);
assert.equal(
    normalize('<svg data-lucide="clock">incomplete'),
    '<svg data-lucide="clock">incomplete',
    'malformed text must remain available to the normal HTML escaping layer'
);

assert.match(
    source,
    /escapeReportHtml\(normalizeReportChipDisplayText\(chipDisplayText\)\)/,
    'normalization must run immediately before the existing HTML escape boundary'
);

assert.doesNotMatch(
    evaluationSource,
    /label\s*\+=\s*[^;]*getIconHtml/,
    'the shared chip model must remain plain text so Today and monthly views cannot expose SVG source'
);
assert.match(evaluationSource, /label \+= ' ⏱\+'/);
assert.match(evaluationSource, /label \+= ' ★\+10p'/);
assert.match(
    timekeepingSource,
    /timekeepingEscapeHTML\(chip\.text\)/,
    'the Today view must keep escaping shared plain-text labels'
);

console.log('report-chip-text.test.js: all assertions passed');
