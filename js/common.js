export function getQuery(name){
  const url = new URL(location.href);
  return url.searchParams.get(name);
}

export function formatTime(ms){
  let s = Math.floor(ms/1000);
  let m = Math.floor(s/60);
  let h = Math.floor(m/60);
  return `${h}:${m%60}:${s%60}`;
}

export function roundJPY(j){
  let base = Math.floor(j/1000)*1000;
  let rest = j-base;
  return rest<=500 ? base : base+500;
}