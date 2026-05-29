importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDRaQF1N4p9J3q1k0eBNdKzvnwvcAZwY6g",
  authDomain: "chiptune-table-timer.firebaseapp.com",
  projectId: "chiptune-table-timer",
  storageBucket: "chiptune-table-timer.firebasestorage.app",
  messagingSenderId: "524748960844",
  appId: "1:524748960844:web:958f11454796be7366f0e9",
  measurementId: "G-68TF8QWDT9"
});

try {
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(function(payload) {
    const title = payload.notification?.title || "Chiptune 提醒";
    const options = {
      body: payload.notification?.body || "桌位时间提醒",
      icon: "./icon.png",
      badge: "./icon.png"
    };

    self.registration.showNotification(title, options);
  });
} catch (e) {
  console.error("Firebase Messaging SW 初始化失败：", e);
}
