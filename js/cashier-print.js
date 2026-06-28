const RATE = 0.044;

const raw = sessionStorage.getItem("cashier_print_data");
const payload = raw ? JSON.parse(raw) : {
  start:"全部",
  end:"全部",
  pay:"全部支付方式",
  rows:[]
};

const rows = payload.rows || [];

function toJPY(r){
  if(r.totalJPY !== undefined) return Number(r.totalJPY || 0);
  if(r.jpy !== undefined) return Number(r.jpy || 0);

  if(r.currency === "人民币"){
    return Math.floor(Number(r.totalRMB || r.rmb || 0) / RATE);
  }

  return 0;
}


function renderSummary(rows){
  const pays = {
    "现金":0,
    "PayPay":0,
    "微信":0,
    "支付宝":0,
    "未记录":0
  };

  let totalJPY = 0;

  rows.forEach(r=>{
    const p = r.pay || "未记录";
    const jpy = toJPY(r);

    if(!pays[p]) pays[p] = 0;

    pays[p] += jpy;
    totalJPY += jpy;
  });

  document.getElementById("printSummary").innerHTML = `
    <table class="record-table">
      <tbody>
        ${Object.keys(pays).map(k=>`
          <tr>
            <td><b>${k}</b></td>
            <td>¥${Math.floor(pays[k]).toLocaleString()}</td>
          </tr>
        `).join("")}
        <tr>
          <td><b>日元总计</b></td>
          <td><b>¥${Math.floor(totalJPY).toLocaleString()}</b></td>
        </tr>
      </tbody>
    </table>
  `;
}

document.getElementById("printTitle").innerText =
  `收银记录｜${payload.start} ～ ${payload.end}｜${payload.pay}｜${rows.length}笔`;

document.getElementById("printRows").innerHTML =
rows.map(r=>`
  <tr>
    <td>${r.closedTime || r.time || ""}</td>
    <td>${r.tableName || ""}</td>
    <td>${r.customerName || ""}${r.phoneLast4 ? "（" + r.phoneLast4 + "）" : ""}</td>
    <td>${(r.customerType || r.type) === "booking" ? "预约" : "Walk-in"}</td>
    <td>${r.packageName || ""}</td>
    <td>¥${Number(r.originalJPY || 0).toLocaleString()}</td>
    <td>¥${toJPY(r).toLocaleString()}</td>
    <td>¥${Number(r.totalRMB || r.rmb || 0).toLocaleString()}</td>
    <td>${r.pay || "未记录"}</td>
    <td>${r.currency || ""}</td>
    <td>${r.roundRule === "批量结账" ? "不抹零" : (r.roundRule || "")}</td>
  </tr>
`).join("");

renderSummary(rows);