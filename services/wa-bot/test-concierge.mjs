// Test del modo conserje v2 (default: BOT_TAKE_ORDERS sin setear o vacío →
// concierge). El asistente NO arma pedidos por chat. El flujo:
//
// 1. saludo con abierto/cerrado + menú online + pie de "ayuda"
// 2. cualquier texto de pedido armado (producto del menú o pedido reciente) →
//    "ok" + link de seguimiento — el chat queda abierto para los eventos
//    (aceptado / en camino / listo)
// 3. cualquier otra cosa → ofrecer atención humana ("¿Querés que lo atienda una
//    persona?") con opciones 1/2
// 4. "ayuda" en cualquier momento → handoff al comercio directamente
process.env.BOT_TAKE_ORDERS = "";

const { handleInbound } = await import("./src/bot.mjs");

const MOCK_MENU = {
  vendor: { id: "vtest", store_name: "Che Sancho", vertical: "gastronomia", store_open: true, open_text: "Abierto ahora" },
  products: [
    { id: "p1", name: "Empanada de carne", price: 1200, category: "Empanadas" },
    { id: "p3", name: "Coca-Cola 500ml", price: 1000, category: "Bebidas" },
  ],
};
let handoffNotified = false;
let recentOrder = null; // si no viene del pedido armado, la respuesta cambia
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/api/wa/menu")) return { ok: true, json: async () => MOCK_MENU };
  if (u.includes("/api/wa/handoff")) { handoffNotified = true; return { ok: true, json: async () => ({ ok: true }) }; }
  if (u.includes("/api/wa/latest-orders")) {
    if (recentOrder) return { ok: true, status: 200, json: async () => ({ pickupNumber: 7, status: "new", trackUrl: "https://www.portal659.com.ar/seguimiento/abc" }) };
    return { ok: true, status: 404, json: async () => ({}) };
  }
  return realFetch(url, opts);
};

const vendor = { id: "vtest", store_name: "Che Sancho", slug: "che-sancho", enabled: true };
const wa = "5491100000006";

function show(label, r) {
  console.log(`\n===== ${label} =====`);
  console.log((r.replies || []).join("\n---\n"));
}

async function main() {
  let r, ok = true;
  recentOrder = null;

  // 1. Saludo con abierto/cerrado + menú + pie de ayuda.
  r = await handleInbound({ vendor, waId: wa, body: "hola" });
  show("hola", r);
  const s = (r.replies || []).join(" ");
  if (!s.includes("Che Sancho") || !s.includes("abiert") || !s.includes("ayuda") || !s.includes("portal659.com.ar/tienda/")) { console.log("!!! saludo incompleto"); ok = false; }
  else { console.log(">>> OK: saludo con abierto + menú + pie de ayuda"); }

  // 2. Pedido armado → silencio (el chat queda abierto para eventos, no contesta).
  r = await handleInbound({ vendor, waId: wa, body: "quiero una empanada" });
  show("quiero empanada (sin pedido reciente)", r._silent ? [] : r.replies);
  const silent = (r.replies || []).length === 0;
  if (!silent) { console.log("!!! el pedido armado no fue silencioso"); ok = false; }
  else { console.log(">>> OK: pedido armado → responde nada (canal abierto para eventos)"); }

  // Con pedido reciente → también silencio (la app gestiona el aviso).
  recentOrder = { pickupNumber: 7, trackUrl: "https://www.portal659.com.ar/seguimiento/abc" };
  r = await handleInbound({ vendor, waId: wa, body: "agregame una cocacola" });
  show("texto con pedido reciente", r);
  const ok3 = (r.replies || []).join(" ");
  if ((r.replies || []).length !== 0) { console.log("!!! con pedido reciente el bot contestó (debe quedar mudo)"); ok = false; }
  else { console.log(">>> OK: con pedido reciente también queda mudo"); }
  recentOrder = null;

  // 3. Cualquier otra cosa → pregunta persona (1 sí / 2 no). Texto neutro para
  // no disparar el handoff global por accidente.
  r = await handleInbound({ vendor, waId: wa, body: "una consultilla sobre la dirección" });
  show("texto distinto → ofrecer persona", r);
  const ask = (r.replies || []).join(" ");
  if (!ask.includes("¿Querés que lo atienda una persona") || !ask.includes("1️⃣") || !ask.includes("2️⃣")) { console.log("!!! no se ofreció persona con options"); ok = false; }
  else { console.log(">>> OK: pregunta persona con opciones 1/2"); }

  // 4. Respuesta "1" → handoff a la persona (notification).
  r = await handleInbound({ vendor, waId: wa, body: "1" });
  show("respuesta 1 → handoff", r);
  const hands = (r.replies || []).join(" ");
  if (!hands.includes("Enseguida te atiende una persona")) { console.log("!!! el '1' no disparó la persona"); ok = false; }
  if (!handoffNotified) { console.log("!!! el handoff no notificó al dueño"); ok = false; }
  else { console.log(">>> OK: handoff + push al comercio"); }

  // Pausa: el próximo texto anuncia una vez y luego el bot queda en calma.
  r = await handleInbound({ vendor, waId: wa, body: "seguí" });
  show("pausa después de handoff", r);
  if (!(r.replies || []).join(" ").includes("atender")) { console.log("!!! la pausa no avisó"); ok = false; }
  else { console.log(">>> OK: pausa donde ahora responde el dueño"); }

  // 5. Después del cancelar → se saluda de nuevo otra vez.
  r = await handleInbound({ vendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor, waId: wa, body: "hola" });
  if (!(r.replies || []).join(" ").includes("Che Sancho")) { console.log("!!! no volvío a saludar tras ¿"); ok = false; }
  else { console.log(">>> OK: tras cancelar la conversación reinica"); }

  // 6. La respuesta "2" → "Perfecto. Esperamos su pedido..." y cierra.
  r = await handleInbound({ vendor, waId: wa, body: "quería consultar sobre algo de ayer" });
  r = await handleInbound({ vendor, waId: wa, body: "2" });
  show("respuesta 2 → cierre", r);
  const no2 = (r.replies || []).join(" ");
  if (!no2.includes("Perfecto") || !no2.includes("Esperamos su pedido")) { console.log("!!! el '2' no cerró bien la oferta"); ok = false; }
  else { console.log(">>> OK: el '2' cierra con el mensaje y el link"); }

  // 6b. Pregunta persona + respuesta que NO es sí/no → handoff DIRECTO (sin loop).
  r = await handleInbound({ vendor, waId: wa, body: "cancelar" });
  handoffNotified = false;
  r = await handleInbound({ vendor, waId: wa, body: "hola" });
  r = await handleInbound({ vendor, waId: wa, body: "bueno, qué sé yo" }); // → pregunta persona
  r = await handleInbound({ vendor, waId: wa, body: "qué sé yo, si de una" }); // no es "2"/no
  show("respuesta rara → handoff directo", r);
  const rare = (r.replies || []).join(" ");
  if (!rare.includes("Enseguida te atiende una persona") || !handoffNotified) { console.log("!!! la respuesta sin sí/no no saltó a persona (debe ser directo, sin loop)"); ok = false; }
  else { console.log(">>> OK: sin sí/no → salta directo a que atienda una persona (sin loop)"); }

  // 7. "ayuda" → handoff directo, ni preguntas (limpio, sin pausa previa).
  r = await handleInbound({ vendor, waId: wa, body: "cancelar" });
  handoffNotified = false;
  r = await handleInbound({ vendor, waId: wa, body: "ayuda" });
  show("ayuda", r);
  if (!(r.replies || []).join(" ").includes("Enseguida te atiende una persona")) { console.log("!!! 'ayuda' no fue al humano"); ok = false; }
  else { console.log(">>> OK: 'ayuda' → handoff inmediato"); }

  // 8. Sweep de inactividad: pregunta pendiente sin contestar > 5 min → el bot
  // avisa "va a ser atendido por una persona" + push al dueño + pausa.
  const { sweepStaleConversations, DEFAULT_STATE } = await import("./src/bot.mjs");
  const { setState } = await import("./src/state.mjs");
  r = await handleInbound({ vendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor, waId: wa, body: "hola" });
  r = await handleInbound({ vendor, waId: wa, body: "quería consultar sobre algo" }); // → pregunta persona
  handoffNotified = false;
  // Forzar staleness: touchedAt viejo (6 min) con la pregunta pendiente.
  await setState(vendor.id, wa, { ...DEFAULT_STATE, step: "concierge_askperson", welcomed: true, touchedAt: Date.now() - 6 * 60 * 1000 });
  // El sweep necesita el cliente del relay conectado: fake ws (readyState OPEN).
  const { addClient } = await import("./src/relay.mjs");
  addClient("fake-ws-token", { readyState: 1, send: () => true, ping: () => {} }, vendor);
  await sweepStaleConversations();
  await new Promise((res) => setTimeout(res, 50));
  if (!handoffNotified) { console.log("!!! el sweep no notificó al dueño"); ok = false; }
  else { console.log(">>> OK: sweep de inactividad → push al dueño (la persona atiende)"); }
  // El estado quedó con pausa: el sweep NO repite (anti-loop).
  handoffNotified = false;
  await sweepStaleConversations();
  if (handoffNotified) { console.log("!!! el sweep repitió el handoff (anti-loop roto)"); ok = false; }
  else { console.log(">>> OK: el sweep no repite con la pausa activa"); }

  if (!ok) { console.error("\n=== HAY FALLOS (concierge) ==="); process.exit(1); }
  console.log("\n=== TODO OK (concierge v2) ===");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
