import { db } from "./firebase.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const ref = doc(db, "shop", "main");

function getTodayDate(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

const params = new URLSearchParams(location.search);
const printDate = params.get("date") || getTodayDate();

const SLOT_MINUTES = 30;

function getSlots(hours){
  const slots = [];
  for(let h = hours.open; h < hours.close; h++){
    slots.push(`${String(h).padStart(2,"0")}:00`);
    slots.push(`${String(h).padStart(2,"0")}:30`);
  }
  return slots;
}

function getBusinessHours(state){
  const h = state.businessHours || {
    weekdayOpen:12,
    weekdayClose:22,
    weekendOpen:10,
    weekendClose:22
  };

  const d = new Date(printDate);
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;

  return {
    open: isWeekend ? Number(h.weekendOpen || 10) : Number(h.weekdayOpen || 12),
    close: isWeekend ? Number(h.weekendClose || 22) : Number(h.weekdayClose || 22)
  };
}

onSnapshot(ref, snap=>{
  if(!snap.exists()) return;

  const state = snap.data();
  const tables = state.tables || [];
  const bookings = (state.bookings || []).filter(b=>b.date === printDate);
  const slots = getSlots(getBusinessHours(state));

  document.getElementById("printTitle").innerText = `${printDate} 预约时间表`;

  let html = `
    <table class="print-booking-table">
      <thead>
        <tr>
          <th>时间</th>
          ${tables.map(t=>`<th>${t.name}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
  `;

  slots.forEach((time,rowIndex)=>{
    html += `<tr><td class="print-time">${time}</td>`;

    tables.forEach((t,tableIndex)=>{
      const booking = bookings.find(b=>{
        const tableIndexes = (b.tableIndexes || [b.tableIndex]).map(Number);
        const startRow = slots.indexOf(b.startTime);
        const endRow = slots.indexOf(b.endTime);
        const realEndRow = endRow > startRow ? endRow : startRow + 1;

        return tableIndexes.includes(tableIndex) &&
               rowIndex >= startRow &&
               rowIndex < realEndRow;
      });

      html += `
        <td class="${booking ? (booking.checkedIn ? "print-checked" : "print-booked") : ""}">
          ${booking && slots.indexOf(booking.startTime) === rowIndex ? booking.name || "" : ""}
        </td>
      `;
    });

    html += `</tr>`;
  });

  html += `</tbody></table>`;

  document.getElementById("printGrid").innerHTML = html;
});