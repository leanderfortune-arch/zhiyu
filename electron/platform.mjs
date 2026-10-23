/** Keep transport and OS dependencies outside the shared domain runtime. */
export const webMode = process.env.ZHIYU_WEB === "1";
const platform = webMode ? await import("../web/platform.mjs") : await import("electron");
export const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Menu,
  net,
  Tray,
  nativeImage,
  Notification,
  safeStorage,
  screen,
  powerMonitor,
} = platform;
export const webPublish = platform.publish ?? (() => {});
export const isWebEvent = platform.isWebEvent ?? (() => false);

export const registerWebCallback = platform.registerCallback ?? (() => {});

export const aiFetch = platform.aiFetch ?? ((...args) => fetch(...args));
