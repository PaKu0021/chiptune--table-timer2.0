import { doc, onSnapshot, setDoc, collection } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";


import { db } from "./firebase.js";

const ref = doc(db, "shop", "main");
const recordsRef = collection(db, "records");
const RATE = 0.044;

let state = null;
let records = [];
let editingRecordId = null;
let uploadingPaymentRecordId = null;
let uploadingPaymentIndex = null;
let uploadingGroupId = null;
let uploadingGroupPaymentIndex = null;


onSnapshot(ref, snap => {
  if(!snap.exists()) return;

  state = snap.data();

if(!Array.isArray(state.groups)){
  state.groups = [];
}

renderTodayBill();
  
});

onSnapshot(recordsRef, snap => {

  records = snap.docs
  .map(d => ({
    id: d.id,
    ...d.data()
  }))
  .filter(r => r.id !== "init");


  renderTodayBill();
});

function dateKey(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getRecordBusinessDate(r){
  if(r.businessDate) return r.businessDate;

  const d = new Date(r.startAt || r.timestamp || r.time || r.date || Date.now());
  return dateKey(d.getTime());
}

function getRecordTime(r){
  return r.closedAt || r.paidAt || r.timestamp || r.time || r.date || Date.now();
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
      note:"旧数据"
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

function paymentDetailHTML(r){
  const list = normalizePayments(r);

  if(!list.length) return r.pay || "未记录";

  return list.map((p,i)=>{
    const amount = Number(p.amountJPY || 0);
    const sign = amount < 0 ? "-" : "+";
    const style = amount < 0
      ? "color:#e85d5d;font-weight:900;"
      : "font-weight:800;";

    const pay = p.pay || "未记录";
    const needReceipt = pay !== "现金" && amount !== 0;

    let receiptHTML = "";

    if(needReceipt){
      if(p.receiptImage){
        receiptHTML = `
          <br>
          <button class="btn-ghost" onclick="viewPaymentReceipt('${r.id}',${i})">
            查看截图
          </button>
        `;
      }else{
        receiptHTML = `
          <br>
          <button class="btn-main" onclick="uploadPaymentReceipt('${r.id}',${i})">
            上传截图
          </button>
        `;
      }
    }else{
      receiptHTML = `<br><small style="color:#8a8174;">现金无需截图</small>`;
    }

    return `
      <div style="${style}">
        ${p.reason || p.type || ""}｜
        ${pay}｜
        ${isRmbPayment(p, r)
  ? `${sign}人民币 ¥${Math.abs(paymentRMB(p)).toLocaleString()}（日元换算 ¥${Math.abs(amount).toLocaleString()}）`
  : `${sign}日元 ¥${Math.abs(amount).toLocaleString()}`
}
        ${p.note ? `<br><small style="color:#8a8174;">${p.note}</small>` : ""}
        ${receiptHTML}
      </div>
    `;
  }).join("");
}

function getTodayRecords(){
  return records.filter(r=>{
    return getRecordBusinessDate(r) === dateKey(Date.now());
  });
}



function getGroupMap(){
  const map = {};

  (state?.groups || []).forEach(g=>{
    map[g.id] = g;
  });

  return map;
}

function getRecordsByGroup(list){
  const map = {};
  const singles = [];

  list.forEach(r=>{
    if(r.groupId){
      if(!map[r.groupId]) map[r.groupId] = [];
      map[r.groupId].push(r);
    }else{
      singles.push(r);
    }
  });

  return {map, singles};
}

function toJPY(r){
  if(Array.isArray(r.payments)){
    return sumPaymentsJPY(r);
  }

  if(r.totalJPY !== undefined) return Number(r.totalJPY || 0);
  if(r.jpy !== undefined) return Number(r.jpy || 0);
  if(r.currency === "人民币") return Math.floor(Number(r.totalRMB || r.rmb || 0) / RATE);
  return 0;
}


function toRMB(r){
  if(Array.isArray(r.payments)){
    return Math.floor(toJPY(r) * RATE);
  }

  if(r.totalRMB !== undefined) return Number(r.totalRMB || 0);
  if(r.rmb !== undefined) return Number(r.rmb || 0);
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

function compressImage(file, maxWidth = 600, quality = 0.45){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const reader = new FileReader();

    reader.onload = e=>{
      img.src = e.target.result;
    };

    img.onload = ()=>{
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(blob=>{
        if(!blob){
          reject(new Error("图片压缩失败"));
          return;
        }

        resolve(new File(
          [blob],
          file.name.replace(/\.[^.]+$/, "") + ".jpg",
          { type:"image/jpeg" }
        ));
      }, "image/jpeg", quality);
    };

    img.onerror = reject;
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderTodayBill(){
  const list = getTodayRecords();
  const groupMap = getGroupMap();

  let jpyIncome = 0;
  let rmbIncome = 0;
  let convertedJPY = 0;
  let payStats = {};
  let typeStats = {walkin:0, booking:0};

  list.forEach(r=>{

  normalizePayments(r).forEach(p=>{
    const jpy = paymentJPY(p);

    convertedJPY += jpy;

    if(isRmbPayment(p, r)){
      rmbIncome += paymentRMB(p);
    }else{
      jpyIncome += jpy;
    }

    const pay = p.pay || r.pay || "未记录";
    payStats[pay] = (payStats[pay] || 0) + jpy;
  });

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
  付款渠道：${Object.keys(payStats).map(k=>`${k} ¥${Math.floor(payStats[k]).toLocaleString()}`).join(" / ") || "暂无"}
  <br>
    客源：Walk-in ${typeStats.walkin || 0}笔 / 预约 ${typeStats.booking || 0}笔
  `;

  const { map:groupRecords, singles } = getRecordsByGroup([...list].reverse());

  let html = "";

  Object.keys(groupRecords).forEach(groupId=>{
    const rows = groupRecords[groupId];
    const group = groupMap[groupId];

    html += `
      <tr style="background:${group?.color || "#eef8ff"};font-weight:900;">
        <td colspan="15">
          👥 ${group?.name || rows[0]?.groupName || "未命名组"}
          （${rows.map(r=>r.tableName).join("、")}）
        </td>
      </tr>
    `;

    if(group?.payments?.length){
      html += `
        <tr>
          <td colspan="15" style="background:#fffaf0;font-weight:800;">
            整组付款：${group.payments.map(p=>`

              ${p.reason || "整组收款"}｜
              ${p.pay || "未记录"}｜
              ¥${Number(p.amountJPY || 0).toLocaleString()}｜
              付款人：${p.payer || "-"}
              ${p.pay && p.pay !== "现金"
  ? (
      p.receiptImage
        ? `<br><button class="btn-ghost" onclick="viewGroupPaymentReceipt('${group.id}',${group.payments.indexOf(p)})">查看整组截图</button>`
        : `<br><button class="btn-main" onclick="uploadGroupPaymentReceipt('${group.id}',${group.payments.indexOf(p)})">上传整组截图</button>`
    )
  : `<br><small style="color:#8a8174;">现金无需截图</small>`
}

            `).join("<br>")}
          </td>
        </tr>
      `;
    }

    rows.forEach(r=>{
      html += renderRecordRow(r,false);
    });
  });

  singles.forEach(r=>{
    html += renderRecordRow(r,true);
  });

  document.getElementById("todayRecords").innerHTML = html;
}


function renderRecordRow(r, showReceipt = true){
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
      <td>${name}${phone ? "(" + phone + ")" : ""}</td>
      <td>${type}</td>
      <td>${packageName}</td>
      <td>${extra}分</td>
      <td>¥${Number(original).toLocaleString()}</td>
      <td>¥${Number(toJPY(r)).toLocaleString()}</td>
      <td>¥${Number(actualRMBIncome(r)).toLocaleString()}</td>
      <td>${paymentDetailHTML(r)}</td>
      <td>${displayCurrency(r)}</td>
      <td>${r.roundRule || ""}</td>
      <td>
        ${showReceipt
          ? (
              r.receiptImage
                ? `<img src="${r.receiptImage}" onclick="viewReceipt('${r.id}')" style="width:60px;height:60px;object-fit:cover;border-radius:8px;cursor:pointer;">`
                : `<button class="btn-ghost" onclick="uploadReceipt('${r.id}')">上传</button>`
            )
          : "-"
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
      <td>
        <button class="btn-ghost" onclick="openEditRecord('${r.id}')">
          修改
        </button>
      </td>
    </tr>
  `;
}

function uploadReceipt(recordId){
  const input = document.getElementById("receiptInput");
  if(!input){
    alert("找不到 receiptInput，请先在 today-bill.html 加上传 input");
    return;
  }

  input.value = "";
  input.dataset.recordId = recordId;
  input.click();
}

function uploadPaymentReceipt(recordId, paymentIndex){
  const input = document.getElementById("receiptInput");

  if(!input){
    alert("找不到 receiptInput");
    return;
  }

  uploadingPaymentRecordId = recordId;
  uploadingPaymentIndex = Number(paymentIndex);

  input.value = "";
  input.dataset.recordId = "";
  input.click();
}

function uploadGroupPaymentReceipt(groupId, paymentIndex){
  const input = document.getElementById("receiptInput");

  if(!input){
    alert("找不到 receiptInput");
    return;
  }

  uploadingGroupId = groupId;
  uploadingGroupPaymentIndex = Number(paymentIndex);

  uploadingPaymentRecordId = null;
  uploadingPaymentIndex = null;

  input.value = "";
  input.dataset.recordId = "";
  input.click();
}

async function handleReceiptFileChange(e){

  const file = e.target.files?.[0];
  const recordId = e.target.dataset.recordId;

if(!file) return;

if(uploadingGroupId !== null && uploadingGroupPaymentIndex !== null){
  await handleGroupPaymentReceiptFile(file);
  return;
}

if(uploadingPaymentRecordId !== null && uploadingPaymentIndex !== null){
  await handlePaymentReceiptFile(file);
  return;
}

if(!recordId) return;

  const r = records.find(x=>x.id===recordId);

  if(!r){
    alert("找不到这条账单");
    return;
  }

  try{

    const compressed = await compressImage(file,800,0.6);

    const base64 = await fileToBase64(compressed);

    r.receiptImage = base64;
    r.receiptFileName = file.name;
    r.receiptUploadedAt = Date.now();
    r.receiptUploadedTime = new Date().toLocaleString();

    await setDoc(
      doc(db,"records",r.id),
      r
    );

    alert("收款截图已保存");

  }catch(err){

    console.error(err);
    alert(err.message);

  }

}

function fileToBase64(file){

  return new Promise((resolve,reject)=>{

    const reader = new FileReader();

    reader.onload = ()=>resolve(reader.result);

    reader.onerror = reject;

    reader.readAsDataURL(file);

  });

}

async function handlePaymentReceiptFile(file){

  const record = records.find(r=>r.id===uploadingPaymentRecordId);

  if(!record){
    alert("找不到账单");
    return;
  }

  if(!Array.isArray(record.payments)){
    alert("这条账单没有 payments");
    return;
  }

  const payment = record.payments[uploadingPaymentIndex];

  if(!payment){
    alert("找不到付款记录");
    return;
  }

  try{

    const compressed = await compressImage(file,800,0.6);

    const base64 = await fileToBase64(compressed);

    payment.receiptImage = base64;
    payment.receiptFileName = file.name;
    payment.receiptUploadedAt = Date.now();
    payment.receiptUploadedTime = new Date().toLocaleString();

    await setDoc(
      doc(db,"records",record.id),
      record
    );

    uploadingPaymentRecordId = null;
    uploadingPaymentIndex = null;

    alert("付款截图已保存");

  }catch(err){

    console.error(err);
    alert(err.message);

  }

}

async function handleGroupPaymentReceiptFile(file){
  const group = (state.groups || []).find(g=>String(g.id) === String(uploadingGroupId));

  if(!group){
    alert("找不到整组记录");
    return;
  }

  const payment = group.payments?.[uploadingGroupPaymentIndex];

  if(!payment){
    alert("找不到整组付款记录");
    return;
  }

  try{
    const compressed = await compressImage(file,800,0.6);
    const base64 = await fileToBase64(compressed);

    payment.receiptImage = base64;
    payment.receiptFileName = file.name;
    payment.receiptUploadedAt = Date.now();
    payment.receiptUploadedTime = new Date().toLocaleString();

    await setDoc(ref,state);

    uploadingGroupId = null;
    uploadingGroupPaymentIndex = null;

    alert("整组付款截图已保存");

  }catch(err){
    console.error(err);
    alert(err.message);
  }
}


function viewReceipt(recordId){
  const r = records.find(x => x.id === recordId);

  if(!r || !r.receiptImage){
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
          style="width:100%;height:auto;border-radius:16px;margin:12px 0;display:block;"
        >
        <button class="btn-ghost full" onclick="closeReceiptPreview()">关闭</button>
      </div>
    `;
    document.body.appendChild(bg);
  }

  document.getElementById("receiptPreviewImg").src = r.receiptImage;
  bg.style.display = "block";
}


function viewPaymentReceipt(recordId, paymentIndex){
  const r = records.find(x=>x.id === recordId);
  const p = r?.payments?.[paymentIndex];

  if(!p || !p.receiptImage){
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
        <h2>付款截图</h2>
        <img id="receiptPreviewImg" style="width:100%;height:auto;border-radius:16px;margin:12px 0;display:block;">
        <button class="btn-ghost full" onclick="closeReceiptPreview()">关闭</button>
      </div>
    `;
    document.body.appendChild(bg);
  }

  document.getElementById("receiptPreviewImg").src = p.receiptImage;
  bg.style.display = "block";
}

function viewGroupPaymentReceipt(groupId, paymentIndex){
  const group = (state.groups || []).find(g=>String(g.id) === String(groupId));
  const p = group?.payments?.[paymentIndex];

  if(!p || !p.receiptImage){
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
        <h2>整组付款截图</h2>
        <img id="receiptPreviewImg" style="width:100%;height:auto;border-radius:16px;margin:12px 0;display:block;">
        <button class="btn-ghost full" onclick="closeReceiptPreview()">关闭</button>
      </div>
    `;
    document.body.appendChild(bg);
  }

  document.getElementById("receiptPreviewImg").src = p.receiptImage;
  bg.style.display = "block";
}

function closeReceiptPreview(){
  const bg = document.getElementById("receiptPreviewBg");
  if(bg) bg.style.display = "none";
}

function confirmExtension(recordId){
const r = records.find(x => x.id === recordId);

  if(!r) return;

  if(!r.receiptImage){
    const ok = confirm("这笔续费还没有上传收款截图，确定先确认吗？");
    if(!ok) return;
  }

  r.extensionConfirmed = true;
  r.extensionConfirmedAt = Date.now();
  r.extensionConfirmedTime = new Date().toLocaleString();

  setDoc(doc(db, "records", r.id), r);
  alert("续费已确认");
}

function openEditRecord(recordId){
  const r = records.find(x=>x.id === recordId);

  if(!r){
    alert("找不到这条账单");
    return;
  }

  editingRecordId = recordId;

  document.getElementById("editRecordInfo").innerHTML = `
    ${r.closedTime || r.time || ""}<br>
    ${r.tableName || ""}｜${r.customerName || "-"} ${r.phoneLast4 || ""}
  `;

  document.getElementById("editPay").value = r.pay || "现金";
  document.getElementById("editTotalJPY").value = toJPY(r);
  document.getElementById("editBusinessDate").value =
  r.businessDate || getRecordBusinessDate(r);

  document.getElementById("editGroupPaid").value =
    r.groupPaymentId ? "yes" : "";

  document.getElementById("editGroupPayerName").value =
    r.groupPayerName || "";

  document.getElementById("editGroupPaymentId").value =
    r.groupPaymentId || "";

  document.getElementById("editPaymentNote").value =
    r.paymentNote || r.groupPaymentNote || "";

  document.getElementById("editRecordModalBg").style.display = "block";
}

function closeEditRecord(){
  editingRecordId = null;
  document.getElementById("editRecordModalBg").style.display = "none";
}

async function saveEditedRecord(){
  const r = records.find(x=>x.id === editingRecordId);

  if(!r){
    alert("找不到这条账单");
    return;
  }

  const pay = document.getElementById("editPay").value;
  const totalJPY = Number(document.getElementById("editTotalJPY").value || 0);
  const groupPaid = document.getElementById("editGroupPaid").value === "yes";
  const groupPayerName = document.getElementById("editGroupPayerName").value.trim();
  const groupPaymentId = document.getElementById("editGroupPaymentId").value.trim();
  const note = document.getElementById("editPaymentNote").value.trim();
  const businessDate = document.getElementById("editBusinessDate").value;

  r.pay = pay;
  r.totalJPY = totalJPY;
  r.totalRMB = Math.floor(totalJPY * RATE);
  r.paidJPY = totalJPY;
  r.dueJPY = 0;
  r.currency = pay === "微信" || pay === "支付宝" ? "人民币" : "日元";
  r.businessDate = businessDate || getRecordBusinessDate(r);

  r.payments = [{
    type:"收入",
    reason: groupPaid ? "一人代付/手动修正" : "手动修正",
    pay,
    amountJPY: totalJPY,
    amountRMB: Math.floor(totalJPY * RATE),
    note,
    time:new Date().toLocaleString(),
    timestamp:Date.now()
  }];

  r.paymentNote = note;
  r.editedAt = Date.now();
  r.editedTime = new Date().toLocaleString();

  if(groupPaid){
    r.groupPaymentId = groupPaymentId || ("manual_group_" + dateKey(Date.now()));
    r.groupPayerName = groupPayerName;
    r.groupPaymentNote = note;
  }else{
    delete r.groupPaymentId;
    delete r.groupPayerName;
    delete r.groupPaymentNote;
  }

  await setDoc(doc(db,"records",r.id),r);

  closeEditRecord();
  alert("账单已修改");
}

window.confirmExtension = confirmExtension;
window.uploadReceipt = uploadReceipt;
window.handleReceiptFileChange = handleReceiptFileChange;
window.viewReceipt = viewReceipt;
window.closeReceiptPreview = closeReceiptPreview;
window.openEditRecord = openEditRecord;
window.closeEditRecord = closeEditRecord;
window.saveEditedRecord = saveEditedRecord;
window.uploadPaymentReceipt = uploadPaymentReceipt;
window.viewPaymentReceipt = viewPaymentReceipt;
window.uploadGroupPaymentReceipt = uploadGroupPaymentReceipt;
window.viewGroupPaymentReceipt = viewGroupPaymentReceipt;