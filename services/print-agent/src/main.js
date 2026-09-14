/**
 * Portal Print Agent — proceso principal (Electron).
 *
 * Ventana de configuración + bandeja del sistema + agente de impresión
 * (relay WebSocket → impresora TCP). Reemplaza al antiguo agente por CMD.
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join, dirname } = require("node:path");
const { createRelay } = require("./relay");

const APP_NAME = "Portal Print Agent";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "PortalPrintAgent";

let mainWindow = null;
let tray = null;
let relay = null;
let isQuitting = false;
let config = null;

// ---------------------------------------------------------------- config

function configPath() {
  return join(app.getPath("userData"), "agent.config.json");
}

function defaultConfig() {
  return { serverUrl: "https://www.portal659.com.ar", token: "", printerIp: "", printerPort: 9100 };
}

function legacyConfigPaths() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  return [join(dirname(exe), "agent.config.json")];
}

function loadConfig() {
  const path = configPath();
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      return { ...defaultConfig(), ...parsed };
    } catch {
      /* config rota → se regenera */
    }
  }
  for (const legacy of legacyConfigPaths()) {
    if (existsSync(legacy)) {
      try {
        const parsed = JSON.parse(readFileSync(legacy, "utf8"));
        const cfg = { ...defaultConfig(), ...parsed };
        saveConfig(cfg); // migrar al userData
        return cfg;
      } catch {
        /* ignorar y seguir */
      }
    }
  }
  return defaultConfig();
}

function saveConfig(next) {
  config = { ...defaultConfig(), ...next };
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
}

// ------------------------------------------------------------- autostart

function runCommandValue() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  return `"${exe}" --hidden`;
}

function reg(args) {
  return new Promise((resolve) => {
    execFile("reg", args, { windowsHide: true }, (err, stdout) => {
      resolve({ err, stdout: String(stdout || "") });
    });
  });
}

async function getAutostart() {
  if (process.platform !== "win32") return false;
  const { err, stdout } = await reg(["query", RUN_KEY, "/v", RUN_VALUE]);
  if (err) return false;
  return stdout.includes(RUN_VALUE);
}

async function setAutostart(enabled) {
  if (process.platform !== "win32") return false;
  if (enabled) {
    const { err } = await reg(["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", runCommandValue(), "/f"]);
    return !err;
  }
  const { err } = await reg(["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]);
  return !err;
}

// ----------------------------------------------------------------- window

const hideToTray = () => {
  if (!mainWindow) return;
  mainWindow.hide();
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 640,
    minWidth: 400,
    minHeight: 560,
    resizable: true,
    show: false,
    title: APP_NAME,
    icon: join(__dirname, "..", "assets", "icon.ico"),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(join(__dirname, "renderer", "index.html"));

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      hideToTray();
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!startHidden) mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Abrir links externos en el navegador del sistema.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function createTray() {
  const iconPath = join(__dirname, "..", "assets", "icon-512.png");
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  image = image.resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Abrir configuración", click: () => { mainWindow && (mainWindow.show(), mainWindow.focus()); } },
    { type: "separator" },
    { label: "Reconectar", click: () => relay && relay.reconnectNow() },
    { label: "Probar impresora", click: () => relay && relay.testPrint() },
    { type: "separator" },
    { label: "Salir", click: () => { isQuitting = true; app.quit(); } },
  ]);
}

// ------------------------------------------------------------------ IPC

function registerIpc() {
  ipcMain.handle("config:get", () => config);
  ipcMain.handle("config:save", (_e, next) => {
    saveConfig(next);
    relay && relay.reconnectNow();
    return config;
  });
  ipcMain.handle("relay:test", () => (relay ? relay.testPrint() : { ok: false, error: "Agente no inicializado" }));
  ipcMain.handle("relay:reconnect", () => (relay ? relay.reconnectNow() : null));
  ipcMain.handle("autostart:get", () => getAutostart());
  ipcMain.handle("autostart:set", (_e, enabled) => setAutostart(!!enabled));
}

// ------------------------------------------------------------------ app

let startHidden = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startHidden = process.argv.includes("--hidden") || process.argv.includes("--minimized");

    config = loadConfig();

    relay = createRelay({
      getConfig: () => config,
      onEvent: (payload) => {
        if (payload.type === "status" && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("status", payload);
        }
        if (payload.type === "print" && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("print", payload);
        }
        if (payload.type === "error" && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("error", payload);
        }
      },
    });

    registerIpc();
    createWindow();
    createTray();
    relay.start();

    app.on("activate", () => {
      if (!mainWindow) createWindow();
      else mainWindow.show();
    });
  });

  // Cerrar del todo también desde la bandeja sin dejar procesos colgados.
  app.on("before-quit", () => {
    isQuitting = true;
    relay && relay.stop();
  });

  app.on("window-all-closed", () => {
    // Con bandeja, no salimos al cerrar la ventana.
  });
}