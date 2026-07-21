import { db } from "./firebase.js";
import { doc, getDoc, getDocs, collection, setDoc, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const logEl=document.getElementById("log");
const btn=document.getElementById("migrateBtn");
const log=m=>{ logEl.textContent += `${new Date().toLocaleTimeString()} ${m}\n`; logEl.scrollTop=logEl.scrollHeight; };
const itemId=(v,i,prefix)=>String(v?.id||v?.bookingId||v?.groupId||`${prefix}_${i}`);

async function commitChunks(writes){
  for(let i=0;i<writes.length;i+=400){
    const batch=writeBatch(db);
    for(const [ref,data,options] of writes.slice(i,i+400)) batch.set(ref,data,options||{merge:true});
    await batch.commit();
  }
}

async function migrate(){
  btn.disabled=true;
  try{
    log("读取兼容状态 shop/main…");
    const mainRef=doc(db,"shop","main");
    const snap=await getDoc(mainRef);
    if(!snap.exists()) throw new Error("找不到 shop/main，无法自动补齐实体数据");
    const state=snap.data();
    const writes=[];
    for(let i=0;i<(state.tables||[]).length;i++){
      const value=state.tables[i]||{};
      const id=`table_${String(i+1).padStart(2,"0")}`;
      writes.push([doc(db,"tables",id),{...value,id,tableIndex:i,version:Math.max(1,Number(value.version||value?._entitySync?.version||0)),deleted:false,updatedAt:serverTimestamp(),updatedBy:"migration-v4",migratedFrom:"shop/main"},{merge:true}]);
    }
    for(const [key,col,prefix] of [["bookings","bookings","booking"],["groups","groups","group"]]){
      for(let i=0;i<(state[key]||[]).length;i++){
        const value=state[key][i]||{}; const id=itemId(value,i,prefix);
        writes.push([doc(db,col,id),{...value,id,version:Math.max(1,Number(value.version||value?._entitySync?.version||0)),deleted:false,updatedAt:serverTimestamp(),updatedBy:"migration-v4",migratedFrom:"shop/main"},{merge:true}]);
      }
    }
    const customers=Array.isArray(state.customers)
      ? Object.fromEntries(state.customers.map((v,i)=>[String(v?.id||`customer_${i}`),v]))
      : (state.customers||{});
    for(const [id,value] of Object.entries(customers)){
      writes.push([doc(db,"customers",String(id)),{...(value||{}),id:String(id),version:Math.max(1,Number(value?.version||value?._entitySync?.version||0)),deleted:false,updatedAt:serverTimestamp(),updatedBy:"migration-v4",migratedFrom:"shop/main"},{merge:true}]);
    }
    await commitChunks(writes);
    log(`桌位、预约、分组、客户共补齐 ${writes.length} 个实体文档。`);

    const recordsSnap=await getDocs(collection(db,"records"));
    let rc=0,pc=0;
    for(const rs of recordsSnap.docs){
      if(rs.id==="init") continue;
      const record=rs.data()||{}; const recordId=String(record.id||rs.id);
      const payments=Array.isArray(record.payments)?record.payments:[];
      await setDoc(doc(db,"records",recordId),{id:recordId,version:Math.max(1,Number(record.version||record?._recordSync?.version||0)),deleted:Boolean(record.deleted),updatedAt:serverTimestamp(),updatedBy:"migration-v4",paymentSchemaVersion:2,paymentsMigrated:true},{merge:true});
      rc++;
      const paymentWrites=[];
      for(let i=0;i<payments.length;i++){
        const payment=payments[i]||{};
        const pid=String(payment.id||payment.paymentId||`${recordId}_legacy_${i}_${Number(payment.createdAt||payment.localCreatedAt||0)}`);
        paymentWrites.push([doc(db,"records",recordId,"payments",pid),{...payment,id:pid,paymentId:pid,recordId,status:payment.status||"active",createdAt:payment.createdAt||serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:"migration-v4",migratedFrom:"records.payments"},{merge:true}]);
      }
      await commitChunks(paymentWrites); pc+=paymentWrites.length;
    }
    await setDoc(mainRef,{schemaVersion:4,entitySyncEnabled:true,migratedAt:serverTimestamp(),migrationVersion:"4.0.0"},{merge:true});
    log(`账单 ${rc} 张，付款流水 ${pc} 条。`);
    log("v4 数据补齐完成。旧字段未删除，可随时回退。请关闭本页并清除其他设备网页缓存。 ");
  }catch(err){ log(`失败：${err?.message||err}`); console.error(err); }
  finally{ btn.disabled=false; }
}
btn.addEventListener("click",()=>{ if(confirm("请确认所有旧页面已关闭且当前暂停营业。开始 v4 数据补齐？")) migrate(); });
