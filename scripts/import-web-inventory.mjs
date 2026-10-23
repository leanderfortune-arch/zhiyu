import { readFile, writeFile } from "node:fs/promises";
import { mergeInventory } from "../web/inventory.mjs";

const [originInput, inventoryFile, passwordFile, backupFile] = process.argv.slice(2);
if (!originInput || !inventoryFile || !passwordFile || !backupFile)
  throw new Error(
    "Usage: node scripts/import-web-inventory.mjs ORIGIN INVENTORY PASSWORD_FILE BACKUP_FILE",
  );
const origin = new URL(originInput).origin;
const password = (await readFile(passwordFile, "utf8")).trim();
const inventory = JSON.parse(await readFile(inventoryFile, "utf8"));
let cookie = "",
  csrf = "";
async function request(path, body) {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Request failed: ${path}, HTTP ${response.status}`);
  return response;
}
const login = await request("/api/login", { password });
cookie = login.headers.get("set-cookie").split(";")[0];
csrf = (await (await request("/api/session")).json()).csrf;
async function rpc(channel, args = []) {
  const result = await (await request("/api/rpc", { channel, args })).json();
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
try {
  const before = await rpc("store:load");
  await writeFile(backupFile, JSON.stringify(before, null, 2), { mode: 0o600, flag: "wx" });
  const merged = mergeInventory(before, inventory);
  await rpc("store:save", [merged.snapshot]);
  const verified = await rpc("store:load");
  const state = verified?.state ?? verified;
  console.log(
    JSON.stringify({
      added: merged.added,
      total: Object.fromEntries(
        ["servers", "services", "aiAssets", "links"].map((key) => [key, state[key]?.length || 0]),
      ),
    }),
  );
} finally {
  await request("/api/logout", {}).catch(() => {});
}
