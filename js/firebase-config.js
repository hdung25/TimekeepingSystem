// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyAgzP0fMd8e1y-mQPjl7b7sCHPHK5BDyuY",
    authDomain: "timekeeping-69f3f.firebaseapp.com",
    projectId: "timekeeping-69f3f",
    storageBucket: "timekeeping-69f3f.firebasestorage.app",
    messagingSenderId: "825341425684",
    appId: "1:825341425684:web:8df432be16e4c8eed5cf01",
    measurementId: "G-BX27BRSFNF"
};

// Khởi tạo Firebase (Compat Version)
// Khởi tạo Firebase (Compat Version)
window.db = null;
window.auth = null;

if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);

    // --- APP CHECK INIT ---
    // Disable on localhost to avoid reCAPTCHA errors and network blocks
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // DISABLE APP CHECK FOR NOW TO FIX VERCEL LOGIN
    // if (firebase.appCheck && !isLocal) {
    //     const appCheck = firebase.appCheck();
    //     appCheck.activate(
    //         new firebase.appCheck.ReCaptchaEnterpriseProvider('6LcM-mAsAAAAANJDIP-izupJvAupsh1V6tccmWzI'),
    //         {
    //             isTokenAutoRefreshEnabled: true
    //         }
    //     );
    //     console.log("Security: App Check Activated! 🛡️");
    // } else {
    //     if (isLocal) console.log("Security: App Check Disabled on Localhost ⚠️");
    // }

    window.db = firebase.firestore();
    window.auth = firebase.auth();
    console.log("Firebase initialized successfully!");
} else {
    console.error("Firebase SDK chưa được tải! Vui lòng kiểm tra lại file HTML.");
    // Fallback: Check again on load
    window.addEventListener('load', () => {
        if (typeof firebase !== 'undefined' && !window.db) {
            console.log("Retry initializing Firebase on window load...");
            firebase.initializeApp(firebaseConfig);
            window.db = firebase.firestore();
            window.auth = firebase.auth();
        }
    });
}

// Global helper to wait for Firebase Auth to restore session. Multiple features
// call this during startup, so share one observer/promise instead of racing
// several loading overlays and timeout handlers.
let firebaseAuthRestorePromise = null;
window.waitAuth = function() {
    if (firebaseAuthRestorePromise) return firebaseAuthRestorePromise;

    firebaseAuthRestorePromise = new Promise((resolve) => {
        if (typeof firebase === 'undefined' || !firebase.auth) {
            resolve(null);
            return;
        }

        const authInstance = window.auth || firebase.auth();
        if (!authInstance) {
            resolve(null);
            return;
        }

        // Show loading overlay if UIService is loaded
        if (window.UIService && typeof window.UIService.showLoading === 'function') {
            window.UIService.showLoading("Đang kết nối hệ thống...");
        }

        let resolved = false;
        let timeoutId = null;
        let unsubscribe = null;
        const finish = (user, timedOut = false) => {
            if (resolved) return;
            resolved = true;
            if (timeoutId) clearTimeout(timeoutId);
            if (typeof unsubscribe === 'function') unsubscribe();
            if (window.UIService && typeof window.UIService.hideLoading === 'function') {
                window.UIService.hideLoading();
            }
            if (timedOut && !user) {
                console.warn("Auth check timed out without active session.");
                if (window.UIService && typeof window.UIService.toast === 'function') {
                    window.UIService.toast("Kết nối chậm. Vui lòng tải lại trang hoặc kiểm tra mạng!", "error");
                }
            }
            resolve(user || null);
        };

        try {
            unsubscribe = authInstance.onAuthStateChanged(
                user => finish(user),
                error => {
                    console.error('Firebase Auth restore failed:', error);
                    finish(null);
                }
            );
            // Defend against test doubles/non-standard implementations that call
            // the observer synchronously before returning their unsubscribe.
            if (resolved && typeof unsubscribe === 'function') unsubscribe();
        } catch (error) {
            console.error('Firebase Auth observer could not start:', error);
            finish(null);
            return;
        }

        // Slow mobile networks can legitimately need several seconds to restore
        // IndexedDB credentials and refresh the token. Keep a finite fail-closed
        // timeout without treating a normal 3-second delay as a logged-out user.
        if (!resolved) {
            timeoutId = setTimeout(() => finish(authInstance.currentUser, true), 15000);
        }
    });

    return firebaseAuthRestorePromise;
};

