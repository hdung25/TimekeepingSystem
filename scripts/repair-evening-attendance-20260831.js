/**
 * One-off, guarded repair for the scheduled teaching attendance on 2026-08-31.
 *
 * Default mode is a read-only production audit:
 *   node scripts/repair-evening-attendance-20260831.js
 *
 * Mutating modes are explicit and mutually exclusive:
 *   node scripts/repair-evening-attendance-20260831.js --apply
 *   node scripts/repair-evening-attendance-20260831.js --rollback
 *
 * The apply path reads every safety source in one Firestore transaction, then
 * commits one immutable backup plus all attendance updates atomically. It does
 * not change schedules, users, shift observations, requests, or salary data.
 */

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}`;
const DOC_ROOT = `${ROOT}/documents`;
const DOC_NAME_ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const DATE = '2026-08-31';
const MONTH = '2026-08';
const REPAIR_ID = 'evening-attendance-20260831-v1';
const BRANCHES = Object.freeze(['cs1', 'cs2', 'cs3']);
const SECTIONS = Object.freeze(['evening1', 'evening2']);
const EXPECTED = Object.freeze({
    assignmentRecords: 34,
    staffWindows: 27,
    uniqueStaff: 18,
    originalAttendanceDocuments: 9,
    originalSessions: 10,
    relevantCancellations: 0,
    lockedPayslips: 0,
    activeBonusRequests: 0,
    activeOvertimeRequests: 0,
    shiftObservations: 2,
    activeLateObservations: 0
});

// These are pinned after the production dry-run. Apply refuses an unpinned or
// changed manifest even if the aggregate counts still happen to be identical.
const EXPECTED_MANIFEST_SHA256 = 'b4e3ffad984f057315692ad01162cd82b5b681e0a5e901261edea4e0c7df3d4d';
const EXPECTED_SCHEDULE_SHA256 = '53d8751dab5d4b97323944f0f80817b39b2e9b4786584b67471d0353c06b91de';
const EXPECTED_ATTENDANCE_SHA256 = 'a13c03c3e12915676484dff1e56d685013998a86721f1a11846f93d71d42a1b9';
const PINNED_HASH = /^[a-f0-9]{64}$/;

function parseArguments(argv = process.argv.slice(2)) {
    const allowed = new Set(['--apply', '--rollback']);
    const unknown = argv.filter(arg => !allowed.has(arg));
    if (unknown.length) throw new Error(`Tham số không hỗ trợ: ${unknown.join(', ')}`);
    const apply = argv.includes('--apply');
    const rollback = argv.includes('--rollback');
    if (apply && rollback) throw new Error('Chỉ được chọn một trong --apply hoặc --rollback.');
    return { apply, rollback, mode: rollback ? 'rollback' : (apply ? 'apply' : 'dry-run') };
}

function accessToken() {
    const gcloud = 'C:\\Users\\Admin\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1';
    return execFileSync('powershell.exe', ['-NoProfile', '-File', gcloud, 'auth', 'print-access-token'], {
        encoding: 'utf8',
        windowsHide: true
    }).trim();
}

async function request(url, options = {}, optional = false) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken.cached}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    if (optional && response.status === 404) return null;
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
    return text ? JSON.parse(text) : null;
}

function transactionQuery(transaction) {
    return transaction ? `?transaction=${encodeURIComponent(transaction)}` : '';
}

function getDocument(collection, id, optional = false, transaction = null) {
    return request(
        `${DOC_ROOT}/${collection}/${encodeURIComponent(id)}${transactionQuery(transaction)}`,
        {},
        optional
    );
}

async function beginTransaction() {
    const response = await request(`${ROOT}/documents:beginTransaction`, {
        method: 'POST',
        body: JSON.stringify({ options: { readWrite: {} } })
    });
    if (!response?.transaction) throw new Error('Không thể mở Firestore transaction cho repair.');
    return response.transaction;
}

async function abandonTransaction(transaction) {
    if (!transaction) return;
    try {
        await request(`${ROOT}/documents:rollback`, {
            method: 'POST',
            body: JSON.stringify({ transaction })
        });
    } catch (error) {
        console.warn('Không thể đóng transaction sau lỗi:', error.message || error);
    }
}

async function runDateQuery(collectionId, transaction = null) {
    const body = {
        structuredQuery: {
            from: [{ collectionId }],
            where: {
                fieldFilter: {
                    field: { fieldPath: 'dateKey' },
                    op: 'EQUAL',
                    value: { stringValue: DATE }
                }
            }
        },
        ...(transaction ? { transaction } : {})
    };
    const rows = await request(`${ROOT}/documents:runQuery`, {
        method: 'POST',
        body: JSON.stringify(body)
    });
    return (Array.isArray(rows) ? rows : [])
        .map(item => item.document)
        .filter(Boolean);
}

async function runCollectionQuery(collectionId, transaction = null) {
    const body = {
        structuredQuery: { from: [{ collectionId }] },
        ...(transaction ? { transaction } : {})
    };
    const rows = await request(`${ROOT}/documents:runQuery`, {
        method: 'POST',
        body: JSON.stringify(body)
    });
    return (Array.isArray(rows) ? rows : [])
        .map(item => item.document)
        .filter(Boolean);
}

async function runFieldQuery(collectionId, fieldPath, value, transaction = null) {
    const encodedValue = typeof value === 'string' ? { stringValue: value } : encode(value);
    const body = {
        structuredQuery: {
            from: [{ collectionId }],
            where: {
                fieldFilter: {
                    field: { fieldPath },
                    op: 'EQUAL',
                    value: encodedValue
                }
            }
        },
        ...(transaction ? { transaction } : {})
    };
    const rows = await request(`${ROOT}/documents:runQuery`, {
        method: 'POST',
        body: JSON.stringify(body)
    });
    return (Array.isArray(rows) ? rows : []).map(item => item.document).filter(Boolean);
}

function decode(value) {
    if (!value || typeof value !== 'object') return value;
    if ('nullValue' in value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('timestampValue' in value) return value.timestampValue;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
    if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
    return value;
}

function decodeFields(fields) {
    return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]));
}

function encode(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('Không thể mã hóa số không hữu hạn vào Firestore.');
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
    return { mapValue: { fields: encodeFields(value) } };
}

function encodeFields(object) {
    return Object.fromEntries(Object.entries(object || {}).map(([key, value]) => [key, encode(value)]));
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

function sha256(value) {
    return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function attendanceFingerprint(documentIds, documents, includeUpdateTime = true) {
    const byId = new Map((documents || []).map(document => [document.id, document]));
    return sha256((documentIds || []).slice().sort().map(id => {
        const document = byId.get(id) || null;
        return {
            id,
            exists: !!document,
            ...(includeUpdateTime ? { updateTime: document?.updateTime || null } : {}),
            fields: document?.fields || null
        };
    }));
}

function assertOriginalAttendanceFingerprint(hash, allowUnpinned = false) {
    if (!PINNED_HASH.test(EXPECTED_ATTENDANCE_SHA256)) {
        if (!allowUnpinned) {
            throw new Error('Safety gate: fingerprint attendance production chưa được ghim; tuyệt đối không apply.');
        }
        return;
    }
    if (hash !== EXPECTED_ATTENDANCE_SHA256) {
        throw new Error(`Safety gate: attendance đầu vào đã đổi (${hash}).`);
    }
}

function cleanText(value) {
    return String(value == null ? '' : value).trim();
}

function normalizeClock(value) {
    const match = cleanText(value).match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    return match ? `${String(Number(match[1])).padStart(2, '0')}:${match[2]}` : '';
}

function exactScheduleISO(time) {
    const clock = normalizeClock(time);
    if (!clock) throw new Error(`Giờ lịch không hợp lệ: “${time}”.`);
    return `${DATE}T${clock}:00+07:00`;
}

function uniqueBy(values, keyOf) {
    const map = new Map();
    (values || []).forEach(value => {
        const key = keyOf(value);
        if (key && !map.has(key)) map.set(key, value);
    });
    return Array.from(map.values());
}

function normalizedTeacher(raw, fallbackName = '') {
    if (!raw) return null;
    const id = cleanText(raw.id || raw.teacherId || raw.userId);
    const name = cleanText(raw.name || raw.teacherName || raw.username || fallbackName);
    if (!id && !name) return null;
    return { id, name };
}

function mainTeachers(row) {
    const listed = Array.isArray(row?.gvList) ? row.gvList : [];
    const legacy = row && (row.gvId || row.gv) ? [{ id: row.gvId, name: row.gv }] : [];
    return uniqueBy([...listed, ...legacy].map(item => normalizedTeacher(item)).filter(Boolean), item => item.id || `name:${item.name}`);
}

function substituteTeachers(row) {
    const listed = [row?.gvThayTeList, row?.gvThayTheList].filter(Array.isArray).flat();
    const legacy = row && (row.gvThayTeId || row.gvThayTheId || row.gvThayTe || row.gvThayThe)
        ? [{
            id: row.gvThayTeId || row.gvThayTheId,
            name: row.gvThayTe || row.gvThayThe
        }]
        : [];
    return uniqueBy([...listed, ...legacy].map(item => normalizedTeacher(item)).filter(Boolean), item => item.id || `name:${item.name}`);
}

function registeredTeachers(row) {
    return uniqueBy(
        (Array.isArray(row?.registeredTeachers) ? row.registeredTeachers : [])
            .map(item => normalizedTeacher(item))
            .filter(Boolean),
        item => item.id || `name:${item.name}`
    );
}

function absenceRecord(row, teacherId) {
    if (!Array.isArray(row?.teacherAbsences)) return null;
    return row.teacherAbsences.find(item =>
        cleanText(item?.teacherId || item?.id) === cleanText(teacherId)
    ) || null;
}

function isMainTeacherAbsent(row, teacherId, mains, substitutes) {
    if (Array.isArray(row?.teacherAbsences)) {
        const type = cleanText(absenceRecord(row, teacherId)?.type).toUpperCase();
        return type === 'VP' || type === 'VDX';
    }
    if (!substitutes.length) return false;
    if (mains.length !== 1) {
        throw new Error('Safety gate: lịch cũ có nhiều GV chính và GV thay nhưng không có trạng thái nghỉ theo từng người.');
    }
    return mains[0].id === teacherId;
}

function activeWorkersForRow(row) {
    const mains = mainTeachers(row);
    const substitutes = substituteTeachers(row);
    const activeMains = mains.filter(teacher => !isMainTeacherAbsent(row, teacher.id, mains, substitutes));
    const active = uniqueBy(
        [...activeMains, ...substitutes, ...registeredTeachers(row)],
        item => item.id || `name:${item.name}`
    );
    active.forEach(item => {
        if (!item.id) throw new Error(`Safety gate: nhân sự “${item.name || '?'}” trên lịch không có userId.`);
    });
    return active;
}

function decodedScheduleDocument(document, branch) {
    return {
        branch,
        id: `${branch}__${DATE}`,
        name: document?.name || `${DOC_NAME_ROOT}/schedules/${branch}__${DATE}`,
        updateTime: document?.updateTime || null,
        data: document?.fields ? decodeFields(document.fields) : (document?.data || document || {})
    };
}

function scheduleRowSignature(row) {
    return [row?.start, row?.end, row?.lop, row?.phong]
        .map(value => cleanText(value))
        .join('|');
}

function registrationMillis(registration) {
    const parsed = Date.parse(registration?.updatedAt || registration?.createdAt || '');
    return Number.isFinite(parsed) ? parsed : 0;
}

function mergeScheduleRegistrations(schedule, registrations) {
    const merged = { ...(schedule || {}) };
    SECTIONS.forEach(section => {
        if (!Array.isArray(schedule?.[section])) return;
        const sectionRegistrations = (registrations || []).filter(item => item.section === section && item.userId);
        merged[section] = schedule[section].map((row, rowIndex) => {
            const signature = scheduleRowSignature(row);
            const matching = sectionRegistrations.filter(registration => {
                const shiftMatches = registration.shiftId && row?.shiftId && registration.shiftId === row.shiftId;
                const legacyMatches = cleanText(registration.rowSignature) === signature &&
                    (!Number.isInteger(registration.rowIndex) || registration.rowIndex === rowIndex);
                return shiftMatches || legacyMatches;
            });
            const latestByUser = new Map();
            matching.forEach(registration => {
                const previous = latestByUser.get(registration.userId);
                if (!previous || registrationMillis(registration) >= registrationMillis(previous)) {
                    latestByUser.set(registration.userId, registration);
                }
            });
            const byUser = new Map((row.registeredTeachers || []).map(item => [cleanText(item.id), item]));
            latestByUser.forEach(registration => {
                if (cleanText(registration.status).toLowerCase() === 'active') {
                    byUser.set(registration.userId, {
                        id: registration.userId,
                        name: cleanText(registration.userName || registration.name)
                    });
                } else {
                    byUser.delete(registration.userId);
                }
            });
            return { ...row, registeredTeachers: Array.from(byUser.values()).filter(item => item.id) };
        });
    });
    return merged;
}

function sanitizeInheritedSchedule(data) {
    const sanitized = JSON.parse(JSON.stringify(data || {}));
    Object.keys(sanitized).forEach(key => {
        if (!Array.isArray(sanitized[key])) return;
        sanitized[key] = sanitized[key].map(row => {
            const next = { ...row, registeredTeachers: [], shiftId: '' };
            delete next.isClosed;
            next.gvThayThe = '';
            next.gvThayTheId = '';
            next.gvThayTheList = [];
            next.gvThayTe = '';
            next.gvThayTeId = '';
            next.gvThayTeList = [];
            delete next.gvThayTheAt;
            delete next.teacherAbsences;
            delete next.teacherAbsenceHistory;
            delete next.staffingUpdatedAt;
            delete next.staffingUpdatedById;
            delete next.staffingUpdatedByName;
            next.staffingSchemaVersion = 2;
            next.teacherAbsences = [];
            next.teacherAbsenceHistory = [];
            return next;
        });
    });
    return sanitized;
}

function manifestScheduleIds(manifest, branch) {
    const data = manifest?.fields ? decodeFields(manifest.fields) : (manifest?.data || manifest || {});
    // 2026-08-31 is Monday (getDay() === 1).
    const values = Array.isArray(data['1']) ? data['1'] : [];
    return values.map(value => cleanText(value)).filter(id => {
        const dateKey = id.includes('__') ? id.split('__').slice(1).join('__') : id;
        const idBranch = id.includes('__') ? id.split('__')[0] : 'cs1';
        return idBranch === branch && dateKey < DATE;
    }).sort().reverse();
}

async function resolveScheduleDocuments(rawDirect, transaction = null) {
    const resolved = [];
    for (let index = 0; index < BRANCHES.length; index += 1) {
        const branch = BRANCHES[index];
        const direct = rawDirect[index];
        let source = direct;
        let inheritedFrom = null;
        let manifest = null;
        if (!direct || !Object.keys(direct.fields || {}).length) {
            manifest = await getDocument('settings', `schedule_manifest_${branch}`, true, transaction);
            if (!manifest && branch === 'cs1') {
                manifest = await getDocument('settings', 'schedule_manifest', true, transaction);
            }
            const sourceId = manifestScheduleIds(manifest, branch)[0] || null;
            source = sourceId ? await getDocument('schedules', sourceId, false, transaction) : null;
            inheritedFrom = sourceId;
        }
        const sourceData = source?.fields ? decodeFields(source.fields) : {};
        const baseData = inheritedFrom ? sanitizeInheritedSchedule(sourceData) : sourceData;
        const registrationRaw = await runFieldQuery(
            'schedule_registrations',
            'scheduleKey',
            `${branch}__${DATE}`,
            transaction
        );
        const registrations = registrationRaw.map(document => ({
            id: document.name.split('/').pop(),
            ...decodeFields(document.fields)
        }));
        resolved.push({
            branch,
            id: `${branch}__${DATE}`,
            name: direct?.name || `${DOC_NAME_ROOT}/schedules/${branch}__${DATE}`,
            updateTime: direct?.updateTime || null,
            data: mergeScheduleRegistrations(baseData, registrations),
            resolution: {
                targetExists: !!direct,
                targetUpdateTime: direct?.updateTime || null,
                inheritedFrom,
                sourceName: source?.name || null,
                sourceUpdateTime: source?.updateTime || null,
                manifestName: manifest?.name || null,
                manifestUpdateTime: manifest?.updateTime || null,
                registrations: registrationRaw.map(document => ({
                    name: document.name,
                    updateTime: document.updateTime,
                    fields: document.fields
                }))
            }
        });
    }
    return resolved;
}

function isCenterSectionClosed(centerClosures, section) {
    const closures = Array.isArray(centerClosures?.[DATE]) ? centerClosures[DATE] : [];
    const parent = section.startsWith('evening') ? 'evening' : '';
    return closures.includes('all') || closures.includes(section) || (parent && closures.includes(parent));
}

function buildManifest(scheduleDocuments, subjectCatalog = [], centerClosures = {}, closureSource = null) {
    const docsByBranch = new Map((scheduleDocuments || []).map(item => {
        const branch = item.branch || BRANCHES.find(value => String(item.id || item.name || '').includes(`${value}__${DATE}`));
        return [branch, item.data ? item : decodedScheduleDocument(item, branch)];
    }));
    const assignments = [];
    const scheduleSnapshot = [];
    const normalizedSubjects = (subjectCatalog || []).map(subject => ({
        id: cleanText(subject.id || subject.name?.split('/').pop()),
        name: cleanText(subject.data?.name || subject.nameValue || (subject.fields ? decodeFields(subject.fields).name : subject.name)),
        updateTime: subject.updateTime || null,
        fields: subject.fields || encodeFields(subject.data || { name: subject.nameValue || subject.name || '' })
    })).filter(item => item.id && item.name);
    const subjectsById = new Map();
    normalizedSubjects.forEach(subject => {
        if (subjectsById.has(subject.id)) {
            throw new Error(`Safety gate: subject catalog trùng id ${subject.id}.`);
        }
        subjectsById.set(subject.id, subject);
    });
    const referencedSubjectIds = new Set();
    const resolveSubjectId = row => {
        const explicit = cleanText(row.lopId || row.subject);
        let ids = explicit.split('+').map(id => cleanText(id)).filter(Boolean);
        if (!ids.length) {
            const lookup = normalizeRateName(row.lop);
            const matches = normalizedSubjects.filter(subject => normalizeRateName(subject.name) === lookup);
            if (matches.length !== 1) return '';
            ids = [matches[0].id];
        }
        ids = Array.from(new Set(ids));
        const missing = ids.filter(id => !subjectsById.has(id));
        if (missing.length) {
            throw new Error(
                `Safety gate: “${cleanText(row.lop) || '?'}” tham chiếu subject không tồn tại [${missing.join(', ')}].`
            );
        }
        ids.forEach(id => referencedSubjectIds.add(id));
        return ids.join('+');
    };

    BRANCHES.forEach(branch => {
        const document = docsByBranch.get(branch);
        if (!document) throw new Error(`Safety gate: thiếu schedules/${branch}__${DATE}.`);
        const data = document.data || {};
        const snapshotSections = {};
        SECTIONS.forEach(section => {
            const rows = Array.isArray(data[section]) ? data[section] : [];
            snapshotSections[section] = rows;
            if (isCenterSectionClosed(centerClosures, section)) return;
            rows.forEach((row, index) => {
                if (!row || row.isClosed === true || !cleanText(row.lop)) return;
                const workers = activeWorkersForRow(row);
                if (!workers.length) return;
                const start = normalizeClock(row.start);
                const end = normalizeClock(row.end);
                const subjectId = resolveSubjectId(row);
                const className = cleanText(row.lop);
                if (!start || !end || !(end > start)) {
                    throw new Error(`Safety gate: ${branch} ${section}[${index}] có giờ không hợp lệ.`);
                }
                if (!subjectId) {
                    throw new Error(`Safety gate: ${branch} ${section}[${index}] “${className}” thiếu subjectId.`);
                }
                workers.forEach(worker => assignments.push({
                    staffId: worker.id,
                    scheduleName: worker.name,
                    start,
                    end,
                    subjectId,
                    className,
                    room: cleanText(row.phong || row.room) || null,
                    branch,
                    section,
                    index,
                    compositeKey: `${branch}__${DATE}`,
                    shiftId: cleanText(row.shiftId) || null
                }));
            });
        });
        scheduleSnapshot.push({
            branch,
            id: document.id,
            resolution: document.resolution || null,
            sections: snapshotSections
        });
    });

    scheduleSnapshot.push({
        centerClosuresForDate: Array.isArray(centerClosures?.[DATE]) ? centerClosures[DATE] : [],
        source: closureSource ? {
            name: closureSource.name,
            updateTime: closureSource.updateTime,
            fields: closureSource.fields
        } : null
    });

    assignments.sort((left, right) =>
        left.staffId.localeCompare(right.staffId) ||
        left.start.localeCompare(right.start) ||
        BRANCHES.indexOf(left.branch) - BRANCHES.indexOf(right.branch) ||
        SECTIONS.indexOf(left.section) - SECTIONS.indexOf(right.section) ||
        left.index - right.index
    );
    const groups = new Map();
    assignments.forEach(assignment => {
        // A session is one staff member's concurrent teaching work inside one
        // concrete schedule lane. Rows in another branch/section are separate
        // evidence even when their clocks happen to be equal.
        const key = `${assignment.staffId}::${assignment.branch}::${assignment.section}::${assignment.start}::${assignment.end}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(assignment);
    });

    const windows = Array.from(groups.entries()).map(([key, group]) => {
        const links = group.map(item => ({
            branch: item.branch,
            compositeKey: item.compositeKey,
            section: item.section,
            index: item.index,
            shiftId: item.shiftId,
            subjectId: item.subjectId,
            className: item.className,
            room: item.room,
            start: item.start,
            end: item.end
        }));
        const subjectIds = Array.from(new Set(group.map(item => item.subjectId)));
        const classNames = Array.from(new Set(group.map(item => item.className)));
        const scheduleNames = Array.from(new Set(group.map(item => item.scheduleName).filter(Boolean)));
        return {
            key,
            staffId: group[0].staffId,
            scheduleNames,
            start: group[0].start,
            end: group[0].end,
            subjectIds,
            classNames,
            role: subjectIds.join('+'),
            roleName: classNames.join(' + '),
            scheduleLinks: links
        };
    }).sort((left, right) => left.staffId.localeCompare(right.staffId) || left.start.localeCompare(right.start));

    const uniqueStaffIds = Array.from(new Set(windows.map(item => item.staffId))).sort();
    const referencedSubjects = Array.from(referencedSubjectIds).sort().map(id => {
        const subject = subjectsById.get(id);
        return {
            id,
            name: subject.name,
            updateTime: subject.updateTime,
            fields: subject.fields
        };
    });
    scheduleSnapshot.push({ referencedSubjects });
    const fingerprintPayload = {
        date: DATE,
        referencedSubjects,
        assignments: assignments.map(({ scheduleName, ...item }) => item),
        windows: windows.map(item => ({
            staffId: item.staffId,
            start: item.start,
            end: item.end,
            subjectIds: item.subjectIds,
            classNames: item.classNames,
            scheduleLinks: item.scheduleLinks
        }))
    };
    return {
        assignments,
        windows,
        uniqueStaffIds,
        referencedSubjects,
        scheduleSnapshot,
        manifestHash: sha256(fingerprintPayload),
        scheduleHash: sha256(scheduleSnapshot),
        counts: {
            assignmentRecords: assignments.length,
            staffWindows: windows.length,
            uniqueStaff: uniqueStaffIds.length
        }
    };
}

function assertExpectedManifest(manifest, allowUnpinned = false) {
    for (const key of ['assignmentRecords', 'staffWindows', 'uniqueStaff']) {
        if (manifest.counts[key] !== EXPECTED[key]) {
            throw new Error(`Safety gate: ${key}=${manifest.counts[key]}, dự kiến ${EXPECTED[key]}.`);
        }
    }
    const hashesPinned = PINNED_HASH.test(EXPECTED_MANIFEST_SHA256) && PINNED_HASH.test(EXPECTED_SCHEDULE_SHA256);
    if (!hashesPinned) {
        if (!allowUnpinned) throw new Error('Safety gate: fingerprint production chưa được ghim; tuyệt đối không apply/rollback.');
        return;
    }
    if (manifest.manifestHash !== EXPECTED_MANIFEST_SHA256) {
        throw new Error(`Safety gate: manifest lịch đã đổi (${manifest.manifestHash}).`);
    }
    if (manifest.scheduleHash !== EXPECTED_SCHEDULE_SHA256) {
        throw new Error(`Safety gate: nội dung evening1/evening2 đã đổi (${manifest.scheduleHash}).`);
    }
}

function normalizeRateName(value) {
    return cleanText(value).toLocaleLowerCase('vi').replace(/\s+/g, ' ');
}

function hydrateTargets(manifest, userDocuments) {
    const usersById = new Map((userDocuments || []).map(item => [item.id, item]));
    return manifest.uniqueStaffIds.map(staffId => {
        const document = usersById.get(staffId);
        if (!document) throw new Error(`Safety gate: thiếu users/${staffId}.`);
        const user = document.data || (document.fields ? decodeFields(document.fields) : document);
        const name = cleanText(user.name || user.username);
        if (!name) throw new Error(`Safety gate: users/${staffId} không có tên.`);
        // Do not freeze a guessed monetary rate into historical attendance.
        // The evaluator resolves the applicable subject policy from `role` and
        // the live schedule link. This is especially important for staff whose
        // dated policy has no direct class-rate entry for this one subject.
        const sessions = manifest.windows.filter(item => item.staffId === staffId);
        return { staffId, name, user, userDocument: document, sessions };
    });
}

function hasMeaningfulValue(value) {
    if (value === null || value === undefined || value === '' || value === false) return false;
    if (typeof value === 'number') return value !== 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

function mapOriginalSessionToWindow(session, target, maxDeltaMinutes = 20) {
    const checkInValue = session?.checkIn || session?.start;
    if (typeof checkInValue !== 'string' || !Number.isFinite(Date.parse(checkInValue))) {
        throw new Error(`Safety gate: ${target.name} có phiên cũ không có ISO check-in hợp lệ.`);
    }
    const checkInMs = Date.parse(checkInValue);
    const candidates = target.sessions.map(window => ({
        window,
        delta: Math.abs(checkInMs - Date.parse(exactScheduleISO(window.start)))
    })).filter(item => item.delta <= maxDeltaMinutes * 60 * 1000)
        .sort((left, right) => left.delta - right.delta);
    if (!candidates.length || (candidates[1] && candidates[1].delta === candidates[0].delta)) {
        const anchors = candidates.map(item => item.window.key).join(', ') || 'none';
        const available = target.sessions.map(item => `${item.start}-${item.end}`).join(', ');
        throw new Error(`Safety gate: phiên ${checkInValue} của ${target.name} không neo duy nhất vào ca tối [${anchors}], lịch [${available}].`);
    }
    if (session.checkOut != null && session.checkOut !== '') {
        if (typeof session.checkOut !== 'string' || !Number.isFinite(Date.parse(session.checkOut))) {
            throw new Error(`Safety gate: ${target.name} có checkout cũ không hợp lệ.`);
        }
        const checkOutMs = Date.parse(session.checkOut);
        if (checkOutMs < checkInMs || checkOutMs - checkInMs > 8 * 60 * 60 * 1000) {
            throw new Error(`Safety gate: phiên cũ của ${target.name} có thời lượng không hợp lệ.`);
        }
    }
    return candidates[0].window;
}

function assertOriginalSessionIsReplaceable(session, target) {
    if (!session || session.isAbsent === true) {
        throw new Error(`Safety gate: ${target.name} có phiên vắng/không hợp lệ; không được thay.`);
    }
    const forbidden = [
        'role', 'roleName', 'roleAssignmentSource', 'linkedClassStart', 'linkedClassEnd',
        'linkedScheduleShiftId', 'linkedScheduleCompositeKey', 'linkedScheduleSection',
        'linkedScheduleLinks', 'linkedReceptionistShift', 'linkedOfficeShift',
        'bonus10', 'bonus10Status', 'studentCount', 'studentCountStatus',
        'overtimeMinutes', 'isAdminEdited', 'editHistory', 'dataRepairId'
    ];
    const present = forbidden.filter(key => hasMeaningfulValue(session[key]));
    if (Number(session.roleRate || 0) !== 0) present.push('roleRate');
    if (present.length) {
        throw new Error(`Safety gate: phiên cũ của ${target.name} có dữ liệu nghiệp vụ [${present.join(', ')}].`);
    }
    // The production input fingerprint pins these exact ten authorized
    // evening attempts. Some staff tapped near the second-slot clock despite
    // having a first-slot schedule, so anchoring is nearest-window rather than
    // inventing a hard 20-minute threshold.
    return mapOriginalSessionToWindow(session, target, Number.POSITIVE_INFINITY);
}

function isOperationalSession(session) {
    const operationalRoles = new Set([
        'tiep-tan', 'tiep_tan', 'receptionist', 'receptionist_assistant',
        'receptionist_lead', 'receptionist_staff', 'van-phong', 'van_phong', 'office_staff'
    ]);
    return hasMeaningfulValue(session?.linkedReceptionistShift) ||
        hasMeaningfulValue(session?.linkedOfficeShift) ||
        operationalRoles.has(cleanText(session?.role).toLowerCase());
}

function classifyOriginalSession(session, target) {
    const checkInValue = session?.checkIn || session?.start;
    if (typeof checkInValue !== 'string' || !Number.isFinite(Date.parse(checkInValue))) {
        throw new Error(`Safety gate: ${target.name} có phiên cũ không có ISO check-in hợp lệ.`);
    }
    if (isOperationalSession(session)) return { kind: 'preserve', reason: 'operational' };

    // A legitimate arrival may be a few minutes before 18:00. Treat only a
    // tight ±20-minute schedule anchor as target evidence before applying the
    // strict outside-horizon preservation rule.
    try {
        const nearWindow = mapOriginalSessionToWindow(session, target, 20);
        assertOriginalSessionIsReplaceable(session, target);
        return { kind: 'target-attempt', window: nearWindow };
    } catch (_) {
        // Continue to the horizon gate. Any unsafe in-horizon session is
        // re-thrown by assertOriginalSessionIsReplaceable below.
    }

    const timestamp = Date.parse(checkInValue);
    const horizonStart = Date.parse(exactScheduleISO('18:00'));
    const horizonEnd = Date.parse(exactScheduleISO('21:00'));
    if (timestamp < horizonStart || timestamp >= horizonEnd) {
        return { kind: 'preserve', reason: 'outside-evening-window' };
    }

    // Only bare attempts inside the exact evening horizon are consumed. The
    // pinned input fingerprint authorizes the ten audited taps even where a
    // user tapped near a different slot clock. Outside/operational sessions
    // remain byte-for-byte in the sessions array.
    const window = assertOriginalSessionIsReplaceable(session, target);
    return { kind: 'target-attempt', window };
}

function auditOriginalAttendance(targets, attendanceDocuments) {
    const attendanceById = new Map((attendanceDocuments || []).map(item => [item.id, item]));
    let targetAttemptDocuments = 0;
    let targetAttempts = 0;
    let preservedSessions = 0;
    const preservedDetails = [];
    const mappedAttempts = new Map();
    const preservedSessionEntriesByStaff = new Map();
    targets.forEach(target => {
        const document = attendanceById.get(`${DATE}_${target.staffId}`);
        if (!document) return;
        const data = document.data || decodeFields(document.fields);
        if (cleanText(data.userId || target.staffId) !== target.staffId || cleanText(data.date || DATE) !== DATE) {
            throw new Error(`Safety gate: attendance của ${target.name} sai userId/date.`);
        }
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        const rawSessionValues = document.fields?.sessions?.arrayValue?.values || [];
        if (document.fields?.sessions && rawSessionValues.length !== sessions.length) {
            throw new Error(`Safety gate: attendance của ${target.name} có mảng sessions REST không đồng nhất.`);
        }
        let documentTargetAttempts = 0;
        const preserved = [];
        sessions.forEach((session, index) => {
            const classification = classifyOriginalSession(session, target);
            if (classification.kind === 'preserve') {
                preserved.push({
                    decoded: session,
                    // Production REST documents always take this branch. The
                    // encode fallback exists only for offline fixtures.
                    rawValue: rawSessionValues[index] || encode(session)
                });
                preservedSessions += 1;
                preservedDetails.push({
                    staffId: target.staffId,
                    name: target.name,
                    checkIn: session.checkIn || session.start || null,
                    reason: classification.reason
                });
                return;
            }
            documentTargetAttempts += 1;
            targetAttempts += 1;
            const key = `${target.staffId}::${classification.window.start}::${classification.window.end}`;
            if (!mappedAttempts.has(key)) mappedAttempts.set(key, []);
            mappedAttempts.get(key).push(session);
        });
        if (documentTargetAttempts > 0) targetAttemptDocuments += 1;
        preservedSessionEntriesByStaff.set(target.staffId, preserved);
    });
    if (targetAttemptDocuments !== EXPECTED.originalAttendanceDocuments || targetAttempts !== EXPECTED.originalSessions) {
        throw new Error(
            `Safety gate: trạng thái công gốc là ${targetAttemptDocuments} docs/${targetAttempts} ca tối mục tiêu, ` +
            `dự kiến ${EXPECTED.originalAttendanceDocuments}/${EXPECTED.originalSessions}; preserved=${canonicalJson(preservedDetails)}.`
        );
    }
    return {
        targetAttemptDocuments,
        targetAttempts,
        preservedSessions,
        preservedDetails,
        mappedAttempts,
        preservedSessionEntriesByStaff
    };
}

function relevantCancellationKeys(target) {
    return new Set(target.sessions.flatMap(session => session.scheduleLinks.flatMap(link => [
        `${link.compositeKey}_${link.section}_${link.index}`,
        link.shiftId ? `shift:${link.shiftId}` : null
    ].filter(Boolean))));
}

function isTeachingPayslipLocked(monthlyData) {
    const published = monthlyData?.published || {};
    const locked = new Set(['published', 'received']);
    const gvStatus = cleanText(published.status_gv).toLowerCase();
    if (locked.has(gvStatus)) return true;
    const hasExplicitComponents = hasMeaningfulValue(published.status_gv) || hasMeaningfulValue(published.status_tt);
    return !hasExplicitComponents && locked.has(cleanText(published.status).toLowerCase());
}

function activeRequest(document) {
    const data = document?.data || (document?.fields ? decodeFields(document.fields) : document || {});
    const status = cleanText(data.status).toLowerCase();
    return !['rejected', 'cancelled', 'canceled', 'deleted'].includes(status);
}

function observationMatchesTargetShift(document, targetById) {
    const data = document?.data || (document?.fields ? decodeFields(document.fields) : document || {});
    if (cleanText(data.status).toLowerCase() === 'cancelled') return false;
    const staffId = cleanText(data.teacherId || data.staffId);
    const target = targetById.get(staffId);
    if (!target) return false;
    return target.sessions.some(session => session.scheduleLinks.some(link => {
        if (data.classStart && normalizeClock(data.classStart) !== link.start) return false;
        if (data.branch && cleanText(data.branch).toLowerCase() !== link.branch.toLowerCase()) return false;
        const hasExactIdentity = cleanText(data.scheduleCompositeKey) && cleanText(data.classSectionKey);
        if (!hasExactIdentity) return true;
        return cleanText(data.scheduleCompositeKey) === link.compositeKey &&
            cleanText(data.classSectionKey) === link.section &&
            Number(data.classIndex) === Number(link.index);
    }));
}

function evaluateExternalGates(
    targets,
    cancellationDocuments,
    salaryDocuments,
    bonusDocuments,
    overtimeDocuments,
    observationDocuments = []
) {
    const targetIds = new Set(targets.map(item => item.staffId));
    const targetById = new Map(targets.map(item => [item.staffId, item]));
    const relevantCancellations = [];
    (cancellationDocuments || []).forEach(document => {
        if (!document) return;
        const data = document.data || decodeFields(document.fields);
        const staffId = cleanText(data.userId || document.id?.slice(MONTH.length + 1));
        const keys = relevantCancellationKeys(targetById.get(staffId) || { sessions: [] });
        (Array.isArray(data.shifts) ? data.shifts : []).forEach(shift => {
            if (keys.has(shift)) relevantCancellations.push({ staffId, shift });
        });
    });
    const lockedPayslips = (salaryDocuments || []).filter(document => {
        if (!document) return false;
        return isTeachingPayslipLocked(document.data || decodeFields(document.fields));
    }).map(document => document.id);
    const activeBonusRequests = (bonusDocuments || []).filter(document => {
        const data = document.data || decodeFields(document.fields);
        return targetIds.has(cleanText(data.staffId)) && activeRequest(document);
    });
    const activeOvertimeRequests = (overtimeDocuments || []).filter(document => {
        const data = document.data || decodeFields(document.fields);
        return targetIds.has(cleanText(data.staffId)) && activeRequest(document);
    });
    const shiftObservations = (observationDocuments || []).filter(document =>
        observationMatchesTargetShift(document, targetById)
    );
    const activeLateObservations = shiftObservations.filter(document => {
        const data = document.data || decodeFields(document.fields);
        return Number(data.lateMinutes || 0) > 0;
    });
    const counts = {
        relevantCancellations: relevantCancellations.length,
        lockedPayslips: lockedPayslips.length,
        activeBonusRequests: activeBonusRequests.length,
        activeOvertimeRequests: activeOvertimeRequests.length,
        shiftObservations: shiftObservations.length,
        activeLateObservations: activeLateObservations.length
    };
    Object.entries(counts).forEach(([key, value]) => {
        if (value !== EXPECTED[key]) throw new Error(`Safety gate: ${key}=${value}, dự kiến ${EXPECTED[key]}.`);
    });
    return {
        counts,
        relevantCancellations,
        lockedPayslips,
        activeBonusRequests,
        activeOvertimeRequests,
        shiftObservations,
        activeLateObservations
    };
}

function documentWrapper(document, id) {
    if (!document) return null;
    return {
        id,
        name: document.name,
        createTime: document.createTime,
        updateTime: document.updateTime,
        fields: document.fields,
        data: decodeFields(document.fields)
    };
}

function appliedSessionMatches(session, expected) {
    const expectedLinks = expected.scheduleLinks.map(link => ({
        branch: link.branch,
        compositeKey: link.compositeKey,
        section: link.section,
        index: link.index,
        shiftId: link.shiftId,
        subjectId: link.subjectId,
        className: link.className,
        room: link.room,
        start: link.start,
        end: link.end
    }));
    return session?.dataRepairId === REPAIR_ID &&
        session.checkIn === exactScheduleISO(expected.start) &&
        session.start === exactScheduleISO(expected.start) &&
        session.checkOut === exactScheduleISO(expected.end) &&
        session.role === expected.role &&
        session.roleName === expected.roleName &&
        session.roleRate === undefined &&
        session.linkedClassStart === expected.start &&
        session.linkedClassEnd === expected.end &&
        canonicalJson(session.linkedScheduleLinks || []) === canonicalJson(expectedLinks);
}

function isAppliedAttendance(document, target, repairedPatch = null) {
    if (!document) return false;
    const data = document.data || decodeFields(document.fields);
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    if (data.dataRepairId !== REPAIR_ID) return false;
    if (repairedPatch?.sessions) {
        return canonicalJson(sessions) === canonicalJson(repairedPatch.sessions) &&
            data.checkIn === repairedPatch.checkIn && data.checkOut === repairedPatch.checkOut;
    }
    const repairSessions = sessions.filter(session => session?.dataRepairId === REPAIR_ID);
    return repairSessions.length === target.sessions.length &&
        target.sessions.every(expected => repairSessions.some(session => appliedSessionMatches(session, expected)));
}

function originalDocumentsMatchBackup(attendanceDocuments, payload) {
    const byId = new Map((attendanceDocuments || []).map(item => [item.id, item]));
    return (payload?.originalAttendance || []).every(item => {
        const current = byId.get(item.documentId) || null;
        if (!item.document) return current === null;
        return current && canonicalJson(current.fields) === canonicalJson(item.document.fields);
    });
}

function validateBackupPayload(backup) {
    if (!backup || backup.data?.repairId !== REPAIR_ID) {
        throw new Error('Safety gate: thiếu backup hợp lệ cho repair này.');
    }
    const payload = JSON.parse(backup.data.payload || '{}');
    if (payload.repairId !== REPAIR_ID || backup.data.payloadHash !== sha256(payload)) {
        throw new Error('Safety gate: nội dung backup sai repair ID hoặc checksum.');
    }
    if (!Array.isArray(payload.originalAttendance) || payload.originalAttendance.length !== EXPECTED.uniqueStaff) {
        throw new Error('Safety gate: backup không chứa đủ 18 attendance nguyên bản.');
    }
    return payload;
}

function appliedDocumentsMatchBackup(attendanceDocuments, backup, payload) {
    const byId = new Map((attendanceDocuments || []).map(item => [item.id, item]));
    const repaired = payload?.repairedAttendance || [];
    if (repaired.length !== EXPECTED.uniqueStaff) return false;
    const originalById = new Map((payload?.originalAttendance || [])
        .map(item => [item.documentId, item.document]));
    const expectedFieldEntries = repaired.map(item => ({
        documentId: item.documentId,
        fields: attendanceWriteFields(
            originalById.get(item.documentId)
                ? { fields: originalById.get(item.documentId).fields }
                : null,
            item.patch,
            payload.createdAt
        )
    }));
    if (fieldsFingerprint(expectedFieldEntries) !== payload.appliedAttendanceFieldsHash) return false;
    const fieldEntries = [];
    for (const item of repaired) {
        const current = byId.get(item.documentId);
        if (!current || current.data?.dataRepairId !== REPAIR_ID) return false;
        if (!isAppliedAttendance(current, null, item.patch)) return false;
        if (!current.updateTime || Date.parse(current.updateTime) < Date.parse(payload.createdAt || 0)) return false;
        fieldEntries.push({ documentId: item.documentId, fields: current.fields });
    }
    return fieldsFingerprint(fieldEntries) === payload.appliedAttendanceFieldsHash;
}

async function loadState({ transaction = null, allowUnpinned = false } = {}) {
    const [rawDirectSchedules, rawSubjects, rawSystemSettings] = await Promise.all([
        Promise.all(BRANCHES.map(branch =>
            getDocument('schedules', `${branch}__${DATE}`, true, transaction)
        )),
        runCollectionQuery('subjects', transaction),
        getDocument('settings', 'system', false, transaction)
    ]);
    const scheduleDocuments = await resolveScheduleDocuments(rawDirectSchedules, transaction);
    const subjects = rawSubjects.map(document => documentWrapper(document, document.name.split('/').pop()));
    const systemSettings = documentWrapper(rawSystemSettings, 'system');
    const centerClosures = systemSettings.data.centerClosures || {};
    const manifest = buildManifest(scheduleDocuments, subjects, centerClosures, rawSystemSettings);
    assertExpectedManifest(manifest, allowUnpinned);

    const ids = manifest.uniqueStaffIds;
    const [
        rawUsers,
        rawAttendance,
        rawSalary,
        rawCancellations,
        backupRaw,
        bonusRaw,
        overtimeRaw,
        observationRaw
    ] = await Promise.all([
        Promise.all(ids.map(id => getDocument('users', id, false, transaction))),
        Promise.all(ids.map(id => getDocument('attendance_logs', `${DATE}_${id}`, true, transaction))),
        Promise.all(ids.map(id => getDocument('salary_settings_monthly', `${MONTH}_${id}`, true, transaction))),
        runFieldQuery('cancelled_shifts', 'month', MONTH, transaction),
        getDocument('migration_backups', REPAIR_ID, true, transaction),
        runDateQuery('bonus10_requests', transaction),
        runDateQuery('overtime_requests', transaction),
        runDateQuery('shift_observations', transaction)
    ]);
    const users = rawUsers.map((document, index) => documentWrapper(document, ids[index]));
    const attendance = rawAttendance.map((document, index) => documentWrapper(document, `${DATE}_${ids[index]}`)).filter(Boolean);
    const salary = rawSalary.map((document, index) => documentWrapper(document, `${MONTH}_${ids[index]}`)).filter(Boolean);
    const targetIdSet = new Set(ids);
    const cancellations = rawCancellations
        .map(document => documentWrapper(document, document.name.split('/').pop()))
        .filter(document => targetIdSet.has(cleanText(document.data.userId)));
    const bonus = bonusRaw.map(document => documentWrapper(document, document.name.split('/').pop()));
    const overtime = overtimeRaw.map(document => documentWrapper(document, document.name.split('/').pop()));
    const observations = observationRaw.map(document => documentWrapper(document, document.name.split('/').pop()));
    const backup = backupRaw ? documentWrapper(backupRaw, REPAIR_ID) : null;
    const targets = hydrateTargets(manifest, users);
    const external = evaluateExternalGates(targets, cancellations, salary, bonus, overtime, observations);
    const attendanceDocumentIds = ids.map(id => `${DATE}_${id}`);
    const attendanceHash = attendanceFingerprint(attendanceDocumentIds, attendance, true);

    let applied = false;
    let rolledBack = false;
    let originalAudit = null;
    if (backup) {
        const status = cleanText(backup.data.status);
        const payload = validateBackupPayload(backup);
        applied = status === 'applied' && appliedDocumentsMatchBackup(attendance, backup, payload);
        rolledBack = status === 'rolled-back' && originalDocumentsMatchBackup(attendance, payload);
        if (!applied && !rolledBack) {
            throw new Error('Safety gate: backup tồn tại nhưng dữ liệu không ở trạng thái applied/rolled-back nguyên vẹn.');
        }
    } else {
        assertOriginalAttendanceFingerprint(attendanceHash, allowUnpinned);
        originalAudit = auditOriginalAttendance(targets, attendance);
    }

    return {
        transaction,
        scheduleDocuments,
        centerClosures,
        manifest,
        subjects,
        users,
        attendance,
        salary,
        cancellations,
        bonus,
        overtime,
        observations,
        backup,
        targets,
        external,
        originalAudit,
        attendanceHash,
        applied,
        rolledBack
    };
}

function beforeAttemptsForWindow(state, target, expected) {
    const key = `${target.staffId}::${expected.start}::${expected.end}`;
    const attempts = state.originalAudit?.mappedAttempts?.get(key) || [];
    return attempts.map(session => ({
        id: session.id ?? null,
        checkIn: session.checkIn || session.start || null,
        checkOut: session.checkOut || null
    }));
}

function buildSession(state, target, expected, now) {
    const checkIn = exactScheduleISO(expected.start);
    const checkOut = exactScheduleISO(expected.end);
    const links = expected.scheduleLinks.map(link => ({
        branch: link.branch,
        compositeKey: link.compositeKey,
        section: link.section,
        index: link.index,
        shiftId: link.shiftId,
        subjectId: link.subjectId,
        className: link.className,
        room: link.room,
        start: link.start,
        end: link.end
    }));
    const branches = Array.from(new Set(links.map(link => link.branch)));
    const rooms = Array.from(new Set(links.map(link => link.room).filter(Boolean)));
    const session = {
        id: Date.parse(checkIn),
        start: checkIn,
        checkIn,
        checkOut,
        type: 'admin_add',
        status: 'closed',
        source: 'admin',
        anchorDateKey: DATE,
        role: expected.role,
        roleName: expected.roleName,
        isFixedShift: false,
        linkedClassStart: expected.start,
        linkedClassEnd: expected.end,
        linkedScheduleLinks: links,
        branch: branches.join('+'),
        branches,
        className: expected.roleName,
        room: rooms.join(' + ') || null,
        isAdminEdited: true,
        isAbsent: false,
        roleAssignmentSource: 'repair_from_schedule_exact',
        subjectOverride: false,
        dataRepairId: REPAIR_ID,
        createdAt: now,
        editHistory: [{
            at: now,
            action: 'repair_exact_schedule_attendance',
            source: 'rule_hd_cli_evening_schedule_repair',
            editor: 'system-repair',
            before: { attempts: beforeAttemptsForWindow(state, target, expected) },
            after: {
                checkIn,
                checkOut,
                role: expected.role,
                roleName: expected.roleName,
                linkedClassStart: expected.start,
                links
            }
        }]
    };
    // The manifest groups only one branch/section lane, so every repaired
    // session has an unambiguous common schedule anchor. A merged session has
    // multiple row links and therefore deliberately has no singular shiftId.
    if (links.length >= 1) {
        session.linkedScheduleCompositeKey = links[0].compositeKey;
        session.linkedScheduleSection = links[0].section;
        if (links.length === 1 && links[0].shiftId) session.linkedScheduleShiftId = links[0].shiftId;
    }
    return session;
}

function buildAttendancePatch(state, target, now) {
    const preservedEntries = state.originalAudit?.preservedSessionEntriesByStaff?.get(target.staffId) || [];
    const repaired = target.sessions.map(expected => buildSession(state, target, expected, now));
    const entries = [
        ...preservedEntries.map(item => ({ decoded: item.decoded, rawValue: item.rawValue })),
        ...repaired.map(session => ({ decoded: session, rawValue: encode(session) }))
    ].sort((left, right) =>
        Date.parse(left.decoded.checkIn || left.decoded.start || 0) -
        Date.parse(right.decoded.checkIn || right.decoded.start || 0)
    );
    const sessions = entries.map(item => item.decoded);
    const rawSessions = { arrayValue: { values: entries.map(item => item.rawValue) } };
    const sessionIds = sessions.map(session => String(session?.id ?? '')).filter(Boolean);
    if (new Set(sessionIds).size !== sessionIds.length) {
        throw new Error(`Safety gate: ${target.name} có session id trùng sau khi dựng repair.`);
    }
    const latest = sessions.slice().sort((left, right) =>
        Date.parse(left.checkIn || left.start || 0) - Date.parse(right.checkIn || right.start || 0)
    ).pop();
    return {
        userId: target.staffId,
        name: target.name,
        date: DATE,
        sessions,
        rawSessions,
        checkIn: latest.checkIn || latest.start,
        checkOut: latest.checkOut,
        dataRepairId: REPAIR_ID,
        lastUpdated: now
    };
}

function attendanceWriteFields(existing, patch, now) {
    const fields = {
        ...(existing?.fields || {}),
        ...encodeFields({
            userId: patch.userId,
            name: patch.name,
            date: patch.date,
            checkIn: patch.checkIn,
            checkOut: patch.checkOut,
            dataRepairId: patch.dataRepairId
        })
    };
    fields.sessions = patch.rawSessions;
    fields.lastUpdated = { timestampValue: now };
    return fields;
}

function normalizeFirestoreWireValue(value) {
    if (Array.isArray(value)) return value.map(normalizeFirestoreWireValue);
    if (!value || typeof value !== 'object') return value;
    if (Object.prototype.hasOwnProperty.call(value, 'arrayValue')) {
        const arrayValue = value.arrayValue || {};
        return {
            arrayValue: {
                ...arrayValue,
                // Firestore REST omits `values` after persisting an empty
                // array even when the write payload used `values: []`.
                values: (arrayValue.values || []).map(normalizeFirestoreWireValue)
            }
        };
    }
    if (Object.prototype.hasOwnProperty.call(value, 'mapValue')) {
        const mapValue = value.mapValue || {};
        return {
            mapValue: {
                ...mapValue,
                // Empty maps use the same omitted-field wire convention.
                fields: normalizeFirestoreWireValue(mapValue.fields || {})
            }
        };
    }
    return Object.fromEntries(Object.entries(value)
        .map(([key, child]) => [key, normalizeFirestoreWireValue(child)]));
}

function fieldsFingerprint(entries) {
    return sha256((entries || []).slice().sort((left, right) => left.documentId.localeCompare(right.documentId))
        .map(item => ({
            documentId: item.documentId,
            fields: normalizeFirestoreWireValue(item.fields)
        })));
}

function createWrite(name, fields) {
    return { update: { name, fields }, currentDocument: { exists: false } };
}

function updateWrite(document, fields, fieldPaths) {
    return {
        update: { name: document.name, fields },
        ...(fieldPaths ? { updateMask: { fieldPaths } } : {}),
        currentDocument: { updateTime: document.updateTime }
    };
}

function buildBackupPayload(state, now, attendancePatches, appliedAttendanceFieldsHash) {
    return {
        repairId: REPAIR_ID,
        createdAt: now,
        project: PROJECT,
        date: DATE,
        manifestHash: state.manifest.manifestHash,
        scheduleHash: state.manifest.scheduleHash,
        originalAttendanceHash: state.attendanceHash,
        appliedAttendanceFieldsHash,
        scheduleDocuments: state.scheduleDocuments.map(document => ({
            id: document.id,
            name: document.name,
            updateTime: document.updateTime,
            resolution: document.resolution || null
        })),
        referencedSubjects: state.manifest.referencedSubjects,
        manifest: state.targets.map(target => ({
            staffId: target.staffId,
            name: target.name,
            sessions: target.sessions
        })),
        safetyAudit: {
            ...state.manifest.counts,
            originalAttendanceDocuments: state.originalAudit?.targetAttemptDocuments,
            originalSessions: state.originalAudit?.targetAttempts,
            preservedSessions: state.originalAudit?.preservedSessions,
            ...state.external.counts
        },
        shiftObservationEvidence: (state.external.shiftObservations || []).map(document => ({
            id: document.id,
            name: document.name,
            updateTime: document.updateTime,
            fields: document.fields
        })),
        originalAttendance: state.targets.map(target => ({
            documentId: `${DATE}_${target.staffId}`,
            document: (() => {
                const original = state.attendance.find(item => item.id === `${DATE}_${target.staffId}`) || null;
                if (!original) return null;
                // Raw Firestore REST document shape, without the decoded helper
                // copy. Rollback writes these exact fields back.
                return {
                    name: original.name,
                    createTime: original.createTime,
                    updateTime: original.updateTime,
                    fields: original.fields
                };
            })()
        })),
        repairedAttendance: attendancePatches.map(item => ({
            documentId: `${DATE}_${item.target.staffId}`,
            patch: item.patch
        }))
    };
}

function buildApplyWrites(state, now = new Date().toISOString()) {
    if (state.backup || state.applied || state.rolledBack) {
        throw new Error('Safety gate: repair ID đã có backup; không tạo bộ ghi apply mới.');
    }
    const attendancePatches = state.targets.map(target => ({ target, patch: buildAttendancePatch(state, target, now) }));
    const attendanceFieldPlans = attendancePatches.map(({ target, patch }) => {
        const documentId = `${DATE}_${target.staffId}`;
        const existing = state.attendance.find(item => item.id === documentId) || null;
        return { target, patch, existing, documentId, fields: attendanceWriteFields(existing, patch, now) };
    });
    const appliedAttendanceFieldsHash = fieldsFingerprint(attendanceFieldPlans);
    const backupPayload = buildBackupPayload(
        state,
        now,
        attendancePatches,
        appliedAttendanceFieldsHash
    );
    const backupPayloadJson = JSON.stringify(backupPayload);
    const backupPayloadHash = sha256(backupPayload);
    const backupWrite = createWrite(`${DOC_NAME_ROOT}/migration_backups/${REPAIR_ID}`, {
        repairId: { stringValue: REPAIR_ID },
        status: { stringValue: 'applied' },
        createdAt: { timestampValue: now },
        description: {
            stringValue: 'Replace only the audited 2026-08-31 evening attendance attempts with exact scheduled teaching sessions; atomic, fingerprinted, and reversible.'
        },
        manifestHash: { stringValue: state.manifest.manifestHash },
        scheduleHash: { stringValue: state.manifest.scheduleHash },
        originalAttendanceHash: { stringValue: state.attendanceHash },
        appliedAttendanceFieldsHash: { stringValue: appliedAttendanceFieldsHash },
        payloadHash: { stringValue: backupPayloadHash },
        payload: { stringValue: backupPayloadJson }
    });
    const attendanceWrites = attendanceFieldPlans.map(({ target, existing, fields }) => {
        if (!existing) {
            return createWrite(`${DOC_NAME_ROOT}/attendance_logs/${DATE}_${target.staffId}`, fields);
        }
        return updateWrite(existing, fields, [
            'userId', 'name', 'date', 'sessions', 'checkIn', 'checkOut', 'dataRepairId', 'lastUpdated'
        ]);
    });
    return { writes: [backupWrite, ...attendanceWrites], backupPayload, attendancePatches };
}

function buildRollbackWrites(state, rolledBackAt = new Date().toISOString()) {
    if (!state.applied || !state.backup) {
        throw new Error('Safety gate rollback: repair không ở trạng thái applied nguyên vẹn.');
    }
    const payload = JSON.parse(state.backup.data.payload || '{}');
    const currentById = new Map(state.attendance.map(item => [item.id, item]));
    const writes = payload.originalAttendance.map(item => {
        const current = currentById.get(item.documentId);
        if (!current) throw new Error(`Safety gate rollback: thiếu attendance_logs/${item.documentId}.`);
        if (!item.document) {
            return { delete: current.name, currentDocument: { updateTime: current.updateTime } };
        }
        return updateWrite(current, item.document.fields, null);
    });
    writes.push(updateWrite(state.backup, {
        status: { stringValue: 'rolled-back' },
        rolledBackAt: { timestampValue: rolledBackAt }
    }, ['status', 'rolledBackAt']));
    return { writes, payload };
}

async function loadRollbackState(transaction = null) {
    const backupRaw = await getDocument('migration_backups', REPAIR_ID, false, transaction);
    const backup = documentWrapper(backupRaw, REPAIR_ID);
    const payload = validateBackupPayload(backup);
    const documentIds = payload.originalAttendance.map(item => item.documentId);
    if (new Set(documentIds).size !== EXPECTED.uniqueStaff) {
        throw new Error('Safety gate rollback: danh sách attendance trong backup bị trùng/thiếu.');
    }
    const rawAttendance = await Promise.all(documentIds.map(id =>
        getDocument('attendance_logs', id, true, transaction)
    ));
    const attendance = rawAttendance
        .map((document, index) => documentWrapper(document, documentIds[index]))
        .filter(Boolean);
    const status = cleanText(backup.data.status);
    const applied = status === 'applied' && appliedDocumentsMatchBackup(attendance, backup, payload);
    const rolledBack = status === 'rolled-back' && originalDocumentsMatchBackup(attendance, payload);
    if (!applied && !rolledBack) {
        throw new Error('Safety gate rollback: current attendance không khớp applied/rolled-back backup nguyên vẹn.');
    }
    return { transaction, backup, payload, attendance, applied, rolledBack };
}

function dryRunSummary(state, mode, plan = null) {
    return {
        mode,
        project: PROJECT,
        date: DATE,
        repairId: REPAIR_ID,
        manifestHash: state.manifest.manifestHash,
        scheduleHash: state.manifest.scheduleHash,
        attendanceHash: state.attendanceHash,
        fingerprintsPinned: PINNED_HASH.test(EXPECTED_MANIFEST_SHA256) &&
            PINNED_HASH.test(EXPECTED_SCHEDULE_SHA256) &&
            PINNED_HASH.test(EXPECTED_ATTENDANCE_SHA256),
        status: state.applied ? 'already-applied' : (state.rolledBack ? 'already-rolled-back' : 'ready'),
        plan: plan ? {
            atomicWrites: plan.writes.length,
            backupWrites: 1,
            attendanceWrites: plan.writes.length - 1,
            backupPayloadBytes: Buffer.byteLength(JSON.stringify(plan.backupPayload), 'utf8')
        } : null,
        audit: {
            ...state.manifest.counts,
            referencedSubjects: state.manifest.referencedSubjects.length,
            originalAttendanceDocuments: state.originalAudit?.targetAttemptDocuments ?? null,
            originalSessions: state.originalAudit?.targetAttempts ?? null,
            preservedSessions: state.originalAudit?.preservedSessions ?? null,
            ...state.external.counts
        },
        scheduleResolution: state.scheduleDocuments.map(document => ({
            branch: document.branch,
            targetExists: document.resolution?.targetExists ?? true,
            inheritedFrom: document.resolution?.inheritedFrom || null,
            sourceUpdateTime: document.resolution?.sourceUpdateTime || document.updateTime || null,
            registrationDocuments: document.resolution?.registrations?.length || 0
        })),
        centerClosures: Array.isArray(state.centerClosures?.[DATE]) ? state.centerClosures[DATE] : [],
        staff: state.targets.map(target => ({
            staffId: target.staffId,
            name: target.name,
            attendanceExists: !!state.attendance.find(item => item.id === `${DATE}_${target.staffId}`),
            sessions: target.sessions.map(session => ({
                start: session.start,
                end: session.end,
                role: session.role,
                roleName: session.roleName,
                links: session.scheduleLinks.map(link =>
                    `${link.branch}/${link.section}[${link.index}]`
                )
            }))
        }))
    };
}

async function applyRepair() {
    const transaction = await beginTransaction();
    let committed = false;
    try {
        const state = await loadState({ transaction, allowUnpinned: false });
        if (state.applied) {
            await abandonTransaction(transaction);
            console.log(JSON.stringify({ mode: 'apply', status: 'already-applied', repairId: REPAIR_ID }, null, 2));
            return;
        }
        if (state.rolledBack) throw new Error('Safety gate: repair ID đã rollback; không tái sử dụng cùng ID.');
        const now = new Date().toISOString();
        const plan = buildApplyWrites(state, now);
        const localBackup = path.join(os.tmpdir(), `${REPAIR_ID}-${Date.now()}-backup.json`);
        fs.writeFileSync(localBackup, JSON.stringify(plan.backupPayload, null, 2), { flag: 'wx' });
        await request(`${ROOT}/documents:commit`, {
            method: 'POST',
            body: JSON.stringify({ writes: plan.writes, transaction })
        });
        committed = true;
        const verified = await loadState({ allowUnpinned: false });
        if (!verified.applied) throw new Error('Verification failed after apply.');
        console.log(JSON.stringify({
            mode: 'apply',
            status: 'complete',
            repairId: REPAIR_ID,
            localBackup,
            backupDocument: `migration_backups/${REPAIR_ID}`,
            attendanceDocuments: verified.targets.length,
            sessions: verified.manifest.counts.staffWindows
        }, null, 2));
    } finally {
        if (!committed) await abandonTransaction(transaction);
    }
}

async function rollbackRepair() {
    const transaction = await beginTransaction();
    let committed = false;
    try {
        // Rollback intentionally does not depend on the current schedule. The
        // immutable backup + exact applied fields are the rollback authority;
        // a legitimate later schedule edit must not strand recovery.
        const state = await loadRollbackState(transaction);
        if (state.rolledBack) {
            await abandonTransaction(transaction);
            console.log(JSON.stringify({ mode: 'rollback', status: 'already-rolled-back', repairId: REPAIR_ID }, null, 2));
            return;
        }
        const rolledBackAt = new Date().toISOString();
        const plan = buildRollbackWrites(state, rolledBackAt);
        await request(`${ROOT}/documents:commit`, {
            method: 'POST',
            body: JSON.stringify({ writes: plan.writes, transaction })
        });
        committed = true;
        const verified = await loadRollbackState();
        if (!verified.rolledBack) throw new Error('Verification failed after rollback.');
        console.log(JSON.stringify({ mode: 'rollback', status: 'complete', repairId: REPAIR_ID, rolledBackAt }, null, 2));
    } finally {
        if (!committed) await abandonTransaction(transaction);
    }
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArguments(argv);
    accessToken.cached = accessToken();
    if (args.apply) return applyRepair();
    if (args.rollback) return rollbackRepair();
    const state = await loadState({ allowUnpinned: true });
    const plan = state.backup ? null : buildApplyWrites(state, new Date().toISOString());
    console.log(JSON.stringify(dryRunSummary(state, args.mode, plan), null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.stack || error.message || error);
        process.exitCode = 1;
    });
}

module.exports = {
    PROJECT,
    DATE,
    MONTH,
    REPAIR_ID,
    BRANCHES,
    SECTIONS,
    EXPECTED,
    EXPECTED_MANIFEST_SHA256,
    EXPECTED_SCHEDULE_SHA256,
    EXPECTED_ATTENDANCE_SHA256,
    parseArguments,
    decode,
    decodeFields,
    encode,
    encodeFields,
    canonicalJson,
    sha256,
    exactScheduleISO,
    mainTeachers,
    substituteTeachers,
    activeWorkersForRow,
    registeredTeachers,
    mergeScheduleRegistrations,
    sanitizeInheritedSchedule,
    isCenterSectionClosed,
    buildManifest,
    assertExpectedManifest,
    hydrateTargets,
    assertOriginalSessionIsReplaceable,
    classifyOriginalSession,
    auditOriginalAttendance,
    evaluateExternalGates,
    buildAttendancePatch,
    attendanceFingerprint,
    fieldsFingerprint,
    buildApplyWrites,
    buildRollbackWrites,
    dryRunSummary,
    main
};
