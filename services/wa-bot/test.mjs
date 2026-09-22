import { handleInbound } from "./src/bot.mjs";

const MOCK_MENU = {
  products: [
    { id: "p1", name: "Empanada de carne", price: 1200, category: "Empanadas" },
    { id: "p2", name: "Empanada de jamón y queso", price: 1300, category: "Empanadas" },
    { id: "p3", name: "Coca-Cola 500ml", price: 1000, category: "Bebidas" },
    { id: "p4", name: "Pizza muzzarella", price: 8000, category: "Pizzas" },
  ],
};

let lastOrderBody = null;
let orderCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/api/wa/menu")) return { ok: true, json: async () => MOCK_MENU };
  if (u.includes("/api/wa/order")) {
    orderCalls++;
    lastOrderBody = JSON.parse(opts?.body || "{}");
    return { ok: true, json: async () => ({ ok: true, orderId: "ord-123", total: 4400 }) };
  }
  if (u.includes("/api/wa/handoff")) return { ok: true, json: async () => ({ ok: true }) };
  return realFetch(url, opts);
};

const vendor = {
  id: "vtest",
  store_name: "Che Sancho",
  slug: "che-sancho",
  enabled: true,
  transfer_alias: "chesancho.mp",
  transfer_cbu: null,
};

const wa = "5491134567890";

function show(label, r) {
  console.log(`\n===== ${label} =====`);
  console.log((r.replies || []).join("\n---\n"));
}

function assertOrder(label) {
  const items = lastOrderBody?.items || [];
  console.log(`>>> [${label}] /api/wa/order body:`, JSON.stringify(lastOrderBody));
  if (!orderCalls) { console.log("!!! NO se llamó a /api/wa/order"); return false; }
  if (!items.length || items.some((i) => !i.offerId)) {
    console.log("!!! items sin offerId — pricing.ts rechazaría con 400");
    return false;
  }
  console.log(">>> OK: items con offerId (el pedido no fallaría)");
  return true;
}

async function main() {
  let r, ok = true;
  r = await handleInbound({ vendor, waId: wa, body: "hola" });
  show("hola", r);

  // Flujo completo en UN mensaje combinado (reglas, sin LLM): debería extraer
  // items + método delivery + dirección y preguntar solo nombre/pago.
  r = await handleInbound({ vendor, waId: wa, body: "quiero 2 empanadas de carne y una coca, envío a calle 5 123" });
  show("pedido combinado", r);
  const pending = (r.replies || []).join(" ").toLowerCase();
  if (pending.includes("dirección") || !pending.includes("nombre") || !pending.includes("pag")) {
    console.log("!!! Debería preguntar solo nombre+pago (reglas ya capturaron dirección)"); ok = false;
  }

  // Nombre + pago en un mensaje: nombre por regla → el LLM no está, usá la
  // respuesta de una pieza tras la otra.
  r = await handleInbound({ vendor, waId: wa, body: "Juan" });
  show("nombre", r);

  r = await handleInbound({ vendor, waId: wa, body: "efectivo" });
  show("pago efectivo", r);
  if (!(r.replies || []).join(" ").includes("Todo bien")) { console.log("!!! pago no llevó al resumen de confirm"); ok = false; }

  // "sí" con TODO completo → confirmar → crear pedido (antes el "sí" se comía
  // como nombre; y antes aun /api/wa/order fallaba por falta de offerId).
  r = await handleInbound({ vendor, waId: wa, body: "sí" });
  show("sí (crear pedido)", r);
  ok = assertOrder("confirmar completo") && ok;

  // Un "sí" posterior NO debe re-confirmar el mismo pedido (estado limpio).
  r = await handleInbound({ vendor, waId: wa, body: "sí" });
  show("sí después de confirmar (debe ignorarse)", r);
  const afterConfirm = (r.replies || []).join(" ");
  if (afterConfirm.includes("Pedido confirmado")) { console.log("!!! Re-confirmó el pedido (estado zombie)"); ok = false; }

  console.log('\n--- ESC: "cambiar método" en el flujo (delivery→retiro) ---');
  r = await handleInbound({ vendor, waId: wa, body: "quiero 1 coca, envío a saavedra 800" });
  show("pedido coca + delivery", r);
  r = await handleInbound({ vendor, waId: wa, body: "mejor lo retiro" });
  show("cambio a retiro", r);
  const campoRetiro = (r.replies || []).join(" ");
  if (campoRetiro.includes("dirección")) { console.log("!!! Tras retiro sigue preguntando dirección"); ok = false; }
  r = await handleInbound({ vendor, waId: wa, body: "Juan" });
  show("nombre retiro", r);
  r = await handleInbound({ vendor, waId: wa, body: "efectivo" });
  show("pago retiro", r);
  r = await handleInbound({ vendor, waId: wa, body: "sí" });
  show("confirmar retiro", r);
  ok = assertOrder("confirmar retiro") && ok;
  if (!(lastOrderBody?.method === "pickup")) { console.log("!!! pedido retiro no salió como pickup"); ok = false; }
  console.log(`>>> [retiro] método ${lastOrderBody?.method}; dirección "${lastOrderBody?.customerAddress}" (ok aunque sobre, es informativa)`);

  console.log("\n--- ESC: cantidades en palabras ---");
  r = await handleInbound({ vendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor, waId: wa, body: "quiero una docena de empanadas de carne" });
  show("una docena", r);
  if (!(r.replies || []).join(" ").includes("×12")) { console.log("!!! docena no resolvió a ×12"); ok = false; }

  // Re-declarar no duplica tras docena.
  r = await handleInbound({ vendor, waId: wa, body: "no, mejor solo 3 empanadas" });
  show("re-declaración", r);
  if (!(r.replies || []).join(" ").includes("×3")) { console.log("!!! re-declaración no resolvió a ×3 (no duplicó)"); ok = false; }
  if ((r.replies || []).join(" ").includes("×12")) { console.log("!!! quedó ×12 (duplicó)"); ok = false; }

  if (!ok) { console.error("\n=== HAY FALLOS ==="); process.exit(1); }
  console.log("\n=== TODO OK ===");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });