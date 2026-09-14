const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  testPrint: () => ipcRenderer.invoke("relay:test"),
  reconnect: () => ipcRenderer.invoke("relay:reconnect"),
  getAutostart: () => ipcRenderer.invoke("autostart:get"),
  setAutostart: (enabled) => ipcRenderer.invoke("autostart:set", enabled),
  onStatus: (cb) => ipcRenderer.on("status", (_e, data) => cb(data)),
  onPrint: (cb) => ipcRenderer.on("print", (_e, data) => cb(data)),
  onError: (cb) => ipcRenderer.on("error", (_e, data) => cb(data)),
});