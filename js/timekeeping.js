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
    renderTodayChips();  // NEW: Show chip status for today's classes
    renderTodayClasses();

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

function isCenterClosed(dateStr, shiftKey, centerClosures) {
    if (!centerClosures || !centerClosures[dateStr]) return false;
    const closures = centerClosures[dateStr];
    return closures.includes('all') || closures.includes(shiftKey);
}

// 1. Global Check-in Rendering
async function renderGlobalCheckIn() {
    const container = document.getElementById('global-checkin-container');
    if (!container) return;

    const currentUserId = localStorage.getItem('currentUserId');
    if (!currentUserId) {
        container.innerHTML = '<p class="text-muted">Vui lòng đăng nhập để chấm công</p>';
        return;
    }

    // Loading state
    container.innerHTML = '<button class="btn btn-secondary" disabled>Đang tải...</button>';

    // Look up Cloud Data
    const now = new Date();
    const dateKey = getLocalDateKey(now);
    const previousDateKey = getLocalDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

    try {
        const [attendanceRecord, previousAttendanceRecord] = await Promise.all([
            DBService.getPersonalAttendance(dateKey, currentUserId),
            previousDateKey === dateKey
                ? Promise.resolve(null)
                : DBService.getPersonalAttendance(previousDateKey, currentUserId)
        ]);

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
                ? '<div style="font-size:0.82rem;color:#92400E;margin-bottom:0.75rem;font-weight:700;">Ca bắt đầu từ ngày hôm trước</div>'
                : '';
            container.innerHTML = `
                <div class="glass-panel" style="background: #ECFDF5; border: 2px solid var(--primary-color); padding: 2rem; text-align: center;">
                    <h2 style="color: var(--primary-color); font-weight: 700; margin-bottom: 0.5rem;">ĐANG TRONG CA</h2>
                    <div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem;">(Ca hiện tại)</div>
                    ${overnightText}
                    <p style="font-size: 1.5rem; margin-bottom: 1.5rem;">Giờ vào: <strong>${timeStr}</strong></p>
                    <button class="btn" style="background: #EF4444; color: white; padding: 1rem 3rem; font-size: 1.25rem;" onclick="globalCheckOut(this)">
                        RA CA
                    </button>
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
                <div class="glass-panel" style="padding: 2rem; text-align: center;">
                    <h2 style="color: var(--primary-color); font-weight: 700; margin-bottom: 0.5rem;">${title}</h2>
                    <p style="color: var(--text-muted); margin-bottom: 1.5rem;">${sub}</p>
                    <button class="btn btn-primary" style="padding: 1rem 3rem; font-size: 1.25rem; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);" onclick="globalCheckIn(this)">
                        VÀO CA
                    </button>
                </div>
            `;
        }
    } catch (e) {
        console.error(e);
        const message = typeof getStaffAttendanceErrorMessage === 'function'
            ? getStaffAttendanceErrorMessage(e)
            : 'Chưa thể tải trạng thái chấm công. Vui lòng kiểm tra kết nối rồi thử lại.';
        container.innerHTML = `
            <div class="glass-panel" style="padding:1.25rem;text-align:center;color:#92400E;">
                <p id="attendance-load-error" style="margin:0 0 0.9rem;font-weight:600;"></p>
                <button type="button" class="btn btn-primary" onclick="renderGlobalCheckIn()">Tải lại</button>
            </div>
        `;
        const errorText = container.querySelector('#attendance-load-error');
        if (errorText) errorText.textContent = message;
    }

    // Call history render separate
    fetchAndRenderHistory(dateKey, currentUserId);
}

// 2. Render History
async function fetchAndRenderHistory(dateKey, userId) {
    const historyContainer = document.getElementById('attendance-history-list');
    if (!historyContainer) return;

    try {
        const record = await DBService.getPersonalAttendance(dateKey, userId);
        const sessions = getAttendanceSessions(record);

        if (sessions.length === 0) {
            historyContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem; font-style: italic;">Chưa có dữ liệu chấm công hôm nay.</p>';
        } else {
            let html = '<table class="history-table"><thead><tr><th>Vào</th><th>Ra</th><th>Trạng thái</th></tr></thead><tbody>';
            // Show latest first
            [...sessions].reverse().forEach(session => {
                const inTime = new Date(session.checkIn || session.start).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                const outTime = session.checkOut
                    ? new Date(session.checkOut).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                    : '<span style="color: var(--primary-color); font-weight: bold;">---</span>';

                const status = session.isAbsent
                    ? '<span style="color:#BE123C;font-weight:700;">Vắng</span>'
                    : (session.checkOut
                        ? '<span style="color:#047857;font-weight:700;">Đã kết thúc</span>'
                        : '<span style="color:#1D4ED8;font-weight:700;">Đang trong ca</span>');
                html += `<tr><td>${inTime}</td><td>${outTime}</td><td>${status}</td></tr>`;
            });
            html += '</tbody></table>';
            historyContainer.innerHTML = html;
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

function renderTodayClasses() {
    const container = document.getElementById('class-list-container');
    if (!container) return;

    const today = new Date();
    const dateKey = getLocalDateKey(today);
    const currentUserId = localStorage.getItem('currentUserId');

    // Fetch from BOTH branches
    const BRANCHES = ['cs1', 'cs2', 'cs3'];
    const branchPromises = BRANCHES.map(branch => {
        const compositeKey = `${branch}__${dateKey}`;
        return DBService.getSchedule(compositeKey).then(data => ({ data: data || {}, branch, compositeKey }));
    });

    Promise.all(branchPromises).then(results => {
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
                <div style="text-align: center; color: var(--text-muted); padding: 3rem;">
                    <p>Bạn chưa nhận lớp nào hôm nay.</p>
                    <p style="font-size: 0.85rem; margin-top: 0.5rem;">Vào <strong>Lịch Làm</strong> để nhận lớp.</p>
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
    });
}

function createClassCard(cls, compositeKey) {
    const el = document.createElement('div');
    el.className = 'glass-panel class-card';
    el.style.marginBottom = '1.5rem';
    el.style.padding = '1.5rem';
    el.style.display = 'flex';
    el.style.justifyContent = 'space-between';
    el.style.alignItems = 'center';

    const isSectionClosed = isCenterClosed(cls._dateKey, cls.section, window.centerClosures);
    const isClassClosed = cls.isClosed === true;
    const isClosed = isSectionClosed || isClassClosed;
    
    if (isClosed) {
        el.style.borderLeft = isClassClosed ? '5px solid #EF4444' : '5px solid #9CA3AF';
        el.style.backgroundColor = isClassClosed ? '#FEF2F2' : '#F9FAFB';
    } else {
        el.style.borderLeft = '5px solid var(--primary-color)';
    }

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
    const branchLabel = cls._branch ? cls._branch.toUpperCase() : 'CS1';
    const branchColors = { cs1: { bg: '#F0FDF4', fg: '#059669' }, cs2: { bg: '#EFF6FF', fg: '#3B82F6' }, cs3: { bg: '#FEF3C7', fg: '#D97706' } };
    const bColor = branchColors[cls._branch] || branchColors.cs1;
    const branchBadge = `<span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:0.7rem; font-weight:700; background:${bColor.bg}; color:${bColor.fg}; margin-left:0.5rem;">${branchLabel}</span>`;

    let statusBadge = '<span style="color: var(--text-muted);">Chưa nhận</span>';
    let actionBtn = `<button class="btn btn-primary" onclick="registerClass('${compositeKey}', '${cls.section}', ${cls.index}, this, '${cls.end}')">Nhận Lớp</button>`;

    if (isClosed) {
        if (isClassClosed) {
            statusBadge = '<span style="color: #EF4444; font-weight: bold;">Lớp nghỉ</span>';
            actionBtn = '<span style="color: #EF4444; font-size: 0.875rem; font-weight: 500;">Lớp đã bị Admin tắt</span>';
        } else {
            statusBadge = '<span style="color: #9CA3AF; font-weight: bold;">Lịch nghỉ trung tâm</span>';
            actionBtn = '<span style="color: #9CA3AF; font-size: 0.875rem;">Lớp đã bị tắt do trung tâm nghỉ</span>';
        }
    } else if (isDeclaredAbsent) {
        const typeLabel = String(absenceRecord?.type || '').toUpperCase() === 'VP' ? 'Vắng có phép' : 'Vắng đột xuất';
        const replacementIds = window.TeacherShiftState
            ? TeacherShiftState.getReplacementIdsForTeacher(cls, currentUserId)
            : (absenceRecord?.replacementIds || []);
        statusBadge = `<span style="color:${absenceRecord?.type === 'VP' ? '#1D4ED8' : '#BE123C'};font-weight:800;">${typeLabel}</span>`;
        actionBtn = `<span style="color:#6B7280;font-size:0.78rem;">${replacementIds.length ? 'Đã điều phối GV thay' : 'Đang chờ GV thay'}</span>`;
    } else if (isScheduledSubstitute) {
        statusBadge = '<span style="color:#B45309;font-weight:800;">GV dạy thay</span>';
        actionBtn = '<span style="color:#6B7280;font-size:0.78rem;">Được người xếp lịch phân công</span>';
    } else if (isScheduledMain) {
        statusBadge = '<span style="color:#047857;font-weight:800;">GV chính</span>';
        actionBtn = '<span style="color:#6B7280;font-size:0.78rem;">Được người xếp lịch phân công</span>';
    } else if (isSelfRegistered) {
        statusBadge = '<span style="color: var(--secondary-color); font-weight: bold;">Đã tự nhận lớp</span>';
        actionBtn = `<button class="btn btn-secondary" onclick="registerClass('${compositeKey}', '${cls.section}', ${cls.index}, this, '${cls.end}')">Hủy Nhận</button>`;
    }

    el.innerHTML = `
        <div>
            <h3 style="font-size: 1.25rem; font-weight: 700;">${timekeepingEscapeHTML(cls.lop || 'Lớp chưa nhập tên')}${branchBadge}</h3>
            <div style="color: var(--text-muted); margin-top: 0.25rem;">
                <span style="display:inline-block; margin-right: 1rem;">🕒 ${timekeepingEscapeHTML(cls.start)} - ${timekeepingEscapeHTML(cls.end)}</span>
                <span>🚪 ${timekeepingEscapeHTML(cls.phong || 'Chưa xếp phòng')}</span>
            </div>
            <div style="margin-top: 0.5rem; font-size: 0.875rem;">
                 ${registeredTeachers.length > 0 ? `GV tự nhận: ${timekeepingEscapeHTML(registeredTeachers.map(t => t.name).join(', '))}` : 'Nhân sự theo lịch đã xếp'}
            </div>
        </div>
        <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem;">
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
        renderTodayClasses();
        localStorage.setItem('schedule_registration_updated', Date.now().toString());
    } catch (e) {
        UIService.toast("Lỗi: " + e, "error");
        if (btn) btn.disabled = false;
    }
}

// === NEW: Render Chips Status for Today's Classes ===
function renderTodayChips() {
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

    const BRANCHES = ['cs1', 'cs2', 'cs3'];
    const branchPromises = BRANCHES.map(branch => {
        const compositeKey = `${branch}__${dateKey}`;
        return DBService.getSchedule(compositeKey).then(schedule => ({
            schedule: schedule || {},
            branch,
            compositeKey
        }));
    });

    Promise.all([
        Promise.all(branchPromises),
        DBService.getPersonalAttendance(dateKey, currentUserId),
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
                    <div style="text-align: center; color: var(--text-muted); padding: 1.5rem; background: #f9fafb; border-radius: 8px;">
                        <p style="font-size: 0.9rem;">Không có lớp nào hôm nay</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = '';
            chips.forEach(chip => {
                const chipEl = document.createElement('div');
                chipEl.className = `schedule-chip ${chip.class}`;
                chipEl.style.cssText = `
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 0.75rem;
                    padding: 0.75rem 1rem;
                    border-radius: 8px;
                `;
                chipEl.innerHTML = `<span>${timekeepingEscapeHTML(chip.text)}</span>`;
                
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
