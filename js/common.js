export function getQuery(name){
  const url = new URL(location.href);
  return url.searchParams.get(name);
}

export function formatTime(ms){
  ms = Math.max(0, ms);

  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}


export function roundJPY(j){
  let base = Math.floor(j/1000)*1000;
  let rest = j-base;
  return rest<=500 ? base : base+500;
}

export function resetTable(name){
  return {
    name,

    start:null,
    extra:0,

    packageIndex:0,

    recordId:null,

    bookingId:null,

    activeColor:"",

    customerKey:"",

    visitId:null,
    visitDate:"",
    visitRange:"",

    type:"",

    pay:"",


    payTiming:"prepaid",
    paidJPY:0,
    paidRMB:0,
    paidAt:null,

    currency:"日元",

    customer:{
      name:"",
      phoneLast4:""
    },

    alerted:false,
    alerting:false,

    pausedAt:null,

    lastAction:""
  };
}