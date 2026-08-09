// Service Worker v69 - network-first for app shell/assets, cache fallback for offline.
const CACHE_NAME = 'tdt-chamcong-v124-history-roster-20260809';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/admin.html',
    '/nhan-vien.html',
    '/cham-cong.html',
    '/bao-cao.html',
    '/lich-lam.html',
    '/lich-tiep-tan.html',
    '/quan-sat-ca.html',
    '/nhat-ky-ca.html',
    '/tuong-trinh.html',
    '/cham-bu.html',
    '/nhan-su.html',
    '/he-thong.html',
    '/mon-hoc.html',
    '/css/style.css?v=20260808-combined-v1',
    '/css/login.css?v=20260621-font',
    '/css/shift-oversight.css?v=20260717-gv-absence-v1',
    '/js/main.js?v=20260808-combined-v1',
    '/js/firebase-config.js',
    '/js/db-service.js?v=20260809-history-roster-v7',
    '/js/report.js?v=20260809-history-roster-v7',
    '/js/evaluation-service.js?v=20260809-history-roster-v7',
    '/js/shift-oversight.js?v=20260717-gv-absence-v1',
    '/js/ui-service.js?v=20260808-combined-v1',
    '/js/early10.js?v=20260809-chip-policy-v1',
    '/js/payroll-automation.js?v=20260809-payroll-safety-v1',
    '/js/subject-rate-policy.js?v=20260809-subject-rate-v1',
    '/js/mon-hoc.js?v=20260809-nested-groups-v1',
    '/js/personnel.js?v=20260809-group-rates-v1',
    '/js/auth-guard.js?v=20260725-admin-edit-fix-v1',
    '/js/chart-service.js?v=20260807-multi-gv-bulk-v1',
    '/js/analytics.js',
    '/js/note-repair.js?v=20260805-note-owner-fix-v1',
    '/js/schedule.js?v=20260806-no-false-absent-v1',
    '/js/receptionist-schedule.js?v=20260628-gps-receptionist-persistence',
    '/js/timekeeping.js?v=20260807-multi-gv-bulk-v1',
    '/js/salary-bulk-export.js?v=20260807-payslip-mobile-v1',
    '/images/TUDUYTRE.jpg',
    '/images/lotus_bg.png',
    '/manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
            .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
            .then(clients => {
                clients.forEach(client => client.postMessage({
                    type: 'APP_UPDATED',
                    version: CACHE_NAME
                }));
            })
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    if (event.request.method !== 'GET') return;

    if (
        url.hostname.includes('firestore') ||
        url.hostname.includes('googleapis') ||
        url.hostname.includes('firebase') ||
        url.hostname.includes('gstatic')
    ) {
        return;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    const isAppFile =
        url.pathname === '/' ||
        url.pathname.endsWith('.html') ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.css') ||
        url.pathname.endsWith('/manifest.json');

    if (isAppFile) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            return fetch(event.request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                if (event.request.headers.get('accept')?.includes('text/html')) {
                    return caches.match('/index.html');
                }
            });
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow('/nhan-vien.html');
        })
    );
});
