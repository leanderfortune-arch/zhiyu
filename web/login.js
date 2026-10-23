document.querySelector("#login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("button");
  button.disabled = true;
  button.textContent = "正在登录…";
  document.querySelector("#error").textContent = "";
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.querySelector("#password").value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    const session = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
    if (!session.ok) throw new Error("浏览器未保存登录状态，请允许此站点使用 Cookie 后重试。");
    location.replace("/");
  } catch (error) {
    document.querySelector("#error").textContent = error.message || "连接失败，请重试";
    button.disabled = false;
    button.textContent = "登录工作空间";
  }
});
