import { EventEmitter } from "node:events";
import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createAiFetch } from "./ai-fetch.mjs";
import { inspectRaster } from "../electron/services/image-data.mjs";

export const aiFetch = createAiFetch();

export const directory = resolve(process.env.ZHIYU_DATA_DIR || "./web-data");
mkdirSync(directory, { recursive: true, mode: 0o700 });
export const requests = new AsyncLocalStorage();
export const events = new EventEmitter();
export const handlers = new Map();
const trustedEvent = Object.freeze({});
export const isWebEvent = (event) => event === trustedEvent;
export const ipcMain = new EventEmitter();
ipcMain.handle = (channel, fn) => {
  if (handlers.has(channel)) throw new Error(`Duplicate route: ${channel}`);
  handlers.set(channel, (...args) => fn(trustedEvent, ...args));
};
export function send(channel, args) {
  ipcMain.emit(channel, trustedEvent, ...args);
}
export function publish(channel, payload) {
  events.emit("message", { channel, payload });
}

const paths = new Map([
  ["userData", directory],
  ["sessionData", directory],
  ["appData", directory],
  ["documents", directory],
]);
export const app = Object.assign(new EventEmitter(), {
  isPackaged: true,
  getPath(name) {
    if (!paths.has(name)) throw new Error("Unsupported system path");
    return paths.get(name);
  },
  setPath(name, path) {
    paths.set(name, path);
  },
  setName() {},
  getVersion: () => JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version,
  relaunch() {},
  quit() {
    process.emit("SIGTERM");
  },
});

const keyFile = join(directory, "server.key");
let encryptionKey;
try {
  encryptionKey = readFileSync(keyFile);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  encryptionKey = randomBytes(32);
  writeFileSync(keyFile, encryptionKey, { flag: "wx", mode: 0o600 });
}
if (encryptionKey.length !== 32) throw new Error("Invalid server encryption key");
export const safeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "server-aes-256-gcm",
  encryptString(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
  },
  decryptString(value) {
    const buffer = Buffer.from(value);
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey, buffer.subarray(0, 12));
    cipher.setAuthTag(buffer.subarray(12, 28));
    return Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString("utf8");
  },
};

function context() {
  const ctx = requests.getStore();
  if (!ctx) throw new Error("This operation requires a browser request");
  return ctx;
}
export const dialog = {
  async showOpenDialog(_window, options = {}) {
    if (options.properties?.includes("openDirectory")) {
      if (options.properties.includes("createDirectory")) {
        const path = join(dirname(directory), "backups");
        mkdirSync(path, { recursive: true, mode: 0o700 });
        return { canceled: false, filePaths: [path] };
      }
      throw new Error("Web 版无法读取浏览器所在电脑的目录；本机 v2rayN 统计请使用桌面版。");
    }
    const uploads = context().uploads;
    return { canceled: !uploads.length, filePaths: uploads };
  },
  async showSaveDialog(_window, options = {}) {
    const ctx = context();
    const name = basename(options.defaultPath || "download.bin");
    const path = join(ctx.temporary, name);
    ctx.downloads.push({ path, name });
    return { canceled: false, filePath: path };
  },
  async showMessageBox() {
    // Confirmation is collected in the initiating browser before the RPC.
    return { response: context().confirmed ? 1 : 0 };
  },
};
export const shell = {
  async openExternal(url) {
    if (!/^https?:\/\//.test(url)) throw new Error("Only HTTP(S) links are allowed");
    publish("web:open-external", { url });
  },
  async openPath() {
    return "Web 版数据保存在服务器；请使用加密备份下载资料。";
  },
};
export const net = { fetch: (...args) => fetch(...args) };
export const Menu = { buildFromTemplate: () => null, setApplicationMenu() {} };
export const powerMonitor = new EventEmitter();
export const screen = {};
export class Notification {
  static isSupported() {
    return false;
  }
}
export class BrowserWindow {
  constructor() {
    throw new Error("Desktop windows are unavailable in Web mode");
  }
}
export class Tray {
  constructor() {
    throw new Error("Desktop tray is unavailable in Web mode");
  }
}

function image(input, options = {}) {
  const worker = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./image-worker.mjs", import.meta.url)), JSON.stringify(options)],
    {
      input,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15_000,
    },
  );
  const output = worker.status === 0 ? worker.stdout : Buffer.alloc(0);
  return {
    isEmpty: () => !output.length,
    getSize: () => inspectRaster(output, "image/png"),
    toPNG: () => output,
    resize: (size) => image(output, size),
  };
}
export const nativeImage = {
  createFromDataURL: (value) => image(Buffer.from(value.split(",")[1] || "", "base64")),
  createFromBuffer: (value) => image(value),
};

const callbacks = new Map();
export function registerCallback(raw, state) {
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port)
    return;
  for (const [key, entry] of callbacks) if (entry.expires < Date.now()) callbacks.delete(key);
  callbacks.set(state, { origin: url.origin, path: url.pathname, expires: Date.now() + 300_000 });
}
export async function relayCallback(raw) {
  const url = new URL(raw);
  const state = url.searchParams.get("state");
  const expected = callbacks.get(state);
  if (
    !expected ||
    expected.expires < Date.now() ||
    url.origin !== expected.origin ||
    url.pathname !== expected.path ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("回调不属于当前授权请求，或已过期。请从应用重新授权。");
  if (
    url.searchParams.getAll("state").length !== 1 ||
    [...url.searchParams.keys()].some(
      (key) =>
        !["code", "state", "error", "error_description", "scope", "authuser", "prompt"].includes(
          key,
        ),
    )
  )
    throw new Error("回调参数无效");
  const host = url.host;
  url.hostname = "127.0.0.1";
  const response = await fetch(url, {
    headers: { Host: host },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("授权服务未接受回调，请检查是否复制了完整链接。");
  callbacks.delete(state);
}
