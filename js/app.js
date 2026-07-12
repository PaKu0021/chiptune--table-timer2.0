/*alert("app.js 已加载");*/
import { db } from "./firebase.js?v=2.6.9";
import { doc, onSnapshot, getDoc, getDocFromServer } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { setStateBaseline, saveStateSafely, installConnectionGuard, setSyncStatus, atomicAdjustTableExtra, loadLocalState, reconcileCloudState, flushPending, getLocalRecord, getLocalRecordSync, saveRecordSafely, emergencySaveRecord, emergencySaveState } from "./safe-state.js?v=2.6.9";
/*import { formatTime } from "./common.js?v=2.6.5";*/
import { resetTable, formatTime } from "./common.js?v=2.6.9";
const ref = doc(db, "shop", "main");
const RATE = 0.044;
const VAPID_KEY = "BN7TodJ52H-wKg54Dj-tFcm21Q5zplpmeFuXYzqtQbkb1LzpTO-pRsGV1fWpUEiDKxBbqN8l2SRtzXuiisRHEPE";


let state = null;
installConnectionGuard();

loadLocalState()
  .then(local=>{
    if(!local || state) return;

    applyIncomingAppState(
      local,
      "本机缓存"
    );
  })
  .catch(error=>{
    console.error(
      "读取本机桌位状态失败",
      error
    );
  });
window.addEventListener("chiptune-online-change",e=>{
  if(e.detail?.online) flushPending({db,ref}).catch(err=>console.warn("自动同步失败",err));
});
window.addEventListener("chiptune-sync-tick",()=>{
  flushPending({db,ref}).catch(err=>console.warn("定时同步失败",err));
});

// 本机事务写入云端成功后，立即采用服务器最终合并状态。
window.addEventListener(
  "chiptune-cloud-state-saved",
  event=>{
    applyIncomingAppState(
      event.detail?.state,
      "云端保存"
    );
  }
);

window.addEventListener(
  "chiptune-state-broadcast",
  event=>{
    const incoming =
      event.detail?.state;

    if(!incoming) return;

    applyIncomingAppState(
      incoming,
      event.detail?.action
        ? `本机页面同步：${event.detail.action}`
        : "本机页面同步"
    );

    setSyncStatus(
      navigator.onLine
        ? "pending"
        : "offline",
      navigator.onLine
        ? "● 已收到预约操作 · 正在同步云端"
        : "● 已收到预约操作 · 当前离线"
    );
  }
);

window.addEventListener(
  "storage",
  event=>{
    if(
      event.key !== "chiptune_state_shadow_v2" ||
      !event.newValue
    ){
      return;
    }

    try{
      const box =
        JSON.parse(event.newValue);

      if(!box?.state) return;

      applyIncomingAppState(
        box.state,
        "本机状态备份"
      );
    }catch(error){
      console.warn(
        "读取其他页面状态失败",
        error
      );
    }
  }
);
// iPad 桌面网页偶尔会只停留在 Firestore 缓存。每 5 秒主动向服务器核对一次，
// 确保手机、iPad 和其他终端都能看到同一份最新桌位状态。
async function refreshSharedStateFromServer(){
  if(!navigator.onLine) return;

  try{
    const snap =
      await getDocFromServer(ref);

    if(!snap.exists()) return;

    const incoming =
      await reconcileCloudState(
        snap.data()
      );

    applyIncomingAppState(
      incoming,
      "主动服务器刷新"
    );

  }catch(error){
    console.warn(
      "主动刷新共享桌位状态失败",
      error
    );
  }
}
setInterval(refreshSharedStateFromServer,15000);
window.addEventListener("online",refreshSharedStateFromServer);
document.addEventListener("visibilitychange",()=>{ if(!document.hidden) refreshSharedStateFromServer(); });

let checkoutIndex = null;
let checkoutSubmitting = false;
let forceEndIndex = null;
let forceEndSubmitting = false;
let useRound = false;
let alertLoops = {};
let remindLocks = {};
let searchKeyword = "";
let statusFilter = "";
let typeFilter = "";
let payFilter = "";
let sortDirection = "asc";
let filterPanelOpen = true;
let autoClosingOldTables = false;
let movingRunningFromIndex = null;
let movingRunningToIndex = null;
let draggingRunningFrom = null;
let runningMoveTempLine = null;
let runningMoveAreaRect = null;


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
  tables: Array.from({length:12},(_,i)=>newTable(i+1)),
  bookings:[],
  customers:{}
};

function normalizeAppCustomers(customers){
  const result = {};

  if(Array.isArray(customers)){
    customers.forEach(customer=>{
      if(
        !customer ||
        typeof customer !== "object"
      ){
        return;
      }

      const key =
        customer.key ||
        makeCustomerKey(
          customer.name,
          customer.phoneLast4
        );

      if(!key) return;

      result[key] = {
        ...customer,
        key,
        visits:Array.isArray(customer.visits)
          ? customer.visits
          : [],
        visitCount:Array.isArray(customer.visits)
          ? customer.visits.length
          : Number(customer.visitCount || 0)
      };
    });

    return result;
  }

  if(
    customers &&
    typeof customers === "object"
  ){
    Object.entries(customers)
      .forEach(([rawKey,customer])=>{
        if(
          !customer ||
          typeof customer !== "object"
        ){
          return;
        }

        const key =
          customer.key ||
          rawKey ||
          makeCustomerKey(
            customer.name,
            customer.phoneLast4
          );

        if(!key) return;

        const visits =
          Array.isArray(customer.visits)
            ? customer.visits
            : [];

        result[key] = {
          ...customer,
          key,
          visits,
          visitCount:visits.length
        };
      });
  }

  return result;
}

function normalizeAppState(nextState){
  const next =
    nextState && typeof nextState === "object"
      ? nextState
      : structuredClone(defaultState);

  if(
    !Array.isArray(next.tables) ||
    next.tables.length === 0
  ){
    next.tables =
      structuredClone(defaultState.tables);
  }

  if(
    !Array.isArray(next.packages) ||
    next.packages.length === 0
  ){
    next.packages =
      structuredClone(defaultState.packages);
  }

  if(!Array.isArray(next.bookings)){
    next.bookings = [];
  }

  if(!Array.isArray(next.groups)){
    next.groups = [];
  }

  next.customers =
    normalizeAppCustomers(next.customers);

  next.tables.forEach((t,i)=>{
    if(!t || typeof t !== "object"){
      next.tables[i] =
        resetTable((i + 1) + "号桌");
      return;
    }

    if(!t.name) t.name = (i + 1) + "号桌";
    if(t.packageIndex === undefined) t.packageIndex = 0;
    if(!t.customer) t.customer = {name:"",phoneLast4:""};
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
    if(t.groupId === undefined) t.groupId = "";
    if(t.groupName === undefined) t.groupName = "";
    if(t.groupColor === undefined) t.groupColor = "";
    if(t.activeColor === undefined) t.activeColor = "";

    if(t.customPackage?.enabled){
      t.customPackage.enabled = false;
    }
  });

  return next;
}

function applyIncomingAppState(
  incoming,
  source="同步"
){
  if(
    !incoming ||
    typeof incoming !== "object"
  ){
    return;
  }

  state = normalizeAppState(
    structuredClone(incoming)
  );

  try{
    render();

    /*
     * 不阻塞状态接收和页面刷新。
     */
    Promise.resolve()
      .then(()=>autoCloseOldTables())
      .catch(error=>{
        console.warn(
          "自动检查跨天桌位失败",
          error
        );
      });

    console.log(
      `${source}状态已应用`
    );

  }catch(error){
    console.warn(
      `${source}后刷新计时器失败`,
      error
    );
  }
}

onSnapshot(
  ref,
  {includeMetadataChanges:true},
  async snap=>{
    if(snap.exists()){
      const incoming =
        await reconcileCloudState(
          snap.data()
        );

      /*
       * 这里传原始云端数据，
       * 不要传本机合并后的 state。
       */
      if(!snap.metadata.hasPendingWrites){
        setStateBaseline(
          snap.data()
        );
      }

      if(snap.metadata.fromCache){
        setSyncStatus("cache");
      }

      applyIncomingAppState(
        incoming,
        snap.metadata.fromCache
          ? "Firestore缓存"
          : "Firestore云端"
      );

    }else{
      state =
        structuredClone(defaultState);

      await save(
        "initialize_state"
      );
    }
  },
  error=>{
    console.error(
      "读取 shop/main 失败",
      error
    );

    alert(
      "桌位数据读取失败：\n\n" +
      (error.code || "") +
      "\n" +
      (error.message || String(error))
    );

    if(!state){
      applyIncomingAppState(
        structuredClone(defaultState),
        "默认数据"
      );
    }
  }
);


async function save(action="state_update"){
  return saveStateSafely({db, ref, getState:()=>state, action});
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

  const extraHours = Math.floor(Number(t.extra || 0) / 3600000);

  // 老板模式新增的独立金额套餐，按套餐金额＋每小时续时金额计算。
  if(p.customPricing){
    return Number(p.price || 0) + extraHours * Number(p.extensionPrice || 0);
  }

  const baseMinutes = Number(p.minutes || 0);
  const extraMinutes = Math.floor(Number(t.extra || 0) / 60000);
  const totalMinutes = baseMinutes + extraMinutes;

  return calcPriceByTotalMinutes(totalMinutes);
}

function roundJPY(jpy){
  jpy = Number(jpy || 0);

  if(jpy < 0){
    return -roundJPY(Math.abs(jpy));
  }

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

function makePaymentLine({type="收入", reason="", pay="", amountJPY=0, note=""}){
  return {
    type,
    reason,
    pay: pay || "未记录",
    amountJPY: Number(amountJPY || 0),
    amountRMB: getRMB(Number(amountJPY || 0)),
    note,
    time: new Date().toLocaleString(),
    timestamp: Date.now()
  };
}

function normalizePayments(record){
  if(Array.isArray(record.payments)) return record.payments;

  if(Number(record.totalJPY || 0) !== 0){
    return [{
      type:"收入",
      reason:record.checkoutMethod || "历史记录",
      pay:record.pay || "未记录",
      amountJPY:Number(record.totalJPY || 0),
      amountRMB:Number(record.totalRMB || 0),
      note:"旧数据自动兼容",
      time:record.time || "",
      timestamp:record.timestamp || Date.now()
    }];
  }

  return [];
}

function sumPaymentsJPY(payments){
  return payments.reduce((sum,p)=>sum + Number(p.amountJPY || 0),0);
}

function getPaymentSummary(payments){
  const pays = [...new Set(
    payments
      .filter(p=>Number(p.amountJPY || 0) !== 0)
      .map(p=>p.pay || "未记录")
  )];

  if(pays.length === 0) return "未记录";
  if(pays.length === 1) return pays[0];
  return "混合";
}

function getDueJPY(t){
  return Math.max(0, getOriginalJPY(t) - Number(t.paidJPY || 0));
}

async function getTableRecord(t){
  if(!t.recordId) return null;

  const local = await getLocalRecord(t.recordId);
  if(local) return local;

  if(!navigator.onLine) return null;
  try{
    const snap = await getDoc(doc(db, "records", t.recordId));
    return snap.exists() ? snap.data() : null;
  }catch(err){
    console.warn("读取云端账单失败，继续使用本机数据", err);
    return null;
  }
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

async function createOrUpdateRecord(t, options = {}){

  const p = getPackage(t);
const originalJPY = getOriginalJPY(t);

let paidJPY = Number(t.paidJPY || 0);

const dueJPY = Math.max(0, originalJPY - paidJPY);

  // 优先使用同步本机影子，避免 iPad 的 IndexedDB/网络卡住时，
  // “开始计时”不能立刻生成账单。
  let record = getLocalRecordSync(t.recordId);
  if(!record && t.recordId){
    try{
      record = await Promise.race([
        getTableRecord(t),
        new Promise(resolve=>setTimeout(()=>resolve(null),1200))
      ]);
    }catch(_err){
      record = null;
    }
  }

  let isNewRecord = false;

  if(!record){
    isNewRecord = true;
    const id = "rec_" + Date.now() + "_" + Math.random().toString(36).slice(2,8);
    t.recordId = id;


    const now = Date.now();

record = {
  id,
  timestamp: now,
  businessDate: getDateText(now),

  time: new Date(now).toLocaleString(),

  tableName: t.name,

  receiptImage:"",
  receiptFileName:"",
};
  }

  // 入座开始即生成正式账单；结账时只更新同一个 recordId。
  record.startAt = Number(t.start || record.startAt || Date.now());
  record.startedTime = record.startedTime || new Date(record.startAt).toLocaleString();
  record.closed = false;
  record.status = "进行中";

  record.businessDate =
    record.businessDate ||
    getDateText(record.timestamp || Date.now());
  record.tableName = t.name;
  record.groupId = t.groupId || record.groupId || "";
record.groupName = t.groupName || record.groupName || "";
record.groupColor = t.groupColor || t.activeColor || record.groupColor || "";
  record.customerName = t.customer?.name || "";
  record.phoneLast4 = t.customer?.phoneLast4 || "";
  record.customerType = t.type || "walkin";

  record.packageName = p.name;
  record.packageMinutes = p.unlimited ? "不限时" : p.minutes;
  record.packagePrice = p.price;

  record.extraMinutes = Math.floor(Number(t.extra || 0) / 60000);
  record.extensionAmount = Math.max(0, originalJPY - Number(p.price || 0));

  record.originalJPY = originalJPY;


  record.payments = normalizePayments(record);

if(isNewRecord && t.payTiming === "prepaid" && paidJPY > 0){
  record.payments.push(
    makePaymentLine({
      type:"收入",
      reason:"套餐费",
      pay:t.pay || "未记录",
      amountJPY:paidJPY,
      note:"开始计时时记录"
    })
  );
}

const packageLine = record.payments.find(p=>p.reason === "套餐费");

if(packageLine && packageLine.pay === "未记录" && t.pay){
  packageLine.pay = t.pay;
}

// 先付款模式下，续时/撤回续时直接修改同一条账单，
// 并把本次差额作为续时收费或退款记录追加进去。
const adjustmentJPY = Number(options.adjustmentJPY || 0);
if(adjustmentJPY !== 0){
  const actionKey = String(options.actionKey || "");
  const alreadyAdded = actionKey && record.payments.some(p=>p.actionKey === actionKey);
  if(!alreadyAdded){
    const line = makePaymentLine({
      type: adjustmentJPY > 0 ? "收入" : "退款",
      reason: adjustmentJPY > 0 ? "续时费" : "撤回续时",
      pay: t.pay || "未记录",
      amountJPY: adjustmentJPY,
      note: options.note || (adjustmentJPY > 0 ? "续时1小时" : "撤回续时1小时")
    });
    if(actionKey) line.actionKey = actionKey;
    record.payments.push(line);
  }
}

const paymentsTotalJPY = sumPaymentsJPY(record.payments);

record.paidJPY = paymentsTotalJPY;
record.dueJPY = Math.max(0, originalJPY - paymentsTotalJPY);

record.totalJPY = paymentsTotalJPY;
record.totalRMB = getRMB(paymentsTotalJPY);

record.pay = getPaymentSummary(record.payments);




  record.currency = t.currency || "日元";
  record.payTiming = t.payTiming || "prepaid";
  record.paidStatus = Number(record.dueJPY || 0) > 0 ? "未结清" : "已结清";
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

// 同步写入本机影子，今日账单会立即出现；IndexedDB 与 Firestore 后台同步。
emergencySaveRecord({db, ref, record});
  return record;
}

async function updateRecordOnly(record){
  await saveRecordSafely({db, ref, record});
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
        notifyLocal("桌位已超时", t.name + " 已超时，请及时处理");
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
        <div class="action-row">
          <button class="${status==="warning" ? "btn-warn" : "btn-main"}" onclick="addHour(${i})">
            +1小时 → ¥${(p.customPricing
              ? getOriginalJPY({...t, extra:Number(t.extra || 0) + 3600000})
              : calcPriceByTotalMinutes((Number(p.minutes || 0) + Math.floor(Number(t.extra || 0) / 60000) + 60))
            ).toLocaleString()}
          </button>
          <button class="btn-ghost" onclick="undoHour(${i})" ${Number(t.extra || 0) < 3600000 ? "disabled" : ""}>
            撤回1小时
          </button>
        </div>
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

        ${t.start ? `
  <button class="btn-ghost full" onclick="moveRunningTable(${i})">
    移动桌位
  </button>
` : ""}

<button class="btn-success full" onclick="openCheckout(${i})">结账</button>
${t.start ? `
<button class="btn-danger full" onclick="openForceEnd(${i})">
  强制结束桌位
</button>
` : ""}

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
  if (!("Notification" in window)) {
    alert("当前浏览器不支持系统通知");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    localStorage.setItem("chiptuneNotifyEnabled", "1");
    updateNotifyButton();
    notifyLocal("系统通知已开启", "桌位剩余10分钟或超时时会发送静默通知");
  } else {
    localStorage.removeItem("chiptuneNotifyEnabled");
    updateNotifyButton();
    alert("系统通知没有开启，请在 iPad 设置中允许此网页的通知");
  }
}

function updateNotifyButton(){
  const btn = document.getElementById("notifyBtn");
  if(!btn) return;
  const enabled = localStorage.getItem("chiptuneNotifyEnabled") === "1" && Notification.permission === "granted";
  btn.textContent = enabled ? "系统通知：已开启" : "开启系统通知";
}

function notifyLocal(title, body){
  if (!("Notification" in window)) return;
  if (localStorage.getItem("chiptuneNotifyEnabled") !== "1") return;
  if (Notification.permission !== "granted") return;

  try{
    new Notification(title, {
      body,
      icon:"./icon-192.png",
      badge:"./icon-192.png",
      silent:true,
      tag:"chiptune-" + title + "-" + body
    });
  }catch(err){
    console.warn("系统通知发送失败", err);
  }
}

async function setPackage(i,v){
  const t = state.tables[i];

  t.packageIndex = Number(v);
  if(t.customPackage) t.customPackage.enabled = false;

  if(t.start){
    await createOrUpdateRecord(t);
  }

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

async function start(i){
  const pre = Number(document.getElementById("pre-"+i)?.value || 0);
  const t = state.tables[i];
  const startTime = Date.now() - pre * 60000;

  stopAlertLoop(i);

  t.start = startTime;
  t.pausedAt = null;
  t.alerted = false;
  t.alerting = false;
  t.lastAction = "start";

  const p = getPackage(t);
  t.payTiming = t.payTiming || "prepaid";

  if(t.payTiming === "prepaid"){
    t.paidJPY = Number(p.price || 0);
    t.paidRMB = getRMB(t.paidJPY);
    t.paidAt = Date.now();
  }else{
    t.paidJPY = 0;
    t.paidRMB = 0;
    t.paidAt = null;
  }

  // 如果这桌是预约客人，自动把预约标记为已入桌。
  if(t.type === "booking" && Array.isArray(state.bookings)){
    const booking = state.bookings.find(b=>{
      const raw = Array.isArray(b.tableIndexes) ? b.tableIndexes : [b.tableIndex];
      const tableIndexes = raw
        .filter(v => v !== undefined && v !== null && v !== "")
        .map(v => Number(v));
      return tableIndexes.includes(i) && !b.checkedIn && (!b.name || b.name === t.customer.name);
    });
    if(booking){
      booking.checkedIn = true;
      booking.checkInTime = startTime;
      booking.checkInTimeText = new Date(startTime).toLocaleString();
    }
  }

  // 先同步保存桌位状态，确保点击开始后立即生效。
  emergencySaveState({db,ref,state,action:"start_table"});
  render();

  // 先付款：入座开始时立即建立账单；以后续时和结账都更新这一个 recordId。
  await createOrUpdateRecord(t);
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

async function addHour(i){
  stopAlertLoop(i);
  const beforeJPY = getOriginalJPY(state.tables[i]);
  try{
    const updated = await atomicAdjustTableExtra({
      db, ref, tableIndex:i, deltaMs:60 * 60 * 1000, action:"extend_one_hour", getState:()=>state
    });
    state.tables[i] = {...state.tables[i], ...updated};
    const afterJPY = getOriginalJPY(state.tables[i]);
    const deltaJPY = Math.max(0, afterJPY - beforeJPY);
    await createOrUpdateRecord(state.tables[i],{
      adjustmentJPY: state.tables[i].payTiming === "prepaid" ? deltaJPY : 0,
      actionKey:`extend_${Date.now()}_${Number(state.tables[i].extra || 0)}`,
      note:"续时1小时，开始时已收款"
    });
    render();
  }catch(err){
    alert(err.message || "续时保存失败");
  }
}

async function undoHour(i){
  stopAlertLoop(i);
  const beforeJPY = getOriginalJPY(state.tables[i]);
  try{
    const updated = await atomicAdjustTableExtra({
      db, ref, tableIndex:i, deltaMs:-60 * 60 * 1000, action:"undo_one_hour", getState:()=>state
    });
    state.tables[i] = {...state.tables[i], ...updated};
    const afterJPY = getOriginalJPY(state.tables[i]);
    const refundJPY = Math.min(0, afterJPY - beforeJPY);
    if(state.tables[i].start){
      await createOrUpdateRecord(state.tables[i],{
        adjustmentJPY: state.tables[i].payTiming === "prepaid" ? refundJPY : 0,
        actionKey:`undo_${Date.now()}_${Number(state.tables[i].extra || 0)}`,
        note:"撤回续时1小时，记录退款差额"
      });
    }
    render();
  }catch(err){
    alert(err.message || "撤回续时失败");
  }
}


function setPayTiming(i,v){
  state.tables[i].payTiming = v;
  save();
}

async function setPay(i,v){
  updateCustomer(i);

  const t = state.tables[i];
  t.pay = v;

  if(t.start){
    await createOrUpdateRecord(t);
  }

  save();
}

async function setCurrency(i,v){
  const t = state.tables[i];
  t.currency = v;

  if(t.start){
    await createOrUpdateRecord(t);
  }

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

<label style="font-weight:900;display:block;margin:10px 0 6px;">
  本次结账补收付款方式
</label>

<select id="checkoutPay">
  <option value="">请选择【本次补收】付款方式</option>
  <option value="现金" ${t.pay==="现金"?"selected":""}>现金</option>
  <option value="PayPay" ${t.pay==="PayPay"?"selected":""}>PayPay</option>
  <option value="微信" ${t.pay==="微信"?"selected":""}>微信</option>
  <option value="支付宝" ${t.pay==="支付宝"?"selected":""}>支付宝</option>
</select>

<div class="pay-tip">
  仅记录本次新增收款，不会修改之前已收款项。
</div>

    <select id="checkoutCurrency" style="margin-top:8px;">
      <option value="日元" ${t.currency==="日元"?"selected":""}>日元</option>
      <option value="人民币" ${t.currency==="人民币"?"selected":""}>人民币</option>
    </select>
  `;

document.getElementById("checkoutAmount").innerHTML = `
    原价日元：¥${originalJPY.toLocaleString()}<br>
    已收金额：¥${Number(t.paidJPY || 0).toLocaleString()}<br><br>

    <label>实际应收金额</label>
    <input id="checkoutFinalCharge" type="number" value="${originalJPY}" oninput="refreshCheckoutDiff()">
    <label>备注</label>
    <input id="checkoutNote" placeholder="例：不限时改3小时，现金退款差价">

    <br>
    当前需收/需退：<span id="checkoutDiffText">¥${finalJPY.toLocaleString()}</span><br>
    人民币参考：<span id="checkoutRmbText">¥${totalRMB.toLocaleString()}</span><br>    
    <small style="color:#8a8174;">
      如果要退款，把实际应收金额改小。系统会自动算成负数退款。
    </small>
  `;

}

async function confirmCheckout(){
  if(checkoutSubmitting) return;

  const confirmButton = document.querySelector(
    '#checkoutModalBg button.btn-success, #checkoutModalBg .btn-success'
  );

  const originalIndex = checkoutIndex;
  const t = state?.tables?.[originalIndex];
  if(!t){
    alert("找不到这张桌位，请关闭窗口后重试");
    return;
  }

  const pay = document.getElementById("checkoutPay")?.value || "";
  const currency = document.getElementById("checkoutCurrency")?.value || "日元";
  if(!pay){
    alert("请选择付款方式");
    return;
  }

  checkoutSubmitting = true;
  if(confirmButton){
    confirmButton.disabled = true;
    confirmButton.textContent = "正在保存账单…";
  }

  try{
    stopAlertLoop(originalIndex);
    t.pay = pay;
    t.currency = currency;

    const defaultOriginalJPY = getOriginalJPY(t);
    const finalChargeJPY = Number(
      document.getElementById("checkoutFinalCharge")?.value || defaultOriginalJPY
    );
    const note = document.getElementById("checkoutNote")?.value || "";
    const rawDiffJPY = finalChargeJPY - Number(t.paidJPY || 0);
    const finalJPY = useRound ? roundJPY(rawDiffJPY) : rawDiffJPY;

    t.paidJPY = Number(t.paidJPY || 0) + finalJPY;
    t.paidRMB = getRMB(t.paidJPY);
    t.paidAt = Date.now();

    // 先尝试读取/构建完整账单，但最多等待2秒。
    // iPad Safari 的 IndexedDB 偶尔会挂起，不能因此阻塞结账。
    let record = null;
    try{
      record = await Promise.race([
        createOrUpdateRecord(t),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error("本地账单读取超时")),2000))
      ]);
    }catch(err){
      console.warn("结账时完整账单读取超时，改用紧急本地账单",err);
      record = getLocalRecordSync(t.recordId) || {
        id: t.recordId || ("rec_" + Date.now() + "_" + Math.random().toString(36).slice(2,8)),
        timestamp: Date.now(),
        businessDate: getDateText(Date.now()),
        time: new Date().toLocaleString(),
        tableName: t.name,
        receiptImage:"",
        receiptFileName:"",
        payments:[]
      };
      t.recordId = record.id;
    }

    record.payments = normalizePayments(record);
    if(finalJPY !== 0){
      record.payments.push(makePaymentLine({
        type: finalJPY < 0 ? "退款" : "收入",
        reason: finalJPY < 0 ? "退款/改套餐" : "结账补收",
        pay,
        amountJPY: finalJPY,
        note
      }));
    }

    const paymentTotalJPY = sumPaymentsJPY(record.payments);
    const p = getPackage(t);
    record.tableName = t.name;
    record.customerName = t.customer?.name || "";
    record.phoneLast4 = t.customer?.phoneLast4 || "";
    record.customerType = t.type || "walkin";
    record.packageName = p.name;
    record.packageMinutes = p.unlimited ? "不限时" : p.minutes;
    record.packagePrice = p.price;
    record.extraMinutes = Math.floor(Number(t.extra || 0) / 60000);
    record.extensionAmount = Math.max(0, finalChargeJPY - Number(p.price || 0));
    record.originalJPY = finalChargeJPY;
    record.totalJPY = paymentTotalJPY;
    record.totalRMB = getRMB(paymentTotalJPY);
    record.paidJPY = paymentTotalJPY;
    record.dueJPY = Math.max(0, finalChargeJPY - paymentTotalJPY);
    record.pay = getPaymentSummary(record.payments);
    record.currency = t.currency || "日元";
    record.roundRule = useRound ? "500抹零" : "不抹零";
    record.paidStatus = record.dueJPY > 0 ? "未结清" : "已结清";
    record.checkoutMethod = t.payTiming === "postpaid" ? "后付款一次性结账" : "结账确认";
    record.recordType = t.payTiming === "postpaid" ? "postpaid" : "prepaid";
    record.closedAt = Date.now();
    record.closedTime = new Date(record.closedAt).toLocaleString();
    record.businessDate = record.businessDate || getDateText(record.timestamp || record.closedAt);

    const visit = createOrUpdateCustomerVisit(t);
    if(visit){
      visit.endAt = Date.now();
      visit.range = getVisitRangeText(t);
      visit.closed = true;
      visit.finalJPY = t.paidJPY;
      visit.closedTime = new Date().toLocaleString();
    }

    if(t.bookingId){
      const b = state.bookings?.find(x=>Number(x.id) === Number(t.bookingId));
      if(b){
        if(!Array.isArray(b.finishedTableIndexes)) b.finishedTableIndexes = [];
        b.finishedTableIndexes = Array.from(new Set([
          ...b.finishedTableIndexes.map(Number), originalIndex
        ]));
        if(Array.isArray(b.checkedInTableIndexes)){
          b.checkedInTableIndexes = b.checkedInTableIndexes
            .map(Number)
            .filter(i=>i !== originalIndex);
        }
      }
    }

    // 核心：先同步写入 localStorage 紧急备份，再立即清空桌位并关闭窗口。
    // IndexedDB 和 Firestore 都放到后台，不再让用户卡在“正在结账”。
    emergencySaveRecord({db,ref,record});
    state.tables[originalIndex] = resetTable(t.name);
    emergencySaveState({db,ref,state,action:"checkout_complete"});

    closeCheckout();
    render();
    setSyncStatus(navigator.onLine ? "pending" : "offline",
      navigator.onLine ? "● 结账已保存本机 · 正在后台同步" : "● 结账已保存本机 · 当前离线");

    // 后台补写完整IndexedDB账单；失败不会影响已经完成的结账。
    Promise.resolve().then(()=>saveRecordSafely({db,ref,record})).catch(err=>{
      console.warn("结账账单后台保存失败，已保留紧急备份",err);
    });
  }catch(e){
    console.error(e);
    alert("结账错误：\n" + (e?.message || e));
  }finally{
    checkoutSubmitting = false;
    if(confirmButton){
      confirmButton.disabled = false;
      confirmButton.textContent = "确认结账";
    }
  }
}



function openForceEnd(i){
  const t = state?.tables?.[i];
  if(!t?.start){
    alert("这张桌位当前没有开始计时");
    return;
  }

  forceEndIndex = i;
  forceEndSubmitting = false;

  const p = getPackage(t);
  const originalJPY = getOriginalJPY(t);
  const paidJPY = Number(t.paidJPY || 0);
  const dueJPY = Math.max(0, originalJPY - paidJPY);

  const info = document.getElementById("forceEndInfo");
  if(info){
    info.innerHTML = `
      <div style="font-weight:900;font-size:20px;margin-bottom:10px;">${t.name}｜${p.name}</div>
      <div>当前应收：¥${originalJPY.toLocaleString()}</div>
      <div>已收金额：¥${paidJPY.toLocaleString()}</div>
      <div>尚未收款：¥${dueJPY.toLocaleString()}</div>
      <div style="margin-top:14px;padding:12px;border-radius:12px;background:#fff2f2;color:#9b1c1c;font-weight:800;line-height:1.6;">
        强制结束会先把账单保存到本机，再清空该桌位。<br>
        不会新增收款；如有未收金额，账单会保留为“未结清”。
      </div>
    `;
  }

  const button = document.getElementById("forceEndConfirmButton");
  if(button){
    button.disabled = false;
    button.textContent = "确认强制结束";
  }

  document.getElementById("forceEndModalBg").style.display = "block";
}

function closeForceEnd(){
  if(forceEndSubmitting) return;
  const modal = document.getElementById("forceEndModalBg");
  if(modal) modal.style.display = "none";
  forceEndIndex = null;
}

async function confirmForceEnd(){
  if(forceEndSubmitting) return;

  const i = Number(forceEndIndex);
  const t = state?.tables?.[i];
  if(!Number.isInteger(i) || !t?.start){
    alert("找不到需要结束的桌位，页面将重新显示当前状态");
    closeForceEnd();
    render();
    return;
  }

  const button = document.getElementById("forceEndConfirmButton");
  forceEndSubmitting = true;
  if(button){
    button.disabled = true;
    button.textContent = "正在紧急保存…";
  }

  try{
    stopAlertLoop(i);

    const p = getPackage(t);
    const originalJPY = getOriginalJPY(t);
    const now = Date.now();

    // Emergency mode deliberately avoids awaiting IndexedDB or Firestore.
    // Read the synchronous local shadow when available, otherwise create a record now.
    let record = getLocalRecordSync(t.recordId);
    if(!record){
      const id = t.recordId || ("rec_" + now + "_" + Math.random().toString(36).slice(2,8));
      t.recordId = id;
      record = {
        id,
        timestamp: now,
        businessDate: getDateText(now),
        time: new Date(now).toLocaleString(),
        tableName: t.name,
        receiptImage:"",
        receiptFileName:""
      };
    }

    record.tableName = t.name;
    record.customerName = t.customer?.name || "";
    record.phoneLast4 = t.customer?.phoneLast4 || "";
    record.customerType = t.type || "walkin";
    record.packageName = p.name;
    record.packageMinutes = p.unlimited ? "不限时" : p.minutes;
    record.packagePrice = Number(p.price || 0);
    record.extraMinutes = Math.floor(Number(t.extra || 0) / 60000);
    record.extensionAmount = Math.max(0, originalJPY - Number(p.price || 0));
    record.payments = normalizePayments(record);

    // Preserve prepaid amount even when the previous async bill creation never finished.
    if(record.payments.length === 0 && Number(t.paidJPY || 0) > 0){
      record.payments.push(makePaymentLine({
        type:"收入",
        reason:"套餐费",
        pay:t.pay || "未记录",
        amountJPY:Number(t.paidJPY || 0),
        note:"强制结束时从桌位恢复"
      }));
    }

    const paymentTotalJPY = sumPaymentsJPY(record.payments);
    record.originalJPY = originalJPY;
    record.totalJPY = paymentTotalJPY;
    record.totalRMB = getRMB(paymentTotalJPY);
    record.paidJPY = paymentTotalJPY;
    record.dueJPY = Math.max(0, originalJPY - paymentTotalJPY);
    record.pay = getPaymentSummary(record.payments);
    record.currency = t.currency || "日元";
    record.payTiming = t.payTiming || "prepaid";
    record.paidStatus = record.dueJPY > 0 ? "未结清" : "已结清";
    record.recordType = t.payTiming === "postpaid" ? "postpaid" : "prepaid";
    record.checkoutMethod = "本机紧急强制结束";
    record.roundRule = record.roundRule || "不抹零";
    record.closed = true;
    record.closedAt = now;
    record.closedTime = new Date(now).toLocaleString();
    record.businessDate = record.businessDate || getDateText(record.timestamp || now);
    record.forceClosed = true;
    record.forceClosedAt = now;

    emergencySaveRecord({db,ref,record});

    const visit = createOrUpdateCustomerVisit(t);
    if(visit){
      visit.endAt = now;
      visit.range = getVisitRangeText(t);
      visit.closed = true;
      visit.finalJPY = paymentTotalJPY;
      visit.closedTime = new Date(now).toLocaleString();
      visit.forceClosed = true;
    }

    if(t.bookingId){
      const b = state.bookings?.find(x=>Number(x.id) === Number(t.bookingId));
      if(b){
        if(!Array.isArray(b.finishedTableIndexes)) b.finishedTableIndexes = [];
        b.finishedTableIndexes = Array.from(new Set([...b.finishedTableIndexes.map(Number),i]));
        if(Array.isArray(b.checkedInTableIndexes)){
          b.checkedInTableIndexes = b.checkedInTableIndexes.map(Number).filter(x=>x !== i);
        }
      }
    }

    const tableName = t.name;
    state.tables[i] = resetTable(tableName);
    emergencySaveState({db,ref,state,action:"emergency_force_end_table"});

    const modal = document.getElementById("forceEndModalBg");
    if(modal) modal.style.display = "none";
    forceEndIndex = null;
    forceEndSubmitting = false;
    render();

    // Non-blocking visual notice; avoid alert/confirm in iPad standalone mode.
    setSyncStatus(navigator.onLine ? "pending" : "offline", navigator.onLine ? "● 桌位已结束 · 本机已保存 · 等待上传" : "● 桌位已结束 · 已保存本机 · 当前离线");
  }catch(err){
    console.error("紧急强制结束失败",err);
    forceEndSubmitting = false;
    if(button){
      button.disabled = false;
      button.textContent = "确认强制结束";
    }
    alert("强制结束失败：\n" + (err?.message || err));
  }
}

async function autoCloseOldTables(){
  if(!state || autoClosingOldTables) return;

  const today = getDateText(Date.now());

  const targets = state.tables
    .map((t,i)=>({t,i}))
    .filter(({t})=>{
      if(!t.start) return false;
      return getDateText(t.start) < today;
    });

  if(!targets.length) return;

  autoClosingOldTables = true;

  try{
    for(const {t,i} of targets){
      stopAlertLoop(i);

      const now = Date.now();

      const record = await createOrUpdateRecord(t);

      record.businessDate =
        record.businessDate ||
        getDateText(t.start || record.timestamp || now);

      record.closedAt = now;
      record.closedTime = new Date(now).toLocaleString();

      record.checkoutMethod = "系统自动跨天结账";
      record.roundRule = "自动结账";

      record.payments = normalizePayments(record);

      const paymentTotalJPY = sumPaymentsJPY(record.payments);

      record.originalJPY = getOriginalJPY(t);
      record.totalJPY = paymentTotalJPY;
      record.totalRMB = getRMB(paymentTotalJPY);
      record.paidJPY = paymentTotalJPY;
      record.dueJPY = Math.max(0, record.originalJPY - paymentTotalJPY);
      record.pay = getPaymentSummary(record.payments);
      record.currency = t.currency || "日元";
      record.paidStatus = record.dueJPY > 0 ? "未结清" : "已结清";

      await updateRecordOnly(record);

      const visit = createOrUpdateCustomerVisit(t);
      if(visit){
        visit.endAt = now;
        visit.range = getVisitRangeText(t);
        visit.closed = true;
        visit.finalJPY = paymentTotalJPY;
        visit.closedTime = new Date(now).toLocaleString();
      }

      if(t.bookingId){
        const b = state.bookings?.find(x=>Number(x.id) === Number(t.bookingId));

        if(b){
          if(!Array.isArray(b.finishedTableIndexes)){
            b.finishedTableIndexes = [];
          }

          b.finishedTableIndexes = Array.from(new Set([
            ...b.finishedTableIndexes.map(Number),
            i
          ]));

          if(Array.isArray(b.checkedInTableIndexes)){
            b.checkedInTableIndexes = b.checkedInTableIndexes
              .map(Number)
              .filter(idx=>idx !== i);
          }
        }
      }

      state.tables[i] = resetTable(t.name);
    }

    await save();
    render();

    console.log(`已自动结账 ${targets.length} 桌跨天未结账记录`);
  }catch(e){
    console.error(e);
    alert("自动跨天结账失败：" + e.message);
  }finally{
    autoClosingOldTables = false;
  }
}


function refreshCheckoutDiff(){
  const t = state.tables[checkoutIndex];
  if(!t) return;

  const defaultOriginalJPY = getOriginalJPY(t);
  const finalChargeJPY = Number(
    document.getElementById("checkoutFinalCharge")?.value || defaultOriginalJPY
  );

  const rawDiffJPY = finalChargeJPY - Number(t.paidJPY || 0);
  const finalJPY = useRound ? roundJPY(rawDiffJPY) : rawDiffJPY;

  const diffText = document.getElementById("checkoutDiffText");
  const rmbText = document.getElementById("checkoutRmbText");

  if(diffText){
    diffText.innerText = `¥${finalJPY.toLocaleString()}`;
  }

  if(rmbText){
    rmbText.innerText = `¥${getRMB(finalJPY).toLocaleString()}`;
  }
}

function closeCheckout(){
  document.getElementById("checkoutModalBg").style.display = "none";
}

async function moveRunningTable(fromIndex){
  const fromTable = state.tables[fromIndex];

  if(!fromTable || !fromTable.start){
    alert("这张桌没有正在计时，不能移动");
    return;
  }

  movingRunningFromIndex = fromIndex;
  movingRunningToIndex = null;
  draggingRunningFrom = null;

  document.getElementById("moveRunningInfo").innerHTML = `
    当前：${fromTable.name}<br>
    客人：${fromTable.customer?.name || "-"} ${fromTable.customer?.phoneLast4 || ""}
  `;

  document.getElementById("moveRunningFromBox").innerHTML = `
    <button
      class="move-table-btn"
      id="running-from-${fromIndex}"
      onpointerdown="startRunningMoveDrag(event,${fromIndex})"
    >
      ${fromTable.name}<br>
      <small>使用中</small>
    </button>
  `;

  document.getElementById("moveRunningToBox").innerHTML = state.tables.map((t,i)=>{
    const disabled = i === fromIndex || !!t.start;

    return `
      <button
        class="move-table-btn ${disabled ? "disabled" : ""}"
        id="running-to-${i}"
        data-index="${i}"
        ${disabled ? "disabled" : ""}
      >
        ${t.name}<br>
        <small>${disabled ? "不可移动" : "空闲"}</small>
      </button>
    `;
  }).join("");

  document.getElementById("moveRunningModalBg").style.display = "block";
}

function startRunningMoveDrag(e, fromIndex){
  e.preventDefault();

  draggingRunningFrom = fromIndex;

  const area = document.getElementById("moveRunningLineArea");
  const svg = document.getElementById("moveRunningSvg");
  const fromEl = document.getElementById("running-from-" + fromIndex);

  if(!area || !svg || !fromEl) return;

  runningMoveAreaRect = area.getBoundingClientRect();

  const r = fromEl.getBoundingClientRect();
  const x1 = r.left + r.width / 2 - runningMoveAreaRect.left;
  const y1 = r.top + r.height / 2 - runningMoveAreaRect.top;

  const ns = "http://www.w3.org/2000/svg";
  runningMoveTempLine = document.createElementNS(ns,"line");

  runningMoveTempLine.setAttribute("x1",x1);
  runningMoveTempLine.setAttribute("y1",y1);
  runningMoveTempLine.setAttribute("x2",x1);
  runningMoveTempLine.setAttribute("y2",y1);
  runningMoveTempLine.setAttribute("stroke","#d8a900");
  runningMoveTempLine.setAttribute("stroke-width","5");
  runningMoveTempLine.setAttribute("stroke-linecap","round");
  runningMoveTempLine.setAttribute("stroke-dasharray","8 6");

  svg.replaceChildren(runningMoveTempLine);

  window.addEventListener("pointermove", moveRunningDragLine, {passive:false});
  window.addEventListener("pointerup", endRunningMoveDrag);
}

function moveRunningDragLine(e){
  if(draggingRunningFrom === null || !runningMoveTempLine || !runningMoveAreaRect) return;

  e.preventDefault();

  const x = e.clientX - runningMoveAreaRect.left;
  const y = e.clientY - runningMoveAreaRect.top;

  runningMoveTempLine.setAttribute("x2",x);
  runningMoveTempLine.setAttribute("y2",y);
}

function endRunningMoveDrag(e){
  if(draggingRunningFrom === null) return;

  const target = document.elementFromPoint(e.clientX,e.clientY);
  const toBtn = target?.closest?.("[id^='running-to-']");

  if(toBtn && !toBtn.disabled){
    movingRunningToIndex = Number(toBtn.dataset.index);

    document.querySelectorAll("#moveRunningToBox .move-table-btn")
      .forEach(btn=>btn.classList.remove("selected"));

    toBtn.classList.add("selected");

    drawFinalRunningMoveLine();
  }else{
    if(runningMoveTempLine) runningMoveTempLine.remove();
  }

  draggingRunningFrom = null;
  runningMoveTempLine = null;
  runningMoveAreaRect = null;

  window.removeEventListener("pointermove", moveRunningDragLine);
  window.removeEventListener("pointerup", endRunningMoveDrag);
}

function drawFinalRunningMoveLine(){
  const svg = document.getElementById("moveRunningSvg");
  const area = document.getElementById("moveRunningLineArea");
  const fromEl = document.getElementById("running-from-" + movingRunningFromIndex);
  const toEl = document.getElementById("running-to-" + movingRunningToIndex);

  if(!svg || !area || !fromEl || !toEl) return;

  const rect = area.getBoundingClientRect();

  function center(el){
    const r = el.getBoundingClientRect();
    return {
      x:r.left + r.width / 2 - rect.left,
      y:r.top + r.height / 2 - rect.top
    };
  }

  const a = center(fromEl);
  const b = center(toEl);

  const ns = "http://www.w3.org/2000/svg";
  const line = document.createElementNS(ns,"line");

  line.setAttribute("x1",a.x);
  line.setAttribute("y1",a.y);
  line.setAttribute("x2",b.x);
  line.setAttribute("y2",b.y);
  line.setAttribute("stroke","#d8a900");
  line.setAttribute("stroke-width","5");
  line.setAttribute("stroke-linecap","round");

  svg.replaceChildren(line);
}

async function confirmMoveRunningLine(){
  if(movingRunningFromIndex === null || movingRunningToIndex === null){
    alert("请先拖线选择目标桌位");
    return;
  }

  const fromTable = state.tables[movingRunningFromIndex];
  const toTable = state.tables[movingRunningToIndex];

  if(!fromTable || !fromTable.start){
    alert("原桌位不是使用中");
    return;
  }

  if(!toTable || toTable.start){
    alert("目标桌位不是空闲");
    return;
  }

  if(!confirm(`确认把 ${fromTable.name} 移动到 ${toTable.name} 吗？`)){
    return;
  }

  stopAlertLoop(movingRunningFromIndex);
  stopAlertLoop(movingRunningToIndex);

  delete remindLocks[movingRunningFromIndex];
  delete remindLocks[movingRunningToIndex];

  const oldFromName = fromTable.name;
  const oldToName = toTable.name;

  state.tables[movingRunningToIndex] = {
    ...fromTable,
    name:oldToName
  };

  state.tables[movingRunningFromIndex] = resetTable(oldFromName);

  await createOrUpdateRecord(state.tables[movingRunningToIndex]);

  await save();

  closeMoveRunningLineModal();
  render();

  alert(`已移动到 ${oldToName}`);
}

function closeMoveRunningLineModal(){
  document.getElementById("moveRunningModalBg").style.display = "none";

  movingRunningFromIndex = null;
  movingRunningToIndex = null;
  draggingRunningFrom = null;
  runningMoveTempLine = null;
  runningMoveAreaRect = null;

  const svg = document.getElementById("moveRunningSvg");
  if(svg) svg.replaceChildren();
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
  // 提示音永久关闭；系统通知使用 silent:true，不播放声音。
}

function startAlertLoop(){
  // 超时仅保留页面上的文字/颜色提示，不播放声音、不发通知、不震动。
}

function stopAlertLoop(){
  // 无需停止声音循环。
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

async function confirmBatchStart(){
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

for(const i of indexes){
  const t = state.tables[i];
  if(!t || t.start) continue;

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

  await createOrUpdateRecord(t);
}
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
      const dueJPY = getDueJPY(t);

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
            <option value="现金" ${t.pay==="现金"?"selected":""}>现金</option>
            <option value="PayPay" ${t.pay==="PayPay"?"selected":""}>PayPay</option>
            <option value="微信" ${t.pay==="微信"?"selected":""}>微信</option>
            <option value="支付宝" ${t.pay==="支付宝"?"selected":""}>支付宝</option>            
          </select>

          <select id="batch-currency-${i}">
            <option value="日元" ${t.currency==="日元"?"selected":""}>日元</option>
            <option value="人民币" ${t.currency==="人民币"?"selected":""}>人民币</option>
          </select>

          <input
            id="batch-amount-${i}"
            type="number"
            value="${dueJPY}"
            placeholder="本次补收金额"
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

function toggleGroupPayMode(){
  const checked = document.getElementById("groupPayMode")?.checked;
  const box = document.getElementById("groupPayBox");

  if(box){
    box.style.display = checked ? "block" : "none";
  }
}


function closeBatchCheckout(){
  document.getElementById("batchCheckoutModalBg").style.display = "none";
}


async function confirmBatchCheckout(){
  const indexes = [...document.querySelectorAll(".batch-checkout-table:checked")]
    .map(el=>Number(el.value));

  if(indexes.length === 0){
    alert("请选择至少一张桌");
    return;
  }

  const isGroupPay = document.getElementById("groupPayMode")?.checked;

  if(isGroupPay){
    const groupPayMethod = document.getElementById("groupPayMethod")?.value || "";
    const groupPayerName = document.getElementById("groupPayerName")?.value.trim() || "";
    const groupPayNote = document.getElementById("groupPayNote")?.value.trim() || "";
    const manualTotal = Number(document.getElementById("groupPayTotal")?.value || 0);

    if(!groupPayMethod){
      alert("请选择整组付款方式");
      return;
    }

    const items = indexes.map(i=>{
      const t = state.tables[i];
      return {
        i,
        t,
        dueJPY:getDueJPY(t)
      };
    });

    const defaultTotal = items.reduce((sum,item)=>sum + Number(item.dueJPY || 0),0);
    const groupTotalJPY = manualTotal > 0 ? manualTotal : defaultTotal;

    if(groupTotalJPY <= 0){
      alert("整组没有需要补收的金额");
      return;
    }

    if(!confirm(`确认整组代付结账？\n\n合计：¥${groupTotalJPY.toLocaleString()}`)){
      return;
    }

    const groupPaymentId =
      "group_" + Date.now() + "_" + Math.random().toString(36).slice(2,8);

    const tableNames = indexes
      .map(i=>state.tables[i]?.name)
      .filter(Boolean)
      .join("、");

    let remaining = groupTotalJPY;

    for(let idx=0; idx<items.length; idx++){
      const {i,t,dueJPY} = items[idx];

      stopAlertLoop(i);

      let paidThisTime;

      if(manualTotal > 0 && defaultTotal > 0){
        if(idx === items.length - 1){
          paidThisTime = remaining;
        }else{
          paidThisTime = Math.round(groupTotalJPY * dueJPY / defaultTotal);
          remaining -= paidThisTime;
        }
      }else{
        paidThisTime = dueJPY;
      }

      t.pay = groupPayMethod;
      t.currency = "日元";

      const record = await createOrUpdateRecord(t);
      record.payments = normalizePayments(record);

      if(paidThisTime !== 0){
        record.payments.push(
          makePaymentLine({
            type:paidThisTime < 0 ? "退款" : "收入",
            reason:"整组代付",
            pay:groupPayMethod,
            amountJPY:paidThisTime,
            note:groupPayNote || `${groupPayerName || "未填写付款人"} 代付：${tableNames}`
          })
        );
      }

      const paymentTotalJPY = sumPaymentsJPY(record.payments);

      t.paidJPY = paymentTotalJPY;
      t.paidRMB = getRMB(paymentTotalJPY);
      t.paidAt = Date.now();

      record.originalJPY = getOriginalJPY(t);
      record.totalJPY = paymentTotalJPY;
      record.totalRMB = getRMB(paymentTotalJPY);
      record.paidJPY = paymentTotalJPY;
      record.dueJPY = Math.max(0, record.originalJPY - paymentTotalJPY);
      record.pay = getPaymentSummary(record.payments);
      record.currency = "日元";
      record.roundRule = "不抹零";
      record.paidStatus = Number(record.dueJPY || 0) > 0 ? "未结清" : "已结清";
      record.checkoutMethod = "整组代付";
      record.groupPaymentId = groupPaymentId;
      record.groupPayerName = groupPayerName;
      record.groupPaymentMethod = groupPayMethod;
      record.groupPaymentTotalJPY = groupTotalJPY;
      record.groupPaymentTableNames = tableNames;
      record.groupPaymentNote = groupPayNote;
      const now = Date.now();

record.closedAt = now;
record.closedTime = new Date(now).toLocaleString();

record.businessDate =
    record.businessDate ||
    getDateText(record.timestamp || now);
      record.closedTime = new Date().toLocaleString();

      await updateRecordOnly(record);

      state.tables[i] = resetTable(t.name);
    }

    await save();
    closeBatchCheckout();
    render();

    alert("整组代付结账完成");
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

  for(const i of indexes){
    const t = state.tables[i];

    const pay = document.getElementById(`batch-pay-${i}`).value;
    const currency = document.getElementById(`batch-currency-${i}`).value;
    const manualAmount = Number(document.getElementById(`batch-amount-${i}`).value || 0);

    stopAlertLoop(i);

    t.pay = pay;
    t.currency = currency;

    const finalPaidJPY = manualAmount;

    const record = await createOrUpdateRecord(t);

    record.payments = normalizePayments(record);

    if(finalPaidJPY !== 0){
      record.payments.push(
        makePaymentLine({
          type: finalPaidJPY < 0 ? "退款" : "收入",
          reason: finalPaidJPY < 0 ? "批量退款" : "批量结账",
          pay,
          amountJPY: finalPaidJPY,
          note: "批量结账记录"
        })
      );
    }

    const paymentTotalJPY = sumPaymentsJPY(record.payments);

    t.paidJPY = paymentTotalJPY;
    t.paidRMB = getRMB(paymentTotalJPY);
    t.paidAt = Date.now();

    record.originalJPY = getOriginalJPY(t);
    record.totalJPY = paymentTotalJPY;
    record.totalRMB = getRMB(paymentTotalJPY);
    record.paidJPY = paymentTotalJPY;
    record.dueJPY = Math.max(0, record.originalJPY - paymentTotalJPY);
    record.pay = getPaymentSummary(record.payments);
    record.currency = currency;
    record.roundRule = "不抹零";
    record.paidStatus = Number(record.dueJPY || 0) > 0 ? "未结清" : "已结清";
    record.checkoutMethod = "批量结账";

    const now = Date.now();

record.closedAt = now;
record.closedTime = new Date(now).toLocaleString();

record.businessDate =
    record.businessDate ||
    getDateText(record.timestamp || now);


    await updateRecordOnly(record);

    state.tables[i] = resetTable(t.name);
  }

  await save();
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
window.undoHour = undoHour;
window.setPay = setPay;
window.setCurrency = setCurrency;
window.openCheckout = openCheckout;
window.toggleRound = toggleRound;
window.confirmCheckout = confirmCheckout;
window.openForceEnd = openForceEnd;
window.closeForceEnd = closeForceEnd;
window.confirmForceEnd = confirmForceEnd;
window.closeCheckout = closeCheckout;
window.initPush = initPush;
window.updateCustomer = updateCustomer;
window.toggleType = toggleType;
window.roundBatchAmount = roundBatchAmount;
window.render = render;
window.setPayTiming = setPayTiming;
window.moveRunningTable = moveRunningTable;
window.refreshCheckoutDiff = refreshCheckoutDiff;
window.toggleGroupPayMode = toggleGroupPayMode;
window.startRunningMoveDrag = startRunningMoveDrag;
window.confirmMoveRunningLine = confirmMoveRunningLine;
window.closeMoveRunningLineModal = closeMoveRunningLineModal;
window.addEventListener("DOMContentLoaded", updateNotifyButton);
