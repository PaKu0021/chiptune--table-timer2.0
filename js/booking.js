import { db } from "./firebase.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const ref = doc(db, "shop", "main");

let state = null;

onSnapshot(ref, snap=>{
  if(!snap.exists()) return;
  state = snap.data();
  render();
});

function save(){
  setDoc(ref, state);
}

function render(){
  renderTableOptions();
  renderList();
}

function renderTableOptions(){
  const sel = document.getElementById("tableSelect");
  sel.innerHTML = "";

  state.tables.forEach((t,i)=>{
    let opt = document.createElement("option");
    opt.value = i;
    opt.innerText = t.name;
    sel.appendChild(opt);
  });
}

function createBooking(){
  const name = document.getElementById("name").value;
  const phone = document.getElementById("phone").value;
  const time = document.getElementById("time").value;
  const tableIndexes = [...document.querySelectorAll(".table-check:checked")]
  .map(el => Number(el.value));

  if(!name || !phone){
    alert("请填写完整信息");
    return;
  }

  if(!state.bookings) state.bookings = [];

  state.bookings.push({
    id: Date.now(),
    name,
    phone,
    time,
    tableIndexes
  });

  // 👉 同步到桌位（标记为预约）
  tableIndexes.forEach(idx=>{
  let t = state.tables[idx];
  t.type = "booking";
  t.customer.name = name;
  t.customer.phoneLast4 = phone.slice(-4);
});

  save();
}

function renderList(){
  const box = document.getElementById("list");
  box.innerHTML = "";

  if(!state.bookings) return;

  state.bookings.forEach((b,i)=>{
    let div = document.createElement("div");

    div.innerHTML = `
 <div style="border:1px solid #ccc;padding:10px;margin:5px;border-radius:12px;background:${b.checkedIn ? "#e9f7ed" : "#fff"}">
  <b>${b.checkedIn ? "✅ " : ""}${b.name}</b> (${b.phone})
  <br>时间：${b.time}
  <br>桌位：桌位：${(b.tableIndexes || [b.tableIndex])
  .map(idx => state.tables[idx]?.name)
  .filter(Boolean)
  .join("、")}
  <br>状态：${b.checkedIn ? "已入桌" : "未入桌"}
  ${b.checkInTimeText ? `<br>开始时间：${b.checkInTimeText}` : ""}

  <br>
  <select onchange="changeTable(${i},this.value)" ${b.checkedIn ? "disabled" : ""}>
    ${state.tables.map((t,idx)=>`
      <option value="${idx}" ${idx===b.tableIndex?"selected":""}>
        ${t.name}
      </option>
    `).join("")}
  </select>

  <button onclick="deleteBooking(${i})">删除</button>
</div>
    `;

    box.appendChild(div);
  });
}

function changeTable(i,newIndex){
  let b = state.bookings[i];

  // 清旧桌
  let oldTable = state.tables[b.tableIndex];
  oldTable.type = "";
  oldTable.customer = {name:"",phoneLast4:""};

  // 新桌
  let newTable = state.tables[newIndex];
  newTable.type = "booking";
  newTable.customer.name = b.name;
  newTable.customer.phoneLast4 = b.phone.slice(-4);

  b.tableIndex = Number(newIndex);

  save();
}

function deleteBooking(i){
  let b = state.bookings[i];

  let t = state.tables[b.tableIndex];
  t.type = "";
  t.customer = {name:"",phoneLast4:""};

  state.bookings.splice(i,1);
  save();
}

window.createBooking = createBooking;
window.changeTable = changeTable;
window.deleteBooking = deleteBooking;
