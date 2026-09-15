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
      await saveQrToken(vendor.id, msg.data).catch(() => {});
      return;
    }
    if (msg.type === "qr_stop" || msg.type === "linked") {
      await clearQrToken(vendor.id).catch(() => {});
      return;
    }
    if (msg.type !== "message") return;
    if (!msg.wa_id || !msg.body) return;

    const result = await handleInbound({ vendor, waId: msg.wa_id, body: msg.body });
    for (const reply of result.replies || []) {
      sendText(getClient(token), msg.wa_id, reply);
    }
  });

  ws.on("close", () => removeClient(token, ws));
  ws.on("error", () => removeClient(token, ws));
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

server.listen(config.port, () => {
  console.log(`[wa-bot] cerebro escuchando en :${config.port}`);
});