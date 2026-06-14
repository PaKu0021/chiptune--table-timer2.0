import { db } from "./firebase.js";
import { doc,onSnapshot } from
"https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const ref = doc(db,"shop","main");

const query =
  new URLSearchParams(location.search);

const start = query.get("start") || "";
const end = query.get("end") || "";
const pay = query.get("pay") || "";

function dateKey(ts){
  const d = new Date(ts);

  return `${d.getFullYear()}-${String(
    d.getMonth()+1
  ).padStart(2,"0")}-${String(
    d.getDate()
  ).padStart(2,"0")}`;
}

onSnapshot(ref,snap=>{

  if(!snap.exists()) return;

  const state = snap.data();

  const rows =
    (state.records || []).filter(r=>{

      const key = dateKey(r.timestamp);

      if(start && key < start) return false;
      if(end && key > end) return false;
      if(pay && r.pay !== pay) return false;

      return true;
    });

  document.getElementById("printRows").innerHTML =
    rows.map(r=>`
      <tr>
        <td>${r.time||""}</td>
        <td>${r.tableName||""}</td>
        <td>${r.customerName||""}</td>
        <td>${r.packageName||""}</td>
        <td>¥${Number(r.totalJPY||0).toLocaleString()}</td>
        <td>${r.pay||""}</td>
      </tr>
    `).join("");

  setTimeout(()=>{
    window.print();
  },300);
});