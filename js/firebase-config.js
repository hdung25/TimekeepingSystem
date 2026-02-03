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

