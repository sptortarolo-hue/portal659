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
 *   GET /local-scan?token=...&port=9100 → { ok, hosts } (Buscar desde web).
 *   POST /local-config { token, printerIp } → { ok } (fija IP desde web).
 */
const http = require("node:http");
const { sanitizeAgentConfig, printWithAutoFix, discoverPrinters } = require("./relay");

const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = 8792;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
    // CORS + Private Network Access: la PWA (https) llama a este loopback
    // por fetch; sin estos headers el navegador bloquea la respuesta (y el
    // preflight de los POST con JSON). Solo-loopback + token ya autentican.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
  });
  res.end(text);
}

function preflight(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Content-Length": 0,
  });
  res.end();
}

function createLocalServer({ getConfig, onEvent, port = LOCAL_PORT } = {}) {
  const readConfig = typeof getConfig === "function" ? getConfig : () => ({});
  let server = null;
  let listening = false;

  function emit(type, payload) {
    onEvent && onEvent({ type, ...payload });
  }

  function readJsonBody(req, res, onBody) {
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
      onBody(body, reply);
    });
  }

  function handlePrint(req, res) {
    readJsonBody(req, res, (body, reply) => {
      const auth = checkToken(body?.token);
      if (!auth.ok) {
        reply(401, { ok: false, error: auth.error });
        return;
      }
      const config = auth.config;
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
      printWithAutoFix(ip, destPort, data, {
        saveIp: (newIp) => emit("printer-ip-fixed", { ip: newIp }),
      }).then(({ ok, error, usedIp, autoFixed }) => {
        emit("print", {
          ok,
          error: error || null,
          bytes: ok ? data.length : 0,
          ip: ip || null,
          port: destPort,
          test: false,
          local: true,
          at: Date.now(),
          ...(usedIp ? { usedIp } : {}),
          ...(autoFixed ? { autoFixed: true } : {}),
        });
        if (ok) {
          reply(200, autoFixed ? { ok: true, autoFixed: true, printerIpUsed: usedIp } : { ok: true });
        } else {
          reply(200, { ok: false, error: error || "no se pudo imprimir" });
        }
      });
    });
  }

  function checkToken(bodyToken) {
    const config = sanitizeAgentConfig(readConfig());
    if (!config.token) return { ok: false, config, error: "agente sin token configurado" };
    if (String(bodyToken ?? "") !== config.token) return { ok: false, config, error: "token inválido" };
    return { ok: true, config };
  }

  return {
    start() {
      if (server) return;
      server = http.createServer((req, res) => {
        let url;
        try {
          url = new URL(req.url || "/", "http://127.0.0.1");
        } catch {
          url = { pathname: "/", searchParams: new URLSearchParams() };
        }
        const path = url.pathname;
        // Preflight CORS/PNA (navegadores lo exigen antes de GET/POST
        // cross-origin a red privada/loopback).
        if (req.method === "OPTIONS") {
          preflight(res);
          return;
        }
        if (req.method === "GET" && path === "/local-status") {
          json(res, 200, { ok: true, service: "portal-print-agent", local: true, port });
          return;
        }
        // Buscar impresoras desde la web (mismo auth por token).
        if (req.method === "GET" && path === "/local-scan") {
          const auth = checkToken(url.searchParams.get("token"));
          if (!auth.ok) {
            json(res, 401, { ok: false, error: auth.error });
            return;
          }
          const rawPort = Number(url.searchParams.get("port"));
          const scanPort = Number.isFinite(rawPort) && rawPort > 0 && rawPort < 65536 ? Math.trunc(rawPort) : 9100;
          discoverPrinters({ port: scanPort })
            .then((hosts) => json(res, 200, { ok: true, hosts: hosts || [] }))
            .catch((e) => json(res, 200, { ok: true, hosts: [], error: e?.message || null }));
          return;
        }
        if (req.method === "POST" && path === "/local-print") {
          handlePrint(req, res);
          return;
        }
        // Fijar IP desde la web (la persiste main.js vía evento).
        if (req.method === "POST" && path === "/local-config") {
          readJsonBody(req, res, (body) => {
            const auth = checkToken(body?.token);
            if (!auth.ok) {
              json(res, 401, { ok: false, error: auth.error });
              return;
            }
            const ip = String(body?.printerIp ?? "").trim();
            if (!ip || ip.length > 64) {
              json(res, 400, { ok: false, error: "IP inválida" });
              return;
            }
            emit("printer-ip-fixed", { ip, fromWeb: true });
            json(res, 200, { ok: true, printerIp: ip });
          });
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
