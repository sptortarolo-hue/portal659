import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./src/config.mjs";
import { vendorByToken } from "./src/db.mjs";
import { handleInbound } from "./src/bot.mjs";
import { addClient, removeClient, getClient, sendText, clientCount } from "./src/relay.mjs";
import { saveQrToken, clearQrToken } from "./src/state.mjs";

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: clientCount() }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token") || "";
  if (url.pathname !== "/wa" || !token) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    attach(ws, token);
  });
});

const lastPong = new Map(); // token -> última pong/bajada de actividad

async function attach(ws, token) {
  let vendor = null;
  try {
    vendor = await vendorByToken(token);
  } catch (e) {
    console.error("[relay] error resolviendo vendor:", e.message);
  }
  if (!vendor) {
    ws.send(JSON.stringify({ type: "error", message: "token inválido" }));
    ws.close();
    return;
  }

  const existing = getClient(token);
  if (existing) existing.ws.close();

  addClient(token, ws, vendor);
  lastPong.set(token, Date.now());
  ws.on("pong", () => lastPong.set(token, Date.now()));
  ws.send(JSON.stringify({ type: "hello", vendor_id: vendor.id, enabled: vendor.enabled !== false }));
  console.log(`[relay] conectado ${vendor.store_name} (${vendor.id})`, { clients: clientCount() });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // El relay manda el QR crudo (data del QR code) para escanearlo desde la web.
    if (msg.type === "qr" && msg.data) {
      lastPong.set(token, Date.now());
      await saveQrToken(vendor.id, msg.data).catch(() => {});
      return;
    }
    if (msg.type === "qr_stop" || msg.type === "linked") {
      await clearQrToken(vendor.id).catch(() => {});
      console.log(`[relay] ${msg.type === "linked" ? "vinculado" : "qr_stop"} ${vendor.store_name} (${vendor.id})`);
      return;
    }
    if (msg.type !== "message") return;
    if (!msg.wa_id || !msg.body) return;

    lastPong.set(token, Date.now());
    console.log(`[msg] de ${msg.wa_id}: ${msg.body}`);

    const result = await handleInbound({ vendor, waId: msg.wa_id, body: msg.body });
    if (result.handoff) {
      console.log(`[bot] handoff de ${msg.wa_id} (bot apagado) -> responde el dueño`);
      return;
    }
    for (const reply of result.replies || []) {
      const sent = sendText(getClient(token), msg.wa_id, reply);
      console.log(`[bot] reply a ${msg.wa_id} (${sent ? "enviado" : "SIN_CONEXION"}): ${reply}`);
    }
  });

  ws.on("close", () => {
    removeClient(token, ws);
    lastPong.delete(token);
    console.log(`[ws] relay desconectado ${vendor.store_name} (${vendor.id})`, { clients: clientCount() });
  });
  ws.on("error", () => removeClient(token, ws));
}

// Heartbeat: permite distinguir "relay vivo pero en silencio" de "relay muerto".
// gorilla/websocket responde a los ping automáticamente, así que un relay sano
// mantiene lastPong fresco sin tocar el APK.
setInterval(() => {
  const now = Date.now();
  for (const [token, ts] of lastPong) {
    const client = getClient(token);
    if (!client) {
      lastPong.delete(token);
      continue;
    }
    if (now - ts < 60_000) continue;
    console.log(`[heartbeat] ${client.vendor.store_name} (${token}) sin pong > 60s — relay caído, cerrando`);
    try {
      client.ws.terminate();
    } catch {}
    lastPong.delete(token);
  }
}, 20_000);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

server.listen(config.port, () => {
  console.log(`[wa-bot] cerebro escuchando en :${config.port}`);
});