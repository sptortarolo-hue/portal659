/**
 * E2E del agente PC contra el relay real:
 *  relay :8852  →  agent.mjs (config local)  →  capturador TCP :9998
 *
 * Uso: node test/e2e.mjs   (desde services/print-agent)
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const RELAY_DIR = join(DIR, "..", "..", "print-bridge");
const RELAY_PORT = 8852;
const CAPTURE_PORT = 9998;
const SECRET = "agent-e2e";
const TOKEN = "agent-e2e-token";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(fn, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}

function spawnNode(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (out += d.toString()));
  return { child, getOut: () => out };
}

async function run() {
  // 1) Relay
  const relay = spawnNode(["index.mjs", ], RELAY_DIR);
  relay.child.env = undefined;
  console.log("[e2e-agent] levantando relay en :" + RELAY_PORT);
  // configurar env del relay: pasar por env al spawn directamente
  relay.child.kill();
  const relay2 = spawn(process.execPath, ["index.mjs"], {
    cwd: RELAY_DIR,
    env: { ...process.env, PORT: String(RELAY_PORT), PRINT_BRIDGE_SECRET: SECRET },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let relayOut = "";
  relay2.stdout.on("data", (d) => (relayOut += d.toString()));
  relay2.stderr.on("data", (d) => (relayOut += d.toString()));

  // 2) Capturador TCP
  let capturedBytes = 0;
  const capture = net.createServer((sock) => {
    let size = 0;
    sock.on("data", (b) => { size += b.length; });
    sock.on("end", () => { capturedBytes += size; });
  });
  capture.listen(CAPTURE_PORT, "127.0.0.1");

  // 3) Agente con config local
  const cfgPath = join(DIR, "agent.test.config.json");
  writeFileSync(cfgPath, JSON.stringify({
    serverUrl: `http://127.0.0.1:${RELAY_PORT}`,
    token: TOKEN,
    printerIp: "127.0.0.1",
    printerPort: CAPTURE_PORT,
  }));
  const agent = spawnNode(["agent.mjs", "--config", cfgPath], join(DIR, ".."));

  try {
    console.log("[e2e-agent] esperando conexión al relay...");
    const up = await waitFor(() => agent.getOut().includes("conectado al relay"));
    if (!up) {
      console.error("[e2e-agent] FAIL: agente no conectó\n--- relay ---\n" + relayOut + "\n--- agente ---\n" + agent.getOut());
      process.exitCode = 1;
      return;
    }

    // 4) Push al relay
    const payload = Buffer.from("PRUEBA AGENTE PC\n\n").toString("base64");
    const res = await fetch(`http://127.0.0.1:${RELAY_PORT}/push`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-secret": SECRET },
      body: JSON.stringify({ token: TOKEN, job: { type: "comanda", payload, width: 48 } }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("[e2e-agent] FAIL /push:", JSON.stringify(data), "\n--- agente ---\n" + agent.getOut());
      process.exitCode = 1;
      return;
    }

    const printed = await waitFor(() => capturedBytes > 0 && agent.getOut().includes("imprimí"));
    if (!printed) {
      console.error("[e2e-agent] FAIL: no llegó el ticket a la impresora simulada\n--- agente ---\n" + agent.getOut());
      process.exitCode = 1;
      return;
    }

    console.log(`[e2e-agent] PASS: job entregado por el agente PC (${capturedBytes} bytes en el capturador)`);
  } finally {
    relay2.kill();
    agent.child.kill();
    capture.close();
    process.exit(process.exitCode ?? 0);
  }
}

run();
