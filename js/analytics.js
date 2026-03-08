// Analytics Tab v3 — Multi-select comparison + Overall Punctuality
// Depends on: Chart.js (CDN), ChartService (chart-service.js), DBService (db-service.js)

let analyticsDate = new Date();
let chartInstances = {};
let _cachedMonthData = null; // Store loaded data for interactive use

// ============================
// Month Navigation
// ============================
function changeAnalyticsMonth(offset) {
    analyticsDate.setMonth(analyticsDate.getMonth() + offset);
    ChartService._clearCache();
    _cachedMonthData = null;
    loadAnalyticsTab();
}

function getAnalyticsMonthStr() {
    return `${analyticsDate.getFullYear()}-${String(analyticsDate.getMonth() + 1).padStart(2, '0')}`;
}

function updateMonthLabel() {
    const label = document.getElementById('analytics-month-label');
    if (label) {
        const monthNames = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
            'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
        label.textContent = `${monthNames[analyticsDate.getMonth()]} / ${analyticsDate.getFullYear()}`;
    }
}

// ============================
// Chart Helpers
// ============================
function destroyChart(id) {
    if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

function createChart(canvasId, config) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    chartInstances[canvasId] = new Chart(ctx, config);
    return chartInstances[canvasId];
}

// ============================
// Premium Color Palette
// ============================
const C = {
    blue: { bg: 'rgba(59,130,246,0.8)', light: 'rgba(59,130,246,0.12)' },
    green: { bg: 'rgba(16,185,129,0.8)', light: 'rgba(16,185,129,0.12)' },
    orange: { bg: 'rgba(245,158,11,0.85)', light: 'rgba(245,158,11,0.12)' },
    purple: { bg: 'rgba(139,92,246,0.8)', light: 'rgba(139,92,246,0.12)' },
    teal: { bg: 'rgba(20,184,166,0.8)', light: 'rgba(20,184,166,0.12)' },
    pink: { bg: 'rgba(236,72,153,0.8)', light: 'rgba(236,72,153,0.12)' },
    indigo: { bg: 'rgba(99,102,241,0.8)', light: 'rgba(99,102,241,0.12)' },
    red: { bg: 'rgba(239,68,68,0.8)', light: 'rgba(239,68,68,0.12)' },
    gray: { bg: 'rgba(156,163,175,0.8)', light: 'rgba(156,163,175,0.12)' },
    amber: { bg: 'rgba(217,119,6,0.8)', light: 'rgba(217,119,6,0.12)' },
};

const PALETTE = [C.blue.bg, C.green.bg, C.purple.bg, C.teal.bg, C.pink.bg, C.indigo.bg, C.orange.bg, C.amber.bg, C.red.bg];

// ============================
// Chart.js Global Theme
// ============================
if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = "'Inter', 'Segoe UI', -apple-system, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#6B7280';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.padding = 16;
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation.duration = 800;
    Chart.defaults.animation.easing = 'easeOutQuart';
}

const tooltipStyle = {
    backgroundColor: 'rgba(17,24,39,0.9)',
    titleFont: { weight: '600' },
    padding: 12,
    cornerRadius: 8
};

// ============================
// MAIN: Load Analytics Tab
// ============================
async function loadAnalyticsTab() {
    if (typeof Chart === 'undefined') return;

    updateMonthLabel();
    const monthStr = getAnalyticsMonthStr();

    const loading = document.getElementById('analytics-loading');
    const charts = document.getElementById('analytics-charts');
    if (loading) loading.style.display = 'flex';
    if (charts) charts.style.opacity = '0.3';

    const t0 = performance.now();

    try {
        // === SINGLE BATCH FETCH ===
        const data = await ChartService.loadMonthData(monthStr);
        _cachedMonthData = data;
        const { allLogs, schedules, users } = data;
        const staffUsers = users.filter(u => u.role !== 'admin');

        // Populate dropdown + checkboxes
        populateAnalyticsStaffSelect(staffUsers);
        populateCompareCheckboxes(staffUsers);

        // Summary Cards
        const summary = ChartService.getSummaryStats(allLogs, users);
        renderSummaryCards(summary);

        // === RENDER CHARTS (all from cached data) ===
        renderOverallPunctuality(allLogs, schedules, staffUsers);
        renderStaffComparison(allLogs, users); // Default: all staff

        // Late trend (multi-month, async)
        const lateTrend = await ChartService.getLateTrend(3);
        renderLateTrend(lateTrend);

        const elapsed = Math.round(performance.now() - t0);
        const timing = document.getElementById('analytics-timing');
        if (timing) timing.textContent = `⚡ ${elapsed}ms`;

    } catch (e) {
        console.error('[Analytics] Error:', e);
    } finally {
        if (loading) loading.style.display = 'none';
        if (charts) {
            charts.style.opacity = '1';
            charts.style.transition = 'opacity 0.4s ease';
        }
    }
}

// ============================
// Summary Cards
// ============================
function renderSummaryCards(stats) {
    const container = document.getElementById('analytics-summary');
    if (!container) return;

    container.innerHTML = `
        <div class="analytics-stat-card" style="--accent: #3B82F6">
            <div class="analytics-stat-icon">👥</div>
            <div>
                <div class="analytics-stat-value">${stats.totalStaff}</div>
                <div class="analytics-stat-label">Trợ giảng</div>
            </div>
        </div>
        <div class="analytics-stat-card" style="--accent: #10B981">
            <div class="analytics-stat-icon">⏱️</div>
            <div>
                <div class="analytics-stat-value">${stats.totalHours}</div>
                <div class="analytics-stat-label">Tổng giờ làm</div>
            </div>
        </div>
        <div class="analytics-stat-card" style="--accent: #8B5CF6">
            <div class="analytics-stat-icon">📋</div>
            <div>
                <div class="analytics-stat-value">${stats.totalSessions}</div>
                <div class="analytics-stat-label">Tổng ca</div>
            </div>
        </div>
        <div class="analytics-stat-card" style="--accent: #F59E0B">
            <div class="analytics-stat-icon">📅</div>
            <div>
                <div class="analytics-stat-value">${stats.activeDays}</div>
                <div class="analytics-stat-label">Ngày hoạt động</div>
            </div>
        </div>
    `;
}

// ============================
// Populate Controls
// ============================
function populateAnalyticsStaffSelect(staffUsers) {
    const select = document.getElementById('analytics-staff-select');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Chọn nhân viên --</option>';
    staffUsers.sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.name || u.username || u.id;
        select.appendChild(opt);
    });
    if (currentVal) select.value = currentVal;
}

function populateCompareCheckboxes(staffUsers) {
    const container = document.getElementById('staff-compare-checkboxes');
    if (!container) return;

    // Preserve search input if it exists
    const searchInput = container.querySelector('#compare-search');
    const searchHTML = searchInput ? searchInput.outerHTML : '';

    container.innerHTML = searchHTML + staffUsers
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(u => `
            <label class="compare-staff-label" style="
                display: flex; align-items: center; gap: 0.4rem;
                padding: 0.35rem 0.7rem; border-radius: 8px;
                background: #fff; border: 1px solid var(--border-color);
                cursor: pointer; font-size: 0.82rem; color: var(--text-color);
                transition: all 0.2s; user-select: none;
            " onmouseover="this.style.borderColor='var(--primary-color)'" onmouseout="this.style.borderColor='var(--border-color)'">
                <input type="checkbox" value="${u.id}" checked
                    onchange="updateStaffComparison()"
                    style="accent-color: var(--primary-color); cursor: pointer;">
                ${u.name || u.username || u.id}
            </label>
        `).join('');
}

// Search/filter analytics staff select
window.filterAnalyticsSelect = function (query) {
    const select = document.getElementById('analytics-staff-select');
    if (!select) return;
    const q = query.toLowerCase().trim();
    Array.from(select.options).forEach(opt => {
        if (!opt.value) return; // Keep default
        const text = opt.textContent.toLowerCase();
        opt.style.display = text.includes(q) ? '' : 'none';
        opt.hidden = !text.includes(q);
    });
};

// Search/filter compare checkboxes
window.filterCompareCheckboxes = function (query) {
    const container = document.getElementById('staff-compare-checkboxes');
    if (!container) return;
    const q = query.toLowerCase().trim();
    container.querySelectorAll('.compare-staff-label').forEach(label => {
        const text = label.textContent.toLowerCase();
        label.style.display = text.includes(q) ? '' : 'none';
    });
};

function selectAllStaffCompare(selectAll) {
    const checkboxes = document.querySelectorAll('#staff-compare-checkboxes input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = selectAll);
    updateStaffComparison();
}

function updateStaffComparison() {
    if (!_cachedMonthData) return;
    const checkboxes = document.querySelectorAll('#staff-compare-checkboxes input[type="checkbox"]:checked');
    const selectedIds = new Set([...checkboxes].map(cb => cb.value));

    const { allLogs, users } = _cachedMonthData;

    // Filter to selected users only
    const filteredUsers = users.filter(u => selectedIds.has(u.id));
    const filteredLogs = allLogs.filter(l => selectedIds.has(l._userId));

    renderStaffComparison(filteredLogs, filteredUsers);
}

// ============================
// CHART 1: Overall Punctuality (All Staff Combined)
// ============================
function renderOverallPunctuality(allLogs, schedules, staffUsers) {
    let totalOntime = 0, totalLate = 0, totalAbsent = 0;

    staffUsers.forEach(u => {
        const punct = ChartService.getStaffPunctuality(allLogs, schedules, u.id);
        totalOntime += punct.ontime;
        totalLate += punct.late;
        totalAbsent += punct.absent;
    });

    const total = totalOntime + totalLate + totalAbsent;
    if (total === 0) { showNoData('chart-overall-punctuality'); return; }

    createChart('chart-overall-punctuality', {
        type: 'doughnut',
        data: {
            labels: ['Đúng giờ', 'Trễ', 'Vắng'],
            datasets: [{
                data: [totalOntime, totalLate, totalAbsent],
                backgroundColor: [C.green.bg, C.orange.bg, C.gray.bg],
                borderWidth: 3,
                borderColor: '#ffffff',
                hoverOffset: 12
            }]
        },
        options: {
            cutout: '58%',
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    ...tooltipStyle,
                    callbacks: {
                        label: (ctx) => {
                            const pct = Math.round(ctx.raw / total * 100);
                            return `  ${ctx.label}: ${ctx.raw} ca (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ============================
// CHART 2: Late Trend
// ============================
function renderLateTrend(data) {
    if (!data || !data.length || data.every(d => d.lateCount === 0)) {
        showNoData('chart-late-trend'); return;
    }

    createChart('chart-late-trend', {
        type: 'line',
        data: {
            labels: data.map(d => d.month),
            datasets: [
                {
                    label: 'Số lần trễ',
                    data: data.map(d => d.lateCount),
                    borderColor: C.orange.bg,
                    backgroundColor: C.orange.light,
                    fill: true,
                    tension: 0.45,
                    pointRadius: 7,
                    pointHoverRadius: 10,
                    pointBackgroundColor: '#fff',
                    pointBorderWidth: 3,
                    pointBorderColor: C.orange.bg,
                    borderWidth: 3
                },
                {
                    label: '% Trễ',
                    data: data.map(d => d.latePercent),
                    borderColor: C.red.bg,
                    backgroundColor: 'transparent',
                    borderDash: [6, 4],
                    tension: 0.45,
                    pointRadius: 5,
                    pointBorderWidth: 2,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: C.red.bg,
                    borderWidth: 2,
                    yAxisID: 'y2'
                }
            ]
        },
        options: {
            plugins: {
                tooltip: {
                    ...tooltipStyle,
                    callbacks: {
                        label: (ctx) => ctx.datasetIndex === 0
                            ? `  ${ctx.raw} lần trễ`
                            : `  ${ctx.raw}% tỷ lệ trễ`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Lần', font: { size: 11 }, color: '#9CA3AF' },
                    grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false }
                },
                y2: {
                    position: 'right', beginAtZero: true, max: 100,
                    title: { display: true, text: '%', font: { size: 11 }, color: '#9CA3AF' },
                    grid: { display: false }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

// ============================
// PER-STAFF: Punctuality + Weekly Hours
// ============================
async function loadStaffAnalytics() {
    const select = document.getElementById('analytics-staff-select');
    const userId = select ? select.value : '';
    if (!userId) return;

    const monthStr = getAnalyticsMonthStr();
    if (!_cachedMonthData) {
        _cachedMonthData = await ChartService.loadMonthData(monthStr);
    }
    const { allLogs, schedules } = _cachedMonthData;

    const punct = ChartService.getStaffPunctuality(allLogs, schedules, userId);
    const weekly = ChartService.getWeeklyHours(allLogs, monthStr, userId);

    renderPunctuality(punct);
    renderWeeklyHours(weekly);
}

function renderPunctuality(data) {
    if (data.total === 0) { showNoData('chart-punctuality'); return; }

    createChart('chart-punctuality', {
        type: 'doughnut',
        data: {
            labels: ['Đúng giờ', 'Trễ', 'Vắng'],
            datasets: [{
                data: [data.ontime, data.late, data.absent],
                backgroundColor: [C.green.bg, C.orange.bg, C.gray.bg],
                borderWidth: 3, borderColor: '#fff', hoverOffset: 8
            }]
        },
        options: {
            cutout: '62%',
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    ...tooltipStyle,
                    callbacks: {
                        label: (ctx) => {
                            const pct = Math.round(ctx.raw / data.total * 100);
                            return `  ${ctx.label}: ${ctx.raw} ca (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderWeeklyHours(data) {
    if (!data.length || data.every(d => d.hours === 0)) { showNoData('chart-weekly-hours'); return; }

    const avg = data.reduce((a, b) => a + b.hours, 0) / data.length;

    createChart('chart-weekly-hours', {
        type: 'bar',
        data: {
            labels: data.map(d => d.week),
            datasets: [{
                label: 'Giờ làm',
                data: data.map(d => d.hours),
                backgroundColor: data.map(d => d.hours >= avg ? C.green.bg : C.orange.bg),
                borderRadius: 10, borderSkipped: false, barThickness: 36
            }]
        },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: { ...tooltipStyle, callbacks: { label: (ctx) => `  ${ctx.raw} giờ` } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Giờ', font: { size: 11 }, color: '#9CA3AF' },
                    grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

// ============================
// CHART: Staff Comparison (Multi-Select)
// ============================
function renderStaffComparison(allLogs, users) {
    const comparison = ChartService.getAllStaffComparison(allLogs, users);
    const filtered = comparison.filter(d => d.hours > 0);

    if (!filtered.length) { showNoData('chart-staff-comparison'); return; }

    createChart('chart-staff-comparison', {
        type: 'bar',
        data: {
            labels: filtered.map(d => d.name),
            datasets: [{
                label: 'Tổng giờ',
                data: filtered.map(d => d.hours),
                backgroundColor: filtered.map((_, i) => PALETTE[i % PALETTE.length]),
                borderWidth: 0,
                borderRadius: 8,
                borderSkipped: false,
                barThickness: Math.max(20, Math.min(40, 300 / Math.max(filtered.length, 1)))
            }]
        },
        options: {
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...tooltipStyle,
                    callbacks: {
                        label: (ctx) => `  ${ctx.raw} giờ  •  ${filtered[ctx.dataIndex].sessions} ca`
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false },
                    title: { display: true, text: 'Giờ', font: { size: 11 }, color: '#9CA3AF' }
                },
                y: {
                    grid: { display: false },
                    ticks: { font: { size: 12, weight: '500' } }
                }
            }
        }
    });
}

// ============================
// No Data
// ============================
function showNoData(canvasId) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#D1D5DB';
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('📭 Chưa có dữ liệu', w / 2, h / 2 - 8);
    ctx.fillStyle = '#E5E7EB';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('Hãy chấm công để hiển thị biểu đồ', w / 2, h / 2 + 12);
}
