(function () {
    'use strict';

    const mode = document.body.dataset.shiftOversightMode;
    if (!mode) return;

    const SHIFT_LABELS = { morning: 'Sáng', afternoon: 'Chiều', evening: 'Tối' };
    const SHIFT_SECTIONS = {
        morning: ['morning1', 'morning2'],
        afternoon: ['afternoon1', 'afternoon2'],
        evening: ['evening1', 'evening2']
    };
    const OVERSIGHT_BRANCHES = ['cs1', 'cs2', 'cs3'];
    const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    const state = {
        mode,
        dateKey: '',
        branch: 'cs1',
        shiftKey: 'morning',
        currentUserId: localStorage.getItem('currentUserId') || '',
        currentUserName: localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || '',
        roles: parseRoles(localStorage.getItem('currentRole')),
        users: [],
        userMap: {},
        assignedReceptionists: [],
        currentUserAssignments: [],
        observations: [],
        attendanceRecords: [],
        classEntries: [],
        canOperate: false,
        selectedClass: null,
        adminRecords: []
    };

    function parseRoles(raw) {
        try {
            const parsed = JSON.parse(raw || '[]');
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
            return raw ? [raw] : [];
        }
    }

    function isAdminRole() {
        return state.roles.some(role => ['admin', 'senior_assistant'].includes(role));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function localDateKey(date = new Date()) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function toLocalDate(dateKey, time) {
        if (!dateKey || !time) return null;
        const [y, m, d] = dateKey.split('-').map(Number);
        const [h, min] = time.split(':').map(Number);
        const result = new Date(y, m - 1, d, h, min, 0, 0);
        return Number.isNaN(result.getTime()) ? null : result;
    }

    function safeDate(value) {
        if (!value) return null;
        if (value instanceof Date) return value;
        if (typeof value?.toDate === 'function') return value.toDate();
        if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
        const result = new Date(value);
        return Number.isNaN(result.getTime()) ? null : result;
    }

    function getMondayKey(dateKey) {
        const [y, m, d] = dateKey.split('-').map(Number);
        const date = new Date(y, m - 1, d, 12, 0, 0, 0);
        const day = date.getDay();
        date.setDate(date.getDate() - day + (day === 0 ? -6 : 1));
        return localDateKey(date);
    }

    function getDayKey(dateKey) {
        const [y, m, d] = dateKey.split('-').map(Number);
        return DAY_KEYS[new Date(y, m - 1, d, 12, 0, 0, 0).getDay()];
    }

    function initials(name) {
        const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
        return parts.slice(-2).map(part => part.charAt(0).toUpperCase()).join('') || '?';
    }

    function refreshIcons() {
        if (window.lucide) window.lucide.createIcons();
    }

    function toast(message, type = 'info') {
        if (window.UIService?.toast) window.UIService.toast(message, type);
        else console.log(message);
    }

    function renderLoading(container, count = 3) {
        container.innerHTML = Array.from({ length: count }, () => '<div class="oversight-skeleton"></div>').join('');
    }

    async function init() {
        if (window.waitAuth) await window.waitAuth();
        state.users = await DBService.getUsers();
        state.userMap = Object.fromEntries(state.users.map(user => [user.id, user]));

        if (mode === 'receptionist') initReceptionistPage();
        if (mode === 'admin') initAdminPage();
        refreshIcons();
    }

    function initReceptionistPage() {
        const dateInput = document.getElementById('oversight-date');
        const branchInput = document.getElementById('oversight-branch');
        state.dateKey = localDateKey();
        dateInput.value = state.dateKey;

        dateInput.addEventListener('change', () => {
            state.dateKey = dateInput.value || localDateKey();
            loadReceptionistView();
        });
        branchInput.addEventListener('change', () => {
            state.branch = branchInput.value;
            loadReceptionistView();
        });
        document.querySelectorAll('#oversight-shift button').forEach(button => {
            button.addEventListener('click', () => {
                state.shiftKey = button.dataset.shift;
                document.querySelectorAll('#oversight-shift button').forEach(item => item.classList.toggle('active', item === button));
                loadReceptionistView();
            });
        });
        document.getElementById('oversight-refresh-btn').addEventListener('click', loadReceptionistView);
        document.getElementById('observation-form').addEventListener('submit', submitObservation);
        document.getElementById('observation-late-minutes').addEventListener('input', updateEffectivePreview);
        document.querySelectorAll('[data-close-modal]').forEach(item => item.addEventListener('click', closeObservationModal));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeObservationModal();
        });
        loadReceptionistView();
    }

    async function loadReceptionistView() {
        const list = document.getElementById('class-list');
        renderLoading(list, 4);
        document.getElementById('class-count-label').textContent = 'Đang đồng bộ từ trang Xếp lịch...';
        state.canOperate = false;

        try {
            const compositeKey = `${state.branch}__${state.dateKey}`;
            const mondayKey = getMondayKey(state.dateKey);
            const [schedule, receptionistSchedules, observations, attendanceRecords] = await Promise.all([
                DBService.getSchedule(compositeKey),
                Promise.all(OVERSIGHT_BRANCHES.map(branch =>
                    DBService.getReceptionistSchedule(`${branch}__${mondayKey}`)
                )),
                DBService.getShiftObservationsForDate(state.dateKey),
                DBService.getAttendanceRecordsForDate(state.dateKey)
            ]);

            state.observations = observations || [];
            state.attendanceRecords = attendanceRecords || [];
            const dayKey = getDayKey(state.dateKey);
            const schedulesByBranch = Object.fromEntries(
                OVERSIGHT_BRANCHES.map((branch, index) => [branch, receptionistSchedules[index] || {}])
            );
            state.assignedReceptionists = schedulesByBranch[state.branch]?.[state.shiftKey]?.[dayKey] || [];
            state.currentUserAssignments = OVERSIGHT_BRANCHES.flatMap(branch =>
                (schedulesByBranch[branch]?.[state.shiftKey]?.[dayKey] || [])
                    .filter(item => String(item?.id || '') === String(state.currentUserId))
                    .map(item => ({ ...item, branch }))
            );
            state.classEntries = buildClassEntries(schedule || {}, compositeKey);
            updateDutyPanel();
            renderClassList();
        } catch (error) {
            console.error('[ShiftOversight] Load error:', error);
            list.innerHTML = stateHtml('circle-alert', 'Không tải được dữ liệu ca', error.message || 'Vui lòng thử lại.');
            refreshIcons();
        }
    }

    function buildClassEntries(schedule, compositeKey) {
        const entries = [];
        SHIFT_SECTIONS[state.shiftKey].forEach(sectionKey => {
            (schedule[sectionKey] || []).forEach((cls, classIndex) => {
                if (!cls?.start || !cls?.end || cls.isClosed === true) return;
                // Lớp có thể xếp nhiều GV → lấy cả danh sách, không chỉ người đầu tiên
                const substituteIds = [...getScheduledSubstituteIds(cls)];
                const mainTeacherIds = [...getScheduledMainTeacherIds(cls)];
                const availableMainTeacherIds = mainTeacherIds.filter(id =>
                    typeof isMainTeacherAbsentFromClass !== 'function' || !isMainTeacherAbsentFromClass(cls, id)
                );
                const hasReportedAbsence = mainTeacherIds.some(id =>
                    typeof isMainTeacherAbsentFromClass === 'function' && isMainTeacherAbsentFromClass(cls, id)
                );
                const registeredIds = (cls.registeredTeachers || [])
                    .map(item => item.id)
                    .filter(id => id && !mainTeacherIds.includes(id));
                // Đồng giảng: GV thay chỉ thay người đã báo nghỉ; GV chính còn hoạt
                // động vẫn phải xuất hiện để tiếp tân theo dõi đi trễ/vắng mặt.
                const teacherIds = [
                    ...availableMainTeacherIds,
                    ...substituteIds,
                    ...registeredIds
                ].filter(Boolean);
                const uniqueTeacherIds = [...new Set(teacherIds)];

                if (uniqueTeacherIds.length === 0) {
                    entries.push(createClassEntry(
                        cls, sectionKey, classIndex, compositeKey, '',
                        hasReportedAbsence ? 'Chưa có GV thay (GV đã báo nghỉ)' : 'Chưa xếp giáo viên'
                    ));
                    return;
                }
                uniqueTeacherIds.forEach(teacherId => {
                    const staffingEntry = [
                        ...(Array.isArray(cls.gvList) ? cls.gvList : []),
                        ...(Array.isArray(cls.gvThayTeList) ? cls.gvThayTeList : []),
                        ...(Array.isArray(cls.gvThayTheList) ? cls.gvThayTheList : []),
                        ...(cls.registeredTeachers || [])
                    ].find(item => item?.id === teacherId);
                    const fallbackName = staffingEntry?.name || cls.gv || '';
                    const user = state.userMap[teacherId];
                    entries.push(createClassEntry(cls, sectionKey, classIndex, compositeKey, teacherId, user?.name || user?.fullName || fallbackName || teacherId));
                });
            });
        });
        return entries.sort((a, b) => a.start.localeCompare(b.start) || a.className.localeCompare(b.className));
    }

    function createClassEntry(cls, sectionKey, classIndex, compositeKey, teacherId, teacherName) {
        const systemLateMinutes = teacherId ? calculateSystemLate(teacherId, cls.start, cls.end) : 0;
        const observations = state.observations.filter(item => {
            if (item.status === 'cancelled' || item.teacherId !== teacherId) return false;
            if (item.scheduleCompositeKey && item.classSectionKey) {
                return item.scheduleCompositeKey === compositeKey &&
                    item.classSectionKey === sectionKey &&
                    Number(item.classIndex) === Number(classIndex);
            }
            return item.branch === state.branch && item.classStart === cls.start;
        });
        const manualLateMinutes = observations.reduce((max, item) => Math.max(max, Number(item.lateMinutes) || 0), 0);
        return {
            scheduleCompositeKey: compositeKey,
            sectionKey,
            classIndex,
            start: cls.start,
            end: cls.end,
            className: cls.lop || 'Lớp chưa đặt tên',
            subjectId: cls.lopId || '',
            room: cls.phong || '',
            teacherId,
            teacherName,
            systemLateMinutes,
            manualLateMinutes,
            effectiveLateMinutes: Math.max(systemLateMinutes, manualLateMinutes),
            observations
        };
    }

    function calculateSystemLate(teacherId, classStart, classEnd) {
        const record = state.attendanceRecords.find(item => item.userId === teacherId);
        if (!record) return 0;
        const sessions = Array.isArray(record.sessions) ? record.sessions : [];
        const scheduledStart = toLocalDate(state.dateKey, classStart);
        const scheduledEnd = toLocalDate(state.dateKey, classEnd);
        if (!scheduledStart || !scheduledEnd) return 0;

        let session = sessions.find(item => item.linkedClassStart === classStart);
        if (!session) {
            session = sessions.find(item => {
                const checkIn = safeDate(item.checkIn || item.start);
                const checkOut = safeDate(item.checkOut);
                if (!checkIn) return false;
                if (checkOut) return checkIn < scheduledEnd && checkOut > scheduledStart;
                return Math.abs(checkIn - scheduledStart) < 60 * 60 * 1000;
            });
        }
        if (!session) return 0;
        const checkIn = safeDate(session.checkIn || session.start);
        if (!checkIn || checkIn <= scheduledStart) return 0;
        return Math.max(0, Math.round((checkIn - scheduledStart) / 60000));
    }

    function updateDutyPanel() {
        const panel = document.getElementById('shift-duty-panel');
        const status = document.getElementById('duty-status-text');
        const list = document.getElementById('assigned-staff-list');
        const button = document.getElementById('activate-shift-btn');
        const assignmentBranches = [...new Set(state.currentUserAssignments.map(item => item.branch))];
        const isAssignedAnywhere = assignmentBranches.length > 0;

        list.innerHTML = state.assignedReceptionists.length
            ? state.assignedReceptionists.map(item => `
                <span class="staff-presence-chip ${String(item.id) === String(state.currentUserId) ? 'active' : ''}">
                    <span class="presence-mark"></span>${escapeHtml(item.name || state.userMap[item.id]?.name || item.id)}
                </span>`).join('')
            : '<span class="staff-presence-chip">Chưa xếp tiếp tân</span>';

        panel.classList.remove('is-active', 'is-blocked');
        button.classList.remove('is-access-status');
        if (isAdminRole()) {
            state.canOperate = true;
            panel.classList.add('is-active');
            status.textContent = `Quản trị viên đang xem ca ${SHIFT_LABELS[state.shiftKey].toLowerCase()}.`;
            button.disabled = true;
            button.classList.add('is-access-status');
            button.innerHTML = '<i data-lucide="shield-check"></i><span>Quyền quản trị</span>';
        } else if (isAssignedAnywhere) {
            state.canOperate = true;
            panel.classList.add('is-active');
            const branchLabel = assignmentBranches.map(branch => branch.toUpperCase()).join(', ');
            status.textContent = `Bạn có lịch tiếp tân tại ${branchLabel}. Quyền ghi nhận đã mở cho tất cả cơ sở trong ca này.`;
            button.disabled = true;
            button.classList.add('is-access-status');
            button.innerHTML = '<i data-lucide="check-circle-2"></i><span>Đã mở tự động</span>';
        } else {
            panel.classList.add('is-blocked');
            status.textContent = 'Tài khoản này không có lịch tiếp tân tại bất kỳ cơ sở nào trong ca đã chọn.';
            button.disabled = true;
            button.innerHTML = '<i data-lucide="lock-keyhole"></i><span>Chưa được phân ca</span>';
        }
        refreshIcons();
    }

    async function ensureObservationAccess() {
        if (isAdminRole()) return;
        if (state.currentUserAssignments.length === 0) {
            throw new Error('Bạn không có lịch tiếp tân trong ca đã chọn.');
        }

        // Firestore vẫn yêu cầu một presence document để chống ghi trực tiếp trái phép.
        // Tạo ngầm cho cơ sở đang quan sát để tiếp tân không phải bấm thêm một bước.
        await DBService.activateReceptionistShift(
            state.dateKey,
            state.branch,
            state.shiftKey,
            state.currentUserId,
            state.currentUserName
        );
    }

    function renderClassList() {
        const list = document.getElementById('class-list');
        document.getElementById('class-count-label').textContent = `${state.classEntries.length} lớp/giáo viên trong ca ${SHIFT_LABELS[state.shiftKey].toLowerCase()}`;
        if (state.classEntries.length === 0) {
            list.innerHTML = stateHtml('calendar-x-2', 'Không có lớp trong ca này', 'Dữ liệu được lấy trực tiếp từ trang Xếp lịch.');
            refreshIcons();
            return;
        }

        list.innerHTML = state.classEntries.map((entry, index) => {
            const notes = entry.observations.map(item => item.note).filter(Boolean);
            const hasLate = entry.effectiveLateMinutes > 0;
            return `
                <article class="class-card ${hasLate ? 'has-late' : ''}">
                    <div class="class-time"><strong>${escapeHtml(entry.start)} - ${escapeHtml(entry.end)}</strong><span>${state.branch.toUpperCase()}</span></div>
                    <div class="class-details"><h3>${escapeHtml(entry.className)}</h3><p>${entry.room ? `Phòng ${escapeHtml(entry.room)}` : 'Chưa ghi phòng học'}</p></div>
                    <div class="teacher-details"><span class="teacher-avatar">${escapeHtml(initials(entry.teacherName))}</span><div><h3>${escapeHtml(entry.teacherName)}</h3><p>${entry.teacherId ? 'Giáo viên phụ trách' : 'Cần cập nhật Xếp lịch'}</p></div></div>
                    <div>
                        <div class="late-status">
                            <span class="late-badge"><span>Hệ thống</span><strong>${entry.systemLateMinutes} phút</strong></span>
                            <span class="late-badge manual"><span>Tiếp tân</span><strong>${entry.manualLateMinutes} phút</strong></span>
                            <span class="late-badge effective"><span>Hiệu lực</span><strong>${entry.effectiveLateMinutes} phút</strong></span>
                        </div>
                        ${notes.length ? `<div class="observation-note-preview">${escapeHtml(notes.join(' / '))}</div>` : ''}
                    </div>
                    <button type="button" class="record-observation-btn" data-class-entry="${index}" ${!state.canOperate || !entry.teacherId ? 'disabled' : ''}>
                        <i data-lucide="clipboard-pen-line"></i>Ghi nhận
                    </button>
                </article>`;
        }).join('');
        list.querySelectorAll('[data-class-entry]').forEach(button => {
            button.addEventListener('click', () => openObservationModal(Number(button.dataset.classEntry)));
        });
        refreshIcons();
    }

    function stateHtml(icon, title, body) {
        return `<div class="oversight-state"><div><i data-lucide="${icon}"></i><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div></div>`;
    }

    function openObservationModal(index) {
        const entry = state.classEntries[index];
        if (!entry || !state.canOperate || !entry.teacherId) return;
        state.selectedClass = entry;
        document.getElementById('observation-modal-title').textContent = `Ghi nhận cho ${entry.teacherName}`;
        document.getElementById('observation-modal-subtitle').textContent = `${entry.className}, ${entry.start} - ${entry.end}, ${state.branch.toUpperCase()}`;
        document.getElementById('modal-system-late').textContent = `${entry.systemLateMinutes} phút`;
        document.getElementById('observation-late-minutes').value = entry.manualLateMinutes || 0;
        document.getElementById('observation-note').value = '';
        document.getElementById('observation-form-error').classList.remove('visible');
        updateEffectivePreview();
        const modal = document.getElementById('observation-modal');
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        setTimeout(() => document.getElementById('observation-late-minutes').focus(), 50);
        refreshIcons();
    }

    function closeObservationModal() {
        const modal = document.getElementById('observation-modal');
        if (!modal?.classList.contains('open')) return;
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        state.selectedClass = null;
    }

    function updateEffectivePreview() {
        if (!state.selectedClass) return;
        const manual = Math.max(0, Math.round(Number(document.getElementById('observation-late-minutes').value) || 0));
        document.getElementById('modal-effective-late').textContent = `${Math.max(state.selectedClass.systemLateMinutes, manual)} phút`;
    }

    async function submitObservation(event) {
        event.preventDefault();
        const entry = state.selectedClass;
        if (!entry) return;
        const lateMinutes = Math.max(0, Math.round(Number(document.getElementById('observation-late-minutes').value) || 0));
        const note = document.getElementById('observation-note').value.trim();
        const errorBox = document.getElementById('observation-form-error');
        if (lateMinutes === 0 && !note) {
            errorBox.textContent = 'Vui lòng nhập số phút trễ hoặc nội dung ghi chú.';
            errorBox.classList.add('visible');
            return;
        }
        const button = document.getElementById('save-observation-btn');
        button.disabled = true;
        errorBox.classList.remove('visible');
        try {
            await ensureObservationAccess();
            await DBService.createShiftObservation({
                dateKey: state.dateKey,
                branch: state.branch,
                shiftKey: state.shiftKey,
                scheduleCompositeKey: entry.scheduleCompositeKey,
                classSectionKey: entry.sectionKey,
                classIndex: entry.classIndex,
                classStart: entry.start,
                classEnd: entry.end,
                className: entry.className,
                subjectId: entry.subjectId,
                teacherId: entry.teacherId,
                teacherName: entry.teacherName,
                lateMinutes,
                systemLateAtCreation: entry.systemLateMinutes,
                note
            });
            closeObservationModal();
            toast('Đã lưu ghi nhận và cập nhật chip bảng công.', 'success');
            await loadReceptionistView();
        } catch (error) {
            errorBox.textContent = error.message || 'Không thể lưu ghi nhận.';
            errorBox.classList.add('visible');
        } finally {
            button.disabled = false;
        }
    }

    function initAdminPage() {
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        document.getElementById('log-from-date').value = localDateKey(monthStart);
        document.getElementById('log-to-date').value = localDateKey(today);
        document.getElementById('log-filter-btn').addEventListener('click', loadAdminLog);
        document.getElementById('log-refresh-btn').addEventListener('click', loadAdminLog);
        document.getElementById('log-search').addEventListener('input', renderAdminLog);
        document.getElementById('log-branch').addEventListener('change', renderAdminLog);
        document.getElementById('log-shift').addEventListener('change', renderAdminLog);
        loadAdminLog();
    }

    async function loadAdminLog() {
        const from = document.getElementById('log-from-date').value;
        const to = document.getElementById('log-to-date').value;
        const container = document.getElementById('admin-log-list');
        if (!from || !to || from > to) {
            toast('Khoảng ngày không hợp lệ.', 'error');
            return;
        }
        renderLoading(container, 4);
        try {
            state.adminRecords = await DBService.getShiftObservationsByRange(from, to);
            renderAdminLog();
        } catch (error) {
            container.innerHTML = stateHtml('circle-alert', 'Không tải được nhật ký', error.message || 'Vui lòng thử lại.');
            refreshIcons();
        }
    }

    function renderAdminLog() {
        const branch = document.getElementById('log-branch').value;
        const shift = document.getElementById('log-shift').value;
        const keyword = document.getElementById('log-search').value.trim().toLocaleLowerCase('vi');
        const records = state.adminRecords.filter(item => {
            if (branch !== 'all' && item.branch !== branch) return false;
            if (shift !== 'all' && item.shiftKey !== shift) return false;
            if (!keyword) return true;
            return [item.teacherName, item.createdByName, item.note, item.className]
                .some(value => String(value || '').toLocaleLowerCase('vi').includes(keyword));
        });

        const active = records.filter(item => item.status !== 'cancelled');
        document.getElementById('summary-active').textContent = active.filter(item => Number(item.lateMinutes) > 0).length;
        document.getElementById('summary-notes').textContent = active.filter(item => String(item.note || '').trim()).length;
        document.getElementById('summary-minutes').textContent = active.reduce((sum, item) => sum + (Number(item.lateMinutes) || 0), 0);
        document.getElementById('log-result-label').textContent = `${records.length} ghi nhận trong khoảng đã chọn`;

        const container = document.getElementById('admin-log-list');
        if (records.length === 0) {
            container.innerHTML = stateHtml('clipboard-check', 'Chưa có ghi nhận phù hợp', 'Hãy đổi bộ lọc hoặc mở rộng khoảng ngày.');
            refreshIcons();
            return;
        }

        const grouped = records.reduce((result, item) => {
            if (!result[item.dateKey]) result[item.dateKey] = [];
            result[item.dateKey].push(item);
            return result;
        }, {});
        container.innerHTML = Object.keys(grouped).sort().reverse().map(dateKey => {
            const items = grouped[dateKey];
            const dateLabel = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
                .format(toLocalDate(dateKey, '12:00'));
            return `
                <section class="log-day-group">
                    <header class="log-day-header"><h3>${escapeHtml(dateLabel)}</h3><span>${items.length} ghi nhận</span></header>
                    <div>${items.map(renderLogRow).join('')}</div>
                </section>`;
        }).join('');

        container.querySelectorAll('[data-cancel-observation]').forEach(button => {
            button.addEventListener('click', () => cancelObservation(button.dataset.cancelObservation));
        });
        refreshIcons();
    }

    function renderLogRow(item) {
        const cancelled = item.status === 'cancelled';
        const createdAt = formatTimestamp(item.createdAt);
        const effective = Math.max(Number(item.systemLateAtCreation) || 0, Number(item.lateMinutes) || 0);
        return `
            <div class="log-row ${cancelled ? 'is-cancelled' : ''}">
                <div class="log-main"><span class="log-cell-label">Ca</span><strong>${escapeHtml(item.classStart)} - ${escapeHtml(item.classEnd)}</strong><span>${escapeHtml((item.branch || '').toUpperCase())}, ca ${escapeHtml(SHIFT_LABELS[item.shiftKey] || item.shiftKey)}</span></div>
                <div class="log-main"><span class="log-cell-label">Lớp / giáo viên</span><strong>${escapeHtml(item.teacherName || 'Không rõ')}</strong><span>${escapeHtml(item.className || 'Lớp chưa đặt tên')}</span></div>
                <div class="log-main"><span class="log-cell-label">Người tạo</span><strong>${escapeHtml(item.createdByName || 'Không rõ')}</strong><span>${escapeHtml(createdAt)}</span></div>
                <div class="log-note"><span class="log-cell-label">Nội dung</span>${item.note ? `<strong>${escapeHtml(item.note)}</strong>` : 'Không có ghi chú'}<div class="log-command"><span>Hệ thống ${Number(item.systemLateAtCreation) || 0}p, lệnh ${Number(item.lateMinutes) || 0}p</span><strong>Hiệu lực ${effective} phút</strong></div></div>
                <div><span class="log-cell-label">Trạng thái</span><span class="log-status ${cancelled ? 'cancelled' : ''}">${cancelled ? 'Đã hủy' : 'Đang áp dụng'}</span></div>
                <div>${cancelled ? '' : `<button type="button" class="cancel-log-btn" data-cancel-observation="${escapeHtml(item.id)}">Hủy lệnh</button>`}</div>
            </div>`;
    }

    function formatTimestamp(value) {
        const date = safeDate(value);
        if (!date) return 'Đang đồng bộ thời gian';
        return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    }

    async function cancelObservation(id) {
        const item = state.adminRecords.find(record => record.id === id);
        if (!item) return;
        const confirmed = window.UIService?.confirm
            ? await window.UIService.confirm(`Hủy lệnh của ${escapeHtml(item.createdByName || 'tiếp tân')} cho ${escapeHtml(item.teacherName || 'giáo viên')}? Dữ liệu vẫn được giữ trong nhật ký.`)
            : window.confirm('Hủy lệnh này?');
        if (!confirmed) return;
        try {
            await DBService.cancelShiftObservation(id, 'Hủy từ trang nhật ký quản trị');
            toast('Đã hủy lệnh. Nhật ký vẫn được giữ để đối soát.', 'success');
            await loadAdminLog();
        } catch (error) {
            toast(error.message || 'Không thể hủy lệnh.', 'error');
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
