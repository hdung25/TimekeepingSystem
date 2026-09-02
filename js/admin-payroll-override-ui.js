// Admin payroll-allocation editor used by the Bảng Công popup.
// The pure calculation/validation contract lives in admin-payroll-override.js;
// this file only turns Admin choices into that versioned payload.
(function (root) {
    'use strict';

    const state = {
        visible: false,
        dateKey: '',
        session: null,
        chip: null,
        user: null,
        subjects: [],
        allocations: []
    };

    const operationalRoles = new Set([
        'tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant',
        'receptionist_lead', 'receptionist_staff', 'van-phong', 'van_phong',
        'office', 'office_staff'
    ]);

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function toLocalInput(value, fallbackDateKey) {
        if (!value) return '';
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value))) return String(value);
        if (/^\d{2}:\d{2}$/.test(String(value)) && fallbackDateKey) return `${fallbackDateKey}T${value}`;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hour}:${minute}`;
    }

    function rateForSubject(subjectId) {
        const configRoles = state.user?.salary_config?.roles || [];
        const configured = configRoles.find(role => String(role?.id || '') === String(subjectId));
        if (configured && Number.isFinite(Number(configured.rate))) return Number(configured.rate);
        const subject = state.subjects.find(item => String(item?.id || '') === String(subjectId));
        if (subject && Number.isFinite(Number(subject.rate))) return Number(subject.rate);
        return Number(state.user?.salary_config?.attendance_rate || 0);
    }

    function allSubjectOptions() {
        const byId = new Map();
        (state.user?.salary_config?.roles || []).forEach(role => {
            if (!role?.id) return;
            byId.set(String(role.id), {
                id: String(role.id),
                name: String(role.name || role.id),
                rate: Number(role.rate || 0)
            });
        });
        state.subjects.filter(subject => subject && subject.isGroup !== true && subject.id).forEach(subject => {
            const id = String(subject.id);
            if (!byId.has(id)) {
                byId.set(id, { id, name: String(subject.name || id), rate: rateForSubject(id) });
            }
        });
        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    }

    function kindFromChip(chip, session) {
        if (chip?.isOffice) return 'office';
        if (chip?.isReceptionist) return 'receptionist';
        if (chip?.isTeaching) return 'teaching';
        const role = String(session?.role || '').toLowerCase();
        if (['van-phong', 'van_phong', 'office', 'office_staff'].includes(role)) return 'office';
        if (operationalRoles.has(role)) return 'receptionist';
        return 'teaching';
    }

    function employeeSupportsKind(user, kind) {
        const roles = (Array.isArray(user?.roles) && user.roles.length ? user.roles : [user?.role])
            .map(role => String(role || '').trim().toLowerCase())
            .filter(Boolean);
        if (kind === 'receptionist') {
            return roles.some(role => [
                'receptionist', 'receptionist_assistant', 'receptionist_lead',
                'receptionist_staff', 'senior_assistant', 'tiep-tan', 'tiep_tan'
            ].includes(role));
        }
        if (kind === 'office') {
            return roles.some(role => ['office', 'office_staff', 'van-phong', 'van_phong'].includes(role));
        }
        if (kind === 'teaching') {
            return (user?.salary_config?.roles || []).length > 0 || roles.some(role => [
                'assistant', 'teaching_assistant', 'staff', 'teacher', 'giao-vien',
                'gv', 'tro-giang', 'tutor'
            ].includes(role));
        }
        return false;
    }

    function scheduleRefKind(scheduleRef) {
        if (!scheduleRef || typeof scheduleRef !== 'object') return '';
        const raw = String(scheduleRef.type || scheduleRef.kind || scheduleRef.scheduleType || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\s_]+/g, '-');
        if (['teaching', 'teacher', 'giao-vien', 'day'].includes(raw)) return 'teaching';
        if (['receptionist', 'reception', 'tiep-tan'].includes(raw)) return 'receptionist';
        if (['office', 'office-staff', 'van-phong'].includes(raw)) return 'office';
        return '';
    }

    // A schedule locator is evidence for one kind only. Reusing a teaching
    // locator after Admin changes the row to receptionist/office (or vice versa)
    // makes the persisted override fail validation and can bind payroll to the
    // wrong schedule. Unknown legacy locator types are not safe to inherit.
    function compatibleScheduleRef(kind, scheduleRef) {
        return scheduleRefKind(scheduleRef) === kind ? scheduleRef : null;
    }

    function scheduleRefFromChip(chip) {
        if (!chip) return null;
        const type = chip.isOffice ? 'office' : (chip.isReceptionist ? 'receptionist' : 'teaching');
        const hasLocator = chip.classCompositeKey || chip.linkedScheduleShiftId ||
            chip.classSectionKey || chip.classStart || chip.branch;
        if (!hasLocator) return null;
        return {
            type,
            branch: String(chip.branch || chip.sessionData?.branch || '').toLowerCase(),
            documentKey: chip.classCompositeKey || '',
            shiftId: chip.linkedScheduleShiftId || chip.sessionData?.linkedScheduleShiftId || '',
            section: type === 'teaching' ? (chip.classSectionKey || '') : '',
            rowIndex: chip.classIndex !== '' && chip.classIndex !== null && chip.classIndex !== undefined && Number.isInteger(Number(chip.classIndex))
                ? Number(chip.classIndex)
                : null,
            dayKey: type !== 'teaching' ? String(chip.classIndex || '') : '',
            shiftKey: type !== 'teaching' ? (chip.classSectionKey || '') : '',
            start: chip.classStart || '',
            end: chip.classEnd || ''
        };
    }

    function subjectIdsFromChip(chip, session) {
        if (Array.isArray(chip?.subjectIds) && chip.subjectIds.length) return chip.subjectIds.map(String);
        if (chip?.subjectId) return [String(chip.subjectId)];
        const role = String(session?.role || '');
        return operationalRoles.has(role.toLowerCase())
            ? []
            : role.split('+').map(item => item.trim()).filter(Boolean);
    }

    function newAllocation(kind, seed = {}) {
        const session = state.session || {};
        const fromISO = seed.fromISO || seed.from || session.checkIn || session.start || `${state.dateKey}T08:00`;
        const toISO = seed.toISO || seed.to || session.checkOut || `${state.dateKey}T10:00`;
        const resolvedKind = kind || kindFromChip(state.chip, session);
        const subjectIds = resolvedKind === 'teaching'
            ? (seed.subjectIds || subjectIdsFromChip(state.chip, session))
            : [];
        const names = subjectIds.map(id => allSubjectOptions().find(subject => subject.id === String(id))?.name)
            .filter(Boolean);
        const rate = subjectIds.length
            ? Math.max(...subjectIds.map(rateForSubject))
            : Number(state.user?.salary_config?.receptionist_normal_rate || session.roleRate || 0);
        const inheritedScheduleRef = seed.scheduleRef || scheduleRefFromChip(state.chip);
        return {
            id: String(seed.id || `allocation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`),
            kind: resolvedKind,
            fromISO: toLocalInput(fromISO, state.dateKey),
            toISO: toLocalInput(toISO, state.dateKey),
            subjectIds: subjectIds.map(String),
            role: seed.role || (resolvedKind === 'teaching' ? subjectIds.join('+') : (resolvedKind === 'office' ? 'van-phong' : 'tiep-tan')),
            roleName: seed.roleName || seed.label || (resolvedKind === 'teaching'
                ? (names.join(' + ') || state.chip?.scheduledSubjectName || state.chip?.chipFilterName || 'Dạy học')
                : (resolvedKind === 'office' ? 'Văn Phòng' : 'Tiếp Tân')),
            rateMode: seed.rateMode === 'manual' ? 'manual' : 'policy',
            manualRate: seed.manualRate == null ? null : Number(seed.manualRate),
            roleRate: seed.roleRate == null ? rate : Number(seed.roleRate),
            fixed: seed.fixed === true || seed.isFixedShift === true,
            scheduleRef: compatibleScheduleRef(resolvedKind, inheritedScheduleRef),
            note: seed.note || ''
        };
    }

    function deriveAllocations(context) {
        const session = context.session || {};
        const saved = session.adminPayrollOverride;
        if (saved && Array.isArray(saved.allocations) && saved.allocations.length) {
            return saved.allocations.map(item => newAllocation(item.kind, item));
        }
        const segments = Array.isArray(context.chip?.daySegments) ? context.chip.daySegments : [];
        const usable = segments.filter(segment => ['day', 'teaching', 'tiep-tan', 'receptionist', 'office', 'van-phong'].includes(segment.kind));
        if (usable.length > 1) {
            return usable.map(segment => {
                const kind = ['day', 'teaching'].includes(segment.kind)
                    ? 'teaching'
                    : (['office', 'van-phong'].includes(segment.kind) ? 'office' : 'receptionist');
                return newAllocation(kind, {
                    fromISO: `${context.dateKey}T${segment.start}`,
                    toISO: `${context.dateKey}T${segment.end}`,
                    roleName: segment.label,
                    scheduleRef: segment.scheduleRef || null,
                    subjectIds: kind === 'teaching' ? subjectIdsFromChip(context.chip, session) : []
                });
            });
        }
        return [newAllocation(kindFromChip(context.chip, session))];
    }

    function ensureEditor() {
        let panel = document.getElementById('admin-payroll-override-editor');
        if (panel) return panel;
        const roleWrapper = document.getElementById('role-search-wrapper');
        const anchor = roleWrapper?.parentElement;
        if (!anchor || !anchor.parentElement) return null;
        panel = document.createElement('section');
        panel.id = 'admin-payroll-override-editor';
        panel.style.cssText = 'display:none;margin-bottom:1.25rem;padding:1rem;border:2px solid #2563EB;background:#EFF6FF;border-radius:12px;';
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;margin-bottom:.75rem;">
                <div><strong style="color:#1E40AF;font-size:.95rem;">Quyền Admin · nguồn tính chip</strong>
                    <div style="font-size:.78rem;color:#475569;margin-top:2px;">Giờ và công việc lưu tại đây được ưu tiên tuyệt đối; lịch chỉ còn là tham chiếu.</div>
                </div>
                <span id="apo-revision-badge" style="font-size:.72rem;font-weight:700;color:#1D4ED8;background:white;border:1px solid #BFDBFE;border-radius:999px;padding:3px 8px;">Bản 0</span>
            </div>
            <label style="display:block;font-size:.82rem;font-weight:700;color:#334155;margin-bottom:4px;">Cách tính</label>
            <select id="apo-mode" style="width:100%;height:42px;border:1.5px solid #93C5FD;border-radius:8px;background:white;padding:0 10px;margin-bottom:.75rem;">
                <option value="actual">Theo giờ Admin nhập (1 công việc)</option>
                <option value="manual">Chia một lần vào ca thành nhiều công việc</option>
                <option value="schedule">Trở lại tính theo lịch</option>
            </select>
            <div id="apo-manual-wrap" style="display:none;">
                <div id="apo-allocation-list" style="display:flex;flex-direction:column;gap:.65rem;"></div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:.7rem;">
                    <button type="button" data-apo-add="teaching" style="border:1px solid #F59E0B;background:#FFFBEB;color:#92400E;border-radius:8px;padding:7px 10px;font-weight:700;cursor:pointer;">+ Dạy</button>
                    <button type="button" data-apo-add="receptionist" style="border:1px solid #6366F1;background:#EEF2FF;color:#3730A3;border-radius:8px;padding:7px 10px;font-weight:700;cursor:pointer;">+ Tiếp tân</button>
                    <button type="button" data-apo-add="office" style="border:1px solid #0EA5E9;background:#F0F9FF;color:#075985;border-radius:8px;padding:7px 10px;font-weight:700;cursor:pointer;">+ Văn phòng</button>
                </div>
                <label style="display:flex;gap:7px;align-items:center;margin-top:.7rem;font-size:.8rem;color:#334155;cursor:pointer;"><input id="apo-merge-touching" type="checkbox" checked> Gộp nhãn các đoạn cùng công việc liền nhau, cùng cơ sở</label>
            </div>
            <div id="apo-preview" style="margin-top:.75rem;padding:.65rem .75rem;border-radius:8px;background:white;border:1px solid #BFDBFE;font-size:.82rem;color:#334155;"></div>
            <label style="display:block;font-size:.82rem;font-weight:700;color:#334155;margin:.8rem 0 4px;">Lý do điều chỉnh <span style="color:#DC2626">*</span></label>
            <textarea id="apo-reason" rows="2" maxlength="500" placeholder="Ví dụ: Thực tế dạy E7 thay E1 và trực tiếp tân phần giờ còn lại" style="width:100%;box-sizing:border-box;border:1.5px solid #93C5FD;border-radius:8px;padding:8px 10px;background:white;"></textarea>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px;margin-top:.65rem;">
                <label style="display:flex;gap:7px;align-items:center;font-size:.8rem;color:#334155;cursor:pointer;"><input id="apo-clear-links" type="checkbox"> Gỡ các liên kết lịch cũ</label>
                <label style="display:flex;gap:7px;align-items:center;font-size:.8rem;color:#334155;cursor:pointer;"><input id="apo-allow-overlap" type="checkbox"> Xác nhận ngoại lệ trùng phiên nguồn</label>
            </div>`;
        anchor.parentElement.insertBefore(panel, anchor);
        panel.querySelector('#apo-mode').addEventListener('change', () => {
            renderRows();
            refreshPreview();
        });
        panel.querySelectorAll('[data-apo-add]').forEach(button => {
            button.addEventListener('click', () => {
                state.allocations = readManualAllocations();
                state.allocations.push(newAllocation(button.dataset.apoAdd));
                renderRows();
                refreshPreview();
            });
        });
        panel.querySelector('#apo-merge-touching').addEventListener('change', refreshPreview);
        return panel;
    }

    function renderSubjectChoices(container, allocation) {
        container.replaceChildren();
        allSubjectOptions().forEach(subject => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:.78rem;color:#334155;padding:3px 0;';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = subject.id;
            input.checked = allocation.subjectIds.includes(subject.id);
            input.addEventListener('change', () => {
                const selected = Array.from(container.querySelectorAll('input:checked')).map(item => item.value);
                allocation.subjectIds = selected;
                allocation.role = selected.join('+');
                allocation.roleName = selected.map(id => allSubjectOptions().find(subjectItem => subjectItem.id === id)?.name || id).join(' + ') || 'Dạy học';
                allocation.roleRate = selected.length ? Math.max(...selected.map(rateForSubject)) : 0;
                const summary = container.parentElement?.querySelector('summary');
                if (summary) summary.textContent = `Môn học (${selected.length})`;
                refreshPreview();
            });
            const text = document.createElement('span');
            text.textContent = `${subject.name} · ${Number(subject.rate || 0).toLocaleString('vi-VN')}đ/h`;
            label.append(input, text);
            container.appendChild(label);
        });
    }

    function renderRows() {
        const panel = document.getElementById('admin-payroll-override-editor');
        if (!panel) return;
        const mode = panel.querySelector('#apo-mode').value;
        const wrap = panel.querySelector('#apo-manual-wrap');
        wrap.style.display = mode === 'manual' ? 'block' : 'none';
        const list = panel.querySelector('#apo-allocation-list');
        list.replaceChildren();
        if (mode !== 'manual') return;

        state.allocations.forEach((allocation, index) => {
            const row = document.createElement('div');
            row.className = 'apo-allocation-row';
            row.dataset.allocationId = allocation.id;
            row.style.cssText = 'background:white;border:1px solid #BFDBFE;border-radius:10px;padding:.75rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.55rem;position:relative;';
            const scheduleLabel = allocation.scheduleRef
                ? [allocation.scheduleRef.branch?.toUpperCase(), allocation.scheduleRef.start, allocation.scheduleRef.end]
                    .filter(Boolean).join(' · ')
                : 'Không neo lịch';
            const roleCoverageLabel = employeeSupportsKind(state.user, allocation.kind)
                ? '<span style="color:#047857;font-weight:700;">Vai trò có trong hồ sơ</span>'
                : '<span style="color:#B45309;font-weight:700;">Ngoài vai trò hồ sơ · ngoại lệ Admin</span>';
            row.innerHTML = `
                <button type="button" class="apo-remove" aria-label="Xóa phân bổ" style="position:absolute;right:6px;top:5px;border:0;background:#FEE2E2;color:#991B1B;border-radius:999px;width:26px;height:26px;cursor:pointer;">×</button>
                <label style="font-size:.75rem;color:#475569;font-weight:700;">Công việc
                    <select class="apo-kind" style="display:block;width:100%;height:38px;margin-top:3px;border:1px solid #CBD5E1;border-radius:7px;background:white;padding:0 7px;">
                        <option value="teaching">Dạy học</option><option value="receptionist">Tiếp tân</option><option value="office">Văn phòng</option>
                    </select>
                </label>
                <label style="font-size:.75rem;color:#475569;font-weight:700;">Từ
                    <input class="apo-from" type="datetime-local" value="${escapeHtml(allocation.fromISO)}" style="display:block;width:100%;box-sizing:border-box;height:38px;margin-top:3px;border:1px solid #CBD5E1;border-radius:7px;padding:0 7px;">
                </label>
                <label style="font-size:.75rem;color:#475569;font-weight:700;">Đến
                    <input class="apo-to" type="datetime-local" value="${escapeHtml(allocation.toISO)}" style="display:block;width:100%;box-sizing:border-box;height:38px;margin-top:3px;border:1px solid #CBD5E1;border-radius:7px;padding:0 7px;">
                </label>
                <details class="apo-subject-details" style="grid-column:1/-1;border:1px solid #E2E8F0;border-radius:7px;padding:6px 8px;">
                    <summary style="cursor:pointer;font-size:.78rem;font-weight:700;color:#334155;">Môn học (${allocation.subjectIds.length})</summary>
                    <div class="apo-subject-list" style="max-height:150px;overflow:auto;margin-top:5px;"></div>
                </details>
                <label style="font-size:.75rem;color:#475569;font-weight:700;">Đơn giá
                    <select class="apo-rate-mode" style="display:block;width:100%;height:38px;margin-top:3px;border:1px solid #CBD5E1;border-radius:7px;background:white;padding:0 7px;"><option value="policy">Theo chính sách</option><option value="manual">Nhập tay</option></select>
                </label>
                <label class="apo-manual-rate-wrap" style="font-size:.75rem;color:#475569;font-weight:700;">Giá/giờ
                    <input class="apo-manual-rate" type="number" min="0" step="1000" value="${allocation.manualRate == null ? '' : escapeHtml(allocation.manualRate)}" style="display:block;width:100%;box-sizing:border-box;height:38px;margin-top:3px;border:1px solid #CBD5E1;border-radius:7px;padding:0 7px;">
                </label>
                <label style="display:flex;align-items:center;gap:6px;font-size:.76rem;color:#334155;"><input class="apo-fixed" type="checkbox" ${allocation.fixed ? 'checked' : ''}> Ca cố định</label>
                <div style="font-size:.72rem;color:#64748B;align-self:center;">${escapeHtml(scheduleLabel)}<br>${roleCoverageLabel}</div>`;
            const kindSelect = row.querySelector('.apo-kind');
            kindSelect.value = allocation.kind;
            const rateMode = row.querySelector('.apo-rate-mode');
            rateMode.value = allocation.rateMode;
            const manualWrap = row.querySelector('.apo-manual-rate-wrap');
            const subjectDetails = row.querySelector('.apo-subject-details');
            const syncVisibility = () => {
                subjectDetails.style.display = kindSelect.value === 'teaching' ? 'block' : 'none';
                manualWrap.style.display = rateMode.value === 'manual' ? 'block' : 'none';
            };
            syncVisibility();
            renderSubjectChoices(row.querySelector('.apo-subject-list'), allocation);
            row.querySelector('.apo-remove').addEventListener('click', () => {
                state.allocations = readManualAllocations();
                state.allocations.splice(index, 1);
                renderRows();
                refreshPreview();
            });
            kindSelect.addEventListener('change', () => {
                allocation.kind = kindSelect.value;
                allocation.scheduleRef = compatibleScheduleRef(kindSelect.value, allocation.scheduleRef);
                state.allocations = readManualAllocations();
                renderRows();
                refreshPreview();
            });
            [rateMode, row.querySelector('.apo-from'), row.querySelector('.apo-to'), row.querySelector('.apo-manual-rate'), row.querySelector('.apo-fixed')]
                .forEach(input => input.addEventListener('change', () => {
                    syncVisibility();
                    refreshPreview();
                }));
            list.appendChild(row);
        });
    }

    function readManualAllocations() {
        const panel = document.getElementById('admin-payroll-override-editor');
        const merge = panel?.querySelector('#apo-merge-touching')?.checked === true;
        return Array.from(panel?.querySelectorAll('.apo-allocation-row') || []).map((row, index) => {
            const existing = state.allocations[index] || {};
            const kind = row.querySelector('.apo-kind').value;
            const subjectIds = kind === 'teaching'
                ? Array.from(row.querySelectorAll('.apo-subject-list input:checked')).map(input => input.value)
                : [];
            const names = subjectIds.map(id => allSubjectOptions().find(subject => subject.id === id)?.name || id);
            const policyRate = subjectIds.length
                ? Math.max(...subjectIds.map(rateForSubject))
                : Number(state.user?.salary_config?.receptionist_normal_rate || 0);
            const scheduleRef = compatibleScheduleRef(kind, existing.scheduleRef);
            const branch = String(scheduleRef?.branch || 'none');
            const mergeGroupId = merge
                ? `${kind}:${subjectIds.slice().sort().join('+')}:${branch}:${row.querySelector('.apo-fixed').checked ? 'fixed' : 'normal'}`
                : '';
            return {
                id: existing.id || `allocation-${index + 1}`,
                kind,
                fromISO: row.querySelector('.apo-from').value,
                toISO: row.querySelector('.apo-to').value,
                subjectIds,
                role: kind === 'teaching' ? subjectIds.join('+') : (kind === 'office' ? 'van-phong' : 'tiep-tan'),
                roleName: kind === 'teaching' ? (names.join(' + ') || 'Dạy học') : (kind === 'office' ? 'Văn Phòng' : 'Tiếp Tân'),
                rateMode: row.querySelector('.apo-rate-mode').value,
                manualRate: row.querySelector('.apo-manual-rate').value === '' ? null : Number(row.querySelector('.apo-manual-rate').value),
                roleRate: policyRate,
                fixed: row.querySelector('.apo-fixed').checked,
                mergeGroupId,
                scheduleRef,
                note: existing.note || ''
            };
        });
    }

    function primaryAllocation(options) {
        const selectedRoleId = String(options?.selectedRoleId || '');
        const teaching = selectedRoleId === 'giao-vien' || (!operationalRoles.has(selectedRoleId) && options?.isTeaching);
        const kind = selectedRoleId === 'van-phong'
            ? 'office'
            : (selectedRoleId === 'tiep-tan' ? 'receptionist' : (teaching ? 'teaching' : kindFromChip(state.chip, state.session)));
        const selectedSubjects = Array.isArray(options?.selectedSubjects) ? options.selectedSubjects : [];
        const subjectIds = kind === 'teaching' ? selectedSubjects.map(subject => String(subject.id)) : [];
        const roleName = kind === 'teaching'
            ? (selectedSubjects.map(subject => subject.name).join(' + ') || state.chip?.scheduledSubjectName || 'Dạy học')
            : (kind === 'office' ? 'Văn Phòng' : 'Tiếp Tân');
        const requestedRate = Number(options?.selectedRoleRate);
        const roleRate = kind === 'teaching'
            ? (Number.isFinite(requestedRate)
                ? requestedRate
                : (selectedSubjects.length
                    ? selectedSubjects.reduce((sum, subject) => sum + Number(subject.rate || 0), 0) / selectedSubjects.length
                    : 0))
            : (Number.isFinite(requestedRate)
                ? requestedRate
                : Number(state.user?.salary_config?.receptionist_normal_rate || 0));
        return {
            id: state.session?.adminPayrollOverride?.allocations?.[0]?.id || 'actual',
            kind,
            fromISO: options?.checkInISO,
            toISO: options?.checkOutISO,
            subjectIds,
            role: kind === 'teaching' ? subjectIds.join('+') : (kind === 'office' ? 'van-phong' : 'tiep-tan'),
            roleName,
            rateMode: 'policy',
            manualRate: null,
            roleRate,
            fixed: options?.isFixedShift === true,
            mergeGroupId: '',
            scheduleRef: compatibleScheduleRef(kind, scheduleRefFromChip(state.chip)),
            note: ''
        };
    }

    function buildDraft(options = {}) {
        const panel = document.getElementById('admin-payroll-override-editor');
        if (!state.visible || !panel) return null;
        const mode = panel.querySelector('#apo-mode').value;
        const allocations = mode === 'manual'
            ? readManualAllocations()
            : (mode === 'actual' ? [primaryAllocation(options)] : []);
        return {
            override: { version: 1, mode, allocations },
            reason: panel.querySelector('#apo-reason').value.trim(),
            clearLegacyScheduleLinks: panel.querySelector('#apo-clear-links').checked,
            allowSessionOverlap: panel.querySelector('#apo-allow-overlap').checked
        };
    }

    function refreshPreview() {
        const panel = document.getElementById('admin-payroll-override-editor');
        const preview = panel?.querySelector('#apo-preview');
        if (!preview || !state.visible) return;
        const mode = panel.querySelector('#apo-mode').value;
        if (mode === 'schedule') {
            preview.innerHTML = '<strong>Theo lịch:</strong> bỏ ghi đè, chip trở lại quy tắc lịch hiện hành.';
            return;
        }
        if (mode === 'actual') {
            preview.innerHTML = '<strong>Theo giờ Admin nhập:</strong> khi lưu, một chip sẽ dùng nguyên khoảng Vào/Ra và công việc đang chọn, không bị lịch cắt lại.';
            return;
        }
        const allocations = readManualAllocations();
        const draftSession = {
            ...(state.session || {}),
            adminPayrollOverride: { version: 1, mode: 'manual', allocations }
        };
        const helper = root.AdminPayrollOverride;
        if (!helper) {
            preview.textContent = 'Chưa tải được bộ kiểm tra phân bổ.';
            return;
        }
        const result = helper.buildOverrideChips([draftSession]);
        const errors = result.invalidOverrides?.flatMap(item => item.errors || []) || [];
        if (errors.length) {
            preview.innerHTML = `<strong style="color:#B91C1C;">Chưa hợp lệ:</strong> ${escapeHtml(errors[0].message)}`;
            return;
        }
        const warningCount = result.warnings?.length || 0;
        const minutes = result.totalPaidMinutes || 0;
        preview.innerHTML = `<strong>Xem trước:</strong> ${result.chips.length} chip · ${Math.floor(minutes / 60)}h${minutes % 60 ? (minutes % 60) + 'p' : ''}` +
            (warningCount ? ` · <span style="color:#B45309;">đã tự loại phần chồng giờ (${warningCount} cảnh báo)</span>` : '');
    }

    function open(context = {}) {
        const panel = ensureEditor();
        if (!panel) return;
        state.visible = context.isPrimaryAdmin === true && !!context.session && String(context.sessionId || context.session.id || '') !== 'NEW';
        panel.style.display = state.visible ? 'block' : 'none';
        if (!state.visible) return;
        state.dateKey = String(context.dateKey || '');
        state.session = context.session;
        state.chip = context.chip || {};
        state.user = context.user || root.currentUserContext || {};
        state.subjects = Array.isArray(context.subjects) ? context.subjects : (root.currentSubjectCatalog || []);
        state.allocations = deriveAllocations(context);
        const saved = context.session.adminPayrollOverride || {};
        panel.querySelector('#apo-mode').value = ['schedule', 'actual', 'manual'].includes(saved.mode)
            ? saved.mode
            : 'actual';
        panel.querySelector('#apo-reason').value = saved.reason || '';
        panel.querySelector('#apo-clear-links').checked = false;
        panel.querySelector('#apo-allow-overlap').checked = false;
        panel.querySelector('#apo-revision-badge').textContent = `Bản ${Number(saved.revision || 0)}`;
        renderRows();
        refreshPreview();
        const focusId = context.chip?.payrollAllocationId;
        if (focusId) {
            setTimeout(() => panel.querySelector(`[data-allocation-id="${CSS.escape(String(focusId))}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
        }
    }

    function close() {
        state.visible = false;
        const panel = document.getElementById('admin-payroll-override-editor');
        if (panel) panel.style.display = 'none';
    }

    root.AdminPayrollOverrideUI = {
        open,
        close,
        buildDraft,
        refreshPreview,
        compatibleScheduleRef,
        employeeSupportsKind,
        isVisible: () => state.visible,
        getState: () => ({
            visible: state.visible,
            dateKey: state.dateKey,
            allocationCount: state.allocations.length
        })
    };
}(typeof window !== 'undefined' ? window : globalThis));
