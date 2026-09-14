const $ = (id) => document.getElementById(id);

const api = window.api;

const els = {
  dot: $("status-dot"),
  label: $("status-label"),
  sub: $("status-sub"),
  lastPrint: $("last-print"),
  printerIp: $("printerIp"),
  printerPort: $("printerPort"),
  token: $("token"),
  serverUrl: $("serverUrl"),
  autostart: $("autostart"),
  msg: $("msg"),
};

function setMsg(text, cls) {
  els.msg.textContent = text || "";
  els.msg.className = "msg" + (cls ? " " + cls : "");
  if (text) setTimeout(() => setMsg(""), 4000);
}

function renderStatus(s) {
  if (!s) return;
  if (s.online) {
    els.dot.className = "dot dot-on";
    els.label.textContent = "Conectado";
    els.sub.textContent = "Recibiendo tickets e imprimiendo solo";
  } else if (s.connecting) {
    els.dot.className = "dot dot-connecting";
    els.label.textContent = "Conectando\u2026";
    els.sub.textContent = "Intentando conectar al portal";
  } else if (s.reconnectIn) {
    els.dot.className = "dot dot-off";
    els.label.textContent = "Desconectado";
    els.sub.textContent = `Reintento en ${Math.round((s.reconnectIn || 0) / 1000)}s`;
  } else {
    els.dot.className = "dot dot-off";
    els.label.textContent = "Desconectado";
    els.sub.textContent = els.token.value.trim() ? "Sin token válido" : "Configurá el token para conectar";
  }
}

function renderLastPrint(p) {
  if (!p) return;
  const time = p.at ? new Date(p.at).toLocaleTimeString("es-AR") : "";
  if (p.test) {
    els.lastPrint.textContent = p.ok
      ? `Prueba enviada correctamente (${time})`
      : `Falló la prueba: ${p.error || "sin conexión a la impresora"} (${time})`;
  } else {
    els.lastPrint.textContent = p.ok
      ? `Último ticket: ${time} (${p.bytes} bytes)`
      : `Error al imprimir: ${p.error || "desconocido"} (${time})`;
  }
  els.lastPrint.className = "last-print " + (p.ok ? "ok" : "error");
  els.lastPrint.classList.remove("hidden");
}

function getForm() {
  return {
    token: els.token.value.trim(),
    printerIp: els.printerIp.value.trim(),
    printerPort: Number(els.printerPort.value) || 9100,
    serverUrl: els.serverUrl.value.trim(),
  };
}

// ----------------------------------------------------------------- carga

async function load() {
  const cfg = await api.getConfig();
  els.token.value = cfg.token || "";
  els.printerIp.value = cfg.printerIp || "";
  els.printerPort.value = String(cfg.printerPort || 9100);
  els.serverUrl.value = cfg.serverUrl || "https://www.portal659.com.ar";

  els.autostart.checked = await api.getAutostart();
}

// ----------------------------------------------------------------- eventos

$("btn-save").addEventListener("click", async () => {
  const cfg = getForm();
  await api.saveConfig(cfg);
  setMsg("Guardado", "ok");
});

$("btn-reconnect").addEventListener("click", async () => {
  await api.reconnect();
  setMsg("Reconectando\u2026");
});

$("btn-test").addEventListener("click", async () => {
  setMsg("Enviando prueba\u2026");
  const res = await api.testPrint();
  setMsg(res.ok ? "Prueba enviada" : "Falló: " + (res.error || "sin conexión"), res.ok ? "ok" : "error");
});

$("btn-minimize").addEventListener("click", () => {
  // La ventana se minimiza a la bandeja: usamos el cierre suave.
  window.close();
});

els.autostart.addEventListener("change", async () => {
  const ok = await api.setAutostart(els.autostart.checked);
  if (!ok) {
    els.autostart.checked = !els.autostart.checked;
    setMsg("No se pudo cambiar el autoarranque", "error");
  }
});

api.onStatus(renderStatus);
api.onPrint(renderLastPrint);
api.onError((e) => setMsg(e.message || "Error", "error"));

load();