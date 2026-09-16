import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./src/config.mjs";
import { vendorByToken } from "./src/db.mjs";
import { handleInbound } from "./src/bot.mjs";
import { addClient, removeClient, getClient, sendText, clientCount, forEachClient } from "./src/relay.mjs";
import { saveQrToken, clearQrToken, setBotStatus } from "./src/state.mjs";

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

const lastSeen = new Map(); // token -> última actividad (mensaje, qr o pong)

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
  lastSeen.set(token, Date.now());
  ws.on("pong", () => lastSeen.set(token, Date.now()));
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
      lastSeen.set(token, Date.now());
      await saveQrToken(vendor.id, msg.data).catch(() => {});
      return;
    }
    if (msg.type === "qr_stop") {
      await clearQrToken(vendor.id).catch(() => {});
      return;
    }
    if (msg.type === "linked") {
      await clearQrToken(vendor.id).catch(() => {});
      await setBotStatus(vendor.id, "linked").catch(() => {});
      console.log(`[relay] vinculado ${vendor.store_name} (${vendor.id})`);
      return;
    }
    if (msg.type === "logged_out") {
      await clearQrToken(vendor.id).catch(() => {});
      await setBotStatus(vendor.id, "unlinked").catch(() => {});
      console.log(`[relay] desvinculado ${vendor.store_name} (${vendor.id}) — re-pareando`);
      return;
    }
    if (msg.type !== "message") return;
    if (!msg.wa_id || !msg.body) return;

    lastSeen.set(token, Date.now());
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
    lastSeen.delete(token);
    console.log(`[ws] relay desconectado ${vendor.store_name} (${vendor.id})`, { clients: clientCount() });
  });
  ws.on("error", () => removeClient(token, ws));
}

// Heartbeat: distingue "relay vivo (aunque en silencio)" de "relay caído".
// Envía ping cada 20s; gorilla/websocket del relay contesta pong automáticamente.
// Cierra relay que no responda en >90s (mitiga sockets half-open de red móvil
// sin matar conexiones sanas).
setInterval(() => {
  forEachClient((token, c) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.ping();
  });
}, 20_000);

setInterval(() => {
  const now = Date.now();
  for (const [token, ts] of lastSeen) {
    const client = getClient(token);
    if (!client) { lastSeen.delete(token); continue; }
    if (now - ts < 90_000) continue;
    console.log(`[heartbeat] ${client.vendor.store_name} (${token}) sin pong > 90s — relay inalcanzable, cerrando`);
    try { client.ws.terminate(); } catch {}
    lastSeen.delete(token);
  }
}, 20_000);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

server.listen(config.port, () => {
  console.log(`[wa-bot] cerebro escuchando en :${config.port}`);
});