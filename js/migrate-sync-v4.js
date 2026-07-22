import { db } from "./firebase.js?v=4.0.9";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const logEl = document.getElementById("log");
const btn = document.getElementById("migrateBtn");
const verifyBtn = document.getElementById("verifyBtn");
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const progressTextEl = document.getElementById("progressText");
const statsBody = document.getElementById("statsBody");
const resultCard = document.getElementById("resultCard");

const TYPES = ["tables", "bookings", "groups", "customers", "records", "payments"];
const labels = {
  tables: "妗屼綅",
  bookings: "棰勭害",
  groups: "鍒嗙粍",
  customers: "瀹㈡埛",
  records: "璐﹀崟",
  payments: "浠樻娴佹按"
};

const stats = Object.fromEntries(TYPES.map(k => [k, {
  source: 0, created: 0, skipped: 0, failed: 0, verified: "寰呮鏌?
}]));

let totalJobs = 0;
let finishedJobs = 0;
let running = false;

function log(message) {
  logEl.textContent += `${new Date().toLocaleTimeString()} ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function renderStats() {
  statsBody.innerHTML = TYPES.map(type => {
    const s = stats[type];
    return `<tr><td>${labels[type]}</td><td>${s.source}</td><td>${s.created}</td><td>${s.skipped}</td><td>${s.failed}</td><td>${s.verified}</td></tr>`;
  }).join("");
}

function updateProgress(message) {
  const percent = totalJobs > 0 ? Math.min(100, Math.round(finishedJobs / totalJobs * 100)) : 0;
  progressEl.value = percent;
  progressTextEl.textContent = `${percent}%锛?{finishedJobs}/${totalJobs || 0}锛塦;
  if (message) statusEl.textContent = message;
  renderStats();
}

function resetStats() {
  for (const type of TYPES) Object.assign(stats[type], {
    source: 0, created: 0, skipped: 0, failed: 0, verified: "寰呮鏌?
  });
  totalJobs = 0;
  finishedJobs = 0;
  resultCard.hidden = true;
  resultCard.className = "card";
  resultCard.textContent = "";
  updateProgress("姝ｅ湪璇诲彇婧愭暟鎹€?);
}

function itemId(value, index, prefix) {
  return String(value?.id || value?.bookingId || value?.groupId || `${prefix}_${index}`);
}

function entityMetadata(value, id, source) {
  return {
    id,
    version: Math.max(1, Number(value?.version || value?._entitySync?.version || 0)),
    deleted: Boolean(value?.deleted),
    updatedAt: serverTimestamp(),
    updatedBy: "migration-v4.0.1",
    migratedFrom: source,
    schemaVersion: 4
  };
}

async function createOnly(ref, fullData, type) {
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      stats[type].skipped++;
      return "skipped";
    }
    await setDoc(ref, fullData);
    stats[type].created++;
    return "created";
  } catch (error) {
    stats[type].failed++;
    log(`鉂?${type}/${ref.id}锛?{error?.message || error}`);
    return "failed";
  } finally {
    finishedJobs++;
    updateProgress(`姝ｅ湪杩佺Щ ${labels[type]}鈥);
  }
}

async function migrateEntityArray(values, collectionName, prefix, type, source) {
  for (let i = 0; i < values.length; i++) {
    const value = values[i] || {};
    const id = type === "tables"
      ? `table_${String(i + 1).padStart(2, "0")}`
      : itemId(value, i, prefix);
    await createOnly(
      doc(db, collectionName, id),
      {...value, ...entityMetadata(value, id, source), ...(type === "tables" ? {tableIndex: i} : {})},
      type
    );
  }
}

async function readSource() {
  const mainRef = doc(db, "shop", "main");
  const mainSnap = await getDoc(mainRef);
  if (!mainSnap.exists()) throw new Error("鎵句笉鍒?shop/main锛屾棤娉曡鍙栨棫鐗堟暟鎹?);
  const state = mainSnap.data() || {};

  const tables = Array.isArray(state.tables) ? state.tables : [];
  const bookings = Array.isArray(state.bookings) ? state.bookings : [];
  const groups = Array.isArray(state.groups) ? state.groups : [];
  const customersMap = Array.isArray(state.customers)
    ? Object.fromEntries(state.customers.map((v, i) => [String(v?.id || `customer_${i}`), v]))
    : (state.customers || {});

  const recordsSnap = await getDocs(collection(db, "records"));
  const records = recordsSnap.docs
    .filter(d => d.id !== "init")
    .map(d => ({snapId: d.id, data: d.data() || {}}));

  stats.tables.source = tables.length;
  stats.bookings.source = bookings.length;
  stats.groups.source = groups.length;
  stats.customers.source = Object.keys(customersMap).length;
  stats.records.source = records.length;
  stats.payments.source = records.reduce((sum, r) => sum + (Array.isArray(r.data.payments) ? r.data.payments.length : 0), 0);

  totalJobs = TYPES.reduce((sum, type) => sum + stats[type].source, 0);
  updateProgress("婧愭暟鎹鍙栧畬鎴愶紝鍑嗗杩佺Щ鈥?);
  return {mainRef, tables, bookings, groups, customersMap, records};
}

async function migrateRecords(records) {
  for (const {snapId, data: record} of records) {
    const recordId = String(record.id || snapId);
    const recordRef = doc(db, "records", recordId);
    try {
      const current = await getDoc(recordRef);
      if (!current.exists()) {
        await setDoc(recordRef, {
          ...record,
          id: recordId,
          version: Math.max(1, Number(record.version || record?._recordSync?.version || 0)),
          deleted: Boolean(record.deleted),
          updatedAt: serverTimestamp(),
          updatedBy: "migration-v4.0.1",
          paymentSchemaVersion: 2,
          schemaVersion: 4
        });
        stats.records.created++;
      } else {
        const currentData = current.data() || {};
        // 鍙ˉ鍏冩暟鎹紝涓嶆敼鍐欏凡鏈変笟鍔″瓧娈点€?        await setDoc(recordRef, {
          id: recordId,
          version: Math.max(1, Number(currentData.version || record.version || record?._recordSync?.version || 0)),
          deleted: Boolean(currentData.deleted),
          paymentSchemaVersion: 2,
          schemaVersion: 4,
          migrationMetadataUpdatedAt: serverTimestamp()
        }, {merge: true});
        stats.records.skipped++;
      }
    } catch (error) {
      stats.records.failed++;
      log(`鉂?records/${recordId}锛?{error?.message || error}`);
    } finally {
      finishedJobs++;
      updateProgress("姝ｅ湪杩佺Щ璐﹀崟鈥?);
    }

    const payments = Array.isArray(record.payments) ? record.payments : [];
    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i] || {};
      const paymentId = String(
        payment.id || payment.paymentId ||
        `${recordId}_legacy_${i}_${Number(payment.createdAt || payment.localCreatedAt || 0)}`
      );
      await createOnly(
        doc(db, "records", recordId, "payments", paymentId),
        {
          ...payment,
          id: paymentId,
          paymentId,
          recordId,
          status: payment.status || "active",
          createdAt: payment.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: "migration-v4.0.1",
          migratedFrom: "records.payments",
          schemaVersion: 4
        },
        "payments"
      );
    }
  }
}

async function countCollection(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.filter(d => d.id !== "init" && !d.data()?.deleted).length;
}

async function countPaymentSubcollections(records) {
  let count = 0;
  for (const {snapId, data} of records) {
    const recordId = String(data.id || snapId);
    const snap = await getDocs(collection(db, "records", recordId, "payments"));
    count += snap.size;
  }
  return count;
}

async function verifyMigration(source = null) {
  statusEl.textContent = "姝ｅ湪鍥炶 Firestore 楠岃瘉鈥?;
  log("寮€濮嬪洖璇绘柊缁撴瀯杩涜楠岃瘉鈥?);

  const markerSnap = await getDoc(doc(db, "settings", "migration_v4"));
  let sourceData = source;
  if (!sourceData) sourceData = await readSource();

  const actual = {
    tables: await countCollection("tables"),
    bookings: await countCollection("bookings"),
    groups: await countCollection("groups"),
    customers: await countCollection("customers"),
    records: await countCollection("records"),
    payments: await countPaymentSubcollections(sourceData.records)
  };

  let allOk = true;
  for (const type of TYPES) {
    const expected = stats[type].source;
    const ok = actual[type] >= expected;
    stats[type].verified = ok ? `鉁?${actual[type]}` : `鉂?${actual[type]}/${expected}`;
    if (!ok) allOk = false;
  }
  renderStats();

  if (allOk) {
    await setDoc(doc(db, "settings", "migration_v4"), {
      schemaVersion: 4,
      migrationVersion: "4.0.1",
      status: "completed",
      completedAt: serverTimestamp(),
      verifiedAt: serverTimestamp(),
      sourceCounts: Object.fromEntries(TYPES.map(t => [t, stats[t].source])),
      verifiedCounts: actual,
      oldDataDeleted: false
    }, {merge: true});

    await setDoc(sourceData.mainRef, {
      schemaVersion: 4,
      entitySyncEnabled: true,
      migrationVersion: "4.0.1",
      migratedAt: serverTimestamp()
    }, {merge: true});

    progressEl.value = 100;
    progressTextEl.textContent = "100%";
    statusEl.textContent = "鉁?杩佺Щ瀹屾垚骞堕獙璇侀€氳繃";
    resultCard.hidden = false;
    resultCard.className = "card success";
    resultCard.innerHTML = `<strong>鉁?Migration Complete</strong><br><br>杩佺Щ鏍囪宸插啓鍏ワ細<code>settings/migration_v4</code><br>鐘舵€侊細<code>completed</code><br><br>鐜板湪鍙互鍏抽棴姝ら〉闈紝鍐嶉€愬彴鎵撳紑鍏朵粬璁惧銆俙;
    log("鉁?杩佺Щ瀹屾垚锛屾墍鏈夋暟閲忛獙璇侀€氳繃锛屽凡鍐欏叆 settings/migration_v4銆?");
    return true;
  }

  await setDoc(doc(db, "settings", "migration_v4"), {
    schemaVersion: 4,
    migrationVersion: "4.0.1",
    status: "verification_failed",
    verifiedAt: serverTimestamp(),
    sourceCounts: Object.fromEntries(TYPES.map(t => [t, stats[t].source])),
    verifiedCounts: actual,
    oldDataDeleted: false
  }, {merge: true});

  statusEl.textContent = "鉂?杩佺Щ鏈€氳繃楠岃瘉";
  resultCard.hidden = false;
  resultCard.className = "card error";
  resultCard.innerHTML = `<strong>杩佺Щ灏氭湭瀹屾垚銆?/strong><br><br>璇锋煡鐪嬩笂鏂光€滈獙璇佲€濆垪鍜屾棩蹇椼€傚彲鍐嶆鐐瑰嚮鈥滃紑濮?缁х画杩佺Щ鈥濓紝宸ュ叿鍙細琛ラ綈缂哄け鏁版嵁锛屼笉浼氳鐩栧凡瀛樺湪鐨勬暟鎹€俙;
  log("鉂?鏁伴噺楠岃瘉鏈€氳繃锛屽彲瀹夊叏鍦板啀娆℃墽琛岃縼绉汇€?");
  return false;
}

async function migrate() {
  if (running) return;
  running = true;
  btn.disabled = true;
  verifyBtn.disabled = true;
  resetStats();
  logEl.textContent = "";
  try {
    const source = await readSource();
    log(`婧愭暟鎹細妗屼綅 ${stats.tables.source}銆侀绾?${stats.bookings.source}銆佸垎缁?${stats.groups.source}銆佸鎴?${stats.customers.source}銆佽处鍗?${stats.records.source}銆佷粯娆?${stats.payments.source}`);

    await migrateEntityArray(source.tables, "tables", "table", "tables", "shop/main.tables");
    await migrateEntityArray(source.bookings, "bookings", "booking", "bookings", "shop/main.bookings");
    await migrateEntityArray(source.groups, "groups", "group", "groups", "shop/main.groups");

    for (const [id, value] of Object.entries(source.customersMap)) {
      await createOnly(
        doc(db, "customers", String(id)),
        {...(value || {}), ...entityMetadata(value, String(id), "shop/main.customers")},
        "customers"
      );
    }

    await migrateRecords(source.records);
    await verifyMigration(source);
  } catch (error) {
    statusEl.textContent = "鉂?杩佺Щ鍙戠敓閿欒";
    resultCard.hidden = false;
    resultCard.className = "card error";
    resultCard.textContent = `澶辫触锛?{error?.message || error}`;
    log(`鉂?澶辫触锛?{error?.message || error}`);
    console.error(error);
  } finally {
    running = false;
    btn.disabled = false;
    verifyBtn.disabled = false;
  }
}

async function verifyOnly() {
  if (running) return;
  running = true;
  btn.disabled = true;
  verifyBtn.disabled = true;
  resetStats();
  logEl.textContent = "";
  try {
    const source = await readSource();
    await verifyMigration(source);
    const marker = await getDoc(doc(db, "settings", "migration_v4"));
    if (marker.exists()) log(`杩佺Щ鏍囪褰撳墠鐘舵€侊細${marker.data()?.status || "鏈煡"}`);
  } catch (error) {
    statusEl.textContent = "鉂?妫€鏌ュけ璐?;
    log(`鉂?妫€鏌ュけ璐ワ細${error?.message || error}`);
  } finally {
    running = false;
    btn.disabled = false;
    verifyBtn.disabled = false;
  }
}

btn.addEventListener("click", () => {
  if (confirm("璇风‘璁ゆ墍鏈夋棫椤甸潰宸插叧闂笖褰撳墠鏆傚仠钀ヤ笟銆傚紑濮嬫垨缁х画 v4 鏁版嵁杩佺Щ锛?)) migrate();
});
verifyBtn.addEventListener("click", verifyOnly);
renderStats();
