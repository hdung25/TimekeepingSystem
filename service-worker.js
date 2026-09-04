// Service Worker v149 - the Primary-Admin payroll override and its direct
// +10-minute decision must arrive as one cache generation. This prevents an
// old report UI from sending a schedule-based request for a new absolute chip.
const CACHE_NAME = 'tdt-chamcong-v149-admin-payroll-override-20260904';

// Cache.addAll() rejects a batch containing the same request more than once in
// some browsers. Keep this Set boundary so a future page-specific release list
// cannot silently make the whole PWA installation fail.
const STATIC_ASSETS = Array.from(new Set([
    '/',
    '/index.html',
    '/admin.html',
    '/nhan-vien.html',
    '/cham-cong.html',
    '/bao-cao.html',
    '/lich-lam.html',
    '/lich-tiep-tan.html',
    '/lich-van-phong.html',
    '/quan-sat-ca.html',
    '/nhat-ky-ca.html',
    '/tuong-trinh.html',
    '/cham-bu.html',
    '/nhan-su.html',
    '/he-thong.html',
    '/mon-hoc.html',
    '/css/style.css?v=20260904-admin-payroll-override-v1',
    '/css/login.css?v=20260621-font',
    '/css/shift-oversight.css?v=20260816-cross-branch-auto-v1',
    '/js/main.js?v=20260904-admin-payroll-override-v1',
    '/js/startup-recovery.js?v=20260904-admin-payroll-override-v1',
    '/js/firebase-config.js?v=20260904-admin-payroll-override-v1',
    '/js/db-service.js?v=20260904-admin-payroll-override-v1',
    '/js/report.js?v=20260904-admin-payroll-override-v1',
    '/js/evaluation-service.js?v=20260904-admin-payroll-override-v1',
    '/js/shift-absence-state.js?v=20260904-admin-payroll-override-v1',
    '/js/admin-payroll-override.js?v=20260904-admin-payroll-override-v1',
    '/js/admin-payroll-override-ui.js?v=20260904-admin-payroll-override-v1',
    '/js/shift-oversight.js?v=20260904-admin-payroll-override-v1',
    // Keep the legacy key for cham-cong.html while caching the current key used
    // by the scheduler and the updated staff pages. A fresh cache must support
    // both paths offline during the page-version transition.
    '/js/ui-service.js?v=20260829-location-diagnostics-v3',
    '/js/ui-service.js?v=20260904-admin-payroll-override-v1',
    '/js/early10.js?v=20260904-admin-payroll-override-v1',
    '/js/schedule-attendance-admin.js?v=20260904-admin-payroll-override-v1',
    '/js/payroll-automation.js?v=20260809-payroll-safety-v1',
    '/js/subject-rate-policy.js?v=20260809-subject-rate-v1',
    '/js/mon-hoc.js?v=20260809-nested-groups-v1',
    '/js/personnel.js?v=20260904-admin-payroll-override-v1',
    '/js/auth-guard.js?v=20260904-admin-payroll-override-v1',
    '/js/auth-helper.js?v=20260904-admin-payroll-override-v1',
    '/js/chart-service.js?v=20260807-multi-gv-bulk-v1',
    '/js/analytics.js?v=20260904-admin-payroll-override-v1',
    '/js/note-repair.js?v=20260805-note-owner-fix-v1',
    '/js/schedule.js?v=20260904-admin-payroll-override-v1',
    '/js/teacher-shift-state.js?v=20260904-admin-payroll-override-v1',
    '/js/pdf-export.js?v=20260904-admin-payroll-override-v1',
    '/js/receptionist-schedule.js?v=20260904-admin-payroll-override-v1',
    '/js/timekeeping.js?v=20260904-admin-payroll-override-v1',
    '/js/salary-bulk-export.js?v=20260807-payslip-mobile-v1',
    '/images/TUDUYTRE.jpg',
    '/images/lotus_bg.png',
    '/manifest.json'
]));

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

    // Never cache third-party responses; their freshness and cache policies
    // are controlled by the upstream provider, not by this PWA.
    if (url.origin !== self.location.origin) return;

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
