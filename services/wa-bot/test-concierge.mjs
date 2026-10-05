// Test del modo conserje (default: BOT_TAKE_ORDERS sin setear → apagado).
// El asistente no arma pedido por chat; solo saluda, comparte el menú, evalúa
// abierto/cerrado, y deriva al dueño si hay problema o campo libre.
//
// Cubrimos: el flujo de pedidos queda INTACTO (sin borrar) pero sin entrar.

const { handleInbound } = await import("./src/bot.mjs");

const MOCK_MENU = {
  vendor: { id: "vtest", store_name: "Che Sancho", vertical: "gastronomia", store_open: true, open_text: "Abierto ahora" },
  products: [{ id: "p1", name: "Empanada de carne", price: 1200, category: "Empanadas" }],
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/api/wa/menu")) return { ok: true, json: async () => MOCK_MENU };
  if (u.includes("/api/wa/handoff")) return { ok: true, json: async () => ({ ok: true }) };
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

  // 1. hola → saludo con abierto/cerrado + menú + pregunta del problema.
  r = await handleInbound({ vendor, waId: wa, body: "hola" });
  show("hola", r);
  const saludo = (r.replies || []).join(" ");
  if (!saludo.includes("Che Sancho") || !saludo.includes("tuviste algún problema")) { console.log("!!! el saludo no dice nombre + pregunta del problema"); ok = false; }
  else if (!saludo.includes("portal659.com.ar/tienda/")) { console.log("!!! el saludo no comparte el menú online"); ok = false; }
  else { console.log(">>> OK: saludo con abiertos/abierto + menú + pregunta del problema"); }

  // 2. "quiero empanadas" → NO lo toma como pedido: el bot redirige al menú.
  r = await handleInbound({ vendor, waId: wa, body: "quiero 2 empanadas" });
  show("quiero empanadas", r);
  const nopedido = (r.replies || []).join(" ");
  if (nopedido.includes("Tu pedido") || nopedido.includes("Empanada")) { console.log("!!! el concierge interpretó el pedido (NO debe)"); ok = false; }
  else { console.log(">>> OK: 'quiero empanadas' NO se interpreta como pedido por el chat"); }

  // 3. Respuesta "sí" → handoff a la persona del comercio + push.
  r = await handleInbound({ vendor, waId: wa, body: "sí" });
  show("sí (handoff)", r);
  const handsTxt = (r.replies || []).join(" ");
  if (!handsTxt.includes("Enseguida te atiende una persona") || !handsTxt.includes("Che Sancho")) { console.log("!!! el sí no avisó al comercio"); ok = false; }
  else { console.log(">>> OK: el sí hace handoff a la persona de Che Sancho"); }

  // El handoff pone pausa: otro texto no responde como normal (una sola notificación).
  r = await handleInbound({ vendor, waId: wa, body: "hola" });
  show("pausa (la va a atender una persona)", r);
  const pauseTxt = (r.replies || []).join(" ");
  if (pauseTxt.includes("atender por acá en un rato")) { console.log(">>> OK: tras el handoff el bot notifica una vez y queda en pausa"); }
  else if ((pauseTxt || "").length === 0) { console.log(">>> OK: tras el handoff el bot queda mudo"); }
  else { console.log("!!! tras el handoff el bot siguió el chat: " + pauseTxt.slice(0, 120)); ok = false; }

  // 4. La rama "no" (cancelarando la pausa primero) → consulta/sugerencia.
  r = await handleInbound({ vendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor, waId: wa, body: "hola" });
  show("hola (de nuevo tras cancelar)", r);
  r = await handleInbound({ vendor, waId: wa, body: "no" });
  show("no", r);
  const noTxt = (r.replies || []).join(" ");
  if (!noTxt.includes("consulta") || !noTxt.includes("sugerencia")) { console.log("!!! el no no pregunta consulta/sugerencia"); ok = false; }
  else { console.log(">>> OK: el no pregunta consulta/sugerencia"); }

  // 5. La consulta: el comercio recibe el push y el cliente confirmación.
  r = await handleInbound({ vendor, waId: wa, body: "¿tienen bebidas sin azúcar?" });
  show("consulta", r);
  const consultaTxt = (r.replies || []).join(" ");
  if (!consultaTxt.includes("pasé") && !consultaTxt.includes("paso")) { console.log("!!! la consulta no se confirmó con el 'pasé al comercio'"); ok = false; }
  else { console.log(">>> OK: la consulta se reenvía al comercio por push"); }

  // 6. Lee menú otra vez → vuelve a mostrar sin romper.
  r = await handleInbound({ vendor, waId: wa, body: "menú" });
  show("menú otra vez", r);
  if (!(r.replies || []).join(" ").includes("portal659.com.ar/tienda/")) { console.log("!!! el menú no se re-muestra"); ok = false; }

  if (!ok) { console.error("\n=== HAY FALLOS (concierge) ==="); process.exit(1); }
  console.log("\n=== TODO OK (concierge) ===");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
