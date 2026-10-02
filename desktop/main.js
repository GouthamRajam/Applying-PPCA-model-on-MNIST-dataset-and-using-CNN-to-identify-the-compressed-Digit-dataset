// Senson desktop: wraps the Senson page in a window, watches the mission-data folder,
// and reports the USB/network link to the FOUP. It never sends anything to the FOUP.
const { app, BrowserWindow, ipcMain, dialog, Notification, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { FolderWatcher, foupLink } = require("./watcher");

let win = null, watcher = null, linkTimer = null, lastLink = null;
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
function defaults() {
  const lam = "C:\\LAM SensArray";
  const inbox = process.platform === "win32" && fs.existsSync(lam) ? lam : path.join(app.getPath("documents"), "Senson Inbox");
  return { watchDir: inbox, exportDir: process.platform === "win32" ? lam : inbox, mode: "ask", foupPrefix: "192.168.10." };
}
function loadSettings() {
  try { return { ...defaults(), ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) }; } catch (_) { return defaults(); }
}
let settings;
function saveSettings(s) {
  settings = { ...settings, ...s };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function startWatcher() {
  if (watcher) watcher.stop();
  try { fs.mkdirSync(settings.watchDir, { recursive: true }); } catch (_) {}
  watcher = new FolderWatcher(settings.watchDir, {
    onFile: f => {
      let text;
      try { text = fs.readFileSync(f.path, "utf8"); } catch (e) { return send("app:log", `Could not read ${f.name}: ${e.message}`); }
      send("mission:new", { ...f, text });
      if (Notification.isSupported()) new Notification({ title: "Senson: new mission data", body: f.name }).show();
      if (win) { if (win.isMinimized()) win.restore(); win.flashFrame(true); }
    },
    onError: e => send("app:log", `Watch folder not readable: ${e.message}`),
  }).start();
}
function startLinkCheck() {
  clearInterval(linkTimer);
  const check = () => {
    const l = foupLink(os, settings.foupPrefix);
    const key = l.up ? `up:${l.address}` : "down";
    if (key !== lastLink) { lastLink = key; send("foup:link", l); }
  };
  check(); linkTimer = setInterval(check, 3000);
}
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, title: "Senson", backgroundColor: "#e9edf1", icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("did-finish-load", () => { lastLink = null; startLinkCheck(); });
}

ipcMain.handle("settings:get", () => settings);
ipcMain.handle("settings:set", (_e, s) => {
  const dirChanged = s.watchDir && s.watchDir !== settings.watchDir;
  saveSettings(s);
  if (dirChanged) startWatcher();
  if (s.foupPrefix) { lastLink = null; startLinkCheck(); }
  return settings;
});
ipcMain.handle("folder:pick", async (_e, current) => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], defaultPath: current || undefined });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("file:save", (_e, { dir, name, text }) => {
  fs.mkdirSync(dir, { recursive: true });
  const safe = name.replace(/[<>:"/\\|?*]+/g, "-");
  const p = path.join(dir, safe);
  fs.writeFileSync(p, text, "utf8");
  if (watcher && path.resolve(dir) === path.resolve(settings.watchDir)) { // our own export is not a new mission
    const st = fs.statSync(p); watcher.seen.set(safe, `${Math.round(st.mtimeMs)}:${st.size}`);
  }
  return p;
});
ipcMain.handle("app:version", () => app.getVersion());

if (process.env.SENSON_USERDATA) app.setPath("userData", process.env.SENSON_USERDATA); // tests use a throwaway profile

app.whenReady().then(() => {
  settings = loadSettings();
  createWindow();
  startWatcher();
  if (process.env.SENSON_SMOKE) smokeTest(process.env.SENSON_SMOKE);
});

// End-to-end self-test (only when SENSON_SMOKE=<path to a mission csv>): drop the file into the
// watch folder, wait for Senson to open it, print what Data Viewer shows, then quit.
function smokeTest(csvPath) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  win.webContents.once("did-finish-load", async () => {
    await wait(2500);
    fs.copyFileSync(csvPath, path.join(settings.watchDir, "smoke_mission.csv"));
    await wait(7000);
    const r = await win.webContents.executeJavaScript(`({tab:document.querySelector("#docTab").textContent,
      viewer:!document.querySelector("#v-viewer").hidden, stats:document.querySelector("#dvStats").innerText,
      link:document.querySelector("#foupText").textContent, log:document.querySelector("#log").innerText.split("\\n").slice(0,6)})`);
    console.log("SMOKE " + JSON.stringify(r));
    app.quit();
  });
}
app.on("window-all-closed", () => app.quit());
