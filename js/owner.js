import { db } from "./firebase.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const ref = doc(db, "shop", "main");

const RATE = 0.044;

let state = null;
let currentFilter = "today";
let chartCurrency = "JPY";

onSnapshot(ref, snap => {
  if (!snap.exists()) return;
  state = snap.data();
  if (!state.records) state.records = [];
  render();
});

function dateKey(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getFilteredRecords(){
  const now = new Date();

  return state.records.filter(r => {
    const d = new Date(r.timestamp || r.time || r.date);
    if (isNaN(d.getTime())) return currentFilter === "all";

    if (currentFilter === "today") {
      return dateKey(d.getTime()) === dateKey(Date.now());
    }

    if (currentFilter === "week") {
      const nowDay = now.getDay() || 7;
      const monday = new Date(now);
      monday.setDate(now.getDate() - nowDay + 1);
      monday.setHours(0,0,0,0);

      const nextMonday = new Date(monday);
      nextMonday.setDate(monday.getDate() + 7);

      return d >= monday && d < nextMonday;
    }

    if (currentFilter === "month") {
      return d.getFullYear() === now.getFullYear() &&
             d.getMonth() === now.getMonth();
    }

    if (currentFilter === "year") {
      return d.getFullYear() === now.getFullYear();
    }

    return true;
  });
}

function toJPY(r){
  if (r.currency === "人民币") {
    return Number(r.totalRMB || 0) / RATE;
  }
  return Number(r.totalJPY || 0);
}

function toRMB(r){
  if (r.currency === "人民币") {
    return Number(r.totalRMB || 0);
  }
  return Math.floor(Number(r.totalJPY || 0) * RATE);
}

function render(){
  updateButtons();

  const records = getFilteredRecords();

  let totalJPY = 0;
  let totalRMB = 0;
  const payStats = {};
  const typeStats = { walkin:0, booking:0 };

  records.forEach(r => {
    totalJPY += toJPY(r);
    totalRMB += toRMB(r);

    const pay = r.pay || "未记录";
    payStats[pay] = (payStats[pay] || 0) + 1;

    const type = r.customerType || r.type || "walkin";
    typeStats[type] = (typeStats[type] || 0) + 1;
  });

  document.getElementById("summary").innerHTML =
    `筛选：${filterName(currentFilter)}｜` +
    `日元总值：¥${Math.floor(totalJPY).toLocaleString()}｜` +
    `人民币总值：¥${Math.floor(totalRMB).toLocaleString()}｜` +
    `笔数：${records.length}`;

  document.getElementById("payStats").innerHTML =
    `付款渠道：${Object.keys(payStats).map(k=>`${k} ${payStats[k]}笔`).join(" / ") || "暂无"}<br>` +
    `客源：Walk-in ${typeStats.walkin || 0}笔 / 预约 ${typeStats.booking || 0}笔`;

  renderChart(records);
  renderRecords(records);
}

function filterName(mode){
  if (mode === "today") return "今天";
  if (mode === "week") return "本周";
  if (mode === "month") return "本月";
  if (mode === "year") return "本年";
  return "全部";
}

function updateButtons(){
  ["today","week","month","year","all"].forEach(mode=>{
    const btn = document.getElementById(`filter-${mode}`);
    if(btn) btn.classList.toggle("active", mode === currentFilter);
  });

  document.getElementById("currency-jpy").classList.toggle("active", chartCurrency === "JPY");
  document.getElementById("currency-rmb").classList.toggle("active", chartCurrency === "RMB");
}

function renderChart(records){
  const canvas = document.getElementById("incomeChart");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);

  const grouped = {};

  records.forEach(r=>{
    const ts = r.timestamp || r.time || r.date;
    const key = dateKey(ts);
    const value = chartCurrency === "JPY" ? toJPY(r) : toRMB(r);
    grouped[key] = (grouped[key] || 0) + value;
  });

  const labels = Object.keys(grouped).sort();
  const values = labels.map(k=>grouped[k]);

  const padL = 70;
  const padR = 25;
  const padT = 30;
  const padB = 55;

  const chartW = canvas.width - padL - padR;
  const chartH = canvas.height - padT - padB;

  ctx.font = "14px -apple-system";
  ctx.fillStyle = "#8a8174";

  if(!labels.length){
    ctx.fillText("暂无数据", padL, 60);
    return;
  }

  const maxValue = Math.max(...values, 1);
  const yMax = Math.ceil(maxValue / 1000) * 1000 || 1000;
  const steps = 5;

  ctx.strokeStyle = "#e6dccb";
  ctx.lineWidth = 1;

  for(let i=0;i<=steps;i++){
    const y = padT + chartH - (i/steps)*chartH;
    const value = Math.round((yMax/steps)*i);

    ctx.beginPath();
    ctx.moveTo(padL,y);
    ctx.lineTo(padL+chartW,y);
    ctx.stroke();

    ctx.fillStyle = "#8a8174";
    ctx.fillText(value.toLocaleString(), 8, y+4);
  }

  ctx.strokeStyle = "#332d24";
  ctx.beginPath();
  ctx.moveTo(padL,padT);
  ctx.lineTo(padL,padT+chartH);
  ctx.lineTo(padL+chartW,padT+chartH);
  ctx.stroke();

  ctx.strokeStyle = "#d8a900";
  ctx.lineWidth = 4;
  ctx.beginPath();

  labels.forEach((label,i)=>{
    const x = labels.length === 1 ? padL + chartW/2 : padL + i*(chartW/(labels.length-1));
    const y = padT + chartH - (values[i]/yMax)*chartH;

    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });

  ctx.stroke();

  labels.forEach((label,i)=>{
    const x = labels.length === 1 ? padL + chartW/2 : padL + i*(chartW/(labels.length-1));
    const y = padT + chartH - (values[i]/yMax)*chartH;

    ctx.fillStyle = "#332d24";
    ctx.beginPath();
    ctx.arc(x,y,5,0,Math.PI*2);
    ctx.fill();

    ctx.font = "13px -apple-system";
    ctx.fillText(Math.floor(values[i]).toLocaleString(), x-20, y-12);

    ctx.fillStyle = "#8a8174";
    ctx.fillText(label.slice(5), x-22, padT+chartH+25);
  });

  ctx.fillStyle = "#332d24";
  ctx.font = "15px -apple-system";
  ctx.fillText(chartCurrency === "JPY" ? "单位：日元" : "单位：人民币", padL, 20);
}

function renderRecords(records){
  const rows = [...records].reverse();

  document.getElementById("records").innerHTML = `
    <table class="record-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>桌位</th>
          <th>客人</th>
          <th>类型</th>
          <th>套餐</th>
          <th>日元</th>
          <th>人民币</th>
          <th>付款</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td>${r.time || ""}</td>
            <td>${r.tableName || ""}</td>
            <td>${r.customerName || ""} ${r.phoneLast4 ? "(" + r.phoneLast4 + ")" : ""}</td>
            <td>${r.customerType === "booking" ? "预约" : "Walk-in"}</td>
            <td>${r.packageName || ""}</td>
            <td>¥${Number(r.totalJPY || 0).toLocaleString()}</td>
            <td>¥${Number(r.totalRMB || 0).toLocaleString()}</td>
            <td>${r.pay || ""}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function exportCSV(){
  const records = getFilteredRecords();

  const headers = [
    "时间","桌位","客人姓名","手机尾号","类型","套餐",
    "日元","人民币","付款渠道","币种"
  ];

  const rows = records.map(r=>[
    r.time || "",
    r.tableName || "",
    r.customerName || "",
    r.phoneLast4 || "",
    r.customerType === "booking" ? "预约" : "Walk-in",
    r.packageName || "",
    r.totalJPY || 0,
    r.totalRMB || 0,
    r.pay || "",
    r.currency || ""
  ]);

  const csv = [headers,...rows]
    .map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `chiptune_${currentFilter}_${dateKey(Date.now())}.csv`;
  a.click();
}

function setFilter(mode){
  currentFilter = mode;
  render();
}

function setChartCurrency(currency){
  chartCurrency = currency;
  render();
}

window.setFilter = setFilter;
window.setChartCurrency = setChartCurrency;
window.exportCSV = exportCSV;