/*alert("app.js 已加载");*/
import { db } from "./firebase.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
/*import { formatTime } from "./common.js";*/
import { resetTable, formatTime } from "./common.js";
const ref = doc(db, "shop", "main");
const RATE = 0.044;
const VAPID_KEY = "BN7TodJ52H-wKg54Dj-tFcm21Q5zplpmeFuXYzqtQbkb1LzpTO-pRsGV1fWpUEiDKxBbqN8l2SRtzXuiisRHEPE";


let state = null;
let checkoutIndex = null;
let useRound = false;
let alertLoops = {};
let remindLocks = {};
let searchKeyword = "";
let statusFilter = "";
let typeFilter = "";
let payFilter = "";
let sortDirection = "asc";
let filterPanelOpen = true;

function newTable(i){
  return resetTable(i + "号桌");
}   
 

const defaultState = {
  packages:[
    {name:"1小时", minutes:60, price:1500, extensionPrice:900, unlimited:false},
    {name:"3小时", minutes:180, price:3300, extensionPrice:900, unlimited:false},
    {name:"6小时", minutes:360, price:5500, extensionPrice:800, unlimited:false},
    {name:"不限时", minutes:0, price:5500, extensionPrice:0, unlimited:true}
  ],
  tables: Array.from({length:8},(_,i)=>newTable(i+1)),
  records:[],
  bookings:[],
  customers:{}
};

onSnapshot(ref, snap=>{
  if(snap.exists()){
    state = snap.data();
/*alert("Firestore已读取");*/
    
    if(!state.packages) state.packages = defaultState.packages;
    if(!state.records) state.records = [];
    if(!state.bookings) state.bookings = [];
    if(!state.tables) state.tables = defaultState.tables;
    if(!state.customers) state.customers = {};

    state.tables.forEach((t,i)=>{
  if(!t.name) t.name = (i+1) + "号桌";
  if(t.packageIndex === undefined) t.packageIndex = 0;
  if(!t.customer) t.customer = {name:"", phoneLast4:""};
  if(t.currency === undefined) t.currency = "日元";
  if(t.alerted === undefined) t.alerted = false;
  if(t.alerting === undefined) t.alerting = false;
  if(t.extra === undefined) t.extra = 0;
  if(t.pausedAt === undefined) t.pausedAt = null;
  if(t.pay === undefined) t.pay = "";
  if(t.payTiming === undefined) t.payTiming = "prepaid";
  if(t.paidJPY === undefined) t.paidJPY = 0;
  if(t.paidRMB === undefined) t.paidRMB = 0;
  if(t.paidAt === undefined) t.paidAt = null;
  if(t.type === undefined) t.type = "";
  if(t.lastAction === undefined) t.lastAction = "";
  if(t.recordId === undefined) t.recordId = null;
  if(t.customerKey === undefined) t.customerKey = "";
  if(t.visitId === undefined) t.visitId = null;
  if(t.visitDate === undefined) t.visitDate = "";
  if(t.visitRange === undefined) t.visitRange = "";
  if(t.bookingId === undefined) t.bookingId = null;
  if(t.activeColor === undefined) t.activeColor = "";
});

    /*alert("准备render");*/
    render();
  }else{
    state = defaultState;
    save();
  }
});

function save(){
  setDoc(ref,state);
}

function getPackage(t){
  const idx = Number(t.packageIndex ?? 0);
  return state.packages[idx] || state.packages[0] || {
    name:"1小时",
    minutes:60,
    price:1500,
    extensionPrice:900,
    unlimited:false
  };
}

function getLimitMs(t){
  const p = getPackage(t);
  if(p.unlimited) return Infinity;
  return Number(p.minutes || 0) * 60 * 1000 + Number(t.extra || 0);
}

function getElapsedMs(t){
  if(!t.start) return 0;
  if(t.pausedAt) return t.pausedAt - t.start;
  return Date.now() - t.start;
}

function getRemainMs(t){
  if(!t.start) return Infinity;

  const limit = getLimitMs(t);
  if(limit === Infinity) return Infinity;

  return limit - getElapsedMs(t);
}

function calcPriceByTotalMinutes(totalMinutes){
  const hours = Math.ceil(totalMinutes / 60);

  if(hours <= 1) return 1500;
  if(hours === 2) return 2800;
  if(hours === 3) return 3300;
  if(hours === 4) return 4200;
  if(hours === 5) return 5100;
  if(hours === 6) return 5500;

  return 5500 + (hours - 6) * 800;
}

/*
function getOriginalJPY(t){
  const p = getPackage(t);
  if(p.unlimited) return Number(p.price || 0);
  return Number(p.price || 0) + (Number(t.extra || 0) / 3600000) * Number(p.extensionPrice || 0);
}
*/

function getOriginalJPY(t){
  const p = getPackage(t);

  if(p.unlimited){
    return Number(p.price || 0);
  }

  const baseMinutes = Number(p.minutes || 0);
  const extraMinutes = Math.floor(Number(t.extra || 0) / 60000);
  const totalMinutes = baseMinutes + extraMinutes;

  return calcPriceByTotalMinutes(totalMinutes);
}

function roundJPY(jpy){
  const base = Math.floor(jpy / 1000) * 1000;
  const rest = jpy - base;

  if(rest <= 500){
    return base;
  }

  return base + 500;
}

function getRMB(jpy){
  return Math.floor(jpy * RATE);
}

function getDueJPY(t){
  return Math.max(0, getOriginalJPY(t) - Number(t.paidJPY || 0));
}

function getTableRecord(t){
  if(!t.recordId) return null;
  return state.records.find(r=>r.id === t.recordId) || null;
}

function makeCustomerKey(name, phoneLast4){
  const n = String(name || "").trim();
  const p = String(phoneLast4 || "").trim();

  if(!n || !p) return "";

  return `${n}_${p}`;
}

function getDateText(ts){
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getVisitRangeText(t){
  const start = t.start ? new Date(t.start) : new Date();
  const now = new Date();

  const s = `${String(start.getHours()).padStart(2,"0")}:${String(start.getMinutes()).padStart(2,"0")}`;
  const e = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  return `${s}-${e}`;
}

function createOrUpdateCustomerVisit(t){
  const key = makeCustomerKey(t.customer?.name, t.customer?.phoneLast4);

  if(!key) return null;

  if(!state.customers) state.customers = {};

  if(!state.customers[key]){
    state.customers[key] = {
      key,
      name:t.customer?.name || "",
      phoneLast4:t.customer?.phoneLast4 || "",
      visitCount:0,
      firstVisitAt:Date.now(),
      lastVisitAt:Date.now(),
      visits:[]
    };
  }

  const customer = state.customers[key];

  t.customerKey = key;

  let visit = null;

  if(t.visitId){
    visit = customer.visits.find(v=>v.id === t.visitId);
  }

  if(!visit){
    const id = "visit_" + Date.now() + "_" + Math.random().toString(36).slice(2,8);

    t.visitId = id;

    visit = {
      id,
      date:getDateText(t.start || Date.now()),
      startAt:t.start || Date.now(),
      endAt:null,
      range:"",
      tableName:t.name,
      customerType:t.type || "walkin",
      packageName:"",
      packageMinutes:"",
      extraMinutes:0,
      totalJPY:0,
      pay:"",
      closed:false
    };

    customer.visits.push(visit);
    customer.visitCount = customer.visits.length;
  }

  const p = getPackage(t);

  visit.date = getDateText(t.start || Date.now());
  visit.range = getVisitRangeText(t);
  visit.tableName = t.name;
  visit.customerType = t.type || "walkin";
  visit.packageName = p.name;
  visit.packageMinutes = p.unlimited ? "不限时" : p.minutes;
  visit.extraMinutes = Math.floor(Number(t.extra || 0) / 60000);
  visit.totalJPY = getOriginalJPY(t);
  visit.pay = t.pay || "";
  visit.lastUpdatedAt = Date.now();

  customer.name = t.customer?.name || customer.name;
  customer.phoneLast4 = t.customer?.phoneLast4 || customer.phoneLast4;
  customer.lastVisitAt = Date.now();
  customer.visitCount = customer.visits.length;

  return visit;
}

function createOrUpdateRecord(t){
  const p = getPackage(t);
  const originalJPY = getOriginalJPY(t);
  const paidJPY = Number(t.paidJPY || 0);
  const dueJPY = Math.max(0, originalJPY - paidJPY);

  let record = getTableRecord(t);

  if(!record){
    const id = "rec_" + Date.now() + "_" + Math.random().toString(36).slice(2,8);
    t.recordId = id;

    record = {
      id,
      timestamp: Date.now(),
      time: new Date().toLocaleString(),
      tableName: t.name,
      receiptImage:"",
      receiptFileName:"",
    };

    state.records.push(record);
  }

  record.tableName = t.name;
  record.customerName = t.customer?.name || "";
  record.phoneLast4 = t.customer?.phoneLast4 || "";
  record.customerType = t.type || "walkin";

  record.packageName = p.name;
  record.packageMinutes = p.unlimited ? "不限时" : p.minutes;
  record.packagePrice = p.price;

  record.extraMinutes = Math.floor(Number(t.extra || 0) / 60000);
  record.extensionAmount = Math.max(0, originalJPY - Number(p.price || 0));

  record.originalJPY = originalJPY;
  record.paidJPY = paidJPY;
  record.dueJPY = dueJPY;

  record.totalJPY = paidJPY;
  record.totalRMB = getRMB(paidJPY);

  record.pay = t.pay || "";
  record.currency = t.currency || "日元";
  record.payTiming = t.payTiming || "prepaid";

  record.paidStatus = dueJPY > 0 ? "未结清" : "已结清";
  record.recordType = t.payTiming === "postpaid" ? "postpaid" : "prepaid";
  record.checkoutMethod = t.payTiming === "postpaid" ? "后付款" : "先付款";
  record.roundRule = record.roundRule || "不抹零";

  const visit = createOrUpdateCustomerVisit(t);

if(visit){
  record.customerKey = t.customerKey;
  record.visitId = t.visitId;
  record.visitDate = visit.date;
  record.visitRange = visit.range;
}


  return record;
}

function getStatus(t){
  if(!t.start) return "idle";

  const p = getPackage(t);
  if(p.unlimited) return "using";

  const remain = getLimitMs(t) - getElapsedMs(t);

  if(remain <= 0) return "overtime";
  if(remain <= 10 * 60 * 1000) return "warning";

  return "using";
}

function render(){
  try{

  if(!state) return;
  const box = document.getElementById("tables");
  box.innerHTML = "";

const filteredTables = state.tables
  .map((t,i)=>({t,i}))
  .filter(({t})=>{
    const status = getStatus(t);

    const keyword = searchKeyword.trim().toLowerCase();
    const text = [
      t.name,
      t.customer?.name,
      t.customer?.phoneLast4,
      t.type,
      t.pay
    ].join(" ").toLowerCase();

    if(keyword && !text.includes(keyword)) return false;
    if(statusFilter && statusFilter !== "all" && status !== statusFilter) return false;
    if(typeFilter && typeFilter !== "all" && t.type !== typeFilter) return false;
    if(payFilter && payFilter !== "all" && t.pay !== payFilter) return false;
    return true;
      })


.sort((a,b)=>{
  const sortMode = document.getElementById("sortMode")?.value || "table";

  let va = a.i;
  let vb = b.i;

  if(sortMode === "remain"){
    va = getLimitMs(a.t) - getElapsedMs(a.t);
    vb = getLimitMs(b.t) - getElapsedMs(b.t);
  }

  if(sortMode === "used"){
    va = getElapsedMs(a.t);
    vb = getElapsedMs(b.t);
  }

  if(sortMode === "amount"){
    va = getOriginalJPY(a.t);
    vb = getOriginalJPY(b.t);
  }

  return sortDirection === "desc" ? vb - va : va - vb;
});
  


filteredTables.forEach(({t,i})=>{
    const p = getPackage(t);
    const elapsed = getElapsedMs(t);
    const remain = getLimitMs(t) - elapsed;
    const status = getStatus(t);
    const overtime = status === "overtime";

    if(overtime){
      if(!t.alerting){
        t.alerting = true;
        startAlertLoop(i);
        save();
      }
    }else{
      if(t.alerting){
        t.alerting = false;
        stopAlertLoop(i);
        save();
      }
    }

    if(status === "warning" && !remindLocks[i]){
      remindLocks[i] = true;
      setTimeout(()=>{ remindLocks[i] = false; },60000);
      notifyLocal("续费提醒", t.name + " 剩余10分钟，建议提醒续费");
    }

    const usedText = t.start ? "已用 " + formatTime(elapsed) : "";
    const timeText = !t.start
      ? "未开始"
      : t.pausedAt
        ? "暂停中 " + formatTime(elapsed)
        : p.unlimited
          ? "已使用 " + formatTime(elapsed)
          : overtime
            ? "超时 " + formatTime(Math.abs(remain))
            : "剩余 " + formatTime(remain);

    const originalJPY = getOriginalJPY(t);
    const roundedJPY = roundJPY(originalJPY);
    const paidJPY = Number(t.paidJPY || 0);
    const dueJPY = getDueJPY(t);

    const div = document.createElement("div");
    div.className = "card " + status;

    div.innerHTML = `
      <h3>${t.name}</h3>

    <select onchange="setPackage(${i},this.value)" ${t.start ? "disabled" : ""}>
  ${state.packages.map((pkg,idx)=>`
    <option value="${idx}" ${idx===t.packageIndex ? "selected" : ""}>
      ${pkg.name} | ${pkg.unlimited ? "不限时" : pkg.minutes + "分钟"} | ¥${pkg.price}
    </option>
  `).join("")}
</select>

<div class="timer" style="color:${status==="overtime" ? "#e85d5d" : status==="warning" ? "#ff9800" : "#333"};">
  ${timeText}
</div>

${t.start ? `
  <div style="font-size:18px;font-weight:800;margin:-4px 0 10px;color:#8a8174;">
    ${usedText}
  </div>
` : ""}
      <div class="info">
        类型：${t.type || "-"}<br>
        客人：${t.customer.name || "-"} ${t.customer.phoneLast4 || ""}<br>
        收款模式：${t.payTiming === "postpaid" ? "后付款" : "先付款"}<br>
        已收金额：¥${paidJPY.toLocaleString()}<br>
        当前应收：¥${originalJPY.toLocaleString()}<br>
        需收/补收：¥${dueJPY.toLocaleString()}<br>
        人民币参考：¥${getRMB(dueJPY).toLocaleString()}<br>
        抹零参考：¥${roundJPY(dueJPY).toLocaleString()}<br>
      </div>

      <div class="row">
        <input placeholder="姓名" id="name-${i}" value="${t.customer.name || ""}" onchange="updateCustomer(${i})">
        <input placeholder="手机后4位" id="phone-${i}" value="${t.customer.phoneLast4 || ""}" onchange="updateCustomer(${i})">
      </div>

<div class="action-row">
<button class="btn-ghost" style="${t.type==="walkin" ? "background:#f2c94c;color:#332d24;border-color:#d8a900;" : ""}" onclick="toggleType(${i},'walkin')">Walk-in</button>
<button class="btn-ghost" style="${t.type==="booking" ? "background:#f2c94c;color:#332d24;border-color:#d8a900;" : ""}" onclick="toggleType(${i},'booking')">预约</button>
</div>

<input placeholder="提前分钟" id="pre-${i}">

<div class="action-row">
  <button class="btn-ghost" style="${t.lastAction==="start" ? "background:#f2c94c;color:#332d24;border-color:#d8a900;" : ""}" onclick="start(${i})">开始</button>
  <button class="btn-ghost" style="${t.lastAction==="pause" ? "background:#f2c94c;color:#332d24;border-color:#d8a900;" : ""}" onclick="pause(${i})">暂停</button>
  <button class="btn-ghost" style="${t.lastAction==="resume" ? "background:#f2c94c;color:#332d24;border-color:#d8a900;" : ""}" onclick="resume(${i})">继续</button>
</div>

      ${p.unlimited ? "" : `
        <button class="${status==="warning" ? "btn-warn" : "btn-main"} full" onclick="addHour(${i})">
          +1小时 → ¥${calcPriceByTotalMinutes((Number(p.minutes || 0) + Math.floor(Number(t.extra || 0) / 60000) + 60)).toLocaleString()}
        </button>
      `}
      
      <select onchange="setPayTiming(${i},this.value)" ${t.start ? "disabled" : ""}>
       <option value="prepaid" ${t.payTiming==="prepaid"?"selected":""}>先付款</option>
       <option value="postpaid" ${t.payTiming==="postpaid"?"selected":""}>后付款</option>
      </select>
      <select onchange="setPay(${i},this.value)">
        <option value="">付款方式</option>
        <option value="现金" ${t.pay==="现金"?"selected":""}>现金</option>
        <option value="PayPay" ${t.pay==="PayPay"?"selected":""}>PayPay</option>
        <option value="微信" ${t.pay==="微信"?"selected":""}>微信</option>
        <option value="支付宝" ${t.pay==="支付宝"?"selected":""}>支付宝</option>
      </select>

      <select onchange="setCurrency(${i},this.value)">
        <option value="日元" ${t.currency==="日元"?"selected":""}>日元</option>
        <option value="人民币" ${t.currency==="人民币"?"selected":""}>人民币</option>
      </select>

      <button class="btn-success full" onclick="openCheckout(${i})">结账</button>

    `;

    box.appendChild(div);
    generateQR(i);
  });

  renderAlarmPanel();

  }catch(e){
    alert(
      "render错误:\n" +
      e.message +
      "\n行号:" +
      (e.lineNumber || "")
    );
    console.error(e);
  }

}

async function initPush(){
  try{
    if(!("Notification" in window)){
      alert("失败原因：这个浏览器不支持 Notification");
      return;
    }

    if(!("serviceWorker" in navigator)){
      alert("失败原因：这个浏览器不支持 Service Worker");
      return;
    }

    if(!VAPID_KEY || VAPID_KEY.includes("这里填")){
      alert("失败原因：VAPID_KEY 还没有填");
      return;
    }

    const permission = await Notification.requestPermission();

    if(permission !== "granted"){
      alert("失败原因：你没有允许通知权限");
      return;
    }

  /*const { getMessaging, getToken, onMessage } = await import(
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js"
);

    const messaging = getMessaging(app);

    onMessage(messaging,(payload)=>{
      const title = payload.notification?.title || "Chiptune提醒";
      const body = payload.notification?.body || "";
      notifyLocal(title,body);
    });

    const swPath = location.pathname.includes("/chiptune--table-timer2.0/")
      ? "/chiptune--table-timer2.0/firebase-messaging-sw.js"
      : "./firebase-messaging-sw.js";

    const registration = await navigator.serviceWorker.register(swPath);

    const token = await getToken(messaging,{
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    
    if(!token){
      alert("失败原因：Firebase 没有返回 token");
      return;
    }
*/
if (!("Notification" in window)) {
  alert("失败原因：当前设备不支持通知提醒");
  return;
}


localStorage.setItem("chiptuneNotifyEnabled", "1");
alert("锁屏提醒已开启");
    
    /*await setDoc(doc(db,"devices",token),{
      token,
      userAgent:navigator.userAgent,
      createdAt:Date.now(),
      enabled:true
    });

    alert("锁屏提醒已开启 ✅");
    alert("Token: " + token);
*/
  }catch(e){
    console.error(e);
    alert("推送失败原因：" + (e.code || e.name || "") + "\n" + (e.message || e));
  }
}

function notifyLocal(title,body){
  try{
    if("Notification" in window && Notification.permission === "granted"){
      new Notification(title,{
        body,
        icon:"./icon.png"
      });
    }

    if(navigator.vibrate){
      navigator.vibrate([300,100,300]);
    }
  }catch(e){}
}

function setPackage(i,v){
  state.tables[i].packageIndex = Number(v);
  save();
}

function toggleType(i,type){
  const t = state.tables[i];

  if(t.type === type){
    t.type = "";
  }else{
    t.type = type;
  }

  const nameInput = document.getElementById("name-"+i);
  const phoneInput = document.getElementById("phone-"+i);

  if(nameInput) t.customer.name = nameInput.value;
  if(phoneInput) t.customer.phoneLast4 = phoneInput.value;

  render();
  save();
}

function setWalkin(i){
  const t = state.tables[i];

  t.type = "walkin";

  t.customer.name =
    document.getElementById("name-"+i).value;

  t.customer.phoneLast4 =
    document.getElementById("phone-"+i).value;

  render();
  save();
}

function setBooking(i){
  const t = state.tables[i];

  t.type = "booking";

  t.customer.name =
    document.getElementById("name-"+i).value;

  t.customer.phoneLast4 =
    document.getElementById("phone-"+i).value;

  render();
  save();
}

function updateCustomer(i){
  const t = state.tables[i];

  const nameInput = document.getElementById("name-"+i);
  const phoneInput = document.getElementById("phone-"+i);

  if(nameInput) t.customer.name = nameInput.value;
  if(phoneInput) t.customer.phoneLast4 = phoneInput.value;

  save();
}

function start(i){
  const pre = Number(document.getElementById("pre-"+i).value || 0);
  const t = state.tables[i];
  const startTime = Date.now() - pre * 60000;

  stopAlertLoop(i);

  t.start = startTime;
  const p = getPackage(t);

t.payTiming = t.payTiming || "prepaid";

if(t.payTiming === "prepaid"){
  if(!t.pay){
    alert("先付款模式必须先选择付款方式");
    return;
  }

  t.paidJPY = Number(p.price || 0);
  t.paidRMB = getRMB(t.paidJPY);
  t.paidAt = Date.now();
}else{
  t.paidJPY = 0;
  t.paidRMB = 0;
  t.paidAt = null;
}

createOrUpdateRecord(t);

  t.pausedAt = null;
  t.alerted = false;
  t.alerting = false;
  t.lastAction = "start";

  // 如果这桌是预约客人，自动把预约标记为已入桌
  if(t.type === "booking" && Array.isArray(state.bookings)){
  const booking = state.bookings.find(b=>{
    const raw = Array.isArray(b.tableIndexes)
      ? b.tableIndexes
      : [b.tableIndex];

    const tableIndexes = raw
      .filter(v => v !== undefined && v !== null && v !== "")
      .map(v => Number(v));

    return tableIndexes.includes(i) &&
           !b.checkedIn &&
           (!b.name || b.name === t.customer.name);
  });

  if(booking){
    booking.checkedIn = true;
    booking.checkInTime = startTime;
    booking.checkInTimeText = new Date(startTime).toLocaleString();
  }
}
  save();
}

function pause(i){
  const t = state.tables[i];
  t.lastAction = "pause";
  if(!t.start || t.pausedAt) return;

  stopAlertLoop(i);

  t.pausedAt = Date.now();
  t.alerting = false;
  t.lastAction = "pause";
  save();
}

function resume(i){
  const t = state.tables[i];
  t.lastAction = "resume"; 
  if(!t.pausedAt) return;

  const pausedMs = Date.now() - t.pausedAt;
  t.start += pausedMs;
  t.pausedAt = null;
  t.alerted = false;
  t.alerting = false;
  t.lastAction = "resume";

  save();
}

function addHour(i){
  const t = state.tables[i];

  stopAlertLoop(i);

  t.extra += 60 * 60 * 1000;
  t.alerted = false;
  t.alerting = false;
  createOrUpdateRecord(t);
  save();
}

function setPayTiming(i,v){
  state.tables[i].payTiming = v;
  save();
}

function setPay(i,v){
  updateCustomer(i);
  state.tables[i].pay = v;
  save();
}

function setCurrency(i,v){
  state.tables[i].currency = v;
  save();
}

function openCheckout(i){
  checkoutIndex = i;
  useRound = false;

  const btn = document.getElementById("roundButton");
  if(btn){
    btn.classList.remove("active");
    btn.innerText = "抹零";
  }

  updateCheckout();
  document.getElementById("checkoutModalBg").style.display = "block";
}

function toggleRound(){
  useRound = !useRound;

  const btn = document.getElementById("roundButton");
  if(btn){
    btn.classList.toggle("active",useRound);
    btn.innerText = useRound ? "已抹零" : "抹零";
  }

  updateCheckout();
}

function updateCheckout(){
  const t = state.tables[checkoutIndex];
  const p = getPackage(t);

  const originalJPY = getOriginalJPY(t);
  const dueJPY = getDueJPY(t);
  const finalJPY = useRound ? roundJPY(dueJPY) : dueJPY;
  const totalRMB = getRMB(finalJPY);

  document.getElementById("checkoutInfo").innerHTML = `
    ${t.name}｜${p.name}${p.unlimited ? "（不限时）" : ""}<br>
    客人：${t.customer.name || "-"} ${t.customer.phoneLast4 || ""}<br>
    类型：${t.type === "booking" ? "预约" : "Walk-in"}<br><br>

    <select id="checkoutPay">
      <option value="">请选择付款方式</option>
      <option value="现金" ${t.pay==="现金"?"selected":""}>现金</option>
      <option value="PayPay" ${t.pay==="PayPay"?"selected":""}>PayPay</option>
      <option value="微信" ${t.pay==="微信"?"selected":""}>微信</option>
      <option value="支付宝" ${t.pay==="支付宝"?"selected":""}>支付宝</option>
    </select>

    <select id="checkoutCurrency" style="margin-top:8px;">
      <option value="日元" ${t.currency==="日元"?"selected":""}>日元</option>
      <option value="人民币" ${t.currency==="人民币"?"selected":""}>人民币</option>
    </select>
  `;

  document.getElementById("checkoutAmount").innerHTML = `
    原价日元：¥${originalJPY.toLocaleString()}<br>
    结账日元：¥${finalJPY.toLocaleString()}<br>
    人民币：¥${totalRMB.toLocaleString()}
  `;
}



function confirmCheckout(){
  const t = state.tables[checkoutIndex];
  const p = getPackage(t);

  const pay = document.getElementById("checkoutPay")?.value || "";
const currency = document.getElementById("checkoutCurrency")?.value || "日元";

if(!pay){
  alert("请选择付款方式");
  return;
}

t.pay = pay;
t.currency = currency;

  if(!confirm("确认结账？")){
    return;
  }

  stopAlertLoop(checkoutIndex);
  const originalJPY = getOriginalJPY(t);
  const dueJPY = getDueJPY(t);
  const finalJPY = useRound ? roundJPY(dueJPY) : dueJPY;
  const totalRMB = getRMB(finalJPY);
  const now = new Date();

  const record = createOrUpdateRecord(t);

t.paidJPY = Number(t.paidJPY || 0) + finalJPY;
t.paidRMB = getRMB(t.paidJPY);
t.paidAt = Date.now();

record.totalJPY = t.paidJPY;
record.totalRMB = getRMB(t.paidJPY);
record.paidJPY = t.paidJPY;
record.dueJPY = Math.max(0, getOriginalJPY(t) - t.paidJPY);

record.pay = t.pay;
record.currency = t.currency || "日元";
record.roundRule = useRound ? "500抹零" : "不抹零";
record.paidStatus = record.dueJPY > 0 ? "未结清" : "已结清";
record.checkoutMethod = t.payTiming === "postpaid" ? "后付款一次性结账" : "结账确认";
record.recordType = t.payTiming === "postpaid" ? "postpaid" : "prepaid";
record.closedAt = Date.now();
record.closedTime = new Date().toLocaleString();

const visit = createOrUpdateCustomerVisit(t);
if(visit){
  visit.endAt = Date.now();
  visit.range = getVisitRangeText(t);
  visit.closed = true;
  visit.finalJPY = t.paidJPY;
  visit.closedTime = new Date().toLocaleString();
}

state.tables[checkoutIndex] = resetTable(t.name);
  save();
  closeCheckout();
}

function closeCheckout(){
  document.getElementById("checkoutModalBg").style.display = "none";
}

function generateQR(i){
  const canvas = document.getElementById("qr-"+i);
  if(!canvas) return;

  const url = location.origin + location.pathname.replace("app.html","display.html") + "?table=" + (i+1);

  import("https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js").then(QR=>{
    QR.toCanvas(canvas,url);
  });
}

function playBeep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.frequency.value = 880;
    g.gain.value = 0.2;

    o.connect(g);
    g.connect(ctx.destination);

    o.start();
    setTimeout(()=>{
      o.stop();
      ctx.close();
    },500);
  }catch(e){}
}

function startAlertLoop(i){
  if(alertLoops[i]) return;
  if(!state || !state.tables[i]) return;

  playBeep();
  notifyLocal("Chiptune 超时提醒", state.tables[i].name + " 已超时");

  const soundLoop = setInterval(()=>{
    playBeep();
  },3000);

  const notifyLoop = setInterval(()=>{
    if(state && state.tables[i]){
      notifyLocal("Chiptune 超时提醒", state.tables[i].name + " 已超时");
    }
  },30000);

  alertLoops[i] = {
    sound:soundLoop,
    notify:notifyLoop
  };
}

function stopAlertLoop(i){
  if(!alertLoops[i]) return;

  clearInterval(alertLoops[i].sound);
  clearInterval(alertLoops[i].notify);

  delete alertLoops[i];
}

function renderAlarmPanel(){
  const panel = document.getElementById("alarmPanel");
  const list = document.getElementById("alarmList");
  if(!panel || !list || !state) return;

  const overtimeTables = state.tables.filter(t=>{
    if(!t.start || t.pausedAt) return false;

    const p = getPackage(t);
    if(p.unlimited) return false;

    const elapsed = Date.now() - t.start;
    const limit = Number(p.minutes || 0) * 60 * 1000 + Number(t.extra || 0);

    return elapsed > limit;
  });

  if(!overtimeTables.length){
    panel.style.display = "none";
    list.innerHTML = "";
    return;
  }

  panel.style.display = "block";
  list.innerHTML = overtimeTables.map(t=>{
    return `<div class="alarm-item">${t.name} 已超时</div>`;
  }).join("");
}

setInterval(()=>{
  const active = document.activeElement;

  if(
    active &&
    (
      active.tagName === "INPUT" ||
      active.tagName === "SELECT"
    ) &&
    !active.id?.includes("Filter") &&
    active.id !== "sortMode"
  ){
    return;
  }

  render();
},1000);

function setSearchKeyword(v){
  searchKeyword = v;
  render();
}

function setStatusFilter(v){
  statusFilter = v;
  document.activeElement.blur();
  render();
}

function setTypeFilter(v){
  typeFilter = v;
  document.activeElement.blur();
  render();
}

function setPayFilter(v){
  payFilter = v;
  document.activeElement.blur();
  render();
}



function openBatchStart(){
  const pkgBox = document.getElementById("batchPackageSelect");
  const tableBox = document.getElementById("batchTableChecks");

  pkgBox.innerHTML = state.packages.map((p,i)=>`
    <option value="${i}">
      ${p.name}｜${p.unlimited ? "不限时" : p.minutes + "分钟"}｜¥${p.price}
    </option>
  `).join("");

  tableBox.innerHTML = state.tables
    .map((t,i)=>({t,i}))
    .filter(({t})=>!t.start)
    .map(({t,i})=>`
      <label class="table-item">
        <input type="checkbox" class="batch-table-check" value="${i}">
        <span class="num">${t.name.replace("号桌","")}</span>
        <span class="sub">可开始</span>
      </label>
    `).join("");

  if(!tableBox.innerHTML){
    tableBox.innerHTML = `<p style="color:#8a8174;">没有可开始的桌位</p>`;
  }

  document.getElementById("batchStartModalBg").style.display = "block";
}

function closeBatchStart(){
  document.getElementById("batchStartModalBg").style.display = "none";
}

function confirmBatchStart(){
  const packageIndex = Number(document.getElementById("batchPackageSelect").value);
  const pay = document.getElementById("batchPaySelect").value;

  if(!pay){
    alert("请选择付款方式");
    return;
  }

  const indexes = [...document.querySelectorAll(".batch-table-check:checked")]
    .map(el=>Number(el.value));

  if(indexes.length === 0){
    alert("请选择至少一张桌");
    return;
  }

  indexes.forEach(i=>{
    const t = state.tables[i];
    if(!t || t.start) return;

    t.packageIndex = packageIndex;
    t.pay = pay;
    t.start = Date.now();
    t.pausedAt = null;
    t.alerted = false;
    t.alerting = false;
    t.lastAction = "start";
    t.paidJPY = Number(getPackage(t).price || 0);
    t.paidRMB = getRMB(t.paidJPY);
    t.paidAt = Date.now();
    t.payTiming = "prepaid";

createOrUpdateRecord(t);
  });

  save();
  closeBatchStart();
  render();
}






function openBatchCheckout(){
  const box = document.getElementById("batchCheckoutTableChecks");

  box.innerHTML = state.tables
    .map((t,i)=>({t,i}))
    .filter(({t})=>t.start)
    .map(({t,i})=>{
      const p = getPackage(t);
      const amountJPY = getOriginalJPY(t);
      const amountRMB = getRMB(amountJPY);

      return `
        <div class="batch-checkout-card">

          <label class="batch-table-card">
            <input type="checkbox" class="batch-checkout-table" value="${i}">
            <span class="table-name">${t.name}</span>
          </label>

          <div class="batch-info">
            <div><b>套餐：</b>${p.name}</div>
            <div><b>客人：</b>${t.customer?.name || "-"} ${t.customer?.phoneLast4 || ""}</div>
            <div><b>原价：</b>¥${amountJPY.toLocaleString()}</div>
            <div><b>人民币参考：</b>¥${amountRMB.toLocaleString()}</div>
          </div>

          <select id="batch-pay-${i}">
            <option value="">付款方式</option>
            <option value="现金">现金</option>
            <option value="PayPay">PayPay</option>
            <option value="微信">微信</option>
            <option value="支付宝">支付宝</option>
          </select>

          <select id="batch-currency-${i}">
            <option value="日元">日元</option>
            <option value="人民币">人民币</option>
          </select>

          <input
            id="batch-amount-${i}"
            type="number"
            value="${amountJPY}"
            placeholder="实际收款金额"
          >

          <button
            id="round-btn-${i}"
            class="btn-ghost full"
            onclick="roundBatchAmount(${i})"
          >
            抹零
          </button>

        </div>
      `;
    }).join("");

  if(!box.innerHTML){
    box.innerHTML = `<p style="color:#8a8174;">没有正在使用的桌位</p>`;
  }

  document.getElementById("batchCheckoutModalBg").style.display = "block";
}

function roundBatchAmount(i){
  const amountInput = document.getElementById(`batch-amount-${i}`);
  const btn = document.getElementById(`round-btn-${i}`);

  if(!amountInput || !btn || btn.disabled) return;

  const amount = Number(amountInput.value || 0);
  amountInput.value = roundJPY(amount);

  btn.disabled = true;
  btn.innerText = "已抹零";
  btn.classList.add("disabled-round");
}

function closeBatchCheckout(){
  document.getElementById("batchCheckoutModalBg").style.display = "none";
}

function confirmBatchCheckout(){
  const indexes = [...document.querySelectorAll(".batch-checkout-table:checked")]
    .map(el=>Number(el.value));

  if(indexes.length === 0){
    alert("请选择至少一张桌");
    return;
  }

  const noPay = indexes.filter(i=>{
    return !document.getElementById(`batch-pay-${i}`)?.value;
  });

  if(noPay.length){
    alert("以下桌位还没有选择付款方式：\n" + noPay.map(i=>state.tables[i].name).join("、"));
    return;
  }

  if(!confirm(`确认批量结账 ${indexes.length} 桌吗？`)) return;

  indexes.forEach(i=>{
    const t = state.tables[i];
    const p = getPackage(t);

    const originalJPY = getOriginalJPY(t);
    const defaultRMB = getRMB(originalJPY);

    const pay = document.getElementById(`batch-pay-${i}`).value;
    const currency = document.getElementById(`batch-currency-${i}`).value;
    const manualAmount = Number(document.getElementById(`batch-amount-${i}`).value || 0);

    const finalJPY =
      currency === "日元"
        ? (manualAmount > 0 ? manualAmount : originalJPY)
        : originalJPY;

    const totalRMB =
      currency === "人民币"
        ? (manualAmount > 0 ? manualAmount : defaultRMB)
        : defaultRMB;

    const now = new Date();

    stopAlertLoop(i);

    const record = createOrUpdateRecord(t);

t.pay = pay;
t.currency = currency;

const dueJPY = Math.max(0, originalJPY - Number(t.paidJPY || 0));
const finalPaidJPY = currency === "日元"
  ? (manualAmount > 0 ? manualAmount : dueJPY)
  : dueJPY;

t.paidJPY = Number(t.paidJPY || 0) + finalPaidJPY;
t.paidRMB = getRMB(t.paidJPY);
t.paidAt = Date.now();

record.totalJPY = t.paidJPY;
record.totalRMB = getRMB(t.paidJPY);
record.paidJPY = t.paidJPY;
record.dueJPY = Math.max(0, getOriginalJPY(t) - t.paidJPY);
record.pay = pay;
record.currency = currency;
record.roundRule = "不抹零";
record.paidStatus = record.dueJPY > 0 ? "未结清" : "已结清";
record.checkoutMethod = "批量结账";
record.closedAt = Date.now();
record.closedTime = new Date().toLocaleString();

state.tables[i] = resetTable(t.name);
    });

  save();
  closeBatchCheckout();
  render();
}

function toggleSortDirection(){
  sortDirection = sortDirection === "asc" ? "desc" : "asc";

  const btn = document.getElementById("sortDirectionBtn");
  if(btn){
    btn.innerText = sortDirection === "asc" ? "当前：正序" : "当前：倒序";
  }

  render();
}

function toggleFilterPanel(){
  filterPanelOpen = !filterPanelOpen;

  const body = document.getElementById("filterPanelBody");
  const btn = document.getElementById("filterToggleBtn");

  if(body){
    body.style.display = filterPanelOpen ? "block" : "none";
  }

  if(btn){
    btn.innerText = filterPanelOpen ? "收起" : "展开";
  }
}


window.toggleSortDirection = toggleSortDirection;
window.toggleFilterPanel = toggleFilterPanel;
window.roundBatchAmount = roundBatchAmount;
window.openBatchCheckout = openBatchCheckout;
window.closeBatchCheckout = closeBatchCheckout;
window.confirmBatchCheckout = confirmBatchCheckout;
window.openBatchStart = openBatchStart;
window.closeBatchStart = closeBatchStart;
window.confirmBatchStart = confirmBatchStart;
window.setSearchKeyword = setSearchKeyword;
window.setStatusFilter = setStatusFilter;
window.setTypeFilter = setTypeFilter;
window.setPayFilter = setPayFilter;
window.setPackage = setPackage;
window.setWalkin = setWalkin;
window.setBooking = setBooking;
window.start = start;
window.pause = pause;
window.resume = resume;
window.addHour = addHour;
window.setPay = setPay;
window.setCurrency = setCurrency;
window.openCheckout = openCheckout;
window.toggleRound = toggleRound;
window.confirmCheckout = confirmCheckout;
window.closeCheckout = closeCheckout;
window.initPush = initPush;
window.updateCustomer = updateCustomer;
window.toggleType = toggleType;
window.roundBatchAmount = roundBatchAmount;
window.render = render;
window.setPayTiming = setPayTiming;