'use strict';
// Read-only production smoke for the auto check-out resume fix. Never logs in or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const origin = 'https://timekeeping-system-tawny.vercel.app';
const version = '20260911-auto-checkout-resume-v1';
const mainVersion = '20260911-position-allowance-v1';
const cacheName = 'tdt-chamcong-v179-early10-legacy-20260911';
const digest = value => crypto.createHash('sha256')
    .update(Buffer.from(value.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex');
const fetchText = async file => {
    const response = await fetch(`${origin}/${file}`, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
    assert.equal(response.status, 200, file);
    return Buffer.from(await response.arrayBuffer());
};
(async () => {
    for (const file of ['js/main.js', 'js/timekeeping.js', 'service-worker.js']) {
        const remote = await fetchText(file.endsWith('.js') && file !== 'service-worker.js' ? `${file}?v=${version}` : file);
        assert.equal(digest(remote), digest(fs.readFileSync(path.join(root, file))), 'Production must match local: ' + file);
        console.log('PASS hash', file);
    }
    const chamCong = (await fetchText('cham-cong.html')).toString('utf8');
    assert.ok(chamCong.includes(`js/main.js?v=${mainVersion}`) && chamCong.includes(`js/timekeeping.js?v=${version}`));
    assert.ok((await fetchText('nhan-vien.html')).toString('utf8').includes(`js/main.js?v=${mainVersion}`));
    assert.ok((await fetchText('service-worker.js')).toString('utf8').includes(cacheName));
    console.log('PASS production auto check-out resume release is live');
})().catch(error => { console.error(error); process.exitCode = 1; });
