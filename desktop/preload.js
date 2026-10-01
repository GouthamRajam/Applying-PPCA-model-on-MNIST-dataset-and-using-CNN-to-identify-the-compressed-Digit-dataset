// The only bridge between the page and the computer: a small, fixed set of calls.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("senson", {
  desktop: true,
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: s => ipcRenderer.invoke("settings:set", s),
  pickFolder: current => ipcRenderer.invoke("folder:pick", current),
  saveFile: (dir, name, text) => ipcRenderer.invoke("file:save", { dir, name, text }),
  version: () => ipcRenderer.invoke("app:version"),
  onMission: cb => ipcRenderer.on("mission:new", (_e, d) => cb(d)),
  onLink: cb => ipcRenderer.on("foup:link", (_e, d) => cb(d)),
  onLog: cb => ipcRenderer.on("app:log", (_e, m) => cb(m)),
});
