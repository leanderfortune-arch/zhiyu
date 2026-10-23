/** Browser transport implementing the existing, explicitly named bridge contract. */
export function createBrowserTransport() {
  const listeners = new Map();
  let session;
  let sendQueue = Promise.resolve();
  const ready = fetch("/api/session").then(async (response) => {
    if (response.status === 401) {
      location.replace("/login");
      throw new Error("请先登录");
    }
    session = await response.json();
  });
  const source = new EventSource("/api/events");
  source.onmessage = ({ data }) => {
    const { channel, payload } = JSON.parse(data);
    if (channel === "web:open-external") showLink(payload.url);
    for (const fn of listeners.get(channel) || []) fn(null, payload);
  };
  source.onerror = () => {
    fetch("/api/session")
      .then((response) => {
        if (response.status === 401) {
          source.close();
          location.replace("/login");
        }
      })
      .catch(() => {});
  };
  function showLink(url) {
    if (!/^https?:\/\//.test(url)) return;
    const panel = document.createElement("div");
    panel.style.cssText =
      "position:fixed;bottom:60px;right:20px;z-index:10000;background:white;border:1px solid #dce3ec;border-radius:12px;padding:16px;box-shadow:0 8px 40px #0002;color:#172238;max-width:320px";
    const link = document.createElement("a");
    link.textContent = "打开授权页面 ↗";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.cssText = "color:#3b6fe0;font-weight:600";
    const close = document.createElement("button");
    close.textContent = "关闭";
    close.style.cssText = "margin-left:20px;cursor:pointer";
    close.onclick = () => panel.remove();
    const hint = document.createElement("p");
    hint.textContent =
      "若授权后跳到 localhost / 127.0.0.1 且打不开，复制地址栏的完整回调链接并在下方提交。";
    hint.style.cssText = "font:12px/1.6 system-ui;margin:12px 0 8px;color:#64748b";
    const input = document.createElement("input");
    input.placeholder = "粘贴完整回调链接";
    input.style.cssText =
      "width:100%;border:1px solid #dce3ec;padding:8px;border-radius:6px;font:12px system-ui";
    const submit = document.createElement("button");
    submit.textContent = "提交回调";
    submit.style.cssText = "margin-top:8px;color:#3b6fe0;cursor:pointer";
    submit.onclick = async () => {
      submit.disabled = true;
      try {
        await ready;
        const response = await fetch("/api/oauth-callback", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf },
          body: JSON.stringify({ url: input.value.trim() }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        panel.remove();
      } catch (error) {
        hint.textContent = error.message;
        submit.disabled = false;
      }
    };
    panel.append(link, close, hint, input, submit);
    document.body.append(panel);
  }
  async function pick(channel) {
    const extensions = {
      "passwords:preview-import": ".csv",
      "agent:import-document": ".txt,.md",
      "dialog:pick-json": ".json",
      "backup:pick": ".zhiyu-backup,.nanpadbak,.backup,.enc",
      "mail-client:pick-attachments": "",
    };
    if (!Object.hasOwn(extensions, channel)) return [];
    const files = await new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = extensions[channel];
      input.multiple = channel === "mail-client:pick-attachments";
      input.onchange = () => {
        resolve(Array.from(input.files || []));
        input.remove();
      };
      input.oncancel = () => {
        resolve([]);
        input.remove();
      };
      input.style.display = "none";
      document.body.append(input);
      input.click();
    });
    if (files.length > 5 || files.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024)
      throw new Error("最多上传 5 个文件，总大小不超过 32 MiB");
    return Promise.all(
      files.map(async (file) => ({
        name: file.name,
        base64: await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = reject;
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.readAsDataURL(file);
        }),
      })),
    );
  }
  async function invoke(channel, ...args) {
    if (channel === "shell:open-external") {
      const url = args[0];
      if (!/^https?:\/\//.test(url)) return { ok: false, error: "链接无效" };
      window.open(url, "_blank", "noopener,noreferrer");
      return { ok: true, data: true };
    }
    // Window chrome is hidden by the Web entry point; no host window is controlled.
    if (channel === "window:state")
      return { ok: true, data: { maximized: false, platform: "web" } };
    const files = await pick(channel);
    const confirmed =
      channel === "passwords:export-csv"
        ? window.confirm("CSV 包含明文密码。仅用于浏览器密码迁移，完成后请删除。继续导出？")
        : false;
    if (channel === "passwords:export-csv" && !confirmed) return { ok: true, data: null };
    await ready;
    const response = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf },
      body: JSON.stringify({ channel, args, files, confirmed }),
    });
    if (response.status === 401) {
      location.replace("/login");
      throw new Error("登录已过期");
    }
    const result = await response.json();
    for (const item of result.downloads || []) {
      const link = document.createElement("a");
      link.href = item.url;
      link.download = item.name;
      document.body.append(link);
      link.click();
      link.remove();
    }
    for (const url of result.links || []) showLink(url);
    return result;
  }
  async function logout() {
    await ready;
    const response = await fetch("/api/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf },
      body: "{}",
    });
    if (!response.ok) throw new Error("退出登录失败，请重试");
    source.close();
    location.replace("/login");
  }
  return {
    contextBridge: {
      exposeInMainWorld(name, bridge) {
        bridge.logout = logout;
        window[name] = bridge;
      },
    },
    ipcRenderer: {
      invoke,
      send(channel, ...args) {
        // IPC preserves order; preserve it across asynchronous HTTP terminal writes too.
        sendQueue = sendQueue.then(() => invoke(channel, ...args)).catch(() => {});
      },
      on(channel, handler) {
        if (!listeners.has(channel)) listeners.set(channel, new Set());
        listeners.get(channel).add(handler);
      },
      removeListener(channel, handler) {
        listeners.get(channel)?.delete(handler);
      },
    },
  };
}
