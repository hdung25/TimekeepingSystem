const assert = require('node:assert/strict');
const Policy = require('../js/subject-rate-policy.js');

const subjects = [
    { id: 'eng', name: 'Tiếng Anh', isGroup: true, parentId: null },
    { id: 'eng-talk', name: 'Tiếng Anh giao tiếp', isGroup: true, parentId: 'eng' },
    { id: 'eng-school', name: 'Tiếng Anh trên trường', isGroup: true, parentId: 'eng' },
    { id: 'b1', name: 'B1', isGroup: false, parentId: 'eng-school' },
    { id: 'speaking', name: 'Speaking', isGroup: false, parentId: 'eng-talk' },
    { id: 'math', name: 'Toán - TV', isGroup: true, parentId: null },
    { id: 'math1', name: 'Toán 1', isGroup: false, parentId: 'math' },
    { id: 'tin', name: 'Tin học', isGroup: false, parentId: null }
];

const config = {
    roles: [
        { id: 'default', name: 'Mức mặc định cũ', rate: 30000 },
        { id: 'tin', name: 'Tin học', rate: 65000 }
    ],
    subjectRatePolicy: {
        mode: 'group',
        effectiveFrom: '2026-09-01',
        groupRates: [
            { groupId: 'eng', rate: 40000 },
            { groupId: 'eng-talk', rate: 45000 },
            { groupId: 'math', rate: 40000 }
        ]
    }
};

assert.equal(Policy.resolve(config, subjects, 'b1', '2026-08-31', 30000).rate, 30000);
assert.equal(Policy.resolve(config, subjects, 'b1', '2026-09-01').rate, 40000);
assert.equal(Policy.resolve(config, subjects, 'speaking', '2026-09-01').rate, 45000);
assert.equal(Policy.resolve(config, subjects, 'math1', '2026-09-01').rate, 40000);
assert.equal(Policy.resolve(config, subjects, 'tin', '2026-09-01').rate, 65000);
assert.equal(Policy.resolve(config, subjects, 'b1', '2026-09-01').path, 'Tiếng Anh › Tiếng Anh trên trường › B1');
assert.equal(Policy.groupOptions(subjects).find(item => item.id === 'eng-school').path, 'Tiếng Anh › Tiếng Anh trên trường');
assert.deepEqual(Policy.normalizePolicy({ mode: 'unknown', groupRates: [{ groupId: 'eng', rate: 0 }] }), {
    schemaVersion: 1,
    mode: 'legacy',
    effectiveFrom: '',
    groupRates: []
});

console.log('subject-rate-policy.test.js: all assertions passed');
