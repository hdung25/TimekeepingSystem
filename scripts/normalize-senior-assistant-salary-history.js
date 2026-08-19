const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT = 'timekeeping-69f3f';
const DATABASE = '(default)';
const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}`;
const DOC_ROOT = `${ROOT}/documents`;
const STAFF_ID = 'nv_1772981835537';
const MIGRATION_ID = 'senior-assistant-salary-history-20260814-v1';
const apply = process.argv.includes('--apply');

function token() {
    const gcloud = 'C:\\Users\\Admin\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1';
    return execFileSync('powershell.exe', ['-NoProfile', '-File', gcloud, 'auth', 'print-access-token'], {
        encoding: 'utf8', windowsHide: true
    }).trim();
}

async function request(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${token.cached}`, 'Content-Type': 'application/json' }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status}: ${text}`);
    return text ? JSON.parse(text) : null;
}

const clone = value => JSON.parse(JSON.stringify(value));

async function main() {
    token.cached = token();
    const now = new Date().toISOString();
    const rows = await request(`${DOC_ROOT}:runQuery`, {
        method: 'POST',
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'salary_settings_monthly' }] } })
    });
    const documents = rows
        .filter(row => row.document?.name.endsWith(`_${STAFF_ID}`))
        .map(row => row.document)
        .sort((a, b) => a.name.localeCompare(b.name));

    const plan = documents.map(document => {
        const published = clone(document.fields.published?.mapValue?.fields || {});
        const detailsTt = clone(published.details_tt);
        if (!detailsTt?.mapValue?.fields) throw new Error(`Missing details_tt in ${document.name}`);
        const tt = detailsTt.mapValue.fields;

        published.role = { stringValue: 'tiep-tan' };
        published.details = detailsTt;
        published.details_tt = detailsTt;
        for (const field of ['baseSalary', 'netPay', 'totalBonus', 'stats', 'advance']) {
            if (tt[field]) published[field] = clone(tt[field]);
        }
        published.breakdown = { arrayValue: { values: [] } };
        published.historicalRoleMigrationId = { stringValue: MIGRATION_ID };
        published.historicalRoleMigratedAt = { stringValue: now };
        delete published.details_gv;
        delete published.status_gv;
        delete published.publishedAt_gv;

        return {
            id: document.name.split('/').pop(),
            beforeRole: document.fields.published?.mapValue?.fields?.role?.stringValue || '',
            status: published.status?.stringValue || '',
            removesTeacherSettings: !!document.fields.giao_vien,
            document,
            published: { mapValue: { fields: published } }
        };
    });

    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        migrationId: MIGRATION_ID,
        documents: plan.map(({ id, beforeRole, status, removesTeacherSettings }) => ({
            id, beforeRole, afterRole: 'tiep-tan', status, removesTeacherSettings
        }))
    }, null, 2));
    if (!apply) return;
    if (plan.length !== 4 || plan.some(item => item.beforeRole !== 'dual')) {
        throw new Error('Safety gate: expected exactly four dual-role salary history documents');
    }

    const backup = {
        migrationId: MIGRATION_ID,
        createdAt: now,
        documents: plan.map(item => item.document)
    };
    const backupJson = JSON.stringify(backup);
    const backupPath = path.join(os.tmpdir(), `${MIGRATION_ID}-backup.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { flag: 'wx' });
    await request(`${DOC_ROOT}/migration_backups/${MIGRATION_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: {
            migrationId: { stringValue: MIGRATION_ID },
            createdAt: { timestampValue: now },
            description: { stringValue: 'Normalize published senior-assistant salary history to the existing receptionist details without recalculation.' },
            payload: { stringValue: backupJson }
        } })
    });

    const writes = plan.map(item => ({
        update: { name: item.document.name, fields: { published: item.published } },
        updateMask: { fieldPaths: ['published', 'giao_vien'] },
        currentDocument: { updateTime: item.document.updateTime }
    }));
    await request(`${ROOT}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });

    const verified = await Promise.all(plan.map(item => request(`${DOC_ROOT}/salary_settings_monthly/${item.id}`)));
    verified.forEach(document => {
        const fields = document.fields;
        const published = fields.published?.mapValue?.fields || {};
        if (published.role?.stringValue !== 'tiep-tan' || published.details_gv || fields.giao_vien) {
            throw new Error(`Verification failed for ${document.name}`);
        }
    });
    console.log(JSON.stringify({
        status: 'complete',
        documentsNormalized: verified.length,
        backupDocument: `migration_backups/${MIGRATION_ID}`,
        localBackup: backupPath
    }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
