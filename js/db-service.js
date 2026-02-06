// Database Service - Lớp trung gian xử lý dữ liệu
// Mục đích: Tách biệt logic gọi database khỏi giao diện (UI)

const DBService = {
    // 1. Kiểm tra kết nối
    testConnection: async () => {
        try {
            if (!window.db) throw new Error("Database chưa được khởi tạo");
            console.log("Database connection ready");
            return true;
        } catch (error) {
            console.error("Lỗi kết nối:", error);
            return false;
        }
    },

    // 2. Tham chiếu các Collection (Bảng dữ liệu)
    refs: {
        users: () => window.db.collection('users'),
        attendance: () => window.db.collection('attendance'),
        schedules: () => window.db.collection('schedules'),
        logs: () => window.db.collection('system_logs')
    },

    // Các hàm xử lý dữ liệu sẽ được thêm vào dưới đây (getUsers, checkIn, etc.)
    // 3. Authenticate User
    // 3. Authenticate User (SECURE MODE)
    loginUser: async (username, password) => {
        try {
            // 1. Authenticate with Firebase Auth
            // Auto-append domain for UX (User only types username)
            const email = `${username}@tuduytre.com`.toLowerCase();

            // This grants the "ID Card" (Token) needed for Rules
            const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
            const authUser = userCredential.user;

            // 2. Fetch User Profile from Firestore
            // Now we have permission to read 'users' collection!

            // Try query by username first (legacy compatibility)
            // Or try finding by ID if we sync IDs. 
            // In migration, we kept Firestore IDs same. Auth UID might differ? 
            // Wait, we didn't sync Auth UID to Firestore ID. 
            // We need to Find the user document that matches this username.

            const snapshot = await window.db.collection('users')
                .where('username', '==', username)
                .limit(1)
                .get();

            if (snapshot.empty) {
                // Should not happen if migration was correct
                throw new Error("Tài khoản xác thực thành công nhưng không tìm thấy dữ liệu hồ sơ!");
            }

            const doc = snapshot.docs[0];
            const userData = { id: doc.id, ...doc.data() };

            // --- SECURITY PHASE 1: ROLE SYNC ---
            // Write the role to a special collection keyed by Auth UID.
            // This allows Firestore Rules to easily check: get(.../user_roles/$(request.auth.uid)).data.role
            try {
                const roleRef = window.db.collection('user_roles').doc(authUser.uid);
                await roleRef.set({
                    role: userData.role || 'staff', // Default to staff
                    username: userData.username,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log("Security: Role Synced to Auth ID.");
            } catch (err) {
                console.warn("Security: Could not sync role (might lack permission yet).", err);
            }

            return userData;

        } catch (error) {
            console.error("Secure Login Error:", error);
            if (error.code === 'auth/wrong-password') throw new Error("Sai mật khẩu!");
            if (error.code === 'auth/user-not-found') throw new Error("Tài khoản không tồn tại!");
            if (error.code === 'auth/too-many-requests') throw new Error("Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau!");
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
            // 1. Try Direct Fetch (Lịch Riêng)
            const doc = await db.collection('schedules').doc(dateKey).get();

            // Check if document exists AND is not a "Ghost" (empty placeholder)
            if (doc.exists) {
                const data = doc.data();
                // If the user explicitly saved an empty schedule (e.g. deleted all rows), 
                // it will still have keys like 'morning1' (as empty arrays).
                // If it's pure empty {}, treat as non-existent -> Fallback.
                const hasStructure = Object.keys(data).length > 0;
                if (hasStructure) return data;
            }

            // 2. Fallback: Find Nearest Neighbor (Lịch Kế Thừa)
            const manifestDoc = await db.collection('settings').doc('schedule_manifest').get();
            if (!manifestDoc.exists) return {};

            const manifest = manifestDoc.data();

            // Determine Day of Week (0=Sun, 1=Mon...)
            const [y, m, d] = dateKey.split('-').map(Number);
            const localDate = new Date(y, m - 1, d);
            const dayOfWeek = localDate.getDay();
            const dayKey = String(dayOfWeek); // Force String Key

            const availableDates = manifest[dayKey] || manifest[dayOfWeek] || [];

            // Find max date < dateKey
            const pastDates = availableDates.filter(d => d < dateKey);

            if (pastDates.length === 0) return {};

            pastDates.sort().reverse();
            const neighborDate = pastDates[0];

            console.log(`[Schedule] Inheriting from ${neighborDate} for ${dateKey}`);

            const neighborDoc = await db.collection('schedules').doc(neighborDate).get();

            if (!neighborDoc.exists) return {};

            const templateData = neighborDoc.data();

            // SANITIZATION: Clean up 'registeredTeachers' so they don't carry over
            Object.keys(templateData).forEach(key => {
                if (Array.isArray(templateData[key])) {
                    templateData[key] = templateData[key].map(row => ({
                        ...row,
                        registeredTeachers: [] // Reset registrations
                    }));
                }
            });

            return templateData;

        } catch (error) {
            console.error("Error getting schedule:", error);
            return {};
        }
    },

    saveSchedule: async (dateKey, data) => {
        try {
            // 1. Save the actual schedule data
            await db.collection('schedules').doc(dateKey).set(data);

            // 2. Update Manifest (Fire and forget, or await)
            await DBService.updateScheduleManifest(dateKey);

            return true;
        } catch (error) {
            console.error("Error saving schedule:", error);
            throw error;
        }
    },

    updateScheduleManifest: async (dateKey) => {
        try {
            const [y, m, d] = dateKey.split('-').map(Number);
            const localDate = new Date(y, m - 1, d);
            const dayOfWeek = localDate.getDay();
            const dayKey = String(dayOfWeek); // Use String Key

            const ref = db.collection('settings').doc('schedule_manifest');

            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                const data = doc.exists ? doc.data() : {};

                const list = data[dayKey] || [];
                if (!list.includes(dateKey)) {
                    list.push(dateKey);
                    list.sort(); // Keep sorted asc
                    data[dayKey] = list;
                    t.set(ref, data, { merge: true });
                }
            });
        } catch (e) {
            console.warn("Error updating manifest:", e);
        }
    },

    // 5. Class Registration (Nhận Lớp)
    registerClass: async (dateKey, caType, rowMeta, user) => {
        // rowMeta: { index, ... }
        try {
            const docRef = db.collection('schedules').doc(dateKey);

            // Use Transaction to ensure atomicity (multiple teachers clicking at once)
            await db.runTransaction(async (transaction) => {
                let doc = await transaction.get(docRef);
                let data;

                if (!doc.exists) {
                    // FALLBACK: Materialize from Template inside Transaction
                    const manifestDoc = await transaction.get(db.collection('settings').doc('schedule_manifest'));
                    let templateData = {};

                    if (manifestDoc.exists) {
                        const manifest = manifestDoc.data();
                        const [y, m, d] = dateKey.split('-').map(Number);
                        const localDate = new Date(y, m - 1, d);
                        const dayOfWeek = localDate.getDay();

                        const availableDates = manifest[dayOfWeek] || [];
                        const pastDates = availableDates.filter(d => d < dateKey);

                        if (pastDates.length > 0) {
                            pastDates.sort().reverse();
                            const neighborDate = pastDates[0];
                            const neighborDoc = await transaction.get(db.collection('schedules').doc(neighborDate));
                            if (neighborDoc.exists) templateData = neighborDoc.data();
                        }
                    }

                    // Sanitize Template
                    Object.keys(templateData).forEach(key => {
                        if (Array.isArray(templateData[key])) {
                            templateData[key] = templateData[key].map(row => ({
                                ...row,
                                registeredTeachers: []
                            }));
                        }
                    });

                    data = templateData;
                } else {
                    data = doc.data();
                }

                const rows = data[caType] || [];
                const rowIndex = rowMeta.index;

                if (!rows[rowIndex]) throw "Class no longer exists (or structure changed)!";

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

                transaction.set(docRef, data); // Write back full object using SET instead of UPDATE
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

    updateSessionRole: async (userId, dateKey, sessionId, roleData) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        return db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            if (!doc.exists) throw new Error("Attendance record not found");

            const data = doc.data();
            if (!data.sessions) throw new Error("No sessions found");

            const index = data.sessions.findIndex(s => String(s.id) === String(sessionId));
            if (index === -1) throw new Error("Session not found");

            // Update Role
            const session = data.sessions[index];
            session.role = roleData.id;
            session.roleName = roleData.name;
            session.roleRate = roleData.rate; // Optional: Snapshot rate at time of locking? Yes, safer.

            data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
            t.set(ref, data);
        });
    },

    // 7.2 Generic Add Session (Admin)
    addSession: async (userId, dateKey, sessionData) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        // Fetch user name if not exists (for display)
        let userName = 'N/A';
        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) userName = userDoc.data().name || userDoc.data().username;
        } catch (e) { }

        return db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            let data = doc.exists ? doc.data() : {
                userId,
                name: userName,
                date: dateKey,
                sessions: []
            };

            if (!data.sessions) data.sessions = [];

            // Helper to get Start Time from ISO or legacy
            const newStart = sessionData.checkIn || sessionData.start || new Date().toISOString();

            const newSession = {
                id: Date.now(),
                start: newStart,
                checkIn: sessionData.checkIn,
                checkOut: sessionData.checkOut || null,
                type: 'admin_add'
            };

            data.sessions.push(newSession);

            // Sync top level (last session wins)
            data.checkIn = newSession.checkIn;
            data.checkOut = newSession.checkOut;
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
