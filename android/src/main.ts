import { PortalSocket } from "../portal-socket/src/index";

type Settings = {
  serverUrl: string;
  token: string;
  printerIp: string;
  printerPort: number;
};

const STORAGE_KEY = "portalPrint.settings.v1";

const state = {
  ws: null as WebSocket | null,
  connected: false,
  lastError: null as string | null,
};

const els = {
  serverUrl: document.getElementById("serverUrl") as HTMLInputElement,
  token: document.getElementById("token") as HTMLInputElement,
  printerIp: document.getElementById("printerIp") as HTMLInputElement,
  printerPort: document.getElementById("printerPort") as HTMLInputElement,
  btnConnect: document.getElementById("btnConnect") as HTMLButtonElement,
  btnDiscover: document.getElementById("btnDiscover") as HTMLButtonElement,
  btnTest: document.getElementById("btnTest") as HTMLButtonElement,
  btnSave: document.getElementById("btnSave") as HTMLButtonElement,
  relayDot: document.getElementById("relayDot") as HTMLSpanElement,
  printerDot: document.getElementById("printerDot") as HTMLSpanElement,
  log: document.getElementById("log") as HTMLDivElement,
};

function load(): Settings {
  const raw = localStorage.getItem(STORAGE_KEY);
  const base: Settings = {
    serverUrl: "https://www.portal659.com.ar",
    token: "",
    printerIp: "",
    printerPort: 9100,
  };
  if (raw) {
    try {
      return { ...base, ...JSON.parse(raw) };
    } catch {
      /* usar default */
    }
  }
  return base;
}

function save() {
  const settings: Settings = {
    serverUrl: els.serverUrl.value.trim(),
    token: els.token.value.trim(),
    printerIp: els.printerIp.value.trim(),
    printerPort: Number(els.printerPort.value) || 9100,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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

function getSettings(): Settings {
  return {
    serverUrl: els.serverUrl.value.trim(),
    token: els.token.value.trim(),
    printerIp: els.printerIp.value.trim(),
    printerPort: Number(els.printerPort.value) || 9100,
  };
}

function buildWsUrl(serverUrl: string): string | null {
  let url = serverUrl.trim();
  if (!url) return null;
  if (url.startsWith("http://")) url = url.replace("http://", "ws://");
  else if (url.startsWith("https://")) url = url.replace("https://", "wss://");
  else if (!url.startsWith("ws://") && !url.startsWith("wss://")) return null;
  return `${url.replace(/\/+$/, "")}/printbridge`;
}

async function connectRelay() {
  const socketUrl = buildWsUrl(getSettings().serverUrl);
  if (!socketUrl) {
    log("URL del servidor inválida (ej: https://www.portal659.com.ar)", "error");
    return;
  }
  const token = getSettings().token;
  if (!token) {
    log("Falta el token (copialo desde la sección Impresora del dashboard)", "error");
    return;
  }
  disconnectRelay();
  log(`Conectando a ${socketUrl}?token=***`);
  const ws = new WebSocket(`${socketUrl}?token=${encodeURIComponent(token)}`);
  state.ws = ws;

  ws.onopen = () => {
    state.connected = true;
    reconnectDelay = 1000; // reset del backoff
    setRelay("online");
    log("Conectado al relay", "ok");
  };

  ws.onmessage = async (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === "hello") return;
    if (msg.type === "job" && msg.jobId) {
      await handleJob(msg);
    }
  };

  ws.onclose = () => {
    state.connected = false;
    setRelay("offline");
    if (state.ws === ws) {
      scheduleReconnect();
    }
  };
  ws.onerror = () => ws.close();
}

function disconnectRelay() {
  state.connected = false;
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }
  setRelay("offline");
}

// Reconexión con backoff exponencial (1s, 2s, 4s, 8s... máximo 30s).
let reconnectDelay = 1000;
function scheduleReconnect() {
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  log(`Relay desconectado · reintento en ${Math.round(reconnectDelay / 1000)}s`, "error");
  setTimeout(() => {
    if (!state.connected) connectRelay();
  }, reconnectDelay);
}

// Guardián: si el socket está cerrado/sin respuesta (corte silencioso de red), reconecta.
setInterval(() => {
  if (!state.connected && getSettings().token) {
    connectRelay();
  }
}, 10000);

async function handleJob(msg: any) {
  const job = msg.job ?? msg;
  const settings = getSettings();
  const ip = (job.printerIp as string) || settings.printerIp;
  if (!ip) {
    log(`Pedido ${job.type}: sin IP de impresora configurada`, "error");
    ack(msg.jobId, false, "Sin IP de impresora");
    return;
  }
  log(`Pedido ${job.type}: imprimiendo en ${ip}:${job.printerPort ?? settings.printerPort}...`);
  try {
    const result = await PortalSocket.print({
      ip,
      port: job.printerPort ?? settings.printerPort,
      dataBase64: job.payload,
    });
    setPrinter("online");
    log(`Impreso en ${ip} (${result.bytes} bytes)`, "ok");
    ack(msg.jobId, true);
  } catch (e: any) {
    setPrinter("offline");
    log(`Error de impresión: ${e?.message ?? e}`, "error");
    ack(msg.jobId, false, e?.message ?? "error de impresión");
  }
}

function ack(jobId: string, ok: boolean, error?: string) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "ack", jobId, ok, error }));
  }
}

async function discoverPrinter() {
  els.btnDiscover.disabled = true;
  log("Buscando impresoras en la red (escaneo del puerto)...");
  try {
    const result = await PortalSocket.discover({ port: getSettings().printerPort, timeoutMs: 150 });
    log(`Escaneo terminado: ${result.hosts.length} host(s) encontrado(s)`, "ok");
    if (result.hosts.length > 0) {
      els.printerIp.value = result.hosts[0];
      setPrinter("online");
      log(`Primera candidata: ${result.hosts[0]}. Ajustá si hubiera más de una.`, "ok");
      save();
    } else {
      setPrinter("offline");
      log("No se encontró nada en el puerto elegido. Verificá el puerto (9100) y que el celu esté en el mismo Wi-Fi.", "error");
    }
  } catch (e: any) {
    log(`Escaneo fallido: ${e?.message ?? e}`, "error");
  } finally {
    els.btnDiscover.disabled = false;
  }
}

async function testPrint() {
  const settings = getSettings();
  if (!settings.printerIp) {
    log("Configurá primero la IP de la impresora (usan el botón Buscar)", "error");
    return;
  }
  // Buffer ESC/POS mínimo: texto en negrita centrado + feed + cut
  const text = "PORTAL PRINT\nPRUEBA OK\n";
  const mini = encodeAsciiEscPos(text);
  const dataBase64 = btoa(String.fromCharCode(...mini));
  log(`Imprimiendo prueba en ${settings.printerIp}:${settings.printerPort}...`);
  try {
    const result = await PortalSocket.print({ ip: settings.printerIp, port: settings.printerPort, dataBase64 });
    setPrinter("online");
    log(`Prueba enviada (${result.bytes} bytes)`, "ok");
  } catch (e: any) {
    setPrinter("offline");
    log(`Error: ${e?.message ?? e}`, "error");
  }
}

function encodeAsciiEscPos(text: string): number[] {
  const out: number[] = [];
  out.push(0x1b, 0x61, 0x01); // ESC a 1 (centrado)
  out.push(0x1b, 0x45, 0x01); // ESC E 1 (negrita)
  for (const ch of text) out.push(ch.charCodeAt(0) & 0xff);
  out.push(0x1b, 0x45, 0x00); // ESC E 0 (sin negrita)
  out.push(0x1b, 0x64, 0x03); // ESC d 3 (feed 3 líneas)
  out.push(0x1d, 0x56, 0x01); // GS V 1 (cut parcial)
  return out;
}

function bind() {
  els.btnConnect.addEventListener("click", () => {
    if (state.connected) disconnectRelay();
    else connectRelay();
  });
  els.btnDiscover.addEventListener("click", discoverPrinter);
  els.btnTest.addEventListener("click", testPrint);
  els.btnSave.addEventListener("click", () => {
    save();
    log("Configuración guardada", "ok");
  });
  els.printerPort.addEventListener("change", save);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !state.connected && getSettings().token) {
      connectRelay();
    }
  });
}

async function init() {
  const settings = load();
  els.serverUrl.value = settings.serverUrl;
  els.token.value = settings.token;
  els.printerIp.value = settings.printerIp;
  els.printerPort.value = String(settings.printerPort);
  bind();
  await PortalSocket.keepAwake({ enabled: true });
  log("Portal Print listo. Conectá el relay e imprimirá los pedidos de forma automática.");
  if (settings.token && settings.serverUrl) {
    connectRelay();
  }
}

init();