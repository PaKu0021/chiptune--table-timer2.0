import { db } from "./firebase.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { getQuery, formatTime } from "./common.js";

const tableId = getQuery("table");

const ref = doc(db, "shop", "main");

const title = document.getElementById("title");
const timeEl = document.getElementById("time");
const statusEl = document.getElementById("status");

onSnapshot(ref, snap=>{
  if(!snap.exists()) return;

  const data = snap.data();
  const table = data.tables[tableId - 1];

  if(!table){
    title.innerText = "桌位不存在";
    return;
  }

  title.innerText = table.name + " · 实时计时";

  if(!table.start){
    timeEl.innerText = "--:--:--";
    statusEl.innerText = "尚未开始";
    return;
  }

  const elapsed = Date.now() - table.start;

  timeEl.innerText = formatTime(elapsed);

  statusEl.innerText = table.type === "booking" ? "预约客户" : "现场客户";
});