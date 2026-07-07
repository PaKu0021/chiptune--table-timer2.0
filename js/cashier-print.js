const RATE = 0.044;

const raw = sessionStorage.getItem("cashier_print_data");
const payload = raw ? JSON.parse(raw) : {
  start:"全部",
  end:"全部",
  pay:"全部支付方式",
  rows:[]
};

const rows = payload.rows || [];

function normalizePayments(r){
  if(r.payments){
    return r.payments;
  }

  const amount = Number(r.totalJPY || r.jpy || 0);

  if(amount !== 0){
    return [{
      type:"收入",
      reason:r.checkoutMethod || "历史记录",
      pay:r.pay || "未记录",
      amountJPY:amount,
      amountRMB:Number(r.totalRMB || r.rmb || 0)
    }];
  }

  return [];
}

function isRmbPayment(p, r){
  const pay = p.pay || r.pay || "";
  return pay === "微信" ||
         pay === "支付宝" ||
         p.currency === "人民币" ||
         r.currency === "人民币";
}

function paymentRMB(p){
  if(p.amountRMB !== undefined){
    return Number(p.amountRMB || 0);
  }
  return Math.floor(Number(p.amountJPY || 0) * RATE);
}

function actualRMBIncome(r){
  return normalizePayments(r).reduce((sum,p)=>{
    if(isRmbPayment(p,r)){
      return sum + paymentRMB(p);
    }
    return sum;
  },0);
}

function paymentDetailHTML(r){
  if(r.paymentDetail){
    return String(r.paymentDetail).replace(/\s*\/\s*/g,"<br>");
  }

  const list = normalizePayments(r);

  if(!list.length) return r.pay || "未记录";

  return list.map(p=>{
    const amount = Number(p.amountJPY || 0);
    const sign = amount < 0 ? "-" : "+";

    return `${p.reason || p.type || ""}｜${p.pay || "未记录"}｜${isRmbPayment(p, r)
  ? `${sign}人民币 ¥${Math.abs(paymentRMB(p)).toLocaleString()}（日元换算 ¥${Math.abs(amount).toLocaleString()}）`
  : `${sign}日元 ¥${Math.abs(amount).toLocaleString()}`
}`;
  }).join("<br>");
}


function toJPY(r){
  if(Array.isArray(r.payments)){
    return normalizePayments(r)
      .reduce((sum,p)=>sum + Number(p.amountJPY || 0),0);
  }

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
  let totalRMB = 0;

  rows.forEach(r=>{
    normalizePayments(r).forEach(p=>{
      const pay = p.pay || "未记录";
      const jpy = Number(p.amountJPY || 0);

      if(!pays[pay]) pays[pay] = 0;

      pays[pay] += jpy;
      totalJPY += jpy;

      if(isRmbPayment(p,r)){
        totalRMB += paymentRMB(p);
      }
    });
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

        <tr>
          <td><b>人民币总计</b></td>
          <td><b>¥${Math.floor(totalRMB).toLocaleString()}</b></td>
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
    <td>¥${actualRMBIncome(r).toLocaleString()}</td>
    <td>${paymentDetailHTML(r)}</td>
    <td>${
(()=>{
    const list = normalizePayments(r);
    const hasRmb = list.some(p=>isRmbPayment(p,r));
    const hasJpy = list.some(p=>!isRmbPayment(p,r));

    if(hasRmb && hasJpy) return "混合";
    if(hasRmb) return "人民币";
    return "日元";
})()
}</td>    
    <td>${r.roundRule === "批量结账" ? "不抹零" : (r.roundRule || "")}</td>
    <td>
  ${
    r.receiptImage
      ? `<img
           src="${r.receiptImage}"
           style="
             width:90px;
             border-radius:8px;
             border:1px solid #ddd;
           "
         >`
      : "-"
  }
</td>
  </tr>
`).join("");

renderSummary(rows);

function renderReceiptImages(rows){
  const box = document.getElementById("receiptPrintGrid");
  if(!box) return;

  const list = rows.filter(r=>r.receiptImage);

  if(!list.length){
    box.innerHTML = `<p>暂无收款截图</p>`;
    return;
  }

  box.innerHTML = list.map(r=>`
    <div class="receipt-print-card">
      <img src="${r.receiptImage}">
      <div>
        ${r.closedTime || r.time || ""}<br>
        ${r.tableName || ""}｜${r.customerName || ""}${r.phoneLast4 ? "（" + r.phoneLast4 + "）" : ""}<br>
        ${paymentDetailHTML(r)}<br>合计｜¥${toJPY(r).toLocaleString()}
      </div>
    </div>
  `).join("");
}

renderReceiptImages(rows);