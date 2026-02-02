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
let db;
let auth;

if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
    console.log("Firebase initialized successfully!");
} else {
    console.error("Firebase SDK chưa được tải! Vui lòng kiểm tra lại file HTML.");
}
