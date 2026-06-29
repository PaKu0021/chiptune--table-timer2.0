import { doc, onSnapshot, setDoc, collection } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js";

import { db, storage } from "./firebase.js";

const ref = doc(db, "shop", "main");
const recordsRef = collection(db, "records");
const RATE = 0.044;

let state = null;
let records = [];


onSnapshot(ref, snap => {
  if(!snap.exists()) return;

  state = snap.data();

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

function sumPaymentsJPY(r){
  return normalizePayments(r)
    .reduce((sum,p)=>sum + Number(p.amountJPY || 0),0);
}

function paymentDetailHTML(r){
  const list = normalizePayments(r);

  if(!list.length) return r.pay || "未记录";

  return list.map(p=>{
    const amount = Number(p.amountJPY || 0);
    const sign = amount < 0 ? "-" : "+";
    const style = amount < 0
      ? "color:#e85d5d;font-weight:900;"
      : "font-weight:800;";

    return `
      <div style="${style}">
        ${p.reason || p.type || ""}｜
        ${p.pay || "未记录"}｜
        ${sign}¥${Math.abs(amount).toLocaleString()}
        ${p.note ? `<br><small style="color:#8a8174;">${p.note}</small>` : ""}
      </div>
    `;
  }).join("");
}

function getTodayRecords(){
  return records.filter(r=>{
const d = new Date(getRecordTime(r));
    if(isNaN(d.getTime())) return false;
    return dateKey(d.getTime()) === dateKey(Date.now());
  });
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

    normalizePayments(r).forEach(p=>{
  const pay = p.pay || "未记录";
  payStats[pay] = (payStats[pay] || 0) + Number(p.amountJPY || 0);
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
        <td>${paymentDetailHTML(r)}</td>
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
  const input = document.getElementById("receiptInput");
  if(!input){
    alert("找不到 receiptInput，请先在 today-bill.html 加上传 input");
    return;
  }

  input.value = "";
  input.dataset.recordId = recordId;
  input.click();
}

async function handleReceiptFileChange(e){
  const file = e.target.files?.[0];
  const recordId = e.target.dataset.recordId;

  if(!file || !recordId) return;

  const r = records.find(x => x.id === recordId);
  if(!r){
    alert("找不到这条账单");
    return;
  }

  try{
    const compressedFile = await compressImage(file, 800, 0.6);

    const path = `receipts/${recordId}_${Date.now()}.jpg`;
    const fileRef = storageRef(storage, path);

    await uploadBytes(fileRef, compressedFile);

    const url = await getDownloadURL(fileRef);

    r.receiptImage = url;
    r.receiptPath = path;
    r.receiptFileName = compressedFile.name;
    r.receiptUploadedAt = Date.now();
    r.receiptUploadedTime = new Date().toLocaleString();

    await setDoc(doc(db, "records", r.id), r);

    alert("收款截图已上传");
  }catch(err){
    console.error(err);
    alert("上传失败：" + err.message);
  }
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


window.confirmExtension = confirmExtension;
window.uploadReceipt = uploadReceipt;
window.handleReceiptFileChange = handleReceiptFileChange;
