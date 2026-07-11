import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

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
let firestoreDb;
try{
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({tabManager:persistentMultipleTabManager()})
  });
}catch(err){
  console.warn("Firestore 持久化缓存初始化失败，改用普通实时连接",err);
  firestoreDb = getFirestore(app);
}
export const db = firestoreDb;
