/**
 * E2E del relay sin celular:
 * 1. Levanta el relay en un puerto de prueba.
 * 2. Levanta test/client.mjs (app falsa) con un capturador TCP local.
 * 3. Genera un buffer ESC/POS real con node-thermal-printer.
 * 4. Lo manda por /push. Espera ack ok y que el capturador haya recibido bytes.
 *
 * Uso: node test/e2e.mjs   (desde services/print-bridge)
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { ThermalPrinter, PrinterTypes } = require("node-thermal-printer");

const RELAY_PORT = 8851;
const CAPTURE_PORT = 9999;
const SECRET = "dev-e2e";
const TOKEN = "e2e-token";
const BASE = `http://127.0.0.1:${RELAY_PORT}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs = 15000, step = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}

function spawnNode(args, env, cwd) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (out += d.toString()));
  return { child, getOut: () => out };
}

async function buildTestBuffer() {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: "tcp://0.0.0.0:9100",
    width: 48,
  });
  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println("PRUEBA E2E PORTAL PRINT");
  printer.setTextSize(0, 0);
  printer.bold(false);
  printer.println("ancho 80mm");
  printer.cut();
  return (await printer.getBuffer()).toString("base64");
}

async function run() {
  const cwd = dirname(dirname(fileURLToPath(import.meta.url)));

  const relay = spawnNode(["index.mjs"], { PORT: String(RELAY_PORT), PRINT_BRIDGE_SECRET: SECRET }, cwd);

  try {
    // 1) Push SIN cliente conectado: el relay debe encolar el job (no perderlo).
    console.log("[e2e] push sin cliente conectado (debe encolar)...");
    await sleep(400); // el relay tarda un pelín en levantar
    const payloadQueudable = await buildTestBuffer();
    const resQueued = await fetch(`${BASE}/push`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-secret": SECRET },
      body: JSON.stringify({
        token: TOKEN,
        job: { type: "test", payload: payloadQueudable, printerIp: "127.0.0.1", printerPort: CAPTURE_PORT, width: 48 },
      }),
    });
    const queuedData = await resQueued.json();
    if (!queuedData.ok || !queuedData.queued) {
      console.error("[e2e] FAIL: el push offline no se encoló:", JSON.stringify(queuedData));
      process.exitCode = 1;
      return;
    }
    console.log("[e2e] job encolado ok:", JSON.stringify(queuedData));

    // 2) Ahora conecta el cliente: debe recibir el job pendiente y capturarlo por TCP.
    const client = spawnNode(["test/client.mjs", "--server", `ws://127.0.0.1:${RELAY_PORT}`, "--token", TOKEN, "--listen", String(CAPTURE_PORT)], {}, cwd);

    console.log("[e2e] esperando que el job encolado llegue al cliente...");
    const acked = await waitFor(() => client.getOut().includes("ack ok"));
    const captured = await waitFor(() => /\[tcp-capture\] recibidos \d+ bytes/.test(client.getOut()));
    if (!acked || !captured) {
      console.error(`[e2e] FAIL (cola): ${!acked ? "sin ack" : "sin captura TCP"}\n--- salida agente ---\n${client.getOut()}`);
      process.exitCode = 1;
      return;
    }
    console.log("[e2e] cola: job pendiente entregado y ack ok");

    // 3) Push online normal (como antes): llega directo sin encolar.
    console.log("[e2e] push online directo...");
    const payload = await buildTestBuffer();
    const res = await fetch(`${BASE}/push`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-secret": SECRET },
      body: JSON.stringify({
        token: TOKEN,
        job: { type: "test", payload, printerIp: "127.0.0.1", printerPort: CAPTURE_PORT, width: 48 },
      }),
    });
    const data = await res.json();
    if (!data.ok || data.queued) {
      console.error("[e2e] FAIL: /push online respondió", JSON.stringify(data));
      process.exitCode = 1;
      return;
    }
    console.log("[e2e] /push online ok:", JSON.stringify(data));

    const acked2 = await waitFor(() => (client.getOut().match(/ack ok/g) || []).length >= 2);
    if (!acked2) {
      console.error("[e2e] FAIL: el segundo push (online) no tuvo ack\n--- salida agente ---\n" + client.getOut());
      process.exitCode = 1;
      return;
    }
    console.log("[e2e] PASS: cola + entrega directa + captura TCP verificados");
  } catch (e) {
    console.error("[e2e] FAIL:", e.message);
    process.exitCode = 1;
  } finally {
    relay.child.kill();
    process.exit(process.exitCode ?? 0);
  }
}

run();