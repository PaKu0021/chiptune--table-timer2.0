import { db } from "./firebase.js?v=4.0.7";
import { doc, getDoc, getDocs, collection, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const logEl=document.getElementById("log");
const btn=document.getElementById("migrateBtn");
const log=(m)=>{ logEl.textContent += `${new Date().toLocaleTimeString()} ${m}\n`; logEl.scrollTop=logEl.scrollHeight; };
const itemId=(v,i,prefix)=>String(v?.id||v?.bookingId||v?.groupId||`${prefix}_${i}`);

async function migrate(){
  btn.disabled=true;
  try{
    log("璇诲彇鏃?shop/main鈥?);
    const mainRef=doc(db,"shop","main");
    const snap=await getDoc(mainRef);
    if(!snap.exists()) throw new Error("鎵句笉鍒?shop/main");
    const state=snap.data();
    let count=0;
    for(let i=0;i<(state.tables||[]).length;i++){
      const id=`table_${String(i+1).padStart(2,"0")}`;
      await setDoc(doc(db,"shops","main","tables",id),{...(state.tables[i]||{}),id,tableIndex:i,version:Number(state.tables[i]?._entitySync?.version||1),deleted:false,updatedAt:serverTimestamp(),migratedFrom:"shop/main"},{merge:true}); count++;
    }
    for(const [key,col,prefix] of [["bookings","bookings","booking"],["groups","groups","group"]]){
      for(let i=0;i<(state[key]||[]).length;i++){
        const value=state[key][i]||{}; const id=itemId(value,i,prefix);
        await setDoc(doc(db,"shops","main",col,id),{...value,id,version:Number(value?._entitySync?.version||1),deleted:false,updatedAt:serverTimestamp(),migratedFrom:"shop/main"},{merge:true}); count++;
      }
    }
    for(const [id,value] of Object.entries(state.customers||{})){
      await setDoc(doc(db,"shops","main","customers",String(id)),{...(value||{}),id:String(id),version:Number(value?._entitySync?.version||1),deleted:false,updatedAt:serverTimestamp(),migratedFrom:"shop/main"},{merge:true}); count++;
    }
    await setDoc(doc(db,"shops","main"),{schemaVersion:3,migratedAt:serverTimestamp(),legacyMainPath:"shop/main"},{merge:true});
    log(`鐘舵€佸疄浣撳畬鎴愶細${count} 椤广€傝鍙?records鈥);
    const recordsSnap=await getDocs(collection(db,"records"));
    let rc=0,pc=0;
    for(const rs of recordsSnap.docs){
      const record=rs.data(); const recordId=String(record.id||rs.id);
      const {payments=[],...meta}=record;
      await setDoc(doc(db,"shops","main","records",recordId),{...meta,id:recordId,version:Number(record?._recordSync?.version||1),deleted:false,updatedAt:serverTimestamp(),migratedFrom:"records"},{merge:true}); rc++;
      for(let i=0;i<payments.length;i++){
        const payment=payments[i]||{}; const pid=String(payment.id||payment.paymentId||`${recordId}_payment_${i}_${Number(payment.createdAt||0)}`);
        await setDoc(doc(db,"shops","main","records",recordId,"payments",pid),{...payment,id:pid,paymentId:pid,status:payment.status||"active",updatedAt:serverTimestamp(),migratedFrom:"records.payments"},{merge:true}); pc++;
      }
    }
    log(`璐﹀崟 ${rc} 寮犮€佷粯娆炬祦姘?${pc} 鏉¤縼绉诲畬鎴愩€俙);
    log("杩佺Щ鎴愬姛銆備繚鐣欐棫鏁版嵁浣滀负鍏煎瑙嗗浘锛岃涓嶈绔嬪嵆鍒犻櫎 shop/main 鎴?records銆?");
  }catch(err){ log(`澶辫触锛?{err?.message||err}`); console.error(err); }
  finally{ btn.disabled=false; }
}
btn.addEventListener("click",()=>{ if(confirm("璇风‘璁よ惀涓氬凡鏆傚仠銆佹墍鏈夎澶囧凡鍏抽棴鏃ч〉闈紝骞跺凡澶囦唤 Firestore銆傜户缁縼绉伙紵")) migrate(); });
