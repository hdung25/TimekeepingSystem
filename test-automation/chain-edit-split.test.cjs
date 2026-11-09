'use strict';
// Owner 09/11: bé Vy dạy E2 (17:30–19:00) rồi E8 (19:00–20:30) bằng một lần chấm công.
// Bình thường giờ ca 1 vào E2, ca 2 vào E8. Admin chỉnh tay giờ vào/ra cũng phải giữ cách
// chia đó, không gộp thành lớp ghép "E2 + E8" (lương 2 môn khác nhau sẽ bị sai).
// Local fixture only: no Firebase, no production data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const dateKey = '2026-11-05';
const staffId = 'vy';
const user = { id: staffId, roles: ['teaching_assistant'], salary_config: { roles: [{ id: 'e2', name: 'E2', rate: 40000 }, { id: 'e8', name: 'E8', rate: 50000 }] } };
const row = (lop, lopId, start, end, idx) => ({ start, end, lop, lopId, gvId: staffId, registeredTeachers: [], _branch: 'cs1', _compositeKey: `cs1__${dateKey}`, _originalIndex: idx });
const schedule = { evening1: [row('E2', 'e2', '17:30', '19:00', 0)], evening2: [row('E8', 'e8', '19:00', '20:30', 0)] };
const at = t => new Date(`${dateKey}T${t}`).toISOString();
const session = { id: 's1', status: 'closed', source: 'self', start: at('17:30:00'), checkIn: at('17:30:00'), checkOut: at('20:30:00'), role: null };

// 1) legacyClassChain (report.js) reads the class chain from the schedule, ignoring a saved override.
const evalContext = {
    console, Date, Math, Set, Map, Intl, globalThis: null,
    window: { centerClosures: {}, getIconHtml: () => '' },
    getLocalDateKey: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    isScheduledMainTeacher: (cls, id) => cls.gvId === id, isScheduledSubstitute: () => false, hasScheduledSubstitute: () => false
};
evalContext.globalThis = evalContext;
vm.createContext(evalContext);
vm.runInContext(read('js/admin-payroll-override.js'), evalContext);
evalContext.window.AdminPayrollOverride = evalContext.AdminPayrollOverride;
vm.runInContext(read('js/evaluation-service.js'), evalContext);
const report = read('js/report.js').replace(/\r\n/g, '\n');
const fnStart = report.indexOf('function legacyClassChain(');
const fnSource = report.slice(fnStart, report.indexOf('\n}\n', fnStart) + 3);
const fn2Start = report.indexOf('function scheduleClassChain(');
const fn2Source = report.slice(fn2Start, report.indexOf('\n}\n', fn2Start) + 3);
evalContext.calculateDailyChips = evalContext.window.calculateDailyChips;
evalContext.currentUserContext = user;
evalContext.window.currentLegacyChipInputs = { staffId, scheduleMap: { [dateKey]: schedule }, receptionistShiftsMap: {}, cancelledShifts: [], monthFlags: {} };
vm.runInContext(fnSource + fn2Source + '\nthis.legacyClassChain = legacyClassChain;', evalContext);
evalContext.isScheduledMainTeacher = (cls, id) => cls.gvId === id;
evalContext.isScheduledSubstitute = () => false;
const withOldOverride = { ...session, adminPayrollOverride: { version: 1, mode: 'actual', revision: 1,
    allocations: [{ id: 'actual', kind: 'teaching', fromISO: at('17:35:00'), toISO: at('20:30:00'), subjectIds: ['e2', 'e8'], role: 'e2+e8', roleName: 'E2 + E8', rateMode: 'policy', roleRate: 45000 }] } };
const chain = JSON.parse(JSON.stringify(evalContext.legacyClassChain(dateKey, withOldOverride, staffId)));
assert.deepEqual(chain.map(seg => [seg.lop, seg.start, seg.end, seg.lopId]), [['E2', '17:30', '19:00', 'e2'], ['E8', '19:00', '20:30', 'e8']],
    'chain comes from the schedule even when an old combined override is saved');
assert.equal(evalContext.legacyClassChain(dateKey, session, 'someone-else').length, 0, 'only for the staff whose month is on screen');
{
    const vyRow = (lop, lopId, start, end) => ({ ...row(lop, lopId, start, end, 0), _branch: 'cs2', _compositeKey: `cs2__${dateKey}` });
    const vySchedule = { evening1: [vyRow('FFS1', 'ffs1', '18:00', '19:30'), vyRow('E3', 'e3', '18:00', '19:30'), { ...vyRow('E8', 'e8', '18:00', '19:30'), gvId: 'other' }],
        evening2: [vyRow('E8', 'e8', '19:30', '21:00'), { ...vyRow('Toán 5', 't5', '19:30', '21:00'), isClosed: true }] };
    evalContext.window.currentLegacyChipInputs = { staffId, scheduleMap: { [dateKey]: vySchedule }, receptionistShiftsMap: {}, cancelledShifts: [], monthFlags: {} };
    const edited = { ...session, start: at('16:00:00'), checkIn: at('16:00:00'), checkOut: at('21:00:00'), isAdminEdited: true,
        role: 'e3+ffs1+e8', roleName: 'E3 + FFS1 + E8', subjectOverride: true, roleAssignmentSource: 'manual' };
    const vyChain = JSON.parse(JSON.stringify(evalContext.legacyClassChain(dateKey, edited, staffId)));
    assert.deepEqual(vyChain.map(seg => [seg.lop.split('+').sort().join('+'), seg.lopId.split('+').sort().join('+'), seg.start, seg.end]), [['E3+FFS1', 'e3+ffs1', '18:00', '19:30'], ['E8', 'e8', '19:30', '21:00']],
        'an Admin-edited span that starts before the schedule still finds the classes; same-time classes stay one lớp ghép part');
    global.__vyChain = vyChain;
    evalContext.window.currentLegacyChipInputs = { staffId, scheduleMap: { [dateKey]: schedule }, receptionistShiftsMap: {}, cancelledShifts: [], monthFlags: {} };
}

// 2) The editor turns the Admin's Vào/Ra into one allocation per class.
(async () => {
    const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<div><div id="role-search-wrapper"></div></div>');
        await page.addScriptTag({ content: read('js/admin-payroll-override.js') });
        await page.addScriptTag({ content: read('js/admin-payroll-override-ui.js') });
        const draftFor = (subjects, inT, outT, extra = {}) => page.evaluate(({ dateKey, session, user, chain, subjects, inT, outT, extra }) => {
            window.AdminPayrollOverrideUI.open({ isPrimaryAdmin: true, staffId: 'vy', dateKey, sessionId: 's1', session: { ...session, ...(extra.session || {}) },
                classChain: chain, chip: { isTeaching: true, sessionId: 's1', classStart: '17:30', classEnd: '19:00', classCompositeKey: `cs1__${dateKey}`, classSectionKey: 'evening1', classIndex: 0, branch: 'cs1' },
                user, subjects: [] });
            if (extra.mode) document.getElementById('apo-mode').value = extra.mode;
            document.getElementById('apo-reason').value = 'Sửa giờ vào';
            const preview = document.getElementById('apo-preview')?.textContent || '';
            const draft = window.AdminPayrollOverrideUI.buildDraft({ selectedRoleId: 'giao-vien', isTeaching: true, selectedRoleRate: 45000,
                selectedSubjects: subjects.map(id => ({ id, name: id.toUpperCase(), rate: 0 })),
                checkInISO: new Date(`${dateKey}T${inT}`).toISOString(), checkOutISO: new Date(`${dateKey}T${outT}`).toISOString() });
            const chips = window.AdminPayrollOverride.buildOverrideChips([{ ...session, checkIn: new Date(`${dateKey}T${inT}`).toISOString(),
                checkOut: new Date(`${dateKey}T${outT}`).toISOString(), adminPayrollOverride: draft.override }]);
            return { draft, preview, chips: chips.chips.map(c => ({ name: c.chipFilterName, minutes: c.paidMinutes, merged: c.mergedSegments })),
                invalid: (chips.invalidOverrides || []).flatMap(item => item.errors || []).map(e => e.message) };
        }, { dateKey, session, user, chain, subjects, inT, outT, extra });

        // Vào trễ 5 phút (17:35), ra đúng 20:30 — Admin để nguyên 2 lớp của lịch.
        const late = await draftFor(['e2', 'e8'], '17:35', '20:30');
        assert.match(late.preview, /Ca liền nhiều lớp/);
        assert.equal(late.draft.override.mode, 'manual', 'saved as one row per class');
        assert.deepEqual(late.draft.override.allocations.map(a => [a.roleName, a.subjectIds.join('+'), new Date(a.fromISO).toTimeString().slice(0, 5), new Date(a.toISO).toTimeString().slice(0, 5)]),
            [['E2', 'e2', '17:35', '19:00'], ['E8', 'e8', '19:00', '20:30']]);
        assert.deepEqual(late.invalid, []);
        const paid = late.chips.flatMap(c => c.merged ? c.merged.map(s => [s.lop, s.schedMinutes]) : [[c.name, c.minutes]]);
        assert.deepEqual(paid, [['E2', 85], ['E8', 90]], 'E2 gets its 85 minutes, E8 its 90 — no "E2 + E8" class');
        assert.ok(!late.chips.some(c => /\+/.test(c.name || '')), JSON.stringify(late.chips));

        // Ra sớm giữa ca 2 (20:00): E8 chỉ nhận phần đã dạy.
        const early = await draftFor(['e2', 'e8'], '17:30', '20:00');
        assert.deepEqual(early.draft.override.allocations.map(a => [a.roleName, new Date(a.toISO).toTimeString().slice(0, 5)]), [['E2', '19:00'], ['E8', '20:00']]);

        // Vào lúc ca 2 đã bắt đầu (19:10): chỉ còn E8.
        const onlySecond = await draftFor(['e2', 'e8'], '19:10', '20:30');
        assert.deepEqual(onlySecond.draft.override.allocations.map(a => [a.roleName, a.subjectIds.join('+')]), [['E8', 'e8']],
            'only E8 was taught → saved as E8, not "E2 + E8"');

        // Uyên Vy: 16:00–21:00 with FFS1+E3 then E8 → early hours go to the first class.
        const vy = await page.evaluate(({ dateKey, session, chain }) => {
            const vyUser = { id: 'vy', roles: ['teaching_assistant'], salary_config: { roles: [{ id: 'ffs1', name: 'FFS1', rate: 26000 }, { id: 'e3', name: 'E3', rate: 26000 }, { id: 'e8', name: 'E8', rate: 28000 }] } };
            document.getElementById('edit-check-in')?.remove(); document.getElementById('edit-check-out')?.remove();
            document.body.insertAdjacentHTML('beforeend', '<input id="edit-check-in" value="16:00"><input id="edit-check-out" value="21:00">');
            window.AdminPayrollOverrideUI.open({ isPrimaryAdmin: true, staffId: 'vy', dateKey, sessionId: 's1', session, classChain: chain, chip: { isTeaching: true, sessionId: 's1' }, user: vyUser, subjects: [] });
            document.getElementById('apo-mode').value = 'actual';
            window.AdminPayrollOverrideUI.refreshPreview();
            const preview = document.getElementById('apo-preview').textContent;
            const input = document.getElementById('edit-check-out'); input.value = dateKey + 'T20:00'; input.dispatchEvent(new Event('input'));
            const previewAfter = document.getElementById('apo-preview').textContent;
            document.getElementById('apo-reason').value = 'Chia lại theo lớp';
            const draft = window.AdminPayrollOverrideUI.buildDraft({ selectedRoleId: 'giao-vien', isTeaching: true,
                selectedSubjects: [{ id: 'e3', name: 'E3' }, { id: 'ffs1', name: 'FFS1' }, { id: 'e8', name: 'E8' }],
                checkInISO: new Date(`${dateKey}T16:00`).toISOString(), checkOutISO: new Date(`${dateKey}T21:00`).toISOString() });
            return { preview, previewAfter, rows: draft.override.allocations.map(a => [a.roleName, a.subjectIds.join('+'), new Date(a.fromISO).toTimeString().slice(0, 5), new Date(a.toISO).toTimeString().slice(0, 5)]) };
        }, { dateKey, session, chain: global.__vyChain });
        assert.match(vy.preview, /FFS1 \+ E3 16:00–19:30 \(3h30\)[\s\S]*E8 19:30–21:00 \(1h30\)/, vy.preview);
        assert.match(vy.previewAfter, /E8 19:30–20:00 \(0h30\)/, 'preview follows the Ra box as the Admin types');
        assert.deepEqual(vy.rows, [['FFS1 + E3', 'ffs1+e3', '16:00', '19:30'], ['E8', 'e8', '19:30', '21:00']]);

        // Admin chủ động chọn 1 môn khác lịch: admin luôn đúng, không chia.
        const chosen = await draftFor(['e8'], '17:35', '20:30');
        assert.equal(chosen.draft.override.mode, 'actual');
        assert.deepEqual(chosen.draft.override.allocations.map(a => a.subjectIds.join('+')), ['e8']);

        // Phiên đã lưu sai trước đây (1 dòng "E2 + E8"): mở lại và lưu là tự chia đúng.
        const resaved = await draftFor(['e2', 'e8'], '17:35', '20:30', { session: withOldOverride });
        assert.equal(resaved.draft.override.mode, 'manual');
        assert.deepEqual(resaved.draft.override.allocations.map(a => a.roleName), ['E2', 'E8']);

        // Chế độ "Chia ca" mở sẵn mỗi lớp một dòng thay vì 1 dòng gộp.
        const rows = await page.evaluate(() => {
            document.getElementById('apo-mode').value = 'manual';
            document.getElementById('apo-mode').dispatchEvent(new Event('change', { bubbles: true }));
            return window.AdminPayrollOverrideUI.getState().allocationCount;
        });
        assert.equal(rows, 2);
        assert.deepEqual(errors, []);
        console.log('chain-edit-split.test.cjs: manual edit of back-to-back classes keeps one row per class');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
