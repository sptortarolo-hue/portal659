import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./src/config.mjs";
import { vendorByToken } from "./src/db.mjs";
import { handleInbound } from "./src/bot.mjs";
import { getState } from "./src/state.mjs";
import { countOutbound, markNewChat } from "./src/limits.mjs";
import { addClient, removeClient, getClient, sendText, sendTyping, sendPaused, clientCount, forEachClient } from "./src/relay.mjs";
import { saveQrToken, clearQrToken, setBotStatus } from "./src/state.mjs";

// Telemetría de salud (anti-ban): contadores de proceso para /health y logs.
const stats = { messages: 0, replies: 0, errors: 0, loggedOut: 0, limitsHit: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.round(min + Math.random() * (max - min));

/** Delay humano antes de responder: base aleatoria en [min,max], +4ms por char
 *  del inbound (simula que leen). Nunca 0 — WhatsApp nota la inmediatez. */
function humanDelay(textLen) {
  return Math.min(config.replyDelayMaxMs, config.replyDelayMinMs + textLen * 4 + rand(200, 700));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true, clients: clientCount(), llm: !!config.llmApiKey,
      stats,
      limits: { replyDelayMinMs: config.replyDelayMinMs, replyDelayMaxMs: config.replyDelayMaxMs, replyGapMs: config.replyGapMs, maxMsgPerHour: config.maxMsgPerHour, maxMsgPerDay: config.maxMsgPerDay, maxNewChatsPerHour: config.maxNewChatsPerHour },
    }));
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
    if (msg.type === "pairing") {
      // El relay está esperando que escaneen el QR: sacar el "✅ vinculado"
      // del panel y volver a mostrar la sección del QR.
      await setBotStatus(vendor.id, "pairing").catch(() => {});
      return;
    }
    if (msg.type === "logged_out") {
      await clearQrToken(vendor.id).catch(() => {});
      await setBotStatus(vendor.id, "unlinked").catch(() => {});
      stats.loggedOut++;
      console.log(`[ban-risque] ${vendor.store_name} (${vendor.id}) LOGGED_OUT ${stats.loggedOut}° — re-pareando`);
      return;
    }
    if (msg.type !== "message") return;
    if (!msg.wa_id || !msg.body) return;

    lastSeen.set(token, Date.now());
    stats.messages++;
    console.log(`[msg] de ${msg.wa_id}: ${msg.body}`);

    // Rate limit de chats nuevos: si es primer contacto y ya se superó el tope
    // de la hora, no responder (handoff al dueño). Evita contestar la misma
    // plantilla a una avalancha de números nuevos (señal de spam).
    const prev = await getState(vendor.id, msg.wa_id).catch(() => null);
    if (!prev) {
      const { added, count } = await markNewChat(vendor.id, msg.wa_id).catch(() => ({ added: 0, count: 0 }));
      if (added && count > config.maxNewChatsPerHour) {
        stats.limitsHit++;
        console.log(`[ban-risque] ${vendor.store_name} (${vendor.id}) ${count} chats nuevos/hora > ${config.maxNewChatsPerHour} — handoff, responde el dueño`);
        return;
      }
    }

    const result = await handleInbound({ vendor, waId: msg.wa_id, body: msg.body });
    if (result.handoff) {
      console.log(`[bot] handoff de ${msg.wa_id} (bot apagado) -> responde el dueño`);
      return;
    }
    const replies = result.replies || [];
    if (!replies.length) return;

    // Rate limit de salida: si este lote supera los caps de hora/día, no mandar
    // (el dueño atiende). El conteo se hace ANTES de enviar para no exceder.
    const { hour, day } = await countOutbound(vendor.id, replies.length).catch(() => ({ hour: 0, day: 0 }));
    if (hour > config.maxMsgPerHour || day > config.maxMsgPerDay) {
      stats.limitsHit++;
      console.log(`[ban-risque] ${vendor.store_name} (${vendor.id}) salida h=${hour}/${config.maxMsgPerHour} d=${day}/${config.maxMsgPerDay} — handoff, responde el dueño`);
      return;
    }

    // Pacing humano: esperar antes de tipear, gaps entre replies múltiples.
    const client = getClient(token);
    await sleep(humanDelay(msg.body.length));
    sendTyping(client, msg.wa_id);
    let first = true;
    for (const reply of replies) {
      if (!first) await sleep(config.replyGapMs + rand(300, 800));
      first = false;
      const sent = sendText(client, msg.wa_id, reply);
      stats.replies++;
      console.log(`[bot] reply a ${msg.wa_id} (${sent ? "enviado" : "SIN_CONEXION"}): ${reply}`);
    }
    sendPaused(client, msg.wa_id);
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
  console.log(`[wa-bot] LLM ${config.llmApiKey ? `activo (${config.llmModel} via ${config.llmBaseUrl})` : "DESACTIVADO — mensajes sin saludo solo"}`);
  console.log(`[wa-bot] redis=${config.redisUrl ? "on" : "off"} db=${config.databaseUrl ? "ok" : "no conf"} appUrl=${config.appUrl}`);
});