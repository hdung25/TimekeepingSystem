// Lịch riêng không nhận thay đổi của tuần trước (GĐ báo 20/10/2026: "T4 tuần trước chị đã
// chỉnh theo lớp, tuần này nó không lưu").
//
// Ngày CHƯA có lịch riêng tự kế thừa lịch cùng thứ gần nhất trước đó. Nhưng chỉ cần một thao
// tác bất kỳ ở một ngày tương lai (tắt lớp, GV thay, ghi chú…) là ngày đó thành LỊCH RIÊNG —
// từ đó mọi chỉnh sửa ở tuần trước không còn chảy sang nữa và người xếp lịch không hề biết.
// (T4 21/10 cơ sở 1 bị tạo lịch riêng từ 03/10, nên sắp xếp lại phòng ở T4 07/10 và 14/10
// không sang.)
//
// Module này:
//   • ở ngày lịch riêng sắp tới: báo "khác lịch <thứ> tuần trước N lớp" + nút xem khác biệt
//     và LẤY LỊCH TUẦN TRƯỚC (giữ nguyên các việc riêng của ngày đó: lớp tắt, GV thay, vắng);
//   • ở ngày nguồn: báo ngay khi sửa "ngày <thứ> tuần sau đã có lịch riêng nên không nhận thay
//     đổi này" + nút áp dụng sang ngày đó.
// Chỉ đụng ngày trong tương lai (sau hôm nay), ghi trong một giao dịch có kiểm tra xung đột.
(function (global) {
    'use strict';

    const SECTION_LABELS = {
        morning1: 'Sáng - Ca 1', morning2: 'Sáng - Ca 2', afternoon1: 'Chiều - Ca 1',
        afternoon2: 'Chiều - Ca 2', evening1: 'Tối - Ca 1', evening2: 'Tối - Ca 2'
    };
    const SECTION_KEYS = Object.keys(SECTION_LABELS);
    const WEEKDAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    // Những gì chỉ đúng cho MỘT ngày (getSchedule cũng bỏ chúng khi kế thừa) — luôn lấy của
    // chính ngày đích, không lấy từ tuần trước.
    const PER_DAY_FIELDS = ['registeredTeachers', 'isClosed', 'classClosureHistory',
        'gvThayThe', 'gvThayTheId', 'gvThayTheList', 'gvThayTe', 'gvThayTeId', 'gvThayTeList', 'gvThayTheAt',
        'teacherAbsences', 'substituteAbsences', 'teacherAbsenceHistory',
        'staffingUpdatedAt', 'staffingUpdatedById', 'staffingUpdatedByName'];
    const STAFFING_FIELDS = PER_DAY_FIELDS.filter(field => !['registeredTeachers', 'isClosed', 'classClosureHistory'].includes(field));
    const CACHE_MS = 60 * 1000;
    const DISMISS_KEY = 'tdt_schedule_carryover_keep_v1';

    const dbService = () => (typeof DBService !== 'undefined' ? DBService : global.DBService) || null;
    const uiService = () => (typeof UIService !== 'undefined' ? UIService : global.UIService) || null;
    const shiftState = () => (typeof TeacherShiftState !== 'undefined' ? TeacherShiftState : global.TeacherShiftState) || null;
    const firestore = () => global.db || null;

    const pad = value => String(value).padStart(2, '0');
    const dateKeyOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const parseKey = dateKey => { const [y, m, d] = String(dateKey || '').split('-').map(Number); return new Date(y, m - 1, d); };
    const todayKey = () => (typeof global.getLocalDateKeyFromDate === 'function'
        ? global.getLocalDateKeyFromDate(new Date()) : dateKeyOf(new Date()));
    const dateOfDoc = docId => String(docId || '').split('__').pop();
    const dayLabel = dateKey => {
        const [, m, d] = String(dateKey).split('-');
        return `${WEEKDAY_NAMES[parseKey(dateKey).getDay()]} ${d}/${m}`;
    };
    const escapeHtml = value => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const norm = value => String(value == null ? '' : value).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
    const clone = value => JSON.parse(JSON.stringify(value == null ? null : value));

    // ---------- So sánh hai ngày (thuần, có test) ----------
    function mainTeachers(row) {
        const state = shiftState();
        if (state && typeof state.getMainTeachers === 'function') return state.getMainTeachers(row || {});
        const list = Array.isArray(row?.gvList) ? row.gvList : [];
        if (list.length) return list;
        return row && (row.gv || row.gvId) ? [{ id: row.gvId || '', name: row.gv || '' }] : [];
    }
    const teacherIds = row => mainTeachers(row).map(item => String(item?.id || norm(item?.name))).filter(Boolean).sort().join(',');
    const teacherNames = row => mainTeachers(row).map(item => String(item?.name || '').trim()).filter(Boolean).join(', ');
    const rowTitle = row => String(row?.lop || '').trim() || `Lớp chưa đặt tên${row?.phong ? ` (${String(row.phong).trim()})` : ''}`;
    const rowsOf = (day, section) => (Array.isArray(day?.[section]) ? day[section] : []).filter(row => row && typeof row === 'object');

    // Ghép mỗi lớp của tuần trước với đúng lớp đó ở ngày đích: cùng tên lớp (ưu tiên cùng giờ),
    // lớp chưa đặt tên thì theo phòng + giờ. Trả về chỉ số dòng đích cho từng dòng nguồn.
    function matchRows(sourceRows, targetRows) {
        const used = new Set();
        const result = sourceRows.map(() => -1);
        const passes = [
            (s, t) => norm(s.lop) && norm(s.lop) === norm(t.lop) && norm(s.start) === norm(t.start),
            (s, t) => norm(s.lop) && norm(s.lop) === norm(t.lop),
            (s, t) => !norm(s.lop) && !norm(t.lop) && norm(s.phong) === norm(t.phong) && norm(s.start) === norm(t.start)
        ];
        passes.forEach(test => {
            sourceRows.forEach((source, sourceIndex) => {
                if (result[sourceIndex] >= 0) return;
                const targetIndex = targetRows.findIndex((target, index) => !used.has(index) && test(source, target));
                if (targetIndex >= 0) { result[sourceIndex] = targetIndex; used.add(targetIndex); }
            });
        });
        return result;
    }

    function hasPerDayStaffing(row) {
        return STAFFING_FIELDS.some(field => {
            const value = row?.[field];
            return Array.isArray(value) ? value.length > 0 : !!String(value == null ? '' : value).trim();
        });
    }
    function perDayNotes(row) {
        const notes = [];
        if (row?.isClosed === true) notes.push('đang tắt lớp');
        const state = shiftState();
        const subs = state && typeof state.getSubstituteTeachers === 'function' ? state.getSubstituteTeachers(row) : [];
        if (subs.length) notes.push(`GV thay: ${subs.map(item => item.name).filter(Boolean).join(', ')}`);
        if ((row?.teacherAbsences || []).length || (row?.substituteAbsences || []).length) notes.push('có báo vắng');
        if ((row?.registeredTeachers || []).length) notes.push('có người nhận lớp');
        return notes;
    }

    function describeChange(source, target) {
        const parts = [];
        if (norm(source.start) !== norm(target.start) || norm(source.end) !== norm(target.end)) {
            parts.push(`giờ ${target.start || '?'}–${target.end || '?'} → ${source.start || '?'}–${source.end || '?'}`);
        }
        if (norm(source.phong) !== norm(target.phong)) parts.push(`phòng ${String(target.phong || '').trim() || 'trống'} → ${String(source.phong || '').trim() || 'trống'}`);
        if (teacherIds(source) !== teacherIds(target)) parts.push(`GV ${teacherNames(target) || 'trống'} → ${teacherNames(source) || 'trống'}`);
        return parts;
    }

    // Khác biệt giữa ngày đích (target) và lịch tuần trước (source) theo từng ca.
    function diffDays(source, target) {
        const sections = [];
        let count = 0;
        const warnings = [];
        SECTION_KEYS.forEach(section => {
            const sourceRows = rowsOf(source, section);
            const targetRows = rowsOf(target, section);
            const matches = matchRows(sourceRows, targetRows);
            const changes = [];
            sourceRows.forEach((row, index) => {
                const targetIndex = matches[index];
                if (targetIndex < 0) {
                    changes.push({ kind: 'add', text: `Thêm ${rowTitle(row)} · ${row.start || '?'}–${row.end || '?'}${row.phong ? ` · ${String(row.phong).trim()}` : ''}${teacherNames(row) ? ` · ${teacherNames(row)}` : ''}` });
                    return;
                }
                const targetRow = targetRows[targetIndex];
                const parts = describeChange(row, targetRow);
                if (parts.length) changes.push({ kind: 'change', text: `${rowTitle(row)}: ${parts.join(', ')}` });
                if (teacherIds(row) !== teacherIds(targetRow) && hasPerDayStaffing(targetRow)) {
                    warnings.push(`${SECTION_LABELS[section]} · ${rowTitle(targetRow)}: đổi GV chính nên bỏ GV thay / báo vắng đã ghi riêng cho ngày này.`);
                }
            });
            const matchedTargets = new Set(matches.filter(index => index >= 0));
            targetRows.forEach((row, index) => {
                if (matchedTargets.has(index)) return;
                changes.push({ kind: 'remove', text: `Bỏ ${rowTitle(row)} · ${row.start || '?'}–${row.end || '?'}${row.phong ? ` · ${String(row.phong).trim()}` : ''}` });
                const notes = perDayNotes(row);
                if (notes.length) warnings.push(`${SECTION_LABELS[section]} · ${rowTitle(row)} (${notes.join(', ')}) không có ở lịch tuần trước nên sẽ bị bỏ.`);
            });
            const structural = changes.length;
            const order = matches.filter(index => index >= 0);
            if (order.some((value, index) => index > 0 && value < order[index - 1])) {
                changes.push({ kind: 'order', text: 'Sắp lại thứ tự lớp giống tuần trước' });
            }
            if (changes.length) {
                sections.push({ key: section, label: SECTION_LABELS[section], changes });
                count += structural || 1;
            }
        });
        return { sections, count, warnings };
    }

    // Ngày đích sau khi lấy lịch tuần trước: bố cục (lớp, giờ, phòng, GV chính, thứ tự) theo
    // tuần trước; lớp trùng giữ mã ca + việc riêng của ngày đích (tắt lớp, GV thay, vắng…).
    function mergeDay(source, target, targetDateKey, newShiftId) {
        const state = shiftState();
        const merged = {};
        SECTION_KEYS.forEach(section => {
            const sourceRows = rowsOf(source, section);
            const targetRows = rowsOf(target, section);
            if (!sourceRows.length && !Array.isArray(target?.[section]) && !Array.isArray(source?.[section])) return;
            const matches = matchRows(sourceRows, targetRows);
            merged[section] = sourceRows.map((sourceRow, index) => {
                const projected = state && typeof state.projectInheritedRoster === 'function'
                    ? state.projectInheritedRoster(clone(sourceRow), targetDateKey) : clone(sourceRow);
                const row = { ...projected };
                PER_DAY_FIELDS.forEach(field => { delete row[field]; });
                row.registeredTeachers = [];
                row.gvThayThe = ''; row.gvThayTheId = ''; row.gvThayTheList = [];
                row.gvThayTe = ''; row.gvThayTeId = ''; row.gvThayTeList = [];
                row.teacherAbsences = []; row.teacherAbsenceHistory = [];
                row.staffingSchemaVersion = 2;
                const targetIndex = matches[index];
                if (targetIndex < 0) {
                    row.shiftId = newShiftId();
                    return row;
                }
                const targetRow = targetRows[targetIndex];
                row.shiftId = String(targetRow.shiftId || '') || newShiftId();
                const keepStaffing = teacherIds(sourceRow) === teacherIds(targetRow);
                PER_DAY_FIELDS.forEach(field => {
                    if (!(field in targetRow)) return;
                    if (!keepStaffing && STAFFING_FIELDS.includes(field)) return;
                    row[field] = clone(targetRow[field]);
                });
                if (String(targetRow.note || '').trim()) row.note = targetRow.note;
                if (Number(targetRow.soHS) > 0) row.soHS = targetRow.soHS;
                return row;
            });
        });
        return merged;
    }

    // Dấu vân tay bố cục — để "Giữ lịch riêng" chỉ ẩn nhắc cho đúng phiên bản lịch tuần trước.
    function layoutFingerprint(day) {
        return SECTION_KEYS.map(section => rowsOf(day, section)
            .map(row => [row.start, row.end, row.lop, row.phong, teacherIds(row)].map(norm).join('|')).join(';')).join('/');
    }
    function sectionsJson(day) {
        return JSON.stringify(SECTION_KEYS.map(section => rowsOf(day, section)));
    }
    const hasStructure = data => !!data && typeof data === 'object' && Object.keys(data).length > 0;
    const isStop = data => {
        const service = dbService();
        return !!data && (service && typeof service.isScheduleInheritanceStop === 'function'
            ? service.isScheduleInheritanceStop(data) : !!data._inheritanceStop);
    };

    // ---------- Đọc dữ liệu (cache ngắn: bảng được vẽ lại sau mỗi ô vừa sửa) ----------
    const readCache = new Map();
    async function readDoc(path, options = {}) {
        const cached = readCache.get(path);
        if (!options.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
        const [collection, id] = path.split('/');
        const value = firestore().collection(collection).doc(id).get({ source: 'server' })
            .then(snapshot => (snapshot.exists ? snapshot.data() || {} : null));
        readCache.set(path, { at: Date.now(), value });
        try { return await value; } catch (error) { readCache.delete(path); throw error; }
    }
    function invalidate() { readCache.clear(); }

    async function manifestList(branch, weekday) {
        let manifest = await readDoc(`settings/schedule_manifest_${branch}`);
        if (!manifest && branch === 'cs1') manifest = await readDoc('settings/schedule_manifest');
        const list = manifest ? (manifest[weekday] || []) : [];
        return list.filter(id => typeof id === 'string' && id.startsWith(`${branch}__`)).sort();
    }

    // Tìm cặp (ngày đích lịch riêng sắp tới ↔ lịch tuần trước của nó) liên quan tới ngày đang xem.
    async function findPairs(branch, dateKey) {
        const today = todayKey();
        const docId = `${branch}__${dateKey}`;
        const weekday = String(parseKey(dateKey).getDay());
        const list = await manifestList(branch, weekday);
        const pairs = [];
        // Ngày đang xem luôn đọc mới (vừa sửa xong là bảng vẽ lại); ngày còn lại dùng cache ngắn.
        const own = await readDoc(`schedules/${docId}`, { fresh: true });
        const viewedIsOwn = hasStructure(own) && !isStop(own);
        // (1) Ngày đang xem là lịch riêng sắp tới → so với lịch tuần trước của nó.
        if (viewedIsOwn && dateKey > today) {
            const previousId = list.filter(id => id < docId).pop();
            const previous = previousId ? await readDoc(`schedules/${previousId}`) : null;
            if (hasStructure(previous) && !isStop(previous)) {
                pairs.push({ role: 'target', targetId: docId, sourceId: previousId, target: own, source: previous });
            }
        }
        // (2) Ngày đang xem là lịch nguồn → ngày cùng thứ kế tiếp đã là lịch riêng thì không nhận.
        if (viewedIsOwn) {
            const nextId = list.find(id => id > docId);
            const nextDate = nextId ? dateOfDoc(nextId) : '';
            if (nextId && nextDate > today) {
                const next = await readDoc(`schedules/${nextId}`);
                if (hasStructure(next) && !isStop(next)) {
                    pairs.push({ role: 'source', targetId: nextId, sourceId: docId, target: next, source: own });
                }
            }
        }
        return pairs
            .map(pair => ({ ...pair, diff: diffDays(pair.source, pair.target) }))
            .filter(pair => pair.diff.count > 0);
    }

    // ---------- Ẩn nhắc ("Giữ lịch riêng") ----------
    function dismissKey(pair) { return `${pair.targetId}|${pair.sourceId}|${layoutFingerprint(pair.source)}`; }
    function readDismissed() {
        try { const value = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); return Array.isArray(value) ? value : []; }
        catch (_) { return []; }
    }
    function isDismissed(pair) { return readDismissed().includes(dismissKey(pair)); }
    function dismiss(pair) {
        try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...readDismissed(), dismissKey(pair)].slice(-60))); }
        catch (_) { /* chỉ là tiện ích hiển thị */ }
    }

    // ---------- Ghi ----------
    function newShiftId() {
        const state = shiftState();
        if (state && typeof state.stableShiftId === 'function') return state.stableShiftId({});
        return `shift_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    async function applyPair(pair) {
        const today = todayKey();
        const targetDate = dateOfDoc(pair.targetId);
        if (!(targetDate > today)) throw new Error('Chỉ lấy lại lịch cho ngày sau hôm nay.');
        const database = firestore();
        const targetRef = database.collection('schedules').doc(pair.targetId);
        const sourceRef = database.collection('schedules').doc(pair.sourceId);
        const expectedTarget = sectionsJson(pair.target);
        const expectedSource = sectionsJson(pair.source);
        await database.runTransaction(async transaction => {
            const [targetSnap, sourceSnap] = await Promise.all([transaction.get(targetRef), transaction.get(sourceRef)]);
            const target = targetSnap.exists ? targetSnap.data() || {} : null;
            const source = sourceSnap.exists ? sourceSnap.data() || {} : null;
            if (!hasStructure(target) || !hasStructure(source) ||
                sectionsJson(target) !== expectedTarget || sectionsJson(source) !== expectedSource) {
                const error = new Error('Lịch vừa được người khác sửa. Đóng và mở lại để xem khác biệt mới.');
                error.code = 'schedule/carryover-conflict';
                throw error;
            }
            const merged = mergeDay(source, target, targetDate, newShiftId);
            const { _inheritanceStop, ...rest } = target;
            const revision = Number.isInteger(target._revision) ? target._revision : 0;
            transaction.set(targetRef, {
                ...rest,
                ...merged,
                _revision: revision + 1,
                _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                _updatedBy: localStorage.getItem('currentUserId') || null,
                _carryoverFrom: { sourceDocId: pair.sourceId, at: new Date().toISOString(), by: localStorage.getItem('currentUserId') || '' }
            });
        });
        invalidate();
        const service = dbService();
        if (service && typeof service._invalidate === 'function') service._invalidate(`schedule_${pair.targetId.split('__')[0]}__`);
        try { localStorage.setItem('scheduleDataVersion', JSON.stringify({ compositeKey: pair.targetId, at: Date.now() })); } catch (_) { /* best effort */ }
    }

    // ---------- Giao diện ----------
    function injectStyles() {
        if (document.getElementById('sc-styles')) return;
        const style = document.createElement('style');
        style.id = 'sc-styles';
        style.textContent = `
            .schedule-carryover-hint { display: grid; gap: 8px; margin: 0 0 10px; }
            .sc-banner { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 12px; border-radius: 12px; font-size: 0.86rem; line-height: 1.45; background: #FFFBEB; border: 1px solid #FCD34D; color: #78350F; }
            .sc-banner > span { flex: 1 1 280px; min-width: 0; }
            .sc-banner-actions { display: flex; gap: 6px; flex-wrap: wrap; }
            .sc-banner button { min-height: 38px; padding: 0 14px; border-radius: 999px; font: inherit; font-size: 0.82rem; font-weight: 700; cursor: pointer; }
            .sc-primary { border: 1px solid #B45309; background: #B45309; color: #fff; }
            .sc-quiet { border: 1px solid #FCD34D; background: #fff; color: #92400E; }
            .sc-diff { display: grid; gap: 10px; margin: 0 0 14px; }
            .sc-diff h3 { margin: 0 0 4px; font-size: 0.84rem; font-weight: 800; color: #0F172A; }
            .sc-diff ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
            .sc-diff li { padding: 6px 10px; border-radius: 10px; font-size: 0.84rem; line-height: 1.4; background: #F8FAFC; border: 1px solid #E2E8F0; color: #334155; }
            .sc-diff li.is-add { background: #F0FDF4; border-color: #BBF7D0; }
            .sc-diff li.is-remove { background: #FEF2F2; border-color: #FECACA; }
            .sc-diff li.is-change { background: #FFFBEB; border-color: #FDE68A; }
            .sc-diff li b { font-weight: 800; }
            .sc-warn { margin: 0 0 14px; padding: 10px 12px; border-radius: 12px; background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; font-size: 0.84rem; line-height: 1.45; }
            .sc-warn ul { margin: 4px 0 0; padding-left: 1.1rem; }
            .sc-keep { margin: 0 0 14px; font-size: 0.82rem; color: #475569; line-height: 1.45; }
            .sc-actions { display: grid; gap: 8px; }
            .sc-actions .sc-quiet { min-height: 46px; border-radius: 14px; font: inherit; font-weight: 700; cursor: pointer; }
        `;
        document.head.appendChild(style);
    }

    const ICON_SYNC = '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';
    const ICON_CLOSE = '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    const KIND_LABEL = { add: 'Thêm', remove: 'Bỏ', change: 'Đổi', order: 'Thứ tự' };

    let dialogState = null;
    function closeDialog() {
        if (!dialogState) return;
        document.removeEventListener('keydown', dialogState.keyHandler);
        dialogState.root.remove();
        document.documentElement.classList.remove('ch-open');
        dialogState = null;
    }

    function openDialog(pair, onDone) {
        if (dialogState) return;
        injectStyles();
        const targetDate = dateOfDoc(pair.targetId);
        const sourceDate = dateOfDoc(pair.sourceId);
        const diffHtml = pair.diff.sections.map(section => `
            <section><h3>${escapeHtml(section.label)}</h3><ul>${section.changes.map(change => `
                <li class="is-${change.kind}"><b>${KIND_LABEL[change.kind]}:</b> ${escapeHtml(change.text.replace(/^(Thêm|Bỏ) /, ''))}</li>`).join('')}</ul></section>`).join('');
        const warnHtml = pair.diff.warnings.length
            ? `<div class="sc-warn"><b>Cần để ý:</b><ul>${pair.diff.warnings.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul></div>` : '';
        const root = document.createElement('div');
        root.className = 'ch-backdrop';
        root.innerHTML = `
            <section class="ch-sheet" role="dialog" aria-modal="true" aria-labelledby="sc-title">
                <header class="ch-head">
                    <span class="ch-head-icon" style="background:#FFFBEB;color:#B45309">${ICON_SYNC}</span>
                    <div class="ch-head-text">
                        <h2 id="sc-title">Lấy lịch ${escapeHtml(dayLabel(sourceDate))} cho ${escapeHtml(dayLabel(targetDate))}</h2>
                        <p>${escapeHtml(dayLabel(targetDate))} đang là lịch riêng nên không tự nhận thay đổi của ${escapeHtml(dayLabel(sourceDate))}.</p>
                    </div>
                    <button type="button" class="ch-close" data-sc-close aria-label="Đóng">${ICON_CLOSE}</button>
                </header>
                <div class="ch-body">
                    <p class="ch-summary" style="margin-bottom:14px">Bấm <strong>Lấy lịch ${escapeHtml(dayLabel(sourceDate))}</strong> thì ${escapeHtml(dayLabel(targetDate))} sẽ thay đổi như sau:</p>
                    <div class="sc-diff">${diffHtml}</div>
                    ${warnHtml}
                    <p class="sc-keep">Giữ nguyên của ${escapeHtml(dayLabel(targetDate))}: lớp đã tắt, GV thay thế, báo vắng, người nhận lớp, ghi chú và số HS của các lớp trùng tên. Các tuần sau sẽ kế thừa theo lịch mới này.</p>
                    <div class="sc-actions">
                        <button type="button" class="btn btn-primary ch-submit" data-sc-apply>Lấy lịch ${escapeHtml(dayLabel(sourceDate))}</button>
                        <button type="button" class="sc-quiet" data-sc-keep>Giữ lịch riêng của ${escapeHtml(dayLabel(targetDate))} (ẩn nhắc)</button>
                    </div>
                </div>
            </section>`;
        const state = { root, busy: false };
        state.keyHandler = event => { if (event.key === 'Escape' && !state.busy) closeDialog(); };
        dialogState = state;
        document.body.appendChild(root);
        document.documentElement.classList.add('ch-open');
        document.addEventListener('keydown', state.keyHandler);
        const applyButton = root.querySelector('[data-sc-apply]');
        root.addEventListener('click', async event => {
            if (state.busy) return;
            if (event.target === root || event.target.closest('[data-sc-close]')) { closeDialog(); return; }
            if (event.target.closest('[data-sc-keep]')) {
                dismiss(pair);
                closeDialog();
                uiService()?.toast?.(escapeHtml(`Đã giữ lịch riêng của ${dayLabel(targetDate)}. Nhắc sẽ hiện lại nếu ${dayLabel(sourceDate)} được sửa tiếp.`), 'success');
                onDone && onDone();
                return;
            }
            if (!event.target.closest('[data-sc-apply]')) return;
            const lockKey = `carryover:${pair.targetId}`;
            const canTrack = typeof global.beginScheduleMutation === 'function';
            if (canTrack && !global.beginScheduleMutation(lockKey)) return;
            state.busy = true;
            applyButton.disabled = true;
            applyButton.textContent = 'Đang lấy lịch…';
            let failure = null;
            try {
                await applyPair(pair);
            } catch (error) {
                failure = error;
                console.error('[ScheduleCarryover] apply', error);
            }
            state.busy = false;
            closeDialog();
            if (canTrack) await global.finishScheduleMutation(lockKey);
            const ui = uiService();
            if (failure) ui?.toast?.(escapeHtml(`Chưa lấy được lịch: ${failure.message || failure}`), 'error');
            else ui?.toast?.(escapeHtml(`${dayLabel(targetDate)} đã theo lịch ${dayLabel(sourceDate)}.`), 'success');
            onDone && onDone();
        });
        root.querySelector('[data-sc-close]').focus();
    }

    function isScheduleManager() {
        let roles = [];
        try {
            const raw = localStorage.getItem('currentRole');
            roles = typeof global.parseRoles === 'function' ? global.parseRoles(raw) : JSON.parse(raw || '[]');
        } catch (_) {
            roles = [localStorage.getItem('currentRole')];
        }
        return (Array.isArray(roles) ? roles : [roles]).some(role => ['admin', 'assistant', 'senior_assistant'].includes(role));
    }

    function bannerText(pair) {
        const targetDate = dateOfDoc(pair.targetId);
        const sourceDate = dateOfDoc(pair.sourceId);
        const n = pair.diff.count;
        return pair.role === 'target'
            ? `<b>${escapeHtml(dayLabel(targetDate))} là lịch riêng</b> nên không nhận các thay đổi ở <b>${escapeHtml(dayLabel(sourceDate))}</b> — đang khác ${n} chỗ.`
            : `Thay đổi ở ngày này <b>không tự sang ${escapeHtml(dayLabel(targetDate))}</b> vì ngày đó đã có lịch riêng — đang khác ${n} chỗ.`;
    }

    let renderToken = 0;
    async function renderHint(dayData, dateKey) {
        const token = ++renderToken;
        const table = document.getElementById('schedule-table');
        const existing = document.getElementById('schedule-carryover-hint');
        const branch = typeof currentBranch !== 'undefined' ? currentBranch : global.currentBranch;
        if (!table || !table.parentNode || !isScheduleManager() || !firestore() || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || '')) || !branch) {
            if (existing) existing.remove();
            return;
        }
        const viewKey = `${branch}__${dateKey}`;
        if (existing && existing.dataset.viewKey !== viewKey) existing.remove(); // nhắc của ngày khác
        let pairs = [];
        try {
            pairs = (await findPairs(branch, dateKey)).filter(pair => !isDismissed(pair));
        } catch (error) {
            console.warn('[ScheduleCarryover] hint', error);
            pairs = [];
        }
        if (token !== renderToken) return;
        let hint = document.getElementById('schedule-carryover-hint');
        if (!pairs.length) { if (hint) hint.remove(); return; }
        injectStyles();
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'schedule-carryover-hint';
            hint.className = 'schedule-carryover-hint';
            hint.setAttribute('role', 'status');
            hint.dataset.viewKey = viewKey;
            table.parentNode.insertBefore(hint, table);
        }
        hint.innerHTML = pairs.map((pair, index) => `
            <div class="sc-banner"><span>${bannerText(pair)}</span>
                <div class="sc-banner-actions"><button type="button" class="sc-primary" data-sc-open="${index}">${pair.role === 'target'
                    ? `Xem &amp; lấy lịch ${escapeHtml(dayLabel(dateOfDoc(pair.sourceId)))}`
                    : `Xem &amp; áp dụng sang ${escapeHtml(dayLabel(dateOfDoc(pair.targetId)))}`}</button></div></div>`).join('');
        hint.querySelectorAll('[data-sc-open]').forEach(button => {
            button.onclick = () => openDialog(pairs[Number(button.dataset.scOpen)], () => {
                invalidate();
                if (typeof global.renderTable === 'function') global.renderTable();
                else if (typeof renderTable === 'function') renderTable();
            });
        });
    }

    global.ScheduleCarryover = { renderHint, invalidate, _test: { matchRows, diffDays, mergeDay, layoutFingerprint, findPairs, applyPair } };
    global.renderScheduleCarryoverHint = renderHint;
})(typeof window !== 'undefined' ? window : globalThis);
