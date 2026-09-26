// Timekeeping Logic

window.__TDT_TIMEKEEPING_BOOTSTRAP_STARTED__ = true;
function signalTimekeepingBootstrapReady() {
    if (window.__TDT_TIMEKEEPING_BOOTSTRAP_READY__) return;
    window.__TDT_TIMEKEEPING_BOOTSTRAP_READY__ = true;
    if (typeof window.dispatchEvent === 'function' && typeof Event === 'function') {
        window.dispatchEvent(new Event('tdt:timekeeping-ready'));
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const authUser = typeof window.waitAuth === 'function'
            ? await window.waitAuth()
            : (window.auth?.currentUser || null);
        if (!authUser) return;
        // Only initialize if we are on the timekeeping page
        if (document.getElementById('timekeeping-container')) {
            await initTimekeeping();
            signalTimekeepingBootstrapReady();
            updateClock();
            setInterval(updateClock, 1000);
            setInterval(refreshCheckinElapsed, 30000);
        }
    } catch (error) {
        console.error('Timekeeping initialization failed:', error);
        const container = document.getElementById('global-checkin-container');
        if (container) {
            container.innerHTML = `
                <div class="glass-panel" style="padding:1.25rem;text-align:center;color:#92400E;">
                    <p style="margin:0 0 0.9rem;font-weight:600;">Chưa thể mở chấm công. Vui lòng kiểm tra kết nối rồi tải lại trang.</p>
                    <button type="button" class="btn btn-primary" onclick="window.location.reload()">Tải lại</button>
                </div>
            `;
        }
        signalTimekeepingBootstrapReady();
    }
});

async function initTimekeeping() {
    try {
        const settings = await DBService.getSystemSettings();
        window.centerClosures = settings?.centerClosures || {};
    } catch (e) {
        console.warn("Error loading system settings:", e);
        window.centerClosures = {};
    }
    await renderGlobalCheckIn();
    await Promise.all([
        renderTodayChips({ fresh: true }),
        renderTodayClasses({ fresh: true })
    ]);
    timekeepingLastResumeRefreshAt = Date.now();

    // Run global auto-checkout check once immediately
    if (typeof globalCheckAutoCheckout === 'function') {
        globalCheckAutoCheckout();
    }
}

function getLocalDateKey(date) {
    // All attendance documents are anchored to Vietnam time, regardless of the
    // timezone configured on an admin laptop or a staff phone.
    if (typeof getLocalDateKeyFromDate === 'function') return getLocalDateKeyFromDate(date);
    const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    return `${vnTime.getUTCFullYear()}-${String(vnTime.getUTCMonth() + 1).padStart(2, '0')}-${String(vnTime.getUTCDate()).padStart(2, '0')}`;
}

function timekeepingEscapeHTML(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getAttendanceSessions(record) {
    if (!record) return [];
    if (Array.isArray(record.sessions)) return record.sessions;
    return record.checkIn
        ? [{ id: 'legacy', checkIn: record.checkIn, start: record.checkIn, checkOut: record.checkOut || null }]
        : [];
}

let todayTeachingScheduleRead = null;
function loadTodayTeachingSchedules(dateKey, options = {}) {
    const fresh = options.fresh === true;
    const key = `${dateKey}:${fresh ? 'server' : 'default'}`;
    if (todayTeachingScheduleRead?.key === key && Date.now() - todayTeachingScheduleRead.startedAt < 2000) {
        return todayTeachingScheduleRead.promise;
    }
    const readOptions = fresh ? { source: 'server', readCache: new Map() } : {};
    const promise = Promise.all(['cs1', 'cs2', 'cs3'].map(branch => {
        const compositeKey = `${branch}__${dateKey}`;
        return DBService.getSchedule(compositeKey, readOptions)
            .then(data => ({ data: data || {}, schedule: data || {}, branch, compositeKey }));
    }));
    todayTeachingScheduleRead = { key, startedAt: Date.now(), promise };
    promise.catch(() => {
        if (todayTeachingScheduleRead?.promise === promise) todayTeachingScheduleRead = null;
    });
    return promise;
}

function isCenterClosed(dateStr, shiftKey, centerClosures) {
    if (!centerClosures || !centerClosures[dateStr]) return false;
    const closures = centerClosures[dateStr];
    return closures.includes('all') || closures.includes(shiftKey);
}

// 1. Global Check-in Rendering
let attendanceRenderGeneration = 0;
// "Đã làm 1 giờ 25 phút" trên thẻ đang trong ca; cập nhật mỗi 30 giây bằng refreshCheckinElapsed.
function formatCheckinElapsed(since, now = new Date()) {
    const minutes = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60000));
    if (!Number.isFinite(minutes)) return '--';
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours} giờ ${String(minutes % 60).padStart(2, '0')} phút` : `${minutes} phút`;
}
async function renderGlobalCheckIn(options = {}) {
    const container = document.getElementById('global-checkin-container');
    if (!container) return;
    const renderGeneration = ++attendanceRenderGeneration;

    const currentUserId = localStorage.getItem('currentUserId');
    if (!currentUserId) {
        container.innerHTML = '<p class="text-muted">Vui lòng đăng nhập để chấm công</p>';
        return;
    }

    // Loading state
    container.innerHTML = '<div class="tk-hero"><span class="tk-hero-status tk-hero-status--idle">Đang tải trạng thái…</span><button class="btn tk-action tk-action--in" disabled>Đang tải...</button></div>';

    // Look up Cloud Data
    const now = new Date();
    const dateKey = getLocalDateKey(now);
    const previousDateKey = getLocalDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

    try {
        // Rendering may also be requested by dashboard refreshes before startup
        // has finished. Never show an enabled action for stale local identity.
        if (typeof window.waitAuth === 'function') await window.waitAuth();
        const authorization = await DBService.getAuthenticatedAuthorizationContext(true);
        const isCurrentRender = () => renderGeneration === attendanceRenderGeneration &&
            localStorage.getItem('currentUserId') === currentUserId &&
            window.auth?.currentUser?.uid === authorization.uid;
        if (authorization.userId !== currentUserId) {
            const mismatch = new Error('Phiên đăng nhập không khớp hồ sơ nhân sự. Vui lòng đăng nhập lại.');
            mismatch.code = 'auth/session-changed';
            throw mismatch;
        }
        const [attendanceRecord, previousAttendanceRecord] = await Promise.all([
            DBService.getPersonalAttendance(dateKey, currentUserId),
            previousDateKey === dateKey
                ? Promise.resolve(null)
                : DBService.getPersonalAttendance(previousDateKey, currentUserId)
        ]);
        if (!isCurrentRender()) return;

        // Logic: If record exists AND has checkIn but NO checkOut -> Active Session
        let isActiveSession = false;
        let lastCheckInTime = null;
        let sessions = getAttendanceSessions(attendanceRecord);

        // Support backward compatibility (single field) if needed, but we just overwrote it
        const previousSessions = getAttendanceSessions(previousAttendanceRecord);
        const openSession = [...sessions, ...previousSessions]
            .filter(s => !s.checkOut && !s.isAbsent && (s.checkIn || s.start))
            .sort((a, b) => new Date(b.checkIn || b.start) - new Date(a.checkIn || a.start))[0];

        if (openSession) {
            isActiveSession = true;
            lastCheckInTime = new Date(openSession.checkIn || openSession.start);
        }

        if (isActiveSession) {
            const timeStr = lastCheckInTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const overnightText = getLocalDateKey(lastCheckInTime) !== dateKey
                ? '<div class="tk-hero-note">Ca bắt đầu từ ngày hôm trước</div>'
                : '';
            container.innerHTML = `
                <div class="tk-hero tk-hero--active">
                    <span class="tk-hero-status"><span class="tk-dot"></span>ĐANG TRONG CA</span>
                    ${overnightText}
                    <div class="tk-hero-grid">
                        <div><span class="tk-label">Giờ vào</span><strong class="tk-value">${timeStr}</strong></div>
                        <div><span class="tk-label">Đã làm</span><strong class="tk-value tk-elapsed" data-since="${lastCheckInTime.toISOString()}">${formatCheckinElapsed(lastCheckInTime)}</strong></div>
                    </div>
                    <button class="btn tk-action tk-action--out" onclick="globalCheckOut(this)">RA CA</button>
                </div>
            `;
        } else {
            // Check previous sessions
            let title = "BẮT ĐẦU CA LÀM VIỆC";
            let sub = "Vui lòng bấm vào đây khi bạn đến trung tâm";

            if (sessions.length > 0) {
                title = "BẮT ĐẦU CA MỚI";
                sub = "Bạn đã kết thúc ca trước đó. Bấm để bắt đầu ca tiếp theo.";
            }

            container.innerHTML = `
                <div class="tk-hero">
                    <span class="tk-hero-status tk-hero-status--idle">Chưa vào ca</span>
                    <h2 class="tk-hero-title">${title}</h2>
                    <p class="tk-hero-sub">${sub}</p>
                    <button class="btn btn-primary tk-action tk-action--in" onclick="globalCheckIn(this)">VÀO CA</button>
                    <p class="checkin-permission-hint">Nếu điện thoại hỏi quyền, hãy chọn <strong>Cho phép</strong>.</p>
                </div>
            `;
        }

        // Mở lại app sau giờ tan ca: kiểm tra ca quá giờ ở NỀN rồi vẽ lại, không bắt khung
        // chấm công chờ đọc lịch 3 cơ sở. Bấm RA CA/VÀO CA trong lúc chờ vẫn an toàn vì
        // globalCheckOut/globalCheckIn tự khép ca quá giờ đúng mốc tan ca trước khi ghi.
        if (openSession && !options.skipOverdueCheck && typeof globalCheckAutoCheckout === 'function') {
            globalCheckAutoCheckout({ refreshUi: false })
                .then(async closed => {
                    if (!closed || !isCurrentRender()) return;
                    await renderGlobalCheckIn({ skipOverdueCheck: true });
                    if (typeof renderTodayChips === 'function') renderTodayChips();
                })
                .catch(error => console.warn('[Attendance] Overdue shift check failed:', error?.code || error));
        }
    } catch (e) {
        if (renderGeneration !== attendanceRenderGeneration ||
            localStorage.getItem('currentUserId') !== currentUserId) return;
        console.error(e);
        const message = typeof getStaffAttendanceErrorMessage === 'function'
            ? getStaffAttendanceErrorMessage(e)
            : 'Chưa thể tải trạng thái chấm công. Vui lòng kiểm tra kết nối rồi thử lại.';
        container.innerHTML = `
            <div class="tk-hero">
                <p id="attendance-load-error" class="tk-hero-error"></p>
                <button type="button" class="btn btn-primary tk-action" onclick="renderGlobalCheckIn()">Tải lại</button>
            </div>
        `;
        const errorText = container.querySelector('#attendance-load-error');
        if (errorText) errorText.textContent = message;
    }

    // Call history render separate
    fetchAndRenderHistory(dateKey, currentUserId);
}

function refreshCheckinElapsed() {
    document.querySelectorAll('.tk-elapsed[data-since]').forEach(el => {
        el.textContent = formatCheckinElapsed(el.dataset.since);
    });
}

// 2. Render History
async function fetchAndRenderHistory(dateKey, userId) {
    const historyContainer = document.getElementById('attendance-history-list');
    if (!historyContainer) return;

    try {
        const record = await DBService.getPersonalAttendance(dateKey, userId);
        const sessions = getAttendanceSessions(record);

        if (sessions.length === 0) {
            historyContainer.innerHTML = '<p class="tk-history-empty">Chưa có lượt vào/ra nào hôm nay.</p>';
        } else {
            const fmt = value => new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            // Mới nhất lên đầu
            historyContainer.innerHTML = '<ul class="tk-history">' + [...sessions].reverse().map(session => {
                const inTime = fmt(session.checkIn || session.start);
                const outTime = session.checkOut ? fmt(session.checkOut) : '...';
                const status = session.isAbsent
                    ? '<span class="tk-status tk-status--absent">Vắng</span>'
                    : (session.checkOut
                        ? '<span class="tk-status tk-status--done">Đã kết thúc</span>'
                        : '<span class="tk-status tk-status--live">Đang trong ca</span>');
                return `<li><span class="tk-history-time">${inTime} <span>–</span> ${outTime}</span>${status}</li>`;
            }).join('') + '</ul>';
        }

    } catch (e) { console.error(e); }
}

window.handleDeleteSession = async function (dateKey, sessionId) {
    if (!confirm("Bạn có chắc chắn muốn xóa lượt chấm công này không?")) return;

    const currentUserId = localStorage.getItem('currentUserId');
    try {
        await DBService.deleteSession(currentUserId, dateKey, sessionId);
        // Refresh UI
        renderGlobalCheckIn();
    } catch (e) {
        alert("Lỗi xóa: " + e.message);
    }
}

async function renderTodayClasses(options = {}) {
    const container = document.getElementById('class-list-container');
    if (!container) return;

    const today = new Date();
    const dateKey = getLocalDateKey(today);
    const currentUserId = localStorage.getItem('currentUserId');

    return loadTodayTeachingSchedules(dateKey, options).then(results => {
        let classes = [];
        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];

        results.forEach(({ data: todaySchedule, branch, compositeKey }) => {
            sections.forEach(sec => {
                if (todaySchedule[sec]) {
                    todaySchedule[sec].forEach((cls, idx) => {
                        // isAssignedToClass: GV chính (mọi người trong gvList) + GV thay thế +
                        // tự nhận lớp. Thiếu nhánh thay thế thì GV dạy thay không thấy lớp nào.
                        const isRegistered = isAssignedToClass(cls, currentUserId);
                        if (!isRegistered) return;
                        classes.push({
                            ...cls,
                            section: sec,
                            index: idx,
                            id: `${dateKey}-${sec}-${idx}`,
                            _branch: branch,
                            _compositeKey: compositeKey,
                            _dateKey: dateKey
                        });
                    });
                }
            });
        });

        if (classes.length === 0) {
            container.innerHTML = `
                <div class="tk-empty">
                    <p>Bạn chưa nhận lớp nào hôm nay.</p>
                    <p style="margin-top:0.35rem;">Vào <strong>Lịch Làm</strong> để nhận lớp.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        classes.sort((a, b) => a.start.localeCompare(b.start));

        classes.forEach(cls => {
            const card = createClassCard(cls, cls._compositeKey);
            container.appendChild(card);
        });
    }).catch(error => {
        console.error('Error loading today classes:', error);
        container.innerHTML = `
            <div class="tk-empty">
                <p style="margin:0 0 0.75rem;color:#93370D;">Chưa tải được lịch mới nhất.</p>
                <button type="button" class="btn btn-primary" onclick="renderTodayClasses({ fresh: true })">Tải lại lịch</button>
            </div>`;
    });
}

function createClassCard(cls, compositeKey) {
    const el = document.createElement('div');
    el.className = 'glass-panel class-card tk-class';

    const isSectionClosed = isCenterClosed(cls._dateKey, cls.section, window.centerClosures);
    const isClassClosed = cls.isClosed === true;
    const isClosed = isSectionClosed || isClassClosed;
    if (isClosed) el.classList.add(isClassClosed ? 'is-cancelled' : 'is-closed');

    const currentUserId = localStorage.getItem('currentUserId');
    const registeredTeachers = cls.registeredTeachers || [];
    const isScheduledMain = isScheduledMainTeacher(cls, currentUserId);
    const isScheduledSubstitute = window.isScheduledSubstitute
        ? window.isScheduledSubstitute(cls, currentUserId)
        : getScheduledSubstituteIds(cls).has(currentUserId);
    const isSelfRegistered = registeredTeachers.some(item => item.id === currentUserId);
    const absenceRecord = getTeacherAbsenceRecord(cls, currentUserId);
    const isDeclaredAbsent = isScheduledMain && isMainTeacherAbsentFromClass(cls, currentUserId);

    // Branch badge
    const branchKey = ['cs1', 'cs2', 'cs3'].includes(cls._branch) ? cls._branch : 'cs1';
    const branchBadge = `<span class="tk-branch tk-branch--${branchKey}">${timekeepingEscapeHTML(branchKey.toUpperCase())}</span>`;
    const icon = (name, size = 16) => (typeof window.tdtIcon === 'function' ? window.tdtIcon(name, size) : '');

    let statusBadge = '<span class="tk-pill tk-pill--none">Chưa nhận</span>';
    let actionBtn = `<button class="btn btn-primary" onclick="registerClass('${compositeKey}', '${cls.section}', ${cls.index}, this, '${cls.end}')">Nhận Lớp</button>`;

    if (isClosed) {
        if (isClassClosed) {
            statusBadge = '<span class="tk-pill tk-pill--closed">Lớp nghỉ</span>';
            actionBtn = '<span class="tk-class-note">Lớp đã bị Admin tắt</span>';
        } else {
            statusBadge = '<span class="tk-pill tk-pill--center">Lịch nghỉ trung tâm</span>';
            actionBtn = '<span class="tk-class-note">Lớp đã bị tắt do trung tâm nghỉ</span>';
        }
    } else if (isDeclaredAbsent) {
        const isVP = String(absenceRecord?.type || '').toUpperCase() === 'VP';
        const typeLabel = isVP ? 'Vắng có phép' : 'Vắng đột xuất';
        const replacementIds = window.TeacherShiftState
            ? TeacherShiftState.getReplacementIdsForTeacher(cls, currentUserId)
            : (absenceRecord?.replacementIds || []);
        statusBadge = `<span class="tk-pill ${isVP ? 'tk-pill--vp' : 'tk-pill--vdx'}">${typeLabel}</span>`;
        actionBtn = `<span class="tk-class-note">${replacementIds.length ? 'Đã điều phối GV thay' : 'Đang chờ GV thay'}</span>`;
    } else if (isScheduledSubstitute) {
        statusBadge = '<span class="tk-pill tk-pill--sub">GV dạy thay</span>';
        actionBtn = '<span class="tk-class-note">Được người xếp lịch phân công</span>';
    } else if (isScheduledMain) {
        statusBadge = '<span class="tk-pill tk-pill--main">GV chính</span>';
        actionBtn = '<span class="tk-class-note">Được người xếp lịch phân công</span>';
    } else if (isSelfRegistered) {
        statusBadge = '<span class="tk-pill tk-pill--self">Đã tự nhận lớp</span>';
        actionBtn = `<button class="btn btn-ghost" onclick="registerClass('${compositeKey}', '${cls.section}', ${cls.index}, this, '${cls.end}')">Hủy Nhận</button>`;
    }

    el.innerHTML = `
        <div class="tk-class-body">
            <h3 class="tk-class-title">${timekeepingEscapeHTML(cls.lop || 'Lớp chưa nhập tên')}${branchBadge}</h3>
            <div class="tk-class-meta">
                <span>${icon('clock')}${timekeepingEscapeHTML(cls.start)} – ${timekeepingEscapeHTML(cls.end)}</span>
                <span>${icon('door')}${timekeepingEscapeHTML(cls.phong || 'Chưa xếp phòng')}</span>
            </div>
            <div class="tk-class-people">
                 ${registeredTeachers.length > 0 ? `GV tự nhận: ${timekeepingEscapeHTML(registeredTeachers.map(t => t.name).join(', '))}` : 'Nhân sự theo lịch đã xếp'}
            </div>
        </div>
        <div class="tk-class-side">
            ${statusBadge}
            ${actionBtn}
        </div>
    `;

    return el;
}

// 4. Register Class Handler (compositeKey = 'cs1__2026-02-21' or plain dateKey)
window.registerClass = async function (compositeKey, section, index, btn, endTimeStr) {
    if (btn) btn.disabled = true;

    const currentUserId = localStorage.getItem('currentUserId');
    const userFullName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser');

    if (!currentUserId) {
        UIService.toast("Vui lòng đăng nhập lại!", "error");
        if (btn) btn.disabled = false;
        return;
    }

    // Time Validation — extract pure dateKey for Date parsing
    if (endTimeStr) {
        const pureDateKey = compositeKey.includes('__') ? compositeKey.split('__')[1] : compositeKey;
        const now = new Date();
        const classEnd = new Date(`${pureDateKey}T${endTimeStr}`);
        if (now > classEnd) {
            UIService.toast("Đã hết giờ học! Không thể nhận lớp khi ca dạy đã kết thúc.", "error");
            if (btn) btn.disabled = false;
            return;
        }
    }

    if (!await UIService.confirm('Xác nhận thay đổi trạng thái nhận lớp?')) {
        if (btn) btn.disabled = false;
        return;
    }

    try {
        const rowMeta = { index };
        const user = { id: currentUserId, name: userFullName };

        await DBService.registerClass(compositeKey, section, rowMeta, user);

        UIService.toast("Cập nhật thành công!", "success");
        todayTeachingScheduleRead = null;
        renderTodayClasses({ fresh: true });
        localStorage.setItem('schedule_registration_updated', Date.now().toString());
    } catch (e) {
        UIService.toast("Lỗi: " + e, "error");
        if (btn) btn.disabled = false;
    }
}

// === NEW: Render Chips Status for Today's Classes ===
async function renderTodayChips(options = {}) {
    const container = document.getElementById('chips-container');
    if (!container) return;

    const today = new Date();
    const dateKey = getLocalDateKey(today);
    const currentUserId = localStorage.getItem('currentUserId');
    const currentUserContext = {
        userId: currentUserId,
        role: localStorage.getItem('currentRole') || 'staff',
        roles: typeof parseRoles === 'function'
            ? parseRoles(localStorage.getItem('currentRole') || 'staff')
            : [localStorage.getItem('currentRole') || 'staff'],
        userName: localStorage.getItem('currentUserName') || 'Unknown'
    };

    const readOptions = options.fresh ? { source: 'server' } : {};

    return Promise.all([
        loadTodayTeachingSchedules(dateKey, options),
        DBService.getPersonalAttendance(dateKey, currentUserId, readOptions),
        DBService._getDashboardReceptionistShifts(currentUserId, dateKey),
        DBService.loadDailyEvaluationContext(currentUserId, dateKey)
    ]).then(([results, attendance, operationalShifts, evaluationContext]) => {
        try {
            // Merge all schedule data
            const mergedSchedule = {};
            const attendanceSessions = attendance?.sessions || [];
            const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];

            results.forEach(({ schedule, branch }) => {
                sections.forEach(sec => {
                    if (schedule[sec]) {
                        if (!mergedSchedule[sec]) mergedSchedule[sec] = [];
                        mergedSchedule[sec] = mergedSchedule[sec].concat(
                            schedule[sec].map(c => ({ ...c, _branch: branch }))
                        );
                    }
                });
            });

            // Calculate chips for today
            const chips = calculateDailyChips(
                mergedSchedule,
                attendanceSessions,
                currentUserId,
                dateKey,
                currentUserContext,
                operationalShifts || [],
                evaluationContext.overtimeMap || {},
                evaluationContext.cancelledShifts || [],
                evaluationContext.bonus10Map || {},
                evaluationContext.shiftObservations || [],
                evaluationContext.monthFlags || {}
            );

            if (chips.length === 0) {
                container.innerHTML = `
                    <div class="tk-empty">
                        <p>Không có lớp nào hôm nay</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = '';
            chips.forEach(chip => {
                const chipEl = document.createElement('div');
                chipEl.className = `schedule-chip ${chip.class}`;
                // Ký hiệu ⏱ (tăng ca) / ★ (+10p) trong nhãn → icon SVG lúc hiển thị (nhãn gốc giữ nguyên).
                let chipHtml = timekeepingEscapeHTML(chip.text);
                if (typeof window.tdtIcon === 'function') {
                    chipHtml = chipHtml.replace(/\u23F1\uFE0F?/g, window.tdtIcon('timer', 14)).replace(/\u2605/g, window.tdtIcon('star', 14));
                }
                chipEl.innerHTML = `<span>${chipHtml}</span>`;
                
                // Show tooltip on hover
                if (chip.tooltip) {
                    chipEl.title = chip.tooltip;
                }
                
                container.appendChild(chipEl);
            });
        } catch (e) {
            console.error('Error rendering chips:', e);
            container.innerHTML = `<div style="color: var(--text-muted);">Lỗi tải dữ liệu</div>`;
        }
    }).catch(e => {
        console.error('Error loading schedule data:', e);
        container.innerHTML = `<div style="color: var(--text-muted);">Lỗi tải dữ liệu</div>`;
    });
}

let timekeepingResumeRefresh = null;
let timekeepingLastResumeRefreshAt = 0;
async function refreshTimekeepingAfterResume() {
    if (!document.getElementById('timekeeping-container')) return;
    if (timekeepingResumeRefresh) return timekeepingResumeRefresh;
    if (Date.now() - timekeepingLastResumeRefreshAt < 5000) return;
    timekeepingLastResumeRefreshAt = Date.now();
    const dateKey = getLocalDateKey(new Date());
    todayTeachingScheduleRead = null;
    ['cs1', 'cs2', 'cs3'].forEach(branch => DBService._invalidate(`schedule_${branch}__${dateKey}`));
    const currentUserId = localStorage.getItem('currentUserId');
    if (currentUserId) DBService._invalidateAttendance(dateKey, currentUserId);
    timekeepingResumeRefresh = Promise.all([
        renderGlobalCheckIn({ skipOverdueCheck: true }),
        renderTodayChips({ fresh: true }),
        renderTodayClasses({ fresh: true })
    ]).finally(() => { timekeepingResumeRefresh = null; });
    return timekeepingResumeRefresh;
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshTimekeepingAfterResume();
});
window.addEventListener('pageshow', event => {
    if (event.persisted) refreshTimekeepingAfterResume();
});
window.addEventListener('online', refreshTimekeepingAfterResume);
