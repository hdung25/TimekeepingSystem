/* Pure monthly teacher policy. Only explicit Admin application creates a draft. */
(function (global) {
    'use strict';
    const version = 'teacher-attendance-20260909-v1';
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
            const map = { present: [1000, 30000], permitted: [-1000, 30000], unpermitted: [-2000, 50000], none: [0, 0] };
            if (!map[input.meeting]) throw new Error('Chọn kết quả tham gia họp tháng.');
            const [rate, min] = map[input.meeting];
            add(9, rate, `Họp tháng: ${{ present: 'đầy đủ', permitted: 'vắng có phép', unpermitted: 'vắng không phép', none: 'không có họp áp dụng' }[input.meeting]}`, hours, min);
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
            if (chip.isReceptionist || ['tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant', 'receptionist_lead', 'receptionist_staff', 'office_staff'].includes(chip.sessionData?.role)) return;
            if (chip.isAbsence || chip.absenceType || chip.isVDX || /(?:^|\s)chip-(?:gray|red)(?:\s|$)/.test(chip.class || '')) {
                const type = classify(chip);
                // An unrecorded grey absence is distinct from an explicit unauthorized absence.
                const explicit = chip.absenceType || chip.absenceState === 'VKP' || chip.absenceStateSource === 'teacher-absence' || chip.absenceEvidence;
                source[type === 'VP' ? 'vp' : type === 'VDX' ? 'vdx' : explicit ? 'vkp' : 'unreported']++;
            } else if (chip.isTeaching || chip.sessionData?.role) source.minutes += Math.max(0, Number(chip.paidMinutes) || 0);
            source.lateMinutes += Number(/\(T(\d+)p\)/.exec(chip.text || '')?.[1] || 0);
        });
        return source;
    }
    global.TeacherAttendancePolicy = { version, calculate, sourceFromChips };
    if (typeof module !== 'undefined' && module.exports) module.exports = global.TeacherAttendancePolicy;
})(typeof window !== 'undefined' ? window : globalThis);
