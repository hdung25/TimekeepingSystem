// payslip-schedule-core.js — Hẹn giờ gửi bảng lương (yêu cầu chủ trung tâm 07/10/2026:
// "tối nay chị tạo lệnh gửi bảng lương nhưng ngày 10 Tây nó mới gửi").
//
// Một lệnh hẹn = 1 tài liệu payslip_publish_schedules/{id}:
//   { month, runAt, runAtMs, status: scheduled|running|done|failed|cancelled,
//     targets: [{ staffId, name, gv, tt }], message, createdBy*, result }
// Đến giờ, Cloud Function (mỗi 5 phút) — hoặc máy Admin đang mở trang Lương nếu function chưa
// chạy — "nhận" lệnh bằng transaction rồi gửi ĐÚNG bản tính đang lưu lúc đó, với cùng luật như
// nút Gửi bảng lương (_preparePayslipComponentPublish): phần nhân viên đã xác nhận nhận lương
// giữ nguyên, phần chưa tính thì bỏ qua. Không ai sửa được số tiền qua lệnh hẹn.
//
// Dùng chung cho trình duyệt (firebase compat) và Cloud Functions (firebase-admin): cả hai có
// cùng API collection/doc/runTransaction/where/add. Bản sao ở functions/shared phải giống hệt.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PayslipScheduleCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const COLLECTION = 'payslip_publish_schedules';
    const STALE_RUN_MS = 20 * 60 * 1000;
    const MAX_TARGETS = 300;
    const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

    function normalizeTargets(list) {
        const byId = new Map();
        (Array.isArray(list) ? list : []).forEach(raw => {
            const staffId = String(raw?.staffId || raw?.id || '').trim();
            if (!ID_PATTERN.test(staffId)) return;
            const old = byId.get(staffId) || { staffId, name: '', gv: false, tt: false };
            byId.set(staffId, {
                staffId,
                name: String(raw?.name || old.name || '').slice(0, 120),
                gv: old.gv || raw?.gv === true,
                tt: old.tt || raw?.tt === true
            });
        });
        return Array.from(byId.values()).filter(item => item.gv || item.tt).slice(0, MAX_TARGETS);
    }

    function isDue(data, nowMs) {
        if (!data) return false;
        if (data.status === 'scheduled') return Number(data.runAtMs) <= nowMs;
        // Một lượt chạy bị ngắt giữa chừng (mất mạng, function hết giờ) được nhận lại sau 20 phút.
        // Gửi lại là an toàn: phần đã gửi giữ nguyên ngày gửi, phần đã nhận không bị đụng.
        if (data.status === 'running') return nowMs - (Date.parse(data.startedAt || '') || 0) > STALE_RUN_MS;
        return false;
    }

    function monthLabel(monthStr) {
        const [year, month] = String(monthStr || '').split('-');
        return `${Number(month)}/${year}`;
    }

    async function claim(db, ref, nowMs, runner) {
        return db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            const data = snapshot.exists ? snapshot.data() : null;
            if (!isDue(data, nowMs)) return null;
            transaction.update(ref, {
                status: 'running',
                startedAt: new Date(nowMs).toISOString(),
                runner: String(runner || 'unknown').slice(0, 40),
                attempts: (Number(data.attempts) || 0) + 1
            });
            return data;
        });
    }

    async function publishTarget(db, lifecycle, monthStr, target, message, nowIso) {
        const ref = db.collection('salary_settings_monthly').doc(`${monthStr}_${target.staffId}`);
        let transition = null;
        await db.runTransaction(async transaction => {
            transition = null;
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists) return;
            const data = snapshot.data() || {};
            if (data.consultationFeePending && target.tt) {
                throw new Error('Phí tư vấn đã thay đổi — cần Lưu & Tính phần Tiếp Tân trước khi gửi.');
            }
            transition = lifecycle.preparePayslipComponentPublish(data.published || {}, { gv: target.gv, tt: target.tt }, nowIso);
            if (!transition.publishedComponents.length) return;
            if (String(message || '').trim()) transition.published.message = String(message).trim();
            transaction.update(ref, { published: transition.published });
        });
        return {
            staffId: target.staffId,
            name: target.name,
            published: transition ? transition.publishedComponents : [],
            locked: transition ? transition.lockedComponents : [],
            skipped: transition ? transition.skippedComponents : ['gv', 'tt'].filter(key => target[key])
        };
    }

    function notification(target, monthStr, components, serverTimestamp) {
        const part = components.length === 1 ? (components[0] === 'tt' ? ' (phần Tiếp Tân / Văn Phòng)' : ' (phần Giảng dạy)') : '';
        return {
            staffId: target.staffId,
            staffName: target.name || 'N/A',
            action: 'payslip_published',
            dateKey: monthStr,
            details: `Bảng lương tháng ${monthLabel(monthStr)}${part} đã được gửi. Vui lòng xem và bấm xác nhận đã nhận lương.`,
            title: 'Đã có bảng lương',
            link: 'nhan-vien.html',
            adminName: 'Hẹn giờ gửi lương',
            read: false,
            createdAt: serverTimestamp()
        };
    }

    // options: { lifecycle, now: Date, serverTimestamp: () => sentinel, runner, onlyId?, logger? }
    async function runDueSchedules(db, options) {
        const lifecycle = options.lifecycle;
        const nowMs = (options.now || new Date()).getTime();
        const logger = options.logger || console;
        const snapshot = await db.collection(COLLECTION).where('status', 'in', ['scheduled', 'running']).get();
        const reports = [];
        for (const doc of snapshot.docs) {
            if (options.onlyId && doc.id !== options.onlyId) continue;
            if (!isDue(doc.data(), nowMs)) continue;
            const data = await claim(db, doc.ref, nowMs, options.runner);
            if (!data) continue;
            const monthStr = String(data.month || '');
            const targets = normalizeTargets(data.targets);
            const nowIso = new Date(nowMs).toISOString();
            const results = [];
            for (const target of targets) {
                try {
                    const result = await publishTarget(db, lifecycle, monthStr, target, data.message, nowIso);
                    results.push(result);
                    if (result.published.length) {
                        await db.collection('admin_notifications')
                            .add(notification(target, monthStr, result.published, options.serverTimestamp))
                            .catch(error => logger.warn('[payslip-schedule] notification failed', target.staffId, error.message));
                    }
                } catch (error) {
                    results.push({ staffId: target.staffId, name: target.name, published: [], locked: [], skipped: [], error: String(error.message || error).slice(0, 200) });
                }
            }
            const count = key => results.reduce((sum, item) => sum + (item[key] ? item[key].length : 0), 0);
            const failed = results.filter(item => item.error);
            const summary = {
                published: count('published'),
                locked: count('locked'),
                skipped: count('skipped'),
                failed: failed.length,
                failures: failed.slice(0, 50).map(item => ({ staffId: item.staffId, name: item.name, error: item.error })),
                skippedStaff: results.filter(item => item.skipped.length).slice(0, 100).map(item => item.name || item.staffId)
            };
            await doc.ref.update({
                status: failed.length && failed.length === results.length ? 'failed' : 'done',
                finishedAt: new Date().toISOString(),
                result: summary
            });
            reports.push({ id: doc.id, month: monthStr, ...summary });
        }
        return reports;
    }

    return { COLLECTION, STALE_RUN_MS, normalizeTargets, isDue, runDueSchedules };
});
