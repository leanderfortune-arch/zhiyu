import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

test("HTTP compatibility creates secure UUIDs and only copies explicitly supplied text", async () => {
  const source = await readFile(new URL("./http-compat.js", import.meta.url), "utf8");
  let copied = "",
    focusRestored = false,
    removed = false;
  const realm = vm.createContext({
    crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
    navigator: {},
    document: {
      activeElement: {
        focus() {
          focusRestored = true;
        },
      },
      createElement: () => ({
        style: {},
        select() {
          copied = this.value;
        },
        remove() {
          removed = true;
        },
      }),
      body: { append() {} },
      execCommand: (command) => command === "copy",
    },
    Uint8Array,
  });
  vm.runInContext(
    source.replace("export function", "function") + "\ninstallHttpCompatibility();",
    realm,
  );
  const ids = vm.runInContext("Array.from({length:100},()=>crypto.randomUUID())", realm);
  assert.equal(new Set(ids).size, 100);
  for (const id of ids)
    assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  await vm.runInContext('navigator.clipboard.writeText("selected text")', realm);
  assert.equal(copied, "selected text");
  assert.ok(focusRestored && removed);
  await assert.rejects(vm.runInContext("navigator.clipboard.readText()", realm), /手动粘贴/);
});
