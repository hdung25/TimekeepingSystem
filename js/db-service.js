// Database Service - Lớp trung gian xử lý dữ liệu
// Mục đích: Tách biệt logic gọi database khỏi giao diện (UI)

const DBService = {
    // 1. Kiểm tra kết nối
    testConnection: async () => {
        try {
            if (!db) throw new Error("Database chưa được khởi tạo");
            console.log("Database connection ready");
            return true;
        } catch (error) {
            console.error("Lỗi kết nối:", error);
            return false;
        }
    },

    // 2. Tham chiếu các Collection (Bảng dữ liệu)
    refs: {
        users: () => db.collection('users'),
        attendance: () => db.collection('attendance'),
        schedules: () => db.collection('schedules'),
        logs: () => db.collection('system_logs')
    },

    // Các hàm xử lý dữ liệu sẽ được thêm vào dưới đây (getUsers, checkIn, etc.)
    // 3. Authenticate User
    // 3. Authenticate User & Management
    loginUser: async (username, password) => {
        try {
            // Query users collection for matching username and password
            const snapshot = await db.collection('users')
                .where('username', '==', username)
                .where('password', '==', password)
                .limit(1)
                .get();

            if (snapshot.empty) return null;

            const doc = snapshot.docs[0];
            return { id: doc.id, ...doc.data() };
        } catch (error) {
            console.error("Login Error:", error);
            throw error;
        }
    },

    getUsers: async () => {
        try {
            const snapshot = await db.collection('users').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error("Error getting users:", error);
            return [];
        }
    },

    saveUser: async (user) => {
        try {
            // user.id determines update or create
            const ref = db.collection('users').doc(user.id);
            await ref.set(user, { merge: true });
            return true;
        } catch (error) {
            console.error("Error saving user:", error);
            throw error;
        }
    },

    deleteUser: async (userId) => {
        try {
            await db.collection('users').doc(userId).delete();
            return true;
        } catch (error) {
            console.error("Error deleting user:", error);
            throw error;
        }
    },

    // 4. Schedule Management
    getSchedule: async (dateKey) => {
        try {
            const doc = await db.collection('schedules').doc(dateKey).get();
            return doc.exists ? doc.data() : {};
        } catch (error) {
            console.error("Error getting schedule:", error);
            return {};
        }
    },

    saveSchedule: async (dateKey, data) => {
        try {
            await db.collection('schedules').doc(dateKey).set(data);
            return true;
        } catch (error) {
            console.error("Error saving schedule:", error);
            throw error;
        }
    },

    // 5. Class Registration (Nhận Lớp)
    registerClass: async (dateKey, caType, rowMeta, user) => {
        // rowMeta: { index, ... }
        try {
            const docRef = db.collection('schedules').doc(dateKey);

            // Use Transaction to ensure atomicity (multiple teachers clicking at once)
            await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(docRef);
                if (!doc.exists) throw "Schedule does not exist!";

                const data = doc.data();
                const rows = data[caType] || [];
                const rowIndex = rowMeta.index;

                if (!rows[rowIndex]) throw "Class no longer exists!";

                // Init teachers array if null
                if (!rows[rowIndex].registeredTeachers) {
                    rows[rowIndex].registeredTeachers = [];
                }

                // Check if already registered
                const isRegistered = rows[rowIndex].registeredTeachers.some(t => t.id === user.id);

                if (isRegistered) {
                    // Un-register (Toggle off)
                    rows[rowIndex].registeredTeachers = rows[rowIndex].registeredTeachers.filter(t => t.id !== user.id);
                } else {
                    // Register
                    rows[rowIndex].registeredTeachers.push({
                        id: user.id,
                        name: user.name || user.username,
                        timestamp: new Date().toISOString()
                    });
                }

                transaction.update(docRef, { [caType]: rows });
            });
            return true;
        } catch (error) {
            console.error("Registration error:", error);
            throw error;
        }
    },

    updateAttendanceSession: async (dateKey, userId, sessionId, newData) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        return db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            if (!doc.exists) throw new Error("Không tìm thấy phiên làm việc!");

            const data = doc.data();
            const sessionIndex = data.sessions.findIndex(s => String(s.id) === String(sessionId)); // Loose compare

            if (sessionIndex === -1) throw new Error("Không tìm thấy phiên này!");

            // Update specific fields
            const session = data.sessions[sessionIndex];

            // Merge valid fields
            if (newData.checkIn) session.checkIn = newData.checkIn;
            if (newData.checkOut !== undefined) session.checkOut = newData.checkOut; // Allow null
            if (newData.start) session.start = newData.start;

            // Sync top level if it's the latest session
            if (sessionIndex === data.sessions.length - 1) {
                if (newData.checkIn) data.checkIn = newData.checkIn;
                if (newData.checkOut !== undefined) data.checkOut = newData.checkOut;
            }

            data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
            t.set(ref, data);
        });
    },

    // 6. Dashboard Stats
    getDashboardStats: async () => {
        try {
            // Count Users
            const usersSnap = await db.collection('users').get();
            const totalUsers = usersSnap.size;

            // Count Active Attendance Today (Local Time)
            const now = new Date();
            // Offset for timezone (simplistic vn hack: +7h)
            // But 'date' field in logs is YYYY-MM-DD local? 
            // Check checkInPersonal: `const dateKey = now.toISOString().split('T')[0];` -> This is UTC!
            // WE NEED TO FIX THIS to be Local Date.

            // Local Date Key calculation
            const localDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
            const todayKey = localDate.toISOString().split('T')[0];

            const logsSnap = await db.collection('attendance_logs').where('date', '==', todayKey).get();

            let checkedInCount = 0;
            let recentActivity = [];

            if (!logsSnap.empty) {
                checkedInCount = logsSnap.size;

                logsSnap.forEach(doc => {
                    const data = doc.data();
                    const sessions = data.sessions || [];

                    sessions.forEach(s => {
                        const checkInTime = s.checkIn || s.start;
                        if (checkInTime) {
                            // Determine status
                            let status = 'Đúng giờ';
                            if (s.checkOut) status = 'Hoàn thành';
                            else if (!s.checkOut) status = 'Đang làm việc';

                            recentActivity.push({
                                user: data.name || 'N/A',
                                time: checkInTime,
                                type: 'in',
                                status: status
                            });
                        }
                    });
                });

                // Sort by time desc
                recentActivity.sort((a, b) => new Date(b.time) - new Date(a.time));
                recentActivity = recentActivity.slice(0, 5);
            }

            return {
                totalUsers,
                checkedInCount,
                recentActivity
            };
        } catch (error) {
            console.error("Error getting stats:", error);
            throw error; // Let main.js handle UI
        }
    },

    // 7. Personal Attendance (Isolated)
    getPersonalAttendance: async (dateKey, userId) => {
        try {
            const docId = `${dateKey}_${userId}`;
            const doc = await db.collection('attendance_logs').doc(docId).get();

            if (!doc.exists) return null;

            let data = doc.data();

            // Read-time Migration for Legacy Data
            if (!data.sessions || !Array.isArray(data.sessions)) {
                if (data.checkIn) {
                    data.sessions = [{
                        id: 'legacy', // Marker ID
                        start: data.checkIn,
                        checkIn: data.checkIn,
                        checkOut: data.checkOut || null
                    }];
                } else {
                    data.sessions = [];
                }
            }

            return data;
        } catch (error) {
            console.error("Get personal attendance error:", error);
            return null;
        }
    },

    // 8. Monthly Attendance Report
    getMonthlyAttendance: async (monthStr, userId) => {
        // monthStr: "YYYY-MM"
        try {
            // OPTIMIZATION: Fetch by ID instead of Query.
            // This guarantees we find the document even if 'date' or 'userId' fields are missing (legacy data issues).
            const [year, month] = monthStr.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();

            const promises = [];
            for (let d = 1; d <= daysInMonth; d++) {
                const dayStr = String(d).padStart(2, '0');
                const dateKey = `${year}-${String(month).padStart(2, '0')}-${dayStr}`;
                const docId = `${dateKey}_${userId}`;
                promises.push(db.collection('attendance_logs').doc(docId).get());
            }

            const snapshots = await Promise.all(promises);

            let logs = [];
            snapshots.forEach(doc => {
                if (!doc.exists) return;

                let data = doc.data();
                // Ensure date exists (poly-fill for legacy docs)
                if (!data.date) {
                    data.date = doc.id.split('_')[0];
                }

                // Apply same read-time migration
                if (!data.sessions || !Array.isArray(data.sessions)) {
                    if (data.checkIn) {
                        data.sessions = [{
                            id: 'legacy',
                            start: data.checkIn,
                            checkIn: data.checkIn,
                            checkOut: data.checkOut || null
                        }];
                    } else {
                        data.sessions = [];
                    }
                }
                logs.push(data);
            });
            return logs;
        } catch (error) {
            console.error("Monthly attendance error:", error);
            return [];
        }
    },

    // 9. System Settings
    getSystemSettings: async () => {
        try {
            const doc = await db.collection('settings').doc('system').get();
            return doc.exists ? doc.data() : {};
        } catch (error) {
            console.error("Error getting settings:", error);
            return {};
        }
    },

    saveSystemSettings: async (data) => {
        try {
            await db.collection('settings').doc('system').set(data, { merge: true });
            return true;
        } catch (error) {
            console.error("Error saving settings:", error);
            throw error;
        }
    },

    checkInPersonal: async (userId, userFullName) => {
        // IP CHECK LOGIC
        try {
            const settingsDoc = await db.collection('settings').doc('system').get();
            if (settingsDoc.exists) {
                const settings = settingsDoc.data();
                const allowedIP = settings.allowedIP;

                if (allowedIP && allowedIP.trim() !== '') {
                    // Fetch client IP
                    const response = await fetch('https://api.ipify.org?format=json');
                    const data = await response.json();
                    const clientIP = data.ip;

                    // Support multiple IPs (comma separated)
                    const allowedList = allowedIP.split(',').map(ip => ip.trim());

                    if (!allowedList.includes(clientIP)) {
                        throw new Error(`IP Mạng không hợp lệ (${clientIP}). Vui lòng kết nối Wifi công ty!`);
                    }
                }
            }
        } catch (e) {
            // Rethrow specific errors, ignore fetch errors if offline (policy decision: strict or loose?)
            // If strictly enforcing, we should throw. If we want to allow offline workaround, we ignore.
            // User requirement: "đúng ip mạng mới được chấm công" -> STRICT.
            if (e.message.includes('IP')) throw e;
            console.warn("Skipping IP check due to network/fetch error:", e);
            // Optionally: throw new Error("Không thể kiểm tra IP mạng. Vui lòng kiểm tra kết nối internet.");
        }

        const now = new Date();
        const dateKey = now.toISOString().split('T')[0];
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        return db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            let data = doc.exists ? doc.data() : {
                userId,
                name: userFullName,
                date: dateKey,
                sessions: []
            };

            // Initialize sessions if missing (migration)
            if (!data.sessions) {
                // Migrate old single field data if exists
                if (data.checkIn) {
                    data.sessions = [{
                        start: data.checkIn,
                        checkIn: data.checkIn,
                        checkOut: data.checkOut || null
                    }];
                } else {
                    data.sessions = [];
                }
            }

            // Check if ANY working session is currently OPEN (no checkOut)
            const openSession = data.sessions.find(s => !s.checkOut);
            if (openSession) {
                const startTime = new Date(openSession.checkIn || openSession.start).toLocaleTimeString('vi-VN');
                throw new Error(`Bạn đang có ca làm việc chưa kết thúc (bắt đầu lúc ${startTime})! Vui lòng Check-out hoặc Xóa ca cũ.`);
            }

            // Add new session
            const newSession = {
                id: Date.now(), // timestamp ID for deletion
                start: now.toISOString(),
                checkIn: now.toISOString(),
                checkOut: null
            };

            data.sessions.push(newSession);

            // Sync top-level fields for query compatibility (optional but good for simple queries)
            data.checkIn = newSession.checkIn;
            data.checkOut = null;
            data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

            t.set(ref, data);
        });
    },

    checkOutPersonal: async (userId) => {
        const now = new Date();
        const dateKey = now.toISOString().split('T')[0];
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        return db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            if (!doc.exists) throw new Error("Bạn chưa check-in hôm nay!");

            const data = doc.data();

            // MIGRATION LOGIC (Important for consistency)
            if (!data.sessions || !Array.isArray(data.sessions)) {
                if (data.checkIn) {
                    data.sessions = [{
                        id: 'legacy',
                        start: data.checkIn,
                        checkIn: data.checkIn,
                        checkOut: data.checkOut || null
                    }];
                } else {
                    data.sessions = [];
                }
            }

            // Find open session
            const openSessionIndex = data.sessions.findIndex(s => !s.checkOut);

            if (openSessionIndex === -1) {
                throw new Error("Bạn chưa vào ca hoặc đã ra ca rồi!");
            }

            // Close session
            data.sessions[openSessionIndex].checkOut = now.toISOString();

            // Sync top level
            data.checkOut = now.toISOString();
            data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

            t.set(ref, data);
        });
    },

    // 7.1 Manual Add (Admin)
    addManualSession: async (userId, dateKey, checkInTime, checkOutTime) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        // Fetch User Name for consistency
        let userName = 'N/A';
        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) userName = userDoc.data().name || userDoc.data().username;
        } catch (e) { console.warn("Could not fetch user name for manual add", e); }

        return db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            let data = doc.exists ? doc.data() : {
                userId,
                name: userName,
                date: dateKey,
                sessions: []
            };

            if (!data.sessions) data.sessions = [];

            // Create new session
            // Format timestamps: YYYY-MM-DDTHH:mm:00.000Z (ISO)
            // Input checkInTime is usually HH:mm. We need to combine with dateKey.
            // CAREFUL: dateKey is YYYY-MM-DD.
            // We'll construct a local Date string -> ISO
            const startISO = new Date(`${dateKey}T${checkInTime}`).toISOString();
            const endISO = checkOutTime ? new Date(`${dateKey}T${checkOutTime}`).toISOString() : null;

            const newSession = {
                id: Date.now(),
                start: startISO,
                checkIn: startISO,
                checkOut: endISO,
                type: 'manual' // Marker
            };

            data.sessions.push(newSession);

            // Sync top level (last session wins)
            data.checkIn = newSession.checkIn;
            data.checkOut = newSession.checkOut;
            data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

            t.set(ref, data);
        });
    },

    deleteSession: async (userId, dateKey, sessionId) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        return db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            if (!doc.exists) return;

            const data = doc.data();
            if (!data.sessions) return;

            // Filter out the session
            const originalLength = data.sessions.length;
            data.sessions = data.sessions.filter(s => String(s.id) !== String(sessionId));

            if (data.sessions.length === originalLength) {
                // Try searching by index logic if needed, but ID is best.
                // If timestamp ID match failed (maybe date string vs number), try loose compare
            }

            // Re-sync top level status if needed
            // If we deleted the open session, we are checked out?
            // Just keep last session's status or reset
            const lastSession = data.sessions[data.sessions.length - 1];
            if (lastSession) {
                data.checkIn = lastSession.checkIn;
                data.checkOut = lastSession.checkOut;
            } else {
                data.checkIn = null;
                data.checkOut = null;
            }

            data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
            t.set(ref, data);
        });
    },

    updateSession: async (userId, dateKey, sessionId, newData) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        return db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            if (!doc.exists) throw new Error("Attendance record not found");

            const data = doc.data();
            if (!data.sessions) throw new Error("No sessions found");

            const index = data.sessions.findIndex(s => String(s.id) === String(sessionId));
            if (index === -1) throw new Error("Session not found");

            // Update fields
            const session = data.sessions[index];
            if (newData.checkIn) {
                session.checkIn = newData.checkIn;
                session.start = newData.checkIn; // Sync legacy
            }
            if (newData.checkOut !== undefined) {
                session.checkOut = newData.checkOut; // Can be null
            }

            // Sync top level if this is the last session
            if (index === data.sessions.length - 1) {
                data.checkIn = session.checkIn;
                data.checkOut = session.checkOut;
            }

            data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
            t.set(ref, data);
        });
    },

    getDashboardStats: async () => {
        try {
            // Count Users
            const usersSnap = await db.collection('users').get();
            const totalUsers = usersSnap.size;

            // Count Active Attendance Today (Local Time Logic)
            const now = new Date();
            const localDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
            const todayKey = localDate.toISOString().split('T')[0];

            const logsSnap = await db.collection('attendance_logs').where('date', '==', todayKey).get();

            let checkedInCount = 0;
            let recentActivity = [];

            if (!logsSnap.empty) {
                checkedInCount = logsSnap.size;

                logsSnap.forEach(doc => {
                    const data = doc.data();
                    const sessions = data.sessions || [];

                    sessions.forEach(s => {
                        const checkInTime = s.checkIn || s.start;
                        if (checkInTime) {
                            // Determine status
                            let status = 'Đúng giờ';
                            if (s.checkOut) status = 'Hoàn thành';
                            else if (!s.checkOut) status = 'Đang làm việc';

                            recentActivity.push({
                                user: data.name || 'N/A',
                                time: checkInTime,
                                type: 'in',
                                status: status
                            });
                        }
                    });
                });

                // Sort & Slice
                recentActivity.sort((a, b) => new Date(b.time) - new Date(a.time));
                recentActivity = recentActivity.slice(0, 5);
            }

            return {
                totalUsers,
                checkedInCount,
                recentActivity
            };
        } catch (error) {
            console.error("Error getting stats:", error);
            throw error;
        }
    }
};
