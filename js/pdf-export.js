// ================= EXPORT PDF (CUSTOM FORM) =================
// Extracted from report.js — Incremental Refactoring (22/02/2026)
// Dependencies (global scope from report.js):
//   - EVALUATION_CRITERIA, calculateSalary(), removeVietnameseTones(), currentDate
//   - window.currentMonthChips, window.currentMonthSalary

function exportSalaryPDF() {
    // 1. Get Data
    const staffSelect = document.getElementById('staff-select');
    const staffId = staffSelect.value;
    const staffName = staffSelect.options[staffSelect.selectedIndex].text.split('(')[0].trim();
    if (staffId === 'all') { alert("Vui lòng chọn nhân viên để xuất file"); return; }

    // const rate = parseFloat(document.getElementById('salary-rate').value) || 0; // Removed
    const rate = 0; // Legacy logic removal
    const advance = parseFloat(document.getElementById('salary-advance').value) || 0;

    // Evaluation Items
    let totalBonus = 0;
    const evalItems = [];
    document.querySelectorAll('.eval-amount').forEach((inp, idx) => {
        const val = parseFloat(inp.value) || 0;
        totalBonus += val;
        // Find saved note
        const noteInp = document.querySelector(`.eval-note[data-index="${idx}"]`);
        const item = EVALUATION_CRITERIA[idx];

        let displayNote = '';
        // If template exists and not much note, show template? Or show saved note? 
        // User form shows specific text like "Vắng phép: 0...". 
        // We will assume the Note input contains this text if edited, or empty.
        // If user didn't edit note, we might want to show default template if available?
        // Let's rely on what's in the note field (user should fill it).
        // Fallback: if note is empty, show template (if any)

        /// ACTUALLY: User form has specific text. The User should input this into the Note field using the Edit 📝 button.
        displayNote = noteInp.value || item.template || '';

        evalItems.push({
            label: item.label,
            title: item.tooltip,
            note: displayNote,
            amount: val
        });
    });

    // --- FIX: Use Filtered Data for PDF ---
    // Ensure data is fresh
    calculateSalary();

    const filterType = document.getElementById('salary-role-filter') ? document.getElementById('salary-role-filter').value : 'all';
    const chips = window.currentMonthChips || [];
    let normalMinutes = 0;
    let fixedMinutes = 0;
    let normalSalary = 0;
    let fixedSalary = 0;

    // Recalculate filtered minutes matching calculateSalary logic
    chips.forEach(chip => {
        if (!chip.sessionData) return;
        let include = false;
        if (filterType === 'all') {
            include = true;
        } else if (filterType === 'giao-vien') {
            const nameRaw = (chip.sessionData.roleName || '').toLowerCase();
            const name = removeVietnameseTones(nameRaw);
            if (name.includes('tiep') || name.includes('le') || name.includes('reception')) {
                include = false;
            } else if (chip.isTeaching || name.includes('gv') || name.includes('giao') || name.includes('tro') || name.includes('ta')) {
                include = true;
            }
        } else if (filterType === 'tiep-tan') {
            const nameRaw = (chip.sessionData.roleName || '').toLowerCase();
            const name = removeVietnameseTones(nameRaw);
            if (name.includes('tiep') || name.includes('le') || name.includes('reception')) {
                include = true;
            }
        }

        if (include) {
            const minutes = chip.paidMinutes || 0;
            let rate = (chip.sessionData && chip.sessionData.roleRate) ? Number(chip.sessionData.roleRate) : 0;
            
            let isTiepTan = chip.isReceptionist || (chip.sessionData && chip.sessionData.role === 'tiep-tan');
            let isFixed = false;
            
            if (window.currentUserContext && window.currentUserContext.salary_config) {
                 const cfg = window.currentUserContext.salary_config;
                 if (isTiepTan && chip.isFixedShift && cfg.receptionist_fixed_rate) {
                     rate = Number(cfg.receptionist_fixed_rate);
                     isFixed = true;
                 } else if (isTiepTan && cfg.receptionist_normal_rate) {
                     rate = Number(cfg.receptionist_normal_rate);
                 }
            }

            if (isFixed) {
                 fixedMinutes += minutes;
                 fixedSalary += (minutes / 60) * rate;
            } else {
                 normalMinutes += minutes;
                 normalSalary += (minutes / 60) * rate;
            }
        }
    });

    const filteredMinutes = normalMinutes + fixedMinutes;
    const baseSalary = normalSalary + fixedSalary; // Recalculated accurately to match window.currentMonthSalary
    const initialTotal = baseSalary + totalBonus;
    const finalNet = initialTotal - advance;

    const month = currentDate.getMonth() + 1;
    const year = currentDate.getFullYear();

    const fmt = (n) => new Intl.NumberFormat('vi-VN').format(n);

    // 2. Build HTML
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Bang_Luong_${staffName}_${month}_${year}</title>
            <style>
                body { font-family: 'Times New Roman', serif; padding: 20px; }
                .header { text-align: center; font-weight: bold; margin-bottom: 20px; text-transform: uppercase; }
                .sub-header { margin-bottom: 10px; font-weight: bold; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                th, td { border: 1px solid black; padding: 8px; vertical-align: middle; }
                .red-text { color: red; font-weight: bold; }
                .bold { font-weight: bold; }
                .right { text-align: right; }
                .center { text-align: center; }
                .no-border-top { border-top: none; }
                .footer-note { font-style: italic; margin-top: 10px; font-size: 0.9em; }
                .warning { color: red; font-weight: bold; margin-top: 10px; }
            </style>
        </head>
        <body>
            <div class="header">
                TRUNG TÂM NGOẠI NGỮ TƯ DUY TRẺ
            </div>
            
            <div class="sub-header">
                MÃ NHÂN VIÊN: ${staffId.substring(0, 6).toUpperCase()} &nbsp;&nbsp;&nbsp;&nbsp; HỌ VÀ TÊN: ${staffName.toUpperCase()}
                <br>LOẠI CÔNG VIỆC: ${filterType === 'all' ? 'Tất cả' : (filterType === 'tiep-tan' ? 'Tiếp tân' : 'Giáo viên/Trợ giảng')}
            </div>
            <div style="margin-bottom: 15px;">
                Tổng số tháng làm việc năm ${year} (từ sau tết âm lịch): ...
            </div>

            <table>
                <!-- TOTAL SALARY ROW -->
                <tr>
                    <td class="bold red-text" style="width: 70%">TỔNG LƯƠNG (1)</td>
                    <td class="bold red-text right">${fmt(initialTotal)}</td>
                </tr>

                <!-- HOURS & RATE -->
                <tr>
                    <td class="bold">
                        TỔNG SỐ GIỜ CƠ BẢN: ${Math.floor(normalMinutes / 60)} giờ ${Math.floor(normalMinutes % 60)} phút
                        <br><br>
                        LƯƠNG CƠ BẢN:
                    </td>
                    <td class="bold right" style="vertical-align: top;">${fmt(normalSalary)}</td>
                </tr>
                ${(fixedMinutes > 0 || window.fixedWorkedCount > 0 || window.fixedAbsentCount > 0) ? `
                <tr>
                    <td class="bold" style="color: #6366F1;">
                        TỔNG SỐ GIỜ CỐ ĐỊNH: ${Math.floor(fixedMinutes / 60)} giờ ${Math.floor(fixedMinutes % 60)} phút
                        <br>
                        [Ca Cố Định] Đi làm: ${window.fixedWorkedCount || 0} | OFF: ${window.fixedAbsentCount || 0}
                        <br><br>
                        LƯƠNG CA CỐ ĐỊNH:
                    </td>
                    <td class="bold right" style="vertical-align: top; color: #6366F1;">${fmt(fixedSalary)}</td>
                </tr>
                ` : ''}

                <!-- PLACEHOLDERS FOR SPECIFIC TYPES -->
                <tr><td>SOẠN BÀI/ CHẤM BÀI/ SỰ KIỆN/ PHÁT SINH: giờ</td><td></td></tr>
                <tr><td>TỔNG SỐ GIỜ MẦM NON: giờ</td><td></td></tr>
                <tr><td>TỔNG SỐ GIỜ GTNL/TOEIC/IELTS: giờ</td><td></td></tr>
                <tr><td>TỔNG SỐ GIỜ LIÊN KẾT: giờ</td><td></td></tr>
                <tr><td>TỔNG SỐ GIỜ KÈM 1:1 TẠI NHÀ: giờ</td><td></td></tr>
                <tr><td>TRỢ CẤP CHỨC VỤ:</td><td></td></tr>

                <!-- TOTAL BONUS ROW -->
                <tr>
                    <td class="bold">TỔNG THƯỞNG (I+II+III+IV+V+VI+VII+VIII+IX):</td>
                    <td class="bold right">${fmt(totalBonus)}</td>
                </tr>

                <!-- EVALUATION ITEMS Rows -->
                ${evalItems.map(item => `
                    <tr>
                        <td>
                            <div style="display:flex;">
                                <div style="width: 40%; font-weight:bold;">(${item.label}) ${item.title}</div>
                                <div style="width: 60%;">${item.note}</div>
                            </div>
                        </td>
                        <td class="right">${item.amount !== 0 ? fmt(item.amount) : ''}</td>
                    </tr>
                `).join('')}

                <!-- ADVANCE -->
                <tr>
                    <td class="bold red-text">TẠM ỨNG (2)</td>
                    <td class="right">${advance !== 0 ? fmt(advance) : ''}</td>
                </tr>

                <!-- NET PAY -->
                <tr>
                    <td class="bold red-text">THỰC LÃNH (1)-(2)</td>
                    <td class="bold red-text right">${fmt(finalNet)}</td>
                </tr>
            </table>

            <div class="footer-note">
                Lưu ý: Nếu bảng lương có sai sót vui lòng liên hệ chị Thúy (bộ phận nhân sự) vào sáng giờ hành chính (7h-11h)
            </div>
            <div class="warning">
                *LƯU Ý: - Lương tháng ${month}/${year} chưa bao gồm phí soạn bài bên chị Tiên, phí soạn bài vui lòng liên hệ chị Tiên!
            </div>

            <script>
                window.print();
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// Expose to global scope for HTML onclick handler
window.exportSalaryPDF = exportSalaryPDF;
