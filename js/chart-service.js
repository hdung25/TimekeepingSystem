// Chart Data Service v2 — Optimized with batch queries + memory cache
// Uses existing DBService functions. Does NOT modify any data.

const ChartService = {

    // ===== MEMORY CACHE =====
    _cache: {},

    _getCacheKey: (type, monthStr, userId) => `${type}_${monthStr}_${userId || 'all'}`,

    _clearCache: () => { ChartService._cache = {}; },

    // ===== BATCH: Get ALL attendance for a month (single WHERE query) =====
    _getAllMonthAttendance: async (monthStr) => {
        const cacheKey = ChartService._getCacheKey('attendance', monthStr);
        if (ChartService._cache[cacheKey]) return ChartService._cache[cacheKey];

        try {
            const [year, month] = monthStr.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            const startDate = `${monthStr}-01`;
            const endDate = `${monthStr}-${String(daysInMonth).padStart(2, '0')}`;

            // Single Firestore query for ALL users in the month
            const snap = await db.collection('attendance_logs')
                .where('date', '>=', startDate)
                .where('date', '<=', endDate)
                .get();

            const allLogs = [];
            snap.forEach(doc => {
                const data = doc.data();
                if (!data.date) data.date = doc.id.split('_')[0];
                if (!data.sessions || !Array.isArray(data.sessions)) {
                    if (data.checkIn) {
                        data.sessions = [{ id: 'legacy', start: data.checkIn, checkIn: data.checkIn, checkOut: data.checkOut || null }];
                    } else {
                        data.sessions = [];
                    }
                }
                // Extract userId from doc ID pattern: "YYYY-MM-DD_userId"
                data._userId = doc.id.includes('_') ? doc.id.split('_').slice(1).join('_') : (data.userId || '');
                data._docId = doc.id;
                allLogs.push(data);
            });

            ChartService._cache[cacheKey] = allLogs;
            return allLogs;
        } catch (e) {
            console.error('[ChartService] Batch attendance error:', e);
            return [];
        }
    },

    // ===== BATCH: Get ALL schedules for a month =====
    _getAllMonthSchedules: async (monthStr) => {
        const cacheKey = ChartService._getCacheKey('schedules', monthStr);
        if (ChartService._cache[cacheKey]) return ChartService._cache[cacheKey];

        try {
            const [year, month] = monthStr.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            const schedules = {};

            const promises = [];
            for (let d = 1; d <= daysInMonth; d++) {
                const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                promises.push(
                    DBService.getSchedule(dateKey).then(data => {
                        if (data && Object.keys(data).length > 0) schedules[dateKey] = data;
                    }).catch(() => { })
                );
            }
            await Promise.all(promises);

            ChartService._cache[cacheKey] = schedules;
            return schedules;
        } catch (e) {
            console.error('[ChartService] Batch schedules error:', e);
            return {};
        }
    },

    // ===== MASTER: Load all data at once for a month =====
    loadMonthData: async (monthStr) => {
        const [allLogs, schedules, users] = await Promise.all([
            ChartService._getAllMonthAttendance(monthStr),
            ChartService._getAllMonthSchedules(monthStr),
            ChartService._getCachedUsers()
        ]);
        return { allLogs, schedules, users };
    },

    _getCachedUsers: async () => {
        const cacheKey = 'users_all';
        if (ChartService._cache[cacheKey]) return ChartService._cache[cacheKey];
        const users = await DBService.getUsers();
        ChartService._cache[cacheKey] = users;
        return users;
    },

    // ===== HELPER: Get registered classes for a user =====
    _getRegisteredClasses: (daySchedule, userId) => {
        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
        const classes = [];
        sections.forEach(sec => {
            (daySchedule[sec] || []).forEach(cls => {
                if ((cls.registeredTeachers || []).some(t => t.id === userId)) classes.push(cls);
            });
        });
        return classes;
    },

    // ===== 1. PUNCTUALITY (from cached data) =====
    getStaffPunctuality: (allLogs, schedules, userId) => {
        let ontime = 0, late = 0, absent = 0;
        const userLogs = allLogs.filter(l => l._userId === userId);
        const today = new Date();

        Object.keys(schedules).forEach(dateKey => {
            const daySchedule = schedules[dateKey];
            const dayLog = userLogs.find(l => l.date === dateKey);
            const sessions = dayLog ? (dayLog.sessions || []) : [];
            const registeredClasses = ChartService._getRegisteredClasses(daySchedule, userId);

            registeredClasses.forEach(cls => {
                const schedStart = new Date(`${dateKey}T${cls.start}`);
                const matched = sessions.find(s => {
                    const checkIn = new Date(s.checkIn || s.start);
                    return Math.abs(checkIn - schedStart) < 60 * 60 * 1000;
                });

                if (!matched || !matched.checkIn) {
                    if (new Date(dateKey) < today) absent++;
                } else {
                    const checkIn = new Date(matched.checkIn || matched.start);
                    const diffMs = schedStart - checkIn;
                    if (diffMs < 0 && Math.round(Math.abs(diffMs) / 60000) > 0) late++;
                    else ontime++;
                }
            });
        });

        return { ontime, late, absent, total: ontime + late + absent };
    },

    // ===== 2. WEEKLY HOURS (from cached data) =====
    getWeeklyHours: (allLogs, monthStr, userId) => {
        const userLogs = allLogs.filter(l => l._userId === userId);
        const [year, month] = monthStr.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();

        const weeks = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const weekNum = Math.ceil(d / 7);
            if (!weeks[weekNum - 1]) weeks[weekNum - 1] = { week: `Tuần ${weekNum}`, totalMinutes: 0 };

            const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayLog = userLogs.find(l => l.date === dateKey);
            if (!dayLog || !dayLog.sessions) continue;

            dayLog.sessions.forEach(s => {
                if (s.checkIn && s.checkOut) {
                    const mins = (new Date(s.checkOut) - new Date(s.checkIn)) / 60000;
                    if (mins > 0 && mins < 720) weeks[weekNum - 1].totalMinutes += mins;
                }
            });
        }

        return weeks.filter(w => w).map(w => ({
            week: w.week,
            hours: Math.round(w.totalMinutes / 60 * 10) / 10
        }));
    },

    // ===== 3. STAFF COMPARISON (from cached data) =====
    getAllStaffComparison: (allLogs, users) => {
        const staffUsers = users.filter(u => u.role !== 'admin');

        const results = staffUsers.map(u => {
            const userLogs = allLogs.filter(l => l._userId === u.id);
            let totalMins = 0, sessionCount = 0;

            userLogs.forEach(day => {
                (day.sessions || []).forEach(s => {
                    if (s.checkIn && s.checkOut) {
                        const mins = (new Date(s.checkOut) - new Date(s.checkIn)) / 60000;
                        if (mins > 0 && mins < 720) { totalMins += mins; sessionCount++; }
                    }
                });
            });

            return {
                name: u.name || u.username || 'N/A',
                hours: Math.round(totalMins / 60 * 10) / 10,
                sessions: sessionCount
            };
        });

        results.sort((a, b) => b.hours - a.hours);
        return results;
    },

    // ===== 4. LATE TREND (uses batch per month) =====
    getLateTrend: async (numMonths = 3) => {
        const now = new Date();
        const results = [];

        for (let i = numMonths - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const monthLabel = `T${d.getMonth() + 1}`;

            const { allLogs, schedules, users } = await ChartService.loadMonthData(monthStr);
            const staffUsers = users.filter(u => u.role !== 'admin');

            let totalLate = 0, totalSessions = 0;

            staffUsers.forEach(u => {
                const punct = ChartService.getStaffPunctuality(allLogs, schedules, u.id);
                totalLate += punct.late;
                totalSessions += punct.total;
            });

            results.push({
                month: monthLabel,
                lateCount: totalLate,
                latePercent: totalSessions > 0 ? Math.round(totalLate / totalSessions * 100) : 0
            });
        }

        return results;
    },

    // ===== 5. ROLE DISTRIBUTION (from cached data) =====
    getRoleDistribution: (allLogs) => {
        const roleMap = {};

        allLogs.forEach(day => {
            (day.sessions || []).forEach(s => {
                if (s.checkIn && s.checkOut && s.role) {
                    const roleName = (typeof s.role === 'object' ? s.role.name : s.role) || 'Chưa chọn';
                    const mins = (new Date(s.checkOut) - new Date(s.checkIn)) / 60000;
                    if (mins > 0 && mins < 720) roleMap[roleName] = (roleMap[roleName] || 0) + mins;
                }
            });
        });

        return Object.entries(roleMap)
            .map(([role, mins]) => ({ role, hours: Math.round(mins / 60 * 10) / 10 }))
            .sort((a, b) => b.hours - a.hours);
    },

    // ===== SUMMARY STATS (from cached data) =====
    getSummaryStats: (allLogs, users) => {
        const staffUsers = users.filter(u => u.role !== 'admin');
        let totalHours = 0, totalSessions = 0, activeDays = new Set();

        allLogs.forEach(day => {
            (day.sessions || []).forEach(s => {
                if (s.checkIn && s.checkOut) {
                    const mins = (new Date(s.checkOut) - new Date(s.checkIn)) / 60000;
                    if (mins > 0 && mins < 720) {
                        totalHours += mins / 60;
                        totalSessions++;
                        activeDays.add(day.date);
                    }
                }
            });
        });

        return {
            totalStaff: staffUsers.length,
            totalHours: Math.round(totalHours),
            totalSessions,
            activeDays: activeDays.size
        };
    }
};
