import { db } from "./firebase.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const OWNER_PASSWORD = "prompt";

const ok = sessionStorage.getItem("owner_auth");

if(ok !== "1"){
  location.href = "./index.html";
  throw new Error("owner auth required");
}

const ref = doc(db,"shop","main");
const RATE = 0.044;

let state = null;
let currentFilter = "today";
let currencyMode = "CONVERTED";
let packagePanelOpen = false;


function newTable(i){
  return {
    name:i+"号桌",
    start:null,
    extra:0,
    packageIndex:0,
    type:"",
    pay:"",
    currency:"日元",
    customer:{name:"",phoneLast4:""},
    alerted:false,
    alerting:false,
    pausedAt:null
  };
}

onSnapshot(ref,snap=>{
  if(!snap.exists()) return;

  state = snap.data();

  if(!state.records) state.records = [];
  if(!state.packages) state.packages = [];
  if(!state.tables) state.tables = [];

  if(!state.businessHours){
  state.businessHours = {
    weekdayOpen:12,
    weekdayClose:22,
    weekendOpen:10,
    weekendClose:22
  };
}

  render();
  renderBusinessHours();
});

function save(){
  return setDoc(ref,state);
}

function dateKey(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getRecordTime(r){
  return r.timestamp || r.time || r.date || Date.now();
}

function getFilteredRecords(){
  const now = new Date();

  return state.records.filter(r=>{
    const d = new Date(getRecordTime(r));
    if(isNaN(d.getTime())) return currentFilter === "all";

    if(currentFilter === "today"){
      return dateKey(d.getTime()) === dateKey(Date.now());
    }

    if(currentFilter === "week"){
      const day = now.getDay() || 7;
      const monday = new Date(now);
      monday.setDate(now.getDate() - day + 1);
      monday.setHours(0,0,0,0);

      const nextMonday = new Date(monday);
      nextMonday.setDate(monday.getDate()+7);

      return d >= monday && d < nextMonday;
    }

    if(currentFilter === "month"){
      return d.getFullYear() === now.getFullYear() &&
             d.getMonth() === now.getMonth();
    }

    if(currentFilter === "year"){
      return d.getFullYear() === now.getFullYear();
    }

    return true;
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

function getAmountByMode(r){
  if(currencyMode === "JPY"){
    return r.currency === "日元" ? Number(r.totalJPY || r.jpy || 0) : 0;
  }

  if(currencyMode === "RMB"){
    return r.currency === "人民币" ? Number(r.totalRMB || r.rmb || 0) : 0;
  }

  if(r.currency === "人民币"){
    return Math.floor(Number(r.totalRMB || r.rmb || 0) / RATE);
  }

  return Number(r.totalJPY || r.jpy || 0);
}

function filterName(){
  if(currentFilter === "today") return "今天";
  if(currentFilter === "week") return "本周";
  if(currentFilter === "month") return "本月";
  if(currentFilter === "year") return "本年";
  return "全部";
}

function render(){
  renderButtons();
  renderSummary();
  renderChart();
  renderPackages();
  renderRecords();

  const tableInput = document.getElementById("tableCount");
  if(tableInput) tableInput.value = state.tables.length || 0;

  const packageBody = document.getElementById("packagePanelBody");
const packageBtn = document.getElementById("packageToggleBtn");

if(packageBody){
  packageBody.style.display = packagePanelOpen ? "block" : "none";
}

if(packageBtn){
  packageBtn.innerText = packagePanelOpen ? "收起" : "展开";
}
}

function renderButtons(){
  ["today","week","month","year","all"].forEach(k=>{
    const btn = document.getElementById("f_"+k);
    if(btn) btn.classList.toggle("active",currentFilter === k);
  });

document.getElementById("c_jpy")?.classList.toggle("active",currencyMode === "JPY");
document.getElementById("c_rmb")?.classList.toggle("active",currencyMode === "RMB");
document.getElementById("c_converted")?.classList.toggle("active",currencyMode === "CONVERTED");

}

function renderSummary(){
  const list = getFilteredRecords();

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

  document.getElementById("summary").innerHTML =
    `${filterName()}｜日元收入：¥${Math.floor(jpyIncome).toLocaleString()}｜人民币收入：¥${Math.floor(rmbIncome).toLocaleString()}｜换算总收入：¥${Math.floor(convertedJPY).toLocaleString()}｜笔数：${list.length}`;

  document.getElementById("payStats").innerHTML =
    `付款渠道：${Object.keys(payStats).map(k=>`${k} ${payStats[k]}笔`).join(" / ") || "暂无"}<br>
     客源：Walk-in ${typeStats.walkin || 0}笔 / 预约 ${typeStats.booking || 0}笔`;
}


function renderChart(){
  const canvas = document.getElementById("chart");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);

  const list = getFilteredRecords();
  const grouped = {};

  list.forEach(r=>{
    const key = dateKey(getRecordTime(r));
    const value = getAmountByMode(r);
    grouped[key] = (grouped[key] || 0) + value;
  });

  const labels = Object.keys(grouped).sort();
  const values = labels.map(k=>grouped[k]);

  const padL = 70;
  const padR = 25;
  const padT = 35;
  const padB = 55;

  const w = canvas.width - padL - padR;
  const h = canvas.height - padT - padB;

  ctx.font = "14px -apple-system";
  ctx.fillStyle = "#8a8174";

  if(!labels.length){
    ctx.fillText("暂无数据",padL,60);
    return;
  }

  const maxValue = Math.max(...values,1);
  const yMax = Math.ceil(maxValue / 1000) * 1000 || 1000;
  const steps = 5;

  ctx.strokeStyle = "#e6dccb";
  ctx.lineWidth = 1;

  for(let i=0;i<=steps;i++){
    const y = padT + h - (i/steps)*h;
    const value = Math.round((yMax/steps)*i);

    ctx.beginPath();
    ctx.moveTo(padL,y);
    ctx.lineTo(padL+w,y);
    ctx.stroke();

    ctx.fillStyle = "#8a8174";
    ctx.fillText(value.toLocaleString(),8,y+4);
  }

  ctx.strokeStyle = "#332d24";
  ctx.beginPath();
  ctx.moveTo(padL,padT);
  ctx.lineTo(padL,padT+h);
  ctx.lineTo(padL+w,padT+h);
  ctx.stroke();

  ctx.strokeStyle = "#d8a900";
  ctx.lineWidth = 4;
  ctx.beginPath();

  labels.forEach((label,i)=>{
    const x = labels.length === 1 ? padL + w/2 : padL + i*(w/(labels.length-1));
    const y = padT + h - (values[i]/yMax)*h;

    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });

  ctx.stroke();

  labels.forEach((label,i)=>{
    const x = labels.length === 1 ? padL + w/2 : padL + i*(w/(labels.length-1));
    const y = padT + h - (values[i]/yMax)*h;

    ctx.fillStyle = "#332d24";
    ctx.beginPath();
    ctx.arc(x,y,5,0,Math.PI*2);
    ctx.fill();

    ctx.font = "13px -apple-system";
    ctx.fillText(Math.floor(values[i]).toLocaleString(),x-18,y-12);

    ctx.fillStyle = "#8a8174";
    ctx.fillText(label.slice(5),x-22,padT+h+25);
  });

  ctx.fillStyle = "#332d24";
  ctx.font = "15px -apple-system";
const unitText =
  currencyMode === "JPY"
    ? "单位：日元收入"
    : currencyMode === "RMB"
      ? "单位：人民币收入"
      : "单位：换算日元总收入";

ctx.fillText(unitText,padL,22);
}

function renderPackages(){
  const box = document.getElementById("packageBox");
  box.innerHTML = "";

  state.packages.forEach((p,i)=>{
    const row = document.createElement("div");
    row.className = "grid";
    row.style.gridTemplateColumns = "1fr 1fr 1fr 1fr auto";
    row.style.gap = "8px";
    row.style.marginBottom = "8px";

    row.innerHTML = `
      <div>
        <small>套餐名</small>
        <input data-pkg-name="${i}" value="${p.name || ""}">
      </div>

      <div>
        <small>分钟 0=不限时</small>
        <input type="number" data-pkg-minutes="${i}" value="${p.minutes || 0}">
      </div>

      <div>
        <small>套餐金额</small>
        <input type="number" data-pkg-price="${i}" value="${p.price || 0}">
      </div>

      <div>
        <small>续费1小时金额</small>
        <input type="number" data-pkg-extension="${i}" value="${p.extensionPrice || 0}">
      </div>

      <button class="btn-danger" onclick="removePackage(${i})">删除</button>
    `;

    box.appendChild(row);
  });
}

function renderRecords(){
  const rows = [...getFilteredRecords()].reverse();

  document.getElementById("records").innerHTML = rows.map(r=>{
    const table = r.tableName || r.table || "";
    const name = r.customerName || r.name || "";
    const phone = r.phoneLast4 || "";
    const type = (r.customerType || r.type) === "booking" ? "预约" : "Walk-in";
    const packageName = r.packageName || "";
    const extra = r.extraMinutes || 0;
    const original = r.originalJPY || r.totalJPY || r.jpy || 0;
    const jpy = toJPY(r);
    const rmb = toRMB(r);

    return `
      <tr>
        <td>${r.time || ""}</td>
        <td>${table}</td>
        <td>${name}${phone ? "("+phone+")" : ""}</td>
        <td>${type}</td>
        <td>${packageName}</td>
        <td>${extra}分</td>
        <td>¥${Number(original).toLocaleString()}</td>
        <td>¥${Number(jpy).toLocaleString()}</td>
        <td>¥${Number(rmb).toLocaleString()}</td>
        <td>${r.pay || ""}</td>
        <td>${r.currency || ""}</td>
        <td>${r.roundRule || ""}</td>
      </tr>
    `;
  }).join("");
}

function collectPackagesFromInputs(){
  state.packages = state.packages.map((p,i)=>({
    name: document.querySelector(`[data-pkg-name="${i}"]`)?.value || p.name || "新套餐",
    minutes: Number(document.querySelector(`[data-pkg-minutes="${i}"]`)?.value || 0),
    price: Number(document.querySelector(`[data-pkg-price="${i}"]`)?.value || 0),
    extensionPrice: Number(document.querySelector(`[data-pkg-extension="${i}"]`)?.value || 0),
    unlimited: Number(document.querySelector(`[data-pkg-minutes="${i}"]`)?.value || 0) === 0
  }));
}

function addPackage(){
  collectPackagesFromInputs();

  state.packages.push({
    name:"新套餐",
    minutes:60,
    price:0,
    extensionPrice:0,
    unlimited:false
  });

  render();
}

function removePackage(i){
  collectPackagesFromInputs();

  if(state.packages.length <= 1){
    alert("至少保留一个套餐");
    return;
  }

  state.packages.splice(i,1);

  state.tables.forEach(t=>{
    if(t.packageIndex >= state.packages.length){
      t.packageIndex = 0;
    }
  });

  render();
}

function savePackages(){
  collectPackagesFromInputs();
  state.packages = state.packages.map((p,i)=>{
    const name = document.querySelector(`[data-pkg-name="${i}"]`).value || "未命名套餐";
    const minutes = Number(document.querySelector(`[data-pkg-minutes="${i}"]`).value || 0);
    const price = Number(document.querySelector(`[data-pkg-price="${i}"]`).value || 0);
    const extensionPrice = Number(document.querySelector(`[data-pkg-extension="${i}"]`).value || 0);

    return {
      name,
      minutes,
      price,
      extensionPrice,
      unlimited: minutes === 0
    };
  });

  save();
  alert("套餐设置已保存");
}

function saveTableCount(){
  const count = Number(document.getElementById("tableCount").value || state.tables.length);

  if(count < 1) return alert("桌位数量至少为1");

  if(count > state.tables.length){
    for(let i=state.tables.length;i<count;i++){
      state.tables.push(newTable(i+1));
    }
  }else if(count < state.tables.length){
    const deleting = state.tables.slice(count);
    const hasRunning = deleting.some(t=>t.start);

    if(hasRunning && !confirm("删除范围内有正在计时桌位，确定删除吗？")){
      return;
    }

    state.tables = state.tables.slice(0,count);
  }

  save();
  alert("桌位数量已保存");
}

function exportCSV(){
  const rows = getFilteredRecords();

  const headers = [
    "时间","桌位","客人姓名","手机尾号","类型","套餐",
    "续费分钟","原价日元","结账日元","人民币","付款渠道","币种","抹零规则"
  ];

  const body = rows.map(r=>[
    r.time || "",
    r.tableName || r.table || "",
    r.customerName || r.name || "",
    r.phoneLast4 || "",
    (r.customerType || r.type) === "booking" ? "预约" : "Walk-in",
    r.packageName || "",
    r.extraMinutes || 0,
    r.originalJPY || r.totalJPY || r.jpy || 0,
    toJPY(r),
    toRMB(r),
    r.pay || "",
    r.currency || "",
    r.roundRule || ""
  ]);

  const csv = [headers,...body]
    .map(row=>row.map(cell=>`"${String(cell ?? "").replace(/"/g,'""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `chiptune_${currentFilter}_${dateKey(Date.now())}.csv`;
  a.click();
}

function setFilter(v){
  currentFilter = v;
  render();
}

function setCurrencyMode(v){
  currencyMode = v;
  render();
}

function togglePackagePanel(){
  packagePanelOpen = !packagePanelOpen;

  const body = document.getElementById("packagePanelBody");
  const btn = document.getElementById("packageToggleBtn");

  if(body){
    body.style.display = packagePanelOpen ? "block" : "none";
  }

  if(btn){
    btn.innerText = packagePanelOpen ? "收起" : "展开";
  }
}


function renderBusinessHours(){
  const h = state.businessHours || {
    weekdayOpen:12,
    weekdayClose:22,
    weekendOpen:10,
    weekendClose:22
  };

  const ids = ["weekdayOpen","weekdayClose","weekendOpen","weekendClose"];

  ids.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value = h[id];
  });
}

function saveBusinessHours(){
  state.businessHours = {
    weekdayOpen: Number(document.getElementById("weekdayOpen").value || 12),
    weekdayClose: Number(document.getElementById("weekdayClose").value || 22),
    weekendOpen: Number(document.getElementById("weekendOpen").value || 10),
    weekendClose: Number(document.getElementById("weekendClose").value || 22)
  };

  save();
  alert("营业时间已保存");
}

function logoutOwner(){
  sessionStorage.removeItem("owner_auth");
  location.href="./index.html";
}

function setTopActionActive(type){

  document
    .getElementById("btnQrPage")
    ?.classList.remove("active-top-btn");

  document
    .getElementById("btnCashierPage")
    ?.classList.remove("active-top-btn");

  if(type === "qr"){
    document
      .getElementById("btnQrPage")
      ?.classList.add("active-top-btn");
  }

  if(type === "cashier"){
    document
      .getElementById("btnCashierPage")
      ?.classList.add("active-top-btn");
  }
}

function openQrPage(){
  setTopActionActive("qr");

  setTimeout(()=>{
    location.href = "./qr.html";
  },120);
}

function openCashierPage(){
  setTopActionActive("cashier");

  setTimeout(()=>{
    location.href = "./cashier.html";
  },120);
}

window.logoutOwner = logoutOwner;
window.saveBusinessHours = saveBusinessHours;
window.togglePackagePanel = togglePackagePanel;
window.setFilter = setFilter;
window.setCurrencyMode = setCurrencyMode;
window.addPackage = addPackage;
window.removePackage = removePackage;
window.savePackages = savePackages;
window.saveTableCount = saveTableCount;
window.exportCSV = exportCSV;
window.openQrPage = openQrPage;
window.openCashierPage = openCashierPage;