import { db } from "./firebase.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const ref = doc(db, "shop", "main");
let state = null;
let activeBookingId = null;


onSnapshot(ref, snap=>{
  if(!snap.exists()) return;

  state = snap.data();

  if(!state.bookings) state.bookings = [];

  if(!Array.isArray(state.tables) || state.tables.length === 0){
    state.tables = Array.from({length:12},(_,i)=>({
      name:(i+1)+"号桌"
    }));
  }

  currentBookingDate = getTodayDate();

  try{
    renderList();
    renderBookingGrid();
  }catch(e){
    alert("预约页面错误：" + e.message);
  }
});



function save(){
  setDoc(ref,state);
}

let currentBookingDate = getTodayDate();


function getTodayDate(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

let selecting = false;
let selection = null;

const OPEN_HOUR = 10;
const CLOSE_HOUR = 22;
const SLOT_MINUTES = 30;

function getSlots(){
  const slots = [];
  for(let h = OPEN_HOUR; h < CLOSE_HOUR; h++){
    slots.push(`${String(h).padStart(2,"0")}:00`);
    slots.push(`${String(h).padStart(2,"0")}:30`);
  }
  return slots;
}

function renderBookingGrid(){
  if(!state) return;

  const box = document.getElementById("bookingGrid");
  if(!box){
    alert("找不到 bookingGrid");
    return;
  }

  if(!Array.isArray(state.tables) || state.tables.length === 0){
    alert("没有桌位数据");
    return;
  }

  const slots = getSlots();

  const title = document.getElementById("bookingDateTitle");
  if(title){
    title.innerText =
      currentBookingDate === getTodayDate()
        ? "今日预约时间表"
        : currentBookingDate + " 预约时间表";
  }

  box.innerHTML = `
    <div class="booking-grid" style="grid-template-columns:80px repeat(${state.tables.length}, 1fr);">
      <div class="grid-head time-head">时间</div>

      ${state.tables.map(t=>`
        <div class="grid-head">${t.name}</div>
      `).join("")}

      ${slots.map((time,rowIndex)=>`
        <div class="time-cell">${time}</div>

        ${state.tables.map((t,tableIndex)=>`
          <div
            class="slot-cell"
            data-table="${tableIndex}"
            data-row="${rowIndex}"
            onpointerdown="startSelectSlot(event,${tableIndex},${rowIndex})"
            onpointermove="moveSelectByPoint(event)"
            onpointerup="endSelectSlot(event)"
            onpointercancel="endSelectSlot(event)"
          ></div>
        `).join("")}
      `).join("")}
    </div>
  `;

  drawExistingBookings();
}

function renderList(){
  const box = document.getElementById("list");
  if(!box) return;

  const bookings = (state.bookings || []).filter(b=>{
    return (b.date || currentBookingDate) === currentBookingDate;
  });

  if(bookings.length === 0){
    box.innerHTML = `<p style="color:#8a8174;">暂无预约</p>`;
    return;
  }

  box.innerHTML = bookings.map(b=>{
    const tables = (b.tableIndexes || [b.tableIndex])
      .filter(v=>v !== undefined && v !== null)
      .map(idx=>state.tables[Number(idx)]?.name)
      .filter(Boolean)
      .join("、");

    return `
      <div class="panel">
        <h3>${b.checkedIn ? "✅ " : ""}${b.name}</h3>
        <p>
          手机：${b.phone}<br>
          时间：${b.startTime || "-"} - ${b.endTime || "-"}<br>
          桌位：${tables || "-"}<br>
          状态：${b.checkedIn ? "已到店" : "未到店"}
        </p>
      </div>
    `;
  }).join("");
}


function startSelectSlot(e,tableIndex,rowIndex){
  e.preventDefault();

  selecting = true;
  selection = {
    tableIndex,
    startRow: rowIndex,
    endRow: rowIndex
  };

  highlightSelection();
}

function moveSelectSlot(e,tableIndex,rowIndex){
  if(!selecting || !selection) return;
  if(tableIndex !== selection.tableIndex) return;

  selection.endRow = rowIndex;
  highlightSelection();
}

function moveSelectByPoint(e){
  if(!selecting || !selection) return;

  const target = document.elementFromPoint(e.clientX, e.clientY);
  if(!target || !target.classList.contains("slot-cell")) return;

  const tableIndex = Number(target.dataset.table);
  const rowIndex = Number(target.dataset.row);

  if(tableIndex !== selection.tableIndex) return;

  selection.endRow = rowIndex;
  highlightSelection();
}

function endSelectSlot(e){
  if(!selecting || !selection) return;

  selecting = false;

  const start = Math.min(selection.startRow, selection.endRow);
  const end = Math.max(selection.startRow, selection.endRow) + 1;
  const slots = getSlots();

  const startTime = slots[start];
  const endTime = slots[end] || `${CLOSE_HOUR}:00`;

  document.getElementById("selectedRangeText").innerText =
    `${state.tables[selection.tableIndex].name}｜${startTime} - ${endTime}`;

  document.getElementById("bookingModalBg").style.display = "block";
}

function highlightSelection(){
  document.querySelectorAll(".slot-cell.selecting").forEach(el=>{
    el.classList.remove("selecting");
  });

  if(!selection) return;

  const start = Math.min(selection.startRow, selection.endRow);
  const end = Math.max(selection.startRow, selection.endRow);

  document.querySelectorAll(".slot-cell").forEach(el=>{
    const table = Number(el.dataset.table);
    const row = Number(el.dataset.row);

    if(table === selection.tableIndex && row >= start && row <= end){
      el.classList.add("selecting");
    }
  });
}

function confirmGridBooking(){
  if(!selection) return;

  const name = document.getElementById("modalName").value.trim();
  const phone = document.getElementById("modalPhone").value.trim();

  if(!name || !phone){
    alert("请填写姓名和手机号");
    return;
  }

  const slots = getSlots();
  const start = Math.min(selection.startRow, selection.endRow);
  const end = Math.max(selection.startRow, selection.endRow) + 1;

  const booking = {
    id: Date.now(),
    date: currentBookingDate,
    name,
    phone,
    tableIndexes:[selection.tableIndex],
    startTime: slots[start],
    endTime: slots[end] || `${CLOSE_HOUR}:00`,
    checkedIn:false,
    checkInTime:null,
    checkInTimeText:"",
    cancelled:false,
  };

  state.bookings.push(booking);

  save();

  closeBookingModal();
  render();
}

function closeBookingModal(){
  document.getElementById("bookingModalBg").style.display = "none";
  document.getElementById("modalName").value = "";
  document.getElementById("modalPhone").value = "";
  selection = null;
}

function openDatePicker(){
  document.getElementById("datePickerInput").value = currentBookingDate;
  document.getElementById("datePickerModalBg").style.display = "block";
}

function closeDatePicker(){
  document.getElementById("datePickerModalBg").style.display = "none";
}

function confirmDatePicker(){
  const v = document.getElementById("datePickerInput").value;

  if(!v){
    alert("请选择日期");
    return;
  }

  currentBookingDate = v;
  closeDatePicker();
  renderBookingGrid();
  renderList();
}

function drawExistingBookings(){
  document.querySelectorAll(".slot-cell.booked").forEach(el=>{
    el.classList.remove("booked");
    el.innerHTML = "";
    el.onclick = null;
  });

  const slots = getSlots();

  const dayBookings = (state.bookings || []).filter(b=>{
    return (b.date || currentBookingDate) === currentBookingDate;
  });

  dayBookings.forEach(b=>{
    const tableIndexes = (b.tableIndexes || [b.tableIndex])
      .filter(v=>v !== undefined && v !== null)
      .map(Number);

    const startRow = slots.indexOf(b.startTime);
    const endRow = slots.indexOf(b.endTime);

    if(startRow < 0) return;

    const realEndRow = endRow > startRow ? endRow : startRow + 1;

    tableIndexes.forEach(tableIndex=>{
      for(let rowIndex=startRow; rowIndex<realEndRow; rowIndex++){
        const cell = document.querySelector(
          `.slot-cell[data-table="${tableIndex}"][data-row="${rowIndex}"]`
        );

        if(!cell) continue;

        cell.classList.add("booked");

        if(rowIndex === startRow){
          cell.innerHTML = b.checkedIn ? `✅ ${b.name}` : b.name;
        }

        cell.onclick = ()=>{
          openBookingAction(b.id);
        };
      }
    });
  });
}

function getBookingById(id){
  return state.bookings.find(b=>Number(b.id) === Number(id));
}

function openBookingAction(id){
  const b = getBookingById(id);
  if(!b) return;

  activeBookingId = id;

  const tables = (b.tableIndexes || [b.tableIndex])
    .filter(v=>v !== undefined && v !== null)
    .map(idx=>state.tables[Number(idx)]?.name)
    .filter(Boolean)
    .join("、");

  document.getElementById("bookingActionInfo").innerHTML = `
    客人：${b.name}<br>
    手机：${b.phone}<br>
    时间：${b.startTime} - ${b.endTime}<br>
    桌位：${tables || "-"}<br>
    状态：${b.checkedIn ? "已到店" : "未到店"}
  `;

  document.getElementById("bookingActionModalBg").style.display = "block";
}

function closeBookingAction(){
  document.getElementById("bookingActionModalBg").style.display = "none";
  activeBookingId = null;
}

function checkInBooking(){
  const b = getBookingById(activeBookingId);
  if(!b) return;

  if(b.checkedIn){
    alert("这个预约已经到店了");
    return;
  }

  const indexes = (b.tableIndexes || [b.tableIndex])
    .filter(v=>v !== undefined && v !== null)
    .map(Number);

  const busy = indexes.filter(idx=>state.tables[idx]?.start);

  if(busy.length){
    alert("以下桌位正在使用中，不能直接到店：\n" + busy.map(i=>state.tables[i].name).join("、"));
    return;
  }

  const now = Date.now();

  indexes.forEach(idx=>{
    const t = state.tables[idx];
    if(!t) return;

    t.type = "booking";
    t.customer = {
      name:b.name,
      phoneLast4:String(b.phone || "").slice(-4)
    };
    t.start = now;
    t.pausedAt = null;
    t.alerted = false;
    t.alerting = false;
    t.lastAction = "start";
  });

  b.checkedIn = true;
  b.checkInTime = now;
  b.checkInTimeText = new Date(now).toLocaleString();

  save();
  closeBookingAction();
  render();
  renderBookingGrid();
}

function cancelBooking(){
  const b = getBookingById(activeBookingId);
  if(!b) return;

  if(!confirm("确定取消这个预约吗？")) return;

  const indexes = (b.tableIndexes || [b.tableIndex])
    .filter(v=>v !== undefined && v !== null)
    .map(Number);

  indexes.forEach(idx=>{
    const t = state.tables[idx];
    if(!t) return;

    if(
      !t.start &&
      t.type === "booking" &&
      t.customer?.name === b.name &&
      t.customer?.phoneLast4 === String(b.phone || "").slice(-4)
    ){
      t.type = "";
      t.customer = {name:"", phoneLast4:""};
    }
  });

  state.bookings = state.bookings.filter(x=>Number(x.id) !== Number(b.id));

  save();
  closeBookingAction();
  render();
  renderBookingGrid();
}

function openChangeBookingTable(){
  const b = getBookingById(activeBookingId);
  if(!b) return;

  if(b.checkedIn){
    alert("已到店的预约不能更换桌位");
    return;
  }

  const input = prompt("请输入新桌号，例如 1 或 1,2：");
  if(!input) return;

  const newIndexes = input
    .split(",")
    .map(v=>Number(v.trim()) - 1)
    .filter(v=>!isNaN(v) && v >= 0 && v < state.tables.length);

  if(!newIndexes.length){
    alert("桌号不正确");
    return;
  }

  const busy = newIndexes.filter(idx=>state.tables[idx]?.start);
  if(busy.length){
    alert("以下桌位正在使用中：\n" + busy.map(i=>state.tables[i].name).join("、"));
    return;
  }

  const oldIndexes = (b.tableIndexes || [b.tableIndex])
    .filter(v=>v !== undefined && v !== null)
    .map(Number);

  oldIndexes.forEach(idx=>{
    const t = state.tables[idx];
    if(!t || t.start) return;

    if(
      t.type === "booking" &&
      t.customer?.name === b.name &&
      t.customer?.phoneLast4 === String(b.phone || "").slice(-4)
    ){
      t.type = "";
      t.customer = {name:"", phoneLast4:""};
    }
  });

  newIndexes.forEach(idx=>{
    const t = state.tables[idx];
    if(!t) return;

    t.type = "booking";
    t.customer = {
      name:b.name,
      phoneLast4:String(b.phone || "").slice(-4)
    };
  });

  b.tableIndexes = newIndexes;
  delete b.tableIndex;

  save();
  closeBookingAction();
  render();
  renderBookingGrid();
}

window.openDatePicker = openDatePicker;
window.closeDatePicker = closeDatePicker;
window.confirmDatePicker = confirmDatePicker;
window.renderBookingGrid = renderBookingGrid;
window.startSelectSlot = startSelectSlot;
window.moveSelectSlot = moveSelectSlot;
window.endSelectSlot = endSelectSlot;
window.confirmGridBooking = confirmGridBooking;
window.closeBookingModal = closeBookingModal;
window.moveSelectByPoint = moveSelectByPoint;
window.openBookingAction = openBookingAction;
window.closeBookingAction = closeBookingAction;
window.checkInBooking = checkInBooking;
window.cancelBooking = cancelBooking;
window.openChangeBookingTable = openChangeBookingTable;