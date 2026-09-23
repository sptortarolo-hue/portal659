/**
 * Servidor local de impresión offline (Track Impresión F2).
 *
 * Escucha SOLO en 127.0.0.1:8792 (nunca en LAN): el browser de la PWA
 * puede hacerle fetch (localhost es origen trustworthy, sin mixed content
 * desde HTTPS) y ningún otro equipo de la red llega a este puerto.
 *
 * Contrato (el mismo que implementa la app Android en :8793):
 *   POST /local-print { token, payload, printerIp?, printerPort? }
 *     token: el del comercio (mismo del relay). Sin match → 401.
 *     payload: bytes ESC/POS en base64 (los renderiza la PWA: ticket de
 *       contingencia, solo-texto, provisorio — ver src/lib/offline-print.ts).
 *     → { ok: true } | { ok: false, error }
 *   GET /local-status → { ok: true, service, local, port } (diagnóstico).
 */
const http = require("node:http");
const { sanitizeAgentConfig, writeToTcp } = require("./relay");

const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = 8792;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function createLocalServer({ getConfig, onEvent, port = LOCAL_PORT } = {}) {
  const readConfig = typeof getConfig === "function" ? getConfig : () => ({});
  let server = null;
  let listening = false;

  function emit(type, payload) {
    onEvent && onEvent({ type, ...payload });
  }

  function handlePrint(req, res) {
    let size = 0;
    const chunks = [];
    let answered = false;
    const reply = (status, body) => {
      if (answered) return;
      answered = true;
      json(res, status, body);
    };
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reply(413, { ok: false, error: "cuerpo demasiado grande" });
        try {
          req.destroy();
        } catch {}
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (answered) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        reply(400, { ok: false, error: "JSON inválido" });
        return;
      }
      if (!body || typeof body !== "object") {
        reply(400, { ok: false, error: "JSON inválido" });
        return;
      }
      const config = sanitizeAgentConfig(readConfig());
      if (!config.token) {
        reply(401, { ok: false, error: "agente sin token configurado" });
        return;
      }
      if (String(body.token ?? "") !== config.token) {
        reply(401, { ok: false, error: "token inválido" });
        return;
      }
      let data;
      try {
        data = Buffer.from(String(body.payload ?? ""), "base64");
      } catch {
        reply(400, { ok: false, error: "payload inválido" });
        return;
      }
      if (data.length === 0) {
        reply(400, { ok: false, error: "payload vacío" });
        return;
      }
      const ip = String(body.printerIp ?? "").trim() || config.printerIp;
      const rawPort = Number(body.printerPort);
      const destPort = Number.isFinite(rawPort) && rawPort > 0 ? Math.trunc(rawPort) : config.printerPort;
      writeToTcp(ip, destPort, data).then(({ ok, error }) => {
        emit("print", {
          ok,
          error: error || null,
          bytes: ok ? data.length : 0,
          ip: ip || null,
          port: destPort,
          test: false,
          local: true,
          at: Date.now(),
        });
        reply(200, ok ? { ok: true } : { ok: false, error: error || "no se pudo imprimir" });
      });
    });
  }

  return {
    start() {
      if (server) return;
      server = http.createServer((req, res) => {
        let path = "/";
        try {
          path = new URL(req.url || "/", "http://127.0.0.1").pathname;
        } catch {
          /* path por defecto */
        }
        if (req.method === "GET" && path === "/local-status") {
          json(res, 200, { ok: true, service: "portal-print-agent", local: true, port });
          return;
        }
        if (req.method === "POST" && path === "/local-print") {
          handlePrint(req, res);
          return;
        }
        json(res, 404, { ok: false, error: "no encontrado" });
      });
      server.on("error", () => {
        listening = false;
      });
      server.listen(port, LOCAL_HOST, () => {
        listening = true;
      });
    },
    stop() {
      listening = false;
      if (server) {
        try {
          server.close();
        } catch {}
        server = null;
      }
    },
    getInfo() {
      return { listening, host: LOCAL_HOST, port };
    },
    isListening() {
      return listening;
    },
  };
}

module.exports = {
  createLocalServer,
  LOCAL_HOST,
  LOCAL_PORT,
};
