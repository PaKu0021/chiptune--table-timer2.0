import {
  runTransaction,
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

let baseline = null;
let saveQueue = Promise.resolve();
let badge = null;

function ensureBadge(){
  if(badge) return badge;
  badge = document.createElement("div");
  badge.id = "syncStatusBadge";
  badge.style.cssText = [
    "position:fixed","right:12px","bottom:12px","z-index:99999",
    "padding:8px 12px","border-radius:999px","font-size:13px","font-weight:800",
    "box-shadow:0 2px 10px rgba(0,0,0,.18)","background:#eef7ee","color:#246b35"
  ].join(";");
  badge.textContent = "● 已同步";
  document.body.appendChild(badge);
  return badge;
}

export function setSyncStatus(type, text){
  const el = ensureBadge();
  const map = {
    synced:["#eef7ee","#246b35","● 已同步"],
    saving:["#fff6df","#8a5b00","● 正在保存"],
    offline:["#ffe8e8","#9b1c1c","● 当前离线，请勿操作"],
    error:["#ffe8e8","#9b1c1c","● 保存失败"],
    cache:["#eef1ff","#3347a8","● 正在同步服务器"]
  };
  const [bg,color,label] = map[type] || map.synced;
  el.style.background = bg;
  el.style.color = color;
  el.textContent = text || label;
}

export function installConnectionGuard(){
  const update = () => setSyncStatus(navigator.onLine ? "synced" : "offline");
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  document.addEventListener("visibilitychange", () => {
    if(!document.hidden && !navigator.onLine) setSyncStatus("offline");
  });
  update();
}

export function setStateBaseline(nextState){
  baseline = clone(nextState);
}

function mergeState(latest, local, base){
  const merged = clone(latest || {});
  const changed = [];
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(base || {})]);

  for(const key of keys){
    if(key === "_sync") continue;
    const localValue = local?.[key];
    const baseValue = base?.[key];
    if(same(localValue, baseValue)) continue;

    if(key === "tables" && Array.isArray(localValue)){
      const latestTables = Array.isArray(merged.tables) ? clone(merged.tables) : [];
      const baseTables = Array.isArray(baseValue) ? baseValue : [];
      localValue.forEach((table,index)=>{
        if(!same(table, baseTables[index])){
          latestTables[index] = clone(table);
          changed.push(`table:${index}`);
        }
      });
      merged.tables = latestTables;
    }else{
      merged[key] = clone(localValue);
      changed.push(key);
    }
  }

  merged._sync = {
    revision: Number(latest?._sync?.revision || 0) + 1,
    updatedAt: Date.now(),
    deviceId: getDeviceId()
  };
  return {merged, changed};
}

function getDeviceId(){
  let id = localStorage.getItem("chiptuneDeviceId");
  if(!id){
    id = `device_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
    localStorage.setItem("chiptuneDeviceId", id);
  }
  return id;
}

export function saveStateSafely({db, ref, getState, action="state_update"}){
  saveQueue = saveQueue.catch(()=>{}).then(async()=>{
    if(!navigator.onLine){
      setSyncStatus("offline");
      throw new Error("当前设备离线，操作没有保存。请恢复网络后重试。");
    }

    const local = clone(getState());
    const base = clone(baseline || local);
    setSyncStatus("saving");
    let result;

    await runTransaction(db, async tx=>{
      const snap = await tx.get(ref);
      const latest = snap.exists() ? snap.data() : {};
      result = mergeState(latest, local, base);
      tx.set(ref, result.merged);
    });

    baseline = clone(result.merged);
    setSyncStatus("synced");

    try{
      await addDoc(collection(db,"operationLogs"),{
        action,
        changed: result.changed,
        deviceId:getDeviceId(),
        createdAt:serverTimestamp(),
        clientTime:Date.now()
      });
    }catch(err){
      console.warn("操作日志写入失败",err);
    }

    return result.merged;
  }).catch(err=>{
    setSyncStatus(navigator.onLine ? "error" : "offline", navigator.onLine ? "● 保存失败，请重试" : undefined);
    console.error(err);
    throw err;
  });

  return saveQueue;
}

export async function atomicAdjustTableExtra({db, ref, tableIndex, deltaMs, action}){
  if(!navigator.onLine){
    setSyncStatus("offline");
    throw new Error("当前设备离线，不能续时或撤回。");
  }
  setSyncStatus("saving");
  let updatedTable = null;

  await runTransaction(db, async tx=>{
    const snap = await tx.get(ref);
    if(!snap.exists()) throw new Error("找不到店铺状态数据");
    const latest = snap.data();
    const tables = Array.isArray(latest.tables) ? clone(latest.tables) : [];
    const table = clone(tables[tableIndex]);
    if(!table) throw new Error("找不到该桌位");

    const current = Number(table.extra || 0);
    const next = Math.max(0,current + Number(deltaMs || 0));
    if(deltaMs < 0 && current < Math.abs(deltaMs)){
      throw new Error("没有可以撤回的续时");
    }

    table.extra = next;
    table.alerted = false;
    table.alerting = false;
    table.lastAction = action || (deltaMs > 0 ? "extend" : "undo_extend");
    table.updatedAt = Date.now();
    tables[tableIndex] = table;

    tx.set(ref,{
      ...latest,
      tables,
      _sync:{
        revision:Number(latest?._sync?.revision || 0)+1,
        updatedAt:Date.now(),
        deviceId:getDeviceId()
      }
    });
    updatedTable = table;
  });

  setSyncStatus("synced");
  try{
    await addDoc(collection(db,"operationLogs"),{
      action: action || (deltaMs > 0 ? "extend_one_hour" : "undo_one_hour"),
      tableIndex,
      deltaMs,
      newExtra:updatedTable?.extra || 0,
      deviceId:getDeviceId(),
      createdAt:serverTimestamp(),
      clientTime:Date.now()
    });
  }catch(err){ console.warn(err); }
  return updatedTable;
}
