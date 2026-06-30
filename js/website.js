import { db } from "./firebase.js";

import {
    doc,
    getDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

async function submitWebsiteBooking(){
  const name = document.getElementById("bookingName").value.trim();
  const contact = document.getElementById("bookingContact").value.trim();
  const people = Number(document.getElementById("bookingPeople").value || 1);
  const date = document.getElementById("bookingDate").value;
  const startTime = document.getElementById("bookingStart").value;
  const endTime = document.getElementById("bookingEnd").value;
  const note = document.getElementById("bookingNote").value.trim();

  if(!name){
    alert("请输入姓名");
    return;
  }

  if(!contact){
    alert("请输入联系方式");
    return;
  }

  if(!date || !startTime || !endTime){
    alert("请选择预约日期和时间");
    return;
  }

  if(startTime >= endTime){
    alert("结束时间必须晚于开始时间");
    return;
  }


  const ref = doc(db,"shop","main");

const snap = await getDoc(ref);

const data = snap.data();

if(!data.bookings){

    data.bookings=[];

}

data.bookings.push({
  id: Date.now(),

  date,
  name,
  phone: contact,

  people,
  startTime,
  endTime,
  note,

  source: "官网",
  color: "#B7E4C7",

  tableIndex: null,
  tableIndexes: [],

  packageIndex: 0,

  pay: "",
  checkedIn: false,
  checkInTime: null,
  checkInTimeText: "",
  checkedInTableIndexes: [],
  finishedTableIndexes: [],

  cancelled: false,
  status: "pending",

  createdAt: Date.now(),
  createdTime: new Date().toLocaleString()
});

await updateDoc(ref,{

    bookings:data.bookings

});

  alert("预约已提交，我们会尽快确认。");

  document.getElementById("bookingName").value = "";
  document.getElementById("bookingContact").value = "";
  document.getElementById("bookingPeople").value = "1";
  document.getElementById("bookingDate").value = "";
  document.getElementById("bookingStart").value = "";
  document.getElementById("bookingEnd").value = "";
  document.getElementById("bookingNote").value = "";
}

window.submitWebsiteBooking = submitWebsiteBooking;