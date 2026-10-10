// Test del auto-responder (default: BOT_TAKE_ORDERS sin setear → concierge).
// El bot es un auto-responder puro: TODO mensaje recibe la respuesta automática
// (estado abierto/cerrado + menú online + pie de ayuda); la ÚNICA escalada es
// "ayuda" (handoff al comercio). El mensaje predefinido del checkout (el pedido
// armado por la app) → silencio: el pedido ya está en el sistema.
process.env.BOT_TAKE_ORDERS = "";

const { handleInbound, handleInboundMedia, startAwaitingReceipt, sweepStaleConversations, DEFAULT_STATE } = await import("./src/bot.mjs");
const { setState } = await import("./src/state.mjs");

const MOCK_MENU = {
  vendor: { id: "vtest", store_name: "Che Sancho", vertical: "gastronomia", store_open: true, open_text: "Abierto ahora" },
  products: [
    { id: "p1", name: "Empanada de carne", price: 1200, category: "Empanadas" },
    { id: "p3", name: "Coca-Cola 500ml", price: 1000, category: "Bebidas" },
  ],
};
let handoffNotified = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/api/wa/menu")) return { ok: true, json: async () => MOCK_MENU };
  if (u.includes("/api/wa/handoff")) { handoffNotified = true; return { ok: true, json: async () => ({ ok: true }) }; }
  return realFetch(url, opts);
};

const vendor = { id: "vtest", store_name: "Che Sancho", slug: "che-sancho", enabled: true };
const wa = "5491100000006";

function show(label, r) {
  console.log(`\n===== ${label} =====`);
  console.log((r.replies || []).join("\n---\n"));
}

// El mensaje predefinido EXACTO que arma el checkout (order-utils.ts).
const APP_ORDER_MSG = [
  "Hola Che Sancho! Quiero hacer un pedido:",
  "",
  "- 2x Empanada de carne ($2.400)",
  "- 1x Coca-Cola 500ml ($1.000)",
  "",
  "Total: $3.400",
  "Nombre: Juan",
  "WhatsApp: 5491134567890",
  "Retiro en el local",
].join("\n");

async function main() {
  let r, ok = true;

  // 1. hola → la bienvenida completa (abierto + menú + ayuda).
  r = await handleInbound({ vendor, waId: wa, body: "hola" });
  show("hola", r);
  const s = (r.replies || []).join(" ");
  if (!s.includes("Che Sancho") || !s.includes("abiert") || !s.includes("ayuda") || !s.includes("portal659.com.ar/tienda/")) { console.log("!!! saludo incompleto"); ok = false; }
  else { console.log(">>> OK: bienvenida con abierto + menú + ayuda"); }

  // 2. Segundo mensaje (sin "ayuda") → "Enseguida te atiende una persona" +
  //    push/notificación al comercio + pausa de 30 min.
  handoffNotified = false;
  r = await handleInbound({ vendor, waId: wa, body: "quiero saber si estan abierto" });
  show("2º mensaje: quiero saber si estan abierto", r);
  const h2 = (r.replies || []).join(" ");
  if (!handoffNotified || !h2.includes("Enseguida te atiende una persona")) { console.log("!!! el 2º mensaje no derivó a persona (con push al comercio)"); ok = false; }
  else { console.log(">>> OK: 2º mensaje → aviso de persona + push al comercio"); }

  // 3. Tercer mensaje → el aviso de pausa UNA vez ("el comercio te atiende en
  //    un rato") y sin nueva notificación al comercio.
  handoffNotified = false;
  r = await handleInbound({ vendor, waId: wa, body: "tienen milanesa?" });
  show("3º mensaje: tienen milanesa? (en pausa)", r);
  const p3 = (r.replies || []).join(" ");
  if (handoffNotified || p3.includes("Enseguida te atiende")) { console.log("!!! el bot volvió a derivar/notificar (loop)"); ok = false; }
  else if ((r.replies || []).length > 1 || (!p3.includes("comercio") && p3 !== "")) { console.log("!!! el aviso de pausa se repite o es raro"); ok = false; }
  else { console.log(">>> OK: aviso de pausa una vez, sin re-notificar al comercio"); }

  // 4. Cuarto mensaje → SILENCIO total (el loop quedó cortado).
  r = await handleInbound({ vendor, waId: wa, body: "te puedo hacer un pedido?" });
  show("4º mensaje: te puedo hacer un pedido? (silencio)", r);
  if ((r.replies || []).length !== 0) { console.log("!!! el bot siguió contestando (loop)"); ok = false; }
  else { console.log(">>> OK: silencio total en pausa (loop cortado)"); }

  // 5. Conversación nueva (tras "cancelar" o 30 min de silencio) → bienvenida.
  r = await handleInbound({ vendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor, waId: wa, body: "te puedo hacer un pedido?" });
  show("conversación nueva: te puedo hacer un pedido?", r);
  const nw = (r.replies || []).join(" ");
  if (!nw.includes("Che Sancho") || !nw.includes("abiert")) { console.log("!!! la conversación nueva no recibió la bienvenida"); ok = false; }
  else { console.log(">>> OK: conversación nueva (tras 30 min de silencio) → bienvenida otra vez"); }

  // 5. El mensaje PREDEFINIDO del checkout → SILENCIO (el pedido ya está en el sistema).
  r = await handleInbound({ vendor, waId: wa, body: APP_ORDER_MSG });
  show("mensaje predefinido del checkout", r);
  if ((r.replies || []).length !== 0) { console.log("!!! el mensaje predefinido recibió respuesta (debe ser silencio)"); ok = false; }
  else { console.log(">>> OK: mensaje predefinido del pedido → silencio (canal abierto para eventos)"); }

  // 6. "ya pagué mi pedido por Mercado Pago" (retorno MP) → silencio.
  r = await handleInbound({ vendor, waId: wa, body: "Hola Che Sancho! Soy Juan: ya pagué mi pedido por Mercado Pago ($3.400)." });
  if ((r.replies || []).length !== 0) { console.log("!!! el retorno de MP recibió respuesta"); ok = false; }
  else { console.log(">>> OK: 'ya pagué mi pedido' → silencio"); }

  // 7. "no se pudo cobrar" (MP falló) → handoff al dueño.
  handoffNotified = false;
  r = await handleInbound({ vendor, waId: wa, body: "Hola Che Sancho! Intenté pagar online y no se pudo cobrar. ¿Coordinamos por acá?" });
  show("no se pudo cobrar", r);
  if (!handoffNotified) { console.log("!!! MP falló no derivó al dueño"); ok = false; }
  else { console.log(">>> OK: 'no se pudo cobrar' → handoff al dueño"); }

  // 8. "ayuda" → handoff (limpio, sin pausa previa).
  r = await handleInbound({ vendor, waId: wa, body: "cancelar" });
  handoffNotified = false;
  r = await handleInbound({ vendor, waId: wa, body: "ayuda" });
  show("ayuda", r);
  if (!(r.replies || []).join(" ").includes("Enseguida te atiende una persona") || !handoffNotified) { console.log("!!! 'ayuda' no derivó al humano"); ok = false; }
  else { console.log(">>> OK: 'ayuda' → handoff a una persona"); }

  // 9. El sweep: comprobante pendiente sin contestar > 5 min → persona.
  r = await handleInbound({ vendor, waId: wa, body: "cancelar" });
  handoffNotified = false;
  await setState(vendor.id, wa, { ...DEFAULT_STATE, step: "awaiting_receipt", welcomed: true, orderId: "ord-1", touchedAt: Date.now() - 6 * 60 * 1000 });
  const { addClient } = await import("./src/relay.mjs");
  addClient("fake-ws-token", { readyState: 1, send: () => true, ping: () => {} }, vendor);
  await sweepStaleConversations();
  await new Promise((res) => setTimeout(res, 50));
  if (!handoffNotified) { console.log("!!! el sweep no notificó al dueño (comprobante pendiente)"); ok = false; }
  else { console.log(">>> OK: sweep → comprobante pendiente sin contestar → persona"); }
  // Anti-loop: con la pausa activa el sweep no repite.
  handoffNotified = false;
  await sweepStaleConversations();
  if (handoffNotified) { console.log("!!! el sweep repitió (anti-loop roto)"); ok = false; }
  else { console.log(">>> OK: el sweep no repite con la pausa activa"); }

  if (!ok) { console.error("\n=== HAY FALLOS (concierge) ==="); process.exit(1); }
  console.log("\n=== TODO OK (auto-responder) ===");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
