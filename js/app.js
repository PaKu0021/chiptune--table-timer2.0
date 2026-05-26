import { app, db } from "./firebase.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { formatTime } from "./common.js";

const ref = doc(db, "shop", "main");
const RATE = 0.044;
const VAPID_KEY = "BN7TodJ52H-wKg54Dj-tFcm21Q5zplpmeFuXYzqtQbkb1LzpTO-pRsGV1fWpUEiDKxBbqN8l2SRtzXuiisRHEPE";

let state = null;
let checkoutIndex = null;
let useRound = false;
let alertLoops = {};
let remindLocks = {};

function newTable(i){
  return {
    name: i + "号桌",
    start: null,
    extra: 0,
    packageIndex: 0,
    type: "",
    pay: "",
    currency: "日元",
    customer: { name:"", phoneLast4:"" },
    alerted: false,
    alerting: false,
    pausedAt: null
  };
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
  bookings:[]
};

onSnapshot(ref, snap=>{
  if(snap.exists()){
    state = snap.data();

    if(!state.packages) state.packages = defaultState.packages;
    if(!state.records) state.records = [];
    if(!state.bookings) state.bookings = [];
    if(!state.tables) state.tables = defaultState.tables;

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
      if(t.type === undefined) t.type = "";
    });

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
  return state.packages[t.packageIndex] || state.packages[0];
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

function getOriginalJPY(t){
  const p = getPackage(t);
  if(p.unlimited) return Number(p.price || 0);
  return Number(p.price || 0) + (Number(t.extra || 0) / 3600000) * Number(p.extensionPrice || 0);
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
  if(!state) return;

  const box = document.getElementById("tables");
  box.innerHTML = "";

  state.tables.forEach((t,i)=>{
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

    const div = document.createElement("div");
    div.className = "card " + status;

    div.innerHTML = `
      <h3>${t.name}</h3>

      <select onchange="setPackage(${i},this.value)" ${t.start ? "disabled" : ""}>
        ${state.packages.map((pkg,idx)=>`
          <option value="${idx}" ${idx===t.packageIndex ? "selected" : ""}>
            ${pkg.name}｜${pkg.unlimited ? "不限时" : pkg.minutes + "分钟"}｜¥${pkg.price}｜续费¥${pkg.extensionPrice}/小时
          </option>
        `).join("")}
      </select>

      <div class="timer" style="color:${status==="overtime" ? "#e85d5d" : status==="warning" ? "#ff9800" : "#333"};">
        ${timeText}
      </div>

      <div class="info">
        类型：${t.type || "-"}<br>
        客人：${t.customer.name || "-"} ${t.customer.phoneLast4 || ""}<br>
        当前日元：¥${originalJPY.toLocaleString()}<br>
        抹零参考：¥${roundedJPY.toLocaleString()}<br>
        人民币参考：¥${getRMB(originalJPY).toLocaleString()}
      </div>

      <div class="row">
        <input placeholder="姓名" id="name-${i}" value="${t.customer.name || ""}">
        <input placeholder="手机后4位" id="phone-${i}" value="${t.customer.phoneLast4 || ""}">
      </div>

      <div class="action-row">
        <button class="btn-blue" onclick="setWalkin(${i})">Walk-in</button>
        <button class="btn-blue" onclick="setBooking(${i})">预约</button>
      </div>

      <input placeholder="提前分钟" id="pre-${i}">

      <div class="action-row">
        <button class="btn-main" onclick="start(${i})">开始</button>
        <button class="btn-ghost" onclick="pause(${i})">暂停</button>
        <button class="btn-ghost" onclick="resume(${i})">继续</button>
      </div>

      ${p.unlimited ? "" : `
        <button class="${status==="warning" ? "btn-warn" : "btn-main"} full" onclick="addHour(${i})">
          +1小时 ¥${p.extensionPrice}
        </button>
      `}

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

    const { getMessaging, getToken, onMessage } = await import(
      "https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging.js"
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

    await setDoc(doc(db,"devices",token),{
      token,
      userAgent:navigator.userAgent,
      createdAt:Date.now(),
      enabled:true
    });

    alert("锁屏提醒已开启 ✅");
    alert("Token: " + token);

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

function setWalkin(i){
  const t = state.tables[i];
  t.type = "walkin";
  t.customer.name = document.getElementById("name-"+i).value;
  t.customer.phoneLast4 = document.getElementById("phone-"+i).value;
  save();
}

function setBooking(i){
  const t = state.tables[i];
  t.type = "booking";
  t.customer.name = document.getElementById("name-"+i).value;
  t.customer.phoneLast4 = document.getElementById("phone-"+i).value;
  save();
}

function start(i){
  const pre = Number(document.getElementById("pre-"+i).value || 0);
  const t = state.tables[i];

  stopAlertLoop(i);

  t.start = Date.now() - pre * 60000;
  t.pausedAt = null;
  t.alerted = false;
  t.alerting = false;

  save();
}

function pause(i){
  const t = state.tables[i];
  if(!t.start || t.pausedAt) return;

  stopAlertLoop(i);

  t.pausedAt = Date.now();
  t.alerting = false;

  save();
}

function resume(i){
  const t = state.tables[i];
  if(!t.pausedAt) return;

  const pausedMs = Date.now() - t.pausedAt;
  t.start += pausedMs;
  t.pausedAt = null;
  t.alerted = false;
  t.alerting = false;

  save();
}

function addHour(i){
  const t = state.tables[i];

  stopAlertLoop(i);

  t.extra += 60 * 60 * 1000;
  t.alerted = false;
  t.alerting = false;

  save();
}

function setPay(i,v){
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
  const finalJPY = useRound ? roundJPY(originalJPY) : originalJPY;
  const totalRMB = getRMB(finalJPY);

  document.getElementById("checkoutInfo").innerHTML = `
    ${t.name}｜${p.name}${p.unlimited ? "（不限时）" : ""}<br>
    客人：${t.customer.name || "-"} ${t.customer.phoneLast4 || ""}<br>
    类型：${t.type === "booking" ? "预约" : "Walk-in"}<br>
    付款：${t.pay || "未选择"}｜币种：${t.currency}
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

  if(!t.pay){
    alert("请选择付款方式");
    return;
  }

  if(!confirm("确认结账？")){
    return;
  }

  stopAlertLoop(checkoutIndex);

  const originalJPY = getOriginalJPY(t);
  const finalJPY = useRound ? roundJPY(originalJPY) : originalJPY;
  const totalRMB = getRMB(finalJPY);
  const now = new Date();

  state.records.push({
    timestamp: now.getTime(),
    time: now.toLocaleString(),
    tableName: t.name,
    customerName: t.customer?.name || "",
    phoneLast4: t.customer?.phoneLast4 || "",
    customerType: t.type || "walkin",
    packageName: p.name,
    packageMinutes: p.unlimited ? "不限时" : p.minutes,
    packagePrice: p.price,
    extraMinutes: Math.floor(Number(t.extra || 0) / 60000),
    extensionAmount: (Number(t.extra || 0) / 3600000) * Number(p.extensionPrice || 0),
    originalJPY,
    totalJPY: finalJPY,
    totalRMB,
    pay: t.pay,
    currency: t.currency || "日元",
    roundRule: useRound ? "500抹零" : "不抹零"
  });

  state.tables[checkoutIndex] = {
    name: t.name,
    start: null,
    extra: 0,
    packageIndex: 0,
    type: "",
    pay: "",
    currency: "日元",
    customer:{ name:"", phoneLast4:"" },
    alerted:false,
    alerting:false,
    pausedAt:null
  };

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

  if(active && (active.tagName === "SELECT" || active.tagName === "INPUT")){
    return;
  }

  render();
},1000);

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
