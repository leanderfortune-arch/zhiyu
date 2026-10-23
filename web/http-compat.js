/** HTTP LAN origins lack randomUUID and the asynchronous clipboard API. */
export function installHttpCompatibility() {
  if (!globalThis.crypto.randomUUID) {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value() {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      },
      configurable: true,
    });
  }
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        async writeText(text) {
          const active = document.activeElement;
          const field = document.createElement("textarea");
          field.value = text;
          field.readOnly = true;
          field.style.cssText = "position:fixed;left:-9999px;top:0";
          document.body.append(field);
          field.select();
          const copied = document.execCommand("copy");
          field.remove();
          active?.focus?.();
          if (!copied) throw new Error("浏览器未允许复制，请选中文字后手动复制。");
        },
        async readText() {
          throw new Error("HTTP 访问请使用 Ctrl/Cmd+V 手动粘贴。");
        },
      },
      configurable: true,
    });
  }
}
