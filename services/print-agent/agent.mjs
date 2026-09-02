/**
 * Print Agent — versión para PC (Windows/Linux) del puente Portal Print.
 *
 * Se conecta al relay de Portal 659 por WebSocket saliente y envía los jobs al
 * puerto TCP de la impresora ESC/POS de la LAN (ej. TP85-NET en 9100).
 *
 * Uso:
 *   node agent.mjs                       # lee agent.config.json al lado
 *   node agent.mjs --config ./mi.json    # otro archivo de config
 *
 * Requisitos: Node.js >= 22 (WebSocket nativo). Sin npm install.
 */
import net from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));

function readConfig() {
  const idx = process.argv.indexOf("--config");
  const path = idx >= 0 ? process.argv[idx + 1] : join(DIR, "agent.config.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`No pude leer la config (${path}): ${e.message}`);
    console.error("Creala con: { \"serverUrl\": \"https://www.portal659.com.ar\", \"token\": \"...\", \"printerIp\": \"192.168.1.100\", \"printerPort\": 9100 }");
    process.exit(1);
  }
}

const cfg = readConfig();
const SERVER = (cfg.serverUrl || "https://www.portal659.com.ar").replace(/\/+$/, "");
const TOKEN = cfg.token || "";
const PRINTER_IP = cfg.printerIp || "";
const PRINTER_PORT = Number(cfg.printerPort) || 9100;

if (!TOKEN) {
  console.error("Falta el token en agent.config.json (copialo del dashboard → Impresora).");
  process.exit(1);
}

function wsUrl() {
  const base = SERVER.startsWith("https") ? SERVER.replace(/^https/, "wss") : SERVER.replace(/^http/, "ws");
  return `${base}/printbridge?token=${encodeURIComponent(TOKEN)}`;
}

function printToTcp(ip, port, dataBase64, jobId, ws) {
  const data = Buffer.from(dataBase64 || "", "base64");
  const socket = net.connect({ host: ip, port, timeout: 5000 });
  const ack = (ok, error) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ack", jobId, ok, error }));
    }
  };
  socket.on("connect", () => {
    socket.end(data);
    ack(true);
    console.log(`[printer] ${new Date().toLocaleTimeString()} imprimí ${data.length} bytes en ${ip}:${port}`);
  });
  socket.on("error", (e) => {
    ack(false, e.message);
    console.error(`[printer] error TCP ${ip}:${port}: ${e.message}`);
  });
  socket.on("timeout", () => {
    socket.destroy();
    ack(false, "timeout TCP");
  });
}

let ws = null;
(function connect() {
  const url = wsUrl();
  console.log(`[agent] conectando a ${SERVER}/printbridge ...`);
  ws = new WebSocket(url);

  ws.onopen = () => console.log("[agent] conectado al relay");
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data || ""));
      if (msg.type === "job" && msg.jobId) {
        handleJob(msg);
      } else if (msg.type === "hello") {
        console.log("[agent] hello del relay");
      }
    } catch {}
  };
  ws.onclose = () => {
    console.log("[agent] desconectado, reintento en 5s");
    setTimeout(connect, 5000);
  };
  ws.onerror = () => ws.close();
})();

function handleJob(msg) {
  const job = msg.job ?? {};
  const ip = job.printerIp || PRINTER_IP;
  const port = job.printerPort ?? PRINTER_PORT;
  if (!ip) {
    console.error(`[agent] job ${msg.jobId}: sin IP de impresora configurada`);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ack", jobId: msg.jobId, ok: false, error: "sin IP" }));
    return;
  }
  printToTcp(ip, port, job.payload, msg.jobId, ws);
}
