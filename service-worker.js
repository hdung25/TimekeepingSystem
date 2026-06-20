// Service Worker v12 - network-first for app shell/assets, cache fallback for offline.
const CACHE_NAME = 'tdt-chamcong-v12-season-mobile';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/admin.html',
    '/nhan-vien.html',
    '/cham-cong.html',
    '/bao-cao.html',
    '/lich-lam.html',
    '/lich-tiep-tan.html',
    '/nhan-su.html',
    '/he-thong.html',
    '/css/style.css?v=20260620-season-mobile',
    '/css/login.css?v=20260620-season-mobile',
    '/js/main.js?v=20260620-season-mobile',
    '/js/login-theme.js?v=20260620-season-mobile',
    '/js/firebase-config.js',
    '/js/db-service.js',
    '/js/ui-service.js',
    '/js/auth-guard.js',
    '/js/chart-service.js',
    '/js/analytics.js',
    '/js/schedule.js',
    '/js/receptionist-schedule.js',
    '/images/TUDUYTRE.jpg',
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
