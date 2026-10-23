import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { readFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createAuth } from "./auth.mjs";

process.env.ZHIYU_WEB = "1";
process.umask(0o077);
const { directory, handlers, requests, events, send, relayCallback } =
  await import("./platform.mjs");
const { startWebServices } = await import("../electron/main.mjs");
const runtime = await startWebServices();
const root = resolve(fileURLToPath(new URL("../dist-web/", import.meta.url)));
const origin = new URL(process.env.ZHIYU_ORIGIN || "http://localhost:8091").origin;
const secure = origin.startsWith("https:");
const auth = await createAuth(directory, { secure });
const downloads = new Map();
const peers = new Map();
const MAX_BODY = 48 * 1024 * 1024;
const unavailable = new Set([
  "extension:pair",
  "extension:status",
  "usage:v2rayn-directory",
  "usage:local-configure",
  "usage:local-refresh",
]);
// Only routes named in the audited renderer bridge may be called from HTTP.
const preload = await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8");
const allowed = new Set(
  [...preload.matchAll(/ipcRenderer\.(?:invoke|send)\("([\w:-]+)"/g)].map((m) => m[1]),
);
const pushed = new Set(["ssh:write", "ssh:resize"]);
let lastActivity = Date.now();

function json(res, status, value, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(value));
}
async function body(req, limit = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("上传内容过大"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw Object.assign(new Error("请求格式无效"), { status: 400 });
  }
}
function closePeers() {
  for (const res of peers.keys()) res.end();
  peers.clear();
}
events.on("message", (event) => {
  const message = `data: ${JSON.stringify(event)}\n\n`;
  for (const [res, token] of peers) {
    if (!auth.sessions.has(token) || res.writableLength > 1024 * 1024) {
      res.end();
      peers.delete(res);
    } else res.write(message);
  }
});
const housekeeping = setInterval(async () => {
  if (Date.now() - lastActivity > 15 * 60_000) runtime.lock();
  for (const [token, session] of auth.sessions) {
    if (session.expires < Date.now()) {
      auth.sessions.delete(token);
      runtime.lock();
    }
  }
  for (const [res, token] of peers) {
    if (!auth.sessions.has(token)) {
      res.end();
      peers.delete(res);
    } else res.write(": heartbeat\n\n");
  }
  for (const [ticket, item] of downloads)
    if (item.expires < Date.now()) {
      downloads.delete(ticket);
      await rm(item.temporary, { recursive: true, force: true });
    }
}, 15_000);
housekeeping.unref();

async function serveFile(res, file) {
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".json": "application/json",
  };
  const info = await stat(file);
  if (!info.isFile()) throw Object.assign(new Error("Not found"), { status: 404 });
  res.writeHead(200, {
    "Content-Type": mime[extname(file)] || "application/octet-stream",
    "Content-Length": info.size,
  });
  const stream = createReadStream(file);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
async function handle(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
  const url = new URL(req.url, origin);
  if (req.headers.host !== new URL(origin).host) return json(res, 421, { error: "Host 不匹配" });
  if (req.method === "POST") {
    if (req.headers.origin !== origin) return json(res, 403, { error: "请求来源无效" });
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return json(res, 415, { error: "仅支持 JSON 请求" });
  } else if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  if (url.pathname === "/api/health") return json(res, 200, { ok: true, runtime: "node-web" });
  if (url.pathname === "/api/login" && req.method === "POST") {
    const result = auth.login((await body(req, 4096)).password, req.socket.remoteAddress);
    if (!result.ok)
      return json(res, result.limited ? 429 : 401, {
        error: result.limited ? "尝试过多，请在 15 分钟后重试" : "访问密码不正确",
      });
    runtime.lock();
    closePeers();
    return json(res, 200, { ok: true }, { "Set-Cookie": result.cookie });
  }
  if (url.pathname === "/login")
    return serveFile(res, fileURLToPath(new URL("./login.html", import.meta.url)));
  if (url.pathname === "/login.js")
    return serveFile(res, fileURLToPath(new URL("./login.js", import.meta.url)));
  if (url.pathname === "/brand/zhiyu.svg")
    return serveFile(res, fileURLToPath(new URL("../public/brand/zhiyu.svg", import.meta.url)));
  const session = auth.authenticate(req);
  if (!session) {
    if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "请先登录" });
    res.writeHead(302, { Location: "/login" });
    return res.end();
  }
  if (url.pathname === "/api/session")
    return json(res, 200, { csrf: session.csrf, mode: "web", singleOwner: true });
  if (req.method === "POST" && req.headers["x-csrf-token"] !== session.csrf)
    return json(res, 403, { error: "会话校验失败，请重新登录" });
  if (url.pathname === "/api/oauth-callback" && req.method === "POST") {
    const input = await body(req);
    try {
      await relayCallback(input.url);
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  if (url.pathname === "/api/logout" && req.method === "POST") {
    runtime.lock();
    closePeers();
    return json(res, 200, { ok: true }, { "Set-Cookie": auth.logout(session.token) });
  }
  if (url.pathname === "/api/events") {
    if (peers.size > 16) return json(res, 429, { error: "连接过多" });
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    peers.set(res, session.token);
    req.on("close", () => peers.delete(res));
    return;
  }
  if (url.pathname.startsWith("/api/download/")) {
    const ticket = url.pathname.split("/").pop();
    const item = downloads.get(ticket);
    if (!item || item.token !== session.token || item.expires < Date.now())
      return json(res, 404, { error: "下载已过期" });
    downloads.delete(ticket);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
    });
    const stream = createReadStream(item.path);
    stream.on("error", () => res.destroy());
    res.on("close", () => void rm(item.temporary, { recursive: true, force: true }));
    return stream.pipe(res);
  }
  if (url.pathname === "/api/rpc" && req.method === "POST") {
    lastActivity = Date.now();
    const input = await body(req);
    if (!allowed.has(input.channel) || (!handlers.has(input.channel) && !pushed.has(input.channel)))
      return json(res, 404, { error: "未知接口" });
    if (unavailable.has(input.channel))
      return json(res, 400, {
        error: "此功能需要连接桌面端。Web 版支持服务器端资产、SSH、密钥库、邮件与 AI 服务。",
      });
    if (!Array.isArray(input.args) || input.args.length > 8)
      return json(res, 400, { error: "参数无效" });
    const temporary = await mkdtemp(join(tmpdir(), "zhiyu-request-"));
    const ctx = {
      temporary,
      uploads: [],
      downloads: [],
      links: [],
      confirmed: input.confirmed === true,
    };
    let retained = false;
    try {
      if (input.files !== undefined && (!Array.isArray(input.files) || input.files.length > 5))
        throw new Error("最多上传 5 个文件");
      for (const file of input.files || []) {
        if (
          typeof file.name !== "string" ||
          typeof file.base64 !== "string" ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)
        )
          throw new Error("文件格式无效");
        const folder = join(temporary, randomBytes(8).toString("hex"));
        await mkdir(folder);
        const path = join(
          folder,
          basename(file.name).replace(/[^\p{L}\p{N}_. -]/gu, "_") || "upload.bin",
        );
        await writeFile(path, Buffer.from(file.base64, "base64"));
        ctx.uploads.push(path);
      }
      const result = await requests.run(ctx, () =>
        pushed.has(input.channel)
          ? (send(input.channel, input.args), { ok: true })
          : handlers.get(input.channel)(...input.args),
      );
      if (!auth.sessions.has(session.token)) return json(res, 401, { error: "会话已失效" });
      const links = [];
      if (result.ok)
        for (const download of ctx.downloads) {
          const ticket = randomBytes(24).toString("base64url");
          downloads.set(ticket, {
            ...download,
            temporary,
            token: session.token,
            expires: Date.now() + 5 * 60_000,
          });
          retained = true;
          links.push({ name: download.name, url: `/api/download/${ticket}` });
        }
      // Restore tickets refer to uploaded files across requests, so retain them for their 15 minute TTL.
      if (input.channel === "backup:pick" && result.ok && result.data?.ticket) {
        retained = true;
        const timer = setTimeout(
          () => void rm(temporary, { recursive: true, force: true }),
          16 * 60_000,
        );
        timer.unref();
      }
      return json(res, 200, { ...result, downloads: links, links: ctx.links });
    } finally {
      if (!retained) await rm(temporary, { recursive: true, force: true });
    }
  }
  if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found" });
  const path = resolve(
    root,
    "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
  );
  if (!path.startsWith(root + sep)) return json(res, 404, { error: "Not found" });
  await serveFile(res, path);
}
const listener = (req, res) =>
  void handle(req, res).catch((error) => {
    if (!res.headersSent)
      json(res, error.status || 500, {
        error: error.status ? error.message : "请求失败，请检查输入或服务器日志",
      });
    else res.destroy();
    console.error("web-request", error.message);
  });
const server = process.env.ZHIYU_TLS_CERT
  ? httpsServer(
      {
        cert: readFileSync(process.env.ZHIYU_TLS_CERT),
        key: readFileSync(process.env.ZHIYU_TLS_KEY),
      },
      listener,
    )
  : httpServer(listener);
server.requestTimeout = 120_000;
server.headersTimeout = 15_000;
server.listen(Number(process.env.PORT || 8091), process.env.HOST || "127.0.0.1", () =>
  console.log(`Zhiyu Web ready at ${origin}`),
);
let stopping = false;
process.on("SIGTERM", async () => {
  if (stopping) return;
  stopping = true;
  closePeers();
  clearInterval(housekeeping);
  server.close();
  await runtime.stop();
  process.exit(0);
});
