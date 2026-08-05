// Database Service - Lớp trung gian xử lý dữ liệu
// Mục đích: Tách biệt logic gọi database khỏi giao diện (UI)

// Global helper: Generate YYYY-MM-DD using Vietnam timezone (UTC+7)
function getLocalDateKeyFromDate(date) {
    if (!(date instanceof Date)) return '';
    const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    const year = vnTime.getUTCFullYear();
    const month = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(vnTime.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Global helper: Create a Date object corresponding to a given HH:MM in Vietnam timezone (UTC+7)
function getVietnamDateFromHM(dateKey, hmStr) {
    if (!dateKey || !hmStr) return null;
    const [year, month, day] = dateKey.split('-').map(Number);
    const [hour, minute] = hmStr.split(':').map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute)) return null;
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
    return new Date(utcDate.getTime() - 7 * 60 * 60 * 1000);
}

// ===== Nhận diện GV của 1 lớp trong lịch (hỗ trợ lớp xếp NHIỀU GV) =====
// Trang xếp lịch lưu danh sách GV ở gvList / gvThayTeList (bản viết cũ: gvThayTheList);
// gvId / gvThayTheId chỉ giữ NGƯỜI ĐẦU TIÊN cho tương thích ngược. Nếu chỗ nào chỉ so gvId
// thì GV thứ 2 của lớp coi như không có ca → tự vào/tự ra, Bảng Công bắt admin chọn lại chức vụ.
function _collectScheduleTeacherIds(cls, listFields, singleFields) {
    const ids = new Set();
    if (!cls) return ids;
    listFields.forEach(field => {
        const list = cls[field];
        if (Array.isArray(list)) list.forEach(g => { if (g && g.id) ids.add(g.id); });
    });
    singleFields.forEach(field => { if (cls[field]) ids.add(cls[field]); });
    return ids;
}

function getScheduledMainTeacherIds(cls) {
    return _collectScheduleTeacherIds(cls, ['gvList'], ['gvId']);
}

function getScheduledSubstituteIds(cls) {
    return _collectScheduleTeacherIds(cls, ['gvThayTeList', 'gvThayTheList'], ['gvThayTeId', 'gvThayTheId']);
}

function isScheduledMainTeacher(cls, staffId) {
    return !!staffId && getScheduledMainTeacherIds(cls).has(staffId);
}

function isScheduledSubstitute(cls, staffId) {
    return !!staffId && getScheduledSubstituteIds(cls).has(staffId);
}

function hasScheduledSubstitute(cls) {
    return getScheduledSubstituteIds(cls).size > 0;
}

// GV được xếp cho lớp (GV chính, GV thay thế, hoặc tự nhận lớp)
function isAssignedToClass(cls, staffId) {
    return isScheduledMainTeacher(cls, staffId) ||
        isScheduledSubstitute(cls, staffId) ||
        ((cls && cls.registeredTeachers) || []).some(t => t.id === staffId);
}

async function resolveDDNS(domain) {
    if (!domain || domain.trim() === '') return null;
    try {
        const url = `https://dns.google/resolve?name=${encodeURIComponent(domain.trim())}&type=A`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (data && data.Answer) {
            const aRecords = data.Answer.filter(ans => ans.type === 1);
            if (aRecords.length > 0) {
                return aRecords[0].data; // Returns IP string
            }
        }
    } catch (e) {
        console.error(`Error resolving DDNS ${domain}:`, e);
    }
    return null;
}

const LOCATION_CACHE_TTL_MS = 2 * 60 * 1000;
let lastBrowserLocation = null;

function getBrowserLocation(options = {}) {
    return new Promise((resolve, reject) => {
        const maximumAge = options.maximumAge ?? LOCATION_CACHE_TTL_MS;
        if (
            lastBrowserLocation &&
            maximumAge > 0 &&
            Date.now() - lastBrowserLocation.timestamp <= maximumAge
        ) {
            resolve(lastBrowserLocation.coords);
            return;
        }

        if (typeof window === 'undefined' || !navigator.geolocation) {
            reject(new Error("Trình duyệt không hỗ trợ định vị GPS!"));
            return;
        }
        const handleSuccess = position => {
            lastBrowserLocation = {
                coords: position.coords,
                timestamp: Date.now()
            };
            resolve(position.coords);
        };

        navigator.geolocation.getCurrentPosition(
            handleSuccess,
            error => {
                if (
                    options.retryApproximate !== false &&
                    error.code !== error.PERMISSION_DENIED
                ) {
                    navigator.geolocation.getCurrentPosition(
                        handleSuccess,
                        () => {
                            let msg = "Không thể lấy vị trí GPS.";
                            reject(new Error(msg));
                        },
                        { enableHighAccuracy: false, timeout: 12000, maximumAge }
                    );
                    return;
                }

                let msg = "Không thể lấy vị trí GPS.";
                if (error.code === error.PERMISSION_DENIED) {
                    msg = "Vui lòng cấp quyền truy cập Vị trí (GPS) trên điện thoại/trình duyệt để chấm công!";
                }
                reject(new Error(msg));
            },
            { enableHighAccuracy: true, timeout: options.timeout ?? 15000, maximumAge }
        );
    });
}

function calculateDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in meters
}

function getConfiguredGPSCampuses(settings = {}) {
    return [
        { lat: settings.gpsCS1Lat, lng: settings.gpsCS1Lng, radius: settings.gpsCS1Radius || 200, name: 'CS1' },
        { lat: settings.gpsCS2Lat, lng: settings.gpsCS2Lng, radius: settings.gpsCS2Radius || 150, name: 'CS2' },
        { lat: settings.gpsCS3Lat, lng: settings.gpsCS3Lng, radius: settings.gpsCS3Radius || 200, name: 'CS3' }
    ].filter(c =>
        c.lat !== undefined && c.lat !== null && c.lat !== '' &&
        c.lng !== undefined && c.lng !== null && c.lng !== ''
    );
}

async function assertAttendanceLocationAllowed(settings = {}) {
    const campuses = getConfiguredGPSCampuses(settings);
    if (campuses.length === 0) return false;

    let coords;
    try {
        coords = await getBrowserLocation();
    } catch (e) {
        console.error("GPS check error:", e);
        throw new Error("IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để chấm công.");
    }

    const isNearAnyCampus = campuses.some(campus => {
        const dist = calculateDistanceInMeters(coords.latitude, coords.longitude, campus.lat, campus.lng);
        const allowedRadius = campus.radius + Math.min(coords.accuracy || 0, 250);
        return dist <= allowedRadius;
    });

    if (!isNearAnyCampus) {
        throw new Error("IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để chấm công.");
    }

    return true;
}

const DBService = {
    _cache: {},
    _cacheTime: {},
    _invalidate(pattern) {
        Object.keys(this._cache).forEach(key => {
            if (key.includes(pattern)) {
                delete this._cache[key];
                delete this._cacheTime[key];
            }
        });
    },
    _invalidateAttendance(dateKey, userId) {
        this._invalidate(`attendance_${dateKey}_${userId}`);
        if (dateKey && typeof dateKey === 'string') {
            const parts = dateKey.split('-');
            if (parts.length >= 2) {
                const monthStr = `${parts[0]}-${parts[1]}`;
                this._invalidate(`monthly_attendance_${monthStr}_${userId}`);
            }
        }
    },

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
                // Normalize roles array — fallback to single role if array missing
                const rolesArr = Array.isArray(userData.roles) && userData.roles.length > 0
                    ? userData.roles
                    : [userData.role || 'staff'];
                const roleRef = window.db.collection('user_roles').doc(authUser.uid);
                await roleRef.set({
                    userId: userData.id,
                    role: userData.role || 'staff', // Backward compat (single role)
                    roles: rolesArr,                // NEW: multi-role array for accurate RBAC
                    username: userData.username,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log("Security: Role Synced to Auth ID.", rolesArr);
            } catch (err) {
                console.warn("Security: Could not sync role (might lack permission yet).", err);
            }

            // Normalize roles field (backward compat)
            if (!userData.roles || !Array.isArray(userData.roles)) {
                userData.roles = userData.role ? [userData.role] : ['staff'];
            }

            return userData;

        } catch (error) {
            console.error("Secure Login Error:", error);
            if (error.code === 'auth/wrong-password') throw new Error("Sai mật khẩu!");
            if (error.code === 'auth/user-not-found') throw new Error("Tài khoản không tồn tại!");
            if (error.code === 'auth/invalid-credential') throw new Error("Sai tên đăng nhập hoặc mật khẩu!");
            if (error.code === 'auth/too-many-requests') throw new Error("Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau!");
            throw error;
        }
    },

    generateUniqueShortNames: (users) => {
        if (!users || !Array.isArray(users)) return users;

        // 1. Map users to parsing objects
        let parsingList = users.map(u => {
            const parts = u.name ? u.name.trim().split(/\s+/) : ['?'];
            return {
                ...u,
                nameParts: parts,
                lastName: parts[parts.length - 1],
                shortName: parts[parts.length - 1], // Default to just last name
                conflictLevel: 0
            };
        });

        let hasConflicts = true;
        let maxIterations = 5; // Prevent infinite loops just in case

        while (hasConflicts && maxIterations > 0) {
            hasConflicts = false;

            // Group by current shortName
            const nameGroups = {};
            parsingList.forEach(item => {
                if (!nameGroups[item.shortName]) nameGroups[item.shortName] = [];
                nameGroups[item.shortName].push(item);
            });

            // Resolve conflicts
            for (const [sName, group] of Object.entries(nameGroups)) {
                if (group.length > 1) { // Conflict found!
                    hasConflicts = true;
                    group.forEach(item => {
                        item.conflictLevel += 1;
                        if (item.nameParts.length > item.conflictLevel) {
                            // Prepend the initial of the previous name part
                            const idxToPrepend = item.nameParts.length - 1 - item.conflictLevel;
                            const initial = item.nameParts[idxToPrepend].charAt(0).toUpperCase();
                            item.shortName = `${initial}.${item.shortName}`;
                        } else {
                            // If we ran out of parts (e.g. 2 exactly same full names), we must append the ID or stop
                            item.shortName = `${item.shortName}(*${item.id.slice(-2)})`;
                        }
                    });
                }
            }
            maxIterations--;
        }

        // 2. Clean up and return original format with shortName attached
        return parsingList.map(item => {
            const { nameParts, lastName, conflictLevel, ...cleanUser } = item;
            return cleanUser;
        });
    },

    getUsers: async () => {
        const cacheKey = 'users_all';
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snapshot = await db.collection('users').get();
                const rawUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                return DBService.generateUniqueShortNames(rawUsers);
            } catch (error) {
                console.error("Error getting users:", error);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getUser: async (userId) => {
        if (!userId) return null;
        const cacheKey = `user_${userId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const doc = await db.collection('users').doc(userId).get();
                return doc.exists ? { id: doc.id, ...doc.data() } : null;
            } catch (error) {
                console.error("Error getting user:", error);
                return null;
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    saveUser: async (user) => {
        try {
            // user.id determines update or create
            const ref = db.collection('users').doc(user.id);
            await ref.set(user, { merge: true });
            DBService._invalidate('users_all');
            DBService._invalidate(`user_${user.id}`);

            // Sync role to user_roles collection if admin is modifying
            const currentRole = localStorage.getItem('currentRole');
            if (currentRole === 'admin' || currentRole === 'senior_assistant') {
                try {
                    const snap = await db.collection('user_roles').where('username', '==', user.username).get();
                    if (!snap.empty) {
                        const roleDoc = snap.docs[0];
                        const rolesArr = Array.isArray(user.roles) && user.roles.length > 0
                            ? user.roles
                            : [user.role || 'staff'];
                        await roleDoc.ref.update({
                            userId: user.id,
                            role: user.role,
                            roles: rolesArr, // NEW: keep array in sync so RBAC rules can see all roles
                            updatedByAdmin: true,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        console.log("[Security] Admin synced role to user_roles for", user.username, rolesArr);
                    }
                } catch (e) {
                    console.warn("[Security] Could not sync user_roles doc", e);
                }
            }

            return true;
        } catch (error) {
            console.error("Error saving user:", error);
            throw error;
        }
    },

    deleteUser: async (userId) => {
        try {
            await db.collection('users').doc(userId).delete();
            DBService._invalidate('users_all');
            DBService._invalidate(`user_${userId}`);
            return true;
        } catch (error) {
            console.error("Error deleting user:", error);
            throw error;
        }
    },

    // ===== BRANCH HELPERS =====
    _parseBranchKey(compositeKey) {
        // 'cs1__2026-02-21' → { branch: 'cs1', dateKey: '2026-02-21', docId: 'cs1__2026-02-21' }
        // '2026-02-21' (legacy) → { branch: 'cs1', dateKey: '2026-02-21', docId: '2026-02-21' }
        if (compositeKey.includes('__')) {
            const [branch, ...rest] = compositeKey.split('__');
            return { branch, dateKey: rest.join('__'), docId: compositeKey };
        }
        return { branch: 'cs1', dateKey: compositeKey, docId: compositeKey };
    },

    // 4. Schedule Management
    getSchedule: async (compositeKey) => {
        const cacheKey = `schedule_${compositeKey}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const { branch, dateKey, docId } = DBService._parseBranchKey(compositeKey);
                const manifestName = `schedule_manifest_${branch}`;

                // 1. Try Direct Fetch (Lịch Riêng)
                const doc = await db.collection('schedules').doc(docId).get();

                if (doc.exists) {
                    const data = doc.data();
                    const hasStructure = Object.keys(data).length > 0;
                    if (hasStructure) return data;
                }

                // 2. Fallback: Find Nearest Neighbor (Lịch Kế Thừa) — branch-specific manifest
                // Try branch-specific manifest first, then legacy fallback
                let manifestDoc = await db.collection('settings').doc(manifestName).get();
                if (!manifestDoc.exists) {
                    // Legacy fallback: old manifest (for cs1 backward compat)
                    if (branch === 'cs1') {
                        manifestDoc = await db.collection('settings').doc('schedule_manifest').get();
                    }
                    if (!manifestDoc || !manifestDoc.exists) return {};
                }

                const manifest = manifestDoc.data();

                const [y, m, d] = dateKey.split('-').map(Number);
                const localDate = new Date(y, m - 1, d);
                const dayOfWeek = localDate.getDay();
                const dayKey = String(dayOfWeek);

                const availableDates = manifest[dayKey] || manifest[dayOfWeek] || [];
                const pastDates = availableDates.filter(d => d < docId);

                if (pastDates.length === 0) return {};

                pastDates.sort().reverse();
                const neighborDocId = pastDates[0];

                console.log(`[Schedule] Inheriting from ${neighborDocId} for ${docId}`);

                const neighborDoc = await db.collection('schedules').doc(neighborDocId).get();
                if (!neighborDoc.exists) return {};

                const templateData = neighborDoc.data();

                // SANITIZATION: Clean up 'registeredTeachers' and temporary closure 'isClosed'
                Object.keys(templateData).forEach(key => {
                    if (Array.isArray(templateData[key])) {
                        templateData[key] = templateData[key].map(row => {
                            const newRow = { ...row, registeredTeachers: [] };
                            delete newRow.isClosed;
                            // GV thay thế chỉ có hiệu lực đúng ngày được gán — không kế thừa
                            // sang tuần sau (dữ liệu cũ tồn tại cả 2 cách viết The/Te).
                            newRow.gvThayThe = ''; newRow.gvThayTheId = ''; newRow.gvThayTheList = [];
                            newRow.gvThayTe = ''; newRow.gvThayTeId = ''; newRow.gvThayTeList = [];
                            return newRow;
                        });
                    }
                });

                return templateData;

            } catch (error) {
                console.error("Error getting schedule:", error);
                return {};
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    saveSchedule: async (compositeKey, data) => {
        try {
            const { docId } = DBService._parseBranchKey(compositeKey);
            // 1. Save the actual schedule data
            await db.collection('schedules').doc(docId).set(data);

            // 2. Update Manifest
            await DBService.updateScheduleManifest(compositeKey);

            DBService._invalidate(`schedule_${compositeKey}`);
            return true;
        } catch (error) {
            console.error("Error saving schedule:", error);
            throw error;
        }
    },

    updateScheduleManifest: async (compositeKey) => {
        try {
            const { branch, dateKey, docId } = DBService._parseBranchKey(compositeKey);
            const manifestName = `schedule_manifest_${branch}`;

            const [y, m, d] = dateKey.split('-').map(Number);
            const localDate = new Date(y, m - 1, d);
            const dayOfWeek = localDate.getDay();
            const dayKey = String(dayOfWeek);

            const ref = db.collection('settings').doc(manifestName);

            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                const data = doc.exists ? doc.data() : {};

                const list = data[dayKey] || [];
                if (!list.includes(docId)) {
                    list.push(docId);
                    list.sort();
                    data[dayKey] = list;
                    t.set(ref, data, { merge: true });
                }
            });
        } catch (e) {
            console.warn("Error updating manifest:", e);
        }
    },

    // 5. Class Registration (Nhận Lớp) — with branch tagging
    registerClass: async (compositeKey, caType, rowMeta, user) => {
        // rowMeta: { index, branch, ... }
        try {
            const userId = user ? (user.id || user.uid) : null;
            const userName = user ? (user.name || user.displayName || user.username) : null;
            if (!userId) throw new Error("User ID is required for registration!");

            const { branch, dateKey, docId } = DBService._parseBranchKey(compositeKey);
            const manifestName = `schedule_manifest_${branch}`;
            const docRef = db.collection('schedules').doc(docId);

            await db.runTransaction(async (transaction) => {
                let doc = await transaction.get(docRef);
                let data;

                if (!doc.exists) {
                    // FALLBACK: Materialize from Template inside Transaction
                    let manifestDoc = await transaction.get(db.collection('settings').doc(manifestName));
                    // Legacy fallback for cs1
                    if (!manifestDoc.exists && branch === 'cs1') {
                        manifestDoc = await transaction.get(db.collection('settings').doc('schedule_manifest'));
                    }
                    let templateData = {};

                    if (manifestDoc.exists) {
                        const manifest = manifestDoc.data();
                        const [y, m, d] = dateKey.split('-').map(Number);
                        const localDate = new Date(y, m - 1, d);
                        const dayOfWeek = localDate.getDay();

                        const availableDates = manifest[dayOfWeek] || [];
                        const pastDates = availableDates.filter(d => d < docId);

                        if (pastDates.length > 0) {
                            pastDates.sort().reverse();
                            const neighborDocId = pastDates[0];
                            const neighborDoc = await transaction.get(db.collection('schedules').doc(neighborDocId));
                            if (neighborDoc.exists) templateData = neighborDoc.data();
                        }
                    }

                    // Sanitize Template
                    Object.keys(templateData).forEach(key => {
                        if (Array.isArray(templateData[key])) {
                            templateData[key] = templateData[key].map(row => {
                                const newRow = { ...row, registeredTeachers: [] };
                                delete newRow.isClosed;
                                // GV thay thế không kế thừa sang ngày mới (cả 2 cách viết The/Te)
                                newRow.gvThayThe = ''; newRow.gvThayTheId = ''; newRow.gvThayTheList = [];
                                newRow.gvThayTe = ''; newRow.gvThayTeId = ''; newRow.gvThayTeList = [];
                                return newRow;
                            });
                        }
                    });

                    data = templateData;
                } else {
                    data = doc.data();
                }

                const rows = data[caType] || [];
                const rowIndex = rowMeta.index;

                if (!rows[rowIndex]) throw "Class no longer exists (or structure changed)!";

                if (!rows[rowIndex].registeredTeachers) {
                    rows[rowIndex].registeredTeachers = [];
                }

                const isRegistered = rows[rowIndex].registeredTeachers.some(t => t.id === userId);

                if (isRegistered) {
                    rows[rowIndex].registeredTeachers = rows[rowIndex].registeredTeachers.filter(t => t.id !== userId);
                } else {
                    rows[rowIndex].registeredTeachers.push({
                        id: userId,
                        name: userName || "Staff",
                        timestamp: new Date().toISOString(),
                        branch: branch   // ← Tag cơ sở
                    });
                }

                transaction.set(docRef, data);
            });
            DBService._invalidate(`schedule_${compositeKey}`);
            return true;
        } catch (error) {
            console.error("Registration error:", error);
            throw error;
        }
    },

    updateAttendanceSession: async (dateKey, userId, sessionId, newData) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) throw new Error("Không tìm thấy phiên làm việc!");

                const data = doc.data();
                const sessionIndex = data.sessions.findIndex(s => String(s.id) === String(sessionId)); // Loose compare

                if (sessionIndex === -1) throw new Error("Không tìm thấy phiên này!");

                // Update specific fields
                const session = data.sessions[sessionIndex];

                // Merge all fields
                Object.assign(session, newData);

                // Sync top level if it's the latest session
                if (sessionIndex === data.sessions.length - 1) {
                    if (newData.checkIn) data.checkIn = newData.checkIn;
                    if (newData.checkOut !== undefined) data.checkOut = newData.checkOut;
                }

                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                t.set(ref, data);
            });
            DBService._invalidateAttendance(dateKey, userId);
        } catch (error) {
            console.error("Error in updateAttendanceSession:", error);
            throw error;
        }
    },

    // 6. Dashboard Stats
    _getDashboardSessionScheduledEnd: async (userId, dateKey, checkInTime) => {
        if (!userId || !dateKey || !checkInTime) return null;

        const BRANCHES = ['cs1', 'cs2', 'cs3'];
        const classSections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
        const [year, month, day] = dateKey.split('-').map(Number);
        const toLocalTime = (timeStr) => {
            if (!timeStr || !timeStr.includes(':')) return null;
            const [hour, minute] = timeStr.split(':').map(Number);
            return new Date(year, month - 1, day, hour, minute, 0, 0);
        };

        const classShifts = [];
        for (const branch of BRANCHES) {
            const schedule = await DBService.getSchedule(`${branch}__${dateKey}`);
            if (!schedule) continue;

            classSections.forEach(section => {
                (schedule[section] || []).forEach(cls => {
                    const isAssigned = isAssignedToClass(cls, userId);
                    if (!isAssigned) return;

                    const shiftStart = toLocalTime(cls.start);
                    const shiftEnd = toLocalTime(cls.end);
                    if (shiftStart && shiftEnd) {
                        classShifts.push({ start: cls.start, end: cls.end, shiftStart, shiftEnd });
                    }
                });
            });
        }

        const matchedClassEnd = DBService._matchDashboardShiftEnd(classShifts, checkInTime);
        if (matchedClassEnd) return matchedClassEnd;

        const receptionistShifts = await DBService._getDashboardReceptionistShifts(userId, dateKey);
        return DBService._matchDashboardShiftEnd(receptionistShifts, checkInTime);
    },

    _matchDashboardShiftEnd: (shifts, checkInTime) => {
        if (!Array.isArray(shifts) || shifts.length === 0) return null;

        shifts.sort((a, b) => a.shiftStart - b.shiftStart);
        const merged = [];
        shifts.forEach(shift => {
            const prev = merged[merged.length - 1];
            if (prev && prev.end === shift.start) {
                prev.end = shift.end;
                prev.shiftEnd = shift.shiftEnd;
            } else {
                merged.push({ ...shift });
            }
        });

        const matched = merged.find(shift => Math.abs(checkInTime - shift.shiftStart) <= 90 * 60 * 1000);
        return matched ? matched.shiftEnd : null;
    },

    _getDashboardReceptionistShifts: async (userId, dateKey) => {
        const SHIFT_KEYS = ['morning', 'afternoon', 'evening'];
        const DAY_KEYS_MAP = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const BRANCHES = ['cs1', 'cs2', 'cs3'];

        const date = new Date(`${dateKey}T00:00:00`);
        const monday = new Date(date);
        const dayOfWeek = monday.getDay();
        monday.setDate(monday.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
        const mondayKey = getLocalDateKeyFromDate(monday);
        const dayIdx = date.getDay() === 0 ? 6 : date.getDay() - 1;
        const dayKey = DAY_KEYS_MAP[dayIdx];
        const [year, month, day] = dateKey.split('-').map(Number);

        const shifts = [];
        for (const branch of BRANCHES) {
            const weekData = await DBService.getReceptionistSchedule(`${branch}__${mondayKey}`);
            if (!weekData) continue;

            const branchShiftConfig = await DBService.getReceptionistShiftConfig(branch);
            for (const shiftKey of SHIFT_KEYS) {
                const shiftData = weekData[shiftKey];
                const staffEntry = shiftData?.[dayKey]?.find(s => s.id === userId);
                if (!staffEntry) continue;

                const weekShiftCfg = weekData._shiftConfig?.[shiftKey];
                const start = staffEntry.customStart || weekShiftCfg?.start || branchShiftConfig[shiftKey]?.start;
                const end = staffEntry.customEnd || weekShiftCfg?.end || branchShiftConfig[shiftKey]?.end;
                if (!start || !end) continue;

                const [startHour, startMinute] = start.split(':').map(Number);
                const [endHour, endMinute] = end.split(':').map(Number);
                shifts.push({
                    start,
                    end,
                    shiftStart: new Date(year, month - 1, day, startHour, startMinute, 0, 0),
                    shiftEnd: new Date(year, month - 1, day, endHour, endMinute, 0, 0)
                });
            }
        }

        return shifts;
    },

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

                for (const doc of logsSnap.docs) {
                    const data = doc.data();
                    const sessions = data.sessions || [];

                    for (const s of sessions) {
                        const checkInTime = s.checkIn || s.start;
                        if (checkInTime) {
                            // Determine status
                            let status = 'Đúng giờ';
                            const checkInDate = new Date(checkInTime);
                            if (s.checkOut) {
                                status = 'Hoàn thành';
                            } else {
                                const scheduledEnd = await DBService._getDashboardSessionScheduledEnd(data.userId, todayKey, checkInDate);
                                status = scheduledEnd && now >= scheduledEnd ? 'Hết ca theo lịch' : 'Đang làm việc';
                            }

                            recentActivity.push({
                                user: data.name || 'N/A',
                                userId: data.userId || '',
                                time: checkInTime,
                                type: 'in',
                                status: status
                            });
                        }
                    }
                }

                // Sort by time desc, then dedup by userId keeping latest entry per employee
                recentActivity.sort((a, b) => new Date(b.time) - new Date(a.time));
                const seenUsers = new Set();
                recentActivity = recentActivity.filter(a => {
                    const key = a.userId || a.user;
                    if (seenUsers.has(key)) return false;
                    seenUsers.add(key);
                    return true;
                });
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
        const cacheKey = `attendance_${dateKey}_${userId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
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
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getMonthlySchedule: async (monthStr) => {
        try {
            const [yearStr, monthNumStr] = monthStr.split('-');
            const year = parseInt(yearStr, 10);
            const month = parseInt(monthNumStr, 10) - 1; // 0-indexed
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            
            const BRANCHES = ['cs1', 'cs2', 'cs3'];
            const schedulePromises = [];
            
            for (let d = 1; d <= daysInMonth; d++) {
                const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                BRANCHES.forEach(branch => {
                    const compositeKey = `${branch}__${dateKey}`;
                    schedulePromises.push(
                        DBService.getSchedule(compositeKey).then(data => ({ date: dateKey, data: data || {}, branch, compositeKey }))
                    );
                });
            }
            
            const results = await Promise.all(schedulePromises);
            const scheduleMap = {};
            results.forEach(item => {
                if (!scheduleMap[item.date]) scheduleMap[item.date] = {};
                const sections = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];
                sections.forEach(sec => {
                    const rows = item.data[sec] || [];
                    const taggedRows = rows.map((row, idx) => ({ 
                        ...row, 
                        _branch: item.branch, 
                        _compositeKey: item.compositeKey,
                        _originalIndex: idx
                    }));
                    if (!scheduleMap[item.date][sec]) scheduleMap[item.date][sec] = [];
                    scheduleMap[item.date][sec] = scheduleMap[item.date][sec].concat(taggedRows);
                });
            });
            return scheduleMap;
        } catch (e) {
            console.error('getMonthlySchedule error:', e);
            return {};
        }
    },

    getMonthlyAttendance: async (monthStr, userId, forceServer = false) => {
        const cacheKey = `monthly_attendance_${monthStr}_${userId}`;
        if (!forceServer && DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const getOptions = forceServer ? { source: 'server' } : {};
                const snap = await db.collection('attendance_logs')
                    .where('userId', '==', userId)
                    .get(getOptions);

                let logs = [];
                snap.forEach(doc => {
                    let data = doc.data();
                    // Ensure date exists (poly-fill for legacy docs)
                    const date = data.date || doc.id.split('_')[0];
                    
                    if (date && date.startsWith(monthStr)) {
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
                        data.date = date; // polyfill
                        logs.push(data);
                    }
                });
                return logs;
            } catch (error) {
                console.error("Monthly attendance error:", error);
                return [];
            }
        })();

        if (!forceServer) {
            DBService._cache[cacheKey] = promise;
        }
        return promise;
    },

    // 9a. Subjects (Môn học) CRUD
    getSubjects: async () => {
        const cacheKey = 'subjects_all';
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snap = await db.collection('subjects').orderBy('name').get();
                return snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) {
                console.warn('getSubjects error:', e);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    saveSubject: async (data) => {
        try {
            let resId;
            if (data.id) {
                const { id, ...rest } = data;
                await db.collection('subjects').doc(id).set(rest, { merge: true });
                resId = data.id;
            } else {
                const ref = await db.collection('subjects').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
                resId = ref.id;
            }
            DBService._invalidate('subjects_all');
            return resId;
        } catch (e) { console.error('saveSubject error:', e); throw e; }
    },

    deleteSubject: async (id) => {
        try {
            await db.collection('subjects').doc(id).delete();
            DBService._invalidate('subjects_all');
        } catch (e) { console.error('deleteSubject error:', e); throw e; }
    },

    // Cập nhật nhiều môn cùng lúc — dùng khi bật/tắt "sớm 10p" cho cả nhóm,
    // hoặc khi chuyển môn sang nhóm khác. Một batch để không có trạng thái nửa vời.
    saveSubjectsBatch: async (updates) => {
        const list = (updates || []).filter(item => item && item.id);
        if (list.length === 0) return 0;
        try {
            const batch = db.batch();
            list.forEach(({ id, ...fields }) => {
                batch.set(db.collection('subjects').doc(id), fields, { merge: true });
            });
            await batch.commit();
            DBService._invalidate('subjects_all');
            return list.length;
        } catch (e) { console.error('saveSubjectsBatch error:', e); throw e; }
    },

    // Xóa nhiều môn cùng lúc (chọn nhiều trên trang Môn Học). Một batch để tránh
    // xóa được nửa chừng rồi lỗi, dẫn tới danh sách nửa cũ nửa mới.
    deleteSubjectsBatch: async (ids) => {
        const list = (ids || []).filter(Boolean);
        if (list.length === 0) return 0;
        try {
            const batch = db.batch();
            list.forEach(id => { batch.delete(db.collection('subjects').doc(id)); });
            await batch.commit();
            DBService._invalidate('subjects_all');
            return list.length;
        } catch (e) { console.error('deleteSubjectsBatch error:', e); throw e; }
    },

    // 9b. Get all user IDs who have attendance on a given day (for GV absent highlight)
    getDayAttendance: async (dateKey) => {
        try {
            const snap = await db.collection('attendance_logs').where('date', '==', dateKey).get();
            const present = new Set();
            snap.forEach(doc => {
                const d = doc.data();
                if (d.userId && d.sessions && d.sessions.some(s => s.checkIn || s.start)) {
                    present.add(d.userId);
                }
            });
            return present;
        } catch (e) {
            console.warn('getDayAttendance error:', e);
            return new Set();
        }
    },

    getAttendanceRecordsForDate: async (dateKey) => {
        if (!dateKey) return [];
        try {
            const snap = await db.collection('attendance_logs').where('date', '==', dateKey).get();
            return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.warn('getAttendanceRecordsForDate error:', e);
            return [];
        }
    },

    // 9. System Settings
    getSystemSettings: async () => {
        const cacheKey = 'system_settings';
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const doc = await db.collection('settings').doc('system').get();
                return doc.exists ? doc.data() : {};
            } catch (error) {
                console.error("Error getting settings:", error);
                return {};
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    saveSystemSettings: async (data) => {
        try {
            await db.collection('settings').doc('system').set(data, { merge: true });
            DBService._invalidate('system_settings');
            DBService._invalidate('receptionist_config_');
            return true;
        } catch (error) {
            console.error("Error saving settings:", error);
            throw error;
        }
    },

    prepareAttendanceLocationPermission: async () => {
        const settings = await DBService.getSystemSettings();
        if (getConfiguredGPSCampuses(settings).length === 0) return false;
        await getBrowserLocation({ maximumAge: LOCATION_CACHE_TTL_MS, timeout: 10000 });
        return true;
    },

    checkInPersonal: async (userId, userFullName) => {
        const settingsDoc = await db.collection('settings').doc('system').get();
        if (settingsDoc.exists) {
            const settings = settingsDoc.data();
            const hasGPS = getConfiguredGPSCampuses(settings).length > 0;

            if (hasGPS) {
                // Strictly verify GPS location. Do not catch error. Let it throw to abort check-in.
                await assertAttendanceLocationAllowed(settings);
            }
        }

        const now = new Date();
        const dateKey = getLocalDateKeyFromDate(now);
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        await db.runTransaction(async (t) => {
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

            // Cooldown check-in removed as requested

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
        DBService._invalidateAttendance(dateKey, userId);
    },

    checkOutPersonal: async (userId, checkOutTime = null) => {
        const now = checkOutTime instanceof Date ? checkOutTime : new Date();
        const dateKey = getLocalDateKeyFromDate(now);
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        await db.runTransaction(async (t) => {
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
        DBService._invalidateAttendance(dateKey, userId);
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

        await db.runTransaction(async (t) => {
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
        DBService._invalidateAttendance(dateKey, userId);
    },

    deleteSession: async (userId, dateKey, sessionId) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) return;

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
            DBService._invalidateAttendance(dateKey, userId);
        } catch (error) {
            console.error("Error in deleteSession:", error);
            throw error;
        }
    },

    updateSession: async (userId, dateKey, sessionId, newData) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) throw new Error("Attendance record not found");

                const data = doc.data();
                if (!data.sessions) throw new Error("No sessions found");

                const index = data.sessions.findIndex(s => String(s.id) === String(sessionId));
                if (index === -1) throw new Error("Session not found");

                // Update fields
                const session = data.sessions[index];

                // Clear old role/link keys to prevent stale links
                delete session.role;
                delete session.roleName;
                delete session.roleRate;
                delete session.isFixedShift;
                delete session.linkedClassStart;
                delete session.linkedReceptionistShift;

                // QUAN TRỌNG: admin đã sửa giờ tay -> bỏ cờ auto-close.
                // Nếu giữ cờ này, khối auto-close (report.js) sẽ coi ca vẫn "quên ra ca"
                // và GHI ĐÈ giờ ra của admin về giờ tan ca/23:59 ở lần tải trang sau.
                delete session.autoClosedReason;

                // Merge new data
                Object.assign(session, newData);

                if (newData.checkIn) {
                    session.start = newData.checkIn; // Sync legacy
                }

                // Sync top level if this is the last session
                if (index === data.sessions.length - 1) {
                    data.checkIn = session.checkIn;
                    data.checkOut = session.checkOut;
                }

                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                t.set(ref, data);
            });
            DBService._invalidateAttendance(dateKey, userId);
        } catch (error) {
            console.error("Error in updateSession:", error);
            throw error;
        }
    },

    updateSessionRole: async (userId, dateKey, sessionId, roleData) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) throw new Error("Attendance record not found");

                const data = doc.data();
                if (!data.sessions) throw new Error("No sessions found");

                const index = data.sessions.findIndex(s => String(s.id) === String(sessionId));
                if (index === -1) throw new Error("Session not found");

                // Update Role
                const session = data.sessions[index];
                session.role = roleData.id || '';
                session.roleName = roleData.name || '';
                if (roleData.rate !== undefined && roleData.rate !== null) {
                    session.roleRate = roleData.rate;
                } else if (session.roleRate !== undefined) {
                    delete session.roleRate;
                }

                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                t.set(ref, data);
            });
            DBService._invalidateAttendance(dateKey, userId);
        } catch (error) {
            console.error("Error in updateSessionRole:", error);
            throw error;
        }
    },

    updateSessionStudentCount: async (userId, dateKey, sessionId, studentCount, status, updaterId, role) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) throw new Error("Attendance record not found");

                const data = doc.data();
                if (!data.sessions) throw new Error("No sessions found");

                const index = data.sessions.findIndex(s => String(s.id) === String(sessionId));
                if (index === -1) throw new Error("Session not found");

                const session = data.sessions[index];
                const isAdmin = ['admin', 'senior_assistant'].includes(role);

                // Enforce editing permissions
                if (!isAdmin) {
                    // Teacher permissions: can only edit if status is empty, or pending
                    const currentStatus = session.studentCountStatus;
                    if (currentStatus && currentStatus !== 'pending') {
                        throw new Error("Không thể chỉnh sửa ca đã được duyệt hoặc từ chối.");
                    }
                    if (studentCount === null || studentCount === undefined || studentCount <= 0) {
                        delete session.studentCount;
                        delete session.studentCountStatus;
                        delete session.studentCountUpdatedAt;
                        delete session.studentCountUpdatedBy;
                    } else {
                        session.studentCount = Number(studentCount);
                        session.studentCountStatus = 'pending';
                        session.studentCountUpdatedAt = new Date().toISOString();
                        session.studentCountUpdatedBy = updaterId || userId;
                    }
                } else {
                    // Admin permissions: can set to approved or rejected or clear
                    if (studentCount === null || studentCount === undefined || studentCount <= 0) {
                        delete session.studentCount;
                        delete session.studentCountStatus;
                        delete session.studentCountUpdatedAt;
                        delete session.studentCountUpdatedBy;
                        delete session.studentCountReviewedAt;
                        delete session.studentCountReviewedBy;
                    } else {
                        session.studentCount = Number(studentCount);
                        session.studentCountStatus = status || 'pending';
                        if (status === 'approved' || status === 'rejected') {
                            session.studentCountReviewedAt = new Date().toISOString();
                            session.studentCountReviewedBy = updaterId;
                        } else {
                            delete session.studentCountReviewedAt;
                            delete session.studentCountReviewedBy;
                        }
                    }
                }

                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                t.set(ref, data);
            });
            DBService._invalidateAttendance(dateKey, userId);
            return true;
        } catch (error) {
            console.error("Error in updateSessionStudentCount:", error);
            throw error;
        }
    },

    saveMonthlyStudentCountPenalty: async (staffId, monthStr, hasPenalty, adminId, reason = '') => {
        if (!staffId || !monthStr) {
            throw new Error('[MonthlySalarySettings] staffId and monthStr are required.');
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            const payload = {
                studentCountBonusPenalty: !!hasPenalty,
                studentCountBonusPenaltyAt: hasPenalty ? new Date().toISOString() : null,
                studentCountBonusPenaltyBy: hasPenalty ? adminId : null,
                studentCountBonusPenaltyReason: hasPenalty ? reason : null
            };
            await db.collection('salary_settings_monthly').doc(docId).set(payload, { merge: true });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return true;
        } catch (e) {
            console.error('[saveMonthlyStudentCountPenalty] Error saving penalty:', e);
            throw e;
        }
    },


    // Đặt cờ bonus10 theo giá trị mong muốn. Dùng khi hệ thống tự duyệt: toggle
    // sẽ TẮT nhầm nếu ca đã có cờ sẵn (VD ca cũ do admin tặng tay).
    setSessionBonus10: async (userId, dateKey, sessionId, value) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);
        try {
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) throw new Error("Không tìm thấy dữ liệu chấm công ngày này");
                const data = doc.data();
                if (!data.sessions) throw new Error("Không tìm thấy phiên làm việc nào");
                const index = data.sessions.findIndex(s => String(s.id) === String(sessionId));
                if (index === -1) throw new Error("Không tìm thấy phiên làm việc cụ thể");

                data.sessions[index].bonus10 = !!value;
                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                t.set(ref, data);
            });
            DBService._invalidateAttendance(dateKey, userId);
            return !!value;
        } catch (error) {
            console.error("Error in setSessionBonus10:", error);
            throw error;
        }
    },

    toggleSessionBonus10: async (userId, dateKey, sessionId) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            let result;
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) throw new Error("Không tìm thấy dữ liệu chấm công ngày này");

                const data = doc.data();
                if (!data.sessions) throw new Error("Không tìm thấy phiên làm việc nào");

                const index = data.sessions.findIndex(s => String(s.id) === String(sessionId));
                if (index === -1) throw new Error("Không tìm thấy phiên làm việc cụ thể");

                // Toggle bonus10 (treat undefined as false, so !undefined -> true)
                data.sessions[index].bonus10 = !data.sessions[index].bonus10;

                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                t.set(ref, data);

                result = data.sessions[index].bonus10;
            });
            DBService._invalidateAttendance(dateKey, userId);
            return result;
        } catch (error) {
            console.error("Error in toggleSessionBonus10:", error);
            throw error;
        }
    },

    // 7.2 Generic Add Session (Admin)
    // options.allowOverlap = true → cố tình thêm dù trùng giờ (người duyệt đã xác nhận).
    // Mặc định CHẶN: nhân viên chỉ bấm vào ca một lần, nên hai ca cùng khung giờ luôn là
    // do thêm tay/duyệt chấm bù hai lần cho hai lớp dạy cùng giờ → bảng công tính lương
    // đôi. Chặn ngay từ lúc ghi rẻ hơn nhiều so với đi dò lại bảng lương cuối tháng.
    addSession: async (userId, dateKey, sessionData, options = {}) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        // Fetch user name if not exists (for display)
        let userName = 'N/A';
        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) userName = userDoc.data().name || userDoc.data().username;
        } catch (e) { }

        let newSessionId = null;
        try {
            await db.runTransaction(async (t) => {
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

                // === CHẶN CA TRÙNG GIỜ ===
                if (!options.allowOverlap && !sessionData.isAbsent && sessionData.checkOut) {
                    const a1 = new Date(newStart).getTime();
                    const a2 = new Date(sessionData.checkOut).getTime();
                    const clash = data.sessions.find(x => {
                        if (!x || x.isAbsent || !(x.checkIn || x.start)) return false;
                        const b1 = new Date(x.checkIn || x.start).getTime();
                        const b2 = x.checkOut ? new Date(x.checkOut).getTime() : b1;
                        // Chồng nhau từ 10 phút trở lên mới coi là trùng (tránh bắt lỗi ca
                        // nối tiếp lệch một hai phút).
                        return Math.min(a2, b2) - Math.max(a1, b1) >= 10 * 60 * 1000;
                    });
                    if (clash) {
                        const fmt = (iso) => iso
                            ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                            : '??:??';
                        const err = new Error(
                            `Ngày ${dateKey} đã có ca ${fmt(clash.checkIn || clash.start)}–${fmt(clash.checkOut)} ` +
                            `trùng khung giờ này. Thêm nữa là bảng công tính lương hai lần cho cùng một giờ làm.`
                        );
                        err.code = 'SESSION_OVERLAP';
                        err.clash = clash;
                        throw err;
                    }
                }

                const newSession = {
                    id: Date.now(),
                    start: newStart,
                    checkIn: sessionData.checkIn,
                    checkOut: sessionData.checkOut || null,
                    type: 'admin_add',
                    ...sessionData
                };

                data.sessions.push(newSession);

                // Sync top level (last session wins)
                data.checkIn = newSession.checkIn;
                data.checkOut = newSession.checkOut;
                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

                t.set(ref, data);
                newSessionId = newSession.id;
            });
            DBService._invalidateAttendance(dateKey, userId);
            return newSessionId;
        } catch (error) {
            console.error("Error in addSession:", error);
            throw error;
        }
    },

    getDashboardStats: async () => {
        try {
            // Count Users (Optimized with cache)
            const users = await DBService.getUsers();
            const totalUsers = users.length;

            // Count Active Attendance Today (Local Time Logic)
            const now = new Date();
            const localDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
            const todayKey = localDate.toISOString().split('T')[0];

            const logsSnap = await db.collection('attendance_logs').where('date', '==', todayKey).get();

            let checkedInCount = 0;
            let recentActivity = [];

            if (!logsSnap.empty) {
                checkedInCount = logsSnap.size;

                for (const doc of logsSnap.docs) {
                    const data = doc.data();
                    const sessions = data.sessions || [];

                    for (const s of sessions) {
                        const checkInTime = s.checkIn || s.start;
                        if (checkInTime) {
                            // Determine status
                            let status = 'Đúng giờ';
                            const checkInDate = new Date(checkInTime);
                            if (s.checkOut) {
                                status = 'Hoàn thành';
                            } else {
                                const scheduledEnd = await DBService._getDashboardSessionScheduledEnd(data.userId, todayKey, checkInDate);
                                status = scheduledEnd && now >= scheduledEnd ? 'Hết ca theo lịch' : 'Đang làm việc';
                            }

                            recentActivity.push({
                                user: data.name || 'N/A',
                                userId: data.userId || '',
                                time: checkInTime,
                                type: 'in',
                                status: status
                            });
                        }
                    }
                }

                // Sort & Slice — dedup by userId keeping latest entry per employee
                recentActivity.sort((a, b) => new Date(b.time) - new Date(a.time));
                const seenUsers2 = new Set();
                recentActivity = recentActivity.filter(a => {
                    const key = a.userId || a.user;
                    if (seenUsers2.has(key)) return false;
                    seenUsers2.add(key);
                    return true;
                });
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
    },

    // ========== UNREGISTERED ALERTS ==========

    // Create alert when staff checks in without registering for any class
    createUnregisteredAlert: async (userId, userName, dateKey, checkInTime) => {
        try {
            const alertId = `${dateKey}_${userId}`;
            console.log('[Alert] Creating alert:', alertId, 'for', userName);
            const ref = db.collection('unregistered_alerts').doc(alertId);

            // Use set() directly — no need to check existence first
            // (Staff can't read this collection, and overwriting same-day alert is fine)
            await ref.set({
                userId: userId,
                userName: userName,
                date: dateKey,
                checkIn: checkInTime,
                resolved: false,
                resolvedBy: null,
                resolvedAt: null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('[Alert] Successfully created alert for', userName);
        } catch (e) {
            console.error('[Alert] FAILED to create alert:', e.code, e.message);
        }
    },

    // Get unresolved alerts for admin dashboard
    getUnregisteredAlerts: async () => {
        try {
            // Simple query without orderBy to avoid needing composite index
            const snapshot = await db.collection('unregistered_alerts')
                .where('resolved', '==', false)
                .limit(20)
                .get();

            const alerts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Sort client-side by date descending
            alerts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            return alerts;
        } catch (e) {
            console.warn("[Alert] Error getting alerts:", e);
            return [];
        }
    },

    // Admin resolves an alert
    resolveAlert: async (alertId, adminName) => {
        try {
            await db.collection('unregistered_alerts').doc(alertId).update({
                resolved: true,
                resolvedBy: adminName,
                resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            console.error("[Alert] Error resolving:", e);
            throw e;
        }
    },

    // ================= ADMIN NOTIFICATIONS =================

    // Create notification for staff when admin modifies their data
    createAdminNotification: async (staffId, staffName, action, dateKey, details) => {
        try {
            const currentUser = firebase.auth().currentUser;
            const adminName = currentUser ? (currentUser.displayName || currentUser.email || 'Admin') : 'Admin';

            await db.collection('admin_notifications').add({
                staffId: staffId,
                staffName: staffName || 'N/A',
                action: action, // 'add_session', 'edit_session', 'delete_session', 'select_role'
                dateKey: dateKey,
                details: details,
                adminName: adminName,
                read: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('[Notification] Created:', action, 'for', staffName);
        } catch (e) {
            console.warn('[Notification] Failed to create:', e.message);
            // Non-blocking: don't throw, notification failure shouldn't stop main action
        }
    },

    // Get unread notifications for a staff member
    getStaffNotifications: async (staffId) => {
        try {
            // Single WHERE to avoid composite index requirement
            const snap = await db.collection('admin_notifications')
                .where('staffId', '==', staffId)
                .limit(50)
                .get();

            // Client-side filter: only unread
            const results = snap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(n => n.read === false);

            // Sort client-side (newest first)
            results.sort((a, b) => {
                const ta = a.createdAt ? a.createdAt.seconds : 0;
                const tb = b.createdAt ? b.createdAt.seconds : 0;
                return tb - ta;
            });
            return results;
        } catch (e) {
            console.error('[Notification] Error fetching:', e.message);
            return [];
        }
    },

    // Mark a notification as read
    markNotificationRead: async (notifId) => {
        try {
            await db.collection('admin_notifications').doc(notifId).update({
                read: true,
                readAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            console.warn('[Notification] Error marking read:', e.message);
        }
    },

    // Mark ALL notifications for a staff as read
    markAllNotificationsRead: async (staffId) => {
        try {
            const snap = await db.collection('admin_notifications')
                .where('staffId', '==', staffId)
                .where('read', '==', false)
                .get();

            const batch = db.batch();
            snap.docs.forEach(doc => {
                batch.update(doc.ref, {
                    read: true,
                    readAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
            console.log('[Notification] Marked all read for', staffId);
        } catch (e) {
            console.warn('[Notification] Error marking all read:', e.message);
        }
    },

    // ================= MAKEUP REQUESTS (Tường trình — chấm công bù) =================
    // Nhân viên gửi yêu cầu chấm bù (ca có lịch quên chấm / ca ngoài lịch). Admin duyệt
    // → materialize session qua DBService.addSession (transaction có sẵn, an toàn dữ liệu).

    createMakeupRequests: async (requests) => {
        const batchId = `mk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const batch = db.batch();
        requests.forEach(r => {
            const ref = db.collection('makeup_requests').doc();
            batch.set(ref, { ...r, batchId, status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        });
        await batch.commit();
        return { batchId, count: requests.length };
    },

    getMyMakeupRequests: async (staffId) => {
        try {
            const snap = await db.collection('makeup_requests').where('staffId', '==', staffId).limit(100).get();
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            list.sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0));
            return list;
        } catch (e) { console.error('[Makeup] get mine:', e); return []; }
    },

    getMakeupRequestsByStatus: async (status) => {
        try {
            const snap = await db.collection('makeup_requests').where('status', '==', status).limit(200).get();
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            list.sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0));
            return list;
        } catch (e) { console.error('[Makeup] get by status:', e); return []; }
    },

    // options.allowOverlap = true → quản lý đã xem cảnh báo "đã có công trùng giờ" và
    // vẫn quyết định duyệt. Mặc định chặn để một lần bấm nhầm không thành lương đôi.
    approveMakeupRequest: async (req, adminName, options = {}) => {
        const s = req.session || {};
        const sessionData = {
            checkIn: s.checkIn || null,
            checkOut: s.checkOut || null,
            role: s.role || null,
            roleName: s.roleName || null,
            isAdminEdited: true, // admin duyệt = admin xác nhận giờ (quy tắc admin-là-chuẩn)
            makeupRequestId: req.id,
            // 'makeup' (có lịch) → session thường, khớp lịch như chấm công thật;
            // 'admin_add' (ngoài lịch) → hiển thị "Ca Thêm" như admin thêm tay.
            type: req.type === 'unscheduled' ? 'admin_add' : 'makeup'
        };
        if (s.isAbsent) sessionData.isAbsent = true;
        if (s.bonus10) sessionData.bonus10 = true;
        // Neo ca vừa duyệt vào đúng ô lịch để Bảng Công không phải đoán:
        //  - ca có lịch  → linkedClassStart = giờ bắt đầu ca đã chọn
        //  - ca tiếp tân → linkedReceptionistShift = sáng/chiều/tối
        if (s.linkedReceptionistShift) sessionData.linkedReceptionistShift = s.linkedReceptionistShift;
        else if (req.shiftKind === 'tt' && req.shiftKey) sessionData.linkedReceptionistShift = req.shiftKey;
        else if (req.shiftStart) sessionData.linkedClassStart = req.shiftStart;
        if (req.branch) sessionData.branch = req.branch;
        if (req.className) sessionData.className = req.className;
        if (req.room) sessionData.room = req.room;
        const sid = await DBService.addSession(req.staffId, req.dateKey, sessionData, {
            allowOverlap: !!options.allowOverlap
        });

        if (s.overtimeMinutes > 0) {
            const h = Math.floor(s.overtimeMinutes / 60), m = s.overtimeMinutes % 60;
            await db.collection('overtime_requests').add({
                staffId: req.staffId, staffName: req.staffName || 'N/A', dateKey: req.dateKey,
                sessionId: String(sid),
                duration: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
                minutes: s.overtimeMinutes, status: 'approved',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                approvedBy: adminName || 'Admin', approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        await db.collection('makeup_requests').doc(req.id).update({
            status: 'approved', reviewedBy: adminName || 'Admin',
            reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
            materializedSessionId: String(sid)
        });
        return sid;
    },

    rejectMakeupRequest: async (reqId, adminName, reason) => {
        await db.collection('makeup_requests').doc(reqId).update({
            status: 'rejected', reviewedBy: adminName || 'Admin',
            reviewedAt: firebase.firestore.FieldValue.serverTimestamp(), rejectReason: reason || ''
        });
    },

    // ================= BROADCAST ANNOUNCEMENTS (Thông báo nội bộ) =================
    // Tái dùng collection admin_notifications: mỗi người nhận 1 doc (action:'announcement')
    // → chuông + popup + đánh dấu đã đọc CÓ SẴN của nhân viên tự hoạt động, không cần rules mới.

    // recipients: [{id, name}], payload: {title, message, color, icon}
    sendAnnouncement: async (recipients, payload) => {
        const currentUser = firebase.auth().currentUser;
        const adminName = currentUser ? (currentUser.displayName || currentUser.email || 'Admin') : 'Admin';
        const batchId = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const todayKey = new Date().toISOString().split('T')[0];

        // Firestore batch tối đa 500 op — chia khúc 400 cho an toàn
        for (let i = 0; i < recipients.length; i += 400) {
            const chunk = recipients.slice(i, i + 400);
            const batch = db.batch();
            chunk.forEach(r => {
                const ref = db.collection('admin_notifications').doc();
                batch.set(ref, {
                    staffId: r.id,
                    staffName: r.name || 'N/A',
                    action: 'announcement',
                    title: payload.title,
                    details: payload.message,
                    color: payload.color || 'blue',
                    icon: payload.icon || 'bell',
                    batchId: batchId,
                    dateKey: todayKey,
                    adminName: adminName,
                    read: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
        }
        return { batchId, count: recipients.length };
    },

    // Lịch sử thông báo đã gửi — gom theo batchId, kèm số người đã đọc
    getRecentAnnouncements: async (maxGroups = 8) => {
        try {
            // 1 WHERE duy nhất để không cần composite index
            const snap = await db.collection('admin_notifications')
                .where('action', '==', 'announcement')
                .limit(400)
                .get();
            const groups = {};
            snap.docs.forEach(doc => {
                const d = doc.data();
                const key = d.batchId || doc.id;
                if (!groups[key]) {
                    groups[key] = { batchId: key, title: d.title || '(không tiêu đề)', details: d.details || '', color: d.color || 'blue', icon: d.icon || 'bell', adminName: d.adminName || 'Admin', createdAt: d.createdAt, total: 0, readCount: 0 };
                }
                groups[key].total++;
                if (d.read === true) groups[key].readCount++;
                const t = d.createdAt && d.createdAt.seconds ? d.createdAt.seconds : 0;
                const cur = groups[key].createdAt && groups[key].createdAt.seconds ? groups[key].createdAt.seconds : 0;
                if (t > cur) groups[key].createdAt = d.createdAt;
            });
            return Object.values(groups)
                .sort((a, b) => ((b.createdAt?.seconds) || 0) - ((a.createdAt?.seconds) || 0))
                .slice(0, maxGroups);
        } catch (e) {
            console.error('[Announcement] Error fetching history:', e);
            return [];
        }
    },

    // ================= AUTO-CLOSE STALE SESSIONS =================
    // Close open sessions from past days that were never checked out
    autoCloseStaleSession: async (userId, dateKey, sessionId, correctEndISO = null) => {
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);

        try {
            return db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (!doc.exists) return false;

                const data = doc.data();
                if (!data.sessions || !Array.isArray(data.sessions)) return false;

                // Find the open session by ID
                const idx = data.sessions.findIndex(s => String(s.id) === String(sessionId) && !s.checkOut);
                if (idx === -1) return false; // Already closed or not found

                // Dùng giờ kết thúc lịch nếu được truyền vào, fallback 23:59
                const endOfDayISO = correctEndISO || new Date(`${dateKey}T23:59:00`).toISOString();
                data.sessions[idx].checkOut = endOfDayISO;
                data.sessions[idx].autoClosedReason = 'stale_session'; // Marker

                // Sync top level if last session
                if (idx === data.sessions.length - 1) {
                    data.checkOut = endOfDayISO;
                }
                data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

                t.set(ref, data);
                console.log(`[AutoClose] Closed stale session ${sessionId} for ${userId} on ${dateKey}`);
                return true;
            });
        } catch (e) {
            console.warn('[AutoClose] Error:', e);
            return false;
        }
    },

    // ================= RECEPTIONIST SCHEDULE =================

    async getReceptionistSchedule(compositeKey) {
        const cacheKey = `receptionist_schedule_${compositeKey}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const doc = await db.collection('receptionist_schedules').doc(compositeKey).get();
                return doc.exists ? doc.data() : null;
            } catch (e) {
                console.error('[ReceptionistSchedule] Error getting:', e);
                return null;
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    async saveReceptionistSchedule(compositeKey, data) {
        try {
            await db.collection('receptionist_schedules').doc(compositeKey).set(data);
            DBService._invalidate(`receptionist_schedule_${compositeKey}`);
            return true;
        } catch (e) {
            console.error('[ReceptionistSchedule] Error saving:', e);
            throw e;
        }
    },

    async unassignReceptionist(compositeKey, shiftKey, dayKey, staffId) {
        try {
            console.log(`[UnassignReceptionist] Start: composite=${compositeKey}, shift=${shiftKey}, day=${dayKey}, staff=${staffId}`);
            const result = await db.runTransaction(async (t) => {
                const docRef = db.collection('receptionist_schedules').doc(compositeKey);
                const doc = await t.get(docRef);
                if (!doc.exists) {
                    console.log(`[UnassignReceptionist] Doc not found: ${compositeKey}`);
                    return false;
                }

                const data = doc.data();
                if (!data[shiftKey] || !data[shiftKey][dayKey]) {
                    console.log(`[UnassignReceptionist] Path not found: ${shiftKey}.${dayKey}`);
                    return false;
                }

                const originalLength = data[shiftKey][dayKey].length;
                data[shiftKey][dayKey] = data[shiftKey][dayKey].filter(s => s.id !== staffId);

                console.log(`[UnassignReceptionist] Filtered from ${originalLength} to ${data[shiftKey][dayKey].length}`);

                if (data[shiftKey][dayKey].length < originalLength) {
                    t.update(docRef, { [shiftKey]: data[shiftKey] });
                    console.log(`[UnassignReceptionist] Success! Updated doc.`);
                    return true;
                }
                console.log(`[UnassignReceptionist] No match found for staffId: ${staffId}`);
                return false;
            });
            DBService._invalidate(`receptionist_schedule_${compositeKey}`);
            return result;
        } catch (e) {
            console.error('[ReceptionistSchedule] Error unassigning:', e);
            throw e;
        }
    },

    // Get receptionist shift time config from system settings (per-branch)
    async getReceptionistShiftConfig(branch) {
        const cacheKey = `receptionist_config_${branch || 'global'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            const defaults = {
                morning: { start: '07:00', end: '11:30' },
                afternoon: { start: '14:00', end: '18:00' },
                evening: { start: '17:30', end: '21:30' }
            };
            try {
                const settings = await this.getSystemSettings();
                // Try per-branch key first, then fallback to global
                if (branch) {
                    const branchKey = `receptionistShifts_${branch}`;
                    if (settings?.[branchKey]) return settings[branchKey];
                }
                return settings?.receptionistShifts || defaults;
            } catch (e) {
                console.warn('[ReceptionistSchedule] Using default shift config');
                return defaults;
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    // ================= SHIFT OVERSIGHT (RECEPTIONIST -> TEACHER) =================

    _buildReceptionistPresenceId(dateKey, branch, shiftKey, staffId) {
        return [dateKey, branch, shiftKey, staffId]
            .map(value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_'))
            .join('_');
    },

    async getReceptionistShiftPresence(dateKey, branch, shiftKey, staffIds = []) {
        const uniqueIds = [...new Set((staffIds || []).filter(Boolean))];
        if (uniqueIds.length === 0) return [];

        try {
            const docs = await Promise.all(uniqueIds.map(staffId => {
                const id = DBService._buildReceptionistPresenceId(dateKey, branch, shiftKey, staffId);
                return db.collection('receptionist_shift_presence').doc(id).get();
            }));
            return docs.filter(doc => doc.exists).map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error('[ShiftOversight] Error loading shift presence:', e);
            return [];
        }
    },

    async activateReceptionistShift(dateKey, branch, shiftKey, staffId, staffName) {
        const authUser = firebase.auth().currentUser;
        if (!authUser) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        if (!dateKey || !branch || !shiftKey || !staffId) {
            throw new Error('Thiếu thông tin ca trực.');
        }

        const id = DBService._buildReceptionistPresenceId(dateKey, branch, shiftKey, staffId);
        const ref = db.collection('receptionist_shift_presence').doc(id);
        await ref.set({
            dateKey,
            branch,
            shiftKey,
            staffId,
            staffName: staffName || localStorage.getItem('userFullName') || '',
            authUid: authUser.uid,
            status: 'active',
            activatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return id;
    },

    async getShiftObservationsForDate(dateKey) {
        if (!dateKey) return [];
        try {
            const snap = await db.collection('shift_observations')
                .where('dateKey', '==', dateKey)
                .get();
            return snap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => String(b.createdAt?.seconds || 0).localeCompare(String(a.createdAt?.seconds || 0)));
        } catch (e) {
            console.error('[ShiftOversight] Error loading observations for date:', e);
            return [];
        }
    },

    async getShiftObservationsForMonth(monthStr, staffId = '') {
        if (!/^\d{4}-\d{2}$/.test(monthStr || '')) return [];
        const cacheKey = `shift_observations_${monthStr}_${staffId || 'all'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            const start = `${monthStr}-01`;
            const [year, month] = monthStr.split('-').map(Number);
            const nextMonth = new Date(year, month, 1);
            const end = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;
            try {
                // A staff-scoped equality query is required so Firestore rules can
                // prove teachers only read their own observations. Date filtering
                // stays client-side to avoid requiring a new composite index.
                let query = db.collection('shift_observations');
                if (staffId) {
                    query = query.where('teacherId', '==', staffId);
                } else {
                    query = query.where('dateKey', '>=', start).where('dateKey', '<', end);
                }
                const snap = await query.get();
                return snap.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(item => item.dateKey >= start && item.dateKey < end)
                    .filter(item => !staffId || item.teacherId === staffId);
            } catch (e) {
                console.error('[ShiftOversight] Error loading monthly observations:', e);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    async getShiftObservationsByRange(fromDate, toDate) {
        if (!fromDate || !toDate) return [];
        try {
            const snap = await db.collection('shift_observations')
                .where('dateKey', '>=', fromDate)
                .where('dateKey', '<=', toDate)
                .get();
            return snap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => {
                    const dateCmp = String(b.dateKey || '').localeCompare(String(a.dateKey || ''));
                    if (dateCmp !== 0) return dateCmp;
                    return Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0);
                });
        } catch (e) {
            console.error('[ShiftOversight] Error loading observation range:', e);
            return [];
        }
    },

    async createShiftObservation(payload) {
        const authUser = firebase.auth().currentUser;
        if (!authUser) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');

        const required = ['dateKey', 'branch', 'shiftKey', 'teacherId', 'classStart', 'classEnd'];
        const missing = required.find(field => !payload?.[field]);
        if (missing) throw new Error(`Thiếu dữ liệu bắt buộc: ${missing}`);

        const lateMinutes = Math.max(0, Math.min(240, Math.round(Number(payload.lateMinutes) || 0)));
        const note = String(payload.note || '').trim().slice(0, 500);
        if (lateMinutes === 0 && !note) {
            throw new Error('Vui lòng nhập số phút trễ hoặc nội dung ghi chú.');
        }

        const creatorStaffId = localStorage.getItem('currentUserId') || '';
        const creatorName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || '';
        if (!creatorStaffId) throw new Error('Không xác định được người tạo lệnh.');

        const ref = await db.collection('shift_observations').add({
            dateKey: payload.dateKey,
            branch: payload.branch,
            shiftKey: payload.shiftKey,
            scheduleCompositeKey: payload.scheduleCompositeKey || `${payload.branch}__${payload.dateKey}`,
            classSectionKey: payload.classSectionKey || '',
            classIndex: Number.isInteger(payload.classIndex) ? payload.classIndex : Number(payload.classIndex || 0),
            classStart: payload.classStart,
            classEnd: payload.classEnd,
            className: String(payload.className || '').slice(0, 160),
            subjectId: payload.subjectId || '',
            teacherId: payload.teacherId,
            teacherName: String(payload.teacherName || '').slice(0, 160),
            lateMinutes,
            systemLateAtCreation: Math.max(0, Math.round(Number(payload.systemLateAtCreation) || 0)),
            effectiveLateAtCreation: Math.max(lateMinutes, Math.round(Number(payload.systemLateAtCreation) || 0)),
            note,
            kind: lateMinutes > 0 ? 'late_adjustment' : 'note',
            status: 'active',
            createdByStaffId: creatorStaffId,
            createdByName: creatorName,
            createdByAuthUid: authUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        DBService._invalidate('shift_observations_');
        return ref.id;
    },

    async cancelShiftObservation(observationId, reason = '') {
        if (!observationId) throw new Error('Thiếu mã lệnh cần hủy.');
        const adminName = localStorage.getItem('userFullName') || localStorage.getItem('currentUser') || 'Admin';
        await db.collection('shift_observations').doc(observationId).update({
            status: 'cancelled',
            cancelledByName: adminName,
            cancelReason: String(reason || '').trim().slice(0, 300),
            cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        DBService._invalidate('shift_observations_');
        return true;
    },

    // ================= DAILY NOTES (Firestore-synced) =================

    // Get all daily notes for a staff member
    async getDailyNotes(staffId) {
        if (!staffId || staffId.trim() === '') {
            console.warn('[DailyNotes] staffId is empty, skipping.');
            return {};
        }
        const cacheKey = `daily_notes_${staffId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const doc = await db.collection('daily_notes').doc(staffId).get();
                return doc.exists ? doc.data() : {};
            } catch (e) {
                console.error('[DailyNotes] Error getting:', e);
                return {};
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    // Save daily notes for a staff member (full object: { "2026-03-01": "note text", ... })
    async saveDailyNotes(staffId, notesObj) {
        try {
            await db.collection('daily_notes').doc(staffId).set(notesObj);
            DBService._invalidate(`daily_notes_${staffId}`);
            return true;
        } catch (e) {
            console.error('[DailyNotes] Error saving:', e);
            throw e;
        }
    },

    // ================= SALARY SETTINGS (Firestore-synced) =================

    // Get salary settings for a staff member
    async getSalarySettings(staffId) {
        if (!staffId || staffId.trim() === '') {
            console.warn('[SalarySettings] staffId is empty, skipping.');
            return {};
        }
        try {
            const doc = await db.collection('salary_settings').doc(staffId).get();
            return doc.exists ? doc.data() : {};
        } catch (e) {
            console.error('[SalarySettings] Error getting:', e);
            return {};
        }
    },

    // Save salary settings for a staff member
    async saveSalarySettings(staffId, settingsObj) {
        try {
            await db.collection('salary_settings').doc(staffId).set(settingsObj, { merge: true });
            return true;
        } catch (e) {
            console.error('[SalarySettings] Error saving:', e);
            throw e;
        }
    },

    // Get monthly salary settings for a staff member and specific month
    async getMonthlySalarySettings(staffId, monthStr) {
        if (!staffId || staffId.trim() === '' || !monthStr) {
            console.warn('[MonthlySalarySettings] staffId or monthStr is empty, skipping.');
            return {};
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            const doc = await db.collection('salary_settings_monthly').doc(docId).get();
            return doc.exists ? doc.data() : {};
        } catch (e) {
            console.error('[MonthlySalarySettings] Error getting:', e);
            return {};
        }
    },

    // Save monthly salary settings for a staff member and specific month
    async saveMonthlySalarySettings(staffId, monthStr, settingsObj) {
        if (!staffId || !monthStr) {
            throw new Error('[MonthlySalarySettings] staffId and monthStr are required.');
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            await db.collection('salary_settings_monthly').doc(docId).set(settingsObj, { merge: true });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return true;
        } catch (e) {
            console.error('[MonthlySalarySettings] Error saving:', e);
            throw e;
        }
    },

    // Publish salary details to employee
    async publishSalary(staffId, monthStr, payload) {
        if (!staffId || !monthStr) {
            throw new Error('[PublishSalary] staffId and monthStr are required.');
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            await db.collection('salary_settings_monthly').doc(docId).set({
                published: {
                    ...payload,
                    status: 'published',
                    publishedAt: new Date().toISOString()
                }
            }, { merge: true });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return true;
        } catch (e) {
            console.error('[PublishSalary] Error publishing:', e);
            throw e;
        }
    },

    // Employee confirms salary received
    async confirmSalaryReceived(staffId, monthStr, confirmedBy = 'employee') {
        if (!staffId || !monthStr) {
            throw new Error('[ConfirmSalary] staffId and monthStr are required.');
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            const docSnap = await db.collection('salary_settings_monthly').doc(docId).get();
            const data = docSnap.exists ? docSnap.data() : {};
            const pub = data.published || {};
            
            const updatedPublished = {
                ...pub,
                status: 'received',
                receivedAt: new Date().toISOString(),
                confirmedBy: confirmedBy
            };
            
            if (pub.status_gv === 'published') {
                updatedPublished.status_gv = 'received';
                updatedPublished.receivedAt_gv = new Date().toISOString();
            }
            if (pub.status_tt === 'published') {
                updatedPublished.status_tt = 'received';
                updatedPublished.receivedAt_tt = new Date().toISOString();
            }
            
            await db.collection('salary_settings_monthly').doc(docId).set({
                published: updatedPublished
            }, { merge: true });
            
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return true;
        } catch (e) {
            console.error('[ConfirmSalary] Error confirming receipt:', e);
            throw e;
        }
    },

    // Get all monthly salary settings for a given month
    async getAllMonthlySalarySettings(monthStr) {
        if (!monthStr) return {};
        const cacheKey = `all_monthly_salary_settings_${monthStr}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snapshot = await db.collection('salary_settings_monthly').get();
                const results = {};
                snapshot.forEach(doc => {
                    if (doc.id.startsWith(monthStr + '_')) {
                        const sId = doc.id.substring(monthStr.length + 1);
                        results[sId] = doc.data();
                    }
                });
                return results;
            } catch (e) {
                console.error('[MonthlySalarySettings] Error getting all:', e);
                return {};
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    // Get receptionist collective bonus pool mốc configuration
    async getReceptionistBonusConfig() {
        try {
            const doc = await db.collection('settings').doc('receptionist_bonus').get();
            if (doc.exists) {
                return doc.data();
            }
            // Return defaults if document does not exist yet
            return {
                center_tiers: [
                    { revenue: 475000000, bonus: 1000000 },
                    { revenue: 500000000, bonus: 4000000 },
                    { revenue: 525000000, bonus: 7000000 }
                ],
                cs2_tiers: [
                    { revenue: 65000000, bonus: 500000 }
                ]
            };
        } catch (e) {
            console.error('[ReceptionistBonusConfig] Error getting config:', e);
            return {
                center_tiers: [
                    { revenue: 475000000, bonus: 1000000 },
                    { revenue: 500000000, bonus: 4000000 },
                    { revenue: 525000000, bonus: 7000000 }
                ],
                cs2_tiers: [
                    { revenue: 65000000, bonus: 500000 }
                ]
            };
        }
    },

    // Save receptionist collective bonus pool mốc configuration
    async saveReceptionistBonusConfig(config) {
        try {
            await db.collection('settings').doc('receptionist_bonus').set(config, { merge: true });
            return true;
        } catch (e) {
            console.error('[ReceptionistBonusConfig] Error saving config:', e);
            throw e;
        }
    },

    // ================= OVERTIME REQUESTS =================

    // Staff submits an overtime request (status: pending)
    // duration: "HH:MM" string, sessionId: the attendance session this OT belongs to
    createOvertimeRequest: async (staffId, staffName, dateKey, sessionId, duration) => {
        try {
            // Check duplicate: chỉ dùng 2 WHERE để tránh lỗi composite index Firestore,
            // filter sessionId + status ở client-side
            const dupSnap = await db.collection('overtime_requests')
                .where('staffId', '==', staffId)
                .where('dateKey', '==', dateKey)
                .get();
            const alreadyExists = dupSnap.docs.some(doc => {
                const d = doc.data();
                return String(d.sessionId) === String(sessionId) && d.status === 'pending';
            });
            if (alreadyExists) {
                throw new Error('Bạn đã gửi yêu cầu tăng ca cho ca này rồi!');
            }

            // Convert HH:MM to minutes
            const [h, m] = duration.split(':').map(Number);
            const minutes = (h || 0) * 60 + (m || 0);
            if (minutes <= 0) throw new Error('Số giờ tăng ca phải lớn hơn 0.');

            const docRef = await db.collection('overtime_requests').add({
                staffId,
                staffName: staffName || 'N/A',
                dateKey,
                sessionId: String(sessionId),
                duration,     // "HH:MM"
                minutes,
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                approvedBy: null,
                approvedAt: null
            });
            DBService._invalidate('overtime_requests_staff_');
            console.log('[OT] Request created:', docRef.id);
            return docRef.id;
        } catch (e) {
            console.error('[OT] Error creating request:', e);
            throw e;
        }
    },

    // Admin: get all pending overtime requests
    getPendingOvertimeRequests: async () => {
        try {
            const snap = await db.collection('overtime_requests')
                .where('status', '==', 'pending')
                .limit(50)
                .get();
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            list.sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || ''));
            return list;
        } catch (e) {
            console.warn('[OT] Error getting pending requests:', e);
            return [];
        }
    },

    // Admin approves an overtime request → mark approved
    approveOvertimeRequest: async (requestId, adminName) => {
        try {
            await db.collection('overtime_requests').doc(requestId).update({
                status: 'approved',
                approvedBy: adminName || 'Admin',
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            DBService._invalidate('overtime_requests_staff_');
            console.log('[OT] Approved:', requestId);
        } catch (e) {
            console.error('[OT] Error approving:', e);
            throw e;
        }
    },

    // Admin rejects an overtime request
    rejectOvertimeRequest: async (requestId, adminName) => {
        try {
            await db.collection('overtime_requests').doc(requestId).update({
                status: 'rejected',
                approvedBy: adminName || 'Admin',
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            DBService._invalidate('overtime_requests_staff_');
            console.log('[OT] Rejected:', requestId);
        } catch (e) {
            console.error('[OT] Error rejecting:', e);
            throw e;
        }
    },

    saveAdminOvertimeConfig: async (staffId, staffName, dateKey, sessionId, minutes) => {
        try {
            const snap = await db.collection('overtime_requests')
                .where('staffId', '==', staffId)
                .where('sessionId', '==', String(sessionId))
                .get();

            if (Number(minutes) > 0) {
                const adminName = localStorage.getItem('currentUserName') || 'Admin';
                if (!snap.empty) {
                    const docId = snap.docs[0].id;
                    await db.collection('overtime_requests').doc(docId).update({
                        duration: Number(minutes),
                        status: 'approved',
                        approvedBy: adminName,
                        approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                } else {
                    await db.collection('overtime_requests').add({
                        staffId: staffId,
                        staffName: staffName || '',
                        dateKey: dateKey,
                        sessionId: String(sessionId),
                        duration: Number(minutes),
                        status: 'approved',
                        approvedBy: adminName,
                        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            } else {
                if (!snap.empty) {
                    await db.collection('overtime_requests').doc(snap.docs[0].id).delete();
                }
            }
            DBService._invalidate('overtime_requests_staff_');
            console.log('[OT] Saved admin overtime config:', staffId, sessionId, minutes);
        } catch (e) {
            console.error('[OT] Error saving overtime config:', e);
            throw e;
        }
    },

    // Get overtime requests for a specific staff member in a month ("YYYY-MM")
    getOvertimeRequestsForStaff: async (staffId, monthStr) => {
        if (!staffId || staffId.trim() === '') return [];
        const cacheKey = `overtime_requests_staff_${staffId}_${monthStr || 'all'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snap = await db.collection('overtime_requests')
                    .where('staffId', '==', staffId)
                    .limit(100)
                    .get();
                const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                // Filter by month client-side to avoid composite index
                return monthStr
                    ? list.filter(r => r.dateKey && r.dateKey.startsWith(monthStr))
                    : list;
            } catch (e) {
                console.warn('[OT] Error getting staff requests:', e);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    // 10. Fixed Shifts (Receptionist)
    getFixedShifts: async (monthStr, userId) => {
        if (!userId || userId.trim() === '') {
            console.warn('[FixedShifts] userId is empty, skipping.');
            return [];
        }
        const cacheKey = `fixed_shifts_${monthStr}_${userId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const docId = `${monthStr}_${userId}`;
                const doc = await db.collection('fixed_shifts').doc(docId).get();
                return doc.exists ? doc.data().shifts || [] : [];
            } catch (error) {
                console.error("Error getting fixed shifts:", error);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    saveFixedShifts: async (monthStr, userId, shiftsArr) => {
        try {
            const docId = `${monthStr}_${userId}`;
            await db.collection('fixed_shifts').doc(docId).set({
                userId,
                month: monthStr,
                shifts: shiftsArr,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            DBService._invalidate(`fixed_shifts_${monthStr}_${userId}`);
            return true;
        } catch (error) {
            console.error("Error saving fixed shifts:", error);
            throw error;
        }
    },

    // ================= CANCELLED SHIFTS (ADMIN) =================

    getCancelledShifts: async (monthStr, staffId) => {
        if (!staffId || staffId.trim() === '') {
            console.warn('[CancelledShifts] staffId is empty, skipping.');
            return [];
        }
        const cacheKey = `cancelled_shifts_${monthStr}_${staffId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const docId = `${monthStr}_${staffId}`;
                const doc = await db.collection('cancelled_shifts').doc(docId).get();
                return doc.exists ? doc.data().shifts || [] : [];
            } catch (error) {
                console.error("[CancelledShifts] Error getting:", error);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getAllCancelledShifts: async (monthStr) => {
        try {
            const snapshot = await db.collection('cancelled_shifts').where('month', '==', monthStr).get();
            const map = {};
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.userId && data.shifts) {
                    map[data.userId] = data.shifts;
                }
            });
            return map;
        } catch (error) {
            console.error("[CancelledShifts] Error getting all:", error);
            return {};
        }
    },

    cancelShift: async (monthStr, staffId, shiftKey) => {
        try {
            const docId = `${monthStr}_${staffId}`;
            const res = await db.runTransaction(async (t) => {
                const docRef = db.collection('cancelled_shifts').doc(docId);
                const doc = await t.get(docRef);
                let shifts = [];
                if (doc.exists) {
                    shifts = doc.data().shifts || [];
                }

                if (!shifts.includes(shiftKey)) {
                    shifts.push(shiftKey);
                }

                t.set(docRef, {
                    userId: staffId,
                    month: monthStr,
                    shifts: shifts,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                return true;
            });
            DBService._invalidate(`cancelled_shifts_${monthStr}_${staffId}`);
            return res;
        } catch (error) {
            console.error("[CancelledShifts] Error saving:", error);
            throw error;
        }
    },

    // ================= BONUS 10P REQUESTS =================

    createBonus10Request: async (staffId, staffName, dateKey, sessionId) => {
        try {
            // Check duplicate: chỉ dùng 2 WHERE để tránh lỗi composite index Firestore,
            // filter sessionId + status ở client-side
            const dupSnap10 = await db.collection('bonus10_requests')
                .where('staffId', '==', staffId)
                .where('dateKey', '==', dateKey)
                .get();
            const alreadyExists10 = dupSnap10.docs.some(doc => {
                const d = doc.data();
                return String(d.sessionId) === String(sessionId) && d.status === 'pending';
            });
            if (alreadyExists10) {
                throw new Error('Bạn đã gửi yêu cầu sớm 10p cho ca này rồi!');
            }

            const docRef = await db.collection('bonus10_requests').add({
                staffId,
                staffName: staffName || 'N/A',
                dateKey,
                sessionId: String(sessionId),
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                approvedBy: null,
                approvedAt: null
            });
            DBService._invalidate('bonus10_requests_');
            console.log('[Bonus10] Request created:', docRef.id);
            return docRef.id;
        } catch (e) {
            console.error('[Bonus10] Error creating:', e);
            throw e;
        }
    },

    // Hệ thống đã tự xác minh đủ điều kiện (môn cho phép + GV chế độ cũ + chấm công
    // sớm ≥10 phút) nên ghi thẳng trạng thái 'approved'.
    // KHÔNG dùng create rồi update: firestore.rules chỉ cho admin update
    // bonus10_requests, trong khi người bấm nút ở đây là giáo viên.
    createApprovedBonus10Request: async (staffId, staffName, dateKey, sessionId, meta) => {
        try {
            const dupSnap = await db.collection('bonus10_requests')
                .where('staffId', '==', staffId)
                .where('dateKey', '==', dateKey)
                .get();
            const already = dupSnap.docs.some(doc => {
                const d = doc.data();
                return String(d.sessionId) === String(sessionId) &&
                    (d.status === 'pending' || d.status === 'approved');
            });
            if (already) throw new Error('Ca này đã được ghi nhận sớm 10p rồi!');

            const docRef = await db.collection('bonus10_requests').add({
                staffId,
                staffName: staffName || 'N/A',
                dateKey,
                sessionId: String(sessionId),
                status: 'approved',
                autoApproved: true,
                earlyMinutes: (meta && meta.earlyMinutes) || null,
                checkInAt: (meta && meta.checkInLabel) || null,
                scheduledStart: (meta && meta.startLabel) || null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                approvedBy: 'Hệ thống tự duyệt',
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await DBService.setSessionBonus10(staffId, dateKey, sessionId, true);
            DBService._invalidate('bonus10_requests_');
            console.log('[Bonus10] Auto-approved:', docRef.id);
            return docRef.id;
        } catch (e) {
            console.error('[Bonus10] Error auto-approving:', e);
            throw e;
        }
    },

    getBonus10RequestsForStaff: async (staffId, monthStr) => {
        if (!staffId || staffId.trim() === '') {
            console.warn('[Bonus10] staffId is empty, skipping.');
            return [];
        }
        const cacheKey = `bonus10_requests_staff_${staffId}_${monthStr || 'all'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snap = await db.collection('bonus10_requests')
                    .where('staffId', '==', staffId)
                    .limit(200)
                    .get();
                const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                return monthStr
                    ? list.filter(r => r.dateKey && r.dateKey.startsWith(monthStr))
                    : list;
            } catch (e) {
                console.warn('[Bonus10] Error getting staff requests:', e);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getPendingBonus10Requests: async () => {
        try {
            const snap = await db.collection('bonus10_requests')
                .where('status', '==', 'pending')
                .limit(100)
                .get();
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            list.sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || ''));
            return list;
        } catch (e) {
            console.warn('[Bonus10] Error getting pending:', e);
            return [];
        }
    },

    approveBonus10Request: async (requestId, adminName, staffId, dateKey, sessionId) => {
        try {
            // 1. Update request status
            await db.collection('bonus10_requests').doc(requestId).update({
                status: 'approved',
                approvedBy: adminName || 'Admin',
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            // 2. Set bonus10 = true on the actual session
            if (staffId && dateKey && sessionId) {
                await DBService.setSessionBonus10(staffId, dateKey, sessionId, true);
            }
            DBService._invalidate('bonus10_requests_');
            console.log('[Bonus10] Approved:', requestId);
        } catch (e) {
            console.error('[Bonus10] Error approving:', e);
            throw e;
        }
    },

    // Admin hủy 1 ca sớm 10p = ĐÁNH DẤU TỪ CHỐI, không xóa bản ghi.
    // Bản ghi 'rejected' còn lại chính là dấu vết khóa phụ cấp cả tháng
    // (mất toàn bộ 10p và mất đơn giá lớp đông). Muốn gỡ phạt thì dùng
    // restoreBonus10Request để xóa hẳn bản ghi này.
    cancelApprovedBonus10: async (requestId, staffId, dateKey, sessionId) => {
        try {
            // 1. Đánh dấu từ chối — dấu vết này chính là hình phạt của cả tháng.
            const adminName = localStorage.getItem('currentUserName') || 'Admin';
            let marked = false;
            if (requestId) {
                try {
                    await db.collection('bonus10_requests').doc(requestId).update({
                        status: 'rejected',
                        approvedBy: adminName,
                        approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    marked = true;
                } catch (updateErr) {
                    console.warn('[Bonus10] Không cập nhật được bản ghi cũ, sẽ tạo bản ghi phạt mới.', updateErr);
                }
            }
            // Ca cũ do admin tặng tay không có bản ghi request → vẫn phải tạo dấu vết,
            // nếu không hình phạt tháng sẽ im lặng biến mất.
            if (!marked) {
                await db.collection('bonus10_requests').add({
                    staffId: staffId,
                    staffName: 'N/A',
                    dateKey: dateKey,
                    sessionId: String(sessionId),
                    status: 'rejected',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    approvedBy: adminName,
                    approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            // 2. Clear bonus10 on the actual session (set it to false)
            const docId = `${dateKey}_${staffId}`;
            const ref = db.collection('attendance_logs').doc(docId);
            await db.runTransaction(async (t) => {
                const doc = await t.get(ref);
                if (doc.exists) {
                    const data = doc.data();
                    if (data.sessions) {
                        const index = data.sessions.findIndex(s => String(s.id) === String(sessionId));
                        if (index !== -1 && data.sessions[index].bonus10) {
                            data.sessions[index].bonus10 = false;
                            data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
                            t.set(ref, data);
                        }
                    }
                }
            });
            DBService._invalidateAttendance(dateKey, staffId);
            DBService._invalidate('bonus10_requests_');
            console.log('[Bonus10] Cancelled approved request:', requestId, sessionId);
        } catch (e) {
            console.error('[Bonus10] Error cancelling approved bonus:', e);
            throw e;
        }
    },

    rejectBonus10Request: async (requestId, adminName) => {
        try {
            await db.collection('bonus10_requests').doc(requestId).update({
                status: 'rejected',
                approvedBy: adminName || 'Admin',
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            DBService._invalidate('bonus10_requests_');
            console.log('[Bonus10] Rejected:', requestId);
        } catch (e) {
            console.error('[Bonus10] Error rejecting:', e);
            throw e;
        }
    },

    // Gỡ hình phạt tháng: xóa hẳn các bản ghi 'rejected' của nhân viên trong tháng.
    // Dùng khi admin bấm nhầm — sau khi gỡ, 10p và phụ cấp lớp đông tính lại bình thường.
    clearBonus10PenaltyForMonth: async (staffId, monthStr) => {
        if (!staffId || !monthStr) return 0;
        try {
            const snap = await db.collection('bonus10_requests')
                .where('staffId', '==', staffId)
                .get();
            const targets = snap.docs.filter(doc => {
                const data = doc.data();
                return data.status === 'rejected' && String(data.dateKey || '').startsWith(monthStr);
            });
            if (targets.length === 0) return 0;
            const batch = db.batch();
            targets.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            DBService._invalidate('bonus10_requests_');
            console.log('[Bonus10] Cleared monthly penalty:', staffId, monthStr, targets.length);
            return targets.length;
        } catch (e) {
            console.error('[Bonus10] Error clearing penalty:', e);
            throw e;
        }
    },

    getMonthlyBonus10Requests: async (monthStr, staffId) => {
        if (!staffId) return [];
        const cacheKey = `bonus10_requests_month_${staffId}_${monthStr || 'all'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snap = await db.collection('bonus10_requests')
                    .where('staffId', '==', staffId)
                    .limit(400)
                    .get();
                const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                return monthStr
                    ? list.filter(r => r.dateKey && String(r.dateKey).startsWith(monthStr))
                    : list;
            } catch (e) {
                console.warn('[Bonus10] Error getting monthly requests:', e);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getMonthlyMeetings: async (monthStr) => {
        const cacheKey = `monthly_meetings_${monthStr}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const doc = await db.collection('meetings_log').doc(monthStr).get();
                if (doc.exists) {
                    return doc.data() || { month: monthStr, records: {} };
                }
                return { month: monthStr, records: {} };
            } catch (error) {
                console.error("[MeetingsLog] Error getting:", error);
                return { month: monthStr, records: {} };
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    saveMonthlyMeetings: async (monthStr, records) => {
        try {
            const docRef = db.collection('meetings_log').doc(monthStr);
            await docRef.set({
                month: monthStr,
                records: records,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            DBService._invalidate(`monthly_meetings_${monthStr}`);
            return true;
        } catch (error) {
            console.error("[MeetingsLog] Error saving:", error);
            throw error;
        }
    },

    // ================= PERIODIC MEETING AUTOMATION =================

    createMeeting: async (meetingData) => {
        try {
            const docRef = await db.collection('meetings').add({
                ...meetingData,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            DBService._invalidate('today_meetings_');
            DBService._invalidate('meetings_month_');
            return docRef.id;
        } catch (error) {
            console.error("[Meetings] Error creating:", error);
            throw error;
        }
    },

    deleteMeeting: async (meetingId) => {
        try {
            await db.collection('meetings').doc(meetingId).delete();
            const attendanceSnap = await db.collection('meeting_attendance')
                .where('meetingId', '==', meetingId)
                .get();
            const batch = db.batch();
            attendanceSnap.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            DBService._invalidate('today_meetings_');
            DBService._invalidate('meetings_month_');
            return true;
        } catch (error) {
            console.error("[Meetings] Error deleting:", error);
            throw error;
        }
    },

    getMeetingsForMonth: async (monthStr) => {
        const cacheKey = `meetings_month_${monthStr}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const snapshot = await db.collection('meetings').get();
                const meetings = [];
                snapshot.forEach(doc => {
                    const data = doc.data();
                    if (data.date && data.date.startsWith(monthStr)) {
                        meetings.push({ id: doc.id, ...data });
                    }
                });
                meetings.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
                return meetings;
            } catch (error) {
                console.error("[Meetings] Error getting for month:", error);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    getTodayMeetings: async () => {
        try {
            const d = new Date();
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const todayStr = `${year}-${month}-${day}`;

            const cacheKey = `today_meetings_${todayStr}`;
            const now = Date.now();
            if (DBService._cache[cacheKey] && (now - (DBService._cacheTime[cacheKey] || 0) < 300000)) {
                return DBService._cache[cacheKey];
            }

            const promise = (async () => {
                const snapshot = await db.collection('meetings')
                    .where('date', '==', todayStr)
                    .get();
                const meetings = [];
                snapshot.forEach(doc => {
                    meetings.push({ id: doc.id, ...doc.data() });
                });
                return meetings;
            })();

            DBService._cache[cacheKey] = promise;
            DBService._cacheTime[cacheKey] = now;
            return promise;
        } catch (error) {
            console.error("[Meetings] Error getting today meetings:", error);
            return [];
        }
    },

    checkInMeeting: async (meetingId, userId, userName, status) => {
        try {
            const attendanceRef = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
            const checkInTime = new Date().toISOString();
            await attendanceRef.set({
                meetingId,
                userId,
                userName,
                status,
                checkInTime,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            const meetingDoc = await db.collection('meetings').doc(meetingId).get();
            if (meetingDoc.exists) {
                const mData = meetingDoc.data();
                const dept = mData.department;
                const mDate = mData.date;
                if (dept && mDate) {
                    const monthStr = mDate.substring(0, 7);
                    
                    let fieldName = '';
                    if (dept === 'TG TA') fieldName = 'hop_tg_tieng_anh';
                    else if (dept === 'TG T-TV') fieldName = 'hop_tg_t_tv';
                    else if (dept === 'TOÁN TƯ DUY') fieldName = 'hop_toan_tu_duy';
                    else if (dept === 'TIẾP TÂN') fieldName = 'hop_tiep_tan';

                    if (fieldName) {
                        const logRef = db.collection('meetings_log').doc(monthStr);
                        const updateKey = `records.${userId}.${fieldName}`;
                        const updateData = {};
                        updateData[updateKey] = status;
                        
                        await logRef.update(updateData).catch(async (err) => {
                            if (err.code === 'not-found') {
                                const initialData = { month: monthStr, records: {} };
                                initialData.records[userId] = { [fieldName]: status };
                                await logRef.set(initialData, { merge: true });
                            }
                        });
                    }
                }
            }
            return { checkInTime, status };
        } catch (error) {
            console.error("[Meetings] Error check-in:", error);
            throw error;
        }
    },

    getMeetingAttendance: async (meetingId) => {
        try {
            const snapshot = await db.collection('meeting_attendance')
                .where('meetingId', '==', meetingId)
                .get();
            const attendance = [];
            snapshot.forEach(doc => {
                attendance.push({ id: doc.id, ...doc.data() });
            });
            return attendance;
        } catch (error) {
            console.error("[Meetings] Error getting attendance:", error);
            return [];
        }
    },

    // Nhân viên TỰ điểm danh: CHỈ ghi vào meeting_attendance (rules cho phép mọi user đăng nhập ghi).
    // KHÔNG đụng tới meetings_log (chỉ admin mới ghi được — tránh lỗi permission-denied ở phía nhân viên).
    // Bảng lương/điểm danh của admin sẽ tự phản ánh qua fallback đọc meeting_attendance trong lưới.
    selfCheckInMeeting: async (meetingId, userId, userName, status) => {
        try {
            const attendanceRef = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
            const checkInTime = new Date().toISOString();
            await attendanceRef.set({
                meetingId,
                userId,
                userName,
                status,
                checkInTime,
                selfCheckIn: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return { checkInTime, status };
        } catch (error) {
            console.error("[Meetings] Error self check-in:", error);
            throw error;
        }
    },

    // Nhân viên XÁC NHẬN tham gia họp (RSVP) — ghi vào meeting_attendance (staff ghi được).
    // willAttend=false + lý do -> đánh 'Vắng phép' ngay (trừ khi sau đó vẫn điểm danh thì
    // selfCheckInMeeting ghi đè 'Có'/'Trễ'). willAttend=true -> chỉ lưu ý định, chưa đổi status;
    // nếu trước đó lỡ 'Vắng phép' do bấm không đi thì xoá để về trạng thái chờ điểm danh.
    selfRsvpMeeting: async (meetingId, userId, userName, willAttend, reason) => {
        try {
            const ref = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
            const data = {
                meetingId, userId, userName,
                rsvp: willAttend ? 'yes' : 'no',
                rsvpReason: willAttend ? '' : (reason || ''),
                rsvpAt: new Date().toISOString(),
                selfRsvp: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (!willAttend) {
                data.status = 'Vắng phép';
            } else {
                const cur = await ref.get();
                if (cur.exists && cur.data().status === 'Vắng phép') {
                    data.status = firebase.firestore.FieldValue.delete();
                }
            }
            await ref.set(data, { merge: true });
            return { rsvp: data.rsvp };
        } catch (error) {
            console.error("[Meetings] Error self RSVP:", error);
            throw error;
        }
    },

    // Chốt "Vắng không phép": họp đã kết thúc, nhân viên bấm ĐI (rsvp yes) nhưng KHÔNG điểm danh.
    // Chỉ ghi khi chưa có status hợp lệ (không đè lên 'Có'/'Trễ'/'Vắng phép'/admin sửa).
    resolveMeetingNoShow: async (meetingId, userId, userName) => {
        try {
            const ref = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
            await ref.set({
                meetingId, userId, userName,
                status: 'Vắng không phép',
                autoNoShow: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return true;
        } catch (error) {
            console.error("[Meetings] Error resolve no-show:", error);
            return false;
        }
    },

    // GPS cho điểm danh HỌP — họp tổ chức tại Cơ Sở 1, nên ưu tiên kiểm tra đúng CS1;
    // nếu CS1 chưa cấu hình toạ độ thì chấp nhận bất kỳ cơ sở nào (giống chấm công).
    // Chưa cấu hình GPS nào -> trả false (bỏ qua kiểm tra, không chặn điểm danh).
    assertMeetingLocationAllowed: async () => {
        const settings = await DBService.getSystemSettings();
        const campuses = getConfiguredGPSCampuses(settings);
        if (campuses.length === 0) return false;
        let coords;
        try {
            coords = await getBrowserLocation();
        } catch (e) {
            console.error("Location meeting check error:", e);
            // Giữ nguyên cách nói "IP mạng/Wifi" như chấm công — không lộ là GPS.
            throw new Error("IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để điểm danh.");
        }
        const cs1 = campuses.find(c => c.name === 'CS1');
        const targets = cs1 ? [cs1] : campuses;
        const ok = targets.some(campus => {
            const dist = calculateDistanceInMeters(coords.latitude, coords.longitude, campus.lat, campus.lng);
            const allowedRadius = campus.radius + Math.min(coords.accuracy || 0, 250);
            return dist <= allowedRadius;
        });
        if (!ok) {
            throw new Error("IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để điểm danh.");
        }
        return true;
    },

    // Lấy trạng thái điểm danh của 1 user trong 1 cuộc họp (đọc trực tiếp theo id ghép)
    getMyMeetingStatus: async (meetingId, userId) => {
        try {
            const doc = await db.collection('meeting_attendance').doc(`${meetingId}_${userId}`).get();
            return doc.exists ? { id: doc.id, ...doc.data() } : null;
        } catch (error) {
            console.error("[Meetings] Error getting my meeting status:", error);
            return null;
        }
    },

    updateMeetingAttendanceStatus: async (meetingId, userId, userName, status) => {
        try {
            const attendanceRef = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
            await attendanceRef.set({
                meetingId,
                userId,
                userName,
                status,
                // Admin chỉnh tay -> luôn được coi là hợp lệ, kể cả khi ngoài khung giờ điểm danh
                adminOverride: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            const meetingDoc = await db.collection('meetings').doc(meetingId).get();
            if (meetingDoc.exists) {
                const mData = meetingDoc.data();
                const dept = mData.department;
                const mDate = mData.date;
                if (dept && mDate) {
                    const monthStr = mDate.substring(0, 7);
                    let fieldName = '';
                    if (dept === 'TG TA') fieldName = 'hop_tg_tieng_anh';
                    else if (dept === 'TG T-TV') fieldName = 'hop_tg_t_tv';
                    else if (dept === 'TOÁN TƯ DUY') fieldName = 'hop_toan_tu_duy';
                    else if (dept === 'TIẾP TÂN') fieldName = 'hop_tiep_tan';

                    if (fieldName) {
                        const logRef = db.collection('meetings_log').doc(monthStr);
                        const updateKey = `records.${userId}.${fieldName}`;
                        const updateData = {};
                        updateData[updateKey] = status;
                        
                        await logRef.update(updateData).catch(async (err) => {
                            if (err.code === 'not-found') {
                                const initialData = { month: monthStr, records: {} };
                                initialData.records[userId] = { [fieldName]: status };
                                await logRef.set(initialData, { merge: true });
                            }
                        });
                    }
                }
            }
            return true;
        } catch (error) {
            console.error("[Meetings] Error updating attendance status:", error);
            throw error;
        }
    },

    checkInMeetingBulk: async (meetingId, attendees, status) => {
        try {
            const meetingDoc = await db.collection('meetings').doc(meetingId).get();
            if (!meetingDoc.exists) return false;
            
            const mData = meetingDoc.data();
            const mDate = mData.date;
            if (!mDate) return false;
            
            const monthStr = mDate.substring(0, 7);
            const checkInTime = new Date().toISOString();
            const batch = db.batch();
            
            // Read or initialize the monthly meetings log document
            const logRef = db.collection('meetings_log').doc(monthStr);
            const logDoc = await logRef.get();
            let logData = logDoc.exists ? logDoc.data() : { month: monthStr, records: {} };
            if (!logData.records) logData.records = {};
            
            attendees.forEach(att => {
                const userId = att.id;
                const userName = att.name;
                const spec = att.specialty || '';
                
                // Write/merge the attendance document
                const attendanceRef = db.collection('meeting_attendance').doc(`${meetingId}_${userId}`);
                batch.set(attendanceRef, {
                    meetingId,
                    userId,
                    userName,
                    status,
                    checkInTime,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
                // Merge in meetings_log
                if (!logData.records[userId]) {
                    logData.records[userId] = {};
                }
                
                const specUpper = spec.toUpperCase();
                if (specUpper.includes('TG TA')) {
                    logData.records[userId].hop_tg_tieng_anh = status;
                }
                if (specUpper.includes('TG T-TV')) {
                    logData.records[userId].hop_tg_t_tv = status;
                }
                if (specUpper.includes('TOÁN TƯ DUY') || specUpper.includes('TTD')) {
                    logData.records[userId].hop_toan_tu_duy = status;
                }
                if (specUpper.includes('TIẾP TÂN') || specUpper.includes('TT')) {
                    logData.records[userId].hop_tiep_tan = status;
                }
            });
            
            batch.set(logRef, logData, { merge: true });
            await batch.commit();
            
            DBService._invalidate(`monthly_meetings_${monthStr}`);
            return true;
        } catch (error) {
            console.error("[Meetings] Error bulk check-in:", error);
            throw error;
        }
    }
};
