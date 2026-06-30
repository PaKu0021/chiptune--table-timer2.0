import { db } from "./firebase.js";

import {
  collection,
  addDoc
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

  await addDoc(collection(db, "publicBookings"), {
    name,
    contact,
    people,
    date,
    startTime,
    endTime,
    note,
    status:"待确认",
    source:"官网预约",
    createdAt:Date.now(),
    createdTime:new Date().toLocaleString()
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