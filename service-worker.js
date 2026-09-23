// Service Worker v194 - inherited schedule deletion recovery.
// Install the new cache without interrupting
// old clients that may currently be recording attendance or saving payroll.
const CACHE_NAME = 'tdt-chamcong-v202-remind8-20260923';

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
    '/xet-tang-luong.html',
    '/he-thong.html',
    '/mon-hoc.html',
    '/hop-dinh-ky.html',
    '/hop-cua-toi.html',
    '/css/style.css?v=20260906-early10-recovery-v1',
    '/css/login.css?v=20260922-login-loading-v1',
    '/css/shift-oversight.css?v=20260816-cross-branch-auto-v1',
    '/css/salary-review.css?v=20260921-overview-v1',
    '/js/salary-review-policy.js?v=20260919-review-v1',
    '/js/salary-review-application.js?v=20260919-review-v1',
    '/js/salary-review-service.js?v=20260919-review-v1',
    '/js/salary-review-notifications.js?v=20260919-review-v1',
    '/js/salary-review.js?v=20260921-overview-v1',
    '/js/salary-review-overview-policy.js?v=20260921-overview-v1',
    '/js/salary-review-overview.js?v=20260921-overview-v1',
    '/js/main.js?v=20260923-remind8-v1',
    '/js/startup-recovery.js?v=20260906-early10-recovery-v1',
    '/js/firebase-config.js?v=20260906-early10-recovery-v1',
    '/js/db-service.js?v=20260923-remind8-v1',
    '/js/meeting-attendance-policy.js?v=20260923-remind8-v1',
    '/js/report.js?v=20260923-student-count-save-v1',
    '/js/teacher-attendance-policy.js?v=20260911-meeting-sync-v1',
    '/js/teacher-attendance-editor.js?v=20260910-hours-bonus-v1',
    '/js/payroll-review.js?v=20260912-payroll-recall-v1',
    '/js/evaluation-service.js?v=20260914-autoclose-subject-v1',
    '/js/shift-absence-state.js?v=20260906-early10-recovery-v1',
    '/js/admin-payroll-override.js?v=20260906-early10-recovery-v1',
    '/js/admin-payroll-override-ui.js?v=20260910-admin-override-default-v1',
    '/js/shift-oversight.js?v=20260906-early10-recovery-v1',
    '/js/ui-service.js?v=20260912-schedule-blank-guard-v1',
    '/js/early10.js?v=20260912-early10-nanos-v1',
    '/js/schedule-attendance-admin.js?v=20260906-early10-recovery-v1',
    '/js/payroll-automation.js?v=20260809-payroll-safety-v1',
    '/js/subject-rate-policy.js?v=20260809-subject-rate-v1',
    '/js/mon-hoc.js?v=20260908-feedback-repair-v1',
    '/js/personnel.js?v=20260908-incident-recovery-v1',
    '/js/auth-guard.js?v=20260919-review-v1',
    '/js/auth-helper.js?v=20260906-early10-recovery-v1',
    '/js/chart-service.js?v=20260906-early10-recovery-v1',
    '/js/analytics.js?v=20260923-remind8-v1',
    '/js/note-repair.js?v=20260805-note-owner-fix-v1',
    '/js/schedule.js?v=20260923-remind8-v1',
    '/js/teacher-shift-state.js?v=20260906-early10-recovery-v1',
    '/js/pdf-export.js?v=20260908-payroll-review-v2',
    '/js/receptionist-schedule.js?v=20260908-payroll-review-v2',
    '/js/timekeeping.js?v=20260919-resume-schedule-v1',
    '/js/salary-bulk-export.js?v=20260922-payroll-list-v1',
    '/images/TUDUYTRE.jpg',
    '/images/lotus_bg.png',
    '/manifest.json'
]));

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            // Download now, activate after old tabs close. Forcing activation
            // would make pre-fix clients reload in the middle of a live write.
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

    // Script/CSS có ?v= đổi mã mỗi khi đổi nội dung (kèm CACHE_NAME mới), nên trả ngay
    // bản đã lưu thay vì chờ mạng cho ~1,5MB script ở mỗi lần mở trang; vẫn tải lại ở nền
    // để lần mở sau luôn có nội dung mới nhất. HTML và tệp không có ?v= vẫn ưu tiên mạng.
    const isVersionedAsset = url.searchParams.has('v') &&
        (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'));
    if (isVersionedAsset) {
        const network = fetch(event.request);
        const stored = network.then(response => {
            if (!response.ok) return undefined;
            const copy = response.clone();
            return caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }).catch(() => undefined);
        event.waitUntil(stored);
        event.respondWith(
            caches.open(CACHE_NAME)
                .then(cache => cache.match(event.request))
                .then(cached => cached || network)
        );
        return;
    }

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

// Thông báo đẩy (FCM, gói dữ liệu) — hiện được cả khi app đang tắt. Trình duyệt bắt buộc
// mỗi lần đẩy phải hiện một thông báo, nên luôn hiện kể cả khi thiếu nội dung.
self.addEventListener('push', event => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; }
    catch (_) { payload = { data: { body: event.data ? event.data.text() : '' } }; }
    const data = payload.data || payload.notification || payload || {};
    const tag = String(data.tag || '').slice(0, 120);
    event.waitUntil(self.registration.showNotification(String(data.title || 'Chấm Công TDT').slice(0, 120), {
        body: String(data.body || 'Bạn có thông báo mới.').slice(0, 400),
        icon: '/images/TUDUYTRE.jpg',
        badge: '/images/TUDUYTRE.jpg',
        tag: tag || undefined,
        renotify: !!tag,
        vibrate: [200, 100, 200],
        data: { url: String(data.link || '') }
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    // Thông báo có thể mang trang đích (vd. cham-bu.html khi chấm bù bị từ chối). Chỉ nhận
    // đường dẫn nội bộ cùng origin.
    const wanted = String(event.notification.data?.url || '');
    const target = /^[a-z0-9-]+\.html(\?[\w=&%-]*)?$/i.test(wanted) ? '/' + wanted : '/nhan-vien.html';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if ('focus' in client) {
                    if (wanted && 'navigate' in client) return client.navigate(target).then(c => (c || client).focus());
                    return client.focus();
                }
            }
            if (self.clients.openWindow) return self.clients.openWindow(target);
        })
    );
});
