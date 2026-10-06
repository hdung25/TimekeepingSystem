'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { decodeFields } = require('./repair-evening-attendance-20260831.js');
const audit = JSON.parse(fs.readFileSync('../.attendance-repairs/quang-huy-20261006-audit.json', 'utf8'));
const oldSource = execFileSync('git', ['show', '0bc40b4:js/evaluation-service.js'], { encoding: 'utf8' });
const newSource = fs.readFileSync('js/evaluation-service.js', 'utf8');
function contextFor(source) {
    const context = { console, Date, Math, Set, Map, Intl, window: { centerClosures: {}, getIconHtml: () => '' },
        getLocalDateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        isScheduledMainTeacher: (cls, id) => cls.gvId === id || (cls.gvList || []).some(g => g.id === id),
        isScheduledSubstitute: (cls, id) => cls.gvThayTheId === id || cls.gvThayTeId === id || (cls.gvThayTheList || []).some(g => g.id === id) || (cls.gvThayTeList || []).some(g => g.id === id),
        hasScheduledSubstitute: cls => !!cls.gvThayTheId || !!cls.gvThayTeId || (cls.gvThayTheList || []).length > 0 || (cls.gvThayTeList || []).length > 0 };
    vm.createContext(context); vm.runInContext(source, context); return context;
}
const old = contextFor(oldSource), current = contextFor(newSource);
const results = audit.records.map(record => {
    const schedule = {}, reception = [];
    const dow = new Date(record.date + 'T12:00:00+07:00').getDay();
    const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dow];
    for (const branch of record.schedules) {
        const teaching = decodeFields(branch.teaching?.fields || {});
        Object.entries(teaching).forEach(([section, rows]) => {
            if (!Array.isArray(rows)) return;
            schedule[section] = (schedule[section] || []).concat(rows.map((row, index) => ({ ...row, _branch: branch.branch, _compositeKey: branch.branch + '__' + record.date, _originalIndex: index })));
        });
        const roster = decodeFields(branch.reception?.fields || {});
        for (const shiftKey of ['morning', 'afternoon', 'evening']) {
            const person = roster[shiftKey]?.[dayKey]?.find(p => p.id === audit.uid);
            if (person) reception.push({ start: person.customStart || roster._shiftConfig?.[shiftKey]?.start,
                end: person.customEnd || roster._shiftConfig?.[shiftKey]?.end, branch: branch.branch, shiftKey, dayKey,
                isFixedShift: person.isFixedShift, _compositeKey: branch.branch + '__' + record.monday });
        }
    }
    const sessions = decodeFields(record.attendance?.fields || {}).sessions || [];
    const evaluate = context => context.window.calculateDailyChips(schedule, sessions, audit.uid, record.date, audit.user, reception)
        .map(chip => ({ text: chip.text, class: chip.class, paidMinutes: chip.paidMinutes, sessionId: chip.sessionId, role: chip.sessionData?.role, isReceptionist: chip.isReceptionist }));
    return { date: record.date, rawSessions: sessions.length, reception, yesterday: evaluate(old), today: evaluate(current) };
});
fs.writeFileSync('scratch/quang-huy-chip-comparison.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
