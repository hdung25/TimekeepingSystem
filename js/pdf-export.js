// ================= EXPORT PDF (CUSTOM FORM) =================
// Extracted from report.js — Incremental Refactoring (22/02/2026)
// Dependencies (global scope from report.js):
//   - EVALUATION_CRITERIA, calculateSalary(), removeVietnameseTones(), currentDate
//   - window.currentMonthChips, window.currentMonthSalary

function togglePdfTieptanInputs() {
    const filterType = document.getElementById('salary-role-filter')?.value;
    const box = document.getElementById('pdf-tieptan-inputs');
    if (box) box.style.display = (filterType === 'tiep-tan') ? 'block' : 'none';
}
window.togglePdfTieptanInputs = togglePdfTieptanInputs;
function exportSalaryPDF(overrides) {
    // 1. Get Data
    const staffSelect = document.getElementById('staff-select');
    const staffId = staffSelect.value;
    const staffName = staffSelect.options[staffSelect.selectedIndex].text.split('(')[0].trim();
    if (staffId === 'all') { alert("Vui lòng chọn nhân viên để xuất file"); return; }

    // Read values either from overrides (Modal) or fallbacks (Main screen)
    const advance = overrides && overrides.customAdvance !== undefined
        ? overrides.customAdvance
        : (parseFloat(document.getElementById('salary-advance')?.value) || 0);

    let totalBonus = 0;
    let evalItems = [];
    
    if (overrides && overrides.customEvalItems) {
        evalItems = overrides.customEvalItems;
        totalBonus = evalItems.reduce((acc, i) => acc + i.amount, 0);
    } else {
        document.querySelectorAll('.eval-amount').forEach((inp, idx) => {
            const val = parseFloat(inp.value) || 0;
            totalBonus += val;
            const noteInp = document.querySelector(`.eval-note[data-index="${idx}"]`);
            const item = EVALUATION_CRITERIA[idx];
            const displayNote = noteInp ? noteInp.value : '';
            
            evalItems.push({
                label: item.label,
                title: item.tooltip,
                note: displayNote,
                amount: val
            });
        });
    }

    calculateSalary();

    const filterType = overrides && overrides.customFilterType
        ? overrides.customFilterType
        : (document.getElementById('salary-role-filter') ? document.getElementById('salary-role-filter').value : 'all');
    const chips = window.currentMonthChips || [];
    let normalMinutes = 0;
    let fixedMinutes = 0;
    let normalSalary = 0;
    let fixedSalary = 0;

    // Detailed hour/salary categories for Teacher (Form 1)
    let totalBaseMins = 0;
    let totalBaseSalary = 0;

    let totalTinHocMins = 0;
    let totalTinHocSalary = 0;

    let totalPreschoolMins = 0; // Mầm non
    let totalPreschoolSalary = 0;

    let totalAffiliateMins = 0; // Liên kết
    let totalAffiliateSalary = 0;

    let totalTutoringMins = 0; // Kèm 1:1
    let totalTutoringSalary = 0;

    let totalExtraMins = 0; // Soạn bài/Chấm bài...
    let totalExtraSalary = 0;

    chips.forEach(chip => {
        const isReceptionistChip = chip.isReceptionist === true;
        if (!chip.sessionData && !isReceptionistChip) return;
        let include = false;
        if (filterType === 'all') {
            include = true;
        } else if (filterType === 'giao-vien') {
            const roleId = chip.sessionData ? (chip.sessionData.role || '') : '';
            const nameRaw = chip.sessionData ? ((chip.sessionData.roleName || '').toLowerCase()) : '';
            const name = removeVietnameseTones(nameRaw);
            const isReceptionID = ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(roleId);
            
            if (isReceptionID || name.includes('tiep') || name.includes('le') || name.includes('reception')) {
                include = false;
            } else if (chip.isTeaching || name.includes('gv') || name.includes('giao') || name.includes('tro') || name.includes('ta')) {
                include = true;
            }
        } else if (filterType === 'tiep-tan') {
            if (isReceptionistChip) {
                include = true;
            } else {
                const roleId = chip.sessionData ? (chip.sessionData.role || '') : '';
                const nameRaw = chip.sessionData ? ((chip.sessionData.roleName || '').toLowerCase()) : '';
                const name = removeVietnameseTones(nameRaw);
                const isReceptionID = ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(roleId);

                if (isReceptionID || name.includes('tiep') || name.includes('le') || name.includes('reception')) {
                    include = true;
                }
            }
        }

        if (include) {
            const minutes = chip.paidMinutes || 0;
            
            let rate = 0;
            let hasClassRate = false;
            
            const isTiepTan = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
            const monthlyAll = window.currentMonthlySalarySettingsAll || {};
            const cfg = window.currentUserContext?.salary_config || {};
            
            let classRates = {};
            if (isTiepTan) {
                const ttMonthly = monthlyAll['tiep_tan'] || monthlyAll['tiep-tan'] || {};
                classRates = ttMonthly.class_rates || cfg.class_rates || {};
            } else {
                const gvMonthly = monthlyAll['giao_vien'] || monthlyAll['giao-vien'] || {};
                classRates = gvMonthly.class_rates || cfg.class_rates || {};
            }
            
            if (chip.chipFilterName && classRates[chip.chipFilterName] !== undefined && Number(classRates[chip.chipFilterName]) > 0) {
                rate = Number(classRates[chip.chipFilterName]);
                hasClassRate = true;
            }

            let isFixed = false;
            
            if (!hasClassRate) {
                if (chip.sessionData && chip.sessionData.roleRate) {
                    rate = Number(chip.sessionData.roleRate);
                }
                if (window.currentUserContext && window.currentUserContext.salary_config) {
                     if (isTiepTan) {
                          let fixedRate = classRates["Tiếp Tân (Ca Cố Định)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Cố Định)"]) : Number(cfg.receptionist_fixed_rate || 0);
                          let normalRate = classRates["Tiếp Tân (Ca Bình Thường)"] !== undefined ? Number(classRates["Tiếp Tân (Ca Bình Thường)"]) : Number(cfg.receptionist_normal_rate || 0);
                          if (chip.isFixedShift && fixedRate) {
                              rate = fixedRate;
                              isFixed = true;
                          } else if (normalRate) {
                              rate = normalRate;
                          }
                     }
                }
            }

            const salary = (minutes / 60) * rate;

            if (isFixed) {
                 fixedMinutes += minutes;
                 fixedSalary += salary;
            } else {
                 normalMinutes += minutes;
                 normalSalary += salary;
            }

            // Categorize hours for Teacher
            if (!isTiepTan) {
                const filterNameRaw = (chip.chipFilterName || '').toLowerCase();
                const filterNameNorm = removeVietnameseTones(filterNameRaw);

                if (filterNameNorm.includes('tin hoc')) {
                    totalTinHocMins += minutes;
                    totalTinHocSalary += salary;
                } else if (filterNameNorm.includes('mam non')) {
                    totalPreschoolMins += minutes;
                    totalPreschoolSalary += salary;
                } else if (filterNameNorm.includes('lien ket')) {
                    totalAffiliateMins += minutes;
                    totalAffiliateSalary += salary;
                } else if (filterNameNorm.includes('kem 1:1') || filterNameNorm.includes('kem 1-1') || filterNameNorm.includes('tai nha')) {
                    totalTutoringMins += minutes;
                    totalTutoringSalary += salary;
                } else if (filterNameNorm.includes('soan') || filterNameNorm.includes('cham') || filterNameNorm.includes('su kien') || filterNameNorm.includes('phat sinh')) {
                    totalExtraMins += minutes;
                    totalExtraSalary += salary;
                } else {
                    totalBaseMins += minutes;
                    totalBaseSalary += salary;
                }
            }
        }
    });

    const filteredMinutes = normalMinutes + fixedMinutes;
    const baseSalary = normalSalary + fixedSalary;

    // Calculate Attendance Stats dynamically from unfilteredAllMonthChips
    let workedShifts = 0;
    let vpShifts = 0;
    let vdxShifts = 0;
    let vkpShifts = 0;
    let lateCount = 0;
    let totalLateMinutes = 0;

    const unfilteredChips = window.unfilteredAllMonthChips || [];
    const notesMap = typeof _cachedStaffNotes !== 'undefined' ? _cachedStaffNotes : {};
    unfilteredChips.forEach(chip => {
        if (chip.class === 'chip-future') return;
        
        const isTT = chip.isReceptionist || (chip.sessionData && ['tiep-tan', 'receptionist', 'receptionist_assistant', 'senior_assistant', 'assistant'].includes(chip.sessionData.role));
        if (filterType === 'tiep-tan' && !isTT) return;
        if (filterType === 'giao-vien' && isTT) return;
        
        if (chip.class === 'chip-gray' || chip.isVDX || chip.class === 'chip-red') {
            const type = classifyAbsentChip(chip, notesMap);
            if (type === 'VP') vpShifts++;
            else if (type === 'VDX') vdxShifts++;
            else vkpShifts++;
        } else {
            workedShifts++;
        }
        
        const match = chip.text.match(/\(T(\d+)p\)/);
        if (match) {
            lateCount++;
            totalLateMinutes += parseInt(match[1], 10);
        }
    });

    // Apply custom attendance adjustments (penalties) if provided
    let penaltyVDX = 0;
    let penaltyVKP = 0;
    let penaltyLate = 0;
    if (overrides && overrides.customPenalties) {
        penaltyVDX = overrides.customPenalties.vdx || 0;
        penaltyVKP = overrides.customPenalties.vkp || 0;
        penaltyLate = overrides.customPenalties.late || 0;
    }

    const attendanceAdjustments = - penaltyVDX - penaltyVKP - penaltyLate;
    const initialTotal = baseSalary + totalBonus + attendanceAdjustments;
    const finalNet = initialTotal - advance;

    const month = currentDate.getMonth() + 1;
    const year = currentDate.getFullYear();

    const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n));

    // Decimal hour formatting helpers
    const formatHoursDecimal = (mins) => {
        const h = mins / 60;
        if (Number.isInteger(h)) return h.toString() + ' giờ';
        return h.toFixed(2).replace('.', ',') + ' giờ';
    };

    const formatLateHours = (mins) => {
        if (!mins) return '0';
        const hours = mins / 60;
        const formatted = hours.toFixed(2).replace('.', ',');
        return formatted.startsWith('0,') ? formatted.substring(1) : formatted;
    };

    // 2. Build HTML
    const printWindow = window.open('', '_blank');
    const msgVal = document.getElementById('pdf-message')?.value?.trim() || '';
    const messageRow = msgVal
        ? `<div class="footer-note" style="margin-top: 10px;"><strong>Nhắn gửi:</strong> ${msgVal}</div>`
        : '';

    const sharedStyles = `
        body { font-family: 'Times New Roman', serif; padding: 10px 15px; margin: 0; font-size: 11.5px; line-height: 1.25; color: black; }
        .header { text-align: center; font-weight: bold; margin-bottom: 5px; text-transform: uppercase; font-size: 14.5px; }
        .sub-header { margin-bottom: 10px; font-weight: bold; font-size: 11px; text-align: left; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
        th, td { border: 1px solid black; padding: 5px 8px; vertical-align: middle; font-size: 11px; color: black; }
        .red-text { color: red; font-weight: bold; }
        .bold { font-weight: bold; }
        .right { text-align: right; }
        .center { text-align: center; }
        .footer-note { font-style: italic; margin-top: 8px; font-size: 10px; }
        .warning { color: red; font-weight: bold; margin-top: 5px; font-size: 10px; }
        @media print {
            body { padding: 0; margin: 0; font-size: 10px; line-height: 1.2; }
            .header { margin-bottom: 4px; font-size: 13px; }
            table { margin-bottom: 6px; }
            th, td { padding: 4px 6px; font-size: 10px; }
            .footer-note, .warning { font-size: 9px; margin-top: 4px; }
        }
    `;

    const footerNote = `<div class="footer-note">Lưu ý: Nếu bảng lương có sai sót vui lòng liên hệ chị Thủy (bộ phận nhân sự) vào sáng giờ hành chính (7h-11h)</div>`;
    const sharedFooter = filterType === 'tiep-tan'
        ? `${footerNote}${messageRow}`
        : `${footerNote}${messageRow}<div class="warning">*LƯU Ý: - Lương tháng ${month}/${year} chưa bao gồm phí soạn bài bên chị Tiên, phí soạn bài vui lòng liên hệ chị Tiên!</div>`;

    let tableHTML = '';

    if (filterType === 'tiep-tan') {
        const phiTuVan = parseFloat(document.getElementById('pdf-phi-tu-van')?.value) || 0;
        const doanhThuTong = parseFloat(document.getElementById('pdf-doanh-thu-tong')?.value) || 0;
        const doanhThuCs2 = parseFloat(document.getElementById('pdf-doanh-thu-cs2')?.value) || 0;
        const doanhThuCs3 = parseFloat(document.getElementById('pdf-doanh-thu-cs3')?.value) || 0;

        const totalExtras = phiTuVan + doanhThuTong + doanhThuCs2 + doanhThuCs3;
        const totalI = baseSalary + totalExtras + totalBonus + attendanceAdjustments;
        const finalNetTT = totalI - advance;

        const criteriaI = evalItems[0];
        const criteriaV = evalItems[4];

        const penaltiesHtml = (penaltyVDX !== 0 || penaltyVKP !== 0 || penaltyLate !== 0)
            ? `<tr>
                <td class="bold" style="color:red;">KHẤU TRỪ CHUYÊN CẦN:</td>
                <td class="right" style="color:red;font-weight:bold;">${fmt(attendanceAdjustments)}</td>
               </tr>`
            : '';

        const employeeId = (window.currentUserContext?.username || staffId).toUpperCase();
        const headerTitle = "TRUNG TÂM NGOẠI NGỮ VÀ TOÁN TƯ DUY TRẺ";

        tableHTML = `
        <div class="header">${headerTitle}</div>
        <div class="sub-header">
            MÃ NHÂN VIÊN: ${employeeId}
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
            HỌ VÀ TÊN: ${staffName.toUpperCase()}
        </div>
        <table>
            <tr>
                <td class="bold red-text" style="width:70%">TỔNG LƯƠNG (1)</td>
                <td class="bold red-text right">${fmt(totalI)}</td>
            </tr>
            <tr>
                <td class="bold">
                    TỔNG SỐ GIỜ: ${filteredMinutes > 0 ? formatHoursDecimal(filteredMinutes) : 'giờ'}
                    <br>
                    LƯƠNG CƠ BẢN:
                </td>
                <td class="bold right" style="vertical-align:top">${baseSalary > 0 ? fmt(baseSalary) : ''}</td>
            </tr>
            <tr>
                <td class="bold">PHÍ TƯ VẤN:</td>
                <td class="right">${phiTuVan > 0 ? fmt(phiTuVan) : ''}</td>
            </tr>
            <tr>
                <td class="bold">CHẤM BÀI/ DẠY VẼ/ ĐĂNG BÀI/ SỰ KIỆN / PHÁT SINH: &nbsp; giờ</td>
                <td></td>
            </tr>
            <tr><td class="bold">TRỢ CẤP CHỨC VỤ:</td><td></td></tr>
            <tr><td class="bold">LƯƠNG HIỆU SUẤT:</td><td></td></tr>
            <tr>
                <td class="bold">THU NHẬP TĂNG THÊM DOANH THU TỔNG:</td>
                <td class="right">${doanhThuTong > 0 ? fmt(doanhThuTong) : ''}</td>
            </tr>
            <tr>
                <td class="bold">THU NHẬP TĂNG THÊM DOANH THU CS2:</td>
                <td class="right">${doanhThuCs2 > 0 ? fmt(doanhThuCs2) : ''}</td>
            </tr>
            <tr>
                <td class="bold">THU NHẬP TĂNG THÊM DOANH THU CS3:</td>
                <td class="right">${doanhThuCs3 > 0 ? fmt(doanhThuCs3) : ''}</td>
            </tr>
            <tr>
                <td class="bold">PHÁT SINH (I) + (II)</td>
                <td class="right">${totalBonus > 0 ? fmt(totalBonus) : ''}</td>
            </tr>
            ${penaltiesHtml}
            <tr>
                <td rowspan="2" class="center bold" style="width: 15%;">TIÊU<br>CHÍ<br>XÉT</td>
                <td>
                    <span class="bold">(I) CHUYÊN CẦN</span><br>
                    Vắng phép: ${vpShifts} &nbsp;&nbsp; Vắng đột xuất: ${vdxShifts}<br>
                    Vắng không phép: ${vkpShifts} &nbsp;&nbsp; Trễ: ${formatLateHours(totalLateMinutes)} giờ
                </td>
                <td class="right">${criteriaI?.amount ? fmt(criteriaI.amount) : ''}</td>
            </tr>
            <tr>
                <td>
                    <span class="bold">(II) TRÁCH NHIỆM:</span> ${criteriaV?.note || ''}
                </td>
                <td class="right">${criteriaV?.amount ? fmt(criteriaV.amount) : ''}</td>
            </tr>
            <tr>
                <td class="bold red-text">TẠM ỨNG (2)</td>
                <td class="right">${advance > 0 ? fmt(advance) : ''}</td>
            </tr>
            <tr>
                <td class="bold red-text">THỰC LÃNH (1)-(2)</td>
                <td class="bold red-text right">${fmt(finalNetTT)}</td>
            </tr>
        </table>`;

    } else {
        const penaltiesHtml = (penaltyVDX !== 0 || penaltyVKP !== 0 || penaltyLate !== 0)
            ? `<tr>
                <td class="bold" style="color:red;">KHẤU TRỪ CHUYÊN CẦN:</td>
                <td class="right" style="color:red;font-weight:bold;">${fmt(attendanceAdjustments)}</td>
               </tr>`
            : '';

        const criteria0 = evalItems[0];
        const criteria1 = evalItems[1];
        const criteria2 = evalItems[2];
        const criteria3 = evalItems[3];
        const criteria4 = evalItems[4];
        const criteria5 = evalItems[5];
        const criteria6 = evalItems[6];
        const criteria7 = evalItems[7];
        const criteria8 = evalItems[8];
        const criteria9 = evalItems[9];

        const employeeId = (window.currentUserContext?.username || staffId).toUpperCase();
        const headerTitle = "TRUNG TÂM NGOẠI NGỮ TƯ DUY TRẺ";

        tableHTML = `
        <div class="header">${headerTitle}</div>
        <div class="sub-header">
            MÃ NHÂN VIÊN: ${employeeId}
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
            HỌ VÀ TÊN: ${staffName.toUpperCase()}
        </div>
        <table>
            <tr>
                <td class="bold red-text" style="width: 70%">TỔNG LƯƠNG (1)</td>
                <td class="bold red-text right">${fmt(initialTotal)}</td>
            </tr>
            <tr>
                <td class="bold">
                    TỔNG SỐ GIỜ: ${totalBaseMins > 0 ? formatHoursDecimal(totalBaseMins) : 'giờ'} / buổi
                    <br>
                    LƯƠNG CƠ BẢN:
                </td>
                <td class="bold right" style="vertical-align: top;">${totalBaseSalary > 0 ? fmt(totalBaseSalary) : ''}</td>
            </tr>
            <tr>
                <td>TỔNG SỐ GIỜ TIN HỌC: ${totalTinHocMins > 0 ? formatHoursDecimal(totalTinHocMins) : 'giờ'}</td>
                <td class="right">${totalTinHocSalary > 0 ? fmt(totalTinHocSalary) : ''}</td>
            </tr>
            <tr>
                <td>SOẠN BÀI/ CHẤM BÀI/SỰ KIỆN/PHÁT SINH: ${totalExtraMins > 0 ? formatHoursDecimal(totalExtraMins) : 'giờ'}</td>
                <td class="right">${totalExtraSalary > 0 ? fmt(totalExtraSalary) : ''}</td>
            </tr>
            <tr>
                <td>TỔNG SỐ GIỜ MẦM NON: ${totalPreschoolMins > 0 ? formatHoursDecimal(totalPreschoolMins) : 'giờ'}</td>
                <td class="right">${totalPreschoolSalary > 0 ? fmt(totalPreschoolSalary) : ''}</td>
            </tr>
            <tr>
                <td>TỔNG SỐ GIỜ LIÊN KẾT: ${totalAffiliateMins > 0 ? formatHoursDecimal(totalAffiliateMins) : 'giờ'}</td>
                <td class="right">${totalAffiliateSalary > 0 ? fmt(totalAffiliateSalary) : ''}</td>
            </tr>
            <tr>
                <td>TỔNG SỐ GIỜ KÈM 1:1 (TẠI NHÀ): ${totalTutoringMins > 0 ? formatHoursDecimal(totalTutoringMins) : 'giờ'}</td>
                <td class="right">${totalTutoringSalary > 0 ? fmt(totalTutoringSalary) : ''}</td>
            </tr>
            <tr>
                <td class="bold">TRỢ CẤP CHỨC VỤ:</td>
                <td></td>
            </tr>
            ${penaltiesHtml}
            <tr>
                <td class="bold">TỔNG THƯỞNG (I+II+III+IV+V+VI+VII+VIII+IX):</td>
                <td class="bold right">${totalBonus > 0 ? fmt(totalBonus) : ''}</td>
            </tr>
            
            <!-- TIÊU CHÍ ĐÁNH GIÁ (Gộp dòng đứng) -->
            <tr>
                <td rowspan="10" class="center bold" style="width: 10%;">TIÊU<br>CHÍ<br>ĐÁNH<br>GIÁ</td>
                <td class="bold" style="width: 25%;">(I) CHUYÊN CẦN – TÁC PHONG</td>
                <td style="width: 50%;">
                    Vắng phép: ${vpShifts} &nbsp;&nbsp; Vắng đột xuất: ${vdxShifts} &nbsp;&nbsp; Vắng không phép: ${vkpShifts}
                </td>
                <td class="right" style="width: 15%;">${criteria0?.amount ? fmt(criteria0.amount) : ''}</td>
            </tr>
            <tr>
                <td class="bold">(II) ĐÚNG GIỜ</td>
                <td>Trễ: ${totalLateMinutes ? (totalLateMinutes / 60).toFixed(2).replace('.', ',') + ' giờ' : 'nhiều giờ'} &nbsp;&nbsp; số lần trễ: ${lateCount ? lateCount + ' lần' : 'lần'}</td>
                <td class="right">${criteria1?.amount ? fmt(criteria1.amount) : ''}</td>
            </tr>
            <tr>
                <td class="bold">(II) TẬP TRUNG LÀM VIỆC</td>
                <td>${criteria2?.note || ''}</td>
                <td class="right">${criteria2?.amount ? fmt(criteria2.amount) : ''}</td>
            </tr>
            <tr>
                <td class="bold">(III) NHIỆT TÌNH</td>
                <td>${criteria3?.note || ''}</td>
                <td class="right">${criteria3?.amount ? fmt(criteria3.amount) : ''}</td>
            </tr>
            <tr>
                <td class="bold">(IV) TRÁCH NHIỆM</td>
                <td>${criteria4?.note || ''}</td>
                <td class="right">${criteria4?.amount ? fmt(criteria4.amount) : ''}</td>
            </tr>
            <tr>
                <td class="bold">(V) SOẠN BÀI/NHẬN XÉT</td>
                <td>${criteria5?.note || ''}</td>
                <td class="right">${criteria5?.amount ? fmt(criteria5.amount) : ''}</td>
            </tr>
            <tr>
                <td class="bold">(VI) CHUYÊN MÔN</td>
                <td>${criteria6?.note || ''}</td>
                <td class="right">${criteria6?.amount ? fmt(criteria6.amount) : ''}</td>
            </tr>
            <tr>
                <td class="bold">(VII) KỸ NĂNG SƯ PHẠM</td>
                <td>${criteria7?.note || ''}</td>
                <td class="right">${criteria7?.amount ? fmt(criteria7.amount) : ''}</td>
            </tr>
            <tr>
                <td class="bold">(VIII) SỐ GIỜ LÀM</td>
                <td>MỐC XÉT THƯỞNG: 50,65,80 ${criteria8?.note ? `<br>${criteria8.note}` : ''}</td>
                <td class="right">${criteria8?.amount ? fmt(criteria8.amount) : ''}</td>
            </tr>
            <tr>
                <td class="bold">(IX) HỌP ĐỊNH KÌ</td>
                <td>${criteria9?.note || ''}</td>
                <td class="right">${criteria9?.amount ? fmt(criteria9.amount) : ''}</td>
            </tr>
            
            <tr>
                <td class="bold red-text">TẠM ỨNG (2)</td>
                <td class="right">${advance > 0 ? fmt(advance) : ''}</td>
            </tr>
            <tr>
                <td class="bold red-text">THỰC LĨNH (1)-(2)</td>
                <td class="bold red-text right">${fmt(finalNet)}</td>
            </tr>
        </table>`;
    }

    printWindow.document.write(`
        <html>
        <head>
            <title>Bang_Luong_${staffName}_${month}_${year}</title>
            <style>${sharedStyles}</style>
        </head>
        <body>
            ${tableHTML}
            ${sharedFooter}
            <script>window.print();<\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// Expose to global scope for HTML onclick handler
window.exportSalaryPDF = exportSalaryPDF;
