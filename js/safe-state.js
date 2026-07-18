import {
  runTransaction,
  collection,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  documentId,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const DB_NAME = "chiptune_local_first_v1";
const DB_VERSION = 2;
const STATE_KEY = "shop_main";
const RECORDS_KEY = "records";
const STATE_SHADOW = "chiptune_state_shadow_v2";
const RECORDS_SHADOW = "chiptune_records_shadow_v2";
const DELETED_RECORDS_SHADOW = "chiptune_deleted_record_ids_v1";
const RECORD_MIGRATION_KEY = "records_migration_v3";
const RECORD_MIGRATION_SHADOW = "chiptune_records_migration_v3";
const RECORD_HISTORY_SYNC_META = "chiptune_records_history_sync_v2";
const RECORD_DELETES_COLLECTION = "recordDeletes";
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function withTimeout(promise, ms=8000, label="本地数据库操作"){
  return Promise.race([
    promise,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+"超时")),ms))
  ]);
}
function stripImagesDeep(value){
  if(Array.isArray(value)) return value.map(stripImagesDeep);
  if(value && typeof value === "object"){
    const out={};
    for(const [k,v] of Object.entries(value)){
      if(["receiptImage","imageBase64"].includes(k)) out[k]="";
      else out[k]=stripImagesDeep(v);
    }
    return out;
  }
  return value;
}

let baseline = null;
let saveQueue = Promise.resolve();
let badge = null;
let flushTimer = null;

const stateChannel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("chiptune-state-sync-v1")
    : null;

const recordChannel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("chiptune-record-sync-v1")
    : null;

function broadcastRecord(record, action = "record_update"){
  if(!record?.id) return;
  const detail = {record:clone(record),action,sentAt:Date.now(),deviceId:getDeviceId()};
  window.dispatchEvent(new CustomEvent("chiptune-record-broadcast",{detail}));
  try{ recordChannel?.postMessage(detail); }catch(error){ console.warn("跨页面账单广播失败",error); }
}

recordChannel?.addEventListener("message",event=>{
  if(!event.data?.record?.id) return;
  window.dispatchEvent(new CustomEvent("chiptune-record-broadcast",{detail:event.data}));
});

function broadcastState(state, action = "state_update"){
  const detail = {
    state:clone(state),
    action,
    sentAt:Date.now(),
    deviceId:getDeviceId()
  };

  /*
   * 同一个页面内的监听器。
   */
  window.dispatchEvent(
    new CustomEvent(
      "chiptune-state-broadcast",
      {detail}
    )
  );

  /*
   * 不同标签页、不同窗口、PWA 页面之间同步。
   */
  try{
    stateChannel?.postMessage(detail);
  }catch(error){
    console.warn("跨页面状态广播失败",error);
  }
}

stateChannel?.addEventListener(
  "message",
  event=>{
    if(!event.data?.state) return;

    window.dispatchEvent(
      new CustomEvent(
        "chiptune-state-broadcast",
        {
          detail:event.data
        }
      )
    );
  }
);




function role(){
  const p = location.pathname.toLowerCase();
  if(p.includes("booking")) return "booking";
  if(p.includes("owner")) return "owner";
  if(p.includes("today-bill") || p.includes("cashier")) return "report";
  if(p.endsWith("/") || p.includes("index.html")) return "home";
  return "timer";
}

function openLocalDb(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if(!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", {keyPath:"id"});
      if(!db.objectStoreNames.contains("recordQueue")) db.createObjectStore("recordQueue", {keyPath:"id"});
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

async function idbGet(store,key){
  const db = await openLocalDb();
  const task = new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = ()=>resolve(req.result ?? null);
    req.onerror = ()=>reject(req.error);
  });
  return withTimeout(task,8000,"读取本地数据");
}

async function idbPut(store,value,key){
  const db = await openLocalDb();
  const task = new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readwrite");
    const req = key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value,key);
    req.onsuccess = ()=>resolve(value);
    req.onerror = ()=>reject(req.error);
  });
  return withTimeout(task,8000,"写入本地数据");
}

async function idbDelete(store,key){
  const db = await openLocalDb();
  const task = new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
  return withTimeout(task,8000,"删除本地数据");
}

async function idbAll(store){
  const db = await openLocalDb();
  const task = new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = ()=>resolve(req.result || []);
    req.onerror = ()=>reject(req.error);
  });
  return withTimeout(task,8000,"读取本地列表");
}

async function idbClear(store){
  const db = await openLocalDb();
  const task = new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
    tx.onabort = ()=>reject(tx.error || new Error("本地队列清理失败"));
  });
  return withTimeout(task,8000,"清理本地队列");
}

function writeShadow(key,value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch(err){ console.warn("本地同步备份写入失败",err); }
}
function readShadow(key){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }catch{ return null; }
}

function getDeletedRecordIds(){
  const list = readShadow(DELETED_RECORDS_SHADOW);
  return new Set(Array.isArray(list) ? list.map(String) : []);
}

function saveDeletedRecordIds(set){
  writeShadow(DELETED_RECORDS_SHADOW, [...set]);
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
  const shadow = readShadow(STATE_SHADOW);
  if(shadow?.state){
    baseline = clone(shadow.cloudBaseline || shadow.state);
    setSyncStatus(navigator.onLine ? "cache" : "offline");
    return clone(shadow.state);
  }
  try{
    const value = await idbGet("kv",STATE_KEY);
    if(value?.state){
      baseline = clone(value.cloudBaseline || value.state);
      writeShadow(STATE_SHADOW,value);
      setSyncStatus(navigator.onLine ? "cache" : "offline");
      return clone(value.state);
    }
  }catch(err){ console.warn("读取本机数据失败",err); }
  return null;
}

async function writeLocalState(state, cloudBaseline=baseline){
  const box = {state:clone(state),cloudBaseline:clone(cloudBaseline),savedAt:Date.now(),deviceId:getDeviceId()};
  writeShadow(STATE_SHADOW,box);
  await idbPut("kv",box,STATE_KEY);
}

export async function loadLocalRecords(){
  const deleted = getDeletedRecordIds();
  try{
    const value = await idbGet("kv",RECORDS_KEY);
    if(Array.isArray(value)){
      return clone(value.filter(r=>!deleted.has(String(r.id))));
    }
  }catch(err){ console.warn("IndexedDB账单读取失败，尝试轻量备份",err); }

  const shadow = readShadow(RECORDS_SHADOW);
  if(Array.isArray(shadow)){
    return clone(shadow.filter(r=>!deleted.has(String(r.id))));
  }
  return [];
}

async function writeLocalRecords(records){
  const list = clone(records || []);
  // 完整账单（包括收款截图）只存 IndexedDB，避免 localStorage 容量不足。
  await idbPut("kv",list,RECORDS_KEY);
  // localStorage 只保留不含大图片的轻量应急副本。
  const light = list.map(stripImagesDeep);
  writeShadow(RECORDS_SHADOW,light);
}


export async function replaceLocalRecords(records){
  const merged = mergeRecordLists([], records || []);
  await writeLocalRecords(merged);
  return clone(merged);
}

export async function getLocalRecord(recordId){
  if(!recordId) return null;
  const list = await loadLocalRecords();
  return clone(list.find(r=>String(r.id)===String(recordId)) || null);
}

export function mergeRecordLists(cloudRecords=[], localRecords=[]){
  const deleted = getDeletedRecordIds();
  const map = new Map();
  for(const r of cloudRecords || []){
    if(!deleted.has(String(r.id))) map.set(String(r.id),clone(r));
  }
  for(const r of localRecords || []){
    const key = String(r.id);
    if(deleted.has(key)) continue;
    const cloud = map.get(key);
    if(!cloud || Number(r.localUpdatedAt || r.updatedAt || r.timestamp || 0) >= Number(cloud.localUpdatedAt || cloud.updatedAt || cloud.timestamp || 0)) map.set(key,clone(r));
  }
  return [...map.values()].filter(r=>r.id !== "init");
}


function migrationStatus(){
  const shadow = readShadow(RECORD_MIGRATION_SHADOW);
  return shadow && typeof shadow === "object" ? shadow : {};
}

function saveMigrationStatus(status){
  const next = {...status, updatedAt:Date.now()};
  writeShadow(RECORD_MIGRATION_SHADOW,next);
  idbPut("kv",next,RECORD_MIGRATION_KEY).catch(err=>console.warn("迁移状态写入失败",err));
  return next;
}

function looksLikeLegacyRecord(r){
  if(!r || typeof r !== "object" || Array.isArray(r)) return false;
  const hasTime = r.timestamp || r.closedAt || r.paidAt || r.startAt || r.time || r.date || r.businessDate;
  const hasMoney = r.totalJPY !== undefined || r.jpy !== undefined || r.originalJPY !== undefined || Array.isArray(r.payments);
  const hasBillInfo = r.tableName || r.packageName || r.pay || r.checkoutMethod || r.type;
  return Boolean(hasTime && (hasMoney || hasBillInfo));
}

function smallStableHash(value){
  const text = JSON.stringify(value || {});
  let hash = 2166136261;
  for(let i=0;i<text.length;i++){
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash,16777619);
  }
  return (hash >>> 0).toString(36);
}

function legacyRecordId(r,index=0){
  if(r.id) return String(r.id);
  const ts = Number(r.closedAt || r.paidAt || r.timestamp || r.startAt || 0);
  const table = String(r.tableName || r.table || r.tableIndex || "table").replace(/[^a-zA-Z0-9_-]/g,"");
  const amount = Number(r.totalJPY || r.jpy || r.originalJPY || 0);
  return `legacy_${ts || 0}_${table}_${amount}_${smallStableHash(r)}_${index}`;
}

function collectLegacyRecords(value,out,depth=0){
  if(depth > 5 || value == null) return;
  if(Array.isArray(value)){
    value.forEach((item,i)=>{
      if(looksLikeLegacyRecord(item)) out.push({...clone(item),id:legacyRecordId(item,i)});
      else collectLegacyRecords(item,out,depth+1);
    });
    return;
  }
  if(typeof value !== "object") return;
  if(Array.isArray(value.records)) collectLegacyRecords(value.records,out,depth+1);
  if(value.state && typeof value.state === "object") collectLegacyRecords(value.state,out,depth+1);
}


async function queueMigratedRecords(records){
  const db = await openLocalDb();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction("recordQueue","readwrite");
    const store = tx.objectStore("recordQueue");
    for(const r of records){
      store.put({id:`record_${r.id}`,record:clone(r),createdAt:Date.now()});
    }
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
    tx.onabort = ()=>reject(tx.error || new Error("迁移队列写入中止"));
  });
}

/**
 * 一次性账单迁移：
 * 1. 本机旧 state / localStorage 只扫描一次；
 * 2. 云端 records 与旧 shop/main.records 成功读取后只导入一次；
 * 3. 迁移结果统一写入新版本机 records，之后所有页面直接读取它。
 */
export async function migrateLegacyRecordsOnce({db,ref,onProgress}={}){
  const report = msg=>{ try{ onProgress?.(msg); }catch{} };
  let status = migrationStatus();
  const current = await loadLocalRecords().catch(()=>[]);
  let merged = current;
  const recovered = [];
  const notes = [];

  if(!status.localDone){
    report("正在迁移本机旧账单…");
    try{
      const localState = await loadLocalState();
      if(Array.isArray(localState?.records)) collectLegacyRecords(localState.records,recovered);
    }catch(err){ notes.push(`旧本机状态读取失败：${err?.message || err}`); }

    try{
      for(let i=0;i<localStorage.length;i++){
        const key = localStorage.key(i);
        if(!key || key === RECORD_MIGRATION_SHADOW || key === DELETED_RECORDS_SHADOW) continue;
        const raw = localStorage.getItem(key);
        if(!raw || raw.length < 10) continue;
        try{ collectLegacyRecords(JSON.parse(raw),recovered); }catch{}
      }
    }catch(err){ notes.push(`本机备份扫描失败：${err?.message || err}`); }

    merged = mergeRecordLists(merged,recovered);
    await writeLocalRecords(merged);
    status = saveMigrationStatus({...status,localDone:true,localRecovered:recovered.length});
    notes.push(`本机旧数据：发现 ${recovered.length} 条`);
  }

  if(!status.cloudDone && db && ref && navigator.onLine){
    report("正在导入旧云端账单…");
    const cloudFound = [];
    let recordsCollectionSucceeded = false;
    try{
      const snap = await withTimeout(getDocs(collection(db,"records")),12000,"云端 records 读取");
      cloudFound.push(...snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.id!=="init"));
      notes.push(`云端 records：${snap.size} 条`);
      recordsCollectionSucceeded = true;
    }catch(err){ notes.push(`云端 records 暂未完成：${err?.message || err}`); }

    let legacyMainSucceeded = false;
    try{
      const snap = await withTimeout(getDoc(ref),12000,"旧 shop/main 读取");
      if(snap.exists() && Array.isArray(snap.data()?.records)){
        collectLegacyRecords(snap.data().records,cloudFound);
        notes.push(`旧 shop/main.records：${snap.data().records.length} 条`);
      }
      legacyMainSucceeded = true;
    }catch(err){ notes.push(`旧 shop/main.records 暂未完成：${err?.message || err}`); }

    // 两个旧云端来源都完成读取后，才永久标记云端迁移完成，避免弱网时漏账。
    if(recordsCollectionSucceeded && legacyMainSucceeded){
      const beforeIds = new Set(merged.map(r=>String(r.id)));
      merged = mergeRecordLists(merged,cloudFound);
      await writeLocalRecords(merged);
      const newlyAdded = merged.filter(r=>!beforeIds.has(String(r.id)));
      if(newlyAdded.length) await queueMigratedRecords(newlyAdded).catch(err=>notes.push(`云端备份排队失败：${err?.message || err}`));
      status = saveMigrationStatus({...status,cloudDone:true,cloudRecovered:cloudFound.length,completedAt:Date.now()});
    }
  }

  const done = Boolean(status.localDone && status.cloudDone);
  report(done ? "历史账单升级完成" : (navigator.onLine ? "本机迁移完成，云端稍后重试" : "本机迁移完成，联网后自动补全云端旧账单"));
  return {records:clone(merged),done,status,notes};
}

export function resetRecordMigration(){
  try{ localStorage.removeItem(RECORD_MIGRATION_SHADOW); }catch{}
  return idbDelete("kv",RECORD_MIGRATION_KEY).catch(()=>{});
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
  const localBox =
    readShadow(STATE_SHADOW) ||
    await idbGet("kv",STATE_KEY).catch(()=>null);

  const local = localBox?.state;

  /*
   * 本机没有状态时，直接使用云端。
   */
  if(!local){
    baseline = clone(cloud);
    await writeLocalState(cloud,cloud);
    return clone(cloud);
  }

  const queueItems = (
    await idbAll("queue").catch(()=>[])
  ).sort((a,b)=>
    Number(a.createdAt || 0) -
    Number(b.createdAt || 0)
  );

  /*
   * 只处理最后一个待上传状态。
   * enqueue() 已经保证队列通常只有一个最新状态。
   */
  const pendingItem =
    queueItems.length
      ? queueItems[queueItems.length - 1]
      : null;

  /*
   * 没有本机待上传修改时，云端就是最终状态。
   */
  if(!pendingItem){
    baseline = clone(cloud);

    await writeLocalState(
      cloud,
      cloud
    );

    return clone(cloud);
  }

  const pendingLocal =
    pendingItem.state ||
    local;

  const pendingBase =
    pendingItem.base ||
    localBox?.cloudBaseline ||
    baseline ||
    {};

  const changed =
    Array.isArray(pendingItem.changed)
      ? pendingItem.changed
      : changedKeys(
          pendingLocal,
          pendingBase
        );

  const merged = clone(cloud || {});

  for(const key of changed){
    if(key === "_sync") continue;

    const localValue = pendingLocal?.[key];
    const baseValue = pendingBase?.[key];

    /*
     * tables 必须按桌位逐个合并。
     *
     * 不能因为本机修改了1号桌，
     * 就把其他设备刚修改的5号桌一起覆盖。
     */
    if(
      key === "tables" &&
      Array.isArray(localValue)
    ){
      const cloudTables =
        Array.isArray(merged.tables)
          ? clone(merged.tables)
          : [];

      const baseTables =
        Array.isArray(baseValue)
          ? baseValue
          : [];

      localValue.forEach((table,index)=>{
        const baseTable = baseTables[index];
        const cloudTable = cloudTables[index];

        if(!same(table,baseTable)){
          /*
           * 防止旧页面快照把其他页面刚开始的桌位覆盖回未开始。
           *
           * cloud 已经运行，而 local 和 base 都未运行，说明本机这次操作
           * 并没有显式结束该桌，只是携带了开始前的旧快照，必须保留云端。
           * 真正结账/强制结束时 base 原本是运行状态，因此仍可正常清空。
           */
          const staleStopOverwrite = Boolean(
            cloudTable?.start &&
            !table?.start &&
            !baseTable?.start
          );

          if(!staleStopOverwrite){
            cloudTables[index] = clone(table);
          }
        }
      });

      merged.tables = cloudTables;
      continue;
    }

    /*
     * 预约按预约ID合并。
     */
    if(key === "bookings"){
      merged.bookings = mergeArrayChanges(
        merged.bookings,
        localValue,
        baseValue,
        "booking"
      );
      continue;
    }

    /*
     * 分组按groupId合并。
     */
    if(key === "groups"){
      merged.groups = mergeArrayChanges(
        merged.groups,
        localValue,
        baseValue,
        "group"
      );
      continue;
    }

if(key === "customers"){
  merged.customers = mergeCustomerChanges(
    merged.customers,
    localValue,
    baseValue
  );
  continue;
}
    /*
     * 其他普通字段才直接使用本机值。
     */
    merged[key] = clone(localValue);
  }

  /*
   * baseline 必须记录真实云端状态，
   * 不能记录临时合并后的状态。
   */
  baseline = clone(cloud);

  await writeLocalState(
    merged,
    cloud
  );

  return merged;
}

export function setStateBaseline(nextState){
  baseline = clone(nextState);
  const shadow = readShadow(STATE_SHADOW);
  if(shadow?.state) writeLocalState(shadow.state,nextState).catch(()=>{});
}

function itemId(item,index,prefix="item"){
  if(item && typeof item === "object"){
    return String(item.id ?? item.groupId ?? item.bookingId ?? item.key ?? `${prefix}_${index}`);
  }
  return `${prefix}_${index}`;
}

function mergeArrayChanges(latestValue, localValue, baseValue, prefix){
  const latest = Array.isArray(latestValue) ? clone(latestValue) : [];
  const local = Array.isArray(localValue) ? localValue : [];
  const base = Array.isArray(baseValue) ? baseValue : [];

  const latestMap = new Map(latest.map((v,i)=>[itemId(v,i,prefix),clone(v)]));
  const localMap = new Map(local.map((v,i)=>[itemId(v,i,prefix),v]));
  const baseMap = new Map(base.map((v,i)=>[itemId(v,i,prefix),v]));

  // 本机相对基线删除的项目，也从服务器最新结果中删除。
  for(const id of baseMap.keys()){
    if(!localMap.has(id)) latestMap.delete(id);
  }

  // 只写入本机相对基线新增或修改的项目，保留其他设备新增的项目。
  for(const [id,value] of localMap){
    if(!baseMap.has(id) || !same(value,baseMap.get(id))){
      latestMap.set(id,clone(value));
    }
  }

  return [...latestMap.values()];
}

function mergeObjectChanges(latestValue, localValue, baseValue){
  const latest = clone(latestValue || {});
  const local = localValue || {};
  const base = baseValue || {};
  for(const key of Object.keys(base)){
    if(!(key in local)) delete latest[key];
  }
  for(const key of Object.keys(local)){
    if(!(key in base) || !same(local[key],base[key])) latest[key]=clone(local[key]);
  }
  return latest;
}

function normalizeCustomersMap(value){
  if(Array.isArray(value)){
    const result = {};

    value.forEach((customer,index)=>{
      if(!customer || typeof customer !== "object") return;

      const key =
        customer.key ||
        (
          customer.name && customer.phoneLast4
            ? `${String(customer.name).trim()}_${String(customer.phoneLast4).slice(-4)}`
            : `customer_${index}`
        );

      result[key] = {
        ...clone(customer),
        key,
        visits:Array.isArray(customer.visits)
          ? clone(customer.visits)
          : []
      };
    });

    return result;
  }

  if(value && typeof value === "object"){
    return clone(value);
  }

  return {};
}

function mergeCustomerChanges(
  latestValue,
  localValue,
  baseValue
){
  const latest =
    normalizeCustomersMap(latestValue);

  const local =
    normalizeCustomersMap(localValue);

  const base =
    normalizeCustomersMap(baseValue);

  /*
   * 本机相对基线删除的客户，
   * 也从云端最新结果中删除。
   */
  for(const key of Object.keys(base)){
    if(!(key in local)){
      delete latest[key];
    }
  }

  /*
   * 只写入本机新增或修改的客户，
   * 保留其他设备新增的客户。
   */
  for(const [key,customer] of Object.entries(local)){
    if(
      !(key in base) ||
      !same(customer,base[key])
    ){
      latest[key] = clone(customer);
    }
  }

  return latest;
}

function mergeState(latest, local, base, keys, action=""){
  const merged = clone(latest || {});
  const changed = keys?.length ? keys : changedKeys(local,base);
  for(const key of changed){
    const localValue = local?.[key];
    const baseValue = base?.[key];
    if(key === "tables" && Array.isArray(localValue)){
      const latestTables = Array.isArray(merged.tables) ? clone(merged.tables) : [];
      const baseTables = Array.isArray(baseValue) ? baseValue : [];
      localValue.forEach((table,index)=>{
        const baseTable = baseTables[index];
        const latestTable = latestTables[index];

        if(!same(table,baseTable)){
          const explicitStopActions = new Set([
            "checkout_complete",
            "emergency_force_end_table",
            "force_end_table",
            "checkout_table",
            "batch_checkout",
            "clear_finished_table"
          ]);
          const staleStopOverwrite = Boolean(
            latestTable?.start &&
            !table?.start &&
            !explicitStopActions.has(String(action || ""))
          );

          if(!staleStopOverwrite){
            latestTables[index] = clone(table);
          }
        }
      });
      merged.tables = latestTables;
    }else if(key === "bookings"){
      merged.bookings = mergeArrayChanges(merged.bookings,localValue,baseValue,"booking");
    }else if(key === "groups"){
      merged.groups = mergeArrayChanges(merged.groups,localValue,baseValue,"group");
}else if(key === "customers"){
  merged.customers = mergeCustomerChanges(
    merged.customers,
    localValue,
    baseValue
  );      
    }else{
      merged[key] = clone(localValue);
    }
  }
  merged._sync = {revision:Number(latest?._sync?.revision || 0)+1,updatedAt:Date.now(),deviceId:getDeviceId()};
  return {merged,changed};
}

async function enqueue(local,base,action){
  const changed = changedKeys(local,base);
  const item = {id:`${getDeviceId()}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,state:clone(local),base:clone(base),changed,action,createdAt:Date.now(),deviceId:getDeviceId()};

  // 桌位状态使用“最新快照队列”，而不是累积几十个旧快照。
  // 旧快照在弱网恢复后依次重放，会把刚刚开始的桌位重新覆盖成未开始。
  // 当前 state 已包含本机此前所有尚未同步的修改，所以只保留最新一项即可。
  await idbClear("queue");
  await idbPut("queue",item);
  return item;
}

async function flushOne({db,ref}, item){
  let result;
  await runTransaction(db,async tx=>{
    const snap = await tx.get(ref);
    const latest = snap.exists() ? snap.data() : {};
    result = mergeState(latest,item.state,item.base,item.changed,item.action);
    tx.set(ref,result.merged);
  });
  await idbDelete("queue",item.id);
  baseline = clone(result.merged);

  // 上传成功后，本机也必须改成服务器最终合并后的状态。
  // 不能继续保存上传前的旧 state，否则其他终端的修改会在本机重新出现并再次覆盖云端。
  await writeLocalState(result.merged,result.merged);
  writeShadow(STATE_SHADOW,{state:clone(result.merged),cloudBaseline:clone(result.merged),savedAt:Date.now(),deviceId:getDeviceId()});
  window.dispatchEvent(new CustomEvent("chiptune-cloud-state-saved",{detail:{state:clone(result.merged)}}));
  broadcastState(
  result.merged,
  item.action || "cloud_saved"
);
  try{
    await addDoc(collection(db,"operationLogs"),{action:item.action,changed:item.changed,deviceId:item.deviceId,createdAt:serverTimestamp(),clientTime:item.createdAt});
  }catch(err){ console.warn("操作日志写入失败",err); }
}

async function flushRecordOne({db}, item){
  if(item.type === "delete"){
    const recordId = String(item.recordId);
    // 先写共享删除标记，再删除正式账单。其他设备即使保留旧缓存，也会收到删除标记。
    await setDoc(doc(db,RECORD_DELETES_COLLECTION,recordId),{
      recordId,
      deletedAt:serverTimestamp(),
      clientDeletedAt:Number(item.createdAt || Date.now()),
      deviceId:item.deviceId || getDeviceId()
    });
    await deleteDoc(doc(db,"records",recordId));
  }else{
    await setDoc(doc(db,"records",String(item.record.id)), item.record);
  }
  await idbDelete("recordQueue",item.id);
}

export async function flushPending({db,ref}){
  if(!navigator.onLine) return;
  let items = (await idbAll("queue")).sort((a,b)=>a.createdAt-b.createdAt);

  // 兼容旧版本已经积累的多个桌位快照：只上传最后一份，禁止旧快照依次重放。
  if(items.length > 1){
    const latestItem = items[items.length - 1];
    await idbClear("queue");
    await idbPut("queue",latestItem);
    items = [latestItem];
  }

  const recordItems = (await idbAll("recordQueue")).sort((a,b)=>a.createdAt-b.createdAt);
  const total = items.length + recordItems.length;
  if(!total){ setSyncStatus("synced"); return; }
  setSyncStatus("syncing",`● 本机已保存 · 正在上传 ${total} 项`);
  for(const item of items){
    if(!navigator.onLine) break;
    await withTimeout(flushOne({db,ref},item),12000,"桌位状态同步");
  }
  for(const item of recordItems){
    if(!navigator.onLine) break;
    await withTimeout(flushRecordOne({db},item),12000,"收银记录同步");
  }
  const left = (await idbAll("queue")).length + (await idbAll("recordQueue")).length;
  setSyncStatus(left ? "pending" : "synced", left ? `● 已保存本机 · ${left} 项等待上传` : undefined);
}

async function pendingCount(){
  return (await idbAll("queue").catch(()=>[])).length + (await idbAll("recordQueue").catch(()=>[])).length;
}

export function installConnectionGuard(){
  const update = async ()=>{
    const count = await pendingCount();
    if(!navigator.onLine) setSyncStatus("offline",`● 已保存本机 · 离线 · ${count} 项待上传`);
    else setSyncStatus(count ? "pending" : "synced",count ? `● 已保存本机 · ${count} 项等待上传` : undefined);
    window.dispatchEvent(new CustomEvent("chiptune-online-change",{detail:{online:navigator.onLine}}));
  };
  window.addEventListener("online",update);
  window.addEventListener("offline",update);
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) update(); });
  // 弱网环境下定时重试待上传操作；所有打开程序的设备都可参与实时操作。
  setInterval(()=>{
    if(navigator.onLine){
      window.dispatchEvent(new CustomEvent("chiptune-sync-tick",{detail:{online:true}}));
    }
  },5000);
  update();
}

export function saveStateSafely({
  db,
  ref,
  getState,
  action="state_update"
}){
  const immediate = clone(getState());
  const immediateBase =
    clone(baseline || immediate);

  writeShadow(
    STATE_SHADOW,
    {
      state:immediate,
      cloudBaseline:immediateBase,
      savedAt:Date.now(),
      deviceId:getDeviceId()
    }
  );

  /*
   * 本机一保存，马上通知预约页和计时器页。
   */
  broadcastState(immediate,action);

  saveQueue = saveQueue.catch(()=>{}).then(async()=>{
    const local = clone(getState());
    const base = clone(baseline || immediateBase || local);
    setSyncStatus("saving");
    await writeLocalState(local,base);
    await enqueue(local,base,action);
    const count = await pendingCount();
    setSyncStatus(navigator.onLine ? "pending" : "offline", navigator.onLine ? `● 已保存本机 · ${count} 项等待上传` : `● 已保存本机 · 离线 · ${count} 项待上传`);
    if(navigator.onLine){
      // 在线操作立即同步，不再等延迟计时器。这样手机、iPad 和二维码页面
      // 都能在几乎同一时间收到桌位状态更新。
      try{
        await flushPending({db,ref});
      }catch(err){
        console.warn("云端同步失败，将自动重试",err);
        setSyncStatus("pending","● 已保存本机 · 云端同步失败，将重试");
      }
    }
    return local;
  }).catch(err=>{
    setSyncStatus("error","● 本机保存失败，请立即停止操作");
    console.error(err);
    throw err;
  });
  return saveQueue;
}

export async function saveRecordSafely({db,ref,record}){
  const next = clone(record);
  next.localUpdatedAt = Date.now();
  const current = await loadLocalRecords();
  const merged = mergeRecordLists(current,[next]);
  writeShadow(RECORDS_SHADOW,merged);
  broadcastRecord(next,"save_record");
  await writeLocalRecords(merged);
  await idbPut("recordQueue",{id:`record_${next.id}`,record:next,createdAt:Date.now()});
  const count = await pendingCount();
  setSyncStatus(navigator.onLine ? "pending" : "offline", navigator.onLine ? `● 已保存本机 · ${count} 项等待上传` : `● 已保存本机 · 离线 · ${count} 项待上传`);
  if(navigator.onLine){
    clearTimeout(flushTimer);
    flushTimer = setTimeout(()=>flushPending({db,ref}).catch(err=>{
      console.warn("账单同步失败，将自动重试",err);
      setSyncStatus("pending","● 账单已保存本机 · 云端同步失败，将重试");
    }),0);
  }
  return next;
}



export async function atomicStartTable({db,ref,tableIndex,tablePatch,record,timerStartAt,timerEndAt,excludeBookingId=null}){
  if(!navigator.onLine){
    throw new Error("当前离线，无法执行跨设备安全开始");
  }
  let result = null;
  await runTransaction(db, async tx=>{
    const snap = await tx.get(ref);
    const latest = snap.exists() ? clone(snap.data()) : {};
    const tables = Array.isArray(latest.tables) ? clone(latest.tables) : [];
    const existing = tables[tableIndex] || {};

    if(existing.start){
      result = {startedByThisDevice:false,state:latest,table:clone(existing)};
      return;
    }

    const parseBookingDateTime = (dateText,timeText)=>{
      const date = String(dateText || "").trim();
      const time = String(timeText || "").trim();
      if(!date || !/^\d{2}:\d{2}$/.test(time)) return NaN;
      const [y,m,d] = date.split("-").map(Number);
      const [hh,mm] = time.split(":").map(Number);
      if(!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return NaN;
      return new Date(y,m-1,d,hh,mm,0,0).getTime();
    };

    const proposedStart = Number(timerStartAt || tablePatch?.start || Date.now());
    const proposedEnd = Number(timerEndAt || proposedStart);
    const conflict = (Array.isArray(latest.bookings) ? latest.bookings : []).find(b=>{
      if(b?.cancelled || b?.checkedIn) return false;
      if(Number(b?.id) === Number(excludeBookingId)) return false;
      const indexes = (Array.isArray(b?.tableIndexes) ? b.tableIndexes : [b?.tableIndex])
        .filter(v=>v !== undefined && v !== null && v !== "")
        .map(Number);
      if(!indexes.includes(Number(tableIndex))) return false;
      const bookingStart = parseBookingDateTime(b.date,b.startTime);
      const bookingEnd = parseBookingDateTime(b.date,b.endTime);
      if(!Number.isFinite(bookingStart) || !Number.isFinite(bookingEnd)) return false;
      return proposedStart < bookingEnd && proposedEnd > bookingStart;
    });

    if(conflict){
      const err = new Error(`${tablePatch?.name || `${Number(tableIndex)+1}号桌`}无法开始：与预约 ${conflict.date || ""} ${conflict.startTime || "-"}-${conflict.endTime || "-"} 冲突。请更换桌位、调整预约或选择不会重叠的套餐。`);
      err.code = "booking-conflict";
      throw err;
    }

    const nextTable = {...existing,...clone(tablePatch)};
    tables[tableIndex] = nextTable;
    latest.tables = tables;
    latest._sync = {
      revision:Number(latest?._sync?.revision || 0)+1,
      updatedAt:Date.now(),
      deviceId:getDeviceId(),
      action:"atomic_start_table"
    };

    tx.set(ref,latest);
    tx.set(doc(db,"records",String(record.id)),clone(record));
    result = {startedByThisDevice:true,state:latest,table:clone(nextTable)};
  });

  if(result?.state){
    baseline = clone(result.state);
    await writeLocalState(result.state,result.state);
    writeShadow(STATE_SHADOW,{state:clone(result.state),cloudBaseline:clone(result.state),savedAt:Date.now(),deviceId:getDeviceId()});
    window.dispatchEvent(new CustomEvent("chiptune-cloud-state-saved",{detail:{state:clone(result.state)}}));
    broadcastState(result.state,"atomic_start_table");
  }
  if(result?.startedByThisDevice && record){
    const localRecords = await loadLocalRecords().catch(()=>[]);
    const mergedRecords = mergeRecordLists(localRecords,[record]);
    writeShadow(RECORDS_SHADOW,mergedRecords);
    broadcastRecord(record,"atomic_start_record");
    await writeLocalRecords(mergedRecords);
  }
  return result;
}

export async function deleteRecordSafely({db,ref,recordId}){
  const id = String(recordId || "");
  if(!id) throw new Error("缺少账单ID");

  // Tombstone first: this is synchronous and prevents cloud snapshots from reviving the record.
  const deleted = getDeletedRecordIds();
  deleted.add(id);
  saveDeletedRecordIds(deleted);

  const currentShadow = readShadow(RECORDS_SHADOW);
  const shadowList = (Array.isArray(currentShadow) ? currentShadow : []).filter(r=>String(r.id)!==id);
  writeShadow(RECORDS_SHADOW, shadowList);

  try{
    const current = await loadLocalRecords();
    const next = current.filter(r=>String(r.id)!==id);
    await writeLocalRecords(next);
    await idbPut("recordQueue",{id:`delete_record_${id}`,type:"delete",recordId:id,createdAt:Date.now(),deviceId:getDeviceId()});
  }catch(err){
    console.warn("账单本地删除队列写入失败，已保留删除标记",err);
  }

  if(navigator.onLine){
    clearTimeout(flushTimer);
    flushTimer = setTimeout(()=>flushPending({db,ref}).catch(err=>{
      console.warn("账单删除同步失败，将自动重试",err);
      setSyncStatus("pending","● 已从本机删除 · 云端删除等待重试");
    }),50);
  }
  return id;
}

export function clearRecordDeletionMark(recordId){
  const deleted = getDeletedRecordIds();
  deleted.delete(String(recordId));
  saveDeletedRecordIds(deleted);
}

export function getLocalRecordSync(recordId){
  if(!recordId) return null;
  const list = readShadow(RECORDS_SHADOW);
  if(!Array.isArray(list)) return null;
  return clone(list.find(r=>String(r.id)===String(recordId)) || null);
}

export function emergencySaveRecord({db,ref,record}){
  const next = clone(record);
  next.localUpdatedAt = Date.now();
  const current = readShadow(RECORDS_SHADOW);
  const merged = mergeRecordLists(Array.isArray(current) ? current : [], [next]);
  // localStorage is synchronous: once this returns, the emergency bill has a durable local shadow.
  writeShadow(RECORDS_SHADOW, merged);
  broadcastRecord(next,"emergency_save_record");

  // IndexedDB and cloud queue run in background and must never block the UI.
  Promise.resolve().then(async()=>{
    try{
      await writeLocalRecords(merged);
      await idbPut("recordQueue",{id:`record_${next.id}`,record:next,createdAt:Date.now()});
      if(navigator.onLine){
        clearTimeout(flushTimer);
        flushTimer = setTimeout(()=>flushPending({db,ref}).catch(err=>{
          console.warn("紧急账单云端同步失败，将自动重试",err);
          setSyncStatus("pending","● 账单已保存本机 · 云端同步失败，将重试");
        }),0);
      }
    }catch(err){
      console.warn("紧急账单 IndexedDB 保存失败，已保留 localStorage 备份",err);
      setSyncStatus("pending","● 紧急账单已保存在本机备份");
    }
  });
  return next;
}

export function emergencySaveState({db,ref,state,action="emergency_state_update"}){
  const local = clone(state);
  const base = clone(baseline || local);
  // Synchronous shadow first, so closing the modal/page cannot lose this state.
  writeShadow(STATE_SHADOW,{state:local,cloudBaseline:base,savedAt:Date.now(),deviceId:getDeviceId()});
  broadcastState(local,action);
  setSyncStatus(navigator.onLine ? "pending" : "offline", navigator.onLine ? "● 已紧急保存本机 · 等待上传" : "● 已紧急保存本机 · 当前离线");

  Promise.resolve().then(async()=>{
    try{
      await writeLocalState(local,base);
      await enqueue(local,base,action);
      const count = await pendingCount();
      setSyncStatus(navigator.onLine ? "pending" : "offline", navigator.onLine ? `● 已保存本机 · ${count} 项等待上传` : `● 已保存本机 · 离线 · ${count} 项待上传`);
      if(navigator.onLine){
        clearTimeout(flushTimer);
        flushTimer = setTimeout(()=>flushPending({db,ref}).catch(err=>{
          console.warn("紧急状态云端同步失败，将自动重试",err);
          setSyncStatus("pending","● 已保存本机 · 云端同步失败，将重试");
        }),0);
      }
    }catch(err){
      console.warn("紧急状态 IndexedDB 保存失败，已保留 localStorage 备份",err);
      setSyncStatus("pending","● 状态已保存在本机紧急备份");
    }
  });
  return local;
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


/**
 * 统一读取全部收银记录。
 *
 * 设计原则：
 * 1. Firestore records 集合是正式历史账单来源；
 * 2. 本机未上传账单始终合并显示；
 * 3. 云端历史记录按文档 ID 分批读取，避免包含收款截图的大文档一次性下载时卡死；
 * 4. 每读取一批就立刻更新页面，直到完整读完 records 集合。
 */
export function subscribeAllRecords({
  db,
  onChange,
  onStatus,
  fullHistory = false
}={}){
  const recordsRef = collection(db,"records");
  const BATCH_SIZE = 5;
  const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  let cloudRecords = [];
  let fullServerRecords = [];
  let stopped = false;
  let retryTimer = null;
  let loadingAll = false;
  let incrementalUnsubscribe = null;
  let deleteUnsubscribe = null;
  let sharedDeletedIds = new Set();

  // 同一台设备的计时器写入账单后，首页/今日账单/老板模式立即接收，
  // 不等待 Firestore 再回传一次。
  const recordBroadcastHandler = event=>{
    const record = event?.detail?.record;
    if(stopped || !record?.id || sharedDeletedIds.has(String(record.id))) return;
    cloudRecords = mergeRecordLists(cloudRecords,[record]);
    loadLocalRecords().then(local=>{
      if(!stopped) onChange?.(mergeRecordLists(cloudRecords,local));
    }).catch(()=>{
      if(!stopped) onChange?.(mergeRecordLists(cloudRecords,[record]));
    });
  };
  window.addEventListener("chiptune-record-broadcast",recordBroadcastHandler);

  const readMeta = ()=>{
    try{
      return JSON.parse(localStorage.getItem(RECORD_HISTORY_SYNC_META) || "null") || {};
    }catch{
      return {};
    }
  };

  const writeMeta = meta=>{
    try{
      localStorage.setItem(RECORD_HISTORY_SYNC_META,JSON.stringify(meta));
    }catch(err){
      console.warn("历史账单同步进度保存失败",err);
    }
  };

  const recordTime = r=>Number(r?.timestamp || r?.closedAt || r?.paidAt || 0);
  const mergeCloud = list=>{
    cloudRecords = mergeRecordLists(cloudRecords,(list || []).filter(r=>!sharedDeletedIds.has(String(r.id))));
  };

  const applySharedDeletes = async ids=>{
    let changed=false;
    for(const id of ids || []){
      const key=String(id);
      if(!sharedDeletedIds.has(key)) changed=true;
      sharedDeletedIds.add(key);
    }
    if(!changed && !ids?.length) return;
    cloudRecords = cloudRecords.filter(r=>!sharedDeletedIds.has(String(r.id)));
    const local = await loadLocalRecords().catch(()=>[]);
    const filtered = local.filter(r=>!sharedDeletedIds.has(String(r.id)));
    if(filtered.length !== local.length) await writeLocalRecords(filtered).catch(()=>{});
    if(!stopped) onChange?.(mergeRecordLists(cloudRecords,filtered));
  };

  const startDeleteListener = ()=>{
    if(stopped || deleteUnsubscribe) return;
    deleteUnsubscribe = onSnapshot(collection(db,RECORD_DELETES_COLLECTION),snap=>{
      applySharedDeletes(snap.docs.map(d=>d.id)).catch(err=>console.warn("同步账单删除标记失败",err));
    },err=>console.warn("账单删除标记监听失败",err));
  };

  const emit = async({persist=false}={})=>{
    const local = (await loadLocalRecords().catch(()=>[])).filter(r=>!sharedDeletedIds.has(String(r.id)));
    const merged = mergeRecordLists(cloudRecords,local).filter(r=>!sharedDeletedIds.has(String(r.id)));

    if(persist){
      await replaceLocalRecords(merged).catch(err=>{
        console.warn("保存历史账单到本机失败",err);
      });
    }

    if(!stopped) onChange?.(merged);
    return merged;
  };

  const startIncrementalListener = async()=>{
    if(stopped || incrementalUnsubscribe) return;

    const local = await loadLocalRecords().catch(()=>[]);
    const meta = readMeta();
    const localNewest = Math.max(0,...local.map(recordTime));
    const lastTimestamp = Number(meta.lastTimestamp || localNewest || 0);

    // 已有完整历史时，只监听最后时间附近的新记录；从未完整下载过时，
    // 非收银页面只监听最近7天，避免首页启动时下载全部历史和大图。
    const since = lastTimestamp > 0
      ? Math.max(0,lastTimestamp - 60000)
      : Math.max(0,Date.now() - RECENT_WINDOW_MS);

    const q = query(
      recordsRef,
      where("timestamp",">=",since),
      orderBy("timestamp","asc")
    );

    incrementalUnsubscribe = onSnapshot(
      q,
      {includeMetadataChanges:true},
      async snap=>{
        const list = snap.docs
          .map(d=>({id:d.id,...d.data()}))
          .filter(r=>r.id!=="init");

        mergeCloud(list);
        const merged = await emit({persist:!snap.metadata.fromCache});

        if(!snap.metadata.fromCache){
          const newest = Math.max(lastTimestamp,...merged.map(recordTime));
          writeMeta({
            ...readMeta(),
            lastTimestamp:newest,
            lastSyncAt:Date.now(),
            count:merged.length
          });
          onStatus?.(`已从本机载入 ${merged.length} 条｜新记录已同步`);
        }
      },
      err=>{
        console.warn("新账单实时监听失败",err);
        onStatus?.("本机账单已载入｜新记录将在联网后同步");
      }
    );
  };

  const scheduleRetry = ()=>{
    clearTimeout(retryTimer);
    if(!stopped){
      retryTimer = setTimeout(loadAllFromServer,5000);
    }
  };

  async function loadAllFromServer(){
    if(stopped || loadingAll || !fullHistory) return;

    if(!navigator.onLine){
      const local = await loadLocalRecords().catch(()=>[]);
      onStatus?.(`已从本机载入 ${local.length} 条｜等待联网继续读取历史账单`);
      scheduleRetry();
      return;
    }

    loadingAll = true;
    const savedMeta = readMeta();
    let total = null;

    try{
      try{
        const countSnap = await withTimeout(
          getCountFromServer(recordsRef),
          15000,
          "历史账单数量读取"
        );
        total = Math.max(0,Number(countSnap.data().count || 0)-1);
      }catch(err){
        console.warn("无法读取历史账单总数，将仅显示已读取数量",err);
      }

      // 支持中断续传。cursorId 是上次成功保存到本机的最后一个文档ID。
      // 旧版本可能错误地把 complete 写成 true，但本机实际上只有 0 条或少量记录。
      // 因此必须用本机实际条数和云端总数校验，不能只相信 complete 标志。
      const localBefore = await loadLocalRecords().catch(()=>[]);
      const expectedCount = total == null ? Number(savedMeta.count || 0) : total;
      const cacheLooksComplete = Boolean(
        savedMeta.complete &&
        localBefore.length > 0 &&
        (expectedCount <= 0 || localBefore.length >= expectedCount)
      );

      if(savedMeta.complete && !cacheLooksComplete){
        console.warn("历史账单完成标志与本机缓存不一致，自动重新扫描",{
          localCount:localBefore.length,
          expectedCount,
          savedMeta
        });
        writeMeta({
          complete:false,
          cursorId:null,
          loaded:0,
          count:localBefore.length,
          lastTimestamp:Math.max(0,...localBefore.map(recordTime)),
          resetAt:Date.now(),
          resetReason:"stale_complete_flag"
        });
      }

      // 为了保证本机镜像能准确删除云端已经不存在的旧记录，
      // 未完成的完整扫描每次都从头开始。已有页面数据仍从本机立即显示，扫描只在后台重建镜像。
      let cursorId = null;
      let loaded = 0;
      fullServerRecords = [];

      if(cacheLooksComplete){
        onStatus?.(`已从本机载入全部历史账单｜${localBefore.length} 条`);
        await startIncrementalListener();
        return;
      }

      onStatus?.(
        total!=null
          ? `正在读取全部历史账单｜${Math.min(loaded,total)} / ${total}（${total ? Math.min(100,Math.round(loaded/total*100)) : 0}%）`
          : `正在读取全部历史账单｜已读取 ${loaded} 条`
      );

      while(!stopped){
        const pageQuery = cursorId
          ? query(recordsRef,orderBy(documentId()),startAfter(cursorId),limit(BATCH_SIZE))
          : query(recordsRef,orderBy(documentId()),limit(BATCH_SIZE));

        const snap = await withTimeout(
          getDocsFromServer(pageQuery),
          90000,
          "历史账单分批读取"
        );

        if(stopped) return;

        const docs = snap.docs;
        const list = docs
          .map(d=>({id:d.id,...d.data()}))
          .filter(r=>r.id!=="init");

        fullServerRecords = mergeRecordLists(fullServerRecords,list);
        mergeCloud(list);
        const merged = await emit({persist:true});

        loaded += list.length;
        cursorId = docs.length ? docs[docs.length-1].id : cursorId;

        const percent = total
          ? Math.min(100,Math.round(Math.min(loaded,total)/total*100))
          : null;

        writeMeta({
          complete:false,
          cursorId,
          loaded,
          count:merged.length,
          lastTimestamp:Math.max(0,...merged.map(recordTime)),
          lastSyncAt:Date.now()
        });

        onStatus?.(
          total!=null
            ? `正在读取全部历史账单｜${Math.min(loaded,total)} / ${total}（${percent}%）`
            : `正在读取全部历史账单｜已读取 ${loaded} 条`
        );

        if(docs.length < BATCH_SIZE){
          // 完整扫描结束后，以云端全集为基础重建本机镜像；仅保留尚未上传的新账单。
          const pendingItems = await idbAll("recordQueue").catch(()=>[]);
          const pendingRecords = pendingItems
            .filter(x=>x.type !== "delete" && x.record)
            .map(x=>x.record);
          const exactMerged = mergeRecordLists(
            fullServerRecords.filter(r=>!sharedDeletedIds.has(String(r.id))),
            pendingRecords.filter(r=>!sharedDeletedIds.has(String(r.id)))
          );
          await writeLocalRecords(exactMerged);
          cloudRecords = clone(exactMerged);
          if(!stopped) onChange?.(clone(exactMerged));
          const newest = Math.max(0,...exactMerged.map(recordTime));
          writeMeta({
            complete:true,
            cursorId:null,
            loaded:exactMerged.length,
            count:exactMerged.length,
            lastTimestamp:newest,
            lastSyncAt:Date.now()
          });
          onStatus?.(`全部历史账单已保存到本机｜共 ${exactMerged.length} 条`);
          await startIncrementalListener();
          return;
        }
      }
    }catch(err){
      console.warn("完整历史账单读取失败",err);
      const local = await loadLocalRecords().catch(()=>[]);
      const reason = String(err?.message || err || "未知错误");
      onStatus?.(`已保存 ${local.length} 条到本机｜读取中断：${reason}｜5秒后继续`);
      scheduleRetry();
    }finally{
      loadingAll = false;
    }
  }

  // 所有页面都监听共享删除标记，保证手机和 iPad 删除结果一致。
  startDeleteListener();

  // 所有页面先立即使用本机数据。只有收银记录页面要求执行一次完整历史下载。
  loadLocalRecords().then(async local=>{
    if(stopped) return;

    cloudRecords = mergeRecordLists(cloudRecords,local);
    onChange?.(cloudRecords);

    const meta = readMeta();
    if(fullHistory && !meta.complete){
      loadAllFromServer();
      return;
    }

    if(meta.complete){
      onStatus?.(`已从本机载入全部历史账单｜${local.length} 条`);
    }else{
      onStatus?.(`已从本机载入 ${local.length} 条`);
    }
    await startIncrementalListener();
  }).catch(err=>{
    console.warn("读取本机账单失败",err);
    onStatus?.("本机账单读取失败｜正在尝试云端同步");
    if(fullHistory) loadAllFromServer();
    else startIncrementalListener();
  });

  const onlineHandler = ()=>{
    const meta = readMeta();
    if(fullHistory && !meta.complete) loadAllFromServer();
    else startIncrementalListener();
  };
  window.addEventListener("online",onlineHandler);

  return ()=>{
    stopped = true;
    clearTimeout(retryTimer);
    incrementalUnsubscribe?.();
    deleteUnsubscribe?.();
    window.removeEventListener("online",onlineHandler);
    window.removeEventListener("chiptune-record-broadcast",recordBroadcastHandler);
  };
}
