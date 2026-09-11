/* Pure monthly teacher calculations. No database writes or payslip publication. */
(function (global) {
    'use strict';
    const version = 'teacher-attendance-excel-20260909-v2';
    const hoursBonusVersion = 'teacher-hours-bonus-20260910-v1';
    const DEFAULT_HOURS_BONUS_TIERS = [
        { minHours: 50, rate: 1000 },
        { minHours: 65, rate: 2000 },
        { minHours: 80, rate: 3000, strictlyAbove: true }
    ];

    function normalizeHoursBonusTiers(settings = {}) {
        const policyInput = settings?.teacherAttendancePolicy?.input || settings?.input || {};
        const configured = settings?.hoursBonusPolicy || settings?.hours_bonus || policyInput.hoursBonusPolicy;
        const rawTiers = Array.isArray(configured?.tiers) ? configured.tiers : DEFAULT_HOURS_BONUS_TIERS;
        const tiers = rawTiers.map(tier => ({
            minHours: Number(tier?.minHours ?? tier?.hours ?? tier?.threshold),
            rate: Number(tier?.rate ?? tier?.amount ?? tier?.bonusRate),
            strictlyAbove: tier?.strictlyAbove === true
        })).filter(tier => Number.isFinite(tier.minHours) && tier.minHours >= 0 &&
            Number.isFinite(tier.rate) && tier.rate >= 0)
            .sort((a, b) => a.minHours - b.minHours);
        return tiers.length ? tiers : DEFAULT_HOURS_BONUS_TIERS;
    }

    // Criterion IX is a monthly teaching-hours bonus, separate from criterion I.
    // It is automatic for old-mode teachers unless an already-saved policy explicitly
    // disables it. A manually entered criterion IX row remains authoritative in UI.
    function automaticHoursBonus(mode, source, settings = {}) {
        if (mode !== 'old') return null;
        const policyInput = settings?.teacherAttendancePolicy?.input || settings?.input || {};
        const configured = settings?.hoursBonusPolicy || settings?.hours_bonus || policyInput.hoursBonusPolicy;
        // Legacy teacherAttendancePolicy.input.hoursBonus/hourCondition belonged to
        // the removed manual apply gate. Only the explicit monthly policy switch can
        // disable the now-automatic criterion IX.
        if (configured?.enabled === false) return null;

        const minutes = number(source?.minutes, 'Số phút');
        const hours = minutes / 60;
        const tiers = normalizeHoursBonusTiers(settings);
        let selected = null;
        tiers.forEach(tier => {
            const reached = tier.strictlyAbove ? hours > tier.minHours : hours >= tier.minHours;
            if (reached) selected = tier;
        });
        const rate = selected?.rate || 0;
        const amount = Math.round(hours * rate) || 0;
        if (!Number.isSafeInteger(amount)) throw new Error('Số tiền vượt giới hạn hợp lệ.');
        const tierText = tiers.map(tier =>
            (tier.strictlyAbove ? '>' : '≥') + tier.minHours + 'h: ' +
            tier.rate.toLocaleString('vi-VN') + 'đ/h'
        ).join(' · ');
        return {
            id: 8,
            amount,
            rate,
            hours,
            manual: false,
            automatic: hoursBonusVersion,
            note: 'Thưởng tổng giờ tự động: ' +
                hours.toLocaleString('vi-VN', { maximumFractionDigits: 4 }) +
                ' giờ × ' + rate.toLocaleString('vi-VN') + 'đ/giờ; ' + tierText + '.'
        };
    }
    // Owner-approved BẢNG LƯƠNG TG!AR4 formula. Keep the exact Excel
    // priorities and boundaries, including >64.99 for two permitted absences.
    function automaticAttendance(mode, source, rate) {
        const hours = number(source.minutes, 'Số phút') / 60;
        const vp = number(source.vp, 'Vắng phép');
        const vdx = number(source.vdx, 'Vắng đột xuất') + number(source.unreported, 'Chưa cập nhật');
        const vkp = number(source.vkp, 'Vắng không phép');
        let appliedRate;
        if (mode === 'new') appliedRate = number(rate, 'Đơn giá chuyên cần');
        else if (mode === 'old') {
            appliedRate = vkp > 0 ? -3000 : vdx > 0 ? -2000 : vp > 0 && hours < 50 ? -1000
                : vp === 0 ? (hours < 65 ? 1000 : 2000)
                : vp === 1 ? (hours < 50 ? 0 : hours < 65 ? 1000 : 2000)
                : vp === 2 ? (hours > 64.99 ? 2000 : 0) : 0;
        } else return null;
        const amount = Math.round(hours * appliedRate) || 0;
        if (!Number.isSafeInteger(amount)) throw new Error('Số tiền vượt giới hạn hợp lệ.');
        return {id:0, amount, rate:appliedRate, hours, manual:false, automatic:version,
            note:`Chuyên cần tự động: ${hours.toLocaleString('vi-VN', {maximumFractionDigits:4})} giờ × ${appliedRate.toLocaleString('vi-VN')}đ/giờ; VP ${vp}, VĐX ${vdx}, VKP ${vkp}${source.unreported ? ` (gồm ${source.unreported} ca chưa cập nhật)` : ''}.`};
    }
    function number(value, label) {
        if (value === '' || value == null || !Number.isFinite(Number(value)) || Number(value) < 0)
            throw new Error(`${label}: nhập số không âm.`);
        return Number(value);
    }
    function calculate(input, source) {
        const hours = number(source.minutes, 'Số phút') / 60;
        const rows = [];
        const add = (id, rate, note, basis = hours, minimum = 0) => {
            const amount = Math.round(rate === 0 ? 0 : Math.sign(rate) * Math.max(Math.abs(rate * basis), minimum));
            if (!Number.isSafeInteger(amount)) throw new Error('Số tiền vượt giới hạn hợp lệ.');
            rows.push({ id, amount, note: `${note}; ${basis.toLocaleString('vi-VN', { maximumFractionDigits: 4 })} giờ × ${rate.toLocaleString('vi-VN')}đ${minimum ? `; tối thiểu ${minimum.toLocaleString('vi-VN')}đ` : ''}`, manual: true });
        };
        if (input.mode === 'new') {
            add(0, number(input.rate, 'Đơn giá chuyên cần'), 'Chuyên cần chế độ mới');
            return { version, rows, hours };
        }
        if (input.mode !== 'old') throw new Error('Phân loại chế độ giáo viên tại Nhân sự trước khi sử dụng bộ tính.');
        if (!input.eligible) throw new Error('Cần xác nhận giáo viên đã làm việc từ 3 tháng trong tháng xét lương.');
        if (input.attendance) {
            if (!input.fixed) throw new Error('Cần xác nhận có ca dạy cố định để xét chuyên cần.');
            const absence = source.vp + source.vdx + source.vkp + source.unreported;
            let reward = absence < 3 && hours > 65 ? 2000 : absence <= 1 && hours > 50 ? 1000 : 0;
            let penalty = 0;
            if (absence > 0) {
                if (!['highest', 'each', 'none'].includes(input.absenceRule)) throw new Error('Chọn cách áp dụng phạt vắng.');
                if (input.absenceRule === 'highest') penalty = source.vkp ? 3000 : (source.vdx + source.unreported) ? 2000 : 1000;
                if (input.absenceRule === 'each') penalty = source.vp * 1000 + (source.vdx + source.unreported) * 2000 + source.vkp * 3000;
                if (!['both', 'penaltyOnly'].includes(input.rewardRule)) throw new Error('Chọn có cộng thưởng khi có phạt vắng hay không.');
                if (input.rewardRule === 'penaltyOnly' && penalty) reward = 0;
            }
            add(0, reward - penalty, `Chuyên cần cũ: VP ${source.vp}, VĐX ${source.vdx}, VKP ${source.vkp}, chưa cập nhật ${source.unreported}; thưởng ${Math.round(reward * hours).toLocaleString('vi-VN')}đ (${reward}đ/giờ), phạt ${Math.round(penalty * hours).toLocaleString('vi-VN')}đ (${penalty}đ/giờ); ${input.absenceRule || 'không vắng'}`);
        }
        if (input.hoursBonus) {
            if (!input.hoursCondition) throw new Error('Cần xác nhận điều kiện nghỉ để xét thưởng tổng giờ.');
            add(8, hours > 80 ? 3000 : hours >= 65 ? 2000 : hours >= 50 ? 1000 : 0, 'Thưởng tổng giờ dạy');
        }
        if (input.meetingEnabled) {
            const map = { present: 1000, permitted: -1000, unpermitted: -2000, none: 0 };
            if (!Object.prototype.hasOwnProperty.call(map, input.meeting)) throw new Error('Chọn kết quả tham gia họp tháng.');
            const amount = map[input.meeting];
            rows.push({ id: 9, amount, manual: true,
                note: `Họp tháng: ${{ present: 'đầy đủ +1.000đ', permitted: 'vắng có phép -1.000đ', unpermitted: 'vắng không phép -2.000đ', none: 'không có họp áp dụng 0đ' }[input.meeting]}` });
        }
        const selectedRate = (key, allowed) => {
            const rate = Number(input[key]);
            if (!allowed.includes(rate)) throw new Error('Mức thưởng/phạt không hợp lệ.');
            return rate;
        };
        if (input.lateEnabled) add(1, -selectedRate('lateRate', [0, 1000, 2000, 3000, 4000, 5000]), 'Phạt trễ bổ sung; không trừ giờ lần hai');
        if (input.focusEnabled) add(2, -number(input.focusRate, 'Phạt làm việc riêng') * number(input.focusCount, 'Số lần'), `Làm việc riêng ${input.focusCount} lần`);
        if (input.enthusiasmEnabled) add(3, selectedRate('enthusiasmRate', [0, 1000, 2000]), 'Nhiệt tình: Admin đánh giá');
        if (input.responsibilityEnabled) add(4, selectedRate('responsibilityRate', [0, 1000, 2000, -1000, -2000]), 'Trách nhiệm/tác phong/đồng phục: Admin đánh giá');
        if (input.preparationEnabled) {
            if (!String(input.subject || '').trim()) throw new Error('Nhập môn/lớp được đánh giá soạn bài.');
            const subjectHours = number(input.subjectHours, 'Giờ dạy môn soạn bài');
            if (subjectHours > hours) throw new Error('Giờ môn soạn bài vượt tổng giờ dạy.');
            add(5, selectedRate('preparationRate', [0, 1000, 2000, 3000, 4000, -1000, -2000, -3000]), `Soạn bài: ${input.subject}`, subjectHours);
        }
        if (!rows.length) throw new Error('Chọn ít nhất một tiêu chí để tính.');
        return { version, rows, hours };
    }
    function sourceFromChips(chips, classify) {
        const source = { minutes: 0, vp: 0, vdx: 0, vkp: 0, unreported: 0, lateMinutes: 0 };
        chips.forEach(chip => {
            if (chip.isCenterOff || chip.isCancelled || chip.absenceStateSource === 'cancellation' || /(?:^|\s)chip-future(?:\s|$)/.test(chip.class || '')) return;
            if (chip.isReceptionist || chip.isOffice || ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff', 'office_staff', 'van-phong', 'van_phong'].includes(chip.sessionData?.role)) return;
            if (chip.isAbsence || chip.isAbsent || chip.absenceType || chip.isVDX || /(?:^|\s)chip-(?:gray|red)(?:\s|$)/.test(chip.class || '')) {
                const type = classify(chip);
                // An unrecorded grey absence is distinct from an explicit unauthorized absence.
                const explicit = chip.absenceType || chip.absenceState === 'VKP' || chip.absenceStateSource === 'teacher-absence' || chip.absenceEvidence;
                source[type === 'VP' ? 'vp' : type === 'VDX' ? 'vdx' : explicit ? 'vkp' : 'unreported']++;
            } else if (chip.isTeaching || chip.sessionData?.role) source.minutes += Math.max(0, Number(chip.paidMinutes) || 0);
            source.lateMinutes += Number(/\(T(\d+)p\)/.exec(chip.text || '')?.[1] || 0);
        });
        return source;
    }
    global.TeacherAttendancePolicy = {
        version,
        hoursBonusVersion,
        DEFAULT_HOURS_BONUS_TIERS,
        calculate,
        sourceFromChips,
        automaticAttendance,
        automaticHoursBonus,
        normalizeHoursBonusTiers
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = global.TeacherAttendancePolicy;
})(typeof window !== 'undefined' ? window : globalThis);
