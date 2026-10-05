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

  // 2. Pedido armado → ok + canal abierto. latest-orders 404 → cae al menú de la tienda.
  r = await handleInbound({ vendor, waId: wa, body: "quiero una empanada" });
  show("quiero empanada (sin pedido reciente)", r);
  const ok2 = (r.replies || []).join(" ");
  if (!ok2.includes("Ya tenemos tu pedido") || !ok2.includes("ayuda") || !ok2.includes("portal659")) { console.log("!!! el pedido armado no fue ok"); ok = false; }
  else { console.log(">>> OK: pedido armado → ok + canal abierto (sin pedir más nada)"); }

  // Con pedido reciente → el link se vuelva de seguimiento.
  recentOrder = { pickupNumber: 7, trackUrl: "https://www.portal659.com.ar/seguimiento/abc" };
  r = await handleInbound({ vendor, waId: wa, body: "agregame una coca" });
  show("pedido + pedido reciente", r);
  const ok3 = (r.replies || []).join(" ");
  if (!ok3.includes("Nro. 7") || !ok3.includes("seguimiento/abc")) { console.log("!!! no se enfatizó el link de seguimiento del pedido"); ok = false; }
  else { console.log(">>> OK: pedido con nro + link de seguimiento cuando ya existe"); }

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

  // 7. "ayuda" → handoff directo, ni preguntas.
  r = await handleInbound({ vendor, waId: wa, body: "ayuda" });
  show("ayuda", r);
  if (!(r.replies || []).join(" ").includes("Enseguida te atiende una persona")) { console.log("!!! 'ayuda' no fue al humano"); ok = false; }
  else { console.log(">>> OK: 'ayuda' → handoff inmediato"); }

  if (!ok) { console.error("\n=== HAY FALLOS (concierge) ==="); process.exit(1); }
  console.log("\n=== TODO OK (concierge v2) ===");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
