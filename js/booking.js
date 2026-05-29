import { db } from "./firebase.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const ref = doc(db, "shop", "main");
let state = null;

onSnapshot(ref, snap => {
  if (!snap.exists()) return;
  state = snap.data();

  if (!state.bookings) state.bookings = [];
  if (!state.tables) state.tables = [];

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
  const box = document.getElementById("tableChecks");
  box.innerHTML = "";
  box.className = "table-grid";

  state.tables.forEach((t,i)=>{
    const label = document.createElement("label");
    label.className = "table-item";

    const tableNumber = t.name.replace("号桌","");

    label.innerHTML = `
      <input type="checkbox" class="table-check" value="${i}">
      <span class="num">${tableNumber}</span>
      <span class="sub">号桌</span>
    `;

    box.appendChild(label);
  });
}

function createBooking(){
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const time = document.getElementById("time").value.trim();

  const tableIndexes = [...document.querySelectorAll(".table-check:checked")]
    .map(el => Number(el.value));

  if(!name || !phone){
    alert("请填写姓名和手机号");
    return;
  }

  if(tableIndexes.length === 0){
    alert("请选择至少一张桌");
    return;
  }

  const booking = {
    id: Date.now(),
    name,
    phone,
    time,
    tableIndexes,
    checkedIn:false,
    checkInTime:null,
    checkInTimeText:""
  };

  state.bookings.push(booking);

  tableIndexes.forEach(idx=>{
    const t = state.tables[idx];
    if(!t) return;

    t.type = "booking";
    t.customer = {
      name,
      phoneLast4: phone.slice(-4)
    };
  });

  save();

  document.getElementById("name").value = "";
  document.getElementById("phone").value = "";
  document.getElementById("time").value = "";
}

function renderList(){
  const box = document.getElementById("list");
  box.innerHTML = "";

  if(!state.bookings.length){
    box.innerHTML = `<p style="color:#8a8174;">暂无预约</p>`;
    return;
  }

  state.bookings.forEach((b,i)=>{
    const tableIndexes = b.tableIndexes || [b.tableIndex];

    const div = document.createElement("div");
    div.className = "panel";
    div.style.background = b.checkedIn ? "#e9f7ed" : "#fffaf2";

    div.innerHTML = `
      <h3>${b.checkedIn ? "✅ " : ""}${b.name}</h3>
      <p>
        手机：${b.phone}<br>
        到店时间：${b.time || "-"}<br>
        当前桌位：${tableIndexes.map(idx=>state.tables[idx]?.name).filter(Boolean).join("、") || "-"}<br>
        状态：${b.checkedIn ? "已入桌" : "未入桌"}
        ${b.checkInTimeText ? `<br>开始时间：${b.checkInTimeText}` : ""}
      </p>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(100px,1fr));">
        ${state.tables.map((t,idx)=>`
          <label style="display:flex;gap:6px;align-items:center;">
            <input 
              type="checkbox" 
              class="edit-table-${i}" 
              value="${idx}"
              ${tableIndexes.map(Number).includes(idx) ? "checked" : ""}
              ${b.checkedIn ? "disabled" : ""}
            >
            ${t.name}
          </label>
        `).join("")}
      </div>

      <div class="action-row">
        <button class="btn-main" onclick="changeBookingTables(${i})" ${b.checkedIn ? "disabled" : ""}>
          保存桌位修改
        </button>
        <button class="btn-danger" onclick="deleteBooking(${i})">
          删除预约
        </button>
      </div>
    `;

    box.appendChild(div);
  });
}

function changeBookingTables(i){
  const b = state.bookings[i];
  if(!b || b.checkedIn) return;

  const oldIndexes = (b.tableIndexes || [b.tableIndex])
    .filter(v => v !== undefined && v !== null)
    .map(Number);

  const newIndexes = [...document.querySelectorAll(`.edit-table-${i}:checked`)]
    .map(el => Number(el.value));

  if(newIndexes.length === 0){
    alert("至少选择一张桌");
    return;
  }

  oldIndexes.forEach(idx=>{
    const t = state.tables[idx];
    if(!t) return;

    if(
      !t.start &&
      t.type === "booking" &&
      t.customer?.name === b.name &&
      t.customer?.phoneLast4 === b.phone.slice(-4)
    ){
      t.type = "";
      t.customer = {name:"", phoneLast4:""};
    }
  });

  newIndexes.forEach(idx=>{
    const t = state.tables[idx];
    if(!t) return;

    if(t.start){
      alert(`${t.name} 正在使用中，不能分配预约`);
      return;
    }

    t.type = "booking";
    t.customer = {
      name: b.name,
      phoneLast4: b.phone.slice(-4)
    };
  });

  b.tableIndexes = newIndexes;
  delete b.tableIndex;

  save();
}

function deleteBooking(i){
  const b = state.bookings[i];
  if(!b) return;

  if(!confirm("确定删除这个预约吗？")) return;

  const tableIndexes = (b.tableIndexes || [b.tableIndex])
    .filter(v => v !== undefined && v !== null)
    .map(Number);

  tableIndexes.forEach(idx=>{
    const t = state.tables[idx];
    if(!t) return;

    if(
      !t.start &&
      t.type === "booking" &&
      t.customer?.name === b.name &&
      t.customer?.phoneLast4 === b.phone.slice(-4)
    ){
      t.type = "";
      t.customer = {name:"", phoneLast4:""};
    }
  });

  state.bookings.splice(i,1);
  save();
}

window.createBooking = createBooking;
window.changeBookingTables = changeBookingTables;
window.deleteBooking = deleteBooking;
