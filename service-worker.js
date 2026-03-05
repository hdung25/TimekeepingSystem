// Service Worker v10 — Network-first for app files, Cache for offline
const CACHE_NAME = 'tdt-chamcong-v10';

// Static files to pre-cache on install
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
    '/css/style.css',
    '/css/login.css',
    '/js/main.js',
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

// Install: Pre-cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: Clean ALL old caches immediately
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch: Network-first for app files, skip Firebase
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip Firestore/Firebase API calls — always go network
    if (url.hostname.includes('firestore') ||
        url.hostname.includes('googleapis') ||
        url.hostname.includes('firebase') ||
        url.hostname.includes('gstatic')) {
        return;
    }

    // Skip non-http(s) schemes (chrome-extension, etc.)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return;
    }

    // Network-first for HTML and JS — always get latest, cache for offline
    if (url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname === '/') {
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

    // Cache-first for static assets (CSS, images, manifest)
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
