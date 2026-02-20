// Chart Data Service — Read-only functions for analytics
// Uses existing DBService functions. Does NOT modify any data.

const ChartService = {

    // ===== 1. PUNCTUALITY (Doughnut Chart) =====
    // Returns: { ontime, late, absent, total }
    getStaffPunctuality: async (userId, monthStr) => {
        try {
            const [logs, schedules] = await Promise.all([
                DBService.getMonthlyAttendance(monthStr, userId),
                ChartService._getMonthSchedules(monthStr)
            ]);

            let ontime = 0, late = 0, absent = 0;

            // For each day with a schedule
            Object.keys(schedules).forEach(dateKey => {
                const daySchedule = schedules[dateKey];
                const dayLog = logs.find(l => l.date === dateKey);
                const sessions = dayLog ? (dayLog.sessions || []) : [];

                // Get registered classes for this user
                const registeredClasses = ChartService._getRegisteredClasses(daySchedule, userId);

                registeredClasses.forEach(cls => {
                    const schedStart = new Date(`${dateKey}T${cls.start}`);
                    const matched = sessions.find(s => {
                        const checkIn = new Date(s.checkIn || s.start);
                        return Math.abs(checkIn - schedStart) < 60 * 60 * 1000;
                    });

                    if (!matched || !matched.checkIn) {
                        // Only count absent for past dates
                        if (new Date(dateKey) < new Date()) absent++;
                    } else {
                        const checkIn = new Date(matched.checkIn || matched.start);
                        const diffMs = schedStart - checkIn;
                        if (diffMs < 0) {
                            // Late (checkIn after schedStart)
                            const lateMins = Math.round(Math.abs(diffMs) / 60000);
                            if (lateMins > 0) late++;
                            else ontime++;
                        } else {
                            ontime++;
                        }
                    }
                });
            });

            return { ontime, late, absent, total: ontime + late + absent };
        } catch (e) {
            console.error('[ChartService] Punctuality error:', e);
            return { ontime: 0, late: 0, absent: 0, total: 0 };
        }
    },

    // ===== 2. WEEKLY HOURS (Line Chart) =====
    // Returns: [{ week: 'T1', hours: 12.5 }, ...]
    getWeeklyHours: async (userId, monthStr) => {
        try {
            const logs = await DBService.getMonthlyAttendance(monthStr, userId);
            const [year, month] = monthStr.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();

            // Group days into weeks
            const weeks = [];
            for (let d = 1; d <= daysInMonth; d++) {
                const date = new Date(year, month - 1, d);
                const weekNum = Math.ceil(d / 7);
                if (!weeks[weekNum - 1]) weeks[weekNum - 1] = { week: `Tuần ${weekNum}`, totalMinutes: 0 };

                const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const dayLog = logs.find(l => l.date === dateKey);
                if (!dayLog || !dayLog.sessions) continue;

                dayLog.sessions.forEach(s => {
                    if (s.checkIn && s.checkOut) {
                        const checkIn = new Date(s.checkIn);
                        const checkOut = new Date(s.checkOut);
                        const mins = (checkOut - checkIn) / 60000;
                        if (mins > 0 && mins < 720) { // Cap at 12 hours to filter bad data
                            weeks[weekNum - 1].totalMinutes += mins;
                        }
                    }
                });
            }

            return weeks.filter(w => w).map(w => ({
                week: w.week,
                hours: Math.round(w.totalMinutes / 60 * 10) / 10
            }));
        } catch (e) {
            console.error('[ChartService] Weekly hours error:', e);
            return [];
        }
    },

    // ===== 3. STAFF COMPARISON (Bar Chart) =====
    // Returns: [{ name, hours, ontimeRate, lateCount }]
    getAllStaffComparison: async (monthStr) => {
        try {
            const users = await DBService.getUsers();
            const staffUsers = users.filter(u => u.role !== 'admin');

            const results = await Promise.all(staffUsers.map(async (u) => {
                const logs = await DBService.getMonthlyAttendance(monthStr, u.id);
                let totalMins = 0;
                let sessionCount = 0;

                logs.forEach(day => {
                    (day.sessions || []).forEach(s => {
                        if (s.checkIn && s.checkOut) {
                            const mins = (new Date(s.checkOut) - new Date(s.checkIn)) / 60000;
                            if (mins > 0 && mins < 720) {
                                totalMins += mins;
                                sessionCount++;
                            }
                        }
                    });
                });

                return {
                    name: u.name || u.username || 'N/A',
                    hours: Math.round(totalMins / 60 * 10) / 10,
                    sessions: sessionCount
                };
            }));

            // Sort by hours descending
            results.sort((a, b) => b.hours - a.hours);
            return results;
        } catch (e) {
            console.error('[ChartService] Staff comparison error:', e);
            return [];
        }
    },

    // ===== 4. LATE TREND (Area Chart) =====
    // Returns: [{ month: 'T1/2026', avgLateMins: 5.2, lateCount: 3 }]
    getLateTrend: async (userId, numMonths = 3) => {
        try {
            const results = [];
            const now = new Date();

            for (let i = numMonths - 1; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                const monthLabel = `T${d.getMonth() + 1}/${d.getFullYear()}`;

                const [logs, schedules] = await Promise.all([
                    DBService.getMonthlyAttendance(monthStr, userId),
                    ChartService._getMonthSchedules(monthStr)
                ]);

                let totalLateMins = 0, lateCount = 0;

                Object.keys(schedules).forEach(dateKey => {
                    const daySchedule = schedules[dateKey];
                    const dayLog = logs.find(l => l.date === dateKey);
                    const sessions = dayLog ? (dayLog.sessions || []) : [];

                    ChartService._getRegisteredClasses(daySchedule, userId).forEach(cls => {
                        const schedStart = new Date(`${dateKey}T${cls.start}`);
                        const matched = sessions.find(s => {
                            const checkIn = new Date(s.checkIn || s.start);
                            return Math.abs(checkIn - schedStart) < 60 * 60 * 1000;
                        });

                        if (matched && matched.checkIn) {
                            const checkIn = new Date(matched.checkIn);
                            const diffMs = schedStart - checkIn;
                            if (diffMs < 0) {
                                const lateMins = Math.round(Math.abs(diffMs) / 60000);
                                if (lateMins > 0) {
                                    totalLateMins += lateMins;
                                    lateCount++;
                                }
                            }
                        }
                    });
                });

                results.push({
                    month: monthLabel,
                    avgLateMins: lateCount > 0 ? Math.round(totalLateMins / lateCount * 10) / 10 : 0,
                    lateCount
                });
            }

            return results;
        } catch (e) {
            console.error('[ChartService] Late trend error:', e);
            return [];
        }
    },

    // ===== 5. ROLE DISTRIBUTION (Pie Chart) =====
    // Returns: [{ role: 'GV Tiếng Anh', hours: 25 }]
    getRoleDistribution: async (monthStr) => {
        try {
            const users = await DBService.getUsers();
            const staffUsers = users.filter(u => u.role !== 'admin');

            const roleMap = {};

            await Promise.all(staffUsers.map(async (u) => {
                const logs = await DBService.getMonthlyAttendance(monthStr, u.id);

                logs.forEach(day => {
                    (day.sessions || []).forEach(s => {
                        if (s.checkIn && s.checkOut && s.role) {
                            const roleName = s.role.name || s.role || 'Chưa chọn';
                            const mins = (new Date(s.checkOut) - new Date(s.checkIn)) / 60000;
                            if (mins > 0 && mins < 720) {
                                roleMap[roleName] = (roleMap[roleName] || 0) + mins;
                            }
                        }
                    });
                });
            }));

            return Object.entries(roleMap)
                .map(([role, mins]) => ({ role, hours: Math.round(mins / 60 * 10) / 10 }))
                .sort((a, b) => b.hours - a.hours);
        } catch (e) {
            console.error('[ChartService] Role distribution error:', e);
            return [];
        }
    },

    // ===== HELPER: Get all schedule docs for a month =====
    _getMonthSchedules: async (monthStr) => {
        const [year, month] = monthStr.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const schedules = {};

        const promises = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            promises.push(
                DBService.getSchedule(dateKey).then(data => {
                    if (data && Object.keys(data).length > 0) {
                        schedules[dateKey] = data;
                    }
                }).catch(() => { })
            );
        }
        await Promise.all(promises);
        return schedules;
    },

    // ===== HELPER: Get classes a user registered for =====
    _getRegisteredClasses: (daySchedule, userId) => {
        const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
        const classes = [];

        sections.forEach(sec => {
            const list = daySchedule[sec] || [];
            list.forEach(cls => {
                const teachers = cls.registeredTeachers || [];
                if (teachers.some(t => t.id === userId)) {
                    classes.push(cls);
                }
            });
        });

        return classes;
    }
};
