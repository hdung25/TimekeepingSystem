// ================= SUBJECT RATE POLICY =================
// Additive, side-effect-free resolver for teaching rates.
// The legacy salary_config.roles array remains the exact-subject override list.
(function (global) {
    'use strict';

    var SCHEMA_VERSION = 1;

    function asText(value) {
        return String(value == null ? '' : value).trim();
    }

    function asRate(value) {
        var rate = Number(value);
        return Number.isFinite(rate) && rate > 0 ? Math.round(rate) : 0;
    }

    function validDateKey(value) {
        var key = asText(value);
        return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
    }

    function mapById(items) {
        var map = {};
        (Array.isArray(items) ? items : []).forEach(function (item) {
            if (item && item.id != null) map[String(item.id)] = item;
        });
        return map;
    }

    function normalizePolicy(raw) {
        var source = raw || {};
        var groups = Array.isArray(source.groupRates) ? source.groupRates : [];
        return {
            schemaVersion: Number(source.schemaVersion) || SCHEMA_VERSION,
            mode: source.mode === 'group' ? 'group' : 'legacy',
            effectiveFrom: validDateKey(source.effectiveFrom),
            groupRates: groups.map(function (entry) {
                return {
                    groupId: asText(entry && (entry.groupId || entry.id)),
                    groupName: asText(entry && entry.groupName),
                    path: asText(entry && entry.path),
                    rate: asRate(entry && entry.rate)
                };
            }).filter(function (entry) { return entry.groupId && entry.rate > 0; })
        };
    }

    function isActive(rawPolicy, dateKey) {
        var policy = normalizePolicy(rawPolicy);
        if (policy.mode !== 'group') return false;
        if (!policy.effectiveFrom) return true;
        var date = validDateKey(dateKey);
        return !!date && date >= policy.effectiveFrom;
    }

    function pathForNode(nodeId, subjects) {
        var byId = mapById(subjects);
        var current = byId[String(nodeId)];
        var parts = [];
        var seen = {};
        while (current && !seen[String(current.id)]) {
            seen[String(current.id)] = true;
            parts.unshift(asText(current.name));
            current = current.parentId == null ? null : byId[String(current.parentId)];
        }
        return parts.filter(Boolean).join(' › ');
    }

    function ancestorGroups(subjectId, subjects) {
        var byId = mapById(subjects);
        var current = byId[String(subjectId)];
        var result = [];
        var seen = {};
        while (current && current.parentId != null && !seen[String(current.id)]) {
            seen[String(current.id)] = true;
            var parent = byId[String(current.parentId)];
            if (!parent) break;
            result.push(parent);
            current = parent;
        }
        return result;
    }

    function exactLegacyRate(config, subjectId) {
        var roles = config && Array.isArray(config.roles) ? config.roles : [];
        var id = asText(subjectId);
        var found = roles.find(function (role) {
            return asText(role && role.id) === id && asRate(role && role.rate) > 0;
        });
        return found ? asRate(found.rate) : 0;
    }

    function fallbackLegacyRate(config) {
        var roles = config && Array.isArray(config.roles) ? config.roles : [];
        var found = roles.find(function (role) { return asRate(role && role.rate) > 0; });
        return found ? asRate(found.rate) : 0;
    }

    function resolve(config, subjects, subjectId, dateKey, fallbackRate) {
        var catalog = Array.isArray(subjects) ? subjects : [];
        var byId = mapById(catalog);
        var subject = byId[asText(subjectId)] || null;
        var exact = exactLegacyRate(config || {}, subjectId);
        if (exact > 0) {
            return { rate: exact, source: 'subject_override', subject: subject, path: pathForNode(subjectId, catalog) };
        }

        var policy = normalizePolicy(config && config.subjectRatePolicy);
        var legacyFallback = fallbackLegacyRate(config || {}) || asRate(fallbackRate);
        if (!isActive(policy, dateKey)) {
            return { rate: legacyFallback, source: 'legacy', subject: subject, path: pathForNode(subjectId, catalog) };
        }

        var configured = {};
        policy.groupRates.forEach(function (entry) { configured[entry.groupId] = entry; });
        var candidates = [];
        if (subject && subject.isGroup === true) candidates.push(subject);
        ancestorGroups(subjectId, catalog).forEach(function (group) { candidates.push(group); });
        for (var i = 0; i < candidates.length; i += 1) {
            var groupRate = configured[String(candidates[i].id)];
            if (groupRate && groupRate.rate > 0) {
                return {
                    rate: groupRate.rate,
                    source: 'group',
                    groupId: String(candidates[i].id),
                    groupName: groupRate.groupName || candidates[i].name || '',
                    subject: subject,
                    path: pathForNode(subjectId, catalog)
                };
            }
        }

        return { rate: legacyFallback, source: 'legacy_fallback', subject: subject, path: pathForNode(subjectId, catalog) };
    }

    function leafOptions(config, subjects, dateKey, fallbackRate) {
        return (Array.isArray(subjects) ? subjects : [])
            .filter(function (subject) { return subject && subject.isGroup !== true; })
            .map(function (subject) {
                var resolved = resolve(config, subjects, subject.id, dateKey, fallbackRate);
                return {
                    id: String(subject.id),
                    name: asText(subject.name),
                    path: pathForNode(subject.id, subjects),
                    rate: resolved.rate,
                    source: resolved.source,
                    groupId: resolved.groupId || '',
                    groupName: resolved.groupName || ''
                };
            });
    }

    function groupOptions(subjects) {
        return (Array.isArray(subjects) ? subjects : [])
            .filter(function (subject) { return subject && subject.isGroup === true; })
            .map(function (group) {
                return {
                    id: String(group.id),
                    name: asText(group.name),
                    path: pathForNode(group.id, subjects)
                };
            });
    }

    function normalizeGroupRates(rawRates, subjects) {
        var byId = mapById(subjects);
        return (Array.isArray(rawRates) ? rawRates : []).map(function (entry) {
            var id = asText(entry && (entry.groupId || entry.id));
            var group = byId[id];
            return {
                groupId: id,
                groupName: asText(entry && entry.groupName) || asText(group && group.name),
                path: asText(entry && entry.path) || pathForNode(id, subjects),
                rate: asRate(entry && entry.rate)
            };
        }).filter(function (entry) { return entry.groupId && entry.rate > 0; });
    }

    global.SubjectRatePolicy = {
        SCHEMA_VERSION: SCHEMA_VERSION,
        normalizePolicy: normalizePolicy,
        isActive: isActive,
        pathForNode: pathForNode,
        ancestorGroups: ancestorGroups,
        resolve: resolve,
        leafOptions: leafOptions,
        groupOptions: groupOptions,
        normalizeGroupRates: normalizeGroupRates,
        asRate: asRate
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = global.SubjectRatePolicy;
})(typeof window !== 'undefined' ? window : globalThis);
