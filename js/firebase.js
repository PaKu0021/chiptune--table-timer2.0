import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  initializeFirestore,
  memoryLocalCache,
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

function isAppleTouchDevice(){
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
}

const params = new URLSearchParams(location.search);
const forceMemory = params.has("firestore-memory") || params.has("ipad-safe");
const forcePersistent = params.has("firestore-persistent");
const useIPadSafeFirestore = !forcePersistent && (forceMemory || isAppleTouchDevice());

try{
  const settings = useIPadSafeFirestore
    ? {
        localCache: memoryLocalCache(),
        experimentalForceLongPolling: true,
        ignoreUndefinedProperties: true
      }
    : {
        localCache: persistentLocalCache({tabManager:persistentMultipleTabManager()}),
        experimentalAutoDetectLongPolling: true,
        ignoreUndefinedProperties: true
      };
  firestoreDb = initializeFirestore(app, settings);
  window.__CHIPTUNE_FIRESTORE_MODE__ = useIPadSafeFirestore ? "ipad-safe-memory-long-polling" : "persistent-cache";
}catch(err){
  console.warn("Firestore 初始化失败，改用内存缓存实时连接",err);
  firestoreDb = getFirestore(app);
  window.__CHIPTUNE_FIRESTORE_MODE__ = "fallback-default";
}
export const db = firestoreDb;
