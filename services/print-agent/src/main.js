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
const { createRelay, sanitizeAgentConfig, validateConnectionConfig } = require("./relay");
const { createLocalServer } = require("./local-server");

const APP_NAME = "Portal Print Agent";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "PortalPrintAgent";

let mainWindow = null;
let tray = null;
let relay = null;
let localServer = null;
let isQuitting = false;
let config = null;
let lastStatus = null;

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
      return sanitizeAgentConfig(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      /* config rota → se regenera */
    }
  }
  for (const legacy of legacyConfigPaths()) {
    if (existsSync(legacy)) {
      try {
        const migrated = saveConfig(JSON.parse(readFileSync(legacy, "utf8")));
        return migrated.config;
      } catch {
        /* ignorar y seguir */
      }
    }
  }
  return defaultConfig();
}

function saveConfig(next) {
  const validation = validateConnectionConfig(next);
  config = validation.config;
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
  return { config, validation };
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

function connectionStateText(status) {
  if (!status) return "Iniciando";
  if (status.online) return "Conectado";
  if (status.connection?.status === "connecting") return "Conectando";
  if (status.connection?.status === "retrying") return "Reintentando";
  if (status.connection?.status === "invalid") return "Configuración inválida";
  return "Desconectado";
}

function deliverStatus(status) {
  if (!status) return;
  lastStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send("status", status);
    } catch {}
  }
  updateTrayStatus(status);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 680,
    minWidth: 400,
    minHeight: 580,
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
  mainWindow.webContents.on("did-finish-load", () => {
    if (lastStatus) deliverStatus(lastStatus);
  });
  mainWindow.loadFile(join(__dirname, "renderer", "index.html"));

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      hideToTray();
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!startHidden) {
      mainWindow.show();
      if (lastStatus) deliverStatus(lastStatus);
    }
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

function createTray(status) {
  const iconPath = join(__dirname, "..", "assets", "icon-512.png");
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  image = image.resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip(`${APP_NAME} — ${connectionStateText(status)}`);
  tray.setContextMenu(buildTrayMenu(status));
  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      if (lastStatus) deliverStatus(lastStatus);
    }
  });
}

function updateTrayStatus(status) {
  if (!tray) return;
  tray.setToolTip(`${APP_NAME} — ${connectionStateText(status)}`);
  try {
    tray.setContextMenu(buildTrayMenu(status));
  } catch {}
}

function buildTrayMenu(status) {
  return Menu.buildFromTemplate([
    { label: `Estado: ${connectionStateText(status)}`, enabled: false },
    { label: "Abrir configuración", click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
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
    const result = saveConfig(next);
    if (relay) relay.reconnectNow();
    return result;
  });
  ipcMain.handle("status:get", () => lastStatus || (relay ? relay.getStatus() : null));
  ipcMain.handle("relay:test", () => (relay ? relay.testPrint() : { ok: false, error: "Agente no inicializado" }));
  ipcMain.handle("relay:reconnect", () => (relay ? relay.reconnectNow() : null));
  ipcMain.handle("autostart:get", () => getAutostart());
  ipcMain.handle("autostart:set", (_e, enabled) => setAutostart(!!enabled));
  ipcMain.handle("app:getInfo", () => ({
    name: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged(),
  }));
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
      if (lastStatus) deliverStatus(lastStatus);
    }
  });

  app.whenReady().then(() => {
    startHidden = process.argv.includes("--hidden") || process.argv.includes("--minimized");

    config = loadConfig();

    relay = createRelay({
      getConfig: () => config,
      onEvent: (payload) => {
        if (!payload || typeof payload !== "object") return;
        if (payload.type === "status") {
          deliverStatus(payload);
        } else if ((payload.type === "print" || payload.type === "error") && mainWindow && !mainWindow.isDestroyed()) {
          try {
            mainWindow.webContents.send(payload.type, payload);
          } catch {}
        }
      },
    });
    lastStatus = relay.getStatus();

    // Servidor local offline (127.0.0.1:8792): la PWA imprime el ticket de
    // contingencia sin pasar por el VPS. Solo-loopback, token del comercio.
    localServer = createLocalServer({
      getConfig: () => config,
      onEvent: (payload) => {
        if (!payload || typeof payload !== "object") return;
        if ((payload.type === "print" || payload.type === "error") && mainWindow && !mainWindow.isDestroyed()) {
          try {
            mainWindow.webContents.send(payload.type, payload);
          } catch {}
        }
      },
    });
    localServer.start();

    registerIpc();
    createWindow();
    createTray(lastStatus);
    relay.start();

    app.on("activate", () => {
      if (!mainWindow) createWindow();
      else {
        mainWindow.show();
        if (lastStatus) deliverStatus(lastStatus);
      }
    });
  });

  // Cerrar del todo también desde la bandeja sin dejar procesos colgados.
  app.on("before-quit", () => {
    isQuitting = true;
    relay && relay.stop();
    localServer && localServer.stop();
  });

  app.on("window-all-closed", () => {
    // Con bandeja, no salimos al cerrar la ventana.
  });
}