import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

import { db } from "./firebase.js";

const ref = doc(db, "shop", "main");
const RATE = 0.044;

let state = null;
function save(){
  return setDoc(ref, state);
}

onSnapshot(ref, snap => {
  if(!snap.exists()) return;

  state = snap.data();

  if(!state.records) state.records = [];

  renderTodayBill();
});

function dateKey(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getRecordTime(r){
  return r.timestamp || r.closedAt || r.paidAt || r.time || r.date || Date.now();
}

function getTodayRecords(){
  return state.records.filter(r=>{
    const d = new Date(getRecordTime(r));
    if(isNaN(d.getTime())) return false;
    return dateKey(d.getTime()) === dateKey(Date.now());
  });
}

function toJPY(r){
  if(r.totalJPY !== undefined) return Number(r.totalJPY || 0);
  if(r.jpy !== undefined) return Number(r.jpy || 0);
  if(r.currency === "人民币") return Math.floor(Number(r.totalRMB || r.rmb || 0) / RATE);
  return 0;
}

function toRMB(r){
  if(r.totalRMB !== undefined) return Number(r.totalRMB || 0);
  if(r.rmb !== undefined) return Number(r.rmb || 0);
  return Math.floor(toJPY(r) * RATE);
}

function renderTodayBill(){
  const list = getTodayRecords();

  let jpyIncome = 0;
  let rmbIncome = 0;
  let convertedJPY = 0;
  let payStats = {};
  let typeStats = {walkin:0, booking:0};

  list.forEach(r=>{
    if(r.currency === "人民币"){
      const rmb = Number(r.totalRMB || r.rmb || 0);
      rmbIncome += rmb;
      convertedJPY += Math.floor(rmb / RATE);
    }else{
      const jpy = Number(r.totalJPY || r.jpy || 0);
      jpyIncome += jpy;
      convertedJPY += jpy;
    }

    const pay = r.pay || "未记录";
    payStats[pay] = (payStats[pay] || 0) + 1;

    const type = r.customerType || r.type || "walkin";
    typeStats[type] = (typeStats[type] || 0) + 1;
  });

  document.getElementById("todaySummary").innerHTML = `
    日元收入：¥${Math.floor(jpyIncome).toLocaleString()}<br>
    人民币收入：¥${Math.floor(rmbIncome).toLocaleString()}<br>
    换算总收入：¥${Math.floor(convertedJPY).toLocaleString()}<br>
    笔数：${list.length}
  `;

  document.getElementById("todayPayStats").innerHTML = `
    付款渠道：${Object.keys(payStats).map(k=>`${k} ${payStats[k]}笔`).join(" / ") || "暂无"}<br>
    客源：Walk-in ${typeStats.walkin || 0}笔 / 预约 ${typeStats.booking || 0}笔
  `;

  document.getElementById("todayRecords").innerHTML = [...list].reverse().map(r=>{
    const table = r.tableName || r.table || "";
    const name = r.customerName || r.name || "";
    const phone = r.phoneLast4 || "";
    const type = (r.customerType || r.type) === "booking" ? "预约" : "Walk-in";
    const packageName = r.packageName || "";
    const extra = r.extraMinutes || 0;
    const original = r.originalJPY || r.totalJPY || r.jpy || 0;

    return `
      <tr>
        <td>${r.closedTime || r.time || ""}</td>
        <td>${table}</td>
        <td>${name}${phone ? "("+phone+")" : ""}</td>
        <td>${type}</td>
        <td>${packageName}</td>
        <td>${extra}分</td>
        <td>¥${Number(original).toLocaleString()}</td>
        <td>¥${Number(toJPY(r)).toLocaleString()}</td>
        <td>¥${Number(toRMB(r)).toLocaleString()}</td>
        <td>${r.pay || ""}</td>
        <td>${r.currency || ""}</td>
        <td>${r.roundRule || ""}</td>
<td>
  ${r.receiptImage
    ? `<img src="${r.receiptImage}" style="width:60px;border-radius:8px;">`
    : `<button class="btn-ghost" onclick="uploadReceipt('${r.id}')">上传</button>`
  }
</td>
<td>
  ${Number(r.extraMinutes || 0) > 0
    ? (
        r.extensionConfirmed
          ? `已确认<br><small>${r.extensionConfirmedTime || ""}</small>`
          : `<button class="btn-main" onclick="confirmExtension('${r.id}')">续费确认</button>`
      )
    : "-"
  }
</td>        
      </tr>
    `;
  }).join("");
}

function uploadReceipt(recordId){
  alert("下一步要接收款截图上传功能：需要配合 today-bill.html 加 input。");
}

function confirmExtension(recordId){
  const r = state.records.find(x => x.id === recordId);
  if(!r) return;

  r.extensionConfirmed = true;
  r.extensionConfirmedAt = Date.now();
  r.extensionConfirmedTime = new Date().toLocaleString();

  save();
  alert("续费已确认");
}

window.confirmExtension = confirmExtension;
window.uploadReceipt = uploadReceipt;