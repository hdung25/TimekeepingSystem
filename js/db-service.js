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

function createScheduleShiftId() {
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return `shift_${random}`;
}

function createAttendanceSessionId() {
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    return `session_${random}`;
}

// SCHEDULE REGISTRATION HELPERS START
const SCHEDULE_SECTION_KEYS = ['morning1', 'morning2', 'afternoon1', 'afternoon2', 'evening1', 'evening2'];

function _scheduleRegistrationRowSignature(row) {
    return [row?.start, row?.end, row?.lop, row?.phong]
        .map(value => String(value || '').trim())
        .join('|');
}

function _scheduleRegistrationHash(value, seed) {
    let hash = seed >>> 0;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36);
}

function _scheduleRegistrationId(scheduleKey, section, row, userId, rowIndex = -1) {
    // Signature is stable even for an inherited (not-yet-materialized) schedule;
    // inherited rows receive an ephemeral shiftId on each read.
    const locator = _scheduleRegistrationRowSignature(row);
    const raw = [scheduleKey, section, rowIndex, locator, userId].join('::');
    const safeUserId = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'staff';
    return `reg_${_scheduleRegistrationHash(raw, 2166136261)}_${_scheduleRegistrationHash(raw, 3335557771)}_${safeUserId}`;
}

function _scheduleRegistrationUpdatedMillis(registration) {
    const value = registration?.updatedAt || registration?.createdAt;
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (Number.isFinite(value?.seconds)) return value.seconds * 1000 + Number(value.nanoseconds || 0) / 1e6;
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
}

function _mergeScheduleRegistrations(schedule, registrations) {
    const merged = { ...(schedule || {}) };
    const bySection = new Map();
    (registrations || []).forEach(registration => {
        const section = String(registration?.section || '');
        if (!SCHEDULE_SECTION_KEYS.includes(section) || !registration?.userId) return;
        if (!bySection.has(section)) bySection.set(section, []);
        bySection.get(section).push(registration);
    });

    SCHEDULE_SECTION_KEYS.forEach(section => {
        if (!Array.isArray(schedule?.[section])) return;
        const sectionRegistrations = bySection.get(section) || [];
        merged[section] = schedule[section].map((row, rowIndex) => {
            const signature = _scheduleRegistrationRowSignature(row);
            const matching = sectionRegistrations.filter(registration => {
                const shiftMatches = registration.shiftId && row?.shiftId &&
                    String(registration.shiftId) === String(row.shiftId);
                const legacyMatches = String(registration.rowSignature || '') === signature &&
                    (!Number.isInteger(registration.rowIndex) || registration.rowIndex === rowIndex);
                return shiftMatches || legacyMatches;
            });
            if (!matching.length) return { ...row, registeredTeachers: [...(row.registeredTeachers || [])] };

            // At most one current registration per staff/row is expected. If a
            // locator changed in older data, the latest status deterministically wins.
            const latestByUser = new Map();
            matching.forEach(registration => {
                const userId = String(registration.userId);
                const previous = latestByUser.get(userId);
                if (!previous || _scheduleRegistrationUpdatedMillis(registration) >= _scheduleRegistrationUpdatedMillis(previous)) {
                    latestByUser.set(userId, registration);
                }
            });
            const teachers = new Map((row.registeredTeachers || [])
                .filter(item => item?.id)
                .map(item => [String(item.id), { ...item }]));
            latestByUser.forEach(registration => {
                const userId = String(registration.userId);
                teachers.delete(userId); // cancelled is a tombstone for legacy embedded data
                if (registration.status === 'active') {
                    teachers.set(userId, {
                        id: userId,
                        name: registration.userName || registration.name || 'Staff',
                        timestamp: registration.updatedAt || registration.createdAt || '',
                        branch: registration.branch || '',
                        registrationId: registration.id || '',
                        registrationSource: 'schedule_registrations'
                    });
                }
            });
            return { ...row, registeredTeachers: Array.from(teachers.values()) };
        });
    });
    return merged;
}

function _withoutSeparateScheduleRegistrations(schedule) {
    const clean = { ...(schedule || {}) };
    SCHEDULE_SECTION_KEYS.forEach(section => {
        if (!Array.isArray(schedule?.[section])) return;
        clean[section] = schedule[section].map(row => ({
            ...row,
            registeredTeachers: (row.registeredTeachers || [])
                .filter(item => item?.registrationSource !== 'schedule_registrations')
                .map(item => {
                    const { registrationId, registrationSource, ...legacy } = item || {};
                    return legacy;
                })
        }));
    });
    return clean;
}
// SCHEDULE REGISTRATION HELPERS END

// Trạng thái GV báo nghỉ được lưu THEO TỪNG LỚP/CA, thay vì suy đoán từ việc
// đã có GV thay thế. Nhờ vậy người xếp lịch có thể ghi nhận "đang chờ người
// thay" từ sớm và vẫn khôi phục đúng một ca khi GV đi làm lại.
function getTeacherAbsenceRecord(cls, staffId) {
    if (!cls || !staffId || !Array.isArray(cls.teacherAbsences)) return null;
    return cls.teacherAbsences.find(item =>
        item && String(item.teacherId || item.id || '') === String(staffId)
    ) || null;
}

function isTeacherExplicitlyAbsent(cls, staffId) {
    return !!getTeacherAbsenceRecord(cls, staffId);
}

function isMainTeacherAbsentFromClass(cls, staffId) {
    if (!isScheduledMainTeacher(cls, staffId)) return false;
    // Có mảng mới (kể cả rỗng) thì nó là nguồn sự thật theo từng GV. Chỉ dữ
    // liệu cũ chưa có trường này mới phải suy đoán "có GV thay = GV chính nghỉ".
    return Array.isArray(cls?.teacherAbsences)
        ? isTeacherExplicitlyAbsent(cls, staffId)
        : hasScheduledSubstitute(cls);
}

// GV được xếp cho lớp (GV chính, GV thay thế, hoặc tự nhận lớp)
function isAssignedToClass(cls, staffId) {
    return isScheduledMainTeacher(cls, staffId) ||
        isScheduledSubstitute(cls, staffId) ||
        ((cls && cls.registeredTeachers) || []).some(t => t.id === staffId);
}

const LOCATION_CACHE_TTL_MS = 2 * 60 * 1000;
const ATTENDANCE_LOCATION_RECOVERY_TIMEOUT_MS = 26000;
const ATTENDANCE_LOCATION_PUBLIC_MESSAGE = "IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để chấm công.";
const ATTENDANCE_LOCATION_DIAGNOSTIC_COLLECTION = 'attendance_location_events';
let lastBrowserLocation = null;

function createAttendanceLocationError(code, cause = null) {
    const error = new Error(ATTENDANCE_LOCATION_PUBLIC_MESSAGE);
    error.name = 'AttendanceLocationError';
    error.code = code;
    // Keep the technical cause available to developers without changing the
    // staff-facing message or storing precise coordinates anywhere.
    if (cause) error.cause = cause;
    return error;
}

async function getAttendanceLocationPermissionState() {
    try {
        if (!navigator.permissions?.query) return 'unsupported';
        const status = await navigator.permissions.query({ name: 'geolocation' });
        return ['granted', 'prompt', 'denied'].includes(status?.state) ? status.state : 'unknown';
    } catch (_) {
        return 'unknown';
    }
}

function getAttendanceClientContext() {
    const ua = String(navigator.userAgent || '').toLowerCase();
    const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
        window.navigator.standalone === true;
    let browserContext = standalone ? 'standalone' : 'browser';
    if (/zalo/.test(ua)) browserContext = 'zalo';
    else if (/fbav|fban|instagram/.test(ua)) browserContext = 'social_webview';
    else if (/; wv\)|\bwv\b|version\/4\.0.*chrome/.test(ua)) browserContext = 'android_webview';

    let platform = 'desktop';
    if (/android/.test(ua)) platform = 'android';
    else if (/iphone|ipad|ipod/.test(ua)) platform = 'ios';

    return {
        browserContext,
        platform,
        secureContext: window.isSecureContext === true,
        online: navigator.onLine !== false
    };
}

async function recordAttendanceLocationFailure(userId, code, stage = 'location_gate') {
    try {
        const authUid = firebase.auth().currentUser?.uid;
        if (!authUid || !userId || !db) return false;
        const dateKey = getLocalDateKeyFromDate(new Date());
        const safeCode = String(code || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64);
        const safeStage = String(stage || 'location_gate').replace(/[^a-z0-9_]/gi, '_').slice(0, 32);
        const permissionState = await getAttendanceLocationPermissionState();
        const context = getAttendanceClientContext();
        const appVersion = typeof APP_VERSION !== 'undefined' ? String(APP_VERSION) : 'unknown';
        const eventId = `${dateKey}_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await db.collection(ATTENDANCE_LOCATION_DIAGNOSTIC_COLLECTION).doc(eventId).set({
            authUid,
            staffId: String(userId),
            dateKey,
            code: safeCode,
            stage: safeStage,
            permissionState,
            browserContext: context.browserContext,
            platform: context.platform,
            secureContext: context.secureContext,
            online: context.online,
            appVersion,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return true;
    } catch (diagnosticError) {
        console.warn('[AttendanceLocation] Diagnostic write failed:', diagnosticError?.code || diagnosticError?.message || 'UNKNOWN');
        return false;
    }
}

function mapBrowserLocationError(error) {
    const numericCode = Number(error?.code);
    if (numericCode === 1) return 'PERMISSION_DENIED';
    if (numericCode === 3) return 'TIMEOUT';
    return 'POSITION_UNAVAILABLE';
}

function cacheBrowserLocation(coords) {
    lastBrowserLocation = {
        coords,
        timestamp: Date.now()
    };
}

function getBrowserLocation(options = {}) {
    return new Promise((resolve, reject) => {
        const forceFresh = options.forceFresh === true;
        const maximumAge = forceFresh ? 0 : (options.maximumAge ?? LOCATION_CACHE_TTL_MS);
        if (
            !forceFresh &&
            lastBrowserLocation &&
            maximumAge > 0 &&
            Date.now() - lastBrowserLocation.timestamp <= maximumAge
        ) {
            resolve(lastBrowserLocation.coords);
            return;
        }

        if (typeof window === 'undefined' || !navigator.geolocation) {
            const error = new Error('Geolocation is unavailable.');
            error.locationCode = 'UNSUPPORTED';
            reject(error);
            return;
        }
        const handleSuccess = position => {
            cacheBrowserLocation(position.coords);
            resolve(position.coords);
        };

        navigator.geolocation.getCurrentPosition(
            handleSuccess,
            error => {
                if (
                    options.retryApproximate !== false &&
                    mapBrowserLocationError(error) !== 'PERMISSION_DENIED'
                ) {
                    navigator.geolocation.getCurrentPosition(
                        handleSuccess,
                        fallbackError => {
                            const finalError = new Error('Unable to acquire a browser location fix.');
                            finalError.locationCode = mapBrowserLocationError(fallbackError);
                            reject(finalError);
                        },
                        { enableHighAccuracy: false, timeout: 12000, maximumAge }
                    );
                    return;
                }

                const finalError = new Error('Unable to acquire a browser location fix.');
                finalError.locationCode = mapBrowserLocationError(error);
                reject(finalError);
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
    ].map(campus => ({
        ...campus,
        lat: Number(campus.lat),
        lng: Number(campus.lng),
        radius: Number(campus.radius)
    })).filter(campus =>
        Number.isFinite(campus.lat) && campus.lat >= -90 && campus.lat <= 90 &&
        Number.isFinite(campus.lng) && campus.lng >= -180 && campus.lng <= 180 &&
        Number.isFinite(campus.radius) && campus.radius > 0
    );
}

function isAttendanceLocationAllowed(coords, campuses) {
    if (!coords || !Number.isFinite(Number(coords.latitude)) || !Number.isFinite(Number(coords.longitude))) {
        return false;
    }
    return campuses.some(campus => {
        const dist = calculateDistanceInMeters(
            Number(coords.latitude), Number(coords.longitude), campus.lat, campus.lng
        );
        const accuracy = Number.isFinite(Number(coords.accuracy)) ? Math.max(0, Number(coords.accuracy)) : 0;
        const allowedRadius = campus.radius + Math.min(accuracy, 250);
        return dist <= allowedRadius;
    });
}

// A single bounded fresh watch gives mobile/desktop providers time to warm up
// and improve a coarse first point. It never changes the configured radius and
// never resolves until a point passes the same campus check used below.
function getBrowserLocationFromWatch(campuses, options = {}) {
    return new Promise((resolve, reject) => {
        const geolocation = typeof window !== 'undefined' ? navigator.geolocation : null;
        if (!geolocation || typeof geolocation.watchPosition !== 'function') {
            const error = new Error('Geolocation watch is unavailable.');
            error.locationCode = 'UNSUPPORTED';
            reject(error);
            return;
        }

        const deadlineMs = Number.isFinite(Number(options.timeout))
            ? Math.max(1, Number(options.timeout))
            : ATTENDANCE_LOCATION_RECOVERY_TIMEOUT_MS;
        let watchId = null;
        let deadlineId = null;
        let settled = false;
        let sawPosition = false;
        let lastTransientCode = 'TIMEOUT';

        const cleanup = () => {
            if (deadlineId !== null) {
                clearTimeout(deadlineId);
                deadlineId = null;
            }
            if (watchId !== null && watchId !== undefined) {
                try {
                    geolocation.clearWatch(watchId);
                } catch (_) {
                    // Cleanup must never replace the attendance result.
                }
                watchId = null;
            }
        };
        const finishWithError = (locationCode, cause = null) => {
            if (settled) return;
            settled = true;
            cleanup();
            const error = new Error('Unable to acquire an allowed browser location fix.');
            error.locationCode = locationCode;
            if (cause) error.cause = cause;
            reject(error);
        };
        const finishWithPosition = coords => {
            if (settled) return;
            settled = true;
            cacheBrowserLocation(coords);
            cleanup();
            resolve(coords);
        };

        deadlineId = setTimeout(() => {
            finishWithError(sawPosition ? 'OUTSIDE_ALLOWED_RADIUS' : lastTransientCode);
        }, deadlineMs);

        try {
            const assignedWatchId = geolocation.watchPosition(
                position => {
                    if (settled) return;
                    const coords = position?.coords;
                    if (
                        !coords ||
                        !Number.isFinite(Number(coords.latitude)) ||
                        !Number.isFinite(Number(coords.longitude))
                    ) {
                        lastTransientCode = 'POSITION_UNAVAILABLE';
                        return;
                    }
                    sawPosition = true;
                    if (isAttendanceLocationAllowed(coords, campuses)) {
                        finishWithPosition(coords);
                    }
                },
                error => {
                    if (settled) return;
                    const locationCode = mapBrowserLocationError(error);
                    if (locationCode === 'PERMISSION_DENIED') {
                        finishWithError(locationCode, error);
                        return;
                    }
                    lastTransientCode = locationCode;
                },
                {
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: Math.min(20000, deadlineMs)
                }
            );
            watchId = assignedWatchId;
            // Defensive cleanup for non-standard mocks/providers that invoke a
            // callback synchronously before returning the watcher ID.
            if (settled && watchId !== null && watchId !== undefined) {
                try {
                    geolocation.clearWatch(watchId);
                } catch (_) {
                    // Cleanup must never replace the attendance result.
                }
                watchId = null;
            }
        } catch (error) {
            finishWithError(mapBrowserLocationError(error), error);
        }
    });
}

async function assertAttendanceLocationAllowed(settings = {}) {
    const campuses = getConfiguredGPSCampuses(settings);
    if (campuses.length === 0) return false;

    let firstCoords;
    try {
        firstCoords = await getBrowserLocation();
    } catch (e) {
        console.warn('[AttendanceLocation] Initial browser fix failed:', e?.locationCode || 'UNKNOWN');
        const initialCode = e?.locationCode || 'ACQUIRE_FAILED';
        if (!['TIMEOUT', 'POSITION_UNAVAILABLE'].includes(initialCode)) {
            throw createAttendanceLocationError(initialCode, e);
        }

        // Some providers report unavailable while their first fix is warming up.
        // Wait through one bounded, fresh watcher instead of firing more one-shot
        // requests back-to-back.
        lastBrowserLocation = null;
        try {
            await getBrowserLocationFromWatch(campuses);
            return true;
        } catch (freshError) {
            console.warn('[AttendanceLocation] Recovery browser fix failed:', freshError?.locationCode || 'UNKNOWN');
            const freshCode = freshError?.locationCode || 'ACQUIRE_FAILED';
            throw createAttendanceLocationError(
                freshCode === 'OUTSIDE_ALLOWED_RADIUS' ? freshCode : `RECOVERY_${freshCode}`,
                freshError
            );
        }
    }

    if (isAttendanceLocationAllowed(firstCoords, campuses)) return true;

    // A browser may first return a cached/coarse position. One bounded fresh
    // watcher can wait for a better point without weakening the campus radius.
    lastBrowserLocation = null;
    try {
        await getBrowserLocationFromWatch(campuses);
        return true;
    } catch (e) {
        console.warn('[AttendanceLocation] Fresh browser fix failed:', e?.locationCode || 'UNKNOWN');
        const freshCode = e?.locationCode || 'ACQUIRE_FAILED';
        if (freshCode !== 'OUTSIDE_ALLOWED_RADIUS') {
            throw createAttendanceLocationError(`FRESH_${freshCode}`, e);
        }
    }

    throw createAttendanceLocationError('OUTSIDE_ALLOWED_RADIUS');
}

// ===== Authentication profile resolution =====
// Firebase Auth emails are generated from usernames, so comparison must be
// case-insensitive while preserving the original profile value for display.
function _normalizeAuthUsername(value) {
    return String(value || '').trim().toLocaleLowerCase('en-US');
}

function _getUsernameFromAuthUser(authUser) {
    const email = String(authUser?.email || '').trim();
    const separatorIndex = email.lastIndexOf('@');
    if (separatorIndex <= 0) return '';
    const domain = email.slice(separatorIndex + 1).toLocaleLowerCase('en-US');
    return domain === 'tuduytre.com' ? email.slice(0, separatorIndex) : '';
}

function _normalizeRoleList(value) {
    const rawRoles = Array.isArray(value?.roles) && value.roles.length
        ? value.roles
        : (value?.role ? [value.role] : []);
    return [...new Set(rawRoles
        .map(role => String(role || '').trim())
        .filter(Boolean))];
}

function _clearStoredAuthSession() {
    if (typeof window === 'undefined') return;
    if (typeof window.clearAuthSessionStorage === 'function') {
        window.clearAuthSessionStorage();
        return;
    }

    [
        'currentUser',
        'currentRole',
        'currentUserId',
        'currentAuthUid',
        'userFullName',
        'currentUserName'
    ].forEach(key => window.localStorage?.removeItem(key));
}

function _createAuthProfileError(message, code = 'auth/profile-mismatch') {
    const error = new Error(message);
    error.code = code;
    return error;
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

    _getAuthenticatedDirectoryContext: async () => {
        const primaryAuth = window.auth || (typeof firebase !== 'undefined' ? firebase.auth() : null);
        const actor = primaryAuth?.currentUser;
        if (!actor?.uid) return { uid: '', userId: '', roles: [], canReadPrivateProfiles: false };
        const cacheKey = `directory_authz_${actor.uid}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];
        const promise = (async () => {
            try {
                const roleSnapshot = await db.collection('user_roles').doc(actor.uid).get();
                const roleData = roleSnapshot.exists ? (roleSnapshot.data() || {}) : {};
                const roles = _normalizeRoleList(roleData);
                return {
                    uid: actor.uid,
                    userId: String(roleData.userId || '').trim(),
                    roles,
                    canReadPrivateProfiles: roles.some(role => role === 'admin' || role === 'senior_assistant')
                };
            } catch (error) {
                console.warn('[Security] Cannot resolve directory scope; using public staff directory.', error?.code || 'unknown');
                return { uid: actor.uid, userId: '', roles: [], canReadPrivateProfiles: false };
            }
        })();
        DBService._cache[cacheKey] = promise;
        return promise;
    },

    _toStaffDirectoryProfile: (user) => {
        // Exact allow-list: payroll configuration, auth UID, password and
        // migration/audit metadata must never be copied to the shared roster.
        const publicKeys = [
            'id', 'name', 'displayName', 'username', 'role', 'roles',
            'specialty', 'specialties', 'branch', 'branches', 'department',
            'position', 'title', 'isActive', 'active', 'status', 'scheduleColor'
        ];
        const directoryProfile = {};
        publicKeys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(user || {}, key) && user[key] !== undefined) {
                directoryProfile[key] = user[key];
            }
        });
        return directoryProfile;
    },

    // Các hàm xử lý dữ liệu sẽ được thêm vào dưới đây (getUsers, checkIn, etc.)
    // 3. Resolve the Firestore profile that belongs to an authenticated UID.
    // The UID-keyed mapping is authoritative. Username lookup is retained only
    // for legacy mappings which do not yet contain userId.
    _findUserProfileCaseCompatible: async (username) => {
        const requestedUsername = String(username || '').trim();
        const normalizedUsername = _normalizeAuthUsername(requestedUsername);
        if (!normalizedUsername) return null;

        const usersRef = window.db.collection('users');
        const exactCandidates = [...new Set([requestedUsername, normalizedUsername].filter(Boolean))];
        for (const candidate of exactCandidates) {
            const exactSnapshot = await usersRef
                .where('username', '==', candidate)
                .limit(2)
                .get();
            if (exactSnapshot.size > 1) {
                throw _createAuthProfileError(
                    'Có nhiều hồ sơ trùng tên đăng nhập. Vui lòng liên hệ Admin!',
                    'auth/duplicate-profile'
                );
            }
            if (!exactSnapshot.empty) return exactSnapshot.docs[0];
        }

        // Firestore has no native case-insensitive equality. This scan only runs
        // for legacy mixed-case usernames after the indexed exact lookups fail.
        const legacySnapshot = await usersRef.get();
        const compatibleDocs = legacySnapshot.docs.filter(doc =>
            _normalizeAuthUsername(doc.data()?.username) === normalizedUsername
        );
        if (compatibleDocs.length > 1) {
            throw _createAuthProfileError(
                'Có nhiều hồ sơ trùng tên đăng nhập (khác chữ hoa/thường). Vui lòng liên hệ Admin!',
                'auth/duplicate-profile'
            );
        }
        return compatibleDocs[0] || null;
    },

    getAuthenticatedProfile: async (authUser, hints = {}) => {
        if (!authUser?.uid) {
            throw _createAuthProfileError('Phiên đăng nhập Firebase không hợp lệ!', 'auth/session-missing');
        }
        if (!window.db) {
            throw _createAuthProfileError('Không thể kết nối cơ sở dữ liệu!', 'auth/database-unavailable');
        }

        const authUsername = _getUsernameFromAuthUser(authUser);
        const normalizedAuthUsername = _normalizeAuthUsername(authUsername);
        const hintedUsername = String(hints.username || '').trim();
        if (!normalizedAuthUsername) {
            throw _createAuthProfileError('Tài khoản Firebase không có email đăng nhập hợp lệ!');
        }
        if (hintedUsername && _normalizeAuthUsername(hintedUsername) !== normalizedAuthUsername) {
            throw _createAuthProfileError('Tên đăng nhập không khớp với phiên Firebase!');
        }

        const roleSnapshot = await window.db.collection('user_roles').doc(authUser.uid).get();
        const roleMapping = roleSnapshot.exists ? roleSnapshot.data() : null;
        const mappedUserId = String(roleMapping?.userId || '').trim();
        const hintedUserId = String(hints.userId || '').trim();
        let profileDoc = null;

        if (mappedUserId) {
            // Never accept a localStorage user id that belongs to another UID.
            if (hintedUserId && hintedUserId !== mappedUserId) {
                throw _createAuthProfileError('Phiên đăng nhập không khớp hồ sơ nhân sự!');
            }
            const mappedSnapshot = await window.db.collection('users').doc(mappedUserId).get();
            if (!mappedSnapshot.exists) {
                throw _createAuthProfileError(
                    'Tài khoản đã xác thực nhưng hồ sơ được liên kết không tồn tại!',
                    'auth/profile-not-found'
                );
            }
            profileDoc = mappedSnapshot;
        } else {
            // Legacy compatibility: the Auth email is the lookup source, never a
            // role/user id supplied only by localStorage.
            profileDoc = await DBService._findUserProfileCaseCompatible(authUsername);
            if (!profileDoc) {
                throw _createAuthProfileError(
                    'Tài khoản xác thực thành công nhưng không tìm thấy dữ liệu hồ sơ!',
                    'auth/profile-not-found'
                );
            }
            if (hintedUserId && hintedUserId !== profileDoc.id) {
                throw _createAuthProfileError('Phiên đăng nhập không khớp hồ sơ nhân sự!');
            }
        }

        const { password: _legacyPassword, ...profileData } = profileDoc.data() || {};
        const userData = { id: profileDoc.id, ...profileData };
        const profileUsername = _normalizeAuthUsername(userData.username);
        if (!profileUsername || profileUsername !== normalizedAuthUsername) {
            throw _createAuthProfileError('Hồ sơ nhân sự không khớp tài khoản Firebase!');
        }
        if (roleMapping?.username
            && _normalizeAuthUsername(roleMapping.username) !== profileUsername) {
            throw _createAuthProfileError('UID Firebase đang được liên kết với tên đăng nhập khác!');
        }

        // Roles are read from the UID mapping when present. We never let a
        // browser session write or "repair" its own role mapping.
        const mappedRoles = _normalizeRoleList(roleMapping);
        const profileRoles = _normalizeRoleList(userData);
        const roles = roleMapping
            ? (mappedRoles.length ? mappedRoles : ['staff'])
            : (profileRoles.length ? profileRoles : ['staff']);
        const primaryRole = roles.includes(String(roleMapping?.role || '').trim())
            ? String(roleMapping.role).trim()
            : roles[0];

        return {
            ...userData,
            role: primaryRole,
            roles,
            authUid: authUser.uid,
            roleMappingVerified: Boolean(mappedUserId)
        };
    },

    // 4. Authenticate User (Firebase Auth + UID-bound profile)
    loginUser: async (username, password) => {
        const loginUsername = String(username || '').trim();
        try {
            if (!loginUsername) throw new Error('Vui lòng nhập tên đăng nhập!');

            // Password is intentionally passed through unchanged. Leading or
            // trailing spaces can be part of a valid Firebase password.
            const email = `${loginUsername}@tuduytre.com`.toLowerCase();
            const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
            return await DBService.getAuthenticatedProfile(userCredential.user, {
                username: loginUsername
            });
        } catch (error) {
            // A Firebase credential without a matching profile must never remain
            // signed in. Also remove stale client identity values on every error.
            try {
                const primaryAuth = window.auth || firebase.auth();
                if (primaryAuth) await primaryAuth.signOut();
            } catch (signOutError) {
                console.warn('Secure Login cleanup could not sign out Firebase:', signOutError);
            } finally {
                _clearStoredAuthSession();
            }

            console.error('Secure Login Error:', error);
            if (error.code === 'auth/wrong-password') throw new Error('Sai mật khẩu!');
            if (error.code === 'auth/user-not-found') throw new Error('Tài khoản không tồn tại!');
            if (error.code === 'auth/invalid-credential') throw new Error('Sai tên đăng nhập hoặc mật khẩu!');
            if (error.code === 'auth/too-many-requests') throw new Error('Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau!');
            if (error.code === 'auth/network-request-failed') throw new Error('Không thể kết nối máy chủ đăng nhập. Vui lòng kiểm tra mạng!');
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
        const context = await DBService._getAuthenticatedDirectoryContext();
        const collectionName = context.canReadPrivateProfiles ? 'users' : 'staff_directory';
        const cacheKey = `users_all_${context.uid || 'anonymous'}_${collectionName}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                let snapshot;
                try {
                    snapshot = await db.collection(collectionName).get();
                } catch (directoryError) {
                    // Zero-downtime rollout: the frontend may reach production a
                    // few seconds before rules start allowing staff_directory.
                    // Falling back to the legacy collection is useful only while
                    // the old rules are active; final rules deny this list.
                    if (collectionName !== 'staff_directory') throw directoryError;
                    console.warn('[Security] Staff directory is not active yet; using rollout fallback.');
                    snapshot = await db.collection('users').get();
                }
                const rawUsers = snapshot.docs.map(doc => {
                    const { password: _legacyPassword, ...profile } = doc.data() || {};
                    return { id: doc.id, ...profile };
                });
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
        const context = await DBService._getAuthenticatedDirectoryContext();
        const collectionName = context.canReadPrivateProfiles || context.userId === String(userId)
            ? 'users'
            : 'staff_directory';
        const cacheKey = `user_${userId}_${context.uid || 'anonymous'}_${collectionName}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                let profileDoc;
                try {
                    profileDoc = await db.collection(collectionName).doc(userId).get();
                } catch (directoryError) {
                    if (collectionName !== 'staff_directory') throw directoryError;
                    console.warn('[Security] Staff directory is not active yet; using rollout fallback.');
                    profileDoc = await db.collection('users').doc(userId).get();
                }
                if (!profileDoc.exists) return null;
                const { password: _legacyPassword, ...profile } = profileDoc.data() || {};
                return { id: profileDoc.id, ...profile };
            } catch (error) {
                console.error("Error getting user:", error);
                return null;
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    // Credentials are isolated from the staff profile collection. Only verified
    // managers may read this compatibility store; normal authenticated users can
    // never download colleagues' passwords through getUsers().
    getUserCredentialsMap: async () => {
        const snapshot = await db.collection('user_credentials').get();
        const result = {};
        snapshot.forEach(doc => {
            const data = doc.data() || {};
            result[doc.id] = { staffId: doc.id, password: data.password || '' };
        });
        return result;
    },

    updateOwnCredentialPassword: async (staffId, password) => {
        if (!staffId || !password) throw new Error('Thiếu thông tin cập nhật mật khẩu.');
        await db.collection('user_credentials').doc(staffId).set({
            staffId,
            password,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return true;
    },

    _syncUserRoleMappingAsManager: async (user, batch = null) => {
        const primaryAuth = window.auth || (typeof firebase !== 'undefined' ? firebase.auth() : null);
        const actor = primaryAuth?.currentUser;
        if (!actor?.uid) return false;

        // Client storage is never authorization. Confirm the actor's role from
        // the UID-keyed document; Firestore Rules remain the final enforcement.
        const actorRoleSnapshot = await db.collection('user_roles').doc(actor.uid).get();
        if (!actorRoleSnapshot.exists) return false;
        const actorRoles = _normalizeRoleList(actorRoleSnapshot.data());
        if (!actorRoles.some(role => role === 'admin' || role === 'senior_assistant')) return false;

        const targetAuthUid = String(user.authUid || '').trim();
        let targetRef = targetAuthUid ? db.collection('user_roles').doc(targetAuthUid) : null;
        if (!targetRef) {
            const targetSnapshot = await db.collection('user_roles')
                .where('username', '==', user.username)
                .limit(2)
                .get();
            if (targetSnapshot.empty) return false;
            if (targetSnapshot.size !== 1) {
                throw _createAuthProfileError(
                    'Có nhiều UID cùng tên đăng nhập; không thể đồng bộ vai trò an toàn.',
                    'auth/duplicate-role-mapping'
                );
            }
            targetRef = targetSnapshot.docs[0].ref;
        }
        const roles = _normalizeRoleList(user);
        const requestedPrimaryRole = String(user.role || '').trim();
        const rolePayload = {
            userId: user.id,
            username: user.username,
            role: roles.includes(requestedPrimaryRole) ? requestedPrimaryRole : (roles[0] || 'staff'),
            roles: roles.length ? roles : ['staff'],
            updatedByAdmin: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (batch) batch.set(targetRef, rolePayload, { merge: true });
        else await targetRef.set(rolePayload, { merge: true });
        return true;
    },

    saveUser: async (user) => {
        try {
            // user.id determines update or create
            const ref = db.collection('users').doc(user.id);
            const directoryRef = db.collection('staff_directory').doc(user.id);
            const { password, ...safeProfile } = user;
            const batch = db.batch();
            const roleWasSynced = await DBService._syncUserRoleMappingAsManager(user, batch);
            if (user.authUid && !roleWasSynced) {
                throw new Error('Không thể tạo ánh xạ quyền cho tài khoản đăng nhập. Chưa lưu hồ sơ.');
            }
            batch.set(ref, safeProfile, { merge: true });
            batch.set(directoryRef, DBService._toStaffDirectoryProfile(safeProfile));
            if (password) {
                batch.set(db.collection('user_credentials').doc(user.id), {
                    staffId: user.id,
                    password,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
            await batch.commit();
            DBService._invalidate('users_all');
            DBService._invalidate(`user_${user.id}`);

            if (roleWasSynced) console.log('[Security] UID-verified manager synced user role mapping for', user.username);

            return true;
        } catch (error) {
            console.error("Error saving user:", error);
            throw error;
        }
    },

    // Firestore and Firebase Auth cannot share one atomic transaction. Delete the
    // Firestore side first, but return an in-memory recovery snapshot so the UI can
    // restore it immediately when the Auth deletion is refused or fails.
    deleteUser: async (userId, authUid = '') => {
        let pendingRecoverySnapshot = null;
        try {
            const normalizedUserId = String(userId || '').trim();
            const normalizedAuthUid = String(authUid || '').trim();
            if (!normalizedUserId) throw new Error('Thiếu mã nhân sự cần xóa.');

            const primaryAuth = window.auth || (
                typeof firebase !== 'undefined' && typeof firebase.auth === 'function'
                    ? firebase.auth()
                    : null
            );
            const currentActorAuthUid = String(primaryAuth?.currentUser?.uid || '').trim();
            const currentStaffId = String(window.localStorage?.getItem('currentUserId') || '').trim();
            if (currentStaffId === normalizedUserId || (
                normalizedAuthUid && currentActorAuthUid === normalizedAuthUid
            )) {
                const selfDeleteError = new Error('Không thể xóa chính tài khoản quản trị đang đăng nhập.');
                selfDeleteError.code = 'staff/delete-current-actor';
                throw selfDeleteError;
            }

            let roleRefs = [];
            if (normalizedAuthUid) {
                roleRefs = [db.collection('user_roles').doc(normalizedAuthUid)];
            } else {
                const mappings = await db.collection('user_roles')
                    .where('userId', '==', normalizedUserId)
                    .get();
                roleRefs = mappings.docs.map(doc => doc.ref);
            }
            if (currentActorAuthUid && roleRefs.some(ref => ref.id === currentActorAuthUid)) {
                const actorRoleError = new Error('Không thể xóa ánh xạ quyền của tài khoản quản trị đang đăng nhập.');
                actorRoleError.code = 'staff/delete-current-actor';
                throw actorRoleError;
            }

            const targets = [
                { collection: 'users', ref: db.collection('users').doc(normalizedUserId) },
                { collection: 'staff_directory', ref: db.collection('staff_directory').doc(normalizedUserId) },
                { collection: 'user_credentials', ref: db.collection('user_credentials').doc(normalizedUserId) },
                ...roleRefs.map(ref => ({ collection: 'user_roles', ref }))
            ];

            const recoverySnapshot = await db.runTransaction(async transaction => {
                const snapshots = await Promise.all(targets.map(target => transaction.get(target.ref)));
                const profileSnapshot = snapshots[0];
                if (!profileSnapshot.exists) {
                    const missingProfileError = new Error('Hồ sơ nhân sự không còn tồn tại; chưa thay đổi tài khoản đăng nhập.');
                    missingProfileError.code = 'staff/profile-not-found';
                    throw missingProfileError;
                }

                const profileData = profileSnapshot.data() || {};
                if (currentActorAuthUid &&
                    String(profileData.authUid || '').trim() === currentActorAuthUid) {
                    const profileActorError = new Error('Không thể xóa chính tài khoản quản trị đang đăng nhập.');
                    profileActorError.code = 'staff/delete-current-actor';
                    throw profileActorError;
                }
                if (normalizedAuthUid && profileData.authUid &&
                    String(profileData.authUid).trim() !== normalizedAuthUid) {
                    const profileUidError = new Error('UID đăng nhập không khớp hồ sơ; đã dừng xóa để bảo vệ tài khoản khác.');
                    profileUidError.code = 'staff/auth-uid-mismatch';
                    throw profileUidError;
                }

                snapshots.forEach((snapshot, index) => {
                    if (!snapshot.exists || targets[index].collection !== 'user_roles') return;
                    if (String(snapshot.data()?.userId || '').trim() !== normalizedUserId) {
                        const roleMismatchError = new Error('Ánh xạ quyền không khớp nhân sự; đã dừng xóa để bảo vệ tài khoản khác.');
                        roleMismatchError.code = 'staff/role-mapping-mismatch';
                        throw roleMismatchError;
                    }
                });

                const documents = [];
                snapshots.forEach((snapshot, index) => {
                    if (!snapshot.exists) return;
                    documents.push({
                        collection: targets[index].collection,
                        id: snapshot.id,
                        data: snapshot.data()
                    });
                    transaction.delete(targets[index].ref);
                });

                pendingRecoverySnapshot = {
                    schemaVersion: 1,
                    userId: normalizedUserId,
                    authUid: normalizedAuthUid,
                    documents
                };
                return pendingRecoverySnapshot;
            });

            DBService._invalidate('users_all');
            DBService._invalidate(`user_${normalizedUserId}`);
            return recoverySnapshot;
        } catch (error) {
            // A transaction can be committed remotely while its acknowledgement is
            // lost. If the callback already built a snapshot, restore/no-op before
            // allowing the UI to continue; Auth has not been touched at this point.
            if (pendingRecoverySnapshot) {
                try {
                    await DBService.restoreDeletedUser(pendingRecoverySnapshot);
                } catch (recoveryError) {
                    console.error('Firestore delete recovery could not be verified:', recoveryError);
                    error.message += ' Không thể xác minh việc khôi phục hồ sơ sau lỗi mạng.';
                }
            }
            console.error("Error deleting user:", error);
            throw error;
        }
    },

    restoreDeletedUser: async (recoverySnapshot) => {
        try {
            const normalizedUserId = String(recoverySnapshot?.userId || '').trim();
            const documents = Array.isArray(recoverySnapshot?.documents)
                ? recoverySnapshot.documents
                : [];
            const allowedCollections = new Set([
                'users', 'staff_directory', 'user_credentials', 'user_roles'
            ]);
            if (recoverySnapshot?.schemaVersion !== 1 || !normalizedUserId || !documents.length) {
                throw new Error('Ảnh khôi phục hồ sơ không hợp lệ.');
            }

            const seenPaths = new Set();
            const targets = documents.map(document => {
                const collection = String(document?.collection || '');
                const id = String(document?.id || '');
                if (!allowedCollections.has(collection) || !id || !document?.data) {
                    throw new Error('Ảnh khôi phục chứa tài liệu không hợp lệ.');
                }
                if (collection !== 'user_roles' && id !== normalizedUserId) {
                    throw new Error('Ảnh khôi phục không khớp mã nhân sự.');
                }
                if (collection === 'user_roles' &&
                    String(document.data.userId || '').trim() !== normalizedUserId) {
                    throw new Error('Ảnh khôi phục quyền không khớp mã nhân sự.');
                }
                const path = `${collection}/${id}`;
                if (seenPaths.has(path)) throw new Error('Ảnh khôi phục chứa tài liệu trùng lặp.');
                seenPaths.add(path);
                return { ref: db.collection(collection).doc(id), data: document.data };
            });

            await db.runTransaction(async transaction => {
                const currentSnapshots = await Promise.all(targets.map(target => transaction.get(target.ref)));
                const existingCount = currentSnapshots.filter(snapshot => snapshot.exists).length;
                // The delete transaction may have failed before committing. In that
                // case every original document is already present and compensation
                // is a successful no-op; never overwrite those current documents.
                if (existingCount === targets.length) return;
                if (existingCount > 0) {
                    const conflictError = new Error('Dữ liệu nhân sự đã được tạo lại; không ghi đè bằng ảnh khôi phục cũ.');
                    conflictError.code = 'staff/restore-conflict';
                    throw conflictError;
                }
                targets.forEach(target => transaction.set(target.ref, target.data));
            });

            DBService._invalidate('users_all');
            DBService._invalidate(`user_${normalizedUserId}`);
            return true;
        } catch (error) {
            console.error('Error restoring deleted user:', error);
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

    _getScheduleRegistrations: async (compositeKey) => {
        const userId = String(localStorage.getItem('currentUserId') || '').trim();
        if (!userId) return [];
        let roles = [];
        try {
            const stored = localStorage.getItem('currentRole') || '';
            const parsed = JSON.parse(stored);
            roles = Array.isArray(parsed) ? parsed : [stored];
        } catch (error) {
            roles = [localStorage.getItem('currentRole') || ''];
        }
        const canReadAll = roles.some(role => ['admin', 'senior_assistant', 'assistant'].includes(role));
        const collection = db.collection('schedule_registrations');
        const read = async (all) => {
            let query = collection.where('scheduleKey', '==', compositeKey);
            if (!all) query = query.where('userId', '==', userId);
            const snapshot = await query.get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        };
        try {
            return await read(canReadAll);
        } catch (error) {
            // A stale/tampered local role must not hide the schedule. Retry the
            // owner-scoped query that Firestore Rules can prove safely.
            if (canReadAll) {
                try { return await read(false); } catch (_) { /* report original below */ }
            }
            console.warn('[ScheduleRegistration] Could not load registrations:', error);
            return [];
        }
    },

    _attachScheduleRegistrations: async (compositeKey, data) => {
        if (!data || typeof data !== 'object') return data || {};
        const registrations = await DBService._getScheduleRegistrations(compositeKey);
        return _mergeScheduleRegistrations(data, registrations);
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
                    if (hasStructure) return DBService._attachScheduleRegistrations(compositeKey, data);
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
                            delete newRow.gvThayTheAt;
                            delete newRow.teacherAbsences;
                            delete newRow.teacherAbsenceHistory;
                            delete newRow.staffingUpdatedAt;
                            delete newRow.staffingUpdatedById;
                            delete newRow.staffingUpdatedByName;
                            newRow.shiftId = createScheduleShiftId();
                            newRow.staffingSchemaVersion = 2;
                            newRow.teacherAbsences = [];
                            newRow.teacherAbsenceHistory = [];
                            return newRow;
                        });
                    }
                });

                return DBService._attachScheduleRegistrations(compositeKey, templateData);

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
            await db.collection('schedules').doc(docId).set(_withoutSeparateScheduleRegistrations(data));

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

    // 5. Class Registration (Nhận Lớp). Registrations live outside schedules so
    // staff can only mutate their own small document, never a whole schedule day.
    // A cancelled document acts as a tombstone for legacy registeredTeachers.
    registerClass: async (compositeKey, caType, rowMeta, user) => {
        try {
            const userId = user ? (user.id || user.uid) : null;
            const userName = user ? (user.name || user.displayName || user.username) : null;
            if (!userId) throw new Error("User ID is required for registration!");
            const { branch, dateKey, docId } = DBService._parseBranchKey(compositeKey);
            if (!SCHEDULE_SECTION_KEYS.includes(caType)) throw new Error('Nhóm ca không hợp lệ.');
            const schedule = await DBService.getSchedule(compositeKey);
            const rowIndex = Number(rowMeta?.index);
            const row = schedule?.[caType]?.[rowIndex];
            if (!row) throw new Error('Ca không còn tồn tại hoặc đã được người xếp lịch thay đổi.');

            const registrationId = _scheduleRegistrationId(compositeKey, caType, row, userId, rowIndex);
            const registrationRef = db.collection('schedule_registrations').doc(registrationId);
            const currentlyRegistered = (row.registeredTeachers || [])
                .some(item => String(item?.id || '') === String(userId));
            const nextStatus = currentlyRegistered ? 'cancelled' : 'active';
            const authUid = String((window.auth || firebase.auth())?.currentUser?.uid || '').trim();
            if (!authUid) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');

            await db.runTransaction(async transaction => {
                const existingSnapshot = await transaction.get(registrationRef);
                const existing = existingSnapshot.exists ? existingSnapshot.data() : null;
                const immutable = existing || {
                    scheduleKey: compositeKey,
                    scheduleDocId: docId,
                    branch,
                    dateKey,
                    section: caType,
                    rowIndex,
                    shiftId: String(row.shiftId || ''),
                    rowSignature: _scheduleRegistrationRowSignature(row),
                    userId: String(userId),
                    authUid,
                    schemaVersion: 1,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                if (existing && (
                    String(existing.userId) !== String(userId) ||
                    String(existing.scheduleKey) !== String(compositeKey) ||
                    String(existing.section) !== String(caType)
                )) {
                    throw new Error('Khóa đăng ký lớp bị xung đột. Vui lòng tải lại trang.');
                }
                transaction.set(registrationRef, {
                    ...immutable,
                    userName: userName || existing?.userName || 'Staff',
                    status: nextStatus,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            DBService._invalidate(`schedule_${compositeKey}`);
            return nextStatus;
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
            const compositeKey = `${branch}__${mondayKey}`;
            const sources = await Promise.all([
                Promise.all([
                    DBService.getReceptionistSchedule(compositeKey),
                    DBService.getReceptionistShiftConfig(branch)
                ]).then(([weekData, config]) => ({ weekData, config, scheduleType: 'receptionist' })),
                Promise.all([
                    DBService.getOfficeSchedule(compositeKey),
                    DBService.getOfficeShiftConfig(branch)
                ]).then(([weekData, config]) => ({ weekData, config, scheduleType: 'office' }))
            ]);

            for (const source of sources) {
                const weekData = source.weekData;
                if (!weekData) continue;
                for (const shiftKey of SHIFT_KEYS) {
                    const shiftData = weekData[shiftKey];
                    const staffEntry = shiftData?.[dayKey]?.find(s => String(s.id) === String(userId));
                    if (!staffEntry) continue;

                    const weekShiftCfg = weekData._shiftConfig?.[shiftKey];
                    const start = staffEntry.customStart || weekShiftCfg?.start || source.config?.[shiftKey]?.start;
                    const end = staffEntry.customEnd || weekShiftCfg?.end || source.config?.[shiftKey]?.end;
                    if (!start || !end) continue;

                    const [startHour, startMinute] = start.split(':').map(Number);
                    const [endHour, endMinute] = end.split(':').map(Number);
                    shifts.push({
                        shift: shiftKey,
                        label: { morning: 'SÁNG', afternoon: 'CHIỀU', evening: 'TỐI' }[shiftKey],
                        start,
                        end,
                        branch,
                        scheduleType: source.scheduleType,
                        documentKey: compositeKey,
                        cancelCompositeKey: source.scheduleType === 'office'
                            ? `office_${branch}_${mondayKey}`
                            : `${branch}_${mondayKey}`,
                        isFixedShift: staffEntry.isFixedShift === true,
                        shiftStart: new Date(year, month - 1, day, startHour, startMinute, 0, 0),
                        shiftEnd: new Date(year, month - 1, day, endHour, endMinute, 0, 0)
                    });
                }
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
    getSubjects: async (forceServer = false) => {
        const cacheKey = 'subjects_all';
        if (!forceServer && DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const query = db.collection('subjects').orderBy('name');
                let snap;
                try {
                    snap = forceServer ? await query.get({ source: 'server' }) : await query.get();
                } catch (networkError) {
                    // PWA có thể đang offline; giữ khả năng xem dữ liệu cache nhưng không
                    // biến một lần mất mạng thành danh sách môn rỗng/"Không áp dụng" hàng loạt.
                    console.warn('getSubjects server refresh failed; using cache:', networkError);
                    snap = await query.get({ source: 'cache' });
                }
                const result = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                DBService._cache[cacheKey] = Promise.resolve(result);
                return result;
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
            const evidenceByUser = new Map();
            snap.forEach(doc => {
                const d = doc.data();
                const sessions = Array.isArray(d.sessions)
                    ? d.sessions
                    : (d.checkIn ? [{ checkIn: d.checkIn, checkOut: d.checkOut || null }] : []);
                if (d.userId) {
                    const usable = sessions.filter(session =>
                        !session?.isAbsent && (session?.checkIn || session?.start)
                    );
                    if (usable.length) {
                        const key = String(d.userId);
                        evidenceByUser.set(key, [...(evidenceByUser.get(key) || []), ...usable]);
                    }
                }
            });
            return evidenceByUser;
        } catch (e) {
            console.warn('getDayAttendance error:', e);
            return new Map();
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
        return assertAttendanceLocationAllowed(settings);
    },

    // Copy/template workflows may create a whole day, but must never replace a
    // day that another scheduler already prepared. The existence check and
    // create happen in the same transaction.
    createScheduleIfMissing: async (compositeKey, data) => {
        const { docId } = DBService._parseBranchKey(compositeKey);
        const ref = db.collection('schedules').doc(docId);
        let created = false;
        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            if (snapshot.exists) return;
            transaction.set(ref, _withoutSeparateScheduleRegistrations({
                ...(data || {}),
                _revision: 1,
                _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                _updatedBy: localStorage.getItem('currentUserId') || null
            }));
            created = true;
        });
        if (!created) return false;
        await DBService.updateScheduleManifest(compositeKey);
        DBService._invalidate(`schedule_${compositeKey}`);
        return true;
    },

    // Update exactly one class row from the latest Firestore document. The old UI
    // rewrote the whole cached day, so two schedulers editing different classes could
    // silently overwrite each other. A stable shiftId is preferred; the signature is
    // a guarded fallback for legacy rows that have not been materialized with an ID yet.
    updateScheduleRowAtomic: async (compositeKey, section, locator, applyRow, fallbackDayData = null) => {
        if (!section || typeof applyRow !== 'function') {
            throw new Error('Thiếu thông tin ca cần cập nhật.');
        }
        const { docId } = DBService._parseBranchKey(compositeKey);
        const ref = db.collection('schedules').doc(docId);
        let committedRow = null;
        const signatureOf = row => [row?.start, row?.end, row?.lop, row?.phong]
            .map(value => String(value || '').trim())
            .join('|');

        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            const source = snapshot.exists
                ? snapshot.data()
                : JSON.parse(JSON.stringify(fallbackDayData || {}));
            const rows = Array.isArray(source?.[section]) ? source[section].map(row => ({ ...row })) : [];
            const wantedShiftId = String(locator?.shiftId || '').trim();
            const expectedSignature = String(locator?.signature || '').trim();
            let rowIndex = wantedShiftId
                ? rows.findIndex(row => String(row?.shiftId || '') === wantedShiftId)
                : -1;

            if (rowIndex < 0 && Number.isInteger(locator?.index)) {
                const candidate = rows[locator.index];
                if (candidate && (!expectedSignature || signatureOf(candidate) === expectedSignature)) {
                    rowIndex = locator.index;
                }
            }
            if (rowIndex < 0 || !rows[rowIndex]) {
                const conflict = new Error('Ca đã được người khác thay đổi hoặc di chuyển. Vui lòng tải lại lịch rồi thử lại.');
                conflict.code = 'schedule/conflict';
                throw conflict;
            }

            const latestRow = JSON.parse(JSON.stringify(rows[rowIndex]));
            const nextRow = applyRow(latestRow);
            if (!nextRow || typeof nextRow !== 'object') throw new Error('Dữ liệu điều phối ca không hợp lệ.');
            if (!nextRow.shiftId) nextRow.shiftId = createScheduleShiftId();
            rows[rowIndex] = nextRow;
            const currentRevision = Number.isInteger(source?._revision) ? source._revision : 0;
            transaction.set(ref, _withoutSeparateScheduleRegistrations({
                ...source,
                [section]: rows,
                _revision: currentRevision + 1,
                _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                _updatedBy: localStorage.getItem('currentUserId') || null
            }));
            committedRow = JSON.parse(JSON.stringify(nextRow));
        });

        await DBService.updateScheduleManifest(compositeKey);
        DBService._invalidate(`schedule_${compositeKey}`);
        try {
            localStorage.setItem('scheduleDataVersion', JSON.stringify({ compositeKey, at: Date.now() }));
        } catch (error) {
            // Cross-tab invalidation is best effort; Firestore remains the source of truth.
        }
        return committedRow;
    },

    // Add/delete/reorder rows against the latest section in one transaction.
    // This is the section-level companion to updateScheduleRowAtomic and keeps
    // edits in unrelated rows, including staffing/absence state, intact.
    mutateScheduleSectionAtomic: async (compositeKey, section, applyRows, fallbackDayData = null) => {
        if (!section || typeof applyRows !== 'function') {
            throw new Error('Thiếu thông tin danh sách ca cần cập nhật.');
        }
        const { docId } = DBService._parseBranchKey(compositeKey);
        const ref = db.collection('schedules').doc(docId);
        let committedRows = [];

        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            const source = snapshot.exists
                ? snapshot.data()
                : JSON.parse(JSON.stringify(fallbackDayData || {}));
            const rows = Array.isArray(source?.[section])
                ? source[section].map(row => JSON.parse(JSON.stringify(row)))
                : [];
            const nextRows = applyRows(rows);
            if (!Array.isArray(nextRows)) throw new Error('Danh sách ca sau cập nhật không hợp lệ.');
            nextRows.forEach(row => {
                if (!row || typeof row !== 'object') throw new Error('Ca làm việc không hợp lệ.');
                if (!row.shiftId) row.shiftId = createScheduleShiftId();
            });
            const currentRevision = Number.isInteger(source?._revision) ? source._revision : 0;
            transaction.set(ref, _withoutSeparateScheduleRegistrations({
                ...source,
                [section]: nextRows,
                _revision: currentRevision + 1,
                _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                _updatedBy: localStorage.getItem('currentUserId') || null
            }));
            committedRows = JSON.parse(JSON.stringify(nextRows));
        });

        await DBService.updateScheduleManifest(compositeKey);
        DBService._invalidate(`schedule_${compositeKey}`);
        try {
            localStorage.setItem('scheduleDataVersion', JSON.stringify({ compositeKey, at: Date.now() }));
        } catch (error) {
            // Cross-tab invalidation is best effort.
        }
        return committedRows;
    },

    checkInPersonal: async (userId, userFullName) => {
        const settingsDoc = await db.collection('settings').doc('system').get();
        if (settingsDoc.exists) {
            const settings = settingsDoc.data();
            const hasGPS = getConfiguredGPSCampuses(settings).length > 0;

            if (hasGPS) {
                // GPS is the real attendance gate. The exact Wifi/IP sentence
                // remains the only staff-facing explanation by policy.
                try {
                    await assertAttendanceLocationAllowed(settings);
                } catch (locationError) {
                    await recordAttendanceLocationFailure(
                        userId,
                        locationError?.code || 'UNKNOWN',
                        'location_gate'
                    );
                    throw locationError;
                }
            }
        }

        const now = new Date();
        const dateKey = getLocalDateKeyFromDate(now);
        const previousDateKey = getLocalDateKeyFromDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
        const docId = `${dateKey}_${userId}`;
        const ref = db.collection('attendance_logs').doc(docId);
        const previousRef = db.collection('attendance_logs').doc(`${previousDateKey}_${userId}`);

        await db.runTransaction(async (t) => {
            const [doc, previousDoc] = await Promise.all([t.get(ref), t.get(previousRef)]);
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
            const openSession = data.sessions.find(s => !s.checkOut && !s.isAbsent);
            const previousData = previousDoc.exists ? previousDoc.data() : null;
            const previousSessions = previousData
                ? (Array.isArray(previousData.sessions)
                    ? previousData.sessions
                    : (previousData.checkIn ? [{ checkIn: previousData.checkIn, checkOut: previousData.checkOut || null }] : []))
                : [];
            const previousOpenSession = previousSessions.find(s => !s.checkOut && !s.isAbsent);
            if (previousOpenSession) {
                const startTime = new Date(previousOpenSession.checkIn || previousOpenSession.start).toLocaleString('vi-VN');
                throw new Error(`Bạn còn ca làm việc từ ${startTime} chưa kết thúc. Vui lòng Ra ca trước khi Vào ca mới.`);
            }
            if (openSession) {
                const startTime = new Date(openSession.checkIn || openSession.start).toLocaleTimeString('vi-VN');
                throw new Error(`Bạn đang có ca làm việc chưa kết thúc (bắt đầu lúc ${startTime})! Vui lòng Check-out hoặc Xóa ca cũ.`);
            }

            // Cooldown check-in removed as requested

            // Add new session
            const newSession = {
                id: createAttendanceSessionId(),
                anchorDateKey: dateKey,
                status: 'open',
                source: 'self',
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
        const previousDateKey = getLocalDateKeyFromDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
        const candidates = Array.from(new Set([dateKey, previousDateKey])).map(key => ({
            key,
            ref: db.collection('attendance_logs').doc(`${key}_${userId}`)
        }));
        let anchorDateKey = dateKey;

        await db.runTransaction(async (t) => {
            const snapshots = await Promise.all(candidates.map(item => t.get(item.ref)));
            const openCandidates = [];
            snapshots.forEach((doc, candidateIndex) => {
                if (!doc.exists) return;
                const data = doc.data();
                if (!Array.isArray(data.sessions)) {
                    data.sessions = data.checkIn ? [{
                        id: 'legacy', start: data.checkIn, checkIn: data.checkIn,
                        checkOut: data.checkOut || null
                    }] : [];
                }
                data.sessions.forEach((session, sessionIndex) => {
                    if (!session?.checkOut && !session?.isAbsent && (session?.checkIn || session?.start)) {
                        openCandidates.push({
                            ref: candidates[candidateIndex].ref,
                            key: candidates[candidateIndex].key,
                            data,
                            sessionIndex,
                            startedAt: new Date(session.checkIn || session.start).getTime()
                        });
                    }
                });
            });
            openCandidates.sort((left, right) => right.startedAt - left.startedAt);
            const selected = openCandidates[0];
            if (!selected) throw new Error("Bạn chưa vào ca hoặc đã ra ca rồi!");
            if (!Number.isFinite(selected.startedAt) || now.getTime() < selected.startedAt) {
                throw new Error('Giờ Ra ca không thể sớm hơn giờ Vào ca.');
            }

            const { data, sessionIndex: openSessionIndex } = selected;
            anchorDateKey = selected.key;

            // Close session
            data.sessions[openSessionIndex].checkOut = now.toISOString();
            data.sessions[openSessionIndex].status = 'closed';
            data.sessions[openSessionIndex].anchorDateKey = data.sessions[openSessionIndex].anchorDateKey || selected.key;

            // Sync top level
            data.checkOut = now.toISOString();
            data.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();

            t.set(selected.ref, data);
        });
        DBService._invalidateAttendance(anchorDateKey, userId);
        if (anchorDateKey !== dateKey) DBService._invalidateAttendance(dateKey, userId);
    },

    // 7.1 Manual Add (Admin) — nhận giờ dạng "HH:mm".
    // Đi qua addSession để dùng CHUNG hàng rào chặn ca trùng giờ; trước đây hàm này tự
    // push thẳng nên là một cửa hậu tạo ca trùng (hiện chưa nơi nào gọi, nhưng để nguyên
    // thì lần sau ai nối vào là lại sinh lương đôi).
    addManualSession: async (userId, dateKey, checkInTime, checkOutTime, options = {}) => {
        const startDate = getVietnamDateFromHM(dateKey, checkInTime);
        let endDate = checkOutTime ? getVietnamDateFromHM(dateKey, checkOutTime) : null;
        if (!startDate) throw new Error('Giờ vào không hợp lệ.');
        if (endDate && endDate <= startDate) endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
        const startISO = startDate.toISOString();
        const endISO = endDate ? endDate.toISOString() : null;
        return DBService.addSession(userId, dateKey, {
            start: startISO,
            checkIn: startISO,
            checkOut: endISO,
            type: 'manual'
        }, options);
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

                // A manual time correction must not silently detach a session
                // from its scheduled class/shift.  Older callers do not send
                // link fields, so clearing them made a correctly linked 8h
                // shift appear as only its unmatched remainder on payroll.
                const session = data.sessions[index];
                const before = {
                    checkIn: session.checkIn || session.start || null,
                    checkOut: session.checkOut || null,
                    role: session.role || null,
                    linkedClassStart: session.linkedClassStart || null,
                    linkedReceptionistShift: session.linkedReceptionistShift || null,
                    linkedOfficeShift: session.linkedOfficeShift || null,
                    isAbsent: !!session.isAbsent
                };
                const hasOwn = (key) => Object.prototype.hasOwnProperty.call(newData || {}, key);
                const patch = Object.assign({}, newData || {});
                const clearScheduleLinks = patch.clearScheduleLinks === true;
                const editMeta = patch.editMeta || {};
                delete patch.clearScheduleLinks;
                delete patch.editMeta;

                ['role', 'roleName', 'roleRate', 'isFixedShift'].forEach((key) => {
                    if (hasOwn(key)) session[key] = patch[key];
                });

                const hasClassLink = hasOwn('linkedClassStart');
                const hasReceptionistLink = hasOwn('linkedReceptionistShift');
                const hasOfficeLink = hasOwn('linkedOfficeShift');
                if (clearScheduleLinks) {
                    delete session.linkedClassStart;
                    delete session.linkedReceptionistShift;
                    delete session.linkedOfficeShift;
                } else if (hasClassLink) {
                    if (patch.linkedClassStart) session.linkedClassStart = patch.linkedClassStart;
                    else delete session.linkedClassStart;
                    delete session.linkedReceptionistShift;
                    delete session.linkedOfficeShift;
                } else if (hasReceptionistLink) {
                    if (patch.linkedReceptionistShift) session.linkedReceptionistShift = patch.linkedReceptionistShift;
                    else delete session.linkedReceptionistShift;
                    delete session.linkedClassStart;
                    delete session.linkedOfficeShift;
                } else if (hasOfficeLink) {
                    if (patch.linkedOfficeShift) session.linkedOfficeShift = patch.linkedOfficeShift;
                    else delete session.linkedOfficeShift;
                    delete session.linkedClassStart;
                    delete session.linkedReceptionistShift;
                }

                // QUAN TRỌNG: admin đã sửa giờ tay -> bỏ cờ auto-close.
                // Nếu giữ cờ này, khối auto-close (report.js) sẽ coi ca vẫn "quên ra ca"
                // và GHI ĐÈ giờ ra của admin về giờ tan ca/23:59 ở lần tải trang sau.
                delete session.autoClosedReason;

                // Merge ordinary fields after protected role/link fields.
                Object.keys(patch).forEach((key) => {
                    if (['role', 'roleName', 'roleRate', 'isFixedShift', 'linkedClassStart', 'linkedReceptionistShift', 'linkedOfficeShift'].includes(key)) return;
                    session[key] = patch[key];
                });

                if (newData.checkIn) {
                    session.start = newData.checkIn; // Sync legacy
                }

                // Sync top level if this is the last session
                if (index === data.sessions.length - 1) {
                    data.checkIn = session.checkIn;
                    data.checkOut = session.checkOut;
                }

                // Keep a compact audit trail with this attendance session. It
                // supports investigation even before paid cloud backups exist.
                const after = {
                    checkIn: session.checkIn || session.start || null,
                    checkOut: session.checkOut || null,
                    role: session.role || null,
                    linkedClassStart: session.linkedClassStart || null,
                    linkedReceptionistShift: session.linkedReceptionistShift || null,
                    linkedOfficeShift: session.linkedOfficeShift || null,
                    isAbsent: !!session.isAbsent
                };
                const history = Array.isArray(session.editHistory) ? session.editHistory.slice(-19) : [];
                history.push({
                    at: new Date().toISOString(),
                    action: 'manual_edit',
                    source: editMeta.source || 'report',
                    editor: editMeta.editor || null,
                    before: before,
                    after: after
                });
                session.editHistory = history;

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
                // This API is reached from a deliberate role choice. Keep a
                // source marker so evaluation never mistakes a historical
                // auto-inferred role for an approved outside-schedule shift.
                session.roleAssignmentSource = 'manual';
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
                    ...sessionData,
                    id: createAttendanceSessionId(),
                    anchorDateKey: dateKey,
                    status: sessionData.checkOut ? 'closed' : 'open',
                    source: sessionData.type || 'admin',
                    start: newStart,
                    checkIn: sessionData.checkIn,
                    checkOut: sessionData.checkOut || null,
                    type: sessionData.type || 'admin_add'
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

    // Trường BẮT BUỘC của một yêu cầu chấm bù. Trả về danh sách phần còn THIẾU (rỗng = đủ).
    // Dùng ở CẢ 2 phía: nhân viên gửi (cham-bu.html) và quản lý duyệt (tuong-trinh.html) —
    // một nguồn duy nhất nên hai bên không bao giờ hiểu khác nhau về "thế nào là đủ".
    // Quy tắc GĐ: thiếu cơ sở / môn-lớp / người phân công thì quản lý không có căn cứ duyệt
    // và Bảng Công cũng không áp được đơn giá → không cho gửi, không cho duyệt.
    missingMakeupFields: (r) => {
        const req = r || {};
        const s = req.session || {};
        const missing = [];
        const isTT = ['tiep-tan', 'van-phong', 'office_staff'].includes(s.role) || ['tt', 'vp'].includes(req.shiftKind);
        if (!req.dateKey) missing.push('ngày');
        if (!req.branch) missing.push('cơ sở');
        if (req.type !== 'scheduled') {
            if (!isTT && !req.className) missing.push('môn/lớp');
            if (isTT && !req.shiftKey) missing.push('ca trực');
            if (!req.approvedBy) missing.push('người phân công');
        }
        if (!s.isAbsent && (!s.checkIn || !s.checkOut)) missing.push('giờ vào/ra');
        if (!String(req.reason || '').trim()) missing.push('lý do');
        return missing;
    },

    createMakeupRequests: async (requests) => {
        // Chặn ngay ở tầng dữ liệu, không chỉ ở giao diện: đơn thiếu trường vào được DB là
        // quản lý phải xử lý tay từng cái, và có nguy cơ duyệt một ca không tính được lương.
        const list = Array.isArray(requests) ? requests : [];
        if (list.length === 0) throw new Error('Không có yêu cầu nào để gửi.');
        for (const r of list) {
            const missing = DBService.missingMakeupFields(r);
            if (missing.length) {
                const err = new Error('Yêu cầu chấm bù còn thiếu: ' + missing.join(', ') + '. Vui lòng khai đủ rồi gửi lại.');
                err.code = 'MAKEUP_MISSING_FIELDS';
                err.missing = missing;
                throw err;
            }
        }
        const batchId = `mk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const batch = db.batch();
        list.forEach(r => {
            const ref = db.collection('makeup_requests').doc();
            batch.set(ref, { ...r, batchId, status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        });
        await batch.commit();
        return { batchId, count: list.length };
    },

    getMyMakeupRequests: async (staffId) => {
        try {
            const snap = await db.collection('makeup_requests').where('staffId', '==', staffId).limit(100).get();
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            list.sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0));
            return list;
        } catch (e) { console.error('[Makeup] get mine:', e); return []; }
    },

    // Trang Tường Trình lọc/sắp xếp ở phía client nên trần đọc CHÍNH LÀ trần dữ liệu.
    // Trả kèm _truncated để giao diện nói thật là "còn nữa", không im lặng cắt bớt.
    MAKEUP_FETCH_LIMIT: 500,
    getMakeupRequestsByStatus: async (status) => {
        try {
            const cap = DBService.MAKEUP_FETCH_LIMIT;
            const snap = await db.collection('makeup_requests').where('status', '==', status).limit(cap).get();
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            list.sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0));
            list._truncated = list.length >= cap;
            return list;
        } catch (e) { console.error('[Makeup] get by status:', e); return []; }
    },

    // Quản lý BỔ SUNG thông tin cho đơn cũ bị thiếu trường (đơn gửi trước khi có ràng buộc).
    // Chỉ cho sửa đúng những trường mô tả ca — không cho đụng vào status/staffId/giờ đã khai.
    updateMakeupRequest: async (reqId, patch, adminName) => {
        if (!reqId) throw new Error('Thiếu mã yêu cầu.');
        const allowed = ['branch', 'className', 'classId', 'room', 'shiftKey', 'approvedBy', 'shiftLabel', 'reason'];
        const data = {};
        allowed.forEach(k => {
            if (patch && patch[k] !== undefined && patch[k] !== null) data[k] = patch[k];
        });
        if (Object.keys(data).length === 0) throw new Error('Không có gì để cập nhật.');
        data.completedBy = adminName || 'Admin';
        data.completedAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('makeup_requests').doc(reqId).update(data);
    },

    // options.allowOverlap = true → quản lý đã xem cảnh báo "đã có công trùng giờ" và
    // vẫn quyết định duyệt. Mặc định chặn để một lần bấm nhầm không thành lương đôi.
    //
    // options.payoutMonth = 'YYYY-MM' → THÁNG TRẢ LƯƠNG cho ca này (quy định của GĐ Diễm
    // 06/08/2026): lỗi bên trung tâm (mất mạng, mất điện) thì trả ngay trong tháng dạy;
    // nhân viên quên chấm công thì trả vào tháng sau. Ca vẫn nằm nguyên ở THÁNG DẠY —
    // giờ công, đơn giá, Bảng Công đều không đổi — chỉ có tiền là dồn sang tháng được
    // chọn. Bỏ trống = trả trong tháng dạy (mặc định như trước nay).
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
        if (s.linkedOfficeShift) sessionData.linkedOfficeShift = s.linkedOfficeShift;
        else if (req.shiftKind === 'vp' && req.shiftKey) sessionData.linkedOfficeShift = req.shiftKey;
        else if (s.linkedReceptionistShift) sessionData.linkedReceptionistShift = s.linkedReceptionistShift;
        else if (req.shiftKind === 'tt' && req.shiftKey) sessionData.linkedReceptionistShift = req.shiftKey;
        else if (req.shiftStart) sessionData.linkedClassStart = req.shiftStart;
        if (req.branch) sessionData.branch = req.branch;
        if (req.className) sessionData.className = req.className;
        if (req.room) sessionData.room = req.room;

        // Chỉ ghi payoutMonth khi KHÁC tháng dạy — ca trả đúng tháng thì không cần đánh dấu
        const teachMonth = String(req.dateKey || '').slice(0, 7);
        if (options.payoutMonth && teachMonth && options.payoutMonth !== teachMonth) {
            sessionData.payoutMonth = options.payoutMonth;
            sessionData.payoutDeferredFrom = teachMonth;
            if (options.payoutReason) sessionData.payoutReason = options.payoutReason;
        }
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

                // Find the open session by ID. A previous version could have
                // auto-closed the session at the end of the receptionist shift
                // before discovering a directly-connected teaching shift. In
                // that case allow a later, safer end time to extend only the
                // system-generated stale close; never touch a user/admin close.
                const idx = data.sessions.findIndex(s =>
                    String(s.id) === String(sessionId) &&
                    !s.isAdminEdited &&
                    (!s.checkOut || s.autoClosedReason === 'stale_session')
                );
                if (idx === -1) return false; // Already closed or not found

                // Dùng giờ kết thúc lịch nếu được truyền vào, fallback 23:59
                const endOfDayISO = correctEndISO || new Date(`${dateKey}T23:59:00`).toISOString();
                const currentEnd = data.sessions[idx].checkOut ? new Date(data.sessions[idx].checkOut) : null;
                const nextEnd = new Date(endOfDayISO);
                // Không rút ngắn một giờ đóng tự động đã có; chỉ mở rộng khi
                // chuỗi ca liên tiếp chứng minh mốc kết thúc muộn hơn.
                if (currentEnd && !isNaN(currentEnd.getTime()) &&
                    (!isNaN(nextEnd.getTime()) && nextEnd <= currentEnd)) {
                    return false;
                }
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
                throw e;
            }
        })();

        const guardedPromise = promise.catch(error => {
            DBService._invalidate(cacheKey);
            throw error;
        });
        DBService._cache[cacheKey] = guardedPromise;
        return guardedPromise;
    },

    // Cùng schema tuần với lịch tiếp tân nhưng tách collection để mọi thao tác
    // xếp/xóa lịch văn phòng không thể ảnh hưởng lịch tiếp tân hiện hữu.
    async getOfficeSchedule(compositeKey) {
        const cacheKey = `office_schedule_${compositeKey}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const doc = await db.collection('office_schedules').doc(compositeKey).get();
                return doc.exists ? doc.data() : null;
            } catch (e) {
                console.error('[OfficeSchedule] Error getting:', e);
                throw e;
            }
        })();

        const guardedPromise = promise.catch(error => {
            DBService._invalidate(cacheKey);
            throw error;
        });
        DBService._cache[cacheKey] = guardedPromise;
        return guardedPromise;
    },

    // Read the weekly receptionist roster back into concrete daily shifts for
    // a month.  Payroll history needs the exact same source as the current
    // month view; it must never infer a receptionist shift from an attendance
    // session or write anything while loading a historical payslip.
    getMonthlyReceptionistShifts: async (monthStr, staffId) => {
        if (!monthStr || !staffId) return [];

        const cacheKey = `monthly_operational_shifts_${monthStr}_${staffId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            try {
                const [yearStr, monthNumStr] = String(monthStr).split('-');
                const year = Number.parseInt(yearStr, 10);
                const month = Number.parseInt(monthNumStr, 10) - 1;
                if (!Number.isInteger(year) || month < 0 || month > 11) return [];

                const branches = ['cs1', 'cs2', 'cs3'];
                const shiftKeys = ['morning', 'afternoon', 'evening'];
                const shiftLabels = { morning: 'SÁNG', afternoon: 'CHIỀU', evening: 'TỐI' };
                const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const pad = value => String(value).padStart(2, '0');
                const dateKeyOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
                const getMonday = date => {
                    const monday = new Date(date);
                    const weekday = monday.getDay();
                    monday.setDate(monday.getDate() - weekday + (weekday === 0 ? -6 : 1));
                    monday.setHours(0, 0, 0, 0);
                    return monday;
                };

                const monthDays = Array.from({ length: daysInMonth }, (_, index) => new Date(year, month, index + 1));
                const mondayKeys = [...new Set(monthDays.map(day => dateKeyOf(getMonday(day))))];
                const [shiftConfigs, officeShiftConfigs, rosterRows] = await Promise.all([
                    Promise.all(branches.map(branch => DBService.getReceptionistShiftConfig(branch))),
                    Promise.all(branches.map(branch => DBService.getOfficeShiftConfig(branch))),
                    Promise.all(branches.flatMap(branch => mondayKeys.map(mondayKey =>
                        Promise.all([
                            DBService.getReceptionistSchedule(`${branch}__${mondayKey}`).then(data => ({
                                branch,
                                mondayKey,
                                scheduleType: 'receptionist',
                                documentKey: `${branch}__${mondayKey}`,
                                data: data || {}
                            })),
                            DBService.getOfficeSchedule(`${branch}__${mondayKey}`).then(data => ({
                                branch,
                                mondayKey,
                                scheduleType: 'office',
                                documentKey: `${branch}__${mondayKey}`,
                                data: data || {}
                            }))
                        ])
                    )))
                ]);
                const shiftConfigByBranch = Object.fromEntries(branches.map((branch, index) => [branch, shiftConfigs[index] || {}]));
                const officeShiftConfigByBranch = Object.fromEntries(branches.map((branch, index) => [branch, officeShiftConfigs[index] || {}]));
                const flatRosterRows = rosterRows.flat();
                const shiftsByDate = {};

                monthDays.forEach(day => {
                    const dateKey = dateKeyOf(day);
                    const mondayKey = dateKeyOf(getMonday(day));
                    const dayIndex = day.getDay() === 0 ? 6 : day.getDay() - 1;
                    const dayKey = dayKeys[dayIndex];

                    flatRosterRows.forEach(roster => {
                        if (roster.mondayKey !== mondayKey) return;

                        shiftKeys.forEach(shiftKey => {
                            const staffList = roster.data?.[shiftKey]?.[dayKey];
                            if (!Array.isArray(staffList)) return;

                            const staffEntry = staffList.find(entry => String(entry?.id || '') === String(staffId));
                            if (!staffEntry) return;

                            const branchConfig = roster.scheduleType === 'office'
                                ? (officeShiftConfigByBranch[roster.branch] || {})
                                : (shiftConfigByBranch[roster.branch] || {});
                            const weekConfig = roster.data?._shiftConfig?.[shiftKey] || {};
                            const defaultStart = staffEntry.customStart || weekConfig.start || branchConfig[shiftKey]?.start || '07:00';
                            const defaultEnd = staffEntry.customEnd || weekConfig.end || branchConfig[shiftKey]?.end || '11:30';
                            if (!shiftsByDate[dateKey]) shiftsByDate[dateKey] = [];
                            shiftsByDate[dateKey].push({
                                shift: shiftKey,
                                label: shiftLabels[shiftKey],
                                start: staffEntry.customStart || defaultStart,
                                end: staffEntry.customEnd || defaultEnd,
                                branch: roster.branch,
                                scheduleType: roster.scheduleType,
                                documentKey: roster.documentKey,
                                cancelCompositeKey: roster.scheduleType === 'office'
                                    ? `office_${roster.branch}_${mondayKey}`
                                    : `${roster.branch}_${mondayKey}`,
                                isFixedShift: staffEntry.isFixedShift === true
                            });
                        });
                    });
                });

                return Object.keys(shiftsByDate)
                    .sort()
                    .map(id => ({ id, shifts: shiftsByDate[id] }));
            } catch (error) {
                console.error('[ReceptionistSchedule] Error getting monthly roster:', error);
                return [];
            }
        })();

        DBService._cache[cacheKey] = promise;
        return promise;
    },

    async saveReceptionistSchedule(compositeKey, data, expectedRevision = null) {
        try {
            const ref = db.collection('receptionist_schedules').doc(compositeKey);
            let revision = 0;
            await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);
                const currentRevision = snapshot.exists && Number.isInteger(snapshot.data()?._revision)
                    ? snapshot.data()._revision
                    : 0;
                if (Number.isInteger(expectedRevision) && currentRevision !== expectedRevision) {
                    const conflict = new Error('Lịch tiếp tân đã thay đổi kể từ khi bạn mở trang.');
                    conflict.code = 'SCHEDULE_CONFLICT';
                    throw conflict;
                }
                revision = currentRevision + 1;
                transaction.set(ref, {
                    ...data,
                    _revision: revision,
                    _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    _updatedBy: localStorage.getItem('currentUserId') || null
                });
            });
            DBService._invalidate(`receptionist_schedule_${compositeKey}`);
            return { revision };
        } catch (e) {
            console.error('[ReceptionistSchedule] Error saving:', e);
            throw e;
        }
    },

    async saveOfficeSchedule(compositeKey, data, expectedRevision = null) {
        try {
            const ref = db.collection('office_schedules').doc(compositeKey);
            let revision = 0;
            await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);
                const currentRevision = snapshot.exists && Number.isInteger(snapshot.data()?._revision)
                    ? snapshot.data()._revision
                    : 0;
                if (Number.isInteger(expectedRevision) && currentRevision !== expectedRevision) {
                    const conflict = new Error('Lịch văn phòng đã thay đổi kể từ khi bạn mở trang.');
                    conflict.code = 'SCHEDULE_CONFLICT';
                    throw conflict;
                }
                revision = currentRevision + 1;
                transaction.set(ref, {
                    ...data,
                    _revision: revision,
                    _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    _updatedBy: localStorage.getItem('currentUserId') || null
                });
            });
            DBService._invalidate(`office_schedule_${compositeKey}`);
            return { revision };
        } catch (e) {
            console.error('[OfficeSchedule] Error saving:', e);
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
                    const currentRevision = Number.isInteger(data._revision) ? data._revision : 0;
                    t.update(docRef, {
                        [shiftKey]: data[shiftKey],
                        _revision: currentRevision + 1,
                        _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        _updatedBy: localStorage.getItem('currentUserId') || null
                    });
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

    async unassignOfficeStaff(compositeKey, shiftKey, dayKey, staffId) {
        try {
            const result = await db.runTransaction(async (transaction) => {
                const docRef = db.collection('office_schedules').doc(compositeKey);
                const doc = await transaction.get(docRef);
                if (!doc.exists) return false;

                const data = doc.data();
                if (!data[shiftKey] || !Array.isArray(data[shiftKey][dayKey])) return false;

                const originalLength = data[shiftKey][dayKey].length;
                data[shiftKey][dayKey] = data[shiftKey][dayKey]
                    .filter(staff => String(staff?.id || '') !== String(staffId));
                if (data[shiftKey][dayKey].length === originalLength) return false;

                const currentRevision = Number.isInteger(data._revision) ? data._revision : 0;
                transaction.update(docRef, {
                    [shiftKey]: data[shiftKey],
                    _revision: currentRevision + 1,
                    _updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    _updatedBy: localStorage.getItem('currentUserId') || null
                });
                return true;
            });
            DBService._invalidate(`office_schedule_${compositeKey}`);
            return result;
        } catch (e) {
            console.error('[OfficeSchedule] Error unassigning:', e);
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

    // Cấu hình ca văn phòng dùng cùng cấu trúc với tiếp tân nhưng có namespace
    // riêng để thay đổi giờ văn phòng không ảnh hưởng lịch tiếp tân hiện hữu.
    async getOfficeShiftConfig(branch) {
        const cacheKey = `office_config_${branch || 'global'}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = (async () => {
            const defaults = {
                morning: { start: '07:00', end: '11:30' },
                afternoon: { start: '14:00', end: '18:00' },
                evening: { start: '17:30', end: '21:30' }
            };
            try {
                const settings = await this.getSystemSettings();
                if (branch) {
                    const branchKey = `officeShifts_${branch}`;
                    if (settings?.[branchKey]) return settings[branchKey];
                }
                return settings?.officeShifts || defaults;
            } catch (e) {
                console.warn('[OfficeSchedule] Using default shift config');
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

    async getShiftObservationsForDate(dateKey, staffId = '') {
        if (!dateKey) return [];
        try {
            // Firestore authorizes queries from their constraints, not from a
            // client-side filter after downloading the result. Staff-facing
            // callers therefore pass staffId so the query proves ownership;
            // oversight screens omit it and are authorized by their role map.
            let query = db.collection('shift_observations')
                .where('dateKey', '==', dateKey);
            if (staffId) query = query.where('teacherId', '==', staffId);
            const snap = await query.get();
            return snap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(item => !staffId || item.teacherId === staffId)
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
    async getDailyNotes(staffId, options = {}) {
        if (!staffId || staffId.trim() === '') {
            console.warn('[DailyNotes] staffId is empty, skipping.');
            return {};
        }
        const cacheKey = `daily_notes_${staffId}`;
        if (DBService._cache[cacheKey]) return DBService._cache[cacheKey];

        const promise = db.collection('daily_notes').doc(staffId).get()
            .then(doc => doc.exists ? doc.data() : {});

        DBService._cache[cacheKey] = promise;
        try {
            return await promise;
        } catch (e) {
            DBService._invalidate(cacheKey);
            console.error('[DailyNotes] Error getting:', e);
            if (options.strict === true) throw e;
            return {};
        }
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

    // ================= PAYROLL AUTOMATION PROFILES =================
    // Kept separate from users.salary_config and salary_settings_monthly so a
    // future automation rollout cannot overwrite a legacy rate or payslip.
    async getStaffPayrollProfile(staffId) {
        if (!staffId || String(staffId).trim() === '') return { exists: false };
        try {
            const doc = await db.collection('staff_payroll_profiles').doc(staffId).get();
            return doc.exists ? Object.assign({ exists: true }, doc.data()) : { exists: false };
        } catch (e) {
            console.error('[PayrollProfile] Error getting:', e);
            throw e;
        }
    },

    async saveStaffPayrollProfile(staffId, profile) {
        if (!staffId || String(staffId).trim() === '') {
            throw new Error('[PayrollProfile] staffId is required.');
        }
        const payload = Object.assign({}, profile || {}, {
            staffId: staffId,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await db.collection('staff_payroll_profiles').doc(staffId).set(payload, { merge: true });
        return true;
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

    // Pure lifecycle adapters are public so report.js and regression tests use
    // exactly the same legacy-compatible transition contract.
    getPayslipLifecycleState(published = {}) {
        return _getPayslipLifecycleState(published);
    },

    getPayslipPaymentBreakdown(published = {}) {
        return _getPayslipPaymentBreakdown(published);
    },

    getPayslipDraftLockState(published = {}, component = 'gv') {
        return _getPayslipDraftLockState(published, component);
    },

    preparePayslipDraftUpdate(currentPublished = {}, calculatedPublished = {}, component = 'gv', nowIso) {
        return _preparePayslipDraftUpdate(currentPublished, calculatedPublished, component, nowIso);
    },

    preparePayslipComponentPublish(published = {}, targets = {}, nowIso) {
        return _preparePayslipComponentPublish(published, targets, nowIso);
    },

    // Save a calculated draft against the latest Firestore state. This closes
    // the race where a stale report tab recalculated while another tab published
    // or confirmed the same component.
    async savePayslipDraft(staffId, monthStr, calculatedPublished, component = 'gv') {
        if (!staffId || !monthStr) {
            throw new Error('[SavePayslipDraft] staffId and monthStr are required.');
        }
        const docId = `${monthStr}_${staffId}`;
        const docRef = db.collection('salary_settings_monthly').doc(docId);
        let transition = null;

        try {
            await db.runTransaction(async transaction => {
                const docSnap = await transaction.get(docRef);
                const currentPublished = docSnap.exists ? (docSnap.data().published || {}) : {};
                transition = _preparePayslipDraftUpdate(
                    currentPublished,
                    calculatedPublished || {},
                    component
                );
                if (!transition.saved) return;

                if (docSnap.exists) {
                    transaction.update(docRef, { published: transition.published });
                } else {
                    transaction.set(docRef, { published: transition.published }, { merge: true });
                }
            });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return {
                ...transition,
                status: transition.saved ? 'draft_saved' : 'locked'
            };
        } catch (e) {
            console.error('[SavePayslipDraft] Error saving:', e);
            throw e;
        }
    },

    // Update exactly one calendar day. This avoids read-modify-write data loss
    // when two tabs edit different notes concurrently or a prior read failed.
    async updateDailyNote(staffId, dateKey, note) {
        if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) {
            throw new Error('Thiếu nhân sự hoặc ngày ghi chú hợp lệ.');
        }
        const normalizedNote = String(note || '').trim().slice(0, 2000);
        const ref = db.collection('daily_notes').doc(staffId);
        try {
            await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);
                if (normalizedNote) {
                    transaction.set(ref, { [dateKey]: normalizedNote }, { merge: true });
                } else if (snapshot.exists) {
                    transaction.update(ref, {
                        [dateKey]: firebase.firestore.FieldValue.delete()
                    });
                }
            });
            DBService._invalidate(`daily_notes_${staffId}`);
            return normalizedNote;
        } catch (e) {
            console.error('[DailyNotes] Error updating one day:', e);
            throw e;
        }
    },

    // Publish selected components from the current stored calculation. Used by
    // bulk publish so a stale modal cannot lower `received` back to `published`.
    async publishPayslipComponents(staffId, monthStr, targets = {}, message = '') {
        if (!staffId || !monthStr) {
            throw new Error('[PublishPayslipComponents] staffId and monthStr are required.');
        }
        const docId = `${monthStr}_${staffId}`;
        const docRef = db.collection('salary_settings_monthly').doc(docId);
        const nowIso = new Date().toISOString();
        let transition = null;

        try {
            await db.runTransaction(async transaction => {
                const docSnap = await transaction.get(docRef);
                const currentPublished = docSnap.exists ? (docSnap.data().published || {}) : {};
                transition = _preparePayslipComponentPublish(currentPublished, targets, nowIso);
                if (String(message || '').trim() && transition.publishedComponents.length > 0) {
                    transition.published.message = String(message).trim();
                }
                if (transition.publishedComponents.length === 0) return;

                if (docSnap.exists) {
                    transaction.update(docRef, { published: transition.published });
                } else {
                    transaction.set(docRef, { published: transition.published }, { merge: true });
                }
            });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return {
                ok: transition.publishedComponents.length > 0 || transition.lockedComponents.length > 0,
                status: transition.state.overallStatus,
                publishedComponents: transition.publishedComponents,
                lockedComponents: transition.lockedComponents,
                skippedComponents: transition.skippedComponents,
                lifecycle: transition.state
            };
        } catch (e) {
            console.error('[PublishPayslipComponents] Error publishing:', e);
            throw e;
        }
    },

    // Publish salary details to employee. The transaction prevents an older
    // browser tab from overwriting a receipt confirmation made in the meantime.
    async publishSalary(staffId, monthStr, payload) {
        if (!staffId || !monthStr) {
            throw new Error('[PublishSalary] staffId and monthStr are required.');
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            const docRef = db.collection('salary_settings_monthly').doc(docId);
            const nowIso = new Date().toISOString();
            let transition = null;

            await db.runTransaction(async transaction => {
                const docSnap = await transaction.get(docRef);
                const currentPublished = docSnap.exists ? (docSnap.data().published || {}) : {};
                transition = _preparePayslipPublishUpdate(currentPublished, payload || {}, nowIso);

                const requestedComponents = Object.values(transition.targets).filter(Boolean).length;
                if (requestedComponents === 0) {
                    const error = new Error('Không có thành phần bảng lương hợp lệ để gửi.');
                    error.code = 'payslip/no-publishable-component';
                    throw error;
                }
                if (transition.publishedComponents.length === 0
                    && transition.lockedComponents.length === 0) {
                    const error = new Error('Thành phần được chọn chưa có dữ liệu tính lương để gửi.');
                    error.code = 'payslip/no-component-details';
                    throw error;
                }

                if (docSnap.exists) {
                    transaction.update(docRef, { published: transition.published });
                } else {
                    transaction.set(docRef, { published: transition.published }, { merge: true });
                }
            });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return {
                ok: true,
                status: transition.state.overallStatus,
                publishedComponents: transition.publishedComponents,
                lockedComponents: transition.lockedComponents,
                skippedComponents: transition.skippedComponents,
                lifecycle: transition.state
            };
        } catch (e) {
            console.error('[PublishSalary] Error publishing:', e);
            throw e;
        }
    },

    // Confirm only components that are actually published. A dual-role payslip
    // reaches aggregate `received` only after both relevant components do.
    async confirmSalaryReceived(staffId, monthStr, confirmedBy = 'employee', component = 'all') {
        if (!staffId || !monthStr) {
            throw new Error('[ConfirmSalary] staffId and monthStr are required.');
        }
        try {
            const docId = `${monthStr}_${staffId}`;
            const docRef = db.collection('salary_settings_monthly').doc(docId);
            const nowIso = new Date().toISOString();
            let transition = null;

            await db.runTransaction(async transaction => {
                const docSnap = await transaction.get(docRef);
                const currentPublished = docSnap.exists ? (docSnap.data().published || {}) : {};
                transition = _preparePayslipConfirmation(currentPublished, confirmedBy, nowIso, component);

                const receiptRequest = _getPayslipReceiptRequestState(currentPublished, component);
                if (!transition.changed && !receiptRequest.allReceived) {
                    const error = new Error('Bảng lương chưa được gửi nên chưa thể xác nhận đã nhận.');
                    error.code = 'payslip/not-published';
                    throw error;
                }

                if (docSnap.exists) {
                    transaction.update(docRef, { published: transition.published });
                } else {
                    transaction.set(docRef, { published: transition.published }, { merge: true });
                }
            });
            DBService._invalidate(`all_monthly_salary_settings_${monthStr}`);
            return {
                ok: true,
                status: transition.state.overallStatus,
                receivedComponents: transition.receivedComponents,
                changed: transition.changed,
                lifecycle: transition.state
            };
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

    // Shared input bundle for calculateDailyChips(). Chấm Công previously passed only
    // schedule + attendance while Bảng Công also passed cancellations, overtime,
    // receptionist observations and bonus state, producing different chips for one day.
    loadDailyEvaluationContext: async (staffId, dateKey) => {
        if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) {
            throw new Error('Thiếu nhân sự hoặc ngày cần đánh giá.');
        }
        const monthStr = dateKey.slice(0, 7);
        const [cancelledShifts, observations, overtimeRequests, bonusRequests] = await Promise.all([
            DBService.getCancelledShifts(monthStr, staffId),
            DBService.getShiftObservationsForDate(dateKey, staffId),
            DBService.getOvertimeRequestsForStaff(staffId, monthStr),
            DBService.getBonus10RequestsForStaff(staffId, monthStr)
        ]);
        const overtimeMap = {};
        (overtimeRequests || []).filter(item => item.dateKey === dateKey).forEach(item => {
            const key = String(item.sessionId || '');
            if (!key) return;
            const existing = overtimeMap[key];
            if (!existing || item.status === 'approved' || (item.status === 'pending' && existing.status === 'rejected')) {
                overtimeMap[key] = item;
            }
        });
        const bonus10Map = {};
        (bonusRequests || []).forEach(item => {
            const key = String(item.sessionId || '');
            if (!key) return;
            const existing = bonus10Map[key];
            if (!existing || item.status === 'approved' || (item.status === 'pending' && existing.status === 'rejected')) {
                bonus10Map[key] = item;
            }
        });
        return {
            cancelledShifts: cancelledShifts || [],
            shiftObservations: (observations || []).filter(item => !item.teacherId || item.teacherId === staffId),
            overtimeMap,
            bonus10Map,
            monthFlags: {
                early10PenaltyActive: (bonusRequests || []).some(item => item.status === 'rejected')
            }
        };
    },

    restoreCancelledShift: async (monthStr, staffId, shiftKey) => {
        try {
            const docId = `${monthStr}_${staffId}`;
            const result = await db.runTransaction(async transaction => {
                const docRef = db.collection('cancelled_shifts').doc(docId);
                const doc = await transaction.get(docRef);
                if (!doc.exists) return false;

                const data = doc.data() || {};
                const shifts = (Array.isArray(data.shifts) ? data.shifts : [])
                    .filter(key => key !== shiftKey);

                transaction.set(docRef, {
                    userId: staffId,
                    month: monthStr,
                    shifts,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                return true;
            });
            DBService._invalidate(`cancelled_shifts_${monthStr}_${staffId}`);
            return result;
        } catch (error) {
            console.error('[CancelledShifts] Error restoring:', error);
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

    // Hệ thống đã tự xác minh đủ điều kiện (môn cho phép + chế độ cũ/chưa phân loại
    // + chấm công sớm ≥10 phút) nên ghi thẳng trạng thái 'approved'.
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

            // ID ổn định + transaction: hai lần chạm nhanh không thể tạo hai yêu cầu;
            // request và cờ trên attendance luôn cùng thành công hoặc cùng thất bại.
            const normalizedSessionId = String(sessionId);
            const requestId = `auto_${dateKey}_${staffId}_${normalizedSessionId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            const requestRef = db.collection('bonus10_requests').doc(requestId);
            const attendanceRef = db.collection('attendance_logs').doc(`${dateKey}_${staffId}`);

            await db.runTransaction(async transaction => {
                const [requestDoc, attendanceDoc] = await Promise.all([
                    transaction.get(requestRef),
                    transaction.get(attendanceRef)
                ]);
                if (requestDoc.exists) throw new Error('Ca này đã được ghi nhận sớm 10p rồi!');
                if (!attendanceDoc.exists) throw new Error('Không tìm thấy dữ liệu chấm công của ca này.');

                const attendance = attendanceDoc.data() || {};
                const sessions = Array.isArray(attendance.sessions)
                    ? attendance.sessions.map(session => ({ ...session }))
                    : [];
                const index = sessions.findIndex(session => String(session.id) === normalizedSessionId);
                if (index < 0) throw new Error('Không tìm thấy phiên vào/ra tương ứng để cộng 10 phút.');
                sessions[index].bonus10 = true;

                transaction.set(requestRef, {
                    staffId,
                    staffName: staffName || 'N/A',
                    dateKey,
                    sessionId: normalizedSessionId,
                    status: 'approved',
                    autoApproved: true,
                    earlyMinutes: meta?.earlyMinutes ?? null,
                    checkInAt: meta?.checkInLabel ?? null,
                    scheduledStart: meta?.startLabel ?? null,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    approvedBy: 'Hệ thống tự duyệt',
                    approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                transaction.set(attendanceRef, {
                    sessions,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            });

            DBService._invalidate('bonus10_requests_');
            DBService._invalidate(`monthly_attendance_${dateKey.slice(0, 7)}_${staffId}`);
            console.log('[Bonus10] Auto-approved atomically:', requestId);
            return requestId;
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

// PAYSLIP LIFECYCLE HELPERS START
const _PAYSLIP_STATUS_RANK = Object.freeze({ draft: 0, published: 1, received: 2 });

function _normalizePayslipStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(_PAYSLIP_STATUS_RANK, normalized)
        ? normalized
        : 'draft';
}

function _hasExplicitPayslipStatus(published, component) {
    const field = component === 'tt' ? 'status_tt' : 'status_gv';
    const raw = String(published?.[field] || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(_PAYSLIP_STATUS_RANK, raw);
}

function _hasPayslipComponentDetails(published, component) {
    if (!published || typeof published !== 'object') return false;
    const detailField = component === 'tt' ? 'details_tt' : 'details_gv';
    if (published[detailField] !== undefined && published[detailField] !== null) return true;

    const role = String(published.role || '').trim().toLowerCase();
    const isSingleComponentRole = component === 'tt'
        ? ['tiep-tan', 'tiep_tan', 'receptionist'].includes(role)
        : ['giao-vien', 'giao_vien', 'teacher'].includes(role);
    return isSingleComponentRole && published.details !== undefined && published.details !== null;
}

function _derivePayslipOverallStatus(componentStates, fallbackStatus = 'draft') {
    const relevant = [];
    if (componentStates.has_gv) relevant.push(componentStates.status_gv);
    if (componentStates.has_tt) relevant.push(componentStates.status_tt);
    if (relevant.length === 0) return _normalizePayslipStatus(fallbackStatus);
    if (relevant.every(status => status === 'received')) return 'received';
    if (relevant.some(status => status === 'published' || status === 'received')) return 'published';
    return 'draft';
}

function _getPayslipLifecycleState(published = {}) {
    const globalStatus = _normalizePayslipStatus(published.status);
    const explicitGV = _hasExplicitPayslipStatus(published, 'gv');
    const explicitTT = _hasExplicitPayslipStatus(published, 'tt');
    const hasAnyExplicitComponentStatus = explicitGV || explicitTT;
    const hasGVDetails = _hasPayslipComponentDetails(published, 'gv');
    const hasTTDetails = _hasPayslipComponentDetails(published, 'tt');
    let statusGV = explicitGV ? _normalizePayslipStatus(published.status_gv) : 'draft';
    let statusTT = explicitTT ? _normalizePayslipStatus(published.status_tt) : 'draft';

    // Legacy individual publications had only the aggregate status. Once either
    // component status exists, a missing sibling means that sibling is still a
    // draft (the partial bulk-publish contract).
    if (!explicitGV && hasGVDetails && globalStatus !== 'draft' && !hasAnyExplicitComponentStatus) {
        statusGV = globalStatus;
    }
    if (!explicitTT && hasTTDetails && globalStatus !== 'draft' && !hasAnyExplicitComponentStatus) {
        statusTT = globalStatus;
    }

    const hasGV = hasGVDetails || (explicitGV && statusGV !== 'draft');
    const hasTT = hasTTDetails || (explicitTT && statusTT !== 'draft');
    const state = {
        status_gv: statusGV,
        status_tt: statusTT,
        has_gv: hasGV,
        has_tt: hasTT,
        explicit_gv: explicitGV,
        explicit_tt: explicitTT
    };
    state.overallStatus = _derivePayslipOverallStatus(state, globalStatus);
    state.locked_gv = statusGV === 'published' || statusGV === 'received';
    state.locked_tt = statusTT === 'published' || statusTT === 'received';
    return state;
}

function _getPayslipPaymentBreakdown(published = {}) {
    const lifecycle = _getPayslipLifecycleState(published);
    const aggregateValue = Number(published?.netPay);
    const componentSpecs = [];

    if (lifecycle.has_gv) {
        componentSpecs.push({ key: 'gv', status: lifecycle.status_gv, details: published.details_gv });
    }
    if (lifecycle.has_tt) {
        componentSpecs.push({ key: 'tt', status: lifecycle.status_tt, details: published.details_tt });
    }

    // Legacy single-role documents stored their amount in `details` only.
    if (componentSpecs.length === 1 && !componentSpecs[0].details && published.details) {
        componentSpecs[0].details = published.details;
    }

    let knownTotal = 0;
    let paid = 0;
    let unpaid = 0;
    componentSpecs.forEach(component => {
        const value = Number(component.details?.netPay);
        if (!Number.isFinite(value)) return;
        knownTotal += value;
        if (component.status === 'received') paid += value;
        else unpaid += value;
    });

    const total = Number.isFinite(aggregateValue) ? aggregateValue : knownTotal;
    const unallocated = total - knownTotal;
    if (Math.abs(unallocated) > 0.0001) {
        // Malformed/legacy partial documents may not have component amounts.
        // Keep the dashboard conservative: money is unpaid unless every known
        // component is already received.
        const everyComponentReceived = componentSpecs.length > 0
            && componentSpecs.every(component => component.status === 'received');
        if (everyComponentReceived || lifecycle.overallStatus === 'received') paid += unallocated;
        else unpaid += unallocated;
    }

    return { total, paid, unpaid, lifecycle };
}

function _syncPayslipAggregateStatus(published, nowIso) {
    const state = _getPayslipLifecycleState(published);
    published.status = state.overallStatus;
    if (state.overallStatus === 'published' || state.overallStatus === 'received') {
        published.publishedAt = published.publishedAt || nowIso;
    }
    if (state.overallStatus === 'received') {
        published.receivedAt = published.receivedAt || nowIso;
    } else {
        // Component-level receipt metadata remains intact. Aggregate receipt
        // metadata is meaningful only after every relevant component is received.
        delete published.receivedAt;
        delete published.confirmedBy;
    }
    return state;
}

function _preparePayslipComponentPublish(published = {}, targets = {}, nowIso = new Date().toISOString()) {
    const next = { ...published };
    const before = _getPayslipLifecycleState(next);
    const publishedComponents = [];
    const lockedComponents = [];
    const skippedComponents = [];

    if (before.has_gv) next.status_gv = before.status_gv;
    if (before.has_tt) next.status_tt = before.status_tt;

    [['gv', !!targets.gv], ['tt', !!targets.tt]].forEach(([component, requested]) => {
        if (!requested) return;
        if (!_hasPayslipComponentDetails(next, component)) {
            skippedComponents.push(component);
            return;
        }

        const statusField = component === 'tt' ? 'status_tt' : 'status_gv';
        const publishedAtField = component === 'tt' ? 'publishedAt_tt' : 'publishedAt_gv';
        const currentStatus = component === 'tt' ? before.status_tt : before.status_gv;
        if (currentStatus === 'received') {
            next[statusField] = 'received';
            lockedComponents.push(component);
        } else {
            next[statusField] = 'published';
            next[publishedAtField] = next[publishedAtField] || next.publishedAt || nowIso;
            publishedComponents.push(component);
        }
    });

    // A draft sibling is allowed to change while another component is locked,
    // so the aggregate fields deliberately keep the last published snapshot
    // during draft editing. Once that sibling is actually published, rebuild
    // the legacy/dashboard totals from the two component snapshots in the same
    // transaction; otherwise a dual-role payslip can show an old total forever.
    if (publishedComponents.length > 0) {
        _recalculatePayslipScalarTotals(next);
    }

    const state = _syncPayslipAggregateStatus(next, nowIso);
    return { published: next, state, publishedComponents, lockedComponents, skippedComponents };
}

function _recalculatePayslipScalarTotals(published) {
    const details = [published.details_gv, published.details_tt]
        .filter(item => item && typeof item === 'object');
    if (details.length < 2) return published;

    ['netPay', 'baseSalary', 'totalBonus', 'advance'].forEach(field => {
        if (details.every(item => Number.isFinite(Number(item[field])))) {
            published[field] = details.reduce((sum, item) => sum + Number(item[field]), 0);
        }
    });
    return published;
}

function _preparePayslipPublishUpdate(currentPublished = {}, payload = {}, nowIso = new Date().toISOString()) {
    const targets = {
        gv: payload.details_gv !== undefined && payload.details_gv !== null,
        tt: payload.details_tt !== undefined && payload.details_tt !== null
    };
    const role = String(payload.role || '').trim().toLowerCase();
    if (!targets.gv && ['giao-vien', 'giao_vien', 'teacher'].includes(role) && payload.details) targets.gv = true;
    if (!targets.tt && ['tiep-tan', 'tiep_tan', 'receptionist'].includes(role) && payload.details) targets.tt = true;

    const before = _getPayslipLifecycleState(currentPublished);
    const safePayload = { ...payload };
    [
        'status', 'status_gv', 'status_tt',
        'publishedAt', 'publishedAt_gv', 'publishedAt_tt',
        'receivedAt', 'receivedAt_gv', 'receivedAt_tt',
        'confirmedBy', 'confirmedBy_gv', 'confirmedBy_tt'
    ].forEach(field => delete safePayload[field]);

    const requested = [targets.gv ? 'gv' : null, targets.tt ? 'tt' : null].filter(Boolean);
    const allRequestedAlreadyReceived = requested.length > 0 && requested.every(component =>
        component === 'tt' ? before.status_tt === 'received' : before.status_gv === 'received'
    );

    // A received component is an immutable snapshot. A repeated publish remains
    // idempotent and cannot alter its monetary/detail payload.
    const next = allRequestedAlreadyReceived
        ? { ...currentPublished }
        : { ...currentPublished, ...safePayload };
    if (before.status_gv === 'received' && currentPublished.details_gv !== undefined) {
        next.details_gv = currentPublished.details_gv;
    }
    if (before.status_tt === 'received' && currentPublished.details_tt !== undefined) {
        next.details_tt = currentPublished.details_tt;
    }
    if (allRequestedAlreadyReceived && currentPublished.details !== undefined) {
        next.details = currentPublished.details;
    }

    const transition = _preparePayslipComponentPublish(next, targets, nowIso);
    _recalculatePayslipScalarTotals(transition.published);
    transition.state = _getPayslipLifecycleState(transition.published);
    return { ...transition, targets };
}

function _preparePayslipConfirmation(currentPublished = {}, confirmedBy = 'employee', nowIso = new Date().toISOString(), component = 'all') {
    const next = { ...currentPublished };
    const before = _getPayslipLifecycleState(next);
    if (before.has_gv) next.status_gv = before.status_gv;
    if (before.has_tt) next.status_tt = before.status_tt;

    const requestedGV = component === 'all' || component === 'gv';
    const requestedTT = component === 'all' || component === 'tt';
    const receivedComponents = [];

    if (requestedGV && before.has_gv && before.status_gv === 'published') {
        next.status_gv = 'received';
        next.receivedAt_gv = next.receivedAt_gv || nowIso;
        next.confirmedBy_gv = next.confirmedBy_gv || confirmedBy;
        receivedComponents.push('gv');
    }
    if (requestedTT && before.has_tt && before.status_tt === 'published') {
        next.status_tt = 'received';
        next.receivedAt_tt = next.receivedAt_tt || nowIso;
        next.confirmedBy_tt = next.confirmedBy_tt || confirmedBy;
        receivedComponents.push('tt');
    }

    const state = _syncPayslipAggregateStatus(next, nowIso);
    if (state.overallStatus === 'received') {
        next.confirmedBy = next.confirmedBy || confirmedBy;
    }
    return { published: next, state, receivedComponents, changed: receivedComponents.length > 0 };
}

function _getPayslipReceiptRequestState(published = {}, component = 'all') {
    const lifecycle = _getPayslipLifecycleState(published);
    const requestedComponents = [];
    if ((component === 'all' || component === 'gv') && lifecycle.has_gv) requestedComponents.push('gv');
    if ((component === 'all' || component === 'tt') && lifecycle.has_tt) requestedComponents.push('tt');
    const requestedStatuses = requestedComponents.map(item => (
        item === 'tt' ? lifecycle.status_tt : lifecycle.status_gv
    ));
    return {
        lifecycle,
        requestedComponents,
        requestedStatuses,
        allReceived: requestedStatuses.length > 0
            && requestedStatuses.every(status => status === 'received')
    };
}

function _getPayslipDraftLockState(published = {}, component = 'gv') {
    const normalizedComponent = component === 'tt' ? 'tt' : 'gv';
    const lifecycle = _getPayslipLifecycleState(published);
    const status = normalizedComponent === 'tt' ? lifecycle.status_tt : lifecycle.status_gv;
    return {
        component: normalizedComponent,
        status,
        locked: status === 'published' || status === 'received',
        requiresRevision: status === 'published' || status === 'received',
        lifecycle
    };
}

function _preparePayslipDraftUpdate(currentPublished = {}, calculatedPublished = {}, component = 'gv', nowIso = new Date().toISOString()) {
    const lockState = _getPayslipDraftLockState(currentPublished, component);
    if (lockState.locked) {
        return {
            published: { ...currentPublished },
            saved: false,
            locked: true,
            requiresRevision: true,
            component: lockState.component,
            componentStatus: lockState.status,
            lifecycle: lockState.lifecycle
        };
    }

    const before = lockState.lifecycle;
    const next = { ...calculatedPublished };
    const copyOrDelete = (field) => {
        if (currentPublished[field] === undefined) delete next[field];
        else next[field] = currentPublished[field];
    };

    ['gv', 'tt'].forEach(item => {
        const isLocked = item === 'gv' ? before.locked_gv : before.locked_tt;
        const statusField = item === 'gv' ? 'status_gv' : 'status_tt';
        const detailField = item === 'gv' ? 'details_gv' : 'details_tt';
        const publishedAtField = item === 'gv' ? 'publishedAt_gv' : 'publishedAt_tt';
        const receivedAtField = item === 'gv' ? 'receivedAt_gv' : 'receivedAt_tt';
        const confirmedByField = item === 'gv' ? 'confirmedBy_gv' : 'confirmedBy_tt';

        if (isLocked) {
            [statusField, detailField, publishedAtField, receivedAtField, confirmedByField]
                .forEach(copyOrDelete);
            return;
        }

        if (_hasPayslipComponentDetails(next, item)) next[statusField] = 'draft';
        else delete next[statusField];
        delete next[publishedAtField];
        delete next[receivedAtField];
        delete next[confirmedByField];
    });

    const hasLockedSnapshot = before.locked_gv || before.locked_tt;
    if (hasLockedSnapshot) {
        // Aggregate fields are the snapshot shown in legacy dashboards/PDFs.
        // Updating an unlocked sibling draft must not mutate a published amount.
        [
            'netPay', 'baseSalary', 'totalBonus', 'advance', 'penalties',
            'stats', 'breakdown', 'details', 'message', 'publishedAt'
        ].forEach(copyOrDelete);
    } else {
        delete next.publishedAt;
        delete next.receivedAt;
        delete next.confirmedBy;
    }

    const lifecycle = _syncPayslipAggregateStatus(next, nowIso);
    return {
        published: next,
        saved: true,
        locked: false,
        requiresRevision: false,
        component: lockState.component,
        componentStatus: lockState.status,
        preservedPublishedSnapshot: hasLockedSnapshot,
        lifecycle
    };
}
// PAYSLIP LIFECYCLE HELPERS END
