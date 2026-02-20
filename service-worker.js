// Service Worker v4 — Cache-first for static, Network-first for Firestore
const CACHE_NAME = 'tdt-chamcong-v4';

// Static files to pre-cache on install
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/admin.html',
    '/nhan-vien.html',
    '/cham-cong.html',
    '/bao-cao.html',
    '/lich-lam.html',
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

// Activate: Clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch: Network-first for API/Firestore, Cache-first for static
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip Firestore/Firebase API calls — always go network
    if (url.hostname.includes('firestore') ||
        url.hostname.includes('googleapis') ||
        url.hostname.includes('firebase')) {
        return;
    }

    // For everything else: Cache-first, fallback to network
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            return fetch(event.request).then(response => {
                // Cache successful responses
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                // Offline fallback for HTML pages
                if (event.request.headers.get('accept')?.includes('text/html')) {
                    return caches.match('/index.html');
                }
            });
        })
    );
});
