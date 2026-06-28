import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDRaQF1N4p9J3q1k0eBNdKzvnwvcAZwY6g",
  authDomain: "chiptune-table-timer.firebaseapp.com",
  projectId: "chiptune-table-timer",
  storageBucket: "chiptune-table-timer.firebasestorage.app",
  messagingSenderId: "524748960844",
  appId: "1:524748960844:web:958f11454796be7366f0e9",
  measurementId: "G-68TF8QWDT9"
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);

export const storage = getStorage(app);