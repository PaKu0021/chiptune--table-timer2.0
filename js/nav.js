export function renderNav(active){
  const box = document.getElementById("globalNav");
  if(!box) return;

  box.innerHTML = `
    <button class="${active === "app" ? "btn-main" : "btn-ghost"}"
      onclick="location.href='./app.html'">
      计时器
    </button>

    <button class="${active === "booking" ? "btn-main" : "btn-ghost"}"
      onclick="location.href='./booking.html'">
      预约
    </button>

    <button class="${active === "owner" ? "btn-main" : "btn-ghost"}"
      onclick="location.href='./owner.html'">
      老板模式
    </button>

    <button class="btn-ghost"
      onclick="location.href='./index.html'">
      首页
    </button>
  `;
}