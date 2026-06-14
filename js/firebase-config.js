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

// Global helper to wait for Firebase Auth to restore session
window.waitAuth = function() {
    return new Promise((resolve) => {
        if (typeof firebase === 'undefined' || !firebase.auth) {
            resolve(null);
            return;
        }

        // Show loading overlay if UIService is loaded
        if (window.UIService && typeof window.UIService.showLoading === 'function') {
            window.UIService.showLoading("Đang kết nối hệ thống...");
        }

        let resolved = false;
        const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
            if (resolved) return;
            resolved = true;
            unsubscribe();
            if (window.UIService && typeof window.UIService.hideLoading === 'function') {
                window.UIService.hideLoading();
            }
            resolve(user);
        });

        // Timeout fallback: 3 seconds
        setTimeout(() => {
            if (resolved) return;
            resolved = true;
            unsubscribe();
            if (window.UIService && typeof window.UIService.hideLoading === 'function') {
                window.UIService.hideLoading();
            }
            const currentUser = firebase.auth().currentUser;
            if (!currentUser) {
                console.warn("Auth check timed out without active session.");
                if (window.UIService && typeof window.UIService.toast === 'function') {
                    window.UIService.toast("Kết nối chậm. Vui lòng tải lại trang hoặc kiểm tra mạng!", "error");
                }
            }
            resolve(currentUser);
        }, 3000);
    });
};

