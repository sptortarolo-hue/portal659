/**
 * Cliente de prueba del relay (simula la app Portal Print sin celular).
 *
 * - Levanta un capturador TCP en 127.0.0.1:9999 (recibe y resumeniza los bytes ESC/POS).
 * - Se conecta al relay como una app real.
 * - Al recibir un job, abre TCP hacia el destino y escribe payload (según el job) o hacia el
 *   capturador local (para jobs sin destino), y responde ack al relay.
 *
 * Uso:
 *   node test/client.mjs --server ws://localhost:8791 --token dev-token [--listen 9999]
 */
import net from "node:net";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith("--") ? next : true;
      if (typeof args[key] === "string") i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const server = args.server || "ws://localhost:8791";
const token = args.token || "dev-token";
const listenPort = Number(args.listen || 9999);

const { WebSocket } = await import("ws");

const captured = [];

const tcpCapture = net.createServer((socket) => {
  let size = 0;
  const chunks = [];
  socket.on("data", (buf) => {
    size += buf.length;
    chunks.push(buf);
  });
  socket.on("end", () => {
    const all = Buffer.concat(chunks);
    console.log(`\n[tcp-capture] recibidos ${size} bytes (${all.length} en chunks):`);
    console.log("-".repeat(72));
    const printable = all
      .toString("latin1")
      .replace(/[^\x20-\x7e]/g, "·");
    console.log(printable);
    console.log("-".repeat(72));
    captured.length = 0;
  });
  socket.on("error", (e) => console.error("[tcp-capture] error", e.message));
});

tcpCapture.listen(listenPort, "127.0.0.1", () => {
  console.log(`[tcp-capture] escuchando en 127.0.0.1:${listenPort}`);
  connect();
});

function connect() {
  const wsUrl = `${server}/printbridge?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log(`[agent] conectado a ${ws.origin ?? wsUrl}`);
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "hello") {
      console.log("[agent] hello recibido:", msg);
      return;
    }
    if (msg.type === "job" && msg.jobId) {
      const job = msg.job ?? msg;
      console.log(`\n[agent] job recibido: type=${job.type} jobId=${msg.jobId} payload=${(job.payload ?? "").length} chars base64`);
      const buf = Buffer.from(job.payload ?? "", "base64");
      const destination = job.printerIp ? { ip: job.printerIp, port: job.printerPort } : { ip: "127.0.0.1", port: listenPort };
      try {
        await sendTcp(destination.ip, destination.port, buf);
        ws.send(JSON.stringify({ type: "ack", jobId: msg.jobId, ok: true }));
        console.log(`[agent] impreso en ${destination.ip}:${destination.port} (${buf.length} bytes) → ack ok`);
      } catch (e) {
        ws.send(JSON.stringify({ type: "ack", jobId: msg.jobId, ok: false, error: e.message }));
        console.error(`[agent] error de impresión: ${e.message}`);
      }
    }
  });

  ws.on("close", () => {
    console.log("[agent] desconectado, reconectando en 3s...");
    setTimeout(connect, 3000);
  });
  ws.on("error", (e) => console.error("[agent] ws error:", e.message));
}

function sendTcp(ip, port, data) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: ip, port, timeout: 5000 });
    socket.on("connect", () => {
      socket.write(data);
      socket.end();
      socket.on("close", resolve);
    });
    socket.on("error", (e) => reject(e));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("timeout TCP"));
    });
  });
}