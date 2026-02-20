// Analytics Tab — Chart Rendering (admin.html)
// Depends on: Chart.js (CDN), ChartService (chart-service.js), DBService (db-service.js)

let analyticsDate = new Date();
let chartInstances = {}; // Track chart instances for cleanup

// ============================
// Month Navigation
// ============================
function changeAnalyticsMonth(offset) {
    analyticsDate.setMonth(analyticsDate.getMonth() + offset);
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
// Chart Helper: Safe destroy + create
// ============================
function destroyChart(chartId) {
    if (chartInstances[chartId]) {
        chartInstances[chartId].destroy();
        delete chartInstances[chartId];
    }
}

function createChart(canvasId, config) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    chartInstances[canvasId] = new Chart(ctx, config);
    return chartInstances[canvasId];
}

// ============================
// Colors
// ============================
const CHART_COLORS = {
    green: 'rgba(16, 185, 129, 0.8)',
    greenBg: 'rgba(16, 185, 129, 0.15)',
    orange: 'rgba(245, 158, 11, 0.8)',
    orangeBg: 'rgba(245, 158, 11, 0.15)',
    gray: 'rgba(156, 163, 175, 0.8)',
    grayBg: 'rgba(156, 163, 175, 0.15)',
    blue: 'rgba(59, 130, 246, 0.8)',
    blueBg: 'rgba(59, 130, 246, 0.15)',
    purple: 'rgba(139, 92, 246, 0.8)',
    purpleBg: 'rgba(139, 92, 246, 0.15)',
    red: 'rgba(239, 68, 68, 0.8)',
    redBg: 'rgba(239, 68, 68, 0.15)',
    teal: 'rgba(20, 184, 166, 0.8)',
    pink: 'rgba(236, 72, 153, 0.8)',
    indigo: 'rgba(99, 102, 241, 0.8)',
    amber: 'rgba(217, 119, 6, 0.8)',
};

const PALETTE = [
    CHART_COLORS.blue, CHART_COLORS.green, CHART_COLORS.orange,
    CHART_COLORS.purple, CHART_COLORS.teal, CHART_COLORS.pink,
    CHART_COLORS.indigo, CHART_COLORS.amber, CHART_COLORS.red
];

// ============================
// Chart.js Global Defaults
// ============================
if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = "'Inter', 'Segoe UI', sans-serif";
    Chart.defaults.font.size = 13;
    Chart.defaults.color = '#6B7280';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
}

// ============================
// MAIN: Load Analytics Tab
// ============================
async function loadAnalyticsTab() {
    if (typeof Chart === 'undefined') {
        console.warn('[Analytics] Chart.js not loaded');
        return;
    }

    updateMonthLabel();
    const monthStr = getAnalyticsMonthStr();

    // Show loading
    const loading = document.getElementById('analytics-loading');
    const charts = document.getElementById('analytics-charts');
    if (loading) loading.style.display = 'block';
    if (charts) charts.style.display = 'none';

    try {
        // Populate staff dropdown
        await populateAnalyticsStaffSelect();

        // Load global charts in parallel
        await Promise.all([
            renderStaffComparison(monthStr),
            renderRoleDistribution(monthStr),
            renderLateTrend()
        ]);

    } catch (e) {
        console.error('[Analytics] Error loading:', e);
    } finally {
        if (loading) loading.style.display = 'none';
        if (charts) charts.style.display = 'grid';
    }
}

// ============================
// Populate Staff Dropdown
// ============================
async function populateAnalyticsStaffSelect() {
    const select = document.getElementById('analytics-staff-select');
    if (!select || select.options.length > 1) return; // Already populated

    try {
        const users = await DBService.getUsers();
        const staffUsers = users.filter(u => u.role !== 'admin').sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        staffUsers.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.name || u.username || u.id;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('[Analytics] Error getting users:', e);
    }
}

// ============================
// CHART 1: Staff Comparison (Horizontal Bar)
// ============================
async function renderStaffComparison(monthStr) {
    const data = await ChartService.getAllStaffComparison(monthStr);
    if (!data.length) {
        showNoData('chart-staff-comparison', 'Không có dữ liệu nhân viên');
        return;
    }

    createChart('chart-staff-comparison', {
        type: 'bar',
        data: {
            labels: data.map(d => d.name),
            datasets: [{
                label: 'Tổng giờ làm',
                data: data.map(d => d.hours),
                backgroundColor: data.map((_, i) => PALETTE[i % PALETTE.length]),
                borderRadius: 6,
                barThickness: 28
            }]
        },
        options: {
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.raw} giờ (${data[ctx.dataIndex].sessions} ca)`
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    title: { display: true, text: 'Giờ' },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                y: {
                    grid: { display: false }
                }
            }
        }
    });
}

// ============================
// CHART 2: Role Distribution (Doughnut)
// ============================
async function renderRoleDistribution(monthStr) {
    const data = await ChartService.getRoleDistribution(monthStr);
    if (!data.length) {
        showNoData('chart-role-distribution', 'Chưa có dữ liệu vai trò');
        return;
    }

    createChart('chart-role-distribution', {
        type: 'doughnut',
        data: {
            labels: data.map(d => d.role),
            datasets: [{
                data: data.map(d => d.hours),
                backgroundColor: PALETTE.slice(0, data.length),
                borderWidth: 2,
                borderColor: '#fff',
                hoverOffset: 8
            }]
        },
        options: {
            cutout: '55%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 16 }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${ctx.raw} giờ`
                    }
                }
            }
        }
    });
}

// ============================
// CHART 3: Late Trend (Line / Area)
// ============================
async function renderLateTrend() {
    // Get late trend for ALL staff combined
    try {
        const users = await DBService.getUsers();
        const staffUsers = users.filter(u => u.role !== 'admin');

        // Aggregate late data across all staff
        const monthLabels = [];
        const avgLateData = [];
        const lateCountData = [];

        // Get 3 months range
        const now = new Date();
        for (let i = 2; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthLabels.push(`T${d.getMonth() + 1}/${d.getFullYear()}`);

            let totalLate = 0, totalCount = 0;
            for (const u of staffUsers) {
                try {
                    const trend = await ChartService.getLateTrend(u.id, 1);
                    // We only get 1 month but for the specific month
                    // Actually, let's just use getStaffPunctuality for simplicity
                    const punct = await ChartService.getStaffPunctuality(u.id, monthStr);
                    totalLate += punct.late;
                    totalCount += punct.total;
                } catch (e) { /* skip */ }
            }

            avgLateData.push(totalCount > 0 ? Math.round(totalLate / totalCount * 100) : 0);
            lateCountData.push(totalLate);
        }

        if (lateCountData.every(v => v === 0)) {
            showNoData('chart-late-trend', 'Không có dữ liệu đi trễ');
            return;
        }

        createChart('chart-late-trend', {
            type: 'line',
            data: {
                labels: monthLabels,
                datasets: [
                    {
                        label: 'Số lần trễ',
                        data: lateCountData,
                        borderColor: CHART_COLORS.orange,
                        backgroundColor: CHART_COLORS.orangeBg,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 6,
                        pointHoverRadius: 8
                    },
                    {
                        label: '% Trễ',
                        data: avgLateData,
                        borderColor: CHART_COLORS.red,
                        backgroundColor: 'transparent',
                        borderDash: [5, 5],
                        tension: 0.4,
                        pointRadius: 4,
                        yAxisID: 'y2'
                    }
                ]
            },
            options: {
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                if (ctx.datasetIndex === 0) return `${ctx.raw} lần trễ`;
                                return `${ctx.raw}% tỷ lệ trễ`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Số lần' },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    y2: {
                        position: 'right',
                        beginAtZero: true,
                        max: 100,
                        title: { display: true, text: '%' },
                        grid: { display: false }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
    } catch (e) {
        console.error('[Analytics] Late trend error:', e);
        showNoData('chart-late-trend', 'Lỗi tải dữ liệu');
    }
}

// ============================
// PER-STAFF: Punctuality + Weekly Hours
// ============================
async function loadStaffAnalytics() {
    const select = document.getElementById('analytics-staff-select');
    const userId = select ? select.value : '';
    if (!userId) return;

    const monthStr = getAnalyticsMonthStr();

    // Load both charts in parallel
    await Promise.all([
        renderPunctuality(userId, monthStr),
        renderWeeklyHours(userId, monthStr)
    ]);
}

// CHART 4: Punctuality Doughnut
async function renderPunctuality(userId, monthStr) {
    const data = await ChartService.getStaffPunctuality(userId, monthStr);

    if (data.total === 0) {
        showNoData('chart-punctuality', 'Chưa có dữ liệu');
        return;
    }

    createChart('chart-punctuality', {
        type: 'doughnut',
        data: {
            labels: ['Đúng giờ', 'Trễ', 'Vắng'],
            datasets: [{
                data: [data.ontime, data.late, data.absent],
                backgroundColor: [CHART_COLORS.green, CHART_COLORS.orange, CHART_COLORS.gray],
                borderWidth: 2,
                borderColor: '#fff',
                hoverOffset: 6
            }]
        },
        options: {
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const pct = data.total > 0 ? Math.round(ctx.raw / data.total * 100) : 0;
                            return `${ctx.label}: ${ctx.raw} ca (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// CHART 5: Weekly Hours Line
async function renderWeeklyHours(userId, monthStr) {
    const data = await ChartService.getWeeklyHours(userId, monthStr);

    if (!data.length || data.every(d => d.hours === 0)) {
        showNoData('chart-weekly-hours', 'Chưa có dữ liệu');
        return;
    }

    createChart('chart-weekly-hours', {
        type: 'bar',
        data: {
            labels: data.map(d => d.week),
            datasets: [{
                label: 'Giờ làm',
                data: data.map(d => d.hours),
                backgroundColor: data.map((d, i) => {
                    // Color based on value relative to average
                    const avg = data.reduce((a, b) => a + b.hours, 0) / data.length;
                    return d.hours >= avg ? CHART_COLORS.green : CHART_COLORS.orange;
                }),
                borderRadius: 8,
                barThickness: 40
            }]
        },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.raw} giờ`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Giờ' },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

// ============================
// Helper: Show "No Data" on canvas
// ============================
function showNoData(canvasId, message) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);
}
