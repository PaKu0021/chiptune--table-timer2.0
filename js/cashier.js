import { db } from "./firebase.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const ref = doc(db, "shop", "main");
const RATE = 0.044;

let state = null;

function dateKey(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getTodayDate(){
  return dateKey(Date.now());
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

function toRMB(r){
  if(r.currency === "人民币"){
    return Number(r.totalRMB || r.rmb || 0);
  }

  return Math.floor(toJPY(r) * RATE);
}

function setQuickRange(type){
  const now = new Date();
  let start = "";
  let end = "";

  if(type === "today"){
    start = getTodayDate();
    end = getTodayDate();
  }

  if(type === "week"){
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);

    start = dateKey(monday.getTime());
    end = getTodayDate();
  }

  if(type === "month"){
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    start = dateKey(first.getTime());
    end = getTodayDate();
  }

  if(type === "all"){
    start = "";
    end = "";
  }

  document.getElementById("startDate").value = start;
  document.getElementById("endDate").value = end;

  renderCashier();
}

function getFilteredRecords(){
  if(!state) return [];

  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;
  const pay = document.getElementById("payFilter").value;

  return (state.records || []).filter(r=>{
    const ts = getRecordTime(r);
    const d = new Date(ts);
    if(isNaN(d.getTime())) return false;

    const key = dateKey(d.getTime());

    if(start && key < start) return false;
    if(end && key > end) return false;
    if(pay && r.pay !== pay) return false;

    return true;
  }).sort((a,b)=>getRecordTime(a) - getRecordTime(b));
}

function renderCashier(){
  const rows = getFilteredRecords();

  document.getElementById("cashierTitle").innerText =
    `收款明细｜${rows.length}笔`;

  document.getElementById("cashierRows").innerHTML = rows.map(r=>{
    const customer = `${r.customerName || ""}${r.phoneLast4 ? "（" + r.phoneLast4 + "）" : ""}`;

    return `
      <tr>
        <td>${r.time || ""}</td>
        <td>${r.tableName || ""}</td>
        <td>${customer || "-"}</td>
        <td>${(r.customerType || r.type) === "booking" ? "预约" : "Walk-in"}</td>
        <td>${r.packageName || ""}</td>
        <td>¥${Number(r.originalJPY || 0).toLocaleString()}</td>
        <td>¥${toJPY(r).toLocaleString()}</td>
        <td>¥${toRMB(r).toLocaleString()}</td>
        <td>${r.pay || "未记录"}</td>
        <td>${r.currency || ""}</td>
        <td>${r.roundRule || ""}</td>
      </tr>
    `;
  }).join("");

  renderSummary(rows);
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
  let totalRMB = 0;

  rows.forEach(r=>{
    const pay = r.pay || "未记录";
    const jpy = toJPY(r);
    const rmb = toRMB(r);

    if(!pays[pay]) pays[pay] = 0;

    pays[pay] += jpy;
    totalJPY += jpy;
    totalRMB += rmb;
  });

  document.getElementById("cashierSummary").innerHTML = `
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
        <tr>
          <td><b>人民币参考</b></td>
          <td><b>¥${Math.floor(totalRMB).toLocaleString()}</b></td>
        </tr>
      </tbody>
    </table>
  `;
}

function exportCashierCSV(){
  const rows = getFilteredRecords();

  const headers = [
    "时间","桌位","客人姓名","手机尾号","类型","套餐",
    "原价日元","实收日元","人民币","支付方式","币种","抹零"
  ];

  const body = rows.map(r=>[
    r.time || "",
    r.tableName || "",
    r.customerName || "",
    r.phoneLast4 || "",
    (r.customerType || r.type) === "booking" ? "预约" : "Walk-in",
    r.packageName || "",
    r.originalJPY || 0,
    toJPY(r),
    toRMB(r),
    r.pay || "",
    r.currency || "",
    r.roundRule || ""
  ]);

  const csv = [headers, ...body]
    .map(row=>row.map(v=>`"${String(v ?? "").replace(/"/g,'""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type:"text/csv;charset=utf-8"
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `收银记录_${getTodayDate()}.csv`;
  a.click();
}

function printCashier(){
  window.print();
}

onSnapshot(ref, snap=>{
  if(!snap.exists()) return;

  state = snap.data();

  if(!state.records) state.records = [];

  setQuickRange("today");
});

window.setQuickRange = setQuickRange;
window.renderCashier = renderCashier;
window.exportCashierCSV = exportCashierCSV;
window.printCashier = printCashier;