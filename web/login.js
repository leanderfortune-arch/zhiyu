document.querySelector("#login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("button");
  button.disabled = true;
  document.querySelector("#error").textContent = "";
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.querySelector("#password").value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    location.replace("/");
  } catch (error) {
    document.querySelector("#error").textContent = error.message || "连接失败，请重试";
    button.disabled = false;
  }
});
