import { readFile, writeFile } from "node:fs/promises";
import { build } from "vite";
import { fileURLToPath } from "node:url";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = new URL("../", import.meta.url);
const preload = await readFile(new URL("electron/preload.cjs", root), "utf8");
const replaced = preload.replace(
  'const { contextBridge, ipcRenderer } = require("electron");',
  "const { contextBridge, ipcRenderer } = createBrowserTransport();",
);
if (replaced === preload)
  throw new Error("Unrecognized preload contract; review Web adapter before building");
const webBridge = replaced.replace("isDesktop: true,", 'isDesktop: false, runtime: "web",');
const bridge =
  'import { createBrowserTransport } from "./transport.js";\nexport function installBrowserBridge() {\n' +
  webBridge +
  "\n}\n";
await writeFile(new URL("web/bridge.generated.js", root), bridge);
await build({
  configFile: false,
  root: fileURLToPath(new URL("web/", root)),
  publicDir: fileURLToPath(new URL("public/", root)),
  plugins: [tailwindcss(), viteReact()],
  resolve: { alias: { "@": fileURLToPath(new URL("src/", root)) } },
  build: {
    outDir: fileURLToPath(new URL("dist-web/", root)),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
