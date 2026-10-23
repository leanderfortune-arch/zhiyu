import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAuth } from "./auth.mjs";

test("HTTP login is isolated from old HTTPS Secure cookies on the same host", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-protocol-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const httpsAuth = await createAuth(directory, { secure: true });
  const password = (await readFile(join(directory, "initial-password.txt"), "utf8")).trim();
  const httpAuth = await createAuth(directory, { secure: false });
  const secureLogin = httpsAuth.login(password, "https-client");
  const plainLogin = httpAuth.login(password, "http-client");
  const secureCookie = secureLogin.cookie.split(";")[0];
  const plainCookie = plainLogin.cookie.split(";")[0];
  assert.notEqual(secureCookie.split("=")[0], plainCookie.split("=")[0]);
  assert.match(secureLogin.cookie, /; Secure$/);
  assert.doesNotMatch(plainLogin.cookie, /; Secure/);
  const request = {
    headers: { cookie: `zhiyu_session=old-legacy-cookie; ${secureCookie}; ${plainCookie}` },
  };
  assert.ok(httpAuth.authenticate(request));
  assert.equal(
    httpAuth.authenticate({
      headers: { cookie: `zhiyu_session=old-legacy-cookie; ${secureCookie}` },
    }),
    null,
  );
  const token = httpAuth.authenticate(request).token;
  assert.match(httpAuth.logout(token), /^zhiyu_session_http=;.*Max-Age=0/);
  assert.equal(httpAuth.authenticate(request), null);
});

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
