import { installHttpCompatibility } from "./http-compat.js";
import { installBrowserBridge } from "./bridge.generated.js";
import { createRoot } from "react-dom/client";

import "@/styles.css";

installHttpCompatibility();
installBrowserBridge();
// Stores choose their persistence adapter at module initialization. Install first.
const { AppShell } = await import("@/components/app-shell");
document.documentElement.classList.add("is-web");
const host = document.getElementById("root");
if (!host) throw new Error("缺少应用挂载点");
createRoot(host).render(<AppShell />);
