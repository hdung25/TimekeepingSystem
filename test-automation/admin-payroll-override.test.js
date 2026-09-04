const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.TZ = 'Asia/Ho_Chi_Minh';

const overrideApi = require('../js/admin-payroll-override.js');
const dateKey = '2026-08-17';
const at = clock => `${dateKey}T${clock}:00+07:00`;

// Both evaluator entry points must load the pure override API first, and the
// PWA precache must use the exact same URL.
{
    let asset = '';
    ['bao-cao.html', 'cham-cong.html'].forEach(file => {
        const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const match = html.match(/js\/admin-payroll-override\.js\?v=[^"']+/);
        assert.ok(match, `${file} must load a versioned admin-payroll-override.js`);
        if (!asset) asset = match[0];
        assert.equal(match[0], asset, 'both pages must load the same override API version');
        assert.ok(
            html.indexOf(asset) < html.indexOf('js/evaluation-service.js'),
            `${file} must load the override API before evaluation-service.js`
        );
    });
    const worker = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
    assert.ok(worker.includes(`/${asset}`), 'service worker must precache the exact page asset URL');
}

function allocation(id, kind, from, to, extras = {}) {
    return {
        id,
        kind,
        fromISO: at(from),
        toISO: at(to),
        ...extras
    };
}

function session(id, mode, allocations, extras = {}) {
    return {
        id,
        checkIn: at('07:00'),
        checkOut: at('11:00'),
        ...extras,
        adminPayrollOverride: {
            version: 1,
            revision: 1,
            mode,
            ...(allocations === undefined ? {} : { allocations })
        }
    };
}

// Actual means the persisted attendance bounds win over schedule clipping.
{
    const source = session('actual-reception', 'actual', undefined, {
        role: 'tiep-tan',
        roleName: 'Tiếp Tân'
    });
    const result = overrideApi.buildOverrideChips([source]);
    assert.equal(result.applied, true);
    assert.equal(result.totalPaidMinutes, 240);
    assert.equal(result.chips.length, 1);
    assert.equal(result.chips[0].isReceptionist, true);
    assert.equal(result.chips[0].adminPayrollOverrideMode, 'actual');
    assert.equal(result.chips[0].payrollOverrideRevision, 1);
}

// One physical 07:00-11:00 session may be allocated to two employee roles.
// Teaching owns the overlapping 07:30-09:00 range; it is never paid twice.
{
    const source = session('dual-role', 'manual', [
        allocation('front-desk', 'receptionist', '07:00', '11:00', { roleName: 'Tiếp Tân' }),
        allocation('teach-e1', 'teaching', '07:30', '09:00', {
            roleName: 'E1',
            subjectId: 'subject-e1'
        })
    ]);
    const result = overrideApi.buildOverrideChips([source]);
    const teaching = result.chips.find(chip => chip.isTeaching);
    const reception = result.chips.find(chip => chip.isReceptionist);
    assert.equal(result.totalPaidMinutes, 240);
    assert.equal(teaching.paidMinutes, 90);
    assert.equal(reception.paidMinutes, 150);
    assert.equal(
        teaching.daySegments.map(seg => `${seg.kind}:${seg.start}-${seg.end}:${seg.minutes}`).join('|'),
        'tiep-tan:07:00-07:30:30|day:07:30-09:00:90|tiep-tan:09:00-11:00:120'
    );
}

// A manually entered hourly rate travels on the generated chip so every salary
// output can treat the primary Admin decision as authoritative.
{
    const source = session('manual-rate', 'manual', [
        allocation('teach-rate', 'teaching', '07:30', '09:00', {
            roleName: 'E1',
            subjectId: 'subject-e1',
            rateMode: 'manual',
            manualRate: 123456
        })
    ]);
    const result = overrideApi.buildOverrideChips([source]);
    assert.equal(result.chips.length, 1);
    assert.equal(result.chips[0].payrollRateMode, 'manual');
    assert.equal(result.chips[0].payrollRate, 123456);
    assert.equal(result.chips[0].payrollRateSource, 'admin-override');
    assert.equal(result.chips[0].sessionData.roleRate, 123456);
}

// Primary Admin may explicitly add +10 minutes to an absolute teaching chip
// even when there is no schedule locator. This is intentionally a different
// path from the employee self-service early-10 policy.
{
    const source = session('admin-early10-without-schedule', 'actual', undefined, {
        role: 'subject-e7',
        roleName: 'E7'
    });
    source.adminPayrollOverride.adminEarly10 = {
        enabled: true,
        minutes: 10,
        allocationId: 'actual'
    };
    const result = overrideApi.buildOverrideChips([source]);
    assert.equal(result.applied, true);
    assert.equal(result.totalPaidMinutes, 250);
    assert.equal(result.chips[0].paidMinutes, 250);
    assert.equal(result.chips[0].classStart, null,
        'Admin +10 must not require a schedule start when the payroll chip is authoritative');
    assert.equal(result.chips[0].bonus10Status, 'admin_override');
    assert.equal(result.chips[0].isAdminEarly10Override, true);
    assert.match(result.chips[0].text, /\+10p Admin/);
}

// The direct authority is still precise: it cannot change the bonus amount or
// attach a teaching allowance to an operational allocation.
{
    const wrongMinutes = session('bad-admin-early10-minutes', 'actual', undefined, {
        role: 'subject-e7',
        roleName: 'E7'
    });
    wrongMinutes.adminPayrollOverride.adminEarly10 = {
        enabled: true,
        minutes: 15,
        allocationId: 'actual'
    };
    assert.equal(
        overrideApi.validateOverride(wrongMinutes).errors.some(error => error.code === 'INVALID_ADMIN_EARLY10_MINUTES'),
        true
    );

    const receptionist = session('bad-admin-early10-role', 'actual', undefined, {
        role: 'tiep-tan',
        roleName: 'Tiếp Tân'
    });
    receptionist.adminPayrollOverride.adminEarly10 = {
        enabled: true,
        minutes: 10,
        allocationId: 'actual'
    };
    assert.equal(
        overrideApi.validateOverride(receptionist).errors.some(error => error.code === 'ADMIN_EARLY10_REQUIRES_TEACHING'),
        true
    );
}

// The interval union is global across override sessions, not just within one row.
{
    const first = session('overlap-a', 'manual', [
        allocation('teach-a', 'teaching', '07:00', '09:00', { roleName: 'E1', subjectId: 'e1' })
    ]);
    const second = session('overlap-b', 'manual', [
        allocation('teach-b', 'teaching', '08:00', '10:00', { roleName: 'E1', subjectId: 'e1' })
    ]);
    const result = overrideApi.buildOverrideChips([first, second]);
    assert.equal(result.totalPaidMinutes, 180);
    assert.equal(result.chips.find(chip => chip.sessionId === 'overlap-a').paidMinutes, 120);
    assert.equal(result.chips.find(chip => chip.sessionId === 'overlap-b').paidMinutes, 60);
    assert.equal(result.warnings.some(warning => warning.code === 'DUPLICATE_PAY_RANGE_REMOVED'), true);
}

// Equal-priority overlap ownership is stable by session/allocation identity,
// never by the mutable order of maps in attendance.sessions.
{
    const alpha = session('alpha-session', 'manual', [
        allocation('alpha-allocation', 'teaching', '07:00', '09:00', {
            roleName: 'E1', subjectId: 'e1', rateMode: 'manual', manualRate: 100000
        })
    ]);
    const beta = session('beta-session', 'manual', [
        allocation('beta-allocation', 'teaching', '07:00', '09:00', {
            roleName: 'E1', subjectId: 'e1', rateMode: 'manual', manualRate: 200000
        })
    ]);
    const forward = overrideApi.buildOverrideChips([alpha, beta]);
    const reversed = overrideApi.buildOverrideChips([beta, alpha]);
    const owner = result => result.chips.find(chip => chip.paidMinutes === 120)?.sessionId;
    assert.equal(owner(forward), 'alpha-session');
    assert.equal(owner(reversed), 'alpha-session');
    assert.equal(forward.totalPaidMinutes, reversed.totalPaidMinutes);
}

// Explicitly grouped, touching shifts merge only at the same branch.
{
    const sameBranch = session('merge-same-branch', 'manual', [
        allocation('r1', 'receptionist', '07:00', '09:00', {
            roleName: 'Tiếp Tân',
            mergeGroupId: 'morning-chain',
            scheduleRef: { type: 'receptionist', branch: 'cs1', shiftKey: 'sang', dayKey: 'mon' }
        }),
        allocation('r2', 'receptionist', '09:00', '11:00', {
            roleName: 'Tiếp Tân',
            mergeGroupId: 'morning-chain',
            scheduleRef: { type: 'receptionist', branch: 'cs1', shiftKey: 'sang-2', dayKey: 'mon' }
        })
    ]);
    const merged = overrideApi.buildOverrideChips([sameBranch]);
    assert.equal(merged.chips.length, 1);
    assert.equal(merged.chips[0].paidMinutes, 240);
    assert.equal(merged.chips[0].mergedSegments.length, 2);

    const differentBranch = session('merge-different-branch', 'manual', [
        allocation('r1', 'receptionist', '07:00', '09:00', {
            roleName: 'Tiếp Tân',
            mergeGroupId: 'cross-campus-chain',
            scheduleRef: { type: 'receptionist', branch: 'cs1' }
        }),
        allocation('r2', 'receptionist', '09:00', '11:00', {
            roleName: 'Tiếp Tân',
            mergeGroupId: 'cross-campus-chain',
            scheduleRef: { type: 'receptionist', branch: 'cs2' }
        })
    ]);
    const separate = overrideApi.buildOverrideChips([differentBranch]);
    assert.equal(separate.chips.length, 2);
    assert.equal(separate.totalPaidMinutes, 240);
    assert.equal(separate.chips.map(chip => chip.branch).join(','), 'cs1,cs2');
}

// Bad chronology and bad explicit schema values never become payable overrides.
{
    const invalidAllocation = session('bad-allocation-time', 'manual', [
        allocation('reversed', 'teaching', '10:00', '09:00', { roleName: 'E1' })
    ]);
    const invalidResult = overrideApi.buildOverrideChips([invalidAllocation]);
    assert.equal(invalidResult.applied, false);
    assert.equal(
        invalidResult.invalidOverrides[0].errors.some(error => error.code === 'INVALID_CHRONOLOGY'),
        true
    );

    const invalidActual = session('bad-actual-time', 'actual', undefined, {
        checkIn: at('11:00'),
        checkOut: at('07:00'),
        role: 'tiep-tan'
    });
    const actualValidation = overrideApi.validateOverride(invalidActual);
    assert.equal(actualValidation.ok, false);
    assert.equal(actualValidation.errors.some(error => error.code === 'INVALID_ACTUAL_CHRONOLOGY'), true);

    const invalidKind = session('bad-kind', 'manual', [
        allocation('mystery', 'cashier', '07:00', '08:00')
    ]);
    assert.equal(
        overrideApi.validateOverride(invalidKind).errors.some(error => error.code === 'INVALID_KIND'),
        true
    );
}

function loadEvaluator() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'evaluation-service.js'), 'utf8');
    const context = {
        console,
        Date,
        Math,
        Set,
        Map,
        Intl,
        AdminPayrollOverride: overrideApi,
        window: {
            AdminPayrollOverride: overrideApi,
            centerClosures: {},
            getIconHtml: () => ''
        },
        getLocalDateKey: date => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        },
        isScheduledMainTeacher: (cls, id) =>
            cls.gvId === id || (cls.gvList || []).some(teacher => teacher.id === id),
        isScheduledSubstitute: (cls, id) =>
            cls.gvThayTheId === id || cls.gvThayTeId === id ||
            (cls.gvThayTheList || []).some(teacher => teacher.id === id) ||
            (cls.gvThayTeList || []).some(teacher => teacher.id === id),
        hasScheduledSubstitute: cls =>
            !!cls.gvThayTheId || !!cls.gvThayTeId ||
            (cls.gvThayTheList || []).length > 0 || (cls.gvThayTeList || []).length > 0
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context.window.calculateDailyChips;
}

const calculateDailyChips = loadEvaluator();
const staffId = 'dual-role-staff';
const schedule = {
    morning1: [{
        start: '07:30',
        end: '09:00',
        lop: 'E1',
        lopId: 'subject-e1',
        gvId: staffId,
        registeredTeachers: [],
        _branch: 'cs1',
        _compositeKey: 'cs1__2026-08-17',
        _originalIndex: 0
    }]
};
const user = {
    roles: ['teaching_assistant', 'receptionist'],
    salary_config: {
        roles: [{ id: 'subject-e1', name: 'E1', rate: 100000 }]
    }
};
const receptionistShifts = [{
    start: '07:00',
    end: '11:00',
    label: 'SÁNG',
    shift: 'morning',
    branch: 'cs1',
    documentKey: 'cs1_2026-08-17',
    isFixedShift: false
}];

// Evaluator integration: valid actual override replaces schedule-derived chips.
{
    const actualSource = session('evaluator-actual', 'actual', undefined, {
        checkIn: at('07:00'),
        checkOut: at('10:00'),
        role: 'subject-e1',
        roleName: 'E1'
    });
    const chips = calculateDailyChips(schedule, [actualSource], staffId, dateKey, user);
    assert.equal(chips.length, 1);
    assert.equal(chips[0].isAdminPayrollOverride, true);
    assert.equal(chips[0].paidMinutes, 180);
}

// Evaluator integration: manual dual-role allocation suppresses the old grey
// schedule chip and returns exactly the two explicit payroll chips.
{
    const manualSource = session('evaluator-manual', 'manual', [
        allocation('desk', 'receptionist', '07:00', '11:00', {
            roleName: 'Tiếp Tân',
            // Old/UI-derived references can identify the weekly document and
            // shift but omit the weekday. The wrapper recovers just the missing
            // receptionist identity from legacy matching, not every role.
            scheduleRef: {
                type: 'receptionist',
                documentKey: 'cs1_2026-08-17',
                shiftKey: 'morning'
            }
        }),
        allocation('class', 'teaching', '07:30', '09:00', {
            roleName: 'E1',
            subjectId: 'subject-e1',
            scheduleRef: {
                type: 'teaching',
                branch: 'cs1',
                documentKey: 'cs1__2026-08-17',
                section: 'morning1',
                rowIndex: 0,
                start: '07:30',
                end: '09:00'
            }
        })
    ], {
        role: 'tiep-tan',
        roleName: 'Tiếp Tân'
    });
    const chips = calculateDailyChips(schedule, [manualSource], staffId, dateKey, user, receptionistShifts);
    assert.equal(chips.length, 2);
    assert.equal(chips.every(chip => chip.isAdminPayrollOverride), true);
    assert.equal(chips.reduce((sum, chip) => sum + chip.paidMinutes, 0), 240);
    assert.equal(chips.find(chip => chip.isTeaching).paidMinutes, 90);
    assert.equal(chips.find(chip => chip.isReceptionist).paidMinutes, 150);
}

// Reclassifying a teaching source to reception replaces the source session as
// a whole.  Its former teaching schedule must not remain as a second grey chip.
{
    const reclassifiedSource = session('evaluator-reclassified', 'manual', [
        allocation('corrected-desk', 'receptionist', '07:00', '11:00', {
            roleName: 'Tiếp Tân',
            scheduleRef: {
                type: 'receptionist', branch: 'cs1',
                documentKey: 'cs1_2026-08-17', shiftKey: 'morning'
            }
        })
    ], {
        role: 'subject-e1',
        roleName: 'E1'
    });
    const chips = calculateDailyChips(
        schedule, [reclassifiedSource], staffId, dateKey, user, receptionistShifts
    );
    assert.equal(chips.length, 1);
    assert.equal(chips[0].isAdminPayrollOverride, true);
    assert.equal(chips[0].isReceptionist, true);
    assert.equal(chips.some(chip => chip.class === 'chip-gray'), false);
}

// Invalid override data falls back to the unchanged legacy schedule evaluator.
{
    const invalidSource = session('evaluator-invalid', 'manual', [
        allocation('reversed', 'teaching', '09:00', '08:00', { roleName: 'E1' })
    ], {
        checkIn: at('07:30'),
        checkOut: at('09:00'),
        role: 'subject-e1',
        roleName: 'E1'
    });
    const chips = calculateDailyChips(schedule, [invalidSource], staffId, dateKey, user);
    assert.equal(chips.length, 1);
    assert.equal(chips[0].isAdminPayrollOverride, undefined);
    assert.equal(chips[0].paidMinutes, 90);
}

console.log('admin-payroll-override tests passed');
