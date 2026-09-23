// Regression: "Ca đông học sinh" save reported success without writing anything
// (Mỹ Yến, 09/2026). Tapping a chip re-renders the report from the server and
// empties window.allMonthChips while waiting; pressing "Lưu" in that window
// wrote nothing and still toasted success. "Hủy"/after-save also re-entered the
// select mode with stale data, which could clear counts on the next save.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const report = fs.readFileSync(path.join(__dirname, '..', 'js', 'report.js'), 'utf8');
const start = report.indexOf('window.isStudentCountSelectMode = false;');
const end = report.indexOf('window.adminReviewStudentCount = async function');
assert.ok(start > 0 && end > start, 'student-count block must exist in report.js');
const block = report.slice(start, end);

const STAFF = 'nv_1777820162937';
const SCOPE = `${STAFF}__2026-09`;

function chip(dateStr, sessionId, extra = {}) {
    return { dateStr, sessionId, isTeaching: true, studentCount: null, studentCountStatus: null, ...extra };
}

function createHarness() {
    const toasts = [];
    const writes = [];
    const renders = [];
    const window = {
        payrollReadyScope: SCOPE,
        currentReportScope: SCOPE,
        unfilteredAllMonthChips: [],
        allMonthChips: [],
        currentReportRenderPromise: null
    };
    const context = {
        window,
        console: { error() {}, log() {}, warn() {} },
        currentDate: new Date(2026, 8, 23),
        document: { getElementById: () => null },
        localStorage: { getItem: key => (key === 'currentRole' ? '["teaching_assistant"]' : null) },
        lucide: undefined,
        getTargetStaffId: () => STAFF,
        getCurrentPayslipComponentStatus: () => 'draft',
        normalizeStudentCountApprovalStatus: status => (status === 'approved' || status === 'rejected' ? status : 'pending'),
        renderMonthReport: (...args) => { renders.push(args); return Promise.resolve(null); },
        UIService: {
            showLoading() {},
            hideLoading() {},
            toast: (message, type) => toasts.push({ message, type })
        },
        DBService: {
            updateSessionStudentCount: async (...args) => { writes.push(args); return true; }
        }
    };
    vm.createContext(context);
    vm.runInContext(block, context);
    return { context, window, toasts, writes, renders };
}

(async () => {
    // 1. Save pressed while the report is re-rendering: must wait, then write.
    {
        const h = createHarness();
        const c = chip('2026-09-22', 'session_23fdd06d');
        h.window.unfilteredAllMonthChips = [c];
        h.window.toggleStudentCountSelectMode();
        assert.equal(h.window.isStudentCountSelectMode, true);
        h.window.selectedStudentCountChips['2026-09-22_session_23fdd06d'] = {
            dateStr: '2026-09-22', sessionId: 'session_23fdd06d', studentCount: 10, status: 'pending'
        };
        // Chip tap started a server re-render: lists are empty until it finishes.
        h.window.unfilteredAllMonthChips = [];
        h.window.allMonthChips = [];
        h.window.payrollReadyScope = null;
        h.window.currentReportRenderPromise = new Promise(resolve => setTimeout(() => {
            h.window.unfilteredAllMonthChips = [c];
            h.window.payrollReadyScope = SCOPE;
            resolve(null);
        }, 20));
        await h.window.saveStudentCountSelections();
        assert.equal(h.writes.length, 1, 'the selected shift must be written after the render settles');
        assert.deepEqual(h.writes[0].slice(0, 5), [STAFF, '2026-09-22', 'session_23fdd06d', 10, 'approved']);
        assert.ok(h.toasts.some(t => t.type === 'success' && /1 ca/.test(t.message)));
        assert.equal(h.window.isStudentCountSelectMode, false, 'after saving the select mode must close');
    }

    // 2. Report never finished loading: no write, no success toast.
    {
        const h = createHarness();
        h.window.unfilteredAllMonthChips = [chip('2026-09-22', 's1')];
        h.window.toggleStudentCountSelectMode();
        h.window.selectedStudentCountChips['2026-09-22_s1'] = { dateStr: '2026-09-22', sessionId: 's1', studentCount: 10 };
        h.window.payrollReadyScope = null;
        await h.window.saveStudentCountSelections();
        assert.equal(h.writes.length, 0);
        assert.ok(!h.toasts.some(t => t.type === 'success'), 'must never report success without writing');
        assert.ok(h.toasts.some(t => t.type === 'error' && /chưa tải xong/.test(t.message)));
        assert.equal(h.window.isStudentCountSelectMode, true, 'keep selections so the teacher can retry');
    }

    // 3. Selected shift missing from the rendered report: explicit error.
    {
        const h = createHarness();
        h.window.unfilteredAllMonthChips = [chip('2026-09-22', 's1')];
        h.window.toggleStudentCountSelectMode();
        h.window.selectedStudentCountChips['2026-09-21_gone'] = { dateStr: '2026-09-21', sessionId: 'gone', studentCount: 10 };
        await h.window.saveStudentCountSelections();
        assert.equal(h.writes.length, 0);
        assert.ok(!h.toasts.some(t => t.type === 'success'));
        assert.ok(h.toasts.some(t => t.type === 'error' && /Không tìm thấy 1 ca/.test(t.message)));
    }

    // 4. Nothing selected: warning instead of a fake success.
    {
        const h = createHarness();
        h.window.unfilteredAllMonthChips = [chip('2026-09-22', 's1')];
        h.window.toggleStudentCountSelectMode();
        await h.window.saveStudentCountSelections();
        assert.equal(h.writes.length, 0);
        assert.ok(!h.toasts.some(t => t.type === 'success'));
        assert.ok(h.toasts.some(t => t.type === 'warning' && /Không có thay đổi/.test(t.message)));
    }

    // 5. Only counts known when the mode opened may be cleared by deselecting.
    {
        const h = createHarness();
        const known = chip('2026-09-19', 'known', { studentCount: 12, studentCountStatus: 'approved' });
        h.window.unfilteredAllMonthChips = [known];
        h.window.toggleStudentCountSelectMode();
        assert.ok(h.window.selectedStudentCountChips['2026-09-19_known'], 'existing counts are pre-selected');
        delete h.window.selectedStudentCountChips['2026-09-19_known'];
        const appearedLater = chip('2026-09-20', 'later', { studentCount: 11, studentCountStatus: 'approved' });
        h.window.unfilteredAllMonthChips = [known, appearedLater];
        await h.window.saveStudentCountSelections();
        assert.equal(h.writes.length, 1, 'only the deselected known count is cleared');
        assert.deepEqual(h.writes[0].slice(1, 5), ['2026-09-19', 'known', null, null]);
    }

    // 6. Rejected counts and receptionist chips are never written; merged chips write once.
    {
        const h = createHarness();
        h.window.unfilteredAllMonthChips = [
            chip('2026-09-12', 'rej', { studentCount: 10, studentCountStatus: 'rejected' }),
            chip('2026-09-12', 'merged'),
            chip('2026-09-12', 'merged'),
            chip('2026-09-12', 'recep', { isReceptionist: true })
        ];
        h.window.toggleStudentCountSelectMode();
        h.window.selectedStudentCountChips['2026-09-12_merged'] = { dateStr: '2026-09-12', sessionId: 'merged', studentCount: 10 };
        await h.window.saveStudentCountSelections();
        assert.equal(h.writes.length, 1);
        assert.equal(h.writes[0][2], 'merged');
    }

    // 7. "Hủy" really exits instead of re-entering the select mode.
    {
        const h = createHarness();
        h.window.unfilteredAllMonthChips = [chip('2026-09-22', 's1')];
        h.window.toggleStudentCountSelectMode();
        assert.equal(h.window.isStudentCountSelectMode, true);
        h.window.exitStudentCountSelectMode();
        assert.equal(h.window.isStudentCountSelectMode, false);
        assert.deepEqual(Object.keys(h.window.selectedStudentCountChips), []);
    }

    // 8. The select mode cannot open while the report is still loading.
    {
        const h = createHarness();
        h.window.payrollReadyScope = null;
        h.window.toggleStudentCountSelectMode();
        assert.equal(h.window.isStudentCountSelectMode, false);
        assert.ok(h.toasts.some(t => t.type === 'warning' && /đang tải/.test(t.message)));
    }

    assert.match(report, /window\.currentReportRenderPromise = renderPromise;/,
        'renderMonthReport must expose its in-flight promise for chip-dependent actions');
    console.log('student-count-save.test.js passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
