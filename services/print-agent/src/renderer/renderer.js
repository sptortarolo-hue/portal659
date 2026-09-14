const $ = (id) => document.getElementById(id);

const els = {
  dot: $("status-dot"),
  label: $("status-label"),
  sub: $("status-sub"),
  detail: $("status-detail"),
  lastPrint: $("last-print"),
  printerIp: $("printerIp"),
  printerPort: $("printerPort"),
  token: $("token"),
  serverUrl: $("serverUrl"),
  autostart: $("autostart"),
  msg: $("msg"),
  version: $("app-version"),
};

const STARTUP_TIMEOUT_MS = 3000;

function setMsg(text, cls) {
  els.msg.textContent = text || "";
  els.msg.className = "msg" + (cls ? " " + cls : "");
  if (text) setTimeout(() => setMsg(""), 8000);
}

function withStartupTimeout(promise, value) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(value), STARTUP_TIMEOUT_MS)),
  ]);
}

function setStatus(dotClass, label, sub, detail) {
  els.dot.className = `dot ${dotClass}`;
  els.label.textContent = label;
  els.sub.textContent = sub;
  if (els.detail) els.detail.textContent = detail || "";
}

function describeTechnicalDetail(status, connection) {
  const parts = [];
  if (connection.endpointHost) parts.push(`Relay: ${connection.endpointHost}`);
  if (typeof status.attempt === "number" && status.attempt > 0) {
    parts.push(`Intento ${status.attempt}`);
  }
  if (connection.errorCode) parts.push(`Error: ${connection.errorCode}`);
  if (typeof connection.wsCloseCode === "number") parts.push(`Cierre WS: ${connection.wsCloseCode}`);
  return parts.join(" · ");
}

function renderStatus(status) {
  if (!status) {
    setStatus("dot-init", "Iniciando…", "Cargando configuración…", "Esperando el primer estado del agente…");
    return;
  }

  const connection = status.connection || {};
  const detail = describeTechnicalDetail(status, connection);

  if (status.online && connection.status !== "invalid") {
    setStatus(
      "dot-on",
      "Conectado",
      connection.message || "Recibiendo tickets e imprimiendo solo.",
      detail
    );
    return;
  }

  if (connection.status === "invalid") {
    setStatus(
      "dot-off",
      "Configuración inválida",
      connection.message || "Revisá los datos y guardá.",
      detail
    );
    return;
  }

  if (connection.status === "connecting") {
    setStatus(
      "dot-connecting",
      "Conectando…",
      connection.message || "Intentando conectar al portal.",
      detail
    );
    return;
  }

  if (connection.status === "retrying" && status.reconnectIn) {
    setStatus(
      "dot-off",
      "Desconectado",
      `Reintento en ${Math.round(status.reconnectIn / 1000)}s.`,
      connection.message || detail
    );
    return;
  }

  setStatus(
    "dot-off",
    "Desconectado",
    connection.message || "Sin conexión con el relay.",
    detail
  );
}

function renderLastPrint(p) {
  if (!p) return;
  const time = p.at ? new Date(p.at).toLocaleTimeString("es-AR") : "";
  const target = p.ip ? ` a ${p.ip}:${p.port || 9100}` : "";
  if (p.test) {
    els.lastPrint.textContent = p.ok
      ? `Prueba enviada correctamente${target} (${time}).`
      : `Falló la prueba${target}: ${p.error || "sin conexión a la impresora"} (${time}).`;
  } else {
    els.lastPrint.textContent = p.ok
      ? `Último ticket: ${time} (${p.bytes} bytes).`
      : `Error al imprimir: ${p.error || "desconocido"} (${time}).`;
  }
  els.lastPrint.className = "last-print " + (p.ok ? "ok" : "error");
  els.lastPrint.classList.remove("hidden");
}

function renderAppInfo(info) {
  if (els.version) {
    els.version.textContent = info && info.version ? `v${info.version}` : "";
  }
}

function populateForm(config) {
  const safe = config || {};
  els.token.value = safe.token || "";
  els.printerIp.value = safe.printerIp || "";
  els.printerPort.value = String(safe.printerPort || 9100);
  els.serverUrl.value = safe.serverUrl || "https://www.portal659.com.ar";
}

function getForm() {
  return {
    token: els.token.value.trim(),
    printerIp: els.printerIp.value.trim(),
    printerPort: Number(els.printerPort.value) || 9100,
    serverUrl: els.serverUrl.value.trim(),
  };
}

function renderValidationResult(validation) {
  const errors = validation?.errors || [];
  const warnings = validation?.warnings || [];
  if (errors.length > 0) {
    setMsg(`Configuración guardada, pero hay que corregir: ${errors.map((e) => e.message).join(" ")}`, "error");
  } else if (warnings.length > 0) {
    setMsg(`Guardado. Atención: ${warnings.map((w) => w.message).join(" ")}`, "ok");
  } else {
    setMsg("Guardado", "ok");
  }
}

// ----------------------------------------------------------------- carga

async function load() {
  if (!window.api) {
    setStatus(
      "dot-off",
      "No se inició la interfaz",
      "No se pudo cargar el puente seguro con el agente.",
      "Cerrá la app desde la bandeja y volvé a abrirla."
    );
    return;
  }

  try {
    const config = await withStartupTimeout(window.api.getConfig(), null);
    if (!config) throw new Error("timeout");
    populateForm(config);

    renderStatus(await withStartupTimeout(window.api.getStatus(), null));
    renderAppInfo(await withStartupTimeout(window.api.getInfo(), null));

    const autostartEnabled = await withStartupTimeout(window.api.getAutostart(), null);
    if (typeof autostartEnabled === "boolean") els.autostart.checked = autostartEnabled;
  } catch {
    setStatus(
      "dot-off",
      "No se inició la interfaz",
      "La ventana no recibió respuesta del proceso del agente.",
      "Probá Reconectar. Si sigue igual, cerrá desde la bandeja y volvé a abrir."
    );
  }
}

// ----------------------------------------------------------------- eventos

if (window.api) {
  window.api.onStatus(renderStatus);
  window.api.onPrint(renderLastPrint);
  window.api.onError((e) => setMsg(e.message || "Error", "error"));
}

$("btn-save").addEventListener("click", async () => {
  if (!window.api) return;
  const result = await window.api.saveConfig(getForm());
  if (result?.config) populateForm(result.config);
  renderStatus(await window.api.getStatus());
  renderValidationResult(result?.validation);
});

$("btn-reconnect").addEventListener("click", async () => {
  if (!window.api) return;
  await window.api.reconnect();
  setMsg("Reconectando…");
});

$("btn-test").addEventListener("click", async () => {
  if (!window.api) return;
  setMsg("Enviando prueba…");
  const res = await window.api.testPrint();
  const target = res?.ip ? ` a ${res.ip}:${res.port || 9100}` : "";
  setMsg(
    res?.ok ? `Prueba enviada${target}.` : `Falló${target}: ${res?.error || "sin conexión"}.`,
    res?.ok ? "ok" : "error"
  );
});

$("btn-minimize").addEventListener("click", () => {
  // La ventana se minimiza a la bandeja: usamos el cierre suave.
  window.close();
});

els.autostart.addEventListener("change", async () => {
  if (!window.api) return;
  const ok = await window.api.setAutostart(els.autostart.checked);
  if (!ok) {
    els.autostart.checked = !els.autostart.checked;
    setMsg("No se pudo cambiar el autoarranque", "error");
  }
});

load();