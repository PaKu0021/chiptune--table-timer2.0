import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDRaQF1N4p9J3q1k0eBNdKzvnwvcAZwY6g",
  authDomain: "chiptune-table-timer.firebaseapp.com",
  projectId: "chiptune-table-timer"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);