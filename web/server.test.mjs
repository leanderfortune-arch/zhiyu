import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import ssh2 from "ssh2";

test(
  "authenticated Node runtime: persistence, vault, files, SSE and session boundaries",
  { timeout: 90_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyu-web-test-"));
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const password = "isolated-web-access-password";
    let processHandle;
    async function start() {
      processHandle = spawn(process.execPath, ["web/server.mjs"], {
        env: {
          ...process.env,
          ZHIYU_DATA_DIR: directory,
          ZHIYU_ORIGIN: origin,
          PORT: String(port),
          ZHIYU_INITIAL_PASSWORD: password,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let log = "";
      processHandle.stderr.on("data", (data) => {
        log += data;
      });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Server startup timeout: " + log)),
          15_000,
        );
        processHandle.stdout.on("data", (data) => {
          if (String(data).includes("ready at")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        processHandle.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Server exited ${code}: ${log}`));
        });
      });
    }
    async function stop() {
      if (processHandle?.exitCode === null) {
        processHandle.kill("SIGTERM");
        await once(processHandle, "exit");
      }
    }
    t.after(async () => {
      await stop();
      await rm(directory, { recursive: true, force: true });
    });
    await start();
    let cookie, csrf;
    async function request(path, data, overrides = {}) {
      return fetch(origin + path, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          ...overrides,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
        redirect: "manual",
      });
    }
    async function login() {
      const response = await request("/api/login", { password });
      assert.equal(response.status, 200);
      cookie = response.headers.get("set-cookie").split(";")[0];
      const session = await (await request("/api/session")).json();
      csrf = session.csrf;
    }
    async function rpc(channel, args = [], extra = {}) {
      const response = await request("/api/rpc", { channel, args, ...extra });
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value));
      assert.equal(value.ok, true, JSON.stringify(value));
      return value;
    }
    assert.equal((await request("/")).status, 302);
    assert.equal((await request("/api/session")).status, 401);
    assert.equal(
      (await request("/api/rpc", { channel: "vault:get", args: ["account:test"] })).status,
      401,
    );
    assert.equal(
      (await request("/api/login", { password }, { Origin: "https://evil.example" })).status,
      403,
    );
    assert.equal((await request("/api/login", { password: "wrong" })).status, 401);
    await login();
    const home = await request("/");
    assert.equal(home.status, 200);
    assert.match(await home.text(), /assets\/index/);
    assert.equal(
      (await request("/api/rpc", { channel: "vault:status", args: [] }, { "X-CSRF-Token": "bad" }))
        .status,
      403,
    );
    assert.equal(
      (await request("/api/rpc", { channel: "fs:readFile", args: ["/etc/passwd"] })).status,
      404,
    );
    const master = "test-vault-master-12345";
    await rpc("profile:save", [{ name: "Web 集成测试", password: master }]);
    await rpc("vault:set", [
      "account:test",
      { username: "web-user", password: "never-plaintext-credential" },
    ]);
    assert.equal(
      (await rpc("vault:get", ["account:test"])).data.password,
      "never-plaintext-credential",
    );
    assert.equal(
      (await readFile(join(directory, "vault.enc"))).includes("never-plaintext-credential"),
      false,
    );
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const sshServer = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
      client.on("authentication", (ctx) =>
        ctx.method === "password" && ctx.password === "fixture-ssh-password"
          ? ctx.accept()
          : ctx.reject(),
      );
      client.on("ready", () =>
        client.on("session", (accept) => {
          const session = accept();
          session.on("pty", (accept) => accept());
          session.on("window-change", (accept) => accept?.());
          session.on("shell", (accept) => {
            const stream = accept();
            stream.on("data", (chunk) => stream.write("echo:" + chunk));
          });
        }),
      );
    });
    sshServer.listen(0, "127.0.0.1");
    await once(sshServer, "listening");
    t.after(() => sshServer.close());
    const sshTarget = {
      id: "server-fixture",
      host: "127.0.0.1",
      port: sshServer.address().port,
      username: "fixture",
    };
    const snapshot = {
      servers: [{ ...sshTarget, name: "Isolated SSH fixture", status: "online" }],
      domains: [],
      mailboxes: [],
      aiAssets: [{ id: "ai-test", name: "Web subscription", provider: "OpenAI" }],
      secrets: [],
      certs: [],
      services: [],
      phoneNumbers: [],
    };
    await rpc("store:save", [{ state: snapshot, version: 0 }]);
    assert.equal((await rpc("store:load")).data.state.aiAssets[0].name, "Web subscription");
    const streamController = new AbortController();
    const stream = await fetch(origin + "/api/events", {
      headers: { Cookie: cookie },
      signal: streamController.signal,
    });
    const reader = stream.body.getReader();
    await reader.read();
    await rpc("documents:save", [
      {
        id: "doc-web-test",
        title: "Web document",
        markdown: "# Persistent document\nBrowser → Node",
      },
    ]);
    const event = new TextDecoder().decode((await reader.read()).value);
    assert.match(event, /documents:changed/);
    await rpc("vault:set", [
      "ssh:server-fixture",
      { kind: "password", password: "fixture-ssh-password" },
    ]);
    const shell = await rpc("ssh:open", [sshTarget, { cols: 80, rows: 24 }]);
    await rpc("ssh:write", [shell.data.sessionId, "WEB_SSH_MARKER"]);
    let terminalOutput = "";
    const terminalDeadline = setTimeout(() => streamController.abort(), 5000);
    while (!terminalOutput.includes("WEB_SSH_MARKER")) {
      terminalOutput += new TextDecoder().decode((await reader.read()).value);
    }
    clearTimeout(terminalDeadline);
    assert.match(terminalOutput, /ssh:data/);
    await rpc("ssh:resize", [shell.data.sessionId, 100, 30]);
    await rpc("ssh:close", [shell.data.sessionId]);
    streamController.abort();
    assert.match(
      (await rpc("documents:get", ["doc-web-test"])).data.markdown,
      /Persistent document/,
    );
    const imported = await rpc("agent:import-document", [], {
      files: [
        {
          name: "knowledge.md",
          base64: Buffer.from("# Isolated knowledge\nWeb backend import").toString("base64"),
        },
      ],
    });
    assert.ok(imported.data);
    const backup = await rpc("backup:create", [
      { password: "test-backup-password", includeSecure: true },
    ]);
    assert.equal(backup.downloads.length, 1);
    const download = await request(backup.downloads[0].url);
    assert.equal(download.status, 200);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.ok(bytes.length > 100);
    assert.equal(bytes.includes("never-plaintext-credential"), false);
    assert.equal((await request(backup.downloads[0].url)).status, 404);
    const picked = await rpc("backup:pick", [], {
      files: [{ name: "backup.zhiyu-backup", base64: bytes.toString("base64") }],
    });
    assert.ok((await rpc("backup:inspect", [picked.data.ticket, "test-backup-password"])).data);
    const previous = cookie;
    await login();
    assert.equal((await request("/api/session", undefined, { Cookie: previous })).status, 401);
    assert.equal((await rpc("vault:status")).data.unlocked, false);
    await rpc("vault:unlock", [master]);
    await stop();
    await start();
    await login();
    assert.equal((await rpc("store:load")).data.state.aiAssets[0].name, "Web subscription");
    assert.equal((await rpc("documents:get", ["doc-web-test"])).data.title, "Web document");
    assert.equal((await rpc("vault:status")).data.unlocked, false);
    await rpc("vault:unlock", [master]);
    assert.equal((await rpc("vault:get", ["account:test"])).data.username, "web-user");
    assert.equal((await request("/api/logout", {})).status, 200);
    assert.equal((await request("/api/session")).status, 401);
  },
);
