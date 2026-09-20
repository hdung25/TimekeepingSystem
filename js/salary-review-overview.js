/* Batch UI reuses audited per-person services; no writes on load or selection. */
(function () {
    'use strict';
    const P = window.SalaryReviewPolicy, O = window.SalaryReviewOverviewPolicy, S = window.SalaryReviewService;
    const $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const number = value => value == null ? '—' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
    const money = value => value == null ? 'Chưa rõ' : number(value) + ' đ';
    const state = { index: null, selected: new Set(), rows: new Map(), busy: false, dirty: false, preview: [] };
    const today = () => P.dateKey();
    const locked = group => group.enabled === false || group.scheduledChange?.effectiveFrom > today();
    const key = (staffId, groupId) => staffId + '|' + groupId;
    function message(text, error = false) {
        $('sro-message').textContent = text;
        $('sro-message').classList.toggle('error', error);
    }
    function selection() { return [...state.selected]; }
    function visibleUsers() {
        const q = P.key($('sro-search').value), dueOnly = $('sro-due').checked;
        return state.index.users.filter(P.isTeacher).filter(user => {
            if (q && !P.key(user.name + ' ' + user.username).includes(q)) return false;
            const profile = state.index.profiles.find(p => (p.staffId || p.id) === user.id);
            return !dueOnly || (profile?.groups || []).some(g => P.evaluate(g, {}, state.index.config, today(), profile.personOverrides).visibleThisMonth);
        }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
    }
    const hasEdits = () => [...state.rows.values()].some(row => row.dirty || Object.values(row.edits || {}).some(e => e.newRate !== ''));
    function dirty(row) { if (row) row.dirty = true; state.dirty = true; state.preview = []; $('sro-preview').hidden = true; }
    function metrics(row) {
        return `<table class="sro-metrics"><thead><tr><th>Tháng</th><th>Giờ dạy</th><th>Chuyên cần</th><th>Off có phép</th><th>Vắng khác</th><th>Trễ</th></tr></thead><tbody>${row.stats.rows.map(month => {
            const a = O.attendance(month.stats);
            const shifts = (count, hours) => `${number(count)} ca · ${hours === null ? 'chưa lưu giờ' : number(hours) + ' giờ'}`;
            return `<tr><td>${esc(month.month)}</td><td>${month.hours === null ? 'Chưa có phiếu' : number(month.hours) + ' giờ'}</td><td>${a.percent === null ? '—' : number(a.percent) + '%'}</td><td>${shifts(a.offShifts, a.offHours)}</td><td>${shifts(a.absentShifts, a.absentHours)}</td><td>${number(a.lateCount)}</td></tr>`;
        }).join('')}</tbody></table>`;
    }
    function groupRows(id, row) {
        if (!row.groups.length) return '<p class="sr-help">Chưa có giá môn đủ căn cứ. Mở hồ sơ để xác nhận.</p>';
        const evidence = new Map(row.inferred.flatMap(g => g.evidence).map(e => [e.subjectId, e]));
        return row.groups.map(g => {
            const edit = row.edits[g.id], disabled = locked(g) ? 'disabled' : '';
            const names = g.subjectIds.map(subjectId => {
                const e = evidence.get(subjectId), name = e?.name || state.index.subjects.find(s => s.id === subjectId)?.name || subjectId;
                return `<li>${esc(name)} <b>${money(e?.rate ?? g.currentRate)}/giờ</b></li>`;
            }).join('');
            return `<div class="sro-group" data-staff="${esc(id)}" data-group="${esc(g.id)}">
                <div class="sro-subjects"><strong>${esc(g.name)}</strong><ul>${names}</ul>${locked(g) ? `<small>${g.enabled === false ? 'Đang tắt nhắc' : 'Đã duyệt ' + money(g.scheduledChange.newRate) + '/giờ · hiệu lực ' + esc(g.scheduledChange.effectiveFrom)}</small>` : ''}</div>
                <label>Nhắc mỗi (tháng)<input type="number" min="1" max="36" step="1" data-edit="cycle" value="${esc(edit.cycle)}" ${disabled}></label>
                <label>Nhắc tiếp theo<input type="date" data-edit="nextDate" value="${esc(edit.nextDate)}" ${disabled}><small>Mốc ${esc(g.baselineDate || today())}</small></label>
                <label>Mức mới (đ/giờ)<input type="number" min="1" max="10000000" step="1" placeholder="Chưa đề xuất" data-edit="newRate" value="${esc(edit.newRate)}" ${disabled}><small>${g.confirmed ? 'Nhập giá sau tăng' : 'Lưu lịch nhắc trước khi duyệt'}</small></label>
            </div>`;
        }).join('');
    }
    function render() {
        if (!state.index) return;
        const users = visibleUsers();
        $('sro-count').textContent = selection().length + ' đã chọn / ' + state.index.users.filter(P.isTeacher).length + ' giáo viên';
        $('sro-select-all').checked = users.length > 0 && users.every(u => state.selected.has(u.id));
        $('sro-select-all').indeterminate = users.some(u => state.selected.has(u.id)) && !$('sro-select-all').checked;
        $('sro-list').innerHTML = users.length ? users.map(user => {
            const row = state.rows.get(user.id);
            return `<article class="sro-person ${state.selected.has(user.id) ? 'selected' : ''}" data-person-row="${esc(user.id)}">
                <header><label class="sr-check"><input type="checkbox" data-select="${esc(user.id)}" ${state.selected.has(user.id) ? 'checked' : ''}><strong>${esc(user.name || user.username)}</strong></label><span class="sro-result">${esc(row?.result || '')}</span><button class="sr-btn" type="button" data-detail="${esc(user.id)}">Hồ sơ chi tiết</button></header>
                ${row?.loading ? '<p class="sr-help">Đang tải công và giá…</p>' : row?.error ? `<p class="sr-hint sr-error">${esc(row.error)}</p><button class="sr-btn" data-load="${esc(user.id)}">Thử lại</button>` : row?.evidence ? `<div class="sro-evidence">${metrics(row)}<small>Chuyên cần = ca đi làm / (ca đi làm + ca vắng). Nguồn: phiếu GV đã gửi/nhận; “—” là thiếu dữ liệu. Giờ off/vắng chỉ hiện khi phiếu có lưu thời lượng.</small></div>${groupRows(user.id, row)}` : '<p class="sr-help sro-unloaded">Chọn giáo viên rồi bấm “Tải công & giá” để xem 3 tháng gần nhất và giá từng môn.</p>'}
            </article>`;
        }).join('') : '<p class="sr-empty">Không có giáo viên phù hợp.</p>';
    }
    function acceptProfile(id, profile) {
        const index = state.index.profiles.findIndex(p => (p.staffId || p.id) === id);
        const value = { ...profile, staffId: id };
        if (index < 0) state.index.profiles.push(value); else state.index.profiles[index] = value;
        window.dispatchEvent(new CustomEvent('salary-review-profiles-changed', { detail: { staffId: id, profile: value } }));
    }
    async function load(id) {
        const previous = state.rows.get(id);
        state.rows.set(id, { ...previous, loading: true }); render();
        try {
            const evidence = await S.loadEvidence(id);
            const inferred = P.inferGroups(evidence.user, state.index.subjects, evidence.monthly, {
                today: today(), legacySettings: evidence.legacySettings, lifecycle: DBService.getPayslipLifecycleState, rateResolver: window.SubjectRatePolicy
            });
            const groups = O.buildGroups(evidence.profile, inferred, today());
            const edits = Object.fromEntries(groups.map(g => {
                const evaluation = P.evaluate(g, {}, state.index.config, today(), evidence.profile.personOverrides);
                return [g.id, { cycle: evaluation.months || 3, nextDate: evaluation.dueDate || P.addMonths(g.baselineDate || today(), evaluation.months || 3), newRate: '' }];
            }));
            state.rows.set(id, { evidence, inferred, groups, edits, stats: P.statistics(id, P.previousMonths(today(), 3), evidence.monthly, { lifecycle: DBService.getPayslipLifecycleState }), result: '' });
            acceptProfile(id, evidence.profile);
        } catch (error) { state.rows.set(id, { error: error.message }); }
        render();
    }
    async function run(action, writes = false) {
        if (state.busy) return;
        state.busy = true;
        $('sro-workspace').inert = true;
        $('sro-preview').inert = true;
        $('sr-detail').inert = true;
        window.__payrollWritePending = writes;
        try { await action(); }
        catch (error) { message(error.message || 'Không thể hoàn tất. Kiểm tra kết quả từng người rồi thử lại.', true); }
        finally { state.busy = false; window.__payrollWritePending = false; $('sro-workspace').inert = false; $('sro-preview').inert = false; $('sr-detail').inert = false; render(); }
    }
    function selectedRows() {
        if (!selection().length) throw Error('Chọn ít nhất một giáo viên.');
        return selection().map(id => {
            const row = state.rows.get(id);
            if (!row?.evidence) throw Error('Tải công & giá cho tất cả giáo viên đã chọn trước.');
            return [id, row];
        });
    }
    async function saveReminders() {
        const plans = selectedRows().map(([id, row]) => ({ id, row, draft: O.reminderDraft(row.evidence.profile, row.groups, row.edits, today(), P) }));
        if (plans.some(p => !p.draft.groups.length)) throw Error('Có giáo viên chưa có giá môn. Mở hồ sơ để xác nhận trước.');
        let completed = 0;
        for (const { id, row, draft } of plans) {
            try {
                await S.saveProfile(id, draft, row.evidence.profile.revision, state.index.subjects);
                row.evidence.profile = { ...draft, revision: Number(row.evidence.profile.revision || 0) + 1 };
                row.groups = draft.groups;
                row.dirty = false;
                row.result = 'Đã lưu lịch nhắc'; completed++;
                acceptProfile(id, row.evidence.profile);
            } catch (error) {
                row.result = 'Chưa lưu: ' + error.message;
                throw Error(`Đã lưu ${completed}/${plans.length} giáo viên. ${error.message} Các hồ sơ còn lại chưa được lưu.`);
            }
        }
        state.dirty = hasEdits();
        state.preview = []; $('sro-preview').hidden = true;
        message('Đã lưu lịch nhắc cho ' + completed + ' giáo viên. Giá tính lương giữ nguyên.');
    }
    async function prepare() {
        const targetMonth = $('sro-month').value, reason = $('sro-reason').value.trim();
        if (!reason) throw Error('Nhập lý do xét tăng lương.');
        const plans = [];
        for (const [id, row] of selectedRows()) for (const group of row.groups) {
            const edit = row.edits[group.id];
            if (locked(group) || edit.newRate === '') continue;
            const reminder = O.reminderDraft(row.evidence.profile, [group], { [group.id]: edit }, today(), P).groups[0];
            const saved = row.evidence.profile.groups.find(g => g.id === group.id);
            if (!saved?.confirmed || saved.cycleMonths !== reminder.cycleMonths || (saved.nextReviewDate || '') !== reminder.nextReviewDate) throw Error('Lưu lịch nhắc đã chỉnh trước khi xem mức tăng.');
            const command = { newRate: Number(edit.newRate), targetMonth, selectedSubjectIds: group.subjectIds.slice(), reason };
            const prepared = await S.prepareApplication(id, group.id, command, row.evidence.profile.revision);
            if (prepared.preview.changes.some(change => change.beforeRate !== null && change.afterRate <= change.beforeRate)) throw Error('Mức mới của ' + row.evidence.user.name + ' / ' + group.name + ' phải cao hơn giá hiện tại.');
            plans.push({ id, groupId: group.id, command, prepared, name: row.evidence.user.name, groupName: group.name, revision: row.evidence.profile.revision });
        }
        if (!plans.length) throw Error('Nhập mức mới cho ít nhất một nhóm môn của giáo viên đã chọn.');
        state.preview = plans;
        $('sro-preview').innerHTML = `<h2>Kiểm tra trước khi duyệt</h2><p>Hiệu lực từ ${esc(targetMonth)} · ${plans.length} nhóm môn · ${new Set(plans.map(p => p.id)).size} giáo viên</p><div class="sro-evidence"><table class="sr-table"><thead><tr><th>Giáo viên / môn</th><th>Giá trước</th><th>Giá mới / giờ</th></tr></thead><tbody>${plans.flatMap(p => p.prepared.preview.changes.map(change => `<tr><td>${esc(p.name)}<br><small>${esc(change.name)}</small></td><td>${money(change.beforeRate)}</td><td><strong>${money(change.afterRate)}</strong></td></tr>`)).join('')}</tbody></table></div><p class="sr-help">Chỉ đổi các môn trên từ tháng đã chọn. Mỗi nhóm được ghi cùng lịch sử; nếu có lỗi, kết quả sẽ báo rõ nhóm đã lưu và dừng phần còn lại. Phiếu lương đã gửi và các giá ngoài phạm vi được giữ nguyên.</p><button id="sro-apply" class="sr-btn sr-btn-primary" type="button">Duyệt các mức trên</button><button id="sro-close-preview" class="sr-btn" type="button">Quay lại chỉnh</button>`;
        $('sro-preview').hidden = false;
        $('sro-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
        message('Bản xem trước đã sẵn sàng; chưa đổi giá lương.');
    }
    async function apply() {
        const plans = state.preview.slice();
        if (!plans.length) throw Error('Xem trước lại trước khi duyệt.');
        const applied = new Map(), revisions = new Map(); let count = 0;
        try {
            for (const plan of plans) {
                const previous = applied.get(plan.id) || [];
                let prepared = plan.prepared;
                if (previous.length) {
                    prepared = await S.prepareApplication(plan.id, plan.groupId, plan.command, revisions.get(plan.id));
                    if (!O.samePreview(plan.prepared.preview, prepared.preview, previous)) throw Error('Nguồn giá đã thay đổi ngoài các mức vừa duyệt. Hãy tải lại và xem trước.');
                }
                await S.applyApplication(prepared);
                previous.push(prepared.preview); applied.set(plan.id, previous);
                revisions.set(plan.id, Number(revisions.get(plan.id) ?? plan.revision) + 1);
                state.rows.get(plan.id).edits[plan.groupId].newRate = '';
                state.rows.get(plan.id).result = 'Đã duyệt ' + previous.length + ' nhóm từ ' + plan.command.targetMonth;
                count++;
            }
            message('Đã duyệt ' + count + ' nhóm môn. Lịch sử và nút hủy mức chờ hiệu lực nằm trong Hồ sơ chi tiết.');
        } catch (error) {
            message('Đã duyệt ' + count + '/' + plans.length + ' nhóm. Dừng phần còn lại: ' + error.message + ' Tải lại dữ liệu trước khi xem trước lần nữa.', true);
        } finally {
            // Clear all approval handles: no repeated tap can replay a partial batch.
            state.preview = []; $('sro-preview').hidden = true;
            for (const id of applied.keys()) {
                const result = state.rows.get(id).result;
                const pending = state.rows.get(id).edits;
                await load(id);
                const fresh = state.rows.get(id);
                if (fresh) {
                    fresh.result = result;
                    fresh.groups?.filter(g => !locked(g)).forEach(g => {
                        if (pending[g.id]) fresh.edits[g.id].newRate = pending[g.id].newRate;
                    });
                }
            }
            state.dirty = hasEdits();
        }
    }
    function setView(detail) {
        if (state.busy) return;
        $('sro-overview').hidden = detail;
        $('sr-individual').hidden = !detail;
        $('sro-overview-tab').setAttribute('aria-selected', String(!detail));
        $('sro-detail-tab').setAttribute('aria-selected', String(detail));
    }
    window.addEventListener('salary-review-index-loaded', event => {
        if (state.busy || state.dirty) { message('Có dữ liệu đang chỉnh trong tổng quan. Lưu hoặc tải lại từng giáo viên trước khi thay nguồn.', true); return; }
        state.index = event.detail; state.rows.clear(); render();
        $('sro-month').value = P.addMonths(today().slice(0,7) + '-01', 1).slice(0,7);
        $('sro-month').min = $('sro-month').value;
        $('sro-next').value = P.addMonths(today(), Number($('sro-cycle').value));
        message('Chọn giáo viên → Tải công & giá → đặt lịch nhắc hoặc nhập mức mới.');
    });
    $('sro-list').addEventListener('input', event => {
        const input = event.target, box = input.closest('[data-group]');
        if (!box || !input.dataset.edit) return;
        const row = state.rows.get(box.dataset.staff), edit = row.edits[box.dataset.group];
        edit[input.dataset.edit] = input.value;
        if (input.dataset.edit === 'cycle') {
            const g = row.groups.find(g => g.id === box.dataset.group);
            const date = P.addMonths(g.baselineDate || today(), Number(edit.cycle));
            if (date) { edit.nextDate = date; box.querySelector('[data-edit="nextDate"]').value = date; }
        }
        dirty(row);
    });
    $('sro-list').addEventListener('change', event => {
        const id = event.target.dataset.select;
        if (id) { event.target.checked ? state.selected.add(id) : state.selected.delete(id); state.preview = []; $('sro-preview').hidden = true; render(); }
    });
    $('sro-list').addEventListener('click', event => {
        const detail = event.target.closest('[data-detail]'), retry = event.target.closest('[data-load]');
        if (detail) { setView(true); window.dispatchEvent(new CustomEvent('salary-review-open-person', { detail: detail.dataset.detail })); }
        if (retry) run(() => load(retry.dataset.load));
    });
    $('sro-search').addEventListener('input', render); $('sro-due').addEventListener('change', render);
    $('sro-select-all').addEventListener('change', event => { visibleUsers().forEach(u => event.target.checked ? state.selected.add(u.id) : state.selected.delete(u.id)); state.preview = []; $('sro-preview').hidden = true; render(); });
    $('sro-load').addEventListener('click', () => run(async () => {
        if (!selection().length) throw Error('Chọn ít nhất một giáo viên.');
        if (state.dirty && !confirm('Tải lại sẽ bỏ các ô chưa lưu của giáo viên đã chọn. Tiếp tục?')) return;
        for (const id of selection()) await load(id);
        state.dirty = hasEdits(); state.preview = []; $('sro-preview').hidden = true;
        message('Đã tải xong. Mỗi môn giữ đúng giá riêng; ô trống chưa được coi là 0.');
    }));
    $('sro-fill-reminders').addEventListener('click', () => run(async () => {
        const cycle = Number($('sro-cycle').value), nextDate = $('sro-next').value;
        if (!Number.isInteger(cycle) || cycle < 1 || cycle > 36 || !P.validDate(nextDate)) throw Error('Nhập chu kỳ 1–36 tháng và ngày nhắc hợp lệ.');
        selectedRows().forEach(([,row]) => { row.dirty = true; row.groups.filter(g => !locked(g)).forEach(g => Object.assign(row.edits[g.id], { cycle, nextDate })); });
        dirty(); message('Đã điền vào các dòng được chọn. Có thể chỉnh riêng từng người, rồi bấm Lưu lịch nhắc.');
    }));
    $('sro-cycle').addEventListener('input', () => { const next = P.addMonths(today(), Number($('sro-cycle').value)); if (next) $('sro-next').value = next; });
    $('sro-fill-increase').addEventListener('click', () => run(async () => {
        const delta = Number($('sro-increase').value);
        if (!$('sro-increase').value || !Number.isInteger(delta) || delta <= 0) throw Error('Nhập số tiền tăng thêm / giờ lớn hơn 0.');
        const patches = [];
        selectedRows().forEach(([,row]) => row.groups.filter(g => !locked(g)).forEach(g => {
            const evidence = new Map(row.inferred.flatMap(folder => folder.evidence).map(e => [e.subjectId,e]));
            const rates = g.subjectIds.map(id => evidence.get(id)?.rate);
            if (!rates.length || rates.some(rate => rate == null) || new Set(rates).size !== 1) throw Error('Nhóm ' + g.name + ' có giá khác nhau hoặc chưa rõ. Nhập mức mới riêng sau khi xem giá từng môn.');
            const value = rates[0] + delta;
            if (value > 10000000) throw Error('Mức mới vượt giới hạn 10.000.000 đ/giờ.');
            patches.push({ edit: row.edits[g.id], value });
        }));
        patches.forEach(({edit,value}) => { edit.newRate = String(value); });
        dirty(); message('Đã điền mức đề xuất. Chỉnh riêng từng nhóm nếu cần; chưa thay đổi giá tính lương.');
    }));
    $('sro-save').addEventListener('click', () => run(saveReminders, true));
    $('sro-prepare').addEventListener('click', () => run(prepare));
    $('sro-preview').addEventListener('click', event => {
        if (event.target.closest('#sro-apply')) run(apply, true);
        if (event.target.closest('#sro-close-preview')) { state.preview = []; $('sro-preview').hidden = true; }
    });
    ['sro-month','sro-reason'].forEach(id => $(id).addEventListener('input', () => dirty()));
    $('sro-overview-tab').addEventListener('click', () => setView(false));
    $('sro-detail-tab').addEventListener('click', () => setView(true));
    window.addEventListener('beforeunload', event => { if (state.dirty || state.busy) { event.preventDefault(); event.returnValue = ''; } });
    window.SalaryReviewOverview = { hasPendingChanges: () => state.dirty || state.busy };
    setView(new URLSearchParams(location.search).has('staffId'));
})();
