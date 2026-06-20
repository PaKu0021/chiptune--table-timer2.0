import { db } from "./firebase.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { resetTable } from "./common.js";


const ref = doc(db, "shop", "main");
let state = null;
let activeBookingId = null;
let bookingLocked = true;
let currentBookingDate = getTodayDate();
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();
let selectedCalendarDate = currentBookingDate;
let bookingListOpen = false;

const BOOKING_COLORS = [
  "#B7E4C7",
  "#A9DEF9",
  "#FFD6A5",
  "#D8B4FE",
  "#FFCAD4",
  "#FDFFB6",
  "#C7F9CC",
  "#FEC5BB",
  "#BDE0FE",
  "#E9C46A",
  "#CDEAC0",
  "#F1C0E8"
];

function getNextBookingColor(){
  const count = (state.bookings || []).length;
  return BOOKING_COLORS[count % BOOKING_COLORS.length];
}

function darkenColor(hex, amount = 28){
  hex = String(hex || "#B7E4C7").replace("#","");
  const num = parseInt(hex,16);

  let r = (num >> 16) - amount;
  let g = ((num >> 8) & 255) - amount;
  let b = (num & 255) - amount;

  r = Math.max(0,r);
  g = Math.max(0,g);
  b = Math.max(0,b);

  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b)
    .toString(16)
    .slice(1);
}

function getRunningColor(t){
  return t.activeColor || "#B7E4C7";
}

onSnapshot(ref, snap=>{
  if(!snap.exists()) return;

  state = snap.data();

  if(!state.bookings) state.bookings = [];

  if(!Array.isArray(state.tables) || state.tables.length === 0){
    state.tables = Array.from({length:12},(_,i)=>({
      name:(i+1)+"号桌"
    }));
  }

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


function getTodayDate(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

let selecting = false;
let selection = null;

const DEFAULT_BUSINESS_HOURS = {
  weekdayOpen: 12,
  weekdayClose: 22,
  weekendOpen: 10,
  weekendClose: 22
};

const SLOT_MINUTES = 30;

function getBusinessHours(){
  const hours = state.businessHours || DEFAULT_BUSINESS_HOURS;
  const d = new Date(currentBookingDate);
  const day = d.getDay();
  const isWeekend = day === 0 || day === 6;

  return {
    open: isWeekend ? Number(hours.weekendOpen || 10) : Number(hours.weekdayOpen || 12),
    close: isWeekend ? Number(hours.weekendClose || 22) : Number(hours.weekdayClose || 22)
  };
}

function getSlots(){
  const {open, close} = getBusinessHours();
  const slots = [];

  for(let h = open; h < close; h++){
    slots.push(`${String(h).padStart(2,"0")}:00`);
    slots.push(`${String(h).padStart(2,"0")}:30`);
  }

  slots.push(`${String(close).padStart(2,"0")}:00`);

  return slots;
}



function timeToMinutes(time){
  const [h,m] = String(time || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function findPackageIndexByDuration(startTime,endTime){
  const minutes = timeToMinutes(endTime) - timeToMinutes(startTime);

  const index = (state.packages || []).findIndex(p=>{
    return Number(p.minutes || 0) === minutes;
  });

  return index >= 0 ? index : 0;
}


function isTableBusyAtSlot(t, rowIndex){
  if(!t.start) return false;

  const slots = getSlots();
  const slotTime = slots[rowIndex];
  if(!slotTime) return false;

  const [hh, mm] = slotTime.split(":").map(Number);

  const slotDate = new Date(currentBookingDate);
  slotDate.setHours(hh, mm, 0, 0);

  const slotStart = slotDate.getTime();
  const slotEnd = slotStart + SLOT_MINUTES * 60000;

  const p = state.packages?.[t.packageIndex] || {};
  const busyStart = Number(t.start);

  let busyEnd;

  if(p.unlimited || Number(p.minutes || 0) === 0){
    const closeDate = new Date(currentBookingDate);
    closeDate.setHours(getBusinessHours().close, 0, 0, 0);
    busyEnd = closeDate.getTime();
  }else{
    const baseMinutes = Number(p.minutes || 0);
    const extraMinutes = Number(t.extra || 0) / 60000;
    busyEnd = busyStart + (baseMinutes + extraMinutes) * 60000;
  }

  return slotStart < busyEnd && slotEnd > busyStart;
}

function formatShortTime(ms){
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2,"0")}` : `${m}分`;
}

function getTableStatusText(t){
  if(!t.start) return "";

  const p = state.packages?.[t.packageIndex] || {};
  const elapsed = Date.now() - Number(t.start);

  if(p.unlimited || Number(p.minutes || 0) === 0){
    return {
      text:`已用 ${formatShortTime(elapsed)}`,
      className:"slot-running"
    };
  }

  const limit = Number(p.minutes || 0) * 60000 + Number(t.extra || 0);
  const remain = limit - elapsed;

  if(remain <= 0){
    return {
      text:`超时 ${formatShortTime(Math.abs(remain))}`,
      className:"slot-overtime"
    };
  }

  if(remain <= 10 * 60000){
    return {
      text:`剩 ${formatShortTime(remain)}`,
      className:"slot-warning"
    };
  }

  return {
    text:`剩 ${formatShortTime(remain)}`,
    className:"slot-normal"
  };
}


function isTableUsedAtSlot(t,rowIndex){
  if(!t.start) return false;

  const slots = getSlots();
  const slotTime = slots[rowIndex];
  if(!slotTime) return false;

  const [hh,mm] = slotTime.split(":").map(Number);

  const slotDate = new Date(currentBookingDate);
  slotDate.setHours(hh,mm,0,0);

  const slotStart = slotDate.getTime();
  const slotEnd = slotStart + SLOT_MINUTES * 60000;

  const usedStart = Number(t.start);
  const usedEnd = Number(t.pausedAt || Date.now());

  return slotStart < usedEnd && slotEnd > usedStart;
}

function isPastTimeSlot(rowIndex){
  const slots = getSlots();
  const slotTime = slots[rowIndex];
  if(!slotTime) return false;

  const [hh, mm] = slotTime.split(":").map(Number);

  const slotDate = new Date(currentBookingDate);
  slotDate.setHours(hh, mm + SLOT_MINUTES, 0, 0);

  return slotDate.getTime() <= Date.now();
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

      ${state.tables.map((t,tableIndex)=>{
  const usingToday = slots.some((_,rowIndex)=>{
    return isTableBusyAtSlot(t,rowIndex);
  });

  return `
    <div class="grid-head ${usingToday ? "table-using" : ""}">
      ${t.name}${usingToday ? " 使用中" : ""}
    </div>
  `;
}).join("")}

${slots.slice(0,-1).map((time,rowIndex)=>`
        <div class="time-cell ${isPastTimeSlot(rowIndex) ? "past-time-cell" : ""}">
          ${time}
        </div>
        ${state.tables.map((t,tableIndex)=>{

          const busy = isTableBusyAtSlot(t,rowIndex);
          const used = isTableUsedAtSlot(t,rowIndex);
          const statusInfo = busy ? getTableStatusText(t) : null;
return `
  <div
      class="slot-cell ${isPastTimeSlot(rowIndex) ? "past-slot" : ""} ${busy ? "disabled-slot" : ""} ${used ? "used-slot" : ""} ${statusInfo?.className || ""}"
      data-table="${tableIndex}"
      data-row="${rowIndex}"

      ${busy || bookingLocked ? "" : `
  onpointerdown="startSelectSlot(event,${tableIndex},${rowIndex})"
  onpointermove="moveSelectByPoint(event)"
  onpointerup="endSelectSlot(event)"
  onpointercancel="endSelectSlot(event)"
`}

    >
</div>
  `;
}).join("")}
`).join("")}
    </div>
  `;

  drawExistingBookings();
  drawRunningTables();
  updateBookingLockUI();

}

function updateBookingLockUI(){
  const btn = document.getElementById("bookingLockBtn");
  const hint = document.getElementById("bookingLockHint");
  const grid = document.getElementById("bookingGrid");

  if(btn){
    btn.innerText = bookingLocked ? "🔒 已锁定" : "🔓 已解锁";
    btn.className = bookingLocked ? "btn-danger" : "btn-success";
  }

  if(hint){
    hint.innerText = bookingLocked
      ? "当前为锁定状态，只能查看，不能创建/修改预约"
      : "当前为解锁状态，可以创建/修改预约，操作完成后请重新锁定";

    hint.className = bookingLocked
      ? "booking-lock-hint locked"
      : "booking-lock-hint unlocked";
  }

  if(grid){
    grid.classList.toggle("locked-grid", bookingLocked);
    grid.classList.toggle("unlocked-grid", !bookingLocked);
  }
}

function toggleBookingLock(){
  bookingLocked = !bookingLocked;
  updateBookingLockUI();
  renderBookingGrid();
}

function renderList(){
  const box = document.getElementById("list");
  const summary = document.getElementById("bookingSummary");
  const btn = document.getElementById("bookingListToggleBtn");

  if(!box) return;

  const bookings = (state.bookings || [])
    .filter(b=>(b.date || getTodayDate()) === currentBookingDate)
    .sort((a,b)=>String(a.startTime || "99:99").localeCompare(String(b.startTime || "99:99")));

  const checked = bookings.filter(b=>b.checkedIn).length;
  const waiting = bookings.filter(b=>!b.checkedIn).length;

  const tableTotal = bookings.reduce((sum,b)=>{
    return sum + (b.tableIndexes || [b.tableIndex])
      .filter(v=>v !== undefined && v !== null)
      .length;
  },0);

  if(summary){
    summary.innerHTML =
      `未到店：${waiting}组｜已到店：${checked}组｜预约桌数：${tableTotal}桌`;
  }

  if(btn){
    btn.innerText = bookingListOpen ? "收起" : "展开";
  }

  box.style.display = bookingListOpen ? "block" : "none";

  if(bookings.length === 0){
    box.innerHTML = `<p style="color:#8a8174;">这一天暂无预约</p>`;
    return;
  }

  box.innerHTML = bookings.map(b=>{
    const tables = (b.tableIndexes || [b.tableIndex])
      .filter(v=>v !== undefined && v !== null)
      .map(idx=>state.tables[Number(idx)]?.name)
      .filter(Boolean)
      .join("、");

    return `
      <div class="booking-list-item ${b.checkedIn ? "booking-list-done" : "booking-list-wait"}">
        <div class="booking-list-time">
          ${b.startTime || "-"} - ${b.endTime || "-"}
        </div>

        <div class="booking-list-main">
          <strong>${b.name || "-"}</strong>
          <span>${String(b.phone || "").slice(-4) || "-"}</span>
        </div>

        <div class="booking-list-sub">
          桌位：${tables || "-"}｜${b.checkedIn ? "已到店" : "未到店"}
        </div>

        ${bookingLocked ? "" : `
          <div class="action-row" style="margin-top:10px;">
            <button class="btn-success" onclick="checkInBookingById(${b.id})">到店开始</button>
            <button class="btn-main" onclick="openBookingAction(${b.id})">修改</button>
            <button class="btn-danger" onclick="cancelBookingById(${b.id})">取消</button>
          </div>
        `}
      </div>
    `;
  }).join("");
}

function toggleBookingList(){
  bookingListOpen = !bookingListOpen;
  renderList();
}

function checkInBookingById(id){
  activeBookingId = id;
  checkInBooking();
}

function cancelBookingById(id){
  activeBookingId = id;
  cancelBooking();
}

function startSelectSlot(e,tableIndex,rowIndex){
  if(bookingLocked) return;
  if(isTableBusyAtSlot(state.tables[tableIndex], rowIndex)) return;

  e.preventDefault();

  selecting = true;

  selection = {
    startTableIndex: tableIndex,
    endTableIndex: tableIndex,
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

  selection.endTableIndex = tableIndex;
  selection.endRow = rowIndex;

  highlightSelection();
}


function endSelectSlot(e){
  if(!selecting || !selection) return;

  selecting = false;

  const startRow = Math.min(selection.startRow, selection.endRow);
  const endRow = Math.max(selection.startRow, selection.endRow) + 1;

  const startTable = Math.min(selection.startTableIndex, selection.endTableIndex);
  const endTable = Math.max(selection.startTableIndex, selection.endTableIndex);

  const slots = getSlots();

  const startTime = slots[startRow];
  const endTime = slots[endRow] || `${getBusinessHours().close}:00`;

  const tableNames = [];

  for(let i=startTable; i<=endTable; i++){
    tableNames.push(state.tables[i].name);
  }

  document.getElementById("selectedRangeText").innerText =
    `${tableNames.join("、")}｜${startTime} - ${endTime}`;

  const tip = document.getElementById("selectionTip");
  if(tip) tip.style.display = "none";
  fillModalPackages();

const modalType = document.getElementById("modalType");
if(modalType) modalType.value = "booking";

toggleModalType();

  document.getElementById("bookingModalBg").style.display = "block";
}


function updateSelectionTip(){
  let tip = document.getElementById("selectionTip");

  if(!tip){
    tip = document.createElement("div");
    tip.id = "selectionTip";
    tip.className = "selection-tip";
    document.body.appendChild(tip);
  }

  if(!selection){
    tip.style.display = "none";
    return;
  }

  const startRow = Math.min(selection.startRow, selection.endRow);
  const endRow = Math.max(selection.startRow, selection.endRow) + 1;

  const minutes = (endRow - startRow) * SLOT_MINUTES;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  const durationText =
    hours > 0
      ? `${hours}小时${mins ? mins + "分钟" : ""}`
      : `${mins}分钟`;

  const slots = getSlots();
  const startTime = slots[startRow];
  const endTime = slots[endRow] || `${getBusinessHours().close}:00`;

  const tableCount =
    Math.abs(selection.endTableIndex - selection.startTableIndex) + 1;

  tip.innerHTML =
    `<b>${tableCount}桌｜${durationText}</b><br>${startTime} - ${endTime}`;

  const cell = document.querySelector(
    `.slot-cell[data-table="${selection.endTableIndex}"][data-row="${selection.endRow}"]`
  );

  if(cell){
    const rect = cell.getBoundingClientRect();
    tip.style.left = rect.right + 8 + "px";
    tip.style.top = rect.top + "px";
    tip.style.display = "block";
  }else{
    tip.style.display = "none";
  }
}



function highlightSelection(){
  document.querySelectorAll(".slot-cell.selecting").forEach(el=>{
    el.classList.remove("selecting");
  });

  if(!selection) return;

  const startRow = Math.min(selection.startRow, selection.endRow);
  const endRow = Math.max(selection.startRow, selection.endRow);

  const startTable = Math.min(selection.startTableIndex, selection.endTableIndex);
  const endTable = Math.max(selection.startTableIndex, selection.endTableIndex);

  document.querySelectorAll(".slot-cell").forEach(el=>{
    const table = Number(el.dataset.table);
    const row = Number(el.dataset.row);

    if(
      table >= startTable &&
      table <= endTable &&
      row >= startRow &&
      row <= endRow
    ){
      el.classList.add("selecting");
    }
  });
  updateSelectionTip();
}

function toggleModalType(){
  const type = document.getElementById("modalType")?.value || "booking";
  const packageBox = document.getElementById("modalPackageBox");
  const btn = document.getElementById("modalConfirmBtn");

  if(packageBox){
    packageBox.style.display = type === "walkin" ? "block" : "none";
  }

  if(btn){
    btn.innerText = type === "walkin" ? "开始计时" : "确认预约";
  }
}

function fillModalPackages(){
  const box = document.getElementById("modalPackage");
  if(!box) return;

  box.innerHTML = (state.packages || []).map((p,i)=>`
    <option value="${i}">
      ${p.name}｜${p.unlimited ? "不限时" : p.minutes + "分钟"}｜¥${p.price}
    </option>
  `).join("");
}

function confirmGridBooking(){
  if(!selection) return;

  const type = document.getElementById("modalType")?.value || "booking";
  const name = document.getElementById("modalName").value.trim();
  const phone = document.getElementById("modalPhone").value.trim();

  const slots = getSlots();

  const start = Math.min(selection.startRow, selection.endRow);
  const end = Math.max(selection.startRow, selection.endRow) + 1;

  const startTable = Math.min(selection.startTableIndex, selection.endTableIndex);
  const endTable = Math.max(selection.startTableIndex, selection.endTableIndex);

  const tableIndexes = Array.from(
    { length: endTable - startTable + 1 },
    (_,idx)=>startTable + idx
  );

  const busyTables = tableIndexes.filter(idx=>state.tables[idx]?.start);

  if(busyTables.length){
    alert("以下桌位正在使用中，不能操作：\n" + busyTables.map(i=>state.tables[i].name).join("、"));
    return;
  }

  const startTime = slots[start];
  const endTime = slots[end] || `${getBusinessHours().close}:00`;

  if(type === "walkin"){
    const packageIndex = Number(document.getElementById("modalPackage")?.value || 0);
    const now = Date.now();
    const walkinColor = getNextBookingColor();
    tableIndexes.forEach(idx=>{
      const t = state.tables[idx];
      if(!t) return;

      t.type = "walkin";
      t.activeColor = walkinColor;
      t.bookingId = null;
      t.packageIndex = packageIndex;
      t.pay = "";
      t.currency = "日元";
      t.customer = {
        name,
        phoneLast4:String(phone || "").slice(-4)
      };
      t.start = now;
      t.pausedAt = null;
      t.extra = 0;
      t.alerted = false;
      t.alerting = false;
      t.lastAction = "start";
    });

    save();

    closeBookingModal();
    renderBookingGrid();
    renderList();

    alert("Walk-in 已开始计时");
    return;
  }

  if(!name || !phone){
    alert("请填写姓名和手机号");
    return;
  }

  const packageIndex = findPackageIndexByDuration(startTime,endTime);

  const booking = {
    id: Date.now(),
    date: currentBookingDate,
    color: getNextBookingColor(),
    name,
    phone,
    tableIndexes,
    startTime,
    endTime,
    packageIndex,
    checkedIn:false,
    checkInTime:null,
    checkInTimeText:"",
    cancelled:false,
  };

  state.bookings.push(booking);

  save();

  closeBookingModal();
  renderBookingGrid();
  renderList();
}

function closeBookingModal(){
  document.getElementById("bookingModalBg").style.display = "none";
  document.getElementById("modalName").value = "";
  document.getElementById("modalPhone").value = "";

  document.querySelectorAll(".slot-cell.selecting").forEach(el=>{
    el.classList.remove("selecting");
  });

  selecting = false;
  selection = null;
  const tip = document.getElementById("selectionTip");
if(tip) tip.style.display = "none";
  const modalType = document.getElementById("modalType");
if(modalType) modalType.value = "booking";

const packageBox = document.getElementById("modalPackageBox");
if(packageBox) packageBox.style.display = "none";

const btn = document.getElementById("modalConfirmBtn");
if(btn) btn.innerText = "确认预约";
}

function openDatePicker(){
  const d = new Date(currentBookingDate);
  calendarYear = d.getFullYear();
  calendarMonth = d.getMonth();
  selectedCalendarDate = currentBookingDate;

  document.getElementById("datePickerModalBg").style.display = "block";
  renderCustomCalendar();
}


function getBookingDates(){
  const set = new Set();

  (state.bookings || []).forEach(b=>{
    if(b.date) set.add(b.date);
  });

  return set;
}

function renderCustomCalendar(){
  const box = document.getElementById("calendarGrid");
  const title = document.getElementById("calendarTitle");
  if(!box || !title) return;

  title.innerText = `${calendarYear}年${calendarMonth + 1}月`;

  const bookingDates = getBookingDates();

  const first = new Date(calendarYear, calendarMonth, 1);
  const last = new Date(calendarYear, calendarMonth + 1, 0);
  const startDay = first.getDay();
  const days = last.getDate();

  let html = `
    <div class="cal-week">日</div>
    <div class="cal-week">一</div>
    <div class="cal-week">二</div>
    <div class="cal-week">三</div>
    <div class="cal-week">四</div>
    <div class="cal-week">五</div>
    <div class="cal-week">六</div>
  `;

  for(let i=0;i<startDay;i++){
    html += `<div></div>`;
  }

  for(let d=1; d<=days; d++){
    const dateStr =
      `${calendarYear}-${String(calendarMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

    const hasBooking = bookingDates.has(dateStr);
    const selected = selectedCalendarDate === dateStr;

const today = dateStr === getTodayDate();

html += `
  <button
    class="cal-day ${hasBooking ? "has-booking" : ""} ${selected ? "selected" : ""} ${today ? "today" : ""}"
    onclick="selectCalendarDate('${dateStr}')"
  >
    ${d}
    ${hasBooking ? `<span class="booking-dot"></span>` : ""}
  </button>
`;


  }

  box.innerHTML = html;
}

function selectCalendarDate(dateStr){
  selectedCalendarDate = dateStr;
  renderCustomCalendar();
}

function changeCalendarMonth(step){
  calendarMonth += step;

  if(calendarMonth < 0){
    calendarMonth = 11;
    calendarYear--;
  }

  if(calendarMonth > 11){
    calendarMonth = 0;
    calendarYear++;
  }

  renderCustomCalendar();
}

function closeDatePicker(){
  document.getElementById("datePickerModalBg").style.display = "none";
}

function confirmDatePicker(){
  currentBookingDate = selectedCalendarDate;

  closeDatePicker();
  renderBookingGrid();
  renderList();
}
  


function drawExistingBookings(){
  document.querySelectorAll(".slot-cell.booked, .slot-cell.checked-in-booking").forEach(el=>{
    el.classList.remove("booked","checked-in-booking");
    el.innerHTML = "";
    el.onclick = null;
    el.style.background = "";
    el.style.color = "";
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
    let endRow = slots.indexOf(b.endTime);

    if(startRow < 0) return;

    if(endRow < 0 && b.endTime === `${getBusinessHours().close}:00`){
      endRow = slots.length;
    }

    const realEndRow = endRow > startRow ? endRow : startRow + 1;
    const baseColor = b.color || "#B7E4C7";
    const bgColor = b.checkedIn ? darkenColor(baseColor, 35) : baseColor;

    tableIndexes.forEach(tableIndex=>{
      for(let rowIndex = startRow; rowIndex < realEndRow; rowIndex++){
        const cell = document.querySelector(
          `.slot-cell[data-table="${tableIndex}"][data-row="${rowIndex}"]`
        );

        if(!cell) continue;

        cell.classList.add(b.checkedIn ? "checked-in-booking" : "booked");
        cell.style.background = bgColor;
        cell.style.color = "#332d24";

        cell.onpointerdown = null;
        cell.onpointermove = null;
        cell.onpointerup = null;
        cell.onpointercancel = null;

        cell.onclick = (e)=>{
          e.preventDefault();
          e.stopPropagation();
          if(bookingLocked) return;
          openBookingAction(b.id);
        };

        if(rowIndex === startRow){
          cell.innerHTML = b.checkedIn
            ? ""
             : (b.name || "");
        }        
      }
    });
  });
}















  



function drawRunningTables(){
  document.querySelectorAll(".running-block").forEach(el=>{
    el.remove();
  });

  state.tables.forEach((t,tableIndex)=>{
    if(!t.start) return;

    const slots = getSlots();

    let startRow = -1;
    let endRow = -1;

    for(let row=0; row<slots.length-1; row++){
      if(isTableBusyAtSlot(t,row)){
        if(startRow === -1) startRow = row;
        endRow = row;
      }
    }

    if(startRow === -1) return;

    const bgColor = darkenColor(getRunningColor(t), 35);

    for(let row=startRow; row<=endRow; row++){
      const cell = document.querySelector(
        `.slot-cell[data-table="${tableIndex}"][data-row="${row}"]`
      );

      if(cell){
        cell.style.background = bgColor;
      }
    }

    const middleRow = Math.floor((startRow + endRow) / 2);

const middleCell = document.querySelector(
  `.slot-cell[data-table="${tableIndex}"][data-row="${middleRow}"]`
);

if(!middleCell) return;

const status = getTableStatusText(t);

middleCell.innerHTML = `
  <div class="running-block ${status.className}">
    <div class="running-time">
      ${status.text}
    </div>
  </div>
`;



      });
}














function getBookingById(id){
  return state.bookings.find(b=>Number(b.id) === Number(id));
}

function openBookingAction(id){
  const b = getBookingById(id);
  if(!b) return;

  activeBookingId = id;

  const tableIndex = Number(
    (b.tableIndexes || [b.tableIndex])[0] || 0
  );

  document.getElementById("bookingActionInfo").innerHTML = `
    时间：${b.startTime} - ${b.endTime}<br>
    状态：${b.checkedIn ? "已到店" : "未到店"}
  `;

  document.getElementById("detailName").value =
    b.name || "";

  document.getElementById("detailPhone").value =
    b.phone || "";

  document.getElementById("detailPay").value =
    b.pay || "";

  document.getElementById("detailTable").innerHTML =
    state.tables.map((t,i)=>`
      <option
        value="${i}"
        ${i===tableIndex ? "selected" : ""}
      >
        ${t.name}
      </option>
    `).join("");

    document.getElementById("detailPackage").innerHTML =
  (state.packages || []).map((p,i)=>`
    <option value="${i}" ${Number(b.packageIndex || 0) === i ? "selected" : ""}>
      ${p.name}｜${p.unlimited ? "不限时" : p.minutes + "分钟"}｜¥${p.price}
    </option>
  `).join("");

  document.getElementById("bookingActionModalBg").style.display = "block";
}

function saveBookingDetail(){
  const b = getBookingById(activeBookingId);
  if(!b) return;

  const oldIndexes = (b.tableIndexes || [b.tableIndex])
    .filter(v=>v !== undefined && v !== null)
    .map(Number);

  const oldTableIndex = oldIndexes[0];
  const newTableIndex = Number(document.getElementById("detailTable").value);

  const newName = document.getElementById("detailName").value.trim();
  const newPhone = document.getElementById("detailPhone").value.trim();
  const newPay = document.getElementById("detailPay").value;
  const newPackageIndex = Number(document.getElementById("detailPackage").value || 0);


  if(b.checkedIn && newTableIndex !== oldTableIndex){
    const oldTable = state.tables[oldTableIndex];
    const newTable = state.tables[newTableIndex];

    if(newTable?.start){
      alert("新桌位正在使用中，不能更换");
      return;
    }

    state.tables[newTableIndex] = {
      ...oldTable,
      name: newTable.name,
      customer:{
        name:newName,
        phoneLast4:String(newPhone || "").slice(-4)
      },
      pay:newPay || oldTable.pay || "",
      type:"booking"
    };

state.tables[oldTableIndex] = resetTable(oldTable.name);

  }

  if(b.checkedIn && newTableIndex === oldTableIndex){
    const t = state.tables[oldTableIndex];
    if(t){
      t.customer = {
        name:newName,
        phoneLast4:String(newPhone || "").slice(-4)
      };
      t.pay = newPay || t.pay || "";
      t.type = "booking";
    }
  }

  b.name = newName;
  b.phone = newPhone;
  b.pay = newPay;
  b.packageIndex = newPackageIndex;
  b.tableIndexes = [newTableIndex];
  delete b.tableIndex;

  save();
  closeBookingAction();
  renderBookingGrid();
  renderList();

  alert("修改成功");
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
    t.bookingId = b.id;
    t.activeColor = b.color || getNextBookingColor(); 
    t.pay = b.pay || "";
    t.packageIndex = Number(b.packageIndex || 0);
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
  renderBookingGrid();
  renderList();
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
  renderBookingGrid();
  renderList();
}

function printBookingGrid(){
  location.href = `./print-booking.html?date=${currentBookingDate}`;
}

window.printBookingGrid = printBookingGrid;
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
window.saveBookingDetail = saveBookingDetail;
window.toggleBookingLock = toggleBookingLock;
window.changeCalendarMonth = changeCalendarMonth;
window.selectCalendarDate = selectCalendarDate;
window.toggleModalType = toggleModalType;
window.toggleBookingList = toggleBookingList;
window.checkInBookingById = checkInBookingById;
window.cancelBookingById = cancelBookingById;