/**
 * Lógica pura del agente: WebSocket saliente al relay + TCP a la impresora.
 * Misma lógica que el antiguo agent.mjs, pero sin UI y sin tocar consola.
 */
const net = require("node:net");
const os = require("node:os");
const { WebSocket } = require("ws");

const DEFAULT_SERVER_URL = "https://www.portal659.com.ar";
const CONNECT_TIMEOUT_MS = 10000;

function sanitizeAgentConfig(value) {
  const input = value && typeof value === "object" ? value : {};
  const serverUrl = String(input.serverUrl ?? "").trim() || DEFAULT_SERVER_URL;
  const token = String(input.token ?? "").trim();
  const printerIp = String(input.printerIp ?? "").trim();
  const rawPort = Number(input.printerPort);
  const printerPort = Number.isFinite(rawPort) ? Math.trunc(rawPort) : 9100;

  return { serverUrl, token, printerIp, printerPort };
}

function describeServerEndpoint(serverUrl) {
  const url = new URL(serverUrl);
  return { host: url.hostname || null, scheme: url.protocol };
}

function validateConnectionConfig(value) {
  const config = sanitizeAgentConfig(value);
  const errors = [];
  const warnings = [];
  let endpointHost = null;

  if (!config.token) {
    errors.push({
      field: "token",
      code: "missing-token",
      message: "Falta el token del comercio. Pegalo desde el dashboard y guardá.",
    });
  }

  try {
    const url = new URL(config.serverUrl);
    endpointHost = url.hostname || null;

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push({
        field: "serverUrl",
        code: "invalid-server-scheme",
        message: "El servidor debe empezar con http:// o https://, sin anteponer ws:// ni wss://.",
      });
    }
    if (url.username || url.password) {
      errors.push({
        field: "serverUrl",
        code: "invalid-server-auth",
        message: "El servidor no debe incluir usuario ni contraseña.",
      });
    }
    if (url.pathname && url.pathname !== "/") {
      errors.push({
        field: "serverUrl",
        code: "invalid-server-path",
        message: "El servidor debe ser solo el origen, por ejemplo https://www.portal659.com.ar.",
      });
    }
    if (url.search || url.hash) {
      errors.push({
        field: "serverUrl",
        code: "invalid-server-query",
        message: "El servidor no debe incluir parámetros ni fragmentos.",
      });
    }
    if (!endpointHost) {
      errors.push({
        field: "serverUrl",
        code: "invalid-server-host",
        message: "El servidor no tiene un nombre de host válido.",
      });
    }
  } catch {
    errors.push({
      field: "serverUrl",
      code: "invalid-server-url",
      message: "El servidor no es una URL válida.",
    });
  }

  if (config.printerIp && /\s/.test(config.printerIp)) {
    errors.push({
      field: "printerIp",
      code: "invalid-printer-ip",
      message: "La IP de la impresora no debe contener espacios.",
    });
  }
  if (!Number.isInteger(config.printerPort) || config.printerPort < 1 || config.printerPort > 65535) {
    errors.push({
      field: "printerPort",
      code: "invalid-printer-port",
      message: "El puerto debe ser un número entero entre 1 y 65535.",
    });
  }
  if (!config.printerIp) {
    warnings.push({
      field: "printerIp",
      code: "missing-printer-ip",
      message: "Falta la IP de la impresora. El agente puede conectarse, pero no podrá imprimir.",
    });
  }

  return { config, errors, warnings, endpointHost };
}

function buildWsUrl(value) {
  const validation = validateConnectionConfig(value);
  if (validation.errors.length > 0) {
    const error = new Error(validation.errors[0].message);
    error.validationErrors = validation.errors;
    throw error;
  }

  const url = new URL(validation.config.serverUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}/printbridge?token=${encodeURIComponent(validation.config.token)}`;
}

function validatePrinterConfig(value) {
  const validation = validateConnectionConfig(value);
  const printerErrors = validation.errors.filter((error) => error.field === "printerIp" || error.field === "printerPort");
  return { config: validation.config, errors: printerErrors, warnings: validation.warnings };
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

/** ¿El fallo sugiere host muerto (vs. algo vivo que rechaza)? Solo en ese caso se barre la red. */
function shouldAutoScan(error) {
  if (!error) return false;
  const text = typeof error === "string"
    ? error
    : [error.code, error.message, error.errno].filter(Boolean).join(" ");
  if (/ECONNREFUSED|refused/i.test(text)) return false;
  return /EHOSTUNREACH|No route to host|ETIMEDOUT|timed?\s?out|timeout/i.test(text);
}

/**
 * Imprime con auto-fix de DHCP: si la IP configurada está muerta, barre la
 * red y con UNA sola candidata distinta reintenta ahí. `saveIp` persiste la
 * IP corregida (el llamador la guarda donde corresponda).
 * Devuelve { ok, error, usedIp, autoFixed }. Sin dependencias nuevas.
 */
async function printWithAutoFix(ip, port, buffer, { saveIp } = {}) {
  const first = await writeToTcp(ip, port, buffer);
  if (first.ok) return { ok: true, usedIp: ip || null, autoFixed: false };
  if (!shouldAutoScan(first.error)) {
    return { ok: false, error: first.error, usedIp: ip || null, autoFixed: false };
  }
  let hosts = [];
  try {
    hosts = await discoverPrinters({ port: Number(port) || 9100 });
  } catch {
    hosts = [];
  }
  const others = (hosts || []).filter((h) => h && h !== ip);
  if (others.length === 1) {
    const retry = await writeToTcp(others[0], Number(port) || 9100, buffer);
    if (retry.ok) {
      if (typeof saveIp === "function") {
        try {
          await saveIp(others[0]);
        } catch {}
      }
      return { ok: true, usedIp: others[0], autoFixed: true };
    }
    return {
      ok: false,
      error: `${first.error} | reintento en ${others[0]}: ${retry.error}`,
      usedIp: ip || null,
      autoFixed: false,
    };
  }
  if (others.length > 1) {
    return {
      ok: false,
      error: `${first.error} | hay varias impresoras posibles: ${others.join(", ")} (elegí en Buscar)`,
      usedIp: ip || null,
      autoFixed: false,
    };
  }
  return { ok: false, error: first.error, usedIp: ip || null, autoFixed: false };
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

function describeSocketError(error) {
  if (!error) return { code: null, message: "Error de conexión desconocido" };
  const code = error.code || error.name || null;
  const message = error.message ? String(error.message) : "Error de conexión desconocido";
  return { code, message };
}

function createRelay({ getConfig, onEvent } = {}) {
  const readConfig = typeof getConfig === "function" ? getConfig : () => ({});
  let ws = null;
  let connectionSeq = 0;
  let stopped = false;
  let reconnectTimer = null;
  let connectTimer = null;
  let pendingReconnectMs = null;
  let attempt = 0;
  let lastPrint = null;
  let connection = {
    status: "idle",
    code: null,
    message: "Iniciando agente…",
    endpointHost: null,
    errorCode: null,
    wsCloseCode: null,
    updatedAt: Date.now(),
  };

  function emit(type, payload) {
    onEvent && onEvent({ type, ...payload });
  }

  function isOnline() {
    return !!(ws && ws.readyState === WebSocket.OPEN);
  }

  function isConnecting() {
    return connection.status === "connecting" || !!(ws && ws.readyState === WebSocket.CONNECTING);
  }

  function statusSnapshot() {
    return {
      online: isOnline(),
      connecting: isConnecting(),
      attempt,
      reconnectIn: pendingReconnectMs,
      lastPrint: lastPrint ? { ...lastPrint } : null,
      connection: { ...connection },
    };
  }

  function emitStatus() {
    emit("status", statusSnapshot());
  }

  function updateConnection(patch) {
    connection = { ...connection, ...patch, updatedAt: Date.now() };
    emitStatus();
  }

  function clearReconnectTimer() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    pendingReconnectMs = null;
  }

  function clearConnectTimer() {
    clearTimeout(connectTimer);
    connectTimer = null;
  }

  function printToTcp(ip, port, dataBase64, jobId) {
    const data = Buffer.from(dataBase64 || "", "base64");
    printWithAutoFix(ip, Number(port) || 9100, data, {
      saveIp: (newIp) => emit("printer-ip-fixed", { ip: newIp }),
    }).then(({ ok, error, usedIp, autoFixed }) => {
      if (isOnline()) {
        try {
          const ack = { type: "ack", jobId, ok };
          if (!ok && error) ack.error = error;
          if (usedIp) ack.printerIpUsed = usedIp;
          if (autoFixed) ack.autoFixed = true;
          ws.send(JSON.stringify(ack));
        } catch {}
      }
      lastPrint = {
        ok,
        error: error || null,
        bytes: ok ? data.length : 0,
        ip: ip || null,
        port: Number(port) || 9100,
        test: false,
        at: Date.now(),
      };
      if (usedIp) lastPrint.usedIp = usedIp;
      if (autoFixed) lastPrint.autoFixed = true;
      emit("print", { ...lastPrint });
      emitStatus();
    });
  }

  function handleJob(msg) {
    const config = sanitizeAgentConfig(readConfig());
    const job = msg.job ?? {};
    const ip = job.printerIp || config.printerIp;
    const port = job.printerPort ?? config.printerPort;
    if (!ip) {
      emit("error", { message: "Job sin IP de impresora configurada" });
      if (isOnline()) {
        try {
          ws.send(JSON.stringify({ type: "ack", jobId: msg.jobId, ok: false, error: "sin IP" }));
        } catch {}
      }
      return;
    }
    printToTcp(ip, port, job.payload, msg.jobId);
  }

  function startConnectTimeout(socket, seq, host) {
    clearConnectTimer();
    connectTimer = setTimeout(() => {
      if (stopped || seq !== connectionSeq || ws !== socket) return;
      if (!socket || socket.readyState !== WebSocket.CONNECTING) return;
      updateConnection({
        status: "connecting",
        code: "connect-timeout",
        message: `La conexión con ${host} tardó demasiado en responder.`,
        errorCode: "CONNECT_TIMEOUT",
        wsCloseCode: null,
      });
      try {
        socket.close();
      } catch {}
    }, CONNECT_TIMEOUT_MS);
  }

  function scheduleReconnect() {
    if (stopped) return;
    attempt++;
    pendingReconnectMs = Math.min(5000 * attempt, 30000);
    updateConnection({ status: "retrying" });
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, pendingReconnectMs);
  }

  function connect() {
    if (stopped) return;
    clearReconnectTimer();

    const validation = validateConnectionConfig(readConfig());
    if (validation.errors.length > 0) {
      const first = validation.errors[0];
      updateConnection({
        status: "invalid",
        code: first.code,
        message: first.message,
        endpointHost: validation.endpointHost,
        errorCode: null,
        wsCloseCode: null,
      });
      return;
    }

    const endpointHost = validation.endpointHost;
    updateConnection({
      status: "connecting",
      code: null,
      message: `Conectando con ${endpointHost}…`,
      endpointHost,
      errorCode: null,
      wsCloseCode: null,
    });

    let socket;
    let target;
    try {
      target = buildWsUrl(validation.config);
      socket = new WebSocket(target);
    } catch (error) {
      updateConnection({
        status: "invalid",
        code: "invalid-websocket-url",
        message: error.message || "No se pudo construir la URL del relay.",
        endpointHost,
        errorCode: null,
        wsCloseCode: null,
      });
      return;
    }

    const seq = ++connectionSeq;
    ws = socket;
    startConnectTimeout(socket, seq, endpointHost);

    socket.on("open", () => {
      if (stopped || seq !== connectionSeq || ws !== socket) {
        try {
          socket.close();
        } catch {}
        return;
      }
      clearConnectTimer();
      clearReconnectTimer();
      attempt = 0;
      updateConnection({
        status: "online",
        code: null,
        message: `Conectado con ${endpointHost}.`,
        endpointHost,
        errorCode: null,
        wsCloseCode: null,
      });
    });
    socket.on("message", (data) => {
      if (stopped || seq !== connectionSeq || ws !== socket) return;
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === "job" && msg.jobId) handleJob(msg);
      } catch {}
    });
    socket.on("error", (error) => {
      if (stopped || seq !== connectionSeq || ws !== socket) {
        try {
          socket.close();
        } catch {}
        return;
      }
      const detail = describeSocketError(error);
      updateConnection({
        status: "connecting",
        code: "connect-failed",
        message: `No se pudo conectar con ${endpointHost}: ${detail.message}`,
        endpointHost,
        errorCode: detail.code,
        wsCloseCode: null,
      });
      try {
        socket.close();
      } catch {}
    });
    socket.on("close", (code, reason) => {
      if (stopped || seq !== connectionSeq || ws !== socket) return;
      clearConnectTimer();
      if (!connection.errorCode && connection.status !== "online") {
        const text = reason ? String(reason) : "sin motivo informado";
        updateConnection({
          status: "connecting",
          code: "connection-closed",
          message: `La conexión con ${endpointHost} se cerró (código ${code}, ${text}).`,
          endpointHost,
          errorCode: null,
          wsCloseCode: typeof code === "number" ? code : null,
        });
      } else if (connection.status === "online") {
        const text = reason ? String(reason) : "sin motivo informado";
        updateConnection({
          status: "connecting",
          code: "connection-closed",
          message: `Se perdió la conexión con ${endpointHost} (código ${code}, ${text}).`,
          endpointHost,
          errorCode: null,
          wsCloseCode: typeof code === "number" ? code : null,
        });
      } else {
        updateConnection({ status: "connecting" });
      }
      scheduleReconnect();
    });
  }

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      connectionSeq += 1;
      clearReconnectTimer();
      clearConnectTimer();
      if (ws) {
        try {
          ws.close();
        } catch {}
      }
      ws = null;
      updateConnection({ status: "idle", code: null, message: "Agente detenido." });
    },
    reconnectNow() {
      stopped = false;
      connectionSeq += 1;
      clearReconnectTimer();
      clearConnectTimer();
      if (ws) {
        try {
          ws.close();
        } catch {}
      }
      ws = null;
      connect();
    },
    getStatus() {
      return statusSnapshot();
    },
    isConnected() {
      return isOnline();
    },
    async testPrint() {
      const validation = validatePrinterConfig(readConfig());
      if (validation.errors.length > 0) {
        const first = validation.errors[0];
        lastPrint = {
          ok: false,
          error: first.message,
          code: first.code,
          bytes: 0,
          ip: validation.config.printerIp || null,
          port: validation.config.printerPort,
          test: true,
          at: Date.now(),
        };
        emit("print", { ...lastPrint });
        emitStatus();
        return { ok: false, error: first.message, code: first.code };
      }

      const testBuffer = buildTestPayload();
      const res = await writeToTcp(
        validation.config.printerIp,
        validation.config.printerPort,
        testBuffer,
        5000
      );
      lastPrint = {
        ok: res.ok,
        error: res.error || null,
        code: res.ok ? null : "printer-tcp-failed",
        bytes: res.ok ? testBuffer.length : 0,
        ip: validation.config.printerIp,
        port: validation.config.printerPort,
        test: true,
        at: Date.now(),
      };
      emit("print", { ...lastPrint });
      emitStatus();
      return {
        ok: res.ok,
        error: res.error || null,
        code: lastPrint.code,
        ip: validation.config.printerIp,
        port: validation.config.printerPort,
      };
    },
  };
}

module.exports = {
  createRelay,
  sanitizeAgentConfig,
  validateConnectionConfig,
  validatePrinterConfig,
  buildWsUrl,
  buildTestPayload,
  writeToTcp,
  printWithAutoFix,
  shouldAutoScan,
  discoverPrinters,
  localSubnets,
  DEFAULT_SERVER_URL,
  CONNECT_TIMEOUT_MS,
};

/**
 * Subredes /24 locales (IPv4 no internas): el barrido de impresoras las
 * recorre buscando el puerto 9100 abierto.
 */
function localSubnets() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs || {})) {
    for (const nic of list || []) {
      if (!nic || nic.family !== "IPv4" || nic.internal) continue;
      const parts = String(nic.address || "").split(".").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) continue;
      out.push(`${parts[0]}.${parts[1]}.${parts[2]}`);
    }
  }
  return [...new Set(out)].slice(0, 3);
}

/**
 * Busca impresoras térmicas (TCP puerto abierto) en la red local.
 * options: { port=9100, timeoutMs=250, subnets? } — `subnets` solo para
 * tests (ej. ["127.0.0"]). Devuelve hosts ordenados. Sin dependencias.
 */
function discoverPrinters({ port = 9100, timeoutMs = 250, subnets } = {}) {
  const destPort = Number.isFinite(Number(port)) && Number(port) > 0 && Number(port) < 65536
    ? Math.trunc(Number(port))
    : 9100;
  const perHostMs = Math.max(100, Math.min(1000, Number(timeoutMs) || 250));
  const nets = Array.isArray(subnets) && subnets.length > 0 ? subnets : localSubnets();
  const CONCURRENCY = 64;
  return new Promise((resolve) => {
    const targets = [];
    for (const n of nets) {
      for (let h = 1; h <= 254; h++) targets.push(`${n}.${h}`);
    }
    const found = new Set();
    let idx = 0;
    let active = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        resolve([...found].sort());
      } catch {
        resolve([]);
      }
    };
    if (targets.length === 0) {
      finish();
      return;
    }
    const overall = setTimeout(finish, Math.max(3000, perHostMs * 6 + 4000));
    const pump = () => {
      if (done) return;
      while (active < CONCURRENCY && idx < targets.length) {
        const target = targets[idx++];
        active++;
        let settled = false;
        const socket = net.connect({ host: target, port: destPort, timeout: perHostMs });
        const settle = (ok) => {
          if (settled) return;
          settled = true;
          active--;
          if (ok) found.add(target);
          try {
            socket.destroy();
          } catch {}
          pump();
        };
        socket.on("connect", () => settle(true));
        socket.on("error", () => settle(false));
        socket.on("timeout", () => settle(false));
      }
      if (idx >= targets.length && active === 0) {
        clearTimeout(overall);
        finish();
      }
    };
    pump();
  });
}