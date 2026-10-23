import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

test("login stays on the form with an explanation if the browser discards its cookie", async () => {
  const source = await readFile(new URL("./login.js", import.meta.url), "utf8");
  let submit,
    navigated = false;
  const button = { disabled: false, textContent: "登录工作空间" };
  const error = { textContent: "" };
  const calls = [];
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        return selector === "#login"
          ? {
              addEventListener(_name, fn) {
                submit = fn;
              },
            }
          : selector === "button"
            ? button
            : selector === "#error"
              ? error
              : { value: "fixture-password" };
      },
    },
    fetch: async (url) => {
      calls.push(url);
      return url === "/api/login"
        ? { ok: true, json: async () => ({ ok: true }) }
        : { ok: false, status: 401 };
    },
    location: {
      replace() {
        navigated = true;
      },
    },
  });
  vm.runInContext(source, context);
  await submit({ preventDefault() {} });
  assert.deepEqual(calls, ["/api/login", "/api/session"]);
  assert.equal(navigated, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "登录工作空间");
  assert.match(error.textContent, /Cookie/);
});
