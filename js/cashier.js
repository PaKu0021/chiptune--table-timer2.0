import { db } from "./firebase.js?v=2.5.2";

import { loadLocalRecords, mergeRecordLists, saveRecordSafely, installConnectionGuard, flushPending, subscribeAllRecords } from "./safe-state.js?v=2.5.2";


import {
  doc,
  onSnapshot,
  setDoc,
  collection,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";


async function uploadReceipt(recordId,file){
  if(!file) return;

  const record = records.find(r=>r.id === recordId);

  if(!record){
    alert("找不到这条收银记录");
    return;
  }

  const compressedBlob = await compressImage(file);
  const base64 = await fileToBase64(compressedBlob);

  record.receiptImage = base64;
  delete record.receiptPath;
  record.receiptFileName = file.name || "";
  record.receiptUploadedAt = Date.now();
  record.receiptUploadedTime = new Date().toLocaleString();

  await setDoc(
    doc(db,"records",record.id),
    record
  );

  alert("截图已保存");
}

function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function viewReceipt(recordId){
  const record = records.find(r=>r.id === recordId);

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
      <div class="modal" style="max-height:90vh;overflow:auto;">
        <h2>收款截图</h2>
        <img
          id="receiptPreviewImg"
          style="
            width:100%;
            height:auto;
            border-radius:16px;
            margin:12px 0;
            display:block;
          "
        >
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
installConnectionGuard();
loadLocalRecords().then(localRecords=>{
  records = mergeRecordLists(records, localRecords);
  renderCashier();
}).catch(err=>console.warn("读取本机收银记录失败",err));


window.addEventListener("chiptune-online-change",e=>{
  if(e.detail?.online){
    flushPending({db,ref}).catch(err=>console.warn("自动同步失败",err));
  }
});
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
  return r.closedAt || r.paidAt || r.timestamp || r.time || r.date || 0;
}

function getRecordBusinessDate(r){
  if(r.businessDate) return r.businessDate;

  const d = new Date(r.startAt || r.timestamp || r.time || r.date || Date.now());
  return dateKey(d.getTime());
}


function normalizePayments(r){
  if(Array.isArray(r.payments)) return r.payments;

  const amount = Number(r.totalJPY || r.jpy || 0);

  if(amount !== 0){
    return [{
      type:"收入",
      reason:r.checkoutMethod || "历史记录",
      pay:r.pay || "未记录",
      amountJPY:amount,
      amountRMB:Number(r.totalRMB || r.rmb || 0),
      note:"旧数据",
      time:r.time || "",
      timestamp:r.timestamp || Date.now()
    }];
  }

  return [];
}

function isRmbPayment(p, r){
  const pay = p.pay || r.pay || "";
  return pay === "微信" || pay === "支付宝" || p.currency === "人民币" || r.currency === "人民币";
}

function paymentJPY(p){
  return Number(p.amountJPY || 0);
}

function paymentRMB(p){
  if(p.amountRMB !== undefined){
    return Number(p.amountRMB || 0);
  }
  return Math.floor(Number(p.amountJPY || 0) * RATE);
}

function sumPaymentsJPY(r){
  return normalizePayments(r)
    .reduce((sum,p)=>sum + Number(p.amountJPY || 0),0);
}

function paymentDetailText(r){
  const list = normalizePayments(r);

  if(!list.length) return r.pay || "未记录";

  return list.map(p=>{
    const amount = Number(p.amountJPY || 0);
    const sign = amount < 0 ? "-" : "+";

    return `${p.reason || p.type || ""}｜${p.pay || "未记录"}｜${isRmbPayment(p, r)
  ? `${sign}人民币 ¥${Math.abs(paymentRMB(p)).toLocaleString()}（日元换算 ¥${Math.abs(amount).toLocaleString()}）`
  : `${sign}日元 ¥${Math.abs(amount).toLocaleString()}`
}${p.note ? "｜" + p.note : ""}`;
  }).join(" / ");
}

function paymentDetailHTML(r){
  const list = normalizePayments(r);

  if(!list.length) return r.pay || "未记录";

  return list.map(p=>{
    const amount = Number(p.amountJPY || 0);
    const sign = amount < 0 ? "-" : "+";
    const cls = amount < 0 ? "color:#e85d5d;font-weight:900;" : "font-weight:800;";

    return `
      <div style="${cls}">
        ${p.reason || p.type || ""}｜
        ${p.pay || "未记录"}｜
        ${isRmbPayment(p, r)
  ? `${sign}人民币 ¥${Math.abs(paymentRMB(p)).toLocaleString()}（日元换算 ¥${Math.abs(amount).toLocaleString()}）`
  : `${sign}日元 ¥${Math.abs(amount).toLocaleString()}`
}
        ${p.note ? `<br><small style="color:#8a8174;">${p.note}</small>` : ""}
      </div>
    `;
  }).join("");
}

function getPaySummary(r){
  const pays = [...new Set(
    normalizePayments(r)
      .filter(p=>Number(p.amountJPY || 0) !== 0)
      .map(p=>p.pay || "未记录")
  )];

  if(pays.length === 0) return r.pay || "未记录";
  if(pays.length === 1) return pays[0];
  return "混合";
}


function toJPY(r){
  if(Array.isArray(r.payments)){
    return sumPaymentsJPY(r);
  }

  if(r.currency === "人民币"){
    return Math.floor(Number(r.totalRMB || r.rmb || 0) / RATE);
  }

  return Number(r.totalJPY || r.jpy || 0);
}

function toRMB(r){
  if(Array.isArray(r.payments)){
    return Math.floor(toJPY(r) * RATE);
  }

  if(r.currency === "人民币"){
    return Number(r.totalRMB || r.rmb || 0);
  }

  return Math.floor(toJPY(r) * RATE);
}

function actualRMBIncome(r){
  return normalizePayments(r).reduce((sum,p)=>{
    if(isRmbPayment(p,r)){
      return sum + paymentRMB(p);
    }
    return sum;
  },0);
}

function displayCurrency(r){
  const list = normalizePayments(r);
  const hasRmb = list.some(p=>isRmbPayment(p,r));
  const hasJpy = list.some(p=>!isRmbPayment(p,r));

  if(hasRmb && hasJpy) return "混合";
  if(hasRmb) return "人民币";
  return "日元";
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
  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;
  const pay = document.getElementById("payFilter").value;

  return records.filter(r=>{
    const key = getRecordBusinessDate(r);

    if(start && key < start) return false;
    if(end && key > end) return false;

    if(pay){
      const hasPay = normalizePayments(r).some(p=>{
        return (p.pay || "未记录") === pay;
      });

      if(!hasPay) return false;
    }

    return true;
  }).sort((a,b)=>{
    const da = getRecordBusinessDate(a);
    const db = getRecordBusinessDate(b);

    if(da !== db) return da.localeCompare(db);

    return getRecordTime(a) - getRecordTime(b);
  });
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
        <td>${paymentDetailHTML(r)}</td>
        <td>${displayCurrency(r)}</td>        
        <td>${r.roundRule === "批量结账" ? "不抹零" : (r.roundRule || "")}</td>
        <td>
  ${

    getPaySummary(r) === "现金"
      ? "现金无需截图"
      : `
        ${r.receiptImage ? `
  <img
    src="${r.receiptImage}"
    onclick="viewReceipt('${r.id}')"
    style="width:64px;height:64px;object-fit:cover;border-radius:10px;border:1px solid #e6dccb;"
  >
` : ""}
      <input
          type="file"
          accept="image/*"
          onchange="uploadReceipt('${r.id}',this.files[0])"          
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
  normalizePayments(r).forEach(p=>{
    const pay = p.pay || "未记录";
    const jpy = paymentJPY(p);

    if(!pays[pay]) pays[pay] = 0;

    pays[pay] += jpy;
    totalJPY += jpy;

    if(isRmbPayment(p,r)){
      totalRMB += paymentRMB(p);
    }
  });
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
    "原价日元","实收日元","人民币","收支明细","币种","抹零","收款截图"
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
    paymentDetailText(r),    
    displayCurrency(r),
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
  normalizePayments(r).forEach(p=>{
    const pay = p.pay || "未记录";
    const jpy = paymentJPY(p);

    if(!pays[pay]) pays[pay] = 0;

    pays[pay] += jpy;
    totalJPY += jpy;

    if(isRmbPayment(p,r)){
      totalRMB += paymentRMB(p);
    }
  });
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

  customerType:r.customerType || r.type || "",
  packageName:r.packageName || "",
  originalJPY:r.originalJPY || 0,

  pay:getPaySummary(r),
  paymentDetail:paymentDetailText(r),
  payments:normalizePayments(r),  
  currency:r.currency || "",
  roundRule:r.roundRule || "",

  totalJPY:toJPY(r),
  totalRMB:toRMB(r),  

  receiptImage:r.receiptImage || ""
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

subscribeAllRecords({
  db,
  onChange:list=>{ records=list; renderCashier(); },
  onStatus:text=>{
    const el=document.getElementById("recordMigrationStatus");
    if(el) el.textContent=text;
  }
});


function applyDateFilter(){
  renderCashier();
}


async function cleanupOldReceipts(){
  if(!confirm("确定清理90天前的收款截图吗？\n\nFirestore里的截图字段会清空，Storage里的图片文件也会删除。")) return;

  const limit = Date.now() - 90 * 24 * 60 * 60 * 1000;
  let count = 0;

  const targets = records.filter(r=>{
    return r.receiptUploadedAt &&
           r.receiptUploadedAt < limit &&
           (r.receiptImage || r.receiptPath);
  });

  for(const r of targets){

    delete r.receiptImage;
    delete r.receiptPath;
    delete r.receiptFileName;
    delete r.receiptUploadedAt;
    delete r.receiptUploadedTime;

    await setDoc(doc(db,"records",r.id),r);
    count++;
  }

alert(`已清理 ${count} 条90天前截图`);  
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