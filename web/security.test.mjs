import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAuth } from "./auth.mjs";

test("owner authentication limits guessing and expires/revokes sessions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = Date.now();
  const auth = await createAuth(directory, { now: () => now });
  const password = (await readFile(join(directory, "initial-password.txt"), "utf8")).trim();
  assert.ok(password.length >= 16);
  assert.ok(!(await readFile(join(directory, "web-owner.json"), "utf8")).includes(password));
  for (let i = 0; i < 5; i++) assert.equal(auth.login("wrong", "client").ok, false);
  assert.equal(auth.login(password, "client").limited, true);
  now += 16 * 60_000;
  const first = auth.login(password, "client");
  assert.match(first.cookie, /HttpOnly; SameSite=Strict/);
  assert.match(first.cookie, /Secure/);
  const request = { headers: { cookie: first.cookie.split(";")[0] } };
  assert.ok(auth.authenticate(request));
  auth.login(password, "client");
  assert.equal(auth.authenticate(request), null);
  const second = auth.login(password, "client");
  request.headers.cookie = second.cookie.split(";")[0];
  now += 13 * 60 * 60_000;
  assert.equal(auth.authenticate(request), null);
});

test("OAuth relay accepts only an active callback, exact path and state; server secrets authenticate ciphertext", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-callback-"));
  process.env.ZHIYU_DATA_DIR = directory;
  const { registerCallback, relayCallback, safeStorage } = await import("./platform.mjs");
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.end("callback accepted");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const callback = `http://127.0.0.1:${server.address().port}/callback`;
  registerCallback(callback, "expected-state");
  await assert.rejects(relayCallback(callback + "?state=wrong&code=test"));
  await assert.rejects(
    relayCallback(callback.replace("/callback", "/admin") + "?state=expected-state&code=test"),
  );
  await assert.rejects(relayCallback("http://169.254.169.254/?state=expected-state&code=test"));
  assert.equal(calls, 0);
  await relayCallback(callback + "?state=expected-state&code=test");
  assert.equal(calls, 1);
  await assert.rejects(relayCallback(callback + "?state=expected-state&code=test"));
  const encrypted = safeStorage.encryptString("isolated-api-key");
  assert.ok(!encrypted.includes("isolated-api-key"));
  assert.equal(safeStorage.decryptString(encrypted), "isolated-api-key");
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => safeStorage.decryptString(encrypted));
});
