'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const report = fs.readFileSync(path.join(root, 'js/report.js'), 'utf8');
const taxSource = report.slice(report.indexOf('function calculatePersonalIncomeTax('), report.indexOf('function getCurrentCalculationPayload('));
const controls = { 'salary-tax-enabled': { checked: false } };
const context = { currentDate: new Date(2026, 9, 1), document: { getElementById: id => controls[id] }, Math, Number };
vm.createContext(context);
vm.runInContext(taxSource, context);
const tax = context.calculatePersonalIncomeTax;
assert.equal(tax(5300000, false).amount, 530000);
assert.equal(tax(5300000, false).deduction, 0);
assert.equal(tax(5300000, true).deduction, 530000);
assert.equal(tax(5300000, true, new Date(2026, 8, 30)).deduction, 0);
assert.equal(tax(-100, true).amount, 0);
assert.equal(tax(333333, true).amount, 33333);
context.loadPersonalIncomeTaxControl('salary-tax-enabled', { personal_income_tax_enabled: true });
assert.equal(controls['salary-tax-enabled'].checked, true);
context.loadPersonalIncomeTaxControl('salary-tax-enabled', {});
assert.equal(controls['salary-tax-enabled'].checked, false, 'switching staff/month must reset the checkbox');

// Run the production payload builder, including active DOM and saved sibling-role settings.
Object.assign(context, {
    window: { currentUserContext: { name: 'Fixture', username: 'gv1', roles: ['teacher', 'receptionist'] },
        currentMonthlySalarySettingsAll: { giao_vien: { advance: 1000000, evaluation: [{ id: 1, amount: 5300000 }], personal_income_tax_enabled: true },
            tiep_tan: { advance: 1000000, evaluation: [{ id: 1, amount: 5300000 }], personal_income_tax_enabled: false } } },
    hasReceptionistEmploymentRole: () => true, hasTeachingEmploymentRole: () => true, hasOfficeEmploymentRole: () => false,
    parseFormattedNumber: value => Number(value) || 0,
    isStudentCountPenaltyActive: () => false, isMeetingPayrollAutomatic: () => false,
    TeacherAttendancePolicy: { NEW_MODE_VERSION: 'test-new-mode' },
    normalizeEvaluationEntries: value => value || [], applyEvaluationRateRows: value => value || [], getTeacherPayrollHours: () => 0,
    EVALUATION_CRITERIA: [{ label: 'I' }, { label: 'II' }], RECEP_EVALUATION_CRITERIA: [{ index: 1, label: 'III' }]
});
context.document.querySelectorAll = selector => selector === '.eval-amount' ? [{ value: '5300000', dataset: { index: '1' } }] : [];
context.document.querySelector = () => null;
controls['salary-advance'] = { value: '1000000' };
controls['staff-select'] = { value: 'fixture', options: [{ text: 'Fixture' }], selectedIndex: 0 };
vm.runInContext(report.slice(report.indexOf('function getCurrentCalculationPayload('), report.indexOf('function showDraftSaveOutcome(')), context);
for (const role of ['giao-vien', 'tiep-tan']) {
    context.window.currentLoadedRoleKey = role === 'giao-vien' ? 'giao_vien' : 'tiep_tan';
    controls['salary-tax-enabled'].checked = false;
    const without = context.getCurrentCalculationPayload(role);
    assert.equal(without.netPay, 4300000);
    assert.equal(without.details.personalIncomeTax, 530000);
    controls['salary-tax-enabled'].checked = true;
    const withTax = context.getCurrentCalculationPayload(role);
    assert.equal(withTax.netPay, 3770000);
    assert.equal(withTax.details.personalIncomeTaxDeduction, 530000);
}
context.window.currentLoadedRoleKey = 'tiep_tan';
controls['salary-tax-enabled'].checked = false;
assert.equal(context.getCurrentCalculationPayload('giao-vien').netPay, 3770000, 'inactive role uses its saved tax setting');
context.window.currentLoadedRoleKey = 'giao_vien';
controls['salary-tax-enabled'].checked = true;
assert.equal(context.getCurrentCalculationPayload('tiep-tan').netPay, 4300000, 'tax checkbox must not leak into the sibling role');

// Exercise the actual snapshot renderer used for staff payslips and printed PDFs.
const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
context.window = { getIconHtml: () => '' };
context.formatNumberWithCommas = n => Number(n).toLocaleString('en-US');
vm.runInContext(main.slice(main.indexOf('const PAYSLIP_CARD_CSS'), main.indexOf('async function loadStaffPersonalSalary')), context);
const strip = html => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
for (const role of ['giao-vien', 'tiep-tan']) {
    const base = { role, baseSalary: 5300000, totalBaseSalary: 5300000, advance: 1000000,
        personalIncomeTaxAvailable: true, personalIncomeTax: 530000 };
    const noTax = strip(context.renderDetailedSalaryTable({ ...base, personalIncomeTaxDeduction: 0 }, 'draft'));
    assert.match(noTax, /TNCN 10% · Không khấu trừ 530,000/);
    assert.match(noTax, /THỰC LÃNH \(1\)-\(2\) 4,300,000/);
    const withTax = strip(context.renderDetailedSalaryTable({ ...base, personalIncomeTaxDeduction: 530000,
        personalIncomeTaxEnabled: true }, 'draft'));
    assert.match(withTax, /TNCN 10% \(3\) · Đã khấu trừ 530,000/);
    assert.match(withTax, /THỰC LÃNH \(1\)-\(2\)-\(3\) 3,770,000/);
}
console.log('payroll-tax.test.js: optional deduction, month boundary, advance exclusion, rounding, staff switching and both payslip roles passed');
