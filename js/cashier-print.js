import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const ref = doc(db,"shop","main");
const RATE = 0.044;

const query = new URLSearchParams(location.search);
const start = query.get("start") || "";
const end = query.get("end") || "";
const pay = query.get("pay") || "";

function dateKey(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getRecordTime(r){
  return r.timestamp || r.time || r.date || 0;
}

function toJPY(r){
  if(r.currency === "人民币"){
    return Math.floor(Number(r.totalRMB || r.rmb || 0) / RATE);
  }
  return Number(r.totalJPY || r.jpy || 0);
}

function renderSummary(rows){
  const pays = {
    "现金":0,
    "PayPay":0,
    "微信":0,
    "支付宝":0,
    "未记录":0
  };

  let totalJPY = 0;

  rows.forEach(r=>{
    const p = r.pay || "未记录";
    const jpy = toJPY(r);

    if(!pays[p]) pays[p] = 0;

    pays[p] += jpy;
    totalJPY += jpy;
  });

  document.getElementById("printSummary").innerHTML = `
    <table class="record-table">
      <tbody>
        ${Object.keys(pays).map(k=>`
          <tr>
            <td><b>${k}</b></td>
            <td>¥${Math.floor(pays[k]).toLocaleString()}</td>
          </tr>
        `).join("")}
        <tr>
          <td><b>日元总计</b></td>
          <td><b>¥${Math.floor(totalJPY).toLocaleString()}</b></td>
        </tr>
      </tbody>
    </table>
  `;
}

getDoc(ref).then(snap=>{
  if(!snap.exists()) return;

  const state = snap.data();

  const rows = (state.records || []).filter(r=>{
    const ts = getRecordTime(r);
    const d = new Date(ts);

    if(isNaN(d.getTime())) return false;

    const key = dateKey(d.getTime());

    if(start && key < start) return false;
    if(end && key > end) return false;
    if(pay && r.pay !== pay) return false;

    return true;
  });

  document.getElementById("printTitle").innerText =
    `收银记录｜${start || "全部"} ～ ${end || "全部"}｜${pay || "全部支付方式"}｜${rows.length}笔`;

  document.getElementById("printRows").innerHTML =
    rows.map(r=>`
      <tr>
        <td>${r.time || ""}</td>
        <td>${r.tableName || ""}</td>
        <td>${r.customerName || ""}${r.phoneLast4 ? "（" + r.phoneLast4 + "）" : ""}</td>
        <td>${r.packageName || ""}</td>
        <td>¥${toJPY(r).toLocaleString()}</td>
        <td>${r.pay || "未记录"}</td>
      </tr>
    `).join("");

  renderSummary(rows);
});