/** Real form regression: a legacy Secure cookie must not break HTTP login. */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const [originInput, passwordFile, screenshot] = process.argv.slice(2);
if (!originInput || !passwordFile || !screenshot)
  throw new Error("Usage: node scripts/web-login-smoke.mjs HTTP_ORIGIN PASSWORD_FILE SCREENSHOT");
const origin = new URL(originInput).origin;
if (!origin.startsWith("http:")) throw new Error("This regression exercises the HTTP login path");
const password = readFileSync(passwordFile, "utf8").trim();
process.umask(0o077);
const stateDirectory = mkdtempSync(join(tmpdir(), "zhiyu-login-state-"));
const stateFile = join(stateDirectory, "state.json");
const session = "zhiyu-login-" + randomUUID().slice(0, 8);
function run(args, input) {
  const result = spawnSync("agent-browser", ["--session", session, ...args], {
    encoding: "utf8",
    timeout: 45_000,
    input,
  });
  if (result.status !== 0)
    throw new Error(
      (
        result.stderr ||
        result.stdout ||
        result.error?.message ||
        "Browser command failed"
      ).replaceAll(password, "<redacted>"),
    );
  return result.stdout.trim();
}
let activeCookie;
try {
  const secureUrl = origin.replace(/^http:/, "https:") + "/";
  for (const name of ["zhiyu_session", "zhiyu_session_https"])
    run([
      "cookies",
      "set",
      name,
      "previous-https-session",
      "--url",
      secureUrl,
      "--secure",
      "--httpOnly",
      "--sameSite",
      "Strict",
    ]);
  run(["open", origin + "/login"]);
  run(["snapshot", "-i"]);
  run([
    "eval",
    "localStorage.setItem('sinan-settings-v1', JSON.stringify({state:{language:'zh'},version:0}))",
  ]);
  run(
    ["batch", "--bail"],
    JSON.stringify([
      ["fill", "#password", password],
      ["click", "#login button"],
      [
        "wait",
        "--fn",
        "location.pathname === '/' && !!document.querySelector('[data-app-ready=true]')",
      ],
    ]),
  );
  const url = run(["get", "url"]);
  if (new URL(url).pathname !== "/") throw new Error("The form returned to the login page");
  // `cookies get` only returns cookies visible to the current HTTP URL.
  // Saved context state also includes the legacy Secure cookies for HTTPS.
  run(["state", "save", stateFile]);
  const cookies = JSON.parse(readFileSync(stateFile, "utf8")).cookies;
  activeCookie = cookies.find((cookie) => cookie.name === "zhiyu_session_http");
  if (!activeCookie || activeCookie.secure) throw new Error("HTTP login cookie was not accepted");
  if (!cookies.some((cookie) => cookie.name === "zhiyu_session" && cookie.secure))
    throw new Error("Legacy Secure-cookie fixture was lost");
  run(["screenshot", screenshot]);
  console.log(
    JSON.stringify({
      ok: true,
      url,
      legacySecureCookieRetained: true,
      httpSessionAccepted: true,
      screenshot,
    }),
  );
} finally {
  try {
    run(["close"]);
  } finally {
    rmSync(stateDirectory, { recursive: true, force: true });
  }
  if (activeCookie) {
    const headers = { Cookie: `${activeCookie.name}=${activeCookie.value}` };
    const response = await fetch(origin + "/api/session", { headers });
    if (response.ok) {
      const { csrf } = await response.json();
      await fetch(origin + "/api/logout", {
        method: "POST",
        headers: {
          ...headers,
          Origin: origin,
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        body: "{}",
      });
    }
  }
}
