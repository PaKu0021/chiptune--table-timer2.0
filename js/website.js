import { db } from "./firebase.js";

import {
    doc,
    getDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const LANG = {
  zh:{
    navPrice:"价格",
    navAccessory:"配饰",
    navBooking:"预约",
    navAccess:"交通",

    heroTag:"池袋・アイロンビーズ体験工房",
    heroTitle:"来 Chiptune 做属于自己的拼豆作品",

    bookingTitle:"预约",
    nameLabel:"姓名",
    contactLabel:"联系方式",
    peopleLabel:"人数",
    dateLabel:"预约日期",
    startLabel:"开始时间",
    endLabel:"结束时间",
    noteLabel:"备注",
    submitBooking:"提交预约"
  },

  ja:{
    navPrice:"料金",
    navAccessory:"アクセサリー",
    navBooking:"予約",
    navAccess:"アクセス",

    heroTag:"池袋・アイロンビーズ体験工房",
    heroTitle:"Chiptuneで自分だけのビーズ作品を作ろう",

    bookingTitle:"予約",
    nameLabel:"お名前",
    contactLabel:"連絡先",
    peopleLabel:"人数",
    dateLabel:"予約日",
    startLabel:"開始時間",
    endLabel:"終了時間",
    noteLabel:"備考",
    submitBooking:"予約を送信"
  },

  en:{
    navPrice:"Price",
    navAccessory:"Accessories",
    navBooking:"Booking",
    navAccess:"Access",

    heroTag:"Ikebukuro Perler Beads Studio",
    heroTitle:"Create your own bead art at Chiptune",

    bookingTitle:"Booking",
    nameLabel:"Name",
    contactLabel:"Contact",
    peopleLabel:"People",
    dateLabel:"Date",
    startLabel:"Start Time",
    endLabel:"End Time",
    noteLabel:"Note",
    submitBooking:"Submit Booking"
  }
};

function setLang(lang){
  localStorage.setItem("websiteLang", lang);

  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key = el.dataset.i18n;
    if(LANG[lang]?.[key]){
      el.innerText = LANG[lang][key];
    }
  });

  document.querySelectorAll(".lang-switch button").forEach(btn=>{
    btn.classList.remove("active");
  });

  document
    .querySelector(`.lang-switch button[onclick="setLang('${lang}')"]`)
    ?.classList.add("active");
}

window.setLang = setLang;

setLang(localStorage.getItem("websiteLang") || "ja");

let submitting = false;

async function submitWebsiteBooking(){
  if(submitting) return;
  submitting = true;

  try{
    const name = document.getElementById("bookingName").value.trim();
    const contact = document.getElementById("bookingContact").value.trim();
    const people = Number(document.getElementById("bookingPeople").value || 1);
    const date = document.getElementById("bookingDate").value;
    const startTime = document.getElementById("bookingStart").value;
    const endTime = document.getElementById("bookingEnd").value;
    const note = document.getElementById("bookingNote").value.trim();

    if(!name) return alert("请输入姓名");
    if(!contact) return alert("请输入联系方式");
    if(!date || !startTime || !endTime) return alert("请选择预约日期和时间");
    if(startTime >= endTime) return alert("结束时间必须晚于开始时间");

    const ref = doc(db,"shop","main");
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};

    if(!Array.isArray(data.bookings)){
      data.bookings = [];
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

  }catch(err){
    console.error(err);
    alert("预约提交失败：" + err.message);
  }finally{
    submitting = false;
  }
}


window.submitWebsiteBooking = submitWebsiteBooking;