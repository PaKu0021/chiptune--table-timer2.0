import { db, storage } from "./firebase.js";

import {
  doc,
  onSnapshot,
  setDoc,
  collection,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js";

async function uploadReceipt(timestamp,file){

  if(!file) return;

  const record = records.find(
    r=>Number(r.timestamp) === Number(timestamp)
  );

  if(!record){
    alert("找不到这条收银记录");
    return;
  }

  const path =
    `receipts/${record.id}/${Date.now()}_${file.name}`;

  const imgRef = storageRef(storage,path);

  await uploadBytes(imgRef,file);

  const url = await getDownloadURL(imgRef);

  record.receiptImage = url;
  record.receiptPath = path;
  record.receiptFileName = file.name || "";
  record.receiptUploadedAt = Date.now();

  await setDoc(
    doc(db,"records",record.id),
    record
  );

  alert("截图已保存");
}


function viewReceipt(timestamp){
  const record = records.find(r=>Number(r.timestamp) === Number(timestamp));

  if(!record || !record.receiptImage){
    alert("没有截图");
    return;
  }

  let bg = document.getElementById("receiptPreviewBg");

  if(!bg){
    bg = document.createElement("div");
    bg.id = "receiptPreviewBg";
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal">
        <h2>收款截图</h2>
        <img id="receiptPreviewImg" style="width:100%;border-radius:16px;margin:12px 0;">
        <button class="btn-ghost full" onclick="closeReceiptPreview()">关闭</button>
      </div>
    `;
    document.body.appendChild(bg);
  }

  document.getElementById("receiptPreviewImg").src = record.receiptImage;
  bg.style.display = "block";
}

function closeReceiptPreview(){
  document.getElementById("receiptPreviewBg").style.display = "none";
}

    

const ref = doc(db, "shop", "main");
const RATE = 0.044;

let state = null;
let records = [];
let quickRange = "today";
let initialized = false; 

function get90DaysAgo(){

  const d = new Date();

  d.setDate(d.getDate() - 90);

  return d.getTime();
}

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
  quickRange = type;
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

    return records.filter(r=>{
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
        <td>${r.roundRule === "批量结账" ? "不抹零" : (r.roundRule || "")}</td>
        <td>
  ${
    r.pay === "现金"
      ? "现金无需截图"
      : `
        ${r.receiptImage ? `
  <img
    src="${r.receiptImage}"
    onclick="viewReceipt(${r.timestamp})"
    style="width:64px;height:64px;object-fit:cover;border-radius:10px;border:1px solid #e6dccb;"
  >
` : ""}
      <input
          type="file"
          accept="image/*"
          onchange="uploadReceipt(${r.timestamp}, this.files[0])"
        >
      `
  }
</td>
      </tr>
    `;
  }).join("");

  renderSummary(rows);
  renderCashierButtons();
}

function renderCashierButtons(){
  ["today","week","month","all"].forEach(k=>{
    document
      .getElementById("cashier_" + k)
      ?.classList.toggle("active", quickRange === k);
  });
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
    "原价日元","实收日元","人民币","支付方式","币种","抹零","收款截图"
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
    r.roundRule === "批量结账" ? "不抹零" : (r.roundRule || ""),
    r.receiptImage ? "已上传" : "未上传"
  ]);

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

  const summaryRows = [
    [],
    ["支付方式总计"],
    ["支付方式","金额（日元）"],
    ...Object.keys(pays).map(k=>[k, Math.floor(pays[k])]),
    ["日元总计", Math.floor(totalJPY)],
    ["人民币参考", Math.floor(totalRMB)]
  ];

  const csv = [
    headers,
    ...body,
    ...summaryRows
  ]
    .map(row=>row.map(v=>`"${String(v ?? "").replace(/"/g,'""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type:"text/csv;charset=utf-8"
  });

  const start = document.getElementById("startDate").value || "全部";
  const end = document.getElementById("endDate").value || "全部";
  const pay = document.getElementById("payFilter").value || "全部支付方式";

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `收银记录_${start}_${end}_${pay}.csv`;
  a.click();
}

function printCashier(){
  const rows = getFilteredRecords();

  const lightRows = rows.map(r=>({
    time:r.time || "",
    tableName:r.tableName || "",
    customerName:r.customerName || "",
    phoneLast4:r.phoneLast4 || "",
    packageName:r.packageName || "",
    pay:r.pay || "未记录",
    currency:r.currency || "",
    totalJPY:r.totalJPY || r.jpy || 0,
    totalRMB:r.totalRMB || r.rmb || 0
  }));

  const payload = {
    start: document.getElementById("startDate").value || "全部",
    end: document.getElementById("endDate").value || "全部",
    pay: document.getElementById("payFilter").value || "全部支付方式",
    rows: lightRows
  };

  sessionStorage.setItem("cashier_print_data", JSON.stringify(payload));

  location.href = "./cashier-print.html";
}


onSnapshot(ref, snap=>{
  if(!snap.exists()) return;

  state = snap.data();

  if(!initialized){
    initialized = true;
    setQuickRange("today");
  }
});

const recordsQuery = query(
  collection(db,"records"),
  where("timestamp",">=",get90DaysAgo())
);

onSnapshot(recordsQuery,snap=>{

  records = snap.docs
    .map(d=>d.data())
    .filter(r=>r.id !== "init");

  if(state){
    renderCashier();
  }
});


function applyDateFilter(){
  renderCashier();
}


async function cleanupOldReceipts(){
  if(!confirm("确定清理90天前的收款截图记录吗？图片文件可能仍保留在 Storage，但账单里将不再显示。")) return;

  const limit = Date.now() - 90 * 24 * 60 * 60 * 1000;
  let count = 0;

records.forEach(r=>{    
    if(r.receiptUploadedAt && r.receiptUploadedAt < limit){
      delete r.receiptImage;
      delete r.receiptPath;
      delete r.receiptFileName;
      delete r.receiptUploadedAt;
      delete r.receiptUploadedTime;
      count++;
    }
  });

await Promise.all(
  records.map(r=>
    setDoc(doc(db,"records",r.id),r)
  )
);  
  alert(`已清理 ${count} 条90天前截图记录`);
}

window.applyDateFilter = applyDateFilter;
window.setQuickRange = setQuickRange;
window.renderCashier = renderCashier;
window.exportCashierCSV = exportCashierCSV;
window.printCashier = printCashier;
window.uploadReceipt = uploadReceipt;
window.viewReceipt = viewReceipt;
window.closeReceiptPreview = closeReceiptPreview;
window.cleanupOldReceipts = cleanupOldReceipts;