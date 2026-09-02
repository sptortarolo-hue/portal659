/**
 * Portal Print Agent — versión para PC (Windows/Linux/macOS).
 *
 * Se conecta al relay de Portal 659 por WebSocket saliente y envía los jobs al
 * puerto TCP de la impresora ESC/POS de la LAN (ej. TP85-NET en 9100).
 *
 * Uso:
 *   portal-print-agent.exe                → corre con agent.config.json
 *   portal-print-agent.exe                → primera vez sin config: asistente interactivo
 *   portal-print-agent.exe --setup        → reconfigura (cambió la IP o el token)
 *   portal-print-agent.exe --config x.json
 *
 * Requisitos: ninguno (el .exe es autónomo; no hace falta instalar Node ni nada).
 */
import net from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as readline from "node:readline";

const DIR = dirname(fileURLToPath(import.meta.url));

function cfgPathFromArgs() {
  const idx = process.argv.indexOf("--config");
  return idx >= 0 ? process.argv[idx + 1] : join(DIR, "agent.config.json");
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

async function interactiveSetup(path) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n=== Portal Print — Configuración inicial ===\n");
  console.log("Pegá el token que ves en tu dashboard (Comercio → Impresora → App en tu celu).");
  const token = await ask(rl, "\nToken: ");
  console.log("\nAhora la IP de la impresora (ejemplo: 192.168.1.50).");
  console.log("Si no la sabés, en la TP85 el ticket de autotest la imprime (se enciende con el botón FEED apretado).");
  const printerIp = await ask(rl, "IP de la impresora: ");
  const printerPortIn = await ask(rl, "Puerto (enter = 9100): ");
  rl.close();

  const config = {
    serverUrl: "https://www.portal659.com.ar",
    token,
    printerIp,
    printerPort: Number(printerPortIn) || 9100,
  };
  writeFileSync(path, JSON.stringify(config, null, 2));
  console.log(`\n✅ Configuración guardada en ${config.printerIp}:${config.printerPort}`);
  console.log("Desde ahora, con solo abrir este programa ya imprime. Cerrá esta ventana si querés.\n");
  return config;
}

async function readOrCreateConfig(path) {
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      console.error(`La config está rota (${e.message}). Borrando y reconfigurando...`);
    }
  }
  return interactiveSetup(path);
}

const isSetup = process.argv.includes("--setup");
const cfgPath = cfgPathFromArgs();
const cfg = isSetup ? await interactiveSetup(cfgPath) : await readOrCreateConfig(cfgPath);

const SERVER = (cfg.serverUrl || "https://www.portal659.com.ar").replace(/\/+$/, "");
const TOKEN = cfg.token || "";
const PRINTER_IP = cfg.printerIp || "";
const PRINTER_PORT = Number(cfg.printerPort) || 9100;

if (!TOKEN) {
  console.error("Falta el token en la configuración. Corrá de nuevo con --setup.");
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
function connect() {
  console.log(`[agent] conectando a ${SERVER}/printbridge ...`);
  ws = new WebSocket(wsUrl());

  ws.onopen = () => console.log("[agent] 🟢 conectado al relay — imprimirá solo");
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data || ""));
      if (msg.type === "job" && msg.jobId) {
        handleJob(msg);
      } else if (msg.type === "hello") {
        console.log("[agent] relay dice hello");
      }
    } catch {}
  };
  ws.onclose = () => {
    console.log("[agent] desconectado, reintento en 5s");
    setTimeout(connect, 5000);
  };
  ws.onerror = () => ws.close();
}

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

connect();
