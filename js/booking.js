import { db } from "./firebase.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

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
  const box = document.getElementById("bookingGrid");
  const slots = getSlots();

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
            onpointerenter="moveSelectSlot(event,${tableIndex},${rowIndex})"
            onpointerup="endSelectSlot(event)"
          ></div>
        `).join("")}
      `).join("")}
    </div>
  `;

  drawExistingBookings();
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
    date: document.getElementById("bookingDate").value,
    name,
    phone,
    tableIndexes:[selection.tableIndex],
    startTime: slots[start],
    endTime: slots[end] || `${CLOSE_HOUR}:00`,
    checkedIn:false,
    checkInTime:null,
    checkInTimeText:""
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

window.renderBookingGrid = renderBookingGrid;
window.startSelectSlot = startSelectSlot;
window.moveSelectSlot = moveSelectSlot;
window.endSelectSlot = endSelectSlot;
window.confirmGridBooking = confirmGridBooking;
window.closeBookingModal = closeBookingModal;
