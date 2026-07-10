import {
  runTransaction,
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const DB_NAME = "chiptune_local_first_v1";
const DB_VERSION = 1;
const STATE_KEY = "shop_main";
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

let baseline = null;
let saveQueue = Promise.resolve();
let badge = null;
let flushTimer = null;

function role(){
  const p = location.pathname.toLowerCase();
  if(p.includes("booking")) return "booking";
  if(p.includes("owner")) return "owner";
  if(p.includes("today-bill") || p.includes("cashier")) return "report";
  return "timer";
}

function openLocalDb(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if(!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", {keyPath:"id"});
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

async function idbGet(store,key){
  const db = await openLocalDb();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = ()=>resolve(req.result ?? null);
    req.onerror = ()=>reject(req.error);
  });
}

async function idbPut(store,value,key){
  const db = await openLocalDb();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readwrite");
    const req = key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value,key);
    req.onsuccess = ()=>resolve(value);
    req.onerror = ()=>reject(req.error);
  });
}

async function idbDelete(store,key){
  const db = await openLocalDb();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}

async function idbAll(store){
  const db = await openLocalDb();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = ()=>resolve(req.result || []);
    req.onerror = ()=>reject(req.error);
  });
}

function ensureBadge(){
  if(badge) return badge;
  badge = document.createElement("div");
  badge.id = "syncStatusBadge";
  badge.style.cssText = [
    "position:fixed","right:12px","bottom:12px","z-index:99999",
    "padding:8px 12px","border-radius:999px","font-size:13px","font-weight:800",
    "box-shadow:0 2px 10px rgba(0,0,0,.18)"
  ].join(";");
  badge.textContent = "● 正在读取本机数据";
  document.body.appendChild(badge);
  return badge;
}

export function setSyncStatus(type, text){
  const el = ensureBadge();
  const map = {
    synced:["#eef7ee","#246b35","● 已保存本机 · 云端已同步"],
    saving:["#fff6df","#8a5b00","● 正在保存到本机"],
    pending:["#fff6df","#8a5b00","● 已保存本机 · 等待上传"],
    offline:["#eef1ff","#3347a8","● 已保存本机 · 当前离线"],
    error:["#ffe8e8","#9b1c1c","● 本机保存失败"],
    cache:["#eef1ff","#3347a8","● 已读取本机数据"],
    syncing:["#fff6df","#8a5b00","● 本机已保存 · 正在同步云端"]
  };
  const [bg,color,label] = map[type] || map.synced;
  el.style.background = bg;
  el.style.color = color;
  el.textContent = text || label;
}

export function getDeviceId(){
  let id = localStorage.getItem("chiptuneDeviceId");
  if(!id){
    id = `device_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
    localStorage.setItem("chiptuneDeviceId", id);
  }
  return id;
}

export async function loadLocalState(){
  try{
    const value = await idbGet("kv",STATE_KEY);
    if(value?.state){
      baseline = clone(value.cloudBaseline || value.state);
      setSyncStatus(navigator.onLine ? "cache" : "offline");
      return clone(value.state);
    }
  }catch(err){ console.warn("读取本机数据失败",err); }
  return null;
}

async function writeLocalState(state, cloudBaseline=baseline){
  await idbPut("kv",{
    state:clone(state),
    cloudBaseline:clone(cloudBaseline),
    savedAt:Date.now(),
    deviceId:getDeviceId()
  },STATE_KEY);
}

function changedKeys(local, base){
  const keys = new Set([...Object.keys(local||{}),...Object.keys(base||{})]);
  return [...keys].filter(k=>k !== "_sync" && !same(local?.[k],base?.[k]));
}

async function pendingKeys(){
  const items = await idbAll("queue");
  return new Set(items.flatMap(x=>x.changed || []));
}

export async function reconcileCloudState(cloud){
  const localBox = await idbGet("kv",STATE_KEY).catch(()=>null);
  const local = localBox?.state;
  if(!local){
    baseline = clone(cloud);
    await writeLocalState(cloud,cloud);
    return clone(cloud);
  }

  const pending = await pendingKeys();
  const merged = clone(cloud || {});
  const currentRole = role();
  const alwaysLocal = currentRole === "timer" ? new Set(["tables"]) : new Set();

  for(const key of Object.keys(local)){
    if(key === "_sync") continue;
    if(alwaysLocal.has(key) || pending.has(key)) merged[key] = clone(local[key]);
  }

  baseline = clone(cloud);
  await writeLocalState(merged,cloud);
  return merged;
}

export function setStateBaseline(nextState){
  baseline = clone(nextState);
  idbGet("kv",STATE_KEY).then(box=>{
    if(box?.state) return writeLocalState(box.state,nextState);
  }).catch(()=>{});
}

function mergeState(latest, local, base, keys){
  const merged = clone(latest || {});
  const changed = keys?.length ? keys : changedKeys(local,base);
  for(const key of changed){
    const localValue = local?.[key];
    const baseValue = base?.[key];
    if(key === "tables" && Array.isArray(localValue)){
      const latestTables = Array.isArray(merged.tables) ? clone(merged.tables) : [];
      const baseTables = Array.isArray(baseValue) ? baseValue : [];
      localValue.forEach((table,index)=>{
        if(!same(table,baseTables[index])) latestTables[index] = clone(table);
      });
      merged.tables = latestTables;
    }else{
      merged[key] = clone(localValue);
    }
  }
  merged._sync = {
    revision:Number(latest?._sync?.revision || 0)+1,
    updatedAt:Date.now(),
    deviceId:getDeviceId()
  };
  return {merged,changed};
}

async function enqueue(local,base,action){
  const changed = changedKeys(local,base);
  const item = {
    id:`${getDeviceId()}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    state:clone(local), base:clone(base), changed, action,
    createdAt:Date.now(), deviceId:getDeviceId()
  };
  await idbPut("queue",item);
  return item;
}

async function flushOne({db,ref}, item){
  let result;
  await runTransaction(db,async tx=>{
    const snap = await tx.get(ref);
    const latest = snap.exists() ? snap.data() : {};
    result = mergeState(latest,item.state,item.base,item.changed);
    tx.set(ref,result.merged);
  });
  await idbDelete("queue",item.id);
  baseline = clone(result.merged);
  const box = await idbGet("kv",STATE_KEY);
  if(box?.state) await writeLocalState(box.state,result.merged);
  try{
    await addDoc(collection(db,"operationLogs"),{
      action:item.action, changed:item.changed, deviceId:item.deviceId,
      createdAt:serverTimestamp(), clientTime:item.createdAt
    });
  }catch(err){ console.warn("操作日志写入失败",err); }
}

export async function flushPending({db,ref}){
  if(!navigator.onLine) return;
  const items = (await idbAll("queue")).sort((a,b)=>a.createdAt-b.createdAt);
  if(!items.length){ setSyncStatus("synced"); return; }
  setSyncStatus("syncing",`● 本机已保存 · 正在上传 ${items.length} 项`);
  for(const item of items){
    if(!navigator.onLine) break;
    await flushOne({db,ref},item);
  }
  const left = await idbAll("queue");
  setSyncStatus(left.length ? "pending" : "synced", left.length ? `● 已保存本机 · ${left.length} 项等待上传` : undefined);
}

export function installConnectionGuard(){
  const update = async ()=>{
    const count = (await idbAll("queue").catch(()=>[])).length;
    if(!navigator.onLine) setSyncStatus("offline",`● 已保存本机 · 离线 · ${count} 项待上传`);
    else setSyncStatus(count ? "pending" : "synced",count ? `● 已保存本机 · ${count} 项等待上传` : undefined);
    window.dispatchEvent(new CustomEvent("chiptune-online-change",{detail:{online:navigator.onLine}}));
  };
  window.addEventListener("online",update);
  window.addEventListener("offline",update);
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) update(); });
  update();
}

export function saveStateSafely({db,ref,getState,action="state_update"}){
  saveQueue = saveQueue.catch(()=>{}).then(async()=>{
    const local = clone(getState());
    const base = clone(baseline || local);
    setSyncStatus("saving");
    await writeLocalState(local,base);
    await enqueue(local,base,action);
    const count = (await idbAll("queue")).length;
    setSyncStatus(navigator.onLine ? "pending" : "offline", navigator.onLine ? `● 已保存本机 · ${count} 项等待上传` : `● 已保存本机 · 离线 · ${count} 项待上传`);
    if(navigator.onLine){
      clearTimeout(flushTimer);
      flushTimer = setTimeout(()=>flushPending({db,ref}).catch(err=>{
        console.warn("云端同步失败，将自动重试",err);
        setSyncStatus("pending","● 已保存本机 · 云端同步失败，将重试");
      }),150);
    }
    return local;
  }).catch(err=>{
    setSyncStatus("error","● 本机保存失败，请立即停止操作");
    console.error(err);
    throw err;
  });
  return saveQueue;
}

export async function atomicAdjustTableExtra({db,ref,tableIndex,deltaMs,action,getState}){
  const currentState = clone(getState ? getState() : (await loadLocalState()));
  if(!currentState?.tables?.[tableIndex]) throw new Error("找不到该桌位");
  const table = clone(currentState.tables[tableIndex]);
  const current = Number(table.extra || 0);
  if(deltaMs < 0 && current < Math.abs(deltaMs)) throw new Error("没有可以撤回的续时");
  table.extra = Math.max(0,current + Number(deltaMs || 0));
  table.alerted = false;
  table.alerting = false;
  table.lastAction = action || (deltaMs > 0 ? "extend" : "undo_extend");
  table.updatedAt = Date.now();
  currentState.tables[tableIndex] = table;
  await saveStateSafely({db,ref,getState:()=>currentState,action:action || "adjust_extra"});
  return table;
}
