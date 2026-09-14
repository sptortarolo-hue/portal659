/**
 * Lógica pura del agente: WebSocket saliente al relay + TCP a la impresora.
 * Misma lógica que el antiguo agent.mjs, pero sin UI y sin tocar consola.
 */
const net = require("node:net");
const { WebSocket } = require("ws");

function normalizeServer(serverUrl) {
  return (serverUrl || "https://www.portal659.com.ar").replace(/\/+$/, "");
}

function wsUrl(config) {
  const server = normalizeServer(config.serverUrl);
  const base = server.startsWith("https")
    ? server.replace(/^https/, "wss")
    : server.replace(/^http/, "ws");
  return `${base}/printbridge?token=${encodeURIComponent(config.token || "")}`;
}

/** Escribe un buffer a la impresora TCP y resuelve { ok, error }. */
function writeToTcp(ip, port, buffer, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!ip) return resolve({ ok: false, error: "Sin IP de impresora configurada" });
    const socket = net.connect({ host: ip, port: Number(port) || 9100, timeout: timeoutMs });
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve({ ok, error });
    };
    socket.on("connect", () => {
      socket.end(buffer, () => finish(true));
    });
    socket.on("error", (e) => finish(false, e.message));
    socket.on("timeout", () => finish(false, "timeout TCP"));
  });
}

/** Ticket de prueba ESC/POS (init + texto centrado + fecha + corte). */
function buildTestPayload() {
  const now = new Date().toLocaleString("es-AR");
  const cut = Buffer.from([0x1b, 0x64, 0x03, 0x1d, 0x56, 0x42, 0x00]); // feed 3 líneas + corte parcial
  return Buffer.concat([
    Buffer.from("\x1b\x40", "latin1"), // initialize
    Buffer.from("\x1b\x61\x01", "latin1"), // center
    Buffer.from("PORTAL 659\n", "latin1"),
    Buffer.from("Prueba de impresion\n", "latin1"),
    Buffer.from("\x1b\x61\x00", "latin1"), // left
    Buffer.from(`${now}\n`, "latin1"),
    cut,
  ]);
}

function createRelay({ getConfig, onEvent }) {
  let ws = null;
  let stopped = false;
  let reconnectTimer = null;
  let attempt = 0;
  let lastPrint = null;

  function emit(type, payload) {
    onEvent && onEvent({ type, ...payload });
  }

  function sendStatus(extra = {}) {
    emit("status", {
      online: !!(ws && ws.readyState === WebSocket.OPEN),
      connecting: !!ws && ws.readyState === WebSocket.CONNECTING,
      attempt,
      reconnectIn: null,
      lastPrint,
      ...extra,
    });
  }

  function printToTcp(ip, port, dataBase64, jobId) {
    const data = Buffer.from(dataBase64 || "", "base64");
    writeToTcp(ip, port, data).then(({ ok, error }) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ack", jobId, ok, error }));
        } catch {}
      }
      lastPrint = { ok, error: error || null, bytes: data.length, at: Date.now() };
      emit("print", lastPrint);
      sendStatus();
    });
  }

  function handleJob(msg) {
    const config = getConfig() || {};
    const job = msg.job ?? {};
    const ip = job.printerIp || config.printerIp;
    const port = job.printerPort ?? config.printerPort;
    if (!ip) {
      emit("error", { message: "Job sin IP de impresora configurada" });
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ack", jobId: msg.jobId, ok: false, error: "sin IP" }));
        } catch {}
      }
      return;
    }
    printToTcp(ip, port, job.payload, msg.jobId);
  }

  function connect() {
    if (stopped) return;
    const config = getConfig() || {};
    if (!config.token) {
      sendStatus({ online: false, connecting: false, reconnectIn: null });
      return;
    }
    clearTimeout(reconnectTimer);
    sendStatus({ online: false, connecting: true, reconnectIn: null });

    ws = new WebSocket(wsUrl(config));
    ws.on("open", () => {
      attempt = 0;
      sendStatus({ online: true, connecting: false, reconnectIn: null });
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === "job" && msg.jobId) handleJob(msg);
      } catch {}
    });
    ws.on("close", () => {
      sendStatus({ online: false, connecting: false });
      scheduleReconnect();
    });
    ws.on("error", () => {
      try {
        ws.close();
      } catch {}
    });
  }

  function scheduleReconnect() {
    if (stopped) return;
    attempt++;
    const delay = Math.min(5000 * attempt, 30000);
    clearTimeout(reconnectTimer);
    sendStatus({ online: false, connecting: false, reconnectIn: delay });
    reconnectTimer = setTimeout(connect, delay);
  }

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {}
      }
      ws = null;
    },
    reconnectNow() {
      stopped = false;
      clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {}
      }
      ws = null;
      connect();
    },
    /** Devuelve la config actual que usa para conectar. */
    isConnected() {
      return !!(ws && ws.readyState === WebSocket.OPEN);
    },
    async testPrint() {
      const config = getConfig() || {};
      const res = await writeToTcp(
        config.printerIp,
        config.printerPort,
        buildTestPayload(),
        5000
      );
      lastPrint = { ok: res.ok, error: res.error || null, bytes: -1, at: Date.now(), test: true };
      emit("print", lastPrint);
      sendStatus();
      return res;
    },
  };
}

module.exports = { createRelay, buildTestPayload, writeToTcp };