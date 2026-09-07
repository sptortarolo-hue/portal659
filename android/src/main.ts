import { PortalSocket } from "../portal-socket/src/index";

/**
 * UI de Portal Print. No mantiene el WebSocket: lo mantiene el servicio nativo
 * PortalPrintService (Java). Esta pantalla solo configura el token/IP, arranca
 * o detiene el servicio (#connect/#detener) y muestra el estado en vivo.
 */

type Settings = {
  serverUrl: string;
  token: string;
  printerIp: string;
  printerPort: number;
};

const STORAGE_KEY = "portalPrint.settings.v1";

const els = {
  serverUrl: document.getElementById("serverUrl") as HTMLInputElement,
  token: document.getElementById("token") as HTMLInputElement,
  printerIp: document.getElementById("printerIp") as HTMLInputElement,
  printerPort: document.getElementById("printerPort") as HTMLInputElement,
  btnDiscover: document.getElementById("btnDiscover") as HTMLButtonElement,
  btnTest: document.getElementById("btnTest") as HTMLButtonElement,
  btnSave: document.getElementById("btnSave") as HTMLButtonElement,
  btnStop: document.getElementById("btnStop") as HTMLButtonElement,
  relayDot: document.getElementById("relayDot") as HTMLSpanElement,
  printerDot: document.getElementById("printerDot") as HTMLSpanElement,
  log: document.getElementById("log") as HTMLDivElement,
};

const active = { state: false };

function updateStopBtn() {
  if (active.state) {
    els.btnStop.textContent = "⏹ Detener impresión";
    els.btnStop.classList.remove("stopped");
    els.btnStop.classList.add("running");
  } else {
    els.btnStop.textContent = "▶️  Iniciar impresión";
    els.btnStop.classList.remove("running");
    els.btnStop.classList.add("stopped");
  }
}

function load(): Settings {
  const raw = localStorage.getItem(STORAGE_KEY);
  const base: Settings = {
    serverUrl: "https://www.portal659.com.ar",
    token: "",
    printerIp: "",
    printerPort: 9100,
  };
  if (raw) {
    try { return { ...base, ...JSON.parse(raw) }; } catch {}
  }
  return base;
}

function getSettings(): Settings {
  return {
    serverUrl: els.serverUrl.value.trim() || "https://www.portal659.com.ar",
    token: els.token.value.trim(),
    printerIp: els.printerIp.value.trim(),
    printerPort: Number(els.printerPort.value) || 9100,
  };
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getSettings()));
}

function log(message: string, kind: "info" | "ok" | "error" = "info") {
  const time = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const line = document.createElement("div");
  line.className = `log-line log-${kind}`;
  line.textContent = `${time} · ${message}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

function setRelay(status: "online" | "offline") {
  els.relayDot.dataset.status = status === "online" ? "ok" : "off";
  els.relayDot.textContent = status === "online" ? "🟢" : "🔴";
}

function setPrinter(status: "online" | "offline") {
  els.printerDot.dataset.status = status === "online" ? "ok" : "off";
  els.printerDot.textContent = status === "online" ? "🟢" : "🔴";
}

async function startService() {
  try {
    await PortalSocket.saveConfig(getSettings());
    await PortalSocket.setActive({ active: true });
    active.state = true;
    updateStopBtn();
    log("Servicio iniciado (funciona en segundo plano)", "ok");
  } catch (e: any) {
    log(`No se pudo iniciar: ${e?.message ?? e}`, "error");
  }
}

async function stopService() {
  try {
    await PortalSocket.setActive({ active: false });
    active.state = false;
    updateStopBtn();
    setRelay("offline");
    log("Detenido. No volverá a arrancar solo hasta que lo inicies.", "error");
  } catch (e: any) {
    log(`No se pudo detener: ${e?.message ?? e}`, "error");
  }
}

async function toggleService() {
  if (active.state) {
    await stopService();
  } else {
    if (!getSettings().token) {
      log("Falta el token (copialo del dashboard → Impresora)", "error");
      return;
    }
    await startService();
  }
}

async function refreshStatus() {
  try {
    const s = await PortalSocket.status();
    active.state = !!s.enabled;
    updateStopBtn();
    setRelay(s.conn === "connected" ? "online" : "offline");
  } catch {}
}

async function testPrint() {
  const settings = getSettings();
  if (!settings.printerIp) {
    log("Configurá la IP de la impresora (usá el botón Buscar)", "error");
    return;
  }
  const mini = encodeAsciiEscPos("PORTAL PRINT\nPRUEBA OK\n");
  const dataBase64 = btoa(String.fromCharCode(...mini));
  try {
    const result = await PortalSocket.print({ ip: settings.printerIp, port: settings.printerPort, dataBase64 });
    setPrinter("online");
    log(`Prueba enviada (${result.bytes} bytes)`, "ok");
  } catch (e: any) {
    setPrinter("offline");
    log(`Error: ${e?.message ?? e}`, "error");
  }
}

async function discoverPrinter() {
  els.btnDiscover.disabled = true;
  log("Buscando impresoras en la red...");
  try {
    const result = await PortalSocket.discover({ port: getSettings().printerPort, timeoutMs: 150 });
    if (result.hosts.length > 0) {
      els.printerIp.value = result.hosts[0];
      setPrinter("online");
      log(`Candidata: ${result.hosts[0]}`, "ok");
      saveLocal();
    } else {
      setPrinter("offline");
      log("No se encontró nada. Verificá el puerto y que el celu esté en el mismo Wi-Fi.", "error");
    }
  } catch (e: any) {
    log(`Escaneo fallido: ${e?.message ?? e}`, "error");
  } finally {
    els.btnDiscover.disabled = false;
  }
}

function encodeAsciiEscPos(text: string): number[] {
  const out: number[] = [];
  out.push(0x1b, 0x61, 0x01); // centrado
  out.push(0x1b, 0x45, 0x01); // negrita
  for (const ch of text) out.push(ch.charCodeAt(0) & 0xff);
  out.push(0x1b, 0x45, 0x00);
  out.push(0x1b, 0x64, 0x03); // feed
  out.push(0x1d, 0x56, 0x01); // cut
  return out;
}

function bind() {
  els.btnSave.addEventListener("click", async () => {
    saveLocal();
    await PortalSocket.saveConfig(getSettings());
    await refreshStatus();
    log("Configuración guardada", "ok");
  });
  els.btnStop.addEventListener("click", toggleService);
  els.btnDiscover.addEventListener("click", discoverPrinter);
  els.btnTest.addEventListener("click", testPrint);
  els.printerPort.addEventListener("change", saveLocal);
}

async function init() {
  const settings = load();
  els.serverUrl.value = settings.serverUrl;
  els.token.value = settings.token;
  els.printerIp.value = settings.printerIp;
  els.printerPort.value = String(settings.printerPort);
  bind();

  try { await PortalSocket.requestNotifPermission(); } catch {}
  try {
    const s = await PortalSocket.status();
    active.state = !!s.enabled;
    updateStopBtn();
    setRelay(s.conn === "connected" ? "online" : "offline");
  } catch {}

  log("Portal Print listo. Imprime en segundo plano, sin necesidad de esta pantalla abierta.");
  refreshStatus();
  setInterval(refreshStatus, 4000);
}

// Primer uso: exclusión de optimización de batería.
window.addEventListener("load", () => {
  try {
    if (localStorage.getItem("portalPrint.askedBattery") !== "1") {
      localStorage.setItem("portalPrint.askedBattery", "1");
      PortalSocket.requestBatteryExemption().catch(() => {});
    }
  } catch {}
});

init();