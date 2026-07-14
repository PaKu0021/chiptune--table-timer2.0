// Chiptune 营业日：每天早上 06:00 换日。
// 例如 7 月 14 日 00:00–05:59 仍归属于 7 月 13 日营业收入。
export const BUSINESS_DAY_START_HOUR = 6;

export function dateKey(value = Date.now()){
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if(Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function getBusinessDateKey(value = Date.now()){
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if(Number.isNaN(d.getTime())) return "";
  d.setHours(d.getHours() - BUSINESS_DAY_START_HOUR);
  return dateKey(d);
}

export function getCurrentBusinessDate(){
  return getBusinessDateKey(Date.now());
}

export function getRecordTimestamp(record = {}){
  const candidates = [
    record.startAt,
    record.timestamp,
    record.paidAt,
    record.closedAt,
    record.time,
    record.date
  ];

  for(const value of candidates){
    if(value === undefined || value === null || value === "") continue;
    const d = new Date(value);
    if(!Number.isNaN(d.getTime())) return d.getTime();
  }
  return 0;
}

export function getRecordBusinessDate(record = {}){
  // 手工修改过营业日的账单应保留人工指定结果。
  if(record.businessDateManual && record.businessDate){
    return String(record.businessDate);
  }

  const timestamp = getRecordTimestamp(record);
  if(timestamp) return getBusinessDateKey(timestamp);

  // 极旧数据可能只有 businessDate，没有任何可解析时间。
  return record.businessDate ? String(record.businessDate) : "";
}

export function businessDateToLocalDate(key){
  const d = new Date(`${key}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
