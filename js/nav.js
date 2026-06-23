export function renderNav(active){
  const box = document.getElementById("globalNav");
  if(!box) return;

  box.innerHTML = `
    <button class="${active === "booking" ? "btn-main" : "btn-ghost"}"
      onclick="location.href='./booking.html'">
      预约
    </button>

    <button class="${active === "app" ? "btn-main" : "btn-ghost"}"
      onclick="location.href='./app.html'">
      计时器
    </button>

    <button class="${active === "bill" ? "btn-main" : "btn-ghost"}"
      onclick="location.href='./today-bill.html'">
      今日账单
    </button>

    <button class="${active === "owner" ? "btn-main" : "btn-ghost"}"
      ${active === "owner" ? "disabled" : "onclick=\"goOwner()\""}>
      老板模式
    </button>

    <button class="btn-ghost"
      onclick="location.href='./index.html'">
      首页
    </button>
  `;
}

window.goOwner = function(){
  const pw = prompt("请输入老板密码");

  if(pw !== "prompt"){
    alert("密码错误");
    return;
  }

  sessionStorage.setItem("owner_auth","1");
  location.href = "./owner.html";
};