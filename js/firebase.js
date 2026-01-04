// firebase.js (CDN ESM v10) — 언어/퍼시스턴스 옵션 + Firestore 조회 유틸 포함
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  useDeviceLanguage
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  collection, getDocs, query, where, limit
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";


import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js";

// ⚠ storageBucket은 일반적으로 PROJECT_ID.appspot.com
const firebaseConfig = {
  apiKey: "AIzaSyAfs8ZN-2ANX0lYvT_WVcOMXRkNB5usuRw",
  authDomain: "poniverse-3c351.firebaseapp.com",
  projectId: "poniverse-3c351",
  storageBucket: "poniverse-3c351.appspot.com",
  messagingSenderId: "608146456053",
  appId: "1:608146456053:web:711de65e21a2e54a6574bc",
  measurementId: "G-GFRG38YKVW"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

/* ===== 옵션 1) 브라우저 언어 적용 ===== */
try {
  useDeviceLanguage(auth); // 인증 관련 기본 언어를 브라우저 언어로
  // (대안) auth.languageCode = navigator?.language || "ko";
} catch (e) {
  console.warn("[Firebase] useDeviceLanguage 실패(무시 가능):", e?.message || e);
}

/* ===== 옵션 2) 로그인 유지(persistence) ===== */
const persistenceReady = setPersistence(auth, browserLocalPersistence).catch((e) => {
  // 사파리/시크릿 모드 등 일부 환경에서 로컬 퍼시스턴스가 불가할 수 있음
  console.warn("[Firebase] setPersistence 실패:", e?.message || e);
});

export {
  // Core instances
  app, auth, db, storage,

  // Auth APIs
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  useDeviceLanguage,

  // Firestore APIs
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  collection, getDocs, query, where, limit,


  // Helpers
  persistenceReady
};
 