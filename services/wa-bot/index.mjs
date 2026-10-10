import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./src/config.mjs";
import { vendorByToken } from "./src/db.mjs";
import { handleInbound, handleInboundMedia, startAwaitingReceipt, sweepStaleConversations } from "./src/bot.mjs";
import { getState, countByVendor } from "./src/state.mjs";
import { llmStats } from "./src/nlu.mjs";
import { addClient, removeClient, getClient, getClientByVendor, sendText, sendTyping, sendPaused, clientCount, forEachClient, clientsList } from "./src/relay.mjs";
import { saveQrToken, clearQrToken, setBotStatus } from "./src/state.mjs";
import { countOutbound, markNewChat, limitsReport } from "./src/limits.mjs";
import { bumpInbound, feedPush, feedList, metricsReport, touchLastSeen } from "./src/metrics.mjs";

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

  // ————— POST /send: la app inyecta un mensaje saliente (p. ej. al ACEPTAR
  // un pedido web con transferencia, avisar al cliente con los datos de pago).
  // Auth WA_BOT_SECRET. Si el relay no está conectado responde sent:false y
  // el flow sigue igual que siempre (silent). —————
  if (url.pathname === "/send" && req.method === "POST") {
    const auth = req.headers.authorization || "";
    if (config.waBotSecret && auth !== `Bearer ${config.waBotSecret}`) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no autorizado" }));
      return;
    }
    let body = {};
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {}
    const vendorId = String(body.vendorId || "");
    const waId = String(body.waId || "");
    const text = String(body.text || "");
    const orderId = body.orderId ? String(body.orderId) : null;
    // noState: recordatorios/avisos — no toca la máquina del asistente
    // (no setea awaiting_receipt) pero sí respeta rate limits.
    const noState = body.noState === true;
    if (!vendorId || !waId || !text) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "vendorId, waId y text requeridos" }));
      return;
    }

    const c = getClientByVendor(vendorId);
    if (!c || c.ws.readyState !== WebSocket.OPEN) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sent: false, reason: "sin_relay" }));
      return;
    }
    // Kill switch por comercio.
    if (c.vendor && c.vendor.enabled === false) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sent: false, reason: "bot_disabled" }));
      return;
    }
    // Auto-mensaje: el WA del propio comercio no se le escribe a sí mismo.
    const vendorWaDigits = String(c.vendor?.wa_phone || "").replace(/\D/g, "");
    const waIdDigits = waId.replace(/\D/g, "");
    if (vendorWaDigits && waIdDigits === vendorWaDigits) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sent: false, reason: "auto_mensaje" }));
      return;
    }
    const st = await getState(vendorId, waId).catch(() => null);
    // Ya esperando comprobante de ESTE pedido: no duplicar el mensaje (el
    // flujo del asistente ya lo mandó al confirmar).
    if (!noState && st?.step === "awaiting_receipt" && orderId && st?.orderId === orderId) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sent: false, reason: "ya_enviado" }));
      return;
    }
    // Rate limit de salida también para inyectados (recordatorios): si el
    // lote supera los caps, no mandar (handoff silencioso al dueño).
    try {
      const { hour, day } = await countOutbound(vendorId, 1).catch(() => ({ hour: 0, day: 0 }));
      const capH = isCooling(vendorId) ? limitsCap(config.maxMsgPerHour) : config.maxMsgPerHour;
      const capD = isCooling(vendorId) ? limitsCap(config.maxMsgPerDay) : config.maxMsgPerDay;
      if (hour > capH || day > capD) {
        stats.limitsHit++;
        console.log(`[ban-risque] ${vendorId} salida h=${hour}/${capH} d=${day}/${capD} en /send — no se manda`);
        feedPush({ vendorId, store: c.vendor?.store_name, kind: "limit", waId, text: `tope de salida (${hour}/${capH} por hora) — no se mandó el aviso de la app` });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, sent: false, reason: "limits" }));
        return;
      }
    } catch { /* sin redis: se sigue */ }
    // En medio del flujo del asistente: el mensaje IGUAL se manda (el comercio
    // aceptó y el cliente debe saberlo) pero SIN tocar el estado — el carrito
    // del asistente no se pierde. El comprobante entra por el fallback de
    // teléfono (pending-receipt).
    const enFlujo = st?.step === "flow" || st?.step === "confirm";

    if (!enFlujo && !noState) {
      // Setear el estado de espera de comprobante (orderId del pedido web).
      await startAwaitingReceipt({ id: vendorId }, waId, orderId, waId).catch(() => {});
    }
    await sleep(humanDelay(text.length));
    sendTyping(c, waId);
    sendText(c, waId, text);
    sendPaused(c, waId);
    stats.replies++;
    feedPush({ vendorId, store: c.vendor?.store_name, kind: "send", waId, text });
    console.log(`[send] app → ${waId} (orderId ${orderId || "-"}${enFlujo ? ", en_flujo sin estado" : ""}): ${text.slice(0, 80)}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, sent: true, enFlujo: enFlujo || undefined }));
    return;
  }

  // ————— GET /bots: datos en vivo por comercio para el TABLERO del admin
  // (estado de conexión, conversaciones, mensajes, anti-ban). Auth WA_BOT_SECRET.
  if (url.pathname === "/bots" && req.method === "GET") {
    const auth = req.headers.authorization || "";
    if (config.waBotSecret && auth !== `Bearer ${config.waBotSecret}`) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no autorizado" }));
      return;
    }
    const vendors = [];
    for (const [, c] of clientsList()) {
      if (!c.vendor) continue;
      const report = await limitsReport(c.vendor.id).catch(() => ({ sentHour: 0, sentDay: 0, newChatsHour: 0 }));
      const m = metricsReport(c.vendor.id);
      const cooling = isCooling(c.vendor.id);
      vendors.push({
        vendorId: c.vendor.id,
        storeName: c.vendor.store_name,
        connected: c.ws.readyState === WebSocket.OPEN,
        conversations: countByVendor(c.vendor.id),
        sentHour: report.sentHour,
        sentDay: report.sentDay,
        newChatsHour: report.newChatsHour,
        inboundHour: m.inboundHour,
        inboundDay: m.inboundDay,
        handoffsHour: m.handoffsHour,
        handoffsDay: m.handoffsDay,
        lastSeen: m.lastSeen,
        cooling,
        coolingUntil: cooling ? new Date(coolingUntil.get(String(c.vendor.id))).toISOString() : null,
      });
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      llm: { hasKey: !!config.llmApiKey, ...llmStats },
      stats,
      limits: {
        maxMsgPerHour: config.maxMsgPerHour,
        maxMsgPerDay: config.maxMsgPerDay,
        maxNewChatsPerHour: config.maxNewChatsPerHour,
        replyDelayMinMs: config.replyDelayMinMs,
        replyDelayMaxMs: config.replyDelayMaxMs,
      },
      vendors,
    }));
    return;
  }

  // ————— GET /feed: últimos eventos del bot (in/out/handoff/límites/alertas)
  // para el feed en vivo del tablero. Auth WA_BOT_SECRET. —————
  if (url.pathname === "/feed" && req.method === "GET") {
    const auth = req.headers.authorization || "";
    if (config.waBotSecret && auth !== `Bearer ${config.waBotSecret}`) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no autorizado" }));
      return;
    }
    const limit = Number(new URL(req.url, `http://x`).searchParams.get("limit")) || 120;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ events: feedList(limit) }));
    return;
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true, clients: clientCount(),
      llm: { hasKey: !!config.llmApiKey, ...llmStats },
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

// Modo enfriamiento anti-ban: tras un LoggedOut (señal de Meta — el número
// quedó "caliente") el comercio baja el volumen 48h: sin mensajes proactivos
// (el sweep se salta) y rate limits a la mitad.
const COOLING_MS = 48 * 60 * 60 * 1000;
const coolingUntil = new Map(); // vendorId -> timestamp hasta cuándo enfriado

function isCooling(vendorId) {
  const until = coolingUntil.get(String(vendorId));
  if (!until) return false;
  if (until < Date.now()) { coolingUntil.delete(String(vendorId)); return false; }
  return true;
}
function limitsCap(base) {
  return Math.ceil(base / 2); // enfriado: la mitad del tope
}

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
  touchLastSeen(vendor.id);
  ws.on("pong", () => lastSeen.set(token, Date.now()));
  ws.send(JSON.stringify({ type: "hello", vendor_id: vendor.id, enabled: vendor.enabled !== false }));
  feedPush({ vendorId: vendor.id, store: vendor.store_name, kind: "system", text: "relay conectado a la app" });
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
      touchLastSeen(vendor.id);
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
      feedPush({ vendorId: vendor.id, store: vendor.store_name, kind: "system", text: "WhatsApp vinculado ✓" });
      console.log(`[relay] vinculado ${vendor.store_name} (${vendor.id})`);
      return;
    }
    if (msg.type === "pairing") {
      // El relay está esperando que escaneen el QR: sacar el "✅ vinculado"
      // del panel y volver a mostrar la sección del QR.
      await setBotStatus(vendor.id, "pairing").catch(() => {});
      feedPush({ vendorId: vendor.id, store: vendor.store_name, kind: "system", text: "esperando escaneo del QR" });
      return;
    }
    if (msg.type === "logged_out") {
      await clearQrToken(vendor.id).catch(() => {});
      await setBotStatus(vendor.id, "unlinked").catch(() => {});
      stats.loggedOut++;
      feedPush({ vendorId: vendor.id, store: vendor.store_name, kind: "alert", text: "🚨 Meta desconectó el bot (LoggedOut) — enfriamiento 48h activado" });
      console.log(`[ban-risque] ${vendor.store_name} (${vendor.id}) LOGGED_OUT ${stats.loggedOut}° — re-pareando`);
      // Aviso a los admins: el número quedó "caliente" — la guía ANTES de re-vincular.
      fetch(`${config.appUrl}/api/wa/bot-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.waBotSecret}` },
        body: JSON.stringify({ vendorId: vendor.id, storeName: vendor.store_name, kind: "logged_out" }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
      // Modo enfriamiento: 48h sin proactivos y caps a la mitad.
      coolingUntil.set(vendor.id, Date.now() + COOLING_MS);
      return;
    }
    if (msg.type === "image" || msg.type === "file") {
      lastSeen.set(token, Date.now());
      if (!msg.wa_id || !msg.data) return;
      console.log(`[msg] media de ${msg.wa_id}: ${msg.mime} (${Math.round((msg.data.length * 3) / 4 / 1024)}KB)`);
      try {
        const buffer = Buffer.from(msg.data, "base64");
        const result = await handleInboundMedia({
          vendor,
          waId: msg.wa_id,
          waPhone: msg.wa_phone || "",
          mime: msg.mime || "",
          name: msg.name || "",
          buffer,
        });
        if (!result.handled) return;
        for (const reply of result.replies || []) {
          const sent = sendText(getClient(token), msg.wa_id, reply);
          console.log(`[bot] reply a ${msg.wa_id} (${sent ? "enviado" : "SIN_CONEXION"}): ${reply.slice(0, 80)}`);
        }
      } catch (e) {
        console.error(`[bot] error manejando media: ${e.message}`);
      }
      return;
    }

    if (msg.type !== "message") return;
    if (!msg.wa_id || !msg.body) return;

    lastSeen.set(token, Date.now());
    stats.messages++;
    bumpInbound(vendor.id, vendor.store_name, msg.wa_id, msg.body);
    console.log(`[msg] de ${msg.wa_id}: ${msg.body}`);

    // Rate limit de chats nuevos: si es primer contacto y ya se superó el tope
    // de la hora, no responder (handoff al dueño). Evita contestar la misma
    // plantilla a una avalancha de números nuevos (señal de spam).
    const prev = await getState(vendor.id, msg.wa_id).catch(() => null);
    if (!prev) {
      const { added, count } = await markNewChat(vendor.id, msg.wa_id).catch(() => ({ added: 0, count: 0 }));
      const capNew = isCooling(vendor.id) ? limitsCap(config.maxNewChatsPerHour) : config.maxNewChatsPerHour;
      if (added && count > capNew) {
        stats.limitsHit++;
        feedPush({ vendorId: vendor.id, store: vendor.store_name, kind: "limit", waId: msg.wa_id, text: `${count} chats nuevos/hora > ${capNew} — no se responde, atiende el dueño` });
        console.log(`[ban-risque] ${vendor.store_name} (${vendor.id}) ${count} chats nuevos/hora > ${capNew} — handoff, responde el dueño`);
        return;
      }
    }

    const result = await handleInbound({ vendor, waId: msg.wa_id, body: msg.body, waPhone: msg.wa_phone });
    if (result.handoff) {
      feedPush({ vendorId: vendor.id, store: vendor.store_name, kind: "limit", waId: msg.wa_id, text: "bot apagado — no responde, atiende el dueño" });
      console.log(`[bot] handoff de ${msg.wa_id} (bot apagado) -> responde el dueño`);
      return;
    }
    const replies = result.replies || [];
    if (!replies.length) return;

    // Rate limit de salida: si este lote supera los caps de hora/día, no mandar
    // (el dueño atiende). El conteo se hace ANTES de enviar para no exceder.
    const { hour, day } = await countOutbound(vendor.id, replies.length).catch(() => ({ hour: 0, day: 0 }));
    const capH = isCooling(vendor.id) ? limitsCap(config.maxMsgPerHour) : config.maxMsgPerHour;
    const capD = isCooling(vendor.id) ? limitsCap(config.maxMsgPerDay) : config.maxMsgPerDay;
    if (hour > capH || day > capD) {
      stats.limitsHit++;
      feedPush({ vendorId: vendor.id, store: vendor.store_name, kind: "limit", waId: msg.wa_id, text: `tope de salida (${hour}/${capH} por hora) — sin respuesta, atiende el dueño` });
      console.log(`[ban-risque] ${vendor.store_name} (${vendor.id}) salida h=${hour}/${capH} d=${day}/${capD} — handoff, responde el dueño`);
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
      feedPush({ vendorId: vendor.id, store: vendor.store_name, kind: "out", waId: msg.wa_id, text: reply });
      console.log(`[bot] reply a ${msg.wa_id} (${sent ? "enviado" : "SIN_CONEXION"}): ${reply}`);
    }
    sendPaused(client, msg.wa_id);
  });

  ws.on("close", () => {
    removeClient(token, ws);
    lastSeen.delete(token);
    feedPush({ vendorId: vendor.id, store: vendor.store_name, kind: "system", text: "relay desconectado de la app" });
    console.log(`[ws] relay desconectado ${vendor.store_name} (${vendor.id})`, { clients: clientCount() });
  });
  ws.on("error", () => removeClient(token, ws));
}

// Sweep de inactividad cada 60s: pregunta pendiente sin contestar (persona 1/2,
// consulta, comprobante) > WA_HANDOFF_TIMEOUT_MIN → aviso al cliente + push al
// dueño + pausa. Los eventos del pedido no se interrumpen (no miran la pausa).
setInterval(() => {
  sweepStaleConversations().catch((e) => console.error("[sweep] error:", e?.message || e));
}, 60_000);

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